// ================= 3. KAZI & SAHA MOTORU (mining.js) =================
let activeMineIdx = 0, wagonFill = 0, currentWagonStage = 1, isTransitLocked = false;
let powerBarValue = 0, powerBarDirection = 1, powerBarSpeed = 2.4, powerBarInterval = null;
let isSwinging = false, swingFrame = 0, lanternSway = 0;
let rockParticles = [], mCanvas, mCtx, mFrame;

function initMineCanvas() {
  mCanvas = document.getElementById('mine-canvas');
  if (!mCanvas) return;
  mCtx = mCanvas.getContext('2d');
  mCanvas.width = mCanvas.clientWidth || 800;
  mCanvas.height = mCanvas.clientHeight || 450;
  cancelAnimationFrame(mFrame);
  renderMineLoop();
  startPowerBarLoop();
}

function startPowerBarLoop() {
  if (powerBarInterval) clearInterval(powerBarInterval);
  powerBarInterval = setInterval(() => {
    const secCave = document.getElementById('sec-cave');
    if (!secCave || secCave.classList.contains('hidden') || isTransitLocked) return;
    powerBarValue += powerBarSpeed * powerBarDirection;
    if (powerBarValue >= 96) { powerBarValue = 96; powerBarDirection = -1; }
    else if (powerBarValue <= 2) { powerBarValue = 2; powerBarDirection = 1; }
    const ind = document.getElementById('power-bar-indicator');
    if (ind) ind.style.left = `${powerBarValue}%`;
  }, 25);
}

function performMiningStrike() {
  if (isTransitLocked || isSwinging || !CurrentUser) return;

  isSwinging = true;
  swingFrame = 1;
  const isSweetSpot = powerBarValue >= 35 && powerBarValue <= 75;
  const fillAmount = isSweetSpot ? 14 : 7;

  playPickaxeSound(isSweetSpot);

  setTimeout(() => {
    swingFrame = 2;
    spawnRockDebris(isSweetSpot);

    wagonFill = Math.min(100, wagonFill + fillAmount);

    const crystalDropChance = isSweetSpot ? 0.08 : 0.03;
    if (Math.random() < crystalDropChance) {
      CurrentUser.alpCrystals = (CurrentUser.alpCrystals || 0) + 1;
      showToast("💎 Nadir Alp Kristali Çıkarıldı! (+1 Asansör Bileti)", "success");
    }

    const wagonFillEl = document.getElementById('wagon-fill-text');
    if (wagonFillEl) wagonFillEl.innerText = `${wagonFill}%`;

    showFloatingReward(
      isSweetSpot ? `⚡ KRİTİK VURUŞ! +%${fillAmount}` : `+ %${fillAmount}`,
      isSweetSpot ? "#facc15" : "#0ecb81"
    );

    updateHUD();
    saveUserWorld();

    if (wagonFill >= 100) setTimeout(() => triggerWagonFull(), 400);
  }, 120);

  setTimeout(() => { isSwinging = false; swingFrame = 0; }, 300);
}

function spawnRockDebris(isCritical) {
  const w = mCanvas ? mCanvas.width : 800;
  const h = mCanvas ? mCanvas.height : 450;
  const strikeX = w * 0.36;
  const strikeY = h * 0.58;

  const count = isCritical ? 18 : 8;
  for (let i = 0; i < count; i++) {
    rockParticles.push({
      x: strikeX, y: strikeY,
      vx: (Math.random() * 6 + 2), vy: -(Math.random() * 5 + 2),
      size: Math.random() * 5 + 3,
      color: Math.random() < 0.6 ? '#f59e0b' : '#78350f',
      life: 25
    });
  }

  const v = document.getElementById('mine-viewport');
  if (v && isCritical) {
    v.classList.add('screen-shake');
    setTimeout(() => v.classList.remove('screen-shake'), 180);
  }
}

