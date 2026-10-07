// ================= 10. CANLI YAYIN, ÇİFT YÖNLÜ SES MİKSERİ & WEBRTC MOTORU (live.js) =================
let activeLiveRoom = null;
let localMediaStream = null;
let rtcPeerConnections = {}; // targetKey -> RTCPeerConnection
let isCamActive = true;
let isMicActive = true;
let hasHandRaised = false;
let isGhostAdminMode = false;
let pendingPinRoomId = null;
let pendingTicketRoom = null;

// Web Audio API Ses Mikseri (Yayıncı + Sahnedeki Konuşmacılar)
let broadcastAudioCtx = null;
let broadcastAudioDest = null;
let hostMicSourceNode = null;

// Spam & Moderasyon Takibi
let userChatTimestamps = [];
let chatMuteUntilTime = 0;

// Firebase Dinleyicileri
let roomsRefListener = null;
let activeRoomRefListener = null;
let chatRefListener = null;
let hostSignalingBound = false;

// STUN Sunucuları (Mobil 4G/LTE & Ev Ağı CGNAT Geçişi İçin Genişletilmiş Liste)
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ],
  iceCandidatePoolSize: 10
};

function sanitizeFbKey(key) {
  if (!key) return "anon";
  return key.toLowerCase().replace(/[\.\#\$\/\[\]\s]/g, '_');
}

// ================= METİN FİLTRESİ =================
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

// ================= KASA VE USDT TRANSFERLERİ =================
function creditAdminMasterVaultUsdt(amount) {
  const amt = Number(parseFloat(amount) || 0);
  if (amt <= 0) return;
  if (typeof AdminState !== 'undefined' && AdminState) {
    AdminState.masterVaultUsdt = Number(((AdminState.masterVaultUsdt || 0) + amt).toFixed(2));
    if (typeof saveAdminProtocolState === 'function') saveAdminProtocolState(AdminState);
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
    fbDb.ref(`users/${uKey}/usdt`).transaction(cur => Number(((cur || 0) + amt).toFixed(2)));
  }
}

// ================= LOBİ & ODA YÖNETİMİ =================
function initLiveRoomsLobby() {
  const lobbyView = document.getElementById('live-lobby-view');
  const activeView = document.getElementById('live-room-active-view');
  if (lobbyView) lobbyView.classList.remove('hidden');
  if (activeView) activeView.classList.add('hidden');

  renderLiveRoomsList();
  listenToLiveRooms();
}

function listenToLiveRooms() {
  if (typeof fbDb !== 'undefined' && fbDb) {
    if (roomsRefListener) fbDb.ref('liveRooms').off('value', roomsRefListener);
    roomsRefListener = fbDb.ref('liveRooms').on('value', snapshot => {
      renderLiveRoomsList(snapshot.val());
    });
  }
}

function renderLiveRoomsList(roomsData = null) {
  const grid = document.getElementById('live-rooms-grid');
  if (!grid) return;

  const renderRooms = (roomsObj) => {
    grid.innerHTML = "";
    if (!roomsObj || Object.keys(roomsObj).length === 0) {
      grid.innerHTML = `
        <div class="col-span-full p-8 text-center bg-mineora-card/50 rounded-2xl border border-mineora-border text-xs text-slate-500 notranslate" translate="no">
          <i class="fa-solid fa-tower-broadcast text-3xl mb-2 text-slate-600 block"></i>
          Şu anda aktif canlı yayın odası bulunmuyor. Kendi ekibiniz için bir oda kurun!
        </div>
      `;
      return;
    }

    Object.keys(roomsObj).forEach(roomId => {
      const room = roomsObj[roomId];
      if (!room || !room.host) return;

      const isLocked = !!room.hasPin;
      const isTicketed = (room.ticketPrice && room.ticketPrice > 0);
      const isQuarantined = !!room.isQuarantined;
      const viewerCount = room.viewers ? Object.keys(room.viewers).length : 1;

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
              ${isTicketed ? `<span class="px-2 py-0.5 rounded bg-emerald-500/15 text-mineora-green border border-emerald-500/30 text-[10px] font-bold">$${Number(room.ticketPrice).toFixed(2)}</span>` : ''}
              ${isLocked ? '<i class="fa-solid fa-lock text-amber-400" title="Şifreli"></i>' : ''}
              <span class="flex items-center gap-1 text-slate-400"><i class="fa-solid fa-eye text-slate-500"></i> ${viewerCount}</span>
            </div>
          </div>
          <div>
            <h4 class="font-black text-white text-sm group-hover:text-rose-400 transition">${room.title}</h4>
            <div class="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 font-mono">
              <span class="text-slate-300 font-bold">${room.host}</span>
              <span>•</span>
              <span class="text-mineora-gold">${room.hostRole || 'Miner'}</span>
            </div>
          </div>
        </div>

        <button type="button" onclick="attemptJoinRoom('${roomId}')" class="w-full py-2.5 rounded-xl ${isTicketed ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'bg-mineora-input hover:bg-rose-600 hover:text-white text-slate-200'} font-black text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow">
          <i class="fa-solid fa-right-to-bracket"></i> ${isTicketed ? `Bilet Al ($${Number(room.ticketPrice).toFixed(2)})` : 'Odaya Katıl'}
        </button>
      `;
      grid.appendChild(card);
    });
  };

  if (roomsData !== null && typeof roomsData === 'object') {
    renderRooms(roomsData);
  } else if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('liveRooms').once('value').then(snap => renderRooms(snap.val())).catch(() => {});
  }
}

// ================= ODA KURMA & YAYIN BAŞLATMA =================
function openCreateRoomModal() {
  if (!CurrentUser) {
    showToast("⚠️ Canlı oda açmak için giriş yapmalısınız!", "warning");
    return;
  }
  openModal('modal-create-live-room');
}

async function handleCreateLiveRoomSubmit() {
  if (!CurrentUser) return;

  const titleInput = document.getElementById('new-room-title');
  const pinInput = document.getElementById('new-room-pin');
  const ticketInput = document.getElementById('new-room-ticket');

  const title = titleInput?.value.trim();
  const pin = pinInput?.value.trim();
  const ticketPrice = parseFloat(ticketInput?.value) || 0;

  if (!title || title.length < 3) {
    showToast("⚠️ En az 3 karakterli bir oda başlığı yazın!", "warning");
    return;
  }

  const hostSafeKey = sanitizeFbKey(CurrentUser.username);
  const roomId = `room_${hostSafeKey}_${Date.now()}`;

  const roomData = {
    id: roomId,
    title: title,
    host: CurrentUser.username,
    hostRole: CurrentUser.role || "Miner",
    ticketPrice: Math.max(0, ticketPrice),
    hasPin: !!pin,
    createdAt: Date.now(),
    isQuarantined: false,
    viewers: { [hostSafeKey]: true },
    speakers: { [hostSafeKey]: true }
  };
  if (pin) roomData.pin = pin;

  try {
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
  } catch (err) {
    try {
      localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e2) {
      showToast("⚠️ Kamera/Mikrofon izni alınamadı.", "warning");
    }
  }

  // Yayıncının Web Audio mikserini başlat
  initHostAudioMixer();

  if (typeof fbDb !== 'undefined' && fbDb) {
    await fbDb.ref(`liveRooms/${roomId}`).set(roomData);
  }

  closeModal('modal-create-live-room');
  if (titleInput) titleInput.value = "";
  if (pinInput) pinInput.value = "";
  if (ticketInput) ticketInput.value = "";

  enterRoomView(roomData, true);
  showToast(`🎉 '${title}' canlı yayın odası açıldı!`, "success");
}

function initHostAudioMixer() {
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;
    if (!broadcastAudioCtx) {
      broadcastAudioCtx = new AudioCtxClass();
      broadcastAudioDest = broadcastAudioCtx.createMediaStreamDestination();
    }
    if (broadcastAudioCtx.state === 'suspended') {
      broadcastAudioCtx.resume();
    }
    if (localMediaStream && localMediaStream.getAudioTracks().length > 0) {
      if (hostMicSourceNode) {
        try { hostMicSourceNode.disconnect(); } catch(e) {}
      }
      hostMicSourceNode = broadcastAudioCtx.createMediaStreamSource(localMediaStream);
      hostMicSourceNode.connect(broadcastAudioDest);
    }
  } catch (e) {
    console.warn("Mikser uyarısı:", e);
  }
}

// ================= ODAYA GİRİŞ =================
function attemptJoinRoom(roomId) {
  if (!CurrentUser) {
    showToast("⚠️ Odaya katılmak için giriş yapmalısınız!", "warning");
    return;
  }

  const proceed = (room) => {
    if (!room) {
      showToast("⛔ Bu oda artık mevcut değil!", "warning");
      renderLiveRoomsList();
      return;
    }

    const isHost = room.host.toLowerCase() === CurrentUser.username.toLowerCase();
    if (room.hasPin && !isHost) {
      pendingPinRoomId = roomId;
      openModal('modal-room-pin-prompt');
      return;
    }

    executeJoinRoom(room);
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${roomId}`).once('value').then(snap => proceed(snap.val()));
  }
}

function submitRoomPinCheck() {
  const pinEntered = document.getElementById('input-room-pin')?.value.trim();
  if (!pendingPinRoomId) return;

  fbDb.ref(`liveRooms/${pendingPinRoomId}`).once('value').then(snap => {
    const room = snap.val();
    if (room && room.pin === pinEntered) {
      closeModal('modal-room-pin-prompt');
      executeJoinRoom(room);
    } else {
      showToast("❌ Hatalı oda şifresi!", "warning");
    }
  });
}

function executeJoinRoom(room) {
  const isHost = room.host.toLowerCase() === CurrentUser.username.toLowerCase();
  const uSafeKey = sanitizeFbKey(CurrentUser.username);

  if (typeof fbDb !== 'undefined' && fbDb && !isHost) {
    fbDb.ref(`liveRooms/${room.id}/viewers/${uSafeKey}`).set(true);
  }

  enterRoomView(room, isHost);
}

// ================= ODA İÇİ EKRANI =================
function enterRoomView(room, isHost) {
  activeLiveRoom = room;
  hasHandRaised = false;

  document.getElementById('live-lobby-view')?.classList.add('hidden');
  document.getElementById('live-room-active-view')?.classList.remove('hidden');

  document.getElementById('current-room-title').innerText = room.title;
  document.getElementById('current-room-host').innerText = `Yayıncı: ${room.host} (${room.hostRole || 'Miner'})`;
  document.getElementById('live-host-badge-name').innerText = room.host;

  const hostCtrl = document.getElementById('host-controls');
  const viewerCtrl = document.getElementById('viewer-controls');
  const hostReqBtn = document.getElementById('host-requests-btn-container');

  if (hostCtrl) hostCtrl.classList.toggle('hidden', !isHost);
  if (hostReqBtn) hostReqBtn.classList.toggle('hidden', !isHost);
  if (viewerCtrl) viewerCtrl.classList.toggle('hidden', isHost);

  const videoEl = document.getElementById('live-host-video');
  const placeholderEl = document.getElementById('live-video-placeholder');

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
      videoEl.muted = false;
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
  if (!activeLiveRoom) return;
  const isHost = CurrentUser && activeLiveRoom.host.toLowerCase() === CurrentUser.username.toLowerCase();
  const roomId = activeLiveRoom.id;

  if (localMediaStream) {
    localMediaStream.getTracks().forEach(track => track.stop());
    localMediaStream = null;
  }

  if (broadcastAudioCtx) {
    try { broadcastAudioCtx.close(); } catch(e) {}
    broadcastAudioCtx = null;
    broadcastAudioDest = null;
    hostMicSourceNode = null;
  }

  document.querySelectorAll('audio[id^="speaker-audio-"]').forEach(el => el.remove());

  Object.keys(rtcPeerConnections).forEach(k => {
    try { rtcPeerConnections[k].close(); } catch(e) {}
  });
  rtcPeerConnections = {};
  hostSignalingBound = false;

  const videoEl = document.getElementById('live-host-video');
  if (videoEl) videoEl.srcObject = null;

  if (typeof fbDb !== 'undefined' && fbDb) {
    const uSafeKey = sanitizeFbKey(CurrentUser.username);
    if (isHost) {
      fbDb.ref(`liveRooms/${roomId}`).remove();
    } else {
      fbDb.ref(`liveRooms/${roomId}/viewers/${uSafeKey}`).remove();
      fbDb.ref(`liveRooms/${roomId}/speakers/${uSafeKey}`).remove();
      fbDb.ref(`liveRooms/${roomId}/handRaises/${uSafeKey}`).remove();
      fbDb.ref(`liveRooms/${roomId}/signaling/${uSafeKey}`).remove();
    }

    if (activeRoomRefListener) fbDb.ref(`liveRooms/${roomId}`).off('value', activeRoomRefListener);
    if (chatRefListener) fbDb.ref(`liveRooms/${roomId}/chat`).off('child_added', chatRefListener);
  }

  activeLiveRoom = null;
  initLiveRoomsLobby();
  showToast(isHost ? "🛑 Canlı yayın sonlandırıldı." : "Odadan ayrıldınız.", "info");
}

// ================= WEBRTC SİNYALİZASYON (KUSURSUZ EL SIKIŞMA & MİKSER) =================

// Yayıncı tarafı: İzleyicileri dinler ve yayını basar
function listenToIncomingViewerSignalsOnce(roomId) {
  if (hostSignalingBound || !fbDb || !CurrentUser) return;
  hostSignalingBound = true;

  const signalingRef = fbDb.ref(`liveRooms/${roomId}/signaling`);

  signalingRef.on('child_added', viewerNodeSnap => {
    const viewerSafeKey = viewerNodeSnap.key;
    let candidateQueue = [];

    viewerNodeSnap.ref.child('offer').on('value', async offerSnap => {
      const offer = offerSnap.val();
      if (!offer || rtcPeerConnections[viewerSafeKey]) return;

      const pc = new RTCPeerConnection(rtcConfig);
      rtcPeerConnections[viewerSafeKey] = pc;

      // 1. ICE adaylarını izleyiciye aktar
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          viewerNodeSnap.ref.child('hostCandidates').push(event.candidate.toJSON());
        }
      };

      // 2. Sahneye çıkan konuşmacının sesini yakala ve hem dinle hem yayına karıştır
      pc.ontrack = (event) => {
        if (event.track && event.track.kind === 'audio') {
          const speakerStream = new MediaStream([event.track]);

          // A) Yayıncının hoparlöründen dinlet
          let audioEl = document.getElementById(`speaker-audio-${viewerSafeKey}`);
          if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `speaker-audio-${viewerSafeKey}`;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
          }
          audioEl.srcObject = speakerStream;
          audioEl.play().catch(e => console.warn("Speaker hoparlör çalma:", e));

          // B) Miksere bağla (Diğer tüm izleyicilerin de duyması için)
          if (broadcastAudioCtx && broadcastAudioDest) {
            try {
              if (broadcastAudioCtx.state === 'suspended') broadcastAudioCtx.resume();
              const source = broadcastAudioCtx.createMediaStreamSource(speakerStream);
              source.connect(broadcastAudioDest);
            } catch(e) {
              console.warn("Mikser bağlantı hatası:", e);
            }
          }
        }
      };

      // 3. İzleyicinin adaylarını tamponlayarak kabul et
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

      // 4. Uzak teklifi ayarla
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Kuyruktaki adayları boşalt
      for (const cand of candidateQueue) {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
      candidateQueue = [];

      // 5. Video ve mikser sesini kanallara bağla
      if (localMediaStream && localMediaStream.getVideoTracks().length > 0) {
        pc.addTrack(localMediaStream.getVideoTracks()[0], localMediaStream);
      }

      const mixedAudioTrack = (broadcastAudioDest && broadcastAudioDest.stream.getAudioTracks()[0])
        || (localMediaStream && localMediaStream.getAudioTracks()[0]);

      if (mixedAudioTrack) {
        pc.addTrack(mixedAudioTrack, broadcastAudioDest ? broadcastAudioDest.stream : localMediaStream);
      }

      // 6. Cevap üret ve gönder
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await viewerNodeSnap.ref.child('answer').set({
        sdp: answer.sdp,
        type: answer.type
      });
    });
  });
}

// İzleyici tarafı: Yayını alır ve ekrana basar
async function initViewerWebRTC(roomId) {
  if (!fbDb || !CurrentUser) return;
  const mySafeKey = sanitizeFbKey(CurrentUser.username);
  const pc = new RTCPeerConnection(rtcConfig);
  rtcPeerConnections[mySafeKey] = pc;

  const mySigRef = fbDb.ref(`liveRooms/${roomId}/signaling/${mySafeKey}`);
  await mySigRef.remove();

  let candidateQueue = [];

  // Tek ve birleşik inbound stream (Video ve ses birbirini ezmez)
  const inboundStream = new MediaStream();
  const videoEl = document.getElementById('live-host-video');
  const placeholderEl = document.getElementById('live-video-placeholder');
  if (videoEl) {
    videoEl.srcObject = inboundStream;
  }

  pc.ontrack = (event) => {
    if (event.track) {
      inboundStream.addTrack(event.track);
      if (event.track.kind === 'video' && placeholderEl) {
        placeholderEl.classList.add('hidden');
      }
      if (videoEl) {
        videoEl.play().catch(() => {
          // Autoplay engeli varsa sessiz başlatıp devam et
          videoEl.muted = true;
          videoEl.play();
        });
      }
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      mySigRef.child('viewerCandidates').push(event.candidate.toJSON());
    }
  };

  // Video sadece izlenir, ses çift yönlü (söz hakkı için) rezerve edilir
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'sendrecv' });

  // Yayıncının adaylarını tamponla ve remoteDescription sonrası ekle
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

  // Yayıncının cevabını dinle
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

