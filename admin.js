// ================= DEV YÖNETİCİ KOMUTA MASASI (admin.js) =================

async function executeDirectAdminAuthLogin() {
  const passInput = document.getElementById('admin-auth-direct-pass');
  const pass = passInput ? passInput.value.trim() : (CurrentUser ? CurrentUser.pass : null);

  if (!pass) {
    if (typeof showToast === 'function') showToast("Lütfen Firebase şifrenizi girin!", "warning");
    return;
  }

  if (typeof showToast === 'function') showToast("Admin yetkisi doğrulanıyor...", "info");

  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      await firebase.auth().signInWithEmailAndPassword("ersinulasduzyol@gmail.com", pass);
      
      const title = document.getElementById('auth-status-title');
      const dot = document.getElementById('auth-status-dot');
      const controls = document.getElementById('auth-login-controls');

      if (title) {
        title.innerText = "Firebase Admin Yetkisi: AKTİF (Açık ✓)";
        title.className = "text-emerald-400 font-bold block";
      }
      if (dot) dot.className = "w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981]";
      if (controls) controls.classList.add('hidden');

      if (typeof showToast === 'function') showToast("Yetki başarıyla açıldı!", "success");
      
      renderAdminDepositQueue();
      renderAdminWithdrawalQueue();
      renderAdminContactMessages();
    }
  } catch (e) {
    console.error("Giriş hatası:", e);
    if (typeof showToast === 'function') showToast("Şifre hatalı veya yetki verilmedi!", "warning");
  }
}
window.executeDirectAdminAuthLogin = executeDirectAdminAuthLogin;

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
      } catch (e) {}
    }
  }
  const elTotal = document.getElementById('admin-total-user-tl');
  if (elTotal) elTotal.innerText = totalUserTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + " TL";
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
      } catch (e) {}
    }
  }

  const elTotal = document.getElementById('admin-total-user-tl');
  const elLic = document.getElementById('admin-total-license-volume');
  if (elTotal) elTotal.innerText = totalVaultTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + " TL";
  if (elLic) elLic.innerText = totalLicVolume.toLocaleString('tr-TR') + " TL";
  if (typeof showToast === 'function') showToast("Kasa taraması tamamlandı.", "info");
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
      } catch (e) {}
    }
  }

  allUsers.forEach(u => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-mineora-bg/60 transition";
    const l = u.licenses || {};
    const licText = (l.worker || 0) + " Madenci / " + (l.mine || 0) + " Sahip / " + (l.holding || 0) + " Holding";

    tr.innerHTML = 
      '<td class="py-3 px-4 font-bold text-white">' + u.username + (u.isRootAdmin ? ' <span class="text-rose-400 text-[10px] ml-1">[ADMIN]</span>' : '') + '</td>' +
      '<td class="py-3 px-4 font-mono text-slate-400">' + (u.pass || '••••••') + '</td>' +
      '<td class="py-3 px-4 font-bold text-slate-300 text-[11px]">' + (u.role || 'Aday') + '</td>' +
      '<td class="py-3 px-4 font-mono text-slate-400 text-[11px]">' + licText + '</td>' +
      '<td class="py-3 px-4 font-mono text-emerald-400 font-bold">' + Number(u.tl || 0).toFixed(2) + ' TL</td>' +
      '<td class="py-3 px-4">' + (u.isVaultLocked ? '<span class="text-rose-400 font-bold">KİLİTLİ</span>' : '<span class="text-emerald-400">Açık</span>') + '</td>' +
      '<td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">' +
        '<button type="button" onclick="openAdminUserLogsModal(\'' + u.username + '\')" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer transition shadow">Log Dökümü</button>' +
        (!u.isRootAdmin ? '<button type="button" onclick="toggleAdminVaultLock(\'' + u.username + '\')" class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px] font-bold cursor-pointer">' + (u.isVaultLocked ? 'Kilidi Aç' : 'Kilitle') + '</button>' : '') +
        '<button type="button" onclick="openAdminModifyUserModal(\'' + u.username + '\')" class="px-2.5 py-1 rounded bg-cyan-600/30 text-cyan-300 hover:bg-cyan-600/50 text-[11px] font-bold cursor-pointer">Düzenle</button>' +
        (!u.isRootAdmin ? '<button type="button" onclick="deleteAdminUser(\'' + u.username + '\')" class="px-2.5 py-1 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-[11px] font-bold cursor-pointer transition">Sil</button>' : '') +
      '</td>';

    tbody.appendChild(tr);
  });
}
window.renderAdminUserTable = renderAdminUserTable;

