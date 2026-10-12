// ================= CANLI YAYIN ODALARI & WEBRTC YAYIN MOTORU (live.js) =================
let activeLiveRoom = null;
let localMediaStream = null;
let isCamActive = true;
let isMicActive = true;
let hasHandRaised = false;
let isScreenSharing = false;
let screenStream = null;
let pendingPinRoomId = null;
let isLiveRoomsListening = false;

// WEBRTC VE SES MİKSERİ YAPILANDIRMASI
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

let hostPeerConnections = {}; 
let viewerPC = null;          
let viewerMicStream = null;   
let hostAudioCtx = null;      
let hostAudioDest = null;
let hostMicSource = null;
let activeSpeakerUser = null; 

function initLiveRoomsLobby() {
  const lobbyView = document.getElementById('live-lobby-view');
  const activeView = document.getElementById('live-room-active-view');
  if (lobbyView) lobbyView.classList.remove('hidden');
  if (activeView) activeView.classList.add('hidden');

  if (!isLiveRoomsListening) {
    listenToLiveRooms();
  }
}
window.initLiveRoomsLobby = initLiveRoomsLobby;

function listenToLiveRooms() {
  if (typeof fbDb !== 'undefined' && fbDb) {
    isLiveRoomsListening = true;
    fbDb.ref('liveRooms').on('value', snapshot => {
      renderLiveRoomsList(snapshot.val());
    });
  }
}

function openCreateRoomModal() {
  openModal('modal-create-live-room');
}
window.openCreateRoomModal = openCreateRoomModal;

// ODA KURMA & YAYINI BAŞLATMA
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
  const roomId = `room_${hostName.toLowerCase()}_${Date.now()}`;
  const roomData = {
    id: roomId,
    title: title,
    host: hostName,
    hasPin: !!pin,
    createdAt: Date.now()
  };
  if (pin) roomData.pin = pin;

  if (typeof fbDb !== 'undefined' && fbDb) {
    const roomRef = fbDb.ref(`liveRooms/${roomId}`);
    await roomRef.set(roomData).catch(e => console.warn(e));
    roomRef.onDisconnect().remove();
  }

  closeModal('modal-create-live-room');
  if (titleInput) titleInput.value = "";
  if (pinInput) pinInput.value = "";
  showToast(`🎉 '${title}' canlı yayın odası açıldı!`, "success");

  enterRoomView(roomData, true);
}
window.handleCreateLiveRoomSubmit = handleCreateLiveRoomSubmit;

// YAYIN ODASI İÇİ EKRANI & WEBRTC BAŞLATICI
async function enterRoomView(room, isHost) {
  activeLiveRoom = room;

  document.getElementById('live-lobby-view')?.classList.add('hidden');
  document.getElementById('live-room-active-view')?.classList.remove('hidden');

  document.getElementById('current-room-title').innerText = room.title;
  document.getElementById('current-room-host').innerText = `Yayıncı: ${room.host}`;
  document.getElementById('live-host-badge-name').innerText = room.host;

  const isAdmin = !!(CurrentUser && CurrentUser.isRootAdmin);
  const isGhostAdmin = isAdmin && !isHost;

  const hostCtrl = document.getElementById('host-controls');
  const viewerCtrl = document.getElementById('viewer-controls');
  
  if (hostCtrl) hostCtrl.classList.toggle('hidden', !isHost);
  // Hayalet moddaki adminin kontrol paneli gizlenir (sadece izler)
  if (viewerCtrl) viewerCtrl.classList.toggle('hidden', isHost || isGhostAdmin);

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

      setupHostAudioMixer(localMediaStream);
      initHostWebRTC(room.id);
      initHostHandRequestsListener(room.id);
    } catch (err) {
      console.warn("Kamera/Mikrofon erişimi alınamadı:", err);
      if (placeholderEl) placeholderEl.classList.remove('hidden');
      showToast("⚠️ Kamera veya mikrofon izni verilmedi!", "warning");
    }
  } else {
    if (placeholderEl) placeholderEl.classList.remove('hidden');
    initViewerWebRTC(room.id);
    if (!isGhostAdmin) {
      listenToMySpeechStatus(room.id);
    }
  }

  initRoomChat(room.id);
}
window.enterRoomView = enterRoomView;