// ================= SAHNE & SÖZ ALMA SİSTEMİ =================

// İzleyici tıklandığında mikrofon iznini hemen alır
async function toggleRaiseHand() {
  if (!activeLiveRoom || !CurrentUser) return;
  hasHandRaised = !hasHandRaised;

  const btnText = document.getElementById('raise-hand-text');
  const btn = document.getElementById('btn-raise-hand');
  const uSafeKey = sanitizeFbKey(CurrentUser.username);

  if (hasHandRaised) {
    if (!localMediaStream) {
      try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        // Söz verilene kadar mikrofon sessizde bekler
        localMediaStream.getAudioTracks().forEach(t => t.enabled = false);
      } catch (err) {
        hasHandRaised = false;
        showToast("⚠️ Mikrofon izni verilmediği için söz istenemez.", "warning");
        return;
      }
    }

    if (btnText) btnText.innerText = "İsteği Geri Çek";
    if (btn) btn.className = "px-4 py-2 rounded-xl bg-amber-600 text-white font-black flex items-center gap-2 cursor-pointer shadow-lg";

    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${uSafeKey}`).set({
        username: CurrentUser.username,
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

// Yayıncı onayladığında izleyicinin sesini yayına basar
async function checkSpeakerStatus(speakersObj) {
  if (!CurrentUser || !activeLiveRoom) return;
  const isHost = activeLiveRoom.host.toLowerCase() === CurrentUser.username.toLowerCase();
  if (isHost) return;

  const uSafeKey = sanitizeFbKey(CurrentUser.username);
  const isSpeakerNow = !!speakersObj[uSafeKey] || !!speakersObj[CurrentUser.username];
  const pc = rtcPeerConnections[uSafeKey];

  if (isSpeakerNow) {
    if (!localMediaStream) {
      try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch(e) {
        showToast("⚠️ Mikrofon bulunamadı.", "warning");
        return;
      }
    }

    localMediaStream.getAudioTracks().forEach(t => t.enabled = true);

    if (pc && localMediaStream) {
      const audioTrack = localMediaStream.getAudioTracks()[0];
      const senders = pc.getSenders();
      const audioSender = senders.find(s => (s.track && s.track.kind === 'audio') || s.track === null);
      if (audioSender) {
        await audioSender.replaceTrack(audioTrack);
      } else {
        pc.addTrack(audioTrack, localMediaStream);
      }
    }
    showToast("🎙️ Yayıncı söz verdi! Sesiniz canlı yayında!", "success");
  } else if (!isSpeakerNow && localMediaStream) {
    if (pc) {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender) audioSender.replaceTrack(null);
    }
    localMediaStream.getTracks().forEach(t => t.stop());
    localMediaStream = null;
    showToast("🛑 Söz hakkınız sona erdi.", "info");
  }
}

function openSpeakerRequestsModal() {
  openModal('modal-speaker-requests');
}

function renderSpeakerRequestsList(raisesObj) {
  const container = document.getElementById('speaker-requests-list');
  if (!container) return;
  container.innerHTML = "";

  const entries = Object.keys(raisesObj).map(key => ({
    safeKey: key,
    username: raisesObj[key].username || key
  }));

  if (entries.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-slate-500 text-xs notranslate" translate="no">Şu an söz isteyen yok.</div>`;
    return;
  }

  entries.forEach(item => {
    const row = document.createElement('div');
    row.className = 'p-3 rounded-2xl border flex items-center justify-between text-xs bg-mineora-bg border-mineora-border notranslate';
    row.setAttribute('translate', 'no');
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-hand text-amber-400"></i>
        <strong class="text-white">${item.username}</strong>
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
  const safe = sanitizeFbKey(uname);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/speakers/${safe}`).set(true);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${safe}`).remove();
  showToast(`🎤 ${uname} sahneye eklendi!`, "success");
}

