import crypto from 'crypto';

// API BİLGİLERİN
const BITGET_API_KEY = "bg_f73437198f37d20e56939b82041041d0";
const BITGET_SECRET = "fe44b9c347eb5d9dd0e624876809102bb3ec8bab9481ad7bdb5ddf4d8d332ecd";
const BITGET_PASSPHRASE = "Ers4834754"; // <-- Bitget'te API oluştururken belirlediğin parola
const BITGET_BASE_URL = 'https://api.bitget.com';

function getBitgetSign(timestamp, method, requestPath, queryString = '', body = '') {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? '?' + queryString : '') + body;
  return crypto.createHmac('sha256', BITGET_SECRET).update(message).digest('base64');
}

async function bitgetRequest(method, endpoint, params = {}, body = null) {
  const timestamp = Date.now().toString();
  const queryString = method === 'GET' && Object.keys(params).length > 0 ? new URLSearchParams(params).toString() : '';
  const bodyString = body ? JSON.stringify(body) : '';
  const sign = getBitgetSign(timestamp, method, endpoint, queryString, bodyString);

  const url = `${BITGET_BASE_URL}${endpoint}${queryString ? '?' + queryString : ''}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': BITGET_API_KEY,
      'ACCESS-SIGN': sign,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': BITGET_PASSPHRASE,
      'locale': 'en-US'
    },
    body: body ? bodyString : undefined
  });

  return await response.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { symbol } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol gereklidir' });
  }

  try {
    // 1. Serbest Vadeli USDT Bakiyesini Oku
    const accountRes = await bitgetRequest('GET', '/api/v2/mix/account/account', {
      symbol: symbol,
      productType: 'usdt-futures',
      marginCoin: 'USDT'
    });

    if (accountRes.code !== '00000' || !accountRes.data) {
      return res.status(400).json({ error: accountRes.msg || 'Hesap verisi alinamadi' });
    }

    const availableUsdt = parseFloat(accountRes.data.available || '0');
    if (availableUsdt < 5) {
      return res.status(400).json({ error: `Yetersiz bakiye: ${availableUsdt} USDT` });
    }

    // 2. Bakiyenin %30'unu Teminat Olarak Ayır
    const marginToUse = availableUsdt * 0.30;

    // 3. Bitget'te Ayarlı Kaldıracı Oku (Ayarlı değilse 10x)
    const leverage = parseFloat(accountRes.data.longLeverage || accountRes.data.fixedLeverage || '10');

    // 4. Anlık Piyasa Fiyatını Al
    const tickerRes = await bitgetRequest('GET', '/api/v2/mix/market/ticker', {
      symbol: symbol,
      productType: 'usdt-futures'
    });
    const currentPrice = parseFloat(tickerRes.data?.lastPr || '0');
    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({ error: 'Anlik fiyat alinamadi' });
    }

    // 5. Boyut (Size) Hesapla: (Marjin * Kaldıraç) / Fiyat
    const totalPositionUsdt = marginToUse * leverage;
    let targetSize = totalPositionUsdt / currentPrice;
    targetSize = Math.floor(targetSize * 10) / 10; // Adet yuvarlama

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

    const orderRes = await bitgetRequest('POST', '/api/v2/mix/order/place-order', {}, orderPayload);

    if (orderRes.code === '00000') {
      return res.status(200).json({ 
        success: true, 
        orderId: orderRes.data?.orderId,
        size: targetSize,
        marginUsed: marginToUse,
        leverage: leverage
      });
    } else {
      return res.status(400).json({ error: orderRes.msg });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
