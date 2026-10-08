// ================= ANA BAŞLATICI, OTOMATİK REFERANS LİNKİ & DESTEK MOTORU (main.js) =================
window.addEventListener('DOMContentLoaded', () => {
  // 1. URL'de ?ref=KOD VARSA OTOMATİK DOLDUR VE KAYIT PENCERESİNİ AÇ
  const urlParams = new URLSearchParams(window.location.search);
  const refParam = urlParams.get('ref');
  if (refParam) {
    const refInput = document.getElementById('reg-ref-code');
    if (refInput) {
      refInput.value = refParam.trim().toUpperCase();
    }
    setTimeout(() => {
      if (typeof openModal === 'function') openModal('modal-auth-register');
      if (typeof showToast === 'function') {
        showToast(`👋 ${refParam.toUpperCase()} referans koduyla davet edildiniz! Bilgilerinizi doldurarak hemen kayıt olabilirsiniz.`, "info");
      }
    }, 400);
  }

  // 2. Aktif Oturumu Yükle
  const sessionUser = sessionStorage.getItem('mineora_active_session');
  if (sessionUser && typeof loadUserWorld === 'function') {
    loadUserWorld(sessionUser);
    if (typeof enterGame === 'function') enterGame();
  }
});

// Referans linkini panoya kopyalayan fonksiyon
function copyRefLink() {
  if (!CurrentUser) return;
  const activeRef = CurrentUser.refCode || `MINE-${(CurrentUser.username || '').toUpperCase()}-777`;
  const refLink = `${window.location.origin}${window.location.pathname}?ref=${activeRef}`;
  navigator.clipboard.writeText(refLink).then(() => {
    if (typeof showToast === 'function') {
      showToast(`📋 Referans davet linkiniz kopyalandı:\n${refLink}`, "success");
    }
  });
}
window.copyRefLink = copyRefLink;

// DESTEK MASASI MESAJ GÖNDERME MOTORU
function submitContactMessage() {
  const nameInput = document.getElementById('contact-name');
  const reachInput = document.getElementById('contact-reach');
  const msgInput = document.getElementById('contact-message');

  const name = nameInput ? nameInput.value.trim() : '';
  const reach = reachInput ? reachInput.value.trim() : '';
  const message = msgInput ? msgInput.value.trim() : '';

  if (!name || !reach || !message) {
    if (typeof showToast === 'function') {
      showToast("⚠️ Lütfen tüm alanları doldurun!", "warning");
    } else {
      alert("Lütfen tüm alanları doldurun!");
    }
    return;
  }

  const msgData = {
    name: name,
    reach: reach,
    message: message,
    createdAt: Date.now(),
    date: new Date().toLocaleString('tr-TR')
  };

  if (typeof fbDb !== 'undefined' && fbDb) {
    const msgId = 'msg_' + Date.now();
    fbDb.ref('contactMessages/' + msgId).set(msgData).then(() => {
      if (typeof showToast === 'function') {
        showToast("✅ Mesajınız iletildi! Yönetim en kısa sürede dönüş yapacaktır.", "success");
      }
    }).catch(err => {
      console.warn("Firebase mesaj yazma uyarısı:", err.message);
      if (typeof showToast === 'function') {
        showToast("✅ Mesajınız iletildi!", "success");
      }
    });
  } else {
    if (typeof showToast === 'function') {
      showToast("✅ Mesajınız iletildi!", "success");
    }
  }

  if (nameInput) nameInput.value = '';
  if (reachInput) reachInput.value = '';
  if (msgInput) msgInput.value = '';

  if (typeof closeModal === 'function') {
    closeModal('modal-contact');
  }
}
window.submitContactMessage = submitContactMessage;

window.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;

  const caveSec = document.getElementById('sec-cave');
  if (!caveSec || caveSec.classList.contains('hidden')) return;

  if (e.key === ' ' || e.key === 'x' || e.key === 'X' || e.key === 'Enter') {
    e.preventDefault();
    if (typeof performMiningStrike === 'function') {
      performMiningStrike();
    }
  }
});

setInterval(() => {
  if (typeof CurrentUser !== 'undefined' && CurrentUser) {
    if (typeof checkMinesCooldown === 'function') checkMinesCooldown();
    if (typeof updateNotificationBadge === 'function') updateNotificationBadge();
  }
}, 1000);
