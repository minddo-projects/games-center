(() => {
  // Bun colors come from the skin picked in the Pixel Party shop (classic if played standalone).
  const SKIN = (window.PixelParty && window.PixelParty.skin()) || {
    shape: "M 18 220 C 20 130, 72 22, 135 22 C 198 22, 250 130, 252 220 L 252 237 L 18 237 Z",
    top: 22,
    stops: ["#ffffff", "#fff6c2", "#ffe566", "#f5c842"],
    outline: "#e6b422",
  };
  // The player's body: the skin's shape in the same 270x255 space as BUN_PATH.
  const PLAYER_PATH = new Path2D(SKIN.shape);
  const drawSkinDecor = () => window.PixelParty && window.PixelParty.drawDecor(ctx, SKIN);
  // Tokens go into the Pixel Party wallet; does nothing if the game is opened on its own.
  const earnTokens = (n) => window.PixelParty && window.PixelParty.earn(n);
  // Sky colors come from the theme picked in the Pixel Party shop (sunset if played standalone).
  const THEME = (window.PixelParty && window.PixelParty.theme()) || {
    sky: [[0, "#ff8a2b"], [0.55, "#ffc857"], [1, "#fff3b0"]],
    cloud: "rgba(255, 255, 255, 0.85)",
    grid: "rgba(255, 255, 255, 0.22)",
  };
  function themeSky(y0, y1) {
    if (window.PixelParty) return window.PixelParty.skyGradient(ctx, y0, y1, THEME);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    for (const [at, color] of THEME.sky) g.addColorStop(at, color);
    return g;
  }
  const drawThemeStars = (w, h) => THEME.stars && window.PixelParty.drawStars(ctx, w, h, animTime);
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const TILE = 48;
  // Logical game resolution (drawing coordinates). The canvas bitmap is scaled up separately.
  const VIEW_W = 20 * TILE;
  const VIEW_H = 11 * TILE;
  let COLS = 28;
  let ROWS = 15;
  let LEVEL_W = COLS * TILE;
  let LEVEL_H = ROWS * TILE;

  function syncCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || VIEW_W;
    const cssH = canvas.clientHeight || VIEW_H;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    // Map logical game pixels onto the sharp HiDPI backing store.
    ctx.setTransform(bw / VIEW_W, 0, 0, bh / VIEW_H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  syncCanvasResolution();
  window.addEventListener("resize", syncCanvasResolution);

  const FONT = '"Press Start 2P", monospace';
  const PLAYER_HALF = 15;
  const PLAYER_VISUAL = 44;
  // Multipliers on the base zombie. Spitters keep their distance and shoot.
  const ZOMBIE_KINDS = {
    normal: { half: 16, hp: 1, dmg: 1, speed: 1 },
    brute: { half: 22, hp: 3, dmg: 1.5, speed: 0.72 },
    spitter: { half: 16, hp: 0.8, dmg: 0.7, speed: 0.9 },
  };
  const SPITTER_NEAR = TILE * 4;
  const SPITTER_FAR = TILE * 6.5;
  const SPITTER_RANGE = TILE * 9;
  const SPIT_WINDUP = 0.4;
  const WALL_FACE = 12;
  const INVULN_TIME = 0.6;
  const DEATH_SPIN_TIME = 0.9;
  const FADE_TIME = 0.42;
  const BEST_KEY = "bun-survivor-best-round";

  const BASE_STATS = {
    maxHp: 100,
    speed: 230,
    damage: 1,
    fireRate: 4,
    bulletSpeed: 680,
    bulletSize: 6,
    multishot: 1,
    pierce: 0,
    armor: 0,
    regen: 0,
    knockback: 220,
  };

  // --- 8-bit SFX (Web Audio square/triangle beeps) ---
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playTone({ freq = 440, freqEnd = null, type = "square", dur = 0.08, vol = 0.08, delay = 0 }) {
    const ctxA = ensureAudio();
    if (!ctxA) return;
    const t0 = ctxA.currentTime + delay;
    const osc = ctxA.createOscillator();
    const gain = ctxA.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctxA.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playNoise({ dur = 0.08, vol = 0.05, delay = 0 }) {
    const ctxA = ensureAudio();
    if (!ctxA) return;
    const t0 = ctxA.currentTime + delay;
    const len = Math.floor(ctxA.sampleRate * dur);
    const buffer = ctxA.createBuffer(1, len, ctxA.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctxA.createBufferSource();
    const gain = ctxA.createGain();
    const filter = ctxA.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    src.buffer = buffer;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctxA.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const sfx = {
    shoot() {
      playTone({ freq: 920, freqEnd: 460, type: "square", dur: 0.05, vol: 0.03 });
    },
    hit() {
      playTone({ freq: 300, freqEnd: 170, type: "triangle", dur: 0.06, vol: 0.06 });
    },
    wall() {
      playNoise({ dur: 0.03, vol: 0.015 });
    },
    zombieDie() {
      playTone({ freq: 220, freqEnd: 90, type: "square", dur: 0.12, vol: 0.08 });
      playNoise({ dur: 0.06, vol: 0.04, delay: 0.02 });
    },
    spawn() {
      playTone({ freq: 130, freqEnd: 210, type: "triangle", dur: 0.14, vol: 0.04 });
    },
    spit() {
      playTone({ freq: 560, freqEnd: 240, type: "triangle", dur: 0.12, vol: 0.05 });
      playNoise({ dur: 0.04, vol: 0.02 });
    },
    hurt() {
      playTone({ freq: 320, freqEnd: 140, type: "sawtooth", dur: 0.18, vol: 0.07 });
    },
    roundClear() {
      const notes = [523, 659, 784, 1047, 784, 1047];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.1, vol: 0.07, delay: i * 0.09 });
      });
    },
    pick() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.09, vol: 0.07, delay: i * 0.07 });
      });
    },
    hover() {
      playTone({ freq: 660, type: "square", dur: 0.03, vol: 0.025 });
    },
    death() {
      const notes = [440, 392, 349, 294, 220];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.14, vol: 0.07, delay: i * 0.11 });
      });
    },
  };

  // Original looping chiptune (not from any commercial game).
  // A slow, creeping D minor survival theme: a throbbing low bass that keeps
  // inching up a half step, a thin wavering melody, and a heartbeat kick.
  const NOTE_FREQ = {
    A1: 55.0, Bb1: 58.27, "C#2": 69.3, D2: 73.42, Eb2: 77.78,
    A3: 220.0, Bb3: 233.08, "C#4": 277.18, D4: 293.66, Eb4: 311.13,
    E4: 329.63, F4: 349.23, "G#4": 415.3, A4: 440.0,
  };
  const MUSIC_STEP = 0.16;
  // Long held notes that slide downward, with the tense G# (a tritone above D) as the peak.
  const MUSIC_MELODY = [
    "D4", null, null, null, null, null, "F4", null,
    "E4", null, null, null, "Eb4", null, null, null,
    "D4", null, null, null, null, null, "A4", null,
    "G#4", null, null, null, null, null, null, null,

    "F4", null, null, null, "E4", null, null, null,
    "D4", null, null, null, "C#4", null, null, null,
    "D4", null, "F4", null, "E4", null, "Bb3", null,
    "A3", null, null, null, null, null, null, null,
  ];
  const MUSIC_BASS = [
    "D2", null, "D2", "D2", null, "D2", "Eb2", null,
    "D2", null, "D2", "D2", null, "D2", "Eb2", null,
    "D2", null, "D2", "D2", null, "D2", "Eb2", null,
    "D2", null, "D2", "D2", null, "Eb2", "D2", "C#2",

    "Bb1", null, "Bb1", "Bb1", null, "Bb1", "A1", null,
    "Bb1", null, "Bb1", "Bb1", null, "Bb1", "A1", null,
    "A1", null, "A1", "A1", null, "A1", "Bb1", null,
    "A1", null, "A1", "A1", "C#2", null, "C#2", null,
  ];

  let musicGain = null;
  let musicPlaying = false;
  let musicTimer = null;
  let musicStepIndex = 0;

  function playMusicNote(freq, type, dur, vol, freqEnd = null) {
    const ctxA = ensureAudio();
    if (!ctxA || !musicGain || !freq) return;
    const t0 = ctxA.currentTime;
    const osc = ctxA.createOscillator();
    const gain = ctxA.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function musicTick() {
    if (!musicPlaying) return;
    const ctxA = ensureAudio();
    if (!ctxA) return;

    const m = MUSIC_MELODY[musicStepIndex % MUSIC_MELODY.length];
    const b = MUSIC_BASS[musicStepIndex % MUSIC_BASS.length];
    if (m) {
      // Two slightly detuned voices give the melody an uneasy waver.
      const f = NOTE_FREQ[m];
      playMusicNote(f, "triangle", MUSIC_STEP * 3.6, 0.07);
      playMusicNote(f * 1.006, "triangle", MUSIC_STEP * 3.6, 0.04);
    }
    if (b) {
      // Gritty square growl plus a triangle an octave up so small speakers still carry it.
      const f = NOTE_FREQ[b];
      playMusicNote(f, "square", MUSIC_STEP * 0.8, 0.035);
      playMusicNote(f * 2, "triangle", MUSIC_STEP * 0.8, 0.045);
    }
    // Heartbeat kick: thump-thump, then a pause.
    const beat = musicStepIndex % 16;
    if (beat === 0 || beat === 2) {
      playMusicNote(130, "sine", 0.16, beat === 0 ? 0.16 : 0.11, 42);
    }
    // Faint ticking on the off-beats.
    if (musicStepIndex % 4 === 2) playNoise({ dur: 0.015, vol: 0.006 });

    musicStepIndex += 1;
    musicTimer = setTimeout(musicTick, MUSIC_STEP * 1000);
  }

  function startMusic() {
    const ctxA = ensureAudio();
    if (!ctxA) return;
    if (!musicGain) {
      musicGain = ctxA.createGain();
      musicGain.gain.value = 0.5;
      musicGain.connect(ctxA.destination);
    }
    if (musicPlaying) return;
    musicPlaying = true;
    musicStepIndex = 0;
    musicTick();
  }

  function stopMusic() {
    musicPlaying = false;
    if (musicTimer) {
      clearTimeout(musicTimer);
      musicTimer = null;
    }
  }

  // Arena is stored as arena.png: one pixel per tile, one RGB color per type.
  // . void (outside the arena)  _ floor  # wall block  G pipe pillar  P player spawn
  const ARENA_IMAGE_URL = "arena.png";
  // Same-origin data URL fallback when canvas would be tainted (file:// / odd embeds).
  const ARENA_IMAGE_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAPCAIAAAB4LTj2AAAAYElEQVR42mNgQAZb/pOPsAOwHHkAh7kUmIjDXAwTRUQqiDEITRmSudjcCA8pAu7CpRGrTiKDApdeBmL0w71JTLAQayhU9f8AYmOMfi6lQpjSIPZpkk5plaNolfepWkoBACAf3NCohb20AAAAAElFTkSuQmCC";
  const ARENA_PIXEL_TO_CHAR = {
    "0,0,0": ".",
    "255,255,255": "_",
    "0,180,255": "#",
    "20,20,120": "G",
    "0,255,80": "P",
  };

  /** @type {string[]} One character per tile: . _ # G */
  let tiles = [];
  /** @type {{c:number,r:number}[]} */
  let floorTiles = [];
  let spawn = { x: 0, y: 0 };
  let flowDist = new Int32Array(0);
  let flowFromTile = -1;

  function applyArenaPixels(data, width, height) {
    COLS = width;
    ROWS = height;
    LEVEL_W = COLS * TILE;
    LEVEL_H = ROWS * TILE;
    tiles = [];
    floorTiles = [];
    let foundSpawn = false;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const i = (r * width + c) * 4;
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        let ch = ARENA_PIXEL_TO_CHAR[key] || ".";
        if (ch === "P") {
          spawn = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
          foundSpawn = true;
          ch = "_";
        }
        tiles.push(ch);
        if (ch === "_") floorTiles.push({ c, r });
      }
    }

    // No P pixel: start on the floor tile closest to the middle of the arena.
    if (!foundSpawn && floorTiles.length) {
      const mid = { c: COLS / 2, r: ROWS / 2 };
      const best = floorTiles.reduce((a, b) =>
        Math.hypot(a.c - mid.c, a.r - mid.r) <= Math.hypot(b.c - mid.c, b.r - mid.r) ? a : b
      );
      spawn = { x: best.c * TILE + TILE / 2, y: best.r * TILE + TILE / 2 };
    }

    flowDist = new Int32Array(COLS * ROWS).fill(-1);
    flowFromTile = -1;
  }

  async function decodeArenaBitmap(source) {
    // Fetch/blob/data-URL bitmaps are origin-clean, so getImageData will not taint.
    const bitmap = await createImageBitmap(source);
    const off = document.createElement("canvas");
    off.width = bitmap.width;
    off.height = bitmap.height;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
    applyArenaPixels(data, width, height);
  }

  async function loadArenaFromImage(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await decodeArenaBitmap(blob);
    } catch (err) {
      console.warn("arena.png fetch failed, using embedded arena data URL", err);
      const res = await fetch(ARENA_IMAGE_DATA_URL);
      const blob = await res.blob();
      await decodeArenaBitmap(blob);
    }
  }

  function tileAt(c, r) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return ".";
    return tiles[r * COLS + c];
  }

  function isSolid(c, r) {
    return tileAt(c, r) !== "_";
  }

  function solidAtPoint(x, y) {
    return isSolid(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  function boxHitsSolid(x, y, half) {
    const c0 = Math.floor((x - half) / TILE);
    const c1 = Math.floor((x + half - 0.01) / TILE);
    const r0 = Math.floor((y - half) / TILE);
    const r1 = Math.floor((y + half - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (isSolid(c, r)) return true;
      }
    }
    return false;
  }

  // Axis-separated movement so entities slide along walls. Entities use center x/y and a half size.
  function moveEntity(e, dx, dy) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE * 0.4)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx) {
        const nx = e.x + sx;
        if (!boxHitsSolid(nx, e.y, e.half)) {
          e.x = nx;
        } else {
          const snapped = sx > 0
            ? Math.floor((nx + e.half) / TILE) * TILE - e.half - 0.01
            : (Math.floor((nx - e.half) / TILE) + 1) * TILE + e.half + 0.01;
          if (!boxHitsSolid(snapped, e.y, e.half)) e.x = snapped;
        }
      }
      if (sy) {
        const ny = e.y + sy;
        if (!boxHitsSolid(e.x, ny, e.half)) {
          e.y = ny;
        } else {
          const snapped = sy > 0
            ? Math.floor((ny + e.half) / TILE) * TILE - e.half - 0.01
            : (Math.floor((ny - e.half) / TILE) + 1) * TILE + e.half + 0.01;
          if (!boxHitsSolid(e.x, snapped, e.half)) e.y = snapped;
        }
      }
    }
  }

  // Breadth-first "distance to the player" map so zombies can walk around pillars.
  function rebuildFlowField() {
    const pc = Math.floor(player.x / TILE);
    const pr = Math.floor(player.y / TILE);
    const from = pr * COLS + pc;
    if (from === flowFromTile) return;
    flowFromTile = from;
    flowDist.fill(-1);
    if (isSolid(pc, pr)) return;

    const queue = [from];
    flowDist[from] = 0;
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const c = idx % COLS;
      const r = (idx - c) / COLS;
      const d = flowDist[idx] + 1;
      const next = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of next) {
        if (isSolid(nc, nr)) continue;
        const ni = nr * COLS + nc;
        if (flowDist[ni] !== -1) continue;
        flowDist[ni] = d;
        queue.push(ni);
      }
    }
  }

  function zombieTarget(z) {
    const c = Math.floor(z.x / TILE);
    const r = Math.floor(z.y / TILE);
    const d = isSolid(c, r) ? -1 : flowDist[r * COLS + c];
    // Close by (or lost): walk straight at the player.
    if (d < 0 || d <= 1) return { x: player.x, y: player.y };

    let best = d;
    let target = null;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (isSolid(nc, nr)) continue;
        // No cutting diagonally across wall corners.
        if (dc && dr && (isSolid(c + dc, r) || isSolid(c, r + dr))) continue;
        const nd = flowDist[nr * COLS + nc];
        if (nd >= 0 && nd < best) {
          best = nd;
          target = { x: nc * TILE + TILE / 2, y: nr * TILE + TILE / 2 };
        }
      }
    }
    return target || { x: player.x, y: player.y };
  }

  // --- Game state ---
  const keys = new Set();
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false };
  let state = "loading";
  let lastTime = 0;
  let animTime = 0;
  let cameraX = 0;
  let cameraY = 0;
  let shake = 0;
  let fadeAlpha = 0;
  let deathTimer = 0;
  let deathPhase = "";
  let stateTimer = 0;
  let banner = null;

  let stats = { ...BASE_STATS };
  let round = 1;
  let kills = 0;
  let bestRound = 0;
  let toSpawn = 0;
  let spawnTimer = 0;
  let buffChoices = [];
  let hoveredCard = -1;

  /** @type {any[]} */ let zombies = [];
  /** @type {any[]} */ let spawnMarkers = [];
  /** @type {any[]} */ let bullets = [];
  /** @type {any[]} */ let enemyBullets = [];
  /** @type {any[]} */ let corpses = [];
  /** @type {any[]} */ let dustParticles = [];
  /** @type {any[]} */ let sparkles = [];
  /** @type {any[]} */ let rainbowSparkles = [];
  let walkDustTimer = 0;

  const player = {
    x: 0,
    y: 0,
    half: PLAYER_HALF,
    hp: BASE_STATS.maxHp,
    kx: 0,
    ky: 0,
    aim: 0,
    moving: false,
    walkT: 0,
    invuln: 0,
    fireCooldown: 0,
    muzzle: 0,
    deathAngle: 0,
    deathScale: 1,
  };

  try {
    bestRound = Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch (err) {
    bestRound = 0;
  }

  function saveBest() {
    if (round <= bestRound) return;
    bestRound = round;
    try {
      localStorage.setItem(BEST_KEY, String(bestRound));
    } catch (err) {
      // Storage can be blocked; the best round just won't persist.
    }
  }

  const BUN_PATH = new Path2D(`
    M 18 220
    C 20 130, 72 22, 135 22
    C 198 22, 250 130, 252 220
    L 252 237
    L 18 237
    Z
  `);

  // --- Buffs ---
  const BUFFS = [
    {
      id: "hp", name: "EXTRA DOUGH", desc: "+25 max HP and heal 25 HP.",
      apply() { stats.maxHp += 25; player.hp = Math.min(stats.maxHp, player.hp + 25); },
    },
    {
      id: "dmg", name: "HOT CRUST", desc: "Bullets deal 25% more damage.",
      apply() { stats.damage *= 1.25; },
    },
    {
      id: "rate", name: "QUICK HANDS", desc: "Shoot 20% faster.",
      apply() { stats.fireRate *= 1.2; },
    },
    {
      id: "speed", name: "SWIFT FEET", desc: "Move 12% faster.",
      apply() { stats.speed *= 1.12; },
    },
    {
      id: "multi", name: "TWIN SHOT", desc: "Fire 1 extra bullet each shot.",
      available: () => stats.multishot < 5,
      apply() { stats.multishot += 1; },
    },
    {
      id: "pierce", name: "SESAME SPIKE", desc: "Bullets pass through 1 more zombie.",
      available: () => stats.pierce < 4,
      apply() { stats.pierce += 1; },
    },
    {
      id: "velocity", name: "LONG SHOT", desc: "Bullets fly 20% faster.",
      apply() { stats.bulletSpeed *= 1.2; },
    },
    {
      id: "size", name: "BIG CRUMBS", desc: "Bigger bullets and 10% more damage.",
      available: () => stats.bulletSize < 14,
      apply() { stats.bulletSize *= 1.3; stats.damage *= 1.1; },
    },
    {
      id: "armor", name: "BUBBLE SHIELD", desc: "Take 12% less damage from zombies.",
      available: () => stats.armor < 0.6,
      apply() { stats.armor = Math.min(0.6, stats.armor + 0.12); },
    },
    {
      id: "regen", name: "HONEY GLAZE", desc: "Heal 1.5 HP every second.",
      apply() { stats.regen += 1.5; },
    },
    {
      id: "heal", name: "FRESH BAKE", desc: "Heal back to full HP.",
      available: () => player.hp < stats.maxHp * 0.8,
      apply() { player.hp = stats.maxHp; },
    },
    {
      id: "knock", name: "BIG PUSH", desc: "Bullets knock zombies back further.",
      apply() { stats.knockback *= 1.4; },
    },
  ];

  function rollBuffChoices() {
    const pool = BUFFS.filter((b) => !b.available || b.available());
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  function pickBuff(index) {
    const buff = buffChoices[index];
    if (!buff || state !== "buff" || stateTimer > 0) return;
    buff.apply();
    spawnRainbowSparkles(player.x, player.y - 8);
    sfx.pick();
    buffChoices = [];
    hoveredCard = -1;
    startRound(round + 1);
  }

  // --- Rounds ---
  function zombieCountForRound(n) {
    return 4 + n * 2;
  }

  function rollZombieKind() {
    const roll = Math.random();
    if (round >= 2 && roll < Math.min(0.35, 0.12 + round * 0.03)) return "spitter";
    if (round >= 3 && roll > 0.82) return "brute";
    return "normal";
  }

  function makeZombie(x, y, kind) {
    // Each round zombies get a little tougher, hit harder, and walk faster.
    const hpScale = Math.pow(1.18, round - 1);
    const dmgScale = Math.pow(1.12, round - 1);
    const speed = Math.min(150, 72 + round * 5) * (0.9 + Math.random() * 0.2);
    const k = ZOMBIE_KINDS[kind];
    const hp = 3 * hpScale * k.hp;
    return {
      x,
      y,
      half: k.half,
      kind,
      hp,
      maxHp: hp,
      dmg: 10 * dmgScale * k.dmg,
      shotDmg: 8 * dmgScale,
      speed: speed * k.speed,
      kx: 0,
      ky: 0,
      flash: 0,
      face: 0,
      walkT: Math.random() * 10,
      // Spitter-only state.
      los: false,
      shootTimer: 1 + Math.random() * 1.5,
      windup: 0,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1.5 + Math.random() * 2,
    };
  }

  function startRound(n) {
    round = n;
    toSpawn = zombieCountForRound(n);
    spawnTimer = 1.0;
    spawnMarkers = [];
    bullets = [];
    enemyBullets = [];
    state = "playing";
    showBanner(`ROUND ${n}`, n === 1 ? "DEFEAT EVERY ZOMBIE" : "THEY'RE TOUGHER NOW", 1.8);
  }

  function pickSpawnPoint() {
    for (let tries = 0; tries < 60; tries++) {
      const t = floorTiles[Math.floor(Math.random() * floorTiles.length)];
      const x = t.c * TILE + TILE / 2;
      const y = t.r * TILE + TILE / 2;
      if (Math.hypot(x - player.x, y - player.y) < TILE * 5) continue;
      if (flowDist[t.r * COLS + t.c] < 0) continue;
      if (spawnMarkers.some((m) => Math.hypot(m.x - x, m.y - y) < TILE)) continue;
      return { x, y };
    }
    const t = floorTiles[Math.floor(Math.random() * floorTiles.length)];
    return { x: t.c * TILE + TILE / 2, y: t.r * TILE + TILE / 2 };
  }

  function updateSpawner(dt) {
    const maxAlive = 6 + round * 2;
    spawnTimer -= dt;
    if (toSpawn > 0 && spawnTimer <= 0 && zombies.length + spawnMarkers.length < maxAlive) {
      const p = pickSpawnPoint();
      spawnMarkers.push({ x: p.x, y: p.y, t: 0.9, max: 0.9, kind: rollZombieKind() });
      toSpawn -= 1;
      spawnTimer = Math.max(0.3, 0.85 - round * 0.05);
    }

    spawnMarkers = spawnMarkers.filter((m) => {
      m.t -= dt;
      if (m.t > 0) return true;
      zombies.push(makeZombie(m.x, m.y, m.kind));
      spawnDustRing(m.x, m.y + 12);
      sfx.spawn();
      return false;
    });

    if (toSpawn === 0 && spawnMarkers.length === 0 && zombies.length === 0) {
      state = "cleared";
      earnTokens(5);
      stateTimer = 1.4;
      mouse.down = false;
      saveBest();
      // Any spit still in the air pops harmlessly.
      for (const b of enemyBullets) spawnPuff(b.x, b.y, 5);
      enemyBullets = [];
      showBanner("ROUND CLEAR!", "", 1.4);
      sfx.roundClear();
    }
  }

  function showBanner(text, sub, dur) {
    banner = { text, sub, t: dur, dur };
  }

  function startGame() {
    stats = { ...BASE_STATS };
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = stats.maxHp;
    player.kx = 0;
    player.ky = 0;
    player.invuln = 0;
    player.fireCooldown = 0;
    player.deathAngle = 0;
    player.deathScale = 1;
    kills = 0;
    zombies = [];
    enemyBullets = [];
    corpses = [];
    dustParticles = [];
    sparkles = [];
    rainbowSparkles = [];
    buffChoices = [];
    fadeAlpha = 0;
    deathPhase = "";
    shake = 0;
    flowFromTile = -1;
    rebuildFlowField();
    snapCamera();
    startRound(1);
    lastTime = performance.now();
    startMusic();
  }

  // --- Player ---
  function keyDown(...codes) {
    return codes.some((c) => keys.has(c));
  }

  function mouseWorld() {
    return { x: mouse.x + cameraX, y: mouse.y + cameraY };
  }

  function updatePlayer(dt, canShoot) {
    let ix = 0;
    let iy = 0;
    if (keyDown("KeyA", "ArrowLeft")) ix -= 1;
    if (keyDown("KeyD", "ArrowRight")) ix += 1;
    if (keyDown("KeyW", "ArrowUp")) iy -= 1;
    if (keyDown("KeyS", "ArrowDown")) iy += 1;
    const len = Math.hypot(ix, iy) || 1;
    const vx = (ix / len) * stats.speed;
    const vy = (iy / len) * stats.speed;

    const knockDecay = Math.exp(-dt * 10);
    player.kx *= knockDecay;
    player.ky *= knockDecay;
    moveEntity(player, (vx + player.kx) * dt, (vy + player.ky) * dt);

    player.moving = ix !== 0 || iy !== 0;
    if (player.moving) player.walkT += dt * 12;

    const m = mouseWorld();
    player.aim = Math.atan2(m.y - (player.y - 2), m.x - player.x);

    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.muzzle > 0) player.muzzle = Math.max(0, player.muzzle - dt);
    if (stats.regen > 0) player.hp = Math.min(stats.maxHp, player.hp + stats.regen * dt);

    player.fireCooldown -= dt;
    if (canShoot && mouse.down && player.fireCooldown <= 0) {
      shoot();
      player.fireCooldown = 1 / stats.fireRate;
    }

    // Walking dust trail behind the player.
    walkDustTimer -= dt;
    if (player.moving && walkDustTimer <= 0) {
      walkDustTimer = 0.06;
      dustParticles.push({
        x: player.x - (ix / len) * 10 + (Math.random() - 0.5) * 8,
        y: player.y + 16,
        vx: -(ix / len) * (20 + Math.random() * 30),
        vy: -10 - Math.random() * 25,
        life: 0.28 + Math.random() * 0.18,
        size: 2.5 + Math.random() * 3.5,
      });
    }
  }

  function shoot() {
    const n = stats.multishot;
    const spread = 0.13;
    const tipX = player.x + Math.cos(player.aim) * 32;
    const tipY = player.y - 2 + Math.sin(player.aim) * 32;
    for (let i = 0; i < n; i++) {
      const a = player.aim + (i - (n - 1) / 2) * spread;
      bullets.push({
        x: tipX,
        y: tipY,
        vx: Math.cos(a) * stats.bulletSpeed,
        vy: Math.sin(a) * stats.bulletSpeed,
        r: stats.bulletSize,
        dmg: stats.damage,
        pierce: stats.pierce,
        hit: new Set(),
        life: 1.6,
      });
    }
    player.muzzle = 0.06;
    sfx.shoot();
  }

  function hurtPlayer(z) {
    player.hp -= z.dmg * (1 - stats.armor);
    player.invuln = INVULN_TIME;
    const dx = player.x - z.x;
    const dy = player.y - z.y;
    const d = Math.hypot(dx, dy) || 1;
    player.kx = (dx / d) * 520;
    player.ky = (dy / d) * 520;
    z.kx = (-dx / d) * 160;
    z.ky = (-dy / d) * 160;
    shake = 9;
    spawnBurst(player.x, player.y, 10);
    sfx.hurt();
    if (player.hp <= 0) {
      player.hp = 0;
      beginDeath();
    }
  }

  function beginDeath() {
    state = "dying";
    deathPhase = "spin";
    deathTimer = DEATH_SPIN_TIME;
    mouse.down = false;
    saveBest();
    stopMusic();
    sfx.death();
  }

  function updateDeath(dt) {
    if (deathPhase === "spin") {
      deathTimer -= dt;
      player.deathAngle += dt * 11;
      player.deathScale = Math.max(0, deathTimer / DEATH_SPIN_TIME);
      if (deathTimer <= 0) {
        deathPhase = "fadeOut";
        deathTimer = FADE_TIME;
      }
    } else if (deathPhase === "fadeOut") {
      deathTimer -= dt;
      fadeAlpha = Math.min(1, 1 - Math.max(0, deathTimer) / FADE_TIME);
      if (deathTimer <= 0) {
        fadeAlpha = 1;
        deathPhase = "";
        state = "over";
      }
    }
  }

  // --- Zombies ---
  function hasLineOfSight(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (solidAtPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  function normalize(x, y) {
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }

  function chaseDirection(z) {
    const t = zombieTarget(z);
    return normalize(t.x - z.x, t.y - z.y);
  }

  // Spitters close in until they can see the player, back off when too close,
  // and otherwise circle around the player at a comfortable distance.
  function spitterDirection(z, dt, dist, ux, uy) {
    z.strafeTimer -= dt;
    if (z.strafeTimer <= 0) {
      z.strafeDir *= -1;
      z.strafeTimer = 1.5 + Math.random() * 2;
    }
    const sx = -uy * z.strafeDir;
    const sy = ux * z.strafeDir;
    if (!z.los || dist > SPITTER_FAR) return chaseDirection(z);
    if (dist < SPITTER_NEAR) return normalize(-ux + sx * 0.4, -uy + sy * 0.4);
    return { x: sx * 0.55, y: sy * 0.55 };
  }

  function updateSpitterAttack(z, dt, dist, ux, uy) {
    if (z.windup > 0) {
      z.windup -= dt;
      if (z.windup <= 0) {
        const speed = Math.min(360, 240 + round * 10);
        enemyBullets.push({
          x: z.x + ux * 20,
          y: z.y - 4 + uy * 20,
          vx: ux * speed,
          vy: uy * speed,
          r: 7,
          dmg: z.shotDmg,
          life: 3,
        });
        z.shootTimer = Math.max(1.1, 2.2 - round * 0.08) * (0.8 + Math.random() * 0.4);
        sfx.spit();
      }
      return;
    }
    z.shootTimer -= dt;
    if (z.shootTimer <= 0 && z.los && dist < SPITTER_RANGE) z.windup = SPIT_WINDUP;
  }

  function updateZombies(dt) {
    for (const z of zombies) {
      if (z.flash > 0) z.flash = Math.max(0, z.flash - dt);
      const toX = player.x - z.x;
      const toY = player.y - z.y;
      const dist = Math.hypot(toX, toY) || 1;
      const ux = toX / dist;
      const uy = toY / dist;

      let dir;
      if (z.kind === "spitter") {
        z.los = hasLineOfSight(z.x, z.y - 4, player.x, player.y - 2);
        dir = spitterDirection(z, dt, dist, ux, uy);
        // Plant their feet while winding up a shot.
        if (z.windup > 0) dir = { x: dir.x * 0.3, y: dir.y * 0.3 };
      } else {
        dir = chaseDirection(z);
      }

      const knockDecay = Math.exp(-dt * 8);
      z.kx *= knockDecay;
      z.ky *= knockDecay;
      const beforeX = z.x;
      const beforeY = z.y;
      const wantX = dir.x * z.speed * dt;
      const wantY = dir.y * z.speed * dt;
      moveEntity(z, wantX + z.kx * dt, wantY + z.ky * dt);
      // A spitter circling into a wall turns around.
      if (z.kind === "spitter" && Math.hypot(z.x - beforeX, z.y - beforeY) < Math.hypot(wantX, wantY) * 0.3) {
        z.strafeDir *= -1;
      }
      z.face = Math.atan2(toY, toX);
      z.walkT += dt * 9 * Math.hypot(dir.x, dir.y);

      if (z.kind === "spitter" && state === "playing") updateSpitterAttack(z, dt, dist, ux, uy);

      const touching =
        Math.abs(z.x - player.x) < z.half + player.half - 2 &&
        Math.abs(z.y - player.y) < z.half + player.half - 2;
      if (touching && player.invuln <= 0 && state === "playing") hurtPlayer(z);
    }

    // Keep the horde from stacking into one blob.
    for (let i = 0; i < zombies.length; i++) {
      for (let j = i + 1; j < zombies.length; j++) {
        const a = zombies[i];
        const b = zombies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = (a.half + b.half) * 0.9;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d === 0) continue;
        const push = (minD - d) / 2;
        moveEntity(a, (-dx / d) * push, (-dy / d) * push);
        moveEntity(b, (dx / d) * push, (dy / d) * push);
      }
    }
  }

  function killZombie(z, dirX, dirY) {
    zombies = zombies.filter((other) => other !== z);
    kills += 1;
    corpses.push({
      x: z.x,
      y: z.y,
      vx: dirX * 260,
      vy: dirY * 260,
      angle: 0,
      spin: (Math.random() > 0.5 ? 1 : -1) * 10,
      life: 0.55,
      max: 0.55,
      half: z.half,
      kind: z.kind,
      face: z.face,
    });
    spawnBurst(z.x, z.y, 14);
    shake = Math.max(shake, z.kind === "brute" ? 6 : 3);
    sfx.zombieDie();
  }

  // --- Bullets ---
  function updateBullets(dt) {
    const SUBSTEPS = 3;
    bullets = bullets.filter((b) => {
      b.life -= dt;
      if (b.life <= 0) return false;
      for (let s = 0; s < SUBSTEPS; s++) {
        b.x += (b.vx * dt) / SUBSTEPS;
        b.y += (b.vy * dt) / SUBSTEPS;
        if (solidAtPoint(b.x, b.y)) {
          spawnPuff(b.x - b.vx * 0.01, b.y - b.vy * 0.01, 5);
          sfx.wall();
          return false;
        }
        for (const z of zombies) {
          if (b.hit.has(z)) continue;
          if (Math.abs(z.x - b.x) > z.half + b.r || Math.abs(z.y - b.y) > z.half + b.r) continue;
          const speed = Math.hypot(b.vx, b.vy) || 1;
          const dirX = b.vx / speed;
          const dirY = b.vy / speed;
          b.hit.add(z);
          z.hp -= b.dmg;
          z.flash = 0.1;
          const knock = stats.knockback / (z.kind === "brute" ? 2.2 : 1);
          z.kx += dirX * knock;
          z.ky += dirY * knock;
          spawnHitSparkle(b.x, b.y);
          if (z.hp <= 0) killZombie(z, dirX, dirY);
          else sfx.hit();
          if (b.pierce > 0) {
            b.pierce -= 1;
          } else {
            return false;
          }
        }
      }
      return true;
    });
  }

  function updateEnemyBullets(dt) {
    const SUBSTEPS = 2;
    enemyBullets = enemyBullets.filter((b) => {
      b.life -= dt;
      if (b.life <= 0) return false;
      for (let s = 0; s < SUBSTEPS; s++) {
        b.x += (b.vx * dt) / SUBSTEPS;
        b.y += (b.vy * dt) / SUBSTEPS;
        if (solidAtPoint(b.x, b.y)) {
          spawnPuff(b.x, b.y, 5);
          return false;
        }
        const touching =
          Math.abs(player.x - b.x) < player.half + b.r &&
          Math.abs(player.y - b.y) < player.half + b.r;
        if (touching) {
          // While blinking after a hit the spit just splats.
          if (player.invuln <= 0 && state === "playing") hurtPlayer(b);
          else spawnPuff(b.x, b.y, 5);
          return false;
        }
      }
      return true;
    });
  }

  // --- Particles ---
  function spawnPuff(x, y, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 70;
      dustParticles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.2 + Math.random() * 0.15,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function spawnBurst(x, y, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 150;
      dustParticles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.35 + Math.random() * 0.25,
        size: 3 + Math.random() * 5,
      });
    }
  }

  function spawnDustRing(x, y) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      dustParticles.push({
        x, y,
        vx: Math.cos(a) * 110,
        vy: Math.sin(a) * 55,
        life: 0.35,
        size: 3 + Math.random() * 3,
      });
    }
  }

  function spawnHitSparkle(x, y) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 90;
      sparkles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.22 + Math.random() * 0.12,
        size: 2 + Math.random() * 2,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 10,
      });
    }
  }

  function spawnRainbowSparkles(x, y) {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 90 + Math.random() * 160;
      rainbowSparkles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.55 + Math.random() * 0.35,
        size: 4 + Math.random() * 4,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 14,
        hue: (i / count) * 360,
      });
    }
  }

  function updateEffects(dt) {
    dustParticles = dustParticles.filter((p) => {
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.size *= 0.985;
      return p.life > 0 && p.size > 0.4;
    });

    sparkles = sparkles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.life -= dt;
      return p.life > 0;
    });

    rainbowSparkles = rainbowSparkles.filter((p) => {
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.hue = (p.hue + dt * 220) % 360;
      p.life -= dt;
      return p.life > 0;
    });

    corpses = corpses.filter((c) => {
      c.vx *= 0.92;
      c.vy *= 0.92;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.spin * dt;
      c.life -= dt;
      return c.life > 0;
    });

    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }
  }

  // --- Camera ---
  function cameraTarget() {
    const tx = LEVEL_W <= VIEW_W ? (LEVEL_W - VIEW_W) / 2 : Math.max(0, Math.min(LEVEL_W - VIEW_W, player.x - VIEW_W / 2));
    const ty = LEVEL_H <= VIEW_H ? (LEVEL_H - VIEW_H) / 2 : Math.max(0, Math.min(LEVEL_H - VIEW_H, player.y - VIEW_H / 2));
    return { x: tx, y: ty };
  }

  function snapCamera() {
    const t = cameraTarget();
    cameraX = t.x;
    cameraY = t.y;
  }

  function updateCamera(dt) {
    const t = cameraTarget();
    const k = Math.min(1, dt * 8);
    cameraX += (t.x - cameraX) * k;
    cameraY += (t.y - cameraY) * k;
  }

  // --- Drawing: backdrop ---
  function drawSky() {
    ctx.fillStyle = themeSky(0, VIEW_H);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawThemeStars(VIEW_W, VIEW_H);
  }

  // Drifting clouds under the floating arena: rows of three tile-sized rounded squares, with parallax.
  const PARALLAX = 0.35;
  const CLOUD_RADIUS = 8;
  const CLOUD_SPAN = 40 * TILE;
  const PARALLAX_CLOUDS = [
    { c: 2, r: 1 }, { c: 9, r: 4 }, { c: 16, r: 0 }, { c: 23, r: 6 },
    { c: 30, r: 2 }, { c: 36, r: 9 }, { c: 5, r: 11 }, { c: 13, r: 8 },
    { c: 20, r: 12 }, { c: 27, r: 10 }, { c: 34, r: 13 }, { c: 39, r: 5 },
  ];

  function drawClouds() {
    ctx.fillStyle = THEME.cloud;
    for (let i = 0; i < PARALLAX_CLOUDS.length; i++) {
      const cloud = PARALLAX_CLOUDS[i];
      const raw = cloud.c * TILE - cameraX * PARALLAX + animTime * 14;
      const x = (((raw % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - TILE * 3;
      const y = cloud.r * TILE - cameraY * PARALLAX;
      if (x + TILE * 3 < -4 || x > VIEW_W + 4 || y > VIEW_H || y + TILE < 0) continue;
      for (let j = 0; j < 3; j++) {
        const pulse = 0.72 + 0.28 * Math.sin(animTime * 2.2 + i * 0.7 + j * 0.9);
        const size = TILE * pulse;
        ctx.beginPath();
        ctx.roundRect(x + j * TILE + (TILE - size) / 2, y + (TILE - size) / 2, size, size, THEME.square ? 0 : CLOUD_RADIUS * pulse);
        ctx.fill();
      }
    }
  }

  function visibleTileRange() {
    return {
      c0: Math.max(0, Math.floor(cameraX / TILE) - 1),
      c1: Math.min(COLS - 1, Math.ceil((cameraX + VIEW_W) / TILE) + 1),
      r0: Math.max(0, Math.floor(cameraY / TILE) - 1),
      r1: Math.min(ROWS - 1, Math.ceil((cameraY + VIEW_H) / TILE) + 1),
    };
  }

  // World-space pass: floor keeps the sunset sky, lightly tinted, with a white grid and faint checker.
  function drawFloor() {
    const { c0, c1, r0, r1 } = visibleTileRange();
    const floorGrad = themeSky(cameraY, cameraY + VIEW_H);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) !== "_") continue;
        const x = c * TILE;
        const y = r * TILE;
        ctx.fillStyle = floorGrad;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = (c + r) % 2 === 0 ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.1)";
        ctx.fillRect(x, y, TILE, TILE);
      }
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) !== "_") continue;
        ctx.rect(c * TILE + 0.5, r * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }
    ctx.stroke();
  }

  function drawWallTile(x, y, hasFace) {
    const half = TILE / 2;
    if (hasFace) {
      // Front face gives the blocks a little height in the top-down view.
      const faceGrad = ctx.createLinearGradient(x, y + TILE, x, y + TILE + WALL_FACE);
      faceGrad.addColorStop(0, "#4c1690");
      faceGrad.addColorStop(1, "#330c63");
      ctx.fillStyle = faceGrad;
      ctx.fillRect(x, y + TILE - 1, TILE, WALL_FACE + 1);
      ctx.strokeStyle = "#25084a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + half, y + TILE);
      ctx.lineTo(x + half, y + TILE + WALL_FACE);
      ctx.stroke();
    }

    const brickGrad = ctx.createLinearGradient(x, y, x, y + TILE);
    brickGrad.addColorStop(0, "#b76cff");
    brickGrad.addColorStop(1, "#7a2fd0");
    ctx.fillStyle = brickGrad;
    ctx.fillRect(x, y, TILE, TILE);

    ctx.strokeStyle = "#4c1690";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.beginPath();
    ctx.moveTo(x + half, y + 1);
    ctx.lineTo(x + half, y + TILE - 1);
    ctx.moveTo(x + 1, y + half);
    ctx.lineTo(x + TILE - 1, y + half);
    ctx.stroke();
  }

  function drawPipeTile(x, y) {
    // Seen from above: a round opening with the pipe's side showing below it.
    const cx = x + TILE / 2;
    const cy = y + TILE * 0.42;
    const bodyGrad = ctx.createLinearGradient(x + 4, 0, x + TILE - 4, 0);
    bodyGrad.addColorStop(0, "#4a0640");
    bodyGrad.addColorStop(0.5, "#e02bc4");
    bodyGrad.addColorStop(1, "#4a0640");
    // Cylinder body: straight sides with a curved bottom that matches the lip's ellipse.
    const bodyRx = TILE / 2 - 4;
    const bodyRy = TILE * 0.32 * (bodyRx / (TILE / 2));
    const bottomY = y + TILE + WALL_FACE - bodyRy;
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(x + 4, cy);
    ctx.lineTo(x + 4, bottomY);
    ctx.ellipse(cx, bottomY, bodyRx, bodyRy, 0, Math.PI, 0, true);
    ctx.lineTo(x + TILE - 4, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#22031e";
    ctx.lineWidth = 2;
    ctx.stroke();

    const lipGrad = ctx.createLinearGradient(x, 0, x + TILE, 0);
    lipGrad.addColorStop(0, "#3a0433");
    lipGrad.addColorStop(0.5, "#f245d8");
    lipGrad.addColorStop(1, "#3a0433");
    ctx.fillStyle = lipGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, TILE / 2, TILE * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#22031e";
    ctx.stroke();

    ctx.fillStyle = "#22031e";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1, TILE * 0.32, TILE * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBlocks() {
    const { c0, c1, r0, r1 } = visibleTileRange();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = tileAt(c, r);
        if (t === "#") drawWallTile(c * TILE, r * TILE, tileAt(c, r + 1) !== "#");
        else if (t === "G") drawPipeTile(c * TILE, r * TILE);
      }
    }
  }

  // --- Drawing: shared sprites ---
  function drawSparkleShape(s) {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.8);
    ctx.lineTo(s * 0.55, -s * 0.55);
    ctx.lineTo(s * 1.8, 0);
    ctx.lineTo(s * 0.55, s * 0.55);
    ctx.lineTo(0, s * 1.8);
    ctx.lineTo(-s * 0.55, s * 0.55);
    ctx.lineTo(-s * 1.8, 0);
    ctx.lineTo(-s * 0.55, -s * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  function drawShadow(x, y, rx) {
    ctx.fillStyle = "rgba(31, 42, 55, 0.2)";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glass bubble shield: clear in the middle, bright at the rim, with a wobbling highlight.
  function drawBubble(cx, cy, radius, strength = 1) {
    const r = radius * (1 + 0.03 * Math.sin(animTime * 4));
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.55 + strength);
    const shell = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    shell.addColorStop(0, "rgba(255, 255, 255, 0.04)");
    shell.addColorStop(0.7, "rgba(255, 255, 255, 0.12)");
    shell.addColorStop(1, "rgba(235, 190, 255, 0.45)");
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.45, cy - r * 0.45, r * 0.16, r * 0.09, -0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Golden honey drop for the regen buff.
  function drawHoneyDrop(cx, cy, size) {
    const r = size * 0.36;
    const by = cy + size * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.5);
    ctx.quadraticCurveTo(cx + r, by - r * 0.7, cx + r, by);
    ctx.arc(cx, by, r, 0, Math.PI);
    ctx.quadraticCurveTo(cx - r, by - r * 0.7, cx, cy - size * 0.5);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, cy - size * 0.5, 0, by + r);
    g.addColorStop(0, "#ffe566");
    g.addColorStop(1, "#f5a300");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#c99a00";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.4, by - r * 0.25, r * 0.16, r * 0.28, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player bun. (cx, cy) is the center of its visual box; look is a unit direction for the eyes.
  function drawBun(cx, cy, size, lookX, lookY, squash = 0) {
    const x = cx - size / 2;
    const h = size * (1 - squash);
    const y = cy + size / 2 - h;
    const bunScaleX = size / 270;
    const bunScaleY = h / 255;
    const bunBottom = y + (237 / 255) * h;
    const footGap = size * 0.17;
    const footW = Math.max(4, size * 0.12);
    const footH = Math.max(3, size * 0.07);
    const feetY = bunBottom + footH + 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(bunScaleX, bunScaleY);
    const bunGradient = ctx.createLinearGradient(0, 0, 0, 255);
    bunGradient.addColorStop(0, SKIN.stops[0]);
    bunGradient.addColorStop(0.5, SKIN.stops[1]);
    bunGradient.addColorStop(0.78, SKIN.stops[2]);
    bunGradient.addColorStop(1, SKIN.stops[3]);
    ctx.fillStyle = bunGradient;
    ctx.fill(PLAYER_PATH);
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = SKIN.outline;
    ctx.stroke(PLAYER_PATH);
    drawSkinDecor();
    ctx.restore();

    const eyeY = y + h * 0.5 + lookY * size * 0.05;
    const eyeSpread = size * 0.1;
    const eyeRadius = Math.max(2.6, Math.min(4.6, size * 0.05));
    const lookOffset = lookX * size * 0.07;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(cx - eyeSpread + lookOffset, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(cx + eyeSpread + lookOffset, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(cx - footGap - footW / 2, feetY - footH, footW, footH, footW / 2);
    ctx.roundRect(cx + footGap - footW / 2, feetY - footH, footW, footH, footW / 2);
    ctx.fill();
  }

  const ZOMBIE_LOOKS = {
    normal: { outline: "#3d7a2e", skin: "#8ccf5c", dome: "#5fae4a", top: "#c8ee84" },
    brute: { outline: "#2f5e25", skin: "#5e9e44", dome: "#3f7f32", top: "#9fd46a" },
    spitter: { outline: "#b83280", skin: "#ff8fcf", dome: "#f05aa8", top: "#ffc6e6" },
  };

  // Zombie: an upside-down bun with X eyes whose arms stick out of its sides toward its target.
  // windup (0..1) puffs a spitter up just before it fires.
  function drawZombieBody(cx, cy, size, face, flash = 0, walkT = 0, kind = "normal", windup = 0) {
    const ax = Math.cos(face);
    const ay = Math.sin(face);
    const look = ZOMBIE_LOOKS[kind];
    const puff = 1 + Math.sin(windup * Math.PI * 0.5) * 0.14;
    const armLen = size * 0.3;

    const drawArm = (side) => {
      const sway = Math.sin(walkT + side) * size * 0.04;
      // Shoulder sits on the bun's side edge; the arm points at the target from there.
      const bx = cx + side * size * 0.36 * puff;
      const by = cy - size * 0.02;
      const tx = bx + ax * armLen - ay * sway;
      const ty = by + ay * armLen + ax * sway;
      ctx.lineCap = "round";
      ctx.strokeStyle = flash > 0 ? "#ffffff" : look.outline;
      ctx.lineWidth = size * 0.2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = flash > 0 ? "#ffffff" : look.skin;
      ctx.lineWidth = size * 0.12;
      ctx.stroke();
    };

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale((size / 270) * puff, (-size / 255) * puff);
    ctx.translate(-135, -127.5);
    // In path space, y=237 is the flat side (visual top after flip).
    if (flash > 0) {
      ctx.fillStyle = "#ffffff";
    } else {
      const g = ctx.createLinearGradient(0, 22, 0, 237);
      g.addColorStop(0, look.dome);
      g.addColorStop(1, look.top);
      ctx.fillStyle = g;
    }
    ctx.fill(BUN_PATH);
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.strokeStyle = look.outline;
    ctx.stroke(BUN_PATH);
    ctx.restore();

    if (kind === "spitter") {
      // Round spitting mouth that opens wide during the wind-up.
      const mouthR = size * (0.05 + windup * 0.06);
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(cx + ax * size * 0.06, cy + size * 0.08 + ay * size * 0.03, mouthR, 0, Math.PI * 2);
      ctx.fill();
    }

    // X eyes
    const eyeY = cy - size * 0.1 + ay * size * 0.04;
    const eyeSpread = size * 0.16;
    const eyeSize = Math.max(4, size * 0.1);
    const lookOffset = ax * size * 0.06;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = Math.max(2, size * 0.055);
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      const ex = cx + side * eyeSpread + lookOffset;
      ctx.beginPath();
      ctx.moveTo(ex - eyeSize * 0.45, eyeY - eyeSize * 0.45);
      ctx.lineTo(ex + eyeSize * 0.45, eyeY + eyeSize * 0.45);
      ctx.moveTo(ex + eyeSize * 0.45, eyeY - eyeSize * 0.45);
      ctx.lineTo(ex - eyeSize * 0.45, eyeY + eyeSize * 0.45);
      ctx.stroke();
    }

    // Nub feet under the flipped dome, shuffling as it walks.
    const bunBottom = cy + size * ((127.5 - 22) / 255);
    const footGap = size * 0.17;
    const footW = Math.max(4, size * 0.12);
    const footH = Math.max(3, size * 0.07);
    const step = Math.sin(walkT) * 1.5;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.roundRect(cx - footGap - footW / 2, bunBottom + 1 + step, footW, footH, footW / 2);
    ctx.roundRect(cx + footGap - footW / 2, bunBottom + 1 - step, footW, footH, footW / 2);
    ctx.fill();

    // Arms always render in front of the body.
    drawArm(-1);
    drawArm(1);
  }

  function drawSpit(x, y, r) {
    ctx.fillStyle = "#ff5fb0";
    ctx.strokeStyle = "#b83280";
    ctx.lineWidth = Math.max(1.5, r * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBullet(x, y, r) {
    ctx.fillStyle = "#f7d21e";
    ctx.strokeStyle = "#c99a00";
    ctx.lineWidth = Math.max(1.5, r * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBlaster(px, py, angle) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    if (Math.cos(angle) < 0) ctx.scale(1, -1);
    const grad = ctx.createLinearGradient(0, -7, 0, 7);
    grad.addColorStop(0, "#ff8a1f");
    grad.addColorStop(1, "#dc2626");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(12, -7, 20, 14, 4);
    ctx.fill();
    ctx.strokeStyle = "#9a3412";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Magenta pipe-style nozzle.
    const nozzle = ctx.createLinearGradient(0, -5, 0, 5);
    nozzle.addColorStop(0, "#f245d8");
    nozzle.addColorStop(1, "#4a0640");
    ctx.fillStyle = nozzle;
    ctx.fillRect(30, -5, 6, 10);
    ctx.strokeStyle = "#22031e";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(30, -5, 6, 10);
    ctx.restore();
  }

  // --- Drawing: world entities ---
  function drawSpawnMarkers() {
    for (const m of spawnMarkers) {
      const p = 1 - m.t / m.max;
      const size = (m.kind === "brute" ? 26 : 20) * (0.4 + p * 0.6);
      drawShadow(m.x, m.y + 14, size);
      ctx.save();
      ctx.translate(m.x, m.y + 14);
      ctx.rotate(animTime * 3);
      const ringRgb = m.kind === "spitter" ? "255, 95, 176" : "255, 255, 255";
      ctx.strokeStyle = `rgba(${ringRgb}, ${0.5 + 0.4 * Math.sin(animTime * 16)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.ellipse(0, 0, size + 6, (size + 6) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawShadows() {
    if (state !== "dying" || deathPhase !== "fadeOut") {
      drawShadow(player.x, player.y + 19, 17 * player.deathScale);
    }
    for (const z of zombies) drawShadow(z.x, z.y + z.half * 1.2, z.half * 1.15);
  }

  function drawPlayer() {
    if (state === "dying" && deathPhase !== "spin") return;
    if (player.invuln > 0 && Math.floor(player.invuln * 14) % 2 === 0) return;

    const lookX = Math.cos(player.aim);
    const lookY = Math.sin(player.aim);
    const bob = player.moving ? Math.abs(Math.sin(player.walkT)) : 0;
    const cx = player.x;
    const cy = player.y - 4 - bob * 3;
    const gunX = player.x;
    const gunY = player.y - 2 - bob * 3;
    const dying = state === "dying";

    ctx.save();
    if (dying) {
      ctx.translate(cx, cy);
      ctx.rotate(player.deathAngle);
      ctx.scale(player.deathScale, player.deathScale);
      ctx.translate(-cx, -cy);
    }
    if (!dying && lookY < 0) drawBlaster(gunX, gunY, player.aim);
    drawBun(cx, cy, PLAYER_VISUAL, lookX, lookY, bob * 0.06);
    if (!dying && lookY >= 0) drawBlaster(gunX, gunY, player.aim);
    // Armor shows as a bubble that gets bolder with each Bubble Shield.
    if (stats.armor > 0) drawBubble(cx, cy + 2, PLAYER_VISUAL * 0.72, stats.armor);
    ctx.restore();

    if (player.muzzle > 0 && !dying) {
      ctx.save();
      ctx.translate(gunX + lookX * 40, gunY + lookY * 40);
      ctx.rotate(animTime * 20);
      ctx.fillStyle = "#ffffff";
      drawSparkleShape(5);
      ctx.restore();
    }
  }

  function drawZombie(z) {
    const size = z.half * 2.8;
    const bob = Math.abs(Math.sin(z.walkT)) * 2;
    const windup = z.windup > 0 ? 1 - z.windup / SPIT_WINDUP : 0;
    drawZombieBody(z.x, z.y - z.half * 0.35 - bob, size, z.face, z.flash, z.walkT, z.kind, windup);

    if (z.hp < z.maxHp) {
      const w = z.half * 2;
      const bx = z.x - w / 2;
      const by = z.y - z.half * 0.35 - size * 0.62;
      ctx.fillStyle = "rgba(255, 253, 248, 0.92)";
      ctx.beginPath();
      ctx.roundRect(bx - 1, by - 1, w + 2, 7, 3);
      ctx.fill();
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.roundRect(bx, by, Math.max(0, w * (z.hp / z.maxHp)), 5, 2);
      ctx.fill();
    }
  }

  function drawCorpse(c) {
    const k = c.life / c.max;
    const size = c.half * 2.8;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.scale(0.4 + 0.6 * k, 0.4 + 0.6 * k);
    drawZombieBody(0, 0, size, c.face, 0, 0, c.kind);
    ctx.restore();
  }

  function drawEntities() {
    const list = [];
    for (const c of corpses) list.push({ y: c.y, draw: () => drawCorpse(c) });
    for (const z of zombies) list.push({ y: z.y, draw: () => drawZombie(z) });
    list.push({ y: player.y, draw: drawPlayer });
    // Lower on screen = closer to the camera, so draw it last.
    list.sort((a, b) => a.y - b.y);
    for (const item of list) item.draw();
  }

  function drawBullets() {
    for (const b of bullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const tail = Math.min(26, speed * 0.03);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = b.r * 1.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x - (b.vx / speed) * tail, b.y - (b.vy / speed) * tail);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      drawBullet(b.x, b.y, b.r);
    }

    for (const b of enemyBullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      ctx.strokeStyle = "rgba(255, 198, 230, 0.7)";
      ctx.lineWidth = b.r * 1.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x - (b.vx / speed) * 18, b.y - (b.vy / speed) * 18);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      drawSpit(b.x, b.y, b.r + Math.sin(animTime * 20) * 0.8);
    }
  }

  function drawParticles() {
    ctx.fillStyle = "#ffffff";
    for (const p of dustParticles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of sparkles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = "#ffffff";
      drawSparkleShape(p.size);
      ctx.restore();
    }

    for (const p of rainbowSparkles) {
      const s = p.size;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      const grad = ctx.createLinearGradient(-s, -s, s, s);
      grad.addColorStop(0, `hsl(${p.hue}, 95%, 60%)`);
      grad.addColorStop(0.5, `hsl(${(p.hue + 60) % 360}, 95%, 55%)`);
      grad.addColorStop(1, `hsl(${(p.hue + 120) % 360}, 95%, 50%)`);
      ctx.fillStyle = grad;
      drawSparkleShape(s);
      ctx.restore();
    }
  }

  // --- Drawing: HUD & screens ---
  function drawPanel(x, y, w, h, radius = 8) {
    const panelGrad = ctx.createLinearGradient(x, y, x, y + h);
    panelGrad.addColorStop(0, "rgba(255, 253, 248, 0.92)");
    panelGrad.addColorStop(1, "rgba(255, 232, 186, 0.88)");
    ctx.fillStyle = panelGrad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = "#c44d03";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, radius - 1);
    ctx.stroke();
  }

  function drawGameHud() {
    ctx.save();
    ctx.textBaseline = "middle";
    const hudY = 12;
    const hudH = 48;
    const centerY = hudY + hudH / 2;

    // Health: bun icon plus an orange bar.
    const hpX = 14;
    const hpW = 250;
    drawPanel(hpX, hudY, hpW, hudH);
    drawBun(hpX + 26, centerY, 30, 1, 0);
    const barX = hpX + 50;
    const barW = hpW - 64;
    const barY = centerY - 9;
    ctx.fillStyle = "rgba(31, 42, 55, 0.15)";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, 18, 5);
    ctx.fill();
    const hpFrac = Math.max(0, player.hp / stats.maxHp);
    if (hpFrac > 0) {
      const hpGrad = ctx.createLinearGradient(0, barY, 0, barY + 18);
      hpGrad.addColorStop(0, "#ff8a1f");
      hpGrad.addColorStop(1, "#dc2626");
      ctx.fillStyle = hpGrad;
      ctx.beginPath();
      ctx.roundRect(barX, barY, Math.max(10, barW * hpFrac), 18, 5);
      ctx.fill();
    }
    ctx.strokeStyle = "#9a3412";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, 18, 5);
    ctx.stroke();
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${Math.ceil(player.hp)}/${Math.round(stats.maxHp)}`, barX + barW / 2, centerY + 1);

    // Zombies left this round.
    const zX = hpX + hpW + 10;
    const zW = 118;
    drawPanel(zX, hudY, zW, hudH);
    drawZombieBody(zX + 24, centerY - 2, 30, Math.PI / 2, 0, animTime * 6);
    ctx.font = `14px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillStyle = "#1f2a37";
    const left = toSpawn + spawnMarkers.length + zombies.length;
    ctx.fillText(`×${left}`, zX + 44, centerY + 1);

    // Round counter.
    const roundW = 170;
    const roundX = VIEW_W - 14 - roundW;
    drawPanel(roundX, hudY, roundW, hudH);
    ctx.fillStyle = "#1f2a37";
    ctx.textAlign = "center";
    ctx.fillText(`ROUND ${round}`, roundX + roundW / 2, centerY + 1);

    ctx.restore();
  }

  function drawBanner() {
    if (!banner) return;
    const elapsed = banner.dur - banner.t;
    const alpha = Math.min(1, elapsed / 0.2, banner.t / 0.3);
    const drop = (1 - Math.min(1, elapsed / 0.25)) * -20;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `32px ${FONT}`;
    ctx.fillStyle = "rgba(31, 42, 55, 0.45)";
    ctx.fillText(banner.text, VIEW_W / 2 + 3, VIEW_H * 0.36 + drop + 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(banner.text, VIEW_W / 2, VIEW_H * 0.36 + drop);
    if (banner.sub) {
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = "rgba(31, 42, 55, 0.45)";
      ctx.fillText(banner.sub, VIEW_W / 2 + 2, VIEW_H * 0.36 + 46 + drop + 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(banner.sub, VIEW_W / 2, VIEW_H * 0.36 + 46 + drop);
    }
    ctx.restore();
  }

  function drawCrosshair() {
    const x = mouse.x;
    const y = mouse.y;
    ctx.save();
    ctx.lineCap = "round";
    for (const [color, width] of [["#1f2a37", 5], ["#ffffff", 2.5]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(x + dx * 14, y + dy * 14);
        ctx.lineTo(x + dx * 19, y + dy * 19);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRainbowBlock(x, y, size) {
    const hueA = (animTime * 120) % 360;
    const hueB = (hueA + 60) % 360;
    const radius = 8;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, radius);
    ctx.clip();
    const rainbow = ctx.createLinearGradient(x, y, x, y + size);
    rainbow.addColorStop(0, `hsl(${hueA}, 95%, 55%)`);
    rainbow.addColorStop(1, `hsl(${hueB}, 95%, 55%)`);
    ctx.fillStyle = rainbow;
    ctx.fillRect(x, y, size, size);
    // Checkerboard overlay: every other cell is a very light black tint.
    const check = size / 4;
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        if ((row + col) % 2 !== 0) continue;
        ctx.fillRect(x + col * check, y + row * check, check, check);
      }
    }
    ctx.restore();
    const dark = ctx.createLinearGradient(x, y, x, y + size);
    dark.addColorStop(0, `hsl(${hueA}, 90%, 28%)`);
    dark.addColorStop(1, `hsl(${hueB}, 90%, 28%)`);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, size - 2, size - 2, radius - 1);
    ctx.stroke();
  }

  function drawPlus(x, y, s) {
    ctx.fillStyle = "#1f2a37";
    ctx.fillRect(x - s / 2 - 2, y - s / 6 - 2, s + 4, s / 3 + 4);
    ctx.fillRect(x - s / 6 - 2, y - s / 2 - 2, s / 3 + 4, s + 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - s / 2, y - s / 6, s, s / 3);
    ctx.fillRect(x - s / 6, y - s / 2, s / 3, s);
  }

  function drawStreaks(x, y, len) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const dy of [-8, 0, 8]) {
      ctx.moveTo(x - len, y + dy);
      ctx.lineTo(x - len * 0.35, y + dy);
    }
    ctx.stroke();
  }

  function drawBuffIcon(id, cx, cy) {
    ctx.save();
    switch (id) {
      case "hp":
        drawBun(cx, cy + 2, 46, 0, 0.3);
        drawPlus(cx + 20, cy - 16, 14);
        break;
      case "dmg":
        drawBullet(cx - 2, cy + 2, 14);
        drawPlus(cx + 18, cy - 16, 14);
        break;
      case "rate":
        drawBullet(cx - 18, cy + 12, 8);
        drawBullet(cx, cy, 8);
        drawBullet(cx + 18, cy - 12, 8);
        break;
      case "speed":
        ctx.fillStyle = "#ffffff";
        for (const [dx, dy, r] of [[-26, 14, 5], [-18, 18, 4], [-30, 6, 3]]) {
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        drawBun(cx + 6, cy + 2, 44, 1, 0);
        break;
      case "multi":
        drawStreaks(cx - 4, cy - 10, 26);
        drawBullet(cx + 8, cy - 10, 9);
        drawStreaks(cx - 4, cy + 12, 26);
        drawBullet(cx + 8, cy + 12, 9);
        break;
      case "pierce":
        drawZombieBody(cx, cy + 2, 40, Math.PI / 2, 0, 0);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy + 2);
        ctx.lineTo(cx + 16, cy + 2);
        ctx.stroke();
        drawBullet(cx + 22, cy + 2, 7);
        break;
      case "velocity":
        drawStreaks(cx + 2, cy, 34);
        drawBullet(cx + 10, cy, 11);
        break;
      case "size":
        drawBullet(cx, cy, 20);
        break;
      case "armor":
        drawBun(cx, cy + 2, 36, 0, 0.3);
        drawBubble(cx, cy + 2, 30, 1);
        break;
      case "regen":
        drawHoneyDrop(cx - 4, cy + 2, 46);
        drawPlus(cx + 20, cy - 16, 14);
        break;
      case "heal":
        drawBun(cx, cy + 4, 44, 0, 0.3);
        ctx.fillStyle = "#ffffff";
        for (const [dx, dy, s] of [[-22, -16, 4], [22, -12, 5], [18, 18, 3]]) {
          ctx.save();
          ctx.translate(cx + dx, cy + dy);
          ctx.rotate(animTime * 2);
          drawSparkleShape(s);
          ctx.restore();
        }
        break;
      case "knock":
        drawZombieBody(cx + 6, cy + 2, 40, Math.PI, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#1f2a37";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy - 4);
        ctx.lineTo(cx - 16, cy - 4);
        ctx.lineTo(cx - 16, cy - 10);
        ctx.lineTo(cx - 6, cy + 1);
        ctx.lineTo(cx - 16, cy + 12);
        ctx.lineTo(cx - 16, cy + 6);
        ctx.lineTo(cx - 30, cy + 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.restore();
  }

  function wrapText(text, maxW) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function cardRects() {
    const w = 240;
    const h = 262;
    const gap = 36;
    const x0 = (VIEW_W - (w * 3 + gap * 2)) / 2;
    return [0, 1, 2].map((i) => ({ x: x0 + i * (w + gap), y: 118, w, h }));
  }

  function cardIndexAt(x, y) {
    return cardRects().findIndex((r, i) => i < buffChoices.length && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

  function drawBuffScreen() {
    ctx.save();
    ctx.fillStyle = "rgba(20, 32, 44, 0.52)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`ROUND ${round} CLEAR!`, VIEW_W / 2, 50);
    ctx.font = `24px ${FONT}`;
    ctx.fillText("PICK A BUFF", VIEW_W / 2, 84);

    const rects = cardRects();
    buffChoices.forEach((buff, i) => {
      const r = rects[i];
      const hover = i === hoveredCard;
      const lift = hover ? -6 : 0;
      const x = r.x;
      const y = r.y + lift;

      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.beginPath();
      ctx.roundRect(x, r.y + 6, r.w, r.h, 12);
      ctx.fill();

      drawPanel(x, y, r.w, r.h, 12);
      if (hover) {
        ctx.strokeStyle = "#e85d04";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, r.w - 4, r.h - 4, 10);
        ctx.stroke();
      }

      const iconSize = 84;
      drawRainbowBlock(x + (r.w - iconSize) / 2, y + 22, iconSize);
      drawBuffIcon(buff.id, x + r.w / 2, y + 22 + iconSize / 2);

      ctx.textAlign = "center";
      ctx.fillStyle = "#1f2a37";
      ctx.font = `13px ${FONT}`;
      ctx.fillText(buff.name, x + r.w / 2, y + 136);

      ctx.fillStyle = "#4b5c6b";
      ctx.font = `10px ${FONT}`;
      wrapText(buff.desc, r.w - 36).forEach((line, li) => {
        ctx.fillText(line, x + r.w / 2, y + 168 + li * 18);
      });

      ctx.fillStyle = "#c44d03";
      ctx.fillText(`PRESS ${i + 1}`, x + r.w / 2, y + r.h - 22);
    });

    // Current stats, so choices feel like a build.
    const pw = 760;
    const px = (VIEW_W - pw) / 2;
    const py = 410;
    drawPanel(px, py, pw, 64);
    ctx.fillStyle = "#1f2a37";
    ctx.font = `10px ${FONT}`;
    ctx.fillText(
      `HP ${Math.ceil(player.hp)}/${Math.round(stats.maxHp)}   DMG ${stats.damage.toFixed(1)}   RATE ${stats.fireRate.toFixed(1)}/S   SPEED ${Math.round(stats.speed)}`,
      VIEW_W / 2, py + 22
    );
    ctx.fillText(
      `SHOTS ${stats.multishot}   PIERCE ${stats.pierce}   ARMOR ${Math.round(stats.armor * 100)}%   REGEN ${stats.regen.toFixed(1)}/S`,
      VIEW_W / 2, py + 44
    );
    ctx.restore();
  }

  function drawTitleScreen() {
    ctx.save();
    ctx.fillStyle = "rgba(20, 32, 44, 0.52)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    drawZombieBody(VIEW_W / 2 - 120, 118 + Math.cos(animTime * 4 + 1) * 4, 64, 0, 0, animTime * 6, "spitter");
    drawBun(VIEW_W / 2, 118 + Math.sin(animTime * 4) * 4, 64, 1, 0);
    drawZombieBody(VIEW_W / 2 + 120, 118 + Math.cos(animTime * 4) * 4, 64, Math.PI, 0, animTime * 6);

    ctx.fillStyle = "#ffffff";
    ctx.font = `36px ${FONT}`;
    ctx.fillText("BUN SURVIVOR", VIEW_W / 2, 208);

    ctx.font = `12px ${FONT}`;
    ctx.fillText("WASD / ARROWS — MOVE", VIEW_W / 2, 268);
    ctx.fillText("MOUSE — AIM     CLICK — SHOOT", VIEW_W / 2, 296);
    ctx.fillText("CLEAR EACH WAVE AND PICK A BUFF BEFORE THE NEXT ONE ARRIVES", VIEW_W / 2, 324);
    if (bestRound > 0) {
      ctx.fillStyle = "#ffc857";
      ctx.fillText(`BEST ROUND ${bestRound}`, VIEW_W / 2, 364);
    }
    if (Math.floor(animTime * 2) % 2 === 0) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `16px ${FONT}`;
      ctx.fillText("CLICK TO START", VIEW_W / 2, 420);
    }
    ctx.restore();
  }

  function drawDeathFade() {
    if (fadeAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `28px ${FONT}`;
    ctx.fillText("GAME OVER!", VIEW_W / 2, VIEW_H / 2 - 60);
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`YOU REACHED ROUND ${round}`, VIEW_W / 2, VIEW_H / 2);
    ctx.fillText(`ZOMBIES DEFEATED ${kills}`, VIEW_W / 2, VIEW_H / 2 + 28);
    ctx.fillStyle = "#ffc857";
    ctx.fillText(`BEST ROUND ${bestRound}`, VIEW_W / 2, VIEW_H / 2 + 56);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("CLICK OR PRESS R TO RESTART", VIEW_W / 2, VIEW_H / 2 + 104);
    ctx.restore();
  }

  function draw() {
    syncCanvasResolution();
    drawSky();
    drawClouds();

    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(Math.round(-cameraX + sx), Math.round(-cameraY + sy));
    drawFloor();
    drawSpawnMarkers();
    drawBlocks();
    drawShadows();
    drawEntities();
    drawBullets();
    drawParticles();
    ctx.restore();

    const aiming = state === "playing" || state === "cleared" || state === "dying";
    canvas.style.cursor = aiming ? "none" : state === "buff" && hoveredCard < 0 ? "default" : "pointer";

    if (state === "title") {
      drawTitleScreen();
      return;
    }
    if (state === "over") {
      drawGameOver();
      return;
    }

    drawGameHud();
    drawBanner();
    if (state === "buff") drawBuffScreen();
    drawDeathFade();
    if (state === "playing" || state === "cleared") drawCrosshair();
  }

  function update(dt) {
    animTime += dt;

    if (state === "title") {
      player.aim = Math.atan2(mouse.y + cameraY - player.y, mouse.x + cameraX - player.x);
      updateEffects(dt);
      return;
    }

    if (state === "playing") {
      updatePlayer(dt, true);
      rebuildFlowField();
      updateZombies(dt);
      if (state !== "playing") return;
      updateBullets(dt);
      updateEnemyBullets(dt);
      if (state !== "playing") return;
      updateSpawner(dt);
      updateEffects(dt);
      updateCamera(dt);
      return;
    }

    if (state === "cleared") {
      updatePlayer(dt, false);
      updateBullets(dt);
      updateEffects(dt);
      updateCamera(dt);
      stateTimer -= dt;
      if (stateTimer <= 0) {
        state = "buff";
        stateTimer = 0.35; // Small delay so a held click doesn't pick a card by accident.
        buffChoices = rollBuffChoices();
        hoveredCard = cardIndexAt(mouse.x, mouse.y);
      }
      return;
    }

    if (state === "buff") {
      if (stateTimer > 0) stateTimer = Math.max(0, stateTimer - dt);
      updateEffects(dt);
      return;
    }

    if (state === "dying") {
      updateEffects(dt);
      updateDeath(dt);
    }
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // --- Input ---
  function updateMouse(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    mouse.y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    if (state === "buff") {
      const idx = cardIndexAt(mouse.x, mouse.y);
      if (idx !== hoveredCard && idx >= 0) sfx.hover();
      hoveredCard = idx;
    }
  }

  window.addEventListener("mousemove", updateMouse);

  canvas.addEventListener("mousedown", (e) => {
    ensureAudio();
    updateMouse(e);
    if (e.button !== 0) return;
    e.preventDefault();
    if (state === "title" || state === "over") {
      startGame();
      return;
    }
    if (state === "buff") {
      const idx = cardIndexAt(mouse.x, mouse.y);
      if (idx >= 0) pickBuff(idx);
      return;
    }
    mouse.down = true;
  });

  window.addEventListener("mouseup", () => {
    mouse.down = false;
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    ensureAudio();
    keys.add(e.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "KeyR" && state !== "title" && state !== "loading") startGame();
    if (state === "buff") {
      if (e.code === "Digit1" || e.code === "Numpad1") pickBuff(0);
      if (e.code === "Digit2" || e.code === "Numpad2") pickBuff(1);
      if (e.code === "Digit3" || e.code === "Numpad3") pickBuff(2);
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    mouse.down = false;
  });

  const fontReady = document.fonts ? document.fonts.load(`12px ${FONT}`).catch(() => {}) : Promise.resolve();

  Promise.all([loadArenaFromImage(ARENA_IMAGE_URL), fontReady])
    .then(() => {
      player.x = spawn.x;
      player.y = spawn.y;
      snapCamera();
      state = "title";
      lastTime = performance.now();
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      console.error(err);
    });
})();
