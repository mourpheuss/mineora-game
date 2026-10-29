import crypto from 'crypto';

// ================= ADMİN (SENİN) BİTGET API BİLGİLERİN =================
const ADMIN_API_KEY = "bg_70a6d856aad55c998597f8888e27a61f";
const ADMIN_SECRET = "07562c9e62461b950ac8eec37fc9c9cb821bee34a57fc14fca54352bb5423804";
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
    // 1. Serbest Bakiyeyi Bitget UTA V3 Üzerinden Çek
    let availableUsdt = 0;
    const accRes = await bitgetRequest(apiKey, secret, passphrase, 'GET', '/api/v3/account/assets');
    if (accRes.code === '00000' && Array.isArray(accRes.data)) {
      const u = accRes.data.find(a => (a.coin === 'USDT' || a.coinName === 'USDT'));
      if (u) availableUsdt = parseFloat(u.available || u.equity || 0);
    }

    if (availableUsdt < 5) {
      return { success: false, error: `Yetersiz bakiye: ${availableUsdt} USDT` };
    }

    // 2. Kasanın %3'ü Teminat Olarak Belirlenir
    const marginToUse = availableUsdt * 0.03;
    const leverage = 20;

    // 3. Anlık Fiyatı Al
    const tickerRes = await bitgetRequest(apiKey, secret, passphrase, 'GET', '/api/v2/mix/market/ticker', {
      symbol: symbol,
      productType: 'usdt-futures'
    });
    const currentPrice = parseFloat(tickerRes.data?.lastPr || '0');
    if (!currentPrice || currentPrice <= 0) {
      return { success: false, error: 'Anlik fiyat okunamadi' };
    }

    // 4. Boyut (Size) Hesapla: (Marjin * Kaldıraç) / Fiyat
    let targetSize = parseFloat(((marginToUse * leverage) / currentPrice).toFixed(2));
    if (targetSize <= 0) targetSize = 1;

    // 5. Kaldıraç Ayarla (UTA V3)
    await bitgetRequest(apiKey, secret, passphrase, 'POST', '/api/v3/account/set-leverage', {}, {
      symbol: symbol,
      productType: 'usdt-futures',
      leverage: leverage.toString()
    });

    // 6. Market Emrini Borsaya İlet (UTA V3)
    const orderPayload = {
      category: 'USDT-FUTURES',
      symbol: symbol,
      side: 'buy',
      orderType: 'market',
      qty: targetSize.toString()
    };

    const orderRes = await bitgetRequest(apiKey, secret, passphrase, 'POST', '/api/v3/trade/place-order', {}, orderPayload);

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

  // 1. Senin Şahsi İşlemin
  const adminTrade = await tradeForUser(ADMIN_API_KEY, ADMIN_SECRET, ADMIN_PASSPHRASE, symbol);
  results.push({ user: 'admin', result: adminTrade });

  // 2. Firebase Üyeleri
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
