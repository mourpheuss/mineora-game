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
    lastStopDirection: null,
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
  if (!parsed.lastStopDirection) parsed.lastStopDirection = null;
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
        tp1Dist: 350,
        tp2Dist: 750,
        maxSlDist: 350,
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
      tp1Dist: 3.20,
      tp2Dist: 7.00,
      maxSlDist: 4.20, // Güvenli tavan stopu
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

// --- METATRADER KÖPRÜSÜ VE SEMBOL EŞLEŞTİRME ---
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
    return all.map(s => (typeof s === 'string' ? s : s.symbol)).filter(s => /GOLD|XAU/i.test(s));
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
        const hasOpen = Array.isArray(livePositions) && livePositions.some(p => p.symbol === symbol || /GOLD|XAU|BTC/i.test(p.symbol));
        if (hasOpen) return;
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
      comment: `XAU_PRO_${u.username}`
    });

    if (res && (res.orderId || res.positionId)) {
      tradeObj.userPositions[u.username] = {
        positionId: res.positionId || res.orderId,
        volume: lotSize,
        symbol,
        entry: calibratedEntry
      };
    }
  }));
  await saveDB(db);
}

// === ORİJİNAL %60 ERKEN ZIRH: STOPU GİRİŞE ÇEKME ===
async function moveAllUsersMTToBreakeven(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);

  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    await userMetaApiRequest(u, {
      actionType: 'POSITION_MODIFY',
      positionId: String(pos.positionId),
      stopLoss: Number(pos.entry || tradeObj.entry),
      takeProfit: Number(tradeObj.tp2)
    });
  }));
}

// === ORİJİNAL %80 TP1 KÂR ALMA ===
async function partialCloseAllUsersMTAtTP1(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);

  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    const totalVol = Number(pos.volume || u.metaApi.lot || 0.04);
    const closeVol = Math.floor(totalVol * 0.80 * 100) / 100;

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
        stopLoss: Number(pos.entry || tradeObj.entry),
        takeProfit: Number(tradeObj.tp2)
      });
    } catch (err) {}
  }));
  await saveDB(db);
}

// === İŞLEMİ KAPATMA ===
async function closeAllUsersMTTrade(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);
  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    await userMetaApiRequest(u, { actionType: 'POSITION_CLOSE_ID', positionId: String(pos.positionId) });
  }));
}

