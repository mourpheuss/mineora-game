// ================= DEV YÖNETİCİ KOMUTA MASASI (admin.js) =================
function initAdminMasterPanel() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  renderAdminHUD();
  updateAdminFinancialVaultMetrics();
  renderAdminUserTable();
  renderAdminGlobalHierarchy();
  renderAdminDepositQueue();
  renderAdminWithdrawalQueue();
  renderAdminContactMessages();
}
window.initAdminMasterPanel = initAdminMasterPanel;

function renderAdminHUD() {
  let totalUserTl = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u) totalUserTl += Number(u.tl || 0);
      } catch(e) {}
    }
  }
  const elTotal = document.getElementById('admin-total-user-tl');
  if (elTotal) elTotal.innerText = totalUserTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + " ₺";
}
window.renderAdminHUD = renderAdminHUD;

function updateAdminFinancialVaultMetrics() {
  let totalVaultTl = 0;
  let totalLicVolume = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u) {
          totalVaultTl += Number(u.tl || 0);
          const l = u.licenses || {};
          totalLicVolume += (l.worker || 0) * 3000 + (l.mine || 0) * 5000 + (l.holding || 0) * 10000;
        }
      } catch(e) {}
    }
  }

  const elTotal = document.getElementById('admin-total-user-tl');
  const elLic = document.getElementById('admin-total-license-volume');
  if (elTotal) elTotal.innerText = totalVaultTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + " ₺";
  if (elLic) elLic.innerText = totalLicVolume.toLocaleString('tr-TR') + " ₺";
}
window.updateAdminFinancialVaultMetrics = updateAdminFinancialVaultMetrics;

