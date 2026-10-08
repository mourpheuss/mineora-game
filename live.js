// ================= 10. CANLI YAYIN, LİSANS, BİLET & BAHŞİŞ MOTORU (live.js) =================
let activeLiveRoom = null;
let localMediaStream = null;
let rtcPeerConnections = {};
let isCamActive = true;
let isMicActive = true;
let hasHandRaised = false;
let isGhostAdminMode = false;
let pendingPinRoomId = null;
let isRoomLeaving = false;

let roomsRefListener = null;
let activeRoomRefListener = null;
let chatRefListener = null;
let hostSignalingBound = false;

let silentAudioTrack = null;
function getSilentAudioTrack() {
  if (silentAudioTrack && silentAudioTrack.readyState === 'live') return silentAudioTrack;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    silentAudioTrack = dest.stream.getAudioTracks()[0];
    return silentAudioTrack;
  } catch(e) {
    return null;
  }
}

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ],
  bundlePolicy: "max-bundle",
  iceCandidatePoolSize: 10
};

function sanitizeFbKey(key) {
  if (!key) return "anon";
  return key.toLowerCase().replace(/[\.\#\$\/\[\]\s]/g, '_');
}

function unlockAllAudios() {
  document.querySelectorAll('audio').forEach(a => {
    a.muted = false;
    a.play().catch(() => {});
  });
  const unmuter = document.getElementById('live-unmute-overlay');
  if (unmuter) unmuter.remove();
}
document.addEventListener('click', unlockAllAudios);
document.addEventListener('touchstart', unlockAllAudios);

function creditAdminMasterVaultUsdt(amount) {
  const amt = Number(parseFloat(amount) || 0);
  if (amt <= 0) return;
  if (typeof AdminState !== 'undefined' && AdminState) {
    AdminState.masterVaultUsdt = Number(((AdminState.masterVaultUsdt || 0) + amt).toFixed(2));
    if (typeof saveAdminProtocolState === 'function') saveAdminProtocolState(AdminState);
  } else if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('adminState/masterVaultUsdt').transaction(cur => Number(((cur || 0) + amt).toFixed(2)));
  }
}

function creditUserUsdt(username, amount, logTitle, logDesc) {
  const amt = Number(parseFloat(amount) || 0);
  if (amt <= 0 || !username) return;
  const uKey = username.toLowerCase();

  if (CurrentUser && CurrentUser.username.toLowerCase() === uKey) {
    CurrentUser.usdt = Number(((CurrentUser.usdt || 0) + amt).toFixed(2));
    if (typeof addUserNotificationLog === 'function') {
      addUserNotificationLog(CurrentUser, logTitle, logDesc, `+$${amt.toFixed(2)} USDT`, "income");
    }
    saveUserWorld();
    updateHUD();
  } else if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`users/${uKey}`).once('value').then(snap => {
      const uData = snap.val();
      if (uData) {
        uData.usdt = Number(((uData.usdt || 0) + amt).toFixed(2));
        if (!uData.logs) uData.logs = [];
        uData.logs.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: logTitle,
          desc: logDesc,
          amountText: `+$${amt.toFixed(2)} USDT`,
          type: "income",
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toLocaleDateString('en-US'),
          read: false
        });
        fbDb.ref(`users/${uKey}`).set(uData);
      }
    });
  }
}

const INAPPROPRIATE_PATTERNS = [
  /amk/i, /aq/i, /sik/i, /siki/i, /siktir/i, /pic/i, /orospu/i, /yarrak/i, /tasak/i, /got/i,
  /ibne/i, /gotveren/i, /fahise/i, /pezevenk/i, /porn/i, /porno/i, /sex/i, /seks/i,
  /nsfw/i, /escort/i, /amcik/i, /dalyarak/i, /fuck/i, /bitch/i, /whore/i, /dick/i, /pussy/i
];

function sanitizeForProfanityCheck(text) {
  if (!text) return "";
  return text.toLowerCase().replace(/[\s\.\-_,\*\/\\\|@!#\$%^&()+=:;~`"']/g, '');
}

function checkInappropriateContent(rawText) {
  if (!rawText) return false;
  const normalized = sanitizeForProfanityCheck(rawText);
  return INAPPROPRIATE_PATTERNS.some(regex => regex.test(normalized) || regex.test(rawText.toLowerCase()));
}

function hasValidStreamLicense(userObj) {
  if (!userObj) return false;
  if (userObj.isRootAdmin) return true;
  const expires = userObj.streamLicenseExpiresAt || 0;
  return Date.now() < expires;
}

function openStreamLicenseModal() {
  const usdtLabel = document.getElementById('license-modal-usdt');
  if (usdtLabel && CurrentUser) {
    usdtLabel.innerText = `$${Number(CurrentUser.usdt || 0).toFixed(2)} USDT`;
  }
  openModal('modal-stream-license');
}
window.openStreamLicenseModal = openStreamLicenseModal;

function buyStreamLicense(days, costUsdt) {
  if (!CurrentUser) return;
  const myUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));

  if (myUsdt < costUsdt) {
    showToast(`⛔ Yetersiz Bakiye! ${days} günlük lisans için $${costUsdt} USDT gereklidir. Bakiyeniz: $${myUsdt.toFixed(2)} USDT`, "warning");
    return;
  }

  CurrentUser.usdt = Number((myUsdt - costUsdt).toFixed(2));
  const baseTime = (CurrentUser.streamLicenseExpiresAt && CurrentUser.streamLicenseExpiresAt > Date.now()) 
    ? CurrentUser.streamLicenseExpiresAt 
    : Date.now();

  CurrentUser.streamLicenseExpiresAt = baseTime + (days * 24 * 60 * 60 * 1000);
  creditAdminMasterVaultUsdt(costUsdt);

  if (typeof addUserNotificationLog === 'function') {
    addUserNotificationLog(CurrentUser, "Yayın Lisansı Alındı", `${days} günlük sınırsız canlı yayın lisansı aktif edildi.`, `-$${costUsdt.toFixed(2)} USDT`, "expense");
  }

  saveUserWorld();
  updateHUD();
  closeModal('modal-stream-license');

  const expiryDate = new Date(CurrentUser.streamLicenseExpiresAt).toLocaleDateString('tr-TR');
  showToast(`🎉 ${days} günlük canlı yayın lisansı aktif edildi! (Bitiş: ${expiryDate})`, "success");
}
window.buyStreamLicense = buyStreamLicense;

function initLiveRoomsLobby() {
  const lobbyView = document.getElementById('live-lobby-view');
  const activeView = document.getElementById('live-room-active-view');
  if (lobbyView) lobbyView.classList.remove('hidden');
  if (activeView) activeView.classList.add('hidden');

  renderLiveRoomsList();
  listenToLiveRooms();
}
window.initLiveRoomsLobby = initLiveRoomsLobby;

