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
const DB_FILE = IS_CLOUD ? path.join('/tmp', 'signals_db.json') : path.join(__dirname, 'signals_db.json');

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
function getTRFullDate(d = new Date()) {
  return d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function createDefaultMetaApi() {
  return { token: '', accountId: '', symbol: 'GOLD', lot: 0.04, balance: 1000, riskPct: 2, regionUrl: '', enabled: false };
}

function getDefaultDB() {
  return {
    users: [{ username: 'admin', password: 'admin123', role: 'admin', createdAt: 'Kurucu Admin', metaApi: createDefaultMetaApi() }],
    sessions: {},
    activeTrade: null,
    history: [],
    lastStopTimestamp: 0,
    telegram: { botToken: '', chatId: '', enabled: false }
  };
}

function normalizeDB(parsed) {
  if (!parsed || typeof parsed !== 'object') return getDefaultDB();
  let rawUsers = Array.isArray(parsed.users) ? parsed.users.filter(Boolean) : (parsed.users ? Object.values(parsed.users).filter(Boolean) : []);
  if (rawUsers.length === 0) rawUsers = getDefaultDB().users;

  let hasAdmin = false;
  parsed.users = rawUsers.map(u => {
    const isMain = String(u.username || '').toLowerCase() === 'admin';
    if (isMain) hasAdmin = true;
    return {
      username: u.username,
      password: u.password || 'admin123',
      role: isMain ? 'admin' : 'user',
      createdAt: u.createdAt || '-',
      metaApi: { ...createDefaultMetaApi(), ...(u.metaApi || {}) }
    };
  });
  if (!hasAdmin) parsed.users.unshift(getDefaultDB().users[0]);
  if (!parsed.sessions || typeof parsed.sessions !== 'object') parsed.sessions = {};
  parsed.history = Array.isArray(parsed.history) ? parsed.history.filter(Boolean) : (parsed.history ? Object.values(parsed.history).filter(Boolean) : []);
  if (!parsed.telegram) parsed.telegram = { botToken: '', chatId: '', enabled: false };
  if (!parsed.lastStopTimestamp) parsed.lastStopTimestamp = 0;
  return parsed;
}

function loadLocalDB() {
  try {
    if (fs.existsSync(DB_FILE)) return normalizeDB(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {}
  return getDefaultDB();
}

let db = loadLocalDB();
let lastFirebaseSync = 0;
let isOpeningTradeLock = false;

async function syncFromFirebase(force = false) {
  const now = Date.now();
  if (!force && now - lastFirebaseSync < 3500) return;
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/xauusd_pro_state.json`, { cache: 'no-store' });
    if (res.ok) {
      const cloudData = await res.json();
      if (cloudData && cloudData.users) {
        db = normalizeDB(cloudData);
        lastFirebaseSync = now;
      } else if (!cloudData) {
        await saveDB(db);
      }
    }
  } catch (e) {}
}

async function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
  try {
    await fetch(`${FIREBASE_DB_URL}/xauusd_pro_state.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    lastFirebaseSync = Date.now();
  } catch (e) {}
}

let newsCache = { timestamp: 0, data: null };
let calendarCache = { timestamp: 0, data: null };
let lastKnownSpot = 0;

function getMarketSession() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  const isWeekend = (day === 6) || (day === 0) || (day === 5 && hour >= 23);

  if (isWeekend) {
    return {
      isWeekend: true,
      instrument: {
        name: 'BTCUSD',
        brokerSym: 'BTCUSD',
        tvSym: 'BINANCE:BTCUSDT',
        yahooSym: 'BTC-USD',
        tp1Dist: 300,
        tp2Dist: 600,
        maxSlDist: 300,
        minAtr: 80,
        maxSpread: 75
      }
    };
  }

  return {
    isWeekend: false,
    instrument: {
      name: 'GOLD',
      brokerSym: 'GOLD',
      tvSym: 'OANDA:XAUUSD',
      yahooSym: 'GC=F',
      tp1Dist: 2.80, // Yüksek başarı için ilk kâr noktası
      tp2Dist: 5.50, // İkinci hedef
      maxSlDist: 2.60, // Kesin stop mesafesi
      minAtr: 2.2,
      maxSpread: 1.5
    }
  };
}

function getAuthUser(req) {
  const token = req.headers['x-auth-token'];
  if (!token || !db.sessions || !db.sessions[token]) return null;
  const s = db.sessions[token];
  return (db.users || []).find(u => u.username.toLowerCase() === s.username.toLowerCase()) || null;
}

async function requireAuth(req, res, next) {
  await syncFromFirebase();
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  await syncFromFirebase(true);
  const user = getAuthUser(req);
  if (!user || user.username.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Sadece Kurucu Admin yetkisine açıktır.' });
  req.user = user;
  next();
}

app.post('/api/login', async (req, res) => {
  await syncFromFirebase(true);
  const cleanUser = (req.body.username || '').trim();
  const cleanPass = (req.body.password || '').trim();
  const found = (db.users || []).find(u => u.username.toLowerCase() === cleanUser.toLowerCase() && String(u.password) === cleanPass);
  if (!found) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı!' });

  found.role = found.username.toLowerCase() === 'admin' ? 'admin' : 'user';
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { username: found.username, role: found.role, loginTime: Date.now() };
  await saveDB(db);
  res.json({ ok: true, token, user: { username: found.username, role: found.role, metaApi: found.metaApi } });
});

app.get('/api/me', async (req, res) => {
  await syncFromFirebase(true);
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { username: user.username, role: user.username.toLowerCase() === 'admin' ? 'admin' : 'user', metaApi: user.metaApi } });
});

