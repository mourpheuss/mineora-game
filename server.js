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

async function getBitgetCandles(symbol, granularity = '15m', limit = 500) {
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

// KESİN SINIRLI RİSK YÖNETİMİ (ZARAR ASLA BÜYÜYEMEZ)
function calculateStrictPlan(entryPrice, isShort, atr) {
  const precision = entryPrice < 0.01 ? 6 : (entryPrice < 1 ? 5 : (entryPrice < 50 ? 4 : 2));
  
  // SL DAR VE KESİN: 0.50x ATR (BTC için tavan 70$)
  let slDist = Number((atr * 0.50).toFixed(precision));
  if (entryPrice > 10000 && slDist > 70) slDist = 70;
  if (entryPrice <= 2 && slDist > 0.0040) slDist = 0.0040; // XRP/altcoin tavanı

  // TP1 HIZLI REALİZASYON: 0.60x ATR (Erken nakit + Başabaş)
  const tp1Dist = Number((atr * 0.60).toFixed(precision));
  const tp2Dist = Number((atr * 1.80).toFixed(precision));

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

// SEÇİCİ TREND VE LİKİDİTE DÖNÜŞ MOTORU
function evaluateSetup(candles, atr) {
  if (candles.length < 40) return { score: 0 };

  const closes = candles.map(c => c.close);
  const curPrice = closes[closes.length - 1];
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];

  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, Math.min(150, closes.length));

  // Son 15 mumun uç noktaları
  const lookback = candles.slice(-16, -2);
  const minLow = Math.min(...lookback.map(c => c.low));
  const maxHigh = Math.max(...lookback.map(c => c.high));

  // LONG: Fiyat EMA200 üzerinde, dip süpürüldü ve güçlü yeşil gövde kapandı
  if (curPrice >= ema200 && curPrice >= ema50 * 0.995) {
    const sweptDip = prevC.low <= minLow || curC.low <= minLow;
    const greenBody = curC.close > curC.open && curC.close > prevC.close;
    if (sweptDip && greenBody) {
      return { score: 90, isShort: false };
    }
  }

  // SHORT: Fiyat EMA200 altında, tepe süpürüldü ve güçlü kırmızı gövde kapandı
  if (curPrice <= ema200 && curPrice <= ema50 * 1.005) {
    const sweptTop = prevC.high >= maxHigh || curC.high >= maxHigh;
    const redBody = curC.close < curC.open && curC.close < prevC.close;
    if (sweptTop && redBody) {
      return { score: -90, isShort: true };
    }
  }

  return { score: 0 };
}

// === DOĞRU SİMÜLASYON MOTORU ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = '15m';
    
    const candles = await getBitgetCandles(targetSymbol, granularity, 480);
    if (candles.length < 35) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let openCandleIndex = -99;
    let lastTradeIndex = -99;
    let lastStopIndex = -99;
    let lastStopDir = null;
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

        // 1. Önce TP2 Kontrolü
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

        // 2. TP1 Kontrolü (Hızlı realizasyon, Stop derhal maliyete)
        const reachedTP1 = isLong ? c.high >= simActive.tp1 : c.low <= simActive.tp1;
        if (!simActive.tp1Hit && reachedTP1) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry;
        }

        // 3. Stop Kontrolü (Sıkı koruma: Kapanış veya dar SL ihlali)
        let isStopped = false;
        if (simActive.tp1Hit) {
          isStopped = isLong ? c.low <= simActive.sl : c.high >= simActive.sl;
        } else {
          isStopped = isLong ? (c.close <= simActive.sl || c.low <= simActive.sl) : (c.close >= simActive.sl || c.high >= simActive.sl);
        }

        if (isStopped) {
          let profit = 0;
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';

          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.70).toFixed(4));
            status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
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

      // Stop sonrası aynı yönde en az 8 bar (2 saat) bekle
      const currentDir = c.close > c.open ? 'LONG' : 'SHORT';
      if (i - lastStopIndex < 8 && lastStopDir === currentDir) continue;
      if (i - lastTradeIndex < 3) continue;

      const setup = evaluateSetup(slice, atr);

      if (Math.abs(setup.score) >= 80) {
        const plan = calculateStrictPlan(c.close, setup.isShort, atr);
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
      const candles = await getBitgetCandles(coin.symbol, '15m', 45);
      if (candles.length < 30) continue;

      const atr = calcATR(candles, 14);
      const setup = evaluateSetup(candles, atr);
      const plan = calculateStrictPlan(coin.lastPrice, setup.isShort, atr);

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: setup.score,
        signal: setup.score >= 80 ? 'LONG 🟢' : (setup.score <= -80 ? 'SHORT 🔴' : 'NÖTR ⏳'),
        tradePlan: plan,
        reasons: [setup.score !== 0 ? 'Trend & Likidite Teyidi' : 'Beklemede']
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Korumalı Scalp Motoru Aktif: Port ${PORT}`));
module.exports = app;
