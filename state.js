// ================= 2. DURUM & FIREBASE MOTORU (state.js) =================
const firebaseConfig = {
  apiKey: "AIzaSyCLyok5TV3uCdUeN6nNOI2eQ5vm3Q-SS2w",
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
    { id: 0, name: "Silverstream Alpine Mine", mineral: "Bakır & Kristal", hp: 100, depleted: false, rewardPool: 25.00, sealedAt: null },
    { id: 1, name: "Firepath Magmatic Trench", mineral: "Yakut Cevheri", hp: 100, depleted: false, rewardPool: 25.00, sealedAt: null },
    { id: 2, name: "Dark Valley Obsidian Shaft", mineral: "Obsidyen Damarı", hp: 100, depleted: false, rewardPool: 25.00, sealedAt: null },
    { id: 3, name: "Densepine Emerald Basin", mineral: "Zümrüt Yatağı", hp: 100, depleted: false, rewardPool: 25.00, sealedAt: null },
    { id: 4, name: "Goldpeak Apex Vein", mineral: "Doğal Altın Damarı", hp: 100, depleted: false, rewardPool: 25.00, sealedAt: null }
  ];
}

let CurrentUser = null;
let CurrentUserWorld = null;

function getDeletedUsers() {
  try { return JSON.parse(localStorage.getItem('mineora_deleted_usernames') || '[]'); } catch(e) { return []; }
}
function addDeletedUser(u) {
  const list = getDeletedUsers();
  const clean = u.toLowerCase();
  if (!list.includes(clean)) { list.push(clean); localStorage.setItem('mineora_deleted_usernames', JSON.stringify(list)); }
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

function getStoredUser(username) {
  if (!username) return null;
  const raw = localStorage.getItem(`mineora_user_${username.toLowerCase()}`);
  return raw ? JSON.parse(raw) : null;
}

function saveStoredUser(userObj) {
  if (!userObj || !userObj.username) return;
  const uKey = userObj.username.toLowerCase();
  localStorage.setItem(`mineora_user_${uKey}`, JSON.stringify(userObj));
  if (fbDb) {
    try { fbDb.ref('users/' + uKey).set(userObj); } catch(e) {}
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
  if (targetUserObj.logs.length > 40) targetUserObj.logs.pop();
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
        const r2 = (u.customRefCode || "").toUpperCase();
        const uname = (u.username || "").toUpperCase();
        if (clean === r1 || clean === r2 || clean === uname) return u;
      } catch(e) {}
    }
  }
  return null;
}

function getFourDepthTeam(targetUsername) {
  if (!targetUsername) return [];
  const target = targetUsername.toLowerCase();
  const allUsers = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(key));
        if (u && u.username) allUsers.push(u);
      } catch(e) {}
    }
  }

  const team = [];
  allUsers.forEach(member => {
    if (member.username.toLowerCase() === target) return;
    let depth = -1;
    let directSponsor = "-";

    if (Array.isArray(member.referral_chain) && member.referral_chain.length > 0) {
      const chainLower = member.referral_chain.map(s => s.toLowerCase());
      const targetIndex = chainLower.indexOf(target);
      if (targetIndex !== -1) {
        depth = chainLower.length - targetIndex;
        directSponsor = member.referral_chain[member.referral_chain.length - 1];
      }
    }

    if (depth >= 1 && depth <= 4) {
      team.push({
        username: member.username,
        depth: depth,
        sponsor: directSponsor,
        role: member.role || "Aday",
        tl: member.tl || 0
      });
    }
  });

  return team.sort((a, b) => a.depth - b.depth);
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
    const tierName = `${i + 1}. Kademe Referans Geliri (%${(rate * 100).toFixed(0)})`;

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

function loadUserWorld(username, defaultPass = "123456", refCodeUsed = "", extraProfile = {}) {
  const uKey = username.toLowerCase();
  const storageKey = `mineora_user_${uKey}`;
  let data = localStorage.getItem(storageKey);
  if (data) {
    try { CurrentUserWorld = JSON.parse(data); } catch(e) {}
  }
  
  const now = Date.now();
  if (CurrentUserWorld) {
    // ESKİ HESAPLARI TL'YE GÖÇ ET
    CurrentUserWorld.tl = Number(parseFloat(CurrentUserWorld.tl || CurrentUserWorld.usdt || 0).toFixed(2));
    if (!CurrentUserWorld.workers) CurrentUserWorld.workers = [];
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
      tl: 0.00, // TL CÜZDANI
      alpCrystals: 0,
      role: "Candidate",
      isRootAdmin: (username.toLowerCase() === 'mourpheus'),
      isVaultLocked: false,
      createdAt: now,
      refCode: `MINE-${username.toUpperCase()}-777`,
      customRefCode: "",
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
    });
  }
}

