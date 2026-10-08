// ================= CANLI YAYIN ODALARI & ODA İÇİ YAYIN MOTORU (live.js) =================
let activeLiveRoom = null;
let localMediaStream = null;
let isCamActive = true;
let isMicActive = true;
let hasHandRaised = false;
let isScreenSharing = false;
let screenStream = null;
let pendingPinRoomId = null;

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
    fbDb.ref('liveRooms').on('value', snapshot => {
      renderLiveRoomsList(snapshot.val());
    });
  }
}

function openCreateRoomModal() {
  openModal('modal-create-live-room');
}
window.openCreateRoomModal = openCreateRoomModal;

// ODA KURMA VE ANINDA YAYIN ODASI EKRANINA GEÇİŞ
async function handleCreateLiveRoomSubmit() {
  if (!CurrentUser) return;
  const titleInput = document.getElementById('new-room-title');
  const pinInput = document.getElementById('new-room-pin');

  const title = titleInput?.value.trim();
  const pin = pinInput?.value.trim();

  if (!title || title.length < 3) {
    showToast("⚠️ En az 3 karakterli bir oda başlığı yazın!", "warning");
    return;
  }

  const hostName = CurrentUser.username || "Madenci";
  const roomId = `room_${hostName}_${Date.now()}`;
  const roomData = {
    id: roomId,
    title: title,
    host: hostName,
    hasPin: !!pin,
    createdAt: Date.now()
  };
  if (pin) roomData.pin = pin;

  if (typeof fbDb !== 'undefined' && fbDb) {
    await fbDb.ref(`liveRooms/${roomId}`).set(roomData).catch(e => console.warn(e));
  }

  closeModal('modal-create-live-room');
  if (titleInput) titleInput.value = "";
  if (pinInput) pinInput.value = "";
  showToast(`🎉 '${title}' canlı yayın odası açıldı!`, "success");

  // Odayı kurduğun an seni yayın odası ekranına geçirir
  enterRoomView(roomData, true);
}
window.handleCreateLiveRoomSubmit = handleCreateLiveRoomSubmit;

// YAYIN ODASI İÇİ EKRANINI AÇAN MOTOR
async function enterRoomView(room, isHost) {
  activeLiveRoom = room;

  document.getElementById('live-lobby-view')?.classList.add('hidden');
  document.getElementById('live-room-active-view')?.classList.remove('hidden');

  document.getElementById('current-room-title').innerText = room.title;
  document.getElementById('current-room-host').innerText = `Yayıncı: ${room.host}`;
  document.getElementById('live-host-badge-name').innerText = room.host;

  const hostCtrl = document.getElementById('host-controls');
  const viewerCtrl = document.getElementById('viewer-controls');
  if (hostCtrl) hostCtrl.classList.toggle('hidden', !isHost);
  if (viewerCtrl) viewerCtrl.classList.toggle('hidden', isHost);

  const videoEl = document.getElementById('live-host-video');
  const placeholderEl = document.getElementById('live-video-placeholder');

  if (isHost) {
    try {
      localMediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoEl) {
        videoEl.srcObject = localMediaStream;
        videoEl.muted = true;
        videoEl.play().catch(() => {});
      }
      if (placeholderEl) placeholderEl.classList.add('hidden');
    } catch (err) {
      console.warn("Kamera erişimi alınamadı:", err);
      if (placeholderEl) placeholderEl.classList.remove('hidden');
    }
  } else {
    if (placeholderEl) placeholderEl.classList.remove('hidden');
  }

  initRoomChat(room.id);
}
window.enterRoomView = enterRoomView;

function leaveCurrentRoom() {
  if (localMediaStream) {
    localMediaStream.getTracks().forEach(t => t.stop());
    localMediaStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }

  const videoEl = document.getElementById('live-host-video');
  if (videoEl) videoEl.srcObject = null;

  if (activeLiveRoom && fbDb) {
    const isHost = (activeLiveRoom.host || '').toLowerCase() === (CurrentUser?.username || '').toLowerCase();
    if (isHost) {
      fbDb.ref(`liveRooms/${activeLiveRoom.id}`).remove();
    }
  }

  activeLiveRoom = null;
  document.getElementById('live-room-active-view')?.classList.add('hidden');
  document.getElementById('live-lobby-view')?.classList.remove('hidden');
  renderLiveRoomsList();
  showToast("Yayından ayrıldınız.", "info");
}
window.leaveCurrentRoom = leaveCurrentRoom;

function toggleHostCamera() {
  if (!localMediaStream) return;
  const videoTrack = localMediaStream.getVideoTracks()[0];
  if (!videoTrack) return;
  isCamActive = !isCamActive;
  videoTrack.enabled = isCamActive;
  const btn = document.getElementById('btn-toggle-cam');
  if (btn) btn.innerHTML = `<i class="fa-solid ${isCamActive ? 'fa-video' : 'fa-video-slash'}"></i> Kamera`;
}
window.toggleHostCamera = toggleHostCamera;

function toggleHostMic() {
  if (!localMediaStream) return;
  const audioTrack = localMediaStream.getAudioTracks()[0];
  if (!audioTrack) return;
  isMicActive = !isMicActive;
  audioTrack.enabled = isMicActive;
  const btn = document.getElementById('btn-toggle-mic');
  if (btn) btn.innerHTML = `<i class="fa-solid ${isMicActive ? 'fa-microphone' : 'fa-microphone-slash'}"></i> Mikrofon`;
}
window.toggleHostMic = toggleHostMic;

