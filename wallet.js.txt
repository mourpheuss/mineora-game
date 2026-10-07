// ================= 4. BEP-20 / NOWPAYMENTS CÜZDAN MOTORU (wallet.js) =================
let isWalletProcessing = false;
const NOWPAYMENTS_API_KEY = "101Y7VW-THAMMMS-P2AJF28-H1V76AX";
const MASTER_TRUST_WALLET_BEP20 = "0x9bCaE8db59621D8A3345405D92ECA803c9D6C431";

function setWalletTab(tab) {
  const isDep = tab === 'deposit';
  const depView = document.getElementById('wallet-view-deposit');
  const withView = document.getElementById('wallet-view-withdraw');
  const depBtn = document.getElementById('wallet-tab-btn-deposit');
  const withBtn = document.getElementById('wallet-tab-btn-withdraw');

  if (depView) depView.classList.toggle('hidden', !isDep);
  if (withView) withView.classList.toggle('hidden', isDep);

  if (depBtn) {
    depBtn.className = isDep 
      ? "flex-1 py-3 rounded-2xl font-black text-xs bg-gradient-to-r from-amber-500 to-mineora-gold text-black shadow-lg shadow-mineora-gold/20 transition cursor-pointer flex items-center justify-center gap-2" 
      : "flex-1 py-3 rounded-2xl font-bold text-xs text-slate-400 hover:text-white hover:bg-mineora-input/50 transition cursor-pointer flex items-center justify-center gap-2";
  }
  if (withBtn) {
    withBtn.className = !isDep 
      ? "flex-1 py-3 rounded-2xl font-black text-xs bg-gradient-to-r from-emerald-500 to-teal-400 text-black shadow-lg shadow-emerald-500/20 transition cursor-pointer flex items-center justify-center gap-2" 
      : "flex-1 py-3 rounded-2xl font-bold text-xs text-slate-400 hover:text-white hover:bg-mineora-input/50 transition cursor-pointer flex items-center justify-center gap-2";
  }
}

async function getOrCreateUserDepositAddress(username) {
  if (!username) return MASTER_TRUST_WALLET_BEP20;

  if (CurrentUser && CurrentUser.bep20DepositAddress) {
    return CurrentUser.bep20DepositAddress;
  }

  try {
    const response = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: 10,
        price_currency: "usd",
        pay_currency: "usdtbsc",
        order_id: `DEP_${username}_${Date.now()}`,
        order_description: `Mineora Deposit - ${username}`
      })
    });

    const data = await response.json();
    if (data && data.pay_address) {
      if (CurrentUser) {
        CurrentUser.bep20DepositAddress = data.pay_address;
        CurrentUser.lastPaymentId = data.payment_id;
        if (typeof saveUserWorld === 'function') saveUserWorld();
      }
      return data.pay_address;
    }
  } catch (err) {
    console.warn("NOWPayments automated address warning, master vault used:", err);
  }

  return MASTER_TRUST_WALLET_BEP20;
}