function listenToLiveRooms() {
  if (typeof fbDb !== 'undefined' && fbDb) {
    if (roomsRefListener) fbDb.ref('liveRooms').off('value', roomsRefListener);
    roomsRefListener = fbDb.ref('liveRooms').on('value', snapshot => {
      renderLiveRoomsList(snapshot.val());
    });
  }
}

function getRoleBadgeStyle(role) {
  if (role === "Holding Owner" || role === "Şirket Sahibi") {
    return { bg: "bg-purple-500/20 text-purple-300 border-purple-500/40", icon: "fa-building-wheat" };
  } else if (role === "Mine Owner" || role === "Maden Sahibi") {
    return { bg: "bg-amber-500/20 text-amber-300 border-amber-500/40", icon: "fa-mountain" };
  } else if (role === "Worker Miner" || role === "İşçi Madenci") {
    return { bg: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40", icon: "fa-person-digging" };
  } else {
    return { bg: "bg-slate-500/20 text-slate-300 border-slate-500/40", icon: "fa-user" };
  }
}

function getRotatingMockLiveRooms() {
  const block3h = Math.floor(Date.now() / (3 * 60 * 60 * 1000));
  const minuteFluctuation = Math.floor(Date.now() / (4 * 60 * 1000));

  const titlePoolA = [
    "VIP Maden Sahipleri: 120 Günlük Döngü Analizi",
    "Alp 4. Vardiya Holding Koordinasyon Brifingi",
    "Avrupa Madenciler Konseyi - Haftalık Kapanış",
    "Derin Damar Lojistik & Sevk Değerlendirmesi",
    "Goldpeak Tepe Damarı Genişletme Oturumu",
    "Cenevre Madencilik Ağı - Özel İstişare Masası"
  ];

  const titlePoolB = [
    "Holding Liderleri Gizli Meclisi (Yalnızca Davetliler)",
    "Kapalı Devre Filo Yönetimi & Ekip Stratejisi",
    "İsviçre Maden Konsorsiyumu Olağan Toplantısı",
    "Alp Kristalleri & Asansör Sevk Güvenliği",
    "Özel Fon & Holding Ortakları Oturumu",
    "2. Bölge Magmatik Hat Sevk İncelemesi"
  ];

  const titlePoolC = [
    "Maden Sahibi Özel Eğitim & Kasa Yönetimi",
    "Yatırımcı Masası: Küresel Emtia Standartları",
    "Alpha Mining Syndicate - Private Strategy",
    "Bölge Müfettişleri & Saha Operasyon Masası",
    "Derin Şaft Koordinasyon & Kurtarma Planı",
    "Holding İcra Kurulu: Gece Vardiyası Raporu"
  ];

  const title1 = titlePoolA[block3h % titlePoolA.length];
  const title2 = titlePoolB[(block3h + 2) % titlePoolB.length];
  const title3 = titlePoolC[(block3h + 4) % titlePoolC.length];

  const viewers1 = 22 + ((block3h * 5 + minuteFluctuation * 2) % 17);
  const viewers2 = 31 + ((block3h * 7 + minuteFluctuation * 3) % 21);
  const viewers3 = 14 + ((block3h * 3 + minuteFluctuation) % 12);

  return {
    "mock_room_vip_1": {
      id: "mock_room_vip_1",
      title: title1,
      host: "Vanguard_Holding",
      hostRole: "Holding Owner",
      ticketPrice: 5.00,
      hasPin: true,
      isMock: true,
      viewers: Object.fromEntries(Array.from({length: viewers1}, (_, i) => [`bot_v1_${i}`, true]))
    },
    "mock_room_vip_2": {
      id: "mock_room_vip_2",
      title: title2,
      host: "Alpine_Baron",
      hostRole: "Mine Owner",
      ticketPrice: 0,
      hasPin: true,
      isMock: true,
      viewers: Object.fromEntries(Array.from({length: viewers2}, (_, i) => [`bot_v2_${i}`, true]))
    },
    "mock_room_vip_3": {
      id: "mock_room_vip_3",
      title: title3,
      host: "Helvetia_Apex",
      hostRole: "Holding Owner",
      ticketPrice: 10.00,
      hasPin: true,
      isMock: true,
      viewers: Object.fromEntries(Array.from({length: viewers3}, (_, i) => [`bot_v3_${i}`, true]))
    }
  };
}

function renderLiveRoomsList(roomsData = null) {
  const grid = document.getElementById('live-rooms-grid');
  if (!grid) return;

  const renderRooms = (realRoomsObj) => {
    grid.innerHTML = "";
    const mockRooms = getRotatingMockLiveRooms();
    const allRooms = Object.assign({}, mockRooms, realRoomsObj || {});

    Object.keys(allRooms).forEach(roomId => {
      const room = allRooms[roomId];
      if (!room || !room.host) return;

      const isLocked = !!room.hasPin;
      const isTicketed = (room.ticketPrice && room.ticketPrice > 0);
      const isQuarantined = !!room.isQuarantined;
      const viewerCount = room.viewers ? Object.keys(room.viewers).length : 1;
      const badgeStyle = getRoleBadgeStyle(room.hostRole);

      const card = document.createElement('div');
      card.className = `p-5 rounded-3xl bg-mineora-card border ${isQuarantined ? 'border-rose-600/60 bg-rose-950/10' : 'border-mineora-border hover:border-rose-500/40'} transition shadow-xl flex flex-col justify-between space-y-4 group notranslate`;
      card.setAttribute('translate', 'no');
      card.innerHTML = `
        <div class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${isQuarantined ? 'bg-rose-600 text-white' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'} flex items-center gap-1.5 ${isQuarantined ? '' : 'animate-pulse'}">
              <span class="w-1.5 h-1.5 rounded-full ${isQuarantined ? 'bg-white' : 'bg-rose-500'}"></span> ${isQuarantined ? 'DONDURULDU' : 'CANLI'}
            </span>
            <div class="flex items-center gap-2 text-xs font-mono">
              ${isTicketed ? `<span class="px-2 py-0.5 rounded bg-emerald-500/15 text-mineora-green border border-emerald-500/30 text-[10px] font-bold"><i class="fa-solid fa-ticket mr-1"></i>$${Number(room.ticketPrice).toFixed(2)}</span>` : '<span class="text-slate-500 text-[10px]">Ücretsiz</span>'}
              ${isLocked ? '<i class="fa-solid fa-lock text-amber-400" title="Kilitli / VIP"></i>' : ''}
              <span class="flex items-center gap-1 text-slate-400"><i class="fa-solid fa-eye text-slate-500"></i> ${viewerCount}</span>
            </div>
          </div>
          <div>
            <h4 class="font-black text-white text-sm group-hover:text-rose-400 transition">${room.title}</h4>
            <div class="flex items-center gap-2 mt-1.5 text-[11px] font-mono">
              <span class="text-slate-200 font-bold">${room.host}</span>
              <span class="px-2 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 ${badgeStyle.bg}">
                <i class="fa-solid ${badgeStyle.icon}"></i> ${room.hostRole || 'Miner'}
              </span>
            </div>
          </div>
        </div>

        <button type="button" onclick="attemptJoinRoom('${roomId}')" class="w-full py-2.5 rounded-xl ${isTicketed ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'bg-mineora-input hover:bg-rose-600 hover:text-white text-slate-200'} font-black text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow">
          <i class="fa-solid fa-lock text-amber-400"></i> ${isTicketed ? `Biletli VIP Giriş ($${Number(room.ticketPrice).toFixed(2)})` : 'Kilitli Odaya Katıl'}
        </button>
      `;
      grid.appendChild(card);
    });
  };

  if (roomsData !== null && typeof roomsData === 'object') {
    renderRooms(roomsData);
  } else if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('liveRooms').once('value').then(snap => renderRooms(snap.val())).catch(() => renderRooms({}));
  } else {
    renderRooms({});
  }
}
window.renderLiveRoomsList = renderLiveRoomsList;