async function toggleScreenShare() {
  const videoEl = document.getElementById('live-host-video');
  const btn = document.getElementById('btn-toggle-screen');

  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (videoEl) videoEl.srcObject = screenStream;
      isScreenSharing = true;
      if (btn) btn.innerHTML = `<i class="fa-solid fa-stop text-rose-400"></i> Durdur`;
      screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (e) {}
  } else {
    stopScreenShare();
  }
}
window.toggleScreenShare = toggleScreenShare;

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  const videoEl = document.getElementById('live-host-video');
  if (videoEl && localMediaStream) videoEl.srcObject = localMediaStream;
  isScreenSharing = false;
  const btn = document.getElementById('btn-toggle-screen');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-desktop text-cyan-400"></i> Ekran Paylaş`;
}

function toggleRaiseHand() {
  hasHandRaised = !hasHandRaised;
  const txt = document.getElementById('raise-hand-text');
  if (txt) txt.innerText = hasHandRaised ? "İsteği Geri Çek" : "Söz İste (El Kaldır)";
  showToast(hasHandRaised ? "✋ El kaldırıldı, yayıncıya iletildi." : "El indirildi.", "info");
}
window.toggleRaiseHand = toggleRaiseHand;

// SOHBET MOTORU
function initRoomChat(roomId) {
  const container = document.getElementById('live-chat-messages');
  if (!container) return;
  container.innerHTML = "";

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${roomId}/chat`).limitToLast(40).on('child_added', snap => {
      const m = snap.val();
      if (!m) return;
      const d = document.createElement('div');
      d.className = "p-2 rounded-xl bg-mineora-bg border border-mineora-border text-xs";
      d.innerHTML = `<strong class="text-mineora-gold">${m.sender}:</strong> <span class="text-slate-200">${m.text}</span>`;
      container.appendChild(d);
      container.scrollTop = container.scrollHeight;
    });
  }
}

function sendLiveChatMessage() {
  const input = document.getElementById('live-chat-input');
  const text = input?.value.trim();
  if (!text || !activeLiveRoom) return;

  const msgData = {
    sender: CurrentUser ? CurrentUser.username : "Madenci",
    text: text,
    time: Date.now()
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/chat`).push(msgData);
  }
  input.value = "";
}
window.sendLiveChatMessage = sendLiveChatMessage;

function attemptJoinRoom(roomId) {
  if (!CurrentUser) {
    showToast("⚠️ Odaya katılmak için giriş yapmalısınız!", "warning");
    return;
  }

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${roomId}`).once('value').then(snap => {
      const room = snap.val();
      if (!room) {
        showToast("⛔ Bu oda artık mevcut değil!", "warning");
        return;
      }
      const isHost = (room.host || '').toLowerCase() === CurrentUser.username.toLowerCase();
      if (room.hasPin && !isHost) {
        pendingPinRoomId = roomId;
        openModal('modal-room-pin-prompt');
        return;
      }
      enterRoomView(room, isHost);
    });
  }
}
window.attemptJoinRoom = attemptJoinRoom;

function submitRoomPinCheck() {
  const pinEntered = document.getElementById('input-room-pin')?.value.trim();
  if (!pendingPinRoomId || !fbDb) return;

  fbDb.ref(`liveRooms/${pendingPinRoomId}`).once('value').then(snap => {
    const room = snap.val();
    if (room && room.pin === pinEntered) {
      closeModal('modal-room-pin-prompt');
      enterRoomView(room, false);
    } else {
      showToast("❌ Hatalı oda şifresi!", "warning");
    }
  });
}
window.submitRoomPinCheck = submitRoomPinCheck;

function renderLiveRoomsList(roomsData = null) {
  const grid = document.getElementById('live-rooms-grid');
  if (!grid) return;

  const mockRooms = {
    "mock_room_1": { id: "mock_room_1", title: "VIP Maden Sahipleri Koordinasyon Odası", host: "Alp_Holding", hasPin: false },
    "mock_room_2": { id: "mock_room_2", title: "2. Vardiya Kilitli Strateji Meclisi", host: "Saha_Sorumlusu", hasPin: true }
  };

  const allRooms = Object.assign({}, mockRooms, roomsData || {});
  grid.innerHTML = "";

  Object.keys(allRooms).forEach(roomId => {
    const room = allRooms[roomId];
    const isLocked = !!room.hasPin;
    const card = document.createElement('div');
    card.className = "p-5 rounded-3xl bg-mineora-card border border-mineora-border flex flex-col justify-between space-y-4 shadow-xl";
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between">
          <span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">CANLI</span>
          ${isLocked ? `<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] flex items-center gap-1"><i class="fa-solid fa-lock"></i> Kilitli</span>` : ''}
        </div>
        <h4 class="font-black text-white text-sm mt-2">${room.title}</h4>
        <span class="text-xs text-slate-400 block mt-1">Yayıncı: <strong class="text-mineora-gold">${room.host}</strong></span>
      </div>
      <button type="button" onclick="attemptJoinRoom('${roomId}')" class="w-full py-2.5 rounded-xl bg-mineora-input hover:bg-rose-600 hover:text-white text-slate-200 font-bold text-xs transition cursor-pointer shadow flex items-center justify-center gap-1.5">
        ${isLocked ? '<i class="fa-solid fa-lock text-amber-400"></i> Şifreli Odaya Katıl' : 'Odaya Katıl'}
      </button>
    `;
    grid.appendChild(card);
  });
}
window.renderLiveRoomsList = renderLiveRoomsList;

setTimeout(() => {
  renderLiveRoomsList();
}, 500);