function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  const badgeMob = document.getElementById('notif-badge-mobile');
  if (!CurrentUser) return;
  const unreadCount = (CurrentUser.logs || []).filter(l => !l.read).length;
  [badge, badgeMob].forEach(el => {
    if (!el) return;
    if (unreadCount > 0) { el.innerText = unreadCount; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });
}

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

function updateHUD() {
  if (!CurrentUser) return;
  const tlEl = document.getElementById('hud-tl-balance');
  const crystalEl = document.getElementById('hud-crystal-balance');
  const userDisp = document.getElementById('player-username-display');
  const roleBadge = document.getElementById('player-role-badge');

  if (tlEl) tlEl.innerText = Number(parseFloat(CurrentUser.tl || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
  if (crystalEl) crystalEl.innerText = CurrentUser.alpCrystals || 0;
  if (userDisp) userDisp.innerText = CurrentUser.username;

  if (roleBadge) {
    roleBadge.innerText = CurrentUser.isRootAdmin ? "Root Admin" : (CurrentUser.role || "Aday");
  }

  updateNotificationBadge();
  if (typeof renderAdminHUD === 'function') renderAdminHUD();
}

function switchTab(tTab) {
  const isBoss = CurrentUser && !!CurrentUser.isRootAdmin;
  if (tTab === 'boss' && !isBoss) { 
    showToast("⛔ Erişim yetkiniz yok!", "warning"); 
    tTab = 'career'; 
  }

  // P2P LİSTEDEN TAMAMEN KALDIRILDI
  const allTabs = ['boss', 'owner', 'home', 'map', 'cave', 'crash', 'live', 'stake', 'career', 'settings'];
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
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-white bg-rose-600 shadow-lg transition cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition cursor-pointer";
      } else if (tab === 'crash') {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-black bg-cyan-400 shadow-lg transition cursor-pointer" 
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
  if (tTab === 'owner' && typeof renderHierarchyUI === 'function') renderHierarchyUI();
  if (tTab === 'boss' && isBoss && typeof initAdminMasterPanel === 'function') initAdminMasterPanel();
}
window.switchTab = switchTab;

function upgradeRole(role, costTl) {
  if (!CurrentUser) return;
  const currentTl = Number(parseFloat(CurrentUser.tl || 0).toFixed(2));

  if (currentTl < costTl) {
    showToast(`⚠️ Yetersiz bakiye! '${role}' lisansı için ${costTl} ₺ gereklidir.`, "warning");
    return;
  }
  CurrentUser.tl = Number((currentTl - costTl).toFixed(2));
  CurrentUser.role = role;
  addUserNotificationLog(CurrentUser, "Kariyer Lisansı Alındı", `${role} aktif edildi.`, `-${costTl.toFixed(2)} ₺`, "upgrade");

  distributeFourDepthCommission(CurrentUser, costTl);
  saveUserWorld();
  updateHUD();
  showToast(`🎉 Tebrikler! '${role}' lisansınız aktif edildi!`, "success");
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
    });
  } else {
    checkLocalUserLogin(u, p, storageKey);
  }
}

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

function enterGame() {
  document.getElementById('screen-landing')?.classList.add('hidden');
  document.getElementById('screen-game')?.classList.remove('hidden');
  updateHUD();
  const isBoss = CurrentUser && !!CurrentUser.isRootAdmin;
  const tabBoss = document.getElementById('tab-btn-boss');
  if (tabBoss) tabBoss.style.display = isBoss ? 'flex' : 'none';
  switchTab(isBoss ? 'boss' : 'map');
}

function logoutSession() {
  sessionStorage.removeItem('mineora_active_session');
  saveUserWorld();
  CurrentUser = null;
  document.getElementById('screen-game')?.classList.add('hidden');
  document.getElementById('screen-landing')?.classList.remove('hidden');
  showToast("🔒 Oturum kapatıldı.", "info");
}