// ================= LOG DÖKÜMÜ & KAÇAK/HİLE DENETİM MOTORU =================
function openAdminUserLogsModal(username) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const u = typeof getStoredUser === 'function' ? getStoredUser(username) : null;
  if (!u) {
    if (typeof showToast === 'function') showToast("Kullanıcı bulunamadı!", "warning");
    return;
  }

  const targetNameEl = document.getElementById('audit-target-username');
  const cardsContainer = document.getElementById('audit-summary-cards');
  const alertBar = document.getElementById('audit-alert-bar');
  const tbody = document.getElementById('audit-logs-table-body');
  const countEl = document.getElementById('audit-log-count');

  if (targetNameEl) targetNameEl.innerText = u.username;

  const logs = Array.isArray(u.logs) ? u.logs : [];
  if (countEl) countEl.innerText = logs.length;

  let totalMinedTl = 0;
  let totalCommissionTl = 0;
  let totalDepositTl = 0;
  let totalSpentTl = 0;
  let totalWithdrawTl = 0;

  logs.forEach(l => {
    const txt = (l.amountText || "").toString();
    const m = txt.match(/[\d\.]+/);
    const val = m ? parseFloat(m[0]) : 0;
    const desc = ((l.title || "") + " " + (l.desc || "")).toLowerCase();

    if (txt.startsWith('+')) {
      if (desc.includes('maden') || desc.includes('vardiya') || desc.includes('kazı')) totalMinedTl += val;
      else if (desc.includes('referans') || desc.includes('komisyon') || desc.includes('prim')) totalCommissionTl += val;
      else if (desc.includes('havale') || desc.includes('yatır') || desc.includes('yüklendi')) totalDepositTl += val;
      else totalMinedTl += val;
    } else if (txt.startsWith('-')) {
      if (desc.includes('çekim') || desc.includes('çek')) totalWithdrawTl += val;
      else totalSpentTl += val;
    }
  });

  const curTl = Number(parseFloat(u.tl || 0).toFixed(2));
  const netLoggedTl = Number((totalMinedTl + totalCommissionTl + totalDepositTl - totalSpentTl - totalWithdrawTl).toFixed(2));
  const discrepancy = Number((curTl - netLoggedTl).toFixed(2));
  const hasLeak = discrepancy > 5;

  if (cardsContainer) {
    cardsContainer.innerHTML = 
      '<div class="p-3 rounded-2xl bg-mineora-bg border border-mineora-border">' +
        '<span class="text-[10px] text-slate-400 block font-bold uppercase">MEVCUT CÜZDAN</span>' +
        '<strong class="text-emerald-400 text-sm block mt-0.5">' + curTl.toFixed(2) + ' TL</strong>' +
      '</div>' +
      '<div class="p-3 rounded-2xl bg-mineora-bg border border-emerald-500/30">' +
        '<span class="text-[10px] text-slate-400 block font-bold uppercase">MEŞRU ÜRETİM & PRİM</span>' +
        '<strong class="text-emerald-400 text-sm block mt-0.5">+' + (totalMinedTl + totalCommissionTl).toFixed(2) + ' TL</strong>' +
        '<span class="text-[9px] text-slate-500 block">(' + totalMinedTl.toFixed(1) + ' Kazı / ' + totalCommissionTl.toFixed(1) + ' Ref)</span>' +
      '</div>' +
      '<div class="p-3 rounded-2xl bg-mineora-bg border border-rose-500/30">' +
        '<span class="text-[10px] text-slate-400 block font-bold uppercase">HARCANAN / ÇEKİLEN</span>' +
        '<strong class="text-rose-400 text-sm block mt-0.5">-' + (totalSpentTl + totalWithdrawTl).toFixed(2) + ' TL</strong>' +
      '</div>' +
      '<div class="p-3 rounded-2xl bg-mineora-bg border ' + (hasLeak ? 'border-rose-500 bg-rose-950/20' : 'border-emerald-500/30') + '">' +
        '<span class="text-[10px] text-slate-400 block font-bold uppercase">KAÇAK / FARK</span>' +
        '<strong class="' + (hasLeak ? 'text-rose-500 animate-pulse' : 'text-emerald-400') + ' text-sm block mt-0.5">' + (discrepancy > 0 ? '+' : '') + discrepancy.toFixed(2) + ' TL</strong>' +
      '</div>';
  }

  if (alertBar) {
    if (hasLeak) {
      alertBar.className = "p-3 rounded-2xl bg-rose-950/40 border border-rose-500 text-rose-300 flex items-center justify-between gap-3 text-xs";
      alertBar.innerHTML = 
        '<div class="flex items-center gap-2">' +
          '<i class="fa-solid fa-triangle-exclamation text-base text-rose-400"></i>' +
          '<span><strong>Şüpheli Hesap:</strong> Cüzdanda log kaydı bulunmayan <strong>+' + discrepancy.toFixed(2) + ' TL</strong> kaçak bakiye tespit edildi!</span>' +
        '</div>' +
        '<button type="button" onclick="correctTamperedUserBalance(\'' + u.username + '\', ' + Math.max(0, netLoggedTl) + ')" class="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer shadow whitespace-nowrap">' +
          'Kaçak Bakiyeyi Düzelt & Eşitle' +
        '</button>';
      alertBar.classList.remove('hidden');
    } else {
      alertBar.className = "p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2 text-xs";
      alertBar.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i> <span>Tüm işlemler log kayıtlarıyla birebir tutarlı. Hesap güvenli.</span>';
      alertBar.classList.remove('hidden');
    }
  }

  if (tbody) {
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-500">Bu kullanıcıya ait log kaydı bulunmuyor.</td></tr>';
    } else {
      tbody.innerHTML = logs.map(l => {
        const isPos = (l.amountText || "").startsWith('+');
        return '<tr class="hover:bg-mineora-bg/60 transition">' +
          '<td class="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">' + (l.date || '-') + ' ' + (l.time || '') + '</td>' +
          '<td class="py-2.5 px-3 font-bold text-white whitespace-nowrap">' +
            '<span class="px-2 py-0.5 rounded text-[9px] uppercase ' + (isPos ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30') + '">' +
              (l.type || 'işlem') +
            '</span>' +
          '</td>' +
          '<td class="py-2.5 px-3 text-slate-300"><strong>' + (l.title || '-') + '</strong><span class="text-slate-400 block text-[10px]">' + (l.desc || '') + '</span></td>' +
          '<td class="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap ' + (isPos ? 'text-emerald-400' : 'text-rose-400') + '">' + (l.amountText || '-') + '</td>' +
        '</tr>';
      }).join('');
    }
  }

  if (typeof openModal === 'function') openModal('modal-admin-user-logs');
}
window.openAdminUserLogsModal = openAdminUserLogsModal;

