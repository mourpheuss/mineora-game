// ================= 7. MADEN ASANSÖRÜ / CRASH MOTORU (KURUŞ BAZLI TL) (crash.js) =================
let crashCanvas, crashCtx, crashFrame, crashState = "waiting", currentMultiplier = 1.00, crashPoint = 2.00, countdownTimer = 5, crashTickerInterval = null;
let hasPlacedBet = false, hasCashedOut = false, userCashOutMultiplier = 1.00, userWonAmount = 0.00, crashHistory = [1.24, 1.05, 1.68, 1.12, 3.40];
let shaftYOffset = 0, sparks = [], debris = [], cageY = 0, cageVy = 0, cageAngle = 0, cableSnapY = 0, cableSnapVy = 0;

// TABAN KAZANÇ: 0.10 TL (10 Kuruş) - Sembolik, düşük eğlence kazancı
const BASE_REWARD_TL = 0.10;

function initCrashEngine() {
  crashCanvas = document.getElementById('crash-canvas');
  if (!crashCanvas) return;
  crashCtx = crashCanvas.getContext('2d');
  crashCanvas.width = crashCanvas.clientWidth || 800;
  crashCanvas.height = crashCanvas.clientHeight || 400;

  renderCrashHistoryBar(); 
  calculateCrashEstProfit(); 
  updateCrashActionBtn();

  if (crashState === "waiting" || !crashTickerInterval) {
    clearInterval(crashTickerInterval); 
    crashTickerInterval = null; 
    startCrashCountdown();
  }
  cancelAnimationFrame(crashFrame); 
  renderCrashCanvasLoop();
}
window.initCrashEngine = initCrashEngine;

function generateCrashPoint() {
  const roll = Math.random();
  if (roll < 0.12) return Number((1.00 + Math.random() * 0.09).toFixed(2));
  if (roll < 0.60) return Number((1.10 + Math.random() * 0.75).toFixed(2));
  if (roll < 0.90) return Number((1.86 + Math.random() * 1.54).toFixed(2));
  if (roll < 0.98) return Number((3.41 + Math.random() * 8.59).toFixed(2));
  return Number((12.00 + Math.random() * 33.00).toFixed(2));
}

function startCrashCountdown() {
  crashState = "waiting"; currentMultiplier = 1.00; countdownTimer = 5; hasCashedOut = false;
  userCashOutMultiplier = 1.00; userWonAmount = 0.00; sparks = []; debris = [];
  cageY = 0; cageVy = 0; cageAngle = 0; cableSnapY = 0; cableSnapVy = 0;

  const statusBadge = document.getElementById('crash-badge-status');
  const multText = document.getElementById('crash-multiplier-text');
  const subStatus = document.getElementById('crash-sub-status');

  if (multText) {
    multText.innerText = "1.00x";
    multText.className = "text-5xl sm:text-7xl font-black font-mono tracking-tight text-white drop-shadow-[0_4px_25px_rgba(0,0,0,0.9)]";
  }
  updateCrashActionBtn();

  if (crashTickerInterval) clearInterval(crashTickerInterval);
  crashTickerInterval = setInterval(() => {
    countdownTimer--;
    if (statusBadge) {
      statusBadge.innerHTML = `<i class="fa-solid fa-clock animate-spin"></i> Asansör Hazırlanıyor (${countdownTimer}s)`;
    }
    if (subStatus) subStatus.innerText = `Asansör Hazırlanıyor (${countdownTimer}s)`;

    if (countdownTimer <= 0) {
      clearInterval(crashTickerInterval); crashTickerInterval = null; launchCrashElevator();
    }
  }, 1000);
}

function launchCrashElevator() {
  crashState = "running"; crashPoint = generateCrashPoint();
  const startTime = Date.now();
  const statusBadge = document.getElementById('crash-badge-status');
  const subStatus = document.getElementById('crash-sub-status');
  const multText = document.getElementById('crash-multiplier-text');

  if (statusBadge) {
    statusBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-up animate-pulse"></i> Derin Şafta İniyor...`;
  }
  if (subStatus) subStatus.innerText = "Derin Şafta İniyor...";
  updateCrashActionBtn();

  function step() {
    if (crashState !== "running") return;
    const elapsedSec = (Date.now() - startTime) / 1000;
    currentMultiplier = Number((1.00 + 0.08 * Math.pow(elapsedSec, 1.88)).toFixed(2));

    if (multText) {
      multText.innerText = `${currentMultiplier.toFixed(2)}x`;
      multText.className = "text-5xl sm:text-7xl font-black font-mono tracking-tight text-mineora-gold drop-shadow-[0_4px_25px_rgba(240,185,11,0.5)]";
    }

    calculateCrashEstProfit();
    updateCrashActionBtn();

    if (currentMultiplier >= crashPoint) {
      triggerCrashExplosion();
      return;
    }
    crashFrame = requestAnimationFrame(step);
  }
  crashFrame = requestAnimationFrame(step);
}