function openCreateRoomModal() {
  if (!CurrentUser) {
    showToast("⚠️ Canlı oda açmak için giriş yapmalısınız!", "warning");
    return;
  }

  if (!hasValidStreamLicense(CurrentUser)) {
    openStreamLicenseModal();
    showToast("ℹ️ Canlı yayın açabilmek için aktif bir yayın lisansına sahip olmalısınız.", "info");
    return;
  }

  openModal('modal-create-live-room');
}
window.openCreateRoomModal = openCreateRoomModal;

async function handleCreateLiveRoomSubmit() {
  if (!CurrentUser) return;

  if (!hasValidStreamLicense(CurrentUser)) {
    closeModal('modal-create-live-room');
    openStreamLicenseModal();
    return;
  }

  const titleInput = document.getElementById('new-room-title');
  const pinInput = document.getElementById('new-room-pin');
  const ticketInput = document.getElementById('new-room-ticket');

  const title = titleInput?.value.trim();
  const pin = pinInput?.value.trim();
  let ticketPrice = parseFloat(ticketInput?.value) || 0;

  if (!title || title.length < 3) {
    showToast("⚠️ En az 3 karakterli bir oda başlığı yazın!", "warning");
    return;
  }

  if (ticketPrice > 0) {
    if (ticketPrice < 1 || ticketPrice > 50) {
      showToast("⚠️ Biletli odalarda bilet ücreti minimum 1 USDT, maksimum 50 USDT olmalıdır!", "warning");
      return;
    }
  } else {
    ticketPrice = 0;
  }

  const hostSafeKey = sanitizeFbKey(CurrentUser.username);
  const roomId = `room_${hostSafeKey}_${Date.now()}`;

  const roomData = {
    id: roomId,
    title: title,
    host: CurrentUser.username,
    hostRole: CurrentUser.role || "Miner",
    ticketPrice: Number(ticketPrice.toFixed(2)),
    hasPin: !!pin,
    createdAt: Date.now(),
    isQuarantined: false,
    viewers: { [hostSafeKey]: true },
    speakers: { [hostSafeKey]: true },
    paidViewers: { [hostSafeKey]: true },
    banned: {}
  };
  if (pin) roomData.pin = pin;

  try {
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (err) {
    try {
      localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e2) {
      showToast("⚠️ Kamera/Mikrofon izni alınamadı.", "warning");
    }
  }

  if (typeof fbDb !== 'undefined' && fbDb) {
    const roomRef = fbDb.ref(`liveRooms/${roomId}`);
    await roomRef.set(roomData);
    roomRef.onDisconnect().remove();
  }

  closeModal('modal-create-live-room');
  if (titleInput) titleInput.value = "";
  if (pinInput) pinInput.value = "";
  if (ticketInput) ticketInput.value = "";

  enterRoomView(roomData, true);
  showToast(`🎉 '${title}' canlı yayın odası açıldı!`, "success");
}
window.handleCreateLiveRoomSubmit = handleCreateLiveRoomSubmit;

function attemptJoinRoom(roomId) {
  if (!CurrentUser) {
    showToast("⚠️ Odaya katılmak için giriş yapmalısınız!", "warning");
    return;
  }

  const mockRooms = (typeof getRotatingMockLiveRooms === 'function') ? getRotatingMockLiveRooms() : null;
  if (mockRooms && mockRooms[roomId]) {
    const mock = mockRooms[roomId];
    if (mock.hasPin) {
      showToast(`🔒 '${mock.title}' kapalı devre VIP Holding meclisidir. Yalnızca davetli holding sahipleri katılabilir.`, "info");
      return;
    }
  }

  const proceed = (room) => {
    if (!room) {
      showToast("⛔ Bu oda artık mevcut değil!", "warning");
      if (typeof renderLiveRoomsList === 'function') renderLiveRoomsList();
      return;
    }

    const mySafeKey = sanitizeFbKey(CurrentUser.username);
    if (room.banned && room.banned[mySafeKey]) {
      showToast("🚫 Bu odadan yayıncı tarafından engellendiniz!", "warning");
      return;
    }

    const isHost = (room.host || '').toLowerCase() === CurrentUser.username.toLowerCase();
    
    if (room.hasPin && !isHost) {
      pendingPinRoomId = roomId;
      openModal('modal-room-pin-prompt');
      return;
    }

    checkTicketAndJoin(room);
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${roomId}`).once('value').then(snap => proceed(snap.val())).catch(() => proceed(null));
  } else {
    proceed(null);
  }
}
window.attemptJoinRoom = attemptJoinRoom;

function submitRoomPinCheck() {
  const pinEntered = document.getElementById('input-room-pin')?.value.trim();
  if (!pendingPinRoomId) return;

  fbDb.ref(`liveRooms/${pendingPinRoomId}`).once('value').then(snap => {
    const room = snap.val();
    if (room && room.pin === pinEntered) {
      closeModal('modal-room-pin-prompt');
      checkTicketAndJoin(room);
    } else {
      showToast("❌ Hatalı oda şifresi!", "warning");
    }
  });
}
window.submitRoomPinCheck = submitRoomPinCheck;

async function checkTicketAndJoin(room) {
  const isHost = (room.host || '').trim().toLowerCase() === (CurrentUser.username || '').trim().toLowerCase();
  const isRoot = !!CurrentUser.isRootAdmin;
  const mySafeKey = sanitizeFbKey(CurrentUser.username);
  const ticketPrice = Number(parseFloat(room.ticketPrice) || 0);

  if (isHost || isRoot || ticketPrice <= 0) {
    executeJoinRoom(room);
    return;
  }

  const alreadyPaid = room.paidViewers && room.paidViewers[mySafeKey];
  if (alreadyPaid) {
    executeJoinRoom(room);
    return;
  }

  const myUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));
  if (myUsdt < ticketPrice) {
    showToast(`⛔ Yetersiz Bakiye! Giriş bilet ücreti: $${ticketPrice.toFixed(2)} USDT. Cüzdanınız: $${myUsdt.toFixed(2)} USDT`, "warning");
    return;
  }

  const ok = confirm(`🎟️ '${room.title}' yayını biletlidir.\nBilet Ücreti: $${ticketPrice.toFixed(2)} USDT\n\nBakiyenizden tahsil edilerek odaya katılmak istiyor musunuz?`);
  if (!ok) return;

  CurrentUser.usdt = Number((myUsdt - ticketPrice).toFixed(2));
  saveUserWorld();
  updateHUD();

  const hostShare = Number((ticketPrice * 0.70).toFixed(2));
  const vaultShare = Number((ticketPrice - hostShare).toFixed(2));

  creditUserUsdt(room.host, hostShare, "Canlı Yayın Bilet Geliri", `${CurrentUser.username} yayına biletle katıldı (%70 pay).`);
  creditAdminMasterVaultUsdt(vaultShare);

  if (typeof addUserNotificationLog === 'function') {
    addUserNotificationLog(CurrentUser, "Yayın Bileti Alındı", `${room.title} yayınına bilet ödendi.`, `-$${ticketPrice.toFixed(2)} USDT`, "expense");
  }

  if (typeof fbDb !== 'undefined' && fbDb) {
    await fbDb.ref(`liveRooms/${room.id}/paidViewers/${mySafeKey}`).set(true);
  }

  showToast(`🎟️ $${ticketPrice.toFixed(2)} USDT bilet ödendi. Yayına bağlanılıyor...`, "success");
  executeJoinRoom(room);
}

function executeJoinRoom(room) {
  const isHost = (room.host || '').toLowerCase() === CurrentUser.username.toLowerCase();
  const uSafeKey = sanitizeFbKey(CurrentUser.username);

  if (typeof fbDb !== 'undefined' && fbDb && !isHost) {
    fbDb.ref(`liveRooms/${room.id}/viewers/${uSafeKey}`).set(true);
    fbDb.ref(`liveRooms/${room.id}/viewers/${uSafeKey}`).onDisconnect().remove();
  }

  enterRoomView(room, isHost);
}

function openSendTipModal() {
  if (!activeLiveRoom || !CurrentUser) return;
  const isHost = (activeLiveRoom.host || '').trim().toLowerCase() === (CurrentUser.username || '').trim().toLowerCase();
  if (isHost) {
    showToast("⚠️ Kendi yayınınıza bahşiş gönderemezsiniz.", "warning");
    return;
  }
  const inputEl = document.getElementById('input-tip-amount');
  if (inputEl) inputEl.value = "5";
  calculateTipBreakdown();
  openModal('modal-send-tip');
}
window.openSendTipModal = openSendTipModal;

function calculateTipBreakdown() {
  const inputEl = document.getElementById('input-tip-amount');
  const hostEl = document.getElementById('tip-preview-host');
  const vaultEl = document.getElementById('tip-preview-vault');
  const amt = parseFloat(inputEl?.value) || 0;

  const vaultShare = Number((amt * 0.02).toFixed(2));
  const hostShare = Number((amt - vaultShare).toFixed(2));

  if (hostEl) hostEl.innerText = `$${hostShare.toFixed(2)} USDT`;
  if (vaultEl) vaultEl.innerText = `$${vaultShare.toFixed(2)} USDT`;
}
window.calculateTipBreakdown = calculateTipBreakdown;

function executeSendTip() {
  if (!activeLiveRoom || !CurrentUser) return;
  const amt = parseFloat(document.getElementById('input-tip-amount')?.value);
  const myUsdt = Number(parseFloat(CurrentUser.usdt || 0).toFixed(2));

  if (isNaN(amt) || amt < 3 || amt > 100) {
    showToast("⚠️ Bahşiş miktarı minimum 3 USDT, maksimum 100 USDT olmalıdır!", "warning");
    return;
  }

  if (myUsdt < amt) {
    showToast(`⛔ Yetersiz Bakiye! Bahşiş için $${amt.toFixed(2)} USDT gereklidir. Bakiyeniz: $${myUsdt.toFixed(2)} USDT`, "warning");
    return;
  }

  CurrentUser.usdt = Number((myUsdt - amt).toFixed(2));
  saveUserWorld();
  updateHUD();

  const vaultShare = Number((amt * 0.02).toFixed(2));
  const hostShare = Number((amt - vaultShare).toFixed(2));

  creditUserUsdt(activeLiveRoom.host, hostShare, "Canlı Yayın Bahşişi", `${CurrentUser.username} size $${amt.toFixed(2)} USDT bahşiş gönderdi (%98 pay).`);
  creditAdminMasterVaultUsdt(vaultShare);

  if (typeof addUserNotificationLog === 'function') {
    addUserNotificationLog(CurrentUser, "Bahşiş Gönderildi", `${activeLiveRoom.host} adlı yayıncıya $${amt.toFixed(2)} USDT bahşiş yollandı (%2 kurucu protokol kesintisi uygulandı).`, `-$${amt.toFixed(2)} USDT`, "expense");
  }

  const tipMsgData = {
    id: `tip_${Date.now()}`,
    sender: "SİSTEM",
    role: "MINEORA",
    text: `🎁 ${CurrentUser.username}, yayıncıya $${amt.toFixed(2)} USDT bahşiş gönderdi! (Yayıncı Payı: $${hostShare.toFixed(2)} USDT)`,
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/chat`).push(tipMsgData);
  }

  closeModal('modal-send-tip');
  showToast(`🎁 $${amt.toFixed(2)} USDT bahşiş gönderildi! (Kurucu payı: $${vaultShare.toFixed(2)} USDT, Yayıncı: $${hostShare.toFixed(2)} USDT)`, "success");
}
window.executeSendTip = executeSendTip;

