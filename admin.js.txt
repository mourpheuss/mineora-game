// ================= 8. YÖNETİCİ VE PROTOKOL MASASI (admin.js) =================
const DEFAULT_ADMIN_PROTOCOL = {
  feeUsdtPercent: 1.0,
  feeOraPercent: 1.0,
  taxT1: 20.0,
  taxT2: 10.0,
  taxT3: 2.0,
  totalBurnedOra: 0.00,
  masterVaultUsdt: 0.00,
  genesisOraReserve: 1000000000.00
};

function getAdminProtocolState() {
  const local = localStorage.getItem('mineora_admin_root_state');
  if (local) {
    try { return JSON.parse(local); } catch(e) {}
  }
  return DEFAULT_ADMIN_PROTOCOL;
}

function saveAdminProtocolState(state) {
  localStorage.setItem('mineora_admin_root_state', JSON.stringify(state));
  if (typeof fbDb !== 'undefined' && fbDb) {
    try { fbDb.ref('adminState').set(state); } catch(e) {}
  }
}

let AdminState = getAdminProtocolState();

if (typeof fbDb !== 'undefined' && fbDb) {
  fbDb.ref('adminState').on('value', snap => {
    const val = snap.val();
    if (val) {
      AdminState = val;
      localStorage.setItem('mineora_admin_root_state', JSON.stringify(val));
      renderAdminHUD();
    }
  });
}

function initAdminMasterPanel() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  renderAdminHUD();
  renderAdminCommissionInputs();
  renderAdminUserTable();
  renderAdminGlobalHierarchy();
  renderAdminDepositQueue();
  renderAdminWithdrawalQueue();
  renderAdminLiveRoomsMonitor();
}

function renderAdminHUD() {
  const oraResEl = document.getElementById('admin-master-ora-reserve');
  const usdtVaultEl = document.getElementById('admin-master-usdt-vault');
  const burnedEl = document.getElementById('admin-total-burned-display');

  if (oraResEl) oraResEl.innerText = Number(AdminState.genesisOraReserve || 1000000000).toLocaleString('en-US') + " ORA";
  if (usdtVaultEl) usdtVaultEl.innerText = "$" + Number(AdminState.masterVaultUsdt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USDT";
  if (burnedEl) burnedEl.innerText = Number(AdminState.totalBurnedOra || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) + " ORA";
}

function renderAdminCommissionInputs() {
  const p2pUsdt = document.getElementById('admin-set-p2p-usdt');
  const p2pOra = document.getElementById('admin-set-p2p-ora');
  const tax1 = document.getElementById('admin-set-tax-t1');
  const tax2 = document.getElementById('admin-set-tax-t2');
  const tax3 = document.getElementById('admin-set-tax-t3');

  if (p2pUsdt) p2pUsdt.value = AdminState.feeUsdtPercent || 1.0;
  if (p2pOra) p2pOra.value = AdminState.feeOraPercent || 1.0;
  if (tax1) tax1.value = AdminState.taxT1 || 20.0;
  if (tax2) tax2.value = AdminState.taxT2 || 10.0;
  if (tax3) tax3.value = AdminState.taxT3 || 2.0;
}

function updateAdminCommissionSettings() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  AdminState.feeUsdtPercent = parseFloat(document.getElementById('admin-set-p2p-usdt')?.value) || 1.0;
  AdminState.feeOraPercent = parseFloat(document.getElementById('admin-set-p2p-ora')?.value) || 1.0;
  AdminState.taxT1 = parseFloat(document.getElementById('admin-set-tax-t1')?.value) || 20.0;
  AdminState.taxT2 = parseFloat(document.getElementById('admin-set-tax-t2')?.value) || 10.0;
  AdminState.taxT3 = parseFloat(document.getElementById('admin-set-tax-t3')?.value) || 2.0;

  saveAdminProtocolState(AdminState);
  showToast("⚙️ Komisyon ve çıkış vergisi oranları güncellendi!", "success");
}

function executeAdminDirectOraTransfer() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const targetU = document.getElementById('admin-grant-target-user')?.value.trim();
  const amount = parseFloat(document.getElementById('admin-grant-ora-amount')?.value);

  if (!targetU || !amount || amount <= 0) {
    showToast("⚠️ Geçerli bir kullanıcı adı ve miktar girin!", "warning");
    return;
  }

  const targetObj = getStoredUser(targetU);
  if (!targetObj) {
    showToast("⛔ Kullanıcı bulunamadı!", "warning");
    return;
  }

  if (AdminState.genesisOraReserve < amount) {
    showToast("⛔ Kalan Master Genesis rezervi yetersiz!", "warning");
    return;
  }

  AdminState.genesisOraReserve = Number((AdminState.genesisOraReserve - amount).toFixed(2));
  targetObj.ora = Number(((targetObj.ora || 0) + amount).toFixed(2));

  addUserNotificationLog(targetObj, "Master ORA Hibesi", `Root Admin tarafından ${amount.toLocaleString()} ORA doğrudan cüzdanınıza aktarıldı.`, `+${amount.toLocaleString()} ORA`, "grant");

  saveAdminProtocolState(AdminState);
  saveStoredUser(targetObj);

  if (CurrentUser.username.toLowerCase() === targetObj.username.toLowerCase()) {
    CurrentUser.ora = targetObj.ora;
    updateHUD();
  }

  renderAdminHUD();
  renderAdminUserTable();
  document.getElementById('admin-grant-ora-amount').value = "";
  showToast(`🎉 ${targetU} kullanıcısına ${amount.toLocaleString()} ORA başarıyla aktarıldı!`, "success");
}

