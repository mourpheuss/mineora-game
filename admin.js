// ================= 8. YÖNETİCİ VE PROTOKOL MASASI (admin.js) =================
function initAdminMasterPanel() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  renderAdminHUD();
  renderAdminUserTable();
  renderAdminDepositQueue();
  renderAdminWithdrawalQueue();
}

function renderAdminHUD() {
  // Canlı Kasa Taraması
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

// ================= KULLANICI RÖNTGENİ =================
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
    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-white">${u.username} ${u.isRootAdmin ? '<span class="text-rose-400 text-[10px] ml-1">[ADMIN]</span>' : ''}</td>
      <td class="py-3 px-4 font-mono text-slate-400">${u.pass || '••••••'}</td>
      <td class="py-3 px-4 font-bold text-slate-300">${u.role || 'Aday'}</td>
      <td class="py-3 px-4 font-mono text-emerald-400 font-bold">${Number(u.tl || 0).toFixed(2)} ₺</td>
      <td class="py-3 px-4">
        ${u.isVaultLocked ? '<span class="text-rose-400 font-bold">KİLİTLİ</span>' : '<span class="text-emerald-400">Açık</span>'}
      </td>
      <td class="py-3 px-4 text-right space-x-2 notranslate whitespace-nowrap">
        ${!u.isRootAdmin ? `
          <button type="button" onclick="toggleAdminVaultLock('${u.username}')" class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px] font-bold cursor-pointer">
            ${u.isVaultLocked ? 'Kilidi Aç' : 'Kilitle'}
          </button>
        ` : ''}
        <button type="button" onclick="openAdminModifyUserModal('${u.username}')" class="px-2.5 py-1 rounded bg-cyan-600/30 text-cyan-300 hover:bg-cyan-600/50 text-[11px] font-bold cursor-pointer">
          Düzenle
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleAdminVaultLock(username) {
  const u = getStoredUser(username);
  if (!u || u.isRootAdmin) return;
  u.isVaultLocked = !u.isVaultLocked;
  saveStoredUser(u);
  renderAdminUserTable();
  showToast(`🔒 ${username} kasa durumu güncellendi.`, "info");
}

let activeModTargetUser = null;
function openAdminModifyUserModal(username) {
  const u = getStoredUser(username);
  if (!u) return;
  activeModTargetUser = u;

  document.getElementById('admin-target-user-name').innerText = u.username;
  document.getElementById('admin-mod-tl').value = u.tl || 0;
  document.getElementById('admin-mod-role').value = u.role || 'Worker Miner';

  openModal('modal-admin-modify-user');
}

function saveAdminUserModifications() {
  if (!activeModTargetUser) return;
  const newTl = parseFloat(document.getElementById('admin-mod-tl').value) || 0;
  const newRole = document.getElementById('admin-mod-role').value;

  const oldTl = Number(activeModTargetUser.tl || 0);
  const diffTl = Number((newTl - oldTl).toFixed(2));

  if (Math.abs(diffTl) >= 0.01) {
    const sign = diffTl > 0 ? "+" : "";
    addUserNotificationLog(
      activeModTargetUser,
      "Yönetici Bakiye Güncellemesi",
      "Yönetim tarafından bakiye düzenlendi.",
      `${sign}${diffTl.toFixed(2)} ₺`,
      diffTl > 0 ? "income" : "expense"
    );
  }

  activeModTargetUser.tl = Number(newTl.toFixed(2));
  activeModTargetUser.role = newRole;

  saveStoredUser(activeModTargetUser);
  closeModal('modal-admin-modify-user');
  renderAdminUserTable();
  showToast(`💾 ${activeModTargetUser.username} başarıyla güncellendi!`, "success");
}

// ================= BANKA YATIRMA VE ÇEKİM KUYRUKLARI =================
function queueDepositForAdminApproval(username, amount, senderName) {
  if (!fbDb) return;
  const depId = `dep_${Date.now()}`;
  fbDb.ref(`depositQueue/${depId}`).set({
    id: depId,
    username: username,
    amount: amount,
    senderName: senderName,
    date: new Date().toLocaleString('tr-TR'),
    status: 'pending'
  });
}

function renderAdminDepositQueue() {
  const container = document.getElementById('admin-deposit-queue-list');
  if (!container || !fbDb) return;

  fbDb.ref('depositQueue').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen havale/EFT bildirimi yok.</div>`;
      return;
    }
    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen havale/EFT bildirimi yok.</div>`;
      return;
    }
    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-emerald-500/40 flex items-center justify-between text-xs";
      card.innerHTML = `
        <div>
          <div class="flex items-center gap-2">
            <strong class="text-white">${d.username}</strong>
            <span class="text-emerald-400 font-mono font-bold">+${d.amount} ₺</span>
          </div>
          <span class="text-[10px] text-slate-400 block">Gönderen: ${d.senderName} • ${d.date}</span>
        </div>
        <div class="flex gap-1.5">
          <button type="button" onclick="approveDepositOrder('${d.id}', '${d.username}', ${d.amount})" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs cursor-pointer">Onayla</button>
          <button type="button" onclick="rejectDepositOrder('${d.id}')" class="px-2 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 text-xs cursor-pointer">Reddet</button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}

function approveDepositOrder(depId, username, amount) {
  if (!fbDb) return;
  const uKey = username.toLowerCase();
  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.tl = Number(((uData.tl || 0) + amount).toFixed(2));
      addUserNotificationLog(uData, "Banka Havalesi Yüklendi", "Yatırım bildiriminiz onaylandı.", `+${amount.toFixed(2)} ₺`, "income");
      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`depositQueue/${depId}`).remove();
      renderAdminUserTable();
      showToast(`✅ ${username} hesabına ${amount} ₺ yüklendi!`, "success");
    }
  });
}

function rejectDepositOrder(depId) {
  if (!fbDb) return;
  fbDb.ref(`depositQueue/${depId}`).remove();
  showToast("Bildirim reddedildi.", "info");
}

function queueWithdrawalForAdminApproval(username, amount, bankDetails) {
  if (!fbDb) return;
  const withId = `with_${Date.now()}`;
  fbDb.ref(`withdrawalQueue/${withId}`).set({
    id: withId,
    username: username,
    amount: amount,
    bankDetails: bankDetails,
    date: new Date().toLocaleString('tr-TR'),
    status: 'pending'
  });
}

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
        <div class="bg-mineora-bg p-2 rounded-lg text-cyan-300 font-mono text-[11px] select-all">
          ${d.bankDetails}
        </div>
        <div class="flex gap-2 justify-end">
          <button type="button" onclick="rejectWithdrawalOrder('${d.id}', '${d.username}', ${d.amount})" class="px-3 py-1 rounded bg-rose-600/20 text-rose-400 text-xs cursor-pointer">İptal & İade</button>
          <button type="button" onclick="approveWithdrawalOrder('${d.id}', '${d.username}', ${d.amount})" class="px-4 py-1 rounded bg-emerald-600 text-white font-bold text-xs cursor-pointer">Gönderildi (Kapat)</button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}

function approveWithdrawalOrder(withId, username, amount) {
  if (!fbDb) return;
  fbDb.ref(`withdrawalQueue/${withId}`).remove().then(() => {
    showToast(`✅ ${username} adlı madencinin ${amount} ₺ çekim işlemi tamamlandı.`, "success");
  });
}

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
