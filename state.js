// ================= MINEORA TEMEL DURUM, ÇOKLU LİSANS & REFERANS MOTORU (state.js) =================
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
  console.warn("Firebase baglanti uyarisi:", e);
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
    { id: 0, name: "Silverstream Alpine Mine", mineral: "Bakir & Kristal Damari", hp: 100, depleted: false, sealedAt: null },
    { id: 1, name: "Firepath Magmatic Trench", mineral: "Yakut & Akik Yatagi", hp: 100, depleted: false, sealedAt: null },
    { id: 2, name: "Dark Valley Obsidian Shaft", mineral: "Saf Obsidyen Damari", hp: 100, depleted: false, sealedAt: null },
    { id: 3, name: "Densepine Emerald Basin", mineral: "Zumrut ve Granit Havzasi", hp: 100, depleted: false, sealedAt: null },
    { id: 4, name: "Goldpeak Apex Vein", mineral: "Dogal Dag Altini", hp: 100, depleted: false, sealedAt: null }
  ];
}

let CurrentUser = null;
let CurrentUserWorld = null;

function getStoredUser(username) {
  if (!username) return null;
  const raw = localStorage.getItem('mineora_user_' + username.toLowerCase());
  return raw ? JSON.parse(raw) : null;
}
window.getStoredUser = getStoredUser;

function saveStoredUser(userObj) {
  if (!userObj || !userObj.username) return;
  const uKey = userObj.username.toLowerCase();
  localStorage.setItem('mineora_user_' + uKey, JSON.stringify(userObj));
  
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('users/' + uKey).set(userObj).catch(err => {
      console.warn("Firebase yazma uyarisi (" + uKey + "):", err.message);
    });
  }
}
window.saveStoredUser = saveStoredUser;

function saveUserWorld() {
  if (!CurrentUserWorld) return;
  saveStoredUser(CurrentUserWorld);
}
window.saveUserWorld = saveUserWorld;

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
window.addUserNotificationLog = addUserNotificationLog;

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
window.checkMinesCooldown = checkMinesCooldown;

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
window.findUserByRefCode = findUserByRefCode;

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
    const tierName = (i + 1) + ". Kademe Referans Primi (%" + Math.round(rate * 100) + ")";

    sponsorObj.tl = Number(((sponsorObj.tl || 0) + commissionTl).toFixed(2));
    addUserNotificationLog(sponsorObj, tierName, buyerUser.username + " lisans aldi.", "+" + commissionTl.toFixed(2) + " TL", "commission");
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
window.calculateTotalDailyReturnTl = calculateTotalDailyReturnTl;

function purchaseLicense(type, costTl) {
  if (!CurrentUser) return;
  const currentTl = Number(parseFloat(CurrentUser.tl || 0).toFixed(2));

  if (currentTl < costTl) {
    showToast("Yetersiz bakiye! Lisans bedeli: " + costTl.toLocaleString() + " TL", "warning");
    return;
  }

  CurrentUser.tl = Number((currentTl - costTl).toFixed(2));
  if (!CurrentUser.licenses) {
    CurrentUser.licenses = { worker: 0, mine: 0, holding: 0 };
  }

  CurrentUser.licenses[type] = (CurrentUser.licenses[type] || 0) + 1;

  let typeName = "Isci Madenci";
  if (type === 'mine') typeName = "Maden Sahibi";
  if (type === 'holding') typeName = "Holding Sahibi";

  addUserNotificationLog(CurrentUser, "Lisans Satın Alindi", "1 Adet " + typeName + " lisansi portfoye eklendi.", "-" + costTl.toLocaleString() + " TL", "upgrade");

  distributeFourDepthCommission(CurrentUser, costTl);
  saveUserWorld();
  updateHUD();
  showToast("Tebrikler! 1 adet " + typeName + " lisansi basariyla alindi!", "success");
}
window.purchaseLicense = purchaseLicense;