// KAÇAK BAKİYEYİ MEŞRU LOG DÜZEYİNE İNDİREN FONKSİYON
function correctTamperedUserBalance(username, targetTl) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const ok = confirm("'" + username + "' adlı kullanıcının cüzdanındaki haksız/kaçak bakiyeyi silip, yalnızca meşru kayıtlı kazancı olan " + targetTl + " TL seviyesine çekmek istiyor musunuz?");
  if (!ok) return;

  const u = typeof getStoredUser === 'function' ? getStoredUser(username) : null;
  if (!u) return;

  const oldTl = u.tl || 0;
  u.tl = Math.max(0, targetTl);
  u.isVaultLocked = true;

  if (typeof addUserNotificationLog === 'function') {
    addUserNotificationLog(u, "Bakiye Düzeltmesi (Admin)", "Kayıtsız bakiye tespit edildiği için cüzdan meşru üretim seviyesine eşitlendi.", "-" + (oldTl - targetTl).toFixed(2) + " TL", "alert");
  }

  if (typeof saveStoredUser === 'function') saveStoredUser(u);
  openAdminUserLogsModal(username);
  renderAdminUserTable();
  updateAdminFinancialVaultMetrics();
  if (typeof showToast === 'function') showToast("✅ " + username + " hesabındaki haksız bakiye temizlendi!", "success");
}
window.correctTamperedUserBalance = correctTamperedUserBalance;

