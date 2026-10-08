// ================= MINEORA TEMEL DURUM, ÇOKLU LİSANS & HESAP MOTORU (state.js) =================
const firebaseConfig = {
  apiKey: "AIzaSyCLyoK5TV3uCdUeN6nNOI2eQ5vm3Q-SS2w",
  authDomain: "mineora-web.firebaseapp.com",
  projectId: "mineora-web",
  storageBucket: "mineora-web.firebasestorage.app",
  messagingSenderId: "648898617395",
  appId: "1:648898617395:web:23902a04f19da700010346",
  databaseURL: "https://mineora-web-default-rtdb.firebaseio.com"
};

var fbDb = null;
try {
  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    fbDb = firebase.database();
  }
} catch(e) {
  console.warn("Firebase bağlantı uyarısı:", e);
}

const COOLDOWN_24H_MS = 24 * 60 * 60 * 1000;
let audioCtx = null;

function initAudioContext() {
  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e) {}
}

function playPickaxeSound(isCritical = false) {
  try {
    initAudioContext();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = isCritical ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isCritical ? 1300 : 850, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);
    gain.gain.setValueAtTime(isCritical ? 0.5 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch(e) {}
}

function getDefaultMines() {
  return [
    { id: 0, name: "Silverstream Alpine Mine", mineral: "Bakır & Kristal Damarı", hp: 100, depleted: false, sealedAt: null },
    { id: 1, name: "Firepath Magmatic Trench", mineral: "Yakut & Akik Yatağı", hp: 100, depleted: false, sealedAt: null },
    { id: 2, name: "Dark Valley Obsidian Shaft", mineral: "Saf Obsidyen Damarı", hp: 100, depleted: false, sealedAt: null },
    { id: 3, name: "Densepine Emerald Basin", mineral: "Zümrüt ve Granit Havzası", hp: 100, depleted: false, sealedAt: null },
    { id: 4, name: "Goldpeak Apex Vein", mineral: "Doğal Dağ Altını", hp: 100, depleted: false, sealedAt: null }
  ];
}

let CurrentUser = null;
let CurrentUserWorld = null;

function getStoredUser(username) {
  if (!username) return null;
  const raw = localStorage.getItem(`mineora_user_${username.toLowerCase()}`);
  return raw ? JSON.parse(raw) : null;
}

function saveStoredUser(userObj) {
  if (!userObj || !userObj.username) return;
  const uKey = userObj.username.toLowerCase();
  localStorage.setItem(`mineora_user_${uKey}`, JSON.stringify(userObj));
  
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('users/' + uKey).set(userObj).catch(err => {
      console.warn(`Firebase yazma uyarısı (${uKey}):`, err.message);
    });
  }
}

function saveUserWorld() {
  if (!CurrentUserWorld) return;
  saveStoredUser(CurrentUserWorld);
}

function addUserNotificationLog(targetUserObj, title, desc, amountText = "", type = "income") {
  if (!targetUserObj) return;
  if (!targetUserObj.logs) targetUserObj.logs = [];
  targetUserObj.logs.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: title, desc: desc, amountText: amountText, type: type,
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString('tr-TR'), read: false
  });
  if (targetUserObj.logs.length > 50) targetUserObj.logs.pop();
}

function checkMinesCooldown() {
  if (!CurrentUser || !CurrentUser.mines) return;
  let hasChanges = false;
  const now = Date.now();
  CurrentUser.mines.forEach(m => {
    if (m.depleted && m.sealedAt) {
      const elapsed = now - m.sealedAt;
      if (elapsed >= COOLDOWN_24H_MS) {
        m.depleted = false;
        m.sealedAt = null;
        m.hp = 100;
        hasChanges = true;
      }
    }
  });
  if (hasChanges) saveUserWorld();
}

function findUserByRefCode(refCode) {
  if (!refCode) return null;
  const clean = refCode.trim().toUpperCase();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(key));
        if (!u) continue;
        const r1 = (u.refCode || "").toUpperCase();
        const uname = (u.username || "").toUpperCase();
        if (clean === r1 || clean === uname) return u;
      } catch(e) {}
    }
  }
  return null;
}

