// ================= VADELİ TL KASASI MOTORU (stake.js) =================
const STAKE_PLANS = {
  60: { 
    days: 60, 
    durationMs: 60 * 24 * 60 * 60 * 1000, 
    dailyPercent: 3.0, 
    totalProfitPercent: 180.0, 
    badge: "Standart Kasa", 
    dailyRateText: "%3.0 Günlük" 
  },
  90: { 
    days: 90, 
    durationMs: 90 * 24 * 60 * 60 * 1000, 
    dailyPercent: 3.5, 
    totalProfitPercent: 315.0, 
    badge: "Gümüş Kasa", 
    dailyRateText: "%3.5 Günlük" 
  },
  120: { 
    days: 120, 
    durationMs: 120 * 24 * 60 * 60 * 1000, 
    dailyPercent: 4.0, 
    totalProfitPercent: 480.0, 
    badge: "VIP Altın Kasa", 
    dailyRateText: "%4.0 Günlük" 
  }
};

let selectedStakeDays = 60;
let stakeTickerInterval = null;

function setStakePlan(days) {
  selectedStakeDays = days;
  [60, 90, 120].forEach(d => {
    const btn = document.getElementById(`stake-plan-btn-${d}`);
    if (btn) {
      const isSelected = (d === days);
      btn.className = isSelected
        ? "p-4 rounded-2xl bg-gradient-to-r from-amber-500 via-mineora-gold to-yellow-400 text-black font-black border-2 border-yellow-200 shadow-xl cursor-pointer text-left transition transform scale-102"
        : "p-4 rounded-2xl bg-mineora-bg text-slate-300 border border-mineora-border hover:border-mineora-gold/50 cursor-pointer text-left transition";
    }
  });
  calculateStakePreview();
}
window.setStakePlan = setStakePlan;

function calculateStakePreview() {
  const amt = parseFloat(document.getElementById('stake-deposit-amount')?.value) || 0;
  const plan = STAKE_PLANS[selectedStakeDays];
  const dailyProfit = (amt * plan.dailyPercent) / 100;
  const totalProfit = dailyProfit * plan.days;

  const rewardEl = document.getElementById('stake-preview-profit');
  const dailyEl = document.getElementById('stake-preview-daily');

  if (rewardEl) rewardEl.innerText = `+${totalProfit.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ (+%${plan.totalProfitPercent})`;
  if (dailyEl) dailyEl.innerText = `~${dailyProfit.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ / Gün (${plan.dailyRateText})`;
}
window.calculateStakePreview = calculateStakePreview;

function executeDepositStake() {
  if (!CurrentUser) return;
  const amtInput = document.getElementById('stake-deposit-amount');
  const amount = parseFloat(amtInput?.value) || 0;
  const currentTl = Number(parseFloat(CurrentUser.tl || 0).toFixed(2));

  if (isNaN(amount) || amount < 100) { 
    showToast("⚠️ Minimum kilit tutarı 100 ₺'dir!", "warning"); 
    return; 
  }
  if (amount > currentTl) { 
    showToast(`⚠️ Yetersiz bakiye! Mevcut: ${currentTl.toLocaleString('tr-TR')} ₺`, "warning"); 
    return; 
  }

  const plan = STAKE_PLANS[selectedStakeDays];
  const now = Date.now();
  const unlockDate = now + plan.durationMs;
  const expectedProfit = Number(((amount * plan.totalProfitPercent) / 100).toFixed(2));

  CurrentUser.tl = Number((currentTl - amount).toFixed(2));
  if (!CurrentUser.stakes) CurrentUser.stakes = [];

  CurrentUser.stakes.unshift({
    id: Date.now(),
    amount: amount,
    planDays: plan.days,
    dailyPercent: plan.dailyPercent,
    profitPercent: plan.totalProfitPercent,
    expectedProfit: expectedProfit,
    claimedProfit: 0.00,
    lastAccrualTime: now,
    startDate: now,
    unlockDate: unlockDate,
    principalClaimed: false
  });

  addUserNotificationLog(CurrentUser, "Vadeli Kasa Kilidi", `${amount.toLocaleString()} ₺ tutar ${plan.days} günlük kasaya kilitlendi (${plan.dailyRateText}).`, `-${amount.toFixed(2)} ₺`, "expense");
  saveUserWorld(); 
  updateHUD();
  
  if (amtInput) amtInput.value = "";
  calculateStakePreview(); 
  renderActiveStakes();
  showToast(`🔒 ${amount.toLocaleString()} ₺ tutar ${plan.days} günlüğüne kilitlendi (Günlük %${plan.dailyPercent})!`, "success");
}
window.executeDepositStake = executeDepositStake;

function processAccruedStakeProfits() {
  if (!CurrentUser || !CurrentUser.stakes || CurrentUser.stakes.length === 0) return;
  const now = Date.now();
  let totalDistributed = 0;
  let updated = false;

  CurrentUser.stakes.forEach(s => {
    const effectiveTime = Math.min(now, s.unlockDate);
    const elapsedSinceLast = effectiveTime - (s.lastAccrualTime || s.startDate);
    if (elapsedSinceLast > 0 && s.claimedProfit < s.expectedProfit) {
      const ratePerMs = s.expectedProfit / (s.planDays * 24 * 60 * 60 * 1000);
      let newlyAccrued = Math.min(elapsedSinceLast * ratePerMs, s.expectedProfit - s.claimedProfit);
      if (newlyAccrued > 0.0001) {
        s.claimedProfit = Number((s.claimedProfit + newlyAccrued).toFixed(4));
        s.lastAccrualTime = effectiveTime;
        totalDistributed += newlyAccrued;
        updated = true;
      }
    }
  });

  if (updated && totalDistributed > 0) {
    CurrentUser.tl = Number(((CurrentUser.tl || 0) + totalDistributed).toFixed(4));
    saveUserWorld(); 
    updateHUD();
  }
}