function triggerCrashExplosion() {
  crashState = "crashed"; cancelAnimationFrame(crashFrame);
  const statusBadge = document.getElementById('crash-badge-status');
  const subStatus = document.getElementById('crash-sub-status');
  const multText = document.getElementById('crash-multiplier-text');

  if (multText) {
    multText.innerText = `${crashPoint.toFixed(2)}x`;
    multText.className = "text-5xl sm:text-7xl font-black font-mono tracking-tight text-rose-500 fire-pulse drop-shadow-[0_4px_25px_rgba(244,63,94,0.7)]";
  }
  if (statusBadge) {
    statusBadge.innerHTML = `<i class="fa-solid fa-burst"></i> HALAT KOPTU!`;
  }
  if (subStatus) subStatus.innerText = `Halat Koptu @ ${crashPoint.toFixed(2)}x`;

  cageVy = 2.0; cageAngle = (Math.random() - 0.5) * 0.15; cableSnapVy = -12.0;
  const w = crashCanvas ? crashCanvas.width : 800, h = crashCanvas ? crashCanvas.height : 400;
  const centerX = w / 2, currentCageY = h * 0.52;

  for (let i = 0; i < 60; i++) {
    debris.push({
      x: centerX + (Math.random() - 0.5) * 70, y: currentCageY + (Math.random() - 0.5) * 50,
      vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.8) * 14, size: Math.random() * 7 + 3,
      color: Math.random() < 0.4 ? '#f43f5e' : (Math.random() < 0.7 ? '#f59e0b' : '#334155'),
      angle: Math.random() * Math.PI * 2, vAngle: (Math.random() - 0.5) * 0.25
    });
  }

  // TL BAKİYESİ ASLA EKSİLMEZ, YALNIZCA BİLET YANAR
  if (hasPlacedBet && !hasCashedOut) {
    showToast(`💥 Halat Koptu @ ${crashPoint.toFixed(2)}x! Kristal bilet kullanıldı, TL kasanız güvende.`, "warning");
    addUserNotificationLog(CurrentUser, "Asansör Deneyimi", `${crashPoint.toFixed(2)}x seviyesinde halat koptu.`, "0.00 TL", "alert");
  }

  crashHistory.unshift(crashPoint);
  if (crashHistory.length > 8) crashHistory.pop();
  renderCrashHistoryBar();

  hasPlacedBet = false; hasCashedOut = false;
  updateCrashActionBtn();
  setTimeout(() => startCrashCountdown(), 3800);
  renderCrashCanvasLoop();
}

function calculateCrashEstProfit() {
  const estEl = document.getElementById('crash-est-profit');
  if (estEl) {
    if (hasCashedOut) { 
      estEl.innerText = `+${userWonAmount.toFixed(2)} TL (Tahliye Olundu)`; 
      return; 
    }
    const liveWin = Number((BASE_REWARD_TL * currentMultiplier).toFixed(2));
    estEl.innerText = `+${liveWin.toFixed(2)} TL`;
  }
}

function handleCrashActionBtn() {
  if (!CurrentUser) return;

  if (crashState === "waiting") {
    if (hasPlacedBet) {
      CurrentUser.alpCrystals = (CurrentUser.alpCrystals || 0) + 1;
      hasPlacedBet = false;
      saveUserWorld(); updateHUD(); updateCrashActionBtn();
      showToast("↩️ İniş iptal edildi, 1 Kristal Bilet iade edildi.", "info");
      return;
    }

    const crystals = CurrentUser.alpCrystals || 0;
    if (crystals < 1) {
      showToast("⚠️ En az 1 Kristal Bilet gereklidir! Maden sahalarında kazı yaparak ücretsiz toplayabilirsiniz.", "warning");
      return;
    }

    CurrentUser.alpCrystals = crystals - 1;
    hasPlacedBet = true; hasCashedOut = false; userWonAmount = 0;
    saveUserWorld(); updateHUD(); updateCrashActionBtn();
    showToast("🎫 1 Kristal Bilet kullanıldı. Asansör hazırlanıyor!", "success");
  } else if (crashState === "running") {
    if (!hasPlacedBet || hasCashedOut) return;
    hasCashedOut = true;
    userCashOutMultiplier = currentMultiplier;

    // KURUŞ CİNSİNDEN SEMBOLİK TL HESABI: 0.10 TL * Çarpan
    userWonAmount = Number((BASE_REWARD_TL * userCashOutMultiplier).toFixed(2));
    CurrentUser.tl = Number(((CurrentUser.tl || 0) + userWonAmount).toFixed(2));

    saveUserWorld(); updateHUD(); updateCrashActionBtn();
    addUserNotificationLog(CurrentUser, "Asansör Tahliyesi", `${userCashOutMultiplier.toFixed(2)}x seviyesinden tahliye olundu.`, `+${userWonAmount.toFixed(2)} TL`, "income");
    showToast(`🎉 ${userCashOutMultiplier.toFixed(2)}x seviyesinden tahliye olundu! (+${userWonAmount.toFixed(2)} TL cüzdanınıza eklendi)`, "success");
  }
}
window.handleCrashActionBtn = handleCrashActionBtn;

