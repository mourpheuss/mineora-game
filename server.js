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
      bitget: { apiKey: '', secretKey: '', passphrase: '', leverage: 10, marginMode: 'crossed', enabled: false, tradeSizeUSDT: 50 }
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

function getAuthUser(req) {
  const token = req.headers['x-auth-token'] || req.headers['authorization'];
  if (!token || !db.sessions || !db.sessions[token]) return null;
  const s = db.sessions[token];
  return (db.users || []).find(u => u.username.toLowerCase() === s.username.toLowerCase()) || null;
}

async function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
  req.user = user;
  next();
}

// === AUTH VE KULLANICI İŞLEMLERİ ===
app.post('/api/login', async (req, res) => {
  const cleanUser = (req.body.username || '').trim();
  const cleanPass = (req.body.password || '').trim();
  const found = (db.users || []).find(u => u.username.toLowerCase() === cleanUser.toLowerCase() && String(u.password) === cleanPass);
  if (!found) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı!' });

  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { username: found.username, role: found.role };
  await saveDB(db);
  res.json({ ok: true, token, user: { username: found.username, role: found.role, bitget: found.bitget } });
});

app.get('/api/me', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { username: user.username, role: user.role, bitget: user.bitget } });
});

app.post('/api/clear-history', requireAuth, async (req, res) => {
  db.history = [];
  await saveDB(db);
  res.json({ ok: true });
});

// === BITGET V2 İMZA VE API İSTEK MOTORU (CANLI İŞLEM İÇİN) ===
function generateBitgetSignature(secretKey, timestamp, method, requestPath, queryString = '', body = '') {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}${queryString ? '?' + queryString : ''}${body}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

async function bitgetApiRequest(userBitget, method, endpoint, params = {}, body = null) {
  if (!userBitget || !userBitget.enabled || !userBitget.apiKey || !userBitget.secretKey || !userBitget.passphrase) {
    return { ok: false, error: 'Bitget API bilgileri eksik veya devre dışı.' };
  }

  const timestamp = Date.now().toString();
  const queryString = method === 'GET' && Object.keys(params).length ? new URLSearchParams(params).toString() : '';
  const bodyString = body ? JSON.stringify(body) : '';
  const sign = generateBitgetSignature(userBitget.secretKey, timestamp, method, endpoint, queryString, bodyString);

  const url = `https://api.bitget.com${endpoint}${queryString ? '?' + queryString : ''}`;
  const headers = {
    'Content-Type': 'application/json',
    'ACCESS-KEY': userBitget.apiKey,
    'ACCESS-SIGN': sign,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': userBitget.passphrase,
    'locale': 'en-US'
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && bodyString ? bodyString : undefined
    });
    const json = await res.json();
    return { ok: json.code === '00000', data: json.data, raw: json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Bitget API Bilgilerini Kaydetme
app.post('/api/bitget-config', requireAuth, async (req, res) => {
  const { apiKey, secretKey, passphrase, leverage, tradeSizeUSDT, enabled } = req.body;
  req.user.bitget = {
    ...req.user.bitget,
    apiKey: (apiKey || '').trim() || req.user.bitget.apiKey,
    secretKey: (secretKey || '').trim() || req.user.bitget.secretKey,
    passphrase: (passphrase || '').trim() || req.user.bitget.passphrase,
    leverage: Number(leverage) || req.user.bitget.leverage || 10,
    tradeSizeUSDT: Number(tradeSizeUSDT) || req.user.bitget.tradeSizeUSDT || 50,
    enabled: Boolean(enabled)
  };
  await saveDB(db);
  res.json({ ok: true, bitget: req.user.bitget });
});

// Bitget Bakiye ve Bağlantı Testi
app.post('/api/bitget-test', requireAuth, async (req, res) => {
  const bg = req.user.bitget;
  const result = await bitgetApiRequest(bg, 'GET', '/api/v2/mix/account/accounts', { productType: 'USDT-FUTURES' });
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.raw ? `${result.raw.code}: ${result.raw.msg}` : result.error });
  }
  const usdtAcc = (result.data || []).find(a => a.marginCoin === 'USDT') || {};
  res.json({
    ok: true,
    availableBalance: usdtAcc.available || '0.00',
    equity: usdtAcc.equity || '0.00',
    unrealizedPnL: usdtAcc.unrealizedPL || '0.00'
  });
});