function enterRoomView(room, isHost) {
  activeLiveRoom = room;
  hasHandRaised = false;
  isRoomLeaving = false;

  document.getElementById('live-lobby-view')?.classList.add('hidden');
  document.getElementById('live-room-active-view')?.classList.remove('hidden');

  document.getElementById('current-room-title').innerText = room.title;
  document.getElementById('current-room-host').innerText = `Yayıncı: ${room.host}`;

  const hostBadge = document.getElementById('live-host-badge-name');
  if (hostBadge) {
    const badgeStyle = getRoleBadgeStyle(room.hostRole);
    hostBadge.innerHTML = `${room.host} <span class="px-1.5 py-0.2 rounded text-[9px] border font-mono ${badgeStyle.bg}">${room.hostRole || 'Miner'}</span>`;
  }

  const hostCtrl = document.getElementById('host-controls');
  const viewerCtrl = document.getElementById('viewer-controls');
  const hostReqBtn = document.getElementById('host-requests-btn-container');

  if (hostCtrl) hostCtrl.classList.toggle('hidden', !isHost);
  if (hostReqBtn) hostReqBtn.classList.toggle('hidden', !isHost);
  if (viewerCtrl) viewerCtrl.classList.toggle('hidden', isHost);

  const videoEl = document.getElementById('live-host-video');
  const placeholderEl = document.getElementById('live-video-placeholder');

  let remoteAudioEl = document.getElementById('live-remote-host-audio');
  if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.id = 'live-remote-host-audio';
    remoteAudioEl.autoplay = true;
    remoteAudioEl.playsInline = true;
    document.body.appendChild(remoteAudioEl);
  }

  if (isHost && localMediaStream) {
    if (videoEl) {
      videoEl.srcObject = localMediaStream;
      videoEl.muted = true;
      videoEl.play().catch(() => {});
    }
    if (placeholderEl) placeholderEl.classList.add('hidden');
  } else {
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.muted = true;
    }
    if (placeholderEl) placeholderEl.classList.remove('hidden');
  }

  bindActiveRoomListeners(room.id, isHost);
  initRoomChat(room.id);

  if (!isHost) {
    initViewerWebRTC(room.id);
  } else {
    listenToIncomingViewerSignalsOnce(room.id);
  }
}