app.post('/api/admin-password', requireAdmin, async (req, res) => {
  const cleanPass = (req.body.newPassword || '').trim();
  if (cleanPass.length < 4) return res.status(400).json({ error: 'Şifre en az 4 karakter olmalı.' });
  const adminUser = db.users.find(u => u.username.toLowerCase() === 'admin');
  if (adminUser) { adminUser.password = cleanPass; await saveDB(db); }
  res.json({ ok: true });
});

app.get('/api/users', requireAdmin, async (req, res) => {
  const safeUsers = (db.users || []).map(u => ({
    username: u.username,
    password: u.password,
    role: u.username.toLowerCase() === 'admin' ? 'admin' : 'user',
    createdAt: u.createdAt || '-',
    mtEnabled: Boolean(u.metaApi && u.metaApi.enabled),
    mtSymbol: u.metaApi ? u.metaApi.symbol : 'GOLD',
    mtLot: u.metaApi ? u.metaApi.lot : 0.04
  }));
  res.json({ users: safeUsers });
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const cleanUser = (req.body.username || '').trim();
  const cleanPass = (req.body.password || '').trim();
  if (!cleanUser || cleanPass.length < 4) return res.status(400).json({ error: 'Geçersiz kullanıcı adı veya şifre.' });

  const isMain = cleanUser.toLowerCase() === 'admin';
  const idx = db.users.findIndex(u => u.username.toLowerCase() === cleanUser.toLowerCase());
  if (idx >= 0) {
    db.users[idx].password = cleanPass;
    db.users[idx].role = isMain ? 'admin' : 'user';
  } else {
    db.users.push({ username: cleanUser, password: cleanPass, role: 'user', createdAt: getTRFullDate(), metaApi: createDefaultMetaApi() });
  }
  await saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/users/:username', requireAdmin, async (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === 'admin') return res.status(400).json({ error: 'Admin silinemez.' });
  db.users = db.users.filter(u => u.username.toLowerCase() !== target.toLowerCase());
  Object.keys(db.sessions || {}).forEach(tk => {
    if (db.sessions[tk].username.toLowerCase() === target.toLowerCase()) delete db.sessions[tk];
  });
  await saveDB(db);
  res.json({ ok: true });
});

async function resolveMetaApiRegionUrl(token, accountId) {
  try {
    const res = await fetch(`https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${accountId}`, {
      headers: { 'auth-token': token }
    });
    if (!res.ok) return 'https://mt-client-api-v1.london.agiliumtrade.ai';
    const data = await res.json();
    return `https://mt-client-api-v1.${data.region || 'london'}.agiliumtrade.ai`;
  } catch (e) {
    return 'https://mt-client-api-v1.london.agiliumtrade.ai';
  }
}

async function getBrokerGoldSymbols(regionUrl, token, accountId) {
  try {
    const res = await fetch(`${regionUrl}/users/current/accounts/${accountId}/symbols`, {
      headers: { 'auth-token': token }
    });
    if (!res.ok) return [];
    const all = await res.json();
    if (!Array.isArray(all)) return [];
    const names = all.map(s => (typeof s === 'string' ? s : s.symbol)).filter(Boolean);
    return names.filter(s => /GOLD|XAU/i.test(s));
  } catch (e) {
    return [];
  }
}

async function getBrokerLiveTickPrice(regionUrl, token, accountId, symbol) {
  try {
    const encodedSym = encodeURIComponent(symbol);
    const res = await fetch(`${regionUrl}/users/current/accounts/${accountId}/symbols/${encodedSym}/current-price`, {
      headers: { 'auth-token': token }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.bid && data.ask) return { bid: Number(data.bid), ask: Number(data.ask), spread: Number((data.ask - data.bid).toFixed(4)) };
    return null;
  } catch (e) {
    return null;
  }
}

async function smartTradeWithSymbolFallback(regionUrl, token, accountId, basePayload, preferredSymbol) {
  const tradeUrl = `${regionUrl}/users/current/accounts/${accountId}/trade`;
  const brokerGoldList = await getBrokerGoldSymbols(regionUrl, token, accountId);

  const candidates = [];
  const addCand = (s) => { if (s && !candidates.includes(s)) candidates.push(s); };

  if (preferredSymbol) addCand(preferredSymbol);
  brokerGoldList.forEach(addCand);
  ['GOLD', 'GOLD#', 'GOLDmicro', 'GOLDm#', 'GOLD.', 'XAUUSD', 'XAUUSD#', 'XAUUSDm'].forEach(addCand);

  let lastResponse = null;
  let lastSymbolTried = preferredSymbol;

  for (const sym of candidates) {
    lastSymbolTried = sym;
    const res = await fetch(tradeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'auth-token': token },
      body: JSON.stringify({ ...basePayload, symbol: sym })
    });
    const data = await res.json();
    lastResponse = data;

    const errStr = `${data.stringCode || ''} ${data.message || ''}`.toUpperCase();
    if (res.ok && !errStr.includes('UNKNOWN SYMBOL') && !errStr.includes('INVALID_SYMBOL') && !errStr.includes('ERR_MARKET_UNKNOWN_SYMBOL')) {
      return { ok: true, data, workingSymbol: sym, brokerGoldList };
    }
  }

  return { ok: false, data: lastResponse, workingSymbol: lastSymbolTried, brokerGoldList };
}

