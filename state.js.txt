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
  console.warn("Firebase connection warning:", e);
}

const OFFICIAL_TRC20_DEPOSIT_ADDRESS = "0x9bCaE8db59621D8A3345405D92ECA803c9D6C431";
const COOLDOWN_24H_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_TRIAL_DURATION_MS = 48 * 60 * 60 * 1000;

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

function getGlobalProtocolState() {
  const saved = localStorage.getItem('mineora_global_protocol');
  if (saved) {
    try { return JSON.parse(saved); } catch(e) {}
  }
  return { adminVaultUsdt: 0.00, totalBurnedOra: 0.00, feeUsdtPercent: 1.0, feeOraPercent: 1.0 };
}

function saveGlobalProtocolState(s) { 
  localStorage.setItem('mineora_global_protocol', JSON.stringify(s)); 
  if (fbDb) {
    try { fbDb.ref('globalProtocol').set(s); } catch(e) {}
  }
}

let ProtocolState = getGlobalProtocolState();

if (fbDb) {
  fbDb.ref('globalProtocol').on('value', snap => {
    const data = snap.val();
    if (data) {
      ProtocolState = data;
      localStorage.setItem('mineora_global_protocol', JSON.stringify(data));
    }
  });
}

function registerProtocolSystemBurn(amount, reason = "System Burn") {
  const amt = Number(parseFloat(amount) || 0);
  if (amt <= 0) return;
  ProtocolState.totalBurnedOra = Number(((ProtocolState.totalBurnedOra || 0) + amt).toFixed(2));
  saveGlobalProtocolState(ProtocolState);
  if (typeof AdminState !== 'undefined') {
    AdminState.totalBurnedOra = Number(((AdminState.totalBurnedOra || 0) + amt).toFixed(2));
    if (typeof saveAdminProtocolState === 'function') saveAdminProtocolState(AdminState);
    if (typeof renderAdminHUD === 'function') renderAdminHUD();
  }
}

function getDefaultMines() {
  return [
    { id: 0, name: "Silverstream Alpine Mine", mineral: "Copper & Silver Crystal", hp: 100, depleted: false, rewardPool: 10.00, sealedAt: null },
    { id: 1, name: "Firepath Magmatic Trench", mineral: "Ruby Crystal", hp: 100, depleted: false, rewardPool: 10.00, sealedAt: null },
    { id: 2, name: "Dark Valley Obsidian Shaft", mineral: "Pure Obsidian Vein", hp: 100, depleted: false, rewardPool: 10.00, sealedAt: null },
    { id: 3, name: "Densepine Emerald Basin", mineral: "Emerald Deposit", hp: 100, depleted: false, rewardPool: 10.00, sealedAt: null },
    { id: 4, name: "Goldpeak Apex Vein", mineral: "Native Gold Deposit", hp: 100, depleted: false, rewardPool: 10.00, sealedAt: null }
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
        m.rewardPool = 10.00;
        hasChanges = true;
      }
    }
  });
  if (hasChanges) saveUserWorld();
}

function isCandidateTrialExpired(userObj) {
  if (!userObj) return false;
  if (userObj.isRootAdmin) return false;
  if (userObj.role !== "Aday" && userObj.role !== "Candidate") return false;
  if (Number(userObj.usdt || 0) > 0 || userObj.hasDeposited) return false;

  const expires = userObj.trialExpiresAt || (userObj.createdAt ? userObj.createdAt + CANDIDATE_TRIAL_DURATION_MS : 0);
  if (!expires) return false;
  return Date.now() >= expires;
}

function getCandidateRemainingTrialMs(userObj) {
  if (!userObj || (userObj.role !== "Aday" && userObj.role !== "Candidate") || userObj.isRootAdmin) return 0;
  if (Number(userObj.usdt || 0) > 0 || userObj.hasDeposited) return 0;
  const expires = userObj.trialExpiresAt || (userObj.createdAt ? userObj.createdAt + CANDIDATE_TRIAL_DURATION_MS : 0);
  return Math.max(0, expires - Date.now());
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
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString('en-US'), read: false
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
        const r3 = (u.companyRefCode || "").toUpperCase();
        const r4 = (u.customCompanyRefCode || "").toUpperCase();
        const uname = (u.username || "").toUpperCase();
        if (clean === r1 || clean === r2 || clean === r3 || clean === r4 || clean === uname) return u;
      } catch(e) {}
    }
  }
  return null;
}