function renderMineLoop() {
  const sec = document.getElementById('sec-cave');
  if (!mCtx || !sec || sec.classList.contains('hidden')) return;

  const w = mCanvas.width, h = mCanvas.height;
  mCtx.fillStyle = '#06080b';
  mCtx.fillRect(0, 0, w, h);

  mCtx.fillStyle = '#17120e';
  mCtx.beginPath();
  mCtx.moveTo(0, 0); mCtx.lineTo(w * 0.42, 0); mCtx.lineTo(w * 0.36, h); mCtx.lineTo(0, h);
  mCtx.closePath(); mCtx.fill();

  mCtx.strokeStyle = '#f59e0b';
  mCtx.lineWidth = 3;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.22, h * 0.2); mCtx.lineTo(w * 0.34, h * 0.45); mCtx.lineTo(w * 0.28, h * 0.75);
  mCtx.stroke();

  lanternSway = Math.sin(Date.now() / 600) * 8;
  const lanternX = w * 0.52 + lanternSway, lanternY = 85;
  mCtx.strokeStyle = '#334155'; mCtx.lineWidth = 2;
  mCtx.beginPath(); mCtx.moveTo(w * 0.52, 0); mCtx.lineTo(lanternX, lanternY - 14);
  mCtx.stroke();
  mCtx.fillStyle = '#fef08a'; mCtx.beginPath(); mCtx.arc(lanternX, lanternY, 9, 0, Math.PI * 2); mCtx.fill();

  const roomLight = mCtx.createRadialGradient(lanternX, lanternY, 5, lanternX, lanternY, 260);
  roomLight.addColorStop(0, 'rgba(254, 240, 138, 0.45)');
  roomLight.addColorStop(0.5, 'rgba(245, 158, 11, 0.12)');
  roomLight.addColorStop(1, 'rgba(0, 0, 0, 0)');
  mCtx.fillStyle = roomLight;
  mCtx.fillRect(0, 0, w, h);

  mCtx.fillStyle = '#0f172a';
  mCtx.fillRect(0, h - 35, w, 35);
  mCtx.strokeStyle = '#475569'; mCtx.lineWidth = 4;
  mCtx.beginPath(); mCtx.moveTo(w * 0.40, h - 25); mCtx.lineTo(w, h - 25); mCtx.stroke();

  const wagonX = w * 0.72, wagonY = h - 68, wagonW = 100, wagonH = 50;
  mCtx.fillStyle = '#334155';
  mCtx.beginPath();
  mCtx.arc(wagonX + 22, wagonY + wagonH + 2, 9, 0, Math.PI * 2);
  mCtx.arc(wagonX + wagonW - 22, wagonY + wagonH + 2, 9, 0, Math.PI * 2);
  mCtx.fill();

  mCtx.fillStyle = '#1e293b';
  mCtx.fillRect(wagonX, wagonY, wagonW, wagonH);
  mCtx.strokeStyle = '#64748b'; mCtx.lineWidth = 3;
  mCtx.strokeRect(wagonX, wagonY, wagonW, wagonH);

  if (wagonFill > 0) {
    const fillH = (wagonFill / 100) * 32;
    mCtx.fillStyle = currentWagonStage === 2 ? '#c084fc' : '#f59e0b';
    mCtx.beginPath();
    mCtx.moveTo(wagonX + 5, wagonY + 10);
    mCtx.quadraticCurveTo(wagonX + wagonW / 2, wagonY - fillH, wagonX + wagonW - 5, wagonY + 10);
    mCtx.fill();
  }

  const minerX = w * 0.44, minerY = h - 110;
  mCtx.save();
  mCtx.translate(minerX, minerY);

  mCtx.fillStyle = '#0f172a';
  mCtx.fillRect(-12, 50, 10, 35);
  mCtx.fillRect(4, 50, 10, 35);

  mCtx.fillStyle = '#ea580c';
  mCtx.fillRect(-14, 15, 28, 38);

  mCtx.fillStyle = '#fdba74';
  mCtx.beginPath(); mCtx.arc(0, 4, 11, 0, Math.PI * 2); mCtx.fill();

  mCtx.fillStyle = '#facc15';
  mCtx.beginPath(); mCtx.arc(0, 0, 13, Math.PI, 0); mCtx.fill();

  mCtx.fillStyle = '#ffffff';
  mCtx.fillRect(-14, -4, 6, 6);

  const headlampBeam = mCtx.createRadialGradient(-14, -2, 2, -130, 10, 160);
  headlampBeam.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  headlampBeam.addColorStop(0.3, 'rgba(254, 240, 138, 0.4)');
  headlampBeam.addColorStop(1, 'rgba(0, 0, 0, 0)');
  mCtx.fillStyle = headlampBeam;
  mCtx.beginPath();
  mCtx.moveTo(-14, -2); mCtx.lineTo(-180, -60);
  mCtx.lineTo(-180, 80);
  mCtx.closePath(); mCtx.fill();

  mCtx.save();
  let handleStartX, handleStartY, handleEndX, handleEndY, headCenterX, headCenterY, headAngle;

  if (swingFrame === 0) {
    handleStartX = -4; handleStartY = 24; handleEndX = -30; handleEndY = 6;
    headCenterX = -30; headCenterY = 6; headAngle = -0.5;
    mCtx.strokeStyle = '#ea580c'; mCtx.lineWidth = 6;
    mCtx.beginPath(); mCtx.moveTo(-6, 20); mCtx.lineTo(-14, 24); mCtx.stroke();
  } else if (swingFrame === 1) {
    handleStartX = -2; handleStartY = 18; handleEndX = 22; handleEndY = -32;
    headCenterX = 22; headCenterY = -32; headAngle = 0.8;
    mCtx.strokeStyle = '#ea580c'; mCtx.lineWidth = 6;
    mCtx.beginPath(); mCtx.moveTo(-6, 18); mCtx.lineTo(6, 4); mCtx.stroke();
  } else {
    handleStartX = -4; handleStartY = 24; handleEndX = -58; handleEndY = 36;
    headCenterX = -58; headCenterY = 36; headAngle = -1.6;
    mCtx.strokeStyle = '#ea580c'; mCtx.lineWidth = 6;
    mCtx.beginPath(); mCtx.moveTo(-6, 20); mCtx.lineTo(-28, 28); mCtx.stroke();
  }

  mCtx.strokeStyle = '#854d0e';
  mCtx.lineWidth = 4;
  mCtx.lineCap = 'round';
  mCtx.beginPath();
  mCtx.moveTo(handleStartX, handleStartY); mCtx.lineTo(handleEndX, handleEndY);
  mCtx.stroke();

  mCtx.save();
  mCtx.translate(headCenterX, headCenterY);
  mCtx.rotate(headAngle);

  mCtx.fillStyle = '#94a3b8';
  mCtx.strokeStyle = '#cbd5e1';
  mCtx.lineWidth = 1.5;
  mCtx.beginPath();
  mCtx.moveTo(-22, -4); mCtx.lineTo(0, -6);
  mCtx.lineTo(22, -4);
  mCtx.lineTo(26, 0);
  mCtx.lineTo(20, 2);
  mCtx.lineTo(0, 4);
  mCtx.lineTo(-20, 2);
  mCtx.lineTo(-26, 0);
  mCtx.closePath();
  mCtx.fill();
  mCtx.stroke();

  mCtx.fillStyle = '#475569';
  mCtx.fillRect(-4, -6, 8, 12);
  mCtx.restore();

  mCtx.fillStyle = '#451a03';
  mCtx.beginPath(); mCtx.arc(handleStartX, handleStartY, 4.5, 0, Math.PI * 2);
  mCtx.fill();

  mCtx.restore();
  mCtx.restore();

  for (let i = rockParticles.length - 1; i >= 0; i--) {
    const p = rockParticles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.life--;
    mCtx.fillStyle = p.color;
    mCtx.fillRect(p.x, p.y, p.size, p.size);
    if (p.life <= 0) rockParticles.splice(i, 1);
  }

  mFrame = requestAnimationFrame(renderMineLoop);
}

