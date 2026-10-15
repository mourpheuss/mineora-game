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
  return { token: '', accountId: '', symbol: 'GOLD#', lot: 0.01, balance: 84, riskPct: 10, regionUrl: '', enabled: false };
}

function getDefaultDB() {
  return {
    users: [{ username: 'admin', password: 'admin123', role: 'admin', createdAt: 'Kurucu Admin', metaApi: createDefaultMetaApi() }],
    sessions: {},
    activeTrade: null,
    history: [],
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
    mtSymbol: u.metaApi ? u.metaApi.symbol : 'GOLD#',
    mtLot: u.metaApi ? u.metaApi.lot : 0.01
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
    if (data && data.bid && data.ask) return { bid: Number(data.bid), ask: Number(data.ask) };
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

  if (brokerGoldList.includes(preferredSymbol)) addCand(preferredSymbol);
  brokerGoldList.forEach(addCand);
  [preferredSymbol, 'GOLD#', 'GOLD', 'GOLDmicro', 'GOLDm#', 'GOLD.', 'XAUUSD', 'XAUUSD#', 'XAUUSDm'].forEach(addCand);

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
    if (payload.symbol) {
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

async function openMobileMTTradeForAllUsers(tradeObj) {
  const isLong = tradeObj.direction === 'LONG';
  if (!tradeObj.userPositions) tradeObj.userPositions = {};
  const connected = (db.users || []).filter(u => u.metaApi && u.metaApi.enabled && u.metaApi.token && u.metaApi.accountId);

  const slDist = Math.abs(Number(tradeObj.entry) - Number(tradeObj.sl));
  const tp2Dist = Math.abs(Number(tradeObj.tp2) - Number(tradeObj.entry));

  await Promise.allSettled(connected.map(async (u) => {
    const mt = u.metaApi;
    if (!mt.regionUrl) mt.regionUrl = await resolveMetaApiRegionUrl(mt.token, mt.accountId);

    const lotSize = Math.max(0.01, Number(mt.lot) || 0.01);
    const symbol = (mt.symbol || 'GOLD#').trim();

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
        symbol: mt.symbol,
        xmEntry: calibratedEntry,
        xmTp2: calibratedTP2
      };
    }
  }));
  await saveDB(db);
}

async function moveAllUsersMTToBreakeven(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);
  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    const bePrice = Number(pos.xmEntry || tradeObj.entry);
    const tp2Price = Number(pos.xmTp2 || tradeObj.tp2);
    await userMetaApiRequest(u, {
      actionType: 'POSITION_MODIFY',
      positionId: String(pos.positionId),
      stopLoss: bePrice,
      takeProfit: tp2Price
    });
  }));
}

async function partialCloseAllUsersMTAtTP1(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);
  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    const totalVol = Number(pos.volume || u.metaApi.lot || 0.01);
    const closeVol = Math.floor(totalVol * 0.80 * 100) / 100;
    const bePrice = Number(pos.xmEntry || tradeObj.entry);
    const tp2Price = Number(pos.xmTp2 || tradeObj.tp2);

    if (closeVol >= 0.01 && (totalVol - closeVol) >= 0.01) {
      await userMetaApiRequest(u, {
        actionType: 'POSITION_PARTIAL',
        positionId: String(pos.positionId),
        volume: Number(closeVol.toFixed(2))
      });
    }
    await userMetaApiRequest(u, {
      actionType: 'POSITION_MODIFY',
      positionId: String(pos.positionId),
      stopLoss: bePrice,
      takeProfit: tp2Price
    });
  }));
}

async function closeAllUsersMTTrade(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connected = (db.users || []).filter(u => tradeObj.userPositions[u.username]);
  await Promise.allSettled(connected.map(async (u) => {
    const pos = tradeObj.userPositions[u.username];
    await userMetaApiRequest(u, { actionType: 'POSITION_CLOSE_ID', positionId: String(pos.positionId) });
  }));
}

