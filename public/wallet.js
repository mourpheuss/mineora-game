// ================= MINA NATIVE L1 DEPOSIT & WITHDRAWAL ENGINE (wallet.js) =================

// Resmi Bitget MINA Katman-1 Yatırma Adresin
const PLATFORM_MINA_VAULT_ADDRESS = "B62qogfXV8GznR474iXWfB1XVdbeQ6KzWUcjvVHzEhgKjixF8svw99V";

function renderDepositQrCode() {
  const container = document.getElementById('deposit-qrcode-box');
  if (!container) return;

  container.innerHTML = "";
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: PLATFORM_MINA_VAULT_ADDRESS,
      width: 140,
      height: 140,
      colorDark: "#020617",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }
}

function copyPlatformMinaAddress() {
  navigator.clipboard.writeText(PLATFORM_MINA_VAULT_ADDRESS).then(() => {
    showToast("📋 Bitget MINA deposit address copied!", "success");
  });
}

function submitDepositTransaction() {
  if (!CurrentUser) {
    showToast("⚠️ Please sign in to submit a deposit!", "warning");
    return;
  }

  const amtInput = document.getElementById('dep-tx-amount');
  const hashInput = document.getElementById('dep-tx-hash');

  const amount = parseFloat(amtInput?.value) || 0;
  const txHash = hashInput?.value.trim();

  if (isNaN(amount) || amount < 1) {
    showToast("⚠️ Minimum deposit amount is 1 MINA!", "warning");
    return;
  }
  if (!txHash || txHash.length < 10) {
    showToast("⚠️ Please enter a valid Transaction Hash / TxID from Bitget or your wallet!", "warning");
    return;
  }

  const depId = `dep_${Date.now()}`;
  const payload = {
    id: depId,
    username: CurrentUser.username,
    asset: "MINA",
    amount: Number(amount.toFixed(2)),
    txHash: txHash,
    targetVault: PLATFORM_MINA_VAULT_ADDRESS,
    date: new Date().toLocaleString('en-US'),
    status: 'pending'
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`depositQueue/${depId}`).set(payload).then(() => {
      closeModal('depositModal');
      if (amtInput) amtInput.value = "";
      if (hashInput) hashInput.value = "";
      showToast("⏳ Deposit receipt submitted! Awaiting administrator on-chain confirmation.", "info");
    }).catch(err => {
      showToast("⛔ Submission error: " + err.message, "warning");
    });
  } else {
    closeModal('depositModal');
    showToast("⏳ Deposit receipt recorded (local).", "info");
  }
}
