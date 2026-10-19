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

app.post('/api/login', async (req, res) => {
  const cleanUser = (req.body.username || '').trim();
  const cleanPass = (req.body.password || '').trim();
  if (!cleanUser || !cleanPass) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir.' });

  let found = (db.users || []).find(u => u.username.toLowerCase() === cleanUser.toLowerCase());
  if (!found) {
    found = {
      username: cleanUser,
      password: cleanPass,
      role: cleanUser.toLowerCase() === 'admin' ? 'admin' : 'user',
      bitget: { apiKey: '', secretKey: '', passphrase: '', leverage: 10, marginMode: 'crossed', enabled: false, tradeSizeUSDT: 50 }
    };
    db.users.push(found);
  } else if (String(found.password) !== cleanPass) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı!' });
  }

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

// === BITGET V2 MARKET VERİLERİ ===
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

async function getBitgetCandles(symbol, granularity = '15m', limit = 250) {
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

// === MATEMATİKSEL İNDİKATÖRLER ===
function calcRSI(closes, period = 14) {
  if (closes.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Number((100 - 100 / (1 + (avgGain / avgLoss))).toFixed(1));
}

// BOLLINGER BANDS (20, 2)
function calcBollingerBands(closes, period = 20, multiplier = 2.0) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    middle: sma,
    upper: sma + multiplier * stdDev,
    lower: sma - multiplier * stdDev
  };
}

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

// === BOLLINGER MEAN REVERSION STRATEJİ MOTORU ===
function evaluateBollingerMeanReversion(candles) {
  if (candles.length < 35) return { score: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const bb = calcBollingerBands(closes, 20, 2.0);
  if (!bb) return { score: 0, reasons: [] };

  const rsi = calcRSI(closes, 14);
  const ema50 = calcEMA(closes, 50);

  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];
  const prev2C = candles[candles.length - 3] || prevC;

  let score = 0;
  const reasons = [];
  let sl = 0;
  let tp1 = 0;
  let tp2 = 0;

  const precision = curC.close < 2 ? 4 : (curC.close < 50 ? 3 : 2);

  // LONG ŞARTI: Alt bandın dışına sarkıp içeri yeşil kapattı + RSI Aşırı Satımda (Oversold)
  const isOversoldRebound = (prevC.low <= bb.lower || prev2C.low <= bb.lower) && curC.close > bb.lower && curC.close > curC.open;
  if (isOversoldRebound && rsi <= 40) {
    score = 85;
    reasons.push('Bollinger Alt Bandından Dönüş (Panik Satışı Sönümlendi)');
    reasons.push(`RSI Dip Toparlanması (${rsi})`);

    const swingLow = Math.min(curC.low, prevC.low, prev2C.low);
    // Güvenli stop: alt iğnenin biraz altı (minimum %0.8)
    const slDist = Math.max(curC.close * 0.008, curC.close - swingLow + (curC.close * 0.002));
    sl = Number((curC.close - slDist).toFixed(precision));
    tp1 = Number(bb.middle.toFixed(precision)); // Doğrudan Orta Bant (SMA20)
    tp2 = Number((bb.middle + (bb.upper - bb.middle) * 0.5).toFixed(precision));
  }

  // SHORT ŞARTI: Üst bandın dışına taşıp içeri kırmızı kapattı + RSI Aşırı Alımda (Overbought)
  const isOverboughtRejection = (prevC.high >= bb.upper || prev2C.high >= bb.upper) && curC.close < bb.upper && curC.close < curC.open;
  if (isOverboughtRejection && rsi >= 60) {
    score = -85;
    reasons.push('Bollinger Üst Bandından Red (Alıcılar Yoruldu)');
    reasons.push(`RSI Tepe Doygunluğu (${rsi})`);

    const swingHigh = Math.max(curC.high, prevC.high, prev2C.high);
    const slDist = Math.max(curC.close * 0.008, swingHigh - curC.close + (curC.close * 0.002));
    sl = Number((curC.close + slDist).toFixed(precision));
    tp1 = Number(bb.middle.toFixed(precision)); // Doğrudan Orta Bant (SMA20)
    tp2 = Number((bb.middle - (bb.middle - bb.lower) * 0.5).toFixed(precision));
  }

  return {
    score,
    reasons,
    plan: {
      entry: Number(curC.close.toFixed(precision)),
      sl,
      tp1,
      tp2
    },
    bb,
    rsi
  };
}

// === GERİYE DÖNÜK TEST MOTORU ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = '15m';
    const limit = Number(req.query.hours) ? Math.min(300, Number(req.query.hours) * 4) : 180;

    const candles = await getBitgetCandles(targetSymbol, granularity, limit);
    if (candles.length < 35) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let lastTradeIndex = -99;
    const simTrades = [];

    for (let i = 25; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        const isLong = simActive.direction === 'LONG';

        // 1. TP1 VURDU MU? (Orta Bant - En Yüksek İhtimal)
        if (!simActive.tp1Hit && ((isLong && c.high >= simActive.tp1) || (!isLong && c.low <= simActive.tp1))) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry; // Kalan pozisyonu korumak için stopu girişe al
        }

        // 2. TP2 VURDU MU?
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

        // 3. SL KONTROLÜ
        if ((isLong && c.low <= simActive.sl) || (!isLong && c.high >= simActive.sl)) {
          let profit = 0;
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';

          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.8).toFixed(4));
            status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
            result = 'WIN';
          } else {
            profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(4));
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

      if (i - lastTradeIndex < 3) continue;

      const setup = evaluateBollingerMeanReversion(slice);

      if (Math.abs(setup.score) >= 80) {
        const isShort = setup.score < 0;
        lastTradeIndex = i;

        simActive = {
          symbol: targetSymbol,
          openTime: `${dateStr} ${timeStr}`,
          direction: isShort ? 'SHORT' : 'LONG',
          entry: setup.plan.entry,
          sl: setup.plan.sl,
          tp1: setup.plan.tp1,
          tp2: setup.plan.tp2,
          tp1Hit: false
        };
      }
    }

    const wins = simTrades.filter(t => t.result === 'WIN').length;
    const losses = simTrades.filter(t => t.result === 'LOSS').length;
    const winRate = simTrades.length > 0 ? Math.round((wins / simTrades.length) * 100) : 0;
    const totalProfit = simTrades.reduce((acc, t) => acc + (Number(t.profitDollar) || 0), 0);

    const precision = targetSymbol.includes('BTC') ? 2 : 4;
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

// === CANLI ÇOKLU COİN TARAYICI ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(15000000);
    const results = [];

    for (const coin of topCoins.slice(0, 20)) {
      const candles = await getBitgetCandles(coin.symbol, '15m', 45);
      if (candles.length < 35) continue;

      const setup = evaluateBollingerMeanReversion(candles);

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: setup.score,
        signal: setup.score >= 80 ? 'LONG 🟢' : (setup.score <= -80 ? 'SHORT 🔴' : 'NÖTR ⏳'),
        tradePlan: setup.plan,
        reasons: setup.reasons
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Bollinger Mean Reversion Motoru Aktif: Port ${PORT}`));
module.exports = app;
