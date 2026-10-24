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

// ÇİFT YÖNLÜ OTO-İŞLEM (side: 'buy' veya 'sell')
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
    const leverage = parseFloat(side === 'buy' ? (accountRes.data.longLeverage || '10') : (accountRes.data.shortLeverage || '10'));

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
      side: side, // 'buy' (Long) veya 'sell' (Short)
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
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
    const json = await tickersRes.json();
    if (json.code !== "00000" || !Array.isArray(json.data)) {
      return res.status(500).json({ error: "Bitget verisi alinamadi" });
    }

    let locks = {};
    try {
      const lockRes = await fetch(`${FIREBASE_BASE}/cron_locks.json`);
      locks = (await lockRes.json()) || {};
    } catch(e) {
      locks = {};
    }

    const liquidPool = json.data.filter(t => {
      return t.symbol.endsWith("USDT") &&
             !EXCLUDED.includes(t.symbol) &&
             parseFloat(t.usdtVolume || 0) >= 800000;
    });

    const signalsToProcess = [];

    // 1. LONG ADAYLARI: Negatif Fonlama + Henüz Fırlamamış Dip Tahtalar
    const longCandidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);
      return funding <= -0.0035 && chg >= -4.0 && chg <= 8.0;
    });
    longCandidates.forEach(c => signalsToProcess.push({ item: c, direction: 'LONG' }));

    // 2. SHORT ADAYLARI: Aşırı Pozitif Fonlama VEYA Aşırı Şişip Tepe Yapmış Dönüş Pariteleri
    const shortCandidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);
      // Şart: Fonlama aşırı pozitif (küçük yatırımcı Long tarafında sıkışmış) VEYA 24s'de %25 üzeri fırlamış
      return (funding >= 0.015) || (chg >= 25.0 && funding > 0);
    });
    shortCandidates.forEach(c => signalsToProcess.push({ item: c, direction: 'SHORT' }));

    const sentSymbols = [];

    for (const signal of signalsToProcess) {
      const item = signal.item;
      const dir = signal.direction;
      const symbol = item.symbol;
      const lockKey = `${symbol}_${dir}`;
      
      const lastSentTime = typeof locks[lockKey] === 'number' ? locks[lockKey] : 0;
      const minutesPassed = (Date.now() - lastSentTime) / (1000 * 60);

      if (minutesPassed < 120) continue;

      // Kilidi Firebase'e kaydet
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

      let tp1, tp2, sl;
      if (dir === 'LONG') {
        tp1 = price * 1.018;
        tp2 = rawFunding <= -0.005 ? price * 1.048 : price * 1.038;
        sl = price * 0.986;
      } else {
        // SHORT HEDEFLERİ
        tp1 = price * 0.982;
        tp2 = price * 0.955;
        sl = price * 1.015;
      }

      const pEntry = price < 1 ? price.toFixed(6) : price.toFixed(4);
      const pSl = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);
      const pTp1 = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
      const pTp2 = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);

      // Otomatik Emri Aç (buy veya sell)
      const orderSide = dir === 'LONG' ? 'buy' : 'sell';
      await tradeForUser(ADMIN_API_KEY, ADMIN_SECRET, ADMIN_PASSPHRASE, symbol, orderSide);

      // Telegram Mesajı
      const isLong = dir === 'LONG';
      const msg = `⚡ <b>MINEORA VIP SENTINEL | BALİNA AVCI SİNYALİ</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> <code>#${symbol}</code>\n` +
                  `${isLong ? '🟢 <b>YÖN / BEKLENTİ:</b> <b>LONG (PUMP / YUKARI PATLAMA) 🚀</b>' : '🔴 <b>YÖN / BEKLENTİ:</b> <b>SHORT (DUMP / TEPE ÇÖKÜŞÜ) 🩸</b>'}\n` +
                  `📊 <b>Giriş Fiyatı:</b> <code>$${pEntry}</code>\n` +
                  `⚡ <b>Fonlama Oranı:</b> <code>${funding}%</code>\n` +
                  `⚠️ <b>Teşhis:</b> ${isLong ? 'Negatif Fonlama & Short Sıkışması' : 'Aşırı Şişme / Long Tasfiye Riski'}\n\n` +
                  `🎯 <b>LİKİDASYON İŞLEM PLANI:</b>\n` +
                  `🎯 <b>Giriş:</b> <code>$${pEntry}</code>\n` +
                  `🛑 <b>Stop-Loss (SL):</b> <code>$${pSl}</code> (${isLong ? '-%1.4' : '+%1.5'})\n` +
                  `🎯 <b>TP 1:</b> <code>$${pTp1}</code> (${isLong ? '+%1.8' : '-%1.8'})\n` +
                  `🚀 <b>TP 2:</b> <code>$${pTp2}</code> (${isLong ? '+%3.8+' : '-%4.5+'})\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💡 <i>TP1 seviyesinde kasanın %50'si nakde geçilmeli, stop maliyete çekilmelidir.</i>`;

      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_VIP_CHANNEL_ID, text: msg, parse_mode: 'HTML' })
      });

      sentSymbols.push(`${symbol} (${dir})`);
    }

    return res.status(200).json({ success: true, processed: sentSymbols });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
