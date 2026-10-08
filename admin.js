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

function updateAdminAuthStatusBar() {
  const dot = document.getElementById('auth-status-dot');
  const title = document.getElementById('auth-status-title');
  const desc = document.getElementById('auth-status-desc');
  const controls = document.getElementById('auth-login-controls');

  if (!dot || !title) return;

  if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
    const user = firebase.auth().currentUser;
    dot.className = "w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981]";
    title.innerText = "Firebase Admin Yetkisi: AKTİF (Kilitler Açık ✓)";
    title.className = "text-emerald-400 font-bold block";
    desc.innerText = `Bağlı: ${user.email} (UID: ${user.uid})`;
    if (controls) controls.classList.add('hidden');
  } else {
    dot.className = "w-3 h-3 rounded-full bg-rose-500 animate-pulse";
    title.innerText = "Firebase Admin Yetkisi: KAPALI (Kutular Kilitli)";
    title.className = "text-rose-400 font-bold block";
    desc.innerText = "Kutuların açılması için ersinulasduzyol@gmail.com şifrenizi girin:";
    if (controls) controls.classList.remove('hidden');
  }
}

async function executeDirectAdminAuthLogin() {
  const passInput = document.getElementById('admin-auth-direct-pass');
  const pass = passInput ? passInput.value.trim() : (CurrentUser ? CurrentUser.pass : null);

  if (!pass) {
    showToast("⚠️ Lütfen Firebase şifrenizi girin!", "warning");
    return;
  }

  showToast("🔐 Admin kimliği doğrulanıyor...", "info");

  try {
    const res = await firebase.auth().signInWithEmailAndPassword("ersinulasduzyol@gmail.com", pass);
    console.log("✅ Admin oturumu açıldı:", res.user.uid);
    showToast("🎉 Yetki onaylandı! Masalar canlıya bağlandı.", "success");
    
    if (CurrentUser) {
      CurrentUser.pass = pass;
      saveUserWorld();
    }

    updateAdminAuthStatusBar();
    if (typeof renderAdminDepositQueue === 'function') renderAdminDepositQueue();
    if (typeof renderAdminWithdrawalQueue === 'function') renderAdminWithdrawalQueue();
    if (typeof renderAdminContactMessages === 'function') renderAdminContactMessages();
  } catch (err) {
    console.error("Giriş hatası:", err);
    showToast(`❌ Hata (${err.code}): Şifre eşleşmedi veya yetki verilmedi.`, "warning");
    updateAdminAuthStatusBar();
  }
}
window.executeDirectAdminAuthLogin = executeDirectAdminAuthLogin;

if (typeof firebase !== 'undefined' && firebase.auth) {
  firebase.auth().onAuthStateChanged(user => {
    updateAdminAuthStatusBar();
    if (user && user.uid === 'RmrFnNb29TPsDONQv39kDJtj9Vo2') {
      if (typeof renderAdminDepositQueue === 'function') renderAdminDepositQueue();
      if (typeof renderAdminWithdrawalQueue === 'function') renderAdminWithdrawalQueue();
      if (typeof renderAdminContactMessages === 'function') renderAdminContactMessages();
    }
  });
}

