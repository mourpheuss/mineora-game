// ================= LİSANSA GÖRE GÜNLÜK TL KAZANDIRAN MADEN KAZI MOTORU (mining.js) =================
let activeMineIdx = 0, wagonFill = 0, currentWagonStage = 1, isTransitLocked = false;
let powerBarValue = 0, powerBarDirection = 1, powerBarSpeed = 2.4, powerBarInterval = null;
let isSwinging = false, swingFrame = 0, lanternSway = 0, lanternFlicker = 1;
let rockParticles = [], ambientDust = [], mCanvas, mCtx, mFrame;

function initAmbientDust(w, h) {
  ambientDust = [];
  for (let i = 0; i < 40; i++) {
    ambientDust.push({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.8 + 0.5,
      speedX: (Math.random() - 0.5) * 0.4, speedY: Math.random() * 0.3 + 0.1,
      opacity: Math.random() * 0.6 + 0.2, pulse: Math.random() * Math.PI
    });
  }
}

function initMineCanvas() {
  mCanvas = document.getElementById('mine-canvas');
  if (!mCanvas) return;
  mCtx = mCanvas.getContext('2d');
  const w = mCanvas.clientWidth || 800;
  const h = mCanvas.clientHeight || 420;
  mCanvas.width = w;
  mCanvas.height = h;

  initAmbientDust(w, h);
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
      saveUserWorld();
      updateHUD();
    }

    const wagonFillEl = document.getElementById('wagon-fill-text');
    if (wagonFillEl) wagonFillEl.innerText = `${wagonFill}%`;

    showFloatingReward(
      isSweetSpot ? `⚡ KRİTİK VURUŞ! +%${fillAmount}` : `+ %${fillAmount}`,
      isSweetSpot ? "#facc15" : "#38bdf8"
    );

    if (wagonFill >= 100) {
      setTimeout(() => triggerWagonFull(), 400);
    }
  }, 110);

  setTimeout(() => { isSwinging = false; swingFrame = 0; }, 290);
}
window.performMiningStrike = performMiningStrike;

function spawnRockDebris(isCritical) {
  const w = mCanvas ? mCanvas.width : 800;
  const h = mCanvas ? mCanvas.height : 420;
  const strikeX = w * 0.35;
  const strikeY = h * 0.58;

  const count = isCritical ? 24 : 12;
  for (let i = 0; i < count; i++) {
    rockParticles.push({
      type: 'rock', x: strikeX, y: strikeY,
      vx: (Math.random() * 8 + 2), vy: -(Math.random() * 6 + 2),
      size: Math.random() * 5 + 3,
      color: Math.random() < 0.5 ? '#eab308' : (Math.random() < 0.8 ? '#78350f' : '#cbd5e1'),
      rot: Math.random() * Math.PI, vRot: (Math.random() - 0.5) * 0.3, life: 28, maxLife: 28
    });
  }

  const sparkCount = isCritical ? 30 : 14;
  for (let i = 0; i < sparkCount; i++) {
    const angle = (Math.random() * 0.8 - 0.4) * Math.PI;
    const spd = Math.random() * 9 + 4;
    rockParticles.push({
      type: 'spark', x: strikeX, y: strikeY,
      vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 2,
      size: Math.random() * 2.5 + 1.5,
      color: Math.random() < 0.6 ? '#fef08a' : '#f97316', life: 18, maxLife: 18
    });
  }

  const v = document.getElementById('mine-viewport');
  if (v && isCritical) {
    v.classList.add('screen-shake');
    setTimeout(() => v.classList.remove('screen-shake'), 180);
  }
}

function triggerWagonFull() {
  isTransitLocked = true;
  document.getElementById('transit-overlay')?.classList.remove('hidden');
  document.getElementById('transit-timer-box')?.classList.add('hidden');
  document.getElementById('btn-dispatch-wagon')?.classList.remove('hidden');

  if (currentWagonStage === 1) {
    document.getElementById('transit-title').innerText = "1. Vagon Doldu!";
    document.getElementById('transit-desc').innerText = "Yüklenen 1. vagonu yüzey asansörüne sevk edin. Vagon 15 saniyede boşaltılacaktır.";
    document.getElementById('btn-dispatch-text').innerText = "1. Vagonu Sevk Et (15s)";
  } else {
    document.getElementById('transit-title').innerText = "2. Vagon Doldu & Maden Tamamlandı!";
    document.getElementById('transit-desc').innerText = "Son vagon tahliye ediliyor. Maden 24 saat mühürlenecek ve kazancınız doğrudan TL cüzdanınıza aktarılacaktır.";
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
    if (subText) subText.innerText = "Son vagon çekiliyor, TL kazancı aktarılıyor...";
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

        // TOPLAM GÜNLÜK HAKKIN 5 MADENE EŞİT DAĞITILMASI
        const totalDailyTl = (typeof calculateTotalDailyReturnTl === 'function') ? calculateTotalDailyReturnTl(CurrentUser) : 0;
        const mineShareTl = Number((totalDailyTl / 5).toFixed(2));

        if (mineShareTl > 0) {
          CurrentUser.tl = Number(((CurrentUser.tl || 0) + mineShareTl).toFixed(2));
          addUserNotificationLog(CurrentUser, "Maden Kazısı Tamamlandı", `${m.name} tamamlandı. Günlük payınız aktarıldı.`, `+${mineShareTl.toFixed(2)} ₺`, "income");
          showToast(`💰 Maden Tamamlandı! +${mineShareTl.toFixed(2)} ₺ cüzdanınıza yansıtıldı! (Toplam günlük hak: ${totalDailyTl.toFixed(2)} ₺)`, "success");
        } else {
          showToast(`⛏️ Maden Tamamlandı! Aktif lisansınız olmadığı için TL kazancı üretilmedi. Kariyer Lisansı alabilirsiniz.`, "info");
        }

        saveUserWorld(); 
        updateHUD();

        setTimeout(() => {
          document.getElementById('transit-overlay')?.classList.add('hidden');
          switchTab('map');
          renderAlpMapPins();
        }, 800);
      }
    }
  }, 1000);
}
window.startElevatorDispatch = startElevatorDispatch;

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

  activeMineIdx = idx;
  wagonFill = 0;
  currentWagonStage = 1;
  isTransitLocked = false;
  rockParticles = [];
  document.getElementById('transit-overlay')?.classList.add('hidden');
  document.getElementById('active-mine-title').innerText = m.name;
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

