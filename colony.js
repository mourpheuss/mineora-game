// ================= ALP MADEN KOLONİSİ (colony.js) =================
const ColonyAudio = (function() {
  let audioCtx = null;
  let soundEnabled = true;
  function getContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playTone(freq, type, duration, gainVal = 0.15) {
    if (!soundEnabled) return;
    try {
      const ctx = getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }
  return {
    toggleSound: function() {
      soundEnabled = !soundEnabled;
      const icon = document.getElementById('colony-icon-sound');
      if (icon) icon.className = soundEnabled ? "fa-solid fa-volume-high text-xs sm:text-sm text-slate-300" : "fa-solid fa-volume-xmark text-xs sm:text-sm text-rose-400";
    },
    playBuild: () => { playTone(220, 'triangle', 0.12, 0.2); setTimeout(() => playTone(330, 'triangle', 0.18, 0.15), 60); },
    playHarvest: () => { playTone(523.25, 'sine', 0.1, 0.2); setTimeout(() => playTone(659.25, 'sine', 0.15, 0.2), 70); setTimeout(() => playTone(783.99, 'sine', 0.25, 0.25), 140); },
    playDemolish: () => playTone(130, 'sawtooth', 0.22, 0.2),
    playClick: () => playTone(400, 'sine', 0.05, 0.08),
    playWind: () => playTone(110, 'sine', 0.8, 0.12)
  };
})();

const ColonyEngine = (function() {
  let canvas, ctx;
  let isEngineStarted = false;
  const TILE_W = 100, TILE_H = 50, MAX_SIZE = 18;
  let unlockedRadius = 6, isNightMode = false, isVisitingMode = false;
  let movingSourceTile = null;

  const weatherModes = ['clear', 'snow', 'blizzard'];
  let weatherIdx = 0, snowflakes = [];
  let autoWeatherInterval = null;

  let camera = { x: 0, y: 0, zoom: 1.0, isDragging: false, dragStartX: 0, dragStartY: 0 };
  let activeBuildType = null, hoveredTile = null, selectedTileForSheet = null;
  let grid = {}, waterWaveTick = 0, citizens = [], merchantCart = null;

  let cityState = {
    ora: 0, totalBurnedOra: 0, wood: 40, stone: 25, emerald: 15,
    population: 35, defense: 100, heat: 95, hasSchool: false, hasMarket: false, hasExpedition: false, monumentLvl: 0
  };

  let expeditions = [
    { id: 'exp_glacier', name: "Buzul Çatlağı Keşfi", duration: 30, costWood: 15, reward: { wood: 30, stone: 15, emerald: 1 }, active: false, finishTime: null },
    { id: 'exp_peak', name: "Matterhorn Zirve Damarı", duration: 60, costWood: 25, reward: { wood: 50, stone: 35, emerald: 3 }, active: false, finishTime: null }
  ];

  let quests = [
    { id: 'q_houses', title: "Madenci Kolonisi", desc: "Vadide en az 3 Alp Evi inşa et.", target: 3, current: 1, reward: { wood: 40, emerald: 2 }, completed: false, claimed: false },
    { id: 'q_school', title: "Geleceğin Madencileri", desc: "Aileler için 1 Dağ Okulu kur.", target: 1, current: 0, reward: { stone: 30, emerald: 4 }, completed: false, claimed: false },
    { id: 'q_market', title: "Tedarik Noktası", desc: "1 Ticaret Hanı inşa et.", target: 1, current: 0, reward: { wood: 50, emerald: 3 }, completed: false, claimed: false },
    { id: 'q_monument', title: "Koloni Sancağı", desc: "Alp Kristal Anıtını kur ve seviye atlat.", target: 1, current: 0, reward: { wood: 60, emerald: 5 }, completed: false, claimed: false }
  ];

  function initWorld() {
    grid = {};
    for (let x = 0; x < MAX_SIZE; x++) {
      for (let y = 0; y < MAX_SIZE; y++) {
        let terrain = 'grass';
        if (x === 0 || y === 0) terrain = 'mountain_rock';
        else if ((x >= 8 && x <= 11) && (y >= 8 && y <= 11)) terrain = 'lake_water';
        else if ((x >= 7 && x <= 12) && (y >= 7 && y <= 12)) terrain = 'shore_sand';
        else if ((x + y * 3) % 7 === 0) terrain = 'dirt_grass';

        const dist = Math.max(Math.abs(x - 5), Math.abs(y - 5));
        grid[`${x}_${y}`] = {
          x, y, terrain, hasRoad: false, building: null, roadConnected: true,
          isLocked: dist > unlockedRadius, readyHarvest: null
        };
      }
    }

    const initialRoads = [{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:5,y:3},{x:5,y:4},{x:5,y:5},{x:5,y:6},{x:6,y:6},{x:7,y:6}];
    initialRoads.forEach(r => { if (grid[`${r.x}_${r.y}`]) grid[`${r.x}_${r.y}`].hasRoad = true; });

    grid["5_5"].building = { type: 'hq', name: "Vadi Karargahı", lvl: 1, underConstruction: false, damaged: false };
    grid["4_3"].building = { type: 'house', name: "Alp Evi", lvl: 1, underConstruction: false, damaged: false };
    grid["7_5"].building = { type: 'generator', name: "Buhar Fırını", lvl: 1, underConstruction: false, damaged: false };
    grid["6_7"].building = { type: 'tower', name: "Karakol", lvl: 1, underConstruction: false, damaged: false };
    grid["1_1"].readyHarvest = 'emerald';

    citizens = [];
    const roadTiles = Object.values(grid).filter(t => t.hasRoad && !t.isLocked);
    if (roadTiles.length > 0) {
      for (let i = 0; i < 5; i++) {
        const st = roadTiles[Math.floor(Math.random() * roadTiles.length)];
        citizens.push({ currentX: st.x, currentY: st.y, targetX: st.x, targetY: st.y, progress: 1.0, speed: 0.015, color: i % 2 === 0 ? '#f59e0b' : '#38bdf8' });
      }
    }

    snowflakes = [];
    for (let i = 0; i < 75; i++) {
      snowflakes.push({ x: Math.random() * 800, y: Math.random() * 600, r: Math.random() * 2 + 1, speedY: Math.random() * 1.5 + 0.5, speedX: Math.random() - 0.5 });
    }

    updateCityLogic();
    updateWeatherUI();
    startAutoWeatherCycle();
  }

  function startAutoWeatherCycle() {
    if (autoWeatherInterval) clearInterval(autoWeatherInterval);
    autoWeatherInterval = setInterval(() => {
      const roll = Math.random();
      let nextIdx = 0;
      if (roll < 0.60) nextIdx = 0;
      else if (roll < 0.85) nextIdx = 1;
      else nextIdx = 2;

      if (nextIdx !== weatherIdx) {
        weatherIdx = nextIdx;
        updateWeatherUI();
        if (weatherModes[weatherIdx] === 'blizzard') {
          ColonyAudio.playWind();
          showToast("⚠️ Şiddetli Alp Tipisi Başladı!", "fa-wind");
        } else if (weatherModes[weatherIdx] === 'snow') {
          showToast("❄️ Vadide kar yağışı başladı.", "fa-snowflake");
        } else {
          showToast("☀️ Hava tekrar açıldı.", "fa-sun");
        }
      }
    }, 75000);
  }

  function updateWeatherUI() {
    const icon = document.getElementById('weather-icon');
    const text = document.getElementById('weather-text');
    const mode = weatherModes[weatherIdx];
    if (!icon || !text) return;
    if (mode === 'clear') {
      icon.className = "fa-solid fa-sun text-amber-300"; text.innerText = "Güneşli";
    } else if (mode === 'snow') {
      icon.className = "fa-solid fa-snowflake text-sky-300 animate-spin"; text.innerText = "Kar Yağışlı";
    } else if (mode === 'blizzard') {
      icon.className = "fa-solid fa-wind text-rose-300 animate-pulse"; text.innerText = "Alp Tipisi";
    }
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement || document.body;
    let w = parent.clientWidth;
    let h = parent.clientHeight;
    if (!w || w < 100) w = 900;
    if (!h || h < 100) h = 650;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.x = w / 2;
    camera.y = h / 3.4;
    camera.zoom = w < 640 ? 0.85 : 1.05;
  }

  function isoToScreen(tx, ty) {
    return {
      x: (tx - ty) * (TILE_W / 2) * camera.zoom + camera.x,
      y: (tx + ty) * (TILE_H / 2) * camera.zoom + camera.y
    };
  }

  function screenToIso(sx, sy) {
    const adjX = (sx - camera.x) / camera.zoom;
    const adjY = (sy - camera.y) / camera.zoom;
    const tx = Math.floor((adjY / (TILE_H / 2) + adjX / (TILE_W / 2)) / 2);
    const ty = Math.floor((adjY / (TILE_H / 2) - adjX / (TILE_W / 2)) / 2);
    return { x: tx, y: ty };
  }

  function updateCityLogic() {
    let housesCount = 0, schoolCount = 0, towerCount = 0, genCount = 0, monumentLvl = 0;
    Object.values(grid).forEach(tile => {
      if (tile.building && !tile.building.underConstruction && !tile.building.damaged) {
        if (tile.building.type === 'house') housesCount += (tile.building.lvl || 1);
        if (tile.building.type === 'school') schoolCount++;
        if (tile.building.type === 'tower') towerCount += (tile.building.lvl || 1);
        if (tile.building.type === 'generator') genCount++;
        if (tile.building.type === 'monument') monumentLvl = Math.max(monumentLvl, tile.building.lvl || 1);
      }
    });

    cityState.population = 20 + (housesCount * 12);
    cityState.defense = 60 + (towerCount * 80);
    cityState.heat = Math.min(100, 60 + (genCount * 25));
    cityState.monumentLvl = monumentLvl;

    quests.forEach(q => {
      if (q.id === 'q_houses') q.current = housesCount;
      if (q.id === 'q_school') q.current = schoolCount;
      if (q.id === 'q_monument') q.current = monumentLvl;
      if (q.current >= q.target) q.completed = true;
    });

    let rankTitle = "Maden Muhtarlığı";
    if (cityState.monumentLvl >= 3 || cityState.totalBurnedOra >= 300) rankTitle = "Zürih Holding Karteli";
    else if (cityState.monumentLvl >= 2 || cityState.totalBurnedOra >= 150) rankTitle = "Alp Maden Baronluğu";
    else if (cityState.monumentLvl >= 1 || cityState.totalBurnedOra >= 50) rankTitle = "Bağımsız Koloni";

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('hud-colony-wood', cityState.wood);
    setTxt('hud-colony-stone', cityState.stone);
    setTxt('hud-colony-emerald', cityState.emerald);
    setTxt('hud-colony-ora', (typeof CurrentUser !== 'undefined' && CurrentUser ? Number(CurrentUser.ora || 0) : cityState.ora).toFixed(2));
    setTxt('rep-burned-ora', `${cityState.totalBurnedOra} ORA`);
    setTxt('rep-prestige-rank', rankTitle);
    setTxt('colony-phase-tag', rankTitle);
  }

  function showToast(msg, icon = 'fa-bell') {
    const toast = document.getElementById('colony-toast');
    const msgEl = document.getElementById('colony-toast-msg');
    const iconEl = document.getElementById('colony-toast-icon');
    if (!toast || !msgEl) return;
    msgEl.innerText = msg;
    if (iconEl) iconEl.className = `fa-solid ${icon} text-amber-400`;
    toast.classList.remove('opacity-0', '-translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => { toast.classList.add('opacity-0', '-translate-y-2'); toast.classList.remove('opacity-100', 'translate-y-0'); }, 2500);
  }

  function toggleModalVisibility(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const isHidden = modal.classList.contains('pointer-events-none');
    if (isHidden) {
      modal.classList.remove('opacity-0', 'pointer-events-none');
      modal.classList.add('opacity-100');
    } else {
      modal.classList.add('opacity-0', 'pointer-events-none');
      modal.classList.remove('opacity-100');
    }
  }

  function openBuildingSheet(tile) {
    selectedTileForSheet = tile;
    const b = tile.building;
    const sheet = document.getElementById('building-sheet');
    const titleEl = document.getElementById('sheet-title');
    const lvlEl = document.getElementById('sheet-level');
    const statusEl = document.getElementById('sheet-road-status');
    const descEl = document.getElementById('sheet-desc');
    const actionsEl = document.getElementById('sheet-action-container');

    if (titleEl) titleEl.innerText = b.name;
    if (lvlEl) lvlEl.innerText = `Seviye ${b.lvl || 1}`;
    if (statusEl) {
      statusEl.innerText = tile.roadConnected ? "Yola Bağlı ✓" : "Yol Gerekli !";
      statusEl.className = tile.roadConnected ? "font-bold text-emerald-400" : "font-bold text-rose-400";
    }
    if (descEl) descEl.innerText = b.type === 'monument' ? "ORA Yakımıyla seviye atlatılan prestij anıtı." : (b.type === 'house' ? "+12 madenci barındırır." : "Altyapı tesisi.");

    const costOra = b.type === 'monument' ? ((b.lvl || 1) * 50) : ((b.lvl || 1) * 15);
    if (actionsEl) {
      actionsEl.innerHTML = `
        <button onclick="ColonyEngine.upgradeBuilding()" class="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs flex items-center justify-center gap-1.5 shadow text-white cursor-pointer">
          <i class="fa-solid fa-arrow-up"></i><span>Yükselt (${costOra} ORA)</span>
        </button>
        <button onclick="ColonyEngine.startMoveSelected()" class="px-3 py-2.5 rounded-xl bg-blue-950/60 hover:bg-blue-900 border border-blue-800 text-blue-300 font-bold text-xs flex items-center justify-center cursor-pointer" title="Binayı Taşı">
          <i class="fa-solid fa-arrows-up-down-left-right"></i>
        </button>
        <button onclick="ColonyEngine.demolishSelected()" class="px-3.5 py-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs flex items-center justify-center cursor-pointer">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      `;
    }

    if (sheet) {
      sheet.classList.remove('translate-y-full', 'opacity-0', 'pointer-events-none');
      sheet.classList.add('translate-y-0', 'opacity-100');
    }
  }

  function closeSheet() {
    selectedTileForSheet = null;
    const sheet = document.getElementById('building-sheet');
    if (sheet) {
      sheet.classList.add('translate-y-full', 'opacity-0', 'pointer-events-none');
      sheet.classList.remove('translate-y-0', 'opacity-100');
    }
  }

  function render() {
    if (!ctx || !canvas) return;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    ctx.clearRect(0, 0, w, h);
    waterWaveTick += 0.03;

    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    const mode = weatherModes[weatherIdx];

    if (isNightMode) {
      sky.addColorStop(0, '#040711');
      sky.addColorStop(0.5, '#0b1329');
      sky.addColorStop(1, '#1e293b');
    } else if (mode === 'blizzard') {
      sky.addColorStop(0, '#475569');
      sky.addColorStop(0.5, '#64748b');
      sky.addColorStop(1, '#94a3b8');
    } else {
      sky.addColorStop(0, '#0284c7');
      sky.addColorStop(0.5, '#7dd3fc');
      sky.addColorStop(1, '#e0f2fe');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const apex = isoToScreen(0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(apex.x - 500, apex.y + 120);
    ctx.lineTo(apex.x - 200, apex.y - 240);
    ctx.lineTo(apex.x + 20, apex.y - 360);
    ctx.lineTo(apex.x + 240, apex.y - 180);
    ctx.lineTo(apex.x + 550, apex.y + 120);
    ctx.closePath();
    ctx.fillStyle = isNightMode || mode === 'blizzard' ? '#334155' : '#cbd5e1';
    ctx.fill();
    ctx.restore();

    const sorted = Object.values(grid).sort((a, b) => (a.x + a.y) - (b.x + b.y));
    sorted.forEach(tile => {
      if (tile.isLocked) {
        drawTilePath(tile, 'rgba(241, 245, 249, 0.85)');
      } else {
        let col = isNightMode ? '#1e3a1e' : '#4d7c0f';
        if (mode === 'blizzard') col = '#94a3b8';
        else if (tile.terrain === 'lake_water') col = '#0284c7';
        else if (tile.terrain === 'shore_sand') col = '#d97706';
        else if (tile.terrain === 'mountain_rock') col = '#64748b';
        drawTilePath(tile, col);
        if (tile.hasRoad) drawRoad(tile);
      }
    });

    drawMountainMine();

    citizens.forEach(c => {
      c.progress += c.speed;
      if (c.progress >= 1.0) {
        c.progress = 0; c.currentX = c.targetX; c.currentY = c.targetY;
        const n = [grid[`${c.currentX+1}_${c.currentY}`], grid[`${c.currentX-1}_${c.currentY}`], grid[`${c.currentX}_${c.currentY+1}`], grid[`${c.currentX}_${c.currentY-1}`]].filter(t => t && t.hasRoad);
        if (n.length > 0) { const next = n[Math.floor(Math.random() * n.length)]; c.targetX = next.x; c.targetY = next.y; }
      }
      const pos = isoToScreen(c.currentX + (c.targetX - c.currentX) * c.progress, c.currentY + (c.targetY - c.currentY) * c.progress);
      ctx.fillStyle = c.color;
      ctx.fillRect(pos.x - 2, pos.y - 8, 4, 6);
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.arc(pos.x, pos.y - 9, 2.5, 0, Math.PI * 2); ctx.fill();
    });

    sorted.forEach(tile => {
      if (!tile.isLocked && tile.building) drawBuilding(tile);
      if (tile.readyHarvest) drawHarvest(tile);
    });

    if (hoveredTile && grid[`${hoveredTile.x}_${hoveredTile.y}`]) {
      const target = grid[`${hoveredTile.x}_${hoveredTile.y}`];
      const pos = isoToScreen(target.x, target.y);
      const wT = TILE_W * camera.zoom, hT = TILE_H * camera.zoom;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y - hT / 2); ctx.lineTo(pos.x + wT / 2, pos.y); ctx.lineTo(pos.x, pos.y + hT / 2); ctx.lineTo(pos.x - wT / 2, pos.y);
      ctx.closePath();
      ctx.fillStyle = activeBuildType === 'demolish' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.3)';
      ctx.fill();
      ctx.strokeStyle = activeBuildType === 'demolish' ? '#ef4444' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (mode !== 'clear') {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      const speedMult = mode === 'blizzard' ? 2.5 : 1.0;
      snowflakes.forEach(s => {
        s.y += s.speedY * speedMult;
        s.x += (s.speedX + (mode === 'blizzard' ? 2.0 : 0)) * speedMult;
        if (s.y > h) { s.y = -10; s.x = Math.random() * w; }
        if (s.x > w) s.x = -10;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }

    requestAnimationFrame(render);
  }

  function drawTilePath(tile, color) {
    const pos = isoToScreen(tile.x, tile.y);
    const w = TILE_W * camera.zoom, h = TILE_H * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2); ctx.lineTo(pos.x + w / 2, pos.y); ctx.lineTo(pos.x, pos.y + h / 2); ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawRoad(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const w = TILE_W * 0.7 * camera.zoom, h = TILE_H * 0.7 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2); ctx.lineTo(pos.x + w / 2, pos.y); ctx.lineTo(pos.x, pos.y + h / 2); ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();
    ctx.fillStyle = '#a8a29e';
    ctx.fill();
  }

  function drawMountainMine() {
    const pos = isoToScreen(1, 1);
    const z = camera.zoom;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(-40 * z, 10 * z); ctx.lineTo(-30 * z, -50 * z); ctx.lineTo(0, -75 * z); ctx.lineTo(40 * z, -45 * z); ctx.lineTo(40 * z, 10 * z);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.beginPath(); ctx.ellipse(0, -15 * z, 24 * z, 18 * z, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(0, -15 * z, 6 * z, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawBuilding(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const b = tile.building;
    const z = camera.zoom;
    ctx.save();
    ctx.translate(pos.x, pos.y);

    if (b.type === 'house') {
      ctx.fillStyle = isNightMode ? '#cbd5e1' : '#fef3c7';
      ctx.fillRect(-14 * z, -24 * z, 28 * z, 22 * z);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-15 * z, -24 * z, 3 * z, 22 * z);
      ctx.fillRect(12 * z, -24 * z, 3 * z, 22 * z);
      ctx.beginPath();
      ctx.moveTo(-18 * z, -24 * z); ctx.lineTo(0, -42 * z); ctx.lineTo(18 * z, -24 * z);
      ctx.closePath();
      ctx.fillStyle = '#b91c1c'; ctx.fill();
    } else if (b.type === 'school') {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-18 * z, -26 * z, 36 * z, 24 * z);
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath(); ctx.moveTo(-22 * z, -26 * z); ctx.lineTo(0, -46 * z); ctx.lineTo(22 * z, -26 * z); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(0, -51 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
    } else if (b.type === 'generator') {
      ctx.fillStyle = '#475569';
      ctx.fillRect(-18 * z, -28 * z, 36 * z, 26 * z);
      ctx.fillStyle = '#ea580c'; ctx.fillRect(-8 * z, -14 * z, 8 * z, 8 * z);
    } else if (b.type === 'tower') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-10 * z, -40 * z, 20 * z, 38 * z);
      ctx.fillStyle = '#b91c1c'; ctx.fillRect(-12 * z, -46 * z, 24 * z, 8 * z);
    } else if (b.type === 'monument') {
      ctx.fillStyle = '#1e293b'; ctx.fillRect(-12 * z, -8 * z, 24 * z, 8 * z);
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath(); ctx.moveTo(-6 * z, -8 * z); ctx.lineTo(0, -48 * z); ctx.lineTo(6 * z, -8 * z); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#64748b'; ctx.fillRect(-14 * z, -28 * z, 28 * z, 26 * z);
    }
    ctx.restore();
  }

  function drawHarvest(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const z = camera.zoom;
    ctx.save();
    ctx.translate(pos.x, pos.y - 45 * z);
    ctx.fillStyle = tile.readyHarvest === 'emerald' ? '#10b981' : '#d97706';
    ctx.beginPath(); ctx.arc(0, 0, 10 * z, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = `bold ${8 * z}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tile.readyHarvest === 'emerald' ? '💎' : '🪵', 0, 0);
    ctx.restore();
  }

  function setupEvents() {
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { 
        camera.isDragging = true; 
        camera.dragStartX = e.clientX - camera.x; 
        camera.dragStartY = e.clientY - camera.y; 
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (camera.isDragging) { 
        camera.x = e.clientX - camera.dragStartX; 
        camera.y = e.clientY - camera.dragStartY; 
      }
      const rect = canvas.getBoundingClientRect();
      hoveredTile = screenToIso(e.clientX - rect.left, e.clientY - rect.top);
    });
    window.addEventListener('mouseup', () => { camera.isDragging = false; });

    function handleGridTap(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const coord = screenToIso(clientX - rect.left, clientY - rect.top);
      const tile = grid[`${coord.x}_${coord.y}`];
      if (!tile) return;

      if (movingSourceTile) {
        if (tile.building || tile.hasRoad || tile.isLocked || tile.terrain === 'lake_water' || tile.terrain === 'mountain_rock') {
          showToast("Geçersiz hedef alan!", "fa-triangle-exclamation");
          return;
        }
        tile.building = movingSourceTile.building;
        movingSourceTile.building = null;
        movingSourceTile = null;
        ColonyAudio.playBuild();
        updateCityLogic();
        showToast("Bina yeni yerine taşındı.", "fa-arrows-up-down-left-right");
        return;
      }

      if (tile.readyHarvest) {
        ColonyAudio.playHarvest();
        if (tile.readyHarvest === 'emerald') cityState.emerald += 1;
        else cityState.wood += 5;
        tile.readyHarvest = null;
        updateCityLogic();
        showToast("Kaynak toplandı!");
        return;
      }

      if (activeBuildType === 'demolish') {
        if (tile.building && tile.building.type === 'hq') { showToast("Ana Karargah yıkılamaz!", "fa-shield-halved"); return; }
        ColonyAudio.playDemolish();
        tile.building = null; tile.hasRoad = false;
        updateCityLogic();
        closeSheet();
        showToast("Bölge temizlendi.");
        return;
      }

      if (activeBuildType === 'road') {
        if (!tile.building && tile.terrain !== 'lake_water' && tile.terrain !== 'mountain_rock') {
          tile.hasRoad = true;
          ColonyAudio.playBuild();
          updateCityLogic();
        }
        return;
      }

      if (activeBuildType && !tile.building && !tile.hasRoad) {
        ColonyAudio.playBuild();
        tile.building = { type: activeBuildType, name: activeBuildType, lvl: 1, underConstruction: false };
        updateCityLogic();
        showToast("İnşaat tamamlandı!");
        return;
      }

      if (tile.building) {
        ColonyAudio.playClick();
        if (tile.building.type === 'market') { ColonyEngine.toggleMarketModal(); return; }
        if (tile.building.type === 'expedition') { ColonyEngine.toggleExpeditionModal(); return; }
        openBuildingSheet(tile);
      } else {
        closeSheet();
      }
    }

    canvas.addEventListener('click', (e) => {
      handleGridTap(e.clientX, e.clientY);
    });

    let touchStartX = 0, touchStartY = 0;
    let isTouchDragging = false;
    let touchPinchDist = 0;
    let touchInitialZoom = 1;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isTouchDragging = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        camera.dragStartX = touchStartX - camera.x;
        camera.dragStartY = touchStartY - camera.y;
      } else if (e.touches.length === 2) {
        isTouchDragging = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchPinchDist = Math.hypot(dx, dy);
        touchInitialZoom = camera.zoom;
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const curX = e.touches[0].clientX;
        const curY = e.touches[0].clientY;
        if (Math.hypot(curX - touchStartX, curY - touchStartY) > 5) {
          isTouchDragging = true;
        }
        if (isTouchDragging) {
          camera.x = curX - camera.dragStartX;
          camera.y = curY - camera.dragStartY;
        }
      } else if (e.touches.length === 2 && touchPinchDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const curDist = Math.hypot(dx, dy);
        const scale = curDist / touchPinchDist;
        camera.zoom = Math.min(2.0, Math.max(0.5, touchInitialZoom * scale));
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (!isTouchDragging && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        handleGridTap(t.clientX, t.clientY);
      }
    });
  }

  return {
    init: function() {
      canvas = document.getElementById('colonyCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      if (!isEngineStarted) {
        initWorld();
        setupEvents();
        render();
        isEngineStarted = true;
      }
      resize();
      ColonyEngine.syncUserOra();
    },
    selectBuild: function(type) {
      movingSourceTile = null;
      ColonyAudio.playClick();
      activeBuildType = (activeBuildType === type) ? null : type;
      document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('ring-2', 'ring-cyan-400', 'bg-slate-700'));
      if (activeBuildType) {
        const btn = document.getElementById(`btn-build-${activeBuildType}`);
        if (btn) btn.classList.add('ring-2', 'ring-cyan-400', 'bg-slate-700');
        showToast(`Seçildi: ${activeBuildType}`);
      }
    },
    expandMapPrompt: function() {
      const userOra = CurrentUser ? Number(parseFloat(CurrentUser.ora || 0)) : cityState.ora;
      if (userOra < 25) { alert("Arazi genişletmek için cüzdanınızda en az 25 ORA olmalıdır."); return; }
      if (CurrentUser) {
        CurrentUser.ora = Number((userOra - 25).toFixed(2));
        cityState.ora = CurrentUser.ora;
        if (typeof saveUserWorld === 'function') saveUserWorld();
        if (typeof updateHUD === 'function') updateHUD();
      }
      cityState.totalBurnedOra += 25;
      unlockedRadius += 2;
      for (let x = 0; x < MAX_SIZE; x++) {
        for (let y = 0; y < MAX_SIZE; y++) {
          if (Math.max(Math.abs(x - 5), Math.abs(y - 5)) <= unlockedRadius) grid[`${x}_${y}`].isLocked = false;
        }
      }
      ColonyAudio.playHarvest();
      updateCityLogic();
      showToast("25 ORA Yakıldı! Sis dağıldı.", "fa-fire");
    },
    resetCamera: function() { resize(); },
    syncUserOra: function() {
      if (typeof CurrentUser !== 'undefined' && CurrentUser) {
        cityState.ora = Number(parseFloat(CurrentUser.ora || 0));
        const el = document.getElementById('hud-colony-ora');
        if (el) el.innerText = cityState.ora.toFixed(2);
      }
    },
    toggleDayNight: function() { isNightMode = !isNightMode; ColonyAudio.playClick(); },
    cycleWeather: function() { 
      weatherIdx = (weatherIdx + 1) % weatherModes.length; 
      updateWeatherUI();
      if (weatherModes[weatherIdx] === 'blizzard') ColonyAudio.playWind();
      else ColonyAudio.playClick(); 
    },
    toggleReportModal: () => { toggleModalVisibility('report-modal'); },
    toggleQuestModal: () => {
      const list = document.getElementById('quest-list');
      if (list) {
        list.innerHTML = quests.map(q => `
          <div class="p-3 rounded-2xl bg-slate-800/80 border ${q.completed ? 'border-emerald-500/50' : 'border-slate-700'} flex items-center justify-between gap-3">
            <div class="flex-1">
              <div class="flex items-center gap-1.5"><h4 class="text-xs font-bold text-white">${q.title}</h4></div>
              <p class="text-[10px] text-slate-400 mt-0.5">${q.desc}</p>
              <div class="text-[9px] text-amber-300 font-bold mt-1">İlerleme: ${Math.min(q.current, q.target)}/${q.target} (+${q.reward.wood || q.reward.stone} Malzeme, +${q.reward.emerald} Zümrüt)</div>
            </div>
            <div>
              ${q.completed && !q.claimed ? `
                <button onclick="ColonyEngine.claimQuest('${q.id}')" class="px-3 py-1.5 rounded-xl bg-emerald-500 text-black font-black text-xs cursor-pointer shadow">Al</button>
              ` : `<span class="text-xs text-slate-500">${q.claimed ? 'Alındı ✓' : 'Bekliyor'}</span>`}
            </div>
          </div>
        `).join('');
      }
      toggleModalVisibility('quest-modal');
    },
    claimQuest: (qid) => {
      const q = quests.find(i => i.id === qid);
      if (q && q.completed && !q.claimed) {
        q.claimed = true;
        if (q.reward.wood) cityState.wood += q.reward.wood;
        if (q.reward.stone) cityState.stone += q.reward.stone;
        cityState.emerald += q.reward.emerald;
        ColonyAudio.playHarvest();
        updateCityLogic();
        ColonyEngine.toggleQuestModal();
        showToast("Ödül toplandı!");
      }
    },
    toggleMarketModal: () => { toggleModalVisibility('market-modal'); },
    toggleExpeditionModal: () => {
      const list = document.getElementById('expedition-list');
      if (list) {
        list.innerHTML = expeditions.map(exp => `
          <div class="p-3 rounded-2xl bg-slate-800/80 border ${exp.active ? 'border-cyan-500/50' : 'border-slate-700'} flex items-center justify-between gap-3">
            <div>
              <h4 class="text-xs font-bold text-white">${exp.name}</h4>
              <div class="text-[10px] text-slate-400 mt-1">⏱️ ${exp.duration}s | +${exp.reward.wood} Odun, +${exp.reward.emerald} Zümrüt</div>
            </div>
            <div>
              ${exp.active ? `<span class="text-xs text-cyan-300 font-mono font-bold">${Math.max(0, Math.ceil((exp.finishTime - Date.now())/1000))}s</span>` : `
                <button onclick="ColonyEngine.startExpedition('${exp.id}')" class="px-3 py-1.5 rounded-xl bg-cyan-500 text-black font-black text-xs cursor-pointer shadow">Gönder (${exp.costWood} Odun)</button>
              `}
            </div>
          </div>
        `).join('');
      }
      toggleModalVisibility('expedition-modal');
    },
    startExpedition: (expId) => {
      const exp = expeditions.find(e => e.id === expId);
      if (!exp) return;
      if (cityState.wood < exp.costWood) { alert(`Yetersiz Kereste! En az ${exp.costWood} Kereste gereklidir.`); return; }
      cityState.wood -= exp.costWood;
      exp.active = true;
      exp.finishTime = Date.now() + (exp.duration * 1000);
      ColonyAudio.playBuild();
      updateCityLogic();
      ColonyEngine.toggleExpeditionModal();
      showToast(`${exp.name} başladı!`, "fa-person-hiking");
    },
    startMoveMode: () => { showToast("Taşımak istediğiniz binaya tıklayın.", "fa-arrows-up-down-left-right"); },
    startMoveSelected: () => {
      if (!selectedTileForSheet || !selectedTileForSheet.building) return;
      if (selectedTileForSheet.building.type === 'hq') { alert("Ana Karargah taşınamaz!"); return; }
      movingSourceTile = selectedTileForSheet;
      closeSheet();
      showToast("Şimdi binayı koymak istediğiniz boş karoya dokunun.", "fa-arrows-up-down-left-right");
    },
    upgradeBuilding: () => {
      if (!selectedTileForSheet || !selectedTileForSheet.building) return;
      const b = selectedTileForSheet.building;
      const cost = b.type === 'monument' ? ((b.lvl || 1) * 50) : ((b.lvl || 1) * 15);
      const curOra = CurrentUser ? Number(CurrentUser.ora || 0) : cityState.ora;
      if (curOra < cost) { alert(`Yetersiz ORA! Bu işlem için en az ${cost} ORA yakılmalıdır.`); return; }
      if (CurrentUser) {
        CurrentUser.ora = Number((curOra - cost).toFixed(2));
        cityState.ora = CurrentUser.ora;
        if (typeof saveUserWorld === 'function') saveUserWorld();
        if (typeof updateHUD === 'function') updateHUD();
      }
      cityState.totalBurnedOra += cost;
      b.lvl = (b.lvl || 1) + 1;
      ColonyAudio.playBuild();
      updateCityLogic();
      openBuildingSheet(selectedTileForSheet);
      showToast(`${b.name} Seviye ${b.lvl}'e yükseltildi! (${cost} ORA Yakıldı)`, "fa-arrow-up");
    },
    demolishSelected: () => {
      if (!selectedTileForSheet) return;
      if (selectedTileForSheet.building && selectedTileForSheet.building.type === 'hq') { alert("Ana Karargah yıkılamaz!"); return; }
      ColonyAudio.playDemolish();
      selectedTileForSheet.building = null;
      selectedTileForSheet.hasRoad = false;
      updateCityLogic();
      closeSheet();
      showToast("Bina yıkıldı.", "fa-hammer");
    },
    closeSheet: () => closeSheet(),
    toggleVisitMode: () => {
      isVisitingMode = !isVisitingMode;
      const banner = document.getElementById('visit-banner');
      if (banner) {
        banner.classList.toggle('opacity-0', !isVisitingMode);
        banner.classList.toggle('pointer-events-none', !isVisitingMode);
        banner.classList.toggle('opacity-100', isVisitingMode);
      }
      showToast(isVisitingMode ? "Zürih Holding Kolonisi Ziyaret Ediliyor!" : "Kendi koloninize dönüldü.");
    },
    leaveEnergyUpvote: () => { ColonyAudio.playHarvest(); showToast("Holdinge Selam Bırakıldı!", "fa-hand-holding-heart"); },
    buyMaterial: (type) => {
      if (!CurrentUser) return;
      let cost = 5;
      if (type === 'ora_to_wood') cost = 5;
      if (type === 'ora_to_stone') cost = 8;
      if (type === 'ora_to_emerald') cost = 15;

      const curOra = Number(CurrentUser.ora || 0);
      if (curOra < cost) { alert(`Yetersiz ORA! En az ${cost} ORA gereklidir.`); return; }
      CurrentUser.ora = Number((curOra - cost).toFixed(2));
      cityState.totalBurnedOra += cost;
      cityState.ora = CurrentUser.ora;

      if (type === 'ora_to_wood') cityState.wood += 30;
      if (type === 'ora_to_stone') cityState.stone += 25;
      if (type === 'ora_to_emerald') cityState.emerald += 2;

      if (typeof saveUserWorld === 'function') saveUserWorld();
      if (typeof updateHUD === 'function') updateHUD();
      ColonyAudio.playHarvest();
      updateCityLogic();
      showToast(`${cost} ORA Yakıldı ve malzeme kasanıza eklendi!`, "fa-fire");
    }
  };
})();