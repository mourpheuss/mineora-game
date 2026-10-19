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

// === MATEMATİKSEL İNDİKATÖR FONKSİYONLARI ===
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

// === SIKI RİSK VE KÂR PLANI (Gereksiz Zarar Ettirmeyen Asimetrik Model) ===
function calculateCryptoTradePlan(spotPrice, isShort, atr, swingLevel) {
  const precision = spotPrice < 2 ? 4 : (spotPrice < 50 ? 3 : 2);
  
  // Stop mesafesi swing seviyesine veya maksimum 0.85 ATR'ye kilitlenir
  let slDist = Math.abs(spotPrice - swingLevel);
  if (slDist < atr * 0.45) slDist = atr * 0.45;
  if (slDist > atr * 0.90) slDist = atr * 0.90; // Stop asla devasa olamaz

  const tp1Dist = Number((slDist * 1.35).toFixed(precision)); // Net R:R 1.35x
  const tp2Dist = Number((slDist * 2.80).toFixed(precision)); // Net R:R 2.80x
  slDist = Number(slDist.toFixed(precision));

  return {
    entry: Number(spotPrice.toFixed(precision)),
    sl: Number((!isShort ? spotPrice - slDist : spotPrice + slDist).toFixed(precision)),
    tp1: Number((!isShort ? spotPrice + tp1Dist : spotPrice - tp1Dist).toFixed(precision)),
    tp2: Number((!isShort ? spotPrice + tp2Dist : spotPrice - tp2Dist).toFixed(precision)),
    slDist,
    tp1Dist,
    tp2Dist
  };
}

// === GELİŞMİŞ KURUMSAL STRATEJİ MOTORU (TREND + MOMENTUM REVERSAL) ===
function evaluateCryptoSetup(candles, atr) {
  if (candles.length < 55) return { score: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema55 = calcEMA(closes, 55);
  const ema200 = calcEMA(closes, Math.min(200, closes.length));
  const vwap = calcVWAP(candles);

  const prevCloses = closes.slice(0, -1);
  const rsiCurrent = calcRSI(closes, 14);
  const rsiPrev = calcRSI(prevCloses, 14);

  const curPrice = closes[closes.length - 1];
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];

  // 1. ANA SEANS TRENDİ (EMA 200 ve EMA 55 Yönü)
  const isSolidUpTrend = curPrice > ema200 && ema21 > ema55;
  const isSolidDownTrend = curPrice < ema200 && ema21 < ema55;

  // 2. SWING DESTEK VE DİRENÇ (Son 8 Mum)
  const recent8 = candles.slice(-10, -2);
  const localLow = Math.min(...recent8.map(c => c.low));
  const localHigh = Math.max(...recent8.map(c => c.high));

  // 3. RETEST / PULLBACK TEPKİSİ
  const bullPullback = (curC.low <= ema21 || curC.low <= vwap) && curC.close > curC.open && curC.close > ema21;
  const bearPullback = (curC.high >= ema21 || curC.high >= vwap) && curC.close < curC.open && curC.close < ema21;

  // 4. LİKİDİTE İĞNESİ (SWEEP)
  const bullSweep = prevC.low < localLow && curC.close > localLow && curC.close > curC.open;
  const bearSweep = prevC.high > localHigh && curC.close < localHigh && curC.close < curC.open;

  let score = 0;
  const reasons = [];
  let swingLevel = curPrice;

  // === %85+ KALİTE LONG KURULUMU ===
  if (isSolidUpTrend && (bullSweep || bullPullback)) {
    // RSI aşırı alımda değilken ve yukarı dönüş başlarken
    if (rsiCurrent > rsiPrev && rsiCurrent <= 62) {
      score = 85;
      reasons.push('Ana Boğa Trendi (EMA200 ve EMA55 Üstü)');
      reasons.push(bullSweep ? '💎 Likidite Dibi Süpürüldü (Sweep)' : '⚡ EMA21/VWAP Pullback Tepkisi');
      reasons.push(`RSI Pozitif Dönüşü (${rsiCurrent})`);
      swingLevel = Math.min(curC.low, prevC.low);
    }
  }

  // === %85+ KALİTE SHORT KURULUMU ===
  if (isSolidDownTrend && (bearSweep || bearPullback)) {
    // RSI aşırı satımda değilken ve aşağı dönüş başlarken
    if (rsiCurrent < rsiPrev && rsiCurrent >= 38) {
      score = -85;
      reasons.push('Ana Ayı Trendi (EMA200 ve EMA55 Altı)');
      reasons.push(bearSweep ? '💎 Likidite Tepesi Süpürüldü (Sweep)' : '⚡ EMA21/VWAP Pullback Reddi');
      reasons.push(`RSI Negatif Dönüşü (${rsiCurrent})`);
      swingLevel = Math.max(curC.high, prevC.high);
    }
  }

  if (score > 0 && curC.close < curC.open) score = 0;
  if (score < 0 && curC.close > curC.open) score = 0;

  return { score, reasons, ema21, ema55, ema200, vwap, rsi: rsiCurrent, swingLevel };
}

// === GERİYE DÖNÜK TEST (BACKTEST) MOTORU ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const targetSymbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const granularity = '15m'; // 15 Dakikalık kurumsal veri
    const limit = Number(req.query.hours) ? Math.min(350, Number(req.query.hours) * 4) : 220;

    const candles = await getBitgetCandles(targetSymbol, granularity, limit);
    if (candles.length < 55) {
      return res.status(400).json({ error: 'Yeterli mum verisi alınamadı.' });
    }

    let simActive = null;
    let lastTradeIndex = -99;
    const simTrades = [];

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const slice = candles.slice(0, i + 1);
      const atr = calcATR(slice, 14);

      const dObj = new Date(c.time * 1000);
      const timeStr = getTRTime(dObj, false);
      const dateStr = getTRDate(dObj);

      if (simActive) {
        const isLong = simActive.direction === 'LONG';

        // 1. SL KONTROLÜ
        if ((isLong && c.low <= simActive.sl) || (!isLong && c.high >= simActive.sl)) {
          let profit = 0;
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';

          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.8).toFixed(2));
            status = 'TP1 ALINDI + BAŞABAŞ 🛡️';
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

        // 2. TP2 TAM HEDEF KONTROLÜ
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

        // 3. TP1 KONTROLÜ (%80 KÂR + STOPU MALİYETE ÇEK)
        if (!simActive.tp1Hit && ((isLong && c.high >= simActive.tp1) || (!isLong && c.low <= simActive.tp1))) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry; // Kesin risksiz başabaş kilidi
        }
        continue;
      }

      if (i - lastTradeIndex < 3) continue;

      const setup = evaluateCryptoSetup(slice, atr);

      if (Math.abs(setup.score) >= 80) {
        const isShort = setup.score < 0;
        const plan = calculateCryptoTradePlan(c.close, isShort, atr, setup.swingLevel);
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
          tp1Hit: false
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

// === CANLI ÇOKLU COİN TARAYICI ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(15000000);
    const results = [];

    for (const coin of topCoins.slice(0, 20)) {
      const candles = await getBitgetCandles(coin.symbol, '15m', 65);
      if (candles.length < 55) continue;

      const atr = calcATR(candles, 14);
      const setup = evaluateCryptoSetup(candles, atr);
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

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Kurumsal Kripto Motoru (Yüksek Kazanma Oranı) Aktif: Port ${PORT}`));
module.exports = app;
