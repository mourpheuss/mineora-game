// ================= MINA STAKING & YIELD PROTOCOL MOTORU (stake.js) =================

const MINA_STAKE_PLANS = {
  30: { 
    days: 30, 
    dailyRate: 1.5, 
    totalProfitPercent: 45.0, 
    title: "Genesis Alpha Pool", 
    badge: "Flexible Term (30 Days)", 
    minDeposit: 50 
  },
  60: { 
    days: 60, 
    dailyRate: 1.8, 
    totalProfitPercent: 108.0, 
    title: "Recursive ZK Pool", 
    badge: "Compound Yield (60 Days)", 
    minDeposit: 100 
  },
  90: { 
    days: 90, 
    dailyRate: 2.0, 
    totalProfitPercent: 180.0, 
    title: "Samasika Validator VIP", 
    badge: "Institutional VIP (90 Days)", 
    minDeposit: 250 
  }
};

let currentSelectedPlan = 30;

function selectStakePlan(days) {
  currentSelectedPlan = days;
  [30, 60, 90].forEach(d => {
    const btn = document.getElementById(`stake-plan-card-${d}`);
    if (btn) {
      if (d === days) {
        btn.className = "p-5 rounded-2xl bg-gradient-to-br from-orange-500/10 via-amber-500/10 to-transparent border-2 border-orange-500 shadow-md cursor-pointer transition text-left";
      } else {
        btn.className = "p-5 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition text-left";
      }
    }
  });
  updateStakeCalculator();
}

function updateStakeCalculator() {
  const amtInput = document.getElementById('stake-amount-input');
  const amount = parseFloat(amtInput?.value) || 0;
  const plan = MINA_STAKE_PLANS[currentSelectedPlan];

  const totalGain = (amount * plan.totalProfitPercent) / 100;
  const dailyGain = (amount * plan.dailyRate) / 100;

  const totalReturnEl = document.getElementById('calc-total-return');
  const dailyReturnEl = document.getElementById('calc-daily-return');
  const planDurationEl = document.getElementById('calc-plan-duration');

  if (totalReturnEl) totalReturnEl.innerText = `+${totalGain.toFixed(2)} MINA (+${plan.totalProfitPercent}%)`;
  if (dailyReturnEl) dailyReturnEl.innerText = `+${dailyGain.toFixed(2)} MINA / Day (${plan.dailyRate}%)`;
  if (planDurationEl) planDurationEl.innerText = `${plan.days} Days Fixed Term`;
}

function fillMaxStakeAmount() {
  if (!CurrentUser) return;
  const input = document.getElementById('stake-amount-input');
  if (input) {
    input.value = Math.floor(Number(CurrentUser.mina || 0));
    updateStakeCalculator();
  }
}

// 4 KADEMELİ REFERANS KOMİSYONU DAĞITIMI (%10 - %7 - %5 - %3)
function distributeMinaStakingCommissions(stakerUser, stakeAmount) {
  if (!stakerUser || !stakerUser.referral_chain || !stakerUser.referral_chain.length) return;
  
  const tierRates = [0.10, 0.07, 0.05, 0.03];
  const chain = stakerUser.referral_chain;

  for (let i = 0; i < tierRates.length; i++) {
    const sponsorIndex = chain.length - 1 - i;
    if (sponsorIndex < 0) break;

    const sponsorUsername = chain[sponsorIndex];
    const sponsor = getStoredUser(sponsorUsername);
    if (!sponsor) continue;

    const commissionAmount = Number((stakeAmount * tierRates[i]).toFixed(2));
    if (commissionAmount <= 0) continue;

    sponsor.mina = Number(((sponsor.mina || 0) + commissionAmount).toFixed(2));
    
    addUserNotificationLog(
      sponsor,
      `Tier ${i + 1} Staking Commission (%${tierRates[i] * 100})`,
      `${stakerUser.username} staked ${stakeAmount} MINA tokens.`,
      `+${commissionAmount.toFixed(2)} MINA`,
      "commission"
    );

    saveStoredUser(sponsor);

    if (CurrentUser && CurrentUser.username.toLowerCase() === sponsor.username.toLowerCase()) {
      CurrentUser.mina = sponsor.mina;
      CurrentUser.logs = sponsor.logs;
      updateHUD();
    }
  }
}

function executeMinaStakeDeposit() {
  if (!CurrentUser) {
    showToast("⚠️ Please sign in to stake tokens!", "warning");
    return;
  }

  const amtInput = document.getElementById('stake-amount-input');
  const amount = parseFloat(amtInput?.value) || 0;
  const plan = MINA_STAKE_PLANS[currentSelectedPlan];
  const availableBalance = Number(parseFloat(CurrentUser.mina || 0).toFixed(2));

  if (isNaN(amount) || amount < plan.minDeposit) {
    showToast(`⚠️ Minimum stake threshold for this pool is ${plan.minDeposit} MINA!`, "warning");
    return;
  }

  if (amount > availableBalance) {
    showToast(`⚠️ Insufficient balance! Available: ${availableBalance.toFixed(2)} MINA`, "warning");
    return;
  }

  const now = Date.now();
  const unlockTimestamp = now + (plan.days * 24 * 60 * 60 * 1000);
  const targetProfit = Number(((amount * plan.totalProfitPercent) / 100).toFixed(2));

  CurrentUser.mina = Number((availableBalance - amount).toFixed(2));
  if (!CurrentUser.stakes) CurrentUser.stakes = [];

  CurrentUser.stakes.unshift({
    id: Date.now(),
    amount: amount,
    planDays: plan.days,
    dailyRate: plan.dailyRate,
    totalProfitPercent: plan.totalProfitPercent,
    expectedProfit: targetProfit,
    claimedProfit: 0.00,
    startDate: now,
    lastAccrualTime: now,
    unlockDate: unlockTimestamp,
    principalClaimed: false
  });

  // Komisyon dağıtımı
  distributeMinaStakingCommissions(CurrentUser, amount);

  addUserNotificationLog(
    CurrentUser,
    "Staking Position Locked",
    `${amount} MINA locked into ${plan.title} (${plan.days} Days).`,
    `-${amount.toFixed(2)} MINA`,
    "stake"
  );

  saveUserWorld();
  updateHUD();

  if (amtInput) amtInput.value = "";
  updateStakeCalculator();
  renderUserStakesList();

  showToast(`🎉 Successfully locked ${amount} MINA for ${plan.days} days!`, "success");
}

