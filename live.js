// ================= CANLI YAYIN ODALARI MOTORU (live.js) =================
let activeLiveRoom = null;
let pendingPinRoomId = null;

function initLiveRoomsLobby() {
  const lobbyView = document.getElementById('live-lobby-view');
  if (lobbyView) lobbyView.classList.remove('hidden');
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
  const modal = document.getElementById('modal-create-live-room');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modal.style.display = 'flex';
}
window.openCreateRoomModal = openCreateRoomModal;

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

  const roomId = `room_${CurrentUser.username}_${Date.now()}`;
  const roomData = {
    id: roomId,
    title: title,
    host: CurrentUser.username,
    hasPin: !!pin,
    createdAt: Date.now()
  };
  if (pin) roomData.pin = pin;

  if (typeof fbDb !== 'undefined' && fbDb) {
    await fbDb.ref(`liveRooms/${roomId}`).set(roomData);
  }

  closeModal('modal-create-live-room');
  if (titleInput) titleInput.value = "";
  if (pinInput) pinInput.value = "";
  showToast(`🎉 '${title}' canlı yayın odası açıldı! ${pin ? '(Kilitli)' : ''}`, "success");
  renderLiveRoomsList();
}
window.handleCreateLiveRoomSubmit = handleCreateLiveRoomSubmit;

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

      enterRoom(room);
    });
  } else {
    showToast("Odaya bağlanılıyor...", "info");
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
      enterRoom(room);
    } else {
      showToast("❌ Hatalı oda şifresi!", "warning");
    }
  });
}
window.submitRoomPinCheck = submitRoomPinCheck;

function enterRoom(room) {
  activeLiveRoom = room;
  showToast(`🎉 '${room.title}' yayınına katıldınız!`, "success");
}

function renderLiveRoomsList(roomsData = null) {
  const grid = document.getElementById('live-rooms-grid');
  if (!grid) return;

  const mockRooms = {
    "mock_room_1": { id: "mock_room_1", title: "VIP Maden Sahipleri Koordinasyon Odası", host: "Alp_Holding", hasPin: false },
    "mock_room_2": { id: "mock_room_2", title: "2. Vardiya Kilitli Strateji Odası", host: "Saha_Sorumlusu", hasPin: true }
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
