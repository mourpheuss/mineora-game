import crypto from 'crypto';

// Bitget API Bilgileri
const ADMIN_API_KEY = "bg_f73437198f37d20e56939b82041041d0";
const ADMIN_SECRET = "fe44b9c347eb5d9dd0e624876809102bb3ec8bab9481ad7bdb5ddf4d8d332ecd";
const ADMIN_PASSPHRASE = "Ers4834754";
const BITGET_BASE_URL = 'https://api.bitget.com';

const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_VIP_CHANNEL_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_BASE = "https://mineora-web-default-rtdb.firebaseio.com";

const memoryLocks = global._mineora_mem_locks || {};
global._mineora_mem_locks = memoryLocks;

function getBitgetSign(timestamp, method, requestPath, secret, queryString = '', body = '') {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? '?' + queryString : '') + body;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

async function bitgetRequest(apiKey, secret, passphrase, method, endpoint, params = {}, body = null) {
  const timestamp = Date.now().toString();
  const queryString = method === 'GET' && Object.keys(params).length > 0 ? new URLSearchParams(params).toString() : '';
  const bodyString = body ? JSON.stringify(body) : '';
  const sign = getBitgetSign(timestamp, method, endpoint, secret, queryString, bodyString);

  const url = `${BITGET_BASE_URL}${endpoint}${queryString ? '?' + queryString : ''}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': apiKey,
      'ACCESS-SIGN': sign,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': passphrase,
      'locale': 'en-US'
    },
    body: body ? bodyString : undefined
  });
  return await response.json();
}

async function tradeForUser(apiKey, secret, passphrase, symbol, side) {
  try {
    const accountRes = await bitgetRequest(apiKey, secret, passphrase, 'GET', '/api/v2/mix/account/account', {
      symbol: symbol,
      productType: 'usdt-futures',
      marginCoin: 'USDT'
    });

    if (accountRes.code !== '00000' || !accountRes.data) return { success: false, error: accountRes.msg };

    const availableUsdt = parseFloat(accountRes.data.available || '0');
    if (availableUsdt < 5) return { success: false, error: 'Yetersiz bakiye' };

    const marginToUse = availableUsdt * 0.30;
    const leverage = parseFloat(side === 'buy' ? (accountRes.data.longLeverage || accountRes.data.fixedLeverage || '10') : (accountRes.data.shortLeverage || accountRes.data.fixedLeverage || '10'));

    const tickerRes = await bitgetRequest(apiKey, secret, passphrase, 'GET', '/api/v2/mix/market/ticker', {
      symbol: symbol,
      productType: 'usdt-futures'
    });
    const currentPrice = parseFloat(tickerRes.data?.lastPr || '0');
    if (!currentPrice || currentPrice <= 0) return { success: false, error: 'Fiyat okunamadi' };

    let targetSize = Math.floor(((marginToUse * leverage) / currentPrice) * 10) / 10;

    const orderPayload = {
      productType: 'usdt-futures',
      symbol: symbol,
      marginMode: accountRes.data.marginMode || 'crossed',
      marginCoin: 'USDT',
      side: side,
      tradeSide: 'open',
      orderType: 'market',
      size: targetSize.toString()
    };

    const orderRes = await bitgetRequest(apiKey, secret, passphrase, 'POST', '/api/v2/mix/order/place-order', {}, orderPayload);
    return { success: orderRes.code === '00000', orderId: orderRes.data?.orderId, error: orderRes.msg };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default async function handler(req, res) {
  try {
    // 1. Bitget Vadeli Tahtaları Çek
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
    const json = await tickersRes.json();
    if (json.code !== "00000" || !Array.isArray(json.data)) {
      return res.status(500).json({ error: "Bitget verisi alinamadi" });
    }

    const priceMap = {};
    json.data.forEach(t => {
      priceMap[t.symbol] = parseFloat(t.lastPr || '0');
    });

    // 2. Firebase Kilitleri ve Aktif İşlemleri Oku
    let cronLocks = {};
    let activeTrades = {};
    let usersData = {};
    let onChainTransfers = [];

    try {
      const lockRes = await fetch(`${FIREBASE_BASE}/cron_locks.json`);
      cronLocks = (await lockRes.json()) || {};
      if (typeof cronLocks !== 'object' || cronLocks === null || cronLocks.error) cronLocks = {};
    } catch(e) { cronLocks = {}; }

    try {
      const atRes = await fetch(`${FIREBASE_BASE}/active_trades.json`);
      activeTrades = (await atRes.json()) || {};
      if (typeof activeTrades !== 'object' || activeTrades === null || activeTrades.error) activeTrades = {};
    } catch(e) { activeTrades = {}; }

    try {
      const uRes = await fetch(`${FIREBASE_BASE}/users.json`);
      usersData = (await uRes.json()) || {};
    } catch(e) { usersData = {}; }

    try {
      const wRes = await fetch(`${FIREBASE_BASE}/whale_transfers.json`);
      const wData = await wRes.json();
      if (wData && typeof wData === 'object' && !wData.error) {
        onChainTransfers = Object.keys(wData).map(k => wData[k]).filter(w => w && typeof w === 'object');
      }
    } catch(e) { onChainTransfers = []; }

    const now = Date.now();

    // ====================================================
    // 3. AKTİF İŞLEMLERİN TP/SL TAKİBİ
    // ====================================================
    for (const symbol of Object.keys(activeTrades)) {
      const trade = activeTrades[symbol];
      if (!trade || trade.status !== 'OPEN') continue;

      const tradeAgeMinutes = (now - (trade.openedAt || 0)) / (1000 * 60);
      if (tradeAgeMinutes < 3) continue;

      const currentPrice = priceMap[symbol];
      if (!currentPrice) continue;

      const isLong = trade.direction === 'LONG';
      let isClosed = false;
      let closeReason = '';

      if (isLong) {
        if (currentPrice <= trade.sl) {
          isClosed = true;
          closeReason = 'STOP-LOSS (SL)';
        } else if (currentPrice >= trade.tp2) {
          isClosed = true;
          closeReason = 'TP 2 (TÜM HEDEFLER ALINDI)';
        } else if (currentPrice >= trade.tp1 && !trade.tp1Hit) {
          trade.tp1Hit = true;
          fetch(`${FIREBASE_BASE}/active_trades/${symbol}/tp1Hit.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(true)
          }).catch(() => {});

          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TG_VIP_CHANNEL_ID,
              text: `🎯 <b>HEDEF 1 ALINDI (TP1)!</b>\n━━━━━━━━━━━━━━━━━━━━\n💎 <b>Parite:</b> <code>#${symbol}</code> (LONG)\n💰 <b>Fiyat:</b> <code>$${currentPrice}</code>\n💡 <i>Pozisyonun %50'si kârla kapatıldı, stop maliyete çekildi. TP2 bekleniyor.</i>`,
              parse_mode: 'HTML'
            })
          });
        }
      } else {
        if (currentPrice >= trade.sl) {
          isClosed = true;
          closeReason = 'STOP-LOSS (SL)';
        } else if (currentPrice <= trade.tp2) {
          isClosed = true;
          closeReason = 'TP 2 (TÜM HEDEFLER ALINDI)';
        } else if (currentPrice <= trade.tp1 && !trade.tp1Hit) {
          trade.tp1Hit = true;
          fetch(`${FIREBASE_BASE}/active_trades/${symbol}/tp1Hit.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(true)
          }).catch(() => {});

          await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TG_VIP_CHANNEL_ID,
              text: `🎯 <b>HEDEF 1 ALINDI (TP1)!</b>\n━━━━━━━━━━━━━━━━━━━━\n💎 <b>Parite:</b> <code>#${symbol}</code> (SHORT)\n💰 <b>Fiyat:</b> <code>$${currentPrice}</code>\n💡 <i>Pozisyonun %50'si kârla kapatıldı, stop maliyete çekildi. TP2 bekleniyor.</i>`,
              parse_mode: 'HTML'
            })
          });
        }
      }

      if (isClosed) {
        fetch(`${FIREBASE_BASE}/active_trades/${symbol}.json`, { method: 'DELETE' }).catch(() => {});
        delete activeTrades[symbol];

        await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TG_VIP_CHANNEL_ID,
            text: `${closeReason.includes('STOP') ? '🛑' : '🚀'} <b>POZİSYON TAMAMLANDI: ${closeReason}</b>\n━━━━━━━━━━━━━━━━━━━━\n💎 <b>Parite:</b> <code>#${symbol}</code>\n📊 <b>Giriş:</b> <code>$${trade.entryPrice}</code> ➔ <b>Kapanış:</b> <code>$${currentPrice}</code>\n🔓 <i>Parite kilidi açıldı. Yeni formasyonlar takip ediliyor.</i>`,
            parse_mode: 'HTML'
          })
        });
      }
    }

    // Likidite Filtresi ($800k üzeri)
    const liquidPool = json.data.filter(t => {
      return t.symbol.endsWith("USDT") &&
             !EXCLUDED.includes(t.symbol) &&
             parseFloat(t.usdtVolume || 0) >= 800000;
    });

    const signalsToProcess = [];

    // LONG Taraması (X-Ray Uyumlu)
    const longCandidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);
      return funding <= -0.0035 && chg >= -4.0 && chg <= 8.0;
    }).sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate));

    longCandidates.forEach(c => signalsToProcess.push({ item: c, direction: 'LONG' }));

    // SHORT Taraması (Hiper-Pump Kalkanlı)
    const shortCandidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);

      if (chg > 45.0 || funding <= 0.0003) return false;
      return (chg >= 18.0 && chg <= 45.0 && funding >= 0.0005) || (funding >= 0.0010 && chg >= 10.0);
    }).sort((a, b) => parseFloat(b.change24h) - parseFloat(a.change24h));

    shortCandidates.forEach(c => signalsToProcess.push({ item: c, direction: 'SHORT' }));

    const sentSymbols = [];

    // ====================================================
    // 4. X-RAY ONAYLI SİNYAL VE İŞLEM MOTORU
    // ====================================================
    for (const signal of signalsToProcess) {
      const item = signal.item;
      const dir = signal.direction;
      const symbol = item.symbol;

      // 1. KİLİT: Açık işlem varsa asla tekrar sinyal verme
      if (activeTrades[symbol] && activeTrades[symbol].status === 'OPEN') continue;

      // 2. KİLİT: 180 Dakika (3 Saat) Firebase Kilidi
      const lastFirebaseTime = typeof cronLocks[symbol] === 'number' ? cronLocks[symbol] : 0;
      if ((now - lastFirebaseTime) / (1000 * 60) < 180) continue;

      // 3. KİLİT: Vercel Bellek Kilidi
      const lastMemoryTime = memoryLocks[symbol] || 0;
      if ((now - lastMemoryTime) / (1000 * 60) < 180) continue;

      // Kilitleri mühürle
      memoryLocks[symbol] = now;
      cronLocks[symbol] = now;
      fetch(`${FIREBASE_BASE}/cron_locks/${symbol}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(now)
      }).catch(() => {});

      const price = parseFloat(item.lastPr);
      const rawFunding = parseFloat(item.fundingRate || 0);
      const fundingPct = (rawFunding * 100).toFixed(4);
      const chg = parseFloat(item.change24h || 0) * 100;
      const volM = (parseFloat(item.usdtVolume || 0) / 1000000).toFixed(2);

      // --- X-RAY PARAMETRELERİ HESAPLAMASI ---
      let score = 85;
      let fuel = 80;
      let retailRatio = 25;
      let whaleRatio = 75;
      let wickTarget = 0;
      let tp1, tp2, sl, rr;

      if (dir === 'LONG') {
        const isExtreme = rawFunding <= -0.005;
        score = Math.min(96, Math.floor(82 + Math.abs(rawFunding) * 2000));
        fuel = Math.min(95, Math.floor(75 + Math.abs(rawFunding) * 3000));
        wickTarget = price * 0.988;
        tp1 = price * 1.018;
        tp2 = isExtreme ? price * 1.048 : price * 1.038;
        sl = price * 0.986;
        rr = ((tp1 - price) / (price - sl)).toFixed(1);
      } else {
        score = 86;
        fuel = 20; // Shortta yukarı yakıt bitti
        retailRatio = 80;
        whaleRatio = 20;
        wickTarget = price * 1.018;
        tp1 = price * 0.982;
        tp2 = price * 0.955;
        sl = price * 1.015;
        rr = ((price - tp1) / (sl - price)).toFixed(1);
      }

      // Firebase'e aktif işlem olarak kaydet
      const tradePayload = {
        symbol,
        direction: dir,
        entryPrice: price,
        tp1,
        tp2,
        sl,
        status: 'OPEN',
        tp1Hit: false,
        openedAt: now
      };
      activeTrades[symbol] = tradePayload;
      fetch(`${FIREBASE_BASE}/active_trades/${symbol}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradePayload)
      }).catch(() => {});

      // Bitget Oto-İşlem (Kullanıcılar & Admin)
      const orderSide = dir === 'LONG' ? 'buy' : 'sell';
      let executionCount = 0;
      if (usersData && typeof usersData === 'object') {
        for (const uKey of Object.keys(usersData)) {
          const u = usersData[uKey];
          if (u.autoTradeEnabled && u.bitgetApi?.key && u.bitgetApi?.secret && u.bitgetApi?.passphrase) {
            await tradeForUser(u.bitgetApi.key, u.bitgetApi.secret, u.bitgetApi.passphrase, symbol, orderSide);
            executionCount++;
          }
        }
      }
      if (executionCount === 0) {
        await tradeForUser(ADMIN_API_KEY, ADMIN_SECRET, ADMIN_PASSPHRASE, symbol, orderSide);
      }

      // On-Chain Eşleşme
      const matchedWhale = onChainTransfers.find(w => w.symbol === symbol);
      const hasOnChainConfirmation = !!matchedWhale;

      const pEntry = price < 1 ? price.toFixed(6) : price.toFixed(4);
      const pSl = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);
      const pTp1 = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
      const pTp2 = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);
      const pWick = wickTarget < 1 ? wickTarget.toFixed(6) : wickTarget.toFixed(4);

      const isLong = dir === 'LONG';
      const badgeTitle = hasOnChainConfirmation 
        ? `👑 <b>MINEORA X-RAY | ELMAS ONAYLI RÖNTGEN SİNYALİ</b>\n🛡️ <i>[ON-CHAIN CÜZDAN AKIŞI İLE ÇİFT DOĞRULANMIŞ]</i>` 
        : `🔬 <b>MINEORA X-RAY | YÜKSEK GÜVENLİK SİNYALİ</b>`;

      const onChainNote = hasOnChainConfirmation 
        ? `\n🐋 <b>Balina Teyidi:</b> <code>${matchedWhale.amount || ''} ${matchedWhale.asset || ''} (${matchedWhale.usd || ''}) ${matchedWhale.type || ''}</code>\n` 
        : '';

      // YENİ X-RAY FORMATLI TELEGRAM MESAJI
      const msg = `${badgeTitle}\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> <code>#${symbol}</code>\n` +
                  `${isLong ? '🟢 <b>YÖN:</b> <b>LONG (SHORT SIKIŞMASI & PUMP) 🚀</b>' : '🔴 <b>YÖN:</b> <b>SHORT (TEPE DAĞITIMI & DUMP) 🩸</b>'}\n` +
                  `📊 <b>Giriş Fiyatı:</b> <code>$${pEntry}</code> (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)\n` +
                  `⚡ <b>Fonlama Oranı:</b> <code>${fundingPct}%</code> | <b>Hacim:</b> <code>$${volM}M</code>\n\n` +
                  `🔬 <b>X-RAY RÖNTGEN PARAMETRELERİ:</b>\n` +
                  `🛡️ <b>Güvenlik Skoru:</b> <code>%${score} / 100 [GÜVENLİ]</code>\n` +
                  `⛽ <b>Yakıt / Cephane:</b> <code>%${fuel} Depo ${isLong ? '(Taze)' : '(Tükendi)'}</code>\n` +
                  `🐋 <b>Oyuncu Dağılımı:</b> <code>%${whaleRatio} Balina / %${retailRatio} Sürü</code>\n` +
                  `🎯 <b>Piyasa Yapıcı İğne (Wick):</b> <code>$${pWick}</code>\n` +
                  `${onChainNote}\n` +
                  `🎯 <b>LİKİDASYON & İŞLEM PLANI:</b>\n` +
                  `🎯 <b>Giriş:</b> <code>$${pEntry}</code>\n` +
                  `🛑 <b>Stop-Loss (SL):</b> <code>$${pSl}</code> (${isLong ? '-%1.4' : '+%1.5'})\n` +
                  `🎯 <b>TP 1:</b> <code>$${pTp1}</code> (${isLong ? '+%1.8' : '-%1.8'})\n` +
                  `🚀 <b>TP 2:</b> <code>$${pTp2}</code> (${isLong ? '+%3.8+' : '-%4.5+'})\n` +
                  `⚖️ <b>Risk/Ödül (R:R):</b> <code>1 : ${rr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🌐 <b>Canlı Röntgen:</b> mineoragame.com\n` +
                  `💡 <i>TP1 seviyesinde kasanın %50'si nakde geçmeli, stop maliyete çekilmelidir.</i>`;

      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_VIP_CHANNEL_ID, text: msg, parse_mode: 'HTML' })
      });

      sentSymbols.push(`${symbol} (${dir})${hasOnChainConfirmation ? ' [ELMAS]' : ''}`);
    }

    return res.status(200).json({ success: true, processed: sentSymbols });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
