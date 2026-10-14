const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// SENİN FIREBASE REALTIME DATABASE ADRESİN DOĞRUDAN ENTEGRE EDİLDİ
const FIREBASE_DB_URL = 'https://mineora-web-default-rtdb.firebaseio.com';

const IS_CLOUD = Boolean(process.env.VERCEL || process.env.RENDER);
const DB_FILE = IS_CLOUD ? path.join('/tmp', 'signals_db.json') : path.join(__dirname, 'signals_db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- VARSAYILAN VERİTABANI YAPISI ---
function createDefaultMetaApi() {
  return {
    token: '',
    accountId: '',
    symbol: 'XAUUSD',
    lot: 0.05,
    balance: 1000,
    riskPct: 2,
    regionUrl: '',
    enabled: false
  };
}

function getDefaultDB() {
  return {
    users: [
      {
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        createdAt: 'Kurucu Admin',
        metaApi: createDefaultMetaApi()
      }
    ],
    sessions: {},
    activeTrade: null,
    history: [],
    telegram: { botToken: '', chatId: '', enabled: false }
  };
}

function normalizeDB(parsed) {
  if (!parsed || typeof parsed !== 'object') return getDefaultDB();
  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    parsed.users = getDefaultDB().users;
  }
  parsed.users = parsed.users.map(u => ({
    ...u,
    metaApi: { ...createDefaultMetaApi(), ...(u.metaApi || {}) }
  }));
  if (!parsed.sessions) parsed.sessions = {};
  if (!Array.isArray(parsed.history)) parsed.history = [];
  if (!parsed.telegram) parsed.telegram = { botToken: '', chatId: '', enabled: false };
  return parsed;
}

function loadLocalDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return normalizeDB(parsed);
    }
  } catch (e) {
    console.error('Yerel DB okuma hatası:', e.message);
  }
  return getDefaultDB();
}

let db = loadLocalDB();
let lastFirebaseSync = 0;

// Firebase'den veriyi senkronize et
async function syncFromFirebase(force = false) {
  const now = Date.now();
  if (!force && now - lastFirebaseSync < 10000) return;
  try {
    const cleanUrl = FIREBASE_DB_URL.replace(/\/$/, '');
    const res = await fetch(`${cleanUrl}/xauusd_pro_state.json`);
    if (res.ok) {
      const cloudData = await res.json();
      if (cloudData && cloudData.users) {
        db = normalizeDB(cloudData);
        lastFirebaseSync = now;
      } else if (!cloudData) {
        // İlk kez çalışıyorsa varsayılan DB'yi Firebase'e yaz
        saveDB(db);
        lastFirebaseSync = now;
      }
    }
  } catch (e) {
    console.error('Firebase senkronizasyon hatası:', e.message);
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
  if (FIREBASE_DB_URL) {
    const cleanUrl = FIREBASE_DB_URL.replace(/\/$/, '');
    fetch(`${cleanUrl}/xauusd_pro_state.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  }
}

let newsCache = { timestamp: 0, data: null };
let calendarCache = { timestamp: 0, data: null };
let lastKnownSpot = 0;

// --- KULLANICI GİRİŞ VE YETKİ KONTROLÜ ---

function getAuthUser(req) {
  const token = req.headers['x-auth-token'];
  if (!token || !db.sessions || !db.sessions[token]) return null;
  const session = db.sessions[token];
  const user = (db.users || []).find(u => u.username.toLowerCase() === session.username.toLowerCase());
  return user || null;
}

async function requireAuth(req, res, next) {
  await syncFromFirebase();
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz veya süresi doldu.' });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  await syncFromFirebase();
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem sadece Yönetici (Admin) yetkisine açıktır.' });
  }
  req.user = user;
  next();
}

// Giriş Yap API
app.post('/api/login', async (req, res) => {
  await syncFromFirebase(true);
  const { username, password } = req.body;
  const cleanUser = (username || '').trim();
  const cleanPass = (password || '').trim();

  const found = (db.users || []).find(
    u => u.username.toLowerCase() === cleanUser.toLowerCase() && u.password === cleanPass
  );

  if (!found) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı!' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  if (!db.sessions) db.sessions = {};
  db.sessions[token] = { username: found.username, role: found.role, loginTime: Date.now() };
  saveDB(db);

  res.json({
    ok: true,
    token,
    user: {
      username: found.username,
      role: found.role,
      metaApi: {
        enabled: Boolean(found.metaApi && found.metaApi.enabled),
        symbol: found.metaApi ? found.metaApi.symbol : 'XAUUSD',
        lot: found.metaApi ? found.metaApi.lot : 0.05,
        balance: found.metaApi ? found.metaApi.balance : 1000,
        riskPct: found.metaApi ? found.metaApi.riskPct : 2,
        accountId: found.metaApi ? found.metaApi.accountId : ''
      }
    }
  });
});

// Oturum Doğrulama API
app.get('/api/me', async (req, res) => {
  await syncFromFirebase();
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ ok: false });
  res.json({
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      metaApi: {
        enabled: Boolean(user.metaApi && user.metaApi.enabled),
        symbol: user.metaApi ? user.metaApi.symbol : 'XAUUSD',
        lot: user.metaApi ? user.metaApi.lot : 0.05,
        balance: user.metaApi ? user.metaApi.balance : 1000,
        riskPct: user.metaApi ? user.metaApi.riskPct : 2,
        accountId: user.metaApi ? user.metaApi.accountId : ''
      }
    }
  });
});

// Admin: Üye Listesini Getir (Her üyenin MT durumu ve lotu görünür)
app.get('/api/users', requireAdmin, (req, res) => {
  const safeUsers = (db.users || []).map(u => ({
    username: u.username,
    role: u.role,
    createdAt: u.createdAt || '-',
    mtEnabled: Boolean(u.metaApi && u.metaApi.enabled),
    mtSymbol: u.metaApi ? u.metaApi.symbol : 'XAUUSD',
    mtLot: u.metaApi ? u.metaApi.lot : 0.05
  }));
  res.json({ users: safeUsers });
});

// Admin: Yeni Üye Oluştur veya Şifre Güncelle
app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  const cleanUser = (username || '').trim();
  const cleanPass = (password || '').trim();

  if (!cleanUser || cleanPass.length < 4) {
    return res.status(400).json({ error: 'Kullanıcı adı boş olamaz ve şifre en az 4 karakter olmalıdır.' });
  }

  const existingIdx = db.users.findIndex(u => u.username.toLowerCase() === cleanUser.toLowerCase());
  if (existingIdx >= 0) {
    db.users[existingIdx].password = cleanPass;
    db.users[existingIdx].role = role === 'admin' ? 'admin' : 'user';
  } else {
    db.users.push({
      username: cleanUser,
      password: cleanPass,
      role: role === 'admin' ? 'admin' : 'user',
      createdAt: new Date().toLocaleDateString('tr-TR'),
      metaApi: createDefaultMetaApi()
    });
  }
  saveDB(db);
  res.json({ ok: true });
});

// Admin: Üye Sil
app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'Ana admin hesabı silinemez (şifresini değiştirebilirsin).' });
  }
  db.users = db.users.filter(u => u.username.toLowerCase() !== target.toLowerCase());
  Object.keys(db.sessions || {}).forEach(tk => {
    if (db.sessions[tk].username.toLowerCase() === target.toLowerCase()) {
      delete db.sessions[tk];
    }
  });
  saveDB(db);
  res.json({ ok: true });
});

// --- TELEGRAM BİLDİRİM GÖNDERİCİ ---
async function sendTelegramAlert(text) {
  if (!db.telegram || !db.telegram.enabled || !db.telegram.botToken || !db.telegram.chatId) return;
  try {
    const url = `https://api.telegram.org/bot${db.telegram.botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: db.telegram.chatId,
        text,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.error('Telegram gönderim hatası:', err.message);
  }
}

// --- ÇOKLU KULLANICI (MULTI-USER) MOBİL METATRADER KÖPRÜSÜ ---

async function resolveMetaApiRegionUrl(token, accountId) {
  try {
    const res = await fetch(`https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${accountId}`, {
      headers: { 'auth-token': token }
    });
    if (!res.ok) return 'https://mt-client-api-v1.london.agiliumtrade.ai';
    const data = await res.json();
    const region = data.region || 'london';
    return `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
  } catch (e) {
    return 'https://mt-client-api-v1.london.agiliumtrade.ai';
  }
}

async function userMetaApiRequest(userObj, payload) {
  const mt = userObj.metaApi;
  if (!mt || !mt.enabled || !mt.token || !mt.accountId) return null;
  try {
    if (!mt.regionUrl) {
      mt.regionUrl = await resolveMetaApiRegionUrl(mt.token, mt.accountId);
      saveDB(db);
    }
    const url = `${mt.regionUrl}/users/current/accounts/${mt.accountId}/trade`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'auth-token': mt.token
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error(`[${userObj.username}] Mobil MT emir hatası:`, err.message);
    return null;
  }
}

// Tüm bağlı üyelerin MetaTrader hesaplarında aynı anda kendi lotlarıyla işlem açar
async function openMobileMTTradeForAllUsers(tradeObj) {
  const isLong = tradeObj.direction === 'LONG';
  if (!tradeObj.userPositions) tradeObj.userPositions = {};

  const connectedUsers = (db.users || []).filter(
    u => u.metaApi && u.metaApi.enabled && u.metaApi.token && u.metaApi.accountId
  );

  await Promise.allSettled(
    connectedUsers.map(async (u) => {
      const lotSize = Math.max(0.01, Number(u.metaApi.lot) || 0.05);
      const symbol = (u.metaApi.symbol || 'XAUUSD').trim();

      const res = await userMetaApiRequest(u, {
        actionType: isLong ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        symbol,
        volume: Number(lotSize.toFixed(2)),
        stopLoss: Number(tradeObj.sl),
        takeProfit: Number(tradeObj.tp2),
        comment: `XAU_PRO_${u.username}`
      });

      if (res && (res.orderId || res.positionId)) {
        tradeObj.userPositions[u.username] = {
          positionId: res.positionId || res.orderId,
          volume: lotSize,
          symbol
        };
        console.log(`📱 [${u.username}] Mobil MT'de ${tradeObj.direction} (${lotSize} Lot) açıldı!`);
      }
    })
  );
  saveDB(db);
}