function deleteAdminUser(username) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  if (username.toLowerCase() === CurrentUser.username.toLowerCase()) {
    if (typeof showToast === 'function') showToast("Kendi hesabınızı silemezsiniz!", "warning");
    return;
  }
  const confirmDel = confirm("'" + username + "' adlı kullanıcıyı ve tüm verilerini kalıcı olarak silmek istediğinize emin misiniz?");
  if (!confirmDel) return;

  const uKey = username.toLowerCase();
  localStorage.removeItem('mineora_user_' + uKey);

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u && Array.isArray(u.workers)) {
          u.workers = u.workers.filter(w => (w.username || '').toLowerCase() !== uKey);
          saveStoredUser(u);
        }
      } catch (e) {}
    }
  }

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('users/' + uKey).remove().catch(err => console.warn(err.message));
  }

  renderAdminUserTable();
  updateAdminFinancialVaultMetrics();
  if (typeof showToast === 'function') showToast("'" + username + "' kullanıcısı silindi.", "info");
}
window.deleteAdminUser = deleteAdminUser;

function toggleAdminVaultLock(username) {
  const u = typeof getStoredUser === 'function' ? getStoredUser(username) : null;
  if (!u || u.isRootAdmin) return;
  u.isVaultLocked = !u.isVaultLocked;
  if (typeof saveStoredUser === 'function') saveStoredUser(u);
  renderAdminUserTable();
  if (typeof showToast === 'function') showToast(username + " kasa kilidi güncellendi.", "info");
}
window.toggleAdminVaultLock = toggleAdminVaultLock;

let activeModTargetUser = null;

function openAdminModifyUserModal(username) {
  const u = typeof getStoredUser === 'function' ? getStoredUser(username) : null;
  if (!u) return;
  activeModTargetUser = u;

  const targetNameEl = document.getElementById('admin-target-user-name');
  const modTlEl = document.getElementById('admin-mod-tl');
  const roleSelect = document.getElementById('admin-mod-role');

  if (targetNameEl) targetNameEl.innerText = u.username;
  if (modTlEl) modTlEl.value = Number(u.tl || 0);
  if (roleSelect) roleSelect.value = u.role || 'Aday';

  if (typeof openModal === 'function') openModal('modal-admin-modify-user');
}
window.openAdminModifyUserModal = openAdminModifyUserModal;

