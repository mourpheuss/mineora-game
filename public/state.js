// ================= STATE & FIREBASE LIVE MEMORY ENGINE (state.js) =================

// Firebase Yapılandırması
const _firebaseCfg = {
  apiKey: "AIzaSyCLyoK5TV3uCdUeN6nNOI2eQ5vm3Q-SS2w",
  authDomain: "mineora-web.firebaseapp.com",
  projectId: "mineora-web",
  storageBucket: "mineora-web.firebasestorage.app",
  messagingSenderId: "648898617395",
  appId: "1:648898617395:web:23902a04f19da700010346",
  databaseURL: "https://mineora-web-default-rtdb.firebaseio.com"
};

// Global Firebase Nesnesi
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(_firebaseCfg);
}
var fbDb = (typeof firebase !== 'undefined') ? firebase.database() : null;

// Bellekteki Aktif Kullanıcı & Tüm Kullanıcılar Havuzu
var CurrentUser = null;
var _allUsersCache = {};

// 1. KULLANICIYI YÜKLE & CANLI EŞİTLE
function loadUserWorld(username) {
  if (!username) {
    username = sessionStorage.getItem('mineora_active_session') || 'admin';
  }
  const uKey = username.toLowerCase();

  // Önce yerel hafızadan hızlıca oku
  const localRaw = localStorage.getItem(`mineora_user_${uKey}`);
  if (localRaw) {
    try { CurrentUser = JSON.parse(localRaw); } catch(e){}
  }

  if (!CurrentUser) {
    CurrentUser = {
      username: username,
      pass: "123456",
      mina: 0.00,
      role: "Verified Staker",
      referredBy: "",
      referral_chain: [],
      refCode: `MINE-${username.toUpperCase()}-777`,
      stakes: [],
      logs: []
    };
  }

  // Firebase üzerinden canlı dinleyici başlat
  if (fbDb) {
    fbDb.ref(`users/${uKey}`).on('value', snap => {
      const liveData = snap.val();
      if (liveData) {
        CurrentUser = liveData;
        localStorage.setItem(`mineora_user_${uKey}`, JSON.stringify(liveData));
        if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
        if (typeof renderUserStakesList === 'function') renderUserStakesList();
      } else {
        fbDb.ref(`users/${uKey}`).set(CurrentUser);
      }
    });

    // Tüm kullanıcıları referans ağacı için belleğe çek
    fbDb.ref('users').on('value', snap => {
      _allUsersCache = snap.val() || {};
      if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
    });
  }
}

// 2. KULLANICI DEĞİŞİKLİKLERİNİ KAYDET
function saveUserWorld() {
  if (!CurrentUser) return;
  const uKey = CurrentUser.username.toLowerCase();
  localStorage.setItem(`mineora_user_${uKey}`, JSON.stringify(CurrentUser));

  if (fbDb) {
    fbDb.ref(`users/${uKey}`).set(CurrentUser);
  }
}

function updateHUD() {
  saveUserWorld();
  if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
}

// 3. TEKİL KULLANICI OKU & YAZ
function getStoredUser(username) {
  if (!username) return null;
  const uKey = username.toLowerCase();
  if (_allUsersCache[uKey]) return _allUsersCache[uKey];
  const local = localStorage.getItem(`mineora_user_${uKey}`);
  return local ? JSON.parse(local) : null;
}

function saveStoredUser(userObj) {
  if (!userObj || !userObj.username) return;
  const uKey = userObj.username.toLowerCase();
  _allUsersCache[uKey] = userObj;
  localStorage.setItem(`mineora_user_${uKey}`, JSON.stringify(userObj));
  if (fbDb) {
    fbDb.ref(`users/${uKey}`).set(userObj);
  }
}

// 4. BİLDİRİM VE HAREKET GEÇMİŞİ (LOG)
function addUserNotificationLog(userObj, title, desc, amountText, type) {
  if (!userObj) return;
  if (!userObj.logs) userObj.logs = [];

  userObj.logs.unshift({
    id: Date.now(),
    title: title,
    desc: desc,
    amountText: amountText,
    type: type, // 'income', 'expense', 'commission', 'stake'
    time: new Date().toLocaleTimeString('tr-TR'),
    date: new Date().toLocaleDateString('tr-TR')
  });

  if (userObj.logs.length > 50) userObj.logs.pop();
}

// ================= 4 KADEMELİ REFERANS AĞACI MOTORU =================
// Root kullanıcının altına 4 kademeye kadar bağlı olan tüm üyeleri listeler
function getFourDepthTeam(rootUsername) {
  if (!rootUsername) return [];
  const cleanRoot = rootUsername.toLowerCase();
  const results = [];

  // Veritabanındaki tüm kullanıcıları tara
  const usersList = Object.values(_allUsersCache);

  usersList.forEach(u => {
    if (!u || !u.username) return;
    const uNameLower = u.username.toLowerCase();
    if (uNameLower === cleanRoot) return; // Kendisini listeye almaz

    let depth = null;

    // A) Zincir üzerinden derinlik analizi (referral_chain)
    if (Array.isArray(u.referral_chain) && u.referral_chain.length > 0) {
      const normalizedChain = u.referral_chain.map(x => (x || '').toLowerCase());
      const rootIndex = normalizedChain.indexOf(cleanRoot);
      if (rootIndex !== -1) {
        // cleanRoot'tan sonra kaç kişi geliyorsa derinlik odur
        depth = normalizedChain.length - rootIndex;
      }
    }

    // B) Doğrudan Sponsor Kodu veya Kullanıcı Adı Kontrolü (Fallback)
    if (!depth && u.referredBy) {
      const refByClean = u.referredBy.toLowerCase().trim();
      // Örnek: "MINE-MASTERPRO-777" veya doğrudan "masterpro"
      if (refByClean === cleanRoot || refByClean.includes(cleanRoot)) {
        depth = 1;
      }
    }

    // Yalnızca ilk 4 derinliğe giren üyeleri listeye ekle
    if (depth && depth >= 1 && depth <= 4) {
      results.push({
        username: u.username,
        depth: depth,
        sponsor: u.referredBy || (u.referral_chain && u.referral_chain[u.referral_chain.length - 1]) || '-',
        mina: Number(u.mina || u.ora || 0)
      });
    }
  });

  // Önce Tier 1, sonra Tier 2, 3, 4 şeklinde sırala
  return results.sort((a, b) => a.depth - b.depth);
}