function linkHierarchyByRefCode(newUsername, refCode) {
  if (!refCode || !refCode.trim()) return;
  const leader = findUserByRefCode(refCode);
  if (!leader) return;

  const targetUser = getStoredUser(newUsername);
  if (!targetUser) return;

  const parentChain = Array.isArray(leader.referral_chain) ? leader.referral_chain : [];
  targetUser.referral_chain = [...parentChain, leader.username];
  targetUser.referredBy = refCode;
  saveStoredUser(targetUser);

  if (!leader.workers) leader.workers = [];
  const exists = leader.workers.some(w => (w.username || '').toLowerCase() === newUsername.toLowerCase());
  if (!exists) {
    leader.workers.unshift({ username: newUsername, joinedAt: new Date().toLocaleDateString('tr-TR') });
    saveStoredUser(leader);
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
      const myRef = (CurrentUser && CurrentUser.refCode ? CurrentUser.refCode : "").toUpperCase();
      if (refVal === myRef || refVal === target.toUpperCase()) {
        depth = 1;
        directSponsor = targetUsername;
      }
    }

    if (depth >= 1 && depth <= 4) {
      team.push({
        username: member.username,
        depth: depth,
        sponsor: directSponsor,
        licenses: member.licenses || { worker: 0, mine: 0, holding: 0 },
        tl: member.tl || 0
      });
    }
  });

  return team.sort((a, b) => a.depth - b.depth);
}
window.getFourDepthTeam = getFourDepthTeam;