function executeAdminVaultWithdraw() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const targetAddr = document.getElementById('admin-vault-withdraw-addr')?.value.trim();
  const amount = parseFloat(document.getElementById('admin-vault-withdraw-amt')?.value);

  if (!targetAddr || !amount || amount <= 0) {
    showToast("⚠️ Hedef BEP-20 adresi ve çekim miktarı girin!", "warning");
    return;
  }
  if (amount > (AdminState.masterVaultUsdt || 0)) {
    showToast("⛔ Kasada yeterli USDT yok!", "warning");
    return;
  }

  AdminState.masterVaultUsdt = Number(((AdminState.masterVaultUsdt || 0) - amount).toFixed(2));
  saveAdminProtocolState(AdminState);
  renderAdminHUD();
  document.getElementById('admin-vault-withdraw-amt').value = "";
  showToast(`💸 ${amount} USDT soğuk cüzdana çekim emri verildi: ${targetAddr}`, "success");
}

function executeAdminBurnOra() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const amt = parseFloat(document.getElementById('admin-burn-ora-amount')?.value);
  if (!amt || amt <= 0) { showToast("⚠️ Miktar girin!", "warning"); return; }

  AdminState.totalBurnedOra = Number(((AdminState.totalBurnedOra || 0) + amt).toFixed(2));
  saveAdminProtocolState(AdminState);
  renderAdminHUD();
  document.getElementById('admin-burn-ora-amount').value = "";
  showToast(`🔥 ${amt.toLocaleString()} ORA dEaD fırınında yakıldı!`, "success");
}

// ================= CANLI YAYIN ODALARI RÖNTGENİ & MÜDAHALE MASASI =================