function renderAdminGlobalHierarchy() {
  const container = document.getElementById('admin-global-hierarchy-tree');
  if (!container || !CurrentUser || !CurrentUser.isRootAdmin) return;

  const allUsers = [];
  const deletedList = (typeof getDeletedUsers === 'function') ? getDeletedUsers() : [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u && u.username && !deletedList.includes(u.username.toLowerCase())) {
          allUsers.push(u);
        }
      } catch(e) {}
    }
  }

  if (allUsers.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-slate-500 text-xs notranslate" translate="no">Sistemde henüz kayıtlı kullanıcı yok.</div>`;
    return;
  }

  let html = '<div class="space-y-2 max-h-72 overflow-y-auto pr-1 notranslate" translate="no">';
  allUsers.forEach(u => {
    const sponsorName = u.referredBy || (u.referral_chain && u.referral_chain.length > 0 ? u.referral_chain[u.referral_chain.length - 1] : "Doğrudan Kayıt");
    const roleBadge = (typeof getRoleBadgeStyle === 'function') ? getRoleBadgeStyle(u.role) : { bg: "bg-slate-700 text-slate-300", icon: "fa-user" };
    html += `
      <div class="p-3 rounded-xl bg-mineora-card border border-mineora-border flex items-center justify-between text-xs">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg bg-mineora-input flex items-center justify-center font-bold text-white text-[11px]">
            ${u.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <strong class="text-white">${u.username}</strong>
              <span class="px-1.5 py-0.5 rounded text-[8px] border font-mono ${roleBadge.bg}">${u.role || 'Candidate'}</span>
            </div>
            <span class="text-[10px] text-slate-400">Sponsor: <span class="text-cyan-300 font-mono">${sponsorName}</span></span>
          </div>
        </div>
        <div class="text-right font-mono text-[11px]">
          <span class="text-mineora-gold font-bold block">${Number(u.ora || 0).toFixed(2)} ORA</span>
          <span class="text-mineora-green">$${Number(u.usdt || 0).toFixed(2)} USDT</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}
window.renderAdminGlobalHierarchy = renderAdminGlobalHierarchy;

function initAdminMasterPanel() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  renderAdminHUD();
  renderAdminCommissionInputs();
  renderAdminUserTable();
  renderAdminGlobalHierarchy();
  renderAdminDepositQueue();
  renderAdminWithdrawalQueue();
  renderAdminLiveRoomsMonitor();
  renderAdminContactMessages();
}
window.initAdminMasterPanel = initAdminMasterPanel;

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
window.updateAdminCommissionSettings = updateAdminCommissionSettings;

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
window.executeAdminDirectOraTransfer = executeAdminDirectOraTransfer;

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
window.executeAdminVaultWithdraw = executeAdminVaultWithdraw;

async function executeAdminBurnOra() {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const amtInput = document.getElementById('admin-burn-ora-amount');
  const amt = parseFloat(amtInput?.value);

  if (!amt || amt <= 0) { 
    showToast("⚠️ Lütfen yakılacak geçerli bir ORA miktarı girin!", "warning"); 
    return; 
  }

  const currentReserve = Number(AdminState.genesisOraReserve || 1000000000);
  if (amt > currentReserve) {
    showToast("⛔ Yakılmak istenen miktar kalan rezervden büyük olamaz!", "warning");
    return;
  }

  if (typeof firebase !== 'undefined' && firebase.auth && !firebase.auth().currentUser) {
    try {
      showToast("🔐 Admin yetkisi doğrulanıyor...", "info");
      await firebase.auth().signInWithEmailAndPassword("ersinulasduzyol@gmail.com", CurrentUser.pass);
    } catch (authErr) {
      console.warn("Auth köprü uyarısı:", authErr);
      showToast("⛔ Yetki doğrulanamadı! Lütfen bir kez çıkış yapıp tekrar girin.", "warning");
      return;
    }
  }

  const newReserve = Number((currentReserve - amt).toFixed(2));
  const newBurned = Number(((AdminState.totalBurnedOra || 0) + amt).toFixed(2));

  AdminState.genesisOraReserve = newReserve;
  AdminState.totalBurnedOra = newBurned;

  if (typeof ProtocolState !== 'undefined') {
    ProtocolState.totalBurnedOra = newBurned;
    if (typeof saveGlobalProtocolState === 'function') saveGlobalProtocolState(ProtocolState);
  }

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('adminState').update({
      genesisOraReserve: newReserve,
      totalBurnedOra: newBurned
    }).then(() => {
      localStorage.setItem('mineora_admin_root_state', JSON.stringify(AdminState));
      renderAdminHUD();
      if (amtInput) amtInput.value = "";
      showToast(`🔥 ${amt.toLocaleString()} ORA başarıyla yakıldı ve rezervden düşüldü!`, "success");
    }).catch((err) => {
      console.error("Firebase Engeli:", err);
      showToast(`⛔ Firebase Yazma İzni Reddedildi: ${err.message}`, "warning");
      renderAdminHUD();
    });
  } else {
    localStorage.setItem('mineora_admin_root_state', JSON.stringify(AdminState));
    renderAdminHUD();
    if (amtInput) amtInput.value = "";
    showToast(`🔥 ${amt.toLocaleString()} ORA yakıldı (Yerel).`, "success");
  }
}
window.executeAdminBurnOra = executeAdminBurnOra;

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
    if (globalTreeCard && globalTreeCard.parentElement) {
      globalTreeCard.parentElement.insertBefore(monitorContainer, globalTreeCard);
    } else {
      secBoss.querySelector('.p-6')?.appendChild(monitorContainer);
    }
  }

  const renderRoomsList = (rooms) => {
    let rowsHtml = '';
    const roomKeys = rooms ? Object.keys(rooms) : [];

    if (roomKeys.length === 0) {
      rowsHtml = `<tr><td colspan="6" class="py-6 text-center text-slate-500 notranslate" translate="no">Şu anda aktif canlı yayın odası bulunmuyor.</td></tr>`;
    } else {
      roomKeys.forEach(k => {
        const r = rooms[k];
        if (!r) return;
        const reportCount = r.reports ? Object.keys(r.reports).length : 0;
        const viewerCount = r.viewers ? Object.keys(r.viewers).length : 0;
        const isQuarantined = !!r.isQuarantined;

        rowsHtml += `
          <tr class="hover:bg-mineora-card/60 transition notranslate" translate="no">
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
            <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap notranslate" translate="no">
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
      <div class="flex justify-between items-center border-b border-mineora-border pb-3 notranslate" translate="no">
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
      <div class="overflow-x-auto rounded-xl border border-mineora-border notranslate" translate="no">
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
    fbDb.ref('liveRooms').once('value').then(snap => renderRoomsList(snap.val()));
  } else {
    try {
      const localRooms = JSON.parse(localStorage.getItem('mineora_mock_live_rooms') || '{}');
      renderRoomsList(localRooms);
    } catch(e) {}
  }
}
window.renderAdminLiveRoomsMonitor = renderAdminLiveRoomsMonitor;

function adminJoinLiveRoomDirect(roomId, isGhost) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  isGhostAdminMode = !!isGhost;
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${roomId}`).once('value').then(snap => {
      const room = snap.val();
      if (!room) {
        showToast("⛔ Oda bulunamadı!", "warning");
        return;
      }
      enterRoomView(room, false);
      showToast(isGhost ? "👻 Hayalet Modu: Odaya görünmez olarak katıldınız." : "👑 Admin Yetkisiyle odaya doğrudan katıldınız.", "info");
    });
  }
}
window.adminJoinLiveRoomDirect = adminJoinLiveRoomDirect;

function adminNukeLiveRoom(roomId, banUser) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${roomId}`).once('value').then(snap => {
      const room = snap.val();
      if (!room) return;
      fbDb.ref(`liveRooms/${roomId}`).remove();
      if (banUser && room.host) {
        toggleAdminVaultLock(room.host);
      }
      renderAdminLiveRoomsMonitor();
      showToast(`💥 Oda sonlandırıldı! ${banUser ? `(${room.host} cüzdanı kilitlendi)` : ''}`, "warning");
    });
  }
}
window.adminNukeLiveRoom = adminNukeLiveRoom;

function auditUserFinancials(u) {
  if (!u || u.isRootAdmin) return { isSuspicious: false, reasons: [] };

  const reasons = [];
  const currentOra = Number(parseFloat(u.ora || 0).toFixed(2));
  const currentUsdt = Number(parseFloat(u.usdt || 0).toFixed(2));

  let loggedOraIn = 0;
  let loggedOraOut = 0;
  let loggedUsdtIn = 0;
  let loggedUsdtOut = 0;

  if (Array.isArray(u.logs)) {
    u.logs.forEach(l => {
      const txt = (l.amountText || "").toString();
      const numMatch = txt.match(/[\d\.]+/);
      const val = numMatch ? parseFloat(numMatch[0]) : 0;

      if (txt.includes('ORA')) {
        if (txt.startsWith('+')) loggedOraIn += val;
        if (txt.startsWith('-')) loggedOraOut += val;
      } else if (txt.includes('USDT') || txt.includes('$')) {
        if (txt.startsWith('+')) loggedUsdtIn += val;
        if (txt.startsWith('-')) loggedUsdtOut += val;
      }
    });
  }

  const netExpectedOra = Number((loggedOraIn - loggedOraOut).toFixed(2));
  const netExpectedUsdt = Number((loggedUsdtIn - loggedUsdtOut).toFixed(2));

  if (currentOra > 50 && (currentOra - netExpectedOra) > 50) {
    reasons.push(`+${(currentOra - netExpectedOra).toFixed(0)} ORA Kayıtsız Kaçak`);
  }

  if (currentUsdt > 20 && (currentUsdt - netExpectedUsdt) > 20) {
    reasons.push(`+$${(currentUsdt - netExpectedUsdt).toFixed(2)} USDT Kayıtsız Kaçak`);
  }

  if ((u.role === 'Aday' || u.role === 'Candidate') && (currentOra > 150 || currentUsdt > 50)) {
    reasons.push("Aday Hesaba Göre Anormal Yüksek Kasa");
  }

  return {
    isSuspicious: reasons.length > 0,
    reasons: reasons
  };
}