// Tüm bağlı üyelerde Stop-Loss'u girişe (Başabaş / Erken Zırh) çeker
async function moveAllUsersMTToBreakeven(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connectedUsers = (db.users || []).filter(u => tradeObj.userPositions[u.username]);

  await Promise.allSettled(
    connectedUsers.map(async (u) => {
      const posInfo = tradeObj.userPositions[u.username];
      await userMetaApiRequest(u, {
        actionType: 'POSITION_MODIFY',
        positionId: String(posInfo.positionId),
        stopLoss: Number(tradeObj.entry),
        takeProfit: Number(tradeObj.tp2)
      });
    })
  );
}

// Tüm bağlı üyelerde TP1 vurduğunda %80 kısmi kapanış yapar ve stopu girişe çeker
async function partialCloseAllUsersMTAtTP1(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connectedUsers = (db.users || []).filter(u => tradeObj.userPositions[u.username]);

  await Promise.allSettled(
    connectedUsers.map(async (u) => {
      const posInfo = tradeObj.userPositions[u.username];
      const totalVol = Number(posInfo.volume || u.metaApi.lot || 0.05);
      const closeVol = Math.floor(totalVol * 0.80 * 100) / 100;

      if (closeVol >= 0.01 && (totalVol - closeVol) >= 0.01) {
        await userMetaApiRequest(u, {
          actionType: 'POSITION_PARTIAL',
          positionId: String(posInfo.positionId),
          volume: Number(closeVol.toFixed(2))
        });
      }
      await userMetaApiRequest(u, {
        actionType: 'POSITION_MODIFY',
        positionId: String(posInfo.positionId),
        stopLoss: Number(tradeObj.entry),
        takeProfit: Number(tradeObj.tp2)
      });
    })
  );
}

// Tüm bağlı üyelerde açık pozisyonu tamamen kapatır
async function closeAllUsersMTTrade(tradeObj) {
  if (!tradeObj || !tradeObj.userPositions) return;
  const connectedUsers = (db.users || []).filter(u => tradeObj.userPositions[u.username]);

  await Promise.allSettled(
    connectedUsers.map(async (u) => {
      const posInfo = tradeObj.userPositions[u.username];
      await userMetaApiRequest(u, {
        actionType: 'POSITION_CLOSE_ID',
        positionId: String(posInfo.positionId)
      });
    })
  );
}