// === BITGET MARKET VERİLERİ (HERKESE AÇIK) ===
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

async function getBitgetCandles(symbol, granularity = '5m', limit = 120) {
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
  if (candles.length <= period) return Math.max(0.0001, candles[candles.length - 1].close * 0.005);
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return Math.max(0.0001, atr);
}

function calcVWAP(candles) {
  const slice = candles.slice(-50);
  let cumPV = 0, cumVol = 0;
  for (const c of slice) {
    const vol = c.volume || 100;
    cumPV += ((c.high + c.low + c.close) / 3) * vol;
    cumVol += vol;
  }
  return cumVol === 0 ? slice[slice.length - 1].close : cumPV / cumVol;
}

function calculateCryptoTradePlan(spotPrice, isShort, atr) {
  const slDist = Number((atr * 1.2).toFixed(4));
  const tp1Dist = Number((atr * 1.5).toFixed(4));
  const tp2Dist = Number((atr * 3.2).toFixed(4));

  return {
    entry: spotPrice,
    sl: Number((!isShort ? spotPrice - slDist : spotPrice + slDist).toFixed(4)),
    tp1: Number((!isShort ? spotPrice + tp1Dist : spotPrice - tp1Dist).toFixed(4)),
    tp2: Number((!isShort ? spotPrice + tp2Dist : spotPrice - tp2Dist).toFixed(4)),
    slDist,
    tp1Dist,
    tp2Dist
  };
}

// === LİKİDİTE SÜPÜRMESİ & FVG AI TETİKLEYİCİSİ ===
function evaluateCryptoSetup(candles, atr) {
  if (candles.length < 30) return { score: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const vwap = calcVWAP(candles);

  const curPrice = closes[closes.length - 1];
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];
  const prev2C = candles[candles.length - 3] || prevC;

  const isUpTrend = curPrice > ema50 && ema21 > ema50;
  const isDownTrend = curPrice < ema50 && ema21 < ema50;

  const lookback = candles.slice(-14, -2);
  const recentLow = Math.min(...lookback.map(c => c.low));
  const recentHigh = Math.max(...lookback.map(c => c.high));

  const bullSweep = (prevC.low <= recentLow || curC.low <= recentLow) && curC.close >= recentLow && curC.close > curC.open;
  const bearSweep = (prevC.high >= recentHigh || curC.high >= recentHigh) && curC.close <= recentHigh && curC.close < curC.open;

  const bullFvg = curC.low >= prev2C.high && curC.close > curC.open;
  const bearFvg = curC.high <= prev2C.low && curC.close < curC.open;

  const candleRange = Math.max(0.0001, curC.high - curC.low);
  const lowerWick = Math.min(curC.open, curC.close) - curC.low;
  const upperWick = curC.high - Math.max(curC.open, curC.close);
  const isLowerRejection = lowerWick >= candleRange * 0.20;
  const isUpperRejection = upperWick >= candleRange * 0.20;

  let score = 0;
  const reasons = [];

  if (isUpTrend && (bullSweep || (curPrice > vwap && (bullFvg || isLowerRejection)))) {
    score = 75;
    reasons.push('Likidite Dibi Süpürüldü + Trend Desteği');
  }

  if (isDownTrend && (bearSweep || (curPrice < vwap && (bearFvg || isUpperRejection)))) {
    score = -75;
    reasons.push('Likidite Tepesi Süpürüldü + Trend Direnci');
  }

  if (score > 0 && curC.close < curC.open) score = 0;
  if (score < 0 && curC.close > curC.open) score = 0;

  return { score, reasons, ema21, ema50, vwap };
}