function renderAdminUserTable() {
  const tbody = document.getElementById('admin-user-table-body');
  if (!tbody) return;
  tbody.innerHTML = "";

  const allUsers = [];
  const deletedList = (typeof getDeletedUsers === 'function') ? getDeletedUsers() : [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u && u.username && !deletedList.includes(u.username.toLowerCase())) {
          allUsers.push(u);
        }
      } catch(e) {}
    }
  }

  allUsers.forEach(u => {
    const audit = auditUserFinancials(u);
    const tr = document.createElement('tr');
    tr.className = audit.isSuspicious 
      ? "bg-rose-950/30 border-2 border-rose-500/80 transition notranslate animate-pulse" 
      : "hover:bg-mineora-bg/60 transition notranslate";
    tr.setAttribute('translate', 'no');

    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-white">
        ${u.username} ${u.isRootAdmin ? '<span class="text-rose-400 text-[10px] ml-1">[ADMIN]</span>' : ''}
        ${audit.isSuspicious ? `
          <div class="mt-1 px-2 py-0.5 rounded bg-rose-600/30 border border-rose-500 text-rose-300 text-[9px] font-mono font-bold">
            ⚠️ ŞÜPHELİ: ${audit.reasons.join(' • ')}
          </div>
        ` : ''}
      </td>
      <td class="py-3 px-4 font-mono text-slate-400">${u.pass || '••••••'}</td>
      <td class="py-3 px-4 font-bold text-slate-300">${u.role || 'Candidate'}</td>
      <td class="py-3 px-4 font-mono ${audit.isSuspicious ? 'text-rose-400 font-black' : 'text-mineora-green'} font-bold">$${Number(u.usdt || 0).toFixed(2)}</td>
      <td class="py-3 px-4 font-mono ${audit.isSuspicious ? 'text-rose-400 font-black' : 'text-mineora-gold'} font-bold">${Number(u.ora || 0).toFixed(2)} ORA</td>
      <td class="py-3 px-4">
        ${u.isVaultLocked ? '<span class="text-rose-400 font-bold">KİLİTLİ</span>' : '<span class="text-emerald-400">Açık</span>'}
      </td>
      <td class="py-3 px-4 text-right space-x-1.5 notranslate whitespace-nowrap" translate="no">
        <button type="button" onclick="openAdminUserLogsModal('${u.username}')" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer transition shadow">
          <i class="fa-solid fa-file-lines mr-1"></i> Log Dökümü
        </button>
        ${!u.isRootAdmin ? `
          <button type="button" onclick="toggleAdminVaultLock('${u.username}')" class="px-2.5 py-1 rounded ${audit.isSuspicious ? 'bg-rose-600 hover:bg-rose-500 text-white font-black' : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 font-bold'} text-[11px] cursor-pointer">
            ${u.isVaultLocked ? 'Kilidi Aç' : (audit.isSuspicious ? 'Acil Kilitle!' : 'Kilitle')}
          </button>
        ` : `
          <span class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Korumalı</span>
        `}
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
window.renderAdminUserTable = renderAdminUserTable;

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

  const sessionUser = sessionStorage.getItem('mineora_active_session');
  if (sessionUser && sessionUser.toLowerCase() === uKey) {
    sessionStorage.removeItem('mineora_active_session');
  }

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mineora_user_')) {
      try {
        const u = JSON.parse(localStorage.getItem(k));
        if (u && Array.isArray(u.workers)) {
          const prevLen = u.workers.length;
          u.workers = u.workers.filter(w => (w.username || '').toLowerCase() !== uKey);
          if (u.workers.length !== prevLen) {
            saveStoredUser(u);
          }
        }
      } catch(e) {}
    }
  }

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`users/${uKey}`).remove();
    fbDb.ref(`deletedUsers/${uKey}`).set(true);
  }

  renderAdminUserTable();
  showToast(`🗑️ '${username}' kullanıcısı kalıcı olarak silindi.`, "info");
}
window.deleteAdminUser = deleteAdminUser;

function toggleAdminVaultLock(username) {
  const u = getStoredUser(username);
  if (!u) return;

  if (u.isRootAdmin || (CurrentUser && u.username.toLowerCase() === CurrentUser.username.toLowerCase())) {
    showToast("⛔ Yönetici ve kurucu hesapların kasası kilitlenemez!", "warning");
    return;
  }

  u.isVaultLocked = !u.isVaultLocked;
  saveStoredUser(u);
  renderAdminUserTable();
  showToast(`🔒 ${username} kullanıcısının kasa durumu: ${u.isVaultLocked ? 'KİLİTLENDİ' : 'AÇILDI'}`, "info");
}
window.toggleAdminVaultLock = toggleAdminVaultLock;

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
window.openAdminModifyUserModal = openAdminModifyUserModal;