function renderAdminUserTable() {
  const tbody = document.getElementById('admin-user-table-body');
  if (!tbody) return;
  tbody.innerHTML = "";

  const allUsers = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u && u.username) allUsers.push(u);
      } catch(e) {}
    }
  }

  allUsers.forEach(u => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-mineora-bg/60 transition";
    const l = u.licenses || {};
    const licText = `${l.worker || 0} Madenci / ${l.mine || 0} Sahip / ${l.holding || 0} Holding`;

    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-white">${u.username} ${u.isRootAdmin ? '<span class="text-rose-400 text-[10px] ml-1">[ADMIN]</span>' : ''}</td>
      <td class="py-3 px-4 font-mono text-slate-400">${u.pass || '••••••'}</td>
      <td class="py-3 px-4 font-bold text-slate-300 text-[11px]">${u.role || 'Aday'}</td>
      <td class="py-3 px-4 font-mono text-slate-400 text-[11px]">${licText}</td>
      <td class="py-3 px-4 font-mono text-emerald-400 font-bold">${Number(u.tl || 0).toFixed(2)} ₺</td>
      <td class="py-3 px-4">${u.isVaultLocked ? '<span class="text-rose-400 font-bold">KİLİTLİ</span>' : '<span class="text-emerald-400">Açık</span>'}</td>
      <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
        <button type="button" onclick="openAdminUserLogsModal('${u.username}')" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer">Log Dökümü</button>
        ${!u.isRootAdmin ? `
          <button type="button" onclick="toggleAdminVaultLock('${u.username}')" class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px] font-bold cursor-pointer">
            ${u.isVaultLocked ? 'Kilidi Aç' : 'Kilitle'}
          </button>
        ` : ''}
        <button type="button" onclick="openAdminModifyUserModal('${u.username}')" class="px-2.5 py-1 rounded bg-cyan-600/30 text-cyan-300 hover:bg-cyan-600/50 text-[11px] font-bold cursor-pointer">Düzenle</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.renderAdminUserTable = renderAdminUserTable;

function toggleAdminVaultLock(username) {
  const u = getStoredUser(username);
  if (!u || u.isRootAdmin) return;
  u.isVaultLocked = !u.isVaultLocked;
  saveStoredUser(u);
  renderAdminUserTable();
  showToast(`🔒 ${username} kasa durumu güncellendi.`, "info");
}
window.toggleAdminVaultLock = toggleAdminVaultLock;

let activeModTargetUser = null;

// ROL VE TL DEĞERLERİNİ MODALA DOLDURMA
function openAdminModifyUserModal(username) {
  const u = getStoredUser(username);
  if (!u) return;
  activeModTargetUser = u;

  document.getElementById('admin-target-user-name').innerText = u.username;
  document.getElementById('admin-mod-tl').value = Number(u.tl || 0);

  const roleSelect = document.getElementById('admin-mod-role');
  if (roleSelect) {
    roleSelect.value = u.role || 'Aday';
  }

  openModal('modal-admin-modify-user');
}
window.openAdminModifyUserModal = openAdminModifyUserModal;

// ROLÜ VE TL BAKİYESİNİ KAYDETME
function saveAdminUserModifications() {
  if (!activeModTargetUser) return;

  const newTl = parseFloat(document.getElementById('admin-mod-tl').value) || 0;
  const newRole = document.getElementById('admin-mod-role')?.value || activeModTargetUser.role || 'Aday';

  const oldTl = Number(activeModTargetUser.tl || 0);
  const diffTl = Number((newTl - oldTl).toFixed(2));

  if (Math.abs(diffTl) >= 0.01) {
    const sign = diffTl > 0 ? "+" : "";
    addUserNotificationLog(
      activeModTargetUser,
      "Yönetici Bakiye Düzenlemesi",
      "Yönetim masası tarafından bakiye güncellendi.",
      `${sign}${diffTl.toFixed(2)} ₺`,
      diffTl > 0 ? "admin_grant" : "admin_deduct"
    );
  }

  activeModTargetUser.tl = Number(newTl.toFixed(2));
  activeModTargetUser.role = newRole;

  if (!activeModTargetUser.licenses) activeModTargetUser.licenses = { worker: 0, mine: 0, holding: 0 };
  if (newRole === 'Worker Miner' && activeModTargetUser.licenses.worker === 0) {
    activeModTargetUser.licenses.worker = 1;
  } else if (newRole === 'Mine Owner' && activeModTargetUser.licenses.mine === 0) {
    activeModTargetUser.licenses.mine = 1;
  } else if (newRole === 'Holding Owner' && activeModTargetUser.licenses.holding === 0) {
    activeModTargetUser.licenses.holding = 1;
  }

  saveStoredUser(activeModTargetUser);
  closeModal('modal-admin-modify-user');
  renderAdminUserTable();
  updateAdminFinancialVaultMetrics();
  showToast(`💾 ${activeModTargetUser.username} kullanıcısının rolü ve bakiyesi güncellendi!`, "success");
}
window.saveAdminUserModifications = saveAdminUserModifications;

function queueDepositForAdminApproval(username, amount, senderName, receiptBase64) {
  if (!fbDb) return;
  const depId = `dep_${Date.now()}`;
  fbDb.ref(`depositQueue/${depId}`).set({
    id: depId, username: username, amount: amount, senderName: senderName,
    receiptBase64: receiptBase64, date: new Date().toLocaleString('tr-TR'), status: 'pending'
  });
}
window.queueDepositForAdminApproval = queueDepositForAdminApproval;

function renderAdminDepositQueue() {
  const container = document.getElementById('admin-deposit-queue-list');
  if (!container || !fbDb) return;

  fbDb.ref('depositQueue').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen dekont/havale bildirimi yok.</div>`;
      return;
    }
    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen dekont/havale bildirimi yok.</div>`;
      return;
    }
    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-emerald-500/40 flex flex-col gap-2 text-xs";
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <strong class="text-white text-sm">${d.username}</strong>
            <span class="text-emerald-400 font-mono font-black">+${d.amount} ₺</span>
          </div>
          <span class="text-[10px] text-slate-400">${d.date}</span>
        </div>
        <div class="text-[11px] text-slate-300">Gönderen: <strong>${d.senderName}</strong></div>
        ${d.receiptBase64 ? `
          <div class="p-2 bg-black/40 rounded-xl flex items-center justify-between border border-mineora-border">
            <span class="text-amber-300 font-bold text-[11px]"><i class="fa-solid fa-receipt mr-1"></i> Dekont Yüklendi</span>
            <a href="${d.receiptBase64}" target="_blank" class="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-bold">Dekontu İncele</a>
          </div>
        ` : ''}
        <div class="flex gap-1.5 justify-end pt-1">
          <button type="button" onclick="rejectDepositOrder('${d.id}')" class="px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-xs cursor-pointer font-bold">Reddet</button>
          <button type="button" onclick="approveDepositOrder('${d.id}', '${d.username}', ${d.amount})" class="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer shadow">Onayla & Yükle</button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}
window.renderAdminDepositQueue = renderAdminDepositQueue;

function approveDepositOrder(depId, username, amount) {
  if (!fbDb) return;
  const uKey = username.toLowerCase();
  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.tl = Number(((uData.tl || 0) + amount).toFixed(2));
      addUserNotificationLog(uData, "Banka Havalesi Onaylandı", "Havale bildiriminiz onaylandı ve bakiyenize yüklendi.", `+${amount.toFixed(2)} ₺`, "income");
      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`depositQueue/${depId}`).remove();
      renderAdminUserTable();
      updateAdminFinancialVaultMetrics();
      showToast(`✅ ${username} hesabına ${amount} ₺ yüklendi!`, "success");
    }
  });
}
window.approveDepositOrder = approveDepositOrder;

function rejectDepositOrder(depId) {
  if (!fbDb) return;
  fbDb.ref(`depositQueue/${depId}`).remove();
  showToast("Yatırım bildirimi reddedildi.", "info");
}
window.rejectDepositOrder = rejectDepositOrder;

function queueWithdrawalForAdminApproval(username, amount, bankDetails) {
  if (!fbDb) return;
  const withId = `with_${Date.now()}`;
  fbDb.ref(`withdrawalQueue/${withId}`).set({
    id: withId, username: username, amount: amount, bankDetails: bankDetails,
    date: new Date().toLocaleString('tr-TR'), status: 'pending'
  });
}
window.queueWithdrawalForAdminApproval = queueWithdrawalForAdminApproval;