// --- KULLANICI METATRADER AYAR KAYDETME & BAĞLANTI TEST API'LERİ ---

// 1. Üyenin Kendi MetaTrader Ayarlarını Kaydetmesi (Tüm Üyeler Kullanabilir)
app.post('/api/metaapi-config', requireAuth, async (req, res) => {
  const { token, accountId, symbol, lot } = req.body;
  const cleanToken = (token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
  const cleanAcc = (accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
  const regionUrl = cleanToken && cleanAcc ? await resolveMetaApiRegionUrl(cleanToken, cleanAcc) : '';

  req.user.metaApi = {
    ...createDefaultMetaApi(),
    ...(req.user.metaApi || {}),
    token: cleanToken,
    accountId: cleanAcc,
    symbol: (symbol || 'XAUUSD').trim(),
    lot: Math.max(0.01, Number(lot) || 0.05),
    regionUrl,
    enabled: Boolean(cleanToken && cleanAcc)
  };
  saveDB(db);

  res.json({
    ok: true,
    enabled: req.user.metaApi.enabled,
    symbol: req.user.metaApi.symbol,
    lot: req.user.metaApi.lot,
    regionUrl
  });
});

// 2. Üyenin Kendi Lot ve Kasa Ayarını Güncellemesi (Tüm Üyeler Kullanabilir)
app.post('/api/update-lot', requireAuth, (req, res) => {
  const { lot, balance, riskPct } = req.body;
  if (!req.user.metaApi) req.user.metaApi = createDefaultMetaApi();
  if (lot) req.user.metaApi.lot = Math.max(0.01, Number(lot));
  if (balance) req.user.metaApi.balance = Number(balance);
  if (riskPct) req.user.metaApi.riskPct = Number(riskPct);
  saveDB(db);
  res.json({ ok: true, lot: req.user.metaApi.lot });
});

// 3. YENİ: METATRADER BAĞLANTI VE BAKİYE TEST BUTONU API'Sİ
app.post('/api/metaapi-test', requireAuth, async (req, res) => {
  try {
    const token = (req.body.token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
    const accountId = (req.body.accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');

    if (!token || !accountId) {
      return res.status(400).json({ ok: false, error: 'Lütfen önce MetaApi Token ve Account ID girin.' });
    }

    // Adım 1: Hesap durumunu ve bölgesini kontrol et
    const provRes = await fetch(`https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${accountId}`, {
      headers: { 'auth-token': token }
    });

    if (!provRes.ok) {
      return res.status(400).json({
        ok: false,
        error: 'MetaApi Token veya Account ID hatalı! Lütfen bilgileri kontrol edin.'
      });
    }

    const provData = await provRes.json();
    const region = provData.region || 'london';
    const regionUrl = `https://mt-client-api-v1.${region}.agiliumtrade.ai`;

    // Adım 2: Canlı MetaTrader Bakiye, Varlık ve Sunucu bilgisini çek
    const infoRes = await fetch(`${regionUrl}/users/current/accounts/${accountId}/account-information`, {
      headers: { 'auth-token': token }
    });

    if (!infoRes.ok) {
      return res.json({
        ok: true,
        partial: true,
        message: `Hesap bulundu (${provData.name || provData.login} - ${provData.server}), ancak broker bağlantısı henüz hazırlanıyor (Durum: ${provData.connectionStatus || provData.state}). 1 dakika sonra tekrar deneyin.`
      });
    }

    const info = await infoRes.json();
    res.json({
      ok: true,
      broker: info.broker || provData.server || 'MetaTrader',
      login: info.login || provData.login || '-',
      name: info.name || provData.name || '-',
      balance: info.balance,
      equity: info.equity,
      currency: info.currency || 'USD',
      connectionStatus: provData.connectionStatus || 'CONNECTED'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Bağlantı testi sırasında hata: ' + err.message });
  }
});

// 4. YENİ: TELEFONDAKİ METATRADER'A 0.01 LOT CANLI TEST EMRİ GÖNDER (AÇ & 3SN SONRA KAPAT)
app.post('/api/metaapi-test-trade', requireAuth, async (req, res) => {
  try {
    const token = (req.body.token || '').trim() || (req.user.metaApi ? req.user.metaApi.token : '');
    const accountId = (req.body.accountId || '').trim() || (req.user.metaApi ? req.user.metaApi.accountId : '');
    const symbol = (req.body.symbol || (req.user.metaApi ? req.user.metaApi.symbol : 'XAUUSD')).trim();

    if (!token || !accountId) {
      return res.status(400).json({ ok: false, error: 'Lütfen önce MetaApi Token ve Account ID girip kaydedin.' });
    }

    const regionUrl = await resolveMetaApiRegionUrl(token, accountId);
    const tradeUrl = `${regionUrl}/users/current/accounts/${accountId}/trade`;

    // 0.01 Lot Test Alım Emri Gönder
    const openRes = await fetch(tradeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'auth-token': token },
      body: JSON.stringify({
        actionType: 'ORDER_TYPE_BUY',
        symbol,
        volume: 0.01,
        comment: 'XAU_BAGLANTI_TESTI'
      })
    });
    const openData = await openRes.json();

    if (!openRes.ok || (openData.stringCode && openData.stringCode.includes('ERR'))) {
      return res.status(400).json({
        ok: false,
        error: `Test emri açılamadı (${openData.message || openData.stringCode || 'Sembol adını kontrol edin: XAUUSD / GOLD'}).`
      });
    }

    const posId = openData.positionId || openData.orderId;

    // 3 Saniye Sonra Test İşlemini Otomatik Kapat
    if (posId) {
      setTimeout(async () => {
        try {
          await fetch(tradeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'auth-token': token },
            body: JSON.stringify({
              actionType: 'POSITION_CLOSE_ID',
              positionId: String(posId)
            })
          });
        } catch (e) {}
      }, 3000);
    }

    res.json({
      ok: true,
      positionId: posId,
      message: `✅ Başarılı! Telefonundaki MetaTrader'da 0.01 Lot ${symbol} test işlemi açıldı (ID: #${posId}) ve 3 saniye içinde otomatik kapatılıyor!`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Test işlemi hatası: ' + err.message });
  }
});

// --- 1. TEKNİK İNDİKATÖR HESAPLAMA FONKSİYONLARI ---

function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSISeries(closes, period = 14) {
  if (closes.length <= period) return [50];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsiSeries = [];

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiSeries.push(100 - 100 / (1 + rs));
  }
  return rsiSeries.length ? rsiSeries : [50];
}

function calcStochRSI(closes, period = 14) {
  const rsiSeries = calcRSISeries(closes, period);
  if (rsiSeries.length < period) return 50;
  const recent = rsiSeries.slice(-period);
  const minRSI = Math.min(...recent);
  const maxRSI = Math.max(...recent);
  if (maxRSI === minRSI) return 50;
  return ((rsiSeries[rsiSeries.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function calcATR(candles, period = 14) {
  if (candles.length <= period) return 2.5;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
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
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );

    if (i <= period) {
      trSmooth += tr;
      pdmSmooth += pdm;
      mdmSmooth += mdm;
    } else {
      trSmooth = trSmooth - trSmooth / period + tr;
      pdmSmooth = pdmSmooth - pdmSmooth / period + pdm;
      mdmSmooth = mdmSmooth - mdmSmooth / period + mdm;
      const pdi = trSmooth === 0 ? 0 : (pdmSmooth / trSmooth) * 100;
      const mdi = trSmooth === 0 ? 0 : (mdmSmooth / trSmooth) * 100;
      const dx = pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
      dxs.push(dx);
    }
  }
  if (dxs.length === 0) return 20;
  return dxs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, dxs.length);
}

function calcVWAP(candles) {
  const slice = candles.slice(-60);
  let cumPV = 0, cumVol = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumPV += typical * vol;
    cumVol += vol;
  }
  return cumVol === 0 ? slice[slice.length - 1].close : cumPV / cumVol;
}

// --- ATR + İĞNE KORUMALI (SWING HIGH/LOW) SL / TP MOTORU ---

function calculateSmartTradePlan(spotPrice, isShort, m5Candles, m15Candles, m5Atr) {
  const effectiveATR = Math.max(m5Atr, 2.2);

  const recentM5 = m5Candles.slice(-12);
  const recentM15 = m15Candles.slice(-8);

  const swingLowM5 = Math.min(...recentM5.map(c => c.low));
  const swingHighM5 = Math.max(...recentM5.map(c => c.high));
  const structureLowM15 = Math.min(...recentM15.map(c => c.low));
  const structureHighM15 = Math.max(...recentM15.map(c => c.high));

  const wickBuffer = effectiveATR * 0.25;

  let slDist, tp1Dist, tp2Dist;

  if (!isShort) {
    const rawWickSLDist = spotPrice - (swingLowM5 - wickBuffer);
    slDist = Math.max(effectiveATR * 1.25, Math.min(effectiveATR * 2.3, Math.max(rawWickSLDist, effectiveATR * 1.45)));

    const baseTp1Dist = Math.max(effectiveATR * 1.9, slDist * 1.35);
    const distToM15High = structureHighM15 - spotPrice;
    if (distToM15High > effectiveATR * 1.3 && distToM15High < baseTp1Dist + 1.2) {
      tp1Dist = Math.max(effectiveATR * 1.25, distToM15High - 0.35);
    } else {
      tp1Dist = baseTp1Dist;
    }

    tp2Dist = Math.max(effectiveATR * 3.4, slDist * 2.3);
  } else {
    const rawWickSLDist = (swingHighM5 + wickBuffer) - spotPrice;
    slDist = Math.max(effectiveATR * 1.25, Math.min(effectiveATR * 2.3, Math.max(rawWickSLDist, effectiveATR * 1.45)));

    const baseTp1Dist = Math.max(effectiveATR * 1.9, slDist * 1.35);
    const distToM15Low = spotPrice - structureLowM15;
    if (distToM15Low > effectiveATR * 1.3 && distToM15Low < baseTp1Dist + 1.2) {
      tp1Dist = Math.max(effectiveATR * 1.25, distToM15Low - 0.35);
    } else {
      tp1Dist = baseTp1Dist;
    }

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

// --- BİRLEŞTİRİLMİŞ TEKİL HİBRİT PUANLAMA MOTORU ---

function computeSignalScore(m5, m15, h1, dxyChange15m, us10yChange15m, newsScore, m5Candles) {
  let score = 0;
  const reasons = [];

  let h1MainDir = 0;
  if (h1.price > h1.ema21 && h1.ema21 > h1.ema50) {
    score += 20;
    h1MainDir = 1;
    reasons.push({ type: 'pos', text: 'H1 Ana Trend yükselişte (EMA 21 ve 50 üzerinde)' });
  } else if (h1.price < h1.ema21 && h1.ema21 < h1.ema50) {
    score -= 20;
    h1MainDir = -1;
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
    reasons.push({ type: 'pos', text: 'M5 Fiyat gün içi VWAP çizgisinin üzerinde (Alıcılar baskın)' });
  } else {
    score -= 10;
    reasons.push({ type: 'neg', text: 'M5 Fiyat gün içi VWAP çizgisinin altında (Satıcılar baskın)' });
  }

  if (m5.ema9 > m5.ema21 && m5.ema21 > m5.ema50) {
    score += 15;
    reasons.push({ type: 'pos', text: 'M5 EMA (9-21-50) dizilimi yukarı yönlü momentumu onaylıyor' });
  } else if (m5.ema9 < m5.ema21 && m5.ema21 < m5.ema50) {
    score -= 15;
    reasons.push({ type: 'neg', text: 'M5 EMA (9-21-50) dizilimi aşağı yönlü momentumu onaylıyor' });
  }

  if (m15.trend.includes('BULLISH') && m5.stochRsi < 35) {
    score += 15;
    reasons.push({ type: 'pos', text: 'M5 StochRSI geri çekilme bölgesinde: Trend yönünde ucuzluk fırsatı' });
  } else if (m15.trend.includes('BEARISH') && m5.stochRsi > 65) {
    score -= 15;
    reasons.push({ type: 'neg', text: 'M5 StochRSI tepki bölgesinde: Düşüş yönünde satış fırsatı' });
  } else if (m5.rsi > 54 && m5.rsi < 72) {
    score += 8;
  } else if (m5.rsi < 46 && m5.rsi > 28) {
    score -= 8;
  }

  if (dxyChange15m < -0.02) {
    score += 15;
    reasons.push({ type: 'pos', text: `Dolar Endeksi (DXY) 15dk'da düşüşte (%${dxyChange15m.toFixed(2)}) -> Altını destekliyor` });
  } else if (dxyChange15m > 0.02) {
    score -= 15;
    reasons.push({ type: 'neg', text: `Dolar Endeksi (DXY) 15dk'da yükselişte (+%${dxyChange15m.toFixed(2)}) -> Altını baskılıyor` });
  }

  if (us10yChange15m < -0.05) score += 5;
  else if (us10yChange15m > 0.05) score -= 5;

  if (newsScore !== 0) {
    score += newsScore;
  }

  if (m5.adx < 18) {
    score = Math.round(score * 0.7);
    reasons.push({ type: 'warn', text: `Uyarı: M5 ADX (${m5.adx.toFixed(1)}) düşük. Piyasa yatayda sıkışıyor.` });
  }

  if (score > 0 && h1MainDir === -1 && score < 75) {
    score = 30;
    reasons.push({ type: 'warn', text: 'Ana Trend Kalkanı: H1 ana trendi güçlü düşüşte olduğu için zayıf LONG sinyali engellendi.' });
  } else if (score < 0 && h1MainDir === 1 && score > -75) {
    score = -30;
    reasons.push({ type: 'warn', text: 'Ana Trend Kalkanı: H1 ana trendi güçlü yükselişte olduğu için zayıf SHORT sinyali engellendi.' });
  }

  if (m5Candles && m5Candles.length >= 3) {
    const prev2Close = m5Candles[m5Candles.length - 3].close;
    const recentJump = m5.price - prev2Close;
    if (score < -45 && recentJump < -(m5.atr * 1.75)) {
      score = -35;
      reasons.push({ type: 'warn', text: 'Geç Kalmış Mum Koruması: Fiyat son 10dk içinde zaten çok sert düştü, dipten satış engellendi.' });
    } else if (score > 45 && recentJump > (m5.atr * 1.75)) {
      score = 35;
      reasons.push({ type: 'warn', text: 'Geç Kalmış Mum Koruması: Fiyat son 10dk içinde zaten çok sert fırladı, tepeden alış engellendi.' });
    }
  }

  score = Math.max(-100, Math.min(100, score));
  return { score, reasons };
}

// --- 2. CANLI HABER OKUMA MOTORU ---

const BULLISH_RULES = [
  { words: ['rate cut', 'dovish', 'cuts rates', 'fed cut', 'lower rates'], weight: 4, tag: 'Güvercin FED / Faiz İndirimi' },
  { words: ['war', 'missile', 'attack', 'middle east', 'israel', 'iran', 'ukraine', 'geopolitical', 'tensions', 'tariff', 'trade war'], weight: 4, tag: 'Jeopolitik Risk / Güvenli Liman' },
  { words: ['safe haven', 'safe-haven', 'central bank buying', 'gold surges', 'gold rallies', 'record high', 'gold jumps', 'gold climbs', 'bullish'], weight: 3, tag: 'Kurumsal Altın Talebi' },
  { words: ['weak dollar', 'dollar falls', 'dollar drops', 'dollar slips', 'dxy drops', 'yields fall', 'yields drop', 'inflation cools', 'recession'], weight: 3, tag: 'Zayıf Dolar / Düşen Faiz' }
];

const BEARISH_RULES = [
  { words: ['rate hike', 'hawkish', 'higher for longer', 'delays cut', 'no rate cut', 'pause'], weight: -4, tag: 'Şahin FED / Faiz Baskısı' },
  { words: ['strong dollar', 'dollar rises', 'dollar jumps', 'dollar strengthens', 'yields rise', 'yields surge', 'yields jump'], weight: -3, tag: 'Güçlü Dolar / Tahvil Yükselişi' },
  { words: ['gold drops', 'gold falls', 'gold slides', 'gold tumbles', 'profit-taking', 'profit taking', 'sell-off', 'bearish'], weight: -3, tag: 'Altında Kar Satışı' },
  { words: ['ceasefire', 'peace deal', 'truce', 'de-escalation', 'strong jobs', 'hot inflation'], weight: -3, tag: 'Risk İştahı / Güçlü ABD Verisi' }
];

async function getGoldNewsSentiment() {
  const now = Date.now();
  if (newsCache.data && now - newsCache.timestamp < 3 * 60 * 1000) {
    return newsCache.data;
  }

  try {
    const rssUrl = 'https://news.google.com/rss/search?q=(XAUUSD+OR+%22Gold+price%22+OR+%22Federal+Reserve%22+OR+%22US+Dollar%22)+when:12h&hl=en-US&gl=US&ceid=US:en';
    const res = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await res.text();

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items = [];
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1];
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (titleMatch) {
        const cleanTitle = titleMatch[1]
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
        items.push({
          title: cleanTitle,
          pubDate: pubDateMatch ? new Date(pubDateMatch[1]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : ''
        });
      }
    }

    let rawScore = 0;
    const analyzedNews = items.map(item => {
      const lower = item.title.toLowerCase();
      let itemScore = 0;
      const tags = [];

      BULLISH_RULES.forEach(rule => {
        if (rule.words.some(w => lower.includes(w))) {
          itemScore += rule.weight;
          if (!tags.includes(rule.tag)) tags.push(rule.tag);
        }
      });

      BEARISH_RULES.forEach(rule => {
        if (rule.words.some(w => lower.includes(w))) {
          itemScore += rule.weight;
          if (!tags.includes(rule.tag)) tags.push(rule.tag);
        }
      });

      rawScore += itemScore;
      let impact = 'NÖTR';
      if (itemScore > 0) impact = 'BULLISH (ALTIN POZİTİF)';
      else if (itemScore < 0) impact = 'BEARISH (ALTIN NEGATİF)';

      return {
        ...item,
        score: itemScore,
        impact,
        tag: tags.length > 0 ? tags.join(' • ') : 'Genel Piyasa Akışı'
      };
    });

    const normalizedScore = Math.max(-15, Math.min(15, rawScore));
    const result = {
      sentimentScore: normalizedScore,
      summary: normalizedScore >= 4 ? 'POZİTİF (Altın Lehine Haber Akışı)' : (normalizedScore <= -4 ? 'NEGATİF (Dolar Lehine Akış)' : 'DENGELİ / NÖTR HABER AKIŞI'),
      headlines: analyzedNews.slice(0, 6)
    };

    newsCache = { timestamp: now, data: result };
    return result;
  } catch (err) {
    return { sentimentScore: 0, summary: 'HABER VERİSİ BEKLENİYOR', headlines: [] };
  }
}

// --- 3. EKONOMİK TAKVİM VE KILL-SWITCH ---

async function getEconomicCalendar() {
  const now = Date.now();
  if (calendarCache.data && now - calendarCache.timestamp < 5 * 60 * 1000) {
    return calendarCache.data;
  }

  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const events = await res.json();

    const allHighUsdTimestamps = events
      .filter(e => e.country === 'USD' && e.impact === 'High')
      .map(e => ({ title: e.title, timestampMs: new Date(e.date).getTime() }));

    const usdEvents = events
      .filter(e => e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium'))
      .map(e => {
        const eventTime = new Date(e.date).getTime();
        const diffMinutes = Math.round((eventTime - now) / 60000);
        return {
          title: e.title,
          impact: e.impact,
          timeStr: new Date(e.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          dateStr: new Date(e.date).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
          forecast: e.forecast || '-',
          previous: e.previous || '-',
          diffMinutes
        };
      })
      .filter(e => e.diffMinutes >= -60 && e.diffMinutes <= 2160)
      .sort((a, b) => a.diffMinutes - b.diffMinutes);

    const activeDangerEvent = usdEvents.find(
      e => e.impact === 'High' && e.diffMinutes >= -15 && e.diffMinutes <= 30
    );

    const result = {
      killSwitch: Boolean(activeDangerEvent),
      dangerEvent: activeDangerEvent || null,
      upcomingEvents: usdEvents.slice(0, 5),
      allHighUsdTimestamps
    };

    calendarCache = { timestamp: now, data: result };
    return result;
  } catch (err) {
    return { killSwitch: false, dangerEvent: null, upcomingEvents: [], allHighUsdTimestamps: [] };
  }
}

// --- 4. FİYAT VERİSİ ÇEKME SERVİSLERİ ---

async function getOandaSpotAndMacro() {
  try {
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: { tickers: ['OANDA:XAUUSD', 'TVC:DXY', 'TVC:US10Y'] },
        columns: ['close', 'change', 'change|5', 'change|15', 'high', 'low']
      })
    });
    const json = await res.json();
    const map = {};
    if (json && json.data) {
      json.data.forEach(item => {
        map[item.s] = {
          price: item.d[0],
          changeDaily: item.d[1],
          change5m: item.d[2],
          change15m: item.d[3],
          high: item.d[4],
          low: item.d[5]
        };
      });
    }
    return map;
  } catch (err) {
    return {};
  }
}

async function getCandles(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data.chart.result[0];
  const q = result.indicators.quote[0];
  const ts = result.timestamp || [];
  const candles = [];

  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] != null && q.high[i] != null && q.low[i] != null) {
      candles.push({
        time: ts[i],
        open: q.open[i],
        high: q.high[i],
        low: q.low[i],
        close: q.close[i],
        volume: q.volume[i] || 100
      });
    }
  }
  return candles;
}

