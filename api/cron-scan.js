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

async function tradeForUser(apiKey, secret, passphrase, symbol) {
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
    const leverage = parseFloat(accountRes.data.longLeverage || accountRes.data.fixedLeverage || '10');

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
      side: 'buy',
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
    // 1. Bitget Ticker Verilerini Al
    const tickersRes = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
    const json = await tickersRes.json();
    if (json.code !== "00000" || !Array.isArray(json.data)) {
      return res.status(500).json({ error: "Bitget verisi alinamadi" });
    }

    // 2. Firebase'den KALICI Kilit Verisini Çek
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

    const candidates = liquidPool.filter(t => {
      const chg = parseFloat(t.change24h || 0) * 100;
      const funding = parseFloat(t.fundingRate || 0);
      return funding <= -0.0035 && chg >= -4.0 && chg <= 8.0;
    }).sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate));

    const sentSymbols = [];

    for (const item of candidates) {
      const symbol = item.symbol;
      const lastSentTime = typeof locks[symbol] === 'number' ? locks[symbol] : 0;
      const minutesPassed = (Date.now() - lastSentTime) / (1000 * 60);

      // 120 DAKİKA (2 SAAT) GEÇMEDİYSE KESİNLİKLE PAS GEÇ
      if (minutesPassed < 120) {
        continue;
      }

      // KİLİDİ ANINDA FİREBASE'E KALICI YAZ (Bekletmeden)
      const now = Date.now();
      locks[symbol] = now;
      await fetch(`${FIREBASE_BASE}/cron_locks/${symbol}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(now)
      });

      const price = parseFloat(item.lastPr);
      const rawFunding = parseFloat(item.fundingRate || 0);
      const funding = (rawFunding * 100).toFixed(4);

      const isExtreme = rawFunding <= -0.005;
      const tp1 = price * 1.018;
      const tp2 = isExtreme ? price * 1.048 : price * 1.038;
      const sl = price * 0.986;
      const rr = ((tp1 - price) / (price - sl)).toFixed(1);

      const pEntry = price < 1 ? price.toFixed(6) : price.toFixed(4);
      const pSl = sl < 1 ? sl.toFixed(6) : sl.toFixed(4);
      const pTp1 = tp1 < 1 ? tp1.toFixed(6) : tp1.toFixed(4);
      const pTp2 = tp2 < 1 ? tp2.toFixed(6) : tp2.toFixed(4);

      // Otomatik İşlem Aç
      await tradeForUser(ADMIN_API_KEY, ADMIN_SECRET, ADMIN_PASSPHRASE, symbol);

      // Telegram VIP Bildirimi Gönder
      const msg = `⚡ <b>MINEORA VIP SENTINEL | BALİNA AVCI SİNYALİ</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>Parite:</b> <code>#${symbol}</code>\n` +
                  `🟢 <b>YÖN / BEKLENTİ:</b> <b>LONG (PUMP / YUKARI PATLAMA) 🚀</b>\n` +
                  `📊 <b>Giriş Fiyatı:</b> <code>$${pEntry}</code>\n` +
                  `⚡ <b>Fonlama Oranı:</b> <code>${funding}%</code>\n` +
                  `⚠️ <b>Teşhis:</b> Negatif Fonlama & Yoğun Short Sıkışması\n\n` +
                  `🎯 <b>LİKİDASYON İŞLEM PLANI:</b>\n` +
                  `🟢 <b>Giriş:</b> <code>$${pEntry}</code>\n` +
                  `🛑 <b>Stop-Loss (SL):</b> <code>$${pSl}</code> (-%1.4)\n` +
                  `🎯 <b>TP 1 (50x Tasfiye):</b> <code>$${pTp1}</code> (+%1.8)\n` +
                  `🚀 <b>TP 2 (20x Tasfiye):</b> <code>$${pTp2}</code> (+%4.2+)\n` +
                  `⚖️ <b>Risk/Ödül (R:R):</b> <code>1 : ${rr}</code>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💡 <i>TP1 seviyesinde kasanın %50'si nakde geçilmeli, stop maliyete çekilmelidir.</i>`;

      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_VIP_CHANNEL_ID, text: msg, parse_mode: 'HTML' })
      });

      sentSymbols.push(symbol);
    }

    return res.status(200).json({ success: true, sent: sentSymbols });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