function distributeFourDepthCommission(buyerUser, costTl) {
  if (!buyerUser || !buyerUser.referral_chain || buyerUser.referral_chain.length === 0) return;
  const chain = buyerUser.referral_chain;
  const rates = [0.10, 0.07, 0.05, 0.03];

  for (let i = 0; i < rates.length; i++) {
    const sponsorIndex = chain.length - 1 - i;
    if (sponsorIndex < 0) break;

    const sponsorUsername = chain[sponsorIndex];
    const sponsorObj = getStoredUser(sponsorUsername);
    if (!sponsorObj) continue;

    const rate = rates[i];
    const commissionTl = Number((costTl * rate).toFixed(2));
    const tierName = `${i + 1}. Kademe Referans Primi (%${(rate * 100).toFixed(0)})`;

    sponsorObj.tl = Number(((sponsorObj.tl || 0) + commissionTl).toFixed(2));
    addUserNotificationLog(sponsorObj, tierName, `${buyerUser.username} lisans aldı.`, `+${commissionTl.toFixed(2)} ₺`, "commission");
    saveStoredUser(sponsorObj);

    if (CurrentUser && CurrentUser.username.toLowerCase() === sponsorObj.username.toLowerCase()) {
      CurrentUser.tl = sponsorObj.tl;
      CurrentUser.logs = sponsorObj.logs;
      updateHUD();
    }
  }
}

function calculateTotalDailyReturnTl(userObj) {
  if (!userObj || !userObj.licenses) return 0;
  const wCount = userObj.licenses.worker || 0;
  const mCount = userObj.licenses.mine || 0;
  const hCount = userObj.licenses.holding || 0;

  const dailyWorker = wCount * (3000 * 0.02);
  const dailyMine = mCount * (5000 * 0.0225);
  const dailyHolding = hCount * (10000 * 0.03);

  return Number((dailyWorker + dailyMine + dailyHolding).toFixed(2));
}

function purchaseLicense(type, costTl) {
  if (!CurrentUser) return;
  const currentTl = Number(parseFloat(CurrentUser.tl || 0).toFixed(2));

  if (currentTl < costTl) {
    showToast(`⚠️ Yetersiz bakiye! Lisans bedeli: ${costTl.toLocaleString()} ₺. Mevcut: ${currentTl.toLocaleString()} ₺`, "warning");
    return;
  }

  CurrentUser.tl = Number((currentTl - costTl).toFixed(2));
  if (!CurrentUser.licenses) {
    CurrentUser.licenses = { worker: 0, mine: 0, holding: 0 };
  }

  CurrentUser.licenses[type] = (CurrentUser.licenses[type] || 0) + 1;

  let typeName = "İşçi Madenci";
  if (type === 'mine') typeName = "Maden Sahibi";
  if (type === 'holding') typeName = "Holding Sahibi";

  addUserNotificationLog(CurrentUser, "Lisans Satın Alındı", `1 Adet ${typeName} lisansı portföye eklendi.`, `-${costTl.toLocaleString()} ₺`, "upgrade");

  distributeFourDepthCommission(CurrentUser, costTl);
  saveUserWorld();
  updateHUD();
  showToast(`🎉 Tebrikler! 1 adet ${typeName} lisansı başarıyla alındı!`, "success");
}
window.purchaseLicense = purchaseLicense;

function loadUserWorld(username, defaultPass = "123456", refCodeUsed = "", extraProfile = {}) {
  const uKey = username.toLowerCase();
  const storageKey = `mineora_user_${uKey}`;
  let data = localStorage.getItem(storageKey);
  if (data) {
    try { CurrentUserWorld = JSON.parse(data); } catch(e) {}
  }
  
  const now = Date.now();
  if (CurrentUserWorld) {
    CurrentUserWorld.tl = Number(parseFloat(CurrentUserWorld.tl || CurrentUserWorld.usdt || CurrentUserWorld.ora || 0).toFixed(2));
    if (!CurrentUserWorld.licenses) CurrentUserWorld.licenses = { worker: 0, mine: 0, holding: 0 };
    if (!CurrentUserWorld.logs) CurrentUserWorld.logs = [];
    if (!CurrentUserWorld.referral_chain) CurrentUserWorld.referral_chain = [];
    CurrentUserWorld.alpCrystals = CurrentUserWorld.alpCrystals || 0;
    CurrentUserWorld.isRootAdmin = (username.toLowerCase() === 'mourpheus');
  } else {
    CurrentUserWorld = {
      username: username,
      fullname: extraProfile.fullname || "Madenci",
      phone: extraProfile.phone || "",
      pass: defaultPass,
      email: extraProfile.email || `${username}@mineora.io`,
      tl: 0.00,
      alpCrystals: 0,
      licenses: { worker: 0, mine: 0, holding: 0 },
      isRootAdmin: (username.toLowerCase() === 'mourpheus'),
      isVaultLocked: false,
      createdAt: now,
      refCode: `MINE-${username.toUpperCase()}-777`,
      referredBy: refCodeUsed || "",
      referral_chain: [],
      mines: getDefaultMines(),
      logs: []
    };
    saveUserWorld();
  }
  CurrentUser = CurrentUserWorld;
  sessionStorage.setItem('mineora_active_session', CurrentUser.username);
  checkMinesCooldown();

  if (fbDb) {
    fbDb.ref('users/' + uKey).on('value', snap => {
      const cloudUser = snap.val();
      if (cloudUser) {
        CurrentUser = cloudUser;
        CurrentUserWorld = cloudUser;
        updateHUD();
      }
    }, err => {
      console.warn("Firebase okuma uyarısı:", err.message);
    });
  }
}