async function userMetaApiRequest(userObj, payload) {
  const mt = userObj.metaApi;
  if (!mt || !mt.enabled || !mt.token || !mt.accountId) return null;
  try {
    if (!mt.regionUrl) mt.regionUrl = await resolveMetaApiRegionUrl(mt.token, mt.accountId);
    if (payload.symbol && /GOLD|XAU/i.test(payload.symbol)) {
      const result = await smartTradeWithSymbolFallback(mt.regionUrl, mt.token, mt.accountId, payload, payload.symbol);
      if (result.ok && result.workingSymbol !== mt.symbol) {
        mt.symbol = result.workingSymbol;
        await saveDB(db);
      }
      return result.data;
    }
    const res = await fetch(`${mt.regionUrl}/users/current/accounts/${mt.accountId}/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'auth-token': mt.token },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    return null;
  }
}

// === TAM EMİR AÇILIŞI (KATI BROKER STOPU) ===
async function openMobileMTTradeForAllUsers(tradeObj) {
  const isLong = tradeObj.direction === 'LONG';
  if (!tradeObj.userPositions) tradeObj.userPositions = {};
  const connected = (db.users || []).filter(u => u.metaApi && u.metaApi.enabled && u.metaApi.token && u.metaApi.accountId);

  const slDist = Math.abs(Number(tradeObj.entry) - Number(tradeObj.sl));
  const tp2Dist = Math.abs(Number(tradeObj.tp2) - Number(tradeObj.entry));
  const symbol = tradeObj.symbol || 'GOLD';

  await Promise.allSettled(connected.map(async (u) => {
    if (tradeObj.userPositions[u.username]) return;

    const mt = u.metaApi;
    if (!mt.regionUrl) mt.regionUrl = await resolveMetaApiRegionUrl(mt.token, mt.accountId);

    try {
      const posRes = await fetch(`${mt.regionUrl}/users/current/accounts/${mt.accountId}/positions`, {
        headers: { 'auth-token': mt.token }
      });
      if (posRes.ok) {
        const livePositions = await posRes.json();
        const hasOpenPosition = Array.isArray(livePositions) && livePositions.some(p => p.symbol === symbol || /GOLD|XAU|BTC/i.test(p.symbol));
        if (hasOpenPosition) return;
      }
    } catch (e) {}

    const lotSize = Math.max(0.01, Number(mt.lot) || 0.04);

    let calibratedEntry = Number(tradeObj.entry);
    let calibratedSL = Number(tradeObj.sl);
    let calibratedTP2 = Number(tradeObj.tp2);

    const liveTick = await getBrokerLiveTickPrice(mt.regionUrl, mt.token, mt.accountId, symbol);
    if (liveTick) {
      calibratedEntry = isLong ? liveTick.ask : liveTick.bid;
      calibratedSL = Number((isLong ? calibratedEntry - slDist : calibratedEntry + slDist).toFixed(2));
      calibratedTP2 = Number((isLong ? calibratedEntry + tp2Dist : calibratedEntry - tp2Dist).toFixed(2));
    }

    const res = await userMetaApiRequest(u, {
      actionType: isLong ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
      symbol,
      volume: Number(lotSize.toFixed(2)),
      stopLoss: calibratedSL,
      takeProfit: calibratedTP2,
      comment: `ALPHA_${symbol}_${u.username}`
    });

    if (res && (res.orderId || res.positionId)) {
      tradeObj.userPositions[u.username] = {
        positionId: res.positionId || res.orderId,
        volume: lotSize,
        symbol,
        xmEntry: calibratedEntry,
        xmTp2: calibratedTP2,
        xmSl: calibratedSL
      };
    }
  }));
  await saveDB(db);
}

// === TP1'DE %50 KISMİ KAPATMA VE STOPU GİRİŞE ÇEKME ===
async function partialCloseAllUsersMTAtTP1(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);

  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    const totalVol = Number(pos.volume || u.metaApi.lot || 0.04);
    const closeVol = Math.floor((totalVol / 2) * 100) / 100;
    const bePrice = Number(pos.xmEntry || tradeObj.entry);
    const tp2Price = Number(pos.xmTp2 || tradeObj.tp2);

    if (closeVol >= 0.01 && (totalVol - closeVol) >= 0.01) {
      try {
        await userMetaApiRequest(u, {
          actionType: 'POSITION_PARTIAL',
          positionId: String(pos.positionId),
          volume: Number(closeVol.toFixed(2))
        });
        pos.volume = Number((totalVol - closeVol).toFixed(2));
      } catch (err) {}
    }

    try {
      await userMetaApiRequest(u, {
        actionType: 'POSITION_MODIFY',
        positionId: String(pos.positionId),
        stopLoss: bePrice,
        takeProfit: tp2Price
      });
    } catch (err) {}
  }));
  await saveDB(db);
}

async function closeAllUsersMTTrade(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);
  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    await userMetaApiRequest(u, { actionType: 'POSITION_CLOSE_ID', positionId: String(pos.positionId) });
  }));
}

app.post('/api/close-active-trade', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    if (db.activeTrade) {
      const t = db.activeTrade;
      const isLong = t.direction === 'LONG';
      const curPrice = lastKnownSpot || t.currentPrice || t.entry;

      if (t.userPositions && t.userPositions[username]) {
        const pos = t.userPositions[username];
        await userMetaApiRequest(req.user, { actionType: 'POSITION_CLOSE_ID', positionId: String(pos.positionId) });
        delete t.userPositions[username];
      }

      const diff = Number((isLong ? curPrice - t.entry : t.entry - curPrice).toFixed(2));
      const resultType = diff >= 0 ? 'WIN' : 'LOSS';

      db.history.unshift({
        ...t,
        closePrice: curPrice,
        closeTime: getTRTime(),
        status: 'MANUEL KAPATILDI 🛑',
        result: resultType,
        profitDollar: diff
      });

      db.activeTrade = null;
      await saveDB(db);

      return res.json({ ok: true, message: 'İşlem başarıyla kapatıldı.' });
    }
    res.json({ ok: true, message: 'Açık bir işlem bulunamadı.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/clear-history', requireAdmin, async (req, res) => {
  try {
    db.history = [];
    await saveDB(db);
    res.json({ ok: true, message: 'Geçmiş işlemler ve istatistikler sıfırlandı.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/metaapi-config', requireAuth, async (req, res) => {
  const { token, accountId, symbol, lot } = req.body;
  const cleanToken = (token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
  const cleanAcc = (accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
  const regionUrl = cleanToken && cleanAcc ? await resolveMetaApiRegionUrl(cleanToken, cleanAcc) : '';

  let finalSymbol = (symbol || 'GOLD').trim();
  if (cleanToken && cleanAcc && regionUrl && /GOLD|XAU/i.test(finalSymbol)) {
    const goldList = await getBrokerGoldSymbols(regionUrl, cleanToken, cleanAcc);
    if (goldList.length > 0 && !goldList.includes(finalSymbol)) finalSymbol = goldList[0];
  }

  req.user.metaApi = {
    ...createDefaultMetaApi(),
    ...(req.user.metaApi || {}),
    token: cleanToken,
    accountId: cleanAcc,
    symbol: finalSymbol,
    lot: Math.max(0.01, Number(lot) || 0.04),
    regionUrl,
    enabled: Boolean(cleanToken && cleanAcc)
  };
  await saveDB(db);
  res.json({ ok: true, enabled: req.user.metaApi.enabled, symbol: req.user.metaApi.symbol, lot: req.user.metaApi.lot, regionUrl });
});

app.post('/api/update-lot', requireAuth, async (req, res) => {
  const { lot, balance, riskPct } = req.body;
  if (!req.user.metaApi) req.user.metaApi = createDefaultMetaApi();
  if (lot) req.user.metaApi.lot = Math.max(0.01, Number(lot));
  if (balance) req.user.metaApi.balance = Number(balance);
  if (riskPct) req.user.metaApi.riskPct = Number(riskPct);
  await saveDB(db);
  res.json({ ok: true, lot: req.user.metaApi.lot });
});

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcRSISeries(closes, period = 14) {
  if (closes.length <= period) return [50];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  const rsiSeries = [];
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiSeries.push(100 - 100 / (1 + rs));
  }
  return rsiSeries.length ? rsiSeries : [50];
}

function calcStochRSI(closes, period = 14) {
  const rsiSeries = calcRSISeries(closes, period);
  if (rsiSeries.length < period) return 50;
  const recent = rsiSeries.slice(-period);
  const minRSI = Math.min(...recent), maxRSI = Math.max(...recent);
  return maxRSI === minRSI ? 50 : ((rsiSeries[rsiSeries.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function calcATR(candles, period = 14) {
  if (candles.length <= period) return 2.5;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

function calcVWAP(candles) {
  const slice = candles.slice(-60);
  let cumPV = 0, cumVol = 0;
  for (const c of slice) {
    const vol = c.volume || 1;
    cumPV += ((c.high + c.low + c.close) / 3) * vol;
    cumVol += vol;
  }
  return cumVol === 0 ? slice[slice.length - 1].close : cumPV / cumVol;
}

function calcBollingerBands(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    middle: sma,
    upper: Number((sma + multiplier * stdDev).toFixed(2)),
    lower: Number((sma - multiplier * stdDev).toFixed(2))
  };
}

function getSwingLevels(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  const support = Math.min(...recent.map(c => c.low));
  const resistance = Math.max(...recent.map(c => c.high));
  return { support, resistance };
}

// === DAR VE NET STOP HESAPLAYICI (MAKSİMUM 2.60$) ===
function calculateSmartTradePlan(spotPrice, isShort, m5Atr, instrumentName = 'GOLD') {
  const session = getMarketSession();
  const maxSL = session.instrument.maxSlDist || 2.60;
  const tp1Dist = session.instrument.tp1Dist || 2.80;
  const tp2Dist = session.instrument.tp2Dist || 5.50;

  return {
    entry: spotPrice.toFixed(2),
    sl: (!isShort ? spotPrice - maxSL : spotPrice + maxSL).toFixed(2),
    tp1: (!isShort ? spotPrice + tp1Dist : spotPrice - tp1Dist).toFixed(2),
    tp2: (!isShort ? spotPrice + tp2Dist : spotPrice - tp2Dist).toFixed(2),
    slDollar: maxSL.toFixed(2),
    tp1Dollar: tp1Dist.toFixed(2),
    tp2Dollar: tp2Dist.toFixed(2)
  };
}

// === %90 BAŞARI MOTORU: YÜKSEK OLASILIKLI TEPE/DİP KİLİDİ ===
function computeSignalScore(m5, m15, h1, dxyChange15m, m5Candles, bb, swingM15, spotPrice, isWeekend = false) {
  const reasons = [];
  if (!bb || !m5Candles || m5Candles.length < 3) return { score: 0, reasons };

  const curC = m5Candles[m5Candles.length - 1];
  const prevC = m5Candles[m5Candles.length - 2];

  // 1) DİP KOŞULU (A+ SETUP):
  // Fiyat Bollinger alt bandının dışına taşmış veya M15 desteğine değmiş + StochRSI < 20 + RSI < 32 + Yeşil dönüş mumu
  const atDipBoundary = prevC.low <= bb.lower || curC.low <= bb.lower || Math.abs(spotPrice - swingM15.support) <= m5.atr * 0.5;
  const isExtremeOversold = m5.stochRsi <= 20 && m5.rsi <= 35;
  const isBullishReversalCandle = curC.close > curC.open && (curC.close - curC.low) > (curC.high - curC.low) * 0.40;

  if (atDipBoundary && isExtremeOversold && isBullishReversalCandle) {
    reasons.push({ type: 'pos', text: `💎 %90 DİP ONAYI: Alt bant delindi + Çift osilatör aşırı satımda (RSI: ${m5.rsi.toFixed(1)}, Stoch: ${m5.stochRsi.toFixed(1)}) + Alıcı fitili belirdi.` });
    return { score: 75, reasons };
  }

  // 2) TEPE KOŞULU (A+ SETUP):
  // Fiyat Bollinger üst bandını aşmış veya M15 direncine değmiş + StochRSI > 80 + RSI > 68 + Kırmızı dönüş mumu
  const atCeilBoundary = prevC.high >= bb.upper || curC.high >= bb.upper || Math.abs(swingM15.resistance - spotPrice) <= m5.atr * 0.5;
  const isExtremeOverbought = m5.stochRsi >= 80 && m5.rsi >= 65;
  const isBearishReversalCandle = curC.close < curC.open && (curC.high - curC.close) > (curC.high - curC.low) * 0.40;

  if (atCeilBoundary && isExtremeOverbought && isBearishReversalCandle) {
    reasons.push({ type: 'neg', text: `💎 %90 TEPE ONAYI: Üst bant zorlandı + Çift osilatör aşırı alımda (RSI: ${m5.rsi.toFixed(1)}, Stoch: ${m5.stochRsi.toFixed(1)}) + Satıcı fitili belirdi.` });
    return { score: -75, reasons };
  }

  return { score: 0, reasons: [{ type: 'warn', text: '⏳ A+ KURULUM BEKLENİYOR: Aşırı doygunluk ve bant dışı fitil oluşmadı.' }] };
}

async function getGoldNewsSentiment() {
  const now = Date.now();
  if (newsCache.data && now - newsCache.timestamp < 180000) return newsCache.data;
  return { sentimentScore: 0, summary: 'NORMAL AKIŞ', headlines: [] };
}

async function getEconomicCalendar() {
  const now = Date.now();
  if (calendarCache.data && now - calendarCache.timestamp < 300000) return calendarCache.data;
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const events = await res.json();
    const usdEvents = events.filter(e => e.country === 'USD' && e.impact === 'High').map(e => {
      const d = new Date(e.date);
      return { title: e.title, impact: e.impact, timeStr: getTRTime(d, false), diffMinutes: Math.round((d.getTime() - now) / 60000) };
    }).filter(e => e.diffMinutes >= -45 && e.diffMinutes <= 45);

    const activeDanger = usdEvents.length > 0;
    const result = { killSwitch: activeDanger, upcomingEvents: usdEvents };
    calendarCache = { timestamp: now, data: result };
    return result;
  } catch (e) {
    return { killSwitch: false, upcomingEvents: [] };
  }
}

async function getLivePriceData(tvSymbol) {
  try {
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: { tickers: [tvSymbol, 'TVC:DXY', 'TVC:US10Y'] }, columns: ['close', 'change', 'change|5', 'change|15', 'high', 'low'] })
    });
    const json = await res.json();
    const map = {};
    if (json && json.data) json.data.forEach(i => { map[i.s] = { price: i.d[0], changeDaily: i.d[1], change5m: i.d[2], change15m: i.d[3] }; });
    return map;
  } catch (e) { return {}; }
}

async function getCandles(symbol, interval, range) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const r = data.chart.result[0], q = r.indicators.quote[0], ts = r.timestamp || [];
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] != null && q.high[i] != null && q.low[i] != null) {
      candles.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 100 });
    }
  }
  return candles;
}

function analyzeTimeframe(candles) {
  const closes = candles.map(c => c.close), price = closes[closes.length - 1];
  const ema9 = calcEMA(closes, 9), ema21 = calcEMA(closes, 21), ema50 = calcEMA(closes, 50);
  const rsiSeries = calcRSISeries(closes, 14), rsi = rsiSeries[rsiSeries.length - 1];
  const stochRsi = calcStochRSI(closes, 14);
  const atr = calcATR(candles, 14), vwap = calcVWAP(candles);
  let trend = 'NÖTR';
  if (ema9 > ema21 && price > ema21) trend = 'BULLISH (YÜKSELİŞ)';
  else if (ema9 < ema21 && price < ema21) trend = 'BEARISH (DÜŞÜŞ)';
  return { price, ema9, ema21, ema50, rsi, stochRsi, atr, vwap, trend };
}

async function checkActiveTradeOnTick(spotPrice) {
  if (!db.activeTrade || !spotPrice) return null;
  let soundEvent = null;
  const t = db.activeTrade, isLong = t.direction === 'LONG';
  t.currentPrice = spotPrice;
  t.unrealizedPnL = Number((isLong ? spotPrice - t.entry : t.entry - spotPrice).toFixed(2));

  // TP2
  if ((isLong && spotPrice >= t.tp2) || (!isLong && spotPrice <= t.tp2)) {
    const profit = Number(Math.abs(t.tp2 - t.entry).toFixed(2));
    await closeAllUsersMTTrade(t);
    db.history.unshift({ ...t, closePrice: spotPrice, closeTime: getTRTime(), status: 'TP2 TAM HEDEF VURULDU 🎯', result: 'WIN', profitDollar: profit });
    db.activeTrade = null;
    await saveDB(db);
    return 'TP_HIT';
  }

  // TP1
  if (!t.tp1Hit && ((isLong && spotPrice >= t.tp1) || (!isLong && spotPrice <= t.tp1))) {
    t.tp1Hit = true; 
    t.sl = t.entry;
    await saveDB(db);
    await partialCloseAllUsersMTAtTP1(t);
    soundEvent = 'TP_HIT';
  }

  // STOP LOSS
  if ((isLong && spotPrice <= t.sl) || (!isLong && spotPrice >= t.sl)) {
    let profit = -Number(Math.abs(t.entry - t.sl).toFixed(2));
    let statusText = 'STOP OLDU ❌';
    let resultType = 'LOSS';

    if (t.tp1Hit) {
      profit = Number((Math.abs(t.tp1 - t.entry) * 0.5).toFixed(2));
      statusText = 'TP1 ALINDI + KALAN BAŞABAŞ 🛡️';
      resultType = 'WIN';
      soundEvent = 'TP_HIT';
    } else {
      soundEvent = 'SL_HIT';
      db.lastStopTimestamp = Date.now();
    }

    await closeAllUsersMTTrade(t);
    db.history.unshift({ ...t, closePrice: spotPrice, closeTime: getTRTime(), status: statusText, result: resultType, profitDollar: profit });
    db.activeTrade = null;
    await saveDB(db);
  }

  return soundEvent;
}

function getStats() {
  const total = db.history.length, wins = db.history.filter(h => h.result === 'WIN').length;
  const totalProfit = db.history.reduce((acc, h) => acc + (Number(h.profitDollar) || 0), 0);
  return { total, wins, losses: total - wins, winRate: total > 0 ? Math.round((wins / total) * 100) : 0, totalProfit: totalProfit.toFixed(2) };
}

async function executeFullAnalysisEngine(currentUser = null) {
  await syncFromFirebase();
  const session = getMarketSession();
  const currentInstrument = session.instrument;

  const [tvMap, rawM5, rawM15, rawH1, newsData, calendarData] = await Promise.all([
    getLivePriceData(currentInstrument.tvSym),
    getCandles(currentInstrument.yahooSym, '5m', '5d'),
    getCandles(currentInstrument.yahooSym, '15m', '5d'),
    getCandles(currentInstrument.yahooSym, '1h', '1mo'),
    getGoldNewsSentiment(),
    getEconomicCalendar()
  ]);

  const oandaData = tvMap[currentInstrument.tvSym];
  const dxyData = tvMap['TVC:DXY'] || { price: 0, change15m: 0 };
  const lastRawClose = rawM5[rawM5.length - 1].close;
  const spotPrice = oandaData && oandaData.price ? oandaData.price : lastRawClose;
  lastKnownSpot = spotPrice;
  const offset = spotPrice - lastRawClose;
  const calibrate = (list) => list.map(c => ({ ...c, open: c.open + offset, high: c.high + offset, low: c.low + offset, close: c.close + offset }));

  const calM5 = calibrate(rawM5), calM15 = calibrate(rawM15), calH1 = calibrate(rawH1);
  const m5 = analyzeTimeframe(calM5), m15 = analyzeTimeframe(calM15), h1 = analyzeTimeframe(calH1);

  const bb = calcBollingerBands(calM5.map(c => c.close), 20, 2);
  const swingM15 = getSwingLevels(calM15, 20);

  const { score, reasons } = computeSignalScore(m5, m15, h1, dxyData.change15m || 0, calM5, bb, swingM15, spotPrice, session.isWeekend);

  const stopCooldownActive = Boolean(db.lastStopTimestamp && (Date.now() - db.lastStopTimestamp < 35 * 60 * 1000));

  let signal = '⏳ BEKLE (A+ KURULUM ARANIYOR)', direction = 'NEUTRAL';
  if (!session.isWeekend && calendarData.killSwitch) { signal = '⛔ VERİ SAATİ KİLİDİ (45 DK)'; direction = 'LOCKED'; }
  else if (stopCooldownActive) {
    const remainMin = Math.ceil((35 * 60 * 1000 - (Date.now() - db.lastStopTimestamp)) / 60000);
    signal = `🛑 STOP SONRASI BEKLEME (${remainMin} DK)`; direction = 'LOCKED';
  }
  else if (score >= 70) { signal = `🟢 ${currentInstrument.name} DİPTEN LONG GİR (%90)`; direction = 'LONG'; }
  else if (score <= -70) { signal = `🔴 ${currentInstrument.name} TEPEDEN SHORT GİR (%90)`; direction = 'SHORT'; }

  const tradePlan = calculateSmartTradePlan(spotPrice, score < 0, m5.atr, currentInstrument.name);
  let soundEvent = await checkActiveTradeOnTick(spotPrice);

  if (!db.activeTrade && !isOpeningTradeLock && !(session.isWeekend ? false : calendarData.killSwitch) && !stopCooldownActive && Math.abs(score) >= 70) {
    isOpeningTradeLock = true;
    try {
      const dir = score > 0 ? 'LONG' : 'SHORT';
      db.activeTrade = {
        id: Date.now(), openTime: getTRTime(), direction: dir, score, symbol: currentInstrument.brokerSym,
        entry: Number(tradePlan.entry), currentPrice: spotPrice, sl: Number(tradePlan.sl), initialSl: Number(tradePlan.sl),
        tp1: Number(tradePlan.tp1), tp2: Number(tradePlan.tp2), tp1Hit: false, unrealizedPnL: 0, userPositions: {}
      };
      await saveDB(db);
      soundEvent = 'NEW_SIGNAL';
      await openMobileMTTradeForAllUsers(db.activeTrade);
    } finally {
      isOpeningTradeLock = false;
    }
  }

  const userMt = currentUser && currentUser.metaApi ? currentUser.metaApi : createDefaultMetaApi();
  return {
    timestamp: getTRTime(), spotPrice: spotPrice.toFixed(2), score, signal, direction, tradePlan, reasons,
    currentMarket: currentInstrument.name, isWeekendMode: session.isWeekend,
    timeframes: { m5, m15, h1 }, macro: { dxy: dxyData }, news: newsData, calendar: calendarData,
    tracker: { activeTrade: db.activeTrade, history: db.history.slice(0, 15), stats: getStats(), soundEvent, metaApiEnabled: Boolean(userMt.enabled), metaSymbol: currentInstrument.brokerSym, userLot: userMt.lot || 0.04 }
  };
}

app.get('/api/cron', async (req, res) => {
  try {
    const r = await executeFullAnalysisEngine(null);
    if (db.activeTrade) {
      for (let step = 0; step < 3; step++) {
        await new Promise(resolve => setTimeout(resolve, 2300));
        const session = getMarketSession();
        const tvMap = await getLivePriceData(session.instrument.tvSym);
        const data = tvMap[session.instrument.tvSym];
        if (data && data.price) await checkActiveTradeOnTick(data.price);
        if (!db.activeTrade) break;
      }
    }
    res.json({ ok: true, time: getTRTime(), spotPrice: r.spotPrice, score: r.score, signal: r.signal, activeTrade: Boolean(db.activeTrade) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const hours = Number(req.query.hours) || 24, mode = req.query.mode || 'today';
    const [tvMap, rawM5, rawM15, rawH1] = await Promise.all([
      getLivePriceData('OANDA:XAUUSD'), getCandles('GC=F', '5m', '5d'), getCandles('GC=F', '15m', '1mo'), getCandles('GC=F', '1h', '1mo')
    ]);
    const oandaData = tvMap['OANDA:XAUUSD'], lastRawClose = rawM5[rawM5.length - 1].close;
    const spotPrice = oandaData && oandaData.price ? oandaData.price : lastRawClose, offset = spotPrice - lastRawClose;
    const calibrate = (list) => list.map(c => ({ ...c, open: c.open + offset, high: c.high + offset, low: c.low + offset, close: c.close + offset }));
    const calM5 = calibrate(rawM5), calM15 = calibrate(rawM15), calH1 = calibrate(rawH1);

    const nowSec = Math.floor(Date.now() / 1000);
    let startTimestampSec = nowSec - hours * 3600;
    if (mode === 'today') {
      const trOffsetSec = 3 * 3600, nowTrSec = nowSec + trOffsetSec;
      startTimestampSec = nowTrSec - (nowTrSec % 86400) - trOffsetSec;
    }

    let simActive = null, lastStopCandleIndex = -99;
    const simTrades = [];

    for (let i = 30; i < calM5.length; i++) {
      const c = calM5[i];
      if (c.time < startTimestampSec) continue;
      const dObj = new Date(c.time * 1000), timeStr = getTRTime(dObj, false), dateStr = getTRDate(dObj);

      if (simActive) {
        const isLong = simActive.direction === 'LONG';
        if ((isLong && c.low <= simActive.sl) || (!isLong && c.high >= simActive.sl)) {
          let profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(2));
          let status = 'STOP OLDU ❌';
          let result = 'LOSS';
          if (simActive.tp1Hit) {
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.5).toFixed(2));
            status = 'TP1 ALINDI + KALAN BAŞABAŞ 🛡️';
            result = 'WIN';
          } else {
            lastStopCandleIndex = i;
          }
          simTrades.push({ ...simActive, closeTime: `${dateStr} ${timeStr}`, closePrice: simActive.sl.toFixed(2), status, result, profitDollar: profit });
          simActive = null; 
          continue;
        }
        if ((isLong && c.high >= simActive.tp2) || (!isLong && c.low <= simActive.tp2)) {
          const profit = Number(Math.abs(simActive.tp2 - simActive.entry).toFixed(2));
          simTrades.push({ ...simActive, closeTime: `${dateStr} ${timeStr}`, closePrice: simActive.tp2.toFixed(2), status: 'TP2 TAM HEDEF VURULDU 🎯', result: 'WIN', profitDollar: profit });
          simActive = null; 
          continue;
        }
        if (!simActive.tp1Hit && ((isLong && c.high >= simActive.tp1) || (!isLong && c.low <= simActive.tp1))) {
          simActive.tp1Hit = true;
          simActive.sl = simActive.entry;
        }
        continue;
      }

      if (i - lastStopCandleIndex < 7) continue;

      const m5Slice = calM5.slice(Math.max(0, i - 60), i + 1);
      const m15Slice = calM15.filter(x => x.time <= c.time).slice(-60);
      const h1Slice = calH1.filter(x => x.time <= c.time).slice(-60);
      if (m15Slice.length < 20 || h1Slice.length < 20) continue;

      const m5 = analyzeTimeframe(m5Slice), m15 = analyzeTimeframe(m15Slice), h1 = analyzeTimeframe(h1Slice);
      const bbSim = calcBollingerBands(m5Slice.map(x => x.close), 20, 2);
      const swingSim = getSwingLevels(m15Slice, 20);

      const { score } = computeSignalScore(m5, m15, h1, 0, m5Slice, bbSim, swingSim, c.close, false);
      if (Math.abs(score) >= 70) {
        const isShort = score < 0, plan = calculateSmartTradePlan(c.close, isShort, m5.atr, 'GOLD');
        simActive = { openTime: `${dateStr} ${timeStr}`, direction: isShort ? 'SHORT' : 'LONG', score, entry: Number(plan.entry), sl: Number(plan.sl), tp1: Number(plan.tp1), tp2: Number(plan.tp2), tp1Hit: false };
      }
    }

    if (simActive) {
      const isLong = simActive.direction === 'LONG', liveDiff = Number((isLong ? spotPrice - simActive.entry : simActive.entry - spotPrice).toFixed(2));
      simTrades.push({ ...simActive, closeTime: 'HALEN AÇIK ⏳', closePrice: spotPrice.toFixed(2), status: 'AÇIK İŞLEM ⏳', result: liveDiff >= 0 ? 'WIN' : 'OPEN', profitDollar: liveDiff });
    }

    const closed = simTrades.filter(t => t.closeTime !== 'HALEN AÇIK ⏳');
    const wins = closed.filter(t => t.result === 'WIN').length;
    const losses = closed.filter(t => t.result === 'LOSS').length;
    const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;
    const totalProfit = simTrades.reduce((acc, t) => acc + (Number(t.profitDollar) || 0), 0);
    
    res.json({ totalSignals: simTrades.length, closedCount: closed.length, wins, losses, winRate, totalProfit: totalProfit.toFixed(2), trades: simTrades.reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tick', requireAuth, async (req, res) => {
  try {
    const session = getMarketSession();
    const currentInstrument = session.instrument;
    const tvMap = await getLivePriceData(currentInstrument.tvSym);
    const spotPrice = tvMap[currentInstrument.tvSym] && tvMap[currentInstrument.tvSym].price ? tvMap[currentInstrument.tvSym].price : lastKnownSpot;
    if (spotPrice) lastKnownSpot = spotPrice;
    const soundEvent = await checkActiveTradeOnTick(spotPrice);
    const userMt = req.user.metaApi || createDefaultMetaApi();
    res.json({ timestamp: getTRTime(), spotPrice: spotPrice ? spotPrice.toFixed(2) : null, currentMarket: currentInstrument.name, tracker: { activeTrade: db.activeTrade, history: db.history.slice(0, 15), stats: getStats(), soundEvent, metaApiEnabled: Boolean(userMt.enabled), metaSymbol: currentInstrument.brokerSym, userLot: userMt.lot || 0.04 } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/analyze', requireAuth, async (req, res) => {
  try { res.json(await executeFullAnalysisEngine(req.user)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/telegram-config', requireAdmin, async (req, res) => {
  const { botToken, chatId } = req.body;
  db.telegram = { botToken: (botToken || '').trim(), chatId: (chatId || '').trim(), enabled: Boolean(botToken && chatId) };
  await saveDB(db);
  res.json({ ok: true, enabled: db.telegram.enabled });
});

app.listen(PORT, '0.0.0.0', () => console.log(`👑 XAU/USD & WEEKEND BTC Sunucu Aktif: Port ${PORT}`));
module.exports = app;