function renderAdminLiveRoomsMonitor() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;

  const secBoss = document.getElementById('sec-boss');
  if (!secBoss) return;

  let monitorContainer = document.getElementById('admin-live-rooms-monitor-card');
  if (!monitorContainer) {
    monitorContainer = document.createElement('div');
    monitorContainer.id = 'admin-live-rooms-monitor-card';
    monitorContainer.className = 'p-5 rounded-2xl bg-mineora-bg border border-rose-500/40 space-y-4';

    const globalTreeCard = document.getElementById('admin-global-hierarchy-tree')?.parentElement;
    if (globalTreeCard) {
      secBoss.querySelector('.p-6')?.insertBefore(monitorContainer, globalTreeCard);
    } else {
      secBoss.querySelector('.p-6')?.appendChild(monitorContainer);
    }
  }

  const renderRoomsList = (rooms) => {
    let rowsHtml = '';
    const roomKeys = rooms ? Object.keys(rooms) : [];

    if (roomKeys.length === 0) {
      rowsHtml = `<tr><td colspan="6" class="py-6 text-center text-slate-500">Şu anda aktif canlı yayın odası bulunmuyor.</td></tr>`;
    } else {
      roomKeys.forEach(k => {
        const r = rooms[k];
        if (!r) return;
        const reportCount = r.reports ? Object.keys(r.reports).length : 0;
        const viewerCount = r.viewers ? Object.keys(r.viewers).length : 0;
        const isQuarantined = !!r.isQuarantined;

        rowsHtml += `
          <tr class="hover:bg-mineora-card/60 transition">
            <td class="py-3 px-4">
              <strong class="text-white block">${r.title}</strong>
              <span class="text-[10px] text-slate-500 font-mono">${k}</span>
            </td>
            <td class="py-3 px-4 font-bold text-mineora-gold">${r.host}</td>
            <td class="py-3 px-4 font-mono text-slate-300">
              <i class="fa-solid fa-eye text-cyan-400 mr-1"></i>${viewerCount} İzleyici
            </td>
            <td class="py-3 px-4 font-mono">
              ${r.ticketPrice ? `<span class="text-mineora-green font-bold">$${Number(r.ticketPrice).toFixed(2)}</span>` : '<span class="text-slate-500">Ücretsiz</span>'}
            </td>
            <td class="py-3 px-4">
              ${reportCount > 0 ? `
                <span class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center gap-1 w-max animate-pulse">
                  <i class="fa-solid fa-flag"></i> ${reportCount} Şikayet ${isQuarantined ? '(Karantinada)' : ''}
                </span>
              ` : `
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Temiz</span>
              `}
            </td>
            <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap notranslate">
              <button type="button" onclick="adminJoinLiveRoomDirect('${k}', false)" class="px-2.5 py-1 rounded-lg bg-mineora-input hover:bg-slate-700 text-white font-bold text-[11px] cursor-pointer" title="Şifre ve Bilet Olmadan Doğrudan Gir">
                <i class="fa-solid fa-right-to-bracket text-mineora-gold"></i> Gir
              </button>
              <button type="button" onclick="adminJoinLiveRoomDirect('${k}', true)" class="px-2.5 py-1 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 font-bold text-[11px] cursor-pointer" title="Görünmez Olarak İzle">
                <i class="fa-solid fa-ghost"></i> Hayalet
              </button>
              <button type="button" onclick="adminNukeLiveRoom('${k}', false)" class="px-2.5 py-1 rounded-lg bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-black text-[11px] cursor-pointer" title="Yayını Zorla Kapat">
                <i class="fa-solid fa-bolt"></i> Kapat
              </button>
              <button type="button" onclick="adminNukeLiveRoom('${k}', true)" class="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-black text-[11px] cursor-pointer" title="Yayını Kapat ve Yayıncının Cüzdanını Kilitle">
                <i class="fa-solid fa-ban"></i> Nuke & Ban
              </button>
            </td>
          </tr>
        `;
      });
    }

    monitorContainer.innerHTML = `
      <div class="flex justify-between items-center border-b border-mineora-border pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold">
            <i class="fa-solid fa-tower-broadcast"></i>
          </div>
          <div>
            <h3 class="text-sm font-black text-white">Canlı Odalar Röntgen & Kırmızı Düğme Masası</h3>
            <span class="text-[10px] text-slate-400">Tüm şifreli ve biletli odaları ücretsiz izleyin, denetleyin ve tek tıkla sonlandırın.</span>
          </div>
        </div>
        <button type="button" onclick="renderAdminLiveRoomsMonitor()" class="px-3 py-1 rounded-xl bg-mineora-card border border-mineora-border text-xs text-slate-300 hover:text-white cursor-pointer">
          <i class="fa-solid fa-rotate-right mr-1"></i> Yenile
        </button>
      </div>
      <div class="overflow-x-auto rounded-xl border border-mineora-border">
        <table class="w-full text-left text-xs">
          <thead class="bg-black/40 text-slate-400 uppercase text-[10px]">
            <tr>
              <th class="py-3 px-4">Oda / Başlık</th>
              <th class="py-3 px-4">Yayıncı</th>
              <th class="py-3 px-4">İzleyici</th>
              <th class="py-3 px-4">Bilet Ücreti</th>
              <th class="py-3 px-4">Güvenlik Durumu</th>
              <th class="py-3 px-4 text-right">Admin Müdahalesi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-mineora-border text-slate-200">${rowsHtml}</tbody>
        </table>
      </div>
    `;
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('liveRooms').once('value', snap => renderRoomsList(snap.val()));
  } else {
    try {
      const localRooms = JSON.parse(localStorage.getItem('mineora_mock_live_rooms') || '{}');
      renderRoomsList(localRooms);
    } catch(e) {}
  }
}

// ================= KULLANICI RÖNTGENİ & YÖNETİMİ =================

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
      <td class="py-3 px-4 font-bold text-slate-300">${u.role || 'Candidate'}</td>
      <td class="py-3 px-4 font-mono text-mineora-green font-bold">$${Number(u.usdt || 0).toFixed(2)}</td>
      <td class="py-3 px-4 font-mono text-mineora-gold font-bold">${Number(u.ora || 0).toFixed(2)} ORA</td>
      <td class="py-3 px-4">
        ${u.isVaultLocked ? '<span class="text-rose-400 font-bold">KİLİTLİ</span>' : '<span class="text-emerald-400">Açık</span>'}
      </td>
      <td class="py-3 px-4 text-right space-x-2 notranslate whitespace-nowrap">
        <button type="button" onclick="toggleAdminVaultLock('${u.username}')" class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px] font-bold cursor-pointer">
          ${u.isVaultLocked ? 'Kilidi Aç' : 'Kilitle'}
        </button>
        <button type="button" onclick="openAdminModifyUserModal('${u.username}')" class="px-2.5 py-1 rounded bg-cyan-600/30 text-cyan-300 hover:bg-cyan-600/50 text-[11px] font-bold cursor-pointer">
          Düzenle
        </button>
        ${!u.isRootAdmin ? `
          <button type="button" onclick="deleteAdminUser('${u.username}')" class="px-2.5 py-1 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-[11px] font-bold cursor-pointer transition">
            Sil
          </button>
        ` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function deleteAdminUser(username) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  if (username.toLowerCase() === CurrentUser.username.toLowerCase()) {
    showToast("⛔ Kendi hesabınızı silemezsiniz!", "warning");
    return;
  }
  const confirmDel = confirm(`'${username}' adlı kullanıcıyı ve tüm oyun verilerini sistemden kalıcı olarak silmek istediğinize emin misiniz?`);
  if (!confirmDel) return;

  const uKey = username.toLowerCase();
  localStorage.removeItem(`mineora_user_${uKey}`);
  if (typeof addDeletedUser === 'function') addDeletedUser(username);

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`users/${uKey}`).remove();
  }

  renderAdminUserTable();
  showToast(`🗑️ '${username}' kullanıcısı sistemden kalıcı olarak silindi.`, "info");
}

