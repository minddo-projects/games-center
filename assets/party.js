// Pixel Party save data, shared by the site and every game.
// Tokens, purchases, and the chosen skin/theme all live in localStorage, so progress
// stays in this browser without an account. Games load this file too: they call
// PixelParty.earn() when the player scores and PixelParty.skin() to draw the player character.
(function () {
  const KEYS = {
    tokens: "pixel-party-tokens",
    owned: "pixel-party-owned",
    skin: "pixel-party-skin",
    theme: "pixel-party-theme",
  };

  // Each skin is a character drawn in the games' bun space: a 270x255 box whose flat
  // bottom sits at y=237, so the games' eyes, feet, and hitboxes still line up.
  //   shape  body outline (SVG path data, also used as a canvas Path2D)
  //   top    highest y of the shape (Flag Rush sits its hard hat there)
  //   stops  body gradient, top to bottom, like the games' original four stops
  //   decor  extra details drawn over the body (leaves, seeds, score lines)
  const SEED = (x, y) => `M ${x - 5} ${y} a 5 7 0 1 0 10 0 a 5 7 0 1 0 -10 0`;
  const SKINS = [
    {
      id: "classic",
      name: "Bun",
      price: 0,
      shape: "M 18 220 C 20 130, 72 22, 135 22 C 198 22, 250 130, 252 220 L 252 237 L 18 237 Z",
      top: 22,
      stops: ["#ffffff", "#fff6c2", "#ffe566", "#f5c842"],
      outline: "#e6b422",
      decor: [],
    },
    {
      id: "strawberry",
      name: "Strawberry",
      price: 60,
      shape: "M 84 237 C 44 204, 14 130, 28 88 C 40 50, 94 42, 135 56 C 176 42, 230 50, 242 88 C 256 130, 226 204, 186 237 Z",
      top: 22,
      stops: ["#fff0f0", "#ff9aa8", "#f2555f", "#d93545"],
      outline: "#b3263a",
      decor: [
        { d: [SEED(70, 150), SEED(200, 150), SEED(104, 196), SEED(166, 196), SEED(135, 168)].join(" "), fill: "#fff3b0" },
        { d: "M 135 62 L 96 36 L 120 46 L 135 20 L 150 46 L 174 36 Z", fill: "#5cb85c", stroke: "#2e7d32", width: 8 },
      ],
    },
    {
      id: "matcha",
      name: "Mochi",
      price: 60,
      shape: "M 6 237 C 6 150, 58 68, 135 68 C 212 68, 264 150, 264 237 Z",
      top: 68,
      stops: ["#ffffff", "#eef7d6", "#c6e49b", "#9ccc65"],
      outline: "#76a544",
      decor: [{ d: "M 135 74 C 120 56, 132 40, 152 40 C 156 58, 148 70, 135 74 Z", fill: "#6fae3e", stroke: "#4f8a2a", width: 6 }],
    },
    {
      id: "blueberry",
      name: "Blueberry",
      price: 100,
      shape: "M 33 135 A 102 102 0 1 1 237 135 A 102 102 0 1 1 33 135 Z",
      top: 33,
      stops: ["#eef1ff", "#a7b6ff", "#6f83f0", "#4b5ccc"],
      outline: "#3a47a8",
      decor: [{ d: "M 135 30 L 146 46 L 166 42 L 154 58 L 135 52 L 116 58 L 104 42 L 124 46 Z", fill: "#2f3a86", stroke: "#2f3a86", width: 4 }],
    },
    {
      id: "chocolate",
      name: "Choco Block",
      price: 150,
      shape: "M 30 64 Q 30 30 64 30 L 206 30 Q 240 30 240 64 L 240 237 L 30 237 Z",
      top: 30,
      stops: ["#f0cfa8", "#c99567", "#a06a3f", "#7d4c28"],
      outline: "#5e3519",
      decor: [{ d: "M 40 176 L 230 176 M 135 176 L 135 228", stroke: "#6e4022", width: 7 }],
    },
    {
      id: "golden",
      name: "Gold Star",
      price: 400,
      shape: "M 135 22 L 169.1 93.1 L 247.2 103.5 L 190.2 157.9 L 205 237 L 135 198 L 65 237 L 79.8 157.9 L 22.8 103.5 L 100.9 93.1 Z",
      top: 22,
      stops: ["#fffbe0", "#ffe27a", "#ffc21a", "#eaa000"],
      outline: "#b37a00",
      decor: [],
    },
  ];

  // Draws a skin's decor on a canvas whose transform is already in bun space.
  const decorPaths = new Map();
  function drawDecor(ctx, skin) {
    for (const part of skin.decor || []) {
      if (!decorPaths.has(part.d)) decorPaths.set(part.d, new Path2D(part.d));
      const path = decorPaths.get(part.d);
      if (part.fill) {
        ctx.fillStyle = part.fill;
        ctx.fill(path);
      }
      if (part.stroke) {
        ctx.strokeStyle = part.stroke;
        ctx.lineWidth = part.width || 6;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke(path);
      }
    }
  }

  const THEMES = [
    {
      id: "classic",
      name: "Sunset",
      price: 0,
      sky: [[0, "#ff8a2b"], [0.55, "#ffc857"], [1, "#fff3b0"]],
      cloud: "rgba(255, 255, 255, 0.85)",
      grid: "rgba(255, 255, 255, 0.22)",
    },
    {
      id: "night",
      name: "Night Sky",
      price: 200,
      sky: [[0, "#14123a"], [0.55, "#3a2a6e"], [1, "#8a4f8f"]],
      cloud: "rgba(255, 255, 255, 0.16)",
      grid: "rgba(255, 255, 255, 0.07)",
      stars: true,
    },
    {
      id: "retro",
      name: "Retro",
      price: 300,
      sky: [[0, "#ff8a2b"], [0.55, "#ffc857"], [1, "#fff3b0"]],
      cloud: "rgba(255, 255, 255, 0.9)",
      grid: "rgba(255, 255, 255, 0.3)",
      bands: 8,
      square: true,
    },
  ];

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable — this visit still works, it just won't be remembered */
    }
  }

  function tokens() {
    return Math.max(0, Math.floor(Number(read(KEYS.tokens)) || 0));
  }

  function owned() {
    try {
      const list = JSON.parse(read(KEYS.owned) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function owns(item) {
    return item.price === 0 || owned().includes(itemKey(item));
  }

  // Skins and themes share ids like "classic", so purchases are stored as "skin:x" / "theme:x".
  function itemKey(item) {
    return `${SKINS.includes(item) ? "skin" : "theme"}:${item.id}`;
  }

  // Same-window listeners hear this event; other windows (a game in a frame,
  // another tab) hear the browser's own "storage" event.
  function changed() {
    window.dispatchEvent(new CustomEvent("pixelparty:change"));
  }

  function earn(amount) {
    const n = Math.floor(amount);
    if (!(n > 0)) return;
    write(KEYS.tokens, String(tokens() + n));
    changed();
  }

  function buy(item) {
    if (owns(item)) return true;
    const balance = tokens();
    if (balance < item.price) return false;
    write(KEYS.tokens, String(balance - item.price));
    write(KEYS.owned, JSON.stringify([...owned(), itemKey(item)]));
    equip(item);
    return true;
  }

  function equip(item) {
    if (!owns(item)) return;
    write(SKINS.includes(item) ? KEYS.skin : KEYS.theme, item.id);
    if (THEMES.includes(item)) document.documentElement.dataset.theme = item.id;
    changed();
  }

  function current(list, key) {
    const item = list.find((x) => x.id === read(key));
    return item && owns(item) ? item : list[0];
  }

  // CSS version of a theme's sky, for small previews. Banded themes get hard color steps.
  function skyCSS(theme) {
    if (!theme.bands) {
      return `linear-gradient(180deg, ${theme.sky.map(([at, c]) => `${c} ${at * 100}%`).join(", ")})`;
    }
    const steps = [];
    for (let i = 0; i < theme.bands; i++) {
      const color = mixSky(theme.sky, i / (theme.bands - 1));
      steps.push(`${color} ${(i / theme.bands) * 100}% ${((i + 1) / theme.bands) * 100}%`);
    }
    return `linear-gradient(180deg, ${steps.join(", ")})`;
  }

  function mixSky(stops, t) {
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const a = parseInt(c0.slice(1), 16);
    const b = parseInt(c1.slice(1), 16);
    const mix = (shift) => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k);
    return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
  }

  // Canvas gradient for a theme's sky between y0 and y1. Banded themes get hard color
  // steps, so games can fill any shape (sky, Bun Survivor's floor) with one fillStyle.
  function skyGradient(ctx, y0, y1, theme = current(THEMES, KEYS.theme)) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    if (!theme.bands) {
      for (const [at, color] of theme.sky) g.addColorStop(at, color);
      return g;
    }
    for (let i = 0; i < theme.bands; i++) {
      const color = mixSky(theme.sky, i / (theme.bands - 1));
      g.addColorStop(i / theme.bands, color);
      g.addColorStop((i + 1) / theme.bands, color);
    }
    return g;
  }

  // Night theme's twinkling stars, spread over the top 80% of a w x h area.
  const STARS = Array.from({ length: 70 }, (_, i) => ({
    x: ((i * 7919) % 1000) / 1000,
    y: (((i * 4211) % 1000) / 1000) * 0.8,
    s: 2 + (i % 3),
    phase: i * 1.7,
  }));
  function drawStars(ctx, w, h, t) {
    ctx.save();
    ctx.fillStyle = "#fff6c2";
    for (const star of STARS) {
      ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.6 + star.phase));
      ctx.fillRect(Math.round(star.x * w), Math.round(star.y * h), star.s, star.s);
    }
    ctx.restore();
  }

  // The player character as Flag Rush draws it at one 48px tile: the skin's shape in bun
  // space, with the games' outline width, eyes, and feet.
  let svgCount = 0;
  function bunSVG(skin = current(SKINS, KEYS.skin)) {
    const id = `bun-${skin.id}-${svgCount++}`;
    const [a, b, c, d] = skin.stops;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 50" aria-hidden="true">
      <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="255">
        <stop offset="0" stop-color="${a}"/><stop offset="0.5" stop-color="${b}"/>
        <stop offset="0.78" stop-color="${c}"/><stop offset="1" stop-color="${d}"/>
      </linearGradient></defs>
      <g transform="scale(0.177778 0.188235)">
        <path d="${skin.shape}"
          fill="url(#${id})" stroke="${skin.outline}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
        ${(skin.decor || []).map((part) => `<path d="${part.d}" fill="${part.fill || "none"}"
          stroke="${part.stroke || "none"}" stroke-width="${part.width || 6}" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
      </g>
      <g fill="#111">
        <circle cx="19.2" cy="20.64" r="2.6"/><circle cx="28.8" cy="20.64" r="2.6"/>
        <rect x="12.96" y="45.61" width="5.76" height="3.36" rx="1.68"/>
        <rect x="29.28" y="45.61" width="5.76" height="3.36" rx="1.68"/>
      </g>
    </svg>`;
  }

  window.PixelParty = {
    KEYS,
    SKINS,
    THEMES,
    tokens,
    earn,
    owns,
    buy,
    equip,
    skin: () => current(SKINS, KEYS.skin),
    theme: () => current(THEMES, KEYS.theme),
    bunSVG,
    drawDecor,
    skyCSS,
    skyGradient,
    drawStars,
    skyColorAt: (theme, t) => mixSky(theme.sky, t),
  };

  // Apply the theme before first paint so pages never flash the default look.
  document.documentElement.dataset.theme = current(THEMES, KEYS.theme).id;
})();
