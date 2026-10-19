// TÜRKİYE SAAT DİLİMİ KİLİDİ (GMT+3)
process.env.TZ = 'Europe/Istanbul';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const FIREBASE_DB_URL = 'https://mineora-web-default-rtdb.firebaseio.com';

const IS_CLOUD = Boolean(process.env.VERCEL || process.env.RENDER);
const DB_FILE = IS_CLOUD ? path.join('/tmp', 'bitget_crypto_db.json') : path.join(__dirname, 'bitget_crypto_db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

function getTRTime(d = new Date(), sec = true) {
  return d.toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    ...(sec ? { second: '2-digit' } : {})
  });
}
function getTRDate(d = new Date()) {
  return d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit' });
}

function getDefaultDB() {
  return {
    users: [{
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      bitget: { 
        apiKey: '', 
        secretKey: '', 
        passphrase: '', 
        leverage: 10, 
        marginMode: 'crossed', 
        enabled: false, 
        tradeSizeUSDT: 50 
      }
    }],
    sessions: {},
    activeTrades: {},
    history: []
  };
}

function normalizeDB(parsed) {
  if (!parsed || typeof parsed !== 'object') return getDefaultDB();
  let rawUsers = Array.isArray(parsed.users) ? parsed.users.filter(Boolean) : (parsed.users ? Object.values(parsed.users).filter(Boolean) : []);
  if (rawUsers.length === 0) rawUsers = getDefaultDB().users;

  parsed.users = rawUsers.map(u => ({
    username: u.username,
    password: u.password || 'admin123',
    role: String(u.username).toLowerCase() === 'admin' ? 'admin' : 'user',
    bitget: {
      apiKey: '',
      secretKey: '',
      passphrase: '',
      leverage: 10,
      marginMode: 'crossed',
      enabled: false,
      tradeSizeUSDT: 50,
      ...(u.bitget || {})
    }
  }));

  if (!parsed.sessions || typeof parsed.sessions !== 'object') parsed.sessions = {};
  if (!parsed.activeTrades || typeof parsed.activeTrades !== 'object') parsed.activeTrades = {};
  parsed.history = Array.isArray(parsed.history) ? parsed.history.filter(Boolean) : [];
  return parsed;
}