function accrueLiveMinaYields() {
  if (!CurrentUser || !CurrentUser.stakes || !CurrentUser.stakes.length) return;
  const now = Date.now();
  let totalAccrued = 0;
  let hasUpdate = false;

  CurrentUser.stakes.forEach(s => {
    const effectiveTime = Math.min(now, s.unlockDate);
    const elapsed = effectiveTime - (s.lastAccrualTime || s.startDate);
    
    if (elapsed > 0 && s.claimedProfit < s.expectedProfit) {
      const totalDurationMs = s.planDays * 24 * 60 * 60 * 1000;
      const ratePerMs = s.expectedProfit / totalDurationMs;
      const newlyEarned = Math.min(elapsed * ratePerMs, s.expectedProfit - s.claimedProfit);

      if (newlyEarned > 0.0001) {
        s.claimedProfit = Number((s.claimedProfit + newlyEarned).toFixed(4));
        s.lastAccrualTime = effectiveTime;
        totalAccrued += newlyEarned;
        hasUpdate = true;
      }
    }
  });

  if (hasUpdate && totalAccrued > 0) {
    CurrentUser.mina = Number(((CurrentUser.mina || 0) + totalAccrued).toFixed(4));
    saveUserWorld();
    updateHUD();
  }
}

function claimMinaPrincipal(stakeId) {
  if (!CurrentUser || !CurrentUser.stakes) return;
  const s = CurrentUser.stakes.find(i => i.id === stakeId);
  if (!s) return;

  const now = Date.now();
  if (now < s.unlockDate) {
    showToast("⏳ This staking position is still within its lock duration!", "warning");
    return;
  }
  if (s.principalClaimed) {
    showToast("⚠️ Principal amount has already been claimed.", "info");
    return;
  }

  accrueLiveMinaYields();
  s.principalClaimed = true;
  CurrentUser.mina = Number(((CurrentUser.mina || 0) + s.amount).toFixed(2));

  addUserNotificationLog(
    CurrentUser,
    "Principal Released",
    `${s.amount} MINA principal unlocked and transferred back to wallet.`,
    `+${s.amount.toFixed(2)} MINA`,
    "income"
  );

  saveUserWorld();
  updateHUD();
  renderUserStakesList();

  showToast(`🎉 ${s.amount} MINA principal returned to your balance!`, "success");
}

function renderUserStakesList() {
  const container = document.getElementById('user-stakes-container');
  if (!container || !CurrentUser) return;

  const stakes = CurrentUser.stakes || [];
  if (stakes.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs">No active staking deposits found. Select a pool above to start earning.</div>`;
    return;
  }

  const now = Date.now();
  container.innerHTML = "";

  stakes.forEach(s => {
    const isUnlocked = now >= s.unlockDate;
    let timeStr = "";

    if (isUnlocked) {
      timeStr = "Matured & Ready to Claim";
    } else {
      const leftMs = s.unlockDate - now;
      const days = Math.floor(leftMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((leftMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
      timeStr = `${days}d ${hours}h ${mins}m left`;
    }

    const card = document.createElement('div');
    card.className = `p-4 rounded-2xl border ${s.principalClaimed ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200/90 shadow-sm'} flex flex-wrap items-center justify-between gap-4 text-xs`;
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl ${isUnlocked ? 'bg-emerald-100 text-emerald-600' : 'bg-orange-100 text-orange-600'} flex items-center justify-center font-bold text-base">
          ${isUnlocked ? '✓' : '🔒'}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <strong class="text-slate-900 text-sm font-display">${s.amount.toLocaleString()} MINA</strong>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">${s.planDays} Days</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600">+${s.totalProfitPercent}%</span>
          </div>
          <span class="text-[11px] ${isUnlocked ? 'text-emerald-600 font-semibold' : 'text-slate-500'} block mt-0.5">${timeStr}</span>
        </div>
      </div>

      <div class="flex items-center gap-6">
        <div class="text-right">
          <span class="text-[10px] text-slate-400 block font-medium">Earned Yield</span>
          <strong class="text-emerald-600 font-display text-sm font-bold">+${(s.claimedProfit || 0).toFixed(2)} / ${s.expectedProfit} MINA</strong>
        </div>
        <div>
          ${s.principalClaimed ? `
            <span class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 font-semibold text-xs">Completed</span>
          ` : (isUnlocked ? `
            <button onclick="claimMinaPrincipal(${s.id})" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition">Reclaim Principal</button>
          ` : `
            <span class="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 font-semibold text-xs flex items-center gap-1">⚡ Earning</span>
          `)}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// 1 saniyelik canlı kâr sayaç döngüsü
setInterval(() => {
  accrueLiveMinaYields();
  const stakeView = document.getElementById('user-stakes-container');
  if (stakeView && !stakeView.classList.contains('hidden')) {
    renderUserStakesList();
  }
}, 1000);