function saveAdminUserModifications() {
  if (!activeModTargetUser) return;

  const newTl = parseFloat(document.getElementById('admin-mod-tl')?.value) || 0;
  const newRole = document.getElementById('admin-mod-role')?.value || activeModTargetUser.role || 'Aday';
  const oldTl = Number(activeModTargetUser.tl || 0);
  const diffTl = Number((newTl - oldTl).toFixed(2));

  if (Math.abs(diffTl) >= 0.01 && typeof addUserNotificationLog === 'function') {
    const sign = diffTl > 0 ? "+" : "";
    addUserNotificationLog(
      activeModTargetUser,
      "Yönetici Bakiye Düzenlemesi",
      "Yönetim masası tarafından bakiye güncellendi.",
      sign + diffTl.toFixed(2) + " TL",
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

  if (typeof saveStoredUser === 'function') saveStoredUser(activeModTargetUser);
  if (typeof closeModal === 'function') closeModal('modal-admin-modify-user');
  renderAdminUserTable();
  updateAdminFinancialVaultMetrics();
  if (typeof showToast === 'function') showToast(activeModTargetUser.username + " rol ve bakiyesi başarıyla güncellendi!", "success");
}
window.saveAdminUserModifications = saveAdminUserModifications;

function queueDepositForAdminApproval(username, amount, senderName, receiptBase64) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  const depId = 'dep_' + Date.now();
  fbDb.ref('depositQueue/' + depId).set({
    id: depId, username: username, amount: amount, senderName: senderName,
    receiptBase64: receiptBase64, date: new Date().toLocaleString('tr-TR'), status: 'pending'
  });
}
window.queueDepositForAdminApproval = queueDepositForAdminApproval;

function renderAdminDepositQueue() {
  const container = document.getElementById('admin-deposit-queue-list');
  if (!container || typeof fbDb === 'undefined' || !fbDb) return;

  fbDb.ref('depositQueue').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">Bekleyen dekont/havale bildirimi yok.</div>';
      return;
    }
    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">Bekleyen dekont/havale bildirimi yok.</div>';
      return;
    }
    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-emerald-500/40 flex flex-col gap-2 text-xs";
      card.innerHTML = 
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-2">' +
            '<strong class="text-white text-sm">' + d.username + '</strong>' +
            '<span class="text-emerald-400 font-mono font-black">+' + d.amount + ' TL</span>' +
          '</div>' +
          '<span class="text-[10px] text-slate-400">' + d.date + '</span>' +
        '</div>' +
        '<div class="text-[11px] text-slate-300">Gönderen: <strong>' + d.senderName + '</strong></div>' +
        (d.receiptBase64 ? 
          '<div class="p-2 bg-black/40 rounded-xl flex items-center justify-between border border-mineora-border">' +
            '<span class="text-amber-300 font-bold text-[11px]"><i class="fa-solid fa-receipt mr-1"></i> Dekont Yüklendi</span>' +
            '<a href="' + d.receiptBase64 + '" target="_blank" class="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-bold">Dekontu İncele</a>' +
          '</div>' : '') +
        '<div class="flex gap-1.5 justify-end pt-1">' +
          '<button type="button" onclick="rejectDepositOrder(\'' + d.id + '\')" class="px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-xs cursor-pointer font-bold">Reddet</button>' +
          '<button type="button" onclick="approveDepositOrder(\'' + d.id + '\', \'' + d.username + '\', ' + d.amount + ')" class="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer shadow">Onayla & Yükle</button>' +
        '</div>';
      container.appendChild(card);
    });
  });
}
window.renderAdminDepositQueue = renderAdminDepositQueue;

function approveDepositOrder(depId, username, amount) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  const uKey = username.toLowerCase();
  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.tl = Number(((uData.tl || 0) + amount).toFixed(2));
      if (typeof addUserNotificationLog === 'function') {
        addUserNotificationLog(uData, "Banka Havalesi Onaylandı", "Havale bildiriminiz onaylandı ve bakiyenize yüklendi.", "+" + amount.toFixed(2) + " TL", "income");
      }
      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`depositQueue/${depId}`).remove();
      renderAdminUserTable();
      updateAdminFinancialVaultMetrics();
      if (typeof showToast === 'function') showToast(username + " hesabına " + amount + " TL yüklendi!", "success");
    }
  });
}
window.approveDepositOrder = approveDepositOrder;

function rejectDepositOrder(depId) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  fbDb.ref(`depositQueue/${depId}`).remove();
  if (typeof showToast === 'function') showToast("Yatırım bildirimi reddedildi.", "info");
}
window.rejectDepositOrder = rejectDepositOrder;

function queueWithdrawalForAdminApproval(username, amount, bankDetails) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  const withId = 'with_' + Date.now();
  fbDb.ref('withdrawalQueue/' + withId).set({
    id: withId, username: username, amount: amount, bankDetails: bankDetails,
    date: new Date().toLocaleString('tr-TR'), status: 'pending'
  });
}
window.queueWithdrawalForAdminApproval = queueWithdrawalForAdminApproval;

