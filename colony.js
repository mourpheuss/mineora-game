/**
 * MINEORA COLONY ENGINE (2.5D Isometric Engine & Token Sink Bridge)
 */
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
      if (icon) {
        icon.className = soundEnabled ? "fa-solid fa-volume-high text-xs sm:text-sm text-slate-300" : "fa-solid fa-volume-xmark text-xs sm:text-sm text-rose-400";
      }
    },
    playBuild: () => {
      playTone(220, 'triangle', 0.12, 0.2);
      setTimeout(() => playTone(330, 'triangle', 0.18, 0.15), 60);
    },
    playHarvest: () => {
      playTone(523.25, 'sine', 0.1, 0.2);
      setTimeout(() => playTone(659.25, 'sine', 0.15, 0.2), 70);
      setTimeout(() => playTone(783.99, 'sine', 0.25, 0.25), 140);
    },
    playDemolish: () => playTone(130, 'sawtooth', 0.22, 0.2),
    playAlarm: () => {
      playTone(440, 'square', 0.15, 0.25);
      setTimeout(() => playTone(350, 'square', 0.18, 0.25), 160);
    },
    playClick: () => playTone(400, 'sine', 0.05, 0.08),
    playWind: () => playTone(110, 'sine', 0.6, 0.08)
  };
})();

