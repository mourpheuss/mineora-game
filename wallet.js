// ================= 4. BEP-20 ŞAHSİ TRUST WALLET MOTORU (wallet.js) =================
let isWalletProcessing = false;
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

function renderQrCode() {
  const box = document.getElementById('qrcode-container');
  const addrBox = document.getElementById('wallet-trc20-box');
  if (!box) return;

  box.innerHTML = "";
  if (typeof QRCode !== 'undefined') {
    new QRCode(box, {
      text: MASTER_TRUST_WALLET_BEP20,
      width: 140, height: 140,
      colorDark: "#0b0e11", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  if (addrBox) {
    addrBox.value = MASTER_TRUST_WALLET_BEP20;
  }
}

function copyWalletAddress() {
  navigator.clipboard.writeText(MASTER_TRUST_WALLET_BEP20).then(() => {
    showToast("📋 BNB Chain (BEP-20) cüzdan adresi kopyalandı!", "success");
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
    showToast("⚠️ Minimum yatırım bildirimi 10 USDT'dir!", "warning"); 
    return; 
  }

  if (!txid) {
    showToast("⚠️ Lütfen borsadan aldığınız TxID (İşlem Kodu) bilgisini girin!", "warning");
    return;
  }

  isWalletProcessing = true;

  if (typeof queueDepositForAdminApproval === 'function') {
    queueDepositForAdminApproval(CurrentUser.username, amt, txid);
  }
  
  if (amtInput) amtInput.value = "";
  if (txidInput) txidInput.value = "";
  closeModal('modal-wallet');
  showToast(`⏳ $${amt.toFixed(2)} USDT yatırma bildiriminiz alındı. Blokzincir kontrolünden sonra bakiyenize yansıtılacaktır.`, "info");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}

function executeWithdrawal() {
  if (!CurrentUser) return;
  if (CurrentUser.isVaultLocked) { 
    showToast("⛔ Kasası kilitli hesaplar çekim yapamaz.", "warning"); 
    return; 
  }
  if (isWalletProcessing) { 
    showToast("⏳ İşlem yürütülüyor, lütfen bekleyin...", "info"); 
    return; 
  }

  const targetInput = document.getElementById('withdraw-target-address');
  const amtInput = document.getElementById('withdraw-amount-usdt');
  const pwdInput = document.getElementById('withdraw-auth-password');
  const targetAddr = targetInput?.value.trim();
  const amt = parseFloat(amtInput?.value);
  const pwd = pwdInput?.value.trim();

  if (isNaN(amt) || amt <= 0) { showToast("⚠️ Geçerli bir çekim tutarı girin!", "warning"); return; }
  if (amt < 10) { showToast("⚠️ Minimum çekim tutarı 10 USDT'dir!", "warning"); return; }
  
  const isValidAddress = (targetAddr && targetAddr.startsWith('0x') && targetAddr.length === 42);
  if (!targetAddr || !isValidAddress) { 
    showToast("⚠️ '0x' ile başlayan geçerli bir BEP-20 cüzdan adresi girin!", "warning"); 
    return; 
  }

  const currentUsdt = Number(CurrentUser.usdt) || 0;
  if (amt > currentUsdt) { showToast(`⚠️ Yetersiz bakiye! Mevcut USDT: $${currentUsdt.toFixed(2)}`, "warning"); return; }
  if (!pwd) { showToast("⚠️ Güvenlik için hesap şifrenizi girin!", "warning"); return; }
  if (pwd !== CurrentUser.pass) { showToast("❌ Hatalı şifre!", "warning"); return; }

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
  showToast(`🔒 $${amt.toFixed(2)} USDT çekim talebiniz sıraya alındı.`, "success");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}