function renderAdminWithdrawalQueue() {
  const container = document.getElementById('admin-withdrawal-queue-list');
  if (!container || typeof fbDb === 'undefined' || !fbDb) return;

  fbDb.ref('withdrawalQueue').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">Bekleyen banka çekim talebi yok.</div>';
      return;
    }
    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">Bekleyen banka çekim talebi yok.</div>';
      return;
    }
    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-amber-500/40 flex flex-col gap-2 text-xs";
      card.innerHTML = 
        '<div class="flex items-center justify-between">' +
          '<strong class="text-white text-sm">' + d.username + '</strong>' +
          '<span class="text-amber-400 font-mono font-bold text-sm">-' + d.amount + ' TL</span>' +
        '</div>' +
        '<div class="bg-mineora-bg p-2 rounded-lg text-cyan-300 font-mono text-[11px] select-all">' + d.bankDetails + '</div>' +
        '<div class="flex gap-2 justify-end">' +
          '<button type="button" onclick="rejectWithdrawalOrder(\'' + d.id + '\', \'' + d.username + '\', ' + d.amount + ')" class="px-3 py-1 rounded bg-rose-600/20 text-rose-400 text-xs cursor-pointer">İptal & İade</button>' +
          '<button type="button" onclick="approveWithdrawalOrder(\'' + d.id + '\', \'' + d.username + '\', ' + d.amount + ')" class="px-4 py-1 rounded bg-emerald-600 text-white font-bold text-xs cursor-pointer">Gönderildi (Kapat)</button>' +
        '</div>';
      container.appendChild(card);
    });
  });
}
window.renderAdminWithdrawalQueue = renderAdminWithdrawalQueue;

function approveWithdrawalOrder(withId, username, amount) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  fbDb.ref(`withdrawalQueue/${withId}`).remove().then(() => {
    if (typeof showToast === 'function') showToast(username + " adlı madencinin " + amount + " TL çekimi tamamlandı.", "success");
  });
}
window.approveWithdrawalOrder = approveWithdrawalOrder;

function rejectWithdrawalOrder(withId, username, amount) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  const ok = confirm(username + " kullanıcısının talebini iptal edip " + amount + " TL tutarı hesabına geri iade etmek istiyor musunuz?");
  if (!ok) return;

  const uKey = username.toLowerCase();
  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.tl = Number(((uData.tl || 0) + amount).toFixed(2));
      if (typeof addUserNotificationLog === 'function') {
        addUserNotificationLog(uData, "Çekim İptal Edildi", "Talebiniz iptal edildi ve tutar bakiyenize iade edildi.", "+" + amount.toFixed(2) + " TL", "income");
      }
      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`withdrawalQueue/${withId}`).remove();
      if (typeof showToast === 'function') showToast(amount + " TL hesaba iade edildi.", "info");
    }
  });
}
window.rejectWithdrawalOrder = rejectWithdrawalOrder;

function renderAdminContactMessages() {
  const container = document.getElementById('admin-contact-messages-list');
  if (!container || typeof fbDb === 'undefined' || !fbDb) return;

  fbDb.ref('contactMessages').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";
    if (!data) {
      container.innerHTML = '<div class="p-3 text-center text-slate-500 text-xs">Gelen destek mesajı yok.</div>';
      return;
    }
    const msgs = Object.values(data);
    msgs.forEach(m => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-mineora-border flex flex-col gap-1 text-xs";
      card.innerHTML = 
        '<div class="flex justify-between items-center"><strong class="text-white">${m.name}</strong><span class="text-[10px] text-slate-400">${m.reach}</span></div>' +
        '<p class="text-slate-300 mt-1">${m.message}</p>';
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
          html += 
            '<div class="p-3 rounded-xl bg-mineora-card border border-mineora-border flex justify-between items-center text-xs">' +
              '<div><strong class="text-white">' + u.username + '</strong><span class="text-[10px] text-slate-400 block">Sponsor: ' + (u.referredBy || 'Doğrudan') + '</span></div>' +
              '<span class="text-emerald-400 font-mono font-bold">' + Number(u.tl || 0).toFixed(2) + ' TL</span>' +
            '</div>';
        }
      } catch (e) {}
    }
  }
  html += '</div>';
  container.innerHTML = html;
}
window.renderAdminGlobalHierarchy = renderAdminGlobalHierarchy;