app.post('/api/metaapi-config', requireAuth, async (req, res) => {
  const { token, accountId, symbol, lot } = req.body;
  const cleanToken = (token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
  const cleanAcc = (accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
  const regionUrl = cleanToken && cleanAcc ? await resolveMetaApiRegionUrl(cleanToken, cleanAcc) : '';

  let finalSymbol = (symbol || 'GOLD#').trim();
  if (cleanToken && cleanAcc && regionUrl) {
    const goldList = await getBrokerGoldSymbols(regionUrl, cleanToken, cleanAcc);
    if (goldList.length > 0 && !goldList.includes(finalSymbol)) finalSymbol = goldList[0];
  }

  req.user.metaApi = {
    ...createDefaultMetaApi(),
    ...(req.user.metaApi || {}),
    token: cleanToken,
    accountId: cleanAcc,
    symbol: finalSymbol,
    lot: Math.max(0.01, Number(lot) || 0.01),
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

app.post('/api/metaapi-test', requireAuth, async (req, res) => {
  try {
    const token = (req.body.token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
    const accountId = (req.body.accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
    if (!token || !accountId) return res.status(400).json({ ok: false, error: 'Lütfen önce MetaApi Token ve Account ID girin.' });

    const provRes = await fetch(`https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${accountId}`, {
      headers: { 'auth-token': token }
    });
    if (!provRes.ok) return res.status(400).json({ ok: false, error: 'Token veya Account ID hatalı!' });

    const provData = await provRes.json();
    const regionUrl = `https://mt-client-api-v1.${provData.region || 'london'}.agiliumtrade.ai`;

    const [infoRes, goldList] = await Promise.all([
      fetch(`${regionUrl}/users/current/accounts/${accountId}/account-information`, { headers: { 'auth-token': token } }),
      getBrokerGoldSymbols(regionUrl, token, accountId)
    ]);

    if (goldList.length > 0 && req.user.metaApi) {
      if (!goldList.includes(req.user.metaApi.symbol)) req.user.metaApi.symbol = goldList[0];
      req.user.metaApi.regionUrl = regionUrl;
      await saveDB(db);
    }

    if (!infoRes.ok) return res.json({ ok: true, partial: true, message: `Hesap bulundu (${provData.server}), bağlantı hazırlanıyor...` });

    const info = await infoRes.json();
    const symbolsText = goldList.length > 0 ? ` | Bulunan Altın Sembolleri: ${goldList.join(', ')}` : '';
    res.json({
      ok: true,
      broker: `${info.broker || provData.server}${symbolsText}`,
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
    const symbolInput = (req.body.symbol || (req.user.metaApi ? req.user.metaApi.symbol : 'GOLD#')).trim();

    if (!token || !accountId) return res.status(400).json({ ok: false, error: 'Lütfen önce Token ve Account ID girin.' });

    const regionUrl = await resolveMetaApiRegionUrl(token, accountId);
    const tradeUrl = `${regionUrl}/users/current/accounts/${accountId}/trade`;

    const attempt = await smartTradeWithSymbolFallback(
      regionUrl,
      token,
      accountId,
      { actionType: 'ORDER_TYPE_BUY', volume: 0.01, comment: 'XAU_BAGLANTI_TESTI' },
      symbolInput
    );

    const openData = attempt.data || {};
    if (!attempt.ok || (openData.stringCode && (openData.stringCode.includes('ERR') || openData.stringCode.includes('INVALID')))) {
      const availableHint = attempt.brokerGoldList && attempt.brokerGoldList.length > 0
        ? `Hesabınızda bulunan Altın sembolleri: [ ${attempt.brokerGoldList.join(' , ')} ].`
        : `Lütfen sembol kutusuna GOLD# veya GOLDmicro yazıp tekrar deneyin.`;
      return res.status(400).json({
        ok: false,
        error: `Test emri açılamadı (${openData.message || openData.stringCode || 'Sembol hatası'}). ${availableHint}`
      });
    }

    if (req.user.metaApi) {
      req.user.metaApi.symbol = attempt.workingSymbol;
      req.user.metaApi.regionUrl = regionUrl;
      await saveDB(db);
    }

    let posId = openData.positionId || openData.orderId;
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (!posId) {
      try {
        const posRes = await fetch(`${regionUrl}/users/current/accounts/${accountId}/positions`, { headers: { 'auth-token': token } });
        const posList = await posRes.json();
        if (Array.isArray(posList) && posList.length > 0) {
          const foundPos = posList.find(p => p.comment === 'XAU_BAGLANTI_TESTI' || p.symbol === attempt.workingSymbol);
          if (foundPos) posId = foundPos.id;
        }
      } catch (e) {}
    }

    let closeSuccess = false;
    if (posId) {
      const closeRes = await fetch(tradeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'auth-token': token },
        body: JSON.stringify({ actionType: 'POSITION_CLOSE_ID', positionId: String(posId) })
      });
      const closeData = await closeRes.json();
      closeSuccess = closeRes.ok && (!closeData.stringCode || !closeData.stringCode.includes('ERR'));
    }

    if (!closeSuccess) {
      await fetch(tradeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'auth-token': token },
        body: JSON.stringify({ actionType: 'POSITIONS_CLOSE_SYMBOL', symbol: attempt.workingSymbol })
      }).catch(() => {});
    }

    res.json({
      ok: true,
      positionId: posId,
      symbol: attempt.workingSymbol,
      message: `✅ TAM TEST BAŞARILI! Telefonundaki MetaTrader'da 0.01 Lot ${attempt.workingSymbol} işlemi açıldı (ID: #${posId}), 3 saniye beklendi ve OTOMATİK KAPATILDI!`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Test işlemi hatası: ' + err.message });
  }
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

function calculateSmartTradePlan(spotPrice, isShort, m5Candles, m15Candles, m5Atr) {
  const effectiveATR = Math.max(m5Atr, 2.2);
  const recentM5 = m5Candles.slice(-12), recentM15 = m15Candles.slice(-8);
  const swingLowM5 = Math.min(...recentM5.map(c => c.low)), swingHighM5 = Math.max(...recentM5.map(c => c.high));
  const structureLowM15 = Math.min(...recentM15.map(c => c.low)), structureHighM15 = Math.max(...recentM15.map(c => c.high));
  const wickBuffer = effectiveATR * 0.25;
  let slDist, tp1Dist, tp2Dist;

  if (!isShort) {
    const rawWickSLDist = spotPrice - (swingLowM5 - wickBuffer);
    slDist = Math.max(effectiveATR * 1.25, Math.min(effectiveATR * 2.3, Math.max(rawWickSLDist, effectiveATR * 1.45)));
    const baseTp1Dist = Math.max(effectiveATR * 1.9, slDist * 1.35);
    const distToM15High = structureHighM15 - spotPrice;
    tp1Dist = (distToM15High > effectiveATR * 1.3 && distToM15High < baseTp1Dist + 1.2) ? Math.max(effectiveATR * 1.25, distToM15High - 0.35) : baseTp1Dist;
    tp2Dist = Math.max(effectiveATR * 3.4, slDist * 2.3);
  } else {
    const rawWickSLDist = (swingHighM5 + wickBuffer) - spotPrice;
    slDist = Math.max(effectiveATR * 1.25, Math.min(effectiveATR * 2.3, Math.max(rawWickSLDist, effectiveATR * 1.45)));
    const baseTp1Dist = Math.max(effectiveATR * 1.9, slDist * 1.35);
    const distToM15Low = spotPrice - structureLowM15;
    tp1Dist = (distToM15Low > effectiveATR * 1.3 && distToM15Low < baseTp1Dist + 1.2) ? Math.max(effectiveATR * 1.25, distToM15Low - 0.35) : baseTp1Dist;
    tp2Dist = Math.max(effectiveATR * 3.4, slDist * 2.3);
  }

  return {
    entry: spotPrice.toFixed(2),
    sl: (!isShort ? spotPrice - slDist : spotPrice + slDist).toFixed(2),
    tp1: (!isShort ? spotPrice + tp1Dist : spotPrice - tp1Dist).toFixed(2),
    tp2: (!isShort ? spotPrice + tp2Dist : spotPrice - tp2Dist).toFixed(2),
    slDollar: slDist.toFixed(2),
    tp1Dollar: tp1Dist.toFixed(2),
    tp2Dollar: tp2Dist.toFixed(2),
    swingLow: swingLowM5.toFixed(2),
    swingHigh: swingHighM5.toFixed(2)
  };
}

// %70 BAŞARI + STOP SONRASI 45 DAKİKA (9 MUM) DİNLENME KORUMALI MOTOR
function computeSignalScore(m5, m15, h1, dxyChange15m, us10yChange15m, newsScore, m5Candles) {
  let score = 0, h1MainDir = 0;
  const reasons = [];

  if (h1.price > h1.ema21 && h1.ema21 > h1.ema50) {
    score += 20; h1MainDir = 1;
    reasons.push({ type: 'pos', text: 'H1 Ana Trend yükselişte (EMA 21 ve 50 üzerinde)' });
  } else if (h1.price < h1.ema21 && h1.ema21 < h1.ema50) {
    score -= 20; h1MainDir = -1;
    reasons.push({ type: 'neg', text: 'H1 Ana Trend düşüşte (EMA 21 ve 50 altında)' });
  }

  if (m15.price > m15.vwap && m15.ema9 > m15.ema21) {
    score += 25;
    reasons.push({ type: 'pos', text: 'M15 Kurulum Pozitif: Fiyat kurumsal VWAP ve EMA21 üzerinde' });
  } else if (m15.price < m15.vwap && m15.ema9 < m15.ema21) {
    score -= 25;
    reasons.push({ type: 'neg', text: 'M15 Kurulum Negatif: Fiyat kurumsal VWAP ve EMA21 altında' });
  }

  if (m5.price > m5.vwap) {
    score += 10;
    reasons.push({ type: 'pos', text: 'M5 Fiyat gün içi VWAP üzerinde' });
  } else {
    score -= 10;
    reasons.push({ type: 'neg', text: 'M5 Fiyat gün içi VWAP altında' });
  }

  if (m5.ema9 > m5.ema21 && m5.ema21 > m5.ema50) {
    score += 15;
    reasons.push({ type: 'pos', text: 'M5 EMA (9-21-50) yukarı yönlü' });
  } else if (m5.ema9 < m5.ema21 && m5.ema21 < m5.ema50) {
    score -= 15;
    reasons.push({ type: 'neg', text: 'M5 EMA (9-21-50) aşağı yönlü' });
  }

  if (m15.trend.includes('BULLISH') && m5.stochRsi < 35) {
    score += 15;
    reasons.push({ type: 'pos', text: 'M5 StochRSI geri çekilme alım fırsatı' });
  } else if (m15.trend.includes('BEARISH') && m5.stochRsi > 65) {
    score -= 15;
    reasons.push({ type: 'neg', text: 'M5 StochRSI tepki satış fırsatı' });
  } else if (m5.rsi > 54 && m5.rsi < 72) {
    score += 8;
  } else if (m5.rsi < 46 && m5.rsi > 28) {
    score -= 8;
  }

  if (dxyChange15m < -0.02) {
    score += 15;
    reasons.push({ type: 'pos', text: `DXY düşüşte (%${dxyChange15m.toFixed(2)}) -> Altın pozitif` });
  } else if (dxyChange15m > 0.02) {
    score -= 15;
    reasons.push({ type: 'neg', text: `DXY yükselişte (+%${dxyChange15m.toFixed(2)}) -> Altın negatif` });
  }

  if (us10yChange15m < -0.05) score += 5;
  else if (us10yChange15m > 0.05) score -= 5;
  if (newsScore !== 0) score += newsScore;

  if (m5.adx < 18) {
    score = Math.round(score * 0.7);
    reasons.push({ type: 'warn', text: `M5 ADX (${m5.adx.toFixed(1)}) düşük, yatay piyasa.` });
  }

  if (score > 0 && h1MainDir === -1 && score < 75) {
    score = 30;
    reasons.push({ type: 'warn', text: 'Ana Trend Kalkanı: H1 ana trendi düşüşte olduğu için riskli LONG sinyali engellendi.' });
  } else if (score < 0 && h1MainDir === 1 && score > -75) {
    score = -30;
    reasons.push({ type: 'warn', text: 'Ana Trend Kalkanı: H1 ana trendi yükselişte olduğu için riskli SHORT sinyali engellendi.' });
  }

  if (m5Candles && m5Candles.length >= 3) {
    const recentJump = m5.price - m5Candles[m5Candles.length - 3].close;
    if (score < -45 && recentJump < -(m5.atr * 1.75)) {
      score = -35;
      reasons.push({ type: 'warn', text: 'Geç Kalmış Mum Koruması: Dipten satış engellendi.' });
    } else if (score > 45 && recentJump > (m5.atr * 1.75)) {
      score = 35;
      reasons.push({ type: 'warn', text: 'Geç Kalmış Mum Koruması: Tepeden alış engellendi.' });
    }
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
    const result = { sentimentScore: norm, summary: norm >= 4 ? 'POZİTİf HABER AKIŞI' : (norm <= -4 ? 'NEGATİF HABER AKIŞI' : 'DENGELİ AKIŞ'), headlines: analyzed.slice(0, 6) };
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

async function getOandaSpotAndMacro() {
  try {
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: { tickers: ['OANDA:XAUUSD', 'TVC:DXY', 'TVC:US10Y'] }, columns: ['close', 'change', 'change|5', 'change|15', 'high', 'low'] })
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

async function checkActiveTradeOnTick(spotPrice) {
  if (!db.activeTrade || !spotPrice) return null;
  let soundEvent = null;
  const t = db.activeTrade, isLong = t.direction === 'LONG';
  t.currentPrice = spotPrice;
  t.unrealizedPnL = Number((isLong ? spotPrice - t.entry : t.entry - spotPrice).toFixed(2));

  if ((isLong && spotPrice >= t.tp2) || (!isLong && spotPrice <= t.tp2)) {
    const profit = Number(Math.abs(t.tp2 - t.entry).toFixed(2));
    await closeAllUsersMTTrade(t);
    db.history.unshift({ ...t, closePrice: spotPrice, closeTime: getTRTime(), status: 'TP2 TAM HEDEF 🎯', result: 'WIN', profitDollar: profit });
    db.activeTrade = null;
    await saveDB(db);
    return 'TP_HIT';
  }

  if (!t.tp1Hit && ((isLong && spotPrice >= t.tp1) || (!isLong && spotPrice <= t.tp1))) {
    t.tp1Hit = true; t.earlyShieldHit = true; t.sl = t.entry;
    await saveDB(db);
    await partialCloseAllUsersMTAtTP1(t);
    soundEvent = 'TP_HIT';
  }

  if (!t.tp1Hit && !t.earlyShieldHit) {
    const tp1Dist = Math.abs(t.tp1 - t.entry);
    const trig = isLong ? t.entry + tp1Dist * 0.60 : t.entry - tp1Dist * 0.60;
    if ((isLong && spotPrice >= trig) || (!isLong && spotPrice <= trig)) {
      t.earlyShieldHit = true; t.sl = t.entry;
      await saveDB(db);
      await moveAllUsersMTToBreakeven(t);
    }
  }

  if ((isLong && spotPrice <= t.sl) || (!isLong && spotPrice >= t.sl)) {
    let profit = -Number(Math.abs(t.entry - t.sl).toFixed(2)), statusText = 'STOP OLDU ❌', resultType = 'LOSS';
    if (t.tp1Hit) { profit = Number((Math.abs(t.tp1 - t.entry) * 0.8).toFixed(2)); statusText = 'TP1 ALINDI + BAŞABAŞ 🛡️'; resultType = 'WIN'; soundEvent = 'TP_HIT'; }
    else if (t.earlyShieldHit) { profit = Number((Math.abs(t.tp1 - t.entry) * 0.15).toFixed(2)); statusText = 'ERKEN ZIRH KORUMASI 🛡️'; resultType = 'WIN'; }
    else soundEvent = 'SL_HIT';

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
  const [tvMap, rawM5, rawM15, rawH1, newsData, calendarData] = await Promise.all([
    getOandaSpotAndMacro(), getCandles('GC=F', '5m', '5d'), getCandles('GC=F', '15m', '5d'), getCandles('GC=F', '1h', '1mo'), getGoldNewsSentiment(), getEconomicCalendar()
  ]);

  const oandaData = tvMap['OANDA:XAUUSD'];
  const dxyData = tvMap['TVC:DXY'] || { price: 0, change5m: 0, change15m: 0, changeDaily: 0 };
  const us10yData = tvMap['TVC:US10Y'] || { price: 0, change5m: 0, change15m: 0, changeDaily: 0 };
  const lastRawClose = rawM5[rawM5.length - 1].close;
  const spotPrice = oandaData && oandaData.price ? oandaData.price : lastRawClose;
  lastKnownSpot = spotPrice;
  const offset = spotPrice - lastRawClose;
  const calibrate = (list) => list.map(c => ({ ...c, open: c.open + offset, high: c.high + offset, low: c.low + offset, close: c.close + offset }));

  const calM5 = calibrate(rawM5), calM15 = calibrate(rawM15), calH1 = calibrate(rawH1);
  const m5 = analyzeTimeframe(calM5), m15 = analyzeTimeframe(calM15), h1 = analyzeTimeframe(calH1);
  const { score, reasons } = computeSignalScore(m5, m15, h1, dxyData.change15m || 0, us10yData.change15m || 0, newsData.sentimentScore || 0, calM5);

  let signal = '⏳ BEKLE (OTOMATİK TARANIYOR)', direction = 'NEUTRAL';
  if (calendarData.killSwitch) { signal = '⛔ VERİ SAATİ (OTOMATİK KİLİT)'; direction = 'LOCKED'; }
  else if (score >= 45) { signal = '🟢 LONG GİR (OTOMATİK)'; direction = 'LONG'; }
  else if (score <= -45) { signal = '🔴 SHORT GİR (OTOMATİK)'; direction = 'SHORT'; }

  const tradePlan = calculateSmartTradePlan(spotPrice, score < 0, calM5, calM15, m5.atr);
  let soundEvent = await checkActiveTradeOnTick(spotPrice);

  if (!db.activeTrade && !calendarData.killSwitch && Math.abs(score) >= 45) {
    const dir = score > 0 ? 'LONG' : 'SHORT';
    db.activeTrade = {
      id: Date.now(), openTime: getTRTime(), direction: dir, score,
      entry: Number(tradePlan.entry), currentPrice: spotPrice, sl: Number(tradePlan.sl), initialSl: Number(tradePlan.sl),
      tp1: Number(tradePlan.tp1), tp2: Number(tradePlan.tp2), tp1Hit: false, earlyShieldHit: false, unrealizedPnL: 0, userPositions: {}
    };
    await saveDB(db);
    soundEvent = 'NEW_SIGNAL';
    await openMobileMTTradeForAllUsers(db.activeTrade);
  }

  const userMt = currentUser && currentUser.metaApi ? currentUser.metaApi : createDefaultMetaApi();
  return {
    timestamp: getTRTime(), spotPrice: spotPrice.toFixed(2), score, signal, direction, tradePlan, reasons,
    timeframes: { m5, m15, h1 }, macro: { dxy: dxyData, us10y: us10yData }, news: newsData, calendar: calendarData,
    tracker: { activeTrade: db.activeTrade, history: db.history.slice(0, 15), stats: getStats(), soundEvent, metaApiEnabled: Boolean(userMt.enabled), metaSymbol: userMt.symbol || 'GOLD#', userLot: userMt.lot || 0.01 }
  };
}

app.get('/api/cron', async (req, res) => {
  try {
    const r = await executeFullAnalysisEngine(null);
    if (db.activeTrade) {
      for (let step = 0; step < 3; step++) {
        await new Promise(resolve => setTimeout(resolve, 2300));
        const tvMap = await getOandaSpotAndMacro();
        const oandaData = tvMap['OANDA:XAUUSD'];
        if (oandaData && oandaData.price) await checkActiveTradeOnTick(oandaData.price);
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
    const [tvMap, rawM5, rawM15, rawH1, rawDxyM5] = await Promise.all([
      getOandaSpotAndMacro(), getCandles('GC=F', '5m', '5d'), getCandles('GC=F', '15m', '1mo'), getCandles('GC=F', '1h', '1mo'), getCandles('DX-Y.NYB', '5m', '5d').catch(() => [])
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

    const dxyMap = {};
    rawDxyM5.forEach((c, idx) => { if (idx >= 3 && rawDxyM5[idx - 3].close > 0) dxyMap[c.time] = ((c.close - rawDxyM5[idx - 3].close) / rawDxyM5[idx - 3].close) * 100; });

    let simActive = null, lastStopCandleIndex = -99;
    const simTrades = [];

    for (let i = 30; i < calM5.length; i++) {
      const c = calM5[i];
      if (c.time < startTimestampSec) continue;
      const dObj = new Date(c.time * 1000), timeStr = getTRTime(dObj, false), dateStr = getTRDate(dObj);

      if (simActive) {
        const isLong = simActive.direction === 'LONG';
        if ((isLong && c.low <= simActive.sl) || (!isLong && c.high >= simActive.sl)) {
          let profit = -Number(Math.abs(simActive.entry - simActive.sl).toFixed(2)), status = 'STOP OLDU ❌', result = 'LOSS';
          if (simActive.tp1Hit) { profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.8).toFixed(2)); status = 'TP1 ALINDI + BAŞABAŞ 🛡️'; result = 'WIN'; }
          else if (simActive.earlyShieldHit) { profit = Number((Math.abs(simActive.tp1 - simActive.entry) * 0.15).toFixed(2)); status = 'ERKEN ZIRH KORUMASI 🛡️'; result = 'WIN'; }
          else lastStopCandleIndex = i; // STOP OLDUĞU MUMU KAYDET
          simTrades.push({ ...simActive, closeTime: `${dateStr} ${timeStr}`, closePrice: simActive.sl.toFixed(2), status, result, profitDollar: profit });
          simActive = null; continue;
        }
        if ((isLong && c.high >= simActive.tp2) || (!isLong && c.low <= simActive.tp2)) {
          const profit = Number(Math.abs(simActive.tp2 - simActive.entry).toFixed(2));
          simTrades.push({ ...simActive, closeTime: `${dateStr} ${timeStr}`, closePrice: simActive.tp2.toFixed(2), status: 'TP2 TAM HEDEF 🎯', result: 'WIN', profitDollar: profit });
          simActive = null; continue;
        }
        if (!simActive.tp1Hit && ((isLong && c.high >= simActive.tp1) || (!isLong && c.low <= simActive.tp1))) { simActive.tp1Hit = true; simActive.earlyShieldHit = true; simActive.sl = simActive.entry; }
        if (!simActive.tp1Hit && !simActive.earlyShieldHit) {
          const tp1Dist = Math.abs(simActive.tp1 - simActive.entry);
          const trig = isLong ? simActive.entry + tp1Dist * 0.60 : simActive.entry - tp1Dist * 0.60;
          if ((isLong && c.high >= trig) || (!isLong && c.low <= trig)) { simActive.earlyShieldHit = true; simActive.sl = simActive.entry; }
        }
        continue;
      }

      // STOP SONRASI 45 DAKİKA (9 MUM) BEKLEME KURALI (Anlamsız ardışık stopları engeller)
      if (i - lastStopCandleIndex < 9) continue;

      const m5Slice = calM5.slice(Math.max(0, i - 60), i + 1);
      const m15Slice = calM15.filter(x => x.time <= c.time).slice(-60);
      const h1Slice = calH1.filter(x => x.time <= c.time).slice(-60);
      if (m15Slice.length < 20 || h1Slice.length < 20) continue;

      const m5 = analyzeTimeframe(m5Slice), m15 = analyzeTimeframe(m15Slice), h1 = analyzeTimeframe(h1Slice);
      const { score } = computeSignalScore(m5, m15, h1, dxyMap[c.time] || 0, 0, 0, m5Slice);
      if (Math.abs(score) >= 45) {
        const isShort = score < 0, plan = calculateSmartTradePlan(c.close, isShort, m5Slice, m15Slice, m5.atr);
        simActive = { openTime: `${dateStr} ${timeStr}`, direction: isShort ? 'SHORT' : 'LONG', score, entry: Number(plan.entry), sl: Number(plan.sl), tp1: Number(plan.tp1), tp2: Number(plan.tp2), tp1Hit: false, earlyShieldHit: false };
      }
    }

    if (simActive) {
      const isLong = simActive.direction === 'LONG', liveDiff = Number((isLong ? spotPrice - simActive.entry : simActive.entry - spotPrice).toFixed(2));
      simTrades.push({ ...simActive, closeTime: 'HALEN AÇIK ⏳', closePrice: spotPrice.toFixed(2), status: simActive.tp1Hit ? 'AÇIK (TP1 ALINDI 🛡️)' : 'AÇIK İŞLEM ⏳', result: liveDiff >= 0 ? 'WIN' : 'OPEN', profitDollar: liveDiff });
    }

    const closed = simTrades.filter(t => t.closeTime !== 'HALEN AÇIK ⏳');
    const wins = closed.filter(t => t.result === 'WIN').length, losses = closed.filter(t => t.result === 'LOSS').length;
    const totalProfit = simTrades.reduce((acc, t) => acc + t.profitDollar, 0);
    res.json({ totalSignals: simTrades.length, closedCount: closed.length, wins, losses, winRate: closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0, totalProfit: totalProfit.toFixed(2), trades: simTrades.reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tick', requireAuth, async (req, res) => {
  try {
    const tvMap = await getOandaSpotAndMacro(), oandaData = tvMap['OANDA:XAUUSD'];
    const spotPrice = oandaData && oandaData.price ? oandaData.price : lastKnownSpot;
    if (spotPrice) lastKnownSpot = spotPrice;
    const soundEvent = await checkActiveTradeOnTick(spotPrice);
    const userMt = req.user.metaApi || createDefaultMetaApi();
    res.json({ timestamp: getTRTime(), spotPrice: spotPrice ? spotPrice.toFixed(2) : null, macro: { dxy: tvMap['TVC:DXY'] || null, us10y: tvMap['TVC:US10Y'] || null }, tracker: { activeTrade: db.activeTrade, history: db.history.slice(0, 15), stats: getStats(), soundEvent, metaApiEnabled: Boolean(userMt.enabled), metaSymbol: userMt.symbol || 'GOLD#', userLot: userMt.lot || 0.01 } });
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

app.listen(PORT, '0.0.0.0', () => console.log(`👑 XAU/USD Sunucu Aktif: Port ${PORT}`));
module.exports = app;
