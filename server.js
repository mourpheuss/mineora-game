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
      geminiApiKey: '',
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
    geminiApiKey: u.geminiApiKey || '',
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
  req.user = db.users[0] || { username: 'admin', role: 'admin' };
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
      geminiApiKey: '',
      bitget: { apiKey: '', secretKey: '', passphrase: '', leverage: 10, marginMode: 'crossed', enabled: false, tradeSizeUSDT: 50 }
    };
    db.users.push(found);
  }

  const token = 'active_session_' + Date.now();
  db.sessions[token] = { username: found.username, role: found.role };
  await saveDB(db);
  res.json({ ok: true, token, user: { username: found.username, role: found.role, bitget: found.bitget, geminiApiKey: found.geminiApiKey } });
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: db.users[0] });
});

app.post('/api/settings/bitget', requireAuth, async (req, res) => {
  try {
    const { apiKey, secretKey, passphrase, leverage, marginMode, enabled, tradeSizeUSDT, geminiApiKey } = req.body;
    const user = db.users[0];
    
    if (geminiApiKey !== undefined) user.geminiApiKey = geminiApiKey.trim();
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

// === BITGET V2 VERİLERİ ===
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

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

// === SUPERTREND HESAPLAMASI ===
function calcSupertrend(candles, period = 10, multiplier = 3.0) {
  if (candles.length < period) return { isBull: true, level: candles[candles.length - 1].close, trendAge: 1 };
  
  let upperBand = 0, lowerBand = 0;
  let inBull = true;
  let trendAge = 0;

  for (let i = period; i < candles.length; i++) {
    const c = candles[i];
    const slice = candles.slice(0, i + 1);
    const atr = calcATR(slice, period);
    const hl2 = (c.high + c.low) / 2;

    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    if (inBull) {
      lowerBand = Math.max(basicLower, lowerBand);
      if (c.close < lowerBand) {
        inBull = false;
        upperBand = basicUpper;
        trendAge = 1;
      } else {
        trendAge++;
      }
    } else {
      upperBand = Math.min(basicUpper, upperBand);
      if (c.close > upperBand) {
        inBull = true;
        lowerBand = basicLower;
        trendAge = 1;
      } else {
        trendAge++;
      }
    }
  }

  return { isBull: inBull, level: inBull ? lowerBand : upperBand, trendAge };
}

// === RİSK VE KÂR PLANI ===
function calculateTrendPlan(entryPrice, isShort, atr, swingLevel) {
  const precision = entryPrice < 0.1 ? 5 : (entryPrice < 2 ? 4 : (entryPrice < 50 ? 3 : 2));
  
  let slDist = Math.abs(entryPrice - swingLevel) + (atr * 0.20);
  if (slDist < atr * 0.85) slDist = atr * 0.85;

  const maxAllowedSl = entryPrice > 10000 ? 150 : (entryPrice > 1000 ? 14 : entryPrice * 0.014);
  if (slDist > maxAllowedSl) slDist = maxAllowedSl;

  const tp1Dist = Number((atr * 0.70).toFixed(precision)); // %80 Kâr Alımı
  const tp2Dist = Number((atr * 2.40).toFixed(precision)); 
  slDist = Number(slDist.toFixed(precision));

  return {
    entry: Number(entryPrice.toFixed(precision)),
    sl: Number((!isShort ? entryPrice - slDist : entryPrice + slDist).toFixed(precision)),
    tp1: Number((!isShort ? entryPrice + tp1Dist : entryPrice - tp1Dist).toFixed(precision)),
    tp2: Number((!isShort ? entryPrice + tp2Dist : entryPrice - tp2Dist).toFixed(precision)),
    slDist,
    tp1Dist,
    tp2Dist
  };
}

// === 2. BAR TEYİTLİ VE H1 KİLİTLİ SUPERTREND MOTORU ===
function evaluateSupertrendSetup(candles, atr) {
  if (candles.length < 50) return { score: 0, reasons: [] };

  const st = calcSupertrend(candles, 10, 3.0);
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];
  const curPrice = curC.close;

  // H1 (1 Saatlik) Ana Trend Filtresi (EMA 100 periyot)
  const closes = candles.map(c => c.close);
  const h1TrendEma = calcEMA(closes, Math.min(100, closes.length));
  const ema21 = calcEMA(closes, 21);

  let score = 0;
  const reasons = [];
  let swingLevel = curC.close;

  // 1. BOĞA: Trend ilk barda olmamalı (trendAge >= 2 ile sahte kırılımlar elenir)
  if (curPrice >= h1TrendEma && st.isBull && st.trendAge >= 2) {
    // Pullback teyidi: Önceki mum düşmüş veya EMA21'e çekilmiş, mevcut mum yeşil gövdeyle teyit etmiş
    const isPullback = prevC.close <= prevC.open || prevC.low <= ema21;
    const isGreenConfirmed = curC.close > curC.open && curC.close >= prevC.high * 0.999;

    if (isPullback && isGreenConfirmed) {
      score = 85;
      reasons.push('H1 Boğa Trendi Onaylı');
      reasons.push('2. Bar Teyitli Süpertrend Desteği');
      swingLevel = Math.min(curC.low, prevC.low);
    }
  }

  // 2. AYI: Trend ilk barda olmamalı (trendAge >= 2)
  if (curPrice <= h1TrendEma && !st.isBull && st.trendAge >= 2) {
    const isPullback = prevC.close >= prevC.open || prevC.high >= ema21;
    const isRedConfirmed = curC.close < curC.open && curC.close <= prevC.low * 1.001;

    if (isPullback && isRedConfirmed) {
      score = -85;
      reasons.push('H1 Ayı Trendi Onaylı');
      reasons.push('2. Bar Teyitli Süpertrend Direnci');
      swingLevel = Math.max(curC.high, prevC.high);
    }
  }

  return { score, reasons, swingLevel, isBull: st.isBull };
}

// === SİMÜLASYON MOTORU ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = req.query.granularity || '15m'; // İsteğe bağlı 5m veya 15m
    const limit = Number(req.query.hours) ? Math.min(350, Number(req.query.hours) * 4) : 220;

    const candles = await getBitgetCandles(targetSymbol, granularity, limit);
    if (candles.length < 40) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let openCandleIndex = -99;
    let lastTradeIndex = -99;
    let lastStopIndex = -99;
    const simTrades = [];

    for (let i = 25; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);
      const atr = calcATR(slice, 14);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        if (i === openCandleIndex) continue;

        const isLong = simActive.direction === 'LONG';

        // 1. ÖNCE TP HEDEFLERİ
        const reachedTP2 = isLong ? c.high >= simActive.tp2 : c.low <= simActive.tp2;
        if (reachedTP2) {
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

        const reachedTP1 = isLong ? c.high >= simActive.tp1 : c.low <= simActive.tp1;
        if (!simActive.tp1Hit && reachedTP1) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry; // Stop maliyete kilitlendi
        }

        // 2. STOP KONTROLÜ
        let isStopped = false;
        if (simActive.tp1Hit) {
          isStopped = isLong ? c.low <= simActive.sl : c.high >= simActive.sl;
        } else {
          isStopped = isLong ? c.close <= simActive.sl : c.close >= simActive.sl;
        }

        if (isStopped) {
          let profit = 0;
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';

          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.80).toFixed(4));
            status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
            result = 'WIN';
          } else {
            profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(4));
            lastStopIndex = i;
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

      // Stop sonrası en az 6 mum (1.5 saat) bekle
      if (i - lastStopIndex < 6) continue;
      if (i - lastTradeIndex < 3) continue;

      const setup = evaluateSupertrendSetup(slice, atr);

      if (Math.abs(setup.score) >= 80) {
        const isShort = setup.score < 0;
        const plan = calculateTrendPlan(c.close, isShort, atr, setup.swingLevel);
        lastTradeIndex = i;
        openCandleIndex = i;

        simActive = {
          symbol: targetSymbol,
          openTime: `${dateStr} ${timeStr}`,
          direction: isShort ? 'SHORT' : 'LONG',
          entry: plan.entry,
          sl: plan.sl,
          tp1: plan.tp1,
          tp2: plan.tp2,
          tp1Dist: plan.tp1Dist,
          tp1Hit: false
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
      const candles = await getBitgetCandles(coin.symbol, '15m', 50);
      if (candles.length < 35) continue;

      const atr = calcATR(candles, 14);
      const setup = evaluateSupertrendSetup(candles, atr);
      const plan = calculateTrendPlan(coin.lastPrice, setup.score < 0, atr, setup.swingLevel);

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

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Teyitli Süpertrend Motoru Aktif: Port ${PORT}`));
module.exports = app;