// === KULLANICIYA ÖZEL MANUEL KAPATMA ===
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

      const remainingUsers = Object.keys(t.userPositions || {}).length;
      if (username.toLowerCase() === 'admin' || remainingUsers === 0) {
        if (remainingUsers > 0) await closeAllUsersMTTrade(t);
        const diff = Number((isLong ? curPrice - t.entry : t.entry - curPrice).toFixed(2));
        db.history.unshift({
          ...t,
          closePrice: curPrice,
          closeTime: getTRTime(),
          status: 'MANUEL KAPATILDI 🛑',
          result: diff >= 0 ? 'WIN' : 'LOSS',
          profitDollar: diff
        });
        db.activeTrade = null;
      }

      await saveDB(db);
      return res.json({ ok: true, message: 'İşleminiz başarıyla kapatıldı.' });
    }
    res.json({ ok: true, message: 'Açık işlem bulunamadı.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/clear-history', requireAdmin, async (req, res) => {
  db.history = [];
  await saveDB(db);
  res.json({ ok: true });
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
  res.json({ ok: true, enabled: req.user.metaApi.enabled, symbol: req.user.metaApi.symbol, lot: req.user.metaApi.lot });
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

app.post('/api/metaapi-test', requireAuth, async (req, res) => {
  try {
    const token = (req.body.token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
    const accountId = (req.body.accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
    if (!token || !accountId) return res.status(400).json({ ok: false, error: 'Lütfen önce Token ve Account ID girin.' });

    const provRes = await fetch(`https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${accountId}`, {
      headers: { 'auth-token': token }
    });
    if (!provRes.ok) return res.status(400).json({ ok: false, error: 'Token veya Account ID hatalı!' });

    const provData = await provRes.json();
    const regionUrl = `https://mt-client-api-v1.${provData.region || 'london'}.agiliumtrade.ai`;

    const infoRes = await fetch(`${regionUrl}/users/current/accounts/${accountId}/account-information`, {
      headers: { 'auth-token': token }
    });
    const info = await infoRes.json();
    res.json({
      ok: true,
      broker: info.broker || provData.server || 'MetaTrader',
      login: info.login || provData.login || '-',
      name: info.name || provData.name || '-',
      balance: info.balance,
      equity: info.equity,
      connectionStatus: provData.connectionStatus || 'CONNECTED'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/metaapi-test-trade', requireAuth, async (req, res) => {
  try {
    const token = (req.body.token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
    const accountId = (req.body.accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
    const symbol = (req.body.symbol || (req.user.metaApi ? req.user.metaApi.symbol : 'GOLD')).trim();
    if (!token || !accountId) return res.status(400).json({ ok: false, error: 'Lütfen bilgileri kaydedin.' });

    const regionUrl = await resolveMetaApiRegionUrl(token, accountId);
    const attempt = await smartTradeWithSymbolFallback(
      regionUrl, token, accountId,
      { actionType: 'ORDER_TYPE_BUY', volume: 0.01, comment: 'TEST' },
      symbol
    );
    if (!attempt.ok) return res.status(400).json({ ok: false, error: 'Test emri açılamadı.' });

    const posId = attempt.data.positionId || attempt.data.orderId;
    if (posId) {
      setTimeout(async () => {
        await fetch(`${regionUrl}/users/current/accounts/${accountId}/trade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'auth-token': token },
          body: JSON.stringify({ actionType: 'POSITION_CLOSE_ID', positionId: String(posId) })
        }).catch(() => {});
      }, 3000);
    }
    res.json({ ok: true, message: `0.01 Lot ${attempt.workingSymbol} test işlemi açıldı ve kapatıldı!` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- TEKNİK HESAPLAMA MOTORLARI (EMA, RSI, STOCH, ATR, VWAP, CCI, SMC) ---
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

function calcADX(candles, period = 14) {
  if (candles.length <= period * 2) return 20;
  let trSmooth = 0, pdmSmooth = 0, mdmSmooth = 0;
  const dxs = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    const pdm = upMove > downMove && upMove > 0 ? upMove : 0;
    const mdm = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    if (i <= period) { trSmooth += tr; pdmSmooth += pdm; mdmSmooth += mdm; }
    else {
      trSmooth = trSmooth - trSmooth / period + tr;
      pdmSmooth = pdmSmooth - pdmSmooth / period + pdm;
      mdmSmooth = mdmSmooth - mdmSmooth / period + mdm;
      const pdi = trSmooth === 0 ? 0 : (pdmSmooth / trSmooth) * 100;
      const mdi = trSmooth === 0 ? 0 : (mdmSmooth / trSmooth) * 100;
      dxs.push(pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100);
    }
  }
  return dxs.length === 0 ? 20 : dxs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, dxs.length);
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

// === BOLLINGER BANTLARI ===
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

// === COMMODITY CHANNEL INDEX (CCI) ===
function calcCCI(candles, period = 14) {
  if (candles.length < period) return 0;
  const typicals = candles.map(c => (c.high + c.low + c.close) / 3);
  const slice = typicals.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const meanDeviation = slice.reduce((acc, val) => acc + Math.abs(val - sma), 0) / period;
  const curTP = typicals[typicals.length - 1];
  return meanDeviation === 0 ? 0 : (curTP - sma) / (0.015 * meanDeviation);
}

// === SMC SMART MONEY / SWING SEVİYELERİ ===
function getSwingStructure(candles, lookback = 20) {
  const slice = candles.slice(-lookback);
  const support = Math.min(...slice.map(c => c.low));
  const resistance = Math.max(...slice.map(c => c.high));
  return { support, resistance };
}

// === İĞNE KORUMALI DİNAMİK STOP VE HEDEF PLANI (WICK PROTECTION) ===
function calculateSmartTradePlan(spotPrice, isShort, m5Candles, m5Atr, sr) {
  const session = getMarketSession();
  const maxSL = session.instrument.maxSlDist || 4.20;
  const tp1Dist = session.instrument.tp1Dist || 3.20;
  const tp2Dist = session.instrument.tp2Dist || 7.00;

  // Son 6 mumun en uç iğnesi
  const recent = m5Candles.slice(-6);
  const localLow = Math.min(...recent.map(c => c.low));
  const localHigh = Math.max(...recent.map(c => c.high));
  const buffer = Math.max(0.60, m5Atr * 0.25);

  let slDist;
  if (!isShort) {
    const rawDist = spotPrice - (localLow - buffer);
    slDist = Math.max(2.80, Math.min(maxSL, rawDist));
  } else {
    const rawDist = (localHigh + buffer) - spotPrice;
    slDist = Math.max(2.80, Math.min(maxSL, rawDist));
  }

  return {
    entry: spotPrice.toFixed(2),
    sl: (!isShort ? spotPrice - slDist : spotPrice + slDist).toFixed(2),
    tp1: (!isShort ? spotPrice + tp1Dist : spotPrice - tp1Dist).toFixed(2),
    tp2: (!isShort ? spotPrice + tp2Dist : spotPrice - tp2Dist).toFixed(2),
    slDollar: slDist.toFixed(2),
    tp1Dollar: tp1Dist.toFixed(2),
    tp2Dollar: tp2Dist.toFixed(2)
  };
}

// === 4 KATMANLI KURUMSAL TEYİT & TETİKLEYİCİ MOTORU ===
function computeSignalScore(m5, m15, h1, dxyChange15m, us10yChange15m, newsScore, m5Candles, bb, sr, cci) {
  let score = 0;
  const reasons = [];

  const curPrice = m5.price;
  const curC = m5Candles[m5Candles.length - 1];
  const prevC = m5Candles[m5Candles.length - 2];

  // KATMAN 1: BÖLGE TESPİTİ (SMC Destek/Direnç veya Bollinger Band Alanı)
  const atSupport = (bb && (curPrice <= bb.lower || prevC.low <= bb.lower)) || (sr && Math.abs(curPrice - sr.support) <= m5.atr * 0.7);
  const atResistance = (bb && (curPrice >= bb.upper || prevC.high >= bb.upper)) || (sr && Math.abs(sr.resistance - curPrice) <= m5.atr * 0.7);

  // KATMAN 2: MOMENTUM FİLTRESİ (StochRSI + CCI)
  const stochDip = m5.stochRsi <= 35;
  const stochTepe = m5.stochRsi >= 65;
  const cciOversold = cci <= -80;
  const cciOverbought = cci >= 80;

  // KATMAN 3: TETİKLEYİCİ DÖNÜŞ MUMU (İğne Bırakma / Gövde Onayı)
  const candleRange = Math.max(0.1, curC.high - curC.low);
  const isLowerWick = (Math.min(curC.open, curC.close) - curC.low) >= candleRange * 0.35; // %35 alttan iğne
  const isUpperWick = (curC.high - Math.max(curC.open, curC.close)) >= candleRange * 0.35; // %35 üstten iğne
  const bullEngulf = curC.close > curC.open && curC.close >= prevC.high;
  const bearEngulf = curC.close < curC.open && curC.close <= prevC.low;

  const triggerBull = (curC.close > curC.open && (isLowerWick || bullEngulf));
  const triggerBear = (curC.close < curC.open && (isUpperWick || bearEngulf));

  // === DİP LONG DEĞERLENDİRMESİ ===
  if (atSupport && stochDip && (cciOversold || cci <= -50) && triggerBull) {
    score += 55;
    reasons.push({ type: 'pos', text: `🎯 KURUMSAL DİP TETİĞİ: Destek/Alt bant test edildi + Stoch & CCI aşırı satımda + Alıcı fitili belirdi.` });
  }

  // === TEPE SHORT DEĞERLENDİRMESİ ===
  if (atResistance && stochTepe && (cciOverbought || cci >= 50) && triggerBear) {
    score -= 55;
    reasons.push({ type: 'neg', text: `🎯 KURUMSAL TEPE TETİĞİ: Direnç/Üst bant reddedildi + Stoch & CCI aşırı alımda + Satıcı fitili belirdi.` });
  }

  // H1 ve M15 Trend Desteği
  if (h1.price > h1.ema21 && m15.price > m15.ema21) {
    score += 15;
    reasons.push({ type: 'pos', text: 'Ana Trend Pozitif (H1 & M15 EMA21 üzerinde)' });
  } else if (h1.price < h1.ema21 && m15.price < m15.ema21) {
    score -= 15;
    reasons.push({ type: 'neg', text: 'Ana Trend Negatif (H1 & M15 EMA21 altında)' });
  }

  // Kurumsal VWAP
  if (curPrice > m5.vwap) score += 10;
  else score -= 10;

  // DXY Makro Desteği
  if (dxyChange15m < -0.02) score += 10;
  else if (dxyChange15m > 0.02) score -= 10;

  if (newsScore !== 0) score += newsScore;

  // Bıçak Tutma / FOMO Bariyeri: Kırmızı çöken mumda LONG, yeşil fırlayan mumda SHORT engellenir
  if (score > 0 && curC.close < curC.open) {
    score = 0;
    reasons.push({ type: 'warn', text: 'Düşen Bıçak Koruması: M5 mumu kırmızıyla kapandığı için LONG ertelendi.' });
  } else if (score < 0 && curC.close > curC.open) {
    score = 0;
    reasons.push({ type: 'warn', text: 'Yükselen Dalga Koruması: M5 mumu yeşille kapandığı için SHORT ertelendi.' });
  }

  return { score: Math.max(-100, Math.min(100, score)), reasons };
}

const BULLISH_RULES = [
  { words: ['rate cut', 'dovish', 'cuts rates', 'fed cut', 'lower rates'], weight: 4, tag: 'Güvercin FED' },
  { words: ['war', 'missile', 'attack', 'middle east', 'israel', 'iran', 'ukraine', 'geopolitical', 'tensions', 'tariff'], weight: 4, tag: 'Jeopolitik Risk' },
  { words: ['safe haven', 'central bank buying', 'gold surges', 'gold rallies', 'record high', 'gold climbs', 'bullish'], weight: 3, tag: 'Altın Talebi' },
  { words: ['weak dollar', 'dollar falls', 'dollar drops', 'yields fall', 'inflation cools', 'recession'], weight: 3, tag: 'Zayıf Dolar' }
];
const BEARISH_RULES = [
  { words: ['rate hike', 'hawkish', 'higher for longer', 'delays cut', 'no rate cut'], weight: -4, tag: 'Şahin FED' },
  { words: ['strong dollar', 'dollar rises', 'dollar jumps', 'yields rise', 'yields surge'], weight: -3, tag: 'Güçlü Dolar' },
  { words: ['gold drops', 'gold falls', 'gold slides', 'profit-taking', 'sell-off', 'bearish'], weight: -3, tag: 'Kar Satışı' },
  { words: ['ceasefire', 'peace deal', 'truce', 'de-escalation', 'strong jobs', 'hot inflation'], weight: -3, tag: 'Güçlü ABD Verisi' }
];

async function getGoldNewsSentiment() {
  const now = Date.now();
  if (newsCache.data && now - newsCache.timestamp < 180000) return newsCache.data;
  try {
    const res = await fetch('https://news.google.com/rss/search?q=(XAUUSD+OR+%22Gold+price%22+OR+%22Federal+Reserve%22+OR+%22US+Dollar%22)+when:12h&hl=en-US&gl=US&ceid=US:en', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await res.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items = [];
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const block = match[1];
      const tM = block.match(/<title>([\s\S]*?)<\/title>/);
      const pM = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (tM) items.push({ title: tM[1].replace(/<!\[CDATA\[\vert{}\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), pubDate: pM ? getTRTime(new Date(pM[1]), false) : '' });
    }
    let rawScore = 0;
    const analyzed = items.map(item => {
      const lower = item.title.toLowerCase();
      let itemScore = 0; const tags = [];
      BULLISH_RULES.forEach(r => { if (r.words.some(w => lower.includes(w))) { itemScore += r.weight; tags.push(r.tag); } });
      BEARISH_RULES.forEach(r => { if (r.words.some(w => lower.includes(w))) { itemScore += r.weight; tags.push(r.tag); } });
      rawScore += itemScore;
      return { ...item, score: itemScore, tag: tags.length ? tags.join(' • ') : 'Piyasa Akışı' };
    });
    const norm = Math.max(-15, Math.min(15, rawScore));
    const result = { sentimentScore: norm, summary: norm >= 4 ? 'POZİTİF HABER AKIŞI' : (norm <= -4 ? 'NEGATİF HABER AKIŞI' : 'DENGELİ AKIŞ'), headlines: analyzed.slice(0, 6) };
    newsCache = { timestamp: now, data: result };
    return result;
  } catch (e) {
    return { sentimentScore: 0, summary: 'HABER BEKLENİYOR', headlines: [] };
  }
}

async function getEconomicCalendar() {
  const now = Date.now();
  if (calendarCache.data && now - calendarCache.timestamp < 300000) return calendarCache.data;
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const events = await res.json();
    const allHighUsdTimestamps = events.filter(e => e.country === 'USD' && e.impact === 'High').map(e => ({ title: e.title, timestampMs: new Date(e.date).getTime() }));
    const usdEvents = events.filter(e => e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium')).map(e => {
      const d = new Date(e.date);
      return { title: e.title, impact: e.impact, timeStr: getTRTime(d, false), dateStr: getTRDate(d), forecast: e.forecast || '-', diffMinutes: Math.round((d.getTime() - now) / 60000) };
    }).filter(e => e.diffMinutes >= -60 && e.diffMinutes <= 2160).sort((a, b) => a.diffMinutes - b.diffMinutes);

    const activeDanger = usdEvents.find(e => e.impact === 'High' && e.diffMinutes >= -15 && e.diffMinutes <= 30);
    const result = { killSwitch: Boolean(activeDanger), dangerEvent: activeDanger || null, upcomingEvents: usdEvents.slice(0, 5), allHighUsdTimestamps };
    calendarCache = { timestamp: now, data: result };
    return result;
  } catch (e) {
    return { killSwitch: false, dangerEvent: null, upcomingEvents: [], allHighUsdTimestamps: [] };
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
    if (json && json.data) json.data.forEach(i => { map[i.s] = { price: i.d[0], changeDaily: i.d[1], change5m: i.d[2], change15m: i.d[3], high: i.d[4], low: i.d[5] }; });
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
  const stochRsi = calcStochRSI(closes, 14), atr = calcATR(candles, 14), adx = calcADX(candles, 14), vwap = calcVWAP(candles);
  let trend = 'NÖTR';
  if (ema9 > ema21 && price > ema21) trend = 'BULLISH (YÜKSELİŞ)';
  else if (ema9 < ema21 && price < ema21) trend = 'BEARISH (DÜŞÜŞ)';
  return { price, ema9, ema21, ema50, rsi, stochRsi, atr, adx, vwap, trend };
}

// === AKTİF İŞLEM TAKİP MOTORU (%80 TP1 VE %60 ERKEN ZIRH) ===
function checkActiveTradeOnTick(spotPrice) {
  if (!db.activeTrade || !spotPrice) return null;
  let soundEvent = null;
  const t = db.activeTrade;
  const isLong = t.direction === 'LONG';
  t.currentPrice = spotPrice;
  t.unrealizedPnL = Number((isLong ? spotPrice - t.entry : t.entry - spotPrice).toFixed(2));

  // 1) TP2 VURDU MU?
  if ((isLong && spotPrice >= t.tp2) || (!isLong && spotPrice <= t.tp2)) {
    const profit = Number(Math.abs(t.tp2 - t.entry).toFixed(2));
    closeAllUsersMTTrade(t);
    db.history.unshift({ ...t, closePrice: spotPrice, closeTime: getTRTime(), status: 'TP2 TAM HEDEF 🎯', result: 'WIN', profitDollar: profit });
    db.activeTrade = null;
    saveDB(db);
    return 'TP_HIT';
  }

  // 2) TP1 VURDU MU? -> %80 KÂR AL + STOPU GİRİŞE ÇEK
  if (!t.tp1Hit && ((isLong && spotPrice >= t.tp1) || (!isLong && spotPrice <= t.tp1))) {
    t.tp1Hit = true;
    t.earlyShieldHit = true;
    t.sl = t.entry;
    saveDB(db);
    partialCloseAllUsersMTAtTP1(t);
    return 'TP_HIT';
  }

  // 3) ERKEN ZIRH: FİYAT TP1 YOLUNUN %60'INA GELDİYSE STOPU GİRİŞE ÇEK
  if (!t.tp1Hit && !t.earlyShieldHit) {
    const tp1Dist = Math.abs(t.tp1 - t.entry);
    const shieldTrigger = isLong ? t.entry + tp1Dist * 0.60 : t.entry - tp1Dist * 0.60;
    if ((isLong && spotPrice >= shieldTrigger) || (!isLong && spotPrice <= shieldTrigger)) {
      t.earlyShieldHit = true;
      t.sl = t.entry;
      saveDB(db);
      moveAllUsersMTToBreakeven(t);
    }
  }

  // 4) STOP LOSS KONTROLÜ
  if ((isLong && spotPrice <= t.sl) || (!isLong && spotPrice >= t.sl)) {
    let profit = 0;
    let statusText = 'STOP OLDU ❌';
    let resultType = 'LOSS';

    if (t.tp1Hit) {
      profit = Number((Math.abs(t.tp1 - t.entry) * 0.8).toFixed(2));
      statusText = 'TP1 ALINDI + BAŞABAŞ 🛡️';
      resultType = 'WIN';
      soundEvent = 'TP_HIT';
    } else if (t.earlyShieldHit) {
      profit = Number((Math.abs(t.tp1 - t.entry) * 0.15).toFixed(2));
      statusText = 'ERKEN ZIRH KORUMASI 🛡️';
      resultType = 'WIN';
      soundEvent = 'TP_HIT';
    } else {
      profit = -Number(Math.abs(t.entry - t.sl).toFixed(2));
      soundEvent = 'SL_HIT';
      db.lastStopTimestamp = Date.now();
      db.lastStopDirection = t.direction; // 25 DK AYNI YÖN KİLİDİ
    }

    closeAllUsersMTTrade(t);
    db.history.unshift({ ...t, closePrice: spotPrice, closeTime: getTRTime(), status: statusText, result: resultType, profitDollar: profit });
    db.activeTrade = null;
    saveDB(db);
    return soundEvent;
  }

  return soundEvent;
}

function getStats() {
  const total = db.history.length;
  const wins = db.history.filter(h => h.result === 'WIN').length;
  const totalProfit = db.history.reduce((acc, h) => acc + (Number(h.profitDollar) || 0), 0);
  return { total, wins, losses: total - wins, winRate: total > 0 ? Math.round((wins / total) * 100) : 0, totalProfit: totalProfit.toFixed(2) };
}

// === ANALİZ VE TAM OTOMATİK İŞLEM MOTORU ===
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
  const dxyData = tvMap['TVC:DXY'] || { price: 0, change5m: 0, change15m: 0, changeDaily: 0 };
  const us10yData = tvMap['TVC:US10Y'] || { price: 0, change5m: 0, change15m: 0, changeDaily: 0 };

  const lastRawClose = rawM5[rawM5.length - 1].close;
  const spotPrice = oandaData && oandaData.price ? oandaData.price : lastRawClose;
  lastKnownSpot = spotPrice;
  const offset = spotPrice - lastRawClose;
  const calibrate = (list) => list.map(c => ({ ...c, open: c.open + offset, high: c.high + offset, low: c.low + offset, close: c.close + offset }));

  const calM5 = calibrate(rawM5);
  const calM15 = calibrate(rawM15);
  const calH1 = calibrate(rawH1);

  const m5 = analyzeTimeframe(calM5);
  const m15 = analyzeTimeframe(calM15);
  const h1 = analyzeTimeframe(calH1);

  const bb = calcBollingerBands(calM5.map(c => c.close), 20, 2);
  const sr = getSwingStructure(calM15, 20);
  const cci = calcCCI(calM5, 14);

  const { score, reasons } = computeSignalScore(m5, m15, h1, dxyData.change15m || 0, us10yData.change15m || 0, newsData.sentimentScore || 0, calM5, bb, sr, cci);

  const targetDir = score > 0 ? 'LONG' : 'SHORT';
  const sameDirStopLock = Boolean(
    db.lastStopTimestamp &&
    db.lastStopDirection === targetDir &&
    (Date.now() - db.lastStopTimestamp < 25 * 60 * 1000)
  );

  let signal = '⏳ BEKLE (OTOMATİK TARANIYOR)';
  let direction = 'NEUTRAL';

  if (!session.isWeekend && calendarData.killSwitch) {
    signal = '⛔ VERİ SAATİ (OTOMATİK KİLİT)';
    direction = 'LOCKED';
  } else if (sameDirStopLock) {
    const remainMin = Math.ceil((25 * 60 * 1000 - (Date.now() - db.lastStopTimestamp)) / 60000);
    signal = `🛑 ${targetDir} KİLİDİ (${remainMin} DK BEKLEME)`;
    direction = 'LOCKED';
  } else if (score >= 45) {
    signal = `🟢 ${currentInstrument.name} LONG GİR (OTOMATİK)`;
    direction = 'LONG';
  } else if (score <= -45) {
    signal = `🔴 ${currentInstrument.name} SHORT GİR (OTOMATİK)`;
    direction = 'SHORT';
  }

  const isShort = score < 0;
  const tradePlan = calculateSmartTradePlan(spotPrice, isShort, calM5, m5.atr, sr);
  let soundEvent = checkActiveTradeOnTick(spotPrice);

  if (!db.activeTrade && !isOpeningTradeLock && !(session.isWeekend ? false : calendarData.killSwitch) && !sameDirStopLock && Math.abs(score) >= 45) {
    isOpeningTradeLock = true;
    try {
      const dir = score > 0 ? 'LONG' : 'SHORT';
      db.activeTrade = {
        id: Date.now(),
        openTime: getTRTime(),
        direction: dir,
        score,
        symbol: currentInstrument.brokerSym,
        entry: Number(tradePlan.entry),
        currentPrice: spotPrice,
        sl: Number(tradePlan.sl),
        initialSl: Number(tradePlan.sl),
        tp1: Number(tradePlan.tp1),
        tp2: Number(tradePlan.tp2),
        tp1Hit: false,
        earlyShieldHit: false,
        unrealizedPnL: 0,
        userPositions: {}
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
    timestamp: getTRTime(),
    spotPrice: spotPrice.toFixed(2),
    score,
    signal,
    direction,
    tradePlan,
    reasons,
    currentMarket: currentInstrument.name,
    isWeekendMode: session.isWeekend,
    timeframes: { m5, m15, h1 },
    macro: { dxy: dxyData, us10y: us10yData },
    news: newsData,
    calendar: calendarData,
    tracker: {
      activeTrade: db.activeTrade,
      history: db.history.slice(0, 15),
      stats: getStats(),
      soundEvent,
      metaApiEnabled: Boolean(userMt.enabled),
      metaSymbol: currentInstrument.brokerSym,
      userLot: userMt.lot || 0.04
    }
  };
}

app.get('/api/cron', async (req, res) => {
  try {
    const result = await executeFullAnalysisEngine(null);
    res.json({ ok: true, time: result.timestamp, spotPrice: result.spotPrice, score: result.score, signal: result.signal, activeTrade: Boolean(result.tracker.activeTrade) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === SİMÜLASYON MOTORU (4 KATMANLI TEYİT & İĞNE STOPU) ===
app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const hours = Number(req.query.hours) || 24;
    const mode = req.query.mode || 'today';

    const [tvMap, rawM5, rawM15, rawH1, rawDxyM5, calendarData] = await Promise.all([
      getLivePriceData('OANDA:XAUUSD'),
      getCandles('GC=F', '5m', '5d'),
      getCandles('GC=F', '15m', '1mo'),
      getCandles('GC=F', '1h', '1mo'),
      getCandles('DX-Y.NYB', '5m', '5d').catch(() => []),
      getEconomicCalendar()
    ]);

    const oandaData = tvMap['OANDA:XAUUSD'];
    const lastRawClose = rawM5[rawM5.length - 1].close;
    const spotPrice = oandaData && oandaData.price ? oandaData.price : lastRawClose;
    const offset = spotPrice - lastRawClose;

    const calibrate = (list) => list.map(c => ({ ...c, open: c.open + offset, high: c.high + offset, low: c.low + offset, close: c.close + offset }));
    const calM5 = calibrate(rawM5);
    const calM15 = calibrate(rawM15);
    const calH1 = calibrate(rawH1);

    const nowSec = Math.floor(Date.now() / 1000);
    let startTimestampSec = nowSec - hours * 3600;
    if (mode === 'today') {
      const trOffsetSec = 3 * 3600, nowTrSec = nowSec + trOffsetSec;
      startTimestampSec = nowTrSec - (nowTrSec % 86400) - trOffsetSec;
    }

    const dxyMap = {};
    if (Array.isArray(rawDxyM5)) {
      rawDxyM5.forEach((c, idx) => {
        if (idx >= 3 && rawDxyM5[idx - 3].close > 0) {
          dxyMap[c.time] = ((c.close - rawDxyM5[idx - 3].close) / rawDxyM5[idx - 3].close) * 100;
        }
      });
    }

    let simActive = null;
    let lastStopCandleIndex = -99;
    let lastStopDirection = null;
    const simTrades = [];

    for (let i = 30; i < calM5.length; i++) {
      const c = calM5[i];
      if (c.time < startTimestampSec) continue;

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
            profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.15).toFixed(2));
            status = 'ERKEN ZIRH KORUMASI 🛡️';
            result = 'WIN';
          } else {
            profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(2));
            lastStopCandleIndex = i;
            lastStopDirection = simActive.direction;
          }

          simTrades.push({
            ...simActive,
            closeTime: `${dateStr} ${timeStr}`,
            closePrice: simActive.sl.toFixed(2),
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
            closePrice: simActive.tp2.toFixed(2),
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
          const tp1Dist = Math.abs(simActive.tp1 - simActive.entry);
          const shieldTrigger = isLong ? simActive.entry + tp1Dist * 0.60 : simActive.entry - tp1Dist * 0.60;
          if ((isLong && c.high >= shieldTrigger) || (!isLong && c.low <= shieldTrigger)) {
            simActive.earlyShieldHit = true;
            simActive.sl = simActive.entry;
          }
        }
        continue;
      }

      const candleMs = c.time * 1000;
      const isNewsLocked = (calendarData.allHighUsdTimestamps || []).some(ev => {
        const diffMin = (ev.timestampMs - candleMs) / 60000;
        return diffMin >= -15 && diffMin <= 30;
      });
      if (isNewsLocked) continue;

      const m5Slice = calM5.slice(Math.max(0, i - 60), i + 1);
      const m15Slice = calM15.filter(x => x.time <= c.time).slice(-60);
      const h1Slice = calH1.filter(x => x.time <= c.time).slice(-60);
      if (m15Slice.length < 20 || h1Slice.length < 20) continue;

      const m5 = analyzeTimeframe(m5Slice);
      const m15 = analyzeTimeframe(m15Slice);
      const h1 = analyzeTimeframe(h1Slice);
      const dxyChg = dxyMap[c.time] || 0;

      const bbSim = calcBollingerBands(m5Slice.map(x => x.close), 20, 2);
      const srSim = getSwingStructure(m15Slice, 20);
      const cciSim = calcCCI(m5Slice, 14);

      const { score } = computeSignalScore(m5, m15, h1, dxyChg, 0, 0, m5Slice, bbSim, srSim, cciSim);

      if (Math.abs(score) >= 45) {
        const isShort = score < 0;
        const candidateDir = isShort ? 'SHORT' : 'LONG';

        // 25 DAKİKA (5 TANE M5 MUMU) AYNI YÖNE GİRİŞ YASAĞI
        if (i - lastStopCandleIndex < 5 && lastStopDirection === candidateDir) {
          continue;
        }

        const plan = calculateSmartTradePlan(c.close, isShort, m5Slice, m5.atr, srSim);
        simActive = {
          openTime: `${dateStr} ${timeStr}`,
          direction: candidateDir,
          score,
          entry: Number(plan.entry),
          sl: Number(plan.sl),
          tp1: Number(plan.tp1),
          tp2: Number(plan.tp2),
          tp1Hit: false,
          earlyShieldHit: false
        };
      }
    }

    if (simActive) {
      const isLong = simActive.direction === 'LONG';
      const liveDiff = Number((isLong ? spotPrice - simActive.entry : simActive.entry - spotPrice).toFixed(2));
      simTrades.push({
        ...simActive,
        closeTime: 'HALEN AÇIK ⏳',
        closePrice: spotPrice.toFixed(2),
        status: simActive.tp1Hit ? 'AÇIK (TP1 ALINDI 🛡️)' : (simActive.earlyShieldHit ? 'AÇIK (ERKEN ZIRH 🛡️)' : 'AÇIK İŞLEM ⏳'),
        result: liveDiff >= 0 ? 'WIN' : 'OPEN',
        profitDollar: liveDiff
      });
    }

    const closedTrades = simTrades.filter(t => t.closeTime !== 'HALEN AÇIK ⏳');
    const wins = closedTrades.filter(t => t.result === 'WIN').length;
    const losses = closedTrades.filter(t => t.result === 'LOSS').length;
    const winRate = closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 100) : 0;
    const totalProfit = simTrades.reduce((acc, t) => acc + (Number(t.profitDollar) || 0), 0);

    res.json({
      totalSignals: simTrades.length,
      closedCount: closedTrades.length,
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

app.get('/api/tick', requireAuth, async (req, res) => {
  try {
    const session = getMarketSession();
    const currentInstrument = session.instrument;
    const tvMap = await getLivePriceData(currentInstrument.tvSym);
    const spotPrice = tvMap[currentInstrument.tvSym] && tvMap[currentInstrument.tvSym].price ? tvMap[currentInstrument.tvSym].price : lastKnownSpot;
    if (spotPrice) lastKnownSpot = spotPrice;
    const soundEvent = checkActiveTradeOnTick(spotPrice);
    const userMt = req.user.metaApi || createDefaultMetaApi();

    res.json({
      timestamp: getTRTime(),
      spotPrice: spotPrice ? spotPrice.toFixed(2) : null,
      currentMarket: currentInstrument.name,
      macro: { dxy: tvMap['TVC:DXY'] || null, us10y: tvMap['TVC:US10Y'] || null },
      tracker: {
        activeTrade: db.activeTrade,
        history: db.history.slice(0, 15),
        stats: getStats(),
        soundEvent,
        metaApiEnabled: Boolean(userMt.enabled),
        metaSymbol: currentInstrument.brokerSym,
        userLot: userMt.lot || 0.04
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analyze', requireAuth, async (req, res) => {
  try {
    res.json(await executeFullAnalysisEngine(req.user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telegram-config', requireAdmin, async (req, res) => {
  const { botToken, chatId } = req.body;
  db.telegram = { botToken: (botToken || '').trim(), chatId: (chatId || '').trim(), enabled: Boolean(botToken && chatId) };
  await saveDB(db);
  res.json({ ok: true, enabled: db.telegram.enabled });
});

app.listen(PORT, '0.0.0.0', () => console.log(`👑 Kurumsal 4 Katmanlı Teyit + İğne Stoplu M5 Sunucu Aktif: Port ${PORT}`));
module.exports = app;
