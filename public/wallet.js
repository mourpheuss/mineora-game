// ================= MINA NATIVE L1 DEPOSIT & WITHDRAWAL ENGINE (wallet.js) =================

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
    showToast("📋 Bitget MINA yatırma adresi kopyalandı!", "success");
  });
}

// 1. DEPOZİT BİLDİRİMİNİ ADMİN KUYRUĞUNA GÖNDER
function submitDepositTransaction() {
  if (!CurrentUser) {
    showToast("⚠️ İşlem yapmak için lütfen giriş yapın!", "warning");
    return;
  }
  if (CurrentUser.isVaultLocked) {
    showToast("⛔ Hesabınız kilitli durumdadır, işlem yapamazsınız!", "warning");
    return;
  }

  const amtInput = document.getElementById('dep-tx-amount');
  const hashInput = document.getElementById('dep-tx-hash');

  const amount = parseFloat(amtInput?.value) || 0;
  const txHash = hashInput?.value.trim();

  if (isNaN(amount) || amount < 1) {
    showToast("⚠️ Minimum yatırma tutarı 1 MINA'dır!", "warning");
    return;
  }
  if (!txHash || txHash.length < 10) {
    showToast("⚠️ Lütfen geçerli bir İşlem Kodu (TxID / Hash) girin!", "warning");
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
    date: new Date().toLocaleString('tr-TR'),
    status: 'pending'
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`depositQueue/${depId}`).set(payload).then(() => {
      closeModal('depositModal');
      if (amtInput) amtInput.value = "";
      if (hashInput) hashInput.value = "";
      showToast("⏳ Yatırma bildirimi iletildi! Yönetici onayından sonra bakiyenize yansıyacaktır.", "info");
    }).catch(err => {
      showToast("⛔ Hata: " + err.message, "warning");
    });
  } else {
    closeModal('depositModal');
    showToast("⏳ Bildirim kaydedildi (yerel).", "info");
  }
}

// 2. ÇEKİM TALEBİNİ ADMİN KUYRUĞUNA GÖNDER (EKSİK OLAN KISIM BURASIYDI)
function executeMinaWithdrawal() {
  if (!CurrentUser) return;
  if (CurrentUser.isVaultLocked) {
    showToast("⛔ Hesabınız kilitlidir, çekim talebi veremezsiniz!", "warning");
    return;
  }

  const targetAddr = document.getElementById('with-target-addr')?.value.trim();
  const amount = parseFloat(document.getElementById('with-amount-input')?.value);
  const currentMina = Number(CurrentUser.mina || 0);

  if (!targetAddr || !targetAddr.startsWith('B62q') || targetAddr.length < 50) {
    showToast("⚠️ Lütfen 'B62q' ile başlayan geçerli bir MINA adresi girin!", "warning");
    return;
  }
  if (isNaN(amount) || amount < 20) {
    showToast("⚠️ Minimum çekim tutarı 20 MINA'dır!", "warning");
    return;
  }
  if (amount > currentMina) {
    showToast("⚠️ Yetersiz bakiye!", "warning");
    return;
  }

  const withId = `with_${Date.now()}`;
  const payload = {
    id: withId,
    username: CurrentUser.username,
    amount: Number(amount.toFixed(2)),
    targetAddress: targetAddr,
    date: new Date().toLocaleString('tr-TR'),
    status: 'pending'
  };

  // Bakiyeyi kullanıcıdan hemen düş (çifte harcamayı engelle)
  CurrentUser.mina = Number((currentMina - amount).toFixed(2));

  if (!CurrentUser.logs) CurrentUser.logs = [];
  CurrentUser.logs.unshift({
    id: Date.now(),
    title: "MINA Çekim Talebi Alındı",
    desc: `${amount} MINA için ${targetAddr.substring(0, 10)}... adresine çekim emri verildi.`,
    amountText: `-${amount.toFixed(2)} MINA`,
    type: "expense",
    time: new Date().toLocaleTimeString('tr-TR'),
    date: new Date().toLocaleDateString('tr-TR')
  });

  // Firebase Kuyruğuna ve Kullanıcıya Canlı Yaz
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref(`withdrawalQueue/${withId}`).set(payload);
    fbDb.ref(`users/${CurrentUser.username.toLowerCase()}`).set(CurrentUser);
  } else {
    saveUserWorld();
  }

  if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
  closeModal('withdrawModal');
  showToast(`🔒 ${amount} MINA çekim talebi yönetici onayına iletildi.`, "info");
}
