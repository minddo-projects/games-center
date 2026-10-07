// Page backdrop: the same sky the games draw — the sunset gradient, the faint white
// tile grid, and rows of three pulsing rounded-square clouds drifting by.
// Values are lifted from drawSky / drawGridHint / drawCloudRow in the games; the
// equipped theme (PixelParty.theme()) swaps the colors and style.
(function () {
  const canvas = document.getElementById("sky");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const TILE = 48;
  const CLOUD_RADIUS = 8;
  // Cloud rows in tile units; they wrap around a span wider than any screen.
  const CLOUDS = [
    { c: 2, r: 1 }, { c: 8, r: 3 }, { c: 14, r: 1 }, { c: 21, r: 4 },
    { c: 28, r: 2 }, { c: 35, r: 5 }, { c: 42, r: 1 }, { c: 49, r: 3 },
    { c: 5, r: 8 }, { c: 18, r: 10 }, { c: 31, r: 9 }, { c: 45, r: 11 },
  ];
  const SPAN_COLS = 56;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let theme = PixelParty.theme();
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawSky() {
    ctx.fillStyle = PixelParty.skyGradient(ctx, 0, h, theme);
    ctx.fillRect(0, 0, w, h);
  }

  function drawGrid() {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += TILE) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, h);
    }
    for (let y = 0; y <= h; y += TILE) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(w, Math.floor(y) + 0.5);
    }
    ctx.stroke();
  }

  function drawClouds(t) {
    const span = SPAN_COLS * TILE;
    ctx.fillStyle = theme.cloud;
    for (let i = 0; i < CLOUDS.length; i++) {
      const cloud = CLOUDS[i];
      const raw = cloud.c * TILE - t * 14;
      let x = (((raw % span) + span) % span) - TILE * 3;
      const y = cloud.r * TILE;
      if (x > w || y > h) continue;
      if (theme.square) x = Math.round(x / 8) * 8; // retro clouds move in chunky steps
      for (let j = 0; j < 3; j++) {
        let pulse = 0.72 + 0.28 * Math.sin(t * 2.2 + i * 0.7 + j * 0.9);
        if (theme.square) pulse = Math.round(pulse * 4) / 4;
        const size = TILE * pulse;
        ctx.beginPath();
        ctx.roundRect(
          x + j * TILE + (TILE - size) / 2,
          y + (TILE - size) / 2,
          size,
          size,
          theme.square ? 0 : CLOUD_RADIUS * pulse
        );
        ctx.fill();
      }
    }
  }

  function draw(t) {
    drawSky();
    drawGrid();
    if (theme.stars) PixelParty.drawStars(ctx, w, h, t);
    drawClouds(t);
  }

  function frame(ms) {
    draw(ms / 1000);
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", () => {
    resize();
    if (reduceMotion) draw(0);
  });
  window.addEventListener("pixelparty:change", () => {
    theme = PixelParty.theme();
    if (reduceMotion) draw(0);
  });
  requestAnimationFrame(frame);
})();