function renderMineLoop() {
  const sec = document.getElementById('sec-cave');
  if (!mCtx || !sec || sec.classList.contains('hidden')) return;

  const w = mCanvas.width, h = mCanvas.height;
  const caveBg = mCtx.createRadialGradient(w * 0.4, h * 0.4, 20, w * 0.5, h * 0.5, w * 0.8);
  caveBg.addColorStop(0, '#151118');
  caveBg.addColorStop(0.5, '#0c0a0e');
  caveBg.addColorStop(1, '#030304');
  mCtx.fillStyle = caveBg;
  mCtx.fillRect(0, 0, w, h);

  const rockGrad = mCtx.createLinearGradient(0, 0, w * 0.42, 0);
  rockGrad.addColorStop(0, '#1c1713');
  rockGrad.addColorStop(0.7, '#2b2119');
  rockGrad.addColorStop(1, '#18120d');

  mCtx.fillStyle = rockGrad;
  mCtx.beginPath();
  mCtx.moveTo(0, 0);
  mCtx.lineTo(w * 0.42, 0);
  mCtx.bezierCurveTo(w * 0.39, h * 0.35, w * 0.45, h * 0.65, w * 0.35, h);
  mCtx.lineTo(0, h);
  mCtx.closePath();
  mCtx.fill();

  lanternSway = Math.sin(Date.now() / 700) * 6;
  lanternFlicker = 0.94 + Math.random() * 0.12;
  const lanternX = w * 0.52 + lanternSway, lanternY = 82;

  mCtx.strokeStyle = '#475569';
  mCtx.lineWidth = 2;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.52, 0);
  mCtx.lineTo(lanternX, lanternY - 14);
  mCtx.stroke();

  const groundY = h - 35;
  mCtx.fillStyle = '#0b0c10';
  mCtx.fillRect(0, groundY, w, 35);

  const wagonX = w * 0.70, wagonY = groundY - 48, wagonW = 110, wagonH = 46;
  if (wagonFill > 0) {
    const fillRatio = wagonFill / 100;
    const oreHeight = fillRatio * 32;
    mCtx.save();
    mCtx.fillStyle = '#d97706';
    mCtx.beginPath();
    mCtx.moveTo(wagonX + 6, wagonY + 6);
    mCtx.quadraticCurveTo(wagonX + wagonW / 2, wagonY - oreHeight, wagonX + wagonW - 6, wagonY + 6);
    mCtx.fill();
    mCtx.restore();
  }

  mCtx.fillStyle = '#1e293b';
  mCtx.beginPath();
  mCtx.moveTo(wagonX, wagonY);
  mCtx.lineTo(wagonX + wagonW, wagonY);
  mCtx.lineTo(wagonX + wagonW - 10, wagonY + wagonH);
  mCtx.lineTo(wagonX + 10, wagonY + wagonH);
  mCtx.closePath();
  mCtx.fill();

  const minerX = w * 0.43, minerY = groundY - 82;
  mCtx.save();
  mCtx.translate(minerX, minerY);
  mCtx.fillStyle = '#c2410c';
  mCtx.fillRect(-16, 14, 32, 38);
  mCtx.fillStyle = '#fdba74';
  mCtx.beginPath(); mCtx.arc(0, 3, 11, 0, Math.PI * 2); mCtx.fill();
  mCtx.fillStyle = '#eab308';
  mCtx.beginPath(); mCtx.arc(0, -2, 13, Math.PI, 0); mCtx.fill();
  mCtx.restore();

  for (let i = rockParticles.length - 1; i >= 0; i--) {
    const p = rockParticles[i];
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.type === 'spark') {
      p.vy += 0.15;
      mCtx.fillStyle = p.color;
      mCtx.beginPath(); mCtx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2); mCtx.fill();
    } else {
      p.vy += 0.38;
      mCtx.fillStyle = p.color;
      mCtx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    if (p.life <= 0) rockParticles.splice(i, 1);
  }

  mFrame = requestAnimationFrame(renderMineLoop);
}