function renderAdminWithdrawalQueue() {
  const container = document.getElementById('admin-withdrawal-queue-list');
  if (!container || !fbDb) return;

  fbDb.ref('withdrawalQueue').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen banka çekim talebi yok.</div>`;
      return;
    }
    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen banka çekim talebi yok.</div>`;
      return;
    }
    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-amber-500/40 flex flex-col gap-2 text-xs";
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <strong class="text-white text-sm">${d.username}</strong>
          <span class="text-amber-400 font-mono font-bold text-sm">-${d.amount} ₺</span>
        </div>
        <div class="bg-mineora-bg p-2 rounded-lg text-cyan-300 font-mono text-[11px] select-all">${d.bankDetails}</div>
        <div class="flex gap-2 justify-end">
          <button type="button" onclick="rejectWithdrawalOrder('${d.id}', '${d.username}', ${d.amount})" class="px-3 py-1 rounded bg-rose-600/20 text-rose-400 text-xs cursor-pointer">İptal & İade</button>
          <button type="button" onclick="approveWithdrawalOrder('${d.id}', '${d.username}', ${d.amount})" class="px-4 py-1 rounded bg-emerald-600 text-white font-bold text-xs cursor-pointer">Gönderildi (Kapat)</button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}
window.renderAdminWithdrawalQueue = renderAdminWithdrawalQueue;

function approveWithdrawalOrder(withId, username, amount) {
  if (!fbDb) return;
  fbDb.ref(`withdrawalQueue/${withId}`).remove().then(() => {
    showToast(`✅ ${username} adlı madencinin ${amount} ₺ çekimi tamamlandı.`, "success");
  });
}
window.approveWithdrawalOrder = approveWithdrawalOrder;

function rejectWithdrawalOrder(withId, username, amount) {
  if (!fbDb) return;
  const ok = confirm(`${username} kullanıcısının talebini iptal edip ${amount} ₺ tutarı hesabına geri iade etmek istiyor musunuz?`);
  if (!ok) return;

  const uKey = username.toLowerCase();
  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.tl = Number(((uData.tl || 0) + amount).toFixed(2));
      addUserNotificationLog(uData, "Çekim İptal Edildi", "Talebiniz iptal edildi ve tutar bakiyenize iade edildi.", `+${amount.toFixed(2)} ₺`, "income");
      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`withdrawalQueue/${withId}`).remove();
      showToast(`↩️ ${amount} ₺ hesaba iade edildi.`, "info");
    }
  });
}
window.rejectWithdrawalOrder = rejectWithdrawalOrder;

function renderAdminContactMessages() {
  const container = document.getElementById('admin-contact-messages-list');
  if (!container || !fbDb) return;

  fbDb.ref('contactMessages').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Gelen destek mesajı yok.</div>`;
      return;
    }
    const msgs = Object.values(data);
    msgs.forEach(m => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-mineora-border flex flex-col gap-1 text-xs";
      card.innerHTML = `
        <div class="flex justify-between items-center"><strong class="text-white">${m.name}</strong><span class="text-[10px] text-slate-400">${m.reach}</span></div>
        <p class="text-slate-300 mt-1">${m.message}</p>
      `;
      container.appendChild(card);
    });
  });
}
window.renderAdminContactMessages = renderAdminContactMessages;

function renderAdminGlobalHierarchy() {
  const container = document.getElementById('admin-global-hierarchy-tree');
  if (!container) return;
  let html = '<div class="space-y-2 max-h-60 overflow-y-auto pr-1">';
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u && u.username) {
          html += `
            <div class="p-3 rounded-xl bg-mineora-card border border-mineora-border flex justify-between items-center text-xs">
              <div><strong class="text-white">${u.username}</strong><span class="text-[10px] text-slate-400 block">Sponsor: ${u.referredBy || 'Doğrudan'}</span></div>
              <span class="text-emerald-400 font-mono font-bold">${Number(u.tl || 0).toFixed(2)} ₺</span>
            </div>
          `;
        }
      } catch(e) {}
    }
  }
  html += '</div>';
  container.innerHTML = html;
}
window.renderAdminGlobalHierarchy = renderAdminGlobalHierarchy;

async function executeDirectAdminAuthLogin() {
  const pass = document.getElementById('admin-auth-direct-pass')?.value.trim();
  if (!pass) { showToast("Şifre giriniz!", "warning"); return; }
  try {
    await firebase.auth().signInWithEmailAndPassword("ersinulasduzyol@gmail.com", pass);
    showToast("Yetki başarıyla açıldı!", "success");
    document.getElementById('auth-status-title').innerText = "Firebase Admin Yetkisi: AKTİF (Açık ✓)";
    document.getElementById('auth-status-title').className = "text-emerald-400 font-bold block";
    document.getElementById('auth-login-controls').classList.add('hidden');
  } catch(e) {
    showToast("Giriş başarısız!", "warning");
  }
}
window.executeDirectAdminAuthLogin = executeDirectAdminAuthLogin;