// ================= WEBRTC: YAYINCI TARAFI =================
function setupHostAudioMixer(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!hostAudioCtx) hostAudioCtx = new AudioCtx();
    if (hostAudioCtx.state === 'suspended') hostAudioCtx.resume();

    hostAudioDest = hostAudioCtx.createMediaStreamDestination();
    hostMicSource = hostAudioCtx.createMediaStreamSource(stream);
    hostMicSource.connect(hostAudioDest);
  } catch (e) {
    console.warn("Ses mikseri hatası:", e);
  }
}

function getHostBroadcastAudioTrack() {
  if (hostAudioDest && hostAudioDest.stream.getAudioTracks().length > 0) {
    return hostAudioDest.stream.getAudioTracks()[0];
  }
  return localMediaStream ? localMediaStream.getAudioTracks()[0] : null;
}

function initHostWebRTC(roomId) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  hostPeerConnections = {};

  const peersRef = fbDb.ref(`liveRooms/${roomId}/peers`);

  peersRef.on('child_added', async snap => {
    const viewerName = snap.key;
    if (!viewerName || viewerName.toLowerCase() === CurrentUser.username.toLowerCase()) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    hostPeerConnections[viewerName] = pc;

    if (localMediaStream) {
      const vTrack = isScreenSharing && screenStream 
        ? screenStream.getVideoTracks()[0] 
        : localMediaStream.getVideoTracks()[0];
      const aTrack = getHostBroadcastAudioTrack();

      if (vTrack) pc.addTrack(vTrack, localMediaStream);
      if (aTrack) pc.addTrack(aTrack, localMediaStream);
    }

    pc.ontrack = (event) => {
      const incomingStream = event.streams[0] || new MediaStream([event.track]);
      if (hostAudioCtx && hostAudioDest) {
        try {
          const vSource = hostAudioCtx.createMediaStreamSource(incomingStream);
          vSource.connect(hostAudioDest);          
          vSource.connect(hostAudioCtx.destination); 
        } catch (e) {
          console.warn("İzleyici sesi mikslenemedi:", e);
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        fbDb.ref(`liveRooms/${roomId}/peers/${viewerName}/hostCandidates`).push(event.candidate.toJSON());
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await fbDb.ref(`liveRooms/${roomId}/peers/${viewerName}/offer`).set({
        type: offer.type,
        sdp: offer.sdp
      });
    } catch (e) {
      console.warn("Offer hatası:", e);
    }

    fbDb.ref(`liveRooms/${roomId}/peers/${viewerName}/answer`).on('value', async aSnap => {
      const ans = aSnap.val();
      if (ans && pc.signalingState !== 'stable') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(ans));
        } catch (e) {}
      }
    });

    fbDb.ref(`liveRooms/${roomId}/peers/${viewerName}/viewerCandidates`).on('child_added', cSnap => {
      const c = cSnap.val();
      if (c) {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
    });
  });

  peersRef.on('child_removed', snap => {
    const viewerName = snap.key;
    if (hostPeerConnections[viewerName]) {
      hostPeerConnections[viewerName].close();
      delete hostPeerConnections[viewerName];
    }
  });
}