function autoMigrateReferralLineage() {
  const allUsersMap = {};
  const deleted = getDeletedUsers();

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(key));
        if (u && u.username && !deleted.includes(u.username.toLowerCase())) {
          allUsersMap[u.username.toLowerCase()] = u;
        }
      } catch (e) {}
    }
  }

  let hasChanges = false;
  Object.keys(allUsersMap).forEach(k => {
    const leader = allUsersMap[k];
    if (Array.isArray(leader.workers)) {
      leader.workers.forEach(w => {
        const wKey = (w.username || "").toLowerCase();
        if (allUsersMap[wKey] && !allUsersMap[wKey].referredBy) {
          allUsersMap[wKey].referredBy = leader.companyRefCode || leader.refCode || leader.username;
          hasChanges = true;
        }
      });
    }

    if (Array.isArray(leader.minesOwned)) {
      leader.minesOwned.forEach(m => {
        const ownerKey = (m.ownerUsername || "").toLowerCase();
        if (allUsersMap[ownerKey] && !allUsersMap[ownerKey].referredBy) {
          allUsersMap[ownerKey].referredBy = leader.companyRefCode || leader.refCode || leader.username;
          hasChanges = true;
        }
        if (Array.isArray(m.workers)) {
          m.workers.forEach(mw => {
            const mwKey = (mw.username || "").toLowerCase();
            if (allUsersMap[mwKey] && !allUsersMap[mwKey].referredBy) {
              allUsersMap[mwKey].referredBy = m.ownerUsername;
              hasChanges = true;
            }
          });
        }
      });
    }
  });

  function traceChain(username) {
    const chain = [];
    let cur = allUsersMap[username.toLowerCase()];
    const visited = new Set();
    while (cur && cur.referredBy) {
      const refVal = cur.referredBy.trim().toUpperCase();
      let parent = findUserByRefCode(refVal);
      if (!parent && allUsersMap[refVal.toLowerCase()]) {
        parent = allUsersMap[refVal.toLowerCase()];
      }
      if (!parent || visited.has(parent.username.toLowerCase())) break;
      visited.add(parent.username.toLowerCase());
      chain.unshift(parent.username);
      cur = allUsersMap[parent.username.toLowerCase()];
    }
    return chain;
  }

  Object.keys(allUsersMap).forEach(k => {
    const calculatedChain = traceChain(allUsersMap[k].username);
    if (!Array.isArray(allUsersMap[k].referral_chain) || JSON.stringify(allUsersMap[k].referral_chain) !== JSON.stringify(calculatedChain)) {
      allUsersMap[k].referral_chain = calculatedChain;
      hasChanges = true;
    }
  });

  if (hasChanges) {
    Object.keys(allUsersMap).forEach(k => saveStoredUser(allUsersMap[k]));
    if (CurrentUser && allUsersMap[CurrentUser.username.toLowerCase()]) {
      CurrentUser = allUsersMap[CurrentUser.username.toLowerCase()];
      CurrentUserWorld = CurrentUser;
    }
  }
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

    if (depth === -1 && member.referredBy) {
      const refVal = member.referredBy.trim().toUpperCase();
      const myRefs = [
        (CurrentUser?.refCode || "").toUpperCase(),
        (CurrentUser?.customRefCode || "").toUpperCase(),
        (CurrentUser?.companyRefCode || "").toUpperCase(),
        (CurrentUser?.customCompanyRefCode || "").toUpperCase(),
        target.toUpperCase()
      ];
      if (myRefs.includes(refVal)) {
        depth = 1;
        directSponsor = targetUsername;
      }
    }

    if (depth >= 1 && depth <= 4) {
      team.push({
        username: member.username,
        depth: depth,
        sponsor: directSponsor,
        role: member.role || "Candidate",
        ora: member.ora || 0,
        usdt: member.usdt || 0
      });
    }
  });

  return team.sort((a, b) => a.depth - b.depth);
}

function distributeFourDepthCommission(buyerUser, costOra) {
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
    const commissionOra = Number((costOra * rate).toFixed(2));
    const tierName = `${i + 1}. Tier Commission (%${(rate * 100).toFixed(0)})`;

    sponsorObj.ora = Number(((sponsorObj.ora || 0) + commissionOra).toFixed(2));
    addUserNotificationLog(sponsorObj, tierName, `${buyerUser.username} upgraded role.`, `+${commissionOra.toFixed(2)} ORA`, "commission");
    saveStoredUser(sponsorObj);

    if (CurrentUser && CurrentUser.username.toLowerCase() === sponsorObj.username.toLowerCase()) {
      CurrentUser.ora = sponsorObj.ora;
      CurrentUser.logs = sponsorObj.logs;
      updateHUD();
    }
  }
}