function renderHierarchyUI() {
  const container = document.getElementById('sec-owner');
  if (!container || !CurrentUser) return;

  const activeRef = CurrentUser.refCode || ("MINE-" + CurrentUser.username.toUpperCase() + "-777");
  const inviteLink = window.location.origin + window.location.pathname + "?ref=" + activeRef;

  const team = getFourDepthTeam(CurrentUser.username);
  const d1 = team.filter(m => m.depth === 1).length;
  const d2 = team.filter(m => m.depth === 2).length;
  const d3 = team.filter(m => m.depth === 3).length;
  const d4 = team.filter(m => m.depth === 4).length;

  let rowsHtml = '';
  if (team.length === 0) {
    rowsHtml = '<tr><td colspan="5" class="py-8 text-center text-slate-500">Henuz alt ekibinizde kayitli madenci bulunmuyor. Davet linkinizi paylasarak ekibinizi kurabilirsiniz.</td></tr>';
  } else {
    team.forEach(m => {
      const l = m.licenses || {};
      const licStr = (l.worker || 0) + ' Madenci / ' + (l.mine || 0) + ' Sahip / ' + (l.holding || 0) + ' Holding';
      let badgeStyle = 'bg-slate-700 text-slate-300';
      if (m.depth === 1) badgeStyle = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      else if (m.depth === 2) badgeStyle = 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
      else if (m.depth === 3) badgeStyle = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
      else if (m.depth === 4) badgeStyle = 'bg-purple-500/20 text-purple-300 border border-purple-500/30';

      rowsHtml += '<tr class="hover:bg-mineora-bg/50 transition">' +
        '<td class="py-3 px-4 font-bold text-white">' + m.username + '</td>' +
        '<td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ' + badgeStyle + '">' + m.depth + '. Kademe</span></td>' +
        '<td class="py-3 px-4 font-mono text-slate-400">' + m.sponsor + '</td>' +
        '<td class="py-3 px-4 text-slate-300 font-bold text-[11px]">' + licStr + '</td>' +
        '<td class="py-3 px-4 text-right font-mono text-emerald-400 font-bold">' + Number(m.tl || 0).toFixed(2) + ' TL</td>' +
        '</tr>';
    });
  }

  container.innerHTML = 
    '<div class="bg-mineora-card border border-mineora-gold/40 rounded-3xl p-6 shadow-2xl space-y-6">' +
      '<div class="flex flex-wrap items-center justify-between gap-4 border-b border-mineora-border pb-5">' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-12 h-12 rounded-2xl bg-mineora-gold/20 text-mineora-gold flex items-center justify-center text-xl font-black border border-current">' +
            '<i class="fa-solid fa-sitemap"></i>' +
          '</div>' +
          '<div>' +
            '<h2 class="text-lg font-black text-white flex items-center gap-2">' +
              '<span>' + CurrentUser.username + '</span> - 4 Kademeli Referans Agi' +
            '</h2>' +
            '<p class="text-xs text-slate-400">Alt ekibiniz lisans aldikca 4 kademeye kadar dogrudan TL primi kazanirsiniz.</p>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-2 bg-mineora-bg p-2 rounded-2xl border border-mineora-border max-w-full">' +
          '<div class="overflow-hidden">' +
            '<span class="text-[9px] text-slate-400 block font-bold uppercase">Ozel Davet Linkiniz</span>' +
            '<span class="text-cyan-400 font-mono text-xs font-bold truncate block select-all">' + inviteLink + '</span>' +
          '</div>' +
          '<button type="button" onclick="copyRefLink()" class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 text-white font-black text-xs cursor-pointer shadow flex items-center gap-1.5 shrink-0 transition">' +
            '<i class="fa-solid fa-link"></i> Linki Kopyala' +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">' +
        '<div class="p-4 bg-mineora-bg rounded-2xl border border-emerald-500/30">' +
          '<span class="text-slate-400 text-[10px] block font-bold uppercase">1. Kademe (%10 Prim)</span>' +
          '<strong class="text-emerald-400 font-mono text-base block mt-1">' + d1 + ' Uye</strong>' +
        '</div>' +
        '<div class="p-4 bg-mineora-bg rounded-2xl border border-cyan-500/30">' +
          '<span class="text-slate-400 text-[10px] block font-bold uppercase">2. Kademe (%7 Prim)</span>' +
          '<strong class="text-cyan-400 font-mono text-base block mt-1">' + d2 + ' Uye</strong>' +
        '</div>' +
        '<div class="p-4 bg-mineora-bg rounded-2xl border border-amber-500/30">' +
          '<span class="text-slate-400 text-[10px] block font-bold uppercase">3. Kademe (%5 Prim)</span>' +
          '<strong class="text-amber-400 font-mono text-base block mt-1">' + d3 + ' Uye</strong>' +
        '</div>' +
        '<div class="p-4 bg-mineora-bg rounded-2xl border border-purple-500/30">' +
          '<span class="text-slate-400 text-[10px] block font-bold uppercase">4. Kademe (%3 Prim)</span>' +
          '<strong class="text-purple-400 font-mono text-base block mt-1">' + d4 + ' Uye</strong>' +
        '</div>' +
      '</div>' +

      '<div class="space-y-3 pt-2">' +
        '<div class="flex justify-between items-center px-1">' +
          '<h3 class="text-xs font-black uppercase text-slate-300 flex items-center gap-2">' +
            '<i class="fa-solid fa-users text-cyan-400"></i> Alt Ekip Listesi (Toplam ' + team.length + ' Madenci)' +
          '</h3>' +
          '<span class="text-[10px] text-slate-500 font-mono">4. kademeden sonrasi gizlenir</span>' +
        '</div>' +
        '<div class="overflow-x-auto rounded-xl border border-mineora-border">' +
          '<table class="w-full text-left text-xs">' +
            '<thead class="bg-black/50 text-slate-400 uppercase text-[10px] border-b border-mineora-border">' +
              '<tr>' +
                '<th class="py-3 px-4">Kullanici</th>' +
                '<th class="py-3 px-4">Kademe</th>' +
                '<th class="py-3 px-4">Direkt Sponsor</th>' +
                '<th class="py-3 px-4">Aktif Lisanslar</th>' +
                '<th class="py-3 px-4 text-right">TL Kasasi</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody class="divide-y divide-mineora-border text-slate-200">' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
    '</div>';
}
window.renderHierarchyUI = renderHierarchyUI;