function analyzeTimeframe(candles) {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const rsiSeries = calcRSISeries(closes, 14);
  const rsi = rsiSeries[rsiSeries.length - 1];
  const stochRsi = calcStochRSI(closes, 14);
  const atr = calcATR(candles, 14);
  const adx = calcADX(candles, 14);
  const vwap = calcVWAP(candles);

  let trend = 'NÖTR';
  if (ema9 > ema21 && price > ema21) trend = 'BULLISH (YÜKSELİŞ)';
  else if (ema9 < ema21 && price < ema21) trend = 'BEARISH (DÜŞÜŞ)';

  return { price, ema9, ema21, ema50, rsi, stochRsi, atr, adx, vwap, trend };
}

// --- 5. AKTİF İŞLEM TAKİP MOTORU (TÜM ÜYELERİN MT HESAPLARINI SENKRON YÖNETİR) ---

function checkActiveTradeOnTick(spotPrice) {
  if (!db.activeTrade || !spotPrice) return null;

  let soundEvent = null;
  const t = db.activeTrade;
  const isLong = t.direction === 'LONG';
  t.currentPrice = spotPrice;
  t.unrealizedPnL = Number((isLong ? spotPrice - t.entry : t.entry - spotPrice).toFixed(2));

  // 1. TP2 (Ana Hedef) Vurdu mu?
  if ((isLong && spotPrice >= t.tp2) || (!isLong && spotPrice <= t.tp2)) {
    const profit = Number(Math.abs(t.tp2 - t.entry).toFixed(2));
    const closed = {
      ...t,
      closePrice: spotPrice,
      closeTime: new Date().toLocaleTimeString('tr-TR'),
      status: 'TP2 TAM HEDEF 🎯',
      result: 'WIN',
      profitDollar: profit
    };
    closeAllUsersMTTrade(t);
    db.history.unshift(closed);
    db.activeTrade = null;
    saveDB(db);
    soundEvent = 'TP_HIT';
    sendTelegramAlert(`🎯 <b>XAU/USD TP2 ANA HEDEF VURDU!</b>\nYön: ${closed.direction}\nNet Kâr: <b>+$${profit} / ons</b>`);
    return soundEvent;
  }

  // 2. TP1 Vurdu mu? -> %80 Kâr Al + Stopu Girişe Çek
  if (!t.tp1Hit && ((isLong && spotPrice >= t.tp1) || (!isLong && spotPrice <= t.tp1))) {
    t.tp1Hit = true;
    t.earlyShieldHit = true;
    t.sl = t.entry;
    saveDB(db);
    soundEvent = 'TP_HIT';
    partialCloseAllUsersMTAtTP1(t);
    sendTelegramAlert(`✅ <b>XAU/USD TP1 VURDU! (%80 Kâr Alındı)</b>\nYön: ${t.direction}\n🔒 Tüm bağlı MT hesaplarında Stop-Loss girişe ($${t.entry}) çekildi!`);
  }

  // 3. ERKEN ZIRH: Fiyat TP1 yolunun %60'ını gittiyse Stopu Girişe Çek
  if (!t.tp1Hit && !t.earlyShieldHit) {
    const tp1Dist = Math.abs(t.tp1 - t.entry);
    const shieldTriggerPrice = isLong ? t.entry + tp1Dist * 0.60 : t.entry - tp1Dist * 0.60;
    if ((isLong && spotPrice >= shieldTriggerPrice) || (!isLong && spotPrice <= shieldTriggerPrice)) {
      t.earlyShieldHit = true;
      t.sl = t.entry;
      saveDB(db);
      moveAllUsersMTToBreakeven(t);
      sendTelegramAlert(`🛡️ <b>ERKEN ZIRH AKTİF!</b>\nFiyat TP1 yolunun %60'ına ulaştı, tüm bağlı MT hesaplarında Stop-Loss girişe ($${t.entry}) çekildi!`);
    }
  }

  // 4. Stop-Loss Vurdu mu?
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
    } else {
      profit = -Number(Math.abs(t.entry - t.sl).toFixed(2));
      soundEvent = 'SL_HIT';
    }

    const closed = {
      ...t,
      closePrice: spotPrice,
      closeTime: new Date().toLocaleTimeString('tr-TR'),
      status: statusText,
      result: resultType,
      profitDollar: profit
    };
    closeAllUsersMTTrade(t);
    db.history.unshift(closed);
    db.activeTrade = null;
    saveDB(db);
    return soundEvent;
  }

  return soundEvent;
}

