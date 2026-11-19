import { useEffect, useRef, useState } from 'react';
import {
  computeCelestialPosition,
  getDhakaHourDecimal,
  WeatherMood,
} from '../utils/rajshahiWeather';
import { stormAudio } from '../utils/stormAudio';

/** Deterministic tileable 2D value noise for seamless horizon-perspective clouds */
function hash2dPeriodic(ix: number, iy: number, periodX: number): number {
  const wx = ((ix % periodX) + periodX) % periodX;
  const n = Math.sin(wx * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function periodicNoise2d(x: number, y: number, periodX: number): number {
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

function periodicFbm2d(x: number, y: number, periodX: number, octaves = 4): number {
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

type RGB = [number, number, number];

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function rgbCss(c: RGB, alpha = 1): string {
  return alpha >= 0.999 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha.toFixed(3)})`;
}

interface StormyBoyBackdropProps {
  isBirthdayMode: boolean;
  isWeatherMode: boolean;
  accentHex: string;
  secondaryHex: string;
  weatherMood: WeatherMood;
  weatherIsDay: boolean;
  temperatureC: number | null;
  windKmh: number | null;
  windDirectionDeg: number | null;
  cloudCover: number | null;
  sunriseDecimal: number;
  sunsetDecimal: number;
}

interface RainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
  opacity: number;
  layer: number;
}

interface SplashRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface LightningBranch {
  points: Array<{ x: number; y: number }>;
  width: number;
  alpha: number;
}

interface MistPatch {
  x: number;
  y: number;
  rx: number;
  ry: number;
  vx: number;
  alpha: number;
}

interface Balloon {
  x: number;
  y: number;
  radius: number;
  vy: number;
  swayAmp: number;
  swaySpeed: number;
  phase: number;
  depth: number;
  baseColor: string;
  highlightColor: string;
  shadeColor: string;
}

type FireworkType = 'chrysanthemum' | 'willow' | 'peony' | 'crackle';

interface FireworkRocket {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  targetY: number;
  vx: number;
  vy: number;
  color: string;
  secondaryColor: string;
  shellType: FireworkType;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

interface FireworkParticle {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  alpha: number;
  decay: number;
  gravity: number;
  drag: number;
  color: string;
  coreWhite: boolean;
  size: number;
  strobe: boolean;
  canSubBurst: boolean;
  age: number;
}

interface SkyFlash {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
}

const BALLOON_THEMES = [
  { base: '#e11d48', highlight: '#fda4af', shade: '#881337' },
  { base: '#d97706', highlight: '#fef08a', shade: '#78350f' },
  { base: '#0284c7', highlight: '#bae6fd', shade: '#0c4a6e' },
  { base: '#db2777', highlight: '#fbcfe8', shade: '#831843' },
  { base: '#7c3aed', highlight: '#ddd6fe', shade: '#4c1d95' },
  { base: '#f59e0b', highlight: '#fef3c7', shade: '#92400e' },
];

const DEFAULT_VIDEO_CANDIDATES = [
  './videos/video-1.mp4',
  './videos/video-2.mp4',
  './videos/video-3.mp4',
  './videos/video-4.mp4',
  './videos/video-5.mp4',
  './videos/video-6.mp4',
  './videos/1.mp4',
  './videos/2.mp4',
  './videos/3.mp4',
  './videos/video-1.webm',
  './videos/video-2.webm',
];

async function discoverBackgroundVideos(): Promise<string[]> {
  const candidates = new Set<string>();

  try {
    const manifestRes = await fetch('./videos/manifest.json', { cache: 'no-store' });
    const ct = manifestRes.headers.get('content-type') || '';
    if (manifestRes.ok && ct.includes('application/json')) {
      const items = (await manifestRes.json()) as Array<string | { file?: string; src?: string }>;
      if (Array.isArray(items)) {
        for (const item of items) {
          const raw = typeof item === 'string' ? item : item?.file || item?.src;
          if (!raw) continue;
          const resolved =
            raw.startsWith('./') || raw.startsWith('/') ? raw : `./videos/${raw}`;
          candidates.add(resolved);
        }
      }
    }
  } catch {
    // Ignore missing manifest
  }

  for (const c of DEFAULT_VIDEO_CANDIDATES) {
    candidates.add(c);
  }

  const found: string[] = [];
  await Promise.all(
    Array.from(candidates).map(async (url) => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.startsWith('video/')) {
          found.push(url);
        }
      } catch {
        // Not uploaded
      }
    })
  );

  return found;
}

export function StormyBoyBackdrop({
  isBirthdayMode,
  isWeatherMode,
  accentHex,
  secondaryHex,
  weatherMood,
  weatherIsDay,
  temperatureC,
  windKmh,
  windDirectionDeg,
  cloudCover,
  sunriseDecimal,
  sunsetDecimal,
}: StormyBoyBackdropProps) {
  const skyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rainFgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const birthdayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const weatherCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [flashGlow, setFlashGlow] = useState(0);
  const [backgroundVideos, setBackgroundVideos] = useState<string[]>(['./videos/video-1.mp4']);
  const [currentVideoIdx, setCurrentVideoIdx] = useState(0);

  const weatherPropsRef = useRef({
    weatherMood,
    weatherIsDay,
    temperatureC,
    windKmh,
    windDirectionDeg,
    cloudCover,
    sunriseDecimal,
    sunsetDecimal,
  });
  weatherPropsRef.current = {
    weatherMood,
    weatherIsDay,
    temperatureC,
    windKmh,
    windDirectionDeg,
    cloudCover,
    sunriseDecimal,
    sunsetDecimal,
  };

  useEffect(() => {
    let active = true;
    discoverBackgroundVideos().then((videos) => {
      if (active && videos.length > 0) {
        setBackgroundVideos(videos);
        setCurrentVideoIdx(0);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const mode = isBirthdayMode ? 'birthday' : isWeatherMode ? 'weather' : 'storm';
    const celestial = computeCelestialPosition({
      isDay: weatherIsDay,
      sunriseDecimal,
      sunsetDecimal,
    });
    stormAudio.setSceneMode(mode, {
      weatherMood,
      isDay: weatherIsDay,
      windKmh,
      temperatureC,
      sunProgress: celestial.progress,
    });
  }, [
    isBirthdayMode,
    isWeatherMode,
    weatherMood,
    weatherIsDay,
    windKmh,
    temperatureC,
    sunriseDecimal,
    sunsetDecimal,
  ]);

  // Ensure muted background video plays cleanly whenever source changes (only in normal stormy mode)
  useEffect(() => {
    if (isBirthdayMode || isWeatherMode || backgroundVideos.length === 0) return;
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = true;
    vid.play().catch(() => {});
  }, [isBirthdayMode, isWeatherMode, backgroundVideos, currentVideoIdx]);

  // Normal Days: Continuous Rain, Visible Foreground Lightning Bolts & Instant Synced Thunder
  useEffect(() => {
    if (isBirthdayMode || isWeatherMode) return;

    const skyCanvas = skyCanvasRef.current;
    const fgCanvas = rainFgCanvasRef.current;
    if (!skyCanvas || !fgCanvas) return;
    const skyCtx = skyCanvas.getContext('2d');
    const fgCtx = fgCanvas.getContext('2d');
    if (!skyCtx || !fgCtx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = (skyCanvas.width = fgCanvas.width = window.innerWidth);
    let height = (skyCanvas.height = fgCanvas.height = window.innerHeight);

    const dropCount = Math.min(480, Math.max(210, Math.floor((width * height) / 2800)));
    const drops: RainDrop[] = Array.from({ length: dropCount }, () => {
      const r = Math.random();
      const layer = r < 0.4 ? 0 : r < 0.78 ? 1 : 2;
      return {
        x: Math.random() * (width + 260) - 130,
        y: Math.random() * height,
        len: layer === 0 ? 11 + Math.random() * 8 : layer === 1 ? 18 + Math.random() * 14 : 28 + Math.random() * 18,
        speed: layer === 0 ? 10 + Math.random() * 4 : layer === 1 ? 15 + Math.random() * 5 : 22 + Math.random() * 6,
        opacity: layer === 0 ? 0.1 + Math.random() * 0.09 : layer === 1 ? 0.18 + Math.random() * 0.14 : 0.3 + Math.random() * 0.2,
        layer,
      };
    });

    const mistPatches: MistPatch[] = Array.from({ length: 10 }, (_, i) => ({
      x: (i / 10) * width * 1.2,
      y: height * (0.06 + (i % 4) * 0.12),
      rx: width * (0.22 + (i % 3) * 0.1),
      ry: height * (weatherMood === 'fog' ? 0.14 : 0.09),
      vx: 0.18 + (i % 3) * 0.08,
      alpha: weatherMood === 'fog' ? 0.22 : 0.15,
    }));

    const splashes: SplashRipple[] = [];
    let activeBolts: LightningBranch[] = [];
    let flashCenter = { x: width * 0.42, y: height * 0.14 };
    let flashIntensity = 0;
    let secondaryFlickerTimer = 0;
    let nextLightningIn = 75;

    const generateBolt = (startX: number, startY: number, targetY: number): LightningBranch[] => {
      const branches: LightningBranch[] = [];
      const mainPts: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
      let curX = startX;
      let curY = startY;
      const driftBias = (Math.random() - 0.5) * 8;

      while (curY < targetY) {
        curY += 10 + Math.random() * 14;
        curX += driftBias + (Math.random() - 0.5) * 34;
        mainPts.push({ x: curX, y: curY });

        // Secondary & tertiary realistic jagged forks
        if (Math.random() < 0.34 && branches.length < 12) {
          const forkPts: Array<{ x: number; y: number }> = [{ x: curX, y: curY }];
          let fx = curX;
          let fy = curY;
          const dir = Math.random() < 0.5 ? -1 : 1;
          const segs = 4 + Math.floor(Math.random() * 6);
          for (let s = 0; s < segs; s++) {
            fx += dir * (8 + Math.random() * 16) + (Math.random() - 0.5) * 10;
            fy += 9 + Math.random() * 14;
            forkPts.push({ x: fx, y: fy });

            if (s === 2 && Math.random() < 0.45 && branches.length < 14) {
              const subPts: Array<{ x: number; y: number }> = [{ x: fx, y: fy }];
              let sx = fx;
              let sy = fy;
              const subDir = Math.random() < 0.5 ? -dir : dir;
              for (let k = 0; k < 3; k++) {
                sx += subDir * (6 + Math.random() * 11);
                sy += 7 + Math.random() * 10;
                subPts.push({ x: sx, y: sy });
              }
              branches.push({ points: subPts, width: 0.75, alpha: 0.55 });
            }
          }
          branches.push({ points: forkPts, width: 1.35 + Math.random() * 0.45, alpha: 0.78 });
        }
      }

      branches.unshift({ points: mainPts, width: 2.8, alpha: 1 });
      return branches;
    };

    const triggerLightning = (isAftershock = false) => {
      if (!isAftershock) {
        flashCenter = {
          x: width * (0.15 + Math.random() * 0.7),
          y: height * (0.05 + Math.random() * 0.14),
        };
        secondaryFlickerTimer = Math.random() < 0.7 ? 7 + Math.floor(Math.random() * 6) : 0;
        stormAudio.triggerThunder(1.0);
      }
      const targetY = height * (0.48 + Math.random() * 0.24);
      activeBolts = generateBolt(flashCenter.x, 0, targetY);
      flashIntensity = isAftershock ? 0.78 + Math.random() * 0.2 : 1.0;
      if (!isAftershock) {
        nextLightningIn = 110 + Math.floor(Math.random() * 150);
      }
    };

    let firedFirstSoundStrike = false;
    const unsubUnlock = stormAudio.onUnlockChange((unlocked) => {
      if (unlocked && !firedFirstSoundStrike) {
        firedFirstSoundStrike = true;
        stormAudio.unlockAndStart(weatherMood);
        if (!prefersReducedMotion) {
          triggerLightning(false);
        }
      }
    });

    const handleResize = () => {
      width = skyCanvas.width = fgCanvas.width = window.innerWidth;
      height = skyCanvas.height = fgCanvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    let animId = 0;
    let tick = 0;

    const initTimer = window.setTimeout(() => {
      if (!prefersReducedMotion) triggerLightning(false);
    }, 500);

    const render = () => {
      tick += 1;

      const skyGrad = skyCtx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, '#020408');
      skyGrad.addColorStop(0.55, '#070b15');
      skyGrad.addColorStop(1, '#03050a');
      skyCtx.fillStyle = skyGrad;
      skyCtx.fillRect(0, 0, width, height);

      for (const m of mistPatches) {
        if (!prefersReducedMotion) {
          m.x += m.vx;
          if (m.x - m.rx > width) m.x = -m.rx;
        }
        const g = skyCtx.createRadialGradient(m.x, m.y, m.ry * 0.15, m.x, m.y, m.rx);
        g.addColorStop(0, `rgba(71, 85, 105, ${m.alpha + flashIntensity * 0.25})`);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        skyCtx.fillStyle = g;
        skyCtx.beginPath();
        skyCtx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, Math.PI * 2);
        skyCtx.fill();
      }

      if (flashIntensity > 0.01) {
        const flashGrad = skyCtx.createRadialGradient(
          flashCenter.x,
          flashCenter.y,
          12,
          flashCenter.x,
          flashCenter.y + height * 0.18,
          Math.max(width, height) * 0.9
        );
        flashGrad.addColorStop(0, `rgba(224, 242, 254, ${flashIntensity * 0.52})`);
        flashGrad.addColorStop(0.35, `rgba(148, 163, 184, ${flashIntensity * 0.26})`);
        flashGrad.addColorStop(1, 'rgba(2, 4, 8, 0)');
        skyCtx.fillStyle = flashGrad;
        skyCtx.fillRect(0, 0, width, height);
      }

      skyCtx.lineCap = 'round';
      for (const drop of drops) {
        if (drop.layer === 0) {
          skyCtx.strokeStyle = `rgba(148, 163, 184, ${drop.opacity + flashIntensity * 0.18})`;
          skyCtx.lineWidth = 0.75;
          skyCtx.beginPath();
          skyCtx.moveTo(drop.x, drop.y);
          skyCtx.lineTo(drop.x - 2.6, drop.y + drop.len);
          skyCtx.stroke();
        }
      }

      if (tick % 3 === 0) setFlashGlow(flashIntensity);

      fgCtx.clearRect(0, 0, width, height);

      if (activeBolts.length > 0 && flashIntensity > 0.05) {
        fgCtx.save();
        fgCtx.globalCompositeOperation = 'lighter';
        fgCtx.lineCap = 'round';
        fgCtx.lineJoin = 'round';

        // Upper storm-cloud sheet glow around lightning origin
        const cloudGlow = fgCtx.createRadialGradient(
          flashCenter.x,
          flashCenter.y * 0.6,
          10,
          flashCenter.x,
          flashCenter.y + height * 0.12,
          Math.max(width, height) * 0.48
        );
        cloudGlow.addColorStop(0, `rgba(219, 234, 254, ${flashIntensity * 0.55})`);
        cloudGlow.addColorStop(0.4, `rgba(147, 197, 253, ${flashIntensity * 0.24})`);
        cloudGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        fgCtx.fillStyle = cloudGlow;
        fgCtx.fillRect(0, 0, width, height);

        // Pass 1: Wide electric sky-blue/violet plasma corona halo
        for (const branch of activeBolts) {
          fgCtx.beginPath();
          branch.points.forEach((pt, idx) => {
            if (idx === 0) fgCtx.moveTo(pt.x, pt.y);
            else fgCtx.lineTo(pt.x, pt.y);
          });
          fgCtx.strokeStyle = `rgba(147, 197, 253, ${Math.min(0.65, flashIntensity * branch.alpha * 0.58)})`;
          fgCtx.lineWidth = branch.width * 3.4;
          fgCtx.shadowColor = 'rgba(96, 165, 250, 0.95)';
          fgCtx.shadowBlur = 34;
          fgCtx.stroke();
        }

        // Pass 2: Razor-sharp incandescent white-hot plasma core
        for (const branch of activeBolts) {
          fgCtx.beginPath();
          branch.points.forEach((pt, idx) => {
            if (idx === 0) fgCtx.moveTo(pt.x, pt.y);
            else fgCtx.lineTo(pt.x, pt.y);
          });
          fgCtx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, flashIntensity * branch.alpha)})`;
          fgCtx.lineWidth = branch.width * 0.88;
          fgCtx.shadowColor = 'rgba(224, 242, 254, 1)';
          fgCtx.shadowBlur = 14;
          fgCtx.stroke();
        }

        fgCtx.restore();
      }

      fgCtx.lineCap = 'round';
      for (const drop of drops) {
        if (drop.layer > 0) {
          fgCtx.strokeStyle = `rgba(203, 213, 225, ${drop.opacity + flashIntensity * 0.28})`;
          fgCtx.lineWidth = drop.layer === 2 ? 1.3 : 0.95;
          fgCtx.beginPath();
          fgCtx.moveTo(drop.x, drop.y);
          fgCtx.lineTo(drop.x - (drop.layer === 2 ? 5.6 : 3.6), drop.y + drop.len);
          fgCtx.stroke();
        }

        if (!prefersReducedMotion) {
          drop.y += drop.speed;
          drop.x -= drop.speed * 0.19;

          if (drop.y > height * 0.94) {
            if (drop.layer > 0 && Math.random() < 0.15 && splashes.length < 48) {
              splashes.push({
                x: drop.x,
                y: height * (0.92 + Math.random() * 0.06),
                radius: 1,
                maxRadius: 5 + Math.random() * 9,
                alpha: 0.28 + flashIntensity * 0.28,
              });
            }
            drop.y = -35 - Math.random() * 60;
            drop.x = Math.random() * (width + 260) - 40;
          }
        }
      }

      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        fgCtx.beginPath();
        fgCtx.ellipse(s.x, s.y, s.radius, s.radius * 0.26, 0, 0, Math.PI * 2);
        fgCtx.strokeStyle = `rgba(186, 230, 253, ${s.alpha})`;
        fgCtx.lineWidth = 0.75;
        fgCtx.stroke();

        s.radius += 0.48;
        s.alpha -= 0.015;
        if (s.alpha <= 0 || s.radius >= s.maxRadius) splashes.splice(i, 1);
      }

      if (!prefersReducedMotion) {
        flashIntensity *= 0.87;
        if (flashIntensity < 0.01) flashIntensity = 0;

        if (secondaryFlickerTimer > 0) {
          secondaryFlickerTimer -= 1;
          if (secondaryFlickerTimer === 0) triggerLightning(true);
        } else {
          nextLightningIn -= 1;
          if (nextLightningIn <= 0) triggerLightning(false);
        }

        animId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      window.clearTimeout(initTimer);
      cancelAnimationFrame(animId);
      unsubUnlock();
      window.removeEventListener('resize', handleResize);
    };
  }, [isBirthdayMode, isWeatherMode, weatherMood]);

  // Birthday Mode Canvas: Photorealistic 3D Glossy Teardrop Balloons + Cinematic Sky Fireworks & Audio
  useEffect(() => {
    if (!isBirthdayMode) return;
    const canvas = birthdayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const fireworkColors = [
      accentHex,
      secondaryHex,
      '#fde68a',
      '#fda4af',
      '#7dd3fc',
      '#c4b5fd',
      '#fbbf24',
      '#f9a8d4',
    ];

    const balloons: Balloon[] = Array.from({ length: 20 }, (_, i) => {
      const theme = BALLOON_THEMES[i % BALLOON_THEMES.length];
      const depth = 0.48 + (i / 20) * 0.52;
      return {
        x: ((i + 0.5) / 20) * width + (Math.random() - 0.5) * 35,
        y: height * (0.2 + Math.random() * 1.1),
        radius: (15 + Math.random() * 11) * depth + 7,
        vy: (0.45 + Math.random() * 0.45) * (0.65 + depth * 0.5),
        swayAmp: 10 + Math.random() * 16,
        swaySpeed: 0.011 + Math.random() * 0.012,
        phase: Math.random() * Math.PI * 2,
        depth,
        baseColor: theme.base,
        highlightColor: theme.highlight,
        shadeColor: theme.shade,
      };
    }).sort((a, b) => a.depth - b.depth);

    const stars = Array.from({ length: 130 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.85,
      r: 0.5 + Math.random() * 1.4,
      baseA: 0.25 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.035,
    }));

    const rockets: FireworkRocket[] = [];
    const particles: FireworkParticle[] = [];
    const flashes: SkyFlash[] = [];

    const shellTypes: FireworkType[] = ['chrysanthemum', 'willow', 'peony', 'crackle'];

    const spawnRocket = (customX?: number, customTargetY?: number) => {
      const color = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
      const secondaryColor = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
      const shellType = shellTypes[Math.floor(Math.random() * shellTypes.length)];
      const sx = customX ?? width * (0.14 + Math.random() * 0.72);
      const targetY = customTargetY ?? height * (0.14 + Math.random() * 0.3);
      const travelDist = Math.max(180, height - targetY);
      const vy = -Math.sqrt(2 * 0.068 * travelDist) * (0.98 + Math.random() * 0.08);

      rockets.push({
        x: sx,
        y: height + 10,
        prevX: sx,
        prevY: height + 10,
        targetY,
        vx: (Math.random() - 0.5) * 1.15,
        vy,
        color,
        secondaryColor,
        shellType,
        trail: [],
      });
      stormAudio.triggerFireworkLaunch();
    };

    const explodeRocket = (rocket: FireworkRocket) => {
      flashes.push({
        x: rocket.x,
        y: rocket.y,
        radius: 170 + Math.random() * 90,
        color: rocket.color,
        alpha: 0.42,
      });

      stormAudio.triggerFireworkBurst(0.95);

      const type = rocket.shellType;
      const count = type === 'willow' ? 68 : type === 'peony' ? 88 : 78;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.14;
        const speedBase =
          type === 'willow'
            ? 1.8 + Math.random() * 3.1
            : type === 'peony'
              ? (i % 2 === 0 ? 4.4 : 2.3) + (Math.random() - 0.5) * 0.6
              : 2.0 + Math.random() * 4.2;

        const isGold = type === 'willow' || Math.random() < 0.18;
        const pColor = isGold
          ? '#fde68a'
          : i % 3 === 0
            ? rocket.secondaryColor
            : rocket.color;

        particles.push({
          x: rocket.x,
          y: rocket.y,
          prevX: rocket.x,
          prevY: rocket.y,
          vx: Math.cos(angle) * speedBase,
          vy: Math.sin(angle) * speedBase,
          alpha: 1,
          decay: type === 'willow' ? 0.0085 + Math.random() * 0.005 : 0.012 + Math.random() * 0.009,
          gravity: type === 'willow' ? 0.055 : 0.042,
          drag: type === 'willow' ? 0.968 : 0.976,
          color: pColor,
          coreWhite: true,
          size: type === 'willow' ? 1.8 : 1.5 + Math.random() * 1.3,
          strobe: type === 'crackle' || Math.random() < 0.25,
          canSubBurst: type === 'crackle' && i % 9 === 0,
          age: 0,
        });
      }
    };

    const drawRealisticBalloon = (b: Balloon, tickNow: number) => {
      const swayX = Math.sin(tickNow * b.swaySpeed + b.phase) * b.swayAmp;
      const tilt = Math.cos(tickNow * b.swaySpeed + b.phase) * 0.075;
      const bx = b.x + swayX;
      const by = b.y;
      const rx = b.radius * 0.88;
      const ry = b.radius * 1.12;

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(tilt);
      ctx.globalAlpha = 0.45 + b.depth * 0.44;

      ctx.beginPath();
      ctx.moveTo(0, ry + 5);
      const w1 = Math.sin(tickNow * 0.045 + b.phase) * 9;
      const w2 = Math.cos(tickNow * 0.038 + b.phase) * 11;
      ctx.bezierCurveTo(w1, ry + 26, -w2, ry + 52, w1 * 0.6, ry + 78);
      ctx.strokeStyle = `rgba(255, 248, 235, ${0.22 + b.depth * 0.16})`;
      ctx.lineWidth = 0.8 + b.depth * 0.45;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -ry);
      ctx.bezierCurveTo(rx * 1.15, -ry, rx * 1.08, ry * 0.28, 0, ry);
      ctx.bezierCurveTo(-rx * 1.08, ry * 0.28, -rx * 1.15, -ry, 0, -ry);
      ctx.closePath();

      const bodyGrad = ctx.createRadialGradient(
        -rx * 0.34,
        -ry * 0.38,
        rx * 0.08,
        rx * 0.1,
        ry * 0.08,
        ry * 1.25
      );
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.14, b.highlightColor);
      bodyGrad.addColorStop(0.55, b.baseColor);
      bodyGrad.addColorStop(0.92, b.shadeColor);
      bodyGrad.addColorStop(1, 'rgba(10, 6, 18, 0.92)');

      ctx.fillStyle = bodyGrad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(-rx * 0.36, -ry * 0.35, rx * 0.17, ry * 0.3, -0.45, 0, Math.PI * 2);
      const specGrad = ctx.createLinearGradient(-rx * 0.5, -ry * 0.6, -rx * 0.2, -ry * 0.1);
      specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
      specGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      ctx.fillStyle = specGrad;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(-3.2, ry + 4.5);
      ctx.lineTo(3.2, ry + 4.5);
      ctx.lineTo(0, ry - 0.5);
      ctx.closePath();
      ctx.fillStyle = b.shadeColor;
      ctx.fill();

      ctx.restore();
    };

    const handleInteractiveLaunch = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('button, input, aside, a')) return;
      spawnRocket(e.clientX, Math.min(height * 0.55, Math.max(height * 0.12, e.clientY)));
    };
    window.addEventListener('click', handleInteractiveLaunch);

    let firedFirstBirthdayBoom = false;
    const unsubUnlock = stormAudio.onUnlockChange((unlocked) => {
      if (unlocked && !firedFirstBirthdayBoom && !prefersReducedMotion) {
        firedFirstBirthdayBoom = true;
        spawnRocket(width * 0.32, height * 0.22);
        window.setTimeout(() => spawnRocket(width * 0.65, height * 0.26), 240);
      }
    });

    let animId = 0;
    let tick = 0;
    if (!prefersReducedMotion) {
      spawnRocket(width * 0.35, height * 0.22);
      spawnRocket(width * 0.68, height * 0.28);
    }

    const loop = () => {
      tick += 1;

      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#040611');
      bg.addColorStop(0.58, '#0c0b1d');
      bg.addColorStop(1, '#180d22');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const horizon = ctx.createRadialGradient(
        width * 0.5,
        height * 1.04,
        20,
        width * 0.5,
        height * 1.0,
        Math.max(width, height) * 0.65
      );
      horizon.addColorStop(0, 'rgba(251, 146, 60, 0.12)');
      horizon.addColorStop(0.5, 'rgba(190, 24, 93, 0.06)');
      horizon.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = horizon;
      ctx.fillRect(0, 0, width, height);

      for (const s of stars) {
        const twinkle = s.baseA * (0.65 + 0.35 * Math.sin(tick * s.speed + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(254, 243, 199, ${twinkle.toFixed(3)})`;
        ctx.fill();
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const fg = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.radius);
        fg.addColorStop(0, `rgba(255, 250, 235, ${f.alpha * 0.55})`);
        fg.addColorStop(0.38, f.color);
        fg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = f.alpha;
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        f.alpha *= 0.91;
        f.radius *= 1.012;
        if (f.alpha < 0.015) flashes.splice(i, 1);
      }

      for (const b of balloons) {
        if (!prefersReducedMotion) {
          b.y -= b.vy;
          if (b.y < -b.radius * 3.5 - 80) {
            b.y = height + b.radius * 2.2 + 50;
            b.x = Math.random() * width;
          }
        }
        drawRealisticBalloon(b, tick);
      }

      if (!prefersReducedMotion) {
        if (tick % 62 === 0 && rockets.length < 4) spawnRocket();

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i];
          r.prevX = r.x;
          r.prevY = r.y;
          r.x += r.vx;
          r.y += r.vy;
          r.vy += 0.068;

          r.trail.push({ x: r.x, y: r.y, alpha: 0.9 });
          if (r.trail.length > 16) r.trail.shift();

          for (let t = 1; t < r.trail.length; t++) {
            const p0 = r.trail[t - 1];
            const p1 = r.trail[t];
            p0.alpha *= 0.88;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = `rgba(253, 224, 71, ${p0.alpha * 0.72})`;
            ctx.lineWidth = (t / r.trail.length) * 2.4;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(r.x, r.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          if (r.y <= r.targetY || r.vy >= -0.35) {
            explodeRocket(r);
            rockets.splice(i, 1);
          }
        }

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.prevX = p.x;
          p.prevY = p.y;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= p.drag;
          p.vy = p.vy * p.drag + p.gravity;
          p.alpha -= p.decay;
          p.age += 1;

          if (p.canSubBurst && p.alpha < 0.45) {
            p.canSubBurst = false;
            for (let k = 0; k < 5; k++) {
              const a = (Math.PI * 2 * k) / 5 + Math.random() * 0.5;
              particles.push({
                x: p.x,
                y: p.y,
                prevX: p.x,
                prevY: p.y,
                vx: Math.cos(a) * (1.2 + Math.random() * 1.4),
                vy: Math.sin(a) * (1.2 + Math.random() * 1.4),
                alpha: 0.85,
                decay: 0.032,
                gravity: 0.03,
                drag: 0.94,
                color: '#ffffff',
                coreWhite: true,
                size: 1.3,
                strobe: true,
                canSubBurst: false,
                age: 0,
              });
            }
          }

          if (p.alpha <= 0.01) {
            particles.splice(i, 1);
            continue;
          }

          const twinkleFactor = p.strobe && p.age > 14 ? (p.age % 4 < 2 ? 1.0 : 0.28) : 1.0;
          const effAlpha = Math.max(0, Math.min(1, p.alpha * twinkleFactor));

          ctx.globalAlpha = effAlpha;
          ctx.beginPath();
          ctx.moveTo(p.prevX, p.prevY);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.stroke();

          if (p.coreWhite && effAlpha > 0.35) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }

        ctx.restore();
        animId = requestAnimationFrame(loop);
      }
    };

    loop();

    return () => {
      cancelAnimationFrame(animId);
      unsubUnlock();
      window.removeEventListener('click', handleInteractiveLaunch);
      window.removeEventListener('resize', handleResize);
    };
  }, [isBirthdayMode, accentHex, secondaryHex]);

  // Weather Mode 100% Live Photorealistic Procedural Engine (ZERO static photos + seamless volumetric FBM clouds covering/uncovering Sun + articulated swaying Bengal palms & leafy trees + storm gusts/flying leaves + smooth 15-min interpolation)
  useEffect(() => {
    if (isBirthdayMode || !isWeatherMode) return;
    const canvas = weatherCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Helper: smooth 1D chaotic turbulence for non-pendulum wind gusts (different per tree & branch)
    const smoothTurb1d = (t: number): number => {
      const i = Math.floor(t);
      const f = t - i;
      const u = f * f * (3 - 2 * f);
      const h0 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const h1 = Math.sin((i + 1) * 127.1 + 311.7) * 43758.5453;
      const r0 = h0 - Math.floor(h0);
      const r1 = h1 - Math.floor(h1);
      return (r0 + (r1 - r0) * u) * 2 - 1;
    };

    // Localized traveling wind gust envelope across horizontal position x (some trees catch gusts while others stay calmer)
    const sampleLocalWind = (
      x: number,
      tSec: number,
      baseWind: number,
      wSign: number,
      freqMult: number,
      seed: number
    ) => {
      if (baseWind <= 0.01) return { bend: 0, flutter: 0, pocket: 0 };
      const u = x / Math.max(640, width);
      const travelPos1 = u - wSign * tSec * (0.28 + baseWind * 0.2);
      const travelPos2 = u * 1.45 - wSign * tSec * (0.45 + baseWind * 0.28) + 3.7;
      // Gust pocket 0.22..1.65 so wind never hits every tree identically
      const g1 = 0.5 + 0.5 * smoothTurb1d(travelPos1 * 2.8 + 1.3);
      const g2 = 0.5 + 0.5 * smoothTurb1d(travelPos2 * 4.1 + 7.1);
      const pocket = 0.22 + (g1 * 0.62 + g2 * 0.38) * 1.42;

      // Chaotic asymmetrical multi-band sway with dramatic gale-force exaggeration during storms
      const isStorm = baseWind > 0.95;
      const stormMultiplier = isStorm ? 2.6 + (baseWind - 0.95) * 1.8 : 1.0;

      const slowChaotic = smoothTurb1d(tSec * (0.5 + baseWind * 0.4) * freqMult + seed * 5.3);
      const midChaotic = smoothTurb1d(tSec * (1.4 + baseWind * 0.8) * freqMult + seed * 11.7) * 0.6;
      const fastJitter = smoothTurb1d(tSec * (3.5 + baseWind * 1.6) * freqMult + seed * 19.9) * 0.32;

      const effective = baseWind * pocket;
      const bend = effective * (0.62 + slowChaotic * 0.52 + midChaotic * 0.38) * stormMultiplier;
      const flutter = effective * (midChaotic * 0.7 + fastJitter) * (isStorm ? 1.8 : 1.0);
      return { bend, flutter, pocket };
    };

    // 1. Pre-render 3 seamless tileable volumetric 3D-shaded horizontal cloud banks (512x192) + lookup density grid
    const CW = 512;
    const CH = 192;
    const PERIOD_X = 12;
    const densityMap = new Float32Array(CW * CH);

    const buildCloudBank = (
      seedShift: number,
      bandMinY: number,
      bandMaxY: number,
      sparsity: number,
      puffContrast: number
    ) => {
      for (let y = 0; y < CH; y++) {
        const yn = y / CH;
        let vEnv = 0;
        if (yn >= bandMinY && yn <= bandMaxY) {
          const t = (yn - bandMinY) / (bandMaxY - bandMinY);
          // Flat condensation bottom shelf + towering cumulus domes
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

            // Directional 3D self-shadowing: bright illuminated crowns, rich moody shaded bellies
            const upY = Math.max(0, y - 5);
            const upDens = densityMap[upY * CW + x];
            const lightDelta = upDens - dens;
            const topLight = Math.max(0, Math.min(1, 0.74 - lightDelta * 2.15 - (y / CH) * 0.36));

            // Daytime volumetric cumulus: luminous sunlit top -> cool slate-blue/grey underside
            const dR = Math.round(134 + topLight * 120);
            const dG = Math.round(146 + topLight * 108);
            const dB = Math.round(166 + topLight * 88);

            // Storm/overcast/night bank: heavy dark slate bellies with crisp silver upper rims
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
    };

    const bankHigh = buildCloudBank(0.9, 0.04, 0.68, 0.36, 1.15);
    const bankMid = buildCloudBank(4.4, 0.08, 0.86, 0.27, 0.96);
    const bankLow = buildCloudBank(8.9, 0.12, 0.94, 0.24, 0.92);

    // 2. Pre-render 4 botanical leafy-twig sprig sprites (organic individual pointed leaves, zero cartoon blobs)
    const createLeafSprigSprite = (
      seed: number,
      baseRgb: RGB,
      midRgb: RGB,
      tipRgb: RGB
    ): HTMLCanvasElement => {
      const S = 92;
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const g = c.getContext('2d');
      if (!g) return c;

      const leafCount = 32;
      for (let i = 0; i < leafCount; i++) {
        const s1 = Math.sin(seed * 19.3 + i * 7.13) * 43758.54;
        const r1 = s1 - Math.floor(s1);
        const s2 = Math.sin(seed * 41.7 + i * 13.37) * 24634.63;
        const r2 = s2 - Math.floor(s2);
        const s3 = Math.sin(seed * 63.1 + i * 29.9) * 18423.19;
        const r3 = s3 - Math.floor(s3);

        const ang = r1 * Math.PI * 2;
        const rad = Math.pow(r2, 0.58) * (S * 0.35);
        const lx = S * 0.5 + Math.cos(ang) * rad;
        const ly = S * 0.52 + Math.sin(ang) * rad * 0.82;
        const leafRot = ang + (r3 - 0.5) * 0.95;
        const lw = 6.5 + r3 * 5.6;
        const lh = 2.0 + r1 * 1.45;

        const layerTone =
          ly < S * 0.42 && r3 > 0.32
            ? rgbCss(tipRgb, 0.93)
            : r2 > 0.42
              ? rgbCss(midRgb, 0.92)
              : rgbCss(baseRgb, 0.96);

        g.save();
        g.translate(lx, ly);
        g.rotate(leafRot);
        g.fillStyle = layerTone;
        g.beginPath();
        g.moveTo(-lw * 0.55, 0);
        g.quadraticCurveTo(0, -lh, lw * 0.68, 0);
        g.quadraticCurveTo(0, lh, -lw * 0.55, 0);
        g.fill();
        g.restore();
      }
      return c;
    };

    const sprigCool = [
      createLeafSprigSprite(1, [13, 27, 22], [22, 44, 33], [36, 62, 46]),
      createLeafSprigSprite(2, [11, 24, 19], [19, 39, 30], [32, 56, 42]),
      createLeafSprigSprite(3, [14, 28, 22], [24, 46, 34], [38, 66, 48]),
      createLeafSprigSprite(4, [12, 26, 21], [20, 41, 32], [35, 59, 44]),
    ];
    const sprigSun = [
      createLeafSprigSprite(1, [20, 46, 22], [48, 88, 36], [98, 140, 50]),
      createLeafSprigSprite(2, [18, 42, 20], [42, 80, 32], [90, 132, 46]),
      createLeafSprigSprite(3, [22, 48, 24], [52, 92, 38], [104, 146, 54]),
      createLeafSprigSprite(4, [19, 44, 21], [45, 84, 34], [94, 136, 48]),
    ];
    const sprigGolden = [
      createLeafSprigSprite(1, [24, 34, 24], [58, 68, 36], [138, 108, 54]),
      createLeafSprigSprite(2, [22, 31, 22], [52, 62, 34], [128, 100, 50]),
      createLeafSprigSprite(3, [26, 36, 25], [62, 72, 38], [146, 114, 58]),
      createLeafSprigSprite(4, [23, 33, 23], [55, 65, 35], [134, 104, 52]),
    ];

    // 3. Lush Multi-Depth Bengal Treeline: Mid-ground hazy groves + 7 Palms + 10 Articulated Leafy Trees + Foreground Reeds
    const midTrees = [
      { xRatio: 0.08, scale: 0.62, lean: 0.05, seed: 1.1, freqMult: 0.85 },
      { xRatio: 0.18, scale: 0.56, lean: -0.04, seed: 2.4, freqMult: 1.12 },
      { xRatio: 0.31, scale: 0.52, lean: 0.03, seed: 3.7, freqMult: 0.74 },
      { xRatio: 0.44, scale: 0.46, lean: -0.03, seed: 5.1, freqMult: 1.25 },
      { xRatio: 0.57, scale: 0.48, lean: 0.04, seed: 6.3, freqMult: 0.92 },
      { xRatio: 0.71, scale: 0.54, lean: -0.05, seed: 7.8, freqMult: 1.18 },
      { xRatio: 0.84, scale: 0.58, lean: 0.06, seed: 8.9, freqMult: 0.79 },
      { xRatio: 0.95, scale: 0.64, lean: -0.06, seed: 10.2, freqMult: 1.04 },
    ];

    const palmTrees = [
      { xRatio: 0.04, heightRatio: 0.31, lean: 0.14, fronds: 11, seed: 0.9, freqMult: 0.76 },
      { xRatio: 0.14, heightRatio: 0.36, lean: 0.17, fronds: 12, seed: 2.1, freqMult: 1.08 },
      { xRatio: 0.27, heightRatio: 0.25, lean: -0.11, fronds: 10, seed: 3.4, freqMult: 1.24 },
      { xRatio: 0.39, heightRatio: 0.19, lean: 0.09, fronds: 9, seed: 4.8, freqMult: 0.88 },
      { xRatio: 0.64, heightRatio: 0.21, lean: -0.09, fronds: 9, seed: 6.2, freqMult: 1.19 },
      { xRatio: 0.75, heightRatio: 0.27, lean: 0.13, fronds: 10, seed: 7.5, freqMult: 0.82 },
      { xRatio: 0.88, heightRatio: 0.37, lean: -0.18, fronds: 12, seed: 9.1, freqMult: 1.03 },
    ];

    const leafyTrees = [
      {
        xRatio: 0.02, scale: 1.06, lean: 0.08, seed: 0.4, freqMult: 0.74,
        limbs: [
          { ang: -1.84, len: 0.52, freqMult: 0.9, twigs: [-0.46, 0.05, 0.5] },
          { ang: -1.42, len: 0.62, freqMult: 1.15, twigs: [-0.5, 0.0, 0.48] },
          { ang: -1.04, len: 0.5, freqMult: 0.82, twigs: [-0.42, 0.12, 0.55] },
        ],
      },
      {
        xRatio: 0.11, scale: 0.86, lean: -0.04, seed: 1.6, freqMult: 1.18,
        limbs: [
          { ang: -1.92, len: 0.5, freqMult: 1.1, twigs: [-0.42, 0.08, 0.48] },
          { ang: -1.5, len: 0.58, freqMult: 0.86, twigs: [-0.46, 0.02, 0.46] },
          { ang: -1.12, len: 0.48, freqMult: 1.28, twigs: [-0.38, 0.14, 0.5] },
        ],
      },
      {
        xRatio: 0.22, scale: 0.74, lean: 0.06, seed: 2.9, freqMult: 0.89,
        limbs: [
          { ang: -1.9, len: 0.48, freqMult: 0.95, twigs: [-0.4, 0.1, 0.46] },
          { ang: -1.48, len: 0.58, freqMult: 1.22, twigs: [-0.45, 0.05, 0.45] },
          { ang: -1.12, len: 0.46, freqMult: 0.78, twigs: [-0.35, 0.15, 0.5] },
        ],
      },
      {
        xRatio: 0.34, scale: 0.54, lean: -0.05, seed: 4.2, freqMult: 1.32,
        limbs: [
          { ang: -1.88, len: 0.48, freqMult: 1.14, twigs: [-0.38, 0.12, 0.48] },
          { ang: -1.44, len: 0.54, freqMult: 0.88, twigs: [-0.42, 0.04, 0.44] },
        ],
      },
      {
        xRatio: 0.47, scale: 0.42, lean: 0.04, seed: 5.5, freqMult: 0.97,
        limbs: [
          { ang: -1.82, len: 0.46, freqMult: 1.05, twigs: [-0.36, 0.14] },
          { ang: -1.36, len: 0.48, freqMult: 1.31, twigs: [-0.34, 0.18] },
        ],
      },
      {
        xRatio: 0.59, scale: 0.45, lean: -0.05, seed: 6.7, freqMult: 1.21,
        limbs: [
          { ang: -1.86, len: 0.46, freqMult: 0.85, twigs: [-0.36, 0.12] },
          { ang: -1.38, len: 0.5, freqMult: 1.17, twigs: [-0.38, 0.16] },
        ],
      },
      {
        xRatio: 0.71, scale: 0.6, lean: 0.05, seed: 7.9, freqMult: 0.79,
        limbs: [
          { ang: -1.94, len: 0.5, freqMult: 1.24, twigs: [-0.4, 0.06, 0.46] },
          { ang: -1.46, len: 0.56, freqMult: 0.91, twigs: [-0.44, 0.02, 0.45] },
        ],
      },
      {
        xRatio: 0.82, scale: 0.82, lean: -0.06, seed: 9.2, freqMult: 1.14,
        limbs: [
          { ang: -1.96, len: 0.5, freqMult: 0.88, twigs: [-0.42, 0.04, 0.48] },
          { ang: -1.52, len: 0.6, freqMult: 1.26, twigs: [-0.48, -0.02, 0.45] },
          { ang: -1.16, len: 0.48, freqMult: 0.96, twigs: [-0.4, 0.12, 0.45] },
        ],
      },
      {
        xRatio: 0.92, scale: 0.96, lean: 0.06, seed: 10.4, freqMult: 0.84,
        limbs: [
          { ang: -1.92, len: 0.52, freqMult: 1.12, twigs: [-0.44, 0.03, 0.46] },
          { ang: -1.54, len: 0.62, freqMult: 0.83, twigs: [-0.46, 0.01, 0.48] },
          { ang: -1.18, len: 0.48, freqMult: 1.29, twigs: [-0.4, 0.12, 0.5] },
        ],
      },
      {
        xRatio: 0.99, scale: 1.12, lean: -0.1, seed: 11.8, freqMult: 1.07,
        limbs: [
          { ang: -1.98, len: 0.52, freqMult: 0.93, twigs: [-0.45, 0.02, 0.46] },
          { ang: -1.58, len: 0.64, freqMult: 1.19, twigs: [-0.48, 0.0, 0.48] },
          { ang: -1.2, len: 0.48, freqMult: 0.8, twigs: [-0.42, 0.1, 0.52] },
        ],
      },
    ];

    const reeds = Array.from({ length: 68 }, (_, i) => ({
      xRatio: (i + 0.5) / 68 + ((i % 3) - 1) * 0.005,
      h: 22 + ((i * 17) % 34),
      lean: ((i % 7) - 3) * 0.07,
      seed: i * 1.37,
      freqMult: 0.8 + ((i * 13) % 9) * 0.08,
    }));

    // Smoothly interpolated atmospheric simulation state
    const initP = weatherPropsRef.current;
    const sim = {
      windKmh: initP.windKmh ?? 6,
      windDirSign:
        initP.windDirectionDeg !== null && initP.windDirectionDeg >= 10 && initP.windDirectionDeg < 190
          ? -1
          : 1,
      cloudCover:
        initP.cloudCover !== null
          ? initP.cloudCover / 100
          : initP.weatherMood === 'cloudy' || initP.weatherMood === 'rain' || initP.weatherMood === 'storm'
            ? 0.82
            : initP.weatherMood === 'fog'
              ? 0.6
              : 0.34,
      rainWeight: initP.weatherMood === 'rain' || initP.weatherMood === 'storm' ? 1 : 0,
      stormWeight: initP.weatherMood === 'storm' ? 1 : 0,
      fogWeight: initP.weatherMood === 'fog' ? 1 : 0,
      dayWeight: initP.weatherIsDay ? 1 : 0,
      tempC: initP.temperatureC ?? 27,
    };

    const flyingBirds = Array.from({ length: 9 }, (_, i) => ({
      x: Math.random() * width,
      y: height * (0.14 + (i % 5) * 0.075),
      vxBase: (i % 3 === 0 ? -1 : 1) * (0.62 + (i % 4) * 0.2),
      span: 6.5 + (i % 4) * 2.1,
      wingPhase: Math.random() * Math.PI * 2,
      wingSpeed: 0.13 + (i % 3) * 0.04,
      glideTick: Math.floor(Math.random() * 240),
    }));

    const rainDrops = Array.from({ length: 300 }, () => ({
      x: Math.random() * (width + 260) - 130,
      y: Math.random() * height,
      len: 16 + Math.random() * 22,
      speed: 14 + Math.random() * 7,
      a: 0.22 + Math.random() * 0.26,
    }));

    const rainSplashes = Array.from({ length: 34 }, () => ({
      x: Math.random() * width,
      y: height - 8 - Math.random() * 26,
      r: Math.random() * 8,
      maxR: 7 + Math.random() * 9,
      speed: 0.45 + Math.random() * 0.4,
    }));

    const blownLeaves = Array.from({ length: 24 }, (_, i) => ({
      x: Math.random() * width,
      y: height * (0.5 + Math.random() * 0.44),
      vx: 2.4 + Math.random() * 2.8,
      vy: -0.35 + Math.random() * 0.95,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.2,
      size: 3.5 + (i % 3) * 1.4,
      tint: i % 3 === 0 ? 'rgba(92, 132, 48, 0.85)' : 'rgba(54, 96, 40, 0.85)',
    }));

    const gustStreaks = Array.from({ length: 16 }, () => ({
      x: Math.random() * width,
      y: height * (0.28 + Math.random() * 0.62),
      len: 70 + Math.random() * 115,
      speed: 9 + Math.random() * 8,
      a: 0.09 + Math.random() * 0.1,
    }));

    const starGlints = Array.from({ length: 95 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.68,
      r: 0.55 + Math.random() * 1.25,
      phase: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.03,
    }));

    const fireflies = Array.from({ length: 16 }, () => ({
      x: Math.random() * width,
      y: height * (0.68 + Math.random() * 0.25),
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.18,
      phase: Math.random() * Math.PI * 2,
    }));

    const horizonMists = Array.from({ length: 7 }, (_, i) => ({
      x: (i / 4) * (width + 420) - 210,
      y: height * (0.58 + (i % 3) * 0.11),
      rx: width * (0.28 + (i % 3) * 0.12),
      ry: height * 0.1,
      vxBase: 0.2 + (i % 3) * 0.06,
    }));

    let cloudScrollHigh = 90;
    let cloudScrollMid = 220;
    let cloudScrollLow = 0;
    let sunOcclusion = sim.rainWeight > 0.5 ? 0.85 : Math.min(0.8, sim.cloudCover * 0.65);
    let distantStormFlash = 0;
    let stormBolt: Array<{ x: number; y: number }> | null = null;
    let nextStormFlashTick = 175;
    let shootingStar: { x: number; y: number; vx: number; vy: number; alpha: number } | null = null;
    let nextMeteorTick = 160;

    let animId = 0;
    let tick = 0;

    const sampleBankAlpha = (
      grid: Float32Array,
      px: number,
      py: number,
      scrollX: number,
      tileW: number,
      topY: number,
      drawH: number
    ): number => {
      if (py < topY || py > topY + drawH) return 0;
      const wrappedX = (((px - scrollX) % tileW) + tileW) % tileW;
      const gx = Math.min(127, Math.floor((wrappedX / tileW) * 128));
      const gy = Math.min(47, Math.floor(((py - topY) / drawH) * 48));
      return grid[gy * 128 + gx];
    };

    const drawArticulatedPalm = (
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
      barkColor: string,
      frondColor: string,
      rimColor: string,
      rimAlpha: number
    ) => {
      const wSample = sampleLocalWind(baseX, tSec, windFactor, windSign, freqMult, seed);
      const segs = 7;
      const pts: Array<{ x: number; y: number }> = [{ x: baseX, y: baseY }];
      let cx = baseX;
      let cy = baseY;
      const windBendTotal = windSign * wSample.bend * 0.24;

      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const stepH = palmH / segs;
        const leanNow = baseLean + windBendTotal * Math.pow(t, 1.5);
        cx += Math.sin(leanNow) * stepH;
        cy -= Math.cos(leanNow) * stepH;
        pts.push({ x: cx, y: cy });
      }

      ctx.save();
      ctx.lineCap = 'round';
      for (let s = 0; s < segs; s++) {
        const t = s / segs;
        ctx.beginPath();
        ctx.moveTo(pts[s].x, pts[s].y);
        ctx.lineTo(pts[s + 1].x, pts[s + 1].y);
        ctx.strokeStyle = barkColor;
        ctx.lineWidth = (1 - t * 0.68) * (palmH * 0.052) + 1.8;
        ctx.stroke();
      }

      const tip = pts[pts.length - 1];
      const crownScale = palmH * 0.38;

      for (let f = 0; f < frondCount; f++) {
        const baseFrondAng = -Math.PI + (f / Math.max(1, frondCount - 1)) * Math.PI * 1.18 - 0.12;
        const fTurbulence =
          windFactor > 0.015
            ? smoothTurb1d(tSec * (1.8 + windFactor * 1.5) * freqMult + seed * 3.1 + f * 1.7) *
              (0.05 + wSample.pocket * windFactor * 0.22)
            : 0;
        const windStreamBias = windSign * wSample.bend * 0.28;
        const fAng = baseFrondAng + windStreamBias * 0.45 + fTurbulence;
        const fLen = crownScale * (0.76 + (f % 3) * 0.12);

        const endX = tip.x + Math.cos(fAng) * fLen;
        const endY = tip.y + Math.sin(fAng) * fLen + fLen * (0.28 + (f % 2) * 0.14);
        const midX = (tip.x + endX) * 0.5 + Math.cos(fAng) * fLen * 0.08;
        const midY = (tip.y + endY) * 0.5 - fLen * 0.24;

        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.quadraticCurveTo(midX, midY, endX, endY);
        ctx.strokeStyle = frondColor;
        ctx.lineWidth = 2.0;
        ctx.stroke();

        const leafletPairs = 14;
        ctx.lineWidth = 1.2;
        for (let l = 2; l <= leafletPairs; l++) {
          const lt = l / leafletPairs;
          const u = 1 - lt;
          const px = u * u * tip.x + 2 * u * lt * midX + lt * lt * endX;
          const py = u * u * tip.y + 2 * u * lt * midY + lt * lt * endY;
          const leafletLen = Math.sin(lt * Math.PI) * (fLen * 0.24) + 2.8;
          const droopX = windSign * wSample.bend * leafletLen * 0.42;
          const leafJiggle =
            windFactor > 0.015
              ? smoothTurb1d(tSec * (3.2 + windFactor * 2.1) + f * 2.3 + l * 0.9) * wSample.pocket * windFactor * 3.6
              : 0;

          ctx.strokeStyle = rimAlpha > 0.18 && lt > 0.4 && f < 5 ? rimColor : frondColor;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(
            px + droopX * 0.5 + leafJiggle,
            py + leafletLen * 0.55,
            px + droopX + leafJiggle * 1.2 + (lt - 0.5) * 4,
            py + leafletLen
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const renderWeather = () => {
      tick += 1;
      const tSec = tick / 60;
      const tgt = weatherPropsRef.current;

      const tgtWind = tgt.windKmh ?? 6;
      const tgtDirSign =
        tgt.windDirectionDeg !== null && tgt.windDirectionDeg >= 10 && tgt.windDirectionDeg < 190
          ? -1
          : 1;
      const tgtRain = tgt.weatherMood === 'rain' || tgt.weatherMood === 'storm' ? 1 : 0;
      const tgtStorm = tgt.weatherMood === 'storm' ? 1 : 0;
      const tgtFog = tgt.weatherMood === 'fog' ? 1 : 0;
      const tgtDay = tgt.weatherIsDay ? 1 : 0;
      const tgtCloud =
        tgt.cloudCover !== null
          ? tgt.cloudCover / 100
          : tgt.weatherMood === 'cloudy' || tgtRain > 0.5
            ? 0.82
            : tgtFog > 0.5
              ? 0.6
              : 0.34;
      const tgtTemp = tgt.temperatureC ?? 27;

      const lerpRate = 0.012;
      sim.windKmh += (tgtWind - sim.windKmh) * lerpRate;
      sim.windDirSign += (tgtDirSign - sim.windDirSign) * 0.02;
      sim.cloudCover += (tgtCloud - sim.cloudCover) * lerpRate;
      sim.rainWeight += (tgtRain - sim.rainWeight) * lerpRate;
      sim.stormWeight += (tgtStorm - sim.stormWeight) * lerpRate;
      sim.fogWeight += (tgtFog - sim.fogWeight) * lerpRate;
      sim.dayWeight += (tgtDay - sim.dayWeight) * lerpRate;
      sim.tempC += (tgtTemp - sim.tempC) * lerpRate;

      const windSign = sim.windDirSign >= 0 ? 1 : -1;
      const isHotDay = sim.dayWeight > 0.5 && sim.tempC >= 30;
      const effectiveCloud = Math.max(0.02, Math.min(1, sim.cloudCover));

      const windFactor =
        sim.stormWeight > 0.45
          ? Math.max(0.95, Math.min(1.5, 0.75 + sim.windKmh / 22 + sim.stormWeight * 0.35))
          : sim.windKmh < 4.5
            ? Math.max(0, (sim.windKmh - 2.2) * 0.018)
            : Math.min(1.3, (sim.windKmh - 3.8) / 20 + 0.12);

      ctx.clearRect(0, 0, width, height);

      const celestial = computeCelestialPosition({
        isDay: sim.dayWeight >= 0.5,
        sunriseDecimal: tgt.sunriseDecimal,
        sunsetDecimal: tgt.sunsetDecimal,
      });
      const orbX = width * (0.14 + celestial.progress * 0.72);
      const orbY = height * (0.56 - Math.sin(celestial.progress * Math.PI) * 0.41);

      // Clearly observable natural drifting speed (serene steady glide ~0.42–0.65 px/f on normal days, ~1.55 px/f in storm)
      const driftMag =
        0.34 + sim.windKmh * 0.028 + sim.rainWeight * 0.32 + sim.stormWeight * 0.72;
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
        cloudScrollHigh = (cloudScrollHigh + driftPx * 0.42) % highTileW;
        if (cloudScrollHigh < 0) cloudScrollHigh += highTileW;
        cloudScrollMid = (cloudScrollMid + driftPx * 0.72) % midTileW;
        if (cloudScrollMid < 0) cloudScrollMid += midTileW;
        cloudScrollLow = (cloudScrollLow + driftPx) % lowTileW;
        if (cloudScrollLow < 0) cloudScrollLow += lowTileW;
      }

      const highAlpha = (0.28 + effectiveCloud * 0.44) * (1 - sim.fogWeight * 0.75);
      const midAlpha = (0.34 + effectiveCloud * 0.58 + sim.rainWeight * 0.12) * (1 - sim.fogWeight * 0.72);
      const lowAlpha = (0.42 + effectiveCloud * 0.62 + sim.rainWeight * 0.22) * (1 - sim.fogWeight * 0.68);

      // Multi-point neighborhood sampling across Mid & Low clouds right over (orbX, orbY)
      const sampleSunCloud = (ox: number, oy: number) => {
        const l = sampleBankAlpha(bankLow.grid, ox, oy, cloudScrollLow, lowTileW, lowY, lowH);
        const m = sampleBankAlpha(bankMid.grid, ox, oy, cloudScrollMid, midTileW, midY, midH);
        return Math.min(1, l * lowAlpha * 1.35 + m * midAlpha * 0.95);
      };

      const cCenter = sampleSunCloud(orbX, orbY);
      const cLeft = sampleSunCloud(orbX - 24, orbY);
      const cRight = sampleSunCloud(orbX + 24, orbY);
      const cTop = sampleSunCloud(orbX, orbY - 18);
      const cBot = sampleSunCloud(orbX, orbY + 18);
      const avgDiscOcc = cCenter * 0.44 + (cLeft + cRight + cTop + cBot) * 0.14;

      const rawOcc = Math.min(1, avgDiscOcc * 1.45 + sim.fogWeight * 0.62 + sim.rainWeight * 0.58);
      sunOcclusion += (rawOcc - sunOcclusion) * 0.085;
      const edgeBreakGlow = Math.max(0, 1 - Math.abs(avgDiscOcc - 0.36) * 2.1) * (1 - sim.rainWeight * 0.65);

      // 1. Live Dynamic Time-of-Day & Weather Atmospheric Sky Dome
      const hourDec = getDhakaHourDecimal();
      const dawnF = sim.dayWeight > 0.4 && celestial.progress < 0.18 ? 1 - celestial.progress / 0.18 : 0;
      const sunsetF =
        sim.dayWeight > 0.4 && (celestial.progress > 0.74 || hourDec >= 16.3)
          ? Math.max(
              celestial.progress > 0.74 ? (celestial.progress - 0.74) / 0.26 : 0,
              hourDec >= 16.3 ? Math.min(1, (hourDec - 16.3) / 1.3) : 0
            )
          : 0;
      const twilight = Math.min(1, Math.max(dawnF, sunsetF)) * sim.dayWeight;

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

      let topRgb = lerpRgb(dayTop, overTop, effectiveCloud * 0.55 + sim.rainWeight * 0.35);
      let midRgb = lerpRgb(dayMid, overMid, effectiveCloud * 0.55 + sim.rainWeight * 0.35);
      let horRgb = lerpRgb(dayHor, overHor, effectiveCloud * 0.55 + sim.rainWeight * 0.35);

      if (twilight > 0.02) {
        topRgb = lerpRgb(topRgb, [36, 66, 130], twilight * 0.75);
        midRgb = lerpRgb(midRgb, [154, 124, 166], twilight * 0.65);
        horRgb = lerpRgb(horRgb, dawnF > sunsetF ? [246, 188, 136] : [242, 148, 98], twilight * 0.85);
      }

      topRgb = lerpRgb(topRgb, stormTop, sim.rainWeight * 0.45 + sim.stormWeight * 0.55);
      midRgb = lerpRgb(midRgb, stormMid, sim.rainWeight * 0.45 + sim.stormWeight * 0.55);
      horRgb = lerpRgb(horRgb, stormHor, sim.rainWeight * 0.45 + sim.stormWeight * 0.55);

      topRgb = lerpRgb(topRgb, fogTop, sim.fogWeight);
      midRgb = lerpRgb(midRgb, fogMid, sim.fogWeight);
      horRgb = lerpRgb(horRgb, fogHor, sim.fogWeight);

      // Atmospheric shading when clouds cover sun (only darkens when sun occlusion is high)
      const cloudShadeTint: RGB = [36, 52, 74];
      const occShade = Math.pow(Math.max(0, sunOcclusion - 0.15), 1.2) * 0.42 * sim.dayWeight * (1 - sim.stormWeight * 0.4);
      topRgb = lerpRgb(topRgb, cloudShadeTint, occShade);
      midRgb = lerpRgb(midRgb, cloudShadeTint, occShade);
      horRgb = lerpRgb(horRgb, cloudShadeTint, occShade * 0.85);

      topRgb = lerpRgb(nightTop, topRgb, sim.dayWeight);
      midRgb = lerpRgb(nightMid, midRgb, sim.dayWeight);
      horRgb = lerpRgb(nightHor, horRgb, sim.dayWeight);

      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, rgbCss(topRgb));
      skyGrad.addColorStop(0.54, rgbCss(midRgb));
      skyGrad.addColorStop(1, rgbCss(horRgb));
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Subtle sun-shower Rainbow Arc when daytime rain coincides with breaks of sunlight
      if (sim.dayWeight > 0.6 && sim.rainWeight > 0.18 && sunOcclusion < 0.55) {
        const rbAlpha = (1 - sunOcclusion / 0.55) * Math.min(1, sim.rainWeight * 1.4) * 0.16;
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

      // 2. Night Stars & Occasional Shooting Star
      const nightVis = 1 - sim.dayWeight;
      if (nightVis > 0.05 && sim.fogWeight < 0.7) {
        const starVis = nightVis * Math.max(0.1, 1 - effectiveCloud * 0.78 - sim.rainWeight * 0.85);
        for (const s of starGlints) {
          const a = (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(tick * s.speed + s.phase))) * starVis;
          if (a <= 0.015) continue;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(248, 250, 252, ${a.toFixed(3)})`;
          ctx.fill();
        }
        if (!prefersReducedMotion && effectiveCloud < 0.5 && sim.rainWeight < 0.2) {
          if (!shootingStar && tick >= nextMeteorTick) {
            shootingStar = {
              x: width * (0.2 + Math.random() * 0.55),
              y: height * (0.06 + Math.random() * 0.18),
              vx: 7.5 + Math.random() * 3,
              vy: 2.4 + Math.random() * 1.4,
              alpha: 0.9,
            };
            nextMeteorTick = tick + 220 + Math.floor(Math.random() * 200);
          }
          if (shootingStar) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(shootingStar.x, shootingStar.y);
            ctx.lineTo(shootingStar.x - shootingStar.vx * 8, shootingStar.y - shootingStar.vy * 8);
            ctx.strokeStyle = `rgba(224, 242, 254, ${(shootingStar.alpha * nightVis).toFixed(3)})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
            shootingStar.x += shootingStar.vx;
            shootingStar.y += shootingStar.vy;
            shootingStar.alpha -= 0.025;
            if (shootingStar.alpha <= 0) shootingStar = null;
          }
        }
      }

      // 3. Realistic Multi-Scattering Sun / Moon BEHIND Drifting Clouds
      const sunStrength = sim.dayWeight * Math.max(0.03, 1 - sunOcclusion * 0.96) * (1 - sim.stormWeight * 0.88);
      if (sunStrength > 0.015) {
        const wideBloom = ctx.createRadialGradient(
          orbX,
          orbY,
          4,
          orbX,
          orbY,
          Math.max(width, height) * 0.45
        );
        wideBloom.addColorStop(0, `rgba(255, 253, 245, ${(0.92 * sunStrength).toFixed(3)})`);
        wideBloom.addColorStop(0.045, `rgba(255, 248, 218, ${(0.66 * sunStrength).toFixed(3)})`);
        wideBloom.addColorStop(0.18, `rgba(254, 232, 165, ${(0.24 * sunStrength).toFixed(3)})`);
        wideBloom.addColorStop(0.46, `rgba(253, 214, 138, ${(0.07 * sunStrength).toFixed(3)})`);
        wideBloom.addColorStop(1, 'rgba(253, 214, 138, 0)');
        ctx.fillStyle = wideBloom;
        ctx.fillRect(0, 0, width, height);

        const coreR = 8.5 + sunStrength * 3;
        const coreGrad = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, coreR * 2.5);
        coreGrad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, sunStrength * 1.2).toFixed(3)})`);
        coreGrad.addColorStop(0.38, `rgba(255, 252, 236, ${(0.88 * sunStrength).toFixed(3)})`);
        coreGrad.addColorStop(1, 'rgba(255, 244, 200, 0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(orbX, orbY, coreR * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const moonStrength = nightVis * Math.max(0.1, 1 - sunOcclusion * 0.85) * (1 - sim.rainWeight * 0.8);
      if (moonStrength > 0.025) {
        const moonHalo = ctx.createRadialGradient(orbX, orbY, 4, orbX, orbY, 150);
        moonHalo.addColorStop(0, `rgba(241, 245, 249, ${(0.52 * moonStrength).toFixed(3)})`);
        moonHalo.addColorStop(0.28, `rgba(186, 204, 228, ${(0.18 * moonStrength).toFixed(3)})`);
        moonHalo.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = moonHalo;
        ctx.fillRect(0, 0, width, height);

        ctx.beginPath();
        ctx.arc(orbX, orbY, 13, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248, 250, 252, ${(0.92 * moonStrength).toFixed(3)})`;
        ctx.fill();
      }

      // 4. Three Parallax Layers of Volumetric Clouds DRIFTING IN FRONT OF Sun/Moon
      const stormPlateMix = Math.min(
        1,
        sim.stormWeight * 0.92 +
          sim.rainWeight * 0.68 +
          sunOcclusion * 0.42 * sim.dayWeight +
          (1 - sim.dayWeight) * 0.85
      );
      const dayPlateMix = 1 - stormPlateMix;

      const drawCloudBankLayer = (
        bank: { dayC: HTMLCanvasElement; stormC: HTMLCanvasElement },
        scrollX: number,
        tW: number,
        topY: number,
        drawH: number,
        layerAlpha: number
      ) => {
        if (layerAlpha <= 0.015) return;
        for (let start = -tW + scrollX; start < width + tW; start += tW) {
          if (start + tW <= 0 || start >= width) continue;
          if (dayPlateMix > 0.02) {
            ctx.globalAlpha = Math.min(1, layerAlpha * dayPlateMix);
            ctx.drawImage(bank.dayC, start, topY, tW + 1, drawH);
          }
          if (stormPlateMix > 0.02) {
            ctx.globalAlpha = Math.min(1, layerAlpha * stormPlateMix);
            ctx.drawImage(bank.stormC, start, topY, tW + 1, drawH);
          }
        }
      };

      ctx.save();
      drawCloudBankLayer(bankHigh, cloudScrollHigh, highTileW, highY, highH, highAlpha);
      drawCloudBankLayer(bankMid, cloudScrollMid, midTileW, midY, midH, midAlpha);
      drawCloudBankLayer(bankLow, cloudScrollLow, lowTileW, lowY, lowH, lowAlpha);
      ctx.restore();

      // 4b. Distant Cloud-to-Cloud Forked Lightning Bolt & Illumination when stormy
      if (sim.stormWeight > 0.45 && !prefersReducedMotion) {
        if (tick >= nextStormFlashTick) {
          distantStormFlash = 0.85 * sim.stormWeight;
          nextStormFlashTick = tick + 150 + Math.floor(Math.random() * 200);
          stormAudio.triggerThunder(0.78, 'weather');

          // Generate realistic jagged lightning bolt descending from storm cloud belly
          const bx0 = width * (0.15 + Math.random() * 0.7);
          let bx = bx0;
          let by = height * 0.14;
          const segs: Array<{ x: number; y: number }> = [{ x: bx, y: by }];
          const steps = 9;
          for (let s = 1; s <= steps; s++) {
            bx += (Math.random() - 0.5) * 34;
            by += (height * 0.55) / steps;
            segs.push({ x: bx, y: by });
          }
          stormBolt = segs;
        }
        if (distantStormFlash > 0.02) {
          ctx.fillStyle = `rgba(219, 234, 254, ${(distantStormFlash * 0.38).toFixed(3)})`;
          ctx.fillRect(0, 0, width, height * 0.78);
          if (stormBolt && distantStormFlash > 0.28) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(stormBolt[0].x, stormBolt[0].y);
            for (let i = 1; i < stormBolt.length; i++) {
              ctx.lineTo(stormBolt[i].x, stormBolt[i].y);
            }
            ctx.strokeStyle = `rgba(239, 246, 255, ${(distantStormFlash * 0.92).toFixed(3)})`;
            ctx.lineWidth = 2.1;
            ctx.shadowColor = '#bfdbfe';
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.restore();
          }
          distantStormFlash *= 0.86;
        } else {
          stormBolt = null;
        }
      }

      // 5. Realistic Silver-Lining Rim Glow & Crepuscular God Rays when Clouds Pass Over the Sun
      if (sim.dayWeight > 0.25 && sim.fogWeight < 0.72 && sim.stormWeight < 0.85) {
        const scatterPower = sim.dayWeight * (0.14 + edgeBreakGlow * 0.75 + sunOcclusion * 0.28) * (1 - sim.rainWeight * 0.62);
        if (scatterPower > 0.04) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const mieGlow = ctx.createRadialGradient(
            orbX,
            orbY,
            12,
            orbX,
            orbY,
            Math.max(width, height) * 0.25
          );
          mieGlow.addColorStop(0, `rgba(255, 250, 232, ${(0.36 * scatterPower).toFixed(3)})`);
          mieGlow.addColorStop(0.45, `rgba(254, 236, 188, ${(0.15 * scatterPower).toFixed(3)})`);
          mieGlow.addColorStop(1, 'rgba(254, 236, 188, 0)');
          ctx.fillStyle = mieGlow;
          ctx.fillRect(0, 0, width, height);

          if (sunOcclusion > 0.18) {
            const rayBaseA = Math.PI * 0.5 + (0.5 - celestial.progress) * 0.45;
            const rayAlpha = (0.032 + 0.055 * edgeBreakGlow) * sim.dayWeight * (1 - sim.rainWeight * 0.72);
            for (let r = 0; r < 6; r++) {
              const ang = rayBaseA + (r - 2.5) * 0.17 + Math.sin(tick * 0.006 + r * 1.4) * 0.02;
              const len = height * 0.84;
              const bx = orbX + Math.cos(ang) * len;
              const by = orbY + Math.sin(ang) * len;
              const rg = ctx.createLinearGradient(orbX, orbY, bx, by);
              rg.addColorStop(0, `rgba(255, 249, 214, ${rayAlpha.toFixed(3)})`);
              rg.addColorStop(0.6, `rgba(254, 240, 195, ${(rayAlpha * 0.3).toFixed(3)})`);
              rg.addColorStop(1, 'rgba(254, 240, 195, 0)');
              ctx.fillStyle = rg;
              ctx.beginPath();
              ctx.moveTo(orbX - 14, orbY);
              ctx.lineTo(orbX + 14, orbY);
              ctx.lineTo(bx + 82, by);
              ctx.lineTo(bx - 82, by);
              ctx.closePath();
              ctx.fill();
            }
          }
          ctx.restore();
        }
      }

      // 6. Weather-Matched Flying Birds
      const activeBirdCount =
        sim.dayWeight < 0.4 || sim.rainWeight > 0.45
          ? 0
          : sim.fogWeight > 0.5
            ? 2
            : isHotDay
              ? 4
              : 8;

      if (activeBirdCount > 0) {
        const birdAlpha = 0.64 * sim.dayWeight * (1 - sim.fogWeight * 0.45);
        const birdTone = twilight > 0.4 ? `rgba(38, 28, 36, ${birdAlpha.toFixed(2)})` : `rgba(22, 32, 46, ${birdAlpha.toFixed(2)})`;
        ctx.save();
        ctx.strokeStyle = birdTone;
        ctx.lineCap = 'round';
        for (let i = 0; i < activeBirdCount; i++) {
          const b = flyingBirds[i];
          if (!prefersReducedMotion) {
            const speedMult = isHotDay ? 0.78 : 1.0;
            b.x += b.vxBase * speedMult + windSign * windFactor * 0.42;
            b.y += Math.sin(tick * 0.015 + b.glideTick) * 0.1;
            b.glideTick += 1;
            const gliding = (isHotDay || i % 3 === 1) && b.glideTick % 180 > 85;
            if (!gliding) b.wingPhase += b.wingSpeed;
            if (b.x > width + 36) b.x = -36;
            if (b.x < -36) b.x = width + 36;
          }
          const flap = Math.sin(b.wingPhase);
          const wy = flap * b.span * 0.44;
          const my = flap * b.span * 0.18;
          ctx.lineWidth = Math.max(1.05, b.span * 0.15);
          ctx.beginPath();
          ctx.moveTo(b.x - b.span, b.y + wy);
          ctx.quadraticCurveTo(b.x - b.span * 0.45, b.y - b.span * 0.22 + my, b.x, b.y);
          ctx.quadraticCurveTo(b.x + b.span * 0.45, b.y - b.span * 0.22 + my, b.x + b.span, b.y + wy);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. Far Horizon Atmospheric Grove Ridge
      const farBaseY = height * 0.855;
      const farColor = lerpRgb(
        [32, 50, 48],
        lerpRgb(horRgb, [16, 26, 34], 0.44),
        0.5 + sim.fogWeight * 0.42 + sunOcclusion * 0.22
      );
      ctx.fillStyle = rgbCss(farColor, 0.84);
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width + 32; x += 24) {
        const ridge =
          Math.sin(x * 0.0085 + 0.5) * 16 +
          Math.sin(x * 0.023 + 1.8) * 9 +
          Math.cos(x * 0.055) * 5;
        ctx.lineTo(x, farBaseY - Math.max(0, ridge));
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // 7b. Mid-Distance Lush Hazy Village Trees (adds rich depth without cluttering sky)
      const midBarkCss = rgbCss(lerpRgb(farColor, [24, 34, 34], 0.45), 0.86);
      for (const mt of midTrees) {
        const mx = mt.xRatio * width;
        const my = height + 6;
        const mWind = sampleLocalWind(mx, tSec, windFactor, windSign, mt.freqMult, mt.seed);
        const mLen = Math.min(height * 0.22, 165) * mt.scale;
        const flex = windSign * mWind.bend * 0.14;
        const mTopX = mx + Math.sin(mt.lean + flex) * mLen;
        const mTopY = my - Math.cos(mt.lean + flex) * mLen;

        ctx.save();
        ctx.strokeStyle = midBarkCss;
        ctx.lineWidth = 8 * mt.scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mTopX, mTopY);
        ctx.stroke();

        const sprig = sprigCool[Math.floor(mt.seed) % sprigCool.length];
        const mCrown = 104 * mt.scale;
        ctx.globalAlpha = 0.72 * (1 - sim.fogWeight * 0.3);
        ctx.translate(mTopX, mTopY);
        ctx.rotate(flex * 0.5 + mWind.flutter * 0.12);
        ctx.drawImage(sprig, -mCrown * 0.58, -mCrown * 0.52, mCrown * 1.16, mCrown * 0.92);
        ctx.restore();
      }

      // 8. Foreground Botanically Articulated Palms & Leafy Bengal Trees with Real Asynchronous Gusts
      const sunlightFactor =
        sim.dayWeight *
        Math.max(0, 1 - sunOcclusion * 0.95) *
        (1 - sim.rainWeight * 0.82) *
        (1 - sim.fogWeight * 0.85);
      const activeSprigs =
        twilight > 0.38 && sunlightFactor > 0.2
          ? sprigGolden
          : sunlightFactor > 0.36
            ? sprigSun
            : sprigCool;

      const palmBarkRgb = lerpRgb([14, 20, 22], [36, 32, 26], sim.dayWeight * (1 - sunOcclusion * 0.5));
      const palmFrondRgb = lerpRgb(
        [10, 18, 20],
        lerpRgb([18, 40, 28], [32, 70, 38], sunlightFactor),
        sim.dayWeight
      );
      const palmRimRgb = twilight > 0.35 ? ([146, 114, 62] as RGB) : ([96, 138, 52] as RGB);

      for (const palm of palmTrees) {
        const px = palm.xRatio * width;
        const pH = Math.min(height * 0.4, Math.max(135, height * palm.heightRatio));
        drawArticulatedPalm(
          px,
          height + 8,
          pH,
          palm.lean,
          palm.fronds,
          palm.seed,
          palm.freqMult,
          windFactor,
          windSign,
          tSec,
          rgbCss(palmBarkRgb, 0.96),
          rgbCss(palmFrondRgb, 0.95),
          rgbCss(palmRimRgb, 0.92),
          sunlightFactor
        );
      }

      const treeBarkCss = rgbCss(lerpRgb([12, 16, 18], [32, 26, 22], sim.dayWeight * (1 - sunOcclusion * 0.5)), 0.97);
      for (const tree of leafyTrees) {
        const tx = tree.xRatio * width;
        const ty = height + 10;
        const tWind = sampleLocalWind(tx, tSec, windFactor, windSign, tree.freqMult, tree.seed);
        const trunkLen = Math.min(height * 0.25, 195) * tree.scale;

        const trunkFlex = windSign * tWind.bend * 0.16;
        const topX = tx + Math.sin(tree.lean + trunkFlex) * trunkLen;
        const topY = ty - Math.cos(tree.lean + trunkFlex) * trunkLen;
        const ctrlX = tx + Math.sin(tree.lean + trunkFlex * 0.4) * (trunkLen * 0.5);
        const ctrlY = ty - trunkLen * 0.55;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = treeBarkCss;
        ctx.lineWidth = 14 * tree.scale;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(ctrlX, ctrlY, topX, topY);
        ctx.stroke();

        tree.limbs.forEach((limb, li) => {
          const limbLag =
            windFactor > 0.015
              ? smoothTurb1d(tSec * (1.55 + windFactor * 1.1) * limb.freqMult + tree.seed * 2.7 + li * 4.1) *
                tWind.pocket *
                windFactor *
                0.22
              : 0;
          const lAng = limb.ang + trunkFlex * 1.25 + limbLag;
          const lLen = trunkLen * limb.len;
          const lx = topX + Math.cos(lAng) * lLen;
          const ly = topY + Math.sin(lAng) * lLen;

          ctx.strokeStyle = treeBarkCss;
          ctx.lineWidth = 6.6 * tree.scale;
          ctx.beginPath();
          ctx.moveTo(topX, topY);
          ctx.lineTo(lx, ly);
          ctx.stroke();

          limb.twigs.forEach((twOff, ti) => {
            const twigLag =
              windFactor > 0.015
                ? smoothTurb1d(
                    tSec * (2.7 + windFactor * 1.8) * limb.freqMult + tree.seed * 4.3 + li * 3.2 + ti * 5.7
                  ) *
                  tWind.pocket *
                  windFactor *
                  0.28
                : 0;
            const twAng = lAng + twOff + twigLag;
            const twLen = lLen * 0.62;
            const twx = lx + Math.cos(twAng) * twLen;
            const twy = ly + Math.sin(twAng) * twLen;

            ctx.strokeStyle = treeBarkCss;
            ctx.lineWidth = 3.1 * tree.scale;
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(twx, twy);
            ctx.stroke();

            const sprig = activeSprigs[(li + ti + Math.floor(tree.seed)) % activeSprigs.length];
            const sprSize = (80 + ((li + ti) % 2) * 18) * tree.scale;
            const flutterRot =
              windFactor > 0.015
                ? smoothTurb1d(tSec * (4.1 + windFactor * 2.4) + li * 2.9 + ti * 4.7 + tree.seed) *
                  tWind.pocket *
                  windFactor *
                  0.26
                : 0;

            ctx.save();
            ctx.translate(twx, twy);
            ctx.rotate(twAng * 0.25 + flutterRot);
            ctx.globalAlpha = sim.fogWeight > 0.5 ? 0.78 : 0.96;
            ctx.drawImage(sprig, -sprSize * 0.5, -sprSize * 0.5, sprSize, sprSize);
            ctx.restore();
          });
        });
        ctx.restore();
      }

      // Low foreground bushes & wind-rippled riverside reeds along the bottom edge
      ctx.fillStyle = rgbCss(lerpRgb([8, 16, 14], [16, 32, 20], sim.dayWeight * (1 - sunOcclusion * 0.45)));
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width + 24; x += 22) {
        const bush = 13 + Math.sin(x * 0.025) * 9 + Math.cos(x * 0.07) * 5;
        ctx.lineTo(x, height - bush);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      const reedColor = rgbCss(lerpRgb([14, 24, 18], [30, 56, 30], sunlightFactor * 0.8 + sim.dayWeight * 0.2), 0.9);
      ctx.save();
      ctx.strokeStyle = reedColor;
      ctx.lineWidth = 1.45;
      ctx.lineCap = 'round';
      for (const rd of reeds) {
        const rx = rd.xRatio * width;
        const rWind = sampleLocalWind(rx, tSec, windFactor, windSign, rd.freqMult, rd.seed);
        const rBend = windSign * rWind.bend * 22 + rWind.flutter * 8;
        ctx.beginPath();
        ctx.moveTo(rx, height + 2);
        ctx.quadraticCurveTo(rx + rd.lean * 22 + rBend * 0.4, height - rd.h * 0.55, rx + rd.lean * 42 + rBend, height - rd.h);
        ctx.stroke();
      }
      ctx.restore();

      // Atmospheric Cloud-Shadow Veil across sky & landscape when a thick cloud covers the Sun
      if (sunOcclusion > 0.18 && sim.dayWeight > 0.35 && sim.stormWeight < 0.7) {
        const veilA = Math.min(0.28, (sunOcclusion - 0.18) * 0.34 * sim.dayWeight * (1 - sim.stormWeight * 0.6));
        if (veilA > 0.01) {
          ctx.fillStyle = `rgba(10, 18, 30, ${veilA.toFixed(3)})`;
          ctx.fillRect(0, 0, width, height);
        }
      }

      // 9. Calm Night Fireflies
      if (nightVis > 0.4 && sim.rainWeight < 0.3 && windFactor < 0.55) {
        for (const f of fireflies) {
          if (!prefersReducedMotion) {
            f.x += f.vx;
            f.y += f.vy + Math.sin(tick * 0.04 + f.phase) * 0.14;
            if (f.x < 0) f.x = width;
            if (f.x > width) f.x = 0;
            if (f.y < height * 0.65) f.y = height * 0.65;
            if (f.y > height * 0.95) f.y = height * 0.95;
          }
          const glow = 0.25 + 0.75 * Math.max(0, Math.sin(tick * 0.06 + f.phase));
          ctx.beginPath();
          ctx.arc(f.x, f.y, 1.7, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(217, 249, 157, ${(glow * 0.72 * nightVis).toFixed(3)})`;
          ctx.fill();
        }
      }

      // 10. Horizon Fog Ribbons & Subtle Rain Ground Mist
      if (sim.fogWeight > 0.05 || sim.rainWeight > 0.2) {
        const mistDensity = Math.max(sim.fogWeight, sim.rainWeight * 0.38);
        const fogRgbStr = sim.dayWeight > 0.4 ? '226, 234, 242' : '148, 163, 184';
        for (const m of horizonMists) {
          if (!prefersReducedMotion) {
            m.x += windSign * m.vxBase * Math.max(0.5, windFactor + 0.4);
            if (windSign > 0 && m.x - m.rx > width + 60) m.x = -m.rx - 40;
            else if (windSign < 0 && m.x + m.rx < -60) m.x = width + m.rx + 40;
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

      // 11. Storm Wind Gust Streaks & Detached Flying Leaves
      if ((sim.stormWeight > 0.25 || windFactor > 0.52) && !prefersReducedMotion) {
        const gustVis = Math.min(1, Math.max(sim.stormWeight, (windFactor - 0.52) * 1.4));
        ctx.save();
        ctx.strokeStyle = `rgba(226, 232, 240, ${(0.18 * gustVis).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        for (const gs of gustStreaks) {
          gs.x += windSign * gs.speed * (0.9 + windFactor * 0.6);
          gs.y += Math.sin(tick * 0.05 + gs.x * 0.01) * 0.4;
          if (windSign > 0 && gs.x > width + 140) gs.x = -gs.len - 40;
          if (windSign < 0 && gs.x < -gs.len - 40) gs.x = width + 140;

          ctx.beginPath();
          ctx.moveTo(gs.x, gs.y);
          ctx.lineTo(gs.x + windSign * gs.len, gs.y + 4);
          ctx.stroke();
        }

        const leafCount = Math.floor(blownLeaves.length * gustVis);
        for (let i = 0; i < leafCount; i++) {
          const lf = blownLeaves[i];
          lf.x += windSign * lf.vx * (0.85 + windFactor * 0.85);
          lf.y += lf.vy + Math.sin(tick * 0.08 + i) * 0.85;
          lf.rot += lf.vRot * (0.8 + windFactor * 0.7);
          if (windSign > 0 && lf.x > width + 30) {
            lf.x = -20;
            lf.y = height * (0.55 + Math.random() * 0.38);
          } else if (windSign < 0 && lf.x < -30) {
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

      // 12. Live Rain Streaks & Ground Splash Rings scaled by rain/storm intensity
      if (sim.rainWeight > 0.04) {
        const activeDrops = Math.floor(rainDrops.length * (0.58 + sim.stormWeight * 0.42));
        const slant = windSign * (3.2 + windFactor * 6.8);
        ctx.lineCap = 'round';
        for (let i = 0; i < activeDrops; i++) {
          const d = rainDrops[i];
          const a = d.a * sim.rainWeight;
          ctx.strokeStyle =
            sim.dayWeight > 0.5
              ? `rgba(226, 232, 240, ${a.toFixed(3)})`
              : `rgba(186, 230, 253, ${a.toFixed(3)})`;
          ctx.lineWidth = sim.stormWeight > 0.5 ? 1.2 : 0.95;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + slant, d.y + d.len);
          ctx.stroke();

          if (!prefersReducedMotion) {
            d.y += d.speed * (1 + sim.stormWeight * 0.25);
            d.x += slant * 0.52;
            if (d.y > height + 20) {
              d.y = -25;
              d.x = Math.random() * (width + 260) - 130;
            }
            if (d.x > width + 140) d.x = -120;
            if (d.x < -140) d.x = width + 120;
          }
        }

        // Delicate rain splash ripples along the foreground foliage/waterline
        for (const sp of rainSplashes) {
          const progress = sp.r / sp.maxR;
          const spAlpha = (1 - progress) * 0.26 * sim.rainWeight;
          if (spAlpha > 0.01) {
            ctx.beginPath();
            ctx.ellipse(sp.x, sp.y, sp.r, sp.r * 0.34, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(203, 213, 225, ${spAlpha.toFixed(3)})`;
            ctx.lineWidth = 0.85;
            ctx.stroke();
          }
          if (!prefersReducedMotion) {
            sp.r += sp.speed;
            if (sp.r >= sp.maxR) {
              sp.r = 0.4;
              sp.x = Math.random() * width;
              sp.y = height - 8 - Math.random() * 26;
            }
          }
        }
      }

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(renderWeather);
      }
    };

    renderWeather();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isBirthdayMode, isWeatherMode]);

  if (isBirthdayMode) {
    return (
      <canvas
        ref={birthdayCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />
    );
  }

  if (isWeatherMode) {
    return (
      <>
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 bg-[#08101c]"
        />
        <canvas
          ref={weatherCanvasRef}
          aria-hidden="true"
          className="fixed inset-0 z-[1] h-full w-full pointer-events-none"
        />
        {/* Light top-edge scrim only so header buttons remain clear */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-16 bg-gradient-to-b from-black/40 to-transparent"
        />
      </>
    );
  }

  return (
    <>
      <canvas
        ref={skyCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />

      {/* Sequential Muted Background Videos from public/videos/ Clearly Visible & Blended */}
      {backgroundVideos.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[2] overflow-hidden"
          style={{
            maskImage:
              'radial-gradient(ellipse 98% 95% at 50% 50%, black 58%, rgba(0,0,0,0.65) 86%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 98% 95% at 50% 50%, black 58%, rgba(0,0,0,0.65) 86%, transparent 100%)',
          }}
        >
          <video
            ref={videoRef}
            key={backgroundVideos[currentVideoIdx % backgroundVideos.length]}
            src={backgroundVideos[currentVideoIdx % backgroundVideos.length]}
            muted
            autoPlay
            playsInline
            loop={backgroundVideos.length === 1}
            onEnded={() =>
              setCurrentVideoIdx((prev) => (prev + 1) % backgroundVideos.length)
            }
            className="h-full w-full object-cover opacity-90 transition-opacity duration-700"
            style={{
              filter: `brightness(${(0.86 + flashGlow * 0.35).toFixed(2)}) contrast(1.04)`,
            }}
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#020408]/75 via-transparent to-[#020408]/60"
            style={{ opacity: Math.max(0.28, 0.55 - flashGlow * 0.25) }}
          />
        </div>
      )}

      {/* Foreground Visible Lightning Bolts & Pouring Rain */}
      <canvas
        ref={rainFgCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 z-[5] h-full w-full pointer-events-none"
      />
    </>
  );
}