function updateCrashActionBtn() {
  const btn = document.getElementById('btn-crash-action');
  const btnText = document.getElementById('btn-crash-action-text');
  if (!btn || !btnText) return;

  if (crashState === "waiting") {
    if (hasPlacedBet) {
      btn.className = "w-full py-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-black text-sm transition shadow-lg cursor-pointer";
      btnText.innerText = "İnişi İptal Et (Kristali Geri Al)";
    } else {
      btn.className = "w-full py-4 rounded-2xl bg-mineora-green hover:opacity-90 text-white font-black text-sm transition shadow-lg cursor-pointer";
      btnText.innerText = "Şafta Gir (1 Kristal Bilet Kullan)";
    }
  } else if (crashState === "running") {
    if (hasPlacedBet && !hasCashedOut) {
      const liveWin = (BASE_REWARD_TL * currentMultiplier).toFixed(2);
      btn.className = "w-full py-4 rounded-2xl bg-mineora-gold hover:bg-yellow-400 text-black font-black text-sm transition shadow-2xl cursor-pointer animate-pulse";
      btnText.innerText = `Tahliye Ol (+${liveWin} TL)`;
    } else if (hasCashedOut) {
      btn.className = "w-full py-4 rounded-2xl bg-slate-800 text-slate-400 font-black text-sm cursor-not-allowed";
      btnText.innerText = `Tahliye Olundu: ${userCashOutMultiplier.toFixed(2)}x (+${userWonAmount.toFixed(2)} TL)`;
    } else {
      btn.className = "w-full py-4 rounded-2xl bg-slate-800 text-slate-500 font-black text-sm cursor-not-allowed";
      btnText.innerText = "Asansör İniyor...";
    }
  } else {
    btn.className = "w-full py-4 rounded-2xl bg-rose-600 text-white font-black text-sm cursor-not-allowed";
    btnText.innerText = "Halat Koptu!";
  }
}

function renderCrashHistoryBar() {
  const container = document.getElementById('crash-history-bar');
  if (!container) return;
  container.innerHTML = "";
  crashHistory.forEach(mult => {
    const badge = document.createElement('span');
    const isHigh = mult >= 2.00;
    badge.className = `px-2.5 py-1 rounded-lg text-[10px] font-black font-mono border ${isHigh ? 'bg-mineora-gold/15 text-mineora-gold border-mineora-gold/30' : 'bg-mineora-input text-slate-300 border-mineora-border'}`;
    badge.innerText = `${mult.toFixed(2)}x`;
    container.appendChild(badge);
  });
}

