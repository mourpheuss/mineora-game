// ================= 9. ANA BAŞLATICI MOTORU (main.js) =================
window.addEventListener('DOMContentLoaded', () => {
  if (typeof autoMigrateReferralLineage === 'function') {
    autoMigrateReferralLineage();
  }

  applyTranslations();
  const sessionUser = sessionStorage.getItem('mineora_active_session');
  if (sessionUser) {
    loadUserWorld(sessionUser);
    enterGame();
  }
});

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