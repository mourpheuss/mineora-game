// ================= 3. KAZI & SAHA MOTORU (mining.js) =================
let activeMineIdx = 0, wagonFill = 0, currentWagonStage = 1, isTransitLocked = false;
let powerBarValue = 0, powerBarDirection = 1, powerBarSpeed = 2.4, powerBarInterval = null;
let isSwinging = false, swingFrame = 0, lanternSway = 0, lanternFlicker = 1;
let rockParticles = [], ambientDust = [], mCanvas, mCtx, mFrame;

function initAmbientDust(w, h) {
  ambientDust = [];
  for (let i = 0; i < 40; i++) {
    ambientDust.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.8 + 0.5,
      speedX: (Math.random() - 0.5) * 0.4,
      speedY: Math.random() * 0.3 + 0.1,
      opacity: Math.random() * 0.6 + 0.2,
      pulse: Math.random() * Math.PI
    });
  }
}

function initMineCanvas() {
  mCanvas = document.getElementById('mine-canvas');
  if (!mCanvas) return;
  mCtx = mCanvas.getContext('2d');
  const w = mCanvas.clientWidth || 800;
  const h = mCanvas.clientHeight || 450;
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

function spawnRockDebris(isCritical) {
  const w = mCanvas ? mCanvas.width : 800;
  const h = mCanvas ? mCanvas.height : 450;
  const strikeX = w * 0.35;
  const strikeY = h * 0.58;

  const count = isCritical ? 24 : 12;
  for (let i = 0; i < count; i++) {
    rockParticles.push({
      type: 'rock',
      x: strikeX, y: strikeY,
      vx: (Math.random() * 8 + 2),
      vy: -(Math.random() * 6 + 2),
      size: Math.random() * 5 + 3,
      color: Math.random() < 0.5 ? '#eab308' : (Math.random() < 0.8 ? '#78350f' : '#cbd5e1'),
      rot: Math.random() * Math.PI,
      vRot: (Math.random() - 0.5) * 0.3,
      life: 28, maxLife: 28
    });
  }

  const sparkCount = isCritical ? 30 : 14;
  for (let i = 0; i < sparkCount; i++) {
    const angle = (Math.random() * 0.8 - 0.4) * Math.PI;
    const spd = Math.random() * 9 + 4;
    rockParticles.push({
      type: 'spark',
      x: strikeX, y: strikeY,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 2,
      size: Math.random() * 2.5 + 1.5,
      color: Math.random() < 0.6 ? '#fef08a' : '#f97316',
      life: 18, maxLife: 18
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
    document.getElementById('transit-desc').innerText = "Yüklenen 1. vagonu yüzey asansörüne sevk edin. Vagon 15 saniyede yukarı çekilecek ve yeni boş vagon indirilecektir.";
    document.getElementById('btn-dispatch-text').innerText = "Vagonu Asansöre Sevk Et (15s)";
  } else {
    document.getElementById('transit-title').innerText = "2. Vagon Doldu & Maden Tamamlandı!";
    document.getElementById('transit-desc').innerText = "Son vagon asansöre alınıyor (5s tahliye). Tamamlanınca maden 24 saat mühürlenecek ve kazancınız kasanıza aktarılacaktır.";
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
    if (subText) subText.innerText = "1. Vagon asansöre yüklendi, yüzeye çıkarılıyor...";
    showToast("🚀 1. Vagon asansörde, tahliye ediliyor (15s)...", "info");
  } else {
    if (subText) subText.innerText = "Son vagon çekiliyor, maden kapatılıyor...";
    showToast("⚡ Son vagon tahliyesi başladı (5s)...", "info");
  }

  const iv = setInterval(() => {
    countdown--;
    if (timerText) timerText.innerText = countdown;

    if (countdown <= 0) {
      clearInterval(iv);

      if (currentWagonStage === 1) {
        currentWagonStage = 2;
        wagonFill = 0;
        isTransitLocked = false;
        rockParticles = [];
        document.getElementById('transit-overlay')?.classList.add('hidden');
        document.getElementById('wagon-fill-text').innerText = "0%";
        document.getElementById('wagon-round-indicator').innerText = "Vagon: 2 / 2 (Derin Damar)";
        showToast("✅ 1. Vagon boşaltıldı! 2. vagon bağlandı, kazıya devam edin!", "success");
      } else {
        const m = CurrentUser.mines[activeMineIdx];
        m.depleted = true;
        m.sealedAt = Date.now();
        m.hp = 0;
        wagonFill = 0;

        const role = CurrentUser.role || "Candidate";
        const isCycleActive = CurrentUser.cycleExpiresAt && Date.now() < CurrentUser.cycleExpiresAt;

        if (role === "Worker Miner" || role === "İşçi Madenci") {
          if (isCycleActive) {
            const earnedOra = 3.00;
            CurrentUser.ora = Number(((CurrentUser.ora || 0) + earnedOra).toFixed(2));

            if (typeof deductMinedOraFromMasterReserve === 'function') {
              deductMinedOraFromMasterReserve(earnedOra);
            }

            addUserNotificationLog(CurrentUser, "Maden Kazısı Tamamlandı", `${m.name} vardiyası tamamlandı (+%0.3 getiri).`, `+${earnedOra.toFixed(2)} ORA`, "income");
            showToast(`💰 Maden Tamamlandı! +${earnedOra.toFixed(2)} ORA cüzdanınıza yansıtıldı. (5 maden toplamı: Günlük %1.5)`, "success");
          } else {
            showToast("⚠️ 120 günlük lisans süreniz dolduğu için bu kazıdan ORA üretilmedi.", "warning");
          }
        } else if (role === "Maden Sahibi" || role === "Mine Owner" || role === "Holding Owner" || role === "Şirket Sahibi") {
          showToast("⛏️ Teftiş kazısı tamamlandı! İşletme sahipleri kazıdan ORA almaz, kazançları işçi filolarından gelir.", "info");
        } else {
          showToast("⛏️ Kazı tamamlandı! Aday üyeler ORA üretemez. ORA geliri için Kariyer Seçimi'nden lisans almalısınız.", "info");
        }

        saveUserWorld();
        updateHUD();
        distributeDailyMiningRoyalties(CurrentUser.username);

        setTimeout(() => {
          document.getElementById('transit-overlay')?.classList.add('hidden');
          switchTab('map');
          renderAlpMapPins();
        }, 800);
      }
    }
  }, 1000);
}

function distributeDailyMiningRoyalties(minerUsername) {
  if (!minerUsername) return;
  const miner = (typeof getStoredUser === 'function' ? getStoredUser(minerUsername) : null) || CurrentUser;
  if (!miner || !miner.referredBy) return;

  const sponsor = (typeof findUserByRefCode === 'function') ? findUserByRefCode(miner.referredBy) : null;
  if (!sponsor) return;

  const role = sponsor.role || "";
  if (role === "Mine Owner" || role === "Maden Sahibi" || role === "Holding Owner" || role === "Şirket Sahibi") {
    const royaltyOra = 0.30;
    sponsor.ora = Number(((sponsor.ora || 0) + royaltyOra).toFixed(2));
    if (typeof addUserNotificationLog === 'function') {
      addUserNotificationLog(sponsor, "Filo Madencilik Primi", `${miner.username} adlı madenciniz vardiyasını tamamladı.`, `+${royaltyOra.toFixed(2)} ORA`, "commission");
    }
    if (typeof saveStoredUser === 'function') saveStoredUser(sponsor);
    if (CurrentUser && CurrentUser.username.toLowerCase() === sponsor.username.toLowerCase()) {
      CurrentUser.ora = sponsor.ora;
      if (typeof updateHUD === 'function') updateHUD();
    }
  }
}

function deductMinedOraFromMasterReserve(amount) {
  if (typeof AdminState !== 'undefined' && AdminState.genesisOraReserve) {
    AdminState.genesisOraReserve = Number((AdminState.genesisOraReserve - amount).toFixed(2));
    if (typeof saveAdminProtocolState === 'function') saveAdminProtocolState(AdminState);
  }
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

  activeMineIdx = idx;
  wagonFill = 0;
  currentWagonStage = 1;
  isTransitLocked = false;
  rockParticles = [];
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

  mCtx.fillStyle = '#080709';
  mCtx.beginPath();
  mCtx.moveTo(0, 0);
  mCtx.lineTo(w * 0.15, h * 0.12);
  mCtx.lineTo(w * 0.22, 0);
  mCtx.lineTo(w * 0.38, h * 0.16);
  mCtx.lineTo(w * 0.45, 0);
  mCtx.lineTo(w * 0.65, h * 0.11);
  mCtx.lineTo(w * 0.75, 0);
  mCtx.lineTo(w, h * 0.08);
  mCtx.lineTo(w, 0);
  mCtx.closePath();
  mCtx.fill();

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

  mCtx.strokeStyle = 'rgba(0,0,0,0.55)';
  mCtx.lineWidth = 3;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.12, h * 0.15); mCtx.lineTo(w * 0.28, h * 0.38); mCtx.lineTo(w * 0.22, h * 0.7);
  mCtx.moveTo(w * 0.28, h * 0.38); mCtx.lineTo(w * 0.34, h * 0.48);
  mCtx.stroke();

  const veinGlow = (Math.sin(Date.now() / 400) * 0.2) + 0.8;
  mCtx.save();
  mCtx.strokeStyle = currentWagonStage === 2 ? `rgba(192, 132, 252, ${veinGlow})` : `rgba(245, 158, 11, ${veinGlow})`;
  mCtx.lineWidth = 4;
  mCtx.shadowColor = currentWagonStage === 2 ? '#c084fc' : '#f59e0b';
  mCtx.shadowBlur = 12;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.24, h * 0.22);
  mCtx.lineTo(w * 0.33, h * 0.42);
  mCtx.lineTo(w * 0.29, h * 0.68);
  mCtx.stroke();

  const noduleColor = currentWagonStage === 2 ? '#e9d5ff' : '#fef08a';
  [{ x: w * 0.24, y: h * 0.22 }, { x: w * 0.33, y: h * 0.42 }, { x: w * 0.31, y: h * 0.55 }].forEach(nd => {
    mCtx.fillStyle = noduleColor;
    mCtx.beginPath();
    mCtx.arc(nd.x, nd.y, 4, 0, Math.PI * 2);
    mCtx.fill();
  });
  mCtx.restore();

  lanternSway = Math.sin(Date.now() / 700) * 6;
  lanternFlicker = 0.94 + Math.random() * 0.12;
  const lanternX = w * 0.52 + lanternSway, lanternY = 82;

  mCtx.strokeStyle = '#475569';
  mCtx.lineWidth = 2;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.52, 0);
  mCtx.lineTo(lanternX, lanternY - 14);
  mCtx.stroke();

  const lanternLight = mCtx.createRadialGradient(lanternX, lanternY, 4, lanternX, lanternY, 280 * lanternFlicker);
  lanternLight.addColorStop(0, 'rgba(254, 215, 170, 0.48)');
  lanternLight.addColorStop(0.35, 'rgba(245, 158, 11, 0.16)');
  lanternLight.addColorStop(0.7, 'rgba(180, 83, 9, 0.05)');
  lanternLight.addColorStop(1, 'rgba(0, 0, 0, 0)');
  mCtx.fillStyle = lanternLight;
  mCtx.fillRect(0, 0, w, h);

  mCtx.fillStyle = '#0f172a';
  mCtx.fillRect(lanternX - 9, lanternY - 14, 18, 5);
  mCtx.fillStyle = '#fef08a';
  mCtx.beginPath();
  mCtx.arc(lanternX, lanternY, 7, 0, Math.PI * 2);
  mCtx.fill();
  mCtx.strokeStyle = '#78350f';
  mCtx.lineWidth = 1.5;
  mCtx.strokeRect(lanternX - 8, lanternY - 10, 16, 20);

  const groundY = h - 35;
  mCtx.fillStyle = '#0b0c10';
  mCtx.fillRect(0, groundY, w, 35);

  mCtx.fillStyle = 'rgba(255,255,255,0.03)';
  mCtx.fillRect(0, groundY, w, 2);

  mCtx.fillStyle = '#271b13';
  for (let rx = w * 0.36; rx < w; rx += 28) {
    mCtx.fillRect(rx, groundY + 8, 16, 18);
    mCtx.fillStyle = '#170f0a';
    mCtx.fillRect(rx + 13, groundY + 8, 3, 18);
    mCtx.fillStyle = '#271b13';
  }

  mCtx.strokeStyle = '#475569';
  mCtx.lineWidth = 4;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.35, groundY + 12); mCtx.lineTo(w, groundY + 12);
  mCtx.moveTo(w * 0.35, groundY + 22); mCtx.lineTo(w, groundY + 22);
  mCtx.stroke();
  mCtx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
  mCtx.lineWidth = 1.5;
  mCtx.beginPath();
  mCtx.moveTo(w * 0.35, groundY + 11); mCtx.lineTo(w, groundY + 11);
  mCtx.stroke();

  const wagonX = w * 0.70, wagonY = groundY - 48, wagonW = 110, wagonH = 46;

  [-1, 1].forEach(dir => {
    const wheelCenterX = (dir === -1) ? (wagonX + 24) : (wagonX + wagonW - 24);
    const wheelCenterY = wagonY + wagonH + 5;

    mCtx.fillStyle = '#0f172a';
    mCtx.beginPath(); mCtx.arc(wheelCenterX, wheelCenterY, 11, 0, Math.PI * 2); mCtx.fill();
    mCtx.fillStyle = '#334155';
    mCtx.beginPath(); mCtx.arc(wheelCenterX, wheelCenterY, 8, 0, Math.PI * 2); mCtx.fill();
    mCtx.fillStyle = '#cbd5e1';
    mCtx.beginPath(); mCtx.arc(wheelCenterX, wheelCenterY, 3, 0, Math.PI * 2); mCtx.fill();
  });

  if (wagonFill > 0) {
    const fillRatio = wagonFill / 100;
    const oreHeight = fillRatio * 32;

    mCtx.save();
    mCtx.fillStyle = currentWagonStage === 2 ? '#9333ea' : '#d97706';
    mCtx.beginPath();
    mCtx.moveTo(wagonX + 6, wagonY + 6);
    mCtx.quadraticCurveTo(wagonX + wagonW / 2, wagonY - oreHeight, wagonX + wagonW - 6, wagonY + 6);
    mCtx.fill();

    const nuggetCount = Math.floor(fillRatio * 14);
    for (let ni = 0; ni < nuggetCount; ni++) {
      const nx = wagonX + 18 + (ni * 5.8);
      const ny = wagonY - (Math.sin(ni * 0.45) * oreHeight * 0.65) + 3;
      mCtx.fillStyle = currentWagonStage === 2 ? '#c084fc' : '#fbbf24';
      mCtx.fillRect(nx, ny, 4, 4);
    }
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

  mCtx.strokeStyle = '#475569';
  mCtx.lineWidth = 3;
  mCtx.stroke();
  mCtx.fillStyle = '#64748b';
  mCtx.fillRect(wagonX + wagonW / 2 - 3, wagonY, 6, wagonH);

  const minerX = w * 0.43, minerY = groundY - 82;
  mCtx.save();
  mCtx.translate(minerX, minerY);

  mCtx.fillStyle = 'rgba(0,0,0,0.65)';
  mCtx.beginPath();
  mCtx.ellipse(0, 80, 24, 7, 0, 0, Math.PI * 2);
  mCtx.fill();

  mCtx.fillStyle = '#0f172a';
  mCtx.fillRect(-14, 48, 11, 34);
  mCtx.fillRect(3, 48, 11, 34);
  mCtx.fillStyle = '#334155';
  mCtx.fillRect(-15, 74, 13, 8);
  mCtx.fillRect(2, 74, 13, 8);

  mCtx.fillStyle = '#c2410c';
  mCtx.fillRect(-16, 14, 32, 38);
  mCtx.fillStyle = '#facc15';
  mCtx.fillRect(-16, 28, 32, 6);

  mCtx.fillStyle = '#fdba74';
  mCtx.beginPath(); mCtx.arc(0, 3, 11, 0, Math.PI * 2); mCtx.fill();
  mCtx.fillStyle = '#eab308';
  mCtx.beginPath(); mCtx.arc(0, -2, 13, Math.PI, 0); mCtx.fill();
  mCtx.fillRect(-15, -4, 30, 4);

  const lampBeam = mCtx.createRadialGradient(-14, -2, 2, -140, 20, 180);
  lampBeam.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  lampBeam.addColorStop(0.25, 'rgba(254, 240, 138, 0.45)');
  lampBeam.addColorStop(0.7, 'rgba(254, 240, 138, 0.08)');
  lampBeam.addColorStop(1, 'rgba(0, 0, 0, 0)');
  mCtx.fillStyle = lampBeam;
  mCtx.beginPath();
  mCtx.moveTo(-14, -2);
  mCtx.lineTo(-190, -50);
  mCtx.lineTo(-190, 90);
  mCtx.closePath();
  mCtx.fill();

  mCtx.save();
  let hx1, hy1, hx2, hy2, headX, headY, headRot;

  if (swingFrame === 0) {
    hx1 = -4; hy1 = 20; hx2 = -32; hy2 = 8;
    headX = -32; headY = 8; headRot = -0.4;
  } else if (swingFrame === 1) {
    hx1 = -2; hy1 = 16; hx2 = 24; hy2 = -34;
    headX = 24; headY = -34; headRot = 0.85;
  } else {
    hx1 = -4; hy1 = 20; hx2 = -60; hy2 = 38;
    headX = -60; headY = 38; headRot = -1.65;

    mCtx.strokeStyle = 'rgba(254, 240, 138, 0.45)';
    mCtx.lineWidth = 3;
    mCtx.beginPath();
    mCtx.arc(0, 0, 68, -0.2, 0.9);
    mCtx.stroke();
  }

  mCtx.strokeStyle = '#78350f';
  mCtx.lineWidth = 5;
  mCtx.lineCap = 'round';
  mCtx.beginPath();
  mCtx.moveTo(hx1, hy1);
  mCtx.lineTo(hx2, hy2);
  mCtx.stroke();

  mCtx.save();
  mCtx.translate(headX, headY);
  mCtx.rotate(headRot);
  mCtx.fillStyle = '#94a3b8';
  mCtx.strokeStyle = '#f8fafc';
  mCtx.lineWidth = 1.2;
  mCtx.beginPath();
  mCtx.moveTo(-24, -3);
  mCtx.lineTo(0, -5);
  mCtx.lineTo(24, -3);
  mCtx.lineTo(28, 0);
  mCtx.lineTo(22, 3);
  mCtx.lineTo(0, 5);
  mCtx.lineTo(-22, 3);
  mCtx.lineTo(-28, 0);
  mCtx.closePath();
  mCtx.fill();
  mCtx.stroke();
  mCtx.restore();

  mCtx.fillStyle = '#451a03';
  mCtx.beginPath(); mCtx.arc(hx1, hy1, 4.5, 0, Math.PI * 2); mCtx.fill();
  mCtx.restore();
  mCtx.restore();

  ambientDust.forEach(d => {
    d.x += d.speedX;
    d.y += d.speedY;
    d.pulse += 0.03;
    if (d.y > h) d.y = -5;
    if (d.x > w) d.x = 0;
    if (d.x < 0) d.x = w;

    const alpha = (Math.sin(d.pulse) * 0.3 + 0.5) * d.opacity;
    mCtx.fillStyle = `rgba(254, 240, 138, ${alpha})`;
    mCtx.beginPath();
    mCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    mCtx.fill();
  });

  for (let i = rockParticles.length - 1; i >= 0; i--) {
    const p = rockParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    if (p.type === 'spark') {
      p.vy += 0.15;
      mCtx.fillStyle = p.color;
      mCtx.beginPath();
      mCtx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      mCtx.fill();
    } else {
      p.vy += 0.38;
      p.rot += p.vRot;
      mCtx.save();
      mCtx.translate(p.x, p.y);
      mCtx.rotate(p.rot);
      mCtx.fillStyle = p.color;
      mCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      mCtx.restore();
    }

    if (p.life <= 0) rockParticles.splice(i, 1);
  }

  mFrame = requestAnimationFrame(renderMineLoop);
}