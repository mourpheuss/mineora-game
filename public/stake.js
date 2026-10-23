// ================= MINA STAKING & 4-TIER FIREBASE KOMİSYON MOTORU (stake.js) =================

const MINA_STAKE_PLANS = {
  30: { 
    days: 30, 
    dailyRate: 1.5, 
    totalProfitPercent: 45.0, 
    title: "Genesis Alpha Pool", 
    minDeposit: 50 
  },
  60: { 
    days: 60, 
    dailyRate: 1.8, 
    totalProfitPercent: 108.0, 
    title: "Recursive ZK Pool", 
    minDeposit: 100 
  },
  90: { 
    days: 90, 
    dailyRate: 2.0, 
    totalProfitPercent: 180.0, 
    title: "Samasika Validator VIP", 
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

// 4 KADEMELİ CANLI FIREBASE KOMİSYON DAĞITICI (%10 - %7 - %5 - %3)
// KULLANICININ YATIRDIĞI BAKİYEDEN KESİLMEZ, SPONSORLARA PROTOKOL TARAFINDAN AKTARILIR!
async function distributeMinaStakingCommissions(stakerUsername, stakeAmount) {
  const tierRates = [0.10, 0.07, 0.05, 0.03]; // 1. Kademe %10, 2. Kademe %7, 3. Kademe %5, 4. Kademe %3
  
  if (!fbDb) return;

  try {
    // 1. Yatırım yapan kullanıcının güncel sponsor zincirini çek
    const stakerSnap = await fbDb.ref(`users/${stakerUsername.toLowerCase()}`).once('value');
    const stakerData = stakerSnap.val();
    if (!stakerData) return;

    let chain = stakerData.referral_chain || [];
    
    // Eğer referral_chain boşsa ama referredBy varsa tekil zincir kur
    if ((!chain || chain.length === 0) && stakerData.referredBy) {
      chain = [stakerData.referredBy];
    }

    if (!chain || chain.length === 0) return;

    // Zincirdeki sponsorlara sırayla dağıt (En yakından en uzağa)
    for (let i = 0; i < tierRates.length; i++) {
      const sponsorIndex = chain.length - 1 - i;
      if (sponsorIndex < 0) break; // Üst sponsor kalmadıysa döngüyü bitir

      const sponsorName = chain[sponsorIndex];
      if (!sponsorName) continue;

      const rate = tierRates[i];
      const commissionAmount = Number((stakeAmount * rate).toFixed(2));
      if (commissionAmount <= 0) continue;

      const spKey = sponsorName.toLowerCase();
      const spSnap = await fbDb.ref(`users/${spKey}`).once('value');
      const sponsorUser = spSnap.val();

      if (sponsorUser) {
        // Sponsora komisyonu ekle
        sponsorUser.mina = Number(((sponsorUser.mina || 0) + commissionAmount).toFixed(2));
        
        // Log kayıtlarına gelir bildirimi ekle
        if (!sponsorUser.logs) sponsorUser.logs = [];
        sponsorUser.logs.unshift({
          id: Date.now() + i,
          title: `Tier ${i + 1} Referans Komisyonu (%${rate * 100})`,
          desc: `${stakerUsername} kullanıcısının ${stakeAmount} MINA stake işleminden kazanıldı.`,
          amountText: `+${commissionAmount.toFixed(2)} MINA`,
          type: "income",
          time: new Date().toLocaleTimeString('tr-TR'),
          date: new Date().toLocaleDateString('tr-TR')
        });

        // Firebase'e canlı kaydet
        await fbDb.ref(`users/${spKey}`).set(sponsorUser);

        // Eğer şu an giriş yapmış kullanıcı komisyonu alan sponsorsa arayüzünü anında güncelle
        if (CurrentUser && CurrentUser.username.toLowerCase() === spKey) {
          CurrentUser.mina = sponsorUser.mina;
          CurrentUser.logs = sponsorUser.logs;
          if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
        }
      }
    }
  } catch (err) {
    console.error("Komisyon dağıtım hatası:", err);
  }
}

// STAKE İŞLEMİ
async function executeMinaStakeDeposit() {
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

  // Kullanıcının boşta bakiyesinden kilitlenen tutar düşülür (KULLANICIDAN EKSTRA BİR ŞEY KESİLMEZ)
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

  if (!CurrentUser.logs) CurrentUser.logs = [];
  CurrentUser.logs.unshift({
    id: Date.now(),
    title: "Staking Pozisyonu Kilitlendi",
    desc: `${amount} MINA tutar ${plan.days} gün boyunca ${plan.title} havuzuna kilitlendi.`,
    amountText: `-${amount.toFixed(2)} MINA`,
    type: "stake",
    time: new Date().toLocaleTimeString('tr-TR'),
    date: new Date().toLocaleDateString('tr-TR')
  });

  // 1. Kendi hesabını Firebase'e kaydet
  if (fbDb) {
    await fbDb.ref(`users/${CurrentUser.username.toLowerCase()}`).set(CurrentUser);
  } else {
    saveUserWorld();
  }

  // 2. SPONSORLARINA OTOMATİK 4 KADEMELİ KOMİSYON DAĞIT
  await distributeMinaStakingCommissions(CurrentUser.username, amount);

  if (amtInput) amtInput.value = "";
  updateStakeCalculator();
  renderUserStakesList();
  if (typeof refreshDashboardUI === 'function') refreshDashboardUI();

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
    if (fbDb) {
      fbDb.ref(`users/${CurrentUser.username.toLowerCase()}/mina`).set(CurrentUser.mina);
      fbDb.ref(`users/${CurrentUser.username.toLowerCase()}/stakes`).set(CurrentUser.stakes);
    } else {
      saveUserWorld();
    }
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

  if (!CurrentUser.logs) CurrentUser.logs = [];
  CurrentUser.logs.unshift({
    id: Date.now(),
    title: "Ana Para Serbest Bırakıldı",
    desc: `${s.amount} MINA kilit süresi doldu ve cüzdana aktarıldı.`,
    amountText: `+${s.amount.toFixed(2)} MINA`,
    type: "income",
    time: new Date().toLocaleTimeString('tr-TR'),
    date: new Date().toLocaleDateString('tr-TR')
  });

  if (fbDb) {
    fbDb.ref(`users/${CurrentUser.username.toLowerCase()}`).set(CurrentUser);
  } else {
    saveUserWorld();
  }

  renderUserStakesList();
  if (typeof refreshDashboardUI === 'function') refreshDashboardUI();

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

// Canlı kâr sayaç döngüsü
setInterval(() => {
  accrueLiveMinaYields();
  const stakeView = document.getElementById('user-stakes-container');
  if (stakeView && !stakeView.classList.contains('hidden')) {
    renderUserStakesList();
  }
}, 1000);
