// ================= 6. ORA BANKASI / STAKE MOTORU (stake.js) =================
const STAKE_PLANS = {
  60: { days: 60, durationMs: 60 * 24 * 60 * 60 * 1000, totalProfitPercent: 100.0, badge: "Standard Vault", dailyRateText: "~1.66% Daily" },
  90: { days: 90, durationMs: 90 * 24 * 60 * 60 * 1000, totalProfitPercent: 200.0, badge: "Silver Vault", dailyRateText: "~2.22% Daily" },
  120: { days: 120, durationMs: 120 * 24 * 60 * 60 * 1000, totalProfitPercent: 300.0, badge: "Gold VIP Vault", dailyRateText: "~2.50% Daily" }
};
let selectedStakeDays = 60, stakeTickerInterval = null;

function setStakePlan(days) {
  selectedStakeDays = days;
  [60, 90, 120].forEach(d => {
    const btn = document.getElementById(`stake-plan-btn-${d}`);
    if (btn) {
      btn.className = (d === days)
        ? "p-4 rounded-2xl bg-gradient-to-r from-amber-500 via-mineora-gold to-yellow-400 text-black font-black border-2 border-yellow-200 shadow-xl cursor-pointer transition transform scale-102 text-left"
        : "p-4 rounded-2xl bg-mineora-bg text-slate-300 border border-mineora-border hover:border-mineora-gold/50 cursor-pointer transition text-left";
    }
  });
  calculateStakePreview();
}

function calculateStakePreview() {
  const amt = parseFloat(document.getElementById('stake-deposit-amount')?.value) || 0;
  const plan = STAKE_PLANS[selectedStakeDays];
  const profit = (amt * plan.totalProfitPercent) / 100;
  const dailyProfit = profit / plan.days;
  const rewardEl = document.getElementById('stake-preview-profit');
  const dailyEl = document.getElementById('stake-preview-daily');
  if (rewardEl) rewardEl.innerText = `+${profit.toFixed(2)} ORA (+${plan.totalProfitPercent}%)`;
  if (dailyEl) dailyEl.innerText = `~${dailyProfit.toFixed(2)} ORA / ${currentLang === 'ru' ? 'День' : 'Day'}`;
}

function fillMaxStake() {
  if (!CurrentUser) return;
  const amtInput = document.getElementById('stake-deposit-amount');
  if (amtInput) {
    amtInput.value = Math.floor(Number(parseFloat(CurrentUser.ora || 0)));
    calculateStakePreview();
  }
}

function executeDepositStake() {
  if (!CurrentUser) return;
  const amtInput = document.getElementById('stake-deposit-amount');
  const amount = parseFloat(amtInput?.value) || 0;
  const currentOra = Number(parseFloat(CurrentUser.ora || 0).toFixed(2));

  if (isNaN(amount) || amount < 100) { showToast(currentLang === 'ru' ? "⚠️ Мин. сумма 100 ORA!" : "⚠️ Minimum stake threshold is 100 ORA!", "warning"); return; }
  if (amount > currentOra) { showToast(currentLang === 'ru' ? `⚠️ Недостаточно ORA! Доступно: ${currentOra.toFixed(2)} ORA` : `⚠️ Insufficient balance! Available: ${currentOra.toFixed(2)} ORA`, "warning"); return; }

  const plan = STAKE_PLANS[selectedStakeDays];
  const now = Date.now(), unlockDate = now + plan.durationMs;
  const expectedProfit = Number(((amount * plan.totalProfitPercent) / 100).toFixed(2));

  CurrentUser.ora = Number((currentOra - amount).toFixed(2));
  if (!CurrentUser.stakes) CurrentUser.stakes = [];

  CurrentUser.stakes.unshift({
    id: Date.now(), amount: amount, planDays: plan.days, profitPercent: plan.totalProfitPercent,
    expectedProfit: expectedProfit, claimedProfit: 0.00, lastAccrualTime: now, startDate: now, unlockDate: unlockDate, principalClaimed: false
  });

  saveUserWorld(); updateHUD();
  if (amtInput) amtInput.value = "";
  calculateStakePreview(); renderActiveStakes();
  showToast(currentLang === 'ru' ? `🔒 ${amount.toLocaleString()} ORA заблокировано на ${plan.days} дн. (+${plan.totalProfitPercent}%)!` : `🔒 ${amount.toLocaleString()} ORA locked for ${plan.days} days targeting +${plan.totalProfitPercent}% yield!`, "success");
}

function processAccruedStakeProfits() {
  if (!CurrentUser || !CurrentUser.stakes || CurrentUser.stakes.length === 0) return;
  const now = Date.now();
  let totalDistributed = 0, updated = false;

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
    CurrentUser.ora = Number(((CurrentUser.ora || 0) + totalDistributed).toFixed(4));
    if (typeof deductMinedOraFromMasterReserve === 'function') deductMinedOraFromMasterReserve(totalDistributed);
    saveUserWorld(); updateHUD();
  }
}

