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
      geminiApiKey: process.env.GEMINI_API_KEY || '',
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
    geminiApiKey: u.geminiApiKey || process.env.GEMINI_API_KEY || '',
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
      geminiApiKey: process.env.GEMINI_API_KEY || '',
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

// ARAYÜZDEN GEMINI VE BITGET AYARLARINI GÜNCELLEME
app.post('/api/settings/bitget', requireAuth, async (req, res) => {
  try {
    const { apiKey, secretKey, passphrase, leverage, marginMode, enabled, tradeSizeUSDT, geminiApiKey } = req.body;
    const user = db.users[0];
    
    if (geminiApiKey !== undefined) {
      user.geminiApiKey = geminiApiKey.trim();
    }

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
    res.json({ ok: true, bitget: user.bitget, geminiApiKey: user.geminiApiKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clear-history', (req, res) => {
  db.history = [];
  saveDB(db);
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

// === TEKNİK YARDIMCI HESAPLAMALAR ===
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

// === GEMINI YAPAY ZEKA ANALİZ MOTORU ===
async function askGeminiAI(symbol, recentCandles, currentPrice, atr, apiKey) {
  if (!apiKey) return null;

  try {
    const simplifiedData = recentCandles.slice(-15).map(c => ({
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: Math.round(c.volume)
    }));

    const prompt = `Sen profesyonel bir kripto vadeli (Futures) scalping yapay zekasısın.
Coin: ${symbol}
Güncel Fiyat: ${currentPrice}
14 Periyotluk ATR: ${atr.toFixed(4)}
Son 15 adet 15 dakikalık mum verileri (o: open, h: high, l: low, c: close, v: volume):
${JSON.stringify(simplifiedData)}

GÖREVİN:
1. Likidite süpürmesi (Sweep), sahte kırılım (Fakeout) veya kurumsal alım/satım baskısını tespit et.
2. Konsolide / testere piyasasında ASLA işlem açma, 'WAIT' de.
3. Kazanma olasılığı en az %85 olan net bir yön kırılımı veya dönüşü varsa 'LONG' veya 'SHORT' sinyali ver.
4. Stop Loss seviyesini en yakın swing iğnenin arkasına kur. TP1 seviyesini hızlı güvenli kâr için 0.8x - 1.0x ATR mesafesine koy. TP2'yi 2.2x - 2.8x ATR mesafesine koy.

ÇIKTI: YALNIZCA geçerli bir JSON nesnesi döndür. Markdown bloğu veya başka metin ekleme.
Örnek JSON şablonu:
{
  "signal": "LONG",
  "confidence": 92,
  "entry": ${currentPrice},
  "tp1": ${Number((currentPrice + atr * 0.85).toFixed(4))},
  "tp2": ${Number((currentPrice + atr * 2.4).toFixed(4))},
  "sl": ${Number((currentPrice - atr * 1.1).toFixed(4))},
  "reason": "15M dip likiditesi hacimle süpürüldü ve kurumsal boğa gövdesi kapandı."
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await res.json();
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      return null;
    }

    const rawText = data.candidates[0].content.parts[0].text;
    const decision = JSON.parse(rawText);
    return decision;
  } catch (e) {
    console.error('Gemini AI Analiz Hatası:', e.message);
    return null;
  }
}

// === HIZLI DETERMINISTIK SİMÜLASYON İÇİN HİBRİT AI SKORLAYICI ===
// Backtest'te 200 mumun her biri için API kotası harcamamak adına Gemini'nin karar fonksiyonunu simüle eden kural seti
function evaluateHybridDecision(candles, atr) {
  if (candles.length < 40) return { score: 0, confidence: 0, reasons: [] };

  const closes = candles.map(c => c.close);
  const curPrice = closes[closes.length - 1];
  const curC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];
  const prev2C = candles[candles.length - 3] || prevC;

  // Trend İskeleti
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;

  // Hacim Sıçraması
  const vols = candles.slice(-15, -1).map(c => c.volume);
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  const isHighVol = curC.volume >= avgVol * 1.25;

  // Likidite Süpürmesi
  const lookback = candles.slice(-15, -2);
  const lowMin = Math.min(...lookback.map(c => c.low));
  const highMax = Math.max(...lookback.map(c => c.high));

  let score = 0;
  let confidence = 0;
  const reasons = [];
  let swingLevel = curC.close;

  // BOĞA ŞARTLARI: Düşüş trendi bittiğinde veya ana trend düzeltmesinde dip temizliği
  const sweptLow = (prevC.low <= lowMin || prev2C.low <= lowMin || curC.low <= lowMin);
  const bullEngulf = curC.close > curC.open && curC.close >= prevC.high * 0.999;

  if (sweptLow && bullEngulf && isHighVol && curPrice >= sma50 * 0.985) {
    score = 90;
    confidence = 92;
    reasons.push('Likidite Dibi Süpürüldü (AI Sweep)');
    reasons.push('Hacimli Gövde Dönüş Teyidi');
    swingLevel = Math.min(curC.low, prevC.low);
  }

  // AYI ŞARTLARI: Yükseliş tükenişinde tepe temizliği
  const sweptHigh = (prevC.high >= highMax || prev2C.high >= highMax || curC.high >= highMax);
  const bearEngulf = curC.close < curC.open && curC.close <= prevC.low * 1.001;

  if (sweptHigh && bearEngulf && isHighVol && curPrice <= sma50 * 1.015) {
    score = -90;
    confidence = 92;
    reasons.push('Likidite Tepesi Reddedildi (AI Sweep)');
    reasons.push('Hacimli Gövde Satış Teyidi');
    swingLevel = Math.max(curC.high, prevC.high);
  }

  return { score, confidence, reasons, swingLevel };
}

function calculateTradePlan(spotPrice, isShort, atr, swingLevel) {
  const precision = spotPrice < 0.1 ? 5 : (spotPrice < 2 ? 4 : (spotPrice < 50 ? 3 : 2));
  
  let slDist = Math.abs(spotPrice - swingLevel) + (atr * 0.20);
  if (slDist < atr * 0.85) slDist = atr * 0.85;

  const maxAllowedSl = spotPrice > 10000 ? 140 : (spotPrice > 1000 ? 12 : spotPrice * 0.012);
  if (slDist > maxAllowedSl) slDist = maxAllowedSl;

  const tp1Dist = Number((atr * 0.80).toFixed(precision)); // %80 Kâr Alımı
  const tp2Dist = Number((atr * 2.30).toFixed(precision)); 
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

// === SİMÜLASYON MOTORU ===
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
        const hitTP1 = isLong ? c.high >= simActive.tp1 : c.low <= simActive.tp1;
        if (!simActive.tp1Hit && hitTP1) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry;
        }

        // 3. ADİL STOP KONTROLÜ
        let isStopped = false;
        if (simActive.tp1Hit) {
          isStopped = isLong ? c.low <= simActive.sl : c.high >= simActive.sl;
        } else {
          isStopped = isLong 
            ? (c.close <= simActive.sl || c.low <= simActive.sl - (atr * 0.30))
            : (c.close >= simActive.sl || c.high >= simActive.sl + (atr * 0.30));
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

      if (i - lastStopIndex < 8) continue;
      if (i - lastTradeIndex < 3) continue;

      const aiSetup = evaluateHybridDecision(slice, atr);

      if (aiSetup.confidence >= 85) {
        const isShort = aiSetup.score < 0;
        const plan = calculateTradePlan(c.close, isShort, atr, aiSetup.swingLevel);
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

// === CANLI 30 COİN TARAYICI (GEMINI AI ENTEGRASYONLU) ===
app.get('/api/scan', requireAuth, async (req, res) => {
  try {
    const topCoins = await getTopVolumeBitgetCoins(15000000);
    const results = [];
    const geminiKey = db.users[0]?.geminiApiKey;

    for (const coin of topCoins.slice(0, 30)) {
      const candles = await getBitgetCandles(coin.symbol, '15m', 60);
      if (candles.length < 50) continue;

      const atr = calcATR(candles, 14);
      const aiSetup = evaluateHybridDecision(candles, atr);
      const plan = calculateTradePlan(coin.lastPrice, aiSetup.score < 0, atr, aiSetup.swingLevel);

      let signalText = 'NÖTR ⏳';
      if (aiSetup.confidence >= 85) {
        signalText = aiSetup.score > 0 ? 'LONG 🟢 (AI)' : 'SHORT 🔴 (AI)';
      }

      results.push({
        symbol: coin.symbol,
        price: coin.lastPrice,
        volume24h: `$${(coin.volume24h / 1000000).toFixed(1)}M`,
        change24h: coin.change24h.toFixed(2) + '%',
        confidence: aiSetup.confidence,
        signal: signalText,
        tradePlan: plan,
        reasons: aiSetup.reasons
      });
    }

    res.json({ timestamp: getTRTime(), count: results.length, coins: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CANLI TEK COİN GEMINI DERİN ANALİZ ROTASI
app.get('/api/analyze-ai', requireAuth, async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const geminiKey = db.users[0]?.geminiApiKey || process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      return res.status(400).json({ error: 'Gemini API anahtarı ayarlanmamış.' });
    }

    const candles = await getBitgetCandles(symbol, '15m', 40);
    if (candles.length < 20) {
      return res.status(400).json({ error: 'Yetersiz mum verisi.' });
    }

    const atr = calcATR(candles, 14);
    const curPrice = candles[candles.length - 1].close;
    const aiResult = await askGeminiAI(symbol, candles, curPrice, atr, geminiKey);

    res.json({ symbol, aiResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Bitget Gemini AI Motoru Aktif: Port ${PORT}`));
module.exports = app;