// ================= WEBRTC: İZLEYİCİ TARAFI (ADMİN İÇİN GİZLİ TEFTİŞ) =================
async function initViewerWebRTC(roomId) {
  if (typeof fbDb === 'undefined' || !fbDb || !CurrentUser) return;
  
  const isAdmin = !!CurrentUser.isRootAdmin;
  const isHost = (activeLiveRoom?.host || '').toLowerCase() === CurrentUser.username.toLowerCase();
  
  // Admin ise yayıncının listesinde adının çıkmaması için anonim kimlik kullanılır
  const peerKey = (isAdmin && !isHost) 
    ? `ghost_spectator_${Date.now()}` 
    : CurrentUser.username;

  viewerPC = new RTCPeerConnection(RTC_CONFIG);

  viewerPC.addTransceiver('audio', { direction: 'sendrecv' });
  viewerPC.addTransceiver('video', { direction: 'recvonly' });

  viewerPC.ontrack = (event) => {
    const videoEl = document.getElementById('live-host-video');
    const placeholderEl = document.getElementById('live-video-placeholder');
    if (videoEl) {
      videoEl.srcObject = event.streams[0];
      videoEl.muted = false;
      videoEl.play().catch(() => {});
    }
    if (placeholderEl) placeholderEl.classList.add('hidden');
  };

  viewerPC.onicecandidate = (event) => {
    if (event.candidate) {
      fbDb.ref(`liveRooms/${roomId}/peers/${peerKey}/viewerCandidates`).push(event.candidate.toJSON());
    }
  };

  const peerNode = fbDb.ref(`liveRooms/${roomId}/peers/${peerKey}`);
  await peerNode.set({ joinedAt: Date.now(), isGhost: (isAdmin && !isHost) });
  peerNode.onDisconnect().remove();

  peerNode.child('offer').on('value', async snap => {
    const offer = snap.val();
    if (offer && viewerPC && viewerPC.signalingState !== 'closed') {
      try {
        await viewerPC.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await viewerPC.createAnswer();
        await viewerPC.setLocalDescription(answer);
        await peerNode.child('answer').set({
          type: answer.type,
          sdp: answer.sdp
        });
      } catch (e) {
        console.warn("Viewer answer hatası:", e);
      }
    }
  });

  peerNode.child('hostCandidates').on('child_added', snap => {
    const c = snap.val();
    if (c && viewerPC) {
      viewerPC.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  });
}

// ================= SÖZ HAKKI (EL KALDIRMA) MOTORU =================
function toggleRaiseHand() {
  if (!activeLiveRoom || !CurrentUser || typeof fbDb === 'undefined' || !fbDb) return;
  const myName = CurrentUser.username;

  if (activeSpeakerUser === myName) {
    stopViewerSpeaking();
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands/${myName}`).remove();
    activeSpeakerUser = null;
    showToast("Sözü bıraktınız, mikrofon kapatıldı.", "info");
    return;
  }

  hasHandRaised = !hasHandRaised;
  const txt = document.getElementById('raise-hand-text');
  const handRef = fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands/${myName}`);

  if (hasHandRaised) {
    handRef.set({ username: myName, status: 'pending', time: Date.now() });
    if (txt) txt.innerText = "İsteği Geri Çek";
    showToast("✋ El kaldırıldı, yayıncıya iletildi.", "info");
  } else {
    handRef.remove();
    if (txt) txt.innerText = "Söz İste (El Kaldır)";
    showToast("El indirme talebiniz iletildi.", "info");
  }
}
window.toggleRaiseHand = toggleRaiseHand;

function listenToMySpeechStatus(roomId) {
  if (typeof fbDb === 'undefined' || !fbDb || !CurrentUser) return;
  const myName = CurrentUser.username;

  fbDb.ref(`liveRooms/${roomId}/hands/${myName}`).on('value', async snap => {
    const data = snap.val();
    const txt = document.getElementById('raise-hand-text');

    if (data && data.status === 'granted') {
      if (activeSpeakerUser !== myName) {
        activeSpeakerUser = myName;
        if (txt) txt.innerText = "🎤 Sözdesiniz (Sözü Bırak)";
        showToast("🎉 Yayıncı size söz hakkı verdi! Mikrofonunuz açılıyor...", "success");
        await startViewerSpeaking();
      }
    } else {
      if (activeSpeakerUser === myName) {
        stopViewerSpeaking();
        activeSpeakerUser = null;
        if (txt) txt.innerText = "Söz İste (El Kaldır)";
        hasHandRaised = false;
        showToast("Söz hakkınız sona erdi.", "info");
      }
    }
  });
}

async function startViewerSpeaking() {
  try {
    viewerMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const micTrack = viewerMicStream.getAudioTracks()[0];

    if (viewerPC) {
      const audioSender = viewerPC.getSenders().find(s => s.kind === 'audio' || (s.track && s.track.kind === 'audio'));
      if (audioSender) {
        await audioSender.replaceTrack(micTrack);
      } else {
        viewerPC.addTrack(micTrack, viewerMicStream);
      }
    }
    showToast("🎤 Mikrofon yayına bağlandı, konuşabilirsiniz!", "success");
  } catch (err) {
    showToast("⚠️ Mikrofon erişim izni alınamadı!", "warning");
  }
}

function stopViewerSpeaking() {
  if (viewerMicStream) {
    viewerMicStream.getTracks().forEach(t => t.stop());
    viewerMicStream = null;
  }
  if (viewerPC) {
    const audioSender = viewerPC.getSenders().find(s => s.kind === 'audio' || (s.track && s.track.kind === 'audio'));
    if (audioSender) {
      audioSender.replaceTrack(null);
    }
  }
}

// YAYINCI: EL KALDIRANLARI KONTROL ET & SÖZ VER / REDDET PANELİ
function initHostHandRequestsListener(roomId) {
  if (typeof fbDb === 'undefined' || !fbDb) return;

  const hostCtrl = document.getElementById('host-controls');
  let panel = document.getElementById('host-hand-panel');
  if (!panel && hostCtrl) {
    panel = document.createElement('div');
    panel.id = 'host-hand-panel';
    panel.className = 'w-full flex flex-wrap items-center gap-2 pt-2.5 border-t border-mineora-border';
    hostCtrl.parentNode.insertBefore(panel, hostCtrl.nextSibling);
  }

  fbDb.ref(`liveRooms/${roomId}/hands`).on('value', snap => {
    const hands = snap.val() || {};
    if (!panel) return;
    panel.innerHTML = "";

    const userKeys = Object.keys(hands);
    if (userKeys.length === 0) return;

    userKeys.forEach(uName => {
      const item = hands[uName];
      const isGranted = item.status === 'granted';

      const tag = document.createElement('div');
      tag.className = "flex items-center gap-2 px-3 py-1.5 rounded-xl bg-mineora-bg border border-mineora-border text-xs";
      tag.innerHTML = `
        <span class="font-bold text-white flex items-center gap-1.5">
          <i class="fa-solid ${isGranted ? 'fa-microphone text-emerald-400 animate-pulse' : 'fa-hand text-amber-400'}"></i>
          ${uName} ${isGranted ? '<span class="text-[10px] text-emerald-400 font-mono">(Yayında)</span>' : ''}
        </span>
        ${!isGranted ? `
          <button type="button" onclick="grantSpeech('${uName}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] cursor-pointer">Söz Ver</button>
          <button type="button" onclick="rejectSpeech('${uName}')" class="px-2 py-1 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-[10px] cursor-pointer">Reddet</button>
        ` : `
          <button type="button" onclick="revokeSpeech('${uName}')" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer">Sözü Al</button>
        `}
      `;
      panel.appendChild(tag);
    });
  });
}

function grantSpeech(viewerName) {
  if (!activeLiveRoom || typeof fbDb === 'undefined' || !fbDb) return;
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands/${viewerName}`).update({ status: 'granted' });
  showToast(`🎤 ${viewerName} adlı üyeye söz hakkı verildi.`, "success");
}
window.grantSpeech = grantSpeech;

function revokeSpeech(viewerName) {
  if (!activeLiveRoom || typeof fbDb === 'undefined' || !fbDb) return;
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands/${viewerName}`).remove();
  showToast(`${viewerName} adlı üyenin söz hakkı geri alındı.`, "info");
}
window.revokeSpeech = revokeSpeech;