function rejectSpeakerRequest(uname) {
  if (!activeLiveRoom || !fbDb) return;
  const safe = sanitizeFbKey(uname);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/handRaises/${safe}`).remove();
}

function revokeSpeakerPermission(uname) {
  if (!activeLiveRoom || !fbDb) return;
  const safe = sanitizeFbKey(uname);
  fbDb.ref(`liveRooms/${activeLiveRoom.id}/speakers/${safe}`).remove();
  showToast(`🛑 ${uname} söz hakkı alındı.`, "info");
}

function renderStageSpeakers(speakersObj) {
  const container = document.getElementById('stage-speakers-list');
  const countEl = document.getElementById('stage-speakers-count');
  if (!container) return;
  container.innerHTML = "";

  const speakers = Object.keys(speakersObj);
  if (countEl) countEl.innerText = `${speakers.length} Konuşmacı`;

  speakers.forEach(uname => {
    const badge = document.createElement('div');
    badge.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-mineora-bg border border-mineora-border text-xs text-slate-200 font-bold shadow notranslate";
    badge.setAttribute('translate', 'no');
    badge.innerHTML = `
      <i class="fa-solid fa-microphone text-mineora-gold text-[10px] animate-pulse"></i>
      <span>${uname}</span>
      ${(activeLiveRoom && activeLiveRoom.host.toLowerCase() === CurrentUser?.username.toLowerCase() && uname.toLowerCase() !== CurrentUser?.username.toLowerCase()) ? `
        <button type="button" onclick="revokeSpeakerPermission('${uname}')" class="ml-1 text-slate-500 hover:text-rose-400 cursor-pointer" title="Sözü Geri Al">
          <i class="fa-solid fa-xmark"></i>
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
      leaveCurrentRoom();
      return;
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

// ================= CANLI CHAT =================
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
    role: CurrentUser.role || "Miner",
    text: text,
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  };

  appendChatMessage(msgData);

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`liveRooms/${activeLiveRoom.id}/chat`).push(msgData);
  }

  if (inputEl) inputEl.value = "";
}

function appendChatMessage(msg) {
  const container = document.getElementById('live-chat-messages');
  if (!container || !msg) return;

  const isMe = CurrentUser && CurrentUser.username.toLowerCase() === (msg.sender || "").toLowerCase();
  const div = document.createElement('div');
  div.className = "notranslate p-2 rounded-xl text-xs " + (isMe ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-mineora-bg border border-mineora-border');
  div.setAttribute('translate', 'no');
  if (msg.id) div.setAttribute('data-chat-id', msg.id);

  div.innerHTML = `
    <div class="flex items-center justify-between text-[10px] text-slate-400 mb-0.5 font-mono">
      <span class="font-bold ${isMe ? 'text-rose-400' : 'text-mineora-gold'}">${msg.sender} <span class="text-slate-500 font-normal">(${msg.role})</span></span>
      <span>${msg.time || ''}</span>
    </div>
    <p class="text-slate-200 break-words leading-relaxed notranslate" translate="no">${msg.text}</p>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ================= KAMERA & MİKROFON BUTONLARI =================
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