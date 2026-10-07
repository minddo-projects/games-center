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
  let COLS = 80;
  let ROWS = 11;
  // Logical game resolution (drawing coordinates). The canvas bitmap is scaled up separately.
  const VIEW_W = 20 * TILE;
  let VIEW_H = ROWS * TILE;
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

  const GRAVITY = 2200; // Used by non-player physics such as mushrooms.
  const MOVE_SPEED = 260;

  // Platformer jump tuning. The player gets ONE launch impulse. Holding jump
  // simply allows that impulse to play out; releasing early cuts upward speed.
  const PLAYER_RISE_GRAVITY = 1700;
  const PLAYER_FALL_GRAVITY = 2100;
  const JUMP_HEIGHT_TAP = TILE * 1;
  const JUMP_HEIGHT_MAX = TILE * 4;
  const JUMP_VELOCITY_TAP = -Math.sqrt(2 * PLAYER_RISE_GRAVITY * JUMP_HEIGHT_TAP);
  const JUMP_VELOCITY_MAX = -Math.sqrt(2 * PLAYER_RISE_GRAVITY * JUMP_HEIGHT_MAX);
  const STOMP_BOUNCE = -Math.sqrt(2 * PLAYER_RISE_GRAVITY * TILE * 0.9);
  const MAX_FALL = 980;
  const MUSHROOM_SPEED = 90;
  const PLAYER_HITBOX_W = TILE * 0.8;
  const PLAYER_SMALL_H = TILE;
  const PLAYER_BIG_H = TILE * 1.75;
  const LEVEL_TIME = 30;
  const DEATH_FLING_TIME = 0.72;
  const FADE_TIME = 0.42;

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
    jump() {
      playTone({ freq: 360, freqEnd: 620, type: "square", dur: 0.1, vol: 0.07 });
    },
    coin() {
      playTone({ freq: 988, type: "square", dur: 0.06, vol: 0.07 });
      playTone({ freq: 1319, type: "square", dur: 0.12, vol: 0.07, delay: 0.06 });
    },
    stomp() {
      playTone({ freq: 220, freqEnd: 90, type: "square", dur: 0.12, vol: 0.09 });
      playNoise({ dur: 0.06, vol: 0.04, delay: 0.02 });
    },
    bump() {
      playTone({ freq: 160, freqEnd: 110, type: "triangle", dur: 0.07, vol: 0.06 });
    },
    breakBrick() {
      playNoise({ dur: 0.1, vol: 0.06 });
      playTone({ freq: 280, freqEnd: 90, type: "square", dur: 0.12, vol: 0.05 });
    },
    powerup() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.09, vol: 0.07, delay: i * 0.07 });
      });
    },
    hurt() {
      playTone({ freq: 320, freqEnd: 140, type: "sawtooth", dur: 0.18, vol: 0.07 });
    },
    death() {
      const notes = [440, 392, 349, 294, 220];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.14, vol: 0.07, delay: i * 0.11 });
      });
    },
    win() {
      const notes = [523, 659, 784, 1047, 784, 1047];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: "square", dur: 0.1, vol: 0.07, delay: i * 0.09 });
      });
    },
  };

  // Original looping chiptune (not from any commercial game).
  // Bright construction-site bounce in C major with a different contour and rhythm.
  const NOTE_FREQ = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  };
  const MUSIC_STEP = 0.12;
  // Phrase A: rising scaffolds. Phrase B: wide skips. Phrase C: punchy cadence.
  const MUSIC_MELODY = [
    "C5", null, "E5", "G5", null, "E5", "C5", null,
    "D5", null, "F5", "A5", null, "F5", "D5", null,
    "E5", "G5", null, "B5", null, "G5", "E5", null,
    "F5", null, "D5", "C5", null, null, "G4", null,

    "A4", "C5", "E5", null, "G5", null, "E5", "C5",
    "B4", "D5", "F5", null, "A5", null, "F5", "D5",
    "C5", null, "G5", null, "E5", null, "C5", null,
    "D5", "E5", "F5", "G5", null, "E5", "C5", null,
  ];
  const MUSIC_BASS = [
    "C3", null, null, "C3", "G3", null, null, "G3",
    "D3", null, null, "D3", "A3", null, null, "A3",
    "E3", null, null, "E3", "B3", null, null, "B3",
    "F3", null, "F3", null, "G3", null, "G3", null,

    "A3", null, null, "A3", "E3", null, null, "E3",
    "B3", null, null, "B3", "F3", null, null, "F3",
    "C3", null, "G3", null, "C3", null, "G3", null,
    "F3", null, "G3", null, "C3", null, null, null,
  ];

  let musicGain = null;
  let musicPlaying = false;
  let musicTimer = null;
  let musicStepIndex = 0;

  function playMusicNote(freq, type, dur, vol) {
    const ctxA = ensureAudio();
    if (!ctxA || !musicGain || !freq) return;
    const t0 = ctxA.currentTime;
    const osc = ctxA.createOscillator();
    const gain = ctxA.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
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
    if (m) playMusicNote(NOTE_FREQ[m], "square", MUSIC_STEP * 0.85, 0.035);
    if (b) playMusicNote(NOTE_FREQ[b], "triangle", MUSIC_STEP * 0.9, 0.05);
    // Soft off-beat pulse for a drum-ish feel.
    if (musicStepIndex % 4 === 0) {
      playNoise({ dur: 0.035, vol: 0.018 });
    } else if (musicStepIndex % 4 === 2) {
      playNoise({ dur: 0.02, vol: 0.01 });
    }

    musicStepIndex += 1;
    musicTimer = setTimeout(musicTick, MUSIC_STEP * 1000);
  }

  function startMusic() {
    const ctxA = ensureAudio();
    if (!ctxA) return;
    if (!musicGain) {
      musicGain = ctxA.createGain();
      musicGain.gain.value = 0.55;
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

  // Level is stored as level.png: one pixel per tile, one RGB color per type.
  // . empty  # ground  B brick  ? item box  G decorative solid pipe
  // C coin  E enemy  F flag  P player
  const LEVEL_IMAGE_URL = "level.png";
  // Same-origin data URL fallback when canvas would be tainted (file:// / odd embeds).
  const LEVEL_IMAGE_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAALBAMAAAAadheqAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAbUExURQAAAP/cAABQ3P8AyBQUeP9kAAD/UP///wC0/yxmHaIAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACBSURBVCjPjY67DYAwDEQvBgQl2SAyCyAmoPAAGYFRKBkb8gEcIaRc4fNZz7KBGpmxCgM0Zyxg78Dz/xItMGrz7YiB9fNLQMZoWm0BekAeglwehWrlBRswuwjS4iRhoMmFwhpMktKMTZ9mcLtPZKIL5mPKcy9rDxyF9idj0HY1teAJk3Qv6D1InvgAAAAASUVORK5CYII=";
  const LEVEL_PIXEL_TO_CHAR = {
    "0,0,0": ".",
    "0,180,255": "#",
    "0,80,220": "B",
    "255,0,200": "?",
    "20,20,120": "G",
    "255,220,0": "C",
    "255,100,0": "E",
    "255,255,255": "F",
    "0,255,80": "P",
  };
  /** @type {string[]} */
  let LEVEL_MAP = [];

  function applyLevelPixels(data, width, height) {
    COLS = width;
    ROWS = height;
    VIEW_H = ROWS * TILE;
    LEVEL_W = COLS * TILE;
    LEVEL_H = ROWS * TILE;
    syncCanvasResolution();

    const rows = [];
    for (let r = 0; r < height; r++) {
      let row = "";
      for (let c = 0; c < width; c++) {
        const i = (r * width + c) * 4;
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        row += LEVEL_PIXEL_TO_CHAR[key] || ".";
      }
      rows.push(row);
    }
    LEVEL_MAP = rows;
  }

  async function decodeLevelBitmap(source) {
    // Fetch/blob/data-URL bitmaps are origin-clean, so getImageData will not taint.
    const bitmap = await createImageBitmap(source);
    const off = document.createElement("canvas");
    off.width = bitmap.width;
    off.height = bitmap.height;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
    applyLevelPixels(data, width, height);
  }

  async function loadLevelFromImage(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await decodeLevelBitmap(blob);
    } catch (err) {
      console.warn("level.png fetch failed, using embedded level data URL", err);
      const res = await fetch(LEVEL_IMAGE_DATA_URL);
      const blob = await res.blob();
      await decodeLevelBitmap(blob);
    }
  }

  const keys = new Set();
  let state = "start";
  let lastTime = 0;
  let cameraX = 0;
  let coins = 0;
  let lives = 3;
  let invulnTimer = 0;
  let animTime = 0;
  let bumpFlash = [];
  let brickDebris = [];
  let coinSparkles = [];
  let flungHats = [];
  let dustParticles = [];
  let walkDustTimer = 0;
  let rainbowSparkles = [];
  let jumpKeyWasDown = false;
  let jumpOriginY = 0;
  let jumpArmed = false;
  let timeLeft = LEVEL_TIME;
  let deathPhase = "";
  let deathTimer = 0;
  let deathKind = "";
  let deathMessage = "";
  let fadeAlpha = 0;
  let playerDeathAngle = 0;
  let playerDeathSpin = 0;

  const player = {
    x: TILE * 2 + (TILE - PLAYER_HITBOX_W) / 2,
    y: TILE * 8,
    w: PLAYER_HITBOX_W,
    h: PLAYER_SMALL_H,
    vx: 0,
    vy: 0,
    onGround: false,
    facing: 1,
    big: false,
  };

  const BUN_PATH = new Path2D(`
    M 18 220
    C 20 130, 72 22, 135 22
    C 198 22, 250 130, 252 220
    L 252 237
    L 18 237
    Z
  `);

  /** @type {{c:number,r:number,type:string,used?:boolean,bump?:number}[]} */
  let tiles = [];
  /** @type {{x:number,y:number,w:number,h:number,vx:number,alive:boolean,dir:number}[]} */
  let enemies = [];
  /** @type {{x:number,y:number,taken:boolean}[]} */
  let coinList = [];
  /** @type {{x:number,y:number,w:number,h:number,vx:number,dir:number,active:boolean}[]} */
  let mushrooms = [];
  let flag = { x: 0, y: 0, w: TILE * 0.3, h: TILE * 5 };
  let spawn = { x: TILE * 2, y: TILE * 8 };

  function tileAt(c, r) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return tiles[r * COLS + c];
  }

  function solidTiles() {
    return tiles.filter((t) => {
      if (t.type === "#" || t.type === "B" || t.type === "G") return true;
      if (t.type === "?") return true;
      return false;
    });
  }

  function tileRect(t) {
    return { x: t.c * TILE, y: t.r * TILE, w: TILE, h: TILE, tile: t };
  }

  function buildLevel() {
    tiles = [];
    enemies = [];
    coinList = [];
    mushrooms = [];
    bumpFlash = [];
    brickDebris = [];
    coinSparkles = [];
    flungHats = [];
    dustParticles = [];
    walkDustTimer = 0;
    rainbowSparkles = [];

    for (let r = 0; r < ROWS; r++) {
      const row = LEVEL_MAP[r] || "".padEnd(COLS, ".");
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] || ".";
        const type = ch === "P" ? "." : ch === "E" || ch === "C" || ch === "F" ? "." : ch;
        const tile = { c, r, type, used: false, bump: 0 };
        if (ch === "?") tile.type = "?";
        tiles.push(tile);

        if (ch === "P") {
          spawn = { x: c * TILE, y: r * TILE };
        } else if (ch === "E") {
          enemies.push({
            x: c * TILE,
            y: r * TILE,
            w: TILE,
            h: TILE,
            vx: 70,
            vy: 0,
            alive: true,
            defeated: false,
            angle: 0,
            spin: 0,
            dir: -1,
          });
        } else if (ch === "C") {
          coinList.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, taken: false });
        } else if (ch === "F") {
          flag = { x: c * TILE + TILE * 0.35, y: (r - 4) * TILE, w: TILE * 0.3, h: TILE * 5 };
        }
      }
    }

    // Place flag near the end if map has no F
    if (!LEVEL_MAP.some((row) => row.includes("F"))) {
      flag = { x: (COLS - 4) * TILE + TILE * 0.35, y: (ROWS - 7) * TILE, w: TILE * 0.3, h: TILE * 5 };
    }
  }

  function setPlayerHat(hasHat) {
    const oldBottom = player.y + player.h;
    const oldCenterX = player.x + player.w / 2;
    const gainingHat = hasHat && !player.big;
    player.big = hasHat;
    player.w = PLAYER_HITBOX_W;
    player.h = hasHat ? PLAYER_BIG_H : PLAYER_SMALL_H;
    player.x = oldCenterX - player.w / 2;
    player.y = oldBottom - player.h;
    if (gainingHat) {
      spawnRainbowSparkles(player.x + player.w / 2, player.y + player.h * 0.35);
      sfx.powerup();
    }
  }

  function spawnRainbowSparkles(x, y) {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 90 + Math.random() * 160;
      rainbowSparkles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.55 + Math.random() * 0.35,
        maxLife: 0.9,
        size: 4 + Math.random() * 4,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 14,
        hue: (i / count) * 360,
      });
    }
  }

  function flingPlayerHat() {
    if (!player.big) return;
    const bodyH = PLAYER_SMALL_H;
    const bodyY = player.y + player.h - bodyH;
    const bunTop = bodyY + (22 / 255) * bodyH;
    const hatSize = TILE * 0.92;
    const flingDir = player.facing >= 0 ? -1 : 1;

    flungHats.push({
      x: player.x + player.w / 2,
      y: bunTop - hatSize * 0.12,
      size: hatSize,
      facing: player.facing,
      vx: flingDir * (220 + Math.random() * 80),
      vy: -420 - Math.random() * 80,
      angle: 0,
      spin: flingDir * (8 + Math.random() * 4),
      active: true,
    });
    setPlayerHat(false);
    sfx.hurt();
  }

  function resetPlayer(fullRestart) {
    if (fullRestart) {
      coins = 0;
      lives = 3;
      buildLevel();
    }
    player.big = false;
    player.w = PLAYER_HITBOX_W;
    player.h = PLAYER_SMALL_H;
    player.x = spawn.x + (TILE - player.w) / 2;
    player.y = spawn.y + (TILE - player.h);
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.facing = 1;
    cameraX = 0;
    invulnTimer = 0;
    jumpKeyWasDown = false;
    jumpArmed = false;
    playerDeathAngle = 0;
    playerDeathSpin = 0;
    mushrooms = [];
    flungHats = [];
    dustParticles = [];
    walkDustTimer = 0;
    rainbowSparkles = [];
    updateHud();
  }

  function updateHud() {}

  // Fresh level behind the title card; play begins on the first Space/Enter/click.
  function showTitle() {
    startGame();
    state = "title";
    stopMusic();
  }

  function startGame() {
    resetPlayer(true);
    timeLeft = LEVEL_TIME;
    deathPhase = "";
    deathTimer = 0;
    deathKind = "";
    deathMessage = "";
    fadeAlpha = 0;
    state = "playing";
    lastTime = performance.now();
    startMusic();
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function spawnMushroom(tile) {
    mushrooms.push({
      x: tile.c * TILE,
      y: tile.r * TILE - TILE,
      w: TILE,
      h: TILE,
      vx: MUSHROOM_SPEED,
      vy: 0,
      dir: 1,
      angle: 0,
      active: true,
    });
  }

  function hitItemBoxFromBelow(tile) {
    if (tile.type !== "?" || tile.used) return;
    tile.used = true;
    tile.bump = 0.18;
    spawnMushroom(tile);
    bumpFlash.push({ c: tile.c, r: tile.r, t: 0.2 });
    sfx.bump();
  }

  function breakBrick(tile) {
    if (!tile || tile.type !== "B") return;

    const cx = tile.c * TILE + TILE / 2;
    const cy = tile.r * TILE + TILE / 2;
    const debrisSize = TILE * 0.28;

    // Remove the brick immediately so the player can pass through the space.
    tile.type = ".";

    // Four lightweight chunks give the break a classic platformer feel.
    brickDebris.push(
      { x: cx - TILE * 0.22, y: cy - TILE * 0.18, vx: -150, vy: -330, size: debrisSize, spin: -5, angle: 0, life: 0.7 },
      { x: cx + TILE * 0.04, y: cy - TILE * 0.18, vx:  150, vy: -330, size: debrisSize, spin:  5, angle: 0, life: 0.7 },
      { x: cx - TILE * 0.22, y: cy + TILE * 0.05, vx: -105, vy: -230, size: debrisSize, spin: -7, angle: 0, life: 0.7 },
      { x: cx + TILE * 0.04, y: cy + TILE * 0.05, vx:  105, vy: -230, size: debrisSize, spin:  7, angle: 0, life: 0.7 }
    );
    sfx.breakBrick();
  }

  function hitBlockFromBelow(tile) {
    if (!tile) return;
    if (tile.type === "?") {
      hitItemBoxFromBelow(tile);
    } else if (tile.type === "B") {
      if (player.big) breakBrick(tile);
      else {
        tile.bump = 0.12;
        sfx.bump();
      }
    }
  }

  function resolveSolidCollisions(entity, moveX, moveY, options = {}) {
    const solids = solidTiles().map(tileRect);
    let onGround = false;
    let hitCeilingTile = null;

    entity.x += moveX;
    for (const s of solids) {
      if (!aabb(entity, s)) continue;
      if (moveX > 0) entity.x = s.x - entity.w;
      else if (moveX < 0) entity.x = s.x + s.w;
      if ("vx" in entity) entity.vx = 0;
      if ("dir" in entity && options.bounceDir) entity.dir *= -1;
    }

    entity.y += moveY;
    for (const s of solids) {
      if (!aabb(entity, s)) continue;
      if (moveY > 0) {
        entity.y = s.y - entity.h;
        if ("vy" in entity) entity.vy = 0;
        onGround = true;
      } else if (moveY < 0) {
        entity.y = s.y + s.h;
        if ("vy" in entity) entity.vy = 0;
        if (options.trackCeiling) hitCeilingTile = s.tile;
      }
    }

    return { onGround, hitCeilingTile };
  }

  function entityOnGroundEdge(entity) {
    const footX = entity.dir > 0 ? entity.x + entity.w + 2 : entity.x - 2;
    const probe = { x: footX, y: entity.y + entity.h + 2, w: 4, h: 6 };
    return solidTiles().map(tileRect).some((s) => aabb(probe, s));
  }

  function updatePlayer(dt) {
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
    const jumpDown =
      keys.has("ArrowUp") ||
      keys.has("w") ||
      keys.has("W") ||
      keys.has(" ") ||
      keys.has("Space");
    const jumpPressed = jumpDown && !jumpKeyWasDown;
    const jumpReleased = !jumpDown && jumpKeyWasDown;
    jumpKeyWasDown = jumpDown;

    if (left && !right) {
      player.vx = -MOVE_SPEED;
      player.facing = -1;
    } else if (right && !left) {
      player.vx = MOVE_SPEED;
      player.facing = 1;
    } else {
      player.vx = 0;
    }

    if (jumpPressed && player.onGround) {
      // One launch impulse, like a conventional platformer jump.
      // With the key held, this naturally rises to about 4 tiles.
      player.vy = JUMP_VELOCITY_MAX;
      player.onGround = false;
      jumpOriginY = player.y;
      jumpArmed = true;
      sfx.jump();
    }

    // Variable jump height (jump cut): if jump is released while rising,
    // cap the remaining upward speed to the 1-tile short-hop velocity.
    // No extra upward force is applied while the key is held.
    if (jumpReleased && jumpArmed && player.vy < JUMP_VELOCITY_TAP) {
      player.vy = JUMP_VELOCITY_TAP;
      jumpArmed = false;
    }

    // Slightly gentler gravity on the way up and firmer gravity on the way
    // down gives a readable arc without the previous jetpack / brick-drop feel.
    const playerGravity = player.vy < 0 ? PLAYER_RISE_GRAVITY : PLAYER_FALL_GRAVITY;
    player.vy = Math.min(MAX_FALL, player.vy + playerGravity * dt);

    player.onGround = false;
    resolveSolidCollisions(player, player.vx * dt, 0);
    const vertical = resolveSolidCollisions(player, 0, player.vy * dt, { trackCeiling: true });
    player.onGround = vertical.onGround;
    if (player.onGround || player.vy >= 0) jumpArmed = false;

    if (vertical.hitCeilingTile && player.vy <= 0) {
      hitBlockFromBelow(vertical.hitCeilingTile);
      jumpArmed = false;
    }

    if (player.vy < 0) {
      const headC = Math.floor((player.x + player.w / 2) / TILE);
      const headR = Math.floor((player.y - 1) / TILE);
      const above = tileAt(headC, headR);
      if (above && above.type === "?" && !above.used) {
        const box = tileRect(above);
        if (aabb(player, box)) hitItemBoxFromBelow(above);
      }
    }

    if (player.y > LEVEL_H + TILE) {
      beginDeath("pit");
    }

    // Walking dust trail behind the player.
    walkDustTimer -= dt;
    if (player.onGround && Math.abs(player.vx) > 20 && walkDustTimer <= 0) {
      walkDustTimer = 0.045;
      const behind = player.facing >= 0 ? player.x : player.x + player.w;
      dustParticles.push({
        x: behind + (Math.random() - 0.5) * 6,
        y: player.y + player.h - 2,
        vx: -player.facing * (20 + Math.random() * 35),
        vy: -20 - Math.random() * 40,
        life: 0.28 + Math.random() * 0.18,
        size: 2.5 + Math.random() * 3.5,
        color: "#ffffff",
      });
    }
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      if (enemy.defeated) {
        enemy.vy = Math.min(MAX_FALL * 1.25, enemy.vy + GRAVITY * 0.9 * dt);
        enemy.x += enemy.vx * dt;
        enemy.y += enemy.vy * dt;
        enemy.angle += enemy.spin * dt;
        if (enemy.y > LEVEL_H + TILE * 2) enemy.alive = false;
        continue;
      }

      const nextX = enemy.x + enemy.dir * enemy.vx * dt;
      const body = { x: nextX, y: enemy.y, w: enemy.w, h: enemy.h };
      const blocked = solidTiles().map(tileRect).some((s) => aabb(body, s));
      if (blocked || !entityOnGroundEdge({ ...enemy, x: nextX })) {
        enemy.dir *= -1;
      } else {
        enemy.x = nextX;
      }

      if (invulnTimer > 0) continue;
      if (!aabb(player, enemy)) continue;

      const stomping = player.vy > 0 && player.y + player.h - enemy.y < TILE * 0.45;
      if (stomping) {
        enemy.defeated = true;
        enemy.vx = (player.facing >= 0 ? 1 : -1) * 190;
        enemy.vy = -520;
        enemy.spin = (player.facing >= 0 ? 1 : -1) * 9;
        player.vy = STOMP_BOUNCE;
        jumpArmed = false;
        spawnStompDust(enemy.x + enemy.w / 2, enemy.y + enemy.h * 0.35);
        sfx.stomp();
      } else if (player.big) {
        flingPlayerHat();
        invulnTimer = 1.4;
      } else {
        beginDeath("goomba");
      }
    }
  }

  function updateMushrooms(dt) {
    for (const m of mushrooms) {
      if (!m.active) continue;

      m.vy = (m.vy || 0) + GRAVITY * dt;
      m.vy = Math.min(MAX_FALL, m.vy);

      const moveX = m.dir * m.vx * dt;
      const nextX = m.x + moveX;
      const body = { x: nextX, y: m.y, w: m.w, h: m.h };
      const blocked = solidTiles().map(tileRect).some((s) => aabb(body, s));
      if (blocked) {
        m.dir *= -1;
      } else {
        // Mushrooms do not turn around at ledges; they walk off and fall.
        m.x = nextX;
        // Roll with travel distance so the marble rotates as it moves.
        m.angle += moveX / (m.w * 0.5);
      }

      const vert = resolveSolidCollisions(m, 0, m.vy * dt);
      if (vert.onGround) m.vy = 0;

      if (aabb(player, m)) {
        m.active = false;
        if (!player.big) setPlayerHat(true);
      }

      if (m.y > LEVEL_H + TILE) m.active = false;
    }
  }

  function spawnStompDust(x, y) {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const speed = 80 + Math.random() * 140;
      dustParticles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.25,
        size: 3 + Math.random() * 5,
        color: "#ffffff",
      });
    }
  }

  function spawnCoinSparkle(x, y) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.25;
      const speed = 70 + Math.random() * 90;
      coinSparkles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25,
        life: 0.34 + Math.random() * 0.18,
        maxLife: 0.52,
        size: 2.5 + Math.random() * 2.5,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 10,
      });
    }
  }

  function updateCoins() {
    for (const coin of coinList) {
      if (coin.taken) continue;
      const hit = { x: coin.x - 12, y: coin.y - 12, w: 24, h: 24 };
      if (aabb(player, hit)) {
        coin.taken = true;
        coins += 1;
        earnTokens(1);
        spawnCoinSparkle(coin.x, coin.y);
        sfx.coin();
        updateHud();
      }
    }
  }

  function updateTileAnims(dt) {
    for (const t of tiles) {
      if (t.bump > 0) t.bump = Math.max(0, t.bump - dt);
    }
    bumpFlash = bumpFlash.filter((b) => {
      b.t -= dt;
      return b.t > 0;
    });

    brickDebris = brickDebris.filter((piece) => {
      piece.vy += GRAVITY * 0.75 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;
      piece.life -= dt;
      return piece.life > 0;
    });

    coinSparkles = coinSparkles.filter((p) => {
      p.vy += GRAVITY * 0.12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.life -= dt;
      return p.life > 0;
    });

    dustParticles = dustParticles.filter((p) => {
      p.vy += GRAVITY * 0.18 * dt;
      p.vx *= 0.96;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.size *= 0.985;
      return p.life > 0 && p.size > 0.4;
    });

    rainbowSparkles = rainbowSparkles.filter((p) => {
      p.vy += GRAVITY * 0.1 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.hue = (p.hue + dt * 220) % 360;
      p.life -= dt;
      return p.life > 0;
    });

    flungHats = flungHats.filter((hat) => {
      hat.vy += GRAVITY * 0.85 * dt;
      hat.x += hat.vx * dt;
      hat.y += hat.vy * dt;
      hat.angle += hat.spin * dt;
      return hat.y < LEVEL_H + TILE * 2;
    });
  }

  function checkFlag() {
    const pole = { x: flag.x, y: flag.y, w: flag.w, h: flag.h };
    if (aabb(player, pole)) {
      state = "won";
      // Finishing pays a bonus of one token per second left on the clock.
      earnTokens(Math.ceil(timeLeft));
      player.vx = 0;
      stopMusic();
      sfx.win();
    }
  }

  function beginDeath(kind) {
    if (state !== "playing") return;

    lives = Math.max(0, lives - 1);
    updateHud();
    state = "dying";
    deathKind = kind;
    deathMessage = kind === "time" ? "Time's Up!" : "";
    jumpArmed = false;
    jumpKeyWasDown = false;
    player.onGround = false;
    stopMusic();
    sfx.death();

    if (kind === "goomba" || kind === "time") {
      deathPhase = "fling";
      deathTimer = DEATH_FLING_TIME;
      player.vx = (player.facing >= 0 ? -1 : 1) * 170;
      player.vy = -560;
      playerDeathSpin = (player.facing >= 0 ? 1 : -1) * 9;
    } else {
      deathPhase = "fadeOut";
      deathTimer = FADE_TIME;
      player.vx = 0;
      player.vy = 0;
    }
  }

  function restartAfterDeath() {
    // Rebuild the entire course so blocks, enemies, mushrooms, and coins return
    // to their original level-start state, while preserving the player's
    // overall coin/life counters.
    buildLevel();
    player.big = false;
    player.w = PLAYER_HITBOX_W;
    player.h = PLAYER_SMALL_H;
    player.x = spawn.x + (TILE - player.w) / 2;
    player.y = spawn.y + (TILE - player.h);
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.facing = 1;
    cameraX = 0;
    invulnTimer = 0;
    jumpKeyWasDown = false;
    jumpArmed = false;
    playerDeathAngle = 0;
    playerDeathSpin = 0;
    timeLeft = LEVEL_TIME;
  }

  function updateDeath(dt) {
    if (state !== "dying") return;

    if (deathPhase === "fling") {
      player.vy = Math.min(MAX_FALL * 1.35, player.vy + GRAVITY * 0.9 * dt);
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      playerDeathAngle += playerDeathSpin * dt;
      updateCamera();
      deathTimer -= dt;
      if (deathTimer <= 0) {
        deathPhase = "fadeOut";
        deathTimer = FADE_TIME;
      }
      return;
    }

    if (deathPhase === "fadeOut") {
      deathTimer -= dt;
      fadeAlpha = Math.min(1, 1 - Math.max(0, deathTimer) / FADE_TIME);
      if (deathTimer <= 0) {
        fadeAlpha = 1;
        if (lives <= 0) {
          deathPhase = "";
          deathKind = "";
          deathMessage = "";
          // Keep the final death fade fully black for the Game Over screen.
          fadeAlpha = 1;
          state = "lost";
        } else {
          restartAfterDeath();
          deathPhase = "fadeIn";
          deathTimer = FADE_TIME;
        }
      }
      return;
    }

    if (deathPhase === "fadeIn") {
      deathTimer -= dt;
      fadeAlpha = Math.max(0, Math.max(0, deathTimer) / FADE_TIME);
      if (deathTimer <= 0) {
        fadeAlpha = 0;
        deathPhase = "";
        deathKind = "";
        deathMessage = "";
        state = "playing";
        startMusic();
      }
    }
  }

  function updateCamera() {
    const target = player.x + player.w / 2 - VIEW_W * 0.35;
    cameraX = Math.max(0, Math.min(LEVEL_W - VIEW_W, target));
  }

  function drawSky() {
    ctx.fillStyle = themeSky(0, VIEW_H);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawThemeStars(VIEW_W, VIEW_H);
  }

  // Mid-layer clouds: grid-aligned rows of three tile-sized rounded squares, with parallax.
  const PARALLAX = 0.35;
  const CLOUD_RADIUS = 8;
  const PARALLAX_CLOUDS = [
    { c: 2, r: 1 }, { c: 8, r: 2 }, { c: 14, r: 1 }, { c: 21, r: 3 },
    { c: 28, r: 1 }, { c: 35, r: 2 }, { c: 42, r: 1 }, { c: 49, r: 3 },
    { c: 56, r: 2 }, { c: 63, r: 1 }, { c: 70, r: 2 }, { c: 76, r: 1 },
  ];
  // Distant pipes: same grid, orange-shifted blues so they sit back in the sky.
  // r is the lip row; body extends to the bottom of the view.
  const PARALLAX_PIPES = [
    { c: 1, r: 4 }, { c: 4, r: 6 }, { c: 7, r: 5 }, { c: 11, r: 3 },
    { c: 15, r: 5 }, { c: 18, r: 4 }, { c: 22, r: 6 }, { c: 25, r: 3 },
    { c: 29, r: 5 }, { c: 33, r: 4 }, { c: 36, r: 6 }, { c: 40, r: 3 },
    { c: 43, r: 5 }, { c: 47, r: 4 }, { c: 51, r: 6 }, { c: 54, r: 3 },
    { c: 58, r: 5 }, { c: 62, r: 4 }, { c: 65, r: 6 }, { c: 69, r: 3 },
    { c: 73, r: 5 }, { c: 77, r: 4 },
  ];

  function drawParallaxBackground() {
    const scrollX = cameraX * PARALLAX;
    for (const pipe of PARALLAX_PIPES) {
      const x = pipe.c * TILE - scrollX;
      const y = pipe.r * TILE;
      if (x + TILE < -4 || x > VIEW_W + 4) continue;
      drawParallaxPipe(x, y);
    }

    ctx.fillStyle = THEME.cloud;
    for (let cloudIndex = 0; cloudIndex < PARALLAX_CLOUDS.length; cloudIndex++) {
      const cloud = PARALLAX_CLOUDS[cloudIndex];
      const worldX = cloud.c * TILE;
      const worldY = cloud.r * TILE;
      const x = worldX - scrollX;
      const y = worldY;
      if (x + TILE * 3 < -4 || x > VIEW_W + 4) continue;
      drawCloudRow(x, y, cloudIndex);
    }
  }

  function drawParallaxPipe(x, y) {
    // Extend through the bottom of the view so distant pipes feel grounded.
    const bodyBottom = VIEW_H + TILE;
    const bodyH = Math.max(TILE, bodyBottom - y);
    // Opaque orange-haze blues (warm sides, muted blue center) for distance.
    const bodyGrad = ctx.createLinearGradient(x + 4, y, x + TILE - 4, y);
    bodyGrad.addColorStop(0, "#8a5a48");
    bodyGrad.addColorStop(0.5, "#7a6ea8");
    bodyGrad.addColorStop(1, "#8a5a48");
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x + 4, y + 14, TILE - 8, bodyH - 14);

    const lipGrad = ctx.createLinearGradient(x, y, x + TILE, y);
    lipGrad.addColorStop(0, "#7a4a3c");
    lipGrad.addColorStop(0.5, "#8a7ab8");
    lipGrad.addColorStop(1, "#7a4a3c");
    ctx.fillStyle = lipGrad;
    ctx.fillRect(x, y, TILE, 14);

    ctx.strokeStyle = "#5a382c";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TILE - 2, 13);
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 14);
    ctx.lineTo(x + 4, y + bodyH);
    ctx.moveTo(x + TILE - 4, y + 14);
    ctx.lineTo(x + TILE - 4, y + bodyH);
    ctx.stroke();
  }

  function drawCloudRow(x, y, cloudIndex) {
    for (let i = 0; i < 3; i++) {
      const pulse = 0.72 + 0.28 * Math.sin(animTime * 2.2 + cloudIndex * 0.7 + i * 0.9);
      const size = TILE * pulse;
      const ox = x + i * TILE + (TILE - size) / 2;
      const oy = y + (TILE - size) / 2;
      ctx.beginPath();
      ctx.roundRect(ox, oy, size, size, THEME.square ? 0 : CLOUD_RADIUS * pulse);
      ctx.fill();
    }
  }

  function drawGridHint() {
    // Fixed viewport grid (does not scroll with the camera).
    ctx.save();
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth = 1;
    const cols = Math.ceil(VIEW_W / TILE);
    for (let c = 0; c <= cols; c++) {
      const x = Math.floor(c * TILE) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VIEW_H);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      const y = Math.floor(r * TILE) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTiles() {
    for (const t of tiles) {
      if (t.type === ".") continue;
      const bumpY = t.bump > 0 ? -Math.sin((1 - t.bump / 0.18) * Math.PI) * 8 : 0;
      const x = t.c * TILE - cameraX;
      const y = t.r * TILE + bumpY;
      if (x + TILE < -4 || x > VIEW_W + 4) continue;

      if (t.type === "#") {
        const above = tileAt(t.c, t.r - 1);
        const isTopGround = !above || above.type !== "#";

        if (isTopGround) {
          // Surface ground uses the same blue 2x2 brick look.
          const half = TILE / 2;
          const brickGrad = ctx.createLinearGradient(x, y, x, y + TILE);
          brickGrad.addColorStop(0, "#4da3ff");
          brickGrad.addColorStop(1, "#1557c0");
          ctx.fillStyle = brickGrad;
          ctx.fillRect(x, y, TILE, TILE);

          ctx.strokeStyle = "#0b3d8c";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          ctx.beginPath();
          ctx.moveTo(x + half, y + 1);
          ctx.lineTo(x + half, y + TILE - 1);
          ctx.moveTo(x + 1, y + half);
          ctx.lineTo(x + TILE - 1, y + half);
          ctx.stroke();
        } else {
          const azureGrad = ctx.createLinearGradient(x, y, x, y + TILE);
          azureGrad.addColorStop(0, "#1e5bb8");
          azureGrad.addColorStop(1, "#6eb6ff");
          ctx.fillStyle = azureGrad;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = "#164a96";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        }
      } else if (t.type === "B") {
        const half = TILE / 2;
        const brickGrad = ctx.createLinearGradient(x, y, x, y + TILE);
        brickGrad.addColorStop(0, "#4da3ff");
        brickGrad.addColorStop(1, "#1557c0");
        ctx.fillStyle = brickGrad;
        ctx.fillRect(x, y, TILE, TILE);

        ctx.strokeStyle = "#0b3d8c";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        ctx.beginPath();
        ctx.moveTo(x + half, y + 1);
        ctx.lineTo(x + half, y + TILE - 1);
        ctx.moveTo(x + 1, y + half);
        ctx.lineTo(x + TILE - 1, y + half);
        ctx.stroke();
      } else if (t.type === "G") {
        // Non-enterable scenery pipe. Pipe tiles are solid obstacles.
        const above = tileAt(t.c, t.r - 1);
        const below = tileAt(t.c, t.r + 1);
        const left = tileAt(t.c - 1, t.r);
        const right = tileAt(t.c + 1, t.r);
        const isTop = !above || above.type !== "G";
        const joinAbove = above && above.type === "G";
        const joinBelow = below && below.type === "G";
        const isLeftEdge = !left || left.type !== "G";
        const isRightEdge = !right || right.type !== "G";

        // Vertical overlap only: stacked pipe tiles stay seamless, neighbors stay separate.
        const overlap = 1.5;
        const bodyX = x + 4;
        const bodyW = TILE - 8;
        const bodyY = y - (joinAbove ? overlap : 0);
        const bodyH = TILE + (joinAbove ? overlap : 0) + (joinBelow ? overlap : 0);

        const bodyGrad = ctx.createLinearGradient(bodyX, bodyY, bodyX + bodyW, bodyY);
        bodyGrad.addColorStop(0, "#041a4a");
        bodyGrad.addColorStop(0.5, "#1558ff");
        bodyGrad.addColorStop(1, "#041a4a");
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(bodyX, bodyY, bodyW, bodyH);

        if (isTop) {
          const lipGrad = ctx.createLinearGradient(x, y, x + TILE, y);
          lipGrad.addColorStop(0, "#03133a");
          lipGrad.addColorStop(0.5, "#1d6bff");
          lipGrad.addColorStop(1, "#03133a");
          ctx.fillStyle = lipGrad;
          ctx.fillRect(x, y, TILE, 14 + overlap);
          ctx.strokeStyle = "#020d28";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, TILE - 2, 12);
        }

        ctx.strokeStyle = "#020d28";
        ctx.lineWidth = 2;
        if (isLeftEdge) {
          ctx.beginPath();
          ctx.moveTo(x + 4, y + (isTop ? 14 : 0) - (joinAbove ? overlap : 0));
          ctx.lineTo(x + 4, bodyY + bodyH);
          ctx.stroke();
        }
        if (isRightEdge) {
          ctx.beginPath();
          ctx.moveTo(x + TILE - 4, y + (isTop ? 14 : 0) - (joinAbove ? overlap : 0));
          ctx.lineTo(x + TILE - 4, bodyY + bodyH);
          ctx.stroke();
        }
      } else if (t.type === "?") {
        if (t.used) {
          const radius = 5;
          const usedGrad = ctx.createLinearGradient(x, y, x, y + TILE);
          usedGrad.addColorStop(0, "#c8c8c8");
          usedGrad.addColorStop(1, "#6e6e6e");
          ctx.fillStyle = usedGrad;
          ctx.beginPath();
          ctx.roundRect(x, y, TILE, TILE, radius);
          ctx.fill();
          ctx.strokeStyle = "#5a5a5a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(x + 1, y + 1, TILE - 2, TILE - 2, radius - 1);
          ctx.stroke();
        } else {
          const hueShift = (animTime * 120) % 360;
          const hueA = hueShift;
          const hueB = (hueShift + 60) % 360;
          const radius = 5;

          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, TILE, TILE, radius);
          ctx.clip();

          const rainbow = ctx.createLinearGradient(x, y, x, y + TILE);
          rainbow.addColorStop(0, `hsl(${hueA}, 95%, 55%)`);
          rainbow.addColorStop(1, `hsl(${hueB}, 95%, 55%)`);
          ctx.fillStyle = rainbow;
          ctx.fillRect(x, y, TILE, TILE);

          // Checkerboard overlay: every other cell is a very light black tint.
          const checkSize = TILE / 4;
          ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
          for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
              if ((row + col) % 2 !== 0) continue;
              ctx.fillRect(x + col * checkSize, y + row * checkSize, checkSize, checkSize);
            }
          }
          ctx.restore();

          const darkRainbow = ctx.createLinearGradient(x, y, x, y + TILE);
          darkRainbow.addColorStop(0, `hsl(${hueA}, 90%, 28%)`);
          darkRainbow.addColorStop(1, `hsl(${hueB}, 90%, 28%)`);
          ctx.strokeStyle = darkRainbow;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(x + 1, y + 1, TILE - 2, TILE - 2, radius - 1);
          ctx.stroke();

          ctx.fillStyle = "#ffffff";
          ctx.font = `${Math.floor(TILE * 0.52)}px "Press Start 2P", monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("?", x + TILE / 2, y + TILE / 2 + 1);
        }
      }
    }
  }

  function drawFlungHats() {
    for (const hat of flungHats) {
      const x = hat.x - cameraX;
      const y = hat.y;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(hat.angle);
      drawHardHat(0, 0, hat.size, hat.facing);
      ctx.restore();
    }
  }

  function drawBrickDebris() {
    for (const piece of brickDebris) {
      const x = piece.x - cameraX;
      const y = piece.y;
      ctx.save();
      ctx.translate(x + piece.size / 2, y + piece.size / 2);
      ctx.rotate(piece.angle);
      ctx.fillStyle = "#2f7de0";
      ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
      ctx.strokeStyle = "#0b3d8c";
      ctx.lineWidth = 2;
      ctx.strokeRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
      ctx.restore();
    }
  }

  function drawFlag() {
    const x = flag.x - cameraX;
    const y = flag.y;
    const poleW = Math.max(6, flag.w);
    const poleH = flag.h;

    // Pipe-style blue pole with dark sides.
    const poleGrad = ctx.createLinearGradient(x, y, x + poleW, y);
    poleGrad.addColorStop(0, "#041a4a");
    poleGrad.addColorStop(0.5, "#1558ff");
    poleGrad.addColorStop(1, "#041a4a");
    ctx.fillStyle = poleGrad;
    ctx.fillRect(x, y, poleW, poleH);
    ctx.strokeStyle = "#020d28";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, poleW - 1, poleH - 1);

    // Sharp black / white checkered banner.
    const bannerX = x + poleW;
    const bannerY = y + 8;
    const bannerW = TILE * 1.15;
    const bannerH = TILE * 0.85;
    const cellsX = 4;
    const cellsY = 3;
    const cellW = bannerW / cellsX;
    const cellH = bannerH / cellsY;
    for (let row = 0; row < cellsY; row++) {
      for (let col = 0; col < cellsX; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "#111111";
        ctx.fillRect(bannerX + col * cellW, bannerY + row * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2;
    ctx.strokeRect(bannerX + 1, bannerY + 1, bannerW - 2, bannerH - 2);

    // White bauble finial on top of the pole.
    const baubleR = 8;
    const bx = x + poleW / 2;
    const by = y;
    const baubleGrad = ctx.createRadialGradient(bx - 2, by - 3, 1, bx, by, baubleR);
    baubleGrad.addColorStop(0, "#ffffff");
    baubleGrad.addColorStop(1, "#d8d8d8");
    ctx.fillStyle = baubleGrad;
    ctx.beginPath();
    ctx.arc(bx, by, baubleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b0b0b0";
    ctx.lineWidth = 1.5;
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

  function drawPlayerIcon(cx, cy, size) {
    const bunScale = size / 270;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(bunScale, bunScale);
    ctx.translate(-135, -127.5);

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

    // Tiny eyes facing right.
    const eyeY = cy - size * 0.02;
    const eyeSpread = size * 0.08;
    const eyeR = Math.max(1.4, size * 0.035);
    const look = size * 0.04;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(cx - eyeSpread + look, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(cx + eyeSpread + look, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCoins() {
    for (const coin of coinList) {
      if (coin.taken) continue;
      const x = coin.x - cameraX;
      const floatY = coin.y + Math.sin(animTime * 2.4 + coin.x * 0.04) * 2.5;
      const spin = Math.abs(Math.cos(animTime * 7 + coin.x * 0.03));
      const rx = Math.max(2.5, 12 * spin);
      const ry = 12;
      const innerRx = Math.max(1.2, rx * 0.55);
      const innerRy = ry * 0.55;

      ctx.save();
      ctx.translate(x, floatY);

      ctx.fillStyle = "#f7d21e";
      ctx.strokeStyle = "#c99a00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (rx > 4) {
        ctx.fillStyle = "#c9a008";
        ctx.beginPath();
        ctx.ellipse(0, 0, innerRx, innerRy, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawCoinSparkles() {
    for (const p of coinSparkles) {
      const x = p.x - cameraX;
      const y = p.y;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.angle);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -p.size * 1.8);
      ctx.lineTo(p.size * 0.55, -p.size * 0.55);
      ctx.lineTo(p.size * 1.8, 0);
      ctx.lineTo(p.size * 0.55, p.size * 0.55);
      ctx.lineTo(0, p.size * 1.8);
      ctx.lineTo(-p.size * 0.55, p.size * 0.55);
      ctx.lineTo(-p.size * 1.8, 0);
      ctx.lineTo(-p.size * 0.55, -p.size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawDustParticles() {
    for (const p of dustParticles) {
      const x = p.x - cameraX;
      const y = p.y;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, p.size), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRainbowSparkles() {
    for (const p of rainbowSparkles) {
      const x = p.x - cameraX;
      const y = p.y;
      const s = p.size;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.angle);

      const grad = ctx.createLinearGradient(-s, -s, s, s);
      grad.addColorStop(0, `hsl(${p.hue}, 95%, 60%)`);
      grad.addColorStop(0.5, `hsl(${(p.hue + 60) % 360}, 95%, 55%)`);
      grad.addColorStop(1, `hsl(${(p.hue + 120) % 360}, 95%, 50%)`);
      ctx.fillStyle = grad;
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
      ctx.restore();
    }
  }

  function drawHardHat(cx, cy, size, facing = 1) {
    // Orange → red bun dome with a rectangular brim shifted toward facing.
    const bunScale = size / 270;
    const brimW = size * 1.05;
    const brimH = size * 0.14;
    const brimShift = facing * size * 0.12;
    const brimX = cx - brimW / 2 + brimShift;
    const brimY = cy + size * 0.22;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(bunScale, bunScale);
    ctx.translate(-135, -140);

    const hatGrad = ctx.createLinearGradient(0, 22, 0, 237);
    hatGrad.addColorStop(0, "#ff8a1f");
    hatGrad.addColorStop(0.55, "#f97316");
    hatGrad.addColorStop(1, "#dc2626");
    ctx.fillStyle = hatGrad;
    ctx.fill(BUN_PATH);
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#b91c1c";
    ctx.stroke(BUN_PATH);
    ctx.restore();

    ctx.fillStyle = "#ea580c";
    ctx.fillRect(brimX, brimY, brimW, brimH);
    ctx.strokeStyle = "#9a3412";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(brimX + 0.5, brimY + 0.5, brimW - 1, brimH - 1);
  }

  function drawMushrooms() {
    for (const m of mushrooms) {
      if (!m.active) continue;
      const x = m.x - cameraX;
      const y = m.y;
      const cx = x + m.w / 2;
      const cy = y + m.h / 2;
      const radius = m.w * 0.46;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(m.angle || 0);

      // Construction hat sealed inside the marble.
      drawHardHat(0, -m.h * 0.04, m.w * 0.78, m.dir);

      // White translucent marble shell.
      const shell = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.1, 0, 0, radius);
      shell.addColorStop(0, "rgba(255, 255, 255, 0.55)");
      shell.addColorStop(0.45, "rgba(255, 255, 255, 0.22)");
      shell.addColorStop(1, "rgba(255, 255, 255, 0.08)");
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Specular highlight.
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.beginPath();
      ctx.ellipse(-radius * 0.28, -radius * 0.32, radius * 0.18, radius * 0.12, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const x = enemy.x - cameraX;
      const y = enemy.y;

      ctx.save();
      ctx.translate(x + enemy.w / 2, y + enemy.h / 2);
      if (enemy.defeated) ctx.rotate(enemy.angle);
      ctx.translate(-enemy.w / 2, -enemy.h / 2);

      const bunScaleX = enemy.w / 270;
      const bunScaleY = enemy.h / 255;

      ctx.save();
      // Upside-down bun: flip vertically around the enemy box center.
      ctx.translate(enemy.w / 2, enemy.h / 2);
      ctx.scale(bunScaleX, -bunScaleY);
      ctx.translate(-135, -127.5);

      // In path space, y=237 is the flat side (visual top after flip).
      const bunGradient = ctx.createLinearGradient(0, 22, 0, 237);
      bunGradient.addColorStop(0, "#e67a20");
      bunGradient.addColorStop(1, "#f5d442");

      ctx.fillStyle = bunGradient;
      ctx.fill(BUN_PATH);
      ctx.lineWidth = 10;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#d97706";
      ctx.stroke(BUN_PATH);
      ctx.restore();

      // X eyes
      const eyeY = enemy.h * 0.42;
      const eyeSpread = enemy.w * 0.16;
      const eyeSize = Math.max(4, enemy.w * 0.1);
      const lookOffset = enemy.dir * enemy.w * 0.06;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      for (const side of [-1, 1]) {
        const ex = enemy.w / 2 + side * eyeSpread + lookOffset;
        ctx.beginPath();
        ctx.moveTo(ex - eyeSize * 0.45, eyeY - eyeSize * 0.45);
        ctx.lineTo(ex + eyeSize * 0.45, eyeY + eyeSize * 0.45);
        ctx.moveTo(ex + eyeSize * 0.45, eyeY - eyeSize * 0.45);
        ctx.lineTo(ex - eyeSize * 0.45, eyeY + eyeSize * 0.45);
        ctx.stroke();
      }

      // Nub feet sit just under the flipped bun's dome (visual bottom).
      const bunBottom = enemy.h * (0.5 + (127.5 - 22) / 255);
      const footGap = enemy.w * 0.17;
      const footW = Math.max(4, enemy.w * 0.12);
      const footH = Math.max(3, enemy.w * 0.07);
      const feetY = bunBottom + footH + 1;
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.roundRect(enemy.w / 2 - footGap - footW / 2, feetY - footH, footW, footH, footW / 2);
      ctx.roundRect(enemy.w / 2 + footGap - footW / 2, feetY - footH, footW, footH, footW / 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawPlayer() {
    if (invulnTimer > 0 && Math.floor(invulnTimer * 12) % 2 === 0) return;
    const visualW = TILE;
    const x = player.x - cameraX - (visualW - player.w) / 2;
    // Body stays small-bun sized; extra hitbox height is filled by the hat.
    const bodyH = PLAYER_SMALL_H;
    const y = player.y + player.h - bodyH;
    const h = bodyH;

    ctx.save();
    if (state === "dying" && deathPhase === "fling") {
      const cx = x + visualW / 2;
      const cy = player.y + player.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(playerDeathAngle);
      ctx.translate(-cx, -cy);
    }

    const bunScaleX = visualW / 270;
    const bunScaleY = h / 255;
    // Bun path bottoms out at y=237 in a 255-tall space; keep nubs below that edge.
    const bunBottom = y + (237 / 255) * h;
    const footGap = visualW * 0.17;
    const footW = Math.max(4, visualW * 0.12);
    const footH = Math.max(3, visualW * 0.07);
    const feetY = bunBottom + footH + 1;
    const eyeY = y + h * 0.43;
    const eyeSpread = visualW * 0.1;
    const eyeRadius = Math.max(2.6, Math.min(4.6, visualW * 0.04));
    const lookOffset = player.facing * visualW * 0.06;

    ctx.translate(x, y);
    ctx.scale(bunScaleX, bunScaleY);

    const lowerStart = 255 * 0.5;
    const bunGradient = ctx.createLinearGradient(0, 0, 0, 255);
    bunGradient.addColorStop(0, SKIN.stops[0]);
    bunGradient.addColorStop(lowerStart / 255, SKIN.stops[1]);
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

    ctx.scale(1 / bunScaleX, 1 / bunScaleY);
    ctx.translate(-x, -y);

    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(x + visualW / 2 - eyeSpread + lookOffset, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(x + visualW / 2 + eyeSpread + lookOffset, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.roundRect(x + visualW / 2 - footGap - footW / 2, feetY - footH, footW, footH, footW / 2);
    ctx.roundRect(x + visualW / 2 + footGap - footW / 2, feetY - footH, footW, footH, footW / 2);
    ctx.fill();

    if (player.big) {
      // Hat sits on the bun crown so the player reads taller without stretching.
      const bunTop = y + (SKIN.top / 255) * h;
      const hatSize = visualW * 0.92;
      drawHardHat(x + visualW / 2, bunTop - hatSize * 0.12, hatSize, player.facing);
    }

    ctx.restore();
  }

  function drawGameHud() {
    ctx.save();
    ctx.font = `14px "Press Start 2P", monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const hudX = 14;
    const hudY = 12;
    const hudH = 48;
    const groupW = 96;
    const panelW = groupW * 2 + 14;
    const radius = 8;

    // Warm cream panel with orange border, matching the sky / block language.
    const panelGrad = ctx.createLinearGradient(hudX, hudY, hudX, hudY + hudH);
    panelGrad.addColorStop(0, "rgba(255, 253, 248, 0.92)");
    panelGrad.addColorStop(1, "rgba(255, 232, 186, 0.88)");
    ctx.fillStyle = panelGrad;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, panelW, hudH, radius);
    ctx.fill();
    ctx.strokeStyle = "#c44d03";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(hudX + 1, hudY + 1, panelW - 2, hudH - 2, radius - 1);
    ctx.stroke();

    const centerY = hudY + hudH / 2;

    // Coins — use the in-world coin sprite.
    const coinX = hudX + 22;
    drawCoinIcon(coinX, centerY, 0.85);
    ctx.fillStyle = "#1f2a37";
    ctx.fillText(`×${coins}`, coinX + 16, centerY + 1);

    // Lives — use the player bun sprite.
    const lifeX = hudX + groupW + 22;
    drawPlayerIcon(lifeX, centerY + 2, 34);
    ctx.fillStyle = "#1f2a37";
    ctx.fillText(`×${lives}`, lifeX + 20, centerY + 1);

    // Timer panel.
    const timerText = String(Math.max(0, Math.ceil(timeLeft)));
    const timerW = 128;
    const timerX = VIEW_W - 14 - timerW;
    const timerGrad = ctx.createLinearGradient(timerX, hudY, timerX, hudY + hudH);
    timerGrad.addColorStop(0, "rgba(255, 253, 248, 0.92)");
    timerGrad.addColorStop(1, "rgba(255, 232, 186, 0.88)");
    ctx.fillStyle = timerGrad;
    ctx.beginPath();
    ctx.roundRect(timerX, hudY, timerW, hudH, radius);
    ctx.fill();
    ctx.strokeStyle = "#c44d03";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(timerX + 1, hudY + 1, timerW - 2, hudH - 2, radius - 1);
    ctx.stroke();
    ctx.fillStyle = "#1f2a37";
    ctx.textAlign = "center";
    ctx.fillText(`TIME ${timerText}`, timerX + timerW / 2, centerY + 1);

    ctx.restore();
  }

  function drawDeathTransition() {
    if (state !== "dying") return;
    ctx.save();

    if (deathMessage) {
      const messageAlpha = deathPhase === "fadeIn" ? fadeAlpha : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, messageAlpha));
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `28px "Press Start 2P", monospace`;
      ctx.fillText(deathMessage, VIEW_W / 2, VIEW_H * 0.38);
    }

    if (fadeAlpha > 0) {
      ctx.globalAlpha = fadeAlpha;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.restore();
  }

  function drawEndState() {
    if (state !== "won" && state !== "lost") return;
    ctx.save();

    // Final-life Game Over stays on the fully black frame reached by the fade.
    ctx.fillStyle = state === "lost" ? "#000000" : "rgba(20, 32, 44, 0.52)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `28px "Press Start 2P", monospace`;
    ctx.fillText(state === "won" ? "YOU WIN" : "GAME OVER!", VIEW_W / 2, VIEW_H / 2);
    ctx.font = `12px "Press Start 2P", monospace`;
    ctx.fillText("R — Restart", VIEW_W / 2, VIEW_H / 2 + 48);
    ctx.restore();
  }

  function drawTitleScreen() {
    if (state !== "title") return;
    ctx.save();
    ctx.fillStyle = "rgba(20, 32, 44, 0.52)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    drawCoinIcon(cx - 120, cy - 152 + Math.cos(animTime * 4 + 1) * 4, 1.6);
    drawPlayerIcon(cx, cy - 152 + Math.sin(animTime * 4) * 4, 64);
    drawCoinIcon(cx + 120, cy - 152 + Math.cos(animTime * 4) * 4, 1.6);

    ctx.fillStyle = "#ffffff";
    ctx.font = `36px "Press Start 2P", monospace`;
    ctx.fillText("FLAG RUSH", cx, cy - 62);

    ctx.font = `12px "Press Start 2P", monospace`;
    ctx.fillText("A / D OR LEFT / RIGHT — RUN", cx, cy - 2);
    ctx.fillText("W / UP / SPACE — JUMP     R — RESTART", cx, cy + 26);
    ctx.fillText("RACE THE CLOCK TO THE FLAGPOLE AND GRAB COINS ALONG THE WAY", cx, cy + 54);
    if (Math.floor(animTime * 2) % 2 === 0) {
      ctx.font = `16px "Press Start 2P", monospace`;
      ctx.fillText("PRESS SPACE OR CLICK TO START", cx, cy + 150);
    }
    ctx.restore();
  }

  function draw() {
    syncCanvasResolution();
    drawSky();
    drawGridHint();
    drawParallaxBackground();
    drawTiles();
    drawBrickDebris();
    drawFlungHats();
    drawFlag();
    drawCoins();
    drawCoinSparkles();
    drawDustParticles();
    drawRainbowSparkles();
    drawMushrooms();
    drawEnemies();
    drawPlayer();
    drawGameHud();
    drawDeathTransition();
    drawEndState();
    drawTitleScreen();
  }

  function update(dt) {
    animTime += dt;

    if (state === "dying") {
      updateTileAnims(dt);
      updateDeath(dt);
      return;
    }

    if (state !== "playing") return;

    timeLeft = Math.max(0, timeLeft - dt);
    if (timeLeft <= 0) {
      beginDeath("time");
      return;
    }

    if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);
    updateTileAnims(dt);
    updatePlayer(dt);
    if (state !== "playing") return;
    updateEnemies(dt);
    if (state !== "playing") return;
    updateMushrooms(dt);
    updateCoins();
    checkFlag();
    updateCamera();
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function startFromTitle() {
    startGame();
    // The key that started the run shouldn't also register as a jump.
    jumpKeyWasDown = true;
  }

  canvas.addEventListener("click", () => {
    if (state !== "title") return;
    ensureAudio();
    startFromTitle();
  });

  window.addEventListener("keydown", (e) => {
    ensureAudio();
    if (state === "title" && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      startFromTitle();
      return;
    }
    if (state === "playing") startMusic();
    keys.add(e.key);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
      e.preventDefault();
    }
    if (e.key === "r" || e.key === "R") {
      startGame();
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
  });


  loadLevelFromImage(LEVEL_IMAGE_URL)
    .then(() => {
      buildLevel();
      showTitle();
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      console.error(err);
    });
})();
