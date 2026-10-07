// ================= BANKA HAVALE/EFT & TL CÜZDAN MOTORU (wallet.js) =================
let isWalletProcessing = false;

// DAHA SONRA VERECEĞİNİZ ŞİRKET VE IBAN BİLGİLERİ (Burayı güncelleyebilirsiniz)
const BANK_CONFIG = {
  companyName: "MINEORA TEKNOLOJİ A.Ş. (Örnek Şirket)",
  bankName: "Ziraat Bankası / Garanti BBVA",
  iban: "TR00 0000 0000 0000 0000 0000 00"
};

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

function copyCompanyIban() {
  navigator.clipboard.writeText(BANK_CONFIG.iban.replace(/\s/g, '')).then(() => {
    showToast("📋 Şirket IBAN adresi kopyalandı!", "success");
  });
}

function fillMaxWithdraw() {
  if (!CurrentUser) return;
  const withInput = document.getElementById('withdraw-amount-tl');
  if (withInput) withInput.value = Math.max(0, CurrentUser.tl || 0).toFixed(2);
}

// Para Yatırma Bildirimi (Havale / EFT)
function submitDepositReceipt() {
  if (!CurrentUser || isWalletProcessing) return;
  const senderNameInput = document.getElementById('deposit-sender-name');
  const amtInput = document.getElementById('deposit-amount-input');
  
  const senderName = senderNameInput?.value.trim();
  const amt = parseFloat(amtInput?.value) || 0;

  if (!senderName || senderName.length < 3) {
    showToast("⚠️ Lütfen havaleyi gönderdiğiniz Adı ve Soyadı girin!", "warning");
    return;
  }
  if (isNaN(amt) || amt < 50) { 
    showToast("⚠️ Minimum yatırım bildirimi 50 ₺'dir!", "warning"); 
    return; 
  }

  isWalletProcessing = true;

  if (typeof queueDepositForAdminApproval === 'function') {
    queueDepositForAdminApproval(CurrentUser.username, amt, senderName);
  }
  
  if (senderNameInput) senderNameInput.value = "";
  if (amtInput) amtInput.value = "";
  closeModal('modal-wallet');
  showToast(`⏳ ${amt.toFixed(2)} ₺ yatırma bildiriminiz alındı. Muhasebe onayından sonra bakiyenize yansıyacaktır.`, "info");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}

// Para Çekme Talebi (Banka Hesabına)
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

  const holderName = document.getElementById('withdraw-holder-name')?.value.trim();
  const iban = document.getElementById('withdraw-target-iban')?.value.trim().replace(/\s/g, '');
  const amt = parseFloat(document.getElementById('withdraw-amount-tl')?.value);
  const pwd = document.getElementById('withdraw-auth-password')?.value.trim();

  if (!holderName || holderName.length < 3) {
    showToast("⚠️ Lütfen hesap sahibinin Adını ve Soyadını girin!", "warning");
    return;
  }
  if (!iban || !iban.toUpperCase().startsWith("TR") || iban.length !== 26) {
    showToast("⚠️ Lütfen 'TR' ile başlayan 26 haneli geçerli bir IBAN girin!", "warning");
    return;
  }
  if (isNaN(amt) || amt < 100) { 
    showToast("⚠️ Minimum çekim tutarı 100 ₺'dir!", "warning"); 
    return; 
  }

  const currentTl = Number(CurrentUser.tl) || 0;
  if (amt > currentTl) { 
    showToast(`⚠️ Yetersiz bakiye! Mevcut TL: ${currentTl.toFixed(2)} ₺`, "warning"); 
    return; 
  }
  if (!pwd) { 
    showToast("⚠️ Güvenlik için hesap şifrenizi girin!", "warning"); 
    return; 
  }
  if (pwd !== CurrentUser.pass) { 
    showToast("❌ Hatalı şifre!", "warning"); 
    return; 
  }

  isWalletProcessing = true;
  CurrentUser.tl = Number((currentTl - amt).toFixed(2));
  saveUserWorld(); 
  updateHUD();

  if (typeof queueWithdrawalForAdminApproval === 'function') {
    queueWithdrawalForAdminApproval(CurrentUser.username, amt, `${holderName} - ${iban}`);
  }

  document.getElementById('withdraw-holder-name').value = "";
  document.getElementById('withdraw-target-iban').value = "";
  document.getElementById('withdraw-amount-tl').value = "";
  document.getElementById('withdraw-auth-password').value = "";

  closeModal('modal-wallet');
  showToast(`🔒 ${amt.toFixed(2)} ₺ çekim talebiniz banka sırasına alındı.`, "success");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}