function updateHUD() {
  if (!CurrentUser) return;
  const tlEl = document.getElementById('hud-tl-balance');
  const crystalEl = document.getElementById('hud-crystal-balance');
  const userDisp = document.getElementById('player-username-display');
  const activeLicEl = document.getElementById('my-active-licenses-badge');
  const dailyStatusEl = document.getElementById('daily-earned-status-text');

  if (tlEl) tlEl.innerText = Number(parseFloat(CurrentUser.tl || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
  if (crystalEl) crystalEl.innerText = CurrentUser.alpCrystals || 0;
  if (userDisp) userDisp.innerText = CurrentUser.username;

  const totalDaily = calculateTotalDailyReturnTl(CurrentUser);
  if (dailyStatusEl) {
    dailyStatusEl.innerText = `Günlük Kazanç Hakkı: ${totalDaily.toFixed(2)} ₺`;
  }

  if (activeLicEl && CurrentUser.licenses) {
    const l = CurrentUser.licenses;
    activeLicEl.innerText = `${l.worker || 0} Madenci • ${l.mine || 0} Maden Sahibi • ${l.holding || 0} Holding (Toplam: ${totalDaily.toFixed(2)} ₺/gün)`;
  }

  updateNotificationBadge();
  if (typeof renderAdminHUD === 'function') renderAdminHUD();
}

function switchTab(tTab) {
  if (typeof toggleMobileMenu === 'function') toggleMobileMenu(false);

  const isBoss = CurrentUser && !!CurrentUser.isRootAdmin;
  if (tTab === 'boss' && !isBoss) { 
    showToast("⛔ Erişim yetkiniz yok!", "warning"); 
    tTab = 'career'; 
  }

  const allTabs = ['boss', 'owner', 'map', 'cave', 'crash', 'colony', 'live', 'stake', 'career', 'settings'];
  allTabs.forEach(tab => {
    const secEl = document.getElementById(`sec-${tab}`);
    if (secEl) {
      if (tab === 'boss') {
        secEl.style.display = (isBoss && tTab === 'boss') ? '' : 'none';
      } else {
        secEl.classList.toggle('hidden', tab !== tTab);
      }
    }
    const b = document.getElementById(`tab-btn-${tab}`);
    if (b) {
      const isActive = (tab === tTab);
      if (tab === 'boss') {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-white bg-rose-600 shadow-lg cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition cursor-pointer";
      } else if (tab === 'crash') {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-black bg-cyan-400 shadow-lg cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition cursor-pointer";
      } else {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold bg-mineora-gold text-black shadow-md transition cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-mineora-input/50 transition cursor-pointer";
      }
    }
  });

  if (tTab === 'cave' && typeof initMineCanvas === 'function') initMineCanvas();
  if (tTab === 'crash' && typeof initCrashEngine === 'function') initCrashEngine();
  if (tTab === 'map' && typeof renderAlpMapPins === 'function') renderAlpMapPins();
  if (tTab === 'colony' && typeof ColonyEngine !== 'undefined') ColonyEngine.init();
  if (tTab === 'live' && typeof initLiveRoomsLobby === 'function') initLiveRoomsLobby(); // CANLI ODALARI BAŞLATIR
  if (tTab === 'boss' && isBoss && typeof initAdminMasterPanel === 'function') initAdminMasterPanel();
}
window.switchTab = switchTab;

function toggleMobileMenu(forceState) {
  const sidebar = document.getElementById('main-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  const isClosed = sidebar.classList.contains('-translate-x-full');
  const shouldOpen = (typeof forceState === 'boolean') ? forceState : isClosed;

  if (shouldOpen) {
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.add('translate-x-0');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    sidebar.classList.remove('translate-x-0');
    if (backdrop) backdrop.classList.add('hidden');
  }
}
window.toggleMobileMenu = toggleMobileMenu;

function showToast(msg, type = "info") {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const tEl = document.createElement('div');
  const colors = {
    success: 'bg-emerald-600 text-white border-emerald-400',
    warning: 'bg-amber-500 text-black border-yellow-300 font-bold',
    info: 'bg-mineora-card text-slate-200 border-mineora-border'
  };
  tEl.className = `px-4 py-3 rounded-2xl border shadow-2xl text-xs font-bold transition transform duration-300 pointer-events-auto ${colors[type] || colors.info}`;
  tEl.innerHTML = msg;
  container.appendChild(tEl);
  setTimeout(() => tEl.remove(), 3200);
}

function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  if (!CurrentUser) return;
  const unreadCount = (CurrentUser.logs || []).filter(l => !l.read).length;
  if (badge) {
    if (unreadCount > 0) { badge.innerText = unreadCount; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }
}

function handleLogin() {
  const u = document.getElementById('login-user')?.value.trim();
  const p = document.getElementById('login-pwd')?.value.trim();
  if (!u || !p) { showToast("⚠️ Kullanıcı adı ve şifre girin!", "warning"); return; }

  const uKey = u.toLowerCase();
  const storageKey = `mineora_user_${uKey}`;

  if (fbDb) {
    fbDb.ref('users/' + uKey).once('value', snapshot => {
      const cloudData = snapshot.val();
      if (cloudData) {
        if (cloudData.pass !== p) { showToast("⚠️ Hatalı şifre!", "warning"); return; }
        localStorage.setItem(storageKey, JSON.stringify(cloudData));
        loadUserWorld(u, p);
        closeModal('modal-auth-login');
        enterGame();
        showToast(`👋 Hoş geldiniz ${CurrentUser.username}!`, "success");
      } else {
        checkLocalUserLogin(u, p, storageKey);
      }
    }).catch(() => {
      checkLocalUserLogin(u, p, storageKey);
    });
  } else {
    checkLocalUserLogin(u, p, storageKey);
  }
}
window.handleLogin = handleLogin;

function checkLocalUserLogin(u, p, storageKey) {
  const userRecord = localStorage.getItem(storageKey);
  if (userRecord) {
    const parsed = JSON.parse(userRecord);
    if (parsed.pass !== p) { showToast("⚠️ Hatalı şifre!", "warning"); return; }
    loadUserWorld(u, p);
    closeModal('modal-auth-login');
    enterGame();
    showToast(`👋 Hoş geldiniz ${CurrentUser.username}!`, "success");
  } else {
    showToast("⛔ Kullanıcı bulunamadı!", "warning");
  }
}

function handleRegister() {
  const fullname = document.getElementById('reg-fullname')?.value.trim();
  const phone = document.getElementById('reg-phone')?.value.trim();
  const em = document.getElementById('reg-email')?.value.trim();
  const u = document.getElementById('reg-username')?.value.trim();
  const p = document.getElementById('reg-pwd')?.value.trim();
  const ref = document.getElementById('reg-ref-code')?.value.trim() || "";

  if (!fullname || !phone || !u || !p) { showToast("⚠️ Lütfen tüm alanları doldurun!", "warning"); return; }
  const uKey = u.toLowerCase();
  if (localStorage.getItem(`mineora_user_${uKey}`)) { showToast("⚠️ Bu kullanıcı adı zaten kayıtlı!", "warning"); return; }

  loadUserWorld(u, p, ref, { fullname, phone, email: em });
  closeModal('modal-auth-register');
  enterGame();
  showToast(`🎉 Tebrikler ${fullname}! Hesabınız oluşturuldu.`, "success");
}
window.handleRegister = handleRegister;

function enterGame() {
  document.getElementById('screen-landing')?.classList.add('hidden');
  document.getElementById('screen-game')?.classList.remove('hidden');
  updateHUD();
  const isBoss = CurrentUser && !!CurrentUser.isRootAdmin;
  const tabBoss = document.getElementById('tab-btn-boss');
  if (tabBoss) tabBoss.style.display = isBoss ? 'flex' : 'none';
  switchTab(isBoss ? 'boss' : 'cave');
}

function logoutSession() {
  sessionStorage.removeItem('mineora_active_session');
  saveUserWorld();
  CurrentUser = null;
  document.getElementById('screen-game')?.classList.add('hidden');
  document.getElementById('screen-landing')?.classList.remove('hidden');
  showToast("🔒 Oturum kapatıldı.", "info");
}
window.logoutSession = logoutSession;

function handlePasswordChange() {
  const oldP = document.getElementById('pwd-old')?.value;
  const newP = document.getElementById('pwd-new')?.value;
  const repP = document.getElementById('pwd-repeat')?.value;
  if (!oldP || !newP || !repP) { showToast("⚠️ Tüm alanları doldurun!", "warning"); return; }
  if (oldP !== CurrentUser.pass) { showToast("⚠️ Mevcut şifreniz hatalı!", "warning"); return; }
  if (newP !== repP) { showToast("⚠️ Yeni şifreler eşleşmiyor!", "warning"); return; }
  if (newP.length < 4) { showToast("⚠️ Şifre en az 4 karakter olmalıdır!", "warning"); return; }
  
  CurrentUser.pass = newP;
  saveUserWorld();
  document.getElementById('pwd-old').value = "";
  document.getElementById('pwd-new').value = "";
  document.getElementById('pwd-repeat').value = "";
  showToast("🔐 Şifreniz başarıyla güncellendi!", "success");
}
window.handlePasswordChange = handlePasswordChange;