let mapCooldownTimer = null;
function renderAlpMapPins() {
  const c = document.getElementById('alp-map-container');
  if (!c || !CurrentUser) return;
  c.querySelectorAll('.mine-pin').forEach(p => p.remove());
  const coords = [
    { top: '55%', left: '15%' }, { top: '40%', left: '35%' },
    { top: '28%', left: '55%' }, { top: '60%', left: '75%' }, { top: '20%', left: '85%' }
  ];

  const now = Date.now();
  CurrentUser.mines.forEach((mine, idx) => {
    const p = coords[idx];
    const isDep = mine.depleted;
    let timeRemainingText = "";

    if (isDep && mine.sealedAt) {
      const leftMs = Math.max(0, COOLDOWN_24H_MS - (now - mine.sealedAt));
      const leftHours = Math.floor(leftMs / (1000 * 60 * 60));
      const leftMins = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
      const leftSecs = Math.floor((leftMs % (1000 * 60)) / 1000);
      timeRemainingText = `${leftHours}s ${leftMins}d ${leftSecs}sn`;
    }

    let icon = isDep ? 'fa-lock' : 'fa-gem';
    let bg = isDep 
      ? 'bg-mineora-card text-rose-500 border-rose-500/40 cursor-not-allowed opacity-80' 
      : 'bg-mineora-gold text-black border-yellow-200 hover:scale-110 shadow-xl cursor-pointer';
      
    let badge = isDep 
      ? `<span class="mt-1 px-2 py-0.5 rounded bg-mineora-red/90 text-white text-[9px] font-mono font-bold flex items-center gap-1 shadow"><i class="fa-solid fa-clock"></i> ${timeRemainingText}</span>`
      : `<span class="mt-1 px-2.5 py-1 rounded-xl bg-mineora-card/90 border border-mineora-gold/40 text-[11px] font-black text-mineora-gold shadow-lg">${idx+1}. ${mine.name.split(' ')[0]}</span>`;

    const btn = document.createElement('button');
    btn.className = `mine-pin absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group transition transform z-20`;
    btn.style.top = p.top; btn.style.left = p.left;
    btn.onclick = () => selectMine(idx);
    btn.innerHTML = `<div class="w-12 h-12 rounded-2xl ${bg} flex items-center justify-center font-black border-2 text-lg"><i class="fa-solid ${icon}"></i></div>${badge}`;
    c.appendChild(btn);
  });

  if (!mapCooldownTimer) {
    mapCooldownTimer = setInterval(() => {
      const secMap = document.getElementById('sec-map');
      if (secMap && !secMap.classList.contains('hidden')) {
        checkMinesCooldown();
        renderAlpMapPins();
        updateHUD();
      }
    }, 1000);
  }
}

