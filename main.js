// ================= ANA BAŞLATICI, OTOMATİK REFERANS LİNKİ & SAYAÇLAR (main.js) =================
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
      openModal('modal-auth-register');
      showToast(`👋 ${refParam.toUpperCase()} referans koduyla davet edildiniz! Bilgilerinizi doldurarak hemen kayıt olabilirsiniz.`, "info");
    }, 400);
  }

  // 2. Aktif Oturumu Yükle
  const sessionUser = sessionStorage.getItem('mineora_active_session');
  if (sessionUser) {
    loadUserWorld(sessionUser);
    enterGame();
  }
});

// Referans linkini panoya kopyalayan fonksiyon
function copyRefLink() {
  if (!CurrentUser) return;
  const activeRef = CurrentUser.customRefCode || CurrentUser.refCode || `MINE-${(CurrentUser.username || '').toUpperCase()}-777`;
  const refLink = `${window.location.origin}${window.location.pathname}?ref=${activeRef}`;
  navigator.clipboard.writeText(refLink).then(() => {
    showToast(`📋 Referans davet linkiniz kopyalandı:\n${refLink}`, "success");
  });
}
window.copyRefLink = copyRefLink;

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