function rejectSpeech(viewerName) {
  if (!activeLiveRoom || typeof fbDb === 'undefined' || !fbDb) return;
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands/${viewerName}`).remove();
  showToast(`${viewerName} söz hakkı talebi reddedildi.`, "info");
}
window.rejectSpeech = rejectSpeech;

// ================= YAYINDAN AYRILMA =================
function leaveCurrentRoom() {
  if (localMediaStream) {
    localMediaStream.getTracks().forEach(t => t.stop());
    localMediaStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  stopViewerSpeaking();

  if (viewerPC) {
    viewerPC.close();
    viewerPC = null;
  }

  if (hostPeerConnections) {
    Object.keys(hostPeerConnections).forEach(k => {
      hostPeerConnections[k]?.close();
    });
    hostPeerConnections = {};
  }

  if (hostAudioCtx) {
    hostAudioCtx.close().catch(() => {});
    hostAudioCtx = null;
  }

  const videoEl = document.getElementById('live-host-video');
  if (videoEl) videoEl.srcObject = null;

  const panel = document.getElementById('host-hand-panel');
  if (panel) panel.remove();

  if (activeLiveRoom && fbDb && CurrentUser) {
    const isHost = (activeLiveRoom.host || '').toLowerCase() === CurrentUser.username.toLowerCase();
    if (isHost) {
      fbDb.ref(`liveRooms/${activeLiveRoom.id}`).onDisconnect().cancel();
      fbDb.ref(`liveRooms/${activeLiveRoom.id}`).remove();
    } else {
      fbDb.ref(`liveRooms/${activeLiveRoom.id}/peers`).once('value', snap => {
        const peers = snap.val() || {};
        Object.keys(peers).forEach(pKey => {
          if (pKey === CurrentUser.username || (CurrentUser.isRootAdmin && pKey.startsWith('ghost_spectator_'))) {
            fbDb.ref(`liveRooms/${activeLiveRoom.id}/peers/${pKey}`).remove();
          }
        });
      });
      fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands/${CurrentUser.username}`).remove();
    }
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/chat`).off();
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/hands`).off();
  }

  activeLiveRoom = null;
  activeSpeakerUser = null;
  hasHandRaised = false;

  document.getElementById('live-room-active-view')?.classList.add('hidden');
  document.getElementById('live-lobby-view')?.classList.remove('hidden');
  showToast("Yayından ayrıldınız.", "info");
}
window.leaveCurrentRoom = leaveCurrentRoom;