function linkHierarchyByRefCode(newUsername, refCode, newRole = "Candidate", isFeeDeducted = false) {
  if (!refCode || !refCode.trim()) return;

  const processLink = (leader) => {
    if (!leader) return;
    const targetUser = getStoredUser(newUsername) || CurrentUser;
    if (!targetUser) return;

    const parentChain = Array.isArray(leader.referral_chain) ? leader.referral_chain : [];
    targetUser.referral_chain = [...parentChain, leader.username];
    targetUser.referredBy = refCode;
    saveStoredUser(targetUser);

    if (CurrentUser && CurrentUser.username.toLowerCase() === targetUser.username.toLowerCase()) {
      CurrentUser.referral_chain = targetUser.referral_chain;
      CurrentUser.referredBy = refCode;
    }

    if (!leader.workers) leader.workers = [];
    const exists = leader.workers.some(w => w.username.toLowerCase() === newUsername.toLowerCase());
    if (!exists) {
      leader.workers.unshift({
        username: newUsername, workedToday: false, oraMined: 0.00, role: newRole, joinedAt: new Date().toLocaleDateString('en-US')
      });
      saveStoredUser(leader);
      if (CurrentUser && CurrentUser.username.toLowerCase() === leader.username.toLowerCase()) {
        CurrentUser.workers = leader.workers;
      }
    }
  };

  const localLeader = findUserByRefCode(refCode);
  if (localLeader) {
    processLink(localLeader);
  } else if (fbDb) {
    fbDb.ref('users').once('value', snap => {
      const all = snap.val();
      if (all) {
        const clean = refCode.trim().toUpperCase();
        for (let k in all) {
          const u = all[k];
          if ((u.refCode||"").toUpperCase() === clean || (u.customRefCode||"").toUpperCase() === clean || (u.companyRefCode||"").toUpperCase() === clean || (u.username||"").toUpperCase() === clean) {
            saveStoredUser(u);
            processLink(u);
            break;
          }
        }
      }
    });
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
    CurrentUserWorld.trc20Address = OFFICIAL_TRC20_DEPOSIT_ADDRESS;
    if (!CurrentUserWorld.minesOwned) CurrentUserWorld.minesOwned = [];
    if (!CurrentUserWorld.stakes) CurrentUserWorld.stakes = [];
    if (!CurrentUserWorld.workers) CurrentUserWorld.workers = [];
    if (!CurrentUserWorld.logs) CurrentUserWorld.logs = [];
    if (!CurrentUserWorld.referral_chain) CurrentUserWorld.referral_chain = [];
    CurrentUserWorld.alpCrystals = CurrentUserWorld.alpCrystals || 0;
    CurrentUserWorld.kycVerified = true;
    CurrentUserWorld.usdt = Number(parseFloat(CurrentUserWorld.usdt || 0).toFixed(2));
    CurrentUserWorld.ora = Number(parseFloat(CurrentUserWorld.ora || 0).toFixed(2));
    CurrentUserWorld.isRootAdmin = !!CurrentUserWorld.isRootAdmin;

    if ((CurrentUserWorld.role === "Aday" || CurrentUserWorld.role === "Candidate") && !CurrentUserWorld.trialExpiresAt) {
      CurrentUserWorld.createdAt = CurrentUserWorld.createdAt || now;
      CurrentUserWorld.trialExpiresAt = CurrentUserWorld.createdAt + CANDIDATE_TRIAL_DURATION_MS;
      saveStoredUser(CurrentUserWorld);
    }
  } else {
    CurrentUserWorld = {
      username: username,
      fullname: extraProfile.fullname || "Miner",
      phone: extraProfile.phone || "",
      pass: defaultPass,
      email: extraProfile.email || `${username}@mineora.io`,
      trc20Address: OFFICIAL_TRC20_DEPOSIT_ADDRESS,
      usdt: 0.00,
      ora: 0.00,
      alpCrystals: 0,
      role: "Candidate",
      isRootAdmin: !!extraProfile.isRootAdmin,
      isVaultLocked: false,
      hasDeposited: false,
      createdAt: now,
      trialExpiresAt: now + CANDIDATE_TRIAL_DURATION_MS,
      refCode: `MINE-${username.toUpperCase()}-777`,
      customRefCode: "",
      companyRefCode: `HOLD-${username.toUpperCase()}-999`,
      customCompanyRefCode: "",
      referredBy: refCodeUsed || "",
      referral_chain: [],
      kycVerified: true,
      mines: getDefaultMines(),
      stakes: [],
      dailyEarnedOra: 0.00,
      lastProfitDate: new Date().toDateString(),
      workers: [],
      minesOwned: [],
      logs: []
    };
    saveUserWorld();
    if (refCodeUsed) linkHierarchyByRefCode(username, refCodeUsed, CurrentUserWorld.role, false);
  }
  CurrentUser = CurrentUserWorld;
  sessionStorage.setItem('mineora_active_session', CurrentUser.username);
  checkMinesCooldown();

  if (fbDb) {
    fbDb.ref('users').on('value', snap => {
      const allCloudUsers = snap.val();
      const deleted = getDeletedUsers();
      if (allCloudUsers) {
        Object.keys(allCloudUsers).forEach(k => {
          if (!deleted.includes(k.toLowerCase())) {
            localStorage.setItem(`mineora_user_${k}`, JSON.stringify(allCloudUsers[k]));
          } else {
            localStorage.removeItem(`mineora_user_${k}`);
          }
        });
        if (allCloudUsers[uKey] && !deleted.includes(uKey)) {
          CurrentUser = allCloudUsers[uKey];
          CurrentUserWorld = allCloudUsers[uKey];
        }
        autoMigrateReferralLineage();
        updateHUD();
        const secOwner = document.getElementById('sec-owner');
        if (secOwner && !secOwner.classList.contains('hidden')) {
          renderHierarchyUI();
        }
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

function renderNotificationsModal() {
  const container = document.getElementById('user-notifications-list');
  if (!container || !CurrentUser) return;
  container.innerHTML = "";
  const logs = CurrentUser.logs || [];
  if (logs.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-xs">No account notifications found.</div>`;
    return;
  }
  logs.forEach(l => {
    l.read = true;
    const card = document.createElement('div');
    const isIncome = l.amountText.startsWith('+');
    card.className = "p-3 bg-mineora-bg rounded-2xl border border-mineora-border flex items-center justify-between text-xs";
    card.innerHTML = `
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl ${isIncome ? 'bg-mineora-green/20 text-mineora-green' : 'bg-rose-500/20 text-rose-400'} flex items-center justify-center text-sm font-bold">
          <i class="fa-solid ${isIncome ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
        </div>
        <div>
          <strong class="text-white block">${l.title}</strong>
          <span class="text-[10px] text-slate-400">${l.desc} • <span class="font-mono">${l.date} ${l.time}</span></span>
        </div>
      </div>
      <strong class="font-mono text-sm ${isIncome ? 'text-mineora-green' : 'text-slate-400'}">${l.amountText}</strong>
    `;
    container.appendChild(card);
  });
  saveUserWorld();
  updateNotificationBadge();
}

function clearUserLogs() {
  if (!CurrentUser) return;
  CurrentUser.logs = [];
  saveUserWorld();
  renderNotificationsModal();
  updateNotificationBadge();
  showToast("Notifications cleared.", "info");
}

function updateCustomRefCode() {
  if (!CurrentUser) return;
  const inputEl = document.getElementById('custom-ref-input');
  if (!inputEl) return;
  const newCode = inputEl.value.trim().toUpperCase();

  if (!newCode || newCode.length < 4 || newCode.length > 16) {
    showToast("⚠️ Referral code must be 4 to 16 characters!", "warning");
    return;
  }
  if (!/^[A-Z0-9_-]+$/.test(newCode)) {
    showToast("⚠️ Code can only contain letters, numbers, dash (-), and underscore (_)!", "warning");
    return;
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(key));
        if (u && u.username.toLowerCase() !== CurrentUser.username.toLowerCase()) {
          if ((u.customRefCode && u.customRefCode === newCode) || (u.customCompanyRefCode && u.customCompanyRefCode === newCode)) {
            showToast("⚠️ This referral code is already taken!", "warning");
            return;
          }
        }
      } catch(e) {}
    }
  }

  if (CurrentUser.role === "Şirket Sahibi" || CurrentUser.role === "Holding Owner") {
    CurrentUser.customCompanyRefCode = newCode;
  } else {
    CurrentUser.customRefCode = newCode;
  }

  saveUserWorld();
  renderHierarchyUI();
  showToast(`🎉 Custom referral code updated: ${newCode}`, "success");
}

function showToast(msg, type = "info") {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const tEl = document.createElement('div');
  const colors = {
    success: 'bg-mineora-green text-white border-emerald-400',
    warning: 'bg-mineora-gold text-black border-yellow-300 font-bold',
    info: 'bg-mineora-card text-slate-200 border-mineora-border'
  };
  tEl.className = `px-4 py-3 rounded-2xl border shadow-2xl text-xs font-bold transition transform duration-300 pointer-events-auto ${colors[type] || colors.info}`;
  tEl.innerHTML = msg;
  container.appendChild(tEl);
  setTimeout(() => tEl.remove(), 3200);
}

window.openModal = function(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('hidden');
  m.classList.add('flex');
  if (id === 'modal-wallet') {
    if (typeof renderQrCode === 'function') renderQrCode();
    if (typeof setWalletTab === 'function') setWalletTab('deposit');
  }
  if (id === 'modal-notifications') renderNotificationsModal();
  if (id === 'modal-auth-login') {
    setTimeout(() => { document.getElementById('login-user')?.focus(); }, 100);
  }
};

window.closeModal = function(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('hidden');
  m.classList.remove('flex');
};

window.handleLogin = function() {
  const u = document.getElementById('login-user')?.value.trim();
  const p = document.getElementById('login-pwd')?.value.trim();
  if (!u || !p) { showToast("⚠️ Enter username and password!", "warning"); return; }

  const uKey = u.toLowerCase();
  const storageKey = `mineora_user_${uKey}`;

  if (fbDb) {
    showToast("🔍 Verifying account...", "info");
    fbDb.ref('users/' + uKey).once('value', snapshot => {
      const cloudData = snapshot.val();
      if (cloudData) {
        if (cloudData.pass !== p) { showToast("⚠️ Incorrect password!", "warning"); return; }
        localStorage.setItem(storageKey, JSON.stringify(cloudData));
        loadUserWorld(u, p);
        closeModal('modal-auth-login');
        enterGame();
        showToast(`👋 Welcome ${CurrentUser.username}!`, "success");
      } else {
        checkLocalUserLogin(u, p, storageKey);
      }
    }).catch(() => { checkLocalUserLogin(u, p, storageKey); });
  } else {
    checkLocalUserLogin(u, p, storageKey);
  }
};

function checkLocalUserLogin(u, p, storageKey) {
  const userRecord = localStorage.getItem(storageKey);
  if (userRecord) {
    const parsed = JSON.parse(userRecord);
    if (parsed.pass !== p) { showToast("⚠️ Incorrect password!", "warning"); return; }
    loadUserWorld(u, p);
    closeModal('modal-auth-login');
    enterGame();
    showToast(`👋 Welcome ${CurrentUser.username}!`, "success");
  } else {
    showToast("⛔ Username not found!", "warning");
  }
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (!/^\d+$/.test(cleaned)) return { valid: false, msg: "Phone number must contain digits only!" };
  if (cleaned.length < 8 || cleaned.length > 15) return { valid: false, msg: "Please enter a valid phone number!" };
  return { valid: true, phone: cleaned };
}

window.handleRegister = function() {
  const fullname = document.getElementById('reg-fullname')?.value.trim();
  const phoneRaw = document.getElementById('reg-phone')?.value.trim();
  const em = document.getElementById('reg-email')?.value.trim();
  const u = document.getElementById('reg-username')?.value.trim();
  const p = document.getElementById('reg-pwd')?.value.trim();
  const ref = document.getElementById('reg-ref-code') ? document.getElementById('reg-ref-code').value.trim() : "";

  if (!fullname || fullname.length < 3) { showToast("⚠️ Please enter valid full name!", "warning"); return; }
  if (!phoneRaw) { showToast("⚠️ Phone number is required!", "warning"); return; }

  const phoneCheck = validatePhoneNumber(phoneRaw);
  if (!phoneCheck.valid) { showToast(`⚠️ ${phoneCheck.msg}`, "warning"); return; }
  if (!em || !em.includes("@") || !em.includes(".")) { showToast("⚠️ Please enter a valid email address!", "warning"); return; }
  if (!u || u.length < 3) { showToast("⚠️ Username must be at least 3 characters!", "warning"); return; }
  if (!p || p.length < 4) { showToast("⚠️ Password must be at least 4 characters!", "warning"); return; }

  const uKey = u.toLowerCase();
  if (localStorage.getItem(`mineora_user_${uKey}`)) { showToast("⚠️ Username already registered!", "warning"); return; }

  loadUserWorld(u, p, ref, { fullname: fullname, phone: phoneCheck.phone, email: em, kycVerified: true });
  closeModal('modal-auth-register');
  enterGame();
  if (typeof renderAdminUserTable === 'function') renderAdminUserTable();
  showToast(`🎉 Welcome ${fullname}! Account created successfully.`, "success");
};

function enterGame() {
  document.getElementById('screen-landing')?.classList.add('hidden');
  document.getElementById('screen-game')?.classList.remove('hidden');
  updateHUD();
  configureUserTabs();
  updateNotificationBadge();
  if (typeof applyTranslations === 'function') applyTranslations();
  if (CurrentUser && CurrentUser.isRootAdmin && typeof initAdminMasterPanel === 'function') {
    initAdminMasterPanel();
  }
}

function logoutSession() {
  sessionStorage.removeItem('mineora_active_session');
  saveUserWorld();
  CurrentUser = null;
  CurrentUserWorld = null;
  if (typeof mFrame !== 'undefined' && mFrame) cancelAnimationFrame(mFrame);
  if (typeof crashFrame !== 'undefined' && crashFrame) cancelAnimationFrame(crashFrame);
  document.getElementById('screen-game')?.classList.add('hidden');
  document.getElementById('screen-landing')?.classList.remove('hidden');
  
  const secBoss = document.getElementById('sec-boss');
  if (secBoss) secBoss.style.display = 'none';

  showToast("🔒 Session closed.", "info");
}

function configureUserTabs() {
  if (!CurrentUser) return;
  const isBoss = !!CurrentUser.isRootAdmin;

  const tabBoss = document.getElementById('tab-btn-boss');
  const secBoss = document.getElementById('sec-boss');

  if (tabBoss) {
    tabBoss.style.display = isBoss ? 'flex' : 'none';
  }
  if (secBoss) {
    secBoss.style.display = isBoss ? '' : 'none';
  }

  const btnOwner = document.getElementById('tab-btn-owner');
  const ownerText = document.getElementById('tab-owner-text');
  if (btnOwner) {
    btnOwner.classList.remove('hidden');
    if (ownerText) ownerText.innerText = t('tab_owner');
  }

  document.getElementById('tab-btn-map')?.classList.remove('hidden');
  document.getElementById('tab-btn-cave')?.classList.remove('hidden');
  document.getElementById('tab-btn-live')?.classList.remove('hidden');

  if (isBoss) switchTab('boss');
  else switchTab('map');
}

function updateHUD() {
  if (!CurrentUser) return;
  const usdtEl = document.getElementById('hud-usdt-balance');
  const oraEl = document.getElementById('hud-ora-balance');
  const crystalEl = document.getElementById('hud-crystal-balance');
  const trcBox = document.getElementById('wallet-trc20-box');
  const userDisp = document.getElementById('player-username-display');
  const roleBadge = document.getElementById('player-role-badge');
  const trialBanner = document.getElementById('candidate-trial-banner');

  if (usdtEl) usdtEl.innerText = Number(parseFloat(CurrentUser.usdt || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (oraEl) oraEl.innerText = Number(parseFloat(CurrentUser.ora || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (crystalEl) crystalEl.innerText = CurrentUser.alpCrystals || 0;
  if (trcBox) trcBox.value = CurrentUser.bep20DepositAddress || OFFICIAL_TRC20_DEPOSIT_ADDRESS;
  if (userDisp) userDisp.innerText = CurrentUser.username;

  if (roleBadge) {
    let roleKey = 'role_candidate';
    if (CurrentUser.role === "İşçi Madenci" || CurrentUser.role === "Worker Miner") roleKey = 'role_worker';
    else if (CurrentUser.role === "Maden Sahibi" || CurrentUser.role === "Mine Owner") roleKey = 'role_mine_owner';
    else if (CurrentUser.role === "Şirket Sahibi" || CurrentUser.role === "Holding Owner") roleKey = 'role_hold_owner';

    roleBadge.innerText = CurrentUser.isRootAdmin ? t('role_admin') : t(roleKey);
    roleBadge.className = (roleKey === 'role_candidate')
      ? "px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-black uppercase bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0 truncate max-w-[90px]"
      : "px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-black uppercase bg-mineora-gold/15 text-mineora-gold border border-mineora-gold/30 shrink-0 truncate max-w-[90px]";
  }

  if (trialBanner) {
    if ((CurrentUser.role === "Aday" || CurrentUser.role === "Candidate") && !CurrentUser.isRootAdmin && Number(CurrentUser.usdt || 0) === 0 && !CurrentUser.hasDeposited) {
      const left = getCandidateRemainingTrialMs(CurrentUser);
      trialBanner.classList.remove('hidden');
      if (left <= 0) {
        trialBanner.innerHTML = `<span class="text-rose-400 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${t('trial_expired')}</span>`;
      } else {
        const hours = Math.floor(left / 3600000);
        const mins = Math.floor((left % 3600000) / 60000);
        const secs = Math.floor((left % 60000) / 1000);
        trialBanner.innerHTML = `<span class="text-amber-300 font-mono text-xs"><i class="fa-solid fa-stopwatch mr-1"></i> ${t('trial_countdown')} <strong>${hours}h ${mins}m ${secs}s</strong></span>`;
      }
    } else {
      trialBanner.classList.add('hidden');
    }
  }

  updateNotificationBadge();
  if (typeof renderAdminHUD === 'function') renderAdminHUD();
}

function switchTab(tTab) {
  const isBoss = CurrentUser && !!CurrentUser.isRootAdmin;
  if (tTab === 'boss' && !isBoss) { 
    showToast("⛔ Access restricted!", "warning"); 
    tTab = 'career'; 
  }

  const allTabs = ['boss', 'owner', 'home', 'map', 'cave', 'crash', 'live', 'p2p', 'stake', 'career', 'settings'];
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
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-white bg-rose-600 shadow-lg shadow-rose-600/30 transition cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition cursor-pointer";
      } else if (tab === 'crash') {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-black bg-cyan-400 shadow-lg shadow-cyan-400/30 transition cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition cursor-pointer";
      } else if (tab === 'live') {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-rose-600 to-amber-600 shadow-lg shadow-rose-600/30 transition cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition cursor-pointer";
      } else {
        b.className = isActive 
          ? "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold bg-mineora-gold text-black shadow-md shadow-mineora-gold/20 transition cursor-pointer" 
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-mineora-input/50 transition cursor-pointer";
      }
    }
  });

  if (tTab === 'cave' && typeof initMineCanvas === 'function') initMineCanvas();
  if (tTab === 'crash' && typeof initCrashEngine === 'function') initCrashEngine();
  if (tTab === 'map' && typeof renderAlpMapPins === 'function') renderAlpMapPins();
  if (tTab === 'p2p' && typeof renderP2pOrders === 'function') renderP2pOrders();
  if (tTab === 'stake' && typeof renderActiveStakes === 'function') renderActiveStakes();
  if (tTab === 'owner' && typeof renderHierarchyUI === 'function') renderHierarchyUI();
  if (tTab === 'live' && typeof initLiveRoomsLobby === 'function') initLiveRoomsLobby();
  if (tTab === 'boss' && isBoss && typeof initAdminMasterPanel === 'function') initAdminMasterPanel();
}
window.switchTab = switchTab;

function copyRefCode() {
  if (!CurrentUser) return;
  const isCompany = CurrentUser.role === "Şirket Sahibi" || CurrentUser.role === "Holding Owner";
  const activeRef = isCompany
    ? (CurrentUser.customCompanyRefCode || CurrentUser.companyRefCode || `HOLD-${CurrentUser.username.toUpperCase()}-999`)
    : (CurrentUser.customRefCode || CurrentUser.refCode || `MINE-${CurrentUser.username.toUpperCase()}-777`);
  navigator.clipboard.writeText(activeRef).then(() => {
    showToast(`📋 Referral code copied: ${activeRef}`, "success");
  });
}

function upgradeRole(role, costUsdt) {
  if (!CurrentUser) return;
  const costOra = Number((costUsdt * 10).toFixed(2));
  const currentOra = Number(parseFloat(CurrentUser.ora || 0).toFixed(2));

  if (currentOra < costOra) {
    showToast(`⚠️ Insufficient ORA! '${role}' role requires ${costUsdt} USDT equivalent (${costOra} ORA).`, "warning");
    return;
  }
  CurrentUser.ora = Number((currentOra - costOra).toFixed(2));
  CurrentUser.role = role;
  addUserNotificationLog(CurrentUser, "Role Upgrade", `Upgraded to ${role}.`, `-${costOra.toFixed(2)} ORA`, "upgrade");

  if (role === "Holding Owner" || role === "Şirket Sahibi") {
    if (!CurrentUser.companyRefCode) CurrentUser.companyRefCode = `HOLD-${CurrentUser.username.toUpperCase()}-999`;
  } else if (role === "Mine Owner" || role === "Maden Sahibi") {
    if (!CurrentUser.refCode) CurrentUser.refCode = `MINE-${CurrentUser.username.toUpperCase()}-777`;
  }

  distributeFourDepthCommission(CurrentUser, costOra);
  saveUserWorld();
  updateHUD();
  configureUserTabs();
  showToast(`🎉 Role successfully updated to '${role}'!`, "success");
}

function handlePasswordChange() {
  const oldP = document.getElementById('pwd-old')?.value;
  const newP = document.getElementById('pwd-new')?.value;
  const repP = document.getElementById('pwd-repeat')?.value;
  if (!oldP || !newP || !repP) { showToast("⚠️ Fill in all fields!", "warning"); return; }
  if (oldP !== CurrentUser.pass) { showToast("⚠️ Current password incorrect!", "warning"); return; }
  if (newP !== repP) { showToast("⚠️ Passwords do not match!", "warning"); return; }
  if (newP.length < 4) { showToast("⚠️ Password must be at least 4 characters!", "warning"); return; }
  
  CurrentUser.pass = newP;
  CurrentUserWorld.pass = newP;
  saveUserWorld();

  document.getElementById('pwd-old').value = "";
  document.getElementById('pwd-new').value = "";
  document.getElementById('pwd-repeat').value = "";

  showToast("🔐 Password updated across the cloud!", "success");
}

function renderHierarchyUI() {
  const container = document.getElementById('sec-owner');
  if (!container || !CurrentUser) return;
  
  const isCompany = CurrentUser.role === "Şirket Sahibi" || CurrentUser.role === "Holding Owner";
  const activeRef = isCompany
    ? (CurrentUser.customCompanyRefCode || CurrentUser.companyRefCode || `HOLD-${CurrentUser.username.toUpperCase()}-999`)
    : (CurrentUser.customRefCode || CurrentUser.refCode || `MINE-${CurrentUser.username.toUpperCase()}-777`);
  
  const team = getFourDepthTeam(CurrentUser.username);
  const d1 = team.filter(m => m.depth === 1).length;
  const d2 = team.filter(m => m.depth === 2).length;
  const d3 = team.filter(m => m.depth === 3).length;
  const d4 = team.filter(m => m.depth === 4).length;

  container.innerHTML = `
    <div class="bg-mineora-card border border-mineora-gold/40 rounded-3xl p-6 shadow-2xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-mineora-border pb-5">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-mineora-gold/20 text-mineora-gold flex items-center justify-center text-xl font-black border border-current">
            <i class="fa-solid fa-sitemap"></i>
          </div>
          <div>
            <h2 class="text-lg font-black text-white flex items-center gap-2">
              <span>${CurrentUser.username}</span> • 4-Tier Referral Tree
            </h2>
            <p class="text-xs text-slate-400">Live network monitor up to 4 complete levels.</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 bg-mineora-bg p-2 rounded-2xl border border-mineora-border">
          <span class="text-[9px] text-slate-400">Your Referral Code: <strong class="text-cyan-400 font-mono text-sm">${activeRef}</strong></span>
          <button type="button" onclick="copyRefCode()" class="px-3 py-1.5 rounded-xl bg-cyan-600 text-white font-bold text-xs cursor-pointer"><i class="fa-solid fa-copy"></i> Copy</button>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div class="p-3.5 bg-mineora-bg rounded-2xl border border-emerald-500/30">
          <span class="text-slate-400 text-[10px] block font-bold">1st Tier (10%)</span>
          <strong class="text-emerald-400 font-mono text-sm">${d1} Members</strong>
        </div>
        <div class="p-3.5 bg-mineora-bg rounded-2xl border border-cyan-500/30">
          <span class="text-slate-400 text-[10px] block font-bold">2nd Tier (7%)</span>
          <strong class="text-cyan-400 font-mono text-sm">${d2} Members</strong>
        </div>
        <div class="p-3.5 bg-mineora-bg rounded-2xl border border-amber-500/30">
          <span class="text-slate-400 text-[10px] block font-bold">3rd Tier (5%)</span>
          <strong class="text-amber-400 font-mono text-sm">${d3} Members</strong>
        </div>
        <div class="p-3.5 bg-mineora-bg rounded-2xl border border-purple-500/30">
          <span class="text-slate-400 text-[10px] block font-bold">4th Tier (3%)</span>
          <strong class="text-purple-400 font-mono text-sm">${d4} Members</strong>
        </div>
      </div>

      <div class="space-y-3 pt-2">
        <div class="flex justify-between items-center">
          <h3 class="text-xs font-black uppercase text-slate-300 flex items-center gap-2">
            <i class="fa-solid fa-users text-cyan-400"></i> Downline Roster (Max 4 Depths)
          </h3>
          <span class="text-[10px] text-slate-500 font-mono">Tier 5+ hidden</span>
        </div>

        <div class="overflow-x-auto rounded-xl border border-mineora-border">
          <table class="w-full text-left text-xs">
            <thead class="bg-black/40 text-slate-400 uppercase text-[10px]">
              <tr>
                <th class="py-3 px-4">User</th>
                <th class="py-3 px-4">Depth</th>
                <th class="py-3 px-4">Direct Sponsor</th>
                <th class="py-3 px-4">Role</th>
                <th class="py-3 px-4 text-right">ORA Balance</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-mineora-border text-slate-200">
              ${team.length === 0 ? `
                <tr><td colspan="5" class="py-8 text-center text-slate-500">No members registered in your 4-depth boundary yet.</td></tr>
              ` : team.map(m => `
                <tr class="hover:bg-mineora-bg/50 transition">
                  <td class="py-3 px-4 font-bold text-white">${m.username}</td>
                  <td class="py-3 px-4">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                      m.depth === 1 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      m.depth === 2 ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                      m.depth === 3 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                      'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    }">
                      Tier ${m.depth}
                    </span>
                  </td>
                  <td class="py-3 px-4 font-mono text-slate-400">${m.sponsor}</td>
                  <td class="py-3 px-4 font-bold text-slate-300">${m.role}</td>
                  <td class="py-3 px-4 text-right font-mono text-mineora-gold font-bold">${Number(m.ora).toFixed(2)} ORA</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

window.grantMasterAccess = function(secretKey) {
  if (secretKey === "mineora777root" && CurrentUser) {
    CurrentUser.isRootAdmin = true;
    CurrentUserWorld.isRootAdmin = true;
    saveUserWorld();
    updateHUD();
    configureUserTabs();
    showToast("👑 Admin authority activated on this account!", "success");
  } else {
    showToast("⛔ Invalid master key!", "warning");
  }
};