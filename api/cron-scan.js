import crypto from 'crypto';

// Bitget API Bilgilerin
const ADMIN_API_KEY = "bg_f73437198f37d20e56939b82041041d0";
const ADMIN_SECRET = "fe44b9c347eb5d9dd0e624876809102bb3ec8bab9481ad7bdb5ddf4d8d332ecd";
const ADMIN_PASSPHRASE = "Ers4834754";
const BITGET_BASE_URL = 'https://api.bitget.com';

const TG_BOT_TOKEN = "8682225307:AAHaa-hieKBBluU6uZ2_-OgSPxGR7OwMssE";
const TG_VIP_CHANNEL_ID = "-1004404988937";
const EXCLUDED = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const FIREBASE_BASE = "https://mineora-web-default-rtdb.firebaseio.com";

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

// ÇİFT YÖNLÜ OTO-İŞLEM MOTORU (Long: 'buy', Short: 'sell')
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

    // 2. Firebase'den Kalıcı Kilitleri ve On-Chain Transferlerini Al
    let locks = {};
    let onChainTransfers = [];
    try {
      const lockRes = await fetch(`${FIREBASE_BASE}/cron_locks.json`);
      locks = (await lockRes.json()) || {};
    } catch(e) {
      locks = {};
    }

    try {
      const whaleRes = await fetch(`${FIREBASE_BASE}/whale_transfers.json`);
      const whaleData = await whaleRes.json();
      if (whaleData && typeof whaleData === 'object') {
        onChainTransfers = Object.keys(whaleData).map(k => whaleData[k]);
      }
    } catch(e) {
      onChainTransfers = [];
    }

    // Likidite Filtresi: $800k ve üzeri, USDT vadeli pariteler
    const liquidPool = json.data.filter(t => {
      return t.symbol.endsWith("USDT") &&
             !EXCLUDED.includes(t.symbol) &&
             parseFloat(t.usdtVolume || 0) >= 800000;
    });

    const signalsToProcess = [];

    // ==========================================
    // 1. ORİJİNAL LONG ALGORİTMASI (Dokunulmadı)
    // ==========================================
    const longCandidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);
      return funding <= -0.0035 && chg >= -4.0 && chg <= 8.0;
    }).sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate));

    longCandidates.forEach(c => signalsToProcess.push({ item: c, direction: 'LONG' }));

    // ==========================================
    // 2. GÜVENLİ SHORT ALGORİTMASI (Dokunulmadı)
    // ==========================================
    const shortCandidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);
      const isExtremePumpWithPositiveFunding = chg >= 20.0 && funding >= 0.0002;
      const isHeavyCrowdedLong = funding >= 0.0008 && chg >= 8.0;
      return isExtremePumpWithPositiveFunding || isHeavyCrowdedLong;
    }).sort((a, b) => parseFloat(b.change24h) - parseFloat(a.change24h));

    shortCandidates.forEach(c => signalsToProcess.push({ item: c, direction: 'SHORT' }));

    const sentSymbols = [];

    // ==========================================
    // İŞLEM & SİNYAL DAĞITIM DÖNGÜSÜ
    // ==========================================
    for (const signal of signalsToProcess) {
      const item = signal.item;
      const dir = signal.direction;
      const symbol = item.symbol;
      const lockKey = `${symbol}_${dir}`;

      const lastSentTime = typeof locks[lockKey] === 'number' ? locks[lockKey] : 0;
      const minutesPassed = (Date.now() - lastSentTime) / (1000 * 60);

      // 120 DAKİKA KİLİT KONTROLÜ
      if (minutesPassed < 120) continue;

      // On-Chain Eşleşme Teyidi Kontrolü
      const matchedWhale = onChainTransfers.find(w => w.symbol === symbol);
      const hasOnChainConfirmation = !!matchedWhale;

      // Kilidi Firebase'e mühürle
      const now = Date.now();
      locks[lockKey] = now;
      await fetch(`${FIREBASE_BASE}/cron_locks/${lockKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(now)
      });

      const price = parseFloat(item.lastPr);
      const rawFunding = parseFloat(item.fundingRate || 0);
      const funding = (rawFunding * 100).toFixed(4);

      let tp1, tp2, sl, rr;

      if (dir === 'LONG') {
        const isExtreme = rawFunding <= -0.005;
        tp1 = price * 1.018;
        tp2 = isExtreme ? price * 1.048 : price * 1.038;
        sl = price * 0.986;
        rr = ((tp1 - price) / (price - sl)).toFixed(1);
      } else {
        tp1 = price * 0.982;
        tp2 = price * 0.955;
        sl = price * 1.015;
        rr = ((price - tp1) / (sl - price)).toFixed(1);
      }

      const pEntry = price < 1 ? price.toFixed(6) : price.toFixed(4);
      const pSl = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);
      const pTp1 = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
      const pTp2 = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);

      // Bitget Pozisyonunu Aç
      const orderSide = dir === 'LONG' ? 'buy' : 'sell';
      await tradeForUser(ADMIN_API_KEY, ADMIN_SECRET, ADMIN_PASSPHRASE, symbol, orderSide);

      // Telegram Mesajı Formatı
      const isLong = dir === 'LONG';
      const badgeTitle = hasOnChainConfirmation 
        ? `👑 <b>MINEORA VIP SENTINEL | ELMAS BALİNA SİNYALİ</b>\n🛡️ <i>[ON-CHAIN CÜZDAN HAREKETİ İLE ÇİFT TEYİTLİ]</i>` 
        : `⚡ <b>MINEORA VIP SENTINEL | BALİNA AVCI SİNYALİ</b>`;

      const onChainNote = hasOnChainConfirmation 
        ? `\n🐋 <b>Balina Teyidi:</b> <code>${matchedWhale.amount || ''} ${matchedWhale.asset || ''} (${matchedWhale.usd || ''}) ${matchedWhale.type || ''}</code>\n` 
        : '';

      const msg = `${badgeTitle}\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> <code>#${symbol}</code>\n` +
                  `${isLong ? '🟢 <b>YÖN / BEKLENTİ:</b> <b>LONG (PUMP / YUKARI PATLAMA) 🚀</b>' : '🔴 <b>YÖN / BEKLENTİ:</b> <b>SHORT (DUMP / TEPE ÇÖKÜŞÜ) 🩸</b>'}\n` +
                  `📊 <b>Giriş Fiyatı:</b> <code>$${pEntry}</code>\n` +
                  `⚡ <b>Fonlama Oranı:</b> <code>${funding}%</code>\n` +
                  `⚠️ <b>Teşhis:</b> ${isLong ? 'Negatif Fonlama & Short Sıkışması' : 'Aşırı Şişme / Long Tasfiye Riski'}\n` +
                  `${onChainNote}\n` +
                  `🎯 <b>LİKİDASYON İŞLEM PLANI:</b>\n` +
                  `🎯 <b>Giriş:</b> <code>$${pEntry}</code>\n` +
                  `🛑 <b>Stop-Loss (SL):</b> <code>$${pSl}</code> (${isLong ? '-%1.4' : '+%1.5'})\n` +
                  `🎯 <b>TP 1:</b> <code>$${pTp1}</code> (${isLong ? '+%1.8' : '-%1.8'})\n` +
                  `🚀 <b>TP 2:</b> <code>$${pTp2}</code> (${isLong ? '+%3.8+' : '-%4.5+'})\n` +
                  `⚖️ <b>Risk/Ödül (R:R):</b> <code>1 : ${rr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💡 <i>TP1 seviyesinde kasanın %50'si nakde geçilmeli, stop maliyete çekilmelidir.</i>`;

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
