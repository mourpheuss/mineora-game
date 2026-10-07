// ================= 1. DİL SÖZLÜĞÜ VE YÖNETİMİ (Lang.js) =================
let currentLang = localStorage.getItem('mineora_lang') || 'en';
if (currentLang !== 'en' && currentLang !== 'ru') currentLang = 'en';

const TRANSLATIONS = {
  en: {
    guide_btn: "Protocol Guide", login_btn: "Login", register_btn: "Register", logout_title: "Logout",
    wallet_btn: "My BEP20 Wallet", usdt_label: "USDT Wallet", ora_label: "ORA Asset", account_label: "Account",
    landing_badge: "Decentralized Commodity & Natural Reserve Protocol",
    landing_title_1: "Explore the Depths, Manage Resources,",
    landing_title_2: "Build Your Mining Empire!",
    landing_desc: "In this journey beginning in the uncharted veins of the Alps, every ore extracted and fleet formed establishes your dominance. Dig tunnels, scale your workforce, and take control of the reserves.",
    start_btn: "Join Protocol & Start", inspect_btn: "Inspect Architecture",
    badge_peg: "Standard: USDT Pegged", badge_fleet: "Fleet: Multi-Layer Hierarchy", badge_elevator: "Mine Elevator: Dynamic Evacuation",
    tab_boss: "Admin Desk", 
    tab_owner: "Referral Network (4 Depths)",
    tab_home: "Overview", tab_map: "Alpine Map (5 Sectors)", tab_cave: "Mining Stage",
    tab_crash: "MINE ELEVATOR (CRASH)", tab_p2p: "P2P EXCHANGE", tab_stake: "ORA BANK (STAKE)",
    tab_career: "Select Career", tab_settings: "Change Password",
    home_title: "Welcome to the Mining Ecosystem!",
    home_desc: "Acquire ORA assets from the P2P EXCHANGE to enter mining tunnels, and select your career path from the Select Career tab.",
    map_title: "Alpine Geological Map (5 Sectors)",
    map_desc: "Completed mines enter a 24-hour regeneration cycle and reactivate once finished.",
    wagon_full_text: "Wagon Capacity", power_label: "Strike Force & Timing", power_sub: "Hit the green/yellow zone to shatter ore",
    strike_btn: "STRIKE PICKAXE [SPACE / TAP]", elevator_send: "Dispatch to Elevator",
    crash_title: "Mine Elevator: Deep Ascent", crash_sub: "Multipliers surge as you descend! Evacuate before the cable snaps.",
    crash_bets_open: "Bets Open", crash_preparing: "Elevator Preparing...", crash_input_label: "ORA Stake Amount:",
    crash_max: "ALL (MAX)", crash_est_profit: "Estimated Net Volume:", crash_confirm_bet: "Confirm Bet",
    crash_cancel_bet: "Cancel Bet", crash_cashout: "Evacuate", crash_cashed_out: "Evacuated",
    crash_crashed: "Cable Snapped / Crashed!", crash_running: "Descent In Progress!",
    role_candidate: "Candidate", role_worker: "Worker Miner", role_mine_owner: "Mine Owner", role_hold_owner: "Holding Owner",
    role_admin: "Root Admin",
    trial_expired: "48-Hour Trial Period Expired! Upgrade your role to continue mining.",
    trial_countdown: "Trial Time Remaining:",
    p2p_sub: "Direct peer-to-peer exchange between players for USDT and ORA.",
    p2p_escrow: "Escrow Active",
    p2p_create_btn: "Create P2P Offer",
    p2p_tab_buy: "Buy ORA with USDT",
    p2p_tab_sell: "Sell ORA for USDT",
    p2p_market_ref: "Market Benchmark:",
    career_worker_desc: "Direct mining license for the field. Extract ores to produce ORA.",
    career_worker_cost: "License: 100 USDT worth of ORA",
    career_worker_btn: "Select Role & Enter Mine",
    career_mine_desc: "Establish your private site, recruit miners with your referral code, manage workforce.",
    career_mine_cost: "Facility: 1,000 USDT worth of ORA",
    career_mine_btn: "Become Mine Owner",
    career_hold_desc: "Consolidate multiple mines, supervise deep logistics, manage regional fleets.",
    career_hold_cost: "Holding: 5,000 USDT worth of ORA",
    career_hold_btn: "Become Holding Owner",
    stake_title: "MINEORA Bank & Fixed Reserve Vault",
    stake_sub: "Lock your ORA assets; periodic yield distribution reflects to your wallet.",
    stake_step1: "1. Select Lock Term:",
    stake_step2: "2. ORA Amount to Lock:",
    stake_preview_target: "Target Profit Output:",
    stake_preview_rate: "Daily Accrual Rate:",
    stake_action_btn: "Lock Assets into Vault",
    stake_active_title: "Active Term Vaults",
    settings_title: "Change Password",
    settings_btn: "Update Password"
  },
  ru: {
    guide_btn: "Руководство", login_btn: "Вход", register_btn: "Регистрация", logout_title: "Выйти",
    wallet_btn: "Мой BEP20 Кошелек", usdt_label: "USDT Кошелек", ora_label: "Актив ORA", account_label: "Аккаунт",
    landing_badge: "Децентрализованный Протокол Резервов",
    landing_title_1: "Исследуй Недра, Управляй Ресурсами,",
    landing_title_2: "Построй Свою Горную Империю!",
    landing_desc: "Путешествие в неизведанных жилах Альп. Каждая тонна руды и каждый рабочий укрепляют вашу власть. Добывайте руду, расширяйте флот и владейте ресурсами.",
    start_btn: "Начать Добычу", inspect_btn: "Архитектура Системы",
    badge_peg: "Стандарт: Привязка к USDT", badge_fleet: "Флот: 4 Уровня Иерархии", badge_elevator: "Лифт: Динамичная Эвакуация",
    tab_boss: "Панель Лидера", 
    tab_owner: "Партнерская Сеть (4 Уровня)",
    tab_home: "Обзор", tab_map: "Карта (5 Зон)", tab_cave: "Забой / Шахта",
    tab_crash: "ЛИФТ ШАХТЫ (CRASH)", tab_p2p: "P2P ОБМЕН", tab_stake: "БАНК ORA (СТЕЙКИНГ)",
    tab_career: "Карьера", tab_settings: "Сменить Пароль",
    home_title: "Добро пожаловать в Горную Экосистему!",
    home_desc: "Приобретайте активы ORA на P2P БИРЖЕ для доступа к штольням и выберите статус во вкладке Карьера.",
    map_title: "Геологическая Карта Альп (5 Зон)",
    map_desc: "Выработанные забои уходят на 24-часовое восстановление и активируются снова.",
    wagon_full_text: "Загрузка Вагонетки", power_label: "Сила & Тайминг Удара", power_sub: "Бейте в зелено-желтую зону",
    strike_btn: "УДАР КИРКОЙ [ПРОБЕЛ / КЛИК]", elevator_send: "Отправить к Лифту",
    crash_title: "Шахтный Лифт: Глубокий Спуск", crash_sub: "Чем глубже клеть, тем выше коэффициент! Успей выйти до обрыва троса.",
    crash_bets_open: "Прием Билетов", crash_preparing: "Подготовка...", crash_input_label: "Ставка ORA:",
    crash_max: "ВСЕ (МАКС)", crash_est_profit: "Возможный Доход:", crash_confirm_bet: "Начать Спуск",
    crash_cancel_bet: "Отмена", crash_cashout: "Эвакуация", crash_cashed_out: "Эвакуирован",
    crash_crashed: "Трос Оборвался!", crash_running: "Идет Спуск!",
    role_candidate: "Кандидат", role_worker: "Рабочий Шахтер", role_mine_owner: "Владелец Шахты", role_hold_owner: "Владелец Холдинга",
    role_admin: "Главный Администратор",
    trial_expired: "48-часовой пробный период истек! Повысьте статус для продолжения.",
    trial_countdown: "Осталось Пробного Времени:",
    p2p_sub: "Прямой обмен ORA и USDT между участниками без посредников.",
    p2p_escrow: "Эскроу Активен",
    p2p_create_btn: "Создать Ордер",
    p2p_tab_buy: "Купить ORA за USDT",
    p2p_tab_sell: "Продать ORA за USDT",
    p2p_market_ref: "Рыночный Курс:",
    career_worker_desc: "Прямая лицензия на разработку забоя. Добывайте руду и получайте ORA.",
    career_worker_cost: "Лицензия: ORA на сумму 100 USDT",
    career_worker_btn: "Выбрать Роль и Войти в Забой",
    career_mine_desc: "Откройте свою шахту, нанимайте рабочих по реферальному коду и управляйте сменами.",
    career_mine_cost: "Шахта: ORA на сумму 1,000 USDT",
    career_mine_btn: "Стать Владельцем Шахты",
    career_hold_desc: "Объединяйте шахты, координируйте логистику и руководите горным холдингом.",
    career_hold_cost: "Холдинг: ORA на сумму 5,000 USDT",
    career_hold_btn: "Стать Владельцем Холдинга",
    stake_title: "Банк MINEORA & Срочные Хранилища",
    stake_sub: "Блокируйте активы ORA; начисления процентов регулярно поступают на баланс.",
    stake_step1: "1. Выберите Срок Блокировки:",
    stake_step2: "2. Сумма ORA для Блокировки:",
    stake_preview_target: "Ожидаемый Доход:",
    stake_preview_rate: "Дневная Ставка:",
    stake_action_btn: "Заблокировать в Хранилище",
    stake_active_title: "Активные Срочные Вклады",
    settings_title: "Сменить Пароль",
    settings_btn: "Обновить Пароль"
  }
};

function t(key) {
  if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) return TRANSLATIONS[currentLang][key];
  if (TRANSLATIONS['en'] && TRANSLATIONS['en'][key]) return TRANSLATIONS['en'][key];
  return key;
}

function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'ru') lang = 'en';
  currentLang = lang;
  localStorage.setItem('mineora_lang', lang);
  
  const landSel = document.getElementById('landing-lang-select');
  const gameSel = document.getElementById('game-lang-select');
  if (landSel) landSel.value = lang;
  if (gameSel) gameSel.value = lang;

  applyTranslations();
  if (typeof updateHUD === 'function') updateHUD();
  if (typeof updateCrashActionBtn === 'function') updateCrashActionBtn();
  if (typeof renderP2pOrders === 'function') renderP2pOrders();
  if (typeof renderActiveStakes === 'function') renderActiveStakes();
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.innerText = t(key);
  });
  document.querySelectorAll('.lang-toggle-text').forEach(el => {
    el.innerText = currentLang.toUpperCase();
  });
}