function loadLocalDB() {
  try {
    if (fs.existsSync(DB_FILE)) return normalizeDB(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {}
  return getDefaultDB();
}

let db = loadLocalDB();

async function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
  try {
    await fetch(`${FIREBASE_DB_URL}/bitget_crypto_state.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {}
}

function requireAuth(req, res, next) {
  req.user = db.users[0] || { username: 'admin', role: 'admin', bitget: getDefaultDB().users[0].bitget };
  next();
}

app.post('/api/login', async (req, res) => {
  const cleanUser = (req.body.username || '').trim() || 'admin';
  const cleanPass = (req.body.password || '').trim() || 'admin123';

  let found = (db.users || []).find(u => u.username.toLowerCase() === cleanUser.toLowerCase());
  if (!found) {
    found = {
      username: cleanUser,
      password: cleanPass,
      role: 'admin',
      bitget: { apiKey: '', secretKey: '', passphrase: '', leverage: 10, marginMode: 'crossed', enabled: false, tradeSizeUSDT: 50 }
    };
    db.users.push(found);
  }

  const token = 'active_session_' + Date.now();
  db.sessions[token] = { username: found.username, role: found.role };
  await saveDB(db);
  res.json({ ok: true, token, user: { username: found.username, role: found.role, bitget: found.bitget } });
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: db.users[0] });
});

// ARAYÜZDEN BITGET AYARLARINI (Kaldıraç, API vb.) GÜNCELLEME
app.post('/api/settings/bitget', requireAuth, async (req, res) => {
  try {
    const { apiKey, secretKey, passphrase, leverage, marginMode, enabled, tradeSizeUSDT } = req.body;
    const user = db.users[0];
    
    user.bitget = {
      apiKey: apiKey !== undefined ? apiKey.trim() : user.bitget.apiKey,
      secretKey: secretKey !== undefined ? secretKey.trim() : user.bitget.secretKey,
      passphrase: passphrase !== undefined ? passphrase.trim() : user.bitget.passphrase,
      leverage: Number(leverage) || 10,
      marginMode: marginMode || 'crossed',
      enabled: Boolean(enabled),
      tradeSizeUSDT: Number(tradeSizeUSDT) || 50
    };

    await saveDB(db);
    res.json({ ok: true, bitget: user.bitget });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clear-history', (req, res) => {
  db.history = [];
  saveDB(db);
  res.json({ ok: true });
});

// === BITGET V2 İMZALAMA & EMİR FONKSİYONLARI ===
function generateBitgetSignature(timestamp, method, requestPath, queryString = '', body = '', secretKey = '') {
  let signStr = timestamp + method.toUpperCase() + requestPath;
  if (queryString) signStr += '?' + queryString;
  if (body) signStr += body;
  return crypto.createHmac('sha256', secretKey).update(signStr).digest('base64');
}

async function bitgetApiRequest(endpoint, method = 'GET', data = null, creds) {
  if (!creds || !creds.apiKey || !creds.secretKey || !creds.passphrase) {
    throw new Error('Bitget API anahtarları eksik.');
  }

  const timestamp = Date.now().toString();
  let queryString = '';
  let bodyStr = '';

  if (method === 'GET' && data) {
    queryString = new URLSearchParams(data).toString();
  } else if (data) {
    bodyStr = JSON.stringify(data);
  }

  const signature = generateBitgetSignature(timestamp, method, endpoint, queryString, bodyStr, creds.secretKey);
  const url = `https://api.bitget.com${endpoint}${queryString ? '?' + queryString : ''}`;

  const headers = {
    'Content-Type': 'application/json',
    'ACCESS-KEY': creds.apiKey,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': creds.passphrase,
    'locale': 'en-US'
  };

  const response = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' ? bodyStr : undefined
  });

  return await response.json();
}

// Siteden seçilen kaldıracı Bitget borsasında ayarla
async function setBitgetLeverageAndMargin(symbol, leverage, marginMode, creds) {
  try {
    // 1. Kaldıraç Belirleme
    await bitgetApiRequest('/api/v2/mix/account/set-leverage', 'POST', {
      symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      leverage: String(leverage),
      holdSide: 'long'
    }, creds);

    await bitgetApiRequest('/api/v2/mix/account/set-leverage', 'POST', {
      symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      leverage: String(leverage),
      holdSide: 'short'
    }, creds);

    // 2. Marjin Modu Belirleme (crossed / isolated)
    await bitgetApiRequest('/api/v2/mix/account/set-margin-mode', 'POST', {
      symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      marginMode: marginMode === 'isolated' ? 'isolated' : 'crossed'
    }, creds);
  } catch (e) {
    console.error(`Kaldıraç ayar uyarısı (${symbol}):`, e.message);
  }
}

// === BITGET V2 VERİ ÇEKME ===
async function getTopVolumeBitgetCoins(minVolumeUSDT = 15000000) {
  try {
    const res = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return [];

    return json.data
      .filter(c => Number(c.usdtVolume || c.quoteVolume || 0) >= minVolumeUSDT && c.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.usdtVolume || b.quoteVolume || 0) - Number(a.usdtVolume || a.quoteVolume || 0))
      .slice(0, 30)
      .map(c => ({
        symbol: c.symbol,
        lastPrice: Number(c.lastPr),
        volume24h: Number(c.usdtVolume || c.quoteVolume || 0),
        change24h: Number(c.change24h || 0) * 100
      }));
  } catch (e) {
    return [];
  }
}