// === GERİYE DÖNÜK TEST (BACKTEST) UÇ NOKTASI (PANELLE TAM UYUMLU) ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = req.query.granularity || '5m';
    const limit = Number(req.query.hours) ? Math.min(300, Number(req.query.hours) * 12) : 150;

    const candles = await getBitgetCandles(targetSymbol, granularity, limit);
    if (candles.length < 30) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let lastTradeIndex = -99;
    const simTrades = [];

    for (let i = 25; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);
      const atr = calcATR(slice, 14);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        const isLong = simActive.direction === 'LONG';

        if ((isLong && c.low <= simActive.sl) || (!isLong && c.high >= simActive.sl)) {
          let profit = 0;
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';

          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.8).toFixed(2));
            status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
            result = 'WIN';
          } else if (simActive.earlyShieldHit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.2).toFixed(2));
            status = 'ERKEN ZIRH KORUMASI 🛡️';
            result = 'WIN';
          } else {
            profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(2));
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

        if ((isLong && c.high >= simActive.tp2) || (!isLong && c.low <= simActive.tp2)) {
          const profit = Number(Math.abs(simActive.tp2 - simActive.entry).toFixed(2));
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

        if (!simActive.tp1Hit && ((isLong && c.high >= simActive.tp1) || (!isLong && c.low <= simActive.tp1))) {
          simActive.tp1Hit = true;
          simActive.earlyShieldHit = true;
          simActive.sl = simActive.entry;
        }

        if (!simActive.tp1Hit && !simActive.earlyShieldHit) {
          const shieldDist = simActive.tp1Dist * 0.55;
          const shieldTrigger = isLong ? simActive.entry + shieldDist : simActive.entry - shieldDist;
          if ((isLong && c.high >= shieldTrigger) || (!isLong && c.low <= shieldTrigger)) {
            simActive.earlyShieldHit = true;
            simActive.sl = simActive.entry;
          }
        }
        continue;
      }

      if (i - lastTradeIndex < 2) continue;

      const setup = evaluateCryptoSetup(slice, atr);

      if (Math.abs(setup.score) >= 70) {
        const isShort = setup.score < 0;
        const plan = calculateCryptoTradePlan(c.close, isShort, atr);
        lastTradeIndex = i;

        simActive = {
          symbol: targetSymbol,
          openTime: `${dateStr} ${timeStr}`,
          direction: isShort ? 'SHORT' : 'LONG',
          entry: plan.entry,
          sl: plan.sl,
          tp1: plan.tp1,
          tp2: plan.tp2,
          tp1Dist: plan.tp1Dist,
          tp1Hit: false,
          earlyShieldHit: false
        };
      }
    }

    const wins = simTrades.filter(t => t.result === 'WIN').length;
    const losses = simTrades.filter(t => t.result === 'LOSS').length;
    const winRate = simTrades.length > 0 ? Math.round((wins / simTrades.length) * 100) : 0;
    const totalProfit = simTrades.reduce((acc, t) => acc + (Number(t.profitDollar) || 0), 0);

    res.json({
      symbol: targetSymbol,
      totalSignals: simTrades.length,
      wins,
      losses,
      winRate,
      totalProfit: totalProfit.toFixed(2),
      trades: simTrades.reverse()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CANLI ÇOKLU COİN TARAYICI (MARKET SCANNER) ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(15000000);
    const results = [];

    for (const coin of topCoins.slice(0, 20)) {
      const candles = await getBitgetCandles(coin.symbol, '5m', 40);
      if (candles.length < 30) continue;

      const atr = calcATR(candles, 14);
      const setup = evaluateCryptoSetup(candles, atr);
      const plan = calculateCryptoTradePlan(coin.lastPrice, setup.score < 0, atr);

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: setup.score,
        signal: setup.score >= 70 ? 'LONG 🟢' : (setup.score <= -70 ? 'SHORT 🔴' : 'NÖTR ⏳'),
        tradePlan: plan,
        reasons: setup.reasons
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Kripto Vadeli İşlem Sunucusu Aktif: Port ${PORT}`));
module.exports = app;