let currentExpandedTab = 'deposit';

function openQueueDetailModal(tab) {
  currentExpandedTab = tab || 'deposit';
  const title = document.getElementById('expanded-modal-title');
  const icon = document.getElementById('expanded-modal-icon');

  ['dep', 'with', 'msg'].forEach(t => {
    const btn = document.getElementById('exp-tab-' + t);
    if (btn) btn.className = "px-3 py-1 rounded-lg text-xs font-bold text-slate-400 hover:text-white cursor-pointer transition";
  });

  if (tab === 'deposit') {
    const b = document.getElementById('exp-tab-dep');
    if (b) b.className = "px-3 py-1 rounded-lg text-xs font-black bg-emerald-600 text-white cursor-pointer";
    if (title) title.innerText = "Yatırma & Dekont Masası (Geniş İnceleme)";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-arrow-down text-emerald-400"></i>';
    renderExpandedDeposits();
  } else if (tab === 'withdraw') {
    const b = document.getElementById('exp-tab-with');
    if (b) b.className = "px-3 py-1 rounded-lg text-xs font-black bg-amber-500 text-black cursor-pointer";
    if (title) title.innerText = "IBAN Çekim Talepleri (Geniş İnceleme)";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-arrow-up text-amber-400"></i>';
    renderExpandedWithdrawals();
  } else {
    const b = document.getElementById('exp-tab-msg');
    if (b) b.className = "px-3 py-1 rounded-lg text-xs font-black bg-cyan-600 text-white cursor-pointer";
    if (title) title.innerText = "Destek Mesajları (Geniş Okuma Masası)";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-inbox text-cyan-400"></i>';
    renderExpandedContactMessages();
  }

  if (typeof openModal === 'function') openModal('modal-queue-expanded');
}
window.openQueueDetailModal = openQueueDetailModal;

function renderExpandedDeposits() {
  const container = document.getElementById('expanded-queue-container');
  if (!container || typeof fbDb === 'undefined' || !fbDb) return;

  fbDb.ref('depositQueue').once('value').then(snap => {
    const data = snap.val();
    container.innerHTML = "";
    const items = data ? Object.values(data).filter(d => d.status === 'pending') : [];

    if (items.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-500 text-sm">Bekleyen dekont/havale bildirimi yok.</div>';
      return;
    }

    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-4 rounded-2xl bg-mineora-bg border border-emerald-500/40 flex flex-col gap-3 text-xs shadow-lg";
      card.innerHTML = 
        '<div class="flex items-center justify-between border-b border-mineora-border/60 pb-2">' +
          '<div class="flex items-center gap-3">' +
            '<strong class="text-white text-base font-bold">' + d.username + '</strong>' +
            '<span class="text-emerald-400 font-mono font-black text-base">+' + d.amount + ' TL</span>' +
          '</div>' +
          '<span class="text-[11px] text-slate-400 font-mono">' + d.date + '</span>' +
        '</div>' +
        '<div class="text-slate-300">Gönderen Hesap Sahibi: <strong>' + d.senderName + '</strong></div>' +
        (d.receiptBase64 ? 
          '<div class="p-3 bg-black/50 rounded-xl flex items-center justify-between border border-mineora-border">' +
            '<span class="text-amber-300 font-bold"><i class="fa-solid fa-receipt mr-1.5"></i> Yüklenen Dekont Görseli</span>' +
            '<a href="' + d.receiptBase64 + '" target="_blank" class="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5">' +
              '<i class="fa-solid fa-up-right-from-square"></i> Dekontu Yeni Sekmede Tam Boy İncele' +
            '</a>' +
          '</div>' : '') +
        '<div class="flex gap-2 justify-end pt-1">' +
          '<button type="button" onclick="rejectDepositOrder(\'' + d.id + '\'); renderExpandedDeposits();" class="px-4 py-2 rounded-xl bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs cursor-pointer">Reddet</button>' +
          '<button type="button" onclick="approveDepositOrder(\'' + d.id + '\', \'' + d.username + '\', ' + d.amount + '); renderExpandedDeposits();" class="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer shadow-lg">Onayla & TL Yükle</button>' +
        '</div>';
      container.appendChild(card);
    });
  });
}