function leaveCurrentRoom() {
  if (isRoomLeaving) return;
  isRoomLeaving = true;

  const roomToLeave = activeLiveRoom;
  activeLiveRoom = null;

  document.getElementById('live-room-active-view')?.classList.add('hidden');
  document.getElementById('live-lobby-view')?.classList.remove('hidden');

  if (localMediaStream) {
    try { localMediaStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    localMediaStream = null;
  }

  document.querySelectorAll('audio[id^="speaker-audio-"]').forEach(el => el.remove());
  const rAudio = document.getElementById('live-remote-host-audio');
  if (rAudio) { rAudio.srcObject = null; rAudio.remove(); }

  const videoEl = document.getElementById('live-host-video');
  if (videoEl) videoEl.srcObject = null;

  Object.keys(rtcPeerConnections).forEach(k => {
    try { rtcPeerConnections[k].close(); } catch(e) {}
  });
  rtcPeerConnections = {};
  hostSignalingBound = false;

  if (roomToLeave && typeof fbDb !== 'undefined' && fbDb && CurrentUser) {
    const isHost = (roomToLeave.host || '').trim().toLowerCase() === (CurrentUser.username || '').trim().toLowerCase();
    const uSafeKey = sanitizeFbKey(CurrentUser.username);

    if (activeRoomRefListener) {
      fbDb.ref(`liveRooms/${roomToLeave.id}`).off('value', activeRoomRefListener);
      activeRoomRefListener = null;
    }
    if (chatRefListener) {
      fbDb.ref(`liveRooms/${roomToLeave.id}/chat`).off('child_added', chatRefListener);
      chatRefListener = null;
    }

    if (isHost) {
      fbDb.ref(`liveRooms/${roomToLeave.id}`).remove();
    } else {
      fbDb.ref(`liveRooms/${roomToLeave.id}/viewers/${uSafeKey}`).remove();
      fbDb.ref(`liveRooms/${roomToLeave.id}/speakers/${uSafeKey}`).remove();
      fbDb.ref(`liveRooms/${roomToLeave.id}/handRaises/${uSafeKey}`).remove();
      fbDb.ref(`liveRooms/${roomToLeave.id}/signaling/${uSafeKey}`).remove();
    }
  }

  initLiveRoomsLobby();
  showToast("Yayından çıkıldı.", "info");
}
window.leaveCurrentRoom = leaveCurrentRoom;

function listenToIncomingViewerSignalsOnce(roomId) {
  if (hostSignalingBound || !fbDb || !CurrentUser) return;
  hostSignalingBound = true;

  const signalingRef = fbDb.ref(`liveRooms/${roomId}/signaling`);

  signalingRef.on('child_added', viewerNodeSnap => {
    const viewerSafeKey = viewerNodeSnap.key;
    let candidateQueue = [];

    viewerNodeSnap.ref.child('offer').on('value', async offerSnap => {
      const offer = offerSnap.val();
      if (!offer) return;

      if (rtcPeerConnections[viewerSafeKey]) {
        try { rtcPeerConnections[viewerSafeKey].close(); } catch(e) {}
      }

      const pc = new RTCPeerConnection(rtcConfig);
      rtcPeerConnections[viewerSafeKey] = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          viewerNodeSnap.ref.child('hostCandidates').push(event.candidate.toJSON());
        }
      };

      pc.ontrack = (event) => {
        if (event.track && event.track.kind === 'audio') {
          let audioEl = document.getElementById(`speaker-audio-${viewerSafeKey}`);
          if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `speaker-audio-${viewerSafeKey}`;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            document.body.appendChild(audioEl);
          }
          audioEl.srcObject = new MediaStream([event.track]);
          audioEl.play().catch(() => {});
        }
      };

      viewerNodeSnap.ref.child('viewerCandidates').on('child_added', async cSnap => {
        const c = cSnap.val();
        if (c) {
          if (!pc.remoteDescription) {
            candidateQueue.push(c);
          } else {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
        }
      });

      if (localMediaStream) {
        localMediaStream.getTracks().forEach(track => {
          pc.addTrack(track, localMediaStream);
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const cand of candidateQueue) {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
      candidateQueue = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await viewerNodeSnap.ref.child('answer').set({
        sdp: answer.sdp,
        type: answer.type
      });
    });
  });
}

async function initViewerWebRTC(roomId) {
  if (!fbDb || !CurrentUser) return;
  const mySafeKey = sanitizeFbKey(CurrentUser.username);

  if (rtcPeerConnections[mySafeKey]) {
    try { rtcPeerConnections[mySafeKey].close(); } catch(e) {}
  }

  const pc = new RTCPeerConnection(rtcConfig);
  rtcPeerConnections[mySafeKey] = pc;

  const mySigRef = fbDb.ref(`liveRooms/${roomId}/signaling/${mySafeKey}`);
  await mySigRef.remove();

  let candidateQueue = [];
  const videoEl = document.getElementById('live-host-video');
  const placeholderEl = document.getElementById('live-video-placeholder');
  const remoteAudioEl = document.getElementById('live-remote-host-audio');

  pc.ontrack = (event) => {
    if (event.track.kind === 'video') {
      if (videoEl) {
        videoEl.srcObject = new MediaStream([event.track]);
        videoEl.play().catch(() => {});
      }
      if (placeholderEl) placeholderEl.classList.add('hidden');
    } else if (event.track.kind === 'audio') {
      if (remoteAudioEl) {
        remoteAudioEl.srcObject = new MediaStream([event.track]);
        remoteAudioEl.muted = false;
        remoteAudioEl.play().catch(() => {
          if (!document.getElementById('live-unmute-overlay')) {
            const btn = document.createElement('button');
            btn.id = 'live-unmute-overlay';
            btn.className = 'absolute top-4 right-4 z-50 px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-black shadow-2xl animate-bounce cursor-pointer flex items-center gap-1.5';
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Sesi Aç';
            btn.onclick = (e) => {
              e.stopPropagation();
              unlockAllAudios();
            };
            document.getElementById('live-room-active-view')?.appendChild(btn);
          }
        });
      }
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      mySigRef.child('viewerCandidates').push(event.candidate.toJSON());
    }
  };

  const dummyTrack = getSilentAudioTrack();
  if (dummyTrack) {
    pc.addTrack(dummyTrack, new MediaStream([dummyTrack]));
  }
  pc.addTransceiver('video', { direction: 'recvonly' });

  mySigRef.child('hostCandidates').on('child_added', async snap => {
    const cand = snap.val();
    if (cand) {
      if (!pc.remoteDescription) {
        candidateQueue.push(cand);
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await mySigRef.child('offer').set({
    sdp: offer.sdp,
    type: offer.type
  });

  mySigRef.child('answer').on('value', async snap => {
    const answer = snap.val();
    if (answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      for (const c of candidateQueue) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      candidateQueue = [];
    }
  });
}

async function toggleRaiseHand() {
  if (!activeLiveRoom || !CurrentUser) return;
  hasHandRaised = !hasHandRaised;
  unlockAllAudios();

  const btnText = document.getElementById('raise-hand-text');
  const btn = document.getElementById('btn-raise-hand');
  const uSafeKey = sanitizeFbKey(CurrentUser.username);

  if (hasHandRaised) {
    if (!localMediaStream) {
      try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        localMediaStream.getAudioTracks().forEach(t => t.enabled = false);
      } catch (err) {
        hasHandRaised = false;
        showToast("⚠️ Mikrofon izni vermeden söz isteyemezsiniz.", "warning");
        return;
      }
    }

    if (btnText) btnText.innerText = "İsteği Geri Çek";
    if (btn) btn.className = "px-4 py-2 rounded-xl bg-amber-600 text-white font-black flex items-center gap-2 cursor-pointer shadow-lg";

    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${uSafeKey}`).set({
        username: CurrentUser.username,
        role: CurrentUser.role || "Candidate",
        time: Date.now()
      });
    }
    showToast("✋ Söz hakkı istendi. Yayıncının onayı bekleniyor.", "info");
  } else {
    if (btnText) btnText.innerText = "Söz İste (El Kaldır)";
    if (btn) btn.className = "px-4 py-2 rounded-xl bg-mineora-gold text-black font-black flex items-center gap-2 cursor-pointer shadow-lg";

    if (localMediaStream) {
      localMediaStream.getTracks().forEach(t => t.stop());
      localMediaStream = null;
    }

    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${uSafeKey}`).remove();
    }
  }
}
window.toggleRaiseHand = toggleRaiseHand;

async function checkSpeakerStatus(speakersObj) {
  if (!CurrentUser || !activeLiveRoom) return;
  const isHost = (activeLiveRoom.host || '').trim().toLowerCase() === (CurrentUser.username || '').trim().toLowerCase();
  if (isHost) return;

  const uSafeKey = sanitizeFbKey(CurrentUser.username);
  const isSpeakerNow = !!speakersObj[uSafeKey];
  const pc = rtcPeerConnections[uSafeKey];

  if (isSpeakerNow) {
    if (!localMediaStream) {
      try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch(e) {
        showToast("⚠️ Mikrofon açılamadı.", "warning");
        return;
      }
    }

    localMediaStream.getAudioTracks().forEach(t => t.enabled = true);

    if (pc && localMediaStream.getAudioTracks().length > 0) {
      const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (audioSender) {
        await audioSender.replaceTrack(localMediaStream.getAudioTracks()[0]);
      }
    }
    showToast("🎙️ Söz verildi! Mikrofonunuz yayında!", "success");
  } else if (!isSpeakerNow && localMediaStream) {
    if (pc) {
      const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      const dummy = getSilentAudioTrack();
      if (audioSender && dummy) {
        await audioSender.replaceTrack(dummy);
      }
    }
    localMediaStream.getTracks().forEach(t => t.stop());
    localMediaStream = null;
    showToast("🛑 Söz hakkınız sona erdi.", "info");
  }
}

function openSpeakerRequestsModal() {
  openModal('modal-speaker-requests');
}
window.openSpeakerRequestsModal = openSpeakerRequestsModal;

function renderSpeakerRequestsList(raisesObj) {
  const container = document.getElementById('speaker-requests-list');
  if (!container) return;
  container.innerHTML = "";

  const entries = Object.keys(raisesObj).map(key => ({
    safeKey: key,
    username: raisesObj[key].username || key,
    role: raisesObj[key].role || "Candidate"
  }));

  if (entries.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-slate-500 text-xs notranslate" translate="no">Şu an söz isteyen yok.</div>`;
    return;
  }

  entries.forEach(item => {
    const badgeStyle = getRoleBadgeStyle(item.role);
    const row = document.createElement('div');
    row.className = 'p-3 rounded-2xl border flex items-center justify-between text-xs bg-mineora-bg border-mineora-border notranslate';
    row.setAttribute('translate', 'no');
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-hand text-amber-400"></i>
        <strong class="text-white">${item.username}</strong>
        <span class="px-1.5 py-0.5 rounded text-[9px] border font-mono ${badgeStyle.bg}">${item.role}</span>
      </div>
      <div class="flex gap-2">
        <button type="button" onclick="approveSpeakerRequest('${item.username}')" class="px-3 py-1.5 rounded-xl bg-mineora-green text-white font-bold cursor-pointer">Söz Ver</button>
        <button type="button" onclick="rejectSpeakerRequest('${item.username}')" class="px-3 py-1.5 rounded-xl bg-mineora-input text-slate-300 cursor-pointer">Reddet</button>
      </div>
    `;
    container.appendChild(row);
  });
}

function approveSpeakerRequest(uname) {
  if (!activeLiveRoom || !fbDb) return;
  unlockAllAudios();
  const safe = sanitizeFbKey(uname);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/speakers/${safe}`).set(true);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${safe}`).remove();
  showToast(`🎤 ${uname} sahneye eklendi!`, "success");
}
window.approveSpeakerRequest = approveSpeakerRequest;

function rejectSpeakerRequest(uname) {
  if (!activeLiveRoom || !fbDb) return;
  const safe = sanitizeFbKey(uname);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${safe}`).remove();
}
window.rejectSpeakerRequest = rejectSpeakerRequest;

function revokeSpeakerPermission(uname) {
  if (!activeLiveRoom || !fbDb) return;
  const safe = sanitizeFbKey(uname);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/speakers/${safe}`).remove();
  showToast(`🛑 ${uname} söz hakkı alındı.`, "info");
}
window.revokeSpeakerPermission = revokeSpeakerPermission;

function kickAndBanUserFromRoom(username) {
  if (!activeLiveRoom || !fbDb || !CurrentUser) return;
  const isHost = (activeLiveRoom.host || '').trim().toLowerCase() === (CurrentUser.username || '').trim().toLowerCase();
  if (!isHost) return;

  const targetSafe = sanitizeFbKey(username);
  if (targetSafe === sanitizeFbKey(CurrentUser.username)) {
    showToast("⚠️ Kendi hesabınızı banlayamazsınız!", "warning");
    return;
  }

  const ok = confirm(`'${username}' adlı kullanıcıyı yayından atmak ve odaya tekrar girişini engellemek istiyor musunuz?`);
  if (!ok) return;

  fbDb.ref(`liveRooms/${activeLiveRoom.id}/banned/${targetSafe}`).set(true);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/viewers/${targetSafe}`).remove();
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/speakers/${targetSafe}`).remove();
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${targetSafe}`).remove();
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/signaling/${targetSafe}`).remove();

  showToast(`🚫 ${username} odadan atıldı ve engellendi!`, "warning");
}
window.kickAndBanUserFromRoom = kickAndBanUserFromRoom;

function renderStageSpeakers(speakersObj) {
  const container = document.getElementById('stage-speakers-list');
  const countEl = document.getElementById('stage-speakers-count');
  if (!container) return;
  container.innerHTML = "";

  const speakers = Object.keys(speakersObj);
  if (countEl) countEl.innerText = `${speakers.length} Konuşmacı`;

  speakers.forEach(uname => {
    const isHost = activeLiveRoom && (activeLiveRoom.host || '').trim().toLowerCase() === (CurrentUser?.username || '').trim().toLowerCase();
    const isThisUserHost = activeLiveRoom && (activeLiveRoom.host || '').trim().toLowerCase() === uname.trim().toLowerCase();

    const badge = document.createElement('div');
    badge.className = "flex items-center gap-2 px-3 py-1.5 rounded-xl bg-mineora-bg border border-mineora-border text-xs text-slate-200 font-bold shadow notranslate";
    badge.setAttribute('translate', 'no');
    badge.innerHTML = `
      <i class="fa-solid fa-microphone text-emerald-400 text-xs animate-pulse"></i>
      <span class="text-white">${uname}</span>
      ${(isHost && !isThisUserHost) ? `
        <button type="button" onclick="revokeSpeakerPermission('${uname}')" class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[10px] font-bold cursor-pointer" title="Sözü Geri Al">
          Sözü Al
        </button>
        <button type="button" onclick="kickAndBanUserFromRoom('${uname}')" class="px-2 py-0.5 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 text-[10px] font-bold cursor-pointer" title="Odadan At & Banla">
          At
        </button>
      ` : ''}
    `;
    container.appendChild(badge);
  });
}

function bindActiveRoomListeners(roomId, isHost) {
  if (!fbDb) return;
  if (activeRoomRefListener) fbDb.ref(`liveRooms/${roomId}`).off('value', activeRoomRefListener);

  activeRoomRefListener = fbDb.ref(`liveRooms/${roomId}`).on('value', snapshot => {
    const data = snapshot.val();
    
    if (!data) {
      if (activeLiveRoom && !isHost) {
        showToast("📢 Yayıncı canlı yayını sonlandırdı.", "info");
        leaveCurrentRoom();
      }
      return;
    }

    if (!isHost && CurrentUser) {
      const mySafeKey = sanitizeFbKey(CurrentUser.username);
      if (data.banned && data.banned[mySafeKey]) {
        leaveCurrentRoom();
        showToast("🚫 Yayıncı sizi bu canlı yayından uzaklaştırdı!", "warning");
        return;
      }
    }

    const viewerNum = data.viewers ? Object.keys(data.viewers).length : 0;
    const vEl = document.getElementById('live-viewer-num');
    if (vEl) vEl.innerText = viewerNum;

    renderStageSpeakers(data.speakers || {});

    const raises = data.handRaises || {};
    const hrEl = document.getElementById('hand-raise-count');
    if (hrEl) hrEl.innerText = Object.keys(raises).length;

    if (isHost) {
      renderSpeakerRequestsList(raises);
    } else {
      checkSpeakerStatus(data.speakers || {});
    }
  });
}

function initRoomChat(roomId) {
  const container = document.getElementById('live-chat-messages');
  if (!container) return;
  container.innerHTML = "";

  if (typeof fbDb !== 'undefined' && fbDb) {
    if (chatRefListener) fbDb.ref(`liveRooms/${roomId}/chat`).off('child_added', chatRefListener);

    chatRefListener = fbDb.ref(`liveRooms/${roomId}/chat`).limitToLast(50).on('child_added', snapshot => {
      const msg = snapshot.val();
      if (!msg) return;
      const existing = container.querySelector(`[data-chat-id="${msg.id || ''}"]`);
      if (existing && msg.id) return;
      appendChatMessage(msg);
    });
  }
}

function sendLiveChatMessage() {
  if (!activeLiveRoom || !CurrentUser) return;
  const inputEl = document.getElementById('live-chat-input');
  const text = inputEl?.value.trim();
  if (!text) return;

  if (checkInappropriateContent(text)) {
    showToast("🚫 Mesajınız uygunsuz ifadeler içeriyor!", "warning");
    return;
  }

  const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const msgData = {
    id: msgId,
    sender: CurrentUser.username,
    role: CurrentUser.role || "Candidate",
    text: text,
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  };

  appendChatMessage(msgData);

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/chat`).push(msgData);
  }

  if (inputEl) inputEl.value = "";
}
window.sendLiveChatMessage = sendLiveChatMessage;