function saveAdminUserModifications() {
  if (!activeModTargetUser) return;
  const newUsdt = parseFloat(document.getElementById('admin-mod-usdt').value) || 0;
  const newOra = parseFloat(document.getElementById('admin-mod-ora').value) || 0;
  const newRole = document.getElementById('admin-mod-role').value;

  const oldUsdt = Number(parseFloat(activeModTargetUser.usdt || 0).toFixed(2));
  const oldOra = Number(parseFloat(activeModTargetUser.ora || 0).toFixed(2));

  const diffOra = Number((newOra - oldOra).toFixed(2));
  const diffUsdt = Number((newUsdt - oldUsdt).toFixed(2));

  if (Math.abs(diffOra) >= 0.01) {
    const sign = diffOra > 0 ? "+" : "";
    addUserNotificationLog(
      activeModTargetUser,
      "Yönetici ORA Müdahalesi",
      "Root Admin tarafından bakiye güncellendi.",
      `${sign}${diffOra.toFixed(2)} ORA`,
      diffOra > 0 ? "admin_grant" : "admin_deduct"
    );
  }

  if (Math.abs(diffUsdt) >= 0.01) {
    const sign = diffUsdt > 0 ? "+$" : "-$";
    addUserNotificationLog(
      activeModTargetUser,
      "Yönetici USDT Müdahalesi",
      "Root Admin tarafından bakiye güncellendi.",
      `${sign}${Math.abs(diffUsdt).toFixed(2)} USDT`,
      diffUsdt > 0 ? "admin_grant" : "admin_deduct"
    );
  }

  activeModTargetUser.usdt = Number(newUsdt.toFixed(2));
  activeModTargetUser.ora = Number(newOra.toFixed(2));
  activeModTargetUser.role = newRole;

  saveStoredUser(activeModTargetUser);
  closeModal('modal-admin-modify-user');
  renderAdminUserTable();
  showToast(`💾 ${activeModTargetUser.username} bakiyesi ve rolü resmi log kaydıyla güncellendi!`, "success");
}
window.saveAdminUserModifications = saveAdminUserModifications;

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
window.handleAdminCreateUserSubmit = handleAdminCreateUserSubmit;

let lastAuthErrorMessage = "";

async function ensureAdminAuthConnection(customPassword = null) {
  if (typeof firebase === 'undefined' || !firebase.auth) return false;
  if (firebase.auth().currentUser) return true;

  const passToTry = customPassword || (CurrentUser ? CurrentUser.pass : null);
  if (!passToTry) return false;

  try {
    await firebase.auth().signInWithEmailAndPassword("ersinulasduzyol@gmail.com", passToTry);
    console.log("✅ Firebase Admin oturumu doğrulandı.");
    lastAuthErrorMessage = "";
    return true;
  } catch (err) {
    console.warn("Firebase Auth Hatası:", err);
    lastAuthErrorMessage = err.code || err.message;
    return false;
  }
}

function queueDepositForAdminApproval(username, amount, txid) {
  if (!fbDb) {
    showToast("⚠️ Veritabanı bağlantısı yok!", "warning");
    return;
  }
  const depId = `dep_${Date.now()}`;
  const payload = {
    id: depId,
    username: username,
    amount: Number(parseFloat(amount).toFixed(2)),
    txid: txid,
    date: new Date().toLocaleString('tr-TR'),
    status: 'pending'
  };

  fbDb.ref(`depositQueue/${depId}`).set(payload).then(() => {
    console.log("✅ Bildirim Firebase'e yazıldı:", payload);
  }).catch(err => {
    console.error("Yazma hatası:", err);
    showToast("⛔ Bildirim gönderilemedi: " + err.message, "warning");
  });
}
window.queueDepositForAdminApproval = queueDepositForAdminApproval;

async function renderAdminDepositQueue() {
  const container = document.getElementById('admin-deposit-queue-list');
  if (!container || !fbDb) return;

  if (CurrentUser && CurrentUser.isRootAdmin && !firebase.auth().currentUser) {
    await ensureAdminAuthConnection();
  }

  fbDb.ref('depositQueue').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";

    if (!data) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs notranslate" translate="no">Bekleyen BEP-20 yatırma bildirimi yok.</div>`;
      return;
    }

    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs notranslate" translate="no">Bekleyen BEP-20 yatırma bildirimi yok.</div>`;
      return;
    }

    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-emerald-500/40 flex items-center justify-between text-xs";
      card.innerHTML = `
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <strong class="text-white">${d.username}</strong>
            <span class="text-emerald-400 font-mono font-black">+$${d.amount.toFixed(2)} USDT</span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono block break-all">TxID: ${d.txid}</span>
          <span class="text-[9px] text-slate-500 font-mono">${d.date}</span>
        </div>
        <div class="flex gap-1.5 shrink-0 ml-2">
          <button type="button" onclick="approveDepositOrder('${d.id}', '${d.username}', ${d.amount})" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer shadow">
            Onayla
          </button>
          <button type="button" onclick="rejectDepositOrder('${d.id}')" class="px-2.5 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs cursor-pointer">
            Reddet
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  }, err => {
    const errText = lastAuthErrorMessage || err.code || "auth/denied";
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center space-y-2">
        <div class="text-amber-300 text-xs font-bold">
          ⚠️ Firebase Oturumu Doğrulanamadı (${errText})
        </div>
        <p class="text-[10px] text-slate-400">ersinulasduzyol@gmail.com şifrenizi girerek yetkiyi açabilirsiniz:</p>
        <div class="flex gap-1.5 max-w-xs mx-auto pt-1">
          <input type="password" id="input-manual-admin-auth-pass" placeholder="Firebase Şifreniz" class="flex-1 bg-mineora-bg border border-mineora-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-400">
          <button type="button" onclick="handleManualAdminAuthConnect()" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-black text-xs rounded-lg cursor-pointer">
            Bağlan
          </button>
        </div>
      </div>
    `;
  });
}
window.renderAdminDepositQueue = renderAdminDepositQueue;

window.handleManualAdminAuthConnect = async function() {
  const pass = document.getElementById('input-manual-admin-auth-pass')?.value.trim();
  if (!pass) {
    showToast("⚠️ Lütfen şifrenizi girin!", "warning");
    return;
  }
  showToast("🔐 Bağlanılıyor...", "info");
  const success = await ensureAdminAuthConnection(pass);
  if (success) {
    if (CurrentUser) CurrentUser.pass = pass;
    saveUserWorld();
    showToast("✅ Firebase yetkisi alındı!", "success");
    renderAdminDepositQueue();
    if (typeof renderAdminContactMessages === 'function') renderAdminContactMessages();
  } else {
    showToast(`❌ Giriş başarısız: ${lastAuthErrorMessage}`, "warning");
    renderAdminDepositQueue();
  }
};