function claimPrincipalReturn(stakeId) {
  if (!CurrentUser || !CurrentUser.stakes) return;
  const s = CurrentUser.stakes.find(item => item.id === stakeId);
  if (!s) return;
  const now = Date.now();
  if (now < s.unlockDate) { 
    showToast("⏳ Vade süresi henüz dolmadı!", "warning"); 
    return; 
  }
  if (s.principalClaimed) { 
    showToast("⚠️ Anapara zaten hesabınıza aktarılmış.", "info"); 
    return; 
  }

  processAccruedStakeProfits();
  s.principalClaimed = true;
  CurrentUser.tl = Number(((CurrentUser.tl || 0) + s.amount).toFixed(2));
  addUserNotificationLog(CurrentUser, "Kasa Vadesi Doldu", `${s.amount.toLocaleString()} ₺ anapara cüzdana aktarıldı.`, `+${s.amount.toFixed(2)} ₺`, "income");
  saveUserWorld(); 
  updateHUD(); 
  renderActiveStakes();
  showToast(`🎉 ${s.amount.toLocaleString()} ₺ anaparanız cüzdanınıza aktarıldı!`, "success");
}
window.claimPrincipalReturn = claimPrincipalReturn;

// AKTİF KASALARI TAMAMEN TL VE TÜRKÇE OLARAK ÇİZEN MOTOR
function renderActiveStakes() {
  const container = document.getElementById('active-stakes-list');
  if (!container || !CurrentUser) return;
  const stakes = CurrentUser.stakes || [];
  if (stakes.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-xs">Aktif vadeli TL kasanız bulunmuyor.</div>`;
    return;
  }

  const now = Date.now();
  container.innerHTML = "";
  stakes.forEach(s => {
    const isUnlocked = now >= s.unlockDate;
    let timeText = "";
    if (isUnlocked) {
      timeText = "Vade Tamamlandı (Kilit Açık)";
    } else {
      const leftMs = s.unlockDate - now;
      const leftDays = Math.floor(leftMs / (1000 * 60 * 60 * 24));
      const leftHours = Math.floor((leftMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const leftMins = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
      timeText = `Kalan Süre: ${leftDays} Gün ${leftHours} Saat ${leftMins} Dk`;
    }

    const dailyProfit = s.expectedProfit / s.planDays;
    const card = document.createElement('div');
    card.className = `p-4 rounded-2xl bg-mineora-bg border ${s.principalClaimed ? 'border-slate-800 opacity-60' : (isUnlocked ? 'border-emerald-500/60' : 'border-amber-500/40')} flex flex-wrap items-center justify-between gap-4 text-xs shadow-lg`;
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl ${s.principalClaimed ? 'bg-slate-800 text-slate-400' : (isUnlocked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400')} flex items-center justify-center text-lg font-black">
          <i class="fa-solid ${s.principalClaimed ? 'fa-check-double' : (isUnlocked ? 'fa-lock-open' : 'fa-vault')}"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <strong class="text-white text-sm font-mono">${Number(s.amount).toLocaleString('tr-TR')} ₺</strong>
            <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-mineora-card text-cyan-300 border border-cyan-500/30">${s.planDays} Gün</span>
            <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-400">+%${s.profitPercent}%</span>
          </div>
          <span class="text-[10px] ${isUnlocked ? 'text-emerald-400 font-bold' : 'text-cyan-400'} block font-mono mt-0.5"><i class="fa-solid fa-stopwatch mr-1"></i> ${timeText}</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-5">
        <div class="text-right">
          <span class="text-[10px] text-slate-400 block font-bold">İşleyen Kazanç:</span>
          <strong class="text-emerald-400 font-mono text-sm">+${Number(s.claimedProfit || 0).toFixed(2)} / ${Number(s.expectedProfit).toFixed(0)} ₺</strong>
          <span class="text-[9px] text-slate-500 block font-mono">(~${dailyProfit.toFixed(2)} ₺/Gün)</span>
        </div>
        <div>
          ${s.principalClaimed ? `<span class="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-500 font-bold text-[11px] block">Tahsil Edildi</span>` : (isUnlocked ? `<button type="button" onclick="claimPrincipalReturn(${s.id})" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition cursor-pointer shadow-lg animate-pulse">Anaparayı Çek</button>` : `<span class="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[10px] flex items-center gap-1"><i class="fa-solid fa-coins text-mineora-gold animate-bounce"></i> Günlük Faiz İşliyor</span>`)}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}
window.renderActiveStakes = renderActiveStakes;

if (!stakeTickerInterval) {
  stakeTickerInterval = setInterval(() => {
    const secStake = document.getElementById('sec-stake');
    if (secStake && !secStake.classList.contains('hidden')) {
      processAccruedStakeProfits();
      renderActiveStakes();
    }
  }, 1000);
}
