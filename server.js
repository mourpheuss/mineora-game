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
    history: [],
    // CANLI SANAL İŞLEM (PAPER TRADING) VERİLERİ
    paperAccount: {
      balance: 1000.0,
      activePositions: [], // { id, symbol, direction, entry, sl, tp1, tp2, tp1Hit, openTime, sizeUSDT }
      closedTrades: []
    }
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
  
  if (!parsed.paperAccount || typeof parsed.paperAccount !== 'object') {
    parsed.paperAccount = { balance: 1000.0, activePositions: [], closedTrades: [] };
  } else {
    parsed.paperAccount.activePositions = Array.isArray(parsed.paperAccount.activePositions) ? parsed.paperAccount.activePositions : [];
    parsed.paperAccount.closedTrades = Array.isArray(parsed.paperAccount.closedTrades) ? parsed.paperAccount.closedTrades : [];
  }
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

// === BITGET V2 VERİ ÇEKME ===
async function getTopVolumeBitgetCoins(minVolumeUSDT = 10000000) {
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

async function getBitgetCandles(symbol, granularity = '15m', limit = 150) {
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

// === RİSK / ÖDÜL PLANI ===
function calculateLivePlan(entryPrice, isShort, atr) {
  const precision = entryPrice < 0.01 ? 6 : (entryPrice < 1 ? 5 : (entryPrice < 50 ? 4 : 2));
  
  let slDist = Number((atr * 0.55).toFixed(precision));
  if (entryPrice > 10000 && slDist > 90) slDist = 90; // BTC için maks $90 zarar

  const tp1Dist = Number((atr * 0.75).toFixed(precision));
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

// === CANLI SİNYAL DEĞERLENDİRME ===
function checkLiveSetup(candles, atr) {
  if (candles.length < 40) return { score: 0 };

  const closes = candles.map(c => c.close);
  const curPrice = closes[closes.length - 1];
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];

  const h1TrendEma = calcEMA(closes, Math.min(60, closes.length));
  const lookback = candles.slice(-12, -2);
  const minLow = Math.min(...lookback.map(c => c.low));
  const maxHigh = Math.max(...lookback.map(c => c.high));

  // LONG
  if (curPrice >= h1TrendEma && (curC.low <= minLow || prevC.low <= minLow) && curC.close > curC.open && curC.close > prevC.close) {
    return { score: 90, isShort: false, reason: 'H1 Boğa Trendi + Canlı Dip Süpürmesi' };
  }

  // SHORT
  if (curPrice <= h1TrendEma && (curC.high >= maxHigh || prevC.high >= maxHigh) && curC.close < curC.open && curC.close < prevC.close) {
    return { score: -90, isShort: true, reason: 'H1 Ayı Trendi + Canlı Tepe Süpürmesi' };
  }

  return { score: 0 };
}

// === CANLI SANAL İŞLEM (PAPER TRADING) İZLEME DÖNGÜSÜ (HER 15 SANİYE) ===
async function runLivePaperTradingEngine() {
  try {
    const topCoins = await getTopVolumeBitgetCoins(15000000);
    if (!topCoins.length) return;

    const priceMap = {};
    topCoins.forEach(c => { priceMap[c.symbol] = c.lastPrice; });

    let stateChanged = false;
    const active = db.paperAccount.activePositions;

    // 1. AÇIK POZİSYONLARI ANLIK FİYATLA KONTROL ET
    for (let i = active.length - 1; i >= 0; i--) {
      const pos = active[i];
      const curPrice = priceMap[pos.symbol];
      if (!curPrice) continue;

      const isLong = pos.direction === 'LONG';
      let isClosed = false;
      let closePrice = curPrice;
      let status = '';
      let profit = 0;

      // TP2 Kontrolü (Büyük Hedef)
      if ((isLong && curPrice >= pos.tp2) || (!isLong && curPrice <= pos.tp2)) {
        isClosed = true;
        closePrice = pos.tp2;
        profit = isLong ? (pos.tp2 - pos.entry) : (pos.entry - pos.tp2);
        status = 'TP2 TAM HEDEF 🎯';
      } 
      // TP1 Kontrolü (Kâr Kilitleme ve Maliyete Çekme)
      else if (!pos.tp1Hit && ((isLong && curPrice >= pos.tp1) || (!isLong && curPrice <= pos.tp1))) {
        pos.tp1Hit = true;
        pos.sl = pos.entry; // Stop derhal başabaş seviyesine kilitlendi
        stateChanged = true;
      }
      // SL Kontrolü
      else if ((isLong && curPrice <= pos.sl) || (!isLong && curPrice >= pos.sl)) {
        isClosed = true;
        closePrice = pos.sl;
        if (pos.tp1Hit) {
          profit = (isLong ? (pos.tp1 - pos.entry) : (pos.entry - pos.tp1)) * 0.50;
          status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
        } else {
          profit = isLong ? (pos.sl - pos.entry) : (pos.entry - pos.sl);
          status = 'STOP OLDU ❌';
        }
      }

      if (isClosed) {
        db.paperAccount.balance += profit;
        db.paperAccount.closedTrades.unshift({
          ...pos,
          closeTime: `${getTRDate()} ${getTRTime()}`,
          closePrice,
          profitUSDT: Number(profit.toFixed(4)),
          status,
          result: profit >= 0 ? 'WIN' : 'LOSS'
        });
        active.splice(i, 1);
        stateChanged = true;
      }
    }

    // 2. YENİ CANLI POZİSYON FIRSATI ARA (Maksimum 3 Eşzamanlı Pozisyon)
    if (active.length < 3) {
      for (const coin of topCoins.slice(0, 15)) {
        if (active.some(p => p.symbol === coin.symbol)) continue;

        const candles = await getBitgetCandles(coin.symbol, '15m', 50);
        if (candles.length < 35) continue;

        const atr = calcATR(candles, 14);
        const setup = checkLiveSetup(candles, atr);

        if (Math.abs(setup.score) >= 85) {
          const plan = calculateLivePlan(coin.lastPrice, setup.isShort, atr);
          active.push({
            id: 'paper_' + Date.now() + '_' + Math.random().toString(36).substring(4, 8),
            symbol: coin.symbol,
            direction: setup.isShort ? 'SHORT' : 'LONG',
            entry: plan.entry,
            sl: plan.sl,
            tp1: plan.tp1,
            tp2: plan.tp2,
            tp1Hit: false,
            openTime: `${getTRDate()} ${getTRTime()}`,
            reason: setup.reason
          });
          stateChanged = true;
          break; // Aynı turda tek pozisyon aç
        }
      }
    }

    if (stateChanged) {
      await saveDB(db);
    }
  } catch (err) {
    console.error('Canlı Paper Trading Döngü Hatası:', err.message);
  }
}

// Canlı fiyat izleme döngüsü (15 saniyede bir tetiklenir)
setInterval(runLivePaperTradingEngine, 15000);

// === CANLI SANAL İŞLEM VERİLERİ ENDPOINT'İ ===
app.get('/api/paper-trading', requireAuth, (req, res) => {
  const paper = db.paperAccount;
  const wins = paper.closedTrades.filter(t => t.result === 'WIN').length;
  const total = paper.closedTrades.length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  res.json({
    balance: Number(paper.balance.toFixed(2)),
    winRate,
    totalTrades: total,
    wins,
    losses: total - wins,
    activePositions: paper.activePositions,
    closedTrades: paper.closedTrades
  });
});

app.post('/api/paper-trading/reset', requireAuth, async (req, res) => {
  db.paperAccount = {
    balance: 1000.0,
    activePositions: [],
    closedTrades: []
  };
  await saveDB(db);
  res.json({ ok: true });
});

// SİMÜLASYON ENDPOINT'İ (Mevcut arayüz modalını beslemeye devam eder)
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const paper = db.paperAccount;
    const trades = paper.closedTrades.filter(t => t.symbol === targetSymbol);
    const wins = trades.filter(t => t.result === 'WIN').length;
    const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
    const totalProfit = trades.reduce((acc, t) => acc + (t.profitUSDT || 0), 0);

    res.json({
      symbol: targetSymbol,
      totalSignals: trades.length,
      wins,
      losses: trades.length - wins,
      winRate,
      totalProfit: totalProfit.toFixed(2),
      trades
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CANLI 30 COİN TARAYICI
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(10000000);
    const results = [];

    for (const coin of topCoins) {
      const candles = await getBitgetCandles(coin.symbol, '15m', 45);
      if (candles.length < 30) continue;

      const atr = calcATR(candles, 14);
      const setup = checkLiveSetup(candles, atr);
      const plan = calculateLivePlan(coin.lastPrice, setup.isShort, atr);

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        score: setup.score,
        signal: setup.score >= 80 ? 'LONG 🟢' : (setup.score <= -80 ? 'SHORT 🔴' : 'NÖTR ⏳'),
        tradePlan: plan,
        reasons: [setup.reason || 'Beklemede']
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Canlı Paper Trading Motoru Aktif: Port ${PORT}`));
module.exports = app;