async function renderQrCode() {
  const box = document.getElementById('qrcode-container');
  const addrBox = document.getElementById('wallet-trc20-box');
  if (!box) return;
  box.innerHTML = "<div class='text-xs text-slate-500 py-8 flex items-center justify-center animate-pulse'>Generating Secure BEP-20 (BSC) Address...</div>";

  const username = CurrentUser ? CurrentUser.username : "";
  const dedicatedAddr = await getOrCreateUserDepositAddress(username);

  box.innerHTML = "";
  if (typeof QRCode !== 'undefined') {
    new QRCode(box, {
      text: dedicatedAddr,
      width: 140, height: 140,
      colorDark: "#0b0e11", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  if (addrBox) {
    addrBox.value = dedicatedAddr;
  }
}

function copyWalletAddress() {
  const addrBox = document.getElementById('wallet-trc20-box');
  const target = addrBox?.value || CurrentUser?.bep20DepositAddress || MASTER_TRUST_WALLET_BEP20;
  if (!target) return;
  
  navigator.clipboard.writeText(target).then(() => {
    showToast("📋 Dedicated BNB Chain (BEP-20) deposit address copied!", "success");
  });
}

function fillMaxWithdraw() {
  if (!CurrentUser) return;
  const withInput = document.getElementById('withdraw-amount-usdt');
  if (withInput) withInput.value = Math.max(0, CurrentUser.usdt || 0).toFixed(2);
}

function submitDepositReceipt() {
  if (!CurrentUser || isWalletProcessing) return;
  const amtInput = document.getElementById('deposit-amount-input');
  const txidInput = document.getElementById('deposit-txid-input');
  const amt = parseFloat(amtInput?.value) || 0;
  let txid = txidInput?.value.trim();

  if (isNaN(amt) || amt < 10) { 
    showToast("⚠️ Minimum deposit settlement is 10 USDT!", "warning"); 
    return; 
  }

  if (!txid) {
    txid = `BSC-AUTO-${Date.now().toString(36).toUpperCase()}`;
  }

  const existingDeposits = (typeof AdminState !== 'undefined' && AdminState.pendingDeposits) ? AdminState.pendingDeposits : [];
  if (existingDeposits.some(d => d.txid && d.txid.toLowerCase() === txid.toLowerCase())) {
    showToast("⛔ This transfer identifier is already queued!", "warning"); 
    return; 
  }

  isWalletProcessing = true;
  const dedicatedAddr = CurrentUser.bep20DepositAddress || MASTER_TRUST_WALLET_BEP20;

  if (typeof queueDepositForAdminApproval === 'function') {
    queueDepositForAdminApproval(CurrentUser.username, amt, `${txid} [BEP-20 Target: ${dedicatedAddr.slice(0, 6)}...${dedicatedAddr.slice(-4)}]`);
  }
  
  if (amtInput) amtInput.value = "";
  if (txidInput) txidInput.value = "";
  closeModal('modal-wallet');
  showToast(`⏳ $${amt.toFixed(2)} USDT deposit notification sent. Funds will credit upon network validation.`, "info");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}

function executeWithdrawal() {
  if (!CurrentUser) return;
  if (CurrentUser.isVaultLocked) { 
    showToast("⛔ Vault locked accounts cannot withdraw. Contact support desk.", "warning"); 
    return; 
  }
  if (isWalletProcessing) { 
    showToast("⏳ Processing request, please wait...", "info"); 
    return; 
  }

  const targetInput = document.getElementById('withdraw-target-address');
  const amtInput = document.getElementById('withdraw-amount-usdt');
  const pwdInput = document.getElementById('withdraw-auth-password');
  const targetAddr = targetInput?.value.trim();
  const amt = parseFloat(amtInput?.value);
  const pwd = pwdInput?.value.trim();

  if (isNaN(amt) || amt <= 0) { showToast("⚠️ Enter valid withdrawal amount!", "warning"); return; }
  if (amt < 10) { showToast("⚠️ Minimum withdrawal is 10 USDT!", "warning"); return; }
  
  const isValidAddress = (targetAddr && targetAddr.startsWith('0x') && targetAddr.length === 42) || (targetAddr && targetAddr.startsWith('T') && targetAddr.length >= 30);
  if (!targetAddr || !isValidAddress) { 
    showToast("⚠️ Enter a valid BNB Chain (BEP-20) address starting with '0x'!", "warning"); 
    return; 
  }

  const currentUsdt = Number(CurrentUser.usdt) || 0;
  if (amt > currentUsdt) { showToast(`⚠️ Insufficient balance! Current USDT: $${currentUsdt.toFixed(2)}`, "warning"); return; }
  if (!pwd) { showToast("⚠️ Confirm account password for security!", "warning"); return; }
  if (pwd !== CurrentUser.pass) { showToast("❌ Incorrect password! Request aborted.", "warning"); return; }

  isWalletProcessing = true;
  CurrentUser.usdt = Number((currentUsdt - amt).toFixed(2));
  saveUserWorld(); 
  updateHUD();

  if (typeof queueWithdrawalForAdminApproval === 'function') {
    queueWithdrawalForAdminApproval(CurrentUser.username, amt, targetAddr);
  }
  
  if (targetInput) targetInput.value = "";
  if (amtInput) amtInput.value = "";
  if (pwdInput) pwdInput.value = "";

  closeModal('modal-wallet');
  showToast(`🔒 $${amt.toFixed(2)} USDT withdrawal queued. Funds will be sent to your wallet.`, "success");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}