function toggleAdminVaultLock(username) {
  const u = getStoredUser(username);
  if (!u) return;
  u.isVaultLocked = !u.isVaultLocked;
  saveStoredUser(u);
  renderAdminUserTable();
  showToast(`🔒 ${username} kullanıcısının kasa durumu: ${u.isVaultLocked ? 'KİLİTLENDİ' : 'AÇILDI'}`, "info");
}

let activeModTargetUser = null;
function openAdminModifyUserModal(username) {
  const u = getStoredUser(username);
  if (!u) return;
  activeModTargetUser = u;

  document.getElementById('admin-target-user-name').innerText = u.username;
  document.getElementById('admin-mod-usdt').value = u.usdt || 0;
  document.getElementById('admin-mod-ora').value = u.ora || 0;
  document.getElementById('admin-mod-role').value = u.role || 'Worker Miner';

  openModal('modal-admin-modify-user');
}

function saveAdminUserModifications() {
  if (!activeModTargetUser) return;
  const newUsdt = parseFloat(document.getElementById('admin-mod-usdt').value) || 0;
  const newOra = parseFloat(document.getElementById('admin-mod-ora').value) || 0;
  const newRole = document.getElementById('admin-mod-role').value;

  activeModTargetUser.usdt = Number(newUsdt.toFixed(2));
  activeModTargetUser.ora = Number(newOra.toFixed(2));
  activeModTargetUser.role = newRole;

  saveStoredUser(activeModTargetUser);
  closeModal('modal-admin-modify-user');
  renderAdminUserTable();
  showToast(`💾 ${activeModTargetUser.username} verileri güncellendi!`, "success");
}

function handleAdminCreateUserSubmit() {
  const u = document.getElementById('admin-new-username')?.value.trim();
  const p = document.getElementById('admin-new-pass')?.value.trim();
  const em = document.getElementById('admin-new-email')?.value.trim();
  const r = document.getElementById('admin-new-role')?.value;

  if (!u || !p) { showToast("⚠️ Kullanıcı adı ve şifre zorunludur!", "warning"); return; }

  const uKey = u.toLowerCase();
  if (localStorage.getItem(`mineora_user_${uKey}`)) {
    showToast("⚠️ Kullanıcı adı zaten kayıtlı!", "warning");
    return;
  }

  const newUser = {
    username: u,
    fullname: u,
    pass: p,
    email: em || `${u}@mineora.io`,
    role: r || "Worker Miner",
    usdt: 0.00,
    ora: 0.00,
    alpCrystals: 0,
    isRootAdmin: false,
    isVaultLocked: false,
    createdAt: Date.now(),
    refCode: `MINE-${u.toUpperCase()}-777`,
    companyRefCode: `HOLD-${u.toUpperCase()}-999`,
    mines: (typeof getDefaultMines === 'function') ? getDefaultMines() : [],
    stakes: [],
    workers: [],
    logs: []
  };

  saveStoredUser(newUser);
  closeModal('modal-admin-create-user');
  renderAdminUserTable();
  showToast(`🎉 ${u} kullanıcısı oluşturuldu!`, "success");
}

// ================= YATIRMA VE ÇEKİM KUYRUKLARI =================

function renderAdminDepositQueue() {
  const container = document.getElementById('admin-deposit-queue-list');
  if (!container) return;
  container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen BEP-20 yatırma bildirimi yok.</div>`;
}

function renderAdminWithdrawalQueue() {
  const container = document.getElementById('admin-withdrawal-queue-list');
  if (!container) return;
  container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">Bekleyen USDT çekim talebi yok.</div>`;
}

function renderAdminGlobalHierarchy() {
  const treeEl = document.getElementById('admin-global-hierarchy-tree');
  if (!treeEl) return;
  treeEl.innerHTML = `<div class="p-4 bg-mineora-card rounded-xl text-xs text-slate-400">Hiyerarşi haritası senkronize.</div>`;
}