function approveDepositOrder(depId, username, amount) {
  if (!CurrentUser || !CurrentUser.isRootAdmin || !fbDb) return;
  const uKey = username.toLowerCase();

  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.usdt = Number(((uData.usdt || 0) + amount).toFixed(2));
      if (!uData.logs) uData.logs = [];
      uData.logs.unshift({
        id: Date.now(),
        title: "BEP-20 USDT Yüklendi",
        desc: "Yatırma bildiriminiz onaylandı ve bakiyenize aktarıldı.",
        amountText: `+$${amount.toFixed(2)} USDT`,
        type: "income",
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString('tr-TR'),
        read: false
      });

      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`depositQueue/${depId}`).remove();

      if (CurrentUser.username.toLowerCase() === uKey) {
        CurrentUser.usdt = uData.usdt;
        saveUserWorld();
        updateHUD();
      }

      if (typeof renderAdminUserTable === 'function') renderAdminUserTable();
      showToast(`✅ ${username} hesabına $${amount.toFixed(2)} USDT yüklendi!`, "success");
    }
  });
}
window.approveDepositOrder = approveDepositOrder;

function rejectDepositOrder(depId) {
  if (!CurrentUser || !CurrentUser.isRootAdmin || !fbDb) return;
  fbDb.ref(`depositQueue/${depId}`).remove().then(() => {
    showToast("Bildirim reddedildi.", "info");
  });
}
window.rejectDepositOrder = rejectDepositOrder;

function queueWithdrawalForAdminApproval(username, amount, targetAddr) {
  if (!fbDb) {
    showToast("⚠️ Veritabanı bağlantısı yok!", "warning");
    return;
  }
  const withId = `with_${Date.now()}`;
  const payload = {
    id: withId,
    username: username,
    amount: Number(parseFloat(amount).toFixed(2)),
    targetAddress: targetAddr,
    date: new Date().toLocaleString('tr-TR'),
    status: 'pending'
  };

  fbDb.ref(`withdrawalQueue/${withId}`).set(payload).then(() => {
    console.log("✅ Çekim talebi Firebase'e yazıldı:", payload);
  }).catch(err => {
    console.error("Çekim yazma hatası:", err);
    showToast("⛔ Çekim talebi iletilemedi: " + err.message, "warning");
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
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs notranslate" translate="no">Bekleyen USDT çekim talebi yok.</div>`;
      return;
    }

    const items = Object.values(data).filter(d => d.status === 'pending');
    if (items.length === 0) {
      container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs notranslate" translate="no">Bekleyen USDT çekim talebi yok.</div>`;
      return;
    }

    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-amber-500/40 flex flex-col gap-2.5 text-xs shadow-md";
      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-mineora-border/60 pb-1.5">
          <div class="flex items-center gap-2">
            <strong class="text-white text-sm">${d.username}</strong>
            <span class="text-amber-400 font-mono font-black text-sm">-$${d.amount.toFixed(2)} USDT</span>
          </div>
          <span class="text-[10px] text-slate-500 font-mono">${d.date}</span>
        </div>

        <div class="flex items-center gap-2 bg-mineora-bg p-2 rounded-xl border border-mineora-border">
          <i class="fa-solid fa-wallet text-cyan-400 shrink-0"></i>
          <span class="text-[11px] text-cyan-300 font-mono select-all truncate flex-1" title="${d.targetAddress}">${d.targetAddress}</span>
          <button type="button" onclick="navigator.clipboard.writeText('${d.targetAddress}'); showToast('📋 Cüzdan adresi kopyalandı!', 'success');" class="px-2.5 py-1 bg-cyan-600/30 hover:bg-cyan-600 text-cyan-300 hover:text-white rounded-lg text-[10px] font-bold cursor-pointer transition shrink-0 flex items-center gap-1">
            <i class="fa-solid fa-copy"></i> Kopyala
          </button>
        </div>

        <div class="flex gap-2 pt-0.5">
          <button type="button" onclick="approveWithdrawalOrder('${d.id}', '${d.username}', ${d.amount})" class="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer shadow transition text-center">
            Gönderildi (Kapat)
          </button>
          <button type="button" onclick="rejectWithdrawalOrder('${d.id}', '${d.username}', ${d.amount})" class="px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs cursor-pointer transition text-center" title="Reddet ve Parayı İade Et">
            İade Et
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}
window.renderAdminWithdrawalQueue = renderAdminWithdrawalQueue;

function approveWithdrawalOrder(withId, username, amount) {
  if (!CurrentUser || !CurrentUser.isRootAdmin || !fbDb) return;
  fbDb.ref(`withdrawalQueue/${withId}`).remove().then(() => {
    showToast(`✅ ${username} adlı kullanıcının $${amount} USDT çekimi tamamlandı olarak işaretlendi.`, "success");
  });
}
window.approveWithdrawalOrder = approveWithdrawalOrder;

function rejectWithdrawalOrder(withId, username, amount) {
  if (!CurrentUser || !CurrentUser.isRootAdmin || !fbDb) return;
  const ok = confirm(`${username} kullanıcısının çekim talebini reddedip $${amount} USDT tutarı hesabına geri iade etmek istiyor musunuz?`);
  if (!ok) return;

  const uKey = username.toLowerCase();
  fbDb.ref(`users/${uKey}`).once('value').then(snap => {
    const uData = snap.val();
    if (uData) {
      uData.usdt = Number(((uData.usdt || 0) + amount).toFixed(2));
      fbDb.ref(`users/${uKey}`).set(uData);
      fbDb.ref(`withdrawalQueue/${withId}`).remove();

      if (CurrentUser.username.toLowerCase() === uKey) {
        CurrentUser.usdt = uData.usdt;
        saveUserWorld();
        updateHUD();
      }
      showToast(`↩️ Çekim iptal edildi, $${amount} USDT hesaba iade edildi.`, "info");
    }
  });
}
window.rejectWithdrawalOrder = rejectWithdrawalOrder;

function submitContactMessage() {
  const name = document.getElementById('contact-name')?.value.trim();
  const reach = document.getElementById('contact-reach')?.value.trim();
  const msg = document.getElementById('contact-message')?.value.trim();

  if (!reach || !msg) {
    showToast("⚠️ Lütfen iletişim adresinizi ve mesajınızı doldurun!", "warning");
    return;
  }

  const msgId = `msg_${Date.now()}`;
  const payload = {
    id: msgId,
    name: name || (CurrentUser ? CurrentUser.username : "Ziyaretçi"),
    reach: reach,
    message: msg,
    createdAt: Date.now(),
    dateStr: new Date().toLocaleString('tr-TR'),
    isRegistered: !!CurrentUser
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`contactMessages/${msgId}`).set(payload).then(() => {
      closeModal('modal-contact');
      document.getElementById('contact-reach').value = "";
      document.getElementById('contact-message').value = "";
      showToast("✉️ Mesajınız iletildi! En kısa sürede dönüş yapılacaktır.", "success");
    }).catch(err => {
      console.error("Mesaj gönderme hatası:", err);
      showToast("⚠️ Mesaj iletilemedi, lütfen tekrar deneyin.", "warning");
    });
  } else {
    showToast("⚠️ Veritabanı bağlantısı kurulamadı.", "warning");
  }
}
window.submitContactMessage = submitContactMessage;

