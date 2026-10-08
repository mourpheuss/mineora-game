// ================= CANLI YAYIN ODALARI MOTORU (live.js) =================
let activeLiveRoom = null;
let localMediaStream = null;

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
  if (!CurrentUser) {
    showToast("⚠️ Canlı oda açmak için giriş yapmalısınız!", "warning");
    return;
  }
  openModal('modal-create-live-room');
}
window.openCreateRoomModal = openCreateRoomModal;

async function handleCreateLiveRoomSubmit() {
  if (!CurrentUser) return;
  const titleInput = document.getElementById('new-room-title');
  const title = titleInput?.value.trim();

  if (!title || title.length < 3) {
    showToast("⚠️ En az 3 karakterli bir oda başlığı yazın!", "warning");
    return;
  }

  const roomId = `room_${CurrentUser.username}_${Date.now()}`;
  const roomData = {
    id: roomId,
    title: title,
    host: CurrentUser.username,
    createdAt: Date.now()
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    await fbDb.ref(`liveRooms/${roomId}`).set(roomData);
  }

  closeModal('modal-create-live-room');
  if (titleInput) titleInput.value = "";
  showToast(`🎉 '${title}' canlı yayın odası açıldı!`, "success");
}
window.handleCreateLiveRoomSubmit = handleCreateLiveRoomSubmit;

function renderLiveRoomsList(roomsData = null) {
  const grid = document.getElementById('live-rooms-grid');
  if (!grid) return;

  const mockRooms = {
    "mock_room_1": { id: "mock_room_1", title: "VIP Maden Sahipleri Koordinasyon Odası", host: "Alp_Holding" },
    "mock_room_2": { id: "mock_room_2", title: "2. Vardiya Madencilik Brifingi", host: "Saha_Sorumlusu" }
  };

  const allRooms = Object.assign({}, mockRooms, roomsData || {});
  grid.innerHTML = "";

  Object.keys(allRooms).forEach(roomId => {
    const room = allRooms[roomId];
    const card = document.createElement('div');
    card.className = "p-5 rounded-3xl bg-mineora-card border border-mineora-border flex flex-col justify-between space-y-4 shadow-xl";
    card.innerHTML = `
      <div>
        <span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">CANLI</span>
        <h4 class="font-black text-white text-sm mt-2">${room.title}</h4>
        <span class="text-xs text-slate-400 block mt-1">Yayıncı: <strong class="text-mineora-gold">${room.host}</strong></span>
      </div>
      <button type="button" onclick="showToast('Odaya bağlanılıyor...', 'info')" class="w-full py-2.5 rounded-xl bg-mineora-input hover:bg-rose-600 hover:text-white text-slate-200 font-bold text-xs transition cursor-pointer shadow">
        Odaya Katıl
      </button>
    `;
    grid.appendChild(card);
  });
}
window.renderLiveRoomsList = renderLiveRoomsList;