function renderCrashCanvasLoop() {
  const sec = document.getElementById('sec-crash');
  if (!crashCtx || !sec || sec.classList.contains('hidden')) return;

  const w = crashCanvas.width, h = crashCanvas.height;
  const bgGrad = crashCtx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#040608'); bgGrad.addColorStop(1, '#0f141c');
  crashCtx.fillStyle = bgGrad;
  crashCtx.fillRect(0, 0, w, h);

  let speed = 0;
  if (crashState === "running") {
    speed = Math.min(32, 5 + Math.pow(currentMultiplier, 1.3));
    shaftYOffset = (shaftYOffset + speed) % 90;
  } else if (crashState === "crashed") {
    shaftYOffset = (shaftYOffset + 2) % 90;
  }

  const wallW = 60;
  crashCtx.fillStyle = '#12161c';
  crashCtx.fillRect(0, 0, wallW, h);
  crashCtx.fillRect(w - wallW, 0, wallW, h);

  crashCtx.strokeStyle = '#2b1d14';
  crashCtx.lineWidth = 4;
  for (let y = -90 + shaftYOffset; y < h + 90; y += 90) {
    crashCtx.fillStyle = '#3a2518';
    crashCtx.fillRect(0, y, wallW, 14);
    crashCtx.fillRect(w - wallW, y, wallW, 14);
  }

  const railLeftX = wallW + 18, railRightX = w - wallW - 18;
  crashCtx.strokeStyle = '#475569';
  crashCtx.lineWidth = 5;
  crashCtx.beginPath();
  crashCtx.moveTo(railLeftX, 0); crashCtx.lineTo(railLeftX, h);
  crashCtx.moveTo(railRightX, 0); crashCtx.lineTo(railRightX, h);
  crashCtx.stroke();

  const centerX = w / 2;
  let currentCageY = h * 0.52;

  if (crashState !== "crashed") {
    const jitter = crashState === "running" ? (Math.random() - 0.5) * Math.min(6, currentMultiplier * 0.35) : 0;
    crashCtx.strokeStyle = '#94a3b8';
    crashCtx.lineWidth = 3;
    crashCtx.beginPath();
    crashCtx.moveTo(centerX - 16 + jitter, 0); crashCtx.lineTo(centerX - 16 + jitter, currentCageY - 45);
    crashCtx.moveTo(centerX + 16 - jitter, 0); crashCtx.lineTo(centerX + 16 - jitter, currentCageY - 45);
    crashCtx.stroke();
  } else {
    cableSnapY += cableSnapVy;
    cableSnapVy += 0.5;
    crashCtx.strokeStyle = '#ef4444';
    crashCtx.lineWidth = 3;
    crashCtx.beginPath();
    crashCtx.moveTo(centerX - 16, 0); crashCtx.lineTo(centerX - 22 + (Math.random() - 0.5) * 10, Math.max(10, 45 + cableSnapY));
    crashCtx.stroke();
  }

  crashCtx.save();
  if (crashState === "crashed") {
    cageVy += 1.4; cageY += cageVy; cageAngle += 0.05;
    currentCageY += cageY;
    crashCtx.translate(centerX, currentCageY);
    crashCtx.rotate(cageAngle);
  } else {
    const shake = crashState === "running" ? (Math.random() - 0.5) * Math.min(5, currentMultiplier * 0.3) : 0;
    crashCtx.translate(centerX + shake, currentCageY);
  }

  const cageW = 76, cageH = 68;
  crashCtx.fillStyle = crashState === "crashed" ? '#991b1b' : '#334155';
  crashCtx.fillRect(-cageW / 2, -cageH / 2, cageW, 10);
  crashCtx.fillStyle = '#0f172a';
  crashCtx.fillRect(-cageW / 2, cageH / 2 - 10, cageW, 10);
  crashCtx.strokeStyle = crashState === "crashed" ? '#f43f5e' : '#f59e0b';
  crashCtx.lineWidth = 2;
  crashCtx.strokeRect(-cageW / 2, -cageH / 2, cageW, cageH);

  crashCtx.fillStyle = '#ea580c';
  crashCtx.fillRect(-10, -5, 20, 26);
  crashCtx.fillStyle = '#facc15';
  crashCtx.beginPath(); crashCtx.arc(0, -14, 9, Math.PI, 0); crashCtx.fill();
  crashCtx.restore();

  if (crashState === "running" && Math.random() < 0.75) {
    sparks.push({ x: railLeftX, y: currentCageY + (Math.random() - 0.5) * 20, vx: -(Math.random() * 4 + 1), vy: (Math.random() - 0.5) * 6, life: 18 });
    sparks.push({ x: railRightX, y: currentCageY + (Math.random() - 0.5) * 20, vx: Math.random() * 4 + 1, vy: (Math.random() - 0.5) * 6, life: 18 });
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx; s.y += s.vy; s.life--;
    crashCtx.fillStyle = Math.random() < 0.5 ? '#facc15' : '#f97316';
    crashCtx.fillRect(s.x, s.y, 2.5, 2.5);
    if (s.life <= 0) sparks.splice(i, 1);
  }

  if (crashState === "crashed") {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.x += d.vx; d.y += d.vy; d.vy += 0.55; d.angle += d.vAngle;
      crashCtx.save();
      crashCtx.translate(d.x, d.y);
      crashCtx.rotate(d.angle);
      crashCtx.fillStyle = d.color;
      crashCtx.fillRect(-d.size / 2, -d.size / 2, d.size, d.size);
      crashCtx.restore();
    }
  }

  crashFrame = requestAnimationFrame(renderCrashCanvasLoop);
}