function copyRefLink() {
  if (!CurrentUser) return;
  const activeRef = CurrentUser.refCode || ("MINE-" + CurrentUser.username.toUpperCase() + "-777");
  const inviteLink = window.location.origin + window.location.pathname + "?ref=" + activeRef;
  navigator.clipboard.writeText(inviteLink).then(() => {
    showToast("Davet linkiniz kopyalandi:\n" + inviteLink, "success");
  });
}
window.copyRefLink = copyRefLink;

function loadUserWorld(username, defaultPass = "123456", refCodeUsed = "", extraProfile = {}) {
  const uKey = username.toLowerCase();
  const storageKey = 'mineora_user_' + uKey;
  
  CurrentUserWorld = null;
  let localData = localStorage.getItem(storageKey);
  if (localData) {
    try { CurrentUserWorld = JSON.parse(localData); } catch(e) { CurrentUserWorld = null; }
  }
  
  const now = Date.now();
  if (CurrentUserWorld && CurrentUserWorld.username && CurrentUserWorld.username.toLowerCase() === uKey) {
    CurrentUserWorld.tl = Number(parseFloat(CurrentUserWorld.tl || 0).toFixed(2));
    if (!CurrentUserWorld.licenses) CurrentUserWorld.licenses = { worker: 0, mine: 0, holding: 0 };
    if (!CurrentUserWorld.logs) CurrentUserWorld.logs = [];
    if (!CurrentUserWorld.referral_chain) CurrentUserWorld.referral_chain = [];
    CurrentUserWorld.alpCrystals = CurrentUserWorld.alpCrystals || 0;
    CurrentUserWorld.isRootAdmin = (uKey === 'mourpheus');
    saveUserWorld();
  } else {
    CurrentUserWorld = {
      username: username,
      fullname: extraProfile.fullname || username,
      phone: extraProfile.phone || "",
      pass: defaultPass,
      email: extraProfile.email || (username + "@mineora.io"),
      tl: 0.00,
      alpCrystals: 0,
      role: (uKey === 'mourpheus') ? "Root Admin" : "Aday",
      licenses: (uKey === 'mourpheus') ? { worker: 1, mine: 1, holding: 1 } : { worker: 0, mine: 0, holding: 0 },
      isRootAdmin: (uKey === 'mourpheus'),
      isVaultLocked: false,
      createdAt: now,
      refCode: "MINE-" + username.toUpperCase() + "-777",
      referredBy: refCodeUsed || "",
      referral_chain: [],
      mines: getDefaultMines(),
      logs: []
    };
    saveUserWorld();
    if (refCodeUsed) {
      linkHierarchyByRefCode(username, refCodeUsed);
    }
  }
  
  CurrentUser = CurrentUserWorld;
  sessionStorage.setItem('mineora_active_session', CurrentUser.username);
  checkMinesCooldown();

  if (fbDb) {
    fbDb.ref('users/' + uKey).once('value').then(snap => {
      const cloudData = snap.val();
      if (cloudData) {
        CurrentUserWorld = cloudData;
        CurrentUser = cloudData;
        localStorage.setItem(storageKey, JSON.stringify(cloudData));
        updateHUD();
      } else {
        fbDb.ref('users/' + uKey).set(CurrentUserWorld);
      }
    });
  }
}
window.loadUserWorld = loadUserWorld;

if (fbDb) {
  fbDb.ref('users').on('value', snap => {
    const allUsers = snap.val();
    if (allUsers) {
      Object.keys(allUsers).forEach(k => {
        localStorage.setItem('mineora_user_' + k.toLowerCase(), JSON.stringify(allUsers[k]));
      });
      if (CurrentUser && allUsers[CurrentUser.username.toLowerCase()]) {
        CurrentUser = allUsers[CurrentUser.username.toLowerCase()];
        CurrentUserWorld = CurrentUser;
        updateHUD();
      }
      if (CurrentUser && CurrentUser.isRootAdmin && typeof renderAdminUserTable === 'function') {
        renderAdminUserTable();
      }
    }
  });
}

