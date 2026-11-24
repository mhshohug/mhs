export type RGB = [number, number, number];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function evalQuadBezier(
  p0x: number,
  p0y: number,
  cx: number,
  cy: number,
  p1x: number,
  p1y: number,
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * p0x + 2 * u * t * cx + t * t * p1x,
    y: u * u * p0y + 2 * u * t * cy + t * t * p1y,
  };
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function rgbCss(c: RGB, alpha = 1): string {
  return alpha >= 0.999
    ? `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha.toFixed(3)})`;
}

/** Deterministic tileable 2D value noise for seamless horizon-perspective clouds */
export function hash2dPeriodic(ix: number, iy: number, periodX: number): number {
  const wx = ((ix % periodX) + periodX) % periodX;
  const n = Math.sin(wx * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function periodicNoise2d(x: number, y: number, periodX: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2dPeriodic(ix, iy, periodX);
  const b = hash2dPeriodic(ix + 1, iy, periodX);
  const c = hash2dPeriodic(ix, iy + 1, periodX);
  const d = hash2dPeriodic(ix + 1, iy + 1, periodX);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function periodicFbm2d(x: number, y: number, periodX: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise2d(x * freq, y * freq, periodX * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function smoothTurb1d(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const h0 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const h1 = Math.sin((i + 1) * 127.1 + 311.7) * 43758.5453;
  const r0 = h0 - Math.floor(h0);
  const r1 = h1 - Math.floor(h1);
  return (r0 + (r1 - r0) * u) * 2 - 1;
}

export function sampleLocalWind(
  x: number,
  viewW: number,
  tSec: number,
  baseWind: number,
  wSign: number,
  freqMult: number,
  seed: number
): { bend: number; flutter: number; pocket: number } {
  if (baseWind <= 0.01) return { bend: 0, flutter: 0, pocket: 0 };
  const u = x / Math.max(640, viewW);
  const clampedWind = Math.min(1.8, baseWind);
  const travelPos1 = u - wSign * tSec * (0.15 + clampedWind * 0.075);
  const travelPos2 = u * 1.35 - wSign * tSec * (0.22 + clampedWind * 0.105) + 3.7;
  // Traveling gust pockets (0.42..1.34) so wind rolls smoothly across the landscape
  const g1 = 0.5 + 0.5 * smoothTurb1d(travelPos1 * 2.1 + 1.3);
  const g2 = 0.5 + 0.5 * smoothTurb1d(travelPos2 * 3.0 + 7.1);
  const pocket = 0.42 + (g1 * 0.65 + g2 * 0.35) * 0.92;

  // Smoothly saturating wind pressure avoids sudden jumps or over-bending during gusts
  const normWind = baseWind / (1 + baseWind * 0.42);
  // Slow rolling gust swell (no rapid mid/high-frequency trunk shaking)
  const slowSwell = smoothTurb1d(tSec * (0.22 + normWind * 0.16) * freqMult + seed * 5.3);
  const gentleSurge = smoothTurb1d(tSec * (0.46 + normWind * 0.22) * freqMult + seed * 11.7) * 0.35;
  const gustEnvelope = 0.78 + slowSwell * 0.24 + gentleSurge * 0.14;

  const bend = normWind * pocket * gustEnvelope;

  // Expressive leaf flutter at a smooth, non-jittery natural cadence
  const leafWave1 = Math.sin(tSec * (1.15 + normWind * 0.62) * freqMult + seed * 7.3);
  const leafWave2 = smoothTurb1d(tSec * (1.72 + normWind * 0.82) * freqMult + seed * 14.9) * 0.75;
  const flutter = normWind * pocket * (leafWave1 * 0.68 + leafWave2 * 0.55);
  return { bend, flutter, pocket };
}

export function getMoonPhaseFraction(d: Date = new Date()): number {
  const knownNewMoon = 1704974220000;
  const synodicMonthMs = 29.53058867 * 86400000;
  const diff = (d.getTime() - knownNewMoon) % synodicMonthMs;
  return ((diff + synodicMonthMs) % synodicMonthMs) / synodicMonthMs;
}

export interface CloudBank {
  dayC: HTMLCanvasElement;
  stormC: HTMLCanvasElement;
  grid: Float32Array;
}

export function buildCloudBank(
  seedShift: number,
  bandMinY: number,
  bandMaxY: number,
  sparsity: number,
  puffContrast: number
): CloudBank {
  const CW = 512;
  const CH = 192;
  const PERIOD_X = 12;
  const densityMap = new Float32Array(CW * CH);

  for (let y = 0; y < CH; y++) {
    const yn = y / CH;
    let vEnv = 0;
    if (yn >= bandMinY && yn <= bandMaxY) {
      const t = (yn - bandMinY) / (bandMaxY - bandMinY);
      vEnv = Math.sin(Math.pow(t, 0.66) * Math.PI);
    }
    for (let x = 0; x < CW; x++) {
      const xn = (x / CW) * PERIOD_X;
      const nMacro = periodicFbm2d(xn * 0.75 + seedShift, yn * 3.8 + seedShift * 0.5, PERIOD_X * 0.75, 4);
      const nMain = periodicFbm2d(xn + seedShift * 1.3, yn * 5.6 + seedShift * 0.9, PERIOD_X, 5);
      const nWisps = periodicFbm2d(xn * 2.0 + 4.3, yn * 10.2 + 1.8, PERIOD_X * 2, 3);
      const raw = nMacro * 0.42 + nMain * 0.42 + nWisps * 0.16;
      const shaped = Math.max(0, (raw * (0.52 + vEnv * 0.98) - sparsity) / (1 - sparsity));
      densityMap[y * CW + x] = Math.min(1, Math.pow(shaped, puffContrast) * vEnv * 1.65);
    }
  }

  const dayC = document.createElement('canvas');
  dayC.width = CW;
  dayC.height = CH;
  const dCtx = dayC.getContext('2d');

  const stormC = document.createElement('canvas');
  stormC.width = CW;
  stormC.height = CH;
  const sCtx = stormC.getContext('2d');

  const grid = new Float32Array(128 * 48);

  if (dCtx && sCtx) {
    const dImg = dCtx.createImageData(CW, CH);
    const sImg = sCtx.createImageData(CW, CH);
    const dd = dImg.data;
    const sd = sImg.data;

    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const idx = y * CW + x;
        const dens = densityMap[idx];
        if (dens <= 0.004) continue;

        const upY = Math.max(0, y - 5);
        const upDens = densityMap[upY * CW + x];
        const lightDelta = upDens - dens;
        const topLight = Math.max(0, Math.min(1, 0.74 - lightDelta * 2.15 - (y / CH) * 0.36));

        const dR = Math.round(134 + topLight * 120);
        const dG = Math.round(146 + topLight * 108);
        const dB = Math.round(166 + topLight * 88);

        const sR = Math.round(38 + topLight * 112);
        const sG = Math.round(46 + topLight * 118);
        const sB = Math.round(62 + topLight * 124);

        const alphaByte = Math.round(Math.min(1, dens * 1.28) * 255);
        const p = idx * 4;
        dd[p] = dR;
        dd[p + 1] = dG;
        dd[p + 2] = dB;
        dd[p + 3] = alphaByte;

        sd[p] = sR;
        sd[p + 1] = sG;
        sd[p + 2] = sB;
        sd[p + 3] = alphaByte;
      }
    }
    dCtx.putImageData(dImg, 0, 0);
    sCtx.putImageData(sImg, 0, 0);

    for (let gy = 0; gy < 48; gy++) {
      const sy = Math.min(CH - 1, Math.floor(((gy + 0.5) / 48) * CH));
      for (let gx = 0; gx < 128; gx++) {
        const sx = Math.min(CW - 1, Math.floor(((gx + 0.5) / 128) * CW));
        grid[gy * 128 + gx] = densityMap[sy * CW + sx];
      }
    }
  }

  return { dayC, stormC, grid };
}

export function sampleBankAlpha(
  grid: Float32Array,
  px: number,
  py: number,
  scrollX: number,
  tileW: number,
  topY: number,
  drawH: number
): number {
  if (py < topY || py > topY + drawH) return 0;
  const wrappedX = (((px - scrollX) % tileW) + tileW) % tileW;
  const gx = Math.min(127, Math.floor((wrappedX / tileW) * 128));
  const gy = Math.min(47, Math.floor(((py - topY) / drawH) * 48));
  return grid[gy * 128 + gx];
}

export interface BotanicalSpritePack {
  sprigCool: HTMLCanvasElement[];
  sprigSun: HTMLCanvasElement[];
  sprigGolden: HTMLCanvasElement[];
  sprigMonsoon: HTMLCanvasElement[];
  sprigWinter: HTMLCanvasElement[];
  sprigSunRim: HTMLCanvasElement[];
  sprigGoldenRim: HTMLCanvasElement[];
  sprigMoonRim: HTMLCanvasElement[];
  teaDark: HTMLCanvasElement[];
  teaSun: HTMLCanvasElement[];
  grassDark: HTMLCanvasElement[];
  grassLit: HTMLCanvasElement[];
}

export function createLeafSprigSprite(
  seed: number,
  shadowRgb: RGB,
  midRgb: RGB,
  outerRgb: RGB,
  veinRgb: RGB,
  rimOnly = false,
  leafDensity = 1
): HTMLCanvasElement {
  const S = 148;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) return c;

  const cx = S * 0.5;
  const cy = S * 0.54;
  const rand = (k: number) => {
    const v = Math.sin(seed * 31.7 + k * 17.13) * 43758.5453;
    return v - Math.floor(v);
  };

  if (!rimOnly) {
    g.strokeStyle = rgbCss([26, 20, 16], 0.62);
    g.lineCap = 'round';
    for (let t = 0; t < 5; t++) {
      const a = -Math.PI * 0.88 + t * 0.44 + (rand(t + 90) - 0.5) * 0.25;
      const len = 20 + rand(t + 95) * 24;
      g.lineWidth = 1.9 - t * 0.16;
      g.beginPath();
      g.moveTo(cx, cy + 16);
      g.quadraticCurveTo(
        cx + Math.cos(a) * len * 0.52,
        cy + 12 + Math.sin(a) * len * 0.52,
        cx + Math.cos(a) * len,
        cy + 10 + Math.sin(a) * len
      );
      g.stroke();
    }
  }

  // Rich 3D multi-layer canopy (114 overlapping pointed leaves matching StormyBoyBackdrop's botanical density)
  const totalLeaves = Math.max(18, Math.round((rimOnly ? 44 : 114) * leafDensity));
  for (let i = 0; i < totalLeaves; i++) {
    const layer = i / totalLeaves;
    const ang = rand(i * 3) * Math.PI * 2;
    const dist = (rimOnly ? 14 : 3) + Math.pow(rand(i * 3 + 1), 0.72) * (rimOnly ? 38 : 48);
    const lx = cx + Math.cos(ang) * dist;
    const ly = cy + Math.sin(ang) * dist * 0.78 - 2;
    const leafLen = 9.5 + rand(i * 3 + 2) * 11.5;
    const leafWid = 3.0 + rand(i * 7 + 5) * 2.6;
    const tilt = ang + (rand(i * 5) - 0.5) * 0.95;

    const col = rimOnly
      ? layer < 0.45
        ? midRgb
        : outerRgb
      : layer < 0.34
        ? shadowRgb
        : layer < 0.74
          ? midRgb
          : outerRgb;
    const alpha = rimOnly ? 0.56 + layer * 0.36 : 0.84 + layer * 0.14;

    g.save();
    g.translate(lx, ly);
    g.rotate(tilt);

    g.fillStyle = rgbCss(col, alpha);
    g.beginPath();
    g.moveTo(-leafLen * 0.44, 0);
    g.quadraticCurveTo(0, -leafWid, leafLen * 0.58, 0);
    g.quadraticCurveTo(0, leafWid, -leafLen * 0.44, 0);
    g.closePath();
    g.fill();

    if (layer > 0.48 || rimOnly) {
      g.strokeStyle = rgbCss(veinRgb, rimOnly ? 0.62 : 0.38);
      g.lineWidth = 0.65;
      g.beginPath();
      g.moveTo(-leafLen * 0.34, 0);
      g.lineTo(leafLen * 0.46, 0);
      g.stroke();
    }
    g.restore();
  }
  return c;
}

/** High-detail Matte 3D Tea Shrub Sprite covered in hundreds of irregular serrated leaves & two-leaf-and-a-bud shoots (zero glossy dome) */
export function createTeaBushSprite(seed: number, lit: boolean): HTMLCanvasElement {
  const W = 184;
  const H = 104;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return c;

  const rand = (k: number) => {
    const v = Math.sin(seed * 41.3 + k * 19.7) * 43758.5453;
    return v - Math.floor(v);
  };

  // Irregular organic woody dark interior foliage shadow clusters (broken silhouette — never a smooth jelly dome!)
  for (let cl = 0; cl < 18; cl++) {
    const ang = (cl / 18) * Math.PI * 2;
    const cx = W * 0.5 + Math.cos(ang) * (W * (0.24 + rand(cl * 3) * 0.14));
    const cy = H * 0.56 + Math.sin(ang) * (H * (0.14 + rand(cl * 5) * 0.12));
    const radX = 24 + rand(cl * 7) * 16;
    const radY = 16 + rand(cl * 11) * 10;
    g.fillStyle = lit ? 'rgb(14, 42, 16)' : 'rgb(7, 22, 10)';
    g.beginPath();
    g.ellipse(cx, cy, radX, radY, (rand(cl * 13) - 0.5) * 0.6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = lit ? 'rgb(18, 52, 18)' : 'rgb(9, 26, 12)';
  g.beginPath();
  g.ellipse(W * 0.5, H * 0.58, W * 0.34, H * 0.25, 0, 0, Math.PI * 2);
  g.fill();

  // Soft woody twig forks visible deep inside crevices
  g.strokeStyle = lit ? 'rgba(42, 34, 22, 0.55)' : 'rgba(20, 18, 12, 0.6)';
  g.lineWidth = 1.6;
  for (let tw = 0; tw < 7; tw++) {
    const bx = W * (0.25 + tw * 0.083) + (rand(tw * 17) - 0.5) * 8;
    g.beginPath();
    g.moveTo(bx, H * 0.86);
    g.lineTo(bx + (rand(tw * 19) - 0.5) * 18, H * 0.56);
    g.stroke();
  }

  // 420 crisp matte pointed tea leaves & fresh young flush shoots protruding naturally past rim
  const total = 420;
  for (let i = 0; i < total; i++) {
    const layer = i / total;
    const a = rand(i * 3) * Math.PI * 2;
    const r = Math.pow(rand(i * 3 + 1), 0.54);
    const lx = W * 0.5 + Math.cos(a) * r * (W * 0.46);
    const ly = H * 0.58 + Math.sin(a) * r * (H * 0.32) - layer * 14;
    const tilt = Math.cos(a) * 0.55 + (rand(i * 5) - 0.5) * 1.35;
    const leafLen = 6.2 + rand(i * 7) * 5.8;
    const leafWid = 2.3 + rand(i * 11) * 1.45;

    let rgb: RGB;
    if (layer < 0.28) {
      rgb = lit ? [16, 48, 18] : [8, 26, 12];
    } else if (layer < 0.62) {
      rgb = lit ? [34, 92, 30] : [16, 48, 18];
    } else if (layer < 0.84) {
      rgb = lit ? [58, 128, 38] : [26, 70, 24];
    } else {
      // Fresh matte spring-green plucked tea shoot (দুটি পাতা একটি কুঁড়ি) — earthy botanical greens, never neon jelly!
      rgb = lit ? [112, 174, 52] : [42, 92, 32];
    }

    g.save();
    g.translate(lx, ly);
    g.rotate(tilt);
    g.fillStyle = rgbCss(rgb, 0.97);
    g.beginPath();
    g.moveTo(-leafLen * 0.46, 0);
    g.quadraticCurveTo(-leafLen * 0.05, -leafWid, leafLen * 0.58, 0);
    g.quadraticCurveTo(-leafLen * 0.05, leafWid, -leafLen * 0.46, 0);
    g.closePath();
    g.fill();

    // Subtle matte leaf edge shadow & central vein for tactile crisp botanical look
    if (layer > 0.52) {
      g.strokeStyle = rgbCss(lit ? [22, 58, 20] : [8, 24, 10], 0.32);
      g.lineWidth = 0.55;
      g.stroke();
    }
    if (layer > 0.72) {
      g.strokeStyle = rgbCss(lit ? [154, 204, 88] : [58, 108, 42], 0.45);
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(-leafLen * 0.25, 0);
      g.lineTo(leafLen * 0.42, 0);
      g.stroke();
    }
    g.restore();
  }
  return c;
}

/** Pre-baked ultra-dense curved botanical turf clump sprite (organic arching blades — zero spiky triangles!) */
export function createDenseGrassSprite(seed: number, lit: boolean): HTMLCanvasElement {
  const W = 128;
  const H = 56;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return c;

  const rand = (k: number) => {
    const v = Math.sin(seed * 29.1 + k * 13.7) * 43758.5453;
    return v - Math.floor(v);
  };

  // Rich shaded earth/moss root bed at base of grass cluster
  g.fillStyle = lit ? 'rgba(22, 56, 20, 0.85)' : 'rgba(10, 26, 12, 0.88)';
  g.beginPath();
  g.ellipse(W * 0.5, H - 4, W * 0.48, 7.5, 0, 0, Math.PI * 2);
  g.fill();

  // 115 densely layered curved arching grass blades fanning naturally from root nodes
  const blades = 115;
  g.lineCap = 'round';
  for (let i = 0; i < blades; i++) {
    const layer = i / blades;
    const gx = 8 + rand(i * 3) * (W - 16);
    const gy = H - 2 - rand(i * 5) * 6;
    const bh = 12 + rand(i * 7) * 24;
    // Fan outward horizontally like real wild river/meadow grass, arching at the tip
    const splayDir = ((gx - W * 0.5) / (W * 0.5)) * 11 + (rand(i * 11) - 0.5) * 16;
    const midX = gx + splayDir * 0.38;
    const midY = gy - bh * 0.68;
    const tipX = gx + splayDir;
    const tipY = gy - bh + Math.abs(splayDir) * 0.24; // natural gravity droop!

    const col: RGB =
      layer < 0.34
        ? lit ? [20, 56, 20] : [10, 28, 12]
        : layer < 0.72
          ? lit ? [44, 102, 32] : [20, 52, 20]
          : layer < 0.9
            ? lit ? [82, 146, 44] : [32, 74, 28]
            : lit ? [126, 178, 62] : [48, 92, 36];

    g.strokeStyle = rgbCss(col, 0.92);
    g.lineWidth = 1.6 - layer * 0.55;
    g.beginPath();
    g.moveTo(gx, gy);
    g.bezierCurveTo(
      gx + splayDir * 0.14,
      gy - bh * 0.42,
      midX,
      midY - 2,
      tipX,
      tipY
    );
    g.stroke();
  }
  return c;
}

export function buildBotanicalSpritePack(): BotanicalSpritePack {
  const seeds = [1.1, 2.7, 4.3, 6.9, 9.2, 11.4];
  const quadSeeds = [1.4, 3.8, 6.2, 8.9];
  return {
    sprigCool: seeds.map((s) =>
      createLeafSprigSprite(s, [12, 26, 20], [20, 44, 28], [32, 66, 36], [52, 92, 54], false, 1)
    ),
    sprigSun: seeds.map((s) =>
      createLeafSprigSprite(s, [22, 50, 22], [44, 88, 32], [78, 134, 44], [126, 178, 66], false, 1)
    ),
    sprigGolden: seeds.map((s) =>
      createLeafSprigSprite(s, [34, 46, 20], [72, 84, 30], [134, 122, 46], [198, 166, 68], false, 1)
    ),
    sprigMonsoon: seeds.map((s) =>
      createLeafSprigSprite(s, [8, 28, 18], [16, 54, 28], [28, 84, 38], [62, 128, 60], false, 1.25)
    ),
    sprigWinter: seeds.map((s) =>
      createLeafSprigSprite(s, [44, 36, 18], [86, 66, 26], [132, 94, 34], [176, 134, 58], false, 0.52)
    ),
    sprigSunRim: seeds.map((s) =>
      createLeafSprigSprite(s, [96, 148, 48], [136, 188, 64], [184, 226, 88], [228, 248, 138], true, 0.95)
    ),
    sprigGoldenRim: seeds.map((s) =>
      createLeafSprigSprite(s, [138, 112, 42], [188, 144, 52], [238, 178, 72], [255, 220, 122], true, 0.95)
    ),
    sprigMoonRim: seeds.map((s) =>
      createLeafSprigSprite(s, [68, 96, 124], [116, 152, 188], [168, 202, 236], [218, 238, 255], true, 0.9)
    ),
    teaDark: quadSeeds.map((s) => createTeaBushSprite(s, false)),
    teaSun: quadSeeds.map((s) => createTeaBushSprite(s, true)),
    grassDark: quadSeeds.map((s) => createDenseGrassSprite(s, false)),
    grassLit: quadSeeds.map((s) => createDenseGrassSprite(s, true)),
  };
}

export function drawTaperedCurve(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  fillCss: string,
  sunEdgeCss: string | null,
  sunDirX: number
) {
  const steps = 6;
  const leftPts: Array<{ x: number; y: number }> = [];
  const rightPts: Array<{ x: number; y: number }> = [];

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    const px = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const py = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    const ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const mag = Math.hypot(tx, ty) || 1;
    const nx = -ty / mag;
    const ny = tx / mag;
    const halfW = (w0 + (w1 - w0) * Math.pow(t, 0.85)) * 0.5;
    leftPts.push({ x: px + nx * halfW, y: py + ny * halfW });
    rightPts.push({ x: px - nx * halfW, y: py - ny * halfW });
  }

  ctx.fillStyle = fillCss;
  ctx.beginPath();
  ctx.moveTo(leftPts[0].x, leftPts[0].y);
  for (let s = 1; s <= steps; s++) ctx.lineTo(leftPts[s].x, leftPts[s].y);
  for (let s = steps; s >= 0; s--) ctx.lineTo(rightPts[s].x, rightPts[s].y);
  ctx.closePath();
  ctx.fill();

  if (sunEdgeCss) {
    const sidePts = sunDirX >= 0 ? leftPts : rightPts;
    ctx.strokeStyle = sunEdgeCss;
    ctx.lineWidth = Math.max(1.15, w0 * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sidePts[0].x, sidePts[0].y);
    for (let s = 1; s <= steps; s++) ctx.lineTo(sidePts[s].x, sidePts[s].y);
    ctx.stroke();
  }
}

export function drawArticulatedPalm(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  baseX: number,
  baseY: number,
  palmH: number,
  baseLean: number,
  frondCount: number,
  seed: number,
  freqMult: number,
  windFactor: number,
  windSign: number,
  tSec: number,
  orbX: number,
  orbY: number,
  barkColor: string,
  sunBarkColor: string | null,
  frondColor: string,
  rimColor: string,
  sunlightFactor: number,
  withCoconuts = true,
  hasSapPot = false
) {
  const wSample = sampleLocalWind(baseX, viewW, tSec, windFactor, windSign, freqMult, seed);
  const segs = 10;
  const pts: Array<{ x: number; y: number }> = [{ x: baseX, y: baseY }];
  let cx = baseX;
  let cy = baseY;
  const windBendTotal = windSign * Math.min(0.2, wSample.bend * 0.145);

  for (let s = 1; s <= segs; s++) {
    const t = s / segs;
    const stepH = palmH / segs;
    const leanNow = baseLean + windBendTotal * Math.pow(t, 1.5);
    cx += Math.sin(leanNow) * stepH;
    cy -= Math.cos(leanNow) * stepH;
    pts.push({ x: cx, y: cy });
  }

  const tip = pts[pts.length - 1];
  const toSunX = orbX - tip.x;
  const toSunY = orbY - tip.y;
  const toSunMag = Math.hypot(toSunX, toSunY) || 1;
  const sUx = toSunX / toSunMag;
  const sUy = toSunY / toSunMag;

  ctx.save();
  ctx.lineCap = 'round';
  for (let s = 0; s < segs; s++) {
    const t = s / segs;
    const w0 = (1 - t * 0.66) * (palmH * 0.056) + 2.0;
    const w1 = (1 - ((s + 1) / segs) * 0.66) * (palmH * 0.056) + 1.5;
    const midSegX = (pts[s].x + pts[s + 1].x) * 0.5;
    const midSegY = (pts[s].y + pts[s + 1].y) * 0.5;
    drawTaperedCurve(
      ctx,
      pts[s].x,
      pts[s].y,
      midSegX,
      midSegY,
      pts[s + 1].x,
      pts[s + 1].y,
      w0,
      w1,
      barkColor,
      sunBarkColor,
      sUx
    );
  }

  // Ringed palm bark leaf-scars along trunk (খাঁজকাটা নারিকেল কাণ্ড)
  ctx.strokeStyle = 'rgba(18, 12, 8, 0.42)';
  ctx.lineWidth = 1.05;
  for (let r = 1; r < segs * 2; r++) {
    const tf = r / (segs * 2);
    const si = Math.min(segs - 1, Math.floor(tf * segs));
    const localF = tf * segs - si;
    const rx = lerp(pts[si].x, pts[si + 1].x, localF);
    const ry = lerp(pts[si].y, pts[si + 1].y, localF);
    const rw = ((1 - tf * 0.66) * (palmH * 0.056) + 1.8) * 0.48;
    ctx.beginPath();
    ctx.moveTo(rx - rw, ry + 0.6);
    ctx.quadraticCurveTo(rx, ry + 1.8, rx + rw, ry + 0.4);
    ctx.stroke();
  }

  // Optional winter date-palm sap clay pot (শীতকালে খেজুর রসের মাটির হাঁড়ি!)
  if (hasSapPot && palmH > 85) {
    const potPt = pts[segs - 2];
    ctx.fillStyle = 'rgba(92, 54, 34, 0.92)';
    ctx.fillRect(potPt.x - 4.5, potPt.y - 6, 9, 4.5);
    // Bamboo spout (`নলি`) + hanging terracotta clay sap pot (`রসের হাঁড়ি`)
    ctx.strokeStyle = '#d9b37c';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(potPt.x + 2, potPt.y - 2);
    ctx.lineTo(potPt.x + 7, potPt.y + 3);
    ctx.stroke();
    ctx.fillStyle = '#9a4326';
    ctx.beginPath();
    ctx.ellipse(potPt.x + 7.5, potPt.y + 9.5, 4.8, 5.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5c2614';
    ctx.beginPath();
    ctx.ellipse(potPt.x + 7.5, potPt.y + 4.4, 3.3, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const crownScale = palmH * 0.42;
  // Crown base coconut cluster (ডাব/নারিকেল) tucked right beneath crown petioles
  if (withCoconuts && palmH > 75) {
    const nuts = [
      { ox: -5.5, oy: 4.5, r: 4.2, col: '#2f6f26' },
      { ox: 4.5, oy: 5.2, r: 4.1, col: '#3a7d28' },
      { ox: -0.5, oy: 6.4, r: 4.3, col: '#4a8c2a' },
      { ox: -3.2, oy: 2.0, r: 3.6, col: '#69992e' },
    ];
    nuts.forEach((cn) => {
      ctx.fillStyle = cn.col;
      ctx.beginPath();
      ctx.ellipse(tip.x + cn.ox, tip.y + cn.oy, cn.r, cn.r * 1.15, 0.15, 0, Math.PI * 2);
      ctx.fill();
      if (sunlightFactor > 0.18) {
        ctx.fillStyle = `rgba(218, 244, 152, ${(0.34 * sunlightFactor).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(tip.x + cn.ox - 1.1, tip.y + cn.oy - 1.3, cn.r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Textured brown fibrous crown heart
  ctx.fillStyle = '#4e3724';
  ctx.beginPath();
  ctx.ellipse(tip.x, tip.y + 1, 7.5, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const totalFronds = Math.max(7, frondCount);
  // Draw back-layer fronds first (darker) -> upright/front arching fronds on top (brighter sunlit pinnae!)
  const frondIndices = Array.from({ length: totalFronds }, (_, i) => i).sort((a, b) => {
    const ya = Math.sin(-Math.PI + (a / Math.max(1, totalFronds - 1)) * Math.PI * 1.24 - 0.14);
    const yb = Math.sin(-Math.PI + (b / Math.max(1, totalFronds - 1)) * Math.PI * 1.24 - 0.14);
    return ya - yb;
  });

  const frondTips: Array<{ x: number; y: number }> = [];
  const frondMids: Array<{ x: number; y: number }> = [];

  for (const f of frondIndices) {
    const isBack = f % 2 === 0;
    const baseFrondAng = -Math.PI * 1.06 + (f / Math.max(1, totalFronds - 1)) * Math.PI * 1.18;
    const fTurbulence =
      windFactor > 0.015
        ? smoothTurb1d(tSec * (0.72 + Math.min(1.4, windFactor) * 0.38) * freqMult + seed * 3.1 + f * 1.7) *
          (0.03 + wSample.pocket * Math.min(1.4, windFactor) * 0.11)
        : 0;
    const windStreamBias = windSign * Math.min(0.28, wSample.bend * 0.2);
    const fAng = baseFrondAng + windStreamBias * 0.45 + fTurbulence;
    const fLen = crownScale * (0.82 + (f % 3) * 0.11);

    const endX = tip.x + Math.cos(fAng) * fLen;
    const endY = tip.y + Math.sin(fAng) * fLen + fLen * (0.34 + (f % 2) * 0.12);
    const midX = (tip.x + endX) * 0.5 + Math.cos(fAng) * fLen * 0.08;
    const midY = (tip.y + endY) * 0.5 - fLen * 0.32;

    const uMid = 0.45;
    const m1 = 1 - uMid;
    frondMids.push({
      x: m1 * m1 * tip.x + 2 * m1 * uMid * midX + uMid * uMid * endX,
      y: m1 * m1 * tip.y + 2 * m1 * uMid * midY + uMid * uMid * endY,
    });
    frondTips.push({ x: endX, y: endY });

    const sunFacing = Math.max(0, Math.cos(fAng) * sUx + Math.sin(fAng) * sUy + 0.4);
    const frondLit = Math.min(1, sunlightFactor * (0.45 + sunFacing * 0.85));

    // Tapered arched woody green-gold rachis (ডাটা)
    drawTaperedCurve(
      ctx,
      tip.x,
      tip.y,
      midX,
      midY,
      endX,
      endY,
      3.4,
      0.85,
      frondLit > 0.45 && !isBack ? rimColor : frondColor,
      sunlightFactor > 0.25 ? rimColor : null,
      sUx
    );

    // 26 V-pleated botanical lanceolate pinnae sweeping naturally FORWARD along frond curve (zero hanging threads!)
    const leafletCount = 26;
    for (let l = 3; l <= leafletCount; l++) {
      const lt = l / leafletCount;
      const u = 1 - lt;
      const px = u * u * tip.x + 2 * u * lt * midX + lt * lt * endX;
      const py = u * u * tip.y + 2 * u * lt * midY + lt * lt * endY;
      // Tangent vector along arched rachis at lt
      const tx = 2 * u * (midX - tip.x) + 2 * lt * (endX - midX);
      const ty = 2 * u * (midY - tip.y) + 2 * lt * (endY - midY);
      const tangAng = Math.atan2(ty, tx);

      // Pinnae taper near base & tip, fullest across mid-frond
      const env = Math.sin(Math.pow(lt, 0.88) * Math.PI);
      const bladeLen = env * (fLen * 0.34) + 3.8;
      const bladeHalfW = Math.max(1.05, bladeLen * 0.11);

      const leafJiggle =
        windFactor > 0.015
          ? smoothTurb1d(tSec * (1.45 + Math.min(1.4, windFactor) * 0.65) + f * 2.3 + l * 0.7) *
              wSample.pocket *
              Math.min(1.4, windFactor) *
              0.24 +
            wSample.flutter * 0.18
          : 0;

      // Render BOTH upper sunlit edge leaflets and lower shaded drooping leaflets for true 3D pinnate volume!
      for (const side of [-1, 1] as const) {
        // Upper edge points gently upward-forward early then arches gracefully; lower edge sweeps outward-downward
        const sweepAngle =
          tangAng +
          side * (0.68 - lt * 0.26) +
          (side > 0 ? 0.16 * lt : -0.06) +
          windSign * Math.min(0.32, wSample.bend * 0.24) +
          leafJiggle;
        const tipX = px + Math.cos(sweepAngle) * bladeLen;
        const tipY = py + Math.sin(sweepAngle) * bladeLen + lt * bladeLen * 0.18;
        const bendMidX = (px + tipX) * 0.5 + Math.cos(tangAng) * bladeLen * 0.12;
        const bendMidY = (py + tipY) * 0.5 - (side < 0 ? bladeLen * 0.1 : -bladeLen * 0.05);
        const nx = -Math.sin(sweepAngle) * bladeHalfW;
        const ny = Math.cos(sweepAngle) * bladeHalfW;

        const isLitPinna = !isBack && ((side < 0 && frondLit > 0.24) || (frondLit > 0.55 && lt > 0.22));
        ctx.fillStyle = isLitPinna ? rimColor : frondColor;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(bendMidX + nx, bendMidY + ny, tipX, tipY);
        ctx.quadraticCurveTo(bendMidX - nx * 0.65, bendMidY - ny * 0.65, px, py);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
  return { x: tip.x, y: tip.y, frondTips, frondMids };
}

/** Articulated Bengali Banana Plant (কলাগাছ) with broad drooping leaves swaying in wind */
export function drawBananaPlant(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  baseX: number,
  baseY: number,
  heightPx: number,
  seed: number,
  windFactor: number,
  windSign: number,
  tSec: number,
  dayWeight: number,
  sunlightFactor: number,
  moonVis: number
) {
  const w = sampleLocalWind(baseX, viewW, tSec, windFactor, windSign, 1.0, seed);
  const bend = windSign * Math.min(10, w.bend * 8.5);
  const topX = baseX + bend * 0.65;
  const topY = baseY - heightPx;

  const trunkCol = rgbCss(lerpRgb([16, 28, 16], [48, 74, 34], dayWeight * 0.8), 0.96);
  drawTaperedCurve(
    ctx,
    baseX,
    baseY,
    baseX + bend * 0.25,
    baseY - heightPx * 0.5,
    topX,
    topY,
    heightPx * 0.16,
    heightPx * 0.08,
    trunkCol,
    null,
    1
  );

  const leafDefs = [-2.55, -2.0, -1.25, -0.55, 0.15];
  const leafDark = rgbCss(lerpRgb([12, 26, 16], [32, 74, 28], dayWeight), 0.95);
  const leafLit = rgbCss(
    sunlightFactor > 0.15 ? [96, 152, 48] : moonVis > 0.15 ? [78, 108, 128] : [48, 94, 38],
    0.92
  );

  ctx.save();
  leafDefs.forEach((baseA, li) => {
    const fl =
      windFactor > 0.015
        ? smoothTurb1d(tSec * (1.1 + Math.min(1.4, windFactor) * 0.52) + seed + li * 1.9) *
            w.pocket *
            Math.min(1.4, windFactor) *
            0.16 +
          w.flutter * 0.14
        : 0;
    const ang = baseA + windSign * Math.min(0.24, w.bend * 0.19) + fl;
    const len = heightPx * (0.72 + (li % 2) * 0.16);
    const lx = topX + Math.cos(ang) * len;
    const ly = topY + Math.sin(ang) * len + len * 0.28;
    const mx = (topX + lx) * 0.5;
    const my = (topY + ly) * 0.5 - len * 0.22;

    ctx.fillStyle = li % 2 === 0 && (sunlightFactor > 0.15 || moonVis > 0.2) ? leafLit : leafDark;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(mx, my - len * 0.16, lx, ly);
    ctx.quadraticCurveTo(mx, my + len * 0.12, topX, topY);
    ctx.closePath();
    ctx.fill();

    // Central leaf midrib
    ctx.strokeStyle = rgbCss([26, 48, 22], 0.55);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(mx, my - len * 0.04, lx, ly);
    ctx.stroke();
  });
  ctx.restore();
}

/** Articulated Bengali Bamboo Grove (বাঁশঝাড়) bending gracefully with wind */
export function drawBambooClump(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  baseX: number,
  baseY: number,
  maxH: number,
  stalkCount: number,
  seed: number,
  windFactor: number,
  windSign: number,
  tSec: number,
  dayWeight: number,
  sunlightFactor: number,
  pack: BotanicalSpritePack
) {
  const stalkCol = rgbCss(lerpRgb([14, 24, 18], [52, 74, 38], dayWeight), 0.94);
  for (let i = 0; i < stalkCount; i++) {
    const offX = (i - (stalkCount - 1) * 0.5) * 9;
    const sH = maxH * (0.78 + ((i * 7) % 5) * 0.06);
    const sx = baseX + offX;
    const w = sampleLocalWind(sx, viewW, tSec, windFactor, windSign, 0.95 + (i % 3) * 0.1, seed + i);
    const arch = ((i - stalkCount * 0.5) * 0.09) + windSign * Math.min(0.22, w.bend * 0.155);
    const tipX = sx + Math.sin(arch) * sH;
    const tipY = baseY - Math.cos(arch * 0.65) * sH;
    const cx = sx + Math.sin(arch * 0.45) * (sH * 0.52);
    const cy = baseY - sH * 0.54;

    drawTaperedCurve(ctx, sx, baseY, cx, cy, tipX, tipY, 4.2, 1.4, stalkCol, null, 1);

    // Feathery bamboo leaf clusters along upper half with expressive, smooth wind sweep
    for (let k = 0; k < 3; k++) {
      const f = k === 0 ? 0.56 : k === 1 ? 0.76 : 0.95;
      const u = 1 - f;
      const bx = u * u * sx + 2 * u * f * cx + f * f * tipX;
      const by = u * u * baseY + 2 * u * f * cy + f * f * tipY;
      const spr = sunlightFactor > 0.2 ? pack.sprigSun[(i + k) % 6] : pack.sprigCool[(i + k) % 6];
      const sz = sH * (0.28 + k * 0.04);
      const leafShake =
        w.flutter * 0.26 +
        Math.sin(tSec * (1.45 + Math.min(1.4, windFactor) * 0.65) + seed + i * 1.7 + k * 2.3) *
          (0.05 + Math.min(1.4, windFactor) * 0.13);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(arch * 0.55 + leafShake);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(spr, -sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();
    }
  }
}

/**
 * Draws an ultra-dense, realistic curving meadow grass carpet using lush overlapped organic
 * grass clumps + curved arching botanical blades (zero spiky triangular teeth!).
 */
export function drawGrassTuftBand(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  startX: number,
  endX: number,
  yAtX: (x: number) => number,
  tuftCount: number,
  minH: number,
  maxH: number,
  seed: number,
  windFactor: number,
  windSign: number,
  tSec: number,
  darkRgb: RGB,
  litRgb: RGB,
  sunlightFactor: number,
  flowerRgb?: RGB | null,
  pack?: BotanicalSpritePack
) {
  ctx.save();
  const span = Math.max(40, endX - startX);

  // Overlapping textured turf sprite clusters provide rich continuous depth without gaps
  if (pack) {
    const clumpW = 78;
    const clumpH = clamp01(maxH / 26) * 26 + 20;
    const stepX = Math.max(18, Math.min(28, Math.floor(span / Math.max(14, tuftCount * 0.5))));
    for (let x = startX - 18; x <= endX + 18; x += stepX) {
      const idx = Math.abs(Math.floor(x / stepX + seed * 3));
      const gy = yAtX(x) + 5 + (idx % 3) * 1.8;
      const w = sampleLocalWind(x, viewW, tSec, windFactor, windSign, 0.9, seed + idx * 0.3);
      const tilt = Math.max(-0.28, Math.min(0.28, (windSign * w.bend * 0.14) + Math.sin(tSec * 1.6 + idx * 0.7) * 0.03));

      ctx.save();
      ctx.translate(x, gy);
      ctx.transform(1, 0, tilt, 1, 0, 0);
      ctx.globalAlpha = 0.96;
      ctx.drawImage(pack.grassDark[idx % pack.grassDark.length], -clumpW * 0.5, -clumpH + 4, clumpW, clumpH);
      if (sunlightFactor > 0.08) {
        ctx.globalAlpha = clamp01(sunlightFactor * 0.88);
        ctx.drawImage(pack.grassLit[idx % pack.grassLit.length], -clumpW * 0.5, -clumpH + 4, clumpW, clumpH);
      }
      ctx.restore();
    }
  }

  // Curved multi-blade organic fanning tufts foregrounding turf seams (graceful drooping strokes, NOT triangular wedges!)
  const denseCount = Math.max(tuftCount, Math.floor(span / 5.8));
  const shadeCol = rgbCss(darkRgb, 0.92);
  const sunCol = rgbCss(lerpRgb(darkRgb, litRgb, clamp01(0.42 + sunlightFactor * 0.54)), 0.9);
  ctx.lineCap = 'round';
  for (let i = 0; i < denseCount; i++) {
    const u = (i + 0.5) / denseCount;
    const gx = startX + u * span + Math.sin(i * 2.3 + seed) * 2.5;
    const gy = yAtX(gx) + ((i * 5) % 6) * 1.2 + 2;
    const wave = Math.sin(gx * 0.025 - tSec * (1.8 + windFactor * 0.8) * windSign + i * 0.3);
    const fanDir = ((i % 5) - 2) * 3.1;
    const tipBend = fanDir + windSign * windFactor * 6.0 + wave * (1.8 + windFactor * 2.5);
    const bh = lerp(minH * 0.78, maxH * 0.95, 0.5 + 0.5 * Math.sin(i * 4.1 + seed));

    ctx.strokeStyle = i % 2 === 0 && sunlightFactor > 0.1 ? sunCol : shadeCol;
    ctx.lineWidth = i % 3 === 0 ? 1.5 : 1.15;
    ctx.beginPath();
    ctx.moveTo(gx, gy + 2);
    ctx.bezierCurveTo(
      gx + fanDir * 0.18,
      gy - bh * 0.45,
      gx + tipBend * 0.58,
      gy - bh * 0.86,
      gx + tipBend,
      gy - bh + Math.abs(tipBend) * 0.16
    );
    ctx.stroke();

    if (flowerRgb && i % 9 === 0) {
      ctx.fillStyle = rgbCss(flowerRgb, 0.92);
      ctx.beginPath();
      ctx.arc(gx + tipBend, gy - bh + Math.abs(tipBend) * 0.16, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export interface AtmosphericSkyContext {
  dayWeight: number;
  twilight: number;
  dawnF: number;
  sunsetF: number;
  effectiveCloud: number;
  sunOcclusion: number;
  edgeBreakGlow: number;
  sunlightFactor: number;
  effectiveMoonVis: number;
  nightVis: number;
  rainWeight: number;
  stormWeight: number;
  fogWeight: number;
  windFactor: number;
  windSign: number;
  orbX: number;
  orbY: number;
  topRgb: RGB;
  midRgb: RGB;
  horRgb: RGB;
  distantStormFlash: number;
}

export interface SkyPools {
  bankHigh: CloudBank;
  bankMid: CloudBank;
  bankLow: CloudBank;
  starGlints: Array<{ x: number; y: number; r: number; phase: number; speed: number }>;
  rainDrops: Array<{ x: number; y: number; len: number; speed: number; a: number }>;
  rainSplashes: Array<{ x: number; yRatio: number; r: number; maxR: number; speed: number }>;
  blownLeaves: Array<{ x: number; y: number; vx: number; vy: number; rot: number; vRot: number; size: number; tint: string }>;
  gustStreaks: Array<{ x: number; y: number; len: number; speed: number; a: number }>;
  horizonMists: Array<{ x: number; y: number; rx: number; ry: number; vxBase: number }>;
  cloudScrollHigh: number;
  cloudScrollMid: number;
  cloudScrollLow: number;
  sunOcclusion: number;
  distantStormFlash: number;
  stormBolt: Array<{ x: number; y: number }> | null;
  nextStormFlashTick: number;
  shootingStar: { x: number; y: number; vx: number; vy: number; alpha: number } | null;
  nextMeteorTick: number;
}

export function createSkyPools(width: number, height: number): SkyPools {
  return {
    bankHigh: buildCloudBank(0.9, 0.04, 0.68, 0.36, 1.15),
    bankMid: buildCloudBank(4.4, 0.08, 0.86, 0.27, 0.96),
    bankLow: buildCloudBank(8.9, 0.12, 0.94, 0.24, 0.92),
    starGlints: Array.from({ length: 95 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.62,
      r: 0.55 + Math.random() * 1.25,
      phase: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.03,
    })),
    rainDrops: Array.from({ length: 300 }, () => ({
      x: Math.random() * (width + 260) - 130,
      y: Math.random() * height,
      len: 13 + Math.random() * 18,
      speed: 14 + Math.random() * 11,
      a: 0.14 + Math.random() * 0.28,
    })),
    rainSplashes: Array.from({ length: 48 }, () => ({
      x: Math.random() * width,
      yRatio: 0.08 + Math.random() * 0.88,
      r: 0.5 + Math.random() * 8,
      maxR: 6.5 + Math.random() * 9,
      speed: 0.42 + Math.random() * 0.4,
    })),
    blownLeaves: Array.from({ length: 32 }, (_, i) => ({
      x: Math.random() * width,
      y: height * (0.48 + Math.random() * 0.42),
      vx: 3.4 + Math.random() * 3.8,
      vy: -0.35 + Math.random() * 0.95,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.2,
      size: 3.5 + (i % 3) * 1.4,
      tint: i % 3 === 0 ? 'rgba(92, 132, 48, 0.85)' : 'rgba(54, 96, 40, 0.85)',
    })),
    gustStreaks: Array.from({ length: 16 }, () => ({
      x: Math.random() * width,
      y: height * (0.28 + Math.random() * 0.62),
      len: 70 + Math.random() * 115,
      speed: 9 + Math.random() * 8,
      a: 0.09 + Math.random() * 0.1,
    })),
    horizonMists: Array.from({ length: 7 }, (_, i) => ({
      x: (i / 4) * (width + 420) - 210,
      y: height * (0.52 + (i % 3) * 0.11),
      rx: width * (0.28 + (i % 3) * 0.12),
      ry: height * 0.09,
      vxBase: 0.2 + (i % 3) * 0.06,
    })),
    cloudScrollHigh: 90,
    cloudScrollMid: 220,
    cloudScrollLow: 0,
    sunOcclusion: 0.2,
    distantStormFlash: 0,
    stormBolt: null,
    nextStormFlashTick: 175,
    shootingStar: null,
    nextMeteorTick: 160,
  };
}

/**
 * Renders the full volumetric sky dome, stars, Sun/Moon behind 3D FBM cloud banks,
 * God-ray light shafts & distant lightning bolts identically to StormyBoyBackdrop's sky engine.
 */
export function renderAtmosphericSkyAndCelestials(
  ctx: CanvasRenderingContext2D,
  pools: SkyPools,
  width: number,
  height: number,
  tick: number,
  prefersReducedMotion: boolean,
  params: {
    dayWeight: number;
    effectiveCloud: number;
    rainWeight: number;
    stormWeight: number;
    fogWeight: number;
    lightningWeight: number;
    windKmh: number;
    windFactor: number;
    windSign: number;
    isHotDay: boolean;
    liveHourDec: number;
    sunriseDecimal: number;
    sunsetDecimal: number;
    celestialProgress: number;
    onThunderTrigger?: (intensity: number) => void;
    horizonYRatio?: number;
  }
): AtmosphericSkyContext {
  const {
    dayWeight,
    effectiveCloud,
    rainWeight,
    stormWeight,
    fogWeight,
    lightningWeight,
    windKmh,
    windFactor,
    windSign,
    isHotDay,
    liveHourDec,
    sunriseDecimal,
    sunsetDecimal,
    celestialProgress,
    onThunderTrigger,
    horizonYRatio = 0.835,
  } = params;

  const orbX = width * (0.08 + celestialProgress * 0.84);
  const orbY = height * (horizonYRatio - Math.sin(celestialProgress * Math.PI) * (horizonYRatio - 0.14));

  const driftMag = 0.22 + windKmh * 0.028 + rainWeight * 0.25 + stormWeight * 0.65;
  const driftPx = windSign * Math.min(1.65, driftMag);

  const highTileW = Math.max(width * 1.15, height * 1.3);
  const midTileW = Math.max(width * 1.25, height * 1.45);
  const lowTileW = Math.max(width * 1.38, height * 1.65);

  const highH = height * 0.46;
  const midH = height * 0.56;
  const lowH = height * 0.62;

  const highY = -height * 0.04;
  const midY = Math.max(0, Math.min(height * 0.14, orbY - midH * 0.42));
  const lowY = Math.max(height * 0.04, Math.min(height * 0.22, orbY - lowH * 0.38));

  if (!prefersReducedMotion) {
    pools.cloudScrollHigh = (pools.cloudScrollHigh + driftPx * 0.42) % highTileW;
    if (pools.cloudScrollHigh < 0) pools.cloudScrollHigh += highTileW;
    pools.cloudScrollMid = (pools.cloudScrollMid + driftPx * 0.72) % midTileW;
    if (pools.cloudScrollMid < 0) pools.cloudScrollMid += midTileW;
    pools.cloudScrollLow = (pools.cloudScrollLow + driftPx) % lowTileW;
    if (pools.cloudScrollLow < 0) pools.cloudScrollLow += lowTileW;
  }

  const cloudBase = Math.max(0, effectiveCloud - 0.04) / 0.96;
  const highAlpha = Math.min(0.84, Math.pow(cloudBase, 0.88) * 0.72) * (1 - fogWeight * 0.7);
  const midAlpha =
    Math.min(0.92, Math.max(0, (cloudBase - 0.08) / 0.92) * 0.82 + rainWeight * 0.14) *
    (1 - fogWeight * 0.68);
  const lowAlpha =
    Math.min(0.96, Math.max(0, (cloudBase - 0.2) / 0.8) * 0.88 + rainWeight * 0.24) *
    (1 - fogWeight * 0.64);

  const sampleSunCloud = (ox: number, oy: number) => {
    const l = sampleBankAlpha(pools.bankLow.grid, ox, oy, pools.cloudScrollLow, lowTileW, lowY, lowH);
    const m = sampleBankAlpha(pools.bankMid.grid, ox, oy, pools.cloudScrollMid, midTileW, midY, midH);
    return Math.min(1, l * lowAlpha * 1.35 + m * midAlpha * 0.95);
  };

  const cCenter = sampleSunCloud(orbX, orbY);
  const cLeft = sampleSunCloud(orbX - 24, orbY);
  const cRight = sampleSunCloud(orbX + 24, orbY);
  const cTop = sampleSunCloud(orbX, orbY - 18);
  const cBot = sampleSunCloud(orbX, orbY + 18);
  const avgDiscOcc = cCenter * 0.44 + (cLeft + cRight + cTop + cBot) * 0.14;
  const canopyOcc = Math.max(0, (effectiveCloud - 0.14) / 0.86) * 0.82;

  const rawOcc = Math.min(
    0.98,
    avgDiscOcc * 0.62 + canopyOcc * 0.56 + fogWeight * 0.74 + rainWeight * 0.66
  );
  pools.sunOcclusion += (rawOcc - pools.sunOcclusion) * 0.085;
  const sunOcclusion = pools.sunOcclusion;
  const edgeBreakGlow = Math.max(0, 1 - Math.abs(avgDiscOcc - 0.36) * 2.1) * (1 - rainWeight * 0.65);

  const hasSolarWindow =
    Number.isFinite(sunriseDecimal) &&
    Number.isFinite(sunsetDecimal) &&
    sunsetDecimal - sunriseDecimal >= 4;
  const dawnF =
    hasSolarWindow && liveHourDec >= sunriseDecimal - 0.65 && liveHourDec <= sunriseDecimal + 1.15
      ? liveHourDec <= sunriseDecimal + 0.1
        ? Math.max(0, (liveHourDec - (sunriseDecimal - 0.65)) / 0.75)
        : Math.max(0, 1 - (liveHourDec - (sunriseDecimal + 0.1)) / 1.05)
      : dayWeight > 0.35 && celestialProgress < 0.18
        ? 1 - celestialProgress / 0.18
        : 0;
  const sunsetF =
    hasSolarWindow && liveHourDec >= sunsetDecimal - 1.15 && liveHourDec <= sunsetDecimal + 0.65
      ? liveHourDec <= sunsetDecimal - 0.1
        ? Math.max(0, (liveHourDec - (sunsetDecimal - 1.15)) / 1.05)
        : Math.max(0, 1 - (liveHourDec - (sunsetDecimal - 0.1)) / 0.75)
      : dayWeight > 0.35 && celestialProgress > 0.78
        ? (celestialProgress - 0.78) / 0.22
        : 0;
  const twilight = Math.min(1, Math.max(dawnF, sunsetF));

  const dayTop: RGB = [24, 115, 208];
  const dayMid: RGB = [82, 168, 238];
  const dayHor: RGB = isHotDay ? [214, 234, 252] : [184, 222, 250];
  const overTop: RGB = [64, 88, 118];
  const overMid: RGB = [106, 132, 162];
  const overHor: RGB = [156, 176, 196];
  const stormTop: RGB = [20, 28, 42];
  const stormMid: RGB = [38, 50, 68];
  const stormHor: RGB = [62, 76, 94];
  const fogTop: RGB = [174, 186, 198];
  const fogMid: RGB = [204, 214, 222];
  const fogHor: RGB = [226, 232, 238];
  const nightTop: RGB = [5, 11, 28];
  const nightMid: RGB = [12, 25, 56];
  const nightHor: RGB = [24, 43, 76];

  let topRgb = lerpRgb(dayTop, overTop, effectiveCloud * 0.55 + rainWeight * 0.35);
  let midRgb = lerpRgb(dayMid, overMid, effectiveCloud * 0.55 + rainWeight * 0.35);
  let horRgb = lerpRgb(dayHor, overHor, effectiveCloud * 0.55 + rainWeight * 0.35);

  if (twilight > 0.02) {
    topRgb = lerpRgb(topRgb, [36, 66, 130], twilight * 0.75);
    midRgb = lerpRgb(midRgb, [154, 124, 166], twilight * 0.65);
    horRgb = lerpRgb(horRgb, dawnF > sunsetF ? [246, 188, 136] : [242, 148, 98], twilight * 0.88);
  }

  topRgb = lerpRgb(topRgb, stormTop, rainWeight * 0.45 + stormWeight * 0.55);
  midRgb = lerpRgb(midRgb, stormMid, rainWeight * 0.45 + stormWeight * 0.55);
  horRgb = lerpRgb(horRgb, stormHor, rainWeight * 0.45 + stormWeight * 0.55);

  topRgb = lerpRgb(topRgb, fogTop, fogWeight);
  midRgb = lerpRgb(midRgb, fogMid, fogWeight);
  horRgb = lerpRgb(horRgb, fogHor, fogWeight);

  const cloudShadeTint: RGB = [36, 52, 74];
  const occShade =
    Math.pow(Math.max(0, sunOcclusion - 0.15), 1.2) * 0.42 * dayWeight * (1 - stormWeight * 0.4);
  topRgb = lerpRgb(topRgb, cloudShadeTint, occShade);
  midRgb = lerpRgb(midRgb, cloudShadeTint, occShade);
  horRgb = lerpRgb(horRgb, cloudShadeTint, occShade * 0.85);

  const twilightWeightBlend = Math.min(1, Math.max(dayWeight, twilight * 0.75));
  topRgb = lerpRgb(nightTop, topRgb, twilightWeightBlend);
  midRgb = lerpRgb(nightMid, midRgb, twilightWeightBlend);
  horRgb = lerpRgb(nightHor, horRgb, Math.min(1, Math.max(dayWeight, twilight * 0.92)));

  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  skyGrad.addColorStop(0, rgbCss(topRgb));
  skyGrad.addColorStop(0.54, rgbCss(midRgb));
  skyGrad.addColorStop(1, rgbCss(horRgb));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Dawn/Sunset horizon glow
  if (twilight > 0.03 && stormWeight < 0.8 && fogWeight < 0.75) {
    const horizGlowPower =
      twilight * (1 - rainWeight * 0.72) * (1 - fogWeight * 0.65) * (1 - stormWeight * 0.8);
    if (horizGlowPower > 0.02) {
      const horizonSunX = dawnF >= sunsetF ? width * 0.09 : width * 0.91;
      const horizonSunY = height * horizonYRatio;
      const hg = ctx.createRadialGradient(
        horizonSunX,
        horizonSunY,
        12,
        horizonSunX,
        horizonSunY,
        Math.max(width, height) * 0.72
      );
      if (dawnF >= sunsetF) {
        hg.addColorStop(0, `rgba(255, 224, 152, ${(0.52 * horizGlowPower).toFixed(3)})`);
        hg.addColorStop(0.28, `rgba(251, 174, 118, ${(0.28 * horizGlowPower).toFixed(3)})`);
        hg.addColorStop(1, 'rgba(214, 134, 148, 0)');
      } else {
        hg.addColorStop(0, `rgba(255, 196, 110, ${(0.56 * horizGlowPower).toFixed(3)})`);
        hg.addColorStop(0.28, `rgba(244, 128, 86, ${(0.32 * horizGlowPower).toFixed(3)})`);
        hg.addColorStop(1, 'rgba(176, 86, 116, 0)');
      }
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // Sun/Moon directional sky scatter wash
  const skyDayLight =
    dayWeight * Math.max(0.08, 1 - sunOcclusion * 0.85) * (1 - rainWeight * 0.72) * (1 - fogWeight * 0.7);
  const skyNightLight =
    (1 - dayWeight) * Math.max(0.08, 1 - effectiveCloud * 0.78) * (1 - rainWeight * 0.75);
  if (skyDayLight > 0.03 || skyNightLight > 0.03) {
    const farCornerX = orbX < width * 0.5 ? width : 0;
    const dirSkyWash = ctx.createLinearGradient(orbX, orbY * 0.7, farCornerX, height * 0.85);
    if (dayWeight >= 0.45) {
      const warmCol = twilight > 0.3 ? '255, 198, 130' : '255, 246, 212';
      dirSkyWash.addColorStop(0, `rgba(${warmCol}, ${(0.22 * skyDayLight).toFixed(3)})`);
      dirSkyWash.addColorStop(1, `rgba(14, 28, 52, ${(0.16 * skyDayLight).toFixed(3)})`);
    } else {
      dirSkyWash.addColorStop(0, `rgba(186, 218, 255, ${(0.15 * skyNightLight).toFixed(3)})`);
      dirSkyWash.addColorStop(1, `rgba(4, 9, 22, ${(0.16 * skyNightLight).toFixed(3)})`);
    }
    ctx.fillStyle = dirSkyWash;
    ctx.fillRect(0, 0, width, height);
  }

  // Sun-shower Rainbow
  if (dayWeight > 0.6 && rainWeight > 0.18 && sunOcclusion < 0.55) {
    const rbAlpha = (1 - sunOcclusion / 0.55) * Math.min(1, rainWeight * 1.4) * 0.16;
    if (rbAlpha > 0.015) {
      const oppX = width - orbX * 0.7;
      const rbR = Math.min(width, height) * 0.62;
      ctx.save();
      const rbColors = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];
      rbColors.forEach((col, ci) => {
        ctx.beginPath();
        ctx.arc(oppX, height * 0.88, rbR - ci * 7, Math.PI * 1.05, Math.PI * 1.95);
        ctx.strokeStyle = col;
        ctx.globalAlpha = rbAlpha * 0.7;
        ctx.lineWidth = 8;
        ctx.stroke();
      });
      ctx.restore();
    }
  }

  // Night Stars & Shooting Star
  const nightVis = 1 - dayWeight;
  if (nightVis > 0.05 && fogWeight < 0.7) {
    const starVis = nightVis * Math.max(0.1, 1 - effectiveCloud * 0.78 - rainWeight * 0.85);
    for (const s of pools.starGlints) {
      const a = (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(tick * s.speed + s.phase))) * starVis;
      if (a <= 0.015) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(248, 250, 252, ${a.toFixed(3)})`;
      ctx.fill();
    }
    if (!prefersReducedMotion && effectiveCloud < 0.5 && rainWeight < 0.2) {
      if (!pools.shootingStar && tick >= pools.nextMeteorTick) {
        pools.shootingStar = {
          x: width * (0.2 + Math.random() * 0.55),
          y: height * (0.06 + Math.random() * 0.18),
          vx: 7.5 + Math.random() * 3,
          vy: 2.4 + Math.random() * 1.4,
          alpha: 0.9,
        };
        pools.nextMeteorTick = tick + 240 + Math.floor(Math.random() * 200);
      }
      if (pools.shootingStar) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pools.shootingStar.x, pools.shootingStar.y);
        ctx.lineTo(
          pools.shootingStar.x - pools.shootingStar.vx * 8,
          pools.shootingStar.y - pools.shootingStar.vy * 8
        );
        ctx.strokeStyle = `rgba(224, 242, 254, ${(pools.shootingStar.alpha * nightVis).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        pools.shootingStar.x += pools.shootingStar.vx;
        pools.shootingStar.y += pools.shootingStar.vy;
        pools.shootingStar.alpha -= 0.025;
        if (pools.shootingStar.alpha <= 0) pools.shootingStar = null;
      }
    }
  }

  // Sun behind drifting FBM clouds (clean spherical radial bloom, never flat-cut)
  const sunStrength = dayWeight * Math.max(0.04, 1 - sunOcclusion * 0.92) * (1 - stormWeight * 0.88);
  if (sunStrength > 0.015) {
    const sunR = Math.min(width, height) * 0.036;
    const warmMix = twilight;
    const coronaR = sunR * (5.2 + warmMix * 1.8);
    const corona = ctx.createRadialGradient(orbX, orbY, sunR * 0.15, orbX, orbY, coronaR);
    corona.addColorStop(0, `rgba(255, 252, 238, ${(0.92 * sunStrength).toFixed(3)})`);
    corona.addColorStop(0.18, `rgba(255, 246, 210, ${(0.62 * sunStrength).toFixed(3)})`);
    corona.addColorStop(
      0.42,
      `rgba(${warmMix > 0.3 ? '255, 192, 114' : '255, 234, 176'}, ${(0.28 * sunStrength).toFixed(3)})`
    );
    corona.addColorStop(1, 'rgba(255, 210, 120, 0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(orbX, orbY, coronaR, 0, Math.PI * 2);
    ctx.fill();

    // Smooth solar disc with gentle limb softening so it reads as a spherical blazing star
    const discGrad = ctx.createRadialGradient(orbX, orbY, sunR * 0.1, orbX, orbY, sunR);
    const discA = Math.min(1, sunStrength * 1.25);
    discGrad.addColorStop(0, `rgba(255, 254, 246, ${discA.toFixed(3)})`);
    discGrad.addColorStop(0.74, `rgba(255, 248, 224, ${(discA * 0.92).toFixed(3)})`);
    discGrad.addColorStop(1, `rgba(${warmMix > 0.3 ? '255, 204, 130' : '255, 238, 186'}, 0)`);
    ctx.fillStyle = discGrad;
    ctx.beginPath();
    ctx.arc(orbX, orbY, sunR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Phased Moon behind drifting FBM clouds
  const effectiveMoonVis =
    (1 - dayWeight) * Math.max(0.06, 1 - effectiveCloud * 0.78 - rainWeight * 0.86) * (1 - fogWeight * 0.8);
  if (effectiveMoonVis > 0.03) {
    const moonR = Math.min(width, height) * 0.027;
    const mGlowR = moonR * 4.2;
    const mHalo = ctx.createRadialGradient(orbX, orbY, moonR * 0.4, orbX, orbY, mGlowR);
    mHalo.addColorStop(0, `rgba(228, 242, 255, ${(0.55 * effectiveMoonVis).toFixed(3)})`);
    mHalo.addColorStop(0.42, `rgba(164, 202, 248, ${(0.22 * effectiveMoonVis).toFixed(3)})`);
    mHalo.addColorStop(1, 'rgba(130, 175, 235, 0)');
    ctx.fillStyle = mHalo;
    ctx.beginPath();
    ctx.arc(orbX, orbY, mGlowR, 0, Math.PI * 2);
    ctx.fill();

    const phase = getMoonPhaseFraction();
    ctx.save();
    ctx.globalAlpha = Math.min(0.95, effectiveMoonVis * 1.15);
    ctx.beginPath();
    ctx.arc(orbX, orbY, moonR, 0, Math.PI * 2);
    ctx.fillStyle = '#f1f6ff';
    ctx.fill();
    // Lunar phase shadow mask
    const shadowShift = Math.cos(phase * Math.PI * 2) * moonR * 1.85;
    if (Math.abs(phase - 0.5) > 0.08) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(10, 18, 36, 0.88)';
      ctx.beginPath();
      ctx.arc(orbX + shadowShift, orbY, moonR * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Storm Lightning & Plasma Forks
  if (lightningWeight > 0.38 && !prefersReducedMotion) {
    if (tick >= pools.nextStormFlashTick) {
      pools.distantStormFlash = 0.85 + Math.random() * 0.15;
      pools.nextStormFlashTick = tick + 190 + Math.floor(Math.random() * 280);
      const bx = width * (0.18 + Math.random() * 0.64);
      const pts: Array<{ x: number; y: number }> = [{ x: bx, y: 0 }];
      let cx = bx;
      let cy = 0;
      const targetY = height * (0.38 + Math.random() * 0.18);
      while (cy < targetY) {
        cy += 12 + Math.random() * 14;
        cx += (Math.random() - 0.5) * 32;
        pts.push({ x: cx, y: cy });
      }
      pools.stormBolt = pts;
      onThunderTrigger?.(0.75 + rainWeight * 0.25);
    }
  }
  pools.distantStormFlash *= 0.87;
  if (pools.distantStormFlash < 0.01) {
    pools.distantStormFlash = 0;
    pools.stormBolt = null;
  }

  if (pools.distantStormFlash > 0.02) {
    ctx.fillStyle = `rgba(214, 232, 255, ${(pools.distantStormFlash * 0.34).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    if (pools.stormBolt) {
      ctx.save();
      ctx.strokeStyle = `rgba(235, 246, 255, ${pools.distantStormFlash.toFixed(3)})`;
      ctx.shadowColor = 'rgba(147, 197, 253, 0.95)';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      pools.stormBolt.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    }
  }

  // 3D-Shaded Volumetric FBM Cloud Banks scrolling over Sun & Moon
  const drawBank = (bank: CloudBank, tileW: number, scrollX: number, topY: number, drawH: number, alpha: number) => {
    if (alpha <= 0.015) return;
    const useStorm = stormWeight > 0.35 || rainWeight > 0.45 || dayWeight < 0.35;
    const src = useStorm ? bank.stormC : bank.dayC;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let x = scrollX - tileW; x < width + tileW; x += tileW) {
      ctx.drawImage(src, x, topY, tileW, drawH);
    }
    ctx.restore();
  };

  drawBank(pools.bankHigh, highTileW, pools.cloudScrollHigh, highY, highH, highAlpha);
  drawBank(pools.bankMid, midTileW, pools.cloudScrollMid, midY, midH, midAlpha);
  drawBank(pools.bankLow, lowTileW, pools.cloudScrollLow, lowY, lowH, lowAlpha);

  // Soft feathered Crepuscular Light Shafts radiating gently beyond cloud breaks (no sharp cone cutting across sun)
  const isSunActive = dayWeight >= 0.45;
  const scatterPower = isSunActive
    ? dayWeight * (1 - rainWeight * 0.72) * (1 - fogWeight * 0.7) * (0.22 + edgeBreakGlow * 0.55)
    : effectiveMoonVis * 0.45;
  if (scatterPower > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const shaftTrigger = isSunActive ? Math.max(sunOcclusion * 0.78, (1 - sunOcclusion) * 0.4) : effectiveMoonVis * 0.5;
    if (shaftTrigger > 0.18) {
      const targetGroundX = width * (1 - celestialProgress * 0.82) * 0.78 + width * 0.11;
      const rayBaseA = Math.atan2(height * 0.88 - orbY, targetGroundX - orbX);
      const rayAlpha = isSunActive
        ? (0.018 + 0.032 * edgeBreakGlow) * dayWeight * (1 - rainWeight * 0.75)
        : 0.014 * effectiveMoonVis * (1 - rainWeight * 0.78);
      for (let r = 0; r < 5; r++) {
        const ang = rayBaseA + (r - 2) * 0.21 + Math.sin(tick * 0.005 + r * 1.4) * 0.015;
        const innerOff = Math.min(width, height) * 0.06;
        const len = Math.max(width, height) * 0.88;
        const sx = orbX + Math.cos(ang) * innerOff;
        const sy = orbY + Math.sin(ang) * innerOff;
        const bx = orbX + Math.cos(ang) * len;
        const by = orbY + Math.sin(ang) * len;
        const perpX = -Math.sin(ang);
        const perpY = Math.cos(ang);
        const rg = ctx.createLinearGradient(sx, sy, bx, by);
        const rayCol = isSunActive ? (twilight > 0.35 ? '255, 214, 152' : '255, 249, 214') : '206, 228, 255';
        rg.addColorStop(0, `rgba(${rayCol}, 0)`);
        rg.addColorStop(0.2, `rgba(${rayCol}, ${rayAlpha.toFixed(3)})`);
        rg.addColorStop(1, `rgba(${rayCol}, 0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.moveTo(sx - perpX * 26, sy - perpY * 26);
        ctx.lineTo(sx + perpX * 26, sy + perpY * 26);
        ctx.lineTo(bx + perpX * 118, by + perpY * 118);
        ctx.lineTo(bx - perpX * 118, by - perpY * 118);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  const sunlightFactor =
    dayWeight *
    Math.max(0, 1 - sunOcclusion * 0.96) *
    (1 - rainWeight * 0.84) *
    (1 - fogWeight * 0.85);

  return {
    dayWeight,
    twilight,
    dawnF,
    sunsetF,
    effectiveCloud,
    sunOcclusion,
    edgeBreakGlow,
    sunlightFactor,
    effectiveMoonVis,
    nightVis,
    rainWeight,
    stormWeight,
    fogWeight,
    windFactor,
    windSign,
    orbX,
    orbY,
    topRgb,
    midRgb,
    horRgb,
    distantStormFlash: pools.distantStormFlash,
  };
}

export function renderForegroundRainAndWind(
  ctx: CanvasRenderingContext2D,
  pools: SkyPools,
  sky: AtmosphericSkyContext,
  width: number,
  height: number,
  tick: number,
  prefersReducedMotion: boolean,
  splashGroundYFn: (x: number) => number,
  skipRainDrops = false
) {
  // Horizon mist & fog bands
  if (sky.fogWeight > 0.05 || sky.rainWeight > 0.2) {
    const mistDensity = Math.max(sky.fogWeight, sky.rainWeight * 0.38);
    const fogRgbStr = sky.dayWeight > 0.4 ? '226, 234, 242' : '148, 163, 184';
    for (const m of pools.horizonMists) {
      if (!prefersReducedMotion) {
        m.x += sky.windSign * m.vxBase * Math.max(0.5, sky.windFactor + 0.4);
        if (sky.windSign > 0 && m.x - m.rx > width + 60) m.x = -m.rx - 40;
        else if (sky.windSign < 0 && m.x + m.rx < -60) m.x = width + m.rx + 40;
      }
      const mg = ctx.createRadialGradient(m.x, m.y, m.ry * 0.15, m.x, m.y, m.rx);
      mg.addColorStop(0, `rgba(${fogRgbStr}, ${(0.24 * mistDensity).toFixed(3)})`);
      mg.addColorStop(1, `rgba(${fogRgbStr}, 0)`);
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Storm wind streaks & blown detached leaves
  if ((sky.stormWeight > 0.25 || sky.windFactor > 0.52) && !prefersReducedMotion && !skipRainDrops) {
    const gustVis = Math.min(1, Math.max(sky.stormWeight, (sky.windFactor - 0.52) * 1.4));
    ctx.save();
    ctx.strokeStyle = `rgba(226, 232, 240, ${(0.18 * gustVis).toFixed(3)})`;
    ctx.lineWidth = 1.1;
    for (const gs of pools.gustStreaks) {
      gs.x += sky.windSign * gs.speed * (0.9 + sky.windFactor * 0.6);
      gs.y += Math.sin(tick * 0.05 + gs.x * 0.01) * 0.4;
      if (sky.windSign > 0 && gs.x > width + 140) gs.x = -gs.len - 40;
      if (sky.windSign < 0 && gs.x < -gs.len - 40) gs.x = width + 140;
      ctx.beginPath();
      ctx.moveTo(gs.x, gs.y);
      ctx.lineTo(gs.x + sky.windSign * gs.len, gs.y + 4);
      ctx.stroke();
    }

    const leafCount = Math.floor(pools.blownLeaves.length * gustVis);
    for (let i = 0; i < leafCount; i++) {
      const lf = pools.blownLeaves[i];
      lf.x += sky.windSign * lf.vx * (0.85 + sky.windFactor * 0.85);
      lf.y += lf.vy + Math.sin(tick * 0.08 + i) * 0.85;
      lf.rot += lf.vRot * (0.8 + sky.windFactor * 0.7);
      if (sky.windSign > 0 && lf.x > width + 30) {
        lf.x = -20;
        lf.y = height * (0.55 + Math.random() * 0.38);
      } else if (sky.windSign < 0 && lf.x < -30) {
        lf.x = width + 20;
        lf.y = height * (0.55 + Math.random() * 0.38);
      }
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.rot);
      ctx.fillStyle = lf.tint;
      ctx.beginPath();
      ctx.ellipse(0, 0, lf.size, lf.size * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Live Rain Streaks + Splash Spray Rings
  if (sky.rainWeight > 0.02 && !skipRainDrops) {
    const rainCurve = Math.pow(sky.rainWeight, 1.45);
    const activeDrops = Math.max(12, Math.floor(pools.rainDrops.length * (0.04 + rainCurve * 0.96)));
    const slant = sky.windSign * (1.2 + sky.windFactor * 7.2);
    const speedMult = 0.46 + sky.rainWeight * 0.78;
    const opacityBoost = 0.28 + sky.rainWeight * 0.82;
    ctx.lineCap = 'round';
    for (let i = 0; i < activeDrops; i++) {
      const d = pools.rainDrops[i];
      const a = Math.min(0.68, d.a * opacityBoost * Math.min(1, sky.rainWeight * 1.4));
      const dropLen = d.len * (0.32 + sky.rainWeight * 0.78);
      ctx.strokeStyle =
        sky.dayWeight > 0.5
          ? `rgba(226, 232, 240, ${a.toFixed(3)})`
          : `rgba(186, 230, 253, ${a.toFixed(3)})`;
      ctx.lineWidth = 0.48 + rainCurve * 0.95;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + slant, d.y + dropLen);
      ctx.stroke();

      if (!prefersReducedMotion) {
        d.y += d.speed * speedMult;
        d.x += slant * 0.52;
        const gCut = splashGroundYFn(d.x) + ((i * 23) % 100) * 0.01 * Math.max(10, height - splashGroundYFn(d.x));
        if (d.y > gCut) {
          d.y = -25;
          d.x = Math.random() * (width + 260) - 130;
        }
        if (d.x > width + 140) d.x = -120;
        if (d.x < -140) d.x = width + 120;
      }
    }

    const activeSplashes = Math.max(6, Math.floor(pools.rainSplashes.length * (0.1 + rainCurve * 0.9)));
    const splashTint = sky.dayWeight > 0.5 ? '226, 238, 248' : '198, 228, 250';
    for (let si = 0; si < activeSplashes; si++) {
      const sp = pools.rainSplashes[si];
      const groundTop = splashGroundYFn(sp.x) + 3;
      const drawY = groundTop + sp.yRatio * Math.max(8, height - groundTop - 3);
      const progress = Math.min(1, sp.r / sp.maxR);
      const spAlpha = (1 - progress) * (0.26 + sky.rainWeight * 0.34);
      if (spAlpha > 0.015) {
        ctx.beginPath();
        ctx.ellipse(sp.x, drawY, sp.r, sp.r * 0.32, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${splashTint}, ${spAlpha.toFixed(3)})`;
        ctx.lineWidth = 0.85 + sky.rainWeight * 0.45;
        ctx.stroke();

        if (progress < 0.72) {
          const arcT = progress / 0.72;
          const bounceH = Math.sin(arcT * Math.PI) * (5 + sky.rainWeight * 10);
          const spreadX = arcT * (4.5 + sky.rainWeight * 4);
          const beadA = (1 - arcT) * (0.45 + sky.rainWeight * 0.42);
          ctx.fillStyle = `rgba(${splashTint}, ${beadA.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(sp.x - spreadX, drawY - bounceH, 1.05, 0, Math.PI * 2);
          ctx.arc(sp.x + spreadX * 0.9, drawY - bounceH * 0.85, 0.95, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!prefersReducedMotion) {
        sp.r += sp.speed * (0.78 + sky.rainWeight * 0.52);
        if (sp.r >= sp.maxR) {
          sp.r = 0.35;
          sp.x = Math.random() * width;
          sp.yRatio = 0.08 + Math.random() * 0.88;
        }
      }
    }
  }
}