const ColonyEngine = (function() {
  let canvas, ctx;
  const TILE_W = 100;
  const TILE_H = 50;
  const MAX_SIZE = 18;
  let unlockedRadius = 6;
  let isNightMode = false;
  let isVisitingMode = false;
  let movingSourceTile = null;

  const weatherModes = ['clear', 'snow', 'blizzard'];
  let weatherIdx = 0;
  let snowflakes = [];

  let camera = { x: 0, y: 0, zoom: 1.0, isDragging: false, dragStartX: 0, dragStartY: 0 };
  let touchState = { active: false, startX: 0, startY: 0, moved: false, initialPinchDistance: 0, initialZoom: 1.0, touchStartTime: 0 };

  let activeBuildType = null;
  let hoveredTile = null;
  let selectedTileForSheet = null;
  let grid = {};
  let backupPlayerGrid = null;
  let waterWaveTick = 0;
  let citizens = [];
  let merchantCart = null;

  let cityState = {
    ora: 0,
    totalBurnedOra: 0,
    wood: 40,
    stone: 25,
    emerald: 15,
    population: 35,
    defense: 100,
    heat: 95,
    hasSchool: false,
    hasMarket: false,
    hasExpedition: false,
    monumentLvl: 0
  };

  let expeditions = [
    { id: 'exp_glacier', name: "Buzul Çatlağı Keşfi", duration: 30, costWood: 15, reward: { wood: 30, stone: 15, emerald: 1 }, active: false, finishTime: null },
    { id: 'exp_peak', name: "Matterhorn Zirve Damarı", duration: 60, costWood: 25, reward: { wood: 50, stone: 35, emerald: 3 }, active: false, finishTime: null }
  ];

  let quests = [
    { id: 'q_houses', title: "Madenci Kolonisi", desc: "Vadide en az 3 Alp Evi inşa et.", target: 3, current: 1, reward: { wood: 40, emerald: 2 }, completed: false, claimed: false },
    { id: 'q_school', title: "Geleceğin Madencileri", desc: "Aileler için 1 Dağ Okulu kur.", target: 1, current: 0, reward: { stone: 30, emerald: 4 }, completed: false, claimed: false },
    { id: 'q_market', title: "Tedarik Noktası", desc: "1 Ticaret Hanı inşa et.", target: 1, current: 0, reward: { wood: 50, emerald: 3 }, completed: false, claimed: false },
    { id: 'q_monument', title: "Koloni Sancağı", desc: "Alp Kristal Anıtını kur ve 1. seviyeye yükselt.", target: 1, current: 0, reward: { wood: 60, emerald: 5 }, completed: false, claimed: false }
  ];

  // Dış Entegrasyon Hook'ları (Firebase için)
  let onBurnCallback = null;
  let onSaveCallback = null;

  function initWorld() {
    initSnowflakes();
    grid = {};
    for (let x = 0; x < MAX_SIZE; x++) {
      for (let y = 0; y < MAX_SIZE; y++) {
        let terrain = 'grass';
        if (x === 0 || y === 0) terrain = 'mountain_rock';
        else if ((x >= 8 && x <= 11) && (y >= 8 && y <= 11)) terrain = 'lake_water';
        else if ((x >= 7 && x <= 12) && (y >= 7 && y <= 12)) terrain = 'shore_sand';
        else if ((x + y * 3) % 7 === 0) terrain = 'dirt_grass';

        const distFromCenter = Math.max(Math.abs(x - 5), Math.abs(y - 5));
        grid[`${x}_${y}`] = {
          x, y, terrain, hasRoad: false, building: null, roadConnected: true,
          isLocked: distFromCenter > unlockedRadius, readyHarvest: null
        };
      }
    }

    const initialRoads = [
      {x:2, y:2}, {x:3, y:2}, {x:4, y:2}, {x:5, y:2},
      {x:5, y:3}, {x:5, y:4}, {x:5, y:5}, {x:5, y:6},
      {x:6, y:6}, {x:7, y:6}
    ];
    initialRoads.forEach(r => {
      if (grid[`${r.x}_${r.y}`]) grid[`${r.x}_${r.y}`].hasRoad = true;
    });

    grid["5_5"].building = { type: 'hq', name: "Vadi Karargahı", lvl: 1, underConstruction: false, damaged: false };
    grid["4_3"].building = { type: 'house', name: "Alp Evi", lvl: 1, underConstruction: false, damaged: false };
    grid["7_5"].building = { type: 'generator', name: "Buhar Fırını", lvl: 1, underConstruction: false, damaged: false };
    grid["6_7"].building = { type: 'tower', name: "Karakol", lvl: 1, underConstruction: false, damaged: false };
    grid["1_1"].readyHarvest = 'emerald';

    initCitizens();
    updateCityLogic();
    updateWeatherUI();
  }

  function initSnowflakes() {
    snowflakes = [];
    for (let i = 0; i < 80; i++) {
      snowflakes.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 2 + 1,
        speedY: Math.random() * 1.5 + 0.5,
        speedX: Math.random() * 1.0 - 0.5
      });
    }
  }

  function initCitizens() {
    citizens = [];
    const roadTiles = Object.values(grid).filter(t => t.hasRoad && !t.isLocked);
    if (roadTiles.length === 0) return;

    for (let i = 0; i < 5; i++) {
      const startTile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
      citizens.push({
        currentX: startTile.x, currentY: startTile.y, targetX: startTile.x, targetY: startTile.y,
        progress: 1.0, speed: 0.012 + Math.random() * 0.008, color: (i % 2 === 0) ? '#f59e0b' : '#38bdf8'
      });
    }

    merchantCart = {
      currentX: roadTiles[0].x, currentY: roadTiles[0].y, targetX: roadTiles[0].x, targetY: roadTiles[0].y,
      progress: 1.0, speed: 0.007
    };
  }

  function updateCitizens() {
    citizens.forEach(c => {
      c.progress += c.speed;
      if (c.progress >= 1.0) {
        c.progress = 0;
        c.currentX = c.targetX;
        c.currentY = c.targetY;
        const neighbors = [
          grid[`${c.currentX + 1}_${c.currentY}`], grid[`${c.currentX - 1}_${c.currentY}`],
          grid[`${c.currentX}_${c.currentY + 1}`], grid[`${c.currentX}_${c.currentY - 1}`]
        ].filter(n => n && n.hasRoad && !n.isLocked);
        if (neighbors.length > 0) {
          const next = neighbors[Math.floor(Math.random() * neighbors.length)];
          c.targetX = next.x;
          c.targetY = next.y;
        }
      }
    });

    if (merchantCart) {
      merchantCart.progress += merchantCart.speed;
      if (merchantCart.progress >= 1.0) {
        merchantCart.progress = 0;
        merchantCart.currentX = merchantCart.targetX;
        merchantCart.currentY = merchantCart.targetY;
        const neighbors = [
          grid[`${merchantCart.currentX + 1}_${merchantCart.currentY}`], grid[`${merchantCart.currentX - 1}_${merchantCart.currentY}`],
          grid[`${merchantCart.currentX}_${merchantCart.currentY + 1}`], grid[`${merchantCart.currentX}_${merchantCart.currentY - 1}`]
        ].filter(n => n && n.hasRoad && !n.isLocked);
        if (neighbors.length > 0) {
          const next = neighbors[Math.floor(Math.random() * neighbors.length)];
          merchantCart.targetX = next.x;
          merchantCart.targetY = next.y;
        }
      }
    }
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement || document.body;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    if (w < 640) {
      camera.zoom = 0.85;
      camera.y = h / 2.8;
    } else {
      camera.zoom = 1.05;
      camera.y = h / 3.4;
    }
    camera.x = w / 2;
  }

  function resetCamera() {
    const parent = canvas.parentElement || document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    if (w < 640) {
      camera.zoom = 0.85;
      camera.y = h / 2.8;
    } else {
      camera.zoom = 1.05;
      camera.y = h / 3.4;
    }
    camera.x = w / 2;
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
    let housesCount = 0, schoolCount = 0, towerCount = 0, marketCount = 0, generatorCount = 0, expeditionCount = 0, monumentLvl = 0;
    const now = Date.now();

    expeditions.forEach(exp => {
      if (exp.active && exp.finishTime && now >= exp.finishTime) {
        exp.active = false;
        exp.finishTime = null;
        cityState.wood += exp.reward.wood;
        cityState.stone += exp.reward.stone;
        cityState.emerald += exp.reward.emerald;
        ColonyAudio.playHarvest();
        showToast(`🏔️ ${exp.name} döndü! (+${exp.reward.wood} Odun, +${exp.reward.emerald} Zümrüt)`, "fa-person-hiking");
      }
    });

    Object.values(grid).forEach(tile => {
      if (tile.building) {
        const b = tile.building;
        if (b.underConstruction && b.finishTime && now >= b.finishTime) {
          b.underConstruction = false;
          b.finishTime = null;
          ColonyAudio.playHarvest();
          showToast(`${b.name} inşası bitti!`, "fa-circle-check");
        }
        if (!b.underConstruction && !b.damaged) {
          if (b.type === 'house') housesCount += (b.lvl || 1);
          if (b.type === 'school') schoolCount++;
          if (b.type === 'tower') towerCount += (b.lvl || 1);
          if (b.type === 'market') marketCount++;
          if (b.type === 'generator') generatorCount += (b.lvl || 1);
          if (b.type === 'expedition') expeditionCount++;
          if (b.type === 'monument') monumentLvl = Math.max(monumentLvl, b.lvl || 1);

          if (!tile.readyHarvest && Math.random() < 0.05) {
            if (b.type === 'house') tile.readyHarvest = 'wood';
            else if (b.type === 'generator') tile.readyHarvest = 'stone';
          }
        }
        if (b.type === 'hq') {
          tile.roadConnected = true;
          return;
        }
        const neighbors = [
          grid[`${tile.x + 1}_${tile.y}`], grid[`${tile.x - 1}_${tile.y}`],
          grid[`${tile.x}_${tile.y + 1}`], grid[`${tile.x}_${tile.y - 1}`]
        ];
        tile.roadConnected = neighbors.some(n => n && (n.hasRoad || (n.building && n.building.type === 'hq')));
      }
    });

    if (!grid["1_1"].readyHarvest && Math.random() < 0.08) grid["1_1"].readyHarvest = 'emerald';

    cityState.hasSchool = schoolCount > 0;
    cityState.hasMarket = marketCount > 0;
    cityState.hasExpedition = expeditionCount > 0;
    cityState.monumentLvl = monumentLvl;
    cityState.population = 20 + (housesCount * 12);
    cityState.defense = 60 + (towerCount * 80);
    cityState.heat = Math.min(100, 60 + (generatorCount * 25));

    let rankTitle = "Maden Muhtarlığı";
    if (cityState.monumentLvl >= 3 || cityState.totalBurnedOra >= 300) rankTitle = "Zürih Holding Karteli";
    else if (cityState.monumentLvl >= 2 || cityState.totalBurnedOra >= 150) rankTitle = "Alp Maden Baronluğu";
    else if (cityState.monumentLvl >= 1 || cityState.totalBurnedOra >= 50) rankTitle = "Bağımsız Koloni";

    quests.forEach(q => {
      if (q.id === 'q_houses') q.current = housesCount;
      if (q.id === 'q_school') q.current = schoolCount;
      if (q.id === 'q_market') q.current = marketCount;
      if (q.id === 'q_monument') q.current = monumentLvl;
      if (q.current >= q.target) q.completed = true;
    });

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('hud-colony-pop', cityState.population);
    setTxt('hud-colony-heat', `%${cityState.heat}`);
    setTxt('hud-colony-wood', cityState.wood);
    setTxt('hud-colony-stone', cityState.stone);
    setTxt('hud-colony-emerald', cityState.emerald);
    setTxt('hud-colony-ora', cityState.ora);
    setTxt('rep-burned-ora', `${cityState.totalBurnedOra} ORA`);
    setTxt('rep-prestige-rank', rankTitle);
    setTxt('colony-phase-tag', rankTitle);

    // Firebase senkronu için hook
    if (onSaveCallback && !isVisitingMode) {
      onSaveCallback(window.ColonyBridge.exportState());
    }
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

    setTimeout(() => {
      toast.classList.add('opacity-0', '-translate-y-2');
      toast.classList.remove('opacity-100', 'translate-y-0');
    }, 2500);
  }

  function burnOraToken(amount, reason) {
    if (cityState.ora < amount) {
      alert(`Yetersiz ORA! Gerekli: ${amount} ORA.`);
      return false;
    }
    cityState.ora -= amount;
    cityState.totalBurnedOra += amount;
    if (onBurnCallback) onBurnCallback(amount, reason);
    return true;
  }

  // --- RENDER DÖNGÜSÜ ---
  function render() {
    if (!ctx) return;
    const parent = canvas.parentElement || document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    waterWaveTick += 0.03;

    drawSkyline(w, h);

    const sortedTiles = Object.values(grid).sort((a, b) => (a.x + a.y) - (b.x + b.y));
    sortedTiles.forEach(tile => {
      if (!tile.isLocked) {
        drawNaturalTile(tile);
        if (tile.hasRoad) drawRoad(tile);
      } else {
        drawFogTile(tile);
      }
    });

    drawMountainMine();
    updateCitizens();
    drawCitizens();
    drawMerchantCart();

    sortedTiles.forEach(tile => {
      if (!tile.isLocked && tile.building) drawBuilding(tile);
      if (tile.readyHarvest) drawHarvestBubble(tile);
    });

    if (hoveredTile && grid[`${hoveredTile.x}_${hoveredTile.y}`]) {
      drawHighlight(hoveredTile.x, hoveredTile.y);
    }

    drawWeatherParticles(w, h);
    requestAnimationFrame(render);
  }

  function drawSkyline(w, h) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    const mode = weatherModes[weatherIdx];
    if (isNightMode) {
      skyGrad.addColorStop(0, '#040711');
      skyGrad.addColorStop(0.5, '#0b1329');
      skyGrad.addColorStop(1, '#1e293b');
    } else if (mode === 'blizzard') {
      skyGrad.addColorStop(0, '#64748b');
      skyGrad.addColorStop(0.5, '#94a3b8');
      skyGrad.addColorStop(1, '#cbd5e1');
    } else {
      skyGrad.addColorStop(0, '#0284c7');
      skyGrad.addColorStop(0.5, '#7dd3fc');
      skyGrad.addColorStop(1, '#e0f2fe');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    if (isNightMode) {
      ctx.fillStyle = '#ffffff';
      for (let i = 1; i <= 30; i++) {
        ctx.beginPath();
        ctx.arc((i * 97) % w, (i * 53) % (h * 0.4), (i % 2 === 0 ? 1.2 : 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const apex = isoToScreen(0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(apex.x - 600, apex.y + 150);
    ctx.lineTo(apex.x - 300, apex.y - 250);
    ctx.lineTo(apex.x - 100, apex.y - 120);
    ctx.lineTo(apex.x + 20, apex.y - 340);
    ctx.lineTo(apex.x + 200, apex.y - 140);
    ctx.lineTo(apex.x + 450, apex.y - 260);
    ctx.lineTo(apex.x + 700, apex.y + 150);
    ctx.closePath();

    const mtnGrad = ctx.createLinearGradient(apex.x, apex.y - 340, apex.x, apex.y + 150);
    if (isNightMode || mode === 'blizzard') {
      mtnGrad.addColorStop(0, '#cbd5e1');
      mtnGrad.addColorStop(0.5, '#475569');
      mtnGrad.addColorStop(1, '#0f172a');
    } else {
      mtnGrad.addColorStop(0, '#ffffff');
      mtnGrad.addColorStop(0.35, '#94a3b8');
      mtnGrad.addColorStop(1, '#334155');
    }
    ctx.fillStyle = mtnGrad;
    ctx.fill();
    ctx.restore();
  }

  function drawNaturalTile(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const w = TILE_W * camera.zoom;
    const h = TILE_H * camera.zoom;
    const depth = 16 * camera.zoom;

    ctx.beginPath();
    ctx.moveTo(pos.x - w / 2, pos.y);
    ctx.lineTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x, pos.y + h / 2 + depth);
    ctx.lineTo(pos.x - w / 2, pos.y + depth);
    ctx.closePath();
    ctx.fillStyle = isNightMode ? '#3b200b' : '#78350f';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x + w / 2, pos.y);
    ctx.lineTo(pos.x + w / 2, pos.y + depth);
    ctx.lineTo(pos.x, pos.y + h / 2 + depth);
    ctx.closePath();
    ctx.fillStyle = isNightMode ? '#1c0d02' : '#451a03';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2);
    ctx.lineTo(pos.x + w / 2, pos.y);
    ctx.lineTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();

    const isBlizzard = weatherModes[weatherIdx] === 'blizzard';
    if (tile.terrain === 'lake_water') {
      const waterGrad = ctx.createLinearGradient(pos.x - w/2, pos.y, pos.x + w/2, pos.y);
      const waveShift = Math.sin(waterWaveTick + tile.x + tile.y) * 0.1;
      waterGrad.addColorStop(0, isBlizzard ? '#0369a1' : '#0284c7');
      waterGrad.addColorStop(0.5 + waveShift, isBlizzard ? '#38bdf8' : '#7dd3fc');
      waterGrad.addColorStop(1, '#0369a1');
      ctx.fillStyle = waterGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      return;
    } else if (tile.terrain === 'shore_sand') {
      ctx.fillStyle = isNightMode ? '#78350f' : '#d97706';
    } else if (tile.terrain === 'dirt_grass') {
      ctx.fillStyle = isBlizzard ? '#a1a1aa' : (isNightMode ? '#3f6212' : '#65a30d');
    } else if (tile.terrain === 'mountain_rock') {
      ctx.fillStyle = isBlizzard ? '#e2e8f0' : (isNightMode ? '#334155' : '#64748b');
    } else {
      ctx.fillStyle = isBlizzard ? '#cbd5e1' : (isNightMode ? '#1e3a1e' : '#4d7c0f');
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawFogTile(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const w = TILE_W * camera.zoom;
    const h = TILE_H * camera.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2);
    ctx.lineTo(pos.x + w / 2, pos.y);
    ctx.lineTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();
    ctx.fillStyle = isNightMode ? 'rgba(30, 41, 59, 0.9)' : 'rgba(241, 245, 249, 0.85)';
    ctx.fill();
    ctx.strokeStyle = isNightMode ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawRoad(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const w = (TILE_W * 0.72) * camera.zoom;
    const h = (TILE_H * 0.72) * camera.zoom;
    const z = camera.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2);
    ctx.lineTo(pos.x + w / 2, pos.y);
    ctx.lineTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();
    ctx.fillStyle = isNightMode ? '#57534e' : '#a8a29e';
    ctx.fill();
    ctx.strokeStyle = isNightMode ? '#292524' : '#78716c';
    ctx.lineWidth = 1.5 * z;
    ctx.stroke();
    ctx.restore();
  }

  function drawCitizens() {
    const z = camera.zoom;
    citizens.forEach(c => {
      const interpX = c.currentX + (c.targetX - c.currentX) * c.progress;
      const interpY = c.currentY + (c.targetY - c.currentY) * c.progress;
      const pos = isoToScreen(interpX, interpY);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3 * z, 1.5 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.color;
      ctx.fillRect(-2 * z, -8 * z, 4 * z, 6 * z);
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(0, -9.5 * z, 2.5 * z, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawMerchantCart() {
    if (!merchantCart) return;
    const z = camera.zoom;
    const interpX = merchantCart.currentX + (merchantCart.targetX - merchantCart.currentX) * merchantCart.progress;
    const interpY = merchantCart.currentY + (merchantCart.targetY - merchantCart.currentY) * merchantCart.progress;
    const pos = isoToScreen(interpX, interpY);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(-8 * z, -12 * z, 16 * z, 9 * z);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(-9 * z, -16 * z, 18 * z, 4 * z);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-5 * z, -3 * z, 2.5 * z, 0, Math.PI * 2);
    ctx.arc(5 * z, -3 * z, 2.5 * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMountainMine() {
    const pos = isoToScreen(1, 1);
    const z = camera.zoom;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = isNightMode ? '#1e293b' : '#475569';
    ctx.beginPath();
    ctx.moveTo(-50 * z, 10 * z);
    ctx.lineTo(-40 * z, -60 * z);
    ctx.lineTo(0, -90 * z);
    ctx.lineTo(50 * z, -50 * z);
    ctx.lineTo(50 * z, 10 * z);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(0, -15 * z, 28 * z, 22 * z, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 5 * z;
    ctx.beginPath();
    ctx.arc(0, -15 * z, 28 * z, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, -15 * z, (isNightMode ? 8 : 6) * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBuilding(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const b = tile.building;
    const z = camera.zoom;
    const lvl = b.lvl || 1;
    ctx.save();
    ctx.translate(pos.x, pos.y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 4 * z, 24 * z, 12 * z, 0, 0, Math.PI * 2);
    ctx.fill();

    if (b.underConstruction) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2 * z;
      ctx.strokeRect(-16 * z, -32 * z, 32 * z, 30 * z);
      ctx.beginPath();
      ctx.moveTo(-16 * z, -32 * z);
      ctx.lineTo(16 * z, -2 * z);
      ctx.moveTo(16 * z, -32 * z);
      ctx.lineTo(-16 * z, -2 * z);
      ctx.stroke();
      const remainingSec = Math.max(0, Math.ceil((b.finishTime - Date.now()) / 1000));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(-22 * z, -58 * z, 44 * z, 14 * z);
      ctx.fillStyle = '#fde047';
      ctx.font = `bold ${8.5 * z}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`⏳ ${remainingSec}s`, 0, -47 * z);
      ctx.restore();
      return;
    }

    if (b.type === 'house') {
      const houseHeight = lvl >= 2 ? 32 : 22;
      ctx.fillStyle = isNightMode ? '#cbd5e1' : '#fef3c7';
      ctx.fillRect(-14 * z, -houseHeight * z, 28 * z, houseHeight * z);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-15 * z, -houseHeight * z, 3 * z, houseHeight * z);
      ctx.fillRect(12 * z, -houseHeight * z, 3 * z, houseHeight * z);
      ctx.fillStyle = isNightMode ? '#fef08a' : '#38bdf8';
      ctx.fillRect(5 * z, -18 * z, 6 * z, 6 * z);
      if (lvl >= 2) ctx.fillRect(-11 * z, -28 * z, 6 * z, 6 * z);
      ctx.beginPath();
      ctx.moveTo(-18 * z, -houseHeight * z);
      ctx.lineTo(0, -(houseHeight + 18) * z);
      ctx.lineTo(18 * z, -houseHeight * z);
      ctx.closePath();
      ctx.fillStyle = lvl === 3 ? '#1e3a8a' : '#b91c1c';
      ctx.fill();
    } else if (b.type === 'monument') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-14 * z, -10 * z, 28 * z, 10 * z);
      const crystalH = 35 + (lvl * 12);
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.moveTo(-8 * z, -10 * z);
      ctx.lineTo(0, -(10 + crystalH) * z);
      ctx.lineTo(8 * z, -10 * z);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#a5f3fc';
      ctx.beginPath();
      ctx.moveTo(-3 * z, -10 * z);
      ctx.lineTo(0, -(10 + crystalH) * z);
      ctx.lineTo(3 * z, -10 * z);
      ctx.closePath();
      ctx.fill();
    } else if (b.type === 'expedition') {
      ctx.fillStyle = '#065f46';
      ctx.beginPath();
      ctx.moveTo(-16 * z, -2 * z);
      ctx.lineTo(0, -32 * z);
      ctx.lineTo(16 * z, -2 * z);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#022c22';
      ctx.beginPath();
      ctx.moveTo(-6 * z, -2 * z);
      ctx.lineTo(0, -18 * z);
      ctx.lineTo(6 * z, -2 * z);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2 * z;
      ctx.beginPath();
      ctx.moveTo(12 * z, -2 * z);
      ctx.lineTo(12 * z, -42 * z);
      ctx.stroke();
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(12 * z, -42 * z, 10 * z, 6 * z);
    } else if (b.type === 'silo') {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-14 * z, -36 * z, 28 * z, 34 * z);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5 * z;
      ctx.strokeRect(-14 * z, -26 * z, 28 * z, 6 * z);
      ctx.strokeRect(-14 * z, -14 * z, 28 * z, 6 * z);
      ctx.beginPath();
      ctx.arc(0, -36 * z, 14 * z, Math.PI, 0);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
    } else if (b.type === 'market') {
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-16 * z, -26 * z, 32 * z, 24 * z);
      ctx.fillStyle = '#059669';
      ctx.fillRect(-18 * z, -22 * z, 36 * z, 6 * z);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-4 * z, -38 * z, 8 * z, 8 * z);
      ctx.beginPath();
      ctx.moveTo(-18 * z, -26 * z);
      ctx.lineTo(0, -42 * z);
      ctx.lineTo(18 * z, -26 * z);
      ctx.closePath();
      ctx.fillStyle = '#b45309';
      ctx.fill();
    } else if (b.type === 'school') {
      ctx.fillStyle = isNightMode ? '#94a3b8' : '#f8fafc';
      ctx.fillRect(-18 * z, -26 * z, 36 * z, 24 * z);
      ctx.fillStyle = '#4338ca';
      ctx.fillRect(-5 * z, -14 * z, 10 * z, 14 * z);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(-14 * z, -20 * z, 6 * z, 6 * z);
      ctx.fillRect(8 * z, -20 * z, 6 * z, 6 * z);
      ctx.beginPath();
      ctx.moveTo(-22 * z, -26 * z);
      ctx.lineTo(0, -46 * z);
      ctx.lineTo(22 * z, -26 * z);
      ctx.closePath();
      ctx.fillStyle = '#4f46e5';
      ctx.fill();
      ctx.fillStyle = '#312e81';
      ctx.fillRect(-4 * z, -56 * z, 8 * z, 10 * z);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(0, -51 * z, 2.5 * z, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6 * z, -56 * z);
      ctx.lineTo(0, -64 * z);
      ctx.lineTo(6 * z, -56 * z);
      ctx.closePath();
      ctx.fillStyle = '#b91c1c';
      ctx.fill();
    } else if (b.type === 'hq') {
      ctx.fillStyle = isNightMode ? '#64748b' : '#e2e8f0';
      ctx.fillRect(-22 * z, -36 * z, 44 * z, 34 * z);
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.moveTo(-26 * z, -36 * z);
      ctx.lineTo(0, -58 * z);
      ctx.lineTo(26 * z, -36 * z);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-4 * z, -70 * z, 8 * z, 14 * z);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(4 * z, -72 * z, 10 * z, 6 * z);
    } else if (b.type === 'water') {
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-14 * z, -26 * z, 28 * z, 24 * z);
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.arc(16 * z, -12 * z, 10 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-16 * z, -26 * z);
      ctx.lineTo(0, -40 * z);
      ctx.lineTo(16 * z, -26 * z);
      ctx.closePath();
      ctx.fillStyle = '#0284c7';
      ctx.fill();
    } else if (b.type === 'generator') {
      ctx.fillStyle = isNightMode ? '#334155' : '#64748b';
      ctx.fillRect(-18 * z, -28 * z, 36 * z, 26 * z);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(6 * z, -48 * z, 8 * z, 22 * z);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(-8 * z, -14 * z, 8 * z, 8 * z);
    } else if (b.type === 'tower') {
      ctx.fillStyle = isNightMode ? '#1e293b' : '#475569';
      ctx.fillRect(-10 * z, -40 * z, 20 * z, 38 * z);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(-12 * z, -46 * z, 24 * z, 8 * z);
      if (isNightMode) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.beginPath();
        ctx.arc(0, -42 * z, 8 * z, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (b.damaged) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, -30 * z, 10 * z, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(0, -30 * z, 6 * z, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!tile.roadConnected && !b.underConstruction) {
      const bounce = Math.sin(Date.now() / 200) * 3;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, -56 * z + bounce, 8 * z, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${9 * z}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, -53 * z + bounce);
    }

    ctx.restore();
  }

  function drawHarvestBubble(tile) {
    const pos = isoToScreen(tile.x, tile.y);
    const z = camera.zoom;
    const bounce = Math.sin(Date.now() / 150) * 4;
    ctx.save();
    ctx.translate(pos.x, pos.y - 50 * z + bounce);

    if (tile.readyHarvest === 'emerald') ctx.fillStyle = '#10b981';
    else if (tile.readyHarvest === 'stone') ctx.fillStyle = '#64748b';
    else ctx.fillStyle = '#d97706';

    ctx.beginPath();
    ctx.arc(0, 0, 11 * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * z;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${9 * z}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let iconTxt = '🪵';
    if (tile.readyHarvest === 'emerald') iconTxt = '💎';
    else if (tile.readyHarvest === 'stone') iconTxt = '🪨';
    ctx.fillText(iconTxt, 0, 0);
    ctx.restore();
  }

  function drawHighlight(tx, ty) {
    const pos = isoToScreen(tx, ty);
    const w = TILE_W * camera.zoom;
    const h = TILE_H * camera.zoom;
    const target = grid[`${tx}_${ty}`];

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2);
    ctx.lineTo(pos.x + w / 2, pos.y);
    ctx.lineTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();

    if (movingSourceTile) {
      const isValid = target && !target.building && !target.hasRoad && !target.isLocked && target.terrain !== 'lake_water' && target.terrain !== 'mountain_rock';
      ctx.fillStyle = isValid ? 'rgba(59, 130, 246, 0.45)' : 'rgba(239, 68, 68, 0.45)';
      ctx.fill();
      ctx.strokeStyle = isValid ? '#3b82f6' : '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      return;
    }

    if (activeBuildType === 'demolish') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      return;
    }

    const isBlocked = (target && (target.terrain === 'lake_water' || target.terrain === 'mountain_rock') && activeBuildType !== 'water') || (target && target.isLocked);
    ctx.fillStyle = isBlocked ? 'rgba(239, 68, 68, 0.4)' : (activeBuildType ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.25)');
    ctx.fill();
    ctx.strokeStyle = isBlocked ? '#ef4444' : (activeBuildType ? '#10b981' : '#38bdf8');
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function drawWeatherParticles(w, h) {
    const mode = weatherModes[weatherIdx];
    if (mode === 'clear') return;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    const speedMultiplier = mode === 'blizzard' ? 2.5 : 1.0;
    snowflakes.forEach(s => {
      s.y += s.speedY * speedMultiplier;
      s.x += (s.speedX + (mode === 'blizzard' ? 2.2 : 0)) * speedMultiplier;
      if (s.y > h) { s.y = -10; s.x = Math.random() * w; }
      if (s.x > w) s.x = -10;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // --- FARE & TOUCH ETKİLEŞİMİ ---
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

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = 1.08;
      if (e.deltaY < 0) camera.zoom = Math.min(camera.zoom * zoomFactor, 2.4);
      else camera.zoom = Math.max(camera.zoom / zoomFactor, 0.5);
    }, { passive: false });

    canvas.addEventListener('click', (e) => {
      handleInteractionTap(e.clientX, e.clientY);
    });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchState.touchStartTime = Date.now();
      touchState.moved = false;
      if (e.touches.length === 1) {
        touchState.active = true;
        touchState.startX = e.touches[0].clientX;
        touchState.startY = e.touches[0].clientY;
        camera.dragStartX = e.touches[0].clientX - camera.x;
        camera.dragStartY = e.touches[0].clientY - camera.y;
      } else if (e.touches.length === 2) {
        touchState.active = false;
        touchState.initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        touchState.initialZoom = camera.zoom;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && touchState.active) {
        const dx = Math.abs(e.touches[0].clientX - touchState.startX);
        const dy = Math.abs(e.touches[0].clientY - touchState.startY);
        if (dx > 7 || dy > 7) touchState.moved = true;
        camera.x = e.touches[0].clientX - camera.dragStartX;
        camera.y = e.touches[0].clientY - camera.dragStartY;
      } else if (e.touches.length === 2 && touchState.initialPinchDistance > 0) {
        touchState.moved = true;
        const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const scale = currentDist / touchState.initialPinchDistance;
        camera.zoom = Math.min(Math.max(touchState.initialZoom * scale, 0.45), 2.2);
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const duration = Date.now() - touchState.touchStartTime;
      if (!touchState.moved && duration < 350) {
        const touch = e.changedTouches[0];
        handleInteractionTap(touch.clientX, touch.clientY);
      }
      touchState.active = false;
    }, { passive: false });
  }

  function handleInteractionTap(screenX, screenY) {
    if (isVisitingMode) {
      showToast("Ziyaret modundasınız; işlem yapılamaz.", "fa-lock");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const tileCoord = screenToIso(screenX - rect.left, screenY - rect.top);
    const key = `${tileCoord.x}_${tileCoord.y}`;
    const tile = grid[key];
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
      showToast("Bina başarıyla yeni konumuna taşındı.", "fa-arrows-up-down-left-right");
      return;
    }

    if (tile.readyHarvest) {
      ColonyAudio.playHarvest();
      if (tile.readyHarvest === 'emerald') {
        cityState.emerald += 1;
        showToast("+1 Şehir Zümrütü Toplandı!", "fa-gem");
      } else if (tile.readyHarvest === 'wood') {
        cityState.wood += 5;
        showToast("+5 Dağ Kerestesi Toplandı!", "fa-tree");
      } else if (tile.readyHarvest === 'stone') {
        cityState.stone += 4;
        showToast("+4 Granit Taşı Toplandı!", "fa-cube");
      }
      tile.readyHarvest = null;
      updateCityLogic();
      return;
    }

    if (tile.isLocked) {
      expandMapPrompt();
      return;
    }

    if (activeBuildType === 'demolish') {
      if (tile.building && tile.building.type === 'hq') {
        showToast("Vadi Karargahı yıkılamaz!", "fa-shield-halved");
        return;
      }
      if (tile.building || tile.hasRoad) {
        ColonyAudio.playDemolish();
        tile.building = null;
        tile.hasRoad = false;
        initCitizens();
        updateCityLogic();
        closeSheet();
        showToast("Yıkım tamamlandı.", "fa-hammer");
      }
      return;
    }

    if (activeBuildType === 'road') {
      if (tile.terrain !== 'lake_water' && tile.terrain !== 'mountain_rock' && !tile.building) {
        tile.hasRoad = true;
        ColonyAudio.playBuild();
        initCitizens();
        updateCityLogic();
      }
      return;
    }

    if (activeBuildType) {
      if (!tile.building && !tile.hasRoad) {
        if (tile.terrain === 'lake_water' && activeBuildType !== 'water') {
          showToast("Gölete sadece Su Değirmeni kurulabilir!", "fa-droplet");
          return;
        }
        if (tile.terrain === 'mountain_rock') {
          showToast("Sarp kayalıklara inşaat yapılamaz!", "fa-mountain");
          return;
        }

        ColonyAudio.playBuild();
        const buildDuration = (activeBuildType === 'monument' ? 60 : 45) * 1000;
        tile.building = {
          type: activeBuildType,
          name: getBuildingName(activeBuildType),
          lvl: 1,
          underConstruction: true,
          finishTime: Date.now() + buildDuration,
          damaged: false
        };
        showToast(`${tile.building.name} inşası başladı.`, "fa-clock");
        updateCityLogic();
      }
      return;
    }

    if (tile.building) {
      ColonyAudio.playClick();
      if (tile.building.type === 'market') { toggleMarketModal(); return; }
      if (tile.building.type === 'expedition') { toggleExpeditionModal(); return; }
      openBuildingSheet(tile);
    } else {
      closeSheet();
    }
  }

  function getBuildingName(type) {
    const map = {
      house: 'Alp Evi', school: 'Dağ Okulu', market: 'Ticaret Hanı',
      expedition: 'Keşif Kampı', monument: 'Alp Kristal Anıtı', silo: 'Cevher Silosu',
      water: 'Su Değirmeni', generator: 'Buhar Fırını', tower: 'Asayiş Karakolu', hq: 'Vadi Karargahı'
    };
    return map[type] || 'Bina';
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
      if (b.underConstruction) {
        statusEl.innerText = "İnşa Ediliyor..."; statusEl.className = "font-bold text-amber-400";
      } else if (b.damaged) {
        statusEl.innerText = "Hasarlı!"; statusEl.className = "font-bold text-rose-400";
      } else if (tile.roadConnected) {
        statusEl.innerText = "Yola Bağlı ✓"; statusEl.className = "font-bold text-emerald-400";
      } else {
        statusEl.innerText = "Yol Gerekli !"; statusEl.className = "font-bold text-rose-400";
      }
    }

    if (descEl) descEl.innerText = b.type === 'monument' ? "Koloni prestij anıtı. ORA yakımıyla yükselir." : (b.type === 'house' ? "+12 madenci barındırır." : "Ekonomik birim.");

    if (actionsEl) {
      if (b.underConstruction) {
        actionsEl.innerHTML = `
          <button onclick="ColonyEngine.instantFinish()" class="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-98 font-bold text-xs flex items-center justify-center gap-1.5 shadow text-slate-950">
            <i class="fa-solid fa-bolt"></i><span>Hemen Bitir (5 ORA Yak)</span>
          </button>
        `;
      } else if (b.damaged) {
        actionsEl.innerHTML = `
          <button onclick="ColonyEngine.repairBuilding()" class="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 font-bold text-xs flex items-center justify-center gap-1.5 shadow">
            <i class="fa-solid fa-wrench"></i><span>Onar (3 ORA Yak)</span>
          </button>
        `;
      } else {
        const costOra = b.type === 'monument' ? ((b.lvl || 1) * 50) : ((b.lvl || 1) * 15);
        actionsEl.innerHTML = `
          <button onclick="ColonyEngine.upgradeSelectedBuilding()" class="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 font-bold text-xs flex items-center justify-center gap-1.5 shadow">
            <i class="fa-solid fa-arrow-up"></i><span>Seviye Atlat (${costOra} ORA Yak)</span>
          </button>
          <button onclick="ColonyEngine.startMoveSelected()" class="px-3 py-2.5 rounded-xl bg-blue-950/60 hover:bg-blue-900 border border-blue-800 text-blue-300 font-bold text-xs flex items-center justify-center" title="Binayı Taşı">
            <i class="fa-solid fa-arrows-up-down-left-right"></i>
          </button>
          <button onclick="ColonyEngine.demolishSelectedBuilding()" class="px-3 py-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs flex items-center justify-center">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `;
      }
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

  function startMoveMode() {
    showToast("Taşımak istediğiniz binaya tıklayın.", "fa-arrows-up-down-left-right");
  }

  function startMoveSelected() {
    if (!selectedTileForSheet || !selectedTileForSheet.building) return;
    if (selectedTileForSheet.building.type === 'hq') {
      alert("Ana Karargah taşınamaz!");
      return;
    }
    movingSourceTile = selectedTileForSheet;
    closeSheet();
    showToast("Şimdi binayı koymak istediğiniz boş karoya dokunun.", "fa-arrows-up-down-left-right");
  }

  function instantFinish() {
    if (!selectedTileForSheet || !selectedTileForSheet.building) return;
    if (!burnOraToken(5, "Bina Hızlandırma")) return;
    selectedTileForSheet.building.underConstruction = false;
    selectedTileForSheet.building.finishTime = null;
    ColonyAudio.playHarvest();
    updateCityLogic();
    openBuildingSheet(selectedTileForSheet);
    showToast("5 ORA yakıldı ve inşaat tamamlandı!", "fa-fire");
  }

  function repairBuilding() {
    if (!selectedTileForSheet || !selectedTileForSheet.building) return;
    if (!burnOraToken(3, "Bina Onarımı")) return;
    selectedTileForSheet.building.damaged = false;
    ColonyAudio.playBuild();
    updateCityLogic();
    openBuildingSheet(selectedTileForSheet);
    showToast("3 ORA yakılarak bina tamir edildi.", "fa-wrench");
  }

  function upgradeSelectedBuilding() {
    if (!selectedTileForSheet || !selectedTileForSheet.building) return;
    const b = selectedTileForSheet.building;
    const costOra = b.type === 'monument' ? ((b.lvl || 1) * 50) : ((b.lvl || 1) * 15);
    if (!burnOraToken(costOra, `${b.name} Seviye Atlama`)) return;
    b.lvl = (b.lvl || 1) + 1;
    ColonyAudio.playBuild();
    updateCityLogic();
    showToast(`${b.name} Seviye ${b.lvl}'e yükseltildi! (${costOra} ORA Yakıldı)`, 'fa-arrow-up');
    openBuildingSheet(selectedTileForSheet);
  }

  function demolishSelectedBuilding() {
    if (!selectedTileForSheet) return;
    if (selectedTileForSheet.building && selectedTileForSheet.building.type === 'hq') {
      alert("Ana Karargah yıkılamaz!");
      return;
    }
    ColonyAudio.playDemolish();
    selectedTileForSheet.building = null;
    selectedTileForSheet.hasRoad = false;
    initCitizens();
    updateCityLogic();
    closeSheet();
    showToast("Bina yıkıldı.", "fa-hammer");
  }

  function selectBuild(type) {
    if (isVisitingMode) return;
    movingSourceTile = null;
    ColonyAudio.playClick();
    closeSheet();
    activeBuildType = (activeBuildType === type) ? null : type;

    document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('ring-2', 'ring-emerald-400', 'bg-slate-700', 'ring-rose-400'));
    if (activeBuildType) {
      const btn = document.getElementById(`btn-build-${activeBuildType}`);
      if (btn) {
        if (activeBuildType === 'demolish') {
          btn.classList.add('ring-2', 'ring-rose-400', 'bg-rose-900/60');
          showToast("Yıkım modu: Hedefe dokunun.", "fa-hammer");
        } else {
          btn.classList.add('ring-2', 'ring-emerald-400', 'bg-slate-700');
        }
      }
    }
  }

  function triggerBanditRaid() {
    if (isVisitingMode) return;
    closeSheet();
    const threatLevel = 120;
    if (cityState.defense >= threatLevel) {
      ColonyAudio.playHarvest();
      alert(`🛡️ PÜSKÜRTÜLDÜ!\n\nAlp Haydutları vadiye sızamadı. Savunma gücünüz (${cityState.defense}) yeterli geldi!`);
      return;
    }

    const validTargets = Object.values(grid).filter(t => t.building && t.building.type !== 'hq' && !t.building.damaged);
    if (validTargets.length === 0) {
      alert("Saldırılacak uygun bina yok.");
      return;
    }

    ColonyAudio.playAlarm();
    const victim = validTargets[Math.floor(Math.random() * validTargets.length)];
    victim.building.damaged = true;
    updateCityLogic();
    alert(`🚨 ÇETE BASKINI!\n\nSavunma yetersiz kaldı! Haydutlar ${victim.building.name} binasına zarar verdi. (Onarmak için ORA yakmalısınız)`);
  }

  function expandMapPrompt() {
    if (isVisitingMode) return;
    closeSheet();
    const reqPop = 30;
    const reqOraBurn = 25;
    const reqEmerald = 5;

    if (cityState.population < reqPop) {
      alert(`🚫 Nüfus yetersiz! En az ${reqPop} nüfus gereklidir.`);
      return;
    }
    if (!cityState.hasSchool) {
      alert(`🚫 Sosyal altyapı eksik! Önce bir Dağ Okulu kurmalısınız.`);
      return;
    }
    if (cityState.ora < reqOraBurn || cityState.emerald < reqEmerald) {
      alert(`🚫 Harç Yetersiz!\nSis perdesini dağıtmak için ${reqOraBurn} ORA yakılmalı ve ${reqEmerald} Şehir Zümrüdü harcanmalıdır.`);
      return;
    }

    if (confirm(`⛰️ Arazi Genişletme Harcı\n\n${reqOraBurn} ORA yakılarak buharlaştırılacak ve sis perdesi dağıtılacaktır. Onaylıyor musunuz?`)) {
      if (!burnOraToken(reqOraBurn, "Arazi Genişletme")) return;
      cityState.emerald -= reqEmerald;
      unlockedRadius += 2;

      for (let x = 0; x < MAX_SIZE; x++) {
        for (let y = 0; y < MAX_SIZE; y++) {
          const dist = Math.max(Math.abs(x - 5), Math.abs(y - 5));
          if (dist <= unlockedRadius) grid[`${x}_${y}`].isLocked = false;
        }
      }
      ColonyAudio.playHarvest();
      updateCityLogic();
      showToast(`🎉 ${reqOraBurn} ORA Yakıldı! Yeni araziler açıldı.`, "fa-fire");
    }
  }

  function toggleDayNight() {
    ColonyAudio.playClick();
    isNightMode = !isNightMode;
    updateDayNightUI();
  }

  function updateDayNightUI() {
    const icon = document.getElementById('icon-day-night');
    if (icon) icon.className = isNightMode ? "fa-solid fa-moon text-indigo-300 text-xs sm:text-sm" : "fa-solid fa-sun text-amber-400 text-xs sm:text-sm";
  }

  function cycleWeather() {
    weatherIdx = (weatherIdx + 1) % weatherModes.length;
    if (weatherModes[weatherIdx] === 'blizzard') ColonyAudio.playWind();
    else ColonyAudio.playClick();
    updateWeatherUI();
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
      showToast("⚠️ Alp Tipisi Başladı! Buhar Isısını Koruyun.", "fa-wind");
    }
  }

  function toggleMarketModal() {
    ColonyAudio.playClick();
    const modal = document.getElementById('market-modal');
    if (!modal) return;
    const isHidden = modal.classList.contains('pointer-events-none');
    modal.classList.toggle('opacity-0', !isHidden);
    modal.classList.toggle('pointer-events-none', !isHidden);
    modal.classList.toggle('opacity-100', isHidden);
  }

  function buyMaterial(type) {
    if (type === 'ora_to_wood') {
      if (!burnOraToken(5, "Kereste Tedariği")) return;
      cityState.wood += 30;
      ColonyAudio.playHarvest();
      showToast("5 ORA Yakıldı ➔ +30 Kereste Alındı!", "fa-tree");
    } else if (type === 'ora_to_stone') {
      if (!burnOraToken(8, "Granit Tedariği")) return;
      cityState.stone += 25;
      ColonyAudio.playHarvest();
      showToast("8 ORA Yakıldı ➔ +25 Granit Alındı!", "fa-cube");
    } else if (type === 'ora_to_emerald') {
      if (!burnOraToken(15, "Zümrüt Tedariği")) return;
      cityState.emerald += 2;
      ColonyAudio.playHarvest();
      showToast("15 ORA Yakıldı ➔ +2 Zümrüt Alındı!", "fa-gem");
    }
    updateCityLogic();
  }

  function toggleExpeditionModal() {
    ColonyAudio.playClick();
    const modal = document.getElementById('expedition-modal');
    const list = document.getElementById('expedition-list');
    if (!modal || !list) return;
    const isHidden = modal.classList.contains('pointer-events-none');
    if (isHidden) {
      list.innerHTML = expeditions.map(exp => `
        <div class="p-3 rounded-2xl bg-slate-800/80 border ${exp.active ? 'border-cyan-500/50' : 'border-slate-700'} flex items-center justify-between gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-1.5">
              <h4 class="text-xs font-bold text-white">${exp.name}</h4>
              ${exp.active ? '<span class="text-[9px] bg-cyan-900/60 text-cyan-300 px-1.5 py-0.5 rounded font-mono animate-pulse">Seferde</span>' : ''}
            </div>
            <div class="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
              <span>⏱️ ${exp.duration}s</span>
              <span class="text-amber-200 font-bold">+${exp.reward.wood} Odun</span>
              <span class="text-emerald-400 font-bold">+${exp.reward.emerald} Zümrüt</span>
            </div>
          </div>
          <div>
            ${exp.active ? `
              <span class="text-xs font-mono text-cyan-300 font-bold">${Math.max(0, Math.ceil((exp.finishTime - Date.now())/1000))}s</span>
            ` : `
              <button onclick="ColonyEngine.startExpedition('${exp.id}')" class="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs shadow transition">
                Gönder (${exp.costWood} Odun)
              </button>
            `}
          </div>
        </div>
      `).join('');
      modal.classList.remove('opacity-0', 'pointer-events-none');
      modal.classList.add('opacity-100');
    } else {
      modal.classList.add('opacity-0', 'pointer-events-none');
      modal.classList.remove('opacity-100');
    }
  }

  function startExpedition(expId) {
    const exp = expeditions.find(e => e.id === expId);
    if (!exp) return;
    if (cityState.wood < exp.costWood) {
      alert(`Yetersiz Kereste! Sefer için ${exp.costWood} Kereste gereklidir.`);
      return;
    }
    cityState.wood -= exp.costWood;
    exp.active = true;
    exp.finishTime = Date.now() + (exp.duration * 1000);
    ColonyAudio.playBuild();
    updateCityLogic();
    toggleExpeditionModal();
    showToast(`${exp.name} başladı!`, "fa-person-hiking");
  }

  function toggleVisitMode() {
    ColonyAudio.playClick();
    isVisitingMode = !isVisitingMode;
    const banner = document.getElementById('visit-banner');
    const cityName = document.getElementById('hud-city-name');
    const phaseTag = document.getElementById('colony-phase-tag');
    const btnText = document.getElementById('text-visit-mode');

    if (isVisitingMode) {
      backupPlayerGrid = JSON.parse(JSON.stringify(grid));
      generateShowcaseColony();
      if (banner) { banner.classList.remove('opacity-0', 'pointer-events-none'); banner.classList.add('opacity-100'); }
      if (cityName) cityName.innerHTML = `Zürih Holding <i class="fa-solid fa-certificate text-amber-400"></i>`;
      if (phaseTag) phaseTag.innerText = "Holding Maden Kampı (Vitrin)";
      if (btnText) btnText.innerText = "Kendi Kolonime Dön";
      showToast("Zürih Holding Kolonisi Ziyaret Ediliyor!", "fa-compass");
    } else {
      if (backupPlayerGrid) grid = backupPlayerGrid;
      if (banner) { banner.classList.add('opacity-0', 'pointer-events-none'); banner.classList.remove('opacity-100'); }
      if (cityName) cityName.innerHTML = `Matterhorn <i class="fa-solid fa-chart-pie text-[10px] text-slate-400"></i>`;
      if (btnText) btnText.innerText = "Ziyaret Et";
      initCitizens();
      updateCityLogic();
      showToast("Kendi koloninize dönüldü.", "fa-house");
    }
  }

  function generateShowcaseColony() {
    grid = {};
    for (let x = 0; x < MAX_SIZE; x++) {
      for (let y = 0; y < MAX_SIZE; y++) {
        grid[`${x}_${y}`] = { x, y, terrain: 'grass', hasRoad: false, building: null, roadConnected: true, isLocked: false, readyHarvest: null };
      }
    }
    for (let i = 2; i <= 8; i++) {
      grid[`${i}_4`].hasRoad = true; grid[`${i}_6`].hasRoad = true; grid[`5_${i}`].hasRoad = true;
    }
    grid["5_5"].building = { type: 'hq', name: "Holding Köşkü", lvl: 3, underConstruction: false };
    grid["5_3"].building = { type: 'monument', name: "Mega Kristal Anıtı", lvl: 3, underConstruction: false };
    grid["4_4"].building = { type: 'house', name: "Lüks Alp Konağı", lvl: 3, underConstruction: false };
    grid["6_4"].building = { type: 'house', name: "Lüks Alp Konağı", lvl: 3, underConstruction: false };
    grid["4_6"].building = { type: 'silo', name: "Mega Silo", lvl: 2, underConstruction: false };
    grid["6_6"].building = { type: 'market', name: "Büyük Ticaret Sarayı", lvl: 2, underConstruction: false };
    grid["3_4"].building = { type: 'expedition', name: "Usta Keşif Üssü", lvl: 1, underConstruction: false };
  }

  function leaveEnergyUpvote() {
    ColonyAudio.playHarvest();
    showToast("Holdinge Selam Bırakıldı! (Sosyal Prestij Artışı)", "fa-hand-holding-heart");
  }

  function toggleReportModal() {
    ColonyAudio.playClick();
    const modal = document.getElementById('report-modal');
    if (!modal) return;
    const isHidden = modal.classList.contains('pointer-events-none');
    modal.classList.toggle('opacity-0', !isHidden);
    modal.classList.toggle('pointer-events-none', !isHidden);
    modal.classList.toggle('opacity-100', isHidden);
  }

  function toggleQuestModal() {
    ColonyAudio.playClick();
    const modal = document.getElementById('quest-modal');
    const list = document.getElementById('quest-list');
    if (!modal || !list) return;
    const isHidden = modal.classList.contains('pointer-events-none');
    if (isHidden) {
      list.innerHTML = quests.map(q => `
        <div class="p-3 rounded-2xl bg-slate-800/80 border ${q.completed ? 'border-emerald-500/50' : 'border-slate-700'} flex items-center justify-between gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-1.5">
              <h4 class="text-xs font-bold ${q.completed ? 'text-emerald-400' : 'text-white'}">${q.title}</h4>
              ${q.claimed ? '<span class="text-[9px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">Alındı</span>' : ''}
            </div>
            <p class="text-[10px] text-slate-400 leading-tight mt-0.5">${q.desc}</p>
            <div class="flex items-center gap-2 mt-1.5 text-[9px]">
              <span class="font-bold text-slate-300">İlerleme: ${Math.min(q.current, q.target)}/${q.target}</span>
              <span class="text-amber-200 font-bold">+${q.reward.wood || q.reward.stone} Hammadde</span>
              <span class="text-emerald-400 font-bold">+${q.reward.emerald} Zümrüt</span>
            </div>
          </div>
          <div>
            ${q.completed && !q.claimed ? `
              <button onclick="ColonyEngine.claimQuest('${q.id}')" class="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow transition">
                Ödülü Al
              </button>
            ` : `
              <div class="w-7 h-7 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xs ${q.claimed ? 'text-emerald-400' : 'text-slate-500'}">
                <i class="fa-solid ${q.claimed ? 'fa-check' : 'fa-hourglass-half'}"></i>
              </div>
            `}
          </div>
        </div>
      `).join('');
      modal.classList.remove('opacity-0', 'pointer-events-none');
      modal.classList.add('opacity-100');
    } else {
      modal.classList.add('opacity-0', 'pointer-events-none');
      modal.classList.remove('opacity-100');
    }
  }

  function claimQuest(qid) {
    const q = quests.find(item => item.id === qid);
    if (q && q.completed && !q.claimed) {
      q.claimed = true;
      if (q.reward.wood) cityState.wood += q.reward.wood;
      if (q.reward.stone) cityState.stone += q.reward.stone;
      cityState.emerald += q.reward.emerald;
      ColonyAudio.playHarvest();
      updateCityLogic();
      toggleQuestModal();
      showToast(`Tebrikler! Hammadde ve Zümrüt kasanıza eklendi.`, "fa-gift");
    }
  }

  // --- GLOBAL KÖPRÜ (FIREBASE & ANA PLATFORM BAĞLANTISI) ---
  window.ColonyBridge = {
    exportState: function() {
      return {
        grid, cityState, unlockedRadius, expeditions, quests
      };
    },
    importState: function(savedPayload) {
      if (!savedPayload) return;
      if (savedPayload.grid) grid = savedPayload.grid;
      if (savedPayload.cityState) cityState = savedPayload.cityState;
      if (savedPayload.unlockedRadius) unlockedRadius = savedPayload.unlockedRadius;
      if (savedPayload.expeditions) expeditions = savedPayload.expeditions;
      if (savedPayload.quests) quests = savedPayload.quests;
      initCitizens();
      updateCityLogic();
    },
    setWalletOra: function(amount) {
      cityState.ora = Number(amount) || 0;
      const el = document.getElementById('hud-colony-ora');
      if (el) el.innerText = cityState.ora;
    },
    onBurn: function(callback) {
      onBurnCallback = callback;
    },
    onSave: function(callback) {
      onSaveCallback = callback;
    },
    triggerResize: function() {
      resize();
    }
  };

  return {
    init: function() {
      canvas = document.getElementById('colonyCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      initWorld();
      resize();
      setupEvents();
      render();
    },
    selectBuild,
    expandMapPrompt,
    resetCamera,
    closeSheet,
    instantFinish,
    repairBuilding,
    triggerBanditRaid,
    upgradeSelectedBuilding,
    demolishSelectedBuilding,
    startMoveMode,
    startMoveSelected,
    toggleDayNight,
    toggleReportModal,
    toggleQuestModal,
    toggleMarketModal,
    toggleExpeditionModal,
    startExpedition,
    toggleVisitMode,
    leaveEnergyUpvote,
    buyMaterial,
    cycleWeather,
    claimQuest
  };
})();