// ================= YAYINCI BUTON KONTROLLERİ =================
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
      const screenTrack = screenStream.getVideoTracks()[0];

      if (videoEl) videoEl.srcObject = screenStream;
      isScreenSharing = true;
      if (btn) btn.innerHTML = `<i class="fa-solid fa-stop text-rose-400"></i> Durdur`;

      Object.values(hostPeerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      screenTrack.onended = () => stopScreenShare();
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

  if (localMediaStream) {
    const camTrack = localMediaStream.getVideoTracks()[0];
    Object.values(hostPeerConnections).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && camTrack) sender.replaceTrack(camTrack);
    });
  }

  isScreenSharing = false;
  const btn = document.getElementById('btn-toggle-screen');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-desktop text-cyan-400"></i> Ekran Paylaş`;
}

// ================= GÜVENLİ ODA SOHBETİ (XSS KORUMALI) =================
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
      
      const b = document.createElement('strong');
      b.className = "text-mineora-gold";
      b.textContent = (m.sender || 'Madenci') + ": ";

      const span = document.createElement('span');
      span.className = "text-slate-200";
      span.textContent = m.text || '';

      d.appendChild(b);
      d.appendChild(span);
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

// ================= ADMİN GİZLİ TEFTİŞ & MASTER KEY GİRİŞİ =================
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
      const isAdmin = !!CurrentUser.isRootAdmin;

      // ADMİN İSE ŞİFRE SORMAZ (MASTER KEY)
      if (room.hasPin && !isHost && !isAdmin) {
        pendingPinRoomId = roomId;
        const pinInput = document.getElementById('input-room-pin');
        if (pinInput) pinInput.value = "";
        openModal('modal-room-pin-prompt');
        return;
      }

      if (isAdmin && !isHost) {
        showToast("👁️ Yönetici Modu: Odaya şifresiz ve GÖRÜNMEZ olarak bağlanıyorsunuz.", "info");
      }

      enterRoomView(room, isHost);
    });
  }
}
window.attemptJoinRoom = attemptJoinRoom;

function submitRoomPinCheck() {
  const pinInput = document.getElementById('input-room-pin');
  const pinEntered = pinInput?.value.trim();
  if (!pendingPinRoomId || !fbDb) return;

  fbDb.ref(`liveRooms/${pendingPinRoomId}`).once('value').then(snap => {
    const room = snap.val();
    if (room && room.pin === pinEntered) {
      closeModal('modal-room-pin-prompt');
      if (pinInput) pinInput.value = "";
      enterRoomView(room, false);
    } else {
      showToast("❌ Hatalı oda şifresi!", "warning");
    }
  });
}
window.submitRoomPinCheck = submitRoomPinCheck;

// LOBİ LİSTESİ (SADECE AÇIK OLAN GERÇEK ODALARI LİSTELER)
function renderLiveRoomsList(roomsData = null) {
  const grid = document.getElementById('live-rooms-grid');
  if (!grid) return;

  grid.innerHTML = "";
  const rooms = roomsData || {};
  const roomKeys = Object.keys(rooms);

  if (roomKeys.length === 0) {
    grid.innerHTML = '<div class="col-span-full p-8 text-center text-slate-500 text-xs">Şu anda açık canlı oda bulunmuyor. Yeni bir oda kurarak ilk toplantıyı başlatabilirsiniz!</div>';
    return;
  }

  roomKeys.forEach(roomId => {
    const room = rooms[roomId];
    if (!room || !room.id) return;
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
      <button type="button" onclick="attemptJoinRoom('${room.id}')" class="w-full py-2.5 rounded-xl bg-mineora-input hover:bg-rose-600 hover:text-white text-slate-200 font-bold text-xs transition cursor-pointer shadow flex items-center justify-center gap-1.5">
        ${isLocked ? '<i class="fa-solid fa-lock text-amber-400"></i> Şifreli Odaya Katıl' : 'Odaya Katıl'}
      </button>
    `;
    grid.appendChild(card);
  });
}
window.renderLiveRoomsList = renderLiveRoomsList;
