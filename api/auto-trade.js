import crypto from 'crypto';

// ================= ADMİN (SENİN) BİTGET API BİLGİLERİN =================
const ADMIN_API_KEY = "bg_f73437198f37d20e56939b82041041d0";
const ADMIN_SECRET = "fe44b9c347eb5d9dd0e624876809102bb3ec8bab9481ad7bdb5ddf4d8d332ecd";
const ADMIN_PASSPHRASE = "Ers4834754";
const BITGET_BASE_URL = 'https://api.bitget.com';

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
    // 1. Serbest Vadeli USDT Bakiyesini Oku
    const accountRes = await bitgetRequest(apiKey, secret, passphrase, 'GET', '/api/v2/mix/account/account', {
      symbol: symbol,
      productType: 'usdt-futures',
      marginCoin: 'USDT'
    });

    if (accountRes.code !== '00000' || !accountRes.data) {
      return { success: false, error: accountRes.msg || 'Hesap verisi alinamadi' };
    }

    const availableUsdt = parseFloat(accountRes.data.available || '0');
    if (availableUsdt < 5) {
      return { success: false, error: `Yetersiz bakiye: ${availableUsdt} USDT` };
    }

    // 2. Bakiyenin %30'unu Teminat Yap
    const marginToUse = availableUsdt * 0.30;

    // 3. Bitget'te Ayarlı Kaldıracı Çek (Yoksa varsayılan 10x)
    const leverage = parseFloat(accountRes.data.longLeverage || accountRes.data.fixedLeverage || '10');

    // 4. Anlık Fiyatı Al
    const tickerRes = await bitgetRequest(apiKey, secret, passphrase, 'GET', '/api/v2/mix/market/ticker', {
      symbol: symbol,
      productType: 'usdt-futures'
    });
    const currentPrice = parseFloat(tickerRes.data?.lastPr || '0');
    if (!currentPrice || currentPrice <= 0) {
      return { success: false, error: 'Anlik fiyat okunamadi' };
    }

    // 5. Boyut (Size) Hesapla: (Marjin * Kaldıraç) / Fiyat
    const totalPositionUsdt = marginToUse * leverage;
    let targetSize = totalPositionUsdt / currentPrice;
    targetSize = Math.floor(targetSize * 10) / 10; // Küsürat yuvarlama

    // 6. Market Long Emrini Borsaya İlet
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

    if (orderRes.code === '00000') {
      return { success: true, orderId: orderRes.data?.orderId, size: targetSize, marginUsed: marginToUse };
    } else {
      return { success: false, error: orderRes.msg };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol gereklidir' });

  const results = [];

  // 1. Senin Şahsi İşlemin (Öncelikli olarak anında açılır)
  const adminTrade = await tradeForUser(ADMIN_API_KEY, ADMIN_SECRET, ADMIN_PASSPHRASE, symbol);
  results.push({ user: 'admin', result: adminTrade });

  // 2. Firebase'den API Bağlamış ve Aktif Etmiş Üyelerin İşlemleri
  try {
    const fbRes = await fetch("https://mineora-web-default-rtdb.firebaseio.com/users.json");
    const users = await fbRes.json();

    if (users) {
      for (const [username, userData] of Object.entries(users)) {
        if (userData.isVip && userData.autoTradeEnabled && userData.bitgetApi?.key && userData.bitgetApi?.secret && userData.bitgetApi?.passphrase) {
          const userTrade = await tradeForUser(
            userData.bitgetApi.key,
            userData.bitgetApi.secret,
            userData.bitgetApi.passphrase,
            symbol
          );
          results.push({ user: username, result: userTrade });
        }
      }
    }
  } catch (e) {
    console.error("Firebase üyeleri taranırken hata:", e);
  }

  return res.status(200).json({ success: true, processed: results });
}
