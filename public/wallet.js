// ================= MINA & USDT DEPOSIT / WITHDRAWAL MOTORU (wallet.js) =================

// Platform Resmi Yatırma Adresleri
const PLATFORM_MINA_NATIVE_VAULT = "B62qjS5XoXN9Y2jHk1T4Q7mP8z3v6L2w9Y7x5A4b1c2D3e4F5g6H7i8";
const PLATFORM_USDT_BEP20_VAULT = "0x9bCaE8db59621D8A3345405D92ECA803c9D6C431";

let selectedDepositAsset = 'MINA';

function setDepositAsset(asset) {
  selectedDepositAsset = asset;
  const isMina = asset === 'MINA';

  const btnMina = document.getElementById('dep-asset-btn-mina');
  const btnUsdt = document.getElementById('dep-asset-btn-usdt');
  const addrBox = document.getElementById('deposit-address-display');
  const networkBadge = document.getElementById('deposit-network-badge');

  if (btnMina) btnMina.className = isMina 
    ? "flex-1 py-2 rounded-lg bg-slate-900 text-white font-bold text-xs shadow-sm" 
    : "flex-1 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold text-xs hover:bg-slate-200";

  if (btnUsdt) btnUsdt.className = !isMina 
    ? "flex-1 py-2 rounded-lg bg-slate-900 text-white font-bold text-xs shadow-sm" 
    : "flex-1 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold text-xs hover:bg-slate-200";

  if (addrBox) addrBox.value = isMina ? PLATFORM_MINA_NATIVE_VAULT : PLATFORM_USDT_BEP20_VAULT;
  if (networkBadge) networkBadge.innerText = isMina ? "Network: Mina Protocol (Native L1)" : "Network: BNB Smart Chain (BEP-20)";
}

function copyDepositAddress() {
  const addr = selectedDepositAsset === 'MINA' ? PLATFORM_MINA_NATIVE_VAULT : PLATFORM_USDT_BEP20_VAULT;
  navigator.clipboard.writeText(addr).then(() => {
    showToast(`📋 ${selectedDepositAsset} deposit address copied!`, "success");
  });
}

function submitDepositTransaction() {
  if (!CurrentUser) return;
  const amtInput = document.getElementById('dep-tx-amount');
  const hashInput = document.getElementById('dep-tx-hash');

  const amount = parseFloat(amtInput?.value) || 0;
  const txHash = hashInput?.value.trim();

  if (isNaN(amount) || amount <= 0) {
    showToast("⚠️ Please enter a valid deposit amount!", "warning");
    return;
  }
  if (!txHash || txHash.length < 10) {
    showToast("⚠️ Please enter a valid Transaction Hash / TxID from Bitget!", "warning");
    return;
  }

  const depId = `dep_${Date.now()}`;
  const payload = {
    id: depId,
    username: CurrentUser.username,
    asset: selectedDepositAsset,
    amount: amount,
    txHash: txHash,
    date: new Date().toLocaleString('en-US'),
    status: 'pending'
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`depositQueue/${depId}`).set(payload).then(() => {
      closeModal('depositModal');
      if (amtInput) amtInput.value = "";
      if (hashInput) hashInput.value = "";
      showToast("⏳ Deposit receipt submitted! Awaiting automated on-chain confirmation.", "info");
    }).catch(err => {
      showToast("⛔ Submission error: " + err.message, "warning");
    });
  } else {
    closeModal('depositModal');
    showToast("⏳ Deposit receipt recorded (local).", "info");
  }
}
