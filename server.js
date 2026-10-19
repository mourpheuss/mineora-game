// TÜRKİYE SAAT DİLİMİ KİLİDİ (GMT+3)
process.env.TZ = 'Europe/Istanbul';

const express = require('express');
const path = require('path');
const fs = require('fs');

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
  res.json({ ok: true, token, user: { username: found.username, role: found.role, bitget: found.bitget } });
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

// === TÜM AKTİF BİTGET VADELİ (USDT-FUTURES) COINLERİ ===
async function getTopVolumeBitgetCoins(minVolumeUSDT = 1000000) {
  try {
    const res = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return [];

    return json.data
      .filter(c => Number(c.usdtVolume || c.quoteVolume || 0) >= minVolumeUSDT && c.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.usdtVolume || b.quoteVolume || 0) - Number(a.usdtVolume || a.quoteVolume || 0))
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

// 3.000 MUM KADAR DİNAMİK DERİNLİK ALAN MOTOR
async function getBitgetCandles3K(symbol, granularity = '15m', targetCount = 3000) {
  try {
    let allCandles = [];
    let endTime = '';
    const batches = Math.ceil(targetCount / 1000);

    for (let batch = 0; batch < batches; batch++) {
      const limit = Math.min(1000, targetCount - allCandles.length);
      let url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=${granularity}&limit=${limit}`;
      if (endTime) url += `&endTime=${endTime}`;

      const res = await fetch(url);
      const json = await res.json();
      if (json.code !== '00000' || !Array.isArray(json.data) || json.data.length === 0) break;

      const parsed = json.data.map(c => ({
        time: Math.floor(Number(c[0]) / 1000),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5])
      }));

      allCandles = allCandles.concat(parsed);
      endTime = json.data[json.data.length - 1][0];
      if (allCandles.length >= targetCount) break;
    }

    allCandles.sort((a, b) => a.time - b.time);
    return allCandles;
  } catch (e) {
    return [];
  }
}

// === TEKNİK HESAPLAMALAR ===
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

function calcBollinger(closes, period = 20, multiplier = 2.0) {
  if (closes.length < period) {
    const p = closes[closes.length - 1] || 1;
    return { middle: p, upper: p * 1.01, lower: p * 0.99 };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdev = Math.sqrt(variance);
  return {
    middle,
    upper: middle + (multiplier * stdev),
    lower: middle - (multiplier * stdev)
  };
}

function calcLuxAlgoUltimateRSI(closes, period = 14, smooth = 5) {
  if (closes.length <= period + smooth) return { rsi: 50, signal: 50, prevRsi: 50, prevSignal: 50 };

  const rsiValues = [];
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss))));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    const rsiVal = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    rsiValues.push(rsiVal);
  }

  const curRsi = rsiValues[rsiValues.length - 1];
  const prevRsi = rsiValues[rsiValues.length - 2];
  
  const sliceCur = rsiValues.slice(-smooth);
  const signal = sliceCur.reduce((a, b) => a + b, 0) / sliceCur.length;

  const slicePrev = rsiValues.slice(-smooth - 1, -1);
  const prevSignal = slicePrev.reduce((a, b) => a + b, 0) / slicePrev.length;

  return {
    rsi: Number(curRsi.toFixed(2)),
    signal: Number(signal.toFixed(2)),
    prevRsi: Number(prevRsi.toFixed(2)),
    prevSignal: Number(prevSignal.toFixed(2))
  };
}

function findDynamicSupportResistance(candles) {
  const lookback = candles.slice(-60, -1);
  let highest = -Infinity;
  let lowest = Infinity;

  for (const c of lookback) {
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }

  const recentSlice = candles.slice(-20, -1);
  const swingHigh = Math.max(...recentSlice.map(c => c.high));
  const swingLow = Math.min(...recentSlice.map(c => c.low));

  return {
    majorResistance: highest,
    majorSupport: lowest,
    swingResistance: swingHigh,
    swingSupport: swingLow
  };
}

function calculateSMCPlan(entryPrice, isShort, atr, levels) {
  const precision = entryPrice < 0.01 ? 6 : (entryPrice < 1 ? 5 : (entryPrice < 50 ? 4 : 2));

  let slDist, tp1Dist, tp2Dist;

  if (isShort) {
    const targetSl = Math.max(levels.swingResistance, entryPrice + atr * 0.60);
    slDist = Math.abs(targetSl - entryPrice);
    if (slDist < atr * 0.50) slDist = atr * 0.50;
    if (entryPrice > 10000 && slDist > 120) slDist = 120;
    if (entryPrice <= 2 && slDist > 0.0055) slDist = 0.0055;

    tp1Dist = Number((slDist * 1.05).toFixed(precision));
    tp2Dist = Number((slDist * 2.20).toFixed(precision));
  } else {
    const targetSl = Math.min(levels.swingSupport, entryPrice - atr * 0.60);
    slDist = Math.abs(entryPrice - targetSl);
    if (slDist < atr * 0.50) slDist = atr * 0.50;
    if (entryPrice > 10000 && slDist > 120) slDist = 120;
    if (entryPrice <= 2 && slDist > 0.0055) slDist = 0.0055;

    tp1Dist = Number((slDist * 1.05).toFixed(precision));
    tp2Dist = Number((slDist * 2.20).toFixed(precision));
  }

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

function evaluateSMCRSIStrategy(candles, atr) {
  if (candles.length < 200) return { score: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const curPrice = closes[closes.length - 1];
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];

  const ema200Cur = calcEMA(closes, 200);
  const ema200Prev = calcEMA(closes.slice(0, -6), 200);
  const ema200SlopeUp = ema200Cur >= ema200Prev;

  const ema50 = calcEMA(closes, 50);
  const bb = calcBollinger(closes.slice(0, -1), 20, 2.0);
  const ultRsi = calcLuxAlgoUltimateRSI(closes, 14, 5);
  const levels = findDynamicSupportResistance(candles);

  const reasons = [];

  // SHORT
  const isBearTrend = curPrice < ema200Cur && curPrice <= ema50 * 1.002 && !ema200SlopeUp;
  const isResistanceTouch = curC.high >= bb.upper || curC.high >= levels.swingResistance * 0.999;
  const isRsiBearCross = ultRsi.rsi < ultRsi.signal && ultRsi.prevRsi >= ultRsi.prevSignal && ultRsi.rsi >= 46;
  const isRedCandle = curC.close < curC.open && curC.close < prevC.close;

  if (isBearTrend && isResistanceTouch && (isRsiBearCross || ultRsi.rsi >= 58) && isRedCandle) {
    reasons.push('EMA 200/50 Ayı Trendi');
    reasons.push('Sniper Direnç Teması');
    reasons.push(`Ultimate RSI Negatif Kesişim (${ultRsi.rsi})`);
    return { score: -95, isShort: true, levels, reasons };
  }

  // LONG
  const isBullTrend = curPrice > ema200Cur && curPrice >= ema50 * 0.998 && ema200SlopeUp;
  const isSupportTouch = curC.low <= bb.lower || curC.low <= levels.swingSupport * 1.001;
  const isRsiBullCross = ultRsi.rsi > ultRsi.signal && ultRsi.prevRsi <= ultRsi.prevSignal && ultRsi.rsi <= 54;
  const isGreenCandle = curC.close > curC.open && curC.close > prevC.close;

  if (isBullTrend && isSupportTouch && (isRsiBullCross || ultRsi.rsi <= 42) && isGreenCandle) {
    reasons.push('EMA 200/50 Boğa Trendi');
    reasons.push('Sniper Destek Teması');
    reasons.push(`Ultimate RSI Pozitif Kesişim (${ultRsi.rsi})`);
    return { score: 95, isShort: false, levels, reasons };
  }

  return { score: 0, reasons: [] };
}

// === DİNAMİK ZAMAN DİLİMLİ SİMÜLASYON MOTORU ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = '15m';
    const hours = Math.max(12, Math.min(720, Number(req.query.hours) || 120));

    // Saat başına 4 mum + göstergelerin oturması için +200 bar
    const neededCandles = Math.min(3000, (hours * 4) + 200);

    const candles = await getBitgetCandles3K(targetSymbol, granularity, neededCandles);
    if (candles.length < 220) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let openCandleIndex = -99;
    let lastTradeIndex = -99;
    let lastStopIndex = -99;
    let lastStopDir = null;
    const simTrades = [];

    // EMA200 için döngü 200. mumdan başlar
    for (let i = 200; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);
      const atr = calcATR(slice, 14);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        if (i === openCandleIndex) continue;

        const isLong = simActive.direction === 'LONG';

        // 1. TP2 Kontrolü (Büyük Hedef)
        const hitTP2 = isLong ? c.high >= simActive.tp2 : c.low <= simActive.tp2;
        if (hitTP2) {
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

        // 2. TP1 Kontrolü (%80 Kâr Realizasyonu)
        const hitTP1 = isLong ? c.high >= simActive.tp1 : c.low <= simActive.tp1;
        if (!simActive.tp1Hit && hitTP1) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry;
        }

        // 3. Mikro Kâr Kilidi
        const microProfitDist = simActive.tp1Dist * 0.25;
        const triggerLevel = isLong ? (simActive.entry + simActive.tp1Dist * 0.55) : (simActive.entry - simActive.tp1Dist * 0.55);
        const reachedTrigger = isLong ? c.high >= triggerLevel : c.low <= triggerLevel;

        if (!simActive.tp1Hit && !simActive.lockedProfit && reachedTrigger) {
          simActive.lockedProfit = true;
          simActive.sl = isLong ? (simActive.entry + microProfitDist) : (simActive.entry - microProfitDist);
        }

        // 4. Stop Kontrolü
        let isStopped = false;
        if (simActive.tp1Hit || simActive.lockedProfit) {
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
          } else if (simActive.lockedProfit) {
            profit = Number((microProfitDist).toFixed(4));
            status = 'KÂR KİLİTLENDİ 🔒';
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

      // Stop sonrası aynı yönde en az 6 bar bekleme
      const currentDir = c.close > c.open ? 'LONG' : 'SHORT';
      if (i - lastStopIndex < 6 && lastStopDir === currentDir) continue;
      if (i - lastTradeIndex < 3) continue;

      const setup = evaluateSMCRSIStrategy(slice, atr);

      if (Math.abs(setup.score) >= 90) {
        const plan = calculateSMCPlan(c.close, setup.isShort, atr, setup.levels);
        lastTradeIndex = i;
        openCandleIndex = i;

        simActive = {
          symbol: targetSymbol,
          openTime: `${dateStr} ${timeStr}`,
          direction: setup.isShort ? 'SHORT' : 'LONG',
          entry: plan.entry,
          sl: plan.sl,
          tp1: plan.tp1,
          tp2: plan.tp2,
          tp1Dist: plan.tp1Dist,
          tp1Hit: false,
          lockedProfit: false
        };
      }
    }

    const wins = simTrades.filter(t => t.result === 'WIN').length;
    const losses = simTrades.filter(t => t.result === 'LOSS').length;
    const winRate = simTrades.length > 0 ? Math.round((wins / simTrades.length) * 100) : 0;
    const totalProfit = simTrades.reduce((acc, t) => acc + (Number(t.profitDollar) || 0), 0);

    const precision = targetSymbol.includes('BTC') ? 2 : (targetSymbol.includes('ETH') ? 2 : 4);
    res.json({
      symbol: targetSymbol,
      hoursRequested: hours,
      candleCount: candles.length,
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

// === CANLI 35 COİN TARAYICI ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(10000000);
    const results = [];

    for (const coin of topCoins) {
      const candles = await getBitgetCandles3K(coin.symbol, '15m', 250);
      if (candles.length < 200) continue;

      const atr = calcATR(candles, 14);
      const setup = evaluateSMCRSIStrategy(candles, atr);
      const plan = calculateSMCPlan(coin.lastPrice, setup.isShort, atr, setup.levels || findDynamicSupportResistance(candles));

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: setup.score,
        signal: setup.score >= 90 ? 'LONG 🟢 (SMC+RSI)' : (setup.score <= -90 ? 'SHORT 🔴 (SMC+RSI)' : 'NÖTR ⏳'),
        tradePlan: plan,
        reasons: setup.reasons.length ? setup.reasons : ['Sniper Seviyesi Bekleniyor']
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Kusursuz Zaman Ayarlı SMC Motoru Aktif: Port ${PORT}`));
module.exports = app;
