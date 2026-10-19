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

// === BITGET V2 VERİLERİ ===
async function getTopVolumeBitgetCoins(minVolumeUSDT = 10000000) {
  try {
    const res = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    const json = await res.json();
    if (json.code !== '00000' || !Array.isArray(json.data)) return [];

    return json.data
      .filter(c => Number(c.usdtVolume || c.quoteVolume || 0) >= minVolumeUSDT && c.symbol.endsWith('USDT'))
      .sort((a, b) => Number(b.usdtVolume || b.quoteVolume || 0) - Number(a.usdtVolume || a.quoteVolume || 0))
      .slice(0, 35)
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

async function getBitgetCandles(symbol, granularity = '15m', limit = 450) {
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

// === İNDİKATÖR ZİNCİRİ HESAPLAMALARI ===
function calcEMAArray(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  emas[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    emas[i] = closes[i] * k + emas[i - 1] * (1 - k);
  }
  return emas;
}

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const arr = calcEMAArray(closes, period);
  return arr[arr.length - 1];
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

// ADX (Testere Filtresi)
function calcADX(candles, period = 14) {
  if (candles.length < period * 2) return 25;
  let trList = [], plusDM = [], minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trList.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }

  let trSmooth = trList.slice(0, period).reduce((a, b) => a + b, 0);
  let plusDMSmooth = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let minusDMSmooth = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxList = [];
  for (let i = period; i < trList.length; i++) {
    trSmooth = trSmooth - (trSmooth / period) + trList[i];
    plusDMSmooth = plusDMSmooth - (plusDMSmooth / period) + plusDM[i];
    minusDMSmooth = minusDMSmooth - (minusDMSmooth / period) + minusDM[i];

    const plusDI = trSmooth > 0 ? (plusDMSmooth / trSmooth) * 100 : 0;
    const minusDI = trSmooth > 0 ? (minusDMSmooth / trSmooth) * 100 : 0;
    const sumDI = plusDI + minusDI;
    const dx = sumDI > 0 ? (Math.abs(plusDI - minusDI) / sumDI) * 100 : 0;
    dxList.push(dx);
  }

  if (dxList.length < period) return 25;
  const adx = dxList.slice(-period).reduce((a, b) => a + b, 0) / period;
  return Number(adx.toFixed(1));
}

// MACD (Tetikleyici İndikatör)
function calcMACD(closes) {
  if (closes.length < 35) return { macd: 0, signal: 0, hist: 0, prevHist: 0 };
  const ema12 = calcEMAArray(closes, 12);
  const ema26 = calcEMAArray(closes, 26);

  const macdLine = [];
  for (let i = 25; i < closes.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }

  const signalLine = calcEMAArray(macdLine, 9);
  const curMacd = macdLine[macdLine.length - 1];
  const curSignal = signalLine[signalLine.length - 1];
  const prevMacd = macdLine[macdLine.length - 2];
  const prevSignal = signalLine[signalLine.length - 2];

  return {
    macd: curMacd,
    signal: curSignal,
    hist: curMacd - curSignal,
    prevHist: prevMacd - prevSignal
  };
}

// RİSK VE KÂR PLANI
function calculateChainPlan(entryPrice, isShort, atr) {
  const precision = entryPrice < 0.01 ? 6 : (entryPrice < 1 ? 5 : (entryPrice < 50 ? 4 : 2));
  
  // SL: 0.80x ATR (Dinamik ve korunaklı)
  const slDist = Number((atr * 0.80).toFixed(precision));
  // TP1: 0.85x ATR (%75 kâr realizasyonu + stop girişe)
  const tp1Dist = Number((atr * 0.85).toFixed(precision));
  // TP2: 2.20x ATR
  const tp2Dist = Number((atr * 2.20).toFixed(precision));

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

// === İNDİKATÖRLER ZİNCİRİ KARAR MOTORU ===
function evaluateIndicatorChain(candles, atr) {
  if (candles.length < 50) return { score: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const curPrice = closes[closes.length - 1];

  // 1. KATMAN: Trend Filtresi (EMA 200 & EMA 50)
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, Math.min(200, closes.length));
  const isTrendBull = curPrice > ema200 && curPrice >= ema50;
  const isTrendBear = curPrice < ema200 && curPrice <= ema50;

  // 2. KATMAN: Testere Rejim Filtresi (ADX >= 22)
  const adx = calcADX(candles, 14);
  if (adx < 22) return { score: 0, reasons: ['Yatay Piyasa (ADX < 22)'] };

  // 3. KATMAN: Momentum Teyidi (RSI 14)
  const rsi = calcRSI(closes, 14);

  // 4. KATMAN: Tetikleyici (MACD Kesişimi)
  const macd = calcMACD(closes);
  const isMacdBullCross = macd.prevHist <= 0 && macd.hist > 0;
  const isMacdBearCross = macd.prevHist >= 0 && macd.hist < 0;

  const reasons = [];

  // LONG ZİNCİRİ: Trend Boğa + ADX Güçlü + RSI 45-65 + MACD Yukarı Kesişim
  if (isTrendBull && isMacdBullCross && rsi >= 45 && rsi <= 68) {
    reasons.push('EMA200 & EMA50 Boğa Trendi');
    reasons.push(`Trend Güçlü (ADX: ${adx})`);
    reasons.push(`RSI Teyitli (${rsi})`);
    reasons.push('MACD Yukarı Kesişim');
    return { score: 95, isShort: false, reasons };
  }

  // SHORT ZİNCİRİ: Trend Ayı + ADX Güçlü + RSI 32-55 + MACD Aşağı Kesişim
  if (isTrendBear && isMacdBearCross && rsi <= 55 && rsi >= 32) {
    reasons.push('EMA200 & EMA50 Ayı Trendi');
    reasons.push(`Trend Güçlü (ADX: ${adx})`);
    reasons.push(`RSI Teyitli (${rsi})`);
    reasons.push('MACD Aşağı Kesişim');
    return { score: -95, isShort: true, reasons };
  }

  return { score: 0, reasons: [] };
}

// === SİMÜLASYON MOTORU ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = '15m';
    
    const candles = await getBitgetCandles(targetSymbol, granularity, 450);
    if (candles.length < 50) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let openCandleIndex = -99;
    let lastTradeIndex = -99;
    let lastStopIndex = -99;
    const simTrades = [];

    for (let i = 35; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);
      const atr = calcATR(slice, 14);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        if (i === openCandleIndex) continue;

        const isLong = simActive.direction === 'LONG';

        // TP2 Kontrolü
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

        // TP1 Kontrolü (%75 Kâr Alımı + Stop Maliyete)
        const reachedTP1 = isLong ? c.high >= simActive.tp1 : c.low <= simActive.tp1;
        if (!simActive.tp1Hit && reachedTP1) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry;
        }

        // Stop Kontrolü (Fitil Hatasız Kapanış Teyidi)
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
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.75).toFixed(4));
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

      // Stop sonrası en az 6 mum (1.5 saat) bekleme
      if (i - lastStopIndex < 6) continue;
      if (i - lastTradeIndex < 3) continue;

      const chainSetup = evaluateIndicatorChain(slice, atr);

      if (Math.abs(chainSetup.score) >= 90) {
        const plan = calculateChainPlan(c.close, chainSetup.isShort, atr);
        lastTradeIndex = i;
        openCandleIndex = i;

        simActive = {
          symbol: targetSymbol,
          openTime: `${dateStr} ${timeStr}`,
          direction: chainSetup.isShort ? 'SHORT' : 'LONG',
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

    const precision = targetSymbol.includes('BTC') ? 2 : (targetSymbol.includes('ETH') ? 2 : 4);
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

// === CANLI 35 COİN TARAYICI ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(10000000);
    const results = [];

    for (const coin of topCoins) {
      const candles = await getBitgetCandles(coin.symbol, '15m', 55);
      if (candles.length < 40) continue;

      const atr = calcATR(candles, 14);
      const chainSetup = evaluateIndicatorChain(candles, atr);
      const plan = calculateChainPlan(coin.lastPrice, chainSetup.isShort, atr);

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: chainSetup.score,
        signal: chainSetup.score >= 90 ? 'LONG 🟢' : (chainSetup.score <= -90 ? 'SHORT 🔴' : 'NÖTR ⏳'),
        tradePlan: plan,
        reasons: chainSetup.reasons.length ? chainSetup.reasons : ['Fırsat Bekleniyor']
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget İndikatör Zinciri Motoru Aktif: Port ${PORT}`));
module.exports = app;