function claimPrincipalReturn(stakeId) {
  if (!CurrentUser || !CurrentUser.stakes) return;
  const s = CurrentUser.stakes.find(item => item.id === stakeId);
  if (!s) return;
  const now = Date.now();
  if (now < s.unlockDate) { showToast(currentLang === 'ru' ? "⏳ Срок блокировки еще не истек!" : "⏳ Vault lock term has not matured yet!", "warning"); return; }
  if (s.principalClaimed) { showToast(currentLang === 'ru' ? "⚠️ Тело вклада уже выплачено на баланс." : "⚠️ Principal already refunded to your wallet.", "info"); return; }

  processAccruedStakeProfits();
  s.principalClaimed = true;
  CurrentUser.ora = Number(((CurrentUser.ora || 0) + s.amount).toFixed(2));
  saveUserWorld(); updateHUD(); renderActiveStakes();
  showToast(currentLang === 'ru' ? `🎉 ${s.amount.toLocaleString()} ORA возвращено на ваш кошелек!` : `🎉 Congratulations! ${s.amount.toLocaleString()} ORA principal returned to wallet!`, "success");
}

function renderActiveStakes() {
  const container = document.getElementById('active-stakes-list');
  if (!container || !CurrentUser) return;
  const stakes = CurrentUser.stakes || [];
  if (stakes.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500 text-xs">${currentLang === 'ru' ? 'Нет активных срочных вкладов ORA.' : 'No active fixed-term ORA vaults currently locked.'}</div>`;
    return;
  }

  const now = Date.now();
  container.innerHTML = "";
  stakes.forEach(s => {
    const isUnlocked = now >= s.unlockDate;
    let timeText = "";
    if (isUnlocked) {
      timeText = currentLang === 'ru' ? "Срок завершен (Разблокировано)" : "Term Matured (Unlocked)";
    } else {
      const leftMs = s.unlockDate - now;
      const leftDays = Math.floor(leftMs / (1000 * 60 * 60 * 24));
      const leftHours = Math.floor((leftMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const leftMins = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
      const leftSecs = Math.floor((leftMs % (1000 * 60)) / 1000);
      timeText = currentLang === 'ru' 
        ? `Осталось: ${leftDays}д ${leftHours}ч ${leftMins}м ${leftSecs}с`
        : `${leftDays}d ${leftHours}h ${leftMins}m ${leftSecs}s remaining`;
    }

    const dailyProfit = s.expectedProfit / s.planDays;
    const card = document.createElement('div');
    card.className = `p-4 rounded-2xl bg-mineora-bg border ${s.principalClaimed ? 'border-slate-800 opacity-60' : (isUnlocked ? 'border-mineora-green/60' : 'border-amber-500/40')} flex flex-wrap items-center justify-between gap-4 text-xs shadow-lg`;
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl ${s.principalClaimed ? 'bg-slate-800 text-slate-400' : (isUnlocked ? 'bg-mineora-green/20 text-mineora-green' : 'bg-amber-500/20 text-amber-400')} flex items-center justify-center text-lg font-black">
          <i class="fa-solid ${s.principalClaimed ? 'fa-check-double' : (isUnlocked ? 'fa-lock-open' : 'fa-vault')}"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <strong class="text-white text-sm font-mono">${s.amount.toLocaleString()} ORA</strong>
            <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-mineora-card text-cyan-300 border border-cyan-500/30">${s.planDays} ${currentLang === 'ru' ? 'Дней' : 'Days'}</span>
            <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-mineora-green/15 text-mineora-green">+${s.profitPercent}%</span>
          </div>
          <span class="text-[10px] ${isUnlocked ? 'text-mineora-green font-bold' : 'text-cyan-400'} block font-mono mt-0.5"><i class="fa-solid fa-stopwatch mr-1"></i> ${timeText}</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-5">
        <div class="text-right">
          <span class="text-[10px] text-slate-400 block font-bold">${currentLang === 'ru' ? 'Начислено дохода:' : 'Yield Accrued:'}</span>
          <strong class="text-mineora-green font-mono text-sm">+${(s.claimedProfit || 0).toFixed(2)} / ${s.expectedProfit.toFixed(0)} ORA</strong>
          <span class="text-[9px] text-slate-500 block font-mono">(~${dailyProfit.toFixed(2)} ORA/${currentLang === 'ru' ? 'День' : 'Day'})</span>
        </div>
        <div>
          ${s.principalClaimed ? `<span class="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-500 font-bold text-[11px] block">${currentLang === 'ru' ? 'Получено' : 'Claimed'}</span>` : (isUnlocked ? `<button type="button" onclick="claimPrincipalReturn(${s.id})" class="px-4 py-2.5 rounded-xl bg-mineora-green hover:opacity-90 text-white font-black text-xs transition cursor-pointer shadow-lg shadow-mineora-green/20 animate-pulse">${currentLang === 'ru' ? 'Забрать Вклад' : 'Reclaim Principal'}</button>` : `<span class="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[10px] flex items-center gap-1"><i class="fa-solid fa-coins text-mineora-gold animate-bounce"></i> ${currentLang === 'ru' ? 'Идет Начисление' : 'Earning Yield'}</span>`)}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

if (!stakeTickerInterval) {
  stakeTickerInterval = setInterval(() => {
    const secStake = document.getElementById('sec-stake');
    if (secStake && !secStake.classList.contains('hidden')) {
      processAccruedStakeProfits();
      renderActiveStakes();
    }
  }, 1000);
}