async function getBitgetCandles(symbol, granularity = '15m', limit = 300) {
  try {
    const res = await fetch(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=${granularity}&limit=${limit}`);
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return [];

    return json.data.map(c => ({
      time: Math.floor(Number(c[0]) / 1000),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5])
    })).reverse();
  } catch (e) {
    return [];
  }
}

// === TEKNİK HESAPLAMALAR ===
function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcATR(candles, period = 14) {
  if (candles.length <= period) return Math.max(0.0001, candles[candles.length - 1].close * 0.008);
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return Math.max(0.0001, atr);
}

// === KURUMSAL ASİMETRİK RİSK PLANI ===
function calculateCryptoTradePlan(entryPrice, isShort, atr, swingLevel) {
  const precision = entryPrice < 0.1 ? 5 : (entryPrice < 2 ? 4 : (entryPrice < 50 ? 3 : 2));
  
  // Stop: Likidite iğnesinin hemen arkası + 0.35 ATR güvenlik payı
  let slDist = Math.abs(entryPrice - swingLevel) + (atr * 0.35);
  if (slDist < atr * 1.1) slDist = atr * 1.1;

  // Stop Tavanı
  const maxAllowedSl = entryPrice > 10000 ? 190 : (entryPrice > 1000 ? 15 : entryPrice * 0.016);
  if (slDist > maxAllowedSl) slDist = maxAllowedSl;

  const tp1Dist = Number((atr * 1.20).toFixed(precision)); // %80 Nakit Realizasyon
  const tp2Dist = Number((atr * 2.80).toFixed(precision)); // Trend Koşusu
  const shieldDist = Number((tp1Dist * 0.55).toFixed(precision)); // Erken Başabaş
  slDist = Number(slDist.toFixed(precision));

  return {
    entry: Number(entryPrice.toFixed(precision)),
    sl: Number((!isShort ? entryPrice - slDist : entryPrice + slDist).toFixed(precision)),
    shieldPrice: Number((!isShort ? entryPrice + shieldDist : entryPrice - shieldDist).toFixed(precision)),
    tp1: Number((!isShort ? entryPrice + tp1Dist : entryPrice - tp1Dist).toFixed(precision)),
    tp2: Number((!isShort ? entryPrice + tp2Dist : entryPrice - tp2Dist).toFixed(precision)),
    slDist,
    tp1Dist,
    tp2Dist
  };
}

// === MARKET STRUCTURE SHIFT (MSS) + FAIR VALUE GAP (FVG) MOTORU ===
function evaluateMSSandFVGSetup(candles, atr) {
  if (candles.length < 50) return { score: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, Math.min(200, closes.length));

  const c0 = candles[candles.length - 1]; // Güncel mum
  const c1 = candles[candles.length - 2]; // Kırılım mumu (MSS)
  const c2 = candles[candles.length - 3]; // İğne / Likidite süpürme mumu
  const c3 = candles[candles.length - 4];

  // Son 15 mumun swing tepe ve dipleri
  const lookback = candles.slice(-18, -3);
  const swingLow = Math.min(...lookback.map(c => c.low));
  const swingHigh = Math.max(...lookback.map(c => c.high));

  let score = 0;
  const reasons = [];
  let swingLevel = c0.close;
  let optimalEntry = c0.close;

  // 1. BOĞA MSS + FVG KURGUSU (LONG)
  // Şart 1: c2 mumu eski dibi delip likidite topladı (Liquidity Sweep)
  const sweptLow = c2.low < swingLow || c3.low < swingLow;
  // Şart 2: c1 mumu önceki mumların tepesini güçlü yeşil gövdeyle kırdı (MSS - Market Structure Shift)
  const mssBull = c1.close > c2.high && c1.close > c1.open;
  // Şart 3: c1 ile c3 arasında Fair Value Gap (FVG) boşluğu oluştu
  const bullFVG = c1.low > c3.high;
  // Şart 4: c0 mumu bu FVG boşluğuna test veriyor (Pullback)
  const isRetestingBull = c0.low <= c1.high && c0.close >= c3.high;

  if (sweptLow && mssBull && (bullFVG || isRetestingBull) && c0.close >= ema200 * 0.985) {
    score = 90;
    reasons.push('Eski Dip Likiditesi Alındı (Sweep)');
    reasons.push('Piyasa Yapısı Boğaya Kırıldı (MSS)');
    reasons.push('FVG Dengesizlik Alanı Test Edildi');
    swingLevel = Math.min(c1.low, c2.low);
    optimalEntry = c0.close;
  }

  // 2. AYI MSS + FVG KURGUSU (SHORT)
  // Şart 1: c2 mumu eski tepeyi delip likidite topladı
  const sweptHigh = c2.high > swingHigh || c3.high > swingHigh;
  // Şart 2: c1 mumu önceki mumların dibini güçlü kırmızı gövdeyle kırdı (MSS)
  const mssBear = c1.close < c2.low && c1.close < c1.open;
  // Şart 3: c1 ile c3 arasında FVG boşluğu oluştu
  const bearFVG = c1.high < c3.low;
  // Şart 4: c0 mumu bu FVG boşluğunu test ediyor
  const isRetestingBear = c0.high >= c1.low && c0.close <= c3.low;

  if (sweptHigh && mssBear && (bearFVG || isRetestingBear) && c0.close <= ema200 * 1.015) {
    score = -90;
    reasons.push('Eski Tepe Likiditesi Alındı (Sweep)');
    reasons.push('Piyasa Yapısı Ayıya Kırıldı (MSS)');
    reasons.push('FVG Dengesizlik Alanı Test Edildi');
    swingLevel = Math.max(c1.high, c2.high);
    optimalEntry = c0.close;
  }

  return { score, reasons, swingLevel, optimalEntry, ema50, ema200 };
}

// === SİMÜLASYON MOTORU (MSS + FVG) ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = '15m';
    const limit = Number(req.query.hours) ? Math.min(350, Number(req.query.hours) * 4) : 220;

    const candles = await getBitgetCandles(targetSymbol, granularity, limit);
    if (candles.length < 50) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let openCandleIndex = -99;
    let lastTradeIndex = -99;
    let lastStopIndex = -99;
    let lastStopDir = null;
    const simTrades = [];

    for (let i = 30; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);
      const atr = calcATR(slice, 14);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        if (i === openCandleIndex) continue;

        const isLong = simActive.direction === 'LONG';

        // 1. TP2 KONTROLÜ
        if ((isLong && c.high >= simActive.tp2) || (!isLong && c.low <= simActive.tp2)) {
          const profit = Number(Math.abs(simActive.tp2 - simActive.entry).toFixed(4));
          simTrades.push({
            ...simActive,
            closeTime: `${dateStr} ${timeStr}`,
            closePrice: simActive.tp2,
            status: 'TP2 TAM HEDEF 🎯',
            result: 'WIN',
            profitDollar: profit
          });
          simActive = null;
          continue;
        }

        // 2. TP1 VURULDUĞUNDA %80 KÂR AL + STOPU GİRİŞE KİLİTLE
        if (!simActive.tp1Hit && ((isLong && c.high >= simActive.tp1) || (!isLong && c.low <= simActive.tp1))) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry;
        }

        // 3. ERKEN ZIRH (Gereksiz Stop Önleyici)
        if (!simActive.tp1Hit && !simActive.shieldHit) {
          if ((isLong && c.high >= simActive.shieldPrice) || (!isLong && c.low <= simActive.shieldPrice)) {
            simActive.shieldHit = true;
            simActive.sl = simActive.entry;
          }
        }

        // 4. STOP LOSS KONTROLÜ
        const isStopBreached = isLong 
          ? ((simActive.tp1Hit || simActive.shieldHit) ? c.low <= simActive.sl : (c.close <= simActive.sl || c.low <= simActive.sl - (atr * 0.4)))
          : ((simActive.tp1Hit || simActive.shieldHit) ? c.high >= simActive.sl : (c.close >= simActive.sl || c.high >= simActive.sl + (atr * 0.4)));

        if (isStopBreached) {
          let profit = 0;
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';

          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.8).toFixed(4));
            status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
            result = 'WIN';
          } else if (simActive.shieldHit) {
            profit = 0;
            status = 'ERKEN ZIRH BAŞABAŞ 🛡️';
            result = 'WIN';
          } else {
            profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(4));
            lastStopIndex = i;
            lastStopDir = simActive.direction;
          }

          simTrades.push({
            ...simActive,
            closeTime: `${dateStr} ${timeStr}`,
            closePrice: simActive.sl,
            status,
            result,
            profitDollar: profit
          });
          simActive = null;
          continue;
        }

        continue;
      }

      // Stop sonrası aynı yöne 5 mum bekleme
      const dirCandidate = c.close > c.open ? 'LONG' : 'SHORT';
      if (i - lastStopIndex < 5 && lastStopDir === dirCandidate) continue;
      if (i - lastTradeIndex < 3) continue;

      const setup = evaluateMSSandFVGSetup(slice, atr);

      if (Math.abs(setup.score) >= 80) {
        const isShort = setup.score < 0;
        const plan = calculateCryptoTradePlan(setup.optimalEntry, isShort, atr, setup.swingLevel);
        lastTradeIndex = i;
        openCandleIndex = i;

        simActive = {
          symbol: targetSymbol,
          openTime: `${dateStr} ${timeStr}`,
          direction: isShort ? 'SHORT' : 'LONG',
          entry: plan.entry,
          sl: plan.sl,
          shieldPrice: plan.shieldPrice,
          tp1: plan.tp1,
          tp2: plan.tp2,
          tp1Dist: plan.tp1Dist,
          tp1Hit: false,
          shieldHit: false
        };
      }
    }

    const wins = simTrades.filter(t => t.result === 'WIN').length;
    const losses = simTrades.filter(t => t.result === 'LOSS').length;
    const winRate = simTrades.length > 0 ? Math.round((wins / simTrades.length) * 100) : 0;
    const totalProfit = simTrades.reduce((acc, t) => acc + (Number(t.profitDollar) || 0), 0);

    const precision = targetSymbol.includes('BTC') ? 2 : (targetSymbol.includes('DOGE') ? 5 : (targetSymbol.includes('ETH') ? 2 : 4));
    res.json({
      symbol: targetSymbol,
      totalSignals: simTrades.length,
      wins,
      losses,
      winRate,
      totalProfit: totalProfit.toFixed(precision),
      trades: simTrades.reverse()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CANLI 30 COİN TARAYICI ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(15000000);
    const results = [];

    for (const coin of topCoins.slice(0, 30)) {
      const candles = await getBitgetCandles(coin.symbol, '15m', 60);
      if (candles.length < 50) continue;

      const atr = calcATR(candles, 14);
      const setup = evaluateMSSandFVGSetup(candles, atr);
      const plan = calculateCryptoTradePlan(coin.lastPrice, setup.score < 0, atr, setup.swingLevel);

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: setup.score,
        signal: setup.score >= 80 ? 'LONG 🟢' : (setup.score <= -80 ? 'SHORT 🔴' : 'NÖTR ⏳'),
        tradePlan: plan,
        reasons: setup.reasons
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget MSS + FVG Kurumsal Motoru Aktif: Port ${PORT}`));
module.exports = app;