window.renderAdminContactMessages = function() {
  if (!CurrentUser || !CurrentUser.isRootAdmin || !fbDb) return;
  const container = document.getElementById('admin-contact-messages-list');
  if (!container) return;

  fbDb.ref('contactMessages').on('value', snap => {
    const data = snap.val();
    container.innerHTML = "";

    if (!data) {
      container.innerHTML = `<div class="p-4 text-center text-slate-500 text-xs">Henüz gelen bir ziyaretçi mesajı yok.</div>`;
      return;
    }

    const messages = Object.values(data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    messages.forEach(m => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-xl bg-mineora-card border border-mineora-border flex flex-col gap-2 text-xs shadow";
      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-mineora-border/60 pb-1.5">
          <div class="flex items-center gap-1.5">
            <strong class="text-white text-xs">${m.name}</strong>
            <span class="px-1.5 py-0.5 rounded text-[8px] font-bold ${m.isRegistered ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}">
              ${m.isRegistered ? 'Üye' : 'Ziyaretçi'}
            </span>
          </div>
          <span class="text-[9px] text-slate-500 font-mono">${m.dateStr || ''}</span>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-cyan-400 font-mono text-[11px] truncate flex-1" title="${m.reach}">
            <i class="fa-solid fa-address-book mr-1"></i>${m.reach}
          </span>
          <button type="button" onclick="deleteAdminContactMessage('${m.id}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white transition cursor-pointer text-[10px] font-bold shrink-0 flex items-center gap-1">
            <i class="fa-solid fa-trash-can"></i> Sil
          </button>
        </div>

        <p class="text-slate-300 leading-relaxed break-words whitespace-pre-wrap bg-mineora-bg p-2 rounded-lg border border-mineora-border/40 text-[11px]">${m.message}</p>
      `;
      container.appendChild(card);
    });

    const expModal = document.getElementById('modal-queue-expanded');
    if (expModal && !expModal.classList.contains('hidden') && currentExpandedTab === 'contact') {
      renderExpandedContactMessages(messages);
    }
  });
};

window.deleteAdminContactMessage = function(msgId) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const ok = confirm("Bu destek mesajını kalıcı olarak silmek istiyor musunuz?");
  if (!ok) return;

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`contactMessages/${msgId}`).remove().then(() => {
      showToast("🗑️ Mesaj başarıyla silindi.", "info");
      renderAdminContactMessages();
    }).catch(err => {
      console.error("Silme hatası:", err);
      showToast("⛔ Silme izni reddedildi: " + err.message, "warning");
    });
  }
};

let currentExpandedTab = 'deposit';

window.openQueueDetailModal = function(tab) {
  currentExpandedTab = tab;
  const modal = document.getElementById('modal-queue-expanded');
  const title = document.getElementById('expanded-modal-title');
  const icon = document.getElementById('expanded-modal-icon');

  ['dep', 'with', 'msg'].forEach(t => {
    const btn = document.getElementById(`exp-tab-${t}`);
    if (btn) btn.className = "px-3 py-1 rounded-lg text-xs font-bold text-slate-400 hover:text-white cursor-pointer";
  });

  if (tab === 'deposit') {
    const b = document.getElementById('exp-tab-dep');
    if (b) b.className = "px-3 py-1 rounded-lg text-xs font-black bg-emerald-600 text-white cursor-pointer";
    title.innerText = "Yatırma Talepleri (Geniş İnceleme Masası)";
    icon.innerHTML = `<i class="fa-solid fa-arrow-down text-emerald-400"></i>`;
    renderExpandedDeposits();
  } else if (tab === 'withdraw') {
    const b = document.getElementById('exp-tab-with');
    if (b) b.className = "px-3 py-1 rounded-lg text-xs font-black bg-amber-500 text-black cursor-pointer";
    title.innerText = "Çekim Talepleri (Geniş İnceleme Masası)";
    icon.innerHTML = `<i class="fa-solid fa-arrow-up text-amber-400"></i>`;
    renderExpandedWithdrawals();
  } else {
    const b = document.getElementById('exp-tab-msg');
    if (b) b.className = "px-3 py-1 rounded-lg text-xs font-black bg-cyan-600 text-white cursor-pointer";
    title.innerText = "Destek & Ziyaretçi Mesajları (Geniş Okuma Masası)";
    icon.innerHTML = `<i class="fa-solid fa-inbox text-cyan-400"></i>`;
    renderExpandedContactMessages();
  }

  openModal('modal-queue-expanded');
};

function renderExpandedDeposits() {
  const container = document.getElementById('expanded-queue-container');
  if (!container || !fbDb) return;

  fbDb.ref('depositQueue').once('value').then(snap => {
    const data = snap.val();
    container.innerHTML = "";
    const items = data ? Object.values(data).filter(d => d.status === 'pending') : [];

    if (items.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">Bekleyen BEP-20 yatırma bildirimi yok.</div>`;
      return;
    }

    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-4 rounded-2xl bg-mineora-bg border border-emerald-500/40 flex flex-wrap items-center justify-between gap-4 text-xs shadow-lg";
      card.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center gap-3">
            <strong class="text-white text-base font-bold">${d.username}</strong>
            <span class="text-emerald-400 font-mono font-black text-base">+$${d.amount.toFixed(2)} USDT</span>
          </div>
          <div class="text-slate-300 font-mono text-xs flex items-center gap-2">
            <span>TxID:</span>
            <span class="text-cyan-300 select-all">${d.txid}</span>
            <button type="button" onclick="navigator.clipboard.writeText('${d.txid}'); showToast('TxID kopyalandı!', 'success');" class="text-slate-400 hover:text-white cursor-pointer"><i class="fa-solid fa-copy"></i></button>
          </div>
          <span class="text-[10px] text-slate-500 font-mono">${d.date}</span>
        </div>
        <div class="flex gap-2">
          <button type="button" onclick="approveDepositOrder('${d.id}', '${d.username}', ${d.amount}); renderExpandedDeposits();" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer shadow-lg">
            Onayla & Yükle
          </button>
          <button type="button" onclick="rejectDepositOrder('${d.id}'); renderExpandedDeposits();" class="px-4 py-2.5 rounded-xl bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs cursor-pointer">
            Reddet
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}

function renderExpandedWithdrawals() {
  const container = document.getElementById('expanded-queue-container');
  if (!container || !fbDb) return;

  fbDb.ref('withdrawalQueue').once('value').then(snap => {
    const data = snap.val();
    container.innerHTML = "";
    const items = data ? Object.values(data).filter(d => d.status === 'pending') : [];

    if (items.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">Bekleyen USDT çekim talebi yok.</div>`;
      return;
    }

    items.forEach(d => {
      const card = document.createElement('div');
      card.className = "p-4 rounded-2xl bg-mineora-bg border border-amber-500/40 flex flex-col gap-3 text-xs shadow-lg";
      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-mineora-border/60 pb-2">
          <div class="flex items-center gap-3">
            <strong class="text-white text-base">${d.username}</strong>
            <span class="text-amber-400 font-mono font-black text-base">-$${d.amount.toFixed(2)} USDT</span>
          </div>
          <span class="text-slate-400 font-mono text-xs">${d.date}</span>
        </div>

        <div class="flex items-center justify-between gap-3 bg-mineora-card p-3 rounded-xl border border-mineora-border">
          <div class="flex items-center gap-2 overflow-hidden">
            <i class="fa-solid fa-wallet text-cyan-400 text-base"></i>
            <span class="text-cyan-300 font-mono text-xs select-all truncate">${d.targetAddress}</span>
          </div>
          <button type="button" onclick="navigator.clipboard.writeText('${d.targetAddress}'); showToast('📋 Cüzdan adresi kopyalandı!', 'success');" class="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold cursor-pointer shrink-0 flex items-center gap-1.5 shadow">
            <i class="fa-solid fa-copy"></i> Adresi Kopyala
          </button>
        </div>

        <div class="flex gap-2 justify-end pt-1">
          <button type="button" onclick="rejectWithdrawalOrder('${d.id}', '${d.username}', ${d.amount}); renderExpandedWithdrawals();" class="px-4 py-2 rounded-xl bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs cursor-pointer">
            İade Et (İptal)
          </button>
          <button type="button" onclick="approveWithdrawalOrder('${d.id}', '${d.username}', ${d.amount}); renderExpandedWithdrawals();" class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs cursor-pointer shadow-lg">
            Gönderildi Olarak Kapat
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  });
}

function renderExpandedContactMessages(cachedMessages = null) {
  const container = document.getElementById('expanded-queue-container');
  if (!container || !fbDb) return;

  const displayList = (messages) => {
    container.innerHTML = "";
    if (!messages || messages.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 text-sm">Gelen bir ziyaretçi veya destek mesajı yok.</div>`;
      return;
    }

    messages.forEach(m => {
      const card = document.createElement('div');
      card.className = "p-4 rounded-2xl bg-mineora-bg border border-cyan-500/30 flex flex-col gap-3 text-xs shadow-lg";
      card.innerHTML = `
        <div class="flex flex-wrap items-center justify-between border-b border-mineora-border/60 pb-2">
          <div class="flex items-center gap-2">
            <strong class="text-white text-sm font-bold">${m.name}</strong>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${m.isRegistered ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}">
              ${m.isRegistered ? 'Kayıtlı Üye' : 'Ziyaretçi'}
            </span>
            <span class="text-cyan-400 font-mono text-xs ml-2"><i class="fa-solid fa-address-book mr-1"></i>${m.reach}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-slate-500 font-mono text-[11px]">${m.dateStr || ''}</span>
            <button type="button" onclick="deleteAdminContactMessage('${m.id}')" class="px-3 py-1 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white transition cursor-pointer text-xs font-bold">
              <i class="fa-solid fa-trash-can mr-1"></i> Sil
            </button>
          </div>
        </div>
        <p class="text-slate-200 text-xs leading-relaxed break-words whitespace-pre-wrap bg-mineora-card p-3 rounded-xl border border-mineora-border/60">${m.message}</p>
      `;
      container.appendChild(card);
    });
  };

  if (cachedMessages) {
    displayList(cachedMessages);
  } else {
    fbDb.ref('contactMessages').once('value').then(snap => {
      const data = snap.val();
      const messages = data ? Object.values(data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
      displayList(messages);
    });
  }
}

window.openAdminUserLogsModal = function(username) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const u = getStoredUser(username);
  if (!u) {
    showToast("⚠️ Kullanıcı bulunamadı!", "warning");
    return;
  }

  document.getElementById('audit-target-username').innerText = u.username;
  const cardsContainer = document.getElementById('audit-summary-cards');
  const alertBar = document.getElementById('audit-alert-bar');
  const tbody = document.getElementById('audit-logs-table-body');
  const countEl = document.getElementById('audit-log-count');

  const logs = Array.isArray(u.logs) ? u.logs : [];
  if (countEl) countEl.innerText = logs.length;

  let totalMinedOra = 0;
  let totalCommissionOra = 0;
  let totalSpentOra = 0;
  let loggedInUsdt = 0;
  let loggedOutUsdt = 0;

  logs.forEach(l => {
    const txt = (l.amountText || "").toString();
    const m = txt.match(/[\d\.]+/);
    const val = m ? parseFloat(m[0]) : 0;
    const desc = ((l.title || "") + " " + (l.desc || "")).toLowerCase();

    if (txt.includes('ORA')) {
      if (txt.startsWith('+')) {
        if (desc.includes('maden') || desc.includes('vardiya')) totalMinedOra += val;
        else if (desc.includes('referans') || desc.includes('komisyon')) totalCommissionOra += val;
      } else if (txt.startsWith('-')) {
        totalSpentOra += val;
      }
    } else if (txt.includes('USDT') || txt.includes('$')) {
      if (txt.startsWith('+')) loggedInUsdt += val;
      if (txt.startsWith('-')) loggedOutUsdt += val;
    }
  });

  const curOra = Number(parseFloat(u.ora || 0).toFixed(2));
  const curUsdt = Number(parseFloat(u.usdt || 0).toFixed(2));
  const netLoggedOra = Number((totalMinedOra + totalCommissionOra - totalSpentOra).toFixed(2));
  const netLoggedUsdt = Number((loggedInUsdt - loggedOutUsdt).toFixed(2));

  const oraDiscrepancy = Number((curOra - netLoggedOra).toFixed(2));
  const usdtDiscrepancy = Number((curUsdt - netLoggedUsdt).toFixed(2));
  const hasLeak = (oraDiscrepancy > 10 || usdtDiscrepancy > 5);

  cardsContainer.innerHTML = '<div class="p-3 rounded-2xl bg-mineora-bg border border-mineora-border">'
    + '<span class="text-[10px] text-slate-400 block font-bold">MEVCUT CÜZDAN</span>'
    + '<strong class="text-mineora-gold text-sm block">' + curOra + ' ORA</strong>'
    + '<strong class="text-mineora-green text-xs">$' + curUsdt + ' USDT</strong>'
    + '</div>'
    + '<div class="p-3 rounded-2xl bg-mineora-bg border border-emerald-500/30">'
    + '<span class="text-[10px] text-slate-400 block font-bold">MEŞRU ÜRETİM (LOG)</span>'
    + '<strong class="text-emerald-400 text-sm block">+' + totalMinedOra.toFixed(2) + ' Kazı</strong>'
    + '<span class="text-[10px] text-cyan-300">+' + totalCommissionOra.toFixed(2) + ' Ref Geliri</span>'
    + '</div>'
    + '<div class="p-3 rounded-2xl bg-mineora-bg border border-rose-500/30">'
    + '<span class="text-[10px] text-slate-400 block font-bold">HARCANAN / ÇIKAN</span>'
    + '<strong class="text-rose-400 text-sm block">-' + totalSpentOra.toFixed(2) + ' ORA</strong>'
    + '<span class="text-[10px] text-slate-400">Çekim: -$' + loggedOutUsdt.toFixed(2) + '</span>'
    + '</div>'
    + '<div class="p-3 rounded-2xl bg-mineora-bg border ' + (hasLeak ? 'border-rose-500 bg-rose-950/20' : 'border-emerald-500/30') + '">'
    + '<span class="text-[10px] text-slate-400 block font-bold">KAÇAK / FARK</span>'
    + '<strong class="' + (hasLeak ? 'text-rose-500 animate-pulse' : 'text-emerald-400') + ' text-sm block">' + (oraDiscrepancy > 0 ? '+' : '') + oraDiscrepancy + ' ORA</strong>'
    + '<strong class="' + (hasLeak ? 'text-rose-500' : 'text-emerald-400') + ' text-xs">' + (usdtDiscrepancy > 0 ? '+$' : '$') + usdtDiscrepancy + ' USDT</strong>'
    + '</div>';

  if (hasLeak) {
    alertBar.className = "p-3 rounded-2xl bg-rose-950/40 border border-rose-500 text-rose-300 flex items-center justify-between gap-3 text-xs";
    alertBar.innerHTML = '<div class="flex items-center gap-2">'
      + '<i class="fa-solid fa-triangle-exclamation text-base text-rose-400"></i>'
      + '<span><strong>Şüpheli Hesap:</strong> Cüzdanda log kaydı bulunmayan <strong>+' + oraDiscrepancy + ' ORA</strong> veya <strong>+$' + usdtDiscrepancy + ' USDT</strong> kaçak tespit edildi!</span>'
      + '</div>'
      + '<button type="button" onclick="correctTamperedUserBalance(\'' + u.username + '\', ' + netLoggedOra + ', ' + netLoggedUsdt + ')" class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer shadow whitespace-nowrap">'
      + 'Kaçak Bakiyeyi Düzelt & Eşitle</button>';
    alertBar.classList.remove('hidden');
  } else {
    alertBar.className = "p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2 text-xs";
    alertBar.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i> <span>Tüm işlemler log kayıtlarıyla birebir tutarlı. Hesap güvenli.</span>';
    alertBar.classList.remove('hidden');
  }

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-500">Bu kullanıcıya ait log kaydı bulunmuyor.</td></tr>';
  } else {
    tbody.innerHTML = logs.map(l => {
      const isPos = (l.amountText || "").startsWith('+');
      return '<tr class="hover:bg-mineora-bg/60 transition">'
        + '<td class="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">' + (l.date || '-') + ' ' + (l.time || '') + '</td>'
        + '<td class="py-2.5 px-3 font-bold text-white whitespace-nowrap">'
        + '<span class="px-2 py-0.5 rounded text-[9px] uppercase ' + (isPos ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30') + '">'
        + (l.type || 'işlem') + '</span></td>'
        + '<td class="py-2.5 px-3 text-slate-300"><strong>' + (l.title || '-') + '</strong>'
        + '<span class="text-slate-400 block text-[10px]">' + (l.desc || '') + '</span></td>'
        + '<td class="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap ' + (isPos ? 'text-emerald-400' : 'text-rose-400') + '">'
        + (l.amountText || '-') + '</td></tr>';
    }).join('');
  }

  openModal('modal-admin-user-logs');
};

window.correctTamperedUserBalance = function(username, targetOra, targetUsdt) {
  if (!CurrentUser || !CurrentUser.isRootAdmin) return;
  const ok = confirm("'" + username + "' adlı kullanıcının cüzdanındaki kaçak bakiyeyi silip, yalnızca meşru kazancı olan " + targetOra + " ORA ve $" + targetUsdt + " USDT seviyesine çekmek istiyor musunuz?");
  if (!ok) return;

  const u = getStoredUser(username);
  if (!u) return;

  u.ora = Math.max(0, targetOra);
  u.usdt = Math.max(0, targetUsdt);
  u.isVaultLocked = true;

  addUserNotificationLog(u, "Bakiye Düzeltmesi (Admin)", "Kayıtsız bakiye tespit edildiği için cüzdan meşru üretim seviyesine çekildi.", "-" + (u.ora - targetOra).toFixed(2) + " ORA", "alert");

  saveStoredUser(u);
  openAdminUserLogsModal(username);
  if (typeof renderAdminUserTable === 'function') renderAdminUserTable();
  showToast("✅ " + username + " hesabındaki kaçak bakiye temizlendi ve loglarla eşitlendi!", "success");
};