function selectMine(idx) {
  if (!CurrentUser) return;

  checkMinesCooldown();
  const m = CurrentUser.mines[idx];
  if (m.depleted) {
    const now = Date.now();
    const leftMs = Math.max(0, COOLDOWN_24H_MS - (now - (m.sealedAt || now)));
    const leftHours = Math.floor(leftMs / (1000 * 60 * 60));
    const leftMins = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
    showToast(`⏳ Bu maden mühürlüdür! Kalan dinlenme süresi: ${leftHours} saat ${leftMins} dakika.`, "warning");
    return;
  }

  activeMineIdx = idx; wagonFill = 0; currentWagonStage = 1; isTransitLocked = false; rockParticles = [];
  document.getElementById('transit-overlay')?.classList.add('hidden');
  document.getElementById('active-mine-title').innerText = m.name;
  document.getElementById('active-mine-mineral').innerText = `Cevher: ${m.mineral}`;
  document.getElementById('wagon-round-indicator').innerText = "Vagon: 1 / 2";
  document.getElementById('wagon-fill-text').innerText = `${wagonFill}%`;
  switchTab('cave');
  showToast(`⛏️ ${m.name} sahasına girildi! Vagonu doldurmak için kazma vurun.`, "info");
}

function showFloatingReward(text, color = '#f0b90b') {
  const container = document.getElementById('floating-text-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'absolute font-black font-mono text-xs floating-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]';
  el.style.left = '44%'; el.style.top = '40%'; el.style.color = color; el.innerText = text;
  container.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function triggerWagonFull() {
  isTransitLocked = true;
  document.getElementById('transit-overlay')?.classList.remove('hidden');
  document.getElementById('transit-timer-box')?.classList.add('hidden');
  document.getElementById('btn-dispatch-wagon')?.classList.remove('hidden');

  if (currentWagonStage === 1) {
    document.getElementById('transit-title').innerText = "1. Vagon Doldu!";
    document.getElementById('transit-desc').innerText = "1. vagonu yüzey asansörüne sevk edin. Vagon 15 saniyede boşaltılıp yeni vagon indirilecektir.";
    document.getElementById('btn-dispatch-text').innerText = "1. Vagonu Sevk Et (15s)";
  } else {
    document.getElementById('transit-title').innerText = "2. Vagon Doldu & Maden Tamamlandı!";
    document.getElementById('transit-desc').innerText = "Son vagon tahliye ediliyor (5s). Tamamlanınca günlük kazancınız doğrudan TL cüzdanınıza aktarılacaktır.";
    document.getElementById('btn-dispatch-text').innerText = "Son Vagonu Tahliye Et (5s & Mühürle)";
  }
}

function startElevatorDispatch() {
  document.getElementById('btn-dispatch-wagon')?.classList.add('hidden');
  document.getElementById('transit-timer-box')?.classList.remove('hidden');
  let countdown = (currentWagonStage === 1) ? 15 : 5;
  const timerText = document.getElementById('transit-countdown');
  const subText = document.getElementById('transit-subtext');
  if (timerText) timerText.innerText = countdown;

  if (currentWagonStage === 1) {
    if (subText) subText.innerText = "1. Vagon yüzeye çıkarılıyor...";
    showToast("🚀 1. Vagon sevk ediliyor (15s)...", "info");
  } else {
    if (subText) subText.innerText = "Son vagon tahliye ediliyor, maden kapatılıyor...";
    showToast("⚡ Son vagon tahliyesi başladı (5s)...", "info");
  }

  const iv = setInterval(() => {
    countdown--;
    if (timerText) timerText.innerText = countdown;
    if (countdown <= 0) {
      clearInterval(iv);
      if (currentWagonStage === 1) {
        currentWagonStage = 2; wagonFill = 0; isTransitLocked = false; rockParticles = [];
        document.getElementById('transit-overlay')?.classList.add('hidden');
        document.getElementById('wagon-fill-text').innerText = "0%";
        document.getElementById('wagon-round-indicator').innerText = "Vagon: 2 / 2 (Derin Damar)";
        showToast("✅ 1. Vagon boşaltıldı! 2. vagon bağlandı, kazıya devam edin!", "success");
      } else {
        const m = CurrentUser.mines[activeMineIdx];
        m.depleted = true; m.sealedAt = Date.now(); m.hp = 0; wagonFill = 0;

        // DOĞRUDAN TÜRK LİRASI KAZANCI
        const earnedTl = 25.00; // Maden başı 25 ₺ (5 maden tamamlandığında günlük 125 ₺ kazanç)
        CurrentUser.tl = Number(((CurrentUser.tl || 0) + earnedTl).toFixed(2));
        showToast(`💰 Maden Tamamlandı! +${earnedTl.toFixed(2)} ₺ cüzdanınıza aktarıldı!`, "success");

        addUserNotificationLog(CurrentUser, "Maden Kazısı Tamamlandı", `${m.name} sahasından 2 vagon sevk edildi.`, `+${earnedTl.toFixed(2)} ₺`, "income");
        saveUserWorld(); 
        updateHUD();
        setTimeout(() => { document.getElementById('transit-overlay')?.classList.add('hidden'); switchTab('map'); renderAlpMapPins(); }, 800);
      }
    }
  }, 1000);
}