function renderExpandedWithdrawals() {
  const container = document.getElementById('expanded-queue-container');
  if (!container || typeof fbDb === 'undefined' || !fbDb) return;

  fbDb.ref('withdrawalQueue').once('value').then(snap => {
    const data = snap.val();
    container.innerHTML = "";
    const items = data ? Object.values(data).filter(d => d.status === 'pending') : [];

    if (items.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-500 text-sm">Bekleyen banka çekim talebi yok.</div>';
      return;
    }

    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-4 rounded-2xl bg-mineora-bg border border-amber-500/40 flex flex-col gap-3 text-xs shadow-lg";
      card.innerHTML = 
        '<div class="flex items-center justify-between border-b border-mineora-border/60 pb-2">' +
          '<div class="flex items-center gap-3">' +
            '<strong class="text-white text-base font-bold">' + d.username + '</strong>' +
            '<span class="text-amber-400 font-mono font-black text-base">-' + d.amount + ' TL</span>' +
          '</div>' +
          '<span class="text-slate-400 font-mono text-xs">' + d.date + '</span>' +
        '</div>' +
        '<div class="flex items-center justify-between gap-3 bg-mineora-card p-3 rounded-xl border border-mineora-border">' +
          '<span class="text-cyan-300 font-mono text-xs select-all truncate">' + d.bankDetails + '</span>' +
          '<button type="button" onclick="navigator.clipboard.writeText(\'' + d.bankDetails + '\'); if (typeof showToast === \'function\') showToast(\'Bilgiler kopyalandı!\', \'success\');" class="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold cursor-pointer shrink-0">' +
            'Kopyala' +
          '</button>' +
        '</div>' +
        '<div class="flex gap-2 justify-end pt-1">' +
          '<button type="button" onclick="rejectWithdrawalOrder(\'' + d.id + '\', \'' + d.username + '\', ' + d.amount + '); renderExpandedWithdrawals();" class="px-4 py-2 rounded-xl bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs cursor-pointer">İade Et</button>' +
          '<button type="button" onclick="approveWithdrawalOrder(\'' + d.id + '\', \'' + d.username + '\', ' + d.amount + '); renderExpandedWithdrawals();" class="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer shadow-lg">Ödendi Olarak Kapat</button>' +
        '</div>';
      container.appendChild(card);
    });
  });
}

function renderExpandedContactMessages() {
  const container = document.getElementById('expanded-queue-container');
  if (!container || typeof fbDb === 'undefined' || !fbDb) return;

  fbDb.ref('contactMessages').once('value').then(snap => {
    const data = snap.val();
    container.innerHTML = "";
    const msgs = data ? Object.values(data) : [];

    if (msgs.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-500 text-sm">Gelen destek mesajı yok.</div>';
      return;
    }

    msgs.forEach(m => {
      const card = document.createElement('div');
      card.className = "p-4 rounded-2xl bg-mineora-bg border border-cyan-500/30 flex flex-col gap-2 text-xs shadow-lg";
      card.innerHTML = 
        '<div class="flex items-center justify-between border-b border-mineora-border/60 pb-2">' +
          '<strong class="text-white text-sm">' + m.name + '</strong>' +
          '<span class="text-cyan-400 font-mono text-xs">' + m.reach + '</span>' +
        '</div>' +
        '<p class="text-slate-200 bg-mineora-card p-3 rounded-xl border border-mineora-border/60 whitespace-pre-wrap">' + m.message + '</p>';
      container.appendChild(card);
    });
  });
}
