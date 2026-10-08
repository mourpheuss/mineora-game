// ================= ALP KOLONİSİ İZOMETRİK ŞEHİR & İNŞAAT MOTORU (colony.js) =================
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
    },
    playBuild: () => { playTone(220, 'triangle', 0.12, 0.2); setTimeout(() => playTone(330, 'triangle', 0.18, 0.15), 60); },
    playHarvest: () => { playTone(523.25, 'sine', 0.1, 0.2); setTimeout(() => playTone(659.25, 'sine', 0.15, 0.2), 70); },
    playDemolish: () => playTone(130, 'sawtooth', 0.22, 0.2),
    playClick: () => playTone(400, 'sine', 0.05, 0.08)
  };
})();
window.ColonyAudio = ColonyAudio;

const ColonyEngine = (function() {
  let canvas, ctx;
  let isEngineStarted = false;
  const TILE_W = 100, TILE_H = 50, MAX_SIZE = 18;
  let unlockedRadius = 6, isNightMode = false;

  let camera = { x: 0, y: 0, zoom: 1.0, isDragging: false, dragStartX: 0, dragStartY: 0 };
  let activeBuildType = null;
  let grid = {};

  let cityState = {
    wood: 40, stone: 25, emerald: 15
  };

  function initWorld() {
    grid = {};
    for (let x = 0; x < MAX_SIZE; x++) {
      for (let y = 0; y < MAX_SIZE; y++) {
        let terrain = 'grass';
        if (x === 0 || y === 0) terrain = 'mountain_rock';
        else if ((x >= 8 && x <= 11) && (y >= 8 && y <= 11)) terrain = 'lake_water';
        else if ((x >= 7 && x <= 12) && (y >= 7 && y <= 12)) terrain = 'shore_sand';

        const dist = Math.max(Math.abs(x - 5), Math.abs(y - 5));
        grid[x + '_' + y] = {
          x: x, y: y, terrain: terrain, hasRoad: false, building: null,
          isLocked: dist > unlockedRadius
        };
      }
    }

    const initialRoads = [{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:5,y:3},{x:5,y:4},{x:5,y:5}];
    initialRoads.forEach(r => { if (grid[r.x + '_' + r.y]) grid[r.x + '_' + r.y].hasRoad = true; });

    grid["5_5"].building = { type: 'hq', name: "Vadi Karargahı" };
    grid["4_3"].building = { type: 'house', name: "Alp Evi" };
    grid["5_3"].building = { type: 'generator', name: "Buhar Fırını" };

    updateCityLogic();
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement || document.body;
    let w = parent.clientWidth || 800;
    let h = parent.clientHeight || 650;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
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
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('hud-colony-wood', cityState.wood + " 🪵");
    setTxt('hud-colony-stone', cityState.stone + " 🧱");
    setTxt('hud-colony-emerald', cityState.emerald + " 💎");
  }

  function render() {
    const sec = document.getElementById('sec-colony');
    if (!ctx || !canvas || !sec || sec.classList.contains('hidden')) return;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    ctx.clearRect(0, 0, w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, '#040711');
    sky.addColorStop(1, '#0b1329');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const sorted = Object.values(grid).sort((a, b) => (a.x + a.y) - (b.x + b.y));
    sorted.forEach(tile => {
      let col = '#22543d';
      if (tile.terrain === 'lake_water') col = '#0284c7';
      else if (tile.terrain === 'mountain_rock') col = '#475569';
      else if (tile.terrain === 'shore_sand') col = '#d97706';
      
      const pos = isoToScreen(tile.x, tile.y);
      const wT = TILE_W * camera.zoom, hT = TILE_H * camera.zoom;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y - hT / 2); ctx.lineTo(pos.x + wT / 2, pos.y); ctx.lineTo(pos.x, pos.y + hT / 2); ctx.lineTo(pos.x - wT / 2, pos.y);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();

      if (tile.hasRoad) {
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 4 * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }

      if (tile.building) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.fillStyle = tile.building.type === 'hq' ? '#f59e0b' : (tile.building.type === 'generator' ? '#ef4444' : '#cbd5e1');
        ctx.fillRect(-12 * camera.zoom, -20 * camera.zoom, 24 * camera.zoom, 20 * camera.zoom);
        ctx.restore();
      }
    });

    requestAnimationFrame(render);
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
    });
    window.addEventListener('mouseup', () => { camera.isDragging = false; });

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const coord = screenToIso(e.clientX - rect.left, e.clientY - rect.top);
      const tile = grid[coord.x + '_' + coord.y];
      if (!tile) return;

      if (activeBuildType === 'demolish') {
        if (tile.building && tile.building.type === 'hq') { showToast("Ana Karargah yıkılamaz!", "warning"); return; }
        tile.building = null;
        tile.hasRoad = false;
        ColonyAudio.playDemolish();
        showToast("Bölge temizlendi.");
        return;
      }

      if (activeBuildType === 'road') {
        tile.hasRoad = true;
        ColonyAudio.playBuild();
        return;
      }

      if (activeBuildType && !tile.building) {
        tile.building = { type: activeBuildType, name: activeBuildType };
        ColonyAudio.playBuild();
        showToast("İnşaat tamamlandı!");
        return;
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
        isEngineStarted = true;
      }
      resize();
      render();
    },
    selectBuild: function(type) {
      activeBuildType = (activeBuildType === type) ? null : type;
      document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('ring-2', 'ring-cyan-400', 'bg-slate-700'));
      if (activeBuildType) {
        const btn = document.getElementById('btn-build-' + activeBuildType);
        if (btn) btn.classList.add('ring-2', 'ring-cyan-400', 'bg-slate-700');
        showToast("Seçildi: " + activeBuildType);
      }
    },
    resetCamera: function() {
      resize();
    }
  };
})();
window.ColonyEngine = ColonyEngine;