function appendChatMessage(msg) {
  const container = document.getElementById('live-chat-messages');
  if (!container || !msg) return;

  const isMe = CurrentUser && CurrentUser.username.toLowerCase() === (msg.sender || "").toLowerCase();
  const isHost = activeLiveRoom && (activeLiveRoom.host || '').trim().toLowerCase() === (CurrentUser?.username || '').trim().toLowerCase();
  const isSenderHost = activeLiveRoom && (activeLiveRoom.host || '').trim().toLowerCase() === (msg.sender || "").toLowerCase();
  const isSystem = msg.sender === "SİSTEM";
  const badgeStyle = getRoleBadgeStyle(msg.role);

  const div = document.createElement('div');
  div.className = "notranslate p-2 rounded-xl text-xs " + (isSystem ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 font-bold' : (isMe ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-mineora-bg border border-mineora-border'));
  div.setAttribute('translate', 'no');
  if (msg.id) div.setAttribute('data-chat-id', msg.id);

  div.innerHTML = `
    <div class="flex items-center justify-between text-[10px] text-slate-400 mb-0.5 font-mono">
      <span class="font-bold flex items-center gap-1.5 ${isSystem ? 'text-emerald-400' : (isMe ? 'text-rose-400' : 'text-mineora-gold')}">
        ${msg.sender} 
        ${!isSystem ? `<span class="px-1.5 py-0.2 rounded text-[8px] border font-normal ${badgeStyle.bg}">${msg.role}</span>` : ''}
      </span>
      <div class="flex items-center gap-1.5">
        <span>${msg.time || ''}</span>
        ${(isHost && !isSenderHost && !isSystem) ? `
          <button type="button" onclick="kickAndBanUserFromRoom('${msg.sender}')" class="text-rose-500 hover:text-rose-400 font-bold ml-1 cursor-pointer" title="Kullanıcıyı Yayından At">
            <i class="fa-solid fa-ban"></i>
          </button>
        ` : ''}
      </div>
    </div>
    <p class="text-slate-200 break-words leading-relaxed notranslate" translate="no">${msg.text}</p>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function toggleHostCamera() {
  if (!localMediaStream) return;
  const videoTrack = localMediaStream.getVideoTracks()[0];
  if (!videoTrack) return;

  isCamActive = !isCamActive;
  videoTrack.enabled = isCamActive;

  const btn = document.getElementById('btn-toggle-cam');
  if (btn) {
    btn.className = isCamActive
      ? "px-3 py-2 rounded-xl bg-mineora-input text-white font-bold flex items-center gap-1.5 cursor-pointer"
      : "px-3 py-2 rounded-xl bg-rose-600/30 text-rose-400 border border-rose-500/40 font-bold flex items-center gap-1.5 cursor-pointer";
    btn.innerHTML = `<i class="fa-solid ${isCamActive ? 'fa-video' : 'fa-video-slash'}"></i> Kamera`;
  }
}
window.toggleHostCamera = toggleHostCamera;

function toggleHostMic() {
  if (!localMediaStream) return;
  const audioTrack = localMediaStream.getAudioTracks()[0];
  if (!audioTrack) return;

  isMicActive = !isMicActive;
  audioTrack.enabled = isMicActive;

  const btn = document.getElementById('btn-toggle-mic');
  if (btn) {
    btn.className = isMicActive
      ? "px-3 py-2 rounded-xl bg-mineora-input text-white font-bold flex items-center gap-1.5 cursor-pointer"
      : "px-3 py-2 rounded-xl bg-rose-600/30 text-rose-400 border border-rose-500/40 font-bold flex items-center gap-1.5 cursor-pointer";
    btn.innerHTML = `<i class="fa-solid ${isMicActive ? 'fa-microphone' : 'fa-microphone-slash'}"></i> Mikrofon`;
  }
}
window.toggleHostMic = toggleHostMic;

let isScreenSharing = false;
let screenStream = null;

async function toggleScreenShare() {
  if (!activeLiveRoom || !CurrentUser) {
    showToast("⚠️ Canlı oda bilgisi bulunamadı.", "warning");
    return;
  }

  const isHost = (activeLiveRoom.host || '').trim().toLowerCase() === (CurrentUser.username || '').trim().toLowerCase();
  if (!isHost) {
    showToast("⚠️ Yalnızca yayıncı ekran paylaşımı yapabilir.", "warning");
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    showToast("📱 Mobil cihazlar tarayıcı üzerinden ekran paylaşımını desteklemez. Lütfen bilgisayardan deneyin.", "warning");
    return;
  }

  const btn = document.getElementById('btn-toggle-screen');
  const videoEl = document.getElementById('live-host-video');

  if (!isScreenSharing) {
    try {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (audioErr) {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        showToast("⚠️ Ekran video akışı alınamadı.", "warning");
        return;
      }

      Object.keys(rtcPeerConnections).forEach(k => {
        const pc = rtcPeerConnections[k];
        if (pc) {
          const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) videoSender.replaceTrack(screenTrack);
        }
      });

      if (videoEl) {
        videoEl.srcObject = screenStream;
        videoEl.play().catch(() => {});
      }

      isScreenSharing = true;
      if (btn) {
        btn.className = "px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-lg animate-pulse";
        btn.innerHTML = `<i class="fa-solid fa-stop"></i> Paylaşımı Durdur`;
      }
      showToast("🖥️ Ekran paylaşımı başladı!", "success");

      screenTrack.onended = () => { stopScreenShare(); };
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showToast("ℹ️ Ekran seçimi iptal edildi.", "info");
      } else {
        showToast("⚠️ Ekran paylaşılamadı: " + (err.message || err.name), "warning");
      }
    }
  } else {
    stopScreenShare();
  }
}
window.toggleScreenShare = toggleScreenShare;

function stopScreenShare() {
  if (!isScreenSharing) return;

  if (screenStream) {
    try { screenStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    screenStream = null;
  }

  const camTrack = localMediaStream ? localMediaStream.getVideoTracks()[0] : null;
  Object.keys(rtcPeerConnections).forEach(k => {
    const pc = rtcPeerConnections[k];
    if (pc && camTrack) {
      const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (videoSender) videoSender.replaceTrack(camTrack);
    }
  });

  const videoEl = document.getElementById('live-host-video');
  if (videoEl && localMediaStream) {
    videoEl.srcObject = localMediaStream;
    videoEl.play().catch(() => {});
  }

  isScreenSharing = false;
  const btn = document.getElementById('btn-toggle-screen');
  if (btn) {
    btn.className = "px-3 py-2 rounded-xl bg-mineora-input hover:bg-slate-700 text-white font-bold flex items-center gap-1.5 cursor-pointer";
    btn.innerHTML = `<i class="fa-solid fa-desktop text-cyan-400"></i> Ekran Paylaş`;
  }
  showToast("📷 Kameraya geri dönüldü.", "info");
}