function updateHUD() {
  if (!CurrentUser) return;
  const tlEl = document.getElementById('hud-tl-balance');
  const crystalEl = document.getElementById('hud-crystal-balance');
  const userDisp = document.getElementById('player-username-display');
  const activeLicEl = document.getElementById('my-active-licenses-badge');
  const dailyStatusEl = document.getElementById('daily-earned-status-text');

  if (tlEl) tlEl.innerText = Number(parseFloat(CurrentUser.tl || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
  if (crystalEl) crystalEl.innerText = CurrentUser.alpCrystals || 0;
  if (userDisp) userDisp.innerText = CurrentUser.username;

  const totalDaily = calculateTotalDailyReturnTl(CurrentUser);
  if (dailyStatusEl) {
    dailyStatusEl.innerText = "Gunluk Kazanc Hakki: " + totalDaily.toFixed(2) + " TL";
  }

  if (activeLicEl && CurrentUser.licenses) {
    const l = CurrentUser.licenses;
    activeLicEl.innerText = (l.worker || 0) + " Madenci | " + (l.mine || 0) + " Sahip | " + (l.holding || 0) + " Holding (Toplam: " + totalDaily.toFixed(2) + " TL/gun)";
  }

  updateNotificationBadge();
  if (typeof renderAdminHUD === 'function') renderAdminHUD();
}
window.updateHUD = updateHUD;

// SEKMELER ARASI GEÇİŞ (KOLONİ ÇIKARILDI)
function switchTab(tTab) {
  if (typeof toggleMobileMenu === 'function') toggleMobileMenu(false);

  const isBoss = CurrentUser && !!CurrentUser.isRootAdmin;
  if (tTab === 'boss' && !isBoss) { 
    showToast("Erisim yetkiniz yok!", "warning"); 
    tTab = 'career'; 
  }

  const allTabs = ['boss', 'owner', 'map', 'cave', 'crash', 'live', 'career', 'settings'];
  allTabs.forEach(tab => {
    const secEl = document.getElementById('sec-' + tab);
    if (secEl) {
      if (tab === 'boss') {
        secEl.style.display = (isBoss && tTab === 'boss') ? '' : 'none';
      } else {
        secEl.classList.toggle('hidden', tab !== tTab);
      }
    }
    const b = document.getElementById('tab-btn-' + tab);
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
  if (tTab === 'live' && typeof initLiveRoomsLobby === 'function') initLiveRoomsLobby();
  if (tTab === 'owner' && typeof renderHierarchyUI === 'function') renderHierarchyUI();
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
  tEl.className = 'px-4 py-3 rounded-2xl border shadow-2xl text-xs font-bold transition transform duration-300 pointer-events-auto ' + (colors[type] || colors.info);
  tEl.innerHTML = msg;
  container.appendChild(tEl);
  setTimeout(() => tEl.remove(), 3200);
}
window.showToast = showToast;

function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  if (!CurrentUser) return;
  const unreadCount = (CurrentUser.logs || []).filter(l => !l.read).length;
  if (badge) {
    if (unreadCount > 0) { badge.innerText = unreadCount; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }
}
window.updateNotificationBadge = updateNotificationBadge;

function handleLogin() {
  const uInput = document.getElementById('login-user');
  const pInput = document.getElementById('login-pwd');
  const u = uInput?.value.trim();
  const p = pInput?.value.trim();
  if (!u || !p) { showToast("Kullanici adi ve sifre girin!", "warning"); return; }

  const uKey = u.toLowerCase();
  const storageKey = 'mineora_user_' + uKey;

  const proceedLogin = (userData) => {
    if (!userData) {
      if (uKey === 'mourpheus' && p === '4834754') {
        loadUserWorld('mourpheus', p);
        closeModal('modal-auth-login');
        enterGame();
        showToast("Hos geldiniz Root Admin mourpheus!", "success");
        return;
      }
      showToast("Kullanici bulunamadi!", "warning");
      return;
    }

    if (userData.pass !== p) {
      showToast("Hatali sifre!", "warning");
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(userData));
    loadUserWorld(u, p);
    closeModal('modal-auth-login');
    enterGame();
    
    if (uKey === 'mourpheus' && typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signInWithEmailAndPassword("ersinulasduzyol@gmail.com", p)
        .then(() => console.log("Firebase Admin Auth aktif."))
        .catch(e => console.warn("Admin Auth:", e.message));
    }
    
    showToast("Hos geldiniz " + userData.username + "!", "success");
  };

  if (fbDb) {
    fbDb.ref('users/' + uKey).once('value').then(snap => {
      const cloudData = snap.val();
      if (cloudData) {
        proceedLogin(cloudData);
      } else {
        const localData = getStoredUser(uKey);
        proceedLogin(localData);
      }
    }).catch(() => {
      const localData = getStoredUser(uKey);
      proceedLogin(localData);
    });
  } else {
    const localData = getStoredUser(uKey);
    proceedLogin(localData);
  }
}
window.handleLogin = handleLogin;

function handleRegister() {
  const fullname = document.getElementById('reg-fullname')?.value.trim();
  const phone = document.getElementById('reg-phone')?.value.trim();
  const em = document.getElementById('reg-email')?.value.trim();
  const u = document.getElementById('reg-username')?.value.trim();
  const p = document.getElementById('reg-pwd')?.value.trim();
  const ref = document.getElementById('reg-ref-code')?.value.trim() || "";

  if (!fullname || !phone || !u || !p) { showToast("Lutfen tum alanlari doldurun!", "warning"); return; }
  const uKey = u.toLowerCase();

  const registerNewUser = () => {
    CurrentUser = null;
    CurrentUserWorld = null;
    loadUserWorld(u, p, ref, { fullname, phone, email: em });
    closeModal('modal-auth-register');
    enterGame();
    showToast("Tebrikler " + fullname + "! Hesabiniz olusturuldu.", "success");
  };

  if (fbDb) {
    fbDb.ref('users/' + uKey).once('value').then(snap => {
      if (snap.val()) {
        showToast("Bu kullanici adi zaten kayitli!", "warning");
      } else {
        registerNewUser();
      }
    }).catch(() => registerNewUser());
  } else {
    if (getStoredUser(uKey)) {
      showToast("Bu kullanici adi zaten kayitli!", "warning");
    } else {
      registerNewUser();
    }
  }
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
window.enterGame = enterGame;

function logoutSession() {
  sessionStorage.removeItem('mineora_active_session');
  if (CurrentUserWorld) {
    saveUserWorld();
  }
  CurrentUser = null;
  CurrentUserWorld = null;

  const loginUser = document.getElementById('login-user');
  const loginPwd = document.getElementById('login-pwd');
  if (loginUser) loginUser.value = "";
  if (loginPwd) loginPwd.value = "";

  document.getElementById('screen-game')?.classList.add('hidden');
  document.getElementById('screen-landing')?.classList.remove('hidden');

  const secBoss = document.getElementById('sec-boss');
  if (secBoss) secBoss.style.display = 'none';

  showToast("Oturum kapatildi.", "info");
}
window.logoutSession = logoutSession;

function handlePasswordChange() {
  const oldP = document.getElementById('pwd-old')?.value;
  const newP = document.getElementById('pwd-new')?.value;
  const repP = document.getElementById('pwd-repeat')?.value;
  if (!oldP || !newP || !repP) { showToast("Tum alanlari doldurun!", "warning"); return; }
  if (oldP !== CurrentUser.pass) { showToast("Mevcut sifreniz hatali!", "warning"); return; }
  if (newP !== repP) { showToast("Yeni sifreler eslesmiyor!", "warning"); return; }
  if (newP.length < 4) { showToast("Sifre en az 4 karakter olmalidir!", "warning"); return; }
  
  CurrentUser.pass = newP;
  saveUserWorld();
  document.getElementById('pwd-old').value = "";
  document.getElementById('pwd-new').value = "";
  document.getElementById('pwd-repeat').value = "";
  showToast("Sifreniz basariyla guncellendi!", "success");
}
window.handlePasswordChange = handlePasswordChange;