function getStats() {
  const total = db.history.length;
  const wins = db.history.filter(h => h.result === 'WIN').length;
  const losses = total - wins;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const totalProfit = db.history.reduce((acc, h) => acc + (Number(h.profitDollar) || 0), 0);

  return {
    total,
    wins,
    losses,
    winRate,
    totalProfit: totalProfit.toFixed(2)
  };
}

// Masaüstü MT4/MT5 Köprüsü
app.get('/api/mt-bridge', async (req, res) => {
  await syncFromFirebase();
  if (!db.activeTrade) {
    return res.send('NONE|0|NONE|0|0|0|0|0');
  }
  const t = db.activeTrade;
  const slDist = Math.abs(t.entry - (t.initialSl || t.sl)).toFixed(2);
  const tp1Dist = Math.abs(t.tp1 - t.entry).toFixed(2);
  const tp2Dist = Math.abs(t.tp2 - t.entry).toFixed(2);
  const shield = t.earlyShieldHit ? 1 : 0;
  const tp1 = t.tp1Hit ? 1 : 0;

  res.send(`ACTIVE|${t.id}|${t.direction}|${slDist}|${tp1Dist}|${tp2Dist}|${shield}|${tp1}`);
});

// --- 6. ORTAK TAM OTOMATİK MOTOR ÇALIŞTIRICISI ---

