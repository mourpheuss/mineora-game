// ================= BANKA HAVALE, RESMİ ŞİRKET HESABI & DEKONT MOTORU (wallet.js) =================
let isWalletProcessing = false;

const BANK_CONFIG = {
  companyName: "Medya Grup Dijital Yazılım Bilişim Hizmetleri San Tic Ltd Şti",
  bankName: "Garanti BBVA / Ziraat Bankası",
  iban: "TR25 0021 2000 0005 1028 9000 01"
};

function copyCompanyIban() {
  const cleanIban = BANK_CONFIG.iban.replace(/\s/g, '');
  navigator.clipboard.writeText(cleanIban).then(() => {
    showToast("📋 Resmi şirket IBAN adresi kopyalandı!", "success");
  });
}
window.copyCompanyIban = copyCompanyIban;

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
      ? "flex-1 py-3 rounded-2xl font-black text-xs bg-gradient-to-r from-amber-500 to-mineora-gold text-black shadow-lg cursor-pointer" 
      : "flex-1 py-3 rounded-2xl font-bold text-xs text-slate-400 hover:text-white hover:bg-mineora-input/50 transition cursor-pointer";
  }
  if (withBtn) {
    withBtn.className = !isDep 
      ? "flex-1 py-3 rounded-2xl font-black text-xs bg-gradient-to-r from-emerald-500 to-teal-400 text-black shadow-lg cursor-pointer" 
      : "flex-1 py-3 rounded-2xl font-bold text-xs text-slate-400 hover:text-white hover:bg-mineora-input/50 transition cursor-pointer";
  }
}
window.setWalletTab = setWalletTab;

function fillMaxWithdraw() {
  if (!CurrentUser) return;
  const withInput = document.getElementById('withdraw-amount-tl');
  if (withInput) withInput.value = Math.max(0, CurrentUser.tl || 0).toFixed(2);
}
window.fillMaxWithdraw = fillMaxWithdraw;

// ZORUNLU DEKONT GÖRSELİ KONTROLÜ VE BASE64 ÇEVİRİSİ
function submitDepositReceipt() {
  if (!CurrentUser || isWalletProcessing) return;
  const senderNameInput = document.getElementById('deposit-sender-name');
  const amtInput = document.getElementById('deposit-amount-input');
  const fileInput = document.getElementById('deposit-receipt-file');

  const senderName = senderNameInput?.value.trim();
  const amt = parseFloat(amtInput?.value) || 0;
  const file = fileInput?.files ? fileInput.files[0] : null;

  if (!senderName || senderName.length < 3) {
    showToast("⚠️ Lütfen havaleyi gönderdiğiniz Adı ve Soyadı girin!", "warning");
    return;
  }
  if (isNaN(amt) || amt < 100) { 
    showToast("⚠️ Minimum yatırım bildirimi 100 ₺'dir!", "warning"); 
    return; 
  }
  if (!file) {
    showToast("⚠️ Banka dekontu görseli yüklemek ZORUNLUDUR!", "warning");
    return;
  }

  isWalletProcessing = true;
  showToast("⏳ Dekont yükleniyor ve doğrulanıyor...", "info");

  // Dekont görselini Base64'e çevirip yönetici onay masasına iletiyoruz
  const reader = new FileReader();
  reader.onload = function(e) {
    const receiptBase64 = e.target.result;
    
    if (typeof queueDepositForAdminApproval === 'function') {
      queueDepositForAdminApproval(CurrentUser.username, amt, senderName, receiptBase64);
    }

    if (senderNameInput) senderNameInput.value = "";
    if (amtInput) amtInput.value = "";
    if (fileInput) fileInput.value = "";

    closeModal('modal-wallet');
    showToast(`✅ Dekontunuz yüklendi! ${amt.toLocaleString()} ₺ yatırım bildiriminiz yönetici onayına iletildi.`, "success");
    setTimeout(() => { isWalletProcessing = false; }, 1000);
  };

  reader.onerror = function() {
    showToast("❌ Dekont dosyası okunamadı, lütfen başka bir format deneyin.", "warning");
    isWalletProcessing = false;
  };

  reader.readAsDataURL(file);
}
window.submitDepositReceipt = submitDepositReceipt;

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
  showToast(`🔒 ${amt.toFixed(2)} ₺ çekim talebiniz sıraya alındı.`, "success");
  setTimeout(() => { isWalletProcessing = false; }, 1000);
}
window.executeWithdrawal = executeWithdrawal;
