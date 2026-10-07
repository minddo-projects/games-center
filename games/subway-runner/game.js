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

  // Logical game resolution (drawing coordinates). The canvas bitmap is scaled up separately.
  const VIEW_W = 960;
  const VIEW_H = 528;

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
  const BEST_KEY = "bun-express-best";

  // --- 3D camera ---
  // World units: x = sideways, y = up, z = forward along the track. 1 unit ≈ 1 meter.
  const FOCAL = 540;
  const HORIZON = Math.round(VIEW_H * 0.36);
  const CAM_BACK = 5;
  const CAM_Y = 2.35;
  const NEAR = 0.3;
  const FAR = 110;

  // --- Track & obstacles ---
  const LANE_W = 2.6;
  const CAR_HALF_W = 0.9;
  const CAR_H = 2.2;
  const CAR_LEN = 9;
  const CAR_GAP = 0.5;
  const PIPE_R = 1.55;
  const PIPE_IN = 1.28;
  const PIPE_CY = 1.45;
  const PIPE_FLOOR = PIPE_CY - PIPE_IN;
  const HURDLE_H = 0.85;
  const PLAYER_DEPTH = 0.35;

  // --- Movement ---
  const BASE_SPEED = 14;
  const MAX_SPEED = 34;
  const ACCEL = 0.2;
  const TITLE_SPEED = 6;
  const JUMP_V = 9.5;
  const GRAVITY = 28;
  const CRASH_TIME = 1.1;
  const FADE_TIME = 0.42;

  // --- Palette: rose & magenta scenery; yellows/oranges shared with the other games ---
  const CAR = { front: "#ff8cc0", side: "#f0569a", roof: "#ffc2dd", line: "#7a1447", trim: "#fff3d6", glass: "#4a0d2e", skirt: "#5a0f36" };
  const PIPE = { edge: "#5c0a33", mid: "#ff3d8b", lipEdge: "#8c0f4f", lipMid: "#ff7ab3", hole: "#2b0418", line: "#3d0622" };
  const BUILDING_COLORS = [
    ["#fbb6d8", "#e879b0"],
    ["#f78fc3", "#d9609e"],
    ["#ffc4de", "#ec8fbd"],
    ["#f472b6", "#c9508f"],
  ];

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

  function playNoise({ dur = 0.08, vol = 0.05, delay = 0, freq = 1200 }) {
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
    filter.frequency.value = freq;
    src.buffer = buffer;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctxA.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  let coinStreak = 0;
  let coinStreakTimer = 0;

  const sfx = {
    jump() {
      playTone({ freq: 360, freqEnd: 620, type: "square", dur: 0.1, vol: 0.07 });
    },
    coin() {
      // Each coin in a quick chain rings a little higher.
      const bump = Math.pow(1.03, Math.min(coinStreak, 12));
      playTone({ freq: 988 * bump, type: "square", dur: 0.05, vol: 0.06 });
      playTone({ freq: 1319 * bump, type: "square", dur: 0.1, vol: 0.06, delay: 0.05 });
    },
    whoosh() {
      playNoise({ dur: 0.08, vol: 0.03, freq: 2600 });
    },
    bump() {
      playTone({ freq: 160, freqEnd: 110, type: "triangle", dur: 0.08, vol: 0.07 });
    },
    land() {
      playNoise({ dur: 0.04, vol: 0.025, freq: 700 });
    },
    pipe() {
      playTone({ freq: 240, freqEnd: 120, type: "triangle", dur: 0.22, vol: 0.06 });
    },
    crash() {
      playNoise({ dur: 0.3, vol: 0.09, freq: 900 });
      playTone({ freq: 220, freqEnd: 55, type: "square", dur: 0.35, vol: 0.08 });
    },
    faster() {
      [659, 784, 988, 1319].forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.08, vol: 0.06, delay: i * 0.06 });
      });
    },
    start() {
      [523, 659, 784].forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.09, vol: 0.07, delay: i * 0.08 });
      });
    },
  };

  // Original looping chiptune (not from any commercial game).
  // A driving E minor "train" groove: chugging bass, bright hook, and a beat that speeds up with you.
  const NOTE_FREQ = {
    C2: 65.41, D2: 73.42, E2: 82.41, G2: 98.0, A2: 110.0, B2: 123.47,
    C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0,
    A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, "F#5": 739.99,
    G5: 783.99, A5: 880.0, B5: 987.77,
  };
  const MUSIC_BASE_STEP = 0.125;
  const MUSIC_MELODY = [
    "E5", null, "G5", "B5", null, "A5", "G5", null,
    "G5", null, "E5", "C5", null, "E5", "G5", null,
    "D5", null, "G5", "B5", null, "A5", "G5", null,
    "F#5", null, "E5", "D5", null, "F#5", "A5", null,

    "B5", null, "A5", "G5", "E5", null, "G5", null,
    "E5", "G5", null, "E5", "C5", null, "D5", "E5",
    "D5", null, "B4", "D5", "G5", null, "B4", null,
    "A4", null, "D5", "F#5", "A5", null, "F#5", null,
  ];
  // Root-root-fifth-root chug for each chord: Em, C, G, D.
  const MUSIC_BASS = [
    "E2", "E2", "B2", "E2", "E3", "E2", "B2", "E2",
    "C2", "C2", "G2", "C2", "C3", "C2", "G2", "C2",
    "G2", "G2", "D3", "G2", "G3", "G2", "D3", "G2",
    "D2", "D2", "A2", "D2", "D3", "D2", "A2", "D2",
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

  function musicStep() {
    // The groove tightens as the run speeds up.
    return MUSIC_BASE_STEP * Math.pow(BASE_SPEED / Math.max(BASE_SPEED, speed), 0.35);
  }

  function musicTick() {
    if (!musicPlaying) return;
    const ctxA = ensureAudio();
    if (!ctxA) return;
    const step = musicStep();

    const m = MUSIC_MELODY[musicStepIndex % MUSIC_MELODY.length];
    const b = MUSIC_BASS[musicStepIndex % MUSIC_BASS.length];
    if (m) playMusicNote(NOTE_FREQ[m], "square", step * 0.85, 0.03);
    if (b) playMusicNote(NOTE_FREQ[b], "triangle", step * 0.7, 0.07);
    const beat = musicStepIndex % 8;
    if (beat === 0 || beat === 3 || beat === 6) playMusicNote(140, "sine", 0.12, 0.12, 45);
    if (beat === 4) playNoise({ dur: 0.08, vol: 0.035 });
    if (musicStepIndex % 2 === 1) playNoise({ dur: 0.015, vol: 0.01, freq: 6000 });

    musicStepIndex += 1;
    musicTimer = setTimeout(musicTick, step * 1000);
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

  // --- Game state ---
  let state = "title";
  let lastTime = 0;
  let animTime = 0;
  let stateTimer = 0;
  let speed = TITLE_SPEED;
  let runTime = 0;
  let speedTier = 0;
  let coins = 0;
  let best = 0;
  let shake = 0;
  let fadeAlpha = 0;
  let deathPhase = "";
  let banner = null;

  let camX = 0;
  let camZ = -CAM_BACK;

  /** @type {any[]} */ let trains = [];
  /** @type {any[]} */ let pipes = [];
  /** @type {any[]} */ let hurdles = [];
  /** @type {any[]} */ let coinList = [];
  /** @type {any[]} */ let buildings = [];
  /** @type {any[]} */ let lamps = [];
  /** @type {any[]} */ let particles = [];
  let nextPatternZ = 0;
  let nextBuildingZ = { "-1": 0, "1": 0 };
  let nextLampZ = 0;

  const player = {
    lane: 1,
    x: 0,
    y: 0,
    vy: 0,
    z: 0,
    grounded: true,
    floor: 0,
    squash: 0,
    tilt: 0,
    bump: 0,
    runT: 0,
    inPipe: null,
    flip: 0,
    crashSpin: 0,
  };

  try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch (err) {
    best = 0;
  }

  function saveBest() {
    const dist = Math.floor(player.z);
    if (dist <= best) return;
    best = dist;
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
      // Storage can be blocked; the best run just won't persist.
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

  function laneX(lane) {
    return (lane - 1) * LANE_W;
  }

  function playerLane() {
    return Math.max(0, Math.min(2, Math.round(player.x / LANE_W) + 1));
  }

  // --- Projection ---
  function proj(x, y, z) {
    const cz = z - camZ;
    const s = FOCAL / cz;
    return { x: VIEW_W / 2 + (x - camX) * s, y: HORIZON - (y - CAM_Y) * s, s, cz };
  }

  // Clip a camera-space polygon against the near plane so faces sliding past the camera stay sane.
  function clipNear(poly) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const aIn = a[2] >= NEAR;
      const bIn = b[2] >= NEAR;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out;
  }

  function polyPath(worldPts) {
    const cam = clipNear(worldPts.map(([x, y, z]) => [x - camX, y - CAM_Y, z - camZ]));
    if (cam.length < 3) return false;
    ctx.beginPath();
    cam.forEach(([x, y, z], i) => {
      const sx = VIEW_W / 2 + (x * FOCAL) / z;
      const sy = HORIZON - (y * FOCAL) / z;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    return true;
  }

  function fillPoly(worldPts, fill, stroke = null, lineWidth = 2) {
    if (!polyPath(worldPts)) return;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  // Quads on the three kinds of planes the scenery uses.
  function quadX(x, y0, y1, z0, z1) {
    return [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]];
  }
  function quadZ(z, x0, x1, y0, y1) {
    return [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  }
  function quadY(y, x0, x1, z0, z1) {
    return [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  }

  function fogAlpha(cz) {
    return Math.max(0, Math.min(1, (FAR - cz) / 25));
  }

  // --- World generation ---
  function shuffledLanes() {
    const l = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  }

  function addTrain(lane, z, cars) {
    const len = cars * CAR_LEN + (cars - 1) * CAR_GAP;
    trains.push({ lane, z0: z, z1: z + len, cars });
    return len;
  }

  function addPipe(lane, z, len) {
    pipes.push({ lane, z0: z, z1: z + len, hole: null, camInside: false });
  }

  function addHurdle(lane, z) {
    hurdles.push({ lane, z, kind: Math.random() < 0.5 ? "barrier" : "cones" });
  }

  function addCoinLine(lane, z0, z1, y = 0.55) {
    for (let z = z0; z <= z1; z += 1.6) coinList.push({ lane, z, y, taken: false });
  }

  // Coins that follow the jump arc over a hurdle.
  function addCoinArc(lane, z) {
    for (let dz = -4; dz <= 4.01; dz += 1.33) {
      const y = Math.max(0.55, 2 - (dz / 4) * (dz / 4) * 1.45);
      coinList.push({ lane, z: z + dz, y, taken: false });
    }
  }

  function spawnPattern(z) {
    const difficulty = Math.min(1, z / 1500);
    const r = Math.random();
    const lanes = shuffledLanes();
    let len = 1;

    if (r < 0.3) {
      // Trains: block one or two lanes, coins in a free lane.
      const blocked = Math.random() < 0.3 + 0.3 * difficulty ? 2 : 1;
      const cars = 1 + Math.floor(Math.random() * (difficulty > 0.4 ? 3 : 2));
      for (let i = 0; i < blocked; i++) len = Math.max(len, addTrain(lanes[i], z + Math.random() * 3, cars));
      if (Math.random() < 0.75) addCoinLine(lanes[blocked], z, z + len);
    } else if (r < 0.55) {
      // A row of things to jump over.
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) addHurdle(lanes[i], z);
      if (Math.random() < 0.65) addCoinArc(lanes[0], z);
    } else if (r < 0.72) {
      // A pipe to run through, full of coins.
      len = 12 + Math.random() * 8;
      addPipe(lanes[0], z, len);
      addCoinLine(lanes[0], z + 1.5, z + len - 1.5, PIPE_FLOOR + 0.55);
      if (Math.random() < 0.6) {
        addTrain(lanes[1], z + Math.random() * 4, 1 + Math.floor(Math.random() * 2));
      } else {
        addHurdle(lanes[1], z + len / 2);
      }
    } else if (r < 0.88) {
      // Train in one lane, a hurdle in the next, coins in the last.
      len = addTrain(lanes[0], z, 1 + Math.floor(Math.random() * 2));
      addHurdle(lanes[1], z + 2 + Math.random() * 4);
      addCoinLine(lanes[2], z, z + len);
    } else {
      // Coin zigzag between two neighboring lanes.
      const a = Math.floor(Math.random() * 3);
      const b = a === 1 ? (Math.random() < 0.5 ? 0 : 2) : 1;
      addCoinLine(a, z, z + 8);
      addCoinLine(b, z + 11, z + 19);
      len = 19;
    }

    // Faster runs get longer gaps so there is always time to react.
    nextPatternZ = z + len + 6 + speed * 0.62;
  }

  function spawnBuilding(side, z) {
    const inset = 6.4 + Math.random() * 1.6;
    const w = 4 + Math.random() * 3;
    const len = 5 + Math.random() * 5;
    const h = 3.5 + Math.random() * 8;
    const [front, sideColor] = BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)];
    const sideWins = [];
    for (let zz = z + 0.6; zz + 0.8 <= z + len - 0.4; zz += 1.5) {
      for (let yy = 1.0; yy + 0.9 <= h - 0.6; yy += 1.5) sideWins.push({ z: zz, y: yy, lit: Math.random() < 0.65 });
    }
    const frontWins = [];
    for (let xx = 0.6; xx + 0.8 <= w - 0.4; xx += 1.4) {
      for (let yy = 1.0; yy + 0.9 <= h - 0.6; yy += 1.5) frontWins.push({ x: xx, y: yy, lit: Math.random() < 0.65 });
    }
    buildings.push({ side, inset, w, z0: z, z1: z + len, h, front, sideColor, sideWins, frontWins });
    return z + len + 0.6 + Math.random() * 2.5;
  }

  function updateWorld() {
    const ahead = camZ + FAR + 10;
    if (state === "running") {
      while (nextPatternZ < ahead) spawnPattern(nextPatternZ);
    }
    for (const side of [-1, 1]) {
      while (nextBuildingZ[side] < ahead) nextBuildingZ[side] = spawnBuilding(side, nextBuildingZ[side]);
    }
    while (nextLampZ < ahead) {
      lamps.push({ side: -1, z: nextLampZ }, { side: 1, z: nextLampZ });
      nextLampZ += 14;
    }

    const behind = camZ - 1;
    trains = trains.filter((t) => t.z1 > behind);
    pipes = pipes.filter((p) => p.z1 > behind);
    hurdles = hurdles.filter((h) => h.z > behind);
    coinList = coinList.filter((c) => c.z > behind && !c.taken);
    buildings = buildings.filter((b) => b.z1 > behind);
    lamps = lamps.filter((l) => l.z > behind);
  }

  function resetWorld() {
    trains = [];
    pipes = [];
    hurdles = [];
    coinList = [];
    buildings = [];
    lamps = [];
    particles = [];
    player.z = 0;
    camZ = -CAM_BACK;
    nextPatternZ = 45;
    nextBuildingZ = { "-1": camZ - 10, "1": camZ - 6 };
    nextLampZ = camZ + 2;
    updateWorld();
  }

  // --- Player ---
  function resetPlayer() {
    Object.assign(player, {
      lane: 1, x: 0, y: 0, vy: 0, grounded: true, floor: 0, squash: 0, tilt: 0, bump: 0,
      runT: 0, inPipe: null, flip: 0, crashSpin: 0,
    });
    camX = 0;
  }

  function startRun() {
    resetWorld();
    resetPlayer();
    coins = 0;
    runTime = 0;
    speed = BASE_SPEED;
    speedTier = 0;
    shake = 0;
    fadeAlpha = 0;
    deathPhase = "";
    state = "running";
    showBanner("GO!", "", 1.0);
    sfx.start();
    startMusic();
  }

  function showBanner(text, sub, dur) {
    banner = { text, sub, t: dur, dur };
  }

  function pipeAt(lane, z) {
    return pipes.find((p) => p.lane === lane && z > p.z0 && z < p.z1) || null;
  }

  function laneBlocked(lane, z) {
    const span = (a0, a1) => a0 < z + PLAYER_DEPTH + 0.3 && a1 > z - PLAYER_DEPTH - 0.3;
    return trains.some((t) => t.lane === lane && span(t.z0, t.z1)) || pipes.some((p) => p.lane === lane && span(p.z0, p.z1));
  }

  // You can't slip out of a pipe until the camera has come out of it too.
  function pipeLocked() {
    return pipes.some((p) => p.lane === player.lane && player.z > p.z0 - 0.4 && camZ < p.z1 + 0.3);
  }

  function tryLane(dir) {
    if (state !== "running") return;
    const target = player.lane + dir;
    if (target < 0 || target > 2 || pipeLocked() || laneBlocked(target, player.z)) {
      player.bump = dir;
      shake = Math.max(shake, 4);
      sfx.bump();
      return;
    }
    player.lane = target;
    player.tilt = dir;
    sfx.whoosh();
  }

  function tryJump() {
    if (state !== "running" || !player.grounded || player.inPipe) return;
    player.vy = JUMP_V;
    player.grounded = false;
    player.squash = -1;
    sfx.jump();
  }

  function crash() {
    state = "crashing";
    deathPhase = "fling";
    stateTimer = CRASH_TIME;
    player.vy = 6.5;
    player.grounded = false;
    shake = 14;
    saveBest();
    stopMusic();
    sfx.crash();
    spawnBurst(player.x, player.y + 0.5, player.z + 0.3, 16);
  }

  function updatePlayer(dt) {
    const tx = laneX(player.lane);
    player.x += (tx - player.x) * Math.min(1, dt * 16);
    player.tilt *= Math.exp(-dt * 9);
    player.bump *= Math.exp(-dt * 12);
    player.squash *= Math.exp(-dt * 10);
    player.runT += dt * (8 + speed * 0.5);

    if (!player.grounded) {
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.grounded = true;
        player.squash = 1;
        sfx.land();
        spawnDust(player.x, player.z, 8);
      }
    }

    const lane = playerLane();
    const pipe = pipeAt(lane, player.z);
    if (pipe && pipe !== player.inPipe) sfx.pipe();
    player.inPipe = pipe;
    // Step up onto the curved pipe floor while inside.
    player.floor += ((pipe ? PIPE_FLOOR : 0) - player.floor) * Math.min(1, dt * 14);

    if (player.grounded && Math.random() < dt * 14) spawnDust(player.x, player.z - 0.2, 1);
  }

  function checkCollisions() {
    const lane = playerLane();
    const z = player.z;
    for (const t of trains) {
      if (t.lane === lane && z + PLAYER_DEPTH > t.z0 && z - PLAYER_DEPTH < t.z1) {
        crash();
        return;
      }
    }
    for (const h of hurdles) {
      if (h.lane === lane && Math.abs(z - h.z) < PLAYER_DEPTH && player.y < HURDLE_H - 0.05) {
        crash();
        return;
      }
    }
    for (const c of coinList) {
      if (c.taken || c.lane !== lane || Math.abs(z - c.z) > 0.7) continue;
      if (Math.abs(player.y + player.floor + 0.5 - c.y) > 0.9) continue;
      c.taken = true;
      coins += 1;
      // One token for every 10 coins picked up.
      if (coins % 10 === 0) earnTokens(1);
      coinStreak = coinStreakTimer > 0 ? coinStreak + 1 : 0;
      coinStreakTimer = 0.45;
      spawnSparkles(laneX(c.lane), c.y, c.z);
      sfx.coin();
    }
  }

  function updateCamera(dt) {
    camZ = player.z - CAM_BACK;
    camX += (player.x * 0.85 - camX) * Math.min(1, dt * 10);
  }

  // --- Particles (world space) ---
  function spawnDust(x, z, count) {
    for (let i = 0; i < count; i++) {
      particles.push({
        kind: "dust",
        x: x + (Math.random() - 0.5) * 0.6,
        y: 0.05 + player.floor,
        z,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 0.6 + Math.random() * 1.2,
        vz: -1 - Math.random() * 2,
        life: 0.3 + Math.random() * 0.2,
        size: 0.06 + Math.random() * 0.07,
      });
    }
  }

  function spawnBurst(x, y, z, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      particles.push({
        kind: "dust", x, y, z,
        vx: Math.cos(a) * sp,
        vy: Math.abs(Math.sin(a)) * sp,
        vz: (Math.random() - 0.5) * 3,
        life: 0.4 + Math.random() * 0.3,
        size: 0.08 + Math.random() * 0.1,
      });
    }
  }

  function spawnSparkles(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
      particles.push({
        kind: "spark", x, y, z,
        vx: Math.cos(a) * 2.2,
        vy: Math.sin(a) * 2.2,
        vz: speed * 0.6,
        life: 0.3 + Math.random() * 0.15,
        size: 0.05 + Math.random() * 0.03,
        angle: Math.random() * Math.PI,
      });
    }
  }

  function updateParticles(dt) {
    particles = particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.kind === "dust") p.vy -= 3 * dt;
      p.angle = (p.angle || 0) + dt * 8;
      p.life -= dt;
      return p.life > 0 && p.z - camZ > NEAR + 0.5;
    });
  }

  // --- Update ---
  function update(dt) {
    animTime += dt;
    if (coinStreakTimer > 0) coinStreakTimer -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }

    if (state === "title") {
      player.z += TITLE_SPEED * dt;
      player.runT += dt * 10;
      updateCamera(dt);
      updateWorld();
      return;
    }

    if (state === "running") {
      runTime += dt;
      speed = Math.min(MAX_SPEED, BASE_SPEED + runTime * ACCEL);
      const tier = Math.floor((speed - BASE_SPEED) / 5);
      if (tier > speedTier) {
        speedTier = tier;
        showBanner("FASTER!", `SPEED ${Math.round(speed)}`, 1.3);
        sfx.faster();
      }
      player.z += speed * dt;
      updatePlayer(dt);
      checkCollisions();
      updateCamera(dt);
      updateWorld();
      updateParticles(dt);
      return;
    }

    if (state === "crashing") {
      updateParticles(dt);
      if (deathPhase === "fling") {
        // The paper bun pops up, flips over and over, and flutters back toward the camera.
        player.vy -= 18 * dt;
        player.y = Math.max(0, player.y + player.vy * dt);
        player.z -= 2.2 * dt;
        player.flip += dt * 14;
        player.crashSpin += dt * 3;
        stateTimer -= dt;
        if (stateTimer <= 0) {
          deathPhase = "fadeOut";
          stateTimer = FADE_TIME;
        }
      } else if (deathPhase === "fadeOut") {
        stateTimer -= dt;
        fadeAlpha = Math.min(1, 1 - Math.max(0, stateTimer) / FADE_TIME);
        if (stateTimer <= 0) {
          fadeAlpha = 1;
          state = "over";
          stateTimer = 0.5;
        }
      }
      return;
    }

    if (state === "over" && stateTimer > 0) stateTimer -= dt;
  }

  // --- Drawing: backdrop ---
  function drawSky() {
    ctx.fillStyle = themeSky(0, HORIZON);
    ctx.fillRect(-40, -40, VIEW_W + 80, HORIZON + 41);
    drawThemeStars(VIEW_W, HORIZON);
  }

  // Rows of three pulsing rounded squares, drifting slowly across the sky.
  const CLOUDS = [
    { x: 40, y: 30 }, { x: 300, y: 70 }, { x: 560, y: 22 }, { x: 800, y: 90 },
    { x: 1060, y: 44 }, { x: 1300, y: 80 },
  ];
  const CLOUD_SPAN = 1500;
  const CLOUD_SIZE = 34;

  function drawClouds() {
    ctx.fillStyle = THEME.cloud;
    for (let i = 0; i < CLOUDS.length; i++) {
      const c = CLOUDS[i];
      const raw = c.x + animTime * 10 - camX * 10;
      const x = (((raw % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - 150;
      for (let j = 0; j < 3; j++) {
        const pulse = 0.72 + 0.28 * Math.sin(animTime * 2.2 + i * 0.7 + j * 0.9);
        const size = CLOUD_SIZE * pulse;
        ctx.beginPath();
        ctx.roundRect(x + j * CLOUD_SIZE + (CLOUD_SIZE - size) / 2, c.y + (CLOUD_SIZE - size) / 2, size, size, THEME.square ? 0 : 6 * pulse);
        ctx.fill();
      }
    }
  }

  // Hazy far-off towers sitting on the horizon.
  const SKYLINE = [];
  for (let i = 0, x = -200; x < 1400; i++) {
    const w = 40 + ((i * 37) % 50);
    SKYLINE.push({ x, w, h: 30 + ((i * 53) % 70), far: i % 2 === 0 });
    x += w + 6 + ((i * 17) % 20);
  }

  function drawSkyline() {
    for (const layer of [true, false]) {
      ctx.fillStyle = layer ? "rgba(236, 120, 170, 0.28)" : "rgba(214, 84, 142, 0.35)";
      const shift = -camX * (layer ? 4 : 8);
      for (const b of SKYLINE) {
        if (b.far !== layer) continue;
        const h = layer ? b.h * 1.3 : b.h;
        ctx.beginPath();
        ctx.roundRect(b.x + shift, HORIZON - h, b.w, h + 2, [6, 6, 0, 0]);
        ctx.fill();
      }
    }
  }

  function fadeStroke(alpha) {
    const g = ctx.createLinearGradient(0, HORIZON, 0, VIEW_H);
    g.addColorStop(0, "rgba(255, 255, 255, 0)");
    g.addColorStop(0.2, `rgba(255, 255, 255, ${alpha})`);
    g.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);
    return g;
  }

  function drawGround() {
    const g = ctx.createLinearGradient(0, HORIZON, 0, VIEW_H);
    g.addColorStop(0, "#ffd6b0");
    g.addColorStop(1, "#ffb0cf");
    ctx.fillStyle = g;
    ctx.fillRect(-40, HORIZON, VIEW_W + 80, VIEW_H - HORIZON + 40);

    const zNear = camZ + 3;
    const zFar = camZ + FAR;

    // White grid on the ground, the same motif the other games use.
    ctx.strokeStyle = fadeStroke(0.4);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = -16; k <= 16; k++) {
      const a = proj(k * 1.3, 0, zNear);
      const b = proj(k * 1.3, 0, zFar);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    const step = 2.6;
    for (let z = Math.ceil(zNear / step) * step; z < zFar; z += step) {
      const a = proj(-22, 0, z);
      const b = proj(22, 0, z);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * (1 - (z - camZ) / FAR)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Track beds.
    const bedGrad = ctx.createLinearGradient(0, HORIZON, 0, VIEW_H);
    bedGrad.addColorStop(0, "rgba(207, 111, 156, 0)");
    bedGrad.addColorStop(0.1, "rgba(207, 111, 156, 1)");
    bedGrad.addColorStop(1, "#c4608f");
    for (let lane = 0; lane < 3; lane++) {
      const lx = laneX(lane);
      fillPoly(quadY(0.01, lx - 1.1, lx + 1.1, zNear, zFar), bedGrad);
    }

    // Sleepers scroll toward the camera.
    const sleeperStep = 1.2;
    for (let z = Math.ceil(zNear / sleeperStep) * sleeperStep; z < camZ + 60; z += sleeperStep) {
      ctx.globalAlpha = Math.min(1, (camZ + 60 - z) / 15);
      const near = z - camZ < 20;
      for (let lane = 0; lane < 3; lane++) {
        const lx = laneX(lane);
        fillPoly(quadY(0.03, lx - 0.95, lx + 0.95, z - 0.18, z + 0.18), "#ffe9dc", near ? "#a8436f" : null, 1);
      }
    }
    ctx.globalAlpha = 1;

    // Rails.
    const railGrad = ctx.createLinearGradient(0, HORIZON, 0, VIEW_H);
    railGrad.addColorStop(0, "rgba(255, 243, 248, 0)");
    railGrad.addColorStop(0.08, "rgba(255, 243, 248, 1)");
    for (let lane = 0; lane < 3; lane++) {
      const lx = laneX(lane);
      for (const side of [-0.55, 0.55]) {
        fillPoly(quadY(0.1, lx + side - 0.07, lx + side + 0.07, zNear, zFar), railGrad);
        fillPoly(quadX(lx + side + 0.07 * Math.sign(camX - lx - side || 1), 0.03, 0.1, zNear, zFar), "rgba(157, 42, 100, 0.8)");
      }
    }

    // Warm haze where the ground meets the sky.
    const haze = ctx.createLinearGradient(0, HORIZON - 26, 0, HORIZON + 34);
    haze.addColorStop(0, "rgba(255, 226, 180, 0)");
    haze.addColorStop(0.45, "rgba(255, 226, 180, 0.85)");
    haze.addColorStop(1, "rgba(255, 226, 180, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(-40, HORIZON - 26, VIEW_W + 80, 60);
  }

  // --- Drawing: 3D scenery ---
  function drawBuilding(b) {
    const cz = b.z0 - camZ;
    ctx.globalAlpha = fogAlpha(cz);
    const xi = b.side * b.inset;
    const xo = b.side * (b.inset + b.w);
    const detail = cz < 65;

    // Inner wall, facing the track.
    fillPoly(quadX(xi, 0, b.h, b.z0, b.z1), b.sideColor, "#9d2a64", 1.5);
    fillPoly(quadX(xi, b.h - 0.35, b.h, b.z0, b.z1), b.front);
    if (detail) {
      for (const w of b.sideWins) {
        fillPoly(quadX(xi, w.y, w.y + 0.9, w.z, w.z + 0.8), w.lit ? "#fff1c2" : "rgba(122, 20, 71, 0.55)");
      }
    }

    // Front face, visible while it's still ahead of the camera.
    if (cz > NEAR) {
      fillPoly(quadZ(b.z0, Math.min(xi, xo), Math.max(xi, xo), 0, b.h), b.front, "#9d2a64", 1.5);
      if (detail) {
        for (const w of b.frontWins) {
          const x0 = b.side * (b.inset + w.x);
          const x1 = b.side * (b.inset + w.x + 0.8);
          fillPoly(quadZ(b.z0, Math.min(x0, x1), Math.max(x0, x1), w.y, w.y + 0.9), w.lit ? "#fff1c2" : "rgba(122, 20, 71, 0.55)");
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawCar(xl, xr, z0, z1) {
    const h = CAR_H;
    // Side facing the camera.
    let sx = null;
    if (camX < xl) sx = xl;
    else if (camX > xr) sx = xr;
    if (sx !== null) {
      fillPoly(quadX(sx, 0, h, z0, z1), CAR.side, CAR.line);
      fillPoly(quadX(sx, 0, 0.28, z0, z1), CAR.skirt);
      fillPoly(quadX(sx, 0.55, 0.75, z0, z1), CAR.trim);
      for (let wz = z0 + 0.7; wz + 1.2 <= z1 - 0.4; wz += 1.9) {
        fillPoly(quadX(sx, 1.15, 1.85, wz, wz + 1.2), CAR.trim, CAR.line, 1.5);
      }
    }
    // Roof, seen just barely from the camera height.
    if (CAM_Y > h) fillPoly(quadY(h, xl, xr, z0, z1), CAR.roof, CAR.line);

    // Front: windshield with a glare, headlights, and the cream stripe.
    if (z0 - camZ > NEAR) {
      fillPoly(quadZ(z0, xl, xr, 0, h), CAR.front, CAR.line);
      fillPoly(quadZ(z0, xl, xr, 0, 0.28), CAR.skirt);
      fillPoly(quadZ(z0, xl, xr, 0.55, 0.75), CAR.trim);
      fillPoly(quadZ(z0, xl + 0.25, xr - 0.25, 1.15, 1.95), CAR.glass, CAR.line, 1.5);
      fillPoly([[xl + 0.4, 1.2, z0], [xl + 0.75, 1.2, z0], [xl + 1.15, 1.9, z0], [xl + 0.8, 1.9, z0]], "rgba(255, 255, 255, 0.35)");
      fillPoly(quadZ(z0, xl + 0.18, xl + 0.5, 0.36, 0.5), "#ffe566", CAR.line, 1);
      fillPoly(quadZ(z0, xr - 0.5, xr - 0.18, 0.36, 0.5), "#ffe566", CAR.line, 1);
    }
  }

  function drawTrain(t) {
    const xc = laneX(t.lane);
    ctx.globalAlpha = fogAlpha(t.z0 - camZ);
    // Far cars first so nearer ones overlap them.
    for (let i = t.cars - 1; i >= 0; i--) {
      const z0 = t.z0 + i * (CAR_LEN + CAR_GAP);
      if (z0 + CAR_LEN < camZ + NEAR) continue;
      drawCar(xc - CAR_HALF_W, xc + CAR_HALF_W, z0, z0 + CAR_LEN);
    }
    ctx.globalAlpha = 1;
  }

  // The outline of a tube between two projected circles (its two outer tangent lines plus arcs).
  function hullPath(x1, y1, r1, x2, y2, r2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    ctx.beginPath();
    if (d <= Math.abs(r1 - r2) + 0.01) {
      const [x, y, r] = r1 >= r2 ? [x1, y1, r1] : [x2, y2, r2];
      ctx.arc(x, y, r, 0, Math.PI * 2);
      return;
    }
    const theta = Math.atan2(y2 - y1, x2 - x1);
    const alpha = Math.acos((r1 - r2) / d);
    ctx.arc(x1, y1, r1, theta + alpha, theta - alpha + Math.PI * 2);
    ctx.arc(x2, y2, r2, theta - alpha, theta + alpha);
    ctx.closePath();
  }

  function cameraInPipe(p) {
    const px = laneX(p.lane);
    return camZ >= p.z0 - 0.8 && camZ < p.z1 - NEAR && Math.hypot(camX - px, CAM_Y - PIPE_CY) < PIPE_IN * 0.95;
  }

  // Seen from inside: pipe walls fill the screen, rings rush past, and the exit glows ahead.
  function drawTunnel(p, px) {
    const b = proj(px, PIPE_CY, p.z1);
    const br = PIPE_IN * b.s;
    const wall = ctx.createRadialGradient(b.x, b.y, br, b.x, b.y, VIEW_W);
    wall.addColorStop(0, "#ff7ab3");
    wall.addColorStop(0.2, "#b0246a");
    wall.addColorStop(1, PIPE.hole);
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.rect(-60, -60, VIEW_W + 120, VIEW_H + 120);
    ctx.moveTo(b.x + br, b.y);
    ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
    ctx.fill("evenodd");

    const ringStep = 1.5;
    for (let z = Math.ceil((camZ + 0.6) / ringStep) * ringStep; z < p.z1; z += ringStep) {
      const c = proj(px, PIPE_CY, z);
      ctx.strokeStyle = "rgba(255, 170, 210, 0.35)";
      ctx.lineWidth = Math.max(1, c.s * 0.05);
      ctx.beginPath();
      ctx.arc(c.x, c.y, PIPE_IN * c.s, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffd1e6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPipe(p) {
    const px = laneX(p.lane);
    p.hole = null;
    p.camInside = cameraInPipe(p);
    if (p.camInside) {
      drawTunnel(p, px);
      return;
    }
    if (p.z1 - camZ < NEAR + 0.5) return;

    const frontVisible = p.z0 - camZ >= 0.8;
    const f = proj(px, PIPE_CY, Math.max(p.z0, camZ + 0.8));
    const b = proj(px, PIPE_CY, p.z1);
    const fR = PIPE_R * f.s;
    const bR = PIPE_R * b.s;
    const fr = PIPE_IN * f.s;
    const br = PIPE_IN * b.s;

    ctx.save();
    ctx.globalAlpha = fogAlpha(f.cz);

    // Tube body. The front opening is left unpainted so the exit shows through.
    ctx.save();
    if (frontVisible) {
      ctx.beginPath();
      ctx.rect(-60, -60, VIEW_W + 120, VIEW_H + 120);
      ctx.moveTo(f.x + fr, f.y);
      ctx.arc(f.x, f.y, fr, 0, Math.PI * 2);
      ctx.clip("evenodd");
    }
    const body = ctx.createLinearGradient(f.x - fR, 0, f.x + fR, 0);
    body.addColorStop(0, PIPE.edge);
    body.addColorStop(0.5, PIPE.mid);
    body.addColorStop(1, PIPE.edge);
    hullPath(f.x, f.y, fR, b.x, b.y, bR);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = PIPE.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (frontVisible) {
      // Dark inside walls between the front opening and the far exit.
      ctx.save();
      ctx.beginPath();
      ctx.arc(f.x, f.y, fr, 0, Math.PI * 2);
      ctx.clip();
      const inner = ctx.createRadialGradient(b.x, b.y, br, f.x, f.y, fr);
      inner.addColorStop(0, "#7a1447");
      inner.addColorStop(1, PIPE.hole);
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.arc(f.x, f.y, fr, 0, Math.PI * 2);
      ctx.moveTo(b.x + br, b.y);
      ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
      ctx.fill("evenodd");
      for (let z = p.z0 + 1.5; z < p.z1; z += 1.5) {
        const c = proj(px, PIPE_CY, z);
        ctx.strokeStyle = "rgba(255, 122, 179, 0.25)";
        ctx.lineWidth = Math.max(1, c.s * 0.04);
        ctx.beginPath();
        ctx.arc(c.x, c.y, PIPE_IN * c.s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Front lip.
      const lip = ctx.createLinearGradient(f.x - fR, 0, f.x + fR, 0);
      lip.addColorStop(0, PIPE.lipEdge);
      lip.addColorStop(0.5, PIPE.lipMid);
      lip.addColorStop(1, PIPE.lipEdge);
      ctx.fillStyle = lip;
      ctx.beginPath();
      ctx.arc(f.x, f.y, fR, 0, Math.PI * 2);
      ctx.moveTo(f.x + fr, f.y);
      ctx.arc(f.x, f.y, fr, 0, Math.PI * 2);
      ctx.fill("evenodd");
      ctx.strokeStyle = PIPE.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, fR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.x, f.y, fr, 0, Math.PI * 2);
      ctx.stroke();
      p.hole = { x: f.x, y: f.y, r: fr };
    }
    ctx.restore();
  }

  // --- Drawing: paper-cutout sprites ---
  // Sprites are drawn in local units where 100 = one world unit, with the origin at their base.
  function drawSprite(x, y, z, fn) {
    const p = proj(x, y, z);
    if (p.cz < NEAR + 0.2) return;
    ctx.save();
    ctx.globalAlpha *= fogAlpha(p.cz);
    ctx.translate(p.x, p.y);
    ctx.scale(p.s / 100, p.s / 100);
    fn();
    ctx.restore();
  }

  function drawGroundShadow(x, y, z, radius) {
    const a = proj(x, y, z - radius * 0.45);
    const b = proj(x, y, z + radius * 0.45);
    if (a.cz < NEAR + 0.2) return;
    const c = proj(x, y, z);
    ctx.fillStyle = "rgba(90, 15, 54, 0.22)";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, radius * c.s, Math.max(1, Math.abs(a.y - b.y) / 2), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The bun seen from behind, feet pattering.
  function drawBunBack(runT, squash, grounded, flip = 1) {
    const widen = 1 + squash * 0.12;
    const stretch = 1 - squash * 0.14;
    const step = grounded ? Math.sin(runT) : 0;
    const lf = grounded ? Math.max(0, step) * 9 : 5;
    const rf = grounded ? Math.max(0, -step) * 9 : 5;
    const facingFront = flip < 0;

    ctx.save();
    ctx.scale(flip * widen, stretch);
    const feet = new Path2D();
    feet.roundRect(-27, -12 - lf, 17, 12, 6);
    feet.roundRect(10, -12 - rf, 17, 12, 6);
    const k = 0.37;

    ctx.fillStyle = "#111";
    ctx.fill(feet);

    ctx.save();
    ctx.translate(-50, -100);
    ctx.scale(k, k);
    const g = ctx.createLinearGradient(0, 0, 0, 255);
    g.addColorStop(0, SKIN.stops[0]);
    g.addColorStop(0.5, SKIN.stops[1]);
    g.addColorStop(0.78, SKIN.stops[2]);
    g.addColorStop(1, SKIN.stops[3]);
    ctx.fillStyle = g;
    ctx.fill(PLAYER_PATH);
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.strokeStyle = SKIN.outline;
    ctx.stroke(PLAYER_PATH);
    drawSkinDecor();
    ctx.restore();

    if (facingFront) {
      // Flipped around mid-crash: dizzy X eyes.
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const ex of [-11, 11]) {
        ctx.beginPath();
        ctx.moveTo(ex - 5, -55);
        ctx.lineTo(ex + 5, -45);
        ctx.moveTo(ex + 5, -55);
        ctx.lineTo(ex - 5, -45);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCoinSprite(t) {
    const spin = Math.abs(Math.cos(t));
    const rx = Math.max(4, 24 * spin);
    const ry = 26;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f7d21e";
    ctx.strokeStyle = "#c99a00";
    ctx.lineWidth = 4;
    ctx.fill();
    ctx.stroke();
    if (rx > 9) {
      ctx.fillStyle = "#c9a008";
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBarrier() {
    ctx.fillStyle = "#7a1447";
    ctx.fillRect(-80, -88, 12, 88);
    ctx.fillRect(68, -88, 12, 88);
    ctx.fillRect(-90, -8, 32, 8);
    ctx.fillRect(58, -8, 32, 8);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-96, -86, 192, 42, 6);
    ctx.clip();
    ctx.fillStyle = "#fff3d6";
    ctx.fillRect(-96, -86, 192, 42);
    ctx.fillStyle = "#ff5fa2";
    for (let x = -120; x < 110; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, -44);
      ctx.lineTo(x + 18, -44);
      ctx.lineTo(x + 40, -86);
      ctx.lineTo(x + 22, -86);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "#7a1447";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-96, -86, 192, 42, 6);
    ctx.stroke();
  }

  function drawCones() {
    for (const cx of [-62, 0, 62]) {
      const g = ctx.createLinearGradient(cx - 24, 0, cx + 24, 0);
      g.addColorStop(0, "#ea580c");
      g.addColorStop(0.5, "#ff8a1f");
      g.addColorStop(1, "#ea580c");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - 8, -80);
      ctx.lineTo(cx + 8, -80);
      ctx.lineTo(cx + 24, -10);
      ctx.lineTo(cx - 24, -10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#9a3412";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#fff3d6";
      ctx.beginPath();
      ctx.moveTo(cx - 13, -58);
      ctx.lineTo(cx + 13, -58);
      ctx.lineTo(cx + 17, -42);
      ctx.lineTo(cx - 17, -42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#c2410c";
      ctx.fillRect(cx - 30, -10, 60, 10);
    }
  }

  function drawLamp(side) {
    ctx.fillStyle = "#b8336f";
    ctx.fillRect(-5, -320, 10, 320);
    ctx.fillStyle = "#7a1447";
    ctx.beginPath();
    ctx.roundRect(-5 + side * -2, -336, side * -48, 18, 6);
    ctx.fill();
    const lx = side * -40;
    const glow = ctx.createRadialGradient(lx, -318, 2, lx, -318, 48);
    glow.addColorStop(0, "rgba(255, 229, 102, 0.75)");
    glow.addColorStop(1, "rgba(255, 229, 102, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, -318, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe566";
    ctx.beginPath();
    ctx.ellipse(lx, -316, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayer() {
    const crashing = state === "crashing" || state === "over";
    const x = player.x + player.bump * 0.35;
    const y = player.y + player.floor;
    drawGroundShadow(x, player.floor, player.z, 0.45 * Math.max(0.4, 1 - player.y / 3));
    drawSprite(x, y, player.z, () => {
      ctx.rotate(crashing ? Math.sin(player.crashSpin) * 0.5 : player.tilt * 0.2 + player.bump * 0.15);
      const flip = crashing ? Math.cos(player.flip) : 1;
      drawBunBack(player.runT, crashing ? 0 : player.squash, player.grounded && !crashing, Math.abs(flip) < 0.08 ? 0.08 * Math.sign(flip || 1) : flip);
    });
  }

  // --- Drawing: sorted scene ---
  function drawScene() {
    [...buildings].sort((a, b) => b.z0 - a.z0).forEach(drawBuilding);

    const list = [];
    for (const t of trains) list.push({ key: t.z0, draw: () => drawTrain(t) });
    for (const p of pipes) list.push({ key: p.z0, pipe: p, draw: () => drawPipe(p) });
    for (const h of hurdles) {
      list.push({
        key: h.z,
        draw: () => {
          drawGroundShadow(laneX(h.lane), 0, h.z, 0.9);
          drawSprite(laneX(h.lane), 0, h.z, h.kind === "barrier" ? drawBarrier : drawCones);
        },
      });
    }
    for (const l of lamps) {
      const x = l.side * (1.5 * LANE_W + 1.1);
      list.push({ key: l.z, draw: () => drawSprite(x, 0, l.z, () => drawLamp(l.side)) });
    }
    for (const c of coinList) {
      if (c.taken) continue;
      const host = pipeAt(c.lane, c.z);
      list.push({
        key: host ? host.z0 - 0.001 : c.z,
        host,
        draw: () => drawSprite(laneX(c.lane), c.y + Math.sin(animTime * 3 + c.z) * 0.06, c.z, () => drawCoinSprite(animTime * 5 + c.z * 0.4)),
      });
    }
    const playerHost = state === "running" ? pipeAt(playerLane(), player.z) : null;
    list.push({ key: playerHost ? playerHost.z0 - 0.001 : player.z, host: playerHost, draw: drawPlayer });

    // Farthest first; things inside a pipe draw right after it, seen only through its opening.
    list.sort((a, b) => b.key - a.key);
    for (const item of list) {
      if (item.host && !item.host.camInside) {
        if (!item.host.hole) continue;
        ctx.save();
        ctx.beginPath();
        ctx.arc(item.host.hole.x, item.host.hole.y, item.host.hole.r, 0, Math.PI * 2);
        ctx.clip();
        item.draw();
        ctx.restore();
      } else {
        item.draw();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const s = proj(p.x, p.y, p.z);
      if (s.cz < NEAR + 0.3) continue;
      const r = Math.max(0.6, p.size * s.s);
      ctx.fillStyle = "#ffffff";
      if (p.kind === "spark") {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(p.angle);
        drawSparkleShape(r);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

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

  // Streaks flying out from the vanishing point once the run gets fast.
  function drawSpeedLines() {
    const k = (speed - 20) / (MAX_SPEED - 20);
    if (state !== "running" || k <= 0) return;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * k})`;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 280 + Math.random() * 120;
      const r1 = r0 + 60 + Math.random() * 120 * k;
      ctx.beginPath();
      ctx.moveTo(VIEW_W / 2 + Math.cos(a) * r0, HORIZON + Math.sin(a) * r0 * 0.7);
      ctx.lineTo(VIEW_W / 2 + Math.cos(a) * r1, HORIZON + Math.sin(a) * r1 * 0.7);
      ctx.stroke();
    }
    ctx.restore();
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

  function drawCoinIcon(cx, cy, scale = 1) {
    const rx = 10 * scale;
    const ry = 12 * scale;
    ctx.fillStyle = "#f7d21e";
    ctx.strokeStyle = "#c99a00";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c9a008";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHud() {
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font = `14px ${FONT}`;
    const hudY = 12;
    const hudH = 48;
    const centerY = hudY + hudH / 2;

    drawPanel(14, hudY, 190, hudH);
    ctx.fillStyle = "#1f2a37";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.floor(player.z)} M`, 14 + 95, centerY + 1);

    drawPanel(214, hudY, 120, hudH);
    drawCoinIcon(240, centerY, 0.85);
    ctx.fillStyle = "#1f2a37";
    ctx.textAlign = "left";
    ctx.fillText(`×${coins}`, 256, centerY + 1);

    const bestW = 200;
    drawPanel(VIEW_W - 14 - bestW, hudY, bestW, hudH);
    ctx.fillStyle = "#1f2a37";
    ctx.textAlign = "center";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`BEST ${Math.max(best, Math.floor(player.z))} M`, VIEW_W - 14 - bestW / 2, centerY + 1);
    ctx.restore();
  }

  function drawBanner() {
    if (!banner) return;
    const elapsed = banner.dur - banner.t;
    const alpha = Math.min(1, elapsed / 0.15, banner.t / 0.3);
    const pop = 1 + Math.max(0, 0.25 - elapsed) * 1.6;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(VIEW_W / 2, VIEW_H * 0.3);
    ctx.scale(pop, pop);
    ctx.font = `32px ${FONT}`;
    ctx.fillStyle = "rgba(122, 20, 71, 0.45)";
    ctx.fillText(banner.text, 3, 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(banner.text, 0, 0);
    if (banner.sub) {
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = "rgba(122, 20, 71, 0.45)";
      ctx.fillText(banner.sub, 2, 44);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(banner.sub, 0, 42);
    }
    ctx.restore();
  }

  function drawTitle() {
    ctx.save();
    ctx.fillStyle = "rgba(90, 15, 54, 0.45)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `40px ${FONT}`;
    ctx.fillStyle = "rgba(122, 20, 71, 0.6)";
    ctx.fillText("BUN EXPRESS", VIEW_W / 2 + 4, 110);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("BUN EXPRESS", VIEW_W / 2, 106);
    ctx.font = `12px ${FONT}`;
    ctx.fillText("A / D OR LEFT / RIGHT — SWITCH LANES", VIEW_W / 2, 176);
    ctx.fillText("W / UP / SPACE — JUMP", VIEW_W / 2, 204);
    ctx.fillText("ON TOUCH: SWIPE TO STEER, TAP TO JUMP", VIEW_W / 2, 232);
    ctx.fillText("DODGE THE TRAINS AND HOP THE BARRIERS, BUT RUN RIGHT THROUGH THE PIPES", VIEW_W / 2, 272);
    if (best > 0) {
      ctx.fillStyle = "#ffc857";
      ctx.fillText(`BEST RUN ${best} M`, VIEW_W / 2, 312);
    }
    if (Math.floor(animTime * 2) % 2 === 0) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `16px ${FONT}`;
      ctx.fillText("PRESS SPACE OR CLICK TO RUN", VIEW_W / 2, 360);
    }
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
    ctx.fillText("GAME OVER!", VIEW_W / 2, VIEW_H / 2 - 70);
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`YOU RAN ${Math.floor(player.z)} M`, VIEW_W / 2, VIEW_H / 2 - 10);
    ctx.fillText(`COINS ${coins}`, VIEW_W / 2, VIEW_H / 2 + 18);
    ctx.fillStyle = "#ffc857";
    ctx.fillText(`BEST RUN ${best} M`, VIEW_W / 2, VIEW_H / 2 + 46);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("PRESS SPACE, R, OR CLICK TO RUN AGAIN", VIEW_W / 2, VIEW_H / 2 + 96);
    ctx.restore();
  }

  function draw() {
    syncCanvasResolution();
    if (state === "over") {
      drawGameOver();
      return;
    }

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawSky();
    drawClouds();
    drawSkyline();
    drawGround();
    drawScene();
    drawParticles();
    ctx.restore();

    drawSpeedLines();
    if (state === "title") {
      drawTitle();
      return;
    }
    drawHud();
    drawBanner();
    if (fadeAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
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
  function startOrRestart() {
    if (state === "title" || (state === "over" && stateTimer <= 0)) {
      startRun();
      return true;
    }
    return false;
  }

  window.addEventListener("keydown", (e) => {
    ensureAudio();
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (["Space", "Enter", "KeyR"].includes(e.code) && startOrRestart()) return;
    if (e.code === "KeyA" || e.code === "ArrowLeft") tryLane(-1);
    if (e.code === "KeyD" || e.code === "ArrowRight") tryLane(1);
    if (e.code === "KeyW" || e.code === "ArrowUp" || e.code === "Space") tryJump();
  });

  let swipe = null;
  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    swipe = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const rect = canvas.getBoundingClientRect();
    const scale = VIEW_W / rect.width;
    const dx = (e.clientX - swipe.x) * scale;
    const dy = (e.clientY - swipe.y) * scale;
    swipe = null;
    if (startOrRestart()) return;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) tryLane(dx > 0 ? 1 : -1);
    else tryJump();
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const fontReady = document.fonts ? document.fonts.load(`12px ${FONT}`).catch(() => {}) : Promise.resolve();
  fontReady.then(() => {
    resetWorld();
    lastTime = performance.now();
    requestAnimationFrame(frame);
  });
})();