async function executeFullAnalysisEngine(currentUser = null) {
  await syncFromFirebase();

  const [tvMap, rawM5, rawM15, rawH1, newsData, calendarData] = await Promise.all([
    getOandaSpotAndMacro(),
    getCandles('GC=F', '5m', '5d'),
    getCandles('GC=F', '15m', '5d'),
    getCandles('GC=F', '1h', '1mo'),
    getGoldNewsSentiment(),
    getEconomicCalendar()
  ]);

  const oandaData = tvMap['OANDA:XAUUSD'];
  const dxyData = tvMap['TVC:DXY'] || { price: 0, change5m: 0, change15m: 0, changeDaily: 0 };
  const us10yData = tvMap['TVC:US10Y'] || { price: 0, change5m: 0, change15m: 0, changeDaily: 0 };

  const lastRawClose = rawM5[rawM5.length - 1].close;
  const spotPrice = oandaData && oandaData.price ? oandaData.price : lastRawClose;
  lastKnownSpot = spotPrice;
  const offset = spotPrice - lastRawClose;

  const calibrate = (list) => list.map(c => ({
    ...c,
    open: c.open + offset,
    high: c.high + offset,
    low: c.low + offset,
    close: c.close + offset
  }));

  const calM5 = calibrate(rawM5);
  const calM15 = calibrate(rawM15);
  const calH1 = calibrate(rawH1);

  const m5 = analyzeTimeframe(calM5);
  const m15 = analyzeTimeframe(calM15);
  const h1 = analyzeTimeframe(calH1);

  const { score, reasons } = computeSignalScore(
    m5,
    m15,
    h1,
    dxyData.change15m || 0,
    us10yData.change15m || 0,
    newsData.sentimentScore || 0,
    calM5
  );

  if (newsData.sentimentScore !== 0) {
    reasons.push({
      type: newsData.sentimentScore > 0 ? 'pos' : 'neg',
      text: `Canlı Haber Okuması (${newsData.sentimentScore > 0 ? '+' : ''}${newsData.sentimentScore} Puan): ${newsData.summary}`
    });
  }

  let signal = '⏳ BEKLE (OTOMATİK TARANIYOR)';
  let direction = 'NEUTRAL';

  if (calendarData.killSwitch) {
    signal = '⛔ VERİ SAATİ (OTOMATİK KİLİT)';
    direction = 'LOCKED';
    reasons.unshift({
      type: 'warn',
      text: `KRİTİK ABD VERİSİ (${calendarData.dangerEvent.title}) nedeniyle otomatik işlem kilitlendi.`
    });
  } else if (score >= 45) {
    signal = '🟢 LONG GİR (OTOMATİK)';
    direction = 'LONG';
  } else if (score <= -45) {
    signal = '🔴 SHORT GİR (OTOMATİK)';
    direction = 'SHORT';
  }

  const isShort = score < 0;
  const tradePlan = calculateSmartTradePlan(spotPrice, isShort, calM5, calM15, m5.atr);

  reasons.push({
    type: 'pos',
    text: !isShort
      ? `SL/TP Koruması: Son M5 Dip İğnesi ($${tradePlan.swingLow}) baz alındı + %60'ta Erken Zırh aktif.`
      : `SL/TP Koruması: Son M5 Tepe İğnesi ($${tradePlan.swingHigh}) baz alındı + %60'ta Erken Zırh aktif.`
  });

  let soundEvent = checkActiveTradeOnTick(spotPrice);

  // %100 OTOMATİK İŞLEM AÇMA (Tüm bağlı üyelerin MT hesaplarında kendi lotlarıyla açar)
  if (!db.activeTrade && !calendarData.killSwitch && Math.abs(score) >= 45) {
    const dir = score > 0 ? 'LONG' : 'SHORT';
    db.activeTrade = {
      id: Date.now(),
      openTime: new Date().toLocaleTimeString('tr-TR'),
      direction: dir,
      score,
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
    saveDB(db);
    soundEvent = 'NEW_SIGNAL';
    await openMobileMTTradeForAllUsers(db.activeTrade);
    sendTelegramAlert(`🤖 <b>OTOMATİK XAU/USD ${dir} İŞLEMİ AÇILDI! (Skor: ${score})</b>\n📍 Giriş: <b>$${tradePlan.entry}</b>\n🛑 İğne Korumalı SL: $${tradePlan.sl}\n🎯 TP1 (%80): $${tradePlan.tp1}\n🎯 TP2: $${tradePlan.tp2}`);
  }

  const userMt = currentUser && currentUser.metaApi ? currentUser.metaApi : createDefaultMetaApi();

  return {
    timestamp: new Date().toLocaleTimeString('tr-TR'),
    spotPrice: spotPrice.toFixed(2),
    score,
    signal,
    direction,
    tradePlan,
    reasons,
    timeframes: { m5, m15, h1 },
    macro: { dxy: dxyData, us10y: us10yData },
    news: newsData,
    calendar: calendarData,
    tracker: {
      activeTrade: db.activeTrade,
      history: db.history.slice(0, 15),
      stats: getStats(),
      soundEvent,
      telegramEnabled: Boolean(db.telegram && db.telegram.enabled),
      metaApiEnabled: Boolean(userMt.enabled),
      metaSymbol: userMt.symbol || 'XAUUSD',
      userLot: userMt.lot || 0.05
    }
  };
}

// 7/24 Bulut Cron Tetikleyicisi
app.get('/api/cron', async (req, res) => {
  try {
    const result = await executeFullAnalysisEngine(null);
    res.json({
      ok: true,
      time: result.timestamp,
      spotPrice: result.spotPrice,
      score: result.score,
      signal: result.signal,
      activeTrade: Boolean(result.tracker.activeTrade)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- 8. BACKTEST MOTORU ---

app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const hours = Number(req.query.hours) || 24;
    const mode = req.query.mode || 'today';

    const [tvMap, rawM5, rawM15, rawH1, rawDxyM5, calendarData] = await Promise.all([
      getOandaSpotAndMacro(),
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

    const calibrate = (list) => list.map(c => ({
      ...c,
      open: c.open + offset,
      high: c.high + offset,
      low: c.low + offset,
      close: c.close + offset
    }));

    const calM5 = calibrate(rawM5);
    const calM15 = calibrate(rawM15);
    const calH1 = calibrate(rawH1);

    const nowSec = Math.floor(Date.now() / 1000);
    let startTimestampSec = nowSec - hours * 3600;
    if (mode === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      startTimestampSec = Math.floor(todayStart.getTime() / 1000);
    }

    const dxyMap = {};
    rawDxyM5.forEach((c, idx) => {
      if (idx >= 3 && rawDxyM5[idx - 3].close > 0) {
        dxyMap[c.time] = ((c.close - rawDxyM5[idx - 3].close) / rawDxyM5[idx - 3].close) * 100;
      }
    });

    let simActive = null;
    let lastStopCandleIndex = -99;
    const simTrades = [];

    for (let i = 30; i < calM5.length; i++) {
      const c = calM5[i];
      if (c.time < startTimestampSec) continue;

      const timeStr = new Date(c.time * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(c.time * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });

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

      if (i - lastStopCandleIndex < 2) continue;

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

      const { score } = computeSignalScore(m5, m15, h1, dxyChg, 0, 0, m5Slice);

      if (Math.abs(score) >= 45) {
        const isShort = score < 0;
        const plan = calculateSmartTradePlan(c.close, isShort, m5Slice, m15Slice, m5.atr);
        simActive = {
          openTime: `${dateStr} ${timeStr}`,
          direction: isShort ? 'SHORT' : 'LONG',
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
    const totalProfit = simTrades.reduce((acc, t) => acc + t.profitDollar, 0);

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

// --- 9. HIZLI VİTES API (2SN) & ANA VİTES API (15SN) ---

app.get('/api/tick', requireAuth, async (req, res) => {
  try {
    const tvMap = await getOandaSpotAndMacro();
    const oandaData = tvMap['OANDA:XAUUSD'];
    const dxyData = tvMap['TVC:DXY'] || null;
    const us10yData = tvMap['TVC:US10Y'] || null;

    const spotPrice = oandaData && oandaData.price ? oandaData.price : lastKnownSpot;
    if (spotPrice) lastKnownSpot = spotPrice;

    const soundEvent = checkActiveTradeOnTick(spotPrice);
    const userMt = req.user.metaApi || createDefaultMetaApi();

    res.json({
      timestamp: new Date().toLocaleTimeString('tr-TR'),
      spotPrice: spotPrice ? spotPrice.toFixed(2) : null,
      macro: { dxy: dxyData, us10y: us10yData },
      tracker: {
        activeTrade: db.activeTrade,
        history: db.history.slice(0, 15),
        stats: getStats(),
        soundEvent,
        metaApiEnabled: Boolean(userMt.enabled),
        metaSymbol: userMt.symbol || 'XAUUSD',
        userLot: userMt.lot || 0.05
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analyze', requireAuth, async (req, res) => {
  try {
    const result = await executeFullAnalysisEngine(req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Veri çekilirken hata oluştu: ' + error.message });
  }
});

// Admin: Telegram Ayarları
app.post('/api/telegram-config', requireAdmin, async (req, res) => {
  const { botToken, chatId } = req.body;
  db.telegram = {
    botToken: (botToken || '').trim(),
    chatId: (chatId || '').trim(),
    enabled: Boolean(botToken && chatId)
  };
  saveDB(db);

  if (db.telegram.enabled) {
    await sendTelegramAlert(`🔔 <b>OANDA:XAUUSD Sinyal Terminali Bağlandı!</b>`);
  }
  res.json({ ok: true, enabled: db.telegram.enabled });
});

setInterval(() => {
  executeFullAnalysisEngine(null).catch(() => {});
}, 15000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`👑 XAU/USD Çoklu Üye MT + Firebase Sunucusu Aktif!`);
  console.log(`🔥 Firebase DB: ${FIREBASE_DB_URL}`);
  console.log(`👉 Adres: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

module.exports = app;