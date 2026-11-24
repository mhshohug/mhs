import { useEffect, useRef, useState } from 'react';
import { computeBengaliPhenology } from '../utils/bengaliCalendar';
import {
  computeCelestialPosition,
  computeWeatherSeason,
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

/** Synodic lunar cycle progress: 0.0 (New Moon), 0.25 (1st Quarter), 0.5 (Full Moon), 0.75 (Last Quarter) */
function getMoonPhaseFraction(d: Date = new Date()): number {
  const knownNewMoon = 1704974220000; // Jan 11, 2024, 11:57 UTC
  const synodicMonthMs = 29.53058867 * 86400000;
  const diff = (d.getTime() - knownNewMoon) % synodicMonthMs;
  return ((diff + synodicMonthMs) % synodicMonthMs) / synodicMonthMs;
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
  windGustKmh?: number | null;
  windDirectionDeg: number | null;
  cloudCover: number | null;
  fogDensity?: number;
  rainIntensity: number;
  hasLightning: boolean;
  hasThunder: boolean;
  sunriseDecimal: number;
  sunsetDecimal: number;
  timezone?: string;
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
  const discovered = new Set<string>();

  // First check Express server auto-discovery so any uploaded filename in public/videos/ works immediately
  try {
    const apiRes = await fetch('/api/media/list', { cache: 'no-store' });
    const apiCt = apiRes.headers.get('content-type') || '';
    if (apiRes.ok && apiCt.includes('application/json')) {
      const data = (await apiRes.json()) as { videos?: string[] };
      if (Array.isArray(data.videos)) {
        for (const v of data.videos) {
          if (typeof v === 'string' && v.trim()) discovered.add(v);
        }
      }
    }
  } catch {
    // Fallback to manifest + static probing
  }

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
          if (!discovered.has(resolved)) candidates.add(resolved);
        }
      }
    }
  } catch {
    // Ignore missing manifest
  }

  for (const c of DEFAULT_VIDEO_CANDIDATES) {
    if (!discovered.has(c)) candidates.add(c);
  }

  if (candidates.size > 0) {
    await Promise.all(
      Array.from(candidates).map(async (url) => {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          const ct = res.headers.get('content-type') || '';
          if (res.ok && ct.startsWith('video/')) {
            discovered.add(url);
          }
        } catch {
          // Not uploaded
        }
      })
    );
  }

  return Array.from(discovered);
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
  windGustKmh = null,
  windDirectionDeg,
  cloudCover,
  fogDensity = 0,
  rainIntensity,
  hasLightning,
  hasThunder,
  sunriseDecimal,
  sunsetDecimal,
  timezone,
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
    windGustKmh,
    windDirectionDeg,
    cloudCover,
    fogDensity,
    rainIntensity,
    hasLightning,
    hasThunder,
    sunriseDecimal,
    sunsetDecimal,
    timezone,
  });
  weatherPropsRef.current = {
    weatherMood,
    weatherIsDay,
    temperatureC,
    windKmh,
    windGustKmh,
    windDirectionDeg,
    cloudCover,
    fogDensity,
    rainIntensity,
    hasLightning,
    hasThunder,
    sunriseDecimal,
    sunsetDecimal,
    timezone,
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
      timezone,
    });
    stormAudio.setSceneMode(mode, {
      sceneId: 'forest',
      bengaliSeason: computeBengaliPhenology(new Date()).season,
      weatherMood,
      isDay: weatherIsDay,
      windKmh,
      temperatureC,
      sunProgress: celestial.progress,
      rainIntensity,
      hasThunder,
    });
  }, [
    isBirthdayMode,
    isWeatherMode,
    weatherMood,
    weatherIsDay,
    windKmh,
    temperatureC,
    rainIntensity,
    hasThunder,
    sunriseDecimal,
    sunsetDecimal,
    timezone,
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
        stormAudio.triggerThunder(0.84 + Math.random() * 0.34);
      }
      const targetY = height * (0.48 + Math.random() * 0.24);
      activeBolts = generateBolt(flashCenter.x, 0, targetY);
      flashIntensity = isAftershock ? 0.78 + Math.random() * 0.2 : 1.0;
      if (!isAftershock) {
        nextLightningIn = 460 + Math.floor(Math.random() * 520);
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
      const clampedWind = Math.min(1.8, baseWind);
      const travelPos1 = u - wSign * tSec * (0.15 + clampedWind * 0.075);
      const travelPos2 = u * 1.35 - wSign * tSec * (0.22 + clampedWind * 0.105) + 3.7;
      // Traveling gust pockets (0.42..1.34) so wind rolls smoothly across the forest
      const g1 = 0.5 + 0.5 * smoothTurb1d(travelPos1 * 2.1 + 1.3);
      const g2 = 0.5 + 0.5 * smoothTurb1d(travelPos2 * 3.0 + 7.1);
      const pocket = 0.42 + (g1 * 0.65 + g2 * 0.35) * 0.92;

      // Smoothly saturating wind pressure avoids abrupt jumps or earthquake-like reversals
      const normWind = baseWind / (1 + baseWind * 0.42);
      const slowSwell = smoothTurb1d(tSec * (0.22 + normWind * 0.16) * freqMult + seed * 5.3);
      const gentleSurge = smoothTurb1d(tSec * (0.46 + normWind * 0.22) * freqMult + seed * 11.7) * 0.35;
      const gustEnvelope = 0.78 + slowSwell * 0.24 + gentleSurge * 0.14;

      const bend = normWind * pocket * gustEnvelope;

      // Expressive leaf flutter at a smooth, non-jittery cadence
      const leafWave1 = Math.sin(tSec * (1.15 + normWind * 0.62) * freqMult + seed * 7.3);
      const leafWave2 = smoothTurb1d(tSec * (1.72 + normWind * 0.82) * freqMult + seed * 14.9) * 0.75;
      const flutter = normWind * pocket * (leafWave1 * 0.68 + leafWave2 * 0.55);
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

    // 2. High-resolution botanical foliage sprays (140x140: twiglets, tapered leaves, natural sky gaps & sunlit rim sprites)
    const createLeafSprigSprite = (
      seed: number,
      shadowRgb: RGB,
      midRgb: RGB,
      outerRgb: RGB,
      veinRgb: RGB,
      rimOnly = false,
      leafDensity = 1
    ): HTMLCanvasElement => {
      const S = 140;
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

      // Subtle internal wooden twiglets peeking through real foliage gaps
      if (!rimOnly) {
        g.strokeStyle = rgbCss([26, 22, 18], 0.72);
        g.lineCap = 'round';
        for (let t = 0; t < 5; t++) {
          const tang = -Math.PI * 0.9 + (t / 4) * Math.PI * 0.8 + (rand(t + 1) - 0.5) * 0.3;
          const tlen = S * (0.24 + rand(t + 11) * 0.14);
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(cx, cy + 8);
          g.quadraticCurveTo(
            cx + Math.cos(tang) * tlen * 0.5,
            cy + Math.sin(tang) * tlen * 0.5 - 3,
            cx + Math.cos(tang) * tlen,
            cy + Math.sin(tang) * tlen
          );
          g.stroke();
        }
      }

      const leafCount = Math.round((rimOnly ? 64 : 118) * leafDensity);
      for (let i = 0; i < leafCount; i++) {
        const r1 = rand(i * 3 + 1);
        const r2 = rand(i * 3 + 2);
        const r3 = rand(i * 3 + 3);
        const r4 = rand(i * 3 + 4);

        const ang = rimOnly
          ? -Math.PI * 1.15 + r1 * Math.PI * 1.3
          : r1 * Math.PI * 2;
        const distNorm = rimOnly ? 0.45 + Math.pow(r2, 0.7) * 0.52 : Math.pow(r2, 0.62);
        const rad = distNorm * (S * 0.39);
        const lx = cx + Math.cos(ang) * rad;
        const ly = cy + Math.sin(ang) * rad * 0.84;

        // Tapered pointed botanical leaf blade
        const leafRot = ang + (r3 - 0.5) * 0.9;
        const lw = (rimOnly ? 6.2 : 7.0) + r3 * 6.4;
        const lh = (rimOnly ? 2.1 : 2.3) + r4 * 1.7;

        let fillCss: string;
        if (rimOnly) {
          fillCss = rgbCss(r3 > 0.45 ? outerRgb : midRgb, 0.52 + r4 * 0.34);
        } else if (distNorm < 0.44 || (ly > cy + 8 && r3 < 0.55)) {
          fillCss = rgbCss(shadowRgb, 0.94);
        } else if (distNorm > 0.68 && ly < cy + 4) {
          fillCss = rgbCss(outerRgb, 0.9);
        } else {
          fillCss = rgbCss(midRgb, 0.92);
        }

        g.save();
        g.translate(lx, ly);
        g.rotate(leafRot);
        g.fillStyle = fillCss;
        g.beginPath();
        g.moveTo(-lw * 0.48, 0);
        g.bezierCurveTo(-lw * 0.1, -lh * 1.05, lw * 0.28, -lh * 0.85, lw * 0.66, 0);
        g.bezierCurveTo(lw * 0.28, lh * 0.85, -lw * 0.1, lh * 1.05, -lw * 0.48, 0);
        g.fill();

        // Delicate leaf midrib catch-light on outer leaves
        if ((rimOnly || distNorm > 0.72) && r4 > 0.48) {
          g.strokeStyle = rgbCss(veinRgb, rimOnly ? 0.42 : 0.28);
          g.lineWidth = 0.6;
          g.beginPath();
          g.moveTo(-lw * 0.32, 0);
          g.lineTo(lw * 0.48, 0);
          g.stroke();
        }
        g.restore();
      }
      return c;
    };

    const sprigCool = [
      createLeafSprigSprite(1, [11, 23, 19], [20, 42, 31], [34, 61, 45], [52, 82, 62]),
      createLeafSprigSprite(2, [9, 20, 17], [18, 38, 28], [30, 56, 41], [46, 76, 56]),
      createLeafSprigSprite(3, [12, 25, 20], [22, 44, 32], [36, 64, 47], [54, 86, 64]),
      createLeafSprigSprite(4, [10, 22, 18], [19, 40, 30], [32, 58, 43], [48, 78, 58]),
    ];
    const sprigMonsoon = [
      createLeafSprigSprite(1, [8, 26, 20], [16, 52, 32], [30, 78, 46], [58, 118, 72], false, 1.12),
      createLeafSprigSprite(2, [7, 24, 18], [14, 48, 29], [26, 72, 42], [52, 108, 66], false, 1.12),
      createLeafSprigSprite(3, [9, 28, 22], [18, 56, 35], [34, 84, 50], [64, 124, 78], false, 1.12),
      createLeafSprigSprite(4, [8, 25, 19], [15, 50, 31], [28, 75, 44], [55, 112, 69], false, 1.12),
    ];
    const sprigWinter = [
      createLeafSprigSprite(1, [24, 30, 20], [50, 58, 32], [92, 82, 42], [134, 114, 60], false, 0.62),
      createLeafSprigSprite(2, [22, 28, 18], [46, 54, 30], [86, 76, 38], [126, 106, 54], false, 0.62),
      createLeafSprigSprite(3, [26, 32, 22], [54, 62, 34], [98, 88, 46], [142, 120, 64], false, 0.62),
      createLeafSprigSprite(4, [23, 29, 19], [48, 56, 31], [89, 79, 40], [130, 110, 57], false, 0.62),
    ];
    const sprigSun = [
      createLeafSprigSprite(1, [16, 36, 20], [38, 78, 32], [86, 134, 48], [156, 196, 86]),
      createLeafSprigSprite(2, [14, 33, 18], [34, 72, 29], [78, 124, 44], [148, 188, 80]),
      createLeafSprigSprite(3, [18, 38, 22], [42, 82, 34], [92, 140, 52], [164, 202, 92]),
      createLeafSprigSprite(4, [15, 34, 19], [36, 75, 31], [82, 128, 46], [152, 192, 84]),
    ];
    const sprigGolden = [
      createLeafSprigSprite(1, [20, 28, 22], [52, 62, 32], [134, 108, 52], [214, 176, 94]),
      createLeafSprigSprite(2, [18, 26, 20], [46, 56, 30], [124, 98, 48], [202, 166, 86]),
      createLeafSprigSprite(3, [22, 30, 23], [56, 66, 34], [142, 114, 56], [222, 184, 102]),
      createLeafSprigSprite(4, [19, 27, 21], [49, 59, 31], [129, 102, 50], [208, 172, 90]),
    ];
    const sprigSunRim = [
      createLeafSprigSprite(1, [60, 100, 36], [118, 166, 58], [182, 216, 98], [238, 246, 154], true),
      createLeafSprigSprite(2, [56, 94, 34], [110, 158, 54], [174, 208, 92], [232, 240, 148], true),
      createLeafSprigSprite(3, [64, 104, 38], [124, 172, 62], [188, 222, 104], [244, 250, 162], true),
      createLeafSprigSprite(4, [58, 98, 35], [114, 162, 56], [178, 212, 96], [236, 244, 150], true),
    ];
    const sprigGoldenRim = [
      createLeafSprigSprite(1, [110, 82, 36], [186, 134, 54], [242, 186, 86], [255, 226, 148], true),
      createLeafSprigSprite(2, [104, 78, 34], [178, 128, 50], [234, 178, 82], [252, 220, 140], true),
      createLeafSprigSprite(3, [116, 86, 38], [192, 140, 58], [248, 192, 92], [255, 232, 156], true),
      createLeafSprigSprite(4, [108, 80, 35], [182, 132, 52], [238, 182, 84], [254, 224, 144], true),
    ];
    const sprigMoonRim = [
      createLeafSprigSprite(1, [48, 72, 102], [92, 128, 172], [148, 186, 228], [216, 234, 255], true),
      createLeafSprigSprite(2, [44, 68, 96], [86, 122, 166], [140, 178, 220], [210, 228, 250], true),
      createLeafSprigSprite(3, [52, 78, 108], [98, 134, 180], [156, 194, 236], [224, 240, 255], true),
      createLeafSprigSprite(4, [46, 70, 99], [89, 125, 169], [144, 182, 224], [214, 232, 252], true),
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

    // Smoothly interpolated atmospheric & seasonal simulation state
    const initP = weatherPropsRef.current;
    const initSeason = computeWeatherSeason({
      mood: initP.weatherMood,
      temperatureC: initP.temperatureC,
      rainIntensity: initP.rainIntensity,
    });
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
              : 0.14,
      rainWeight: initP.rainIntensity,
      stormWeight: initP.weatherMood === 'storm' ? 1 : initP.rainIntensity > 0.8 ? 0.45 : 0,
      lightningWeight: initP.hasLightning ? 1 : 0,
      fogWeight: Math.max(initP.weatherMood === 'fog' ? 0.78 : 0, Math.min(1, initP.fogDensity ?? 0)),
      dayWeight: initP.weatherIsDay ? 1 : 0,
      tempC: initP.temperatureC ?? 27,
      summerWeight: initSeason.summerWeight,
      monsoonWeight: initSeason.monsoonWeight,
      winterWeight: initSeason.winterWeight,
    };

    const flyingBirds = Array.from({ length: 9 }, (_, i) => ({
      x: Math.random() * width,
      y: height * (0.14 + (i % 5) * 0.08),
      vxBase: (i % 3 === 0 ? -1 : 1) * (0.58 + (i % 4) * 0.18),
      span: 6.2 + (i % 4) * 1.9,
      wingPhase: Math.random() * Math.PI * 2,
      wingSpeed: 0.14 + (i % 3) * 0.04,
      glideTick: Math.floor(Math.random() * 240),
    }));

    // Songbirds living in the trees: hopping cheerfully in dry weather, sheltering quietly under leaves when raining
    const initRaining = initP.rainIntensity > 0.05 || initP.weatherMood === 'storm';
    const canopyBirds = Array.from({ length: 12 }, (_, i) => ({
      anchorIdx: i * 4,
      targetIdx: (i * 4 + 3) % 45,
      state: (!initRaining && i % 4 === 0 ? 'hopping' : 'perched') as 'perched' | 'hopping',
      hopT: !initRaining && i % 4 === 0 ? (i % 4) * 0.2 : 0,
      hopSpeed: 0.012 + (i % 3) * 0.004,
      arcH: 18 + (i % 4) * 11,
      waitTicks: 90 + i * 37,
      wingPhase: Math.random() * Math.PI * 2,
      bobPhase: Math.random() * Math.PI * 2,
      facing: i % 2 === 0 ? 1 : -1,
      scale: 0.84 + (i % 3) * 0.16,
    }));
    const treePerchAnchors: Array<{
      x: number;
      y: number;
      shelterX: number;
      shelterY: number;
      isLeafy: boolean;
    }> = [];
    let rainShelterBlend = initRaining ? 1 : 0;

    const rainDrops = Array.from({ length: 300 }, () => ({
      x: Math.random() * (width + 260) - 130,
      y: Math.random() * height,
      len: 16 + Math.random() * 22,
      speed: 14 + Math.random() * 7,
      a: 0.22 + Math.random() * 0.26,
    }));

    const rainSplashes = Array.from({ length: 56 }, () => ({
      x: Math.random() * width,
      y: height * 0.91 + Math.random() * (height * 0.08),
      yRatio: 0.12 + Math.random() * 0.84,
      r: Math.random() * 7,
      maxR: 6 + Math.random() * 10,
      speed: 0.42 + Math.random() * 0.42,
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

    const drawTaperedCurve = (
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
    ) => {
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
        // Because upward trunk has dy < 0, nx = -dy/mag > 0 points RIGHT (+X), so leftPts is the RIGHT edge and rightPts is the LEFT edge
        const sidePts = sunDirX >= 0 ? leftPts : rightPts;
        ctx.strokeStyle = sunEdgeCss;
        ctx.lineWidth = Math.max(1.15, w0 * 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sidePts[0].x, sidePts[0].y);
        for (let s = 1; s <= steps; s++) ctx.lineTo(sidePts[s].x, sidePts[s].y);
        ctx.stroke();
      }
    };

    const drawRealisticBird = (
      bx: number,
      by: number,
      facing: number,
      scale: number,
      wingPhase: number,
      isGliding: boolean,
      isPerched: boolean,
      bodyCss: string,
      huddle = 0,
      rimCss: string | null = null
    ) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(facing * scale, scale);
      ctx.fillStyle = bodyCss;
      ctx.strokeStyle = bodyCss;
      ctx.lineCap = 'round';

      if (isPerched) {
        // Neat songbird silhouette; when huddled in rain, feathers fluff slightly and head tucks into shoulders
        const bodyRx = 3.6 + huddle * 0.45;
        const bodyRy = 2.2 + huddle * 0.45;
        const headX = 3.0 - huddle * 0.72;
        const headY = -2.1 + huddle * 0.68;
        const headR = 1.55 + huddle * 0.08;

        ctx.beginPath();
        ctx.ellipse(0, huddle * 0.3, bodyRx, bodyRy, -0.35 + huddle * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(headX, headY, headR, 0, Math.PI * 2);
        ctx.fill();
        // Beak
        ctx.beginPath();
        ctx.moveTo(headX + 1.15, headY - 0.35);
        ctx.lineTo(headX + 2.9 - huddle * 0.35, headY + 0.1 + huddle * 0.18);
        ctx.lineTo(headX + 1.15, headY + 0.65);
        ctx.closePath();
        ctx.fill();
        // Tail tucked slightly lower against rain
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(-2.4, 0.8 + huddle * 0.25);
        ctx.lineTo(-6.2 + huddle * 0.5, 3.2 + huddle * 0.85);
        ctx.stroke();

        // Subtle sky-light feather edge so sheltered birds stay distinct against dark green foliage
        if (rimCss) {
          ctx.strokeStyle = rimCss;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(headX - 0.15, headY - 0.15, headR * 0.92, -Math.PI * 0.9, -Math.PI * 0.15);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(-0.3, -0.15 + huddle * 0.25, bodyRx * 0.88, bodyRy * 0.78, -0.35 + huddle * 0.12, Math.PI * 1.05, Math.PI * 1.72);
          ctx.stroke();
        }
      } else {
        // Organic curved-wing avian flight silhouette (swept wing + body + tail)
        const flap = isGliding ? -0.18 : Math.sin(wingPhase);
        const wSpan = 7.4;
        const midY = flap * 2.1 - 1.6;
        const tipY = flap * 4.4 - 0.8;

        // Slender bird body + tail
        ctx.beginPath();
        ctx.ellipse(0, 0.3, 3.2, 1.15, 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-2.5, 0.4);
        ctx.lineTo(-5.8, 1.4);
        ctx.lineTo(-5.2, -0.1);
        ctx.closePath();
        ctx.fill();

        // Far wing & near wing with organic cambered curvature
        ctx.lineWidth = 1.45;
        ctx.beginPath();
        ctx.moveTo(-0.4, -0.2);
        ctx.quadraticCurveTo(-2.2, midY - 0.7, -wSpan * 0.85, tipY - 0.5);
        ctx.stroke();

        ctx.lineWidth = 1.85;
        ctx.beginPath();
        ctx.moveTo(0.8, 0.0);
        ctx.quadraticCurveTo(-1.2, midY, -wSpan, tipY);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawRealisticDeer = (
      dx: number,
      dy: number,
      facing: number,
      scale: number,
      pose: 'grazing' | 'resting' | 'fawn' | 'walking',
      tickVal: number,
      moonRimAlpha = 0,
      rainShelter = 0,
      litIntensity = 0.72,
      strideOverride?: number
    ) => {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.scale(facing * scale, scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Rich lifelike Sundarbans Chital deer (চিত্রা হরিণ): warm golden-chestnut coat, rich dorsal shading, creamy underbelly & throat ruff
      const coatLit = Math.max(0.28, Math.min(1, litIntensity));
      const coatRgb: RGB = lerpRgb([66, 42, 24], [204, 132, 62], coatLit);
      const coatBackRgb: RGB = lerpRgb([44, 28, 16], [148, 86, 34], coatLit);
      const coatShadeRgb: RGB = lerpRgb([30, 19, 12], [110, 64, 28], coatLit);
      const creamRgb: RGB = lerpRgb([144, 132, 114], [250, 242, 224], coatLit);
      const hoofRgb: RGB = [15, 13, 13];
      const antlerCss = rgbCss(lerpRgb([96, 78, 56], [206, 182, 140], coatLit));
      const spotCol = `rgba(255, 248, 234, ${(0.76 + coatLit * 0.22).toFixed(2)})`;
      const rimColor = `rgba(226, 238, 255, ${Math.min(0.85, moonRimAlpha).toFixed(2)})`;

      const coatCss = rgbCss(coatRgb);
      const coatBackCss = rgbCss(coatBackRgb);
      const coatShadeCss = rgbCss(coatShadeRgb);
      const creamCss = rgbCss(creamRgb);
      const hoofCss = rgbCss(hoofRgb);

      const drawAnatomicalHead = (hx: number, hy: number, pitchRad: number, isFawn = false, hasAntlers = false, isResting = false) => {
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(pitchRad);

        const s = isFawn ? 0.74 : 1.0;

        // Back ear (far ear subtle silhouette behind crown)
        ctx.save();
        ctx.translate(-1.2 * s, -2.5 * s);
        ctx.rotate(isResting ? -0.78 : -0.18 + Math.sin(tickVal * 0.06) * 0.08);
        ctx.fillStyle = coatShadeCss;
        ctx.beginPath();
        ctx.ellipse(0, -2.2 * s, 1.15 * s, 3.1 * s, 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Sculpted continuous skull + forehead slope + tapered bridge of nose + soft muzzle jaw
        const headGrad = ctx.createLinearGradient(0, -3.5 * s, 0, 2.5 * s);
        headGrad.addColorStop(0, coatBackCss);
        headGrad.addColorStop(0.65, coatCss);
        headGrad.addColorStop(1, coatShadeCss);
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.moveTo(-3.6 * s, -1.2 * s);
        ctx.quadraticCurveTo(-2.6 * s, -3.4 * s, 0.4 * s, -3.1 * s);
        ctx.quadraticCurveTo(2.4 * s, -2.8 * s, 3.6 * s, -1.4 * s);
        ctx.lineTo(6.9 * s, -0.45 * s);
        ctx.quadraticCurveTo(7.5 * s, 0.25 * s, 6.6 * s, 1.15 * s);
        ctx.lineTo(2.8 * s, 1.95 * s);
        ctx.quadraticCurveTo(0.2 * s, 2.55 * s, -2.6 * s, 1.75 * s);
        ctx.quadraticCurveTo(-4.0 * s, 0.6 * s, -3.6 * s, -1.2 * s);
        ctx.closePath();
        ctx.fill();

        // Dark forehead-to-muzzle bridge stripe & white eye ring (characteristic of Chital!)
        ctx.strokeStyle = coatShadeCss;
        ctx.lineWidth = 0.85 * s;
        ctx.beginPath();
        ctx.moveTo(0.6 * s, -2.6 * s);
        ctx.lineTo(5.8 * s, -0.6 * s);
        ctx.stroke();

        // Creamy white chin, lips & lower jaw
        ctx.fillStyle = creamCss;
        ctx.beginPath();
        ctx.ellipse(3.6 * s, 1.18 * s, 2.4 * s, 0.72 * s, -0.14, 0, Math.PI * 2);
        ctx.fill();

        // Wet dark rhinarium nose pad + nostril notch
        ctx.fillStyle = '#0d131a';
        ctx.beginPath();
        ctx.ellipse(6.75 * s, 0.12 * s, 0.92 * s, 0.68 * s, -0.15, 0, Math.PI * 2);
        ctx.fill();

        // Subtle creamy eye halo + large expressive almond eye + crisp sky catchlight
        ctx.fillStyle = `rgba(248, 240, 224, ${(0.36 * coatLit).toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(1.65 * s, -0.82 * s, 1.25 * s, 0.92 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0b1016';
        ctx.beginPath();
        ctx.ellipse(1.7 * s, -0.82 * s, 0.88 * s, 0.72 * s, -0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(1.92 * s, -1.04 * s, 0.30 * s, 0, Math.PI * 2);
        ctx.fill();

        // Near large cupped outer ear + pale cream inner pinna + dark rim
        ctx.save();
        ctx.translate(-2.2 * s, -2.2 * s);
        ctx.rotate(isResting ? -0.95 : -0.34 + Math.sin(tickVal * 0.08) * 0.14);
        ctx.fillStyle = coatBackCss;
        ctx.beginPath();
        ctx.ellipse(0, -2.6 * s, 1.45 * s, 3.6 * s, -0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = creamCss;
        ctx.beginPath();
        ctx.ellipse(0.28 * s, -2.5 * s, 0.74 * s, 2.25 * s, -0.04, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Slender branched 3-tine Chital stag lyre antlers
        if (hasAntlers) {
          ctx.strokeStyle = antlerCss;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          // Main swept beam
          ctx.moveTo(-0.8, -2.6);
          ctx.bezierCurveTo(-2.0, -8.5, -5.8, -12.6, -5.2, -18.2);
          // Brow tine jutting forward
          ctx.moveTo(-1.1, -5.2);
          ctx.quadraticCurveTo(1.2, -7.2, 2.8, -8.8);
          // Treble tine
          ctx.moveTo(-4.1, -11.4);
          ctx.quadraticCurveTo(-1.4, -13.6, -0.5, -16.4);
          ctx.stroke();

          // Subtle shadow far antler for realistic 3D rack depth
          ctx.strokeStyle = `rgba(148, 128, 98, ${(0.55 + coatLit * 0.3).toFixed(2)})`;
          ctx.lineWidth = 0.95;
          ctx.beginPath();
          ctx.moveTo(0.2, -2.5);
          ctx.bezierCurveTo(-0.4, -7.8, -3.4, -11.8, -2.8, -16.6);
          ctx.stroke();
        }
        ctx.restore();
      };

      const drawSpotRows = (bodyBob: number, rxScale = 1, yShift = 0) => {
        ctx.fillStyle = spotCol;
        const spots = [
          { x: -10.2, y: -15.4, r: 0.88 }, { x: -6.4, y: -16.6, r: 0.96 }, { x: -2.0, y: -16.4, r: 1.02 },
          { x: 2.2, y: -15.8, r: 0.96 }, { x: 6.2, y: -14.8, r: 0.88 },
          { x: -11.4, y: -13.2, r: 0.86 }, { x: -7.8, y: -13.6, r: 1.00 }, { x: -3.6, y: -13.2, r: 1.06 },
          { x: 0.5, y: -12.8, r: 1.00 }, { x: 4.8, y: -12.4, r: 0.94 }, { x: 8.4, y: -12.2, r: 0.82 },
          { x: -9.2, y: -10.6, r: 0.84 }, { x: -5.0, y: -10.4, r: 0.92 }, { x: -0.8, y: -10.2, r: 0.92 },
          { x: 3.2, y: -10.0, r: 0.86 }, { x: 6.6, y: -10.0, r: 0.78 },
        ];
        for (const s of spots) {
          ctx.beginPath();
          ctx.arc(s.x * rxScale, s.y - bodyBob + yShift, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      if (pose === 'walking' || pose === 'grazing') {
        const isWalking = pose === 'walking';
        const walkCycle = strideOverride ?? (tickVal * 0.155);
        const bodyBob = isWalking ? Math.abs(Math.sin(walkCycle)) * 1.15 : Math.sin(tickVal * 0.04) * 0.32;
        const tailWag = Math.sin(tickVal * 0.09) * 0.35;

        const fLeg1 = isWalking ? Math.sin(walkCycle) : 0.16;
        const fLeg2 = isWalking ? Math.sin(walkCycle + Math.PI) : -0.22;
        const hLeg1 = isWalking ? Math.sin(walkCycle + Math.PI * 0.52) : -0.18;
        const hLeg2 = isWalking ? Math.sin(walkCycle + Math.PI * 1.52) : 0.22;

        // Articulated 3-segment slender deer leg (upper thigh/shoulder -> sharp hock/knee -> thin cannon -> split cloven hoof)
        const drawDeerLeg = (
          hipX: number,
          hipY: number,
          hockX: number,
          hockY: number,
          footX: number,
          footY: number,
          col: string,
          upperW: number,
          lowerW: number
        ) => {
          ctx.strokeStyle = col;
          ctx.lineWidth = upperW;
          ctx.beginPath();
          ctx.moveTo(hipX, hipY);
          ctx.lineTo(hockX, hockY);
          ctx.stroke();

          ctx.lineWidth = lowerW;
          ctx.beginPath();
          ctx.moveTo(hockX, hockY);
          ctx.lineTo(footX, footY - 0.6);
          ctx.stroke();

          // Dark fetlock & pointed cloven hoof
          ctx.fillStyle = hoofCss;
          ctx.beginPath();
          ctx.moveTo(footX - 0.9, footY - 1.1);
          ctx.lineTo(footX + 1.8, footY - 0.2);
          ctx.lineTo(footX + 1.4, footY + 0.8);
          ctx.lineTo(footX - 1.0, footY + 0.5);
          ctx.closePath();
          ctx.fill();
        };

        // Far legs slightly darker for natural depth
        drawDeerLeg(-10.2, -11.8, -14.2 + hLeg1 * 3.0, -5.6, -12.6 + hLeg1 * 5.6, 0.8, coatShadeCss, 2.7, 1.5);
        drawDeerLeg(8.8, -10.8, 8.6 + fLeg2 * 3.2, -5.0, 7.8 + fLeg2 * 5.8, 0.8, coatShadeCss, 2.4, 1.4);

        // White tail underside + chestnut upper tail + white rump mirror edge
        ctx.fillStyle = creamCss;
        ctx.beginPath();
        ctx.ellipse(-14.6, -12.2 - bodyBob, 1.8, 3.8, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = creamCss;
        ctx.beginPath();
        ctx.ellipse(-16.0 + tailWag * 2.2, -13.4 - bodyBob, 1.45, 3.4, -0.28 + tailWag * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = coatBackCss;
        ctx.beginPath();
        ctx.ellipse(-15.5 + tailWag * 2.2, -14.0 - bodyBob, 1.05, 2.8, -0.24 + tailWag * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Sculpted anatomical torso (withers -> hollow back -> rounded croup -> tucked flank -> deep chest brisket)
        const bodyGrad = ctx.createLinearGradient(0, -22 - bodyBob, 0, -5 - bodyBob);
        bodyGrad.addColorStop(0, coatBackCss);
        bodyGrad.addColorStop(0.58, coatCss);
        bodyGrad.addColorStop(0.88, coatCss);
        bodyGrad.addColorStop(1, creamCss);
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.moveTo(10.5, -18.2 - bodyBob); // withers
        ctx.quadraticCurveTo(2.0, -19.2 - bodyBob, -4.5, -18.8 - bodyBob); // subtle spine
        ctx.quadraticCurveTo(-12.5, -19.0 - bodyBob, -14.8, -13.8 - bodyBob); // croup & haunch
        ctx.quadraticCurveTo(-14.2, -8.5 - bodyBob, -8.2, -8.4 - bodyBob); // hind thigh
        ctx.quadraticCurveTo(-1.2, -7.2 - bodyBob, 6.2, -7.4 - bodyBob); // tucked waist -> chest
        ctx.quadraticCurveTo(13.8, -7.2 - bodyBob, 14.2, -12.4 - bodyBob); // deep brisket
        ctx.quadraticCurveTo(13.8, -16.8 - bodyBob, 10.5, -18.2 - bodyBob);
        ctx.closePath();
        ctx.fill();

        // Muscular thigh & shoulder shading
        ctx.fillStyle = `rgba(110, 62, 26, ${(0.24 * coatLit).toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(-9.2, -12.6 - bodyBob, 5.2, 4.6, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // Crisp dark dorsal stripe along Chital spine
        ctx.strokeStyle = coatShadeCss;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(-13.8, -16.2 - bodyBob);
        ctx.quadraticCurveTo(-2.5, -19.2 - bodyBob, 10.6, -18.2 - bodyBob);
        ctx.stroke();

        // Near legs (lit golden tan + slender cannon + crisp cloven hooves)
        drawDeerLeg(-8.0, -11.8, -11.6 + hLeg2 * 3.2, -5.2, -8.8 + hLeg2 * 5.8, 1.0, coatCss, 3.1, 1.65);
        drawDeerLeg(11.6, -10.8, 12.6 + fLeg1 * 3.2, -4.8, 13.4 + fLeg1 * 5.8, 1.0, coatCss, 2.8, 1.6);

        // Sculpted Neck & Head (gracefully arched upright vs grazing down with periodic alert glances)
        const chewCycle = Math.sin(tickVal * 0.038);
        const isGrazingDown = !isWalking && (chewCycle > -0.35 || rainShelter > 0.5);
        const neckStartX = 11.4;
        const neckStartY = -14.2 - bodyBob;
        const headX = isWalking ? 18.6 + Math.sin(walkCycle * 2) * 0.7 : isGrazingDown ? 23.8 : 19.6;
        const headY = isWalking ? -24.4 - bodyBob : isGrazingDown ? -4.0 + Math.sin(tickVal * 0.14) * 0.8 : -23.0 - bodyBob;

        ctx.fillStyle = coatCss;
        ctx.beginPath();
        ctx.moveTo(neckStartX - 3.6, neckStartY - 4.2);
        ctx.quadraticCurveTo((neckStartX + headX) * 0.5 - 1.8, (neckStartY + headY) * 0.5 - 2.2, headX - 2.4, headY - 1.8);
        ctx.lineTo(headX + 1.4, headY + 2.0);
        ctx.quadraticCurveTo((neckStartX + headX) * 0.5 + 3.2, (neckStartY + headY) * 0.5 + 3.2, neckStartX + 2.2, neckStartY + 5.6);
        ctx.closePath();
        ctx.fill();

        // Creamy throat patch running cleanly down front chest
        ctx.fillStyle = creamCss;
        ctx.beginPath();
        ctx.moveTo(headX + 0.6, headY + 1.6);
        ctx.quadraticCurveTo((neckStartX + headX) * 0.5 + 3.1, (neckStartY + headY) * 0.5 + 2.4, neckStartX + 2.0, neckStartY + 5.2);
        ctx.lineTo(neckStartX - 0.5, neckStartY + 4.2);
        ctx.quadraticCurveTo((neckStartX + headX) * 0.5 + 0.9, (neckStartY + headY) * 0.5 + 1.8, headX - 0.8, headY + 1.2);
        ctx.closePath();
        ctx.fill();

        drawSpotRows(bodyBob, 1, 0);
        drawAnatomicalHead(headX, headY, isGrazingDown ? 0.44 : 0.06, false, isWalking, false);

        if (moonRimAlpha > 0.04) {
          ctx.strokeStyle = rimColor;
          ctx.lineWidth = 0.85;
          ctx.beginPath();
          ctx.moveTo(-14, -15.8 - bodyBob);
          ctx.quadraticCurveTo(-3, -19.8 - bodyBob, 10.5, -18.2 - bodyBob);
          ctx.stroke();
        }
      } else if (pose === 'resting') {
        const breath = Math.sin(tickVal * 0.045) * 0.48;
        const bodyGrad = ctx.createLinearGradient(0, -13, 0, -1);
        bodyGrad.addColorStop(0, coatBackCss);
        bodyGrad.addColorStop(0.6, coatCss);
        bodyGrad.addColorStop(1, creamCss);
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.ellipse(0, -6.4 + breath * 0.2, 15.2, 7.2 + breath, 0.04, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-9, -6.2, 7.4, 6.0, -0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = coatShadeCss;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(8, -5);
        ctx.lineTo(14.5, -2.5);
        ctx.lineTo(9.5, -0.8);
        ctx.stroke();

        ctx.fillStyle = coatCss;
        ctx.beginPath();
        ctx.moveTo(8.5, -8.5);
        ctx.quadraticCurveTo(11, -13, 12.2, -16.5 + breath * 0.3);
        ctx.lineTo(15.2, -15.5 + breath * 0.3);
        ctx.quadraticCurveTo(15.5, -9.5, 13.4, -5.2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = creamCss;
        ctx.beginPath();
        ctx.ellipse(14.2, -10.8 + breath * 0.2, 1.4, 4.2, 0.15, 0, Math.PI * 2);
        ctx.fill();

        drawSpotRows(-6.4, 0.92, -0.2);
        drawAnatomicalHead(13.8, -17.5 + breath * 0.3, 0.05, false, true, true);

        if (moonRimAlpha > 0.04) {
          ctx.strokeStyle = rimColor;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(0, -5.5 + breath * 0.2, 13.5, -Math.PI * 0.92, -Math.PI * 0.18);
          ctx.stroke();
        }
      } else if (pose === 'fawn') {
        const breath = Math.sin(tickVal * 0.05 + 1.2) * 0.4;
        const fGrad = ctx.createLinearGradient(0, -9, 0, -1);
        fGrad.addColorStop(0, coatBackCss);
        fGrad.addColorStop(0.65, coatCss);
        fGrad.addColorStop(1, creamCss);
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.ellipse(0, -4.4 + breath * 0.2, 9.8, 5.0 + breath, 0.02, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = spotCol;
        for (let i = -6; i <= 4; i += 2.6) {
          ctx.beginPath();
          ctx.arc(i, -6.0 + breath * 0.2, 0.72, 0, Math.PI * 2);
          ctx.arc(i + 1.0, -4.2 + breath * 0.2, 0.65, 0, Math.PI * 2);
          ctx.fill();
        }

        drawAnatomicalHead(8.4, -7.8 + breath * 0.3, 0.12, true, false, true);

        if (moonRimAlpha > 0.04) {
          ctx.strokeStyle = rimColor;
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.arc(0, -3.8 + breath * 0.2, 8.8, -Math.PI * 0.9, -Math.PI * 0.2);
          ctx.stroke();
        }
      }

      ctx.restore();
    };

    const drawRealisticHare = (
      hx: number,
      hy: number,
      facing: number,
      scale: number,
      tickVal: number,
      moonRimAlpha = 0
    ) => {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.scale(facing * scale, scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const hopHop = Math.max(0, Math.sin(tickVal * 0.05));
      const hopY = hopHop * 3.2;
      const breath = Math.sin(tickVal * 0.045) * 0.35;

      ctx.fillStyle = '#1e1814';
      ctx.strokeStyle = '#1e1814';

      // Rounded soft rabbit body
      ctx.beginPath();
      ctx.ellipse(0, -5 - hopY, 7.5, 5.0 + breath, 0.08, 0, Math.PI * 2);
      ctx.fill();

      // Fluffy tail
      ctx.beginPath();
      ctx.arc(-7.5, -6 - hopY, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#2b231d';
      ctx.fill();
      ctx.fillStyle = '#1e1814';

      // Head
      const headX = 6.2;
      const headY = -7.5 - hopY;
      ctx.beginPath();
      ctx.ellipse(headX, headY, 3.4, 2.6, 0.22, 0, Math.PI * 2);
      ctx.fill();

      // Long twitching ears
      const earTwitch = Math.sin(tickVal * 0.12) * 0.12;
      ctx.beginPath();
      ctx.ellipse(headX - 1.8, headY - 5.5, 1.1, 4.4, -0.22 + earTwitch, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(headX - 0.2, headY - 5.8, 1.0, 4.2, 0.08 - earTwitch, 0, Math.PI * 2);
      ctx.fill();

      // Folded hind feet & front paws
      ctx.beginPath();
      ctx.ellipse(-2.5, -1 - hopY * 0.5, 4.2, 1.6, -0.1, 0, Math.PI * 2);
      ctx.ellipse(4.5, -0.8 - hopY * 0.5, 2.2, 1.2, 0.1, 0, Math.PI * 2);
      ctx.fill();

      if (moonRimAlpha > 0.05) {
        ctx.strokeStyle = `rgba(226, 238, 255, ${Math.min(0.8, moonRimAlpha).toFixed(2)})`;
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.arc(0, -5 - hopY, 6.8, -Math.PI * 0.95, -Math.PI * 0.2);
        ctx.stroke();
      }

      ctx.restore();
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
      orbX: number,
      orbY: number,
      barkColor: string,
      sunBarkColor: string | null,
      frondColor: string,
      rimColor: string,
      sunlightFactor: number
    ) => {
      const wSample = sampleLocalWind(baseX, tSec, windFactor, windSign, freqMult, seed);
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

      // Ringed palm bark leaf-scars along trunk
      ctx.strokeStyle = 'rgba(18, 12, 8, 0.42)';
      ctx.lineWidth = 1.05;
      for (let r = 1; r < segs * 2; r++) {
        const tf = r / (segs * 2);
        const si = Math.min(segs - 1, Math.floor(tf * segs));
        const localF = tf * segs - si;
        const rx = pts[si].x + (pts[si + 1].x - pts[si].x) * localF;
        const ry = pts[si].y + (pts[si + 1].y - pts[si].y) * localF;
        const rw = ((1 - tf * 0.66) * (palmH * 0.056) + 1.8) * 0.48;
        ctx.beginPath();
        ctx.moveTo(rx - rw, ry + 0.6);
        ctx.quadraticCurveTo(rx, ry + 1.8, rx + rw, ry + 0.4);
        ctx.stroke();
      }

      // Textured brown fibrous crown heart
      ctx.fillStyle = '#4e3724';
      ctx.beginPath();
      ctx.ellipse(tip.x, tip.y + 1, 7.2, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();

      const crownScale = palmH * 0.42;
      const totalFronds = Math.max(7, frondCount);
      const frondIndices = Array.from({ length: totalFronds }, (_, i) => i).sort((a, b) => {
        const ya = Math.sin(-Math.PI + (a / Math.max(1, totalFronds - 1)) * Math.PI * 1.24 - 0.14);
        const yb = Math.sin(-Math.PI + (b / Math.max(1, totalFronds - 1)) * Math.PI * 1.24 - 0.14);
        return ya - yb;
      });

      for (const f of frondIndices) {
        const isBack = f % 2 === 0;
        const baseFrondAng = -Math.PI * 1.06 + (f / Math.max(1, totalFronds - 1)) * Math.PI * 1.18;
        const effPalmWind = Math.min(1.4, windFactor);
        const fTurbulence =
          windFactor > 0.015
            ? smoothTurb1d(tSec * (0.72 + effPalmWind * 0.38) * freqMult + seed * 3.1 + f * 1.7) *
              (0.03 + wSample.pocket * effPalmWind * 0.11)
            : 0;
        const windStreamBias = windSign * Math.min(0.28, wSample.bend * 0.2);
        const fAng = baseFrondAng + windStreamBias * 0.45 + fTurbulence;
        const fLen = crownScale * (0.82 + (f % 3) * 0.11);

        const endX = tip.x + Math.cos(fAng) * fLen;
        const endY = tip.y + Math.sin(fAng) * fLen + fLen * (0.34 + (f % 2) * 0.12);
        const midX = (tip.x + endX) * 0.5 + Math.cos(fAng) * fLen * 0.08;
        const midY = (tip.y + endY) * 0.5 - fLen * 0.32;

        const sunFacing = Math.max(0, Math.cos(fAng) * sUx + Math.sin(fAng) * sUy + 0.4);
        const frondLit = Math.min(1, sunlightFactor * (0.45 + sunFacing * 0.85));

        drawTaperedCurve(
          tip.x,
          tip.y,
          midX,
          midY,
          endX,
          endY,
          3.2,
          0.8,
          frondLit > 0.45 && !isBack ? rimColor : frondColor,
          sunlightFactor > 0.25 ? rimColor : null,
          sUx
        );

        // 24 V-pleated dual-sided botanical lanceolate leaflets sweeping gracefully along each frond
        const leafletCount = 24;
        for (let l = 3; l <= leafletCount; l++) {
          const lt = l / leafletCount;
          const u = 1 - lt;
          const px = u * u * tip.x + 2 * u * lt * midX + lt * lt * endX;
          const py = u * u * tip.y + 2 * u * lt * midY + lt * lt * endY;
          const tx = 2 * u * (midX - tip.x) + 2 * lt * (endX - midX);
          const ty = 2 * u * (midY - tip.y) + 2 * lt * (endY - midY);
          const tangAng = Math.atan2(ty, tx);

          const env = Math.sin(Math.pow(lt, 0.88) * Math.PI);
          const bladeLen = env * (fLen * 0.34) + 3.6;
          const bladeHalfW = Math.max(1.0, bladeLen * 0.11);

          const leafJiggle =
            windFactor > 0.015
              ? smoothTurb1d(tSec * (1.45 + effPalmWind * 0.65) + f * 2.3 + l * 0.7) *
                  wSample.pocket *
                  effPalmWind *
                  0.24 +
                wSample.flutter * 0.18
              : 0;

          for (const side of [-1, 1] as const) {
            const sweepAngle =
              tangAng +
              side * (0.68 - lt * 0.26) +
              (side > 0 ? 0.16 * lt : -0.06) +
              windSign * Math.min(0.32, wSample.bend * 0.24) +
              leafJiggle;
            const lTipX = px + Math.cos(sweepAngle) * bladeLen;
            const lTipY = py + Math.sin(sweepAngle) * bladeLen + lt * bladeLen * 0.18;
            const bendMidX = (px + lTipX) * 0.5 + Math.cos(tangAng) * bladeLen * 0.12;
            const bendMidY = (py + lTipY) * 0.5 - (side < 0 ? bladeLen * 0.1 : -bladeLen * 0.05);
            const nx = -Math.sin(sweepAngle) * bladeHalfW;
            const ny = Math.cos(sweepAngle) * bladeHalfW;

            const isLitPinna = !isBack && ((side < 0 && frondLit > 0.24) || (frondLit > 0.55 && lt > 0.22));
            ctx.fillStyle = isLitPinna ? rimColor : frondColor;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.quadraticCurveTo(bendMidX + nx, bendMidY + ny, lTipX, lTipY);
            ctx.quadraticCurveTo(bendMidX - nx * 0.65, bendMidY - ny * 0.65, px, py);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      ctx.restore();
      return tip;
    };

    const renderWeather = () => {
      tick += 1;
      const tSec = tick / 60;
      const tgt = weatherPropsRef.current;

      const baseWind = tgt.windKmh ?? 6;
      const gustExtra =
        tgt.windGustKmh !== null && tgt.windGustKmh !== undefined && tgt.windGustKmh > baseWind
          ? (tgt.windGustKmh - baseWind) * (0.25 + 0.4 * Math.max(0, Math.sin(tSec * 0.42)))
          : 0;
      const tgtWind = baseWind + gustExtra;
      const tgtDirSign =
        tgt.windDirectionDeg !== null && tgt.windDirectionDeg >= 10 && tgt.windDirectionDeg < 190
          ? -1
          : 1;
      const tgtRain = Math.max(0, Math.min(1, tgt.rainIntensity));
      const tgtStorm = tgt.weatherMood === 'storm' ? 1 : tgtRain > 0.8 ? 0.45 : 0;
      const tgtLightning = tgt.hasLightning ? 1 : 0;
      const tgtFog = Math.max(tgt.weatherMood === 'fog' ? 0.78 : 0, Math.min(1, tgt.fogDensity ?? 0));
      const liveHourDec = getDhakaHourDecimal(tgt.timezone || 'Asia/Dhaka');
      const hasSolarWindow =
        Number.isFinite(tgt.sunriseDecimal) &&
        Number.isFinite(tgt.sunsetDecimal) &&
        tgt.sunsetDecimal - tgt.sunriseDecimal >= 4;
      // Smooth continuous day/night transition right across actual local sunrise & sunset twilight
      let tgtDay = tgt.weatherIsDay ? 1 : 0;
      if (hasSolarWindow) {
        if (liveHourDec >= tgt.sunriseDecimal + 0.35 && liveHourDec <= tgt.sunsetDecimal - 0.35) {
          tgtDay = 1;
        } else if (liveHourDec > tgt.sunriseDecimal - 0.55 && liveHourDec < tgt.sunriseDecimal + 0.35) {
          tgtDay = Math.max(0, Math.min(1, (liveHourDec - (tgt.sunriseDecimal - 0.55)) / 0.9));
        } else if (liveHourDec > tgt.sunsetDecimal - 0.35 && liveHourDec < tgt.sunsetDecimal + 0.55) {
          tgtDay = Math.max(0, Math.min(1, 1 - (liveHourDec - (tgt.sunsetDecimal - 0.35)) / 0.9));
        } else {
          tgtDay = 0;
        }
      }
      const tgtCloud =
        tgt.cloudCover !== null
          ? tgt.cloudCover / 100
          : tgt.weatherMood === 'cloudy' || tgtRain > 0.2
            ? 0.82
            : tgtFog > 0.5
              ? 0.6
              : 0.14;
      const tgtTemp = tgt.temperatureC ?? 27;

      const tgtSeason = computeWeatherSeason({
        mood: tgt.weatherMood,
        temperatureC: tgt.temperatureC,
        rainIntensity: tgt.rainIntensity,
      });

      const lerpRate = 0.016;
      sim.windKmh += (tgtWind - sim.windKmh) * lerpRate;
      sim.windDirSign += (tgtDirSign - sim.windDirSign) * 0.02;
      sim.cloudCover += (tgtCloud - sim.cloudCover) * lerpRate;
      sim.rainWeight += (tgtRain - sim.rainWeight) * lerpRate;
      sim.stormWeight += (tgtStorm - sim.stormWeight) * lerpRate;
      sim.lightningWeight += (tgtLightning - sim.lightningWeight) * lerpRate;
      sim.fogWeight += (tgtFog - sim.fogWeight) * lerpRate;
      sim.dayWeight += (tgtDay - sim.dayWeight) * lerpRate;
      sim.tempC += (tgtTemp - sim.tempC) * lerpRate;
      sim.summerWeight += (tgtSeason.summerWeight - sim.summerWeight) * lerpRate;
      sim.monsoonWeight += (tgtSeason.monsoonWeight - sim.monsoonWeight) * lerpRate;
      sim.winterWeight += (tgtSeason.winterWeight - sim.winterWeight) * lerpRate;

      const windSign = sim.windDirSign >= 0 ? 1 : -1;
      const isHotDay = sim.dayWeight > 0.5 && sim.tempC >= 30;
      const effectiveCloud = Math.max(0, Math.min(1, sim.cloudCover));

      const wKmh = sim.windKmh;
      const windFactor =
        wKmh < 4
          ? wKmh * 0.002
          : wKmh < 8
            ? 0.008 + (wKmh - 4) * 0.004
            : wKmh < 20
              ? 0.024 + (wKmh - 8) * 0.014
              : wKmh < 34
                ? 0.192 + (wKmh - 20) * 0.036
                : Math.min(2.3, 0.696 + (wKmh - 34) * 0.065 + sim.stormWeight * 0.45);

      ctx.clearRect(0, 0, width, height);

      const celestial = computeCelestialPosition({
        isDay: sim.dayWeight >= 0.45,
        sunriseDecimal: tgt.sunriseDecimal,
        sunsetDecimal: tgt.sunsetDecimal,
        timezone: tgt.timezone,
      });
      // True horizon-to-horizon arc: rises directly over eastern horizon forest (y=0.835) and sets behind western horizon forest (y=0.835)
      const orbX = width * (0.08 + celestial.progress * 0.84);
      const orbY = height * (0.835 - Math.sin(celestial.progress * Math.PI) * 0.695);

      const driftMag =
        0.22 + sim.windKmh * 0.028 + sim.rainWeight * 0.25 + sim.stormWeight * 0.65;
      const driftPx = windSign * Math.min(1.65, driftMag);

      // Natural undulating forest terrain soil contour (বনের উর্বর শ্যামল মাটি ও বনতল)
      const getSoilY = (x: number) => {
        const baseGround = height * 0.865;
        const wave1 = Math.sin(x * 0.0034 + 0.42) * (height * 0.018);
        const wave2 = Math.cos(x * 0.0076 + 1.25) * (height * 0.011);
        const wave3 = Math.sin(x * 0.02 + 0.35) * 3.2;
        return baseGround + wave1 + wave2 + wave3;
      };

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

      // True 0% -> 100% live cloud cover scaling (clear sky at <=5%, scattered at 25-50%, overcast at 80-100%)
      const cloudBase = Math.max(0, effectiveCloud - 0.04) / 0.96;
      const highAlpha = Math.min(0.84, Math.pow(cloudBase, 0.88) * 0.72) * (1 - sim.fogWeight * 0.7);
      const midAlpha =
        Math.min(0.92, Math.max(0, (cloudBase - 0.08) / 0.92) * 0.82 + sim.rainWeight * 0.14) *
        (1 - sim.fogWeight * 0.68);
      const lowAlpha =
        Math.min(0.96, Math.max(0, (cloudBase - 0.2) / 0.8) * 0.88 + sim.rainWeight * 0.24) *
        (1 - sim.fogWeight * 0.64);

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
      const canopyOcc = Math.max(0, (effectiveCloud - 0.14) / 0.86) * 0.82;

      const rawOcc = Math.min(
        0.98,
        avgDiscOcc * 0.62 + canopyOcc * 0.56 + sim.fogWeight * 0.74 + sim.rainWeight * 0.66
      );
      sunOcclusion += (rawOcc - sunOcclusion) * 0.085;
      const edgeBreakGlow = Math.max(0, 1 - Math.abs(avgDiscOcc - 0.36) * 2.1) * (1 - sim.rainWeight * 0.65);

      // 1. Live Dynamic Time-of-Day & Weather Atmospheric Sky Dome
      const hourDec = liveHourDec;
      const sr = tgt.sunriseDecimal;
      const ss = tgt.sunsetDecimal;
      const dawnF =
        hasSolarWindow && hourDec >= sr - 0.65 && hourDec <= sr + 1.15
          ? hourDec <= sr + 0.1
            ? Math.max(0, (hourDec - (sr - 0.65)) / 0.75)
            : Math.max(0, 1 - (hourDec - (sr + 0.1)) / 1.05)
          : sim.dayWeight > 0.35 && celestial.progress < 0.18
            ? 1 - celestial.progress / 0.18
            : 0;
      const sunsetF =
        hasSolarWindow && hourDec >= ss - 1.15 && hourDec <= ss + 0.65
          ? hourDec <= ss - 0.1
            ? Math.max(0, (hourDec - (ss - 1.15)) / 1.05)
            : Math.max(0, 1 - (hourDec - (ss - 0.1)) / 0.75)
          : sim.dayWeight > 0.35 && celestial.progress > 0.78
            ? (celestial.progress - 0.78) / 0.22
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

      let topRgb = lerpRgb(dayTop, overTop, effectiveCloud * 0.55 + sim.rainWeight * 0.35);
      let midRgb = lerpRgb(dayMid, overMid, effectiveCloud * 0.55 + sim.rainWeight * 0.35);
      let horRgb = lerpRgb(dayHor, overHor, effectiveCloud * 0.55 + sim.rainWeight * 0.35);

      if (twilight > 0.02) {
        topRgb = lerpRgb(topRgb, [36, 66, 130], twilight * 0.75);
        midRgb = lerpRgb(midRgb, [154, 124, 166], twilight * 0.65);
        horRgb = lerpRgb(horRgb, dawnF > sunsetF ? [246, 188, 136] : [242, 148, 98], twilight * 0.88);
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

      // Preserve pre-dawn & post-sunset twilight horizon glow smoothly across day/night transitions
      const twilightWeightBlend = Math.min(1, Math.max(sim.dayWeight, twilight * 0.75));
      topRgb = lerpRgb(nightTop, topRgb, twilightWeightBlend);
      midRgb = lerpRgb(nightMid, midRgb, twilightWeightBlend);
      horRgb = lerpRgb(nightHor, horRgb, Math.min(1, Math.max(sim.dayWeight, twilight * 0.92)));

      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, rgbCss(topRgb));
      skyGrad.addColorStop(0.54, rgbCss(midRgb));
      skyGrad.addColorStop(1, rgbCss(horRgb));
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Sunrise / Sunset Horizon Glow centered right on the East (dawn) or West (sunset) horizon
      if (twilight > 0.03 && sim.stormWeight < 0.8 && sim.fogWeight < 0.75) {
        const horizGlowPower = twilight * (1 - sim.rainWeight * 0.72) * (1 - sim.fogWeight * 0.65) * (1 - sim.stormWeight * 0.8);
        if (horizGlowPower > 0.02) {
          const horizonSunX = dawnF >= sunsetF ? width * 0.09 : width * 0.91;
          const horizonSunY = height * 0.835;
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
            hg.addColorStop(0.62, `rgba(214, 134, 148, ${(0.1 * horizGlowPower).toFixed(3)})`);
            hg.addColorStop(1, 'rgba(214, 134, 148, 0)');
          } else {
            hg.addColorStop(0, `rgba(255, 196, 110, ${(0.56 * horizGlowPower).toFixed(3)})`);
            hg.addColorStop(0.28, `rgba(244, 128, 86, ${(0.32 * horizGlowPower).toFixed(3)})`);
            hg.addColorStop(0.62, `rgba(176, 86, 116, ${(0.12 * horizGlowPower).toFixed(3)})`);
            hg.addColorStop(1, 'rgba(176, 86, 116, 0)');
          }
          ctx.fillStyle = hg;
          ctx.fillRect(0, 0, width, height);
        }
      }

      // 1b. Screen-Wide Directional Sky & Atmospheric Light Scattering following (orbX, orbY)
      const skyDayLight = sim.dayWeight * Math.max(0.08, 1 - sunOcclusion * 0.85) * (1 - sim.rainWeight * 0.72) * (1 - sim.fogWeight * 0.7);
      const skyNightLight = (1 - sim.dayWeight) * Math.max(0.08, 1 - effectiveCloud * 0.78) * (1 - sim.rainWeight * 0.75);
      if (skyDayLight > 0.03 || skyNightLight > 0.03) {
        const farCornerX = orbX < width * 0.5 ? width : 0;
        // Directional gradient across the screen: brighter sunlit/moonlit side -> deeper away-side sky
        const dirSkyWash = ctx.createLinearGradient(orbX, orbY * 0.7, farCornerX, height * 0.85);
        if (sim.dayWeight >= 0.45) {
          const warmCol = twilight > 0.3 ? '255, 198, 130' : '255, 246, 212';
          dirSkyWash.addColorStop(0, `rgba(${warmCol}, ${(0.24 * skyDayLight).toFixed(3)})`);
          dirSkyWash.addColorStop(0.45, `rgba(${warmCol}, ${(0.07 * skyDayLight).toFixed(3)})`);
          dirSkyWash.addColorStop(1, `rgba(14, 28, 52, ${(0.18 * skyDayLight).toFixed(3)})`);
        } else {
          dirSkyWash.addColorStop(0, `rgba(186, 218, 255, ${(0.16 * skyNightLight).toFixed(3)})`);
          dirSkyWash.addColorStop(0.5, `rgba(120, 162, 220, ${(0.04 * skyNightLight).toFixed(3)})`);
          dirSkyWash.addColorStop(1, `rgba(4, 9, 22, ${(0.18 * skyNightLight).toFixed(3)})`);
        }
        ctx.fillStyle = dirSkyWash;
        ctx.fillRect(0, 0, width, height);
      }

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

      // 3. Realistic Multi-Scattering Sun / Moon BEHIND Drifting Clouds (warms to crimson-gold at sunrise & sunset)
      const sunStrength = sim.dayWeight * Math.max(0.03, 1 - sunOcclusion * 0.96) * (1 - sim.stormWeight * 0.88);
      if (sunStrength > 0.015) {
        const sunWarm = Math.min(1, twilight * 1.15);
        const wideBloom = ctx.createRadialGradient(
          orbX,
          orbY,
          4,
          orbX,
          orbY,
          Math.max(width, height) * 0.45
        );
        const coreCenterRgb = lerpRgb([255, 253, 245], [255, 236, 198], sunWarm);
        const haloInnerRgb = lerpRgb([255, 248, 218], [255, 196, 118], sunWarm);
        const haloMidRgb = lerpRgb([254, 232, 165], [248, 146, 86], sunWarm);
        const haloOuterRgb = lerpRgb([253, 214, 138], [218, 102, 76], sunWarm);
        wideBloom.addColorStop(0, rgbCss(coreCenterRgb, 0.92 * sunStrength));
        wideBloom.addColorStop(0.045, rgbCss(haloInnerRgb, 0.68 * sunStrength));
        wideBloom.addColorStop(0.18, rgbCss(haloMidRgb, 0.26 * sunStrength));
        wideBloom.addColorStop(0.46, rgbCss(haloOuterRgb, 0.08 * sunStrength));
        wideBloom.addColorStop(1, rgbCss(haloOuterRgb, 0));
        ctx.fillStyle = wideBloom;
        ctx.fillRect(0, 0, width, height);

        const coreR = 9 + sunStrength * 3.5 + sunWarm * 3.2;
        const coreGrad = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, coreR * 2.5);
        coreGrad.addColorStop(0, rgbCss(lerpRgb([255, 255, 255], [255, 242, 206], sunWarm), Math.min(1, sunStrength * 1.2)));
        coreGrad.addColorStop(0.38, rgbCss(lerpRgb([255, 252, 236], [255, 210, 142], sunWarm), 0.9 * sunStrength));
        coreGrad.addColorStop(1, rgbCss(haloMidRgb, 0));
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(orbX, orbY, coreR * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3b. Realistic Weather-Reactive Moon (Synodic Phase, Lunar Maria, Multi-Ring Atmosphere Glow, Cloud-Cover Scaled)
      const moonNightFactor = Math.max(0, 1 - sim.dayWeight);
      const cloudClearMoon = Math.max(0.06, 1 - Math.pow(Math.min(1, sim.cloudCover / 82), 1.35));
      const rainClearMoon = Math.max(0.06, 1 - Math.pow(sim.rainWeight, 0.85));
      const effectiveMoonVis =
        moonNightFactor * cloudClearMoon * rainClearMoon * Math.max(0.12, 1 - sunOcclusion * 0.88);

      if (effectiveMoonVis > 0.02) {
        const moonRadius = Math.max(16, Math.min(25, width * 0.023));
        const moonAlpha = Math.min(1, effectiveMoonVis * 1.25);

        // Broad Lunar Corona & Ambient Night Halo
        const haloR = Math.max(width, height) * 0.42;
        const moonHalo = ctx.createRadialGradient(orbX, orbY, moonRadius * 0.7, orbX, orbY, haloR);
        moonHalo.addColorStop(0, `rgba(241, 248, 255, ${(0.46 * moonAlpha).toFixed(3)})`);
        moonHalo.addColorStop(0.14, `rgba(203, 224, 250, ${(0.19 * moonAlpha).toFixed(3)})`);
        moonHalo.addColorStop(0.38, `rgba(148, 185, 235, ${(0.05 * moonAlpha).toFixed(3)})`);
        moonHalo.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = moonHalo;
        ctx.fillRect(0, 0, width, height);

        // Inner Pearl Ring
        const innerHalo = ctx.createRadialGradient(orbX, orbY, moonRadius * 0.4, orbX, orbY, moonRadius * 3.6);
        innerHalo.addColorStop(0, `rgba(255, 255, 255, ${(0.82 * moonAlpha).toFixed(3)})`);
        innerHalo.addColorStop(0.42, `rgba(224, 238, 255, ${(0.36 * moonAlpha).toFixed(3)})`);
        innerHalo.addColorStop(1, 'rgba(224, 238, 255, 0)');
        ctx.fillStyle = innerHalo;
        ctx.beginPath();
        ctx.arc(orbX, orbY, moonRadius * 3.6, 0, Math.PI * 2);
        ctx.fill();

        // Moon Disc with Synodic Lunar Phase & Maria
        const phaseFraction = getMoonPhaseFraction();
        ctx.save();
        ctx.translate(orbX, orbY);

        // Base luminous moon disc
        ctx.beginPath();
        ctx.arc(0, 0, moonRadius, 0, Math.PI * 2);
        const moonGrad = ctx.createRadialGradient(-moonRadius * 0.25, -moonRadius * 0.25, 2, 0, 0, moonRadius);
        moonGrad.addColorStop(0, `rgba(255, 255, 255, ${(0.98 * moonAlpha).toFixed(3)})`);
        moonGrad.addColorStop(0.65, `rgba(241, 245, 249, ${(0.94 * moonAlpha).toFixed(3)})`);
        moonGrad.addColorStop(1, `rgba(203, 213, 225, ${(0.88 * moonAlpha).toFixed(3)})`);
        ctx.fillStyle = moonGrad;
        ctx.fill();

        // Subtle soft lunar maria (the dark plains/craters of the moon)
        ctx.fillStyle = `rgba(148, 163, 184, ${(0.22 * moonAlpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(-moonRadius * 0.32, -moonRadius * 0.15, moonRadius * 0.32, 0, Math.PI * 2);
        ctx.arc(moonRadius * 0.18, -moonRadius * 0.28, moonRadius * 0.26, 0, Math.PI * 2);
        ctx.arc(-moonRadius * 0.12, moonRadius * 0.26, moonRadius * 0.38, 0, Math.PI * 2);
        ctx.arc(moonRadius * 0.35, moonRadius * 0.12, moonRadius * 0.24, 0, Math.PI * 2);
        ctx.fill();

        // Synodic Phase Shadow
        const phaseDistFromFull = Math.abs(phaseFraction - 0.5);
        if (phaseDistFromFull > 0.05) {
          const isWaxing = phaseFraction < 0.5;
          const k = Math.cos(phaseFraction * Math.PI * 2);
          ctx.fillStyle = `rgba(10, 16, 28, ${(0.9 * moonAlpha).toFixed(3)})`;
          ctx.beginPath();
          if (isWaxing) {
            ctx.arc(0, 0, moonRadius + 0.5, Math.PI * 0.5, Math.PI * 1.5, false);
            ctx.ellipse(0, 0, Math.abs(k) * moonRadius + 0.2, moonRadius + 0.5, 0, Math.PI * 1.5, Math.PI * 0.5, k > 0);
          } else {
            ctx.arc(0, 0, moonRadius + 0.5, -Math.PI * 0.5, Math.PI * 0.5, false);
            ctx.ellipse(0, 0, Math.abs(k) * moonRadius + 0.2, moonRadius + 0.5, 0, Math.PI * 0.5, -Math.PI * 0.5, k < 0);
          }
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();
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

      // 4b. Thunderstorm Lightning ONLY when live city weather has actual thunderstorm (WMO >= 95)
      if (sim.lightningWeight > 0.45 && !prefersReducedMotion) {
        if (tick >= nextStormFlashTick) {
          distantStormFlash = 0.65 * Math.max(sim.lightningWeight, sim.rainWeight);
          nextStormFlashTick = tick + 520 + Math.floor(Math.random() * 620);
          // Generate subtle in-cloud distant fork on stronger storm cells
          const bx = width * (0.15 + Math.random() * 0.7);
          let by = 0;
          const pts: Array<{ x: number; y: number }> = [{ x: bx, y: 0 }];
          let curX = bx;
          const targetY = height * (0.28 + Math.random() * 0.18);
          while (by < targetY) {
            by += 10 + Math.random() * 14;
            curX += (Math.random() - 0.5) * 26;
            pts.push({ x: curX, y: by });
          }
          stormBolt = pts;
          stormAudio.triggerThunder(0.76 + sim.rainWeight * 0.28, 'distant');
        }
        if (distantStormFlash > 0.01) {
          ctx.fillStyle = `rgba(186, 230, 253, ${(distantStormFlash * 0.16).toFixed(3)})`;
          ctx.fillRect(0, 0, width, height * 0.42);
          if (stormBolt && distantStormFlash > 0.24) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(stormBolt[0].x, stormBolt[0].y);
            for (let b = 1; b < stormBolt.length; b++) {
              ctx.lineTo(stormBolt[b].x, stormBolt[b].y);
            }
            ctx.strokeStyle = `rgba(224, 242, 254, ${(distantStormFlash * 0.62).toFixed(3)})`;
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.restore();
          }
          distantStormFlash *= 0.91;
          if (distantStormFlash <= 0.01) stormBolt = null;
        }
      }

      // 5. Realistic Directional Glow & Volumetric Rays Radiating Across the Screen from (orbX, orbY)
      if ((sim.dayWeight > 0.25 || effectiveMoonVis > 0.24) && sim.fogWeight < 0.75 && sim.stormWeight < 0.88) {
        const dayScatter =
          sim.dayWeight *
          (0.18 + edgeBreakGlow * 0.72 + (1 - sunOcclusion) * 0.34) *
          (1 - sim.rainWeight * 0.68);
        const nightScatter = effectiveMoonVis * (1 - sim.dayWeight) * (1 - sim.rainWeight * 0.72) * 0.52;
        const scatterPower = Math.max(dayScatter, nightScatter);

        if (scatterPower > 0.04) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const isSunActive = sim.dayWeight >= 0.42;
          const mieGlow = ctx.createRadialGradient(
            orbX,
            orbY,
            12,
            orbX,
            orbY,
            Math.max(width, height) * 0.42
          );
          if (isSunActive) {
            mieGlow.addColorStop(0, `rgba(255, 250, 232, ${(0.34 * scatterPower).toFixed(3)})`);
            mieGlow.addColorStop(0.38, `rgba(254, 232, 178, ${(0.14 * scatterPower).toFixed(3)})`);
            mieGlow.addColorStop(1, 'rgba(254, 232, 178, 0)');
          } else {
            mieGlow.addColorStop(0, `rgba(218, 236, 255, ${(0.22 * scatterPower).toFixed(3)})`);
            mieGlow.addColorStop(0.45, `rgba(170, 206, 248, ${(0.08 * scatterPower).toFixed(3)})`);
            mieGlow.addColorStop(1, 'rgba(170, 206, 248, 0)');
          }
          ctx.fillStyle = mieGlow;
          ctx.fillRect(0, 0, width, height);

          // Subtle directional shafts angling across the sky & forest away from (orbX, orbY)
          const shaftTrigger = isSunActive ? Math.max(sunOcclusion * 0.9, (1 - sunOcclusion) * 0.55) : effectiveMoonVis * 0.6;
          if (shaftTrigger > 0.14) {
            const targetGroundX = width * (1 - celestial.progress * 0.85) * 0.8 + width * 0.1;
            const rayBaseA = Math.atan2(height * 0.88 - orbY, targetGroundX - orbX);
            const rayAlpha = isSunActive
              ? (0.028 + 0.052 * edgeBreakGlow + (1 - sunOcclusion) * 0.018) * sim.dayWeight * (1 - sim.rainWeight * 0.72)
              : 0.024 * effectiveMoonVis * (1 - sim.rainWeight * 0.75);
            for (let r = 0; r < 6; r++) {
              const ang = rayBaseA + (r - 2.5) * 0.16 + Math.sin(tick * 0.006 + r * 1.4) * 0.018;
              const len = Math.max(width, height) * 0.92;
              const bx = orbX + Math.cos(ang) * len;
              const by = orbY + Math.sin(ang) * len;
              const rg = ctx.createLinearGradient(orbX, orbY, bx, by);
              const rayCol = isSunActive
                ? twilight > 0.35
                  ? '255, 214, 152'
                  : '255, 249, 214'
                : '206, 228, 255';
              rg.addColorStop(0, `rgba(${rayCol}, ${rayAlpha.toFixed(3)})`);
              rg.addColorStop(0.58, `rgba(${rayCol}, ${(rayAlpha * 0.34).toFixed(3)})`);
              rg.addColorStop(1, `rgba(${rayCol}, 0)`);
              ctx.fillStyle = rg;
              ctx.beginPath();
              ctx.moveTo(orbX - 16, orbY);
              ctx.lineTo(orbX + 16, orbY);
              ctx.lineTo(bx + 92, by);
              ctx.lineTo(bx - 92, by);
              ctx.closePath();
              ctx.fill();
            }
          }
          ctx.restore();
        }
      }

      // 6. High/Treeline Realistic Soaring Birds (strictly grounded when raining, stormy, or night)
      const isBirdRainShelter =
        sim.rainWeight > 0.05 || sim.stormWeight > 0.14 || windFactor > 0.92;
      const targetShelterBlend = isBirdRainShelter ? 1 : 0;
      rainShelterBlend += (targetShelterBlend - rainShelterBlend) * 0.05;

      const isEveningBirdCutoff = sim.dayWeight < 0.50 || twilight > 0.14;
      const activeBirdCount =
        isEveningBirdCutoff || isBirdRainShelter || rainShelterBlend > 0.45
          ? 0
          : sim.fogWeight > 0.5
            ? 2
            : isHotDay
              ? 4
              : 8;

      if (activeBirdCount > 0) {
        const birdAlpha =
          0.72 * sim.dayWeight * (1 - sim.fogWeight * 0.45) * Math.max(0, 1 - rainShelterBlend * 2.2);
        const birdTone =
          twilight > 0.4 ? `rgba(38, 28, 36, ${birdAlpha.toFixed(2)})` : `rgba(22, 32, 46, ${birdAlpha.toFixed(2)})`;
        for (let i = 0; i < activeBirdCount; i++) {
          const b = flyingBirds[i];
          if (!prefersReducedMotion) {
            const speedMult = isHotDay ? 0.78 : 1.0;
            b.x += b.vxBase * speedMult + windSign * windFactor * 0.42;
            b.y += Math.sin(tick * 0.018 + b.glideTick) * 0.18;
            b.glideTick += 1;
            const gliding = (isHotDay || i % 3 === 1) && b.glideTick % 180 > 85;
            if (!gliding) b.wingPhase += b.wingSpeed;
            if (b.x > width + 40) b.x = -40;
            if (b.x < -40) b.x = width + 40;
          }
          const gliding = (isHotDay || i % 3 === 1) && b.glideTick % 180 > 85;
          const facing = b.vxBase >= 0 ? 1 : -1;
          drawRealisticBird(b.x, b.y, facing, b.span / 7.5, b.wingPhase, gliding, false, birdTone);
        }
      }

      // Compute directional sunlight across ground foliage
      const sunlightFactor =
        sim.dayWeight *
        Math.max(0, 1 - sunOcclusion * 0.96) *
        (1 - sim.rainWeight * 0.84) *
        (1 - sim.fogWeight * 0.85);

      // 7. Far Horizon Atmospheric Grove Ridge (lit directionally from orbX/orbY)
      if (nightVis > 0.08) {
        // 7a. Ultra-distant nocturnal forest line stretching far into the horizon
        const ultraDeepBaseY = height * 0.785;
        const ultraDeepLit = lerpRgb([14, 26, 42], horRgb, 0.52);
        const ultraDeepShade = lerpRgb([6, 12, 20], horRgb, 0.25);
        const ultraGrad = ctx.createRadialGradient(orbX, ultraDeepBaseY - 25, 20, orbX, ultraDeepBaseY, width * 0.78);
        ultraGrad.addColorStop(0, rgbCss(ultraDeepLit, 0.68 * nightVis));
        ultraGrad.addColorStop(1, rgbCss(ultraDeepShade, 0.72 * nightVis));
        ctx.fillStyle = ultraGrad;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 36; x += 18) {
          const deepCrowns =
            Math.sin(x * 0.007 + 1.2) * 22 +
            Math.sin(x * 0.021 + 0.4) * 11 +
            Math.sin(x * 0.052) * 5;
          ctx.lineTo(x, ultraDeepBaseY - Math.max(0, deepCrowns));
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // 7b. Secondary nocturnal grove ridge with directional silver moonlit rim
        const midDeepBaseY = height * 0.825;
        const midDeepLit = lerpRgb([18, 32, 46], horRgb, 0.44);
        const midDeepShade = lerpRgb([8, 16, 24], horRgb, 0.22);
        const midRidgeGrad = ctx.createRadialGradient(orbX, midDeepBaseY - 15, 16, orbX, midDeepBaseY, width * 0.72);
        midRidgeGrad.addColorStop(0, rgbCss(midDeepLit, 0.8 * nightVis));
        midRidgeGrad.addColorStop(1, rgbCss(midDeepShade, 0.84 * nightVis));
        ctx.fillStyle = midRidgeGrad;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 36; x += 16) {
          const groveCrowns =
            Math.sin(x * 0.009 + 2.7) * 18 +
            Math.sin(x * 0.031 + 1.1) * 9 +
            Math.cos(x * 0.068) * 4;
          ctx.lineTo(x, midDeepBaseY - Math.max(0, groveCrowns));
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // Directional moonlit silver sheen stronger near orbX side of night ridge
        if (effectiveMoonVis > 0.12) {
          const moonRimGrad = ctx.createRadialGradient(orbX, midDeepBaseY, 10, orbX, midDeepBaseY, width * 0.65);
          moonRimGrad.addColorStop(0, `rgba(220, 234, 255, ${(0.24 * effectiveMoonVis * nightVis).toFixed(3)})`);
          moonRimGrad.addColorStop(0.6, `rgba(180, 204, 236, ${(0.1 * effectiveMoonVis * nightVis).toFixed(3)})`);
          moonRimGrad.addColorStop(1, 'rgba(148, 174, 206, 0.02)');
          ctx.strokeStyle = moonRimGrad;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let x = 0; x <= width + 36; x += 16) {
            const groveCrowns =
              Math.sin(x * 0.009 + 2.7) * 18 +
              Math.sin(x * 0.031 + 1.1) * 9 +
              Math.cos(x * 0.068) * 4;
            const gy = midDeepBaseY - Math.max(0, groveCrowns);
            if (x === 0) ctx.moveTo(x, gy);
            else ctx.lineTo(x, gy);
          }
          ctx.stroke();
        }
      }

      // 7c. Far Horizon Atmospheric Grove Ridge (sunlit side warmer/brighter, away side cooler shadow)
      const farBaseY = height * 0.855;
      const farColor = lerpRgb(
        [30, 46, 44],
        lerpRgb(horRgb, sunlightFactor > 0.25 ? [44, 68, 42] : [18, 28, 36], 0.44),
        0.48 + sim.fogWeight * 0.4 + sunOcclusion * 0.22
      );
      const farLitSide = lerpRgb(
        farColor,
        twilight > 0.35 ? [96, 84, 52] : sunlightFactor > 0.2 ? [68, 102, 54] : [36, 52, 68],
        Math.max(sunlightFactor * 0.65, effectiveMoonVis * 0.35)
      );
      const farShadeSide = lerpRgb(farColor, [12, 20, 26], Math.max(sunlightFactor * 0.38, effectiveMoonVis * 0.25));
      const farRidgeGrad = ctx.createRadialGradient(orbX, farBaseY - 12, 18, orbX, farBaseY, width * 0.72);
      farRidgeGrad.addColorStop(0, rgbCss(farLitSide, 0.88));
      farRidgeGrad.addColorStop(1, rgbCss(farShadeSide, 0.90));
      ctx.fillStyle = farRidgeGrad;
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

      // Sunlit/moonlit distant jungle canopy rim
      if (sunlightFactor > 0.14 || effectiveMoonVis > 0.18) {
        const farRimA = sunlightFactor > 0.14 ? 0.24 * sunlightFactor : 0.16 * effectiveMoonVis;
        const farRimGrad = ctx.createRadialGradient(orbX, farBaseY, 10, orbX, farBaseY, width * 0.6);
        farRimGrad.addColorStop(
          0,
          sunlightFactor > 0.14
            ? `rgba(${twilight > 0.35 ? '248, 198, 112' : '188, 224, 126'}, ${farRimA.toFixed(3)})`
            : `rgba(198, 222, 248, ${farRimA.toFixed(3)})`
        );
        farRimGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.strokeStyle = farRimGrad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let x = 0; x <= width + 32; x += 24) {
          const ridge =
            Math.sin(x * 0.0085 + 0.5) * 16 +
            Math.sin(x * 0.023 + 1.8) * 9 +
            Math.cos(x * 0.055) * 5;
          const ry = farBaseY - Math.max(0, ridge);
          if (x === 0) ctx.moveTo(x, ry);
          else ctx.lineTo(x, ry);
        }
        ctx.stroke();
      }

      // 7b. Mid-Distance Lush Hazy Village Trees (directional sunlit & moonlit crown illumination)
      const midBarkCss = rgbCss(lerpRgb(farColor, [24, 34, 34], 0.45), 0.88);
      const midSunBarkCss =
        sunlightFactor > 0.14
          ? rgbCss(twilight > 0.36 ? [174, 132, 76] : [118, 124, 78], Math.min(0.45, sunlightFactor * 0.48))
          : effectiveMoonVis > 0.18
            ? rgbCss([158, 186, 218], Math.min(0.32, effectiveMoonVis * 0.34))
            : null;
      const activeRimSprites = twilight > 0.36 ? sprigGoldenRim : sprigSunRim;
      const activeLitSprites = twilight > 0.36 ? sprigGolden : sprigSun;
      treePerchAnchors.length = 0;

      for (const mt of midTrees) {
        const mx = mt.xRatio * width;
        const my = getSoilY(mx) + 2;
        const mWind = sampleLocalWind(mx, tSec, windFactor, windSign, mt.freqMult, mt.seed);
        const mLen = Math.min(height * 0.22, 165) * mt.scale;
        const flex = windSign * Math.min(0.13, mWind.bend * 0.088);
        const mTopX = mx + Math.sin(mt.lean + flex) * mLen;
        const mTopY = my - Math.cos(mt.lean + flex) * mLen;
        const mToSunX = orbX - mTopX;
        const mToSunY = orbY - mTopY;
        const mToSunMag = Math.hypot(mToSunX, mToSunY) || 1;
        const mSunUx = mToSunX / mToSunMag;
        const mSunUy = mToSunY / mToSunMag;

        ctx.save();
        drawTaperedCurve(
          mx,
          my,
          (mx + mTopX) * 0.5,
          (my + mTopY) * 0.5,
          mTopX,
          mTopY,
          9.5 * mt.scale,
          3.4 * mt.scale,
          midBarkCss,
          midSunBarkCss,
          mSunUx
        );

        const idx = Math.floor(mt.seed) % sprigCool.length;
        const mCrown = 114 * mt.scale;
        ctx.translate(mTopX, mTopY);
        ctx.rotate(flex * 0.55 + mWind.flutter * 0.24 + Math.sin(tSec * 1.42 + mt.seed) * Math.min(0.12, windFactor * 0.08));
        const midBaseAlpha = 0.78 * (1 - sim.fogWeight * 0.3) * (1 - sim.winterWeight * 0.28);
        ctx.globalAlpha = midBaseAlpha;
        // Shaded body shifted slightly away from the light source
        ctx.drawImage(
          sprigCool[idx],
          -mCrown * 0.58 - mSunUx * 2.5,
          -mCrown * 0.54,
          mCrown * 1.16,
          mCrown * 0.94
        );

        if (sim.monsoonWeight > 0.15) {
          ctx.globalAlpha = Math.min(0.68, sim.monsoonWeight * 0.65) * (1 - sim.fogWeight * 0.28);
          ctx.drawImage(sprigMonsoon[idx], -mCrown * 0.58, -mCrown * 0.54, mCrown * 1.16, mCrown * 0.94);
        }
        if (sim.winterWeight > 0.15) {
          ctx.globalAlpha = Math.min(0.74, sim.winterWeight * 0.72) * (1 - sim.fogWeight * 0.22);
          ctx.drawImage(sprigWinter[idx], -mCrown * 0.58, -mCrown * 0.54, mCrown * 1.16, mCrown * 0.94);
        }

        if (sunlightFactor > 0.08) {
          ctx.globalAlpha =
            Math.min(0.88, sunlightFactor * 0.95) *
            (1 - sim.fogWeight * 0.4) *
            (1 - sim.winterWeight * 0.38);
          ctx.drawImage(
            activeLitSprites[idx],
            -mCrown * 0.58 + mSunUx * 4.5,
            -mCrown * 0.54 + mSunUy * 3.0,
            mCrown * 1.16,
            mCrown * 0.94
          );
          ctx.globalAlpha = Math.min(0.65, sunlightFactor * 0.7) * (1 - sim.fogWeight * 0.45);
          ctx.drawImage(
            activeRimSprites[idx],
            -mCrown * 0.58 + mSunUx * 6.5,
            -mCrown * 0.54 + mSunUy * 4.0,
            mCrown * 1.16,
            mCrown * 0.94
          );
        } else if (effectiveMoonVis > 0.16 && sim.dayWeight < 0.45) {
          ctx.globalAlpha = Math.min(0.45, effectiveMoonVis * 0.5) * (1 - sim.fogWeight * 0.4);
          ctx.drawImage(
            sprigMoonRim[idx],
            -mCrown * 0.58 + mSunUx * 5.0,
            -mCrown * 0.54 + mSunUy * 3.2,
            mCrown * 1.16,
            mCrown * 0.94
          );
        }
        ctx.restore();
        treePerchAnchors.push({
          x: mTopX,
          y: mTopY - mCrown * 0.28,
          shelterX: mTopX,
          shelterY: mTopY - mCrown * 0.04,
          isLeafy: false,
        });
      }

      // Helper for real cast ground shadow projection away from (orbX, orbY)
      const getShadowProj = (baseX: number, baseY: number) => {
        const dx = baseX - orbX;
        const dy = Math.max(height * 0.16, baseY - orbY);
        return Math.max(-2.1, Math.min(2.1, dx / dy));
      };

      // 7d. Visible Forest Earth, Loamy Soil Ground, Cast Tree Shadows & Reflective Rain Puddles
      {
        const wetness = Math.min(1, sim.rainWeight * 1.35 + sim.monsoonWeight * 0.22);
        const soilTopDay: RGB = lerpRgb([36, 48, 28], [24, 30, 22], wetness * 0.72);
        const soilTopNight: RGB = lerpRgb([14, 24, 19], [10, 16, 17], wetness * 0.7);
        const soilMidDay: RGB = lerpRgb([46, 33, 22], [25, 19, 15], wetness * 0.78);
        const soilMidNight: RGB = lerpRgb([17, 14, 12], [10, 11, 13], wetness * 0.75);
        const soilDeepDay: RGB = lerpRgb([28, 20, 14], [14, 12, 11], wetness * 0.8);
        const soilDeepNight: RGB = lerpRgb([10, 9, 9], [6, 8, 10], wetness * 0.75);

        const topC = lerpRgb(soilTopNight, soilTopDay, sim.dayWeight * (1 - sunOcclusion * 0.38));
        const midC = lerpRgb(soilMidNight, soilMidDay, sim.dayWeight * (1 - sunOcclusion * 0.42));
        const deepC = lerpRgb(soilDeepNight, soilDeepDay, sim.dayWeight * (1 - sunOcclusion * 0.42));

        const soilMinY = height * 0.855;
        const soilGrad = ctx.createLinearGradient(0, soilMinY, 0, height);
        soilGrad.addColorStop(0, rgbCss(topC, 0.98));
        soilGrad.addColorStop(0.32, rgbCss(midC, 0.99));
        soilGrad.addColorStop(1, rgbCss(deepC, 1));

        ctx.fillStyle = soilGrad;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 24; x += 16) {
          ctx.lineTo(x, getSoilY(x) - 3);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // Directional sunlit/moonlit ground patch highlight on clearing earth near orbX side
        const floorLightAlpha =
          sim.dayWeight > 0.4
            ? sunlightFactor * 0.16 * (1 - wetness * 0.4)
            : effectiveMoonVis * 0.12 * (1 - wetness * 0.3);
        if (floorLightAlpha > 0.015) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(0, height);
          for (let x = 0; x <= width + 24; x += 16) {
            ctx.lineTo(x, getSoilY(x) - 3);
          }
          ctx.lineTo(width, height);
          ctx.closePath();
          ctx.clip();

          const floorSpotX = width * 0.5 + (orbX - width * 0.5) * 0.75;
          const floorSpotGrad = ctx.createRadialGradient(
            floorSpotX,
            height * 0.89,
            10,
            floorSpotX,
            height * 0.93,
            width * 0.55
          );
          const floorLightRgb =
            sim.dayWeight > 0.4
              ? twilight > 0.35
                ? '242, 184, 96'
                : '176, 212, 112'
              : '164, 202, 242';
          floorSpotGrad.addColorStop(0, `rgba(${floorLightRgb}, ${floorLightAlpha.toFixed(3)})`);
          floorSpotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = floorSpotGrad;
          ctx.fillRect(0, soilMinY - 12, width, height - soilMinY + 12);

          // Cast directional trunk + canopy ground shadows across the forest earth away from Sun/Moon
          const shadowStrength =
            sim.dayWeight > 0.4 ? Math.min(0.46, sunlightFactor * 0.52) : Math.min(0.32, effectiveMoonVis * 0.36);
          if (shadowStrength > 0.04) {
            for (const tree of leafyTrees) {
              const tx = tree.xRatio * width;
              const ty = getSoilY(tx) + 12;
              const proj = getShadowProj(tx, ty);
              const tLen = Math.min(height * 0.25, 195) * tree.scale;
              const endX = tx + proj * (tLen * 0.52);
              const endY = Math.min(height - 4, ty + Math.max(8, Math.abs(proj) * 16 + 10));

              ctx.strokeStyle = `rgba(4, 8, 10, ${(shadowStrength * 0.72).toFixed(3)})`;
              ctx.lineWidth = 8.5 * tree.scale;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(tx, ty);
              ctx.lineTo(endX, endY);
              ctx.stroke();

              // Canopy ground shadow pool
              const canopyRx = (36 + Math.abs(proj) * 24) * tree.scale;
              const canopyRy = Math.max(6.5, 10.5 * tree.scale);
              ctx.fillStyle = `rgba(4, 8, 10, ${(shadowStrength * 0.65).toFixed(3)})`;
              ctx.beginPath();
              ctx.ellipse(endX + proj * 14, endY, canopyRx, canopyRy, proj * 0.08, 0, Math.PI * 2);
              ctx.fill();
            }

            for (const palm of palmTrees) {
              const px = palm.xRatio * width;
              const py = getSoilY(px) + 8;
              const proj = getShadowProj(px, py);
              const pLen = Math.min(height * 0.4, Math.max(135, height * palm.heightRatio));
              const endX = px + proj * (pLen * 0.46);
              const endY = Math.min(height - 4, py + Math.max(8, Math.abs(proj) * 14 + 9));

              ctx.strokeStyle = `rgba(4, 8, 10, ${(shadowStrength * 0.62).toFixed(3)})`;
              ctx.lineWidth = 5.5;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(endX, endY);
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        // Subtle rim glow along the crest of the forest earth weighted toward orbX
        const crestAlpha =
          sim.dayWeight > 0.4
            ? 0.16 * sunlightFactor + 0.08 * wetness
            : 0.2 * effectiveMoonVis + 0.07 * wetness;
        if (crestAlpha > 0.02) {
          const crestGrad = ctx.createRadialGradient(orbX, height * 0.86, 15, orbX, height * 0.86, width * 0.65);
          crestGrad.addColorStop(
            0,
            sim.dayWeight > 0.4
              ? `rgba(${twilight > 0.35 ? '238, 186, 102' : '192, 218, 142'}, ${crestAlpha.toFixed(3)})`
              : `rgba(176, 210, 242, ${crestAlpha.toFixed(3)})`
          );
          crestGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.strokeStyle = crestGrad;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let x = 0; x <= width + 24; x += 18) {
            const sy = getSoilY(x) - 3;
            if (x === 0) ctx.moveTo(x, sy);
            else ctx.lineTo(x, sy);
          }
          ctx.stroke();
        }

        // Organic earth pebbles, damp mud ridges, and fallen leaves along the visible forest floor
        ctx.save();
        for (let sx = 18; sx < width - 12; sx += 29) {
          const baseY = getSoilY(sx);
          const spanH = Math.max(12, height - baseY);
          const py = baseY + 6 + ((sx * 19) % Math.max(10, Math.floor(spanH * 0.78)));
          const pebbleAlpha = (0.16 + 0.12 * (1 - wetness)) * (0.65 + sim.dayWeight * 0.35);
          ctx.fillStyle =
            (sx % 58) < 29
              ? `rgba(74, 54, 38, ${pebbleAlpha.toFixed(3)})`
              : `rgba(42, 62, 34, ${(pebbleAlpha * 0.85).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(sx, py, 2.4 + (sx % 3), 1.05 + (sx % 2) * 0.4, (sx % 5) * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Glossy Rainwater Puddles on the clearing soil (specular glint shifted toward orbX)
        const puddleVis = Math.max(sim.rainWeight, sim.monsoonWeight * 0.32);
        if (puddleVis > 0.04) {
          const pDefs = [
            { rxRatio: 0.22, rw: 58, rh: 7.5, yOff: 0.46 },
            { rxRatio: 0.54, rw: 82, rh: 9.5, yOff: 0.56 },
            { rxRatio: 0.79, rw: 64, rh: 8.0, yOff: 0.42 },
          ];
          const skyReflC = lerpRgb(
            [116, 158, 204],
            lerpRgb(horRgb, [202, 224, 245], 0.45),
            sim.dayWeight
          );
          for (const pd of pDefs) {
            const px = width * pd.rxRatio;
            const groundY = getSoilY(px);
            const py = groundY + Math.max(8, (height - groundY) * pd.yOff);
            const rx = pd.rw * Math.min(1.15, Math.max(0.68, width / 920));
            const ry = pd.rh * (0.72 + puddleVis * 0.35);
            const glintShiftX = Math.max(-rx * 0.45, Math.min(rx * 0.45, ((orbX - px) / Math.max(200, width)) * rx * 0.85));

            const pg = ctx.createRadialGradient(px + glintShiftX, py, ry * 0.2, px, py, rx);
            pg.addColorStop(0, rgbCss(skyReflC, (0.3 + puddleVis * 0.24) * (1 - sim.fogWeight * 0.3)));
            pg.addColorStop(0.75, rgbCss(lerpRgb(midC, skyReflC, 0.38), 0.34));
            pg.addColorStop(1, 'rgba(10, 14, 18, 0)');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 8. Foreground Botanically Articulated Palms & Leafy Bengal Trees with Seasonal Flowers & Fruits
      const palmBarkRgb = lerpRgb([14, 20, 22], [44, 36, 28], sim.dayWeight * (1 - sunOcclusion * 0.55));
      const sunBarkCss =
        sunlightFactor > 0.12
          ? rgbCss(
              twilight > 0.36 ? [184, 134, 72] : [132, 126, 78],
              Math.min(0.68, sunlightFactor * 0.72)
            )
          : effectiveMoonVis > 0.18
            ? rgbCss([176, 206, 240], Math.min(0.42, effectiveMoonVis * 0.46))
            : null;
      const palmFrondBase = lerpRgb([18, 40, 28], [14, 52, 32], sim.monsoonWeight * 0.7);
      const palmFrondWinter = lerpRgb(palmFrondBase, [44, 52, 30], sim.winterWeight * 0.55);
      const palmFrondRgb = lerpRgb(
        [10, 18, 20],
        lerpRgb(palmFrondWinter, [32, 68, 36], sunlightFactor * (1 - sim.winterWeight * 0.45)),
        sim.dayWeight
      );
      const palmRimRgb =
        sim.dayWeight < 0.42 && effectiveMoonVis > 0.18
          ? lerpRgb([34, 56, 78], [176, 206, 238], effectiveMoonVis)
          : twilight > 0.36
            ? lerpRgb([86, 108, 46], [202, 152, 68], sunlightFactor)
            : lerpRgb([46, 86, 38], sim.winterWeight > 0.5 ? [146, 148, 72] : [136, 188, 66], sunlightFactor);

      const coconutWeight = Math.max(sim.summerWeight, sim.monsoonWeight * 0.9);
      const nightFruitShade = 0.34 + sim.dayWeight * (1 - sunOcclusion * 0.4) * 0.66;
      const palmRimFactor = Math.max(sunlightFactor, sim.dayWeight < 0.42 ? effectiveMoonVis * 0.72 : 0);

      for (const palm of palmTrees) {
        const px = palm.xRatio * width;
        const pH = Math.min(height * 0.4, Math.max(135, height * palm.heightRatio));
        const pTip = drawArticulatedPalm(
          px,
          getSoilY(px) + 8,
          pH,
          palm.lean,
          palm.fronds,
          palm.seed,
          palm.freqMult,
          windFactor,
          windSign,
          tSec,
          orbX,
          orbY,
          rgbCss(palmBarkRgb, 0.97),
          sunBarkCss,
          rgbCss(palmFrondRgb, 0.95),
          rgbCss(palmRimRgb, 0.94),
          palmRimFactor
        );

        // Seasonal Coconuts (ডাব/নারকেল) tucked beneath palm crown during Summer & Monsoon
        if (coconutWeight > 0.18) {
          const cocoAlpha = Math.min(0.95, coconutWeight * 1.1) * (1 - sim.fogWeight * 0.35);
          const cocoR = Math.max(2.6, Math.min(4.8, pH * 0.025));
          const cocoColor = rgbCss(
            lerpRgb([14, 34, 18], [58, 122, 42], nightFruitShade * (1 - sim.monsoonWeight * 0.25)),
            cocoAlpha
          );
          const cocoHi = rgbCss(
            [168, 224, 114],
            Math.min(0.65, sunlightFactor * 0.7 * cocoAlpha)
          );
          const offsets = [
            { dx: -cocoR * 1.1, dy: cocoR * 1.3 },
            { dx: cocoR * 0.2, dy: cocoR * 1.75 },
            { dx: cocoR * 1.25, dy: cocoR * 1.15 },
          ];
          ctx.save();
          for (const off of offsets) {
            ctx.fillStyle = cocoColor;
            ctx.beginPath();
            ctx.ellipse(pTip.x + off.dx, pTip.y + off.dy, cocoR * 0.92, cocoR * 1.12, 0.12, 0, Math.PI * 2);
            ctx.fill();
            if (sunlightFactor > 0.15) {
              ctx.fillStyle = cocoHi;
              ctx.beginPath();
              ctx.arc(pTip.x + off.dx - cocoR * 0.25, pTip.y + off.dy - cocoR * 0.3, cocoR * 0.35, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.restore();
        }

        treePerchAnchors.push({
          x: pTip.x + 8,
          y: pTip.y - 4,
          shelterX: pTip.x - windSign * 4,
          shelterY: pTip.y + 8,
          isLeafy: false,
        });
      }

      const drawKrishnachuraCluster = (cx: number, cy: number, radius: number, alpha: number, seed: number) => {
        if (alpha <= 0.02) return;
        const litBoost = 0.45 + sim.dayWeight * 0.45 + sunlightFactor * 0.3;
        const petalRgb: RGB = [
          Math.min(255, Math.round(218 * litBoost)),
          Math.min(255, Math.round(58 * litBoost)),
          Math.min(255, Math.round(28 * litBoost)),
        ];
        const flameRgb: RGB = [
          Math.min(255, Math.round(248 * litBoost)),
          Math.min(255, Math.round(126 * litBoost)),
          Math.min(255, Math.round(32 * litBoost)),
        ];
        ctx.save();
        ctx.globalAlpha = alpha;
        for (let b = 0; b < 7; b++) {
          const ang = (b / 7) * Math.PI * 2 + seed;
          const dist = (0.3 + (b % 3) * 0.28) * radius;
          const bx = cx + Math.cos(ang) * dist;
          const by = cy + Math.sin(ang) * dist * 0.72;
          const br = radius * (0.28 + (b % 2) * 0.12);
          ctx.fillStyle = rgbCss(b % 2 === 0 ? petalRgb : flameRgb, 0.92);
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };

      const drawHangingMango = (mx: number, my: number, scale: number, swingAng: number, alpha: number) => {
        if (alpha <= 0.02) return;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(swingAng);
        ctx.globalAlpha = alpha;
        // Stem
        ctx.strokeStyle = rgbCss([36, 48, 22], 0.9);
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 4.2 * scale);
        ctx.stroke();
        // Ripe golden-green mango body
        const mangoBody = lerpRgb([38, 64, 22], [234, 174, 42], 0.55 + sunlightFactor * 0.35);
        const mangoBlush = lerpRgb([96, 42, 18], [239, 98, 42], 0.5 + sunlightFactor * 0.35);
        ctx.fillStyle = rgbCss(mangoBody, 0.95);
        ctx.beginPath();
        ctx.ellipse(0.4 * scale, 8.0 * scale, 2.7 * scale, 3.8 * scale, 0.16, 0, Math.PI * 2);
        ctx.fill();
        if (sunlightFactor > 0.12) {
          ctx.fillStyle = rgbCss(mangoBlush, 0.55);
          ctx.beginPath();
          ctx.ellipse(1.1 * scale, 7.1 * scale, 1.3 * scale, 2.2 * scale, 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };

      const drawKadamFlower = (kx: number, ky: number, radius: number, alpha: number) => {
        if (alpha <= 0.02) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const lit = 0.42 + sim.dayWeight * 0.52 + sunlightFactor * 0.25;
        const coreColor = rgbCss(
          [Math.min(255, Math.round(234 * lit)), Math.min(255, Math.round(178 * lit)), Math.min(255, Math.round(46 * lit))],
          0.96
        );
        const haloColor = rgbCss(
          [Math.min(255, Math.round(252 * lit)), Math.min(255, Math.round(244 * lit)), Math.min(255, Math.round(204 * lit))],
          0.85
        );
        // Tiny radiating creamy stamens
        ctx.strokeStyle = haloColor;
        ctx.lineWidth = 0.7;
        for (let s = 0; s < 8; s++) {
          const a = (s / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(kx + Math.cos(a) * radius * 0.5, ky + Math.sin(a) * radius * 0.5);
          ctx.lineTo(kx + Math.cos(a) * radius * 1.25, ky + Math.sin(a) * radius * 1.25);
          ctx.stroke();
        }
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(kx, ky, radius * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      const treeBarkCss = rgbCss(lerpRgb([12, 16, 18], [40, 32, 24], sim.dayWeight * (1 - sunOcclusion * 0.5)), 0.98);
      leafyTrees.forEach((tree, treeIdx) => {
        const tx = tree.xRatio * width;
        const ty = getSoilY(tx) + 12;
        const tWind = sampleLocalWind(tx, tSec, windFactor, windSign, tree.freqMult, tree.seed);
        const trunkLen = Math.min(height * 0.25, 195) * tree.scale;

        const trunkFlex = windSign * Math.min(0.145, tWind.bend * 0.095);
        const topX = tx + Math.sin(tree.lean + trunkFlex) * trunkLen;
        const topY = ty - Math.cos(tree.lean + trunkFlex) * trunkLen;
        const ctrlX = tx + Math.sin(tree.lean + trunkFlex * 0.45) * (trunkLen * 0.5);
        const ctrlY = ty - trunkLen * 0.55;

        const dSunX = orbX - topX;
        const dSunY = orbY - topY;
        const dSunMag = Math.hypot(dSunX, dSunY) || 1;
        const sunUx = dSunX / dSunMag;
        const sunUy = dSunY / dSunMag;

        ctx.save();
        // Spreading surface roots visibly anchoring each forest tree into the dark earth (lit on sun/moon facing side)
        const rootSpread = 16 * tree.scale;
        drawTaperedCurve(
          tx - 4 * tree.scale,
          ty - 8,
          tx - rootSpread * 0.55,
          ty + 1,
          tx - rootSpread * 1.15,
          ty + 4,
          7.2 * tree.scale,
          1.4 * tree.scale,
          treeBarkCss,
          sunUx < -0.05 ? sunBarkCss : null,
          sunUx
        );
        drawTaperedCurve(
          tx + 4 * tree.scale,
          ty - 8,
          tx + rootSpread * 0.58,
          ty + 2,
          tx + rootSpread * 1.2,
          ty + 4,
          7.0 * tree.scale,
          1.4 * tree.scale,
          treeBarkCss,
          sunUx > 0.05 ? sunBarkCss : null,
          sunUx
        );

        drawTaperedCurve(
          tx,
          ty,
          ctrlX,
          ctrlY,
          topX,
          topY,
          17.5 * tree.scale,
          7.6 * tree.scale,
          treeBarkCss,
          sunBarkCss,
          sunUx
        );

        // Deep shaded inner canopy base so the tree looks lush and multi-dimensional
        const crownBaseIdx = Math.floor(tree.seed) % sprigCool.length;
        const innerSize = 112 * tree.scale;
        ctx.save();
        ctx.translate(topX, topY - trunkLen * 0.28);
        ctx.rotate(trunkFlex * 0.4);
        ctx.globalAlpha = 0.88 * (1 - sim.fogWeight * 0.25) * (1 - sim.winterWeight * 0.26);
        ctx.drawImage(sprigCool[crownBaseIdx], -innerSize * 0.5, -innerSize * 0.5, innerSize, innerSize);
        if (sim.monsoonWeight > 0.15) {
          ctx.globalAlpha = Math.min(0.68, sim.monsoonWeight * 0.65);
          ctx.drawImage(sprigMonsoon[crownBaseIdx], -innerSize * 0.5, -innerSize * 0.5, innerSize, innerSize);
        }
        if (sim.winterWeight > 0.15) {
          ctx.globalAlpha = Math.min(0.7, sim.winterWeight * 0.68);
          ctx.drawImage(sprigWinter[crownBaseIdx], -innerSize * 0.5, -innerSize * 0.5, innerSize, innerSize);
        }
        ctx.restore();

        tree.limbs.forEach((limb, li) => {
          const effTreeWind = Math.min(1.4, windFactor);
          const limbLag =
            windFactor > 0.015
              ? smoothTurb1d(tSec * (0.58 + effTreeWind * 0.28) * limb.freqMult + tree.seed * 2.7 + li * 4.1) *
                tWind.pocket *
                effTreeWind *
                0.095
              : 0;
          const limbWindBend = windSign * Math.min(0.13, tWind.bend * 0.085);
          const lAng = limb.ang + trunkFlex * 1.08 + limbWindBend + limbLag;
          const lLen = trunkLen * limb.len;
          const lx = topX + Math.cos(lAng) * lLen;
          const ly = topY + Math.sin(lAng) * lLen;
          const lMidX =
            (topX + lx) * 0.5 -
            Math.sin(lAng) * 5 * tree.scale +
            windSign * Math.min(lLen * 0.08, tWind.bend * lLen * 0.055);
          const lMidY = (topY + ly) * 0.5 + Math.cos(lAng) * 5 * tree.scale;

          drawTaperedCurve(
            topX,
            topY,
            lMidX,
            lMidY,
            lx,
            ly,
            7.4 * tree.scale,
            3.3 * tree.scale,
            treeBarkCss,
            sunBarkCss,
            sunUx
          );

          limb.twigs.forEach((twOff, ti) => {
            const twigLag =
              windFactor > 0.015
                ? smoothTurb1d(
                    tSec * (0.88 + effTreeWind * 0.42) * limb.freqMult + tree.seed * 4.3 + li * 3.2 + ti * 5.7
                  ) *
                  tWind.pocket *
                  effTreeWind *
                  0.12
                : 0;
            const twAng = lAng + twOff + windSign * Math.min(0.12, tWind.bend * 0.082) + twigLag;
            const twLen = lLen * 0.62;
            const twx = lx + Math.cos(twAng) * twLen;
            const twy = ly + Math.sin(twAng) * twLen;
            const twMidX = (lx + twx) * 0.5 + windSign * Math.min(twLen * 0.075, tWind.bend * twLen * 0.05);

            drawTaperedCurve(
              lx,
              ly,
              twMidX,
              (ly + twy) * 0.5,
              twx,
              twy,
              3.4 * tree.scale,
              1.3 * tree.scale,
              treeBarkCss,
              null,
              sunUx
            );

            const sprIdx = (li + ti + Math.floor(tree.seed)) % sprigCool.length;
            const sprSize = (94 + ((li + ti) % 2) * 20) * tree.scale;
            const leafPhase = tSec * (1.35 + effTreeWind * 0.65) + li * 2.9 + ti * 4.7 + tree.seed;
            const flutterRot =
              windFactor > 0.015
                ? Math.sin(leafPhase) * tWind.pocket * effTreeWind * 0.22 +
                  tWind.flutter * 0.24 +
                  windSign * Math.min(0.16, tWind.bend * 0.11)
                : 0;
            const leafShiftX =
              windFactor > 0.015
                ? windSign * Math.min(4.2, tWind.bend * 3.0) + Math.sin(leafPhase) * effTreeWind * 2.4 * windSign
                : 0;
            const leafShiftY =
              windFactor > 0.015 ? Math.cos(leafPhase * 0.9) * effTreeWind * 1.2 : 0;

            const twigDirX = Math.cos(twAng);
            const twigDirY = Math.sin(twAng);
            const sunDot = twigDirX * sunUx + twigDirY * sunUy;
            const sunExposure = Math.max(0, Math.min(1, 0.42 + sunDot * 0.52));
            const localSun = sunlightFactor * sunExposure;
            const localMoon = effectiveMoonVis * (1 - sim.dayWeight) * sunExposure;

            ctx.save();
            ctx.translate(twx + leafShiftX, twy + leafShiftY);
            ctx.rotate(twAng * 0.25 + flutterRot);

            // Shaded base canopy leaves (sparser in winter, extra lush in monsoon)
            const twigBaseAlpha = (sim.fogWeight > 0.5 ? 0.78 : 0.95) * (1 - sim.winterWeight * 0.34);
            ctx.globalAlpha = twigBaseAlpha;
            ctx.drawImage(sprigCool[sprIdx], -sprSize * 0.5, -sprSize * 0.5, sprSize, sprSize);

            if (sim.monsoonWeight > 0.15) {
              ctx.globalAlpha = Math.min(0.75, sim.monsoonWeight * 0.72) * (1 - sim.fogWeight * 0.25);
              ctx.drawImage(sprigMonsoon[sprIdx], -sprSize * 0.5, -sprSize * 0.5, sprSize, sprSize);
            }
            if (sim.winterWeight > 0.15) {
              ctx.globalAlpha = Math.min(0.8, sim.winterWeight * 0.76) * (1 - sim.fogWeight * 0.2);
              ctx.drawImage(sprigWinter[sprIdx], -sprSize * 0.5, -sprSize * 0.5, sprSize, sprSize);
            }

            // Smoothly blend sunlit warm green foliage strictly toward Sun direction (orbX, orbY)
            if (localSun > 0.05) {
              ctx.globalAlpha = Math.min(0.98, localSun * 1.15) * (1 - sim.winterWeight * 0.42);
              ctx.drawImage(activeLitSprites[sprIdx], -sprSize * 0.5, -sprSize * 0.5, sprSize, sprSize);

              // Directional sun-kissed golden-lime outer rim on leaves facing the Sun
              ctx.globalAlpha = Math.min(0.92, localSun * 0.96) * (1 - sim.winterWeight * 0.35);
              ctx.drawImage(
                activeRimSprites[sprIdx],
                -sprSize * 0.5 + sunUx * 5.2,
                -sprSize * 0.5 + sunUy * 4.0,
                sprSize,
                sprSize
              );
            } else if (localMoon > 0.06) {
              // Silvery moonlight rim on tree branches facing the Moon at night
              ctx.globalAlpha = Math.min(0.62, localMoon * 0.72);
              ctx.drawImage(
                sprigMoonRim[sprIdx],
                -sprSize * 0.5 + sunUx * 4.6,
                -sprSize * 0.5 + sunUy * 3.5,
                sprSize,
                sprSize
              );
            }
            ctx.restore();

            // Seasonal Flowers & Fruits on the Bengal Trees
            const speciesBucket = treeIdx % 3; // 0: Krishnachura, 1: Mango, 2: Kadam
            if (sim.summerWeight > 0.18 && speciesBucket === 0 && (li + ti) % 2 === 0) {
              drawKrishnachuraCluster(
                twx + twigDirX * 8 * tree.scale,
                twy - 5 * tree.scale,
                11.5 * tree.scale,
                Math.min(0.92, sim.summerWeight * 0.95) * (1 - sim.fogWeight * 0.35),
                tree.seed + li + ti
              );
            } else if (sim.summerWeight > 0.18 && speciesBucket === 1 && ti % 2 === 0) {
              const mangoSwing = windSign * windFactor * 0.28 + Math.sin(tSec * 2.2 + li + ti) * 0.08;
              drawHangingMango(
                twx - twigDirX * 6 * tree.scale,
                twy + 6 * tree.scale,
                Math.max(0.72, tree.scale * 0.95),
                mangoSwing,
                Math.min(0.94, sim.summerWeight * 0.96) * (1 - sim.fogWeight * 0.3)
              );
            } else if (sim.monsoonWeight > 0.18 && speciesBucket === 2 && (li + ti) % 2 === 1) {
              drawKadamFlower(
                twx + twigDirX * 6 * tree.scale,
                twy - 3 * tree.scale,
                4.1 * tree.scale,
                Math.min(0.92, sim.monsoonWeight * 0.94) * (1 - sim.fogWeight * 0.28)
              );
            }

            treePerchAnchors.push({
              x: twx,
              y: twy - sprSize * 0.14,
              shelterX: lx * 0.56 + twx * 0.44,
              shelterY: ly * 0.56 + twy * 0.44 - 1,
              isLeafy: true,
            });
          });
        });
        ctx.restore();
      });

      // 8b. Tree-Dwelling Songbirds: Hopping/Fluttering in Dry Weather, Perched Quietly Under Leafy Shelter When Raining
      if (sim.dayWeight > 0.36 && treePerchAnchors.length > 4) {
        const canopyBirdAlpha = Math.min(
          0.94,
          sim.dayWeight * (1 - sim.fogWeight * 0.5) * (isBirdRainShelter ? 0.96 : 0.9)
        );
        const canopyBirdCss = rgbCss(
          isBirdRainShelter
            ? [12, 16, 22]
            : twilight > 0.35
              ? [34, 24, 28]
              : [20, 26, 32],
          canopyBirdAlpha
        );
        const perchRimCss = isBirdRainShelter
          ? `rgba(203, 213, 225, ${(0.34 * sim.dayWeight * (1 - sim.stormWeight * 0.35)).toFixed(2)})`
          : sunlightFactor > 0.25
            ? `rgba(236, 253, 180, ${(0.28 * sunlightFactor).toFixed(2)})`
            : null;
        const maxCanopyBirds = isBirdRainShelter
          ? sim.stormWeight > 0.6
            ? 8
            : canopyBirds.length
          : isHotDay
            ? 6
            : canopyBirds.length;

        const pickLeafyAnchorIdx = (preferredFrom: number) => {
          for (let step = 1; step <= treePerchAnchors.length; step++) {
            const candidate = (preferredFrom + step) % treePerchAnchors.length;
            if (treePerchAnchors[candidate].isLeafy) return candidate;
          }
          return preferredFrom % treePerchAnchors.length;
        };

        const resolvePerchPos = (anchor: (typeof treePerchAnchors)[number]) => ({
          x: anchor.x + (anchor.shelterX - anchor.x) * rainShelterBlend,
          y: anchor.y + (anchor.shelterY - anchor.y) * rainShelterBlend,
        });

        for (let i = 0; i < maxCanopyBirds; i++) {
          const cb = canopyBirds[i];
          const curAnchor = treePerchAnchors[cb.anchorIdx % treePerchAnchors.length];
          if (isBirdRainShelter && !curAnchor.isLeafy) {
            if (rainShelterBlend >= 0.92 || prefersReducedMotion) {
              cb.anchorIdx = pickLeafyAnchorIdx(cb.anchorIdx);
              cb.state = 'perched';
            } else if (cb.state === 'perched') {
              cb.state = 'hopping';
              cb.hopT = 0;
              cb.targetIdx = pickLeafyAnchorIdx(cb.anchorIdx);
              const tgtPos = resolvePerchPos(treePerchAnchors[cb.targetIdx]);
              const srcNow = resolvePerchPos(curAnchor);
              cb.facing = tgtPos.x >= srcNow.x ? 1 : -1;
            }
          }

          const rawSrc = treePerchAnchors[cb.anchorIdx % treePerchAnchors.length];
          const rawDst = treePerchAnchors[cb.targetIdx % treePerchAnchors.length];
          const srcPos = resolvePerchPos(rawSrc);
          const dstPos = resolvePerchPos(rawDst);

          if (cb.state === 'perched') {
            if (!prefersReducedMotion) {
              if (isBirdRainShelter || sim.dayWeight < 0.50 || twilight > 0.14) {
                // During rain or evening/night, birds stay huddled quietly perched in shelter
                cb.bobPhase += 0.025;
                cb.facing = windSign > 0 ? -1 : 1;
              } else {
                cb.waitTicks -= 1;
                cb.bobPhase += 0.06;
                if (cb.waitTicks <= 0) {
                  cb.state = 'hopping';
                  cb.hopT = 0;
                  const offset = 1 + Math.floor(Math.random() * 5);
                  cb.targetIdx =
                    (cb.anchorIdx + (Math.random() < 0.5 ? offset : -offset) + treePerchAnchors.length) %
                    treePerchAnchors.length;
                  const nextPos = resolvePerchPos(treePerchAnchors[cb.targetIdx]);
                  cb.facing = nextPos.x >= srcPos.x ? 1 : -1;
                }
              }
            }
            const bobY = isBirdRainShelter
              ? Math.sin(cb.bobPhase) * 0.25
              : Math.sin(cb.bobPhase) * 0.9;
            drawRealisticBird(
              srcPos.x,
              srcPos.y + bobY,
              cb.facing,
              cb.scale,
              0,
              false,
              true,
              canopyBirdCss,
              rainShelterBlend,
              perchRimCss
            );
          } else {
            if (!prefersReducedMotion) {
              // If rain starts mid-hop, finish landing quickly onto a sheltered leafy branch and stay perched
              cb.hopT += isBirdRainShelter ? cb.hopSpeed * 1.9 : cb.hopSpeed;
              cb.wingPhase += 0.42;
              if (cb.hopT >= 1) {
                cb.state = 'perched';
                cb.anchorIdx = isBirdRainShelter ? pickLeafyAnchorIdx(cb.targetIdx) : cb.targetIdx;
                cb.waitTicks = (isHotDay ? 180 : 85) + Math.floor(Math.random() * 210);
              }
            }
            const t = Math.min(1, cb.hopT);
            const bx = srcPos.x + (dstPos.x - srcPos.x) * t;
            const by = srcPos.y + (dstPos.y - srcPos.y) * t - Math.sin(t * Math.PI) * cb.arcH;
            const isMidGlide = t > 0.45 && t < 0.72;
            drawRealisticBird(
              bx,
              by,
              cb.facing,
              cb.scale * 0.92,
              cb.wingPhase,
              isMidGlide,
              false,
              canopyBirdCss
            );
          }
        }
      }

      // 8c. Dynamic Forest Wildlife: Lifelike Spotted Chital Deer Arriving/Walking, Grazing, Sleeping Under Trees, Hopping Hare & Night Owls
      const wildlifeVis = Math.max(0.76, nightVis, twilight * 0.92, sim.dayWeight * 0.94);
      if (wildlifeVis > 0.08) {
        const deerAlpha = Math.min(0.98, wildlifeVis * 1.05 * (1 - sim.fogWeight * 0.24));
        const deerLit = Math.min(1, 0.34 + sim.dayWeight * 0.56 + sunlightFactor * 0.25 + effectiveMoonVis * 0.28);
        ctx.save();
        ctx.globalAlpha = deerAlpha;

        const deerMoonRim = Math.max(0.18, effectiveMoonVis * 0.78);
        // Substantial, natural woodland scale so deer & animals stand out clearly beneath the trees
        const deerBaseScale = Math.min(2.35, Math.max(1.52, width / 420));

        // In rain/storm, deer shelter closer underneath the main sheltering tree roots
        const rainShiftX = (windSign > 0 ? -1 : 1) * sim.rainWeight * 16 * deerBaseScale;
        const rainShelterFactor = Math.min(1, sim.rainWeight * 1.5 + sim.stormWeight);

        const drawHoofShadow = (sx: number, sy: number, rw: number) => {
          const proj = getShadowProj(sx, sy);
          const shiftX = proj * 9.5;
          const stretchW = rw * (1 + Math.min(0.45, Math.abs(proj) * 0.28));
          ctx.fillStyle = 'rgba(4, 6, 8, 0.42)';
          ctx.beginPath();
          ctx.ellipse(sx + shiftX, sy + 1.8, stretchW, Math.max(2.8, rw * 0.24), 0, 0, Math.PI * 2);
          ctx.fill();
        };

        // Deer 1: Arriving & Walking Spotted Stag moving at natural brisk forest pace (stride matched to velocity!)
        if (!prefersReducedMotion) {
          const walkCycleSpan = width * 0.68;
          const walkProgress = (tick * 0.82) % (walkCycleSpan * 2);
          const walkingRightToLeft = walkProgress <= walkCycleSpan;
          const walkingDeerX = walkingRightToLeft
            ? width * 0.9 - walkProgress
            : width * 0.22 + (walkProgress - walkCycleSpan);
          const walkingDeerY = getSoilY(walkingDeerX) + 26;
          const walkFacing = walkingRightToLeft ? -1 : 1;
          drawHoofShadow(walkingDeerX, walkingDeerY, 18 * deerBaseScale);
          drawRealisticDeer(
            walkingDeerX,
            walkingDeerY,
            walkFacing,
            deerBaseScale * 0.95,
            'walking',
            tick,
            deerMoonRim,
            rainShelterFactor,
            deerLit,
            walkProgress * 0.18
          );
        }

        // Deer 2: Grazing Spotted Deer
        const grazingDeerX = width * 0.28 + rainShiftX;
        const grazingDeerY = getSoilY(grazingDeerX) + 22;
        drawHoofShadow(grazingDeerX, grazingDeerY, 18 * deerBaseScale);
        drawRealisticDeer(
          grazingDeerX,
          grazingDeerY,
          1,
          deerBaseScale * 0.98,
          'grazing',
          tick,
          deerMoonRim,
          rainShelterFactor,
          deerLit
        );

        // Deer 3: Resting Stag tucked beside tree roots
        const restingDeerX = width * 0.47 - rainShiftX * 0.5;
        const restingDeerY = getSoilY(restingDeerX) + 21;
        drawHoofShadow(restingDeerX, restingDeerY, 20 * deerBaseScale);
        drawRealisticDeer(
          restingDeerX,
          restingDeerY,
          -1,
          deerBaseScale * 0.98,
          'resting',
          tick,
          deerMoonRim,
          rainShelterFactor,
          deerLit
        );

        // Deer 4: Sleeping Little Fawn beside mother
        const fawnDeerX = width * 0.39;
        const fawnDeerY = getSoilY(fawnDeerX) + 22;
        drawHoofShadow(fawnDeerX, fawnDeerY, 12 * deerBaseScale);
        drawRealisticDeer(
          fawnDeerX,
          fawnDeerY,
          1,
          deerBaseScale * 0.72,
          'fawn',
          tick,
          deerMoonRim,
          rainShelterFactor,
          deerLit
        );

        // Woodland Hare hopping playfully out onto the mossy earth and back
        const hareWave = Math.sin(tick * 0.0085);
        const hareX = width * 0.14 + hareWave * (width * 0.065);
        const hareY = getSoilY(hareX) + 30;
        const hareFacing = Math.cos(tick * 0.0085) >= 0 ? 1 : -1;
        drawHoofShadow(hareX, hareY, 10 * deerBaseScale);
        drawRealisticHare(hareX, hareY, hareFacing, deerBaseScale * 1.18, tick, deerMoonRim);

        // Woodland birds roost quietly inside canopies once evening arrives (zero night flights)

        // Delicate moonlit grass tussocks under the hooves
        if (effectiveMoonVis > 0.15) {
          ctx.strokeStyle = `rgba(186, 214, 235, ${(0.24 * effectiveMoonVis).toFixed(3)})`;
          ctx.lineWidth = 1.0;
          const tuftXs = [grazingDeerX - 16, grazingDeerX + 20, restingDeerX - 22, restingDeerX + 18];
          for (const tx of tuftXs) {
            const ty = getSoilY(tx) + 22;
            ctx.beginPath();
            ctx.moveTo(tx, ty + 4);
            ctx.lineTo(tx - 4, ty - 7);
            ctx.moveTo(tx, ty + 4);
            ctx.lineTo(tx + 5, ty - 6);
            ctx.stroke();
          }
        }

        // Weathered Mossy Fallen Woodland Log, Ferns, Mushrooms & Daytime Butterfly on open right forest floor
        const logX = width * 0.71;
        const logY = getSoilY(logX) + 24;
        const logCol = rgbCss(lerpRgb([18, 14, 10], [64, 46, 30], deerLit));
        const mossCol = rgbCss(lerpRgb([10, 22, 12], [44, 96, 36], deerLit));
        ctx.fillStyle = 'rgba(4, 6, 8, 0.38)';
        ctx.beginPath();
        ctx.ellipse(logX, logY + 4, 28 * deerBaseScale * 0.62, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = logCol;
        ctx.beginPath();
        ctx.roundRect(logX - 24 * deerBaseScale * 0.55, logY - 6, 48 * deerBaseScale * 0.55, 11, 5);
        ctx.fill();
        // Moss velvet cap & tiny forest shelf mushrooms along log
        ctx.fillStyle = mossCol;
        ctx.beginPath();
        ctx.ellipse(logX - 6, logY - 5, 15, 3.2, -0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgbCss(lerpRgb([52, 42, 32], [224, 198, 152], deerLit));
        [-10, -5, 11].forEach((mx, mi) => {
          ctx.beginPath();
          ctx.arc(logX + mx, logY - 6 - (mi % 2), 2.3, Math.PI, 0);
          ctx.fill();
        });
        // Woodland fern fronds curling beside log
        ctx.strokeStyle = mossCol;
        ctx.lineWidth = 1.6;
        for (let fi = -2; fi <= 2; fi++) {
          ctx.beginPath();
          ctx.moveTo(logX - 18, logY + 2);
          ctx.quadraticCurveTo(logX - 22 + fi * 5, logY - 12 + Math.abs(fi) * 2, logX - 25 + fi * 7, logY - 15 + Math.abs(fi) * 3);
          ctx.stroke();
        }
        // Perched little forest bird hopping softly on fallen log in calm hours
        if (sim.stormWeight < 0.45 && sim.rainWeight < 0.25) {
          const hop = Math.abs(Math.sin(tSec * 2.2)) < 0.14 ? -3 : 0;
          drawRealisticBird(
            logX + 8,
            logY - 7 + hop,
            -1,
            0.95,
            0,
            false,
            true,
            rgbCss(lerpRgb([18, 22, 30], [34, 42, 54], deerLit))
          );
        }
        // Calm daytime fluttering woodland butterfly weaving gently above log & ferns
        if (sim.dayWeight > 0.34 && sim.rainWeight < 0.18 && sim.stormWeight < 0.3 && !prefersReducedMotion) {
          const bfx = logX - 8 + Math.sin(tSec * 1.35) * 24;
          const bfy = logY - 22 + Math.cos(tSec * 2.1) * 9;
          const flap = Math.abs(Math.sin(tSec * 11));
          ctx.fillStyle = `rgba(251, 191, 36, ${(0.72 * sim.dayWeight).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(bfx - 2.2 * flap, bfy, 2.8 * Math.max(0.25, flap), 3.6, -0.35, 0, Math.PI * 2);
          ctx.ellipse(bfx + 2.2 * flap, bfy, 2.8 * Math.max(0.25, flap), 3.6, 0.35, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      // Low mossy grass borders on far soil edges (leaving central forest soil, puddles, and animals unobstructed!)
      const bushBaseRgb = lerpRgb(
        [8, 16, 14],
        lerpRgb([18, 36, 20], [38, 46, 24], sim.winterWeight * 0.6),
        sim.dayWeight * (1 - sunOcclusion * 0.45)
      );
      const bushLitRgb =
        twilight > 0.36
          ? ([96, 86, 42] as RGB)
          : sim.winterWeight > 0.45
            ? ([86, 94, 42] as RGB)
            : ([58, 92, 34] as RGB);
      ctx.fillStyle = rgbCss(lerpRgb(bushBaseRgb, bushLitRgb, sunlightFactor * 0.52));

      // Left edge woodland bank grass
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width * 0.17; x += 18) {
        const taper = 1 - x / (width * 0.17);
        const bush = (10 + Math.sin(x * 0.04) * 6) * taper;
        ctx.lineTo(x, height - bush);
      }
      ctx.lineTo(width * 0.17, height);
      ctx.closePath();
      ctx.fill();

      // Right edge woodland bank grass
      ctx.beginPath();
      ctx.moveTo(width * 0.83, height);
      for (let x = width * 0.83; x <= width + 18; x += 18) {
        const taper = (x - width * 0.83) / (width * 0.17);
        const bush = (10 + Math.sin(x * 0.04) * 6) * Math.min(1, taper);
        ctx.lineTo(x, height - bush);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Winter mustard/wildflower specks along edge grass tufts
      if (sim.winterWeight > 0.22) {
        const wfAlpha = Math.min(0.85, sim.winterWeight * 0.85) * (0.45 + sim.dayWeight * 0.55);
        ctx.fillStyle = `rgba(250, 204, 21, ${wfAlpha.toFixed(2)})`;
        for (let bx = 22; bx < width * 0.14; bx += 38) {
          const by = height - (7 + Math.sin(bx * 0.04) * 4);
          ctx.beginPath();
          ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
          ctx.arc(bx + 7, by + 2.0, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let bx = width * 0.87; bx < width - 16; bx += 38) {
          const by = height - (7 + Math.sin(bx * 0.04) * 4);
          ctx.beginPath();
          ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
          ctx.arc(bx + 7, by + 2.0, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const reedColor = rgbCss(
        lerpRgb(
          [14, 24, 18],
          twilight > 0.36
            ? [126, 114, 54]
            : sim.winterWeight > 0.45
              ? [116, 112, 64]
              : [64, 112, 42],
          sunlightFactor * 0.82 + sim.dayWeight * 0.18
        ),
        0.92
      );
      ctx.save();
      ctx.strokeStyle = reedColor;
      ctx.lineWidth = 1.45;
      ctx.lineCap = 'round';
      reeds.forEach((rd, ri) => {
        const isEdgeBank = rd.xRatio < 0.17 || rd.xRatio > 0.83;
        if (!isEdgeBank && ri % 4 !== 0) return;
        const rx = rd.xRatio * width;
        const reedBaseY = isEdgeBank ? height + 2 : getSoilY(rx) + 2;
        const reedH = isEdgeBank ? rd.h : rd.h * 0.42;
        const rWind = sampleLocalWind(rx, tSec, windFactor, windSign, rd.freqMult, rd.seed);
        const rBend = windSign * Math.min(18, rWind.bend * 14) + rWind.flutter * 5.5;
        const tipX = rx + rd.lean * 42 + rBend;
        const tipY = reedBaseY - reedH;
        ctx.beginPath();
        ctx.moveTo(rx, reedBaseY);
        ctx.quadraticCurveTo(rx + rd.lean * 22 + rBend * 0.4, reedBaseY - reedH * 0.55, tipX, tipY);
        ctx.stroke();

        // Silvery-white feathery কাশফুল plumes blooming on winter reeds
        if (sim.winterWeight > 0.18 && ri % 2 === 0 && isEdgeBank) {
          const plumeAlpha = Math.min(0.88, sim.winterWeight * 0.92) * (0.4 + sim.dayWeight * 0.6);
          const ang = Math.atan2(tipY - (reedBaseY - reedH * 0.55), tipX - (rx + rd.lean * 22));
          ctx.save();
          ctx.translate(tipX, tipY);
          ctx.rotate(ang + Math.PI * 0.5);
          ctx.fillStyle = `rgba(241, 245, 249, ${plumeAlpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(0, -4.5, 2.3, 6.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
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
          const glow = 0.25 + 0.72 * Math.max(0, Math.sin(tick * 0.06 + f.phase));
          ctx.beginPath();
          ctx.arc(f.x, f.y, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(217, 249, 157, ${(glow * 0.34 * nightVis).toFixed(3)})`;
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

      // 12. Live Rain Streaks & Visible Ground/Puddle Splash Spray scaled across Drizzle -> Light -> Moderate -> Heavy Downpour
      if (sim.rainWeight > 0.02) {
        const rainCurve = Math.pow(sim.rainWeight, 1.45);
        // True density scaling: sparse ~14-30 thin drops in drizzle -> ~75 in light -> ~170 in moderate -> full 300 sheets in heavy downpour
        const activeDrops = Math.max(
          12,
          Math.floor(rainDrops.length * (0.04 + rainCurve * 0.96))
        );
        const slant = windSign * (1.2 + windFactor * 7.2);
        const speedMult = 0.46 + sim.rainWeight * 0.78;
        const opacityBoost = 0.28 + sim.rainWeight * 0.82;
        ctx.lineCap = 'round';
        for (let i = 0; i < activeDrops; i++) {
          const d = rainDrops[i];
          const a = Math.min(0.68, d.a * opacityBoost * Math.min(1, sim.rainWeight * 1.4));
          const dropLen = d.len * (0.32 + sim.rainWeight * 0.78);
          ctx.strokeStyle =
            sim.dayWeight > 0.5
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
            const groundCutY = getSoilY(d.x) + ((i * 23) % 100) * 0.01 * Math.max(10, height - getSoilY(d.x));
            if (d.y > groundCutY) {
              d.y = -25;
              d.x = Math.random() * (width + 260) - 130;
            }
            if (d.x > width + 140) d.x = -120;
            if (d.x < -140) d.x = width + 120;
          }
        }

        const activeSplashes = Math.max(6, Math.floor(rainSplashes.length * (0.1 + rainCurve * 0.9)));
        const splashTint = sim.dayWeight > 0.5 ? '226, 238, 248' : '198, 228, 250';
        for (let si = 0; si < activeSplashes; si++) {
          const sp = rainSplashes[si];
          const soilTop = getSoilY(sp.x) + 3;
          const drawY = soilTop + sp.yRatio * Math.max(8, height - soilTop - 3);
          const progress = Math.min(1, sp.r / sp.maxR);
          const spAlpha = (1 - progress) * (0.26 + sim.rainWeight * 0.34);

          if (spAlpha > 0.015) {
            // Concentric water ripple ring on wet forest earth & puddles
            ctx.beginPath();
            ctx.ellipse(sp.x, drawY, sp.r, sp.r * 0.32, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${splashTint}, ${spAlpha.toFixed(3)})`;
            ctx.lineWidth = 0.85 + sim.rainWeight * 0.45;
            ctx.stroke();

            if (sim.rainWeight > 0.36 && progress > 0.25) {
              ctx.beginPath();
              ctx.ellipse(sp.x, drawY, sp.r * 0.55, sp.r * 0.18, 0, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(${splashTint}, ${(spAlpha * 0.65).toFixed(3)})`;
              ctx.lineWidth = 0.65;
              ctx.stroke();
            }

            // Upward bouncing rain-spray beads when droplet strikes soil/puddle
            if (progress < 0.72) {
              const arcT = progress / 0.72;
              const bounceH = Math.sin(arcT * Math.PI) * (5 + sim.rainWeight * 10);
              const spreadX = arcT * (4.5 + sim.rainWeight * 4);
              const beadA = (1 - arcT) * (0.45 + sim.rainWeight * 0.42);
              ctx.fillStyle = `rgba(${splashTint}, ${beadA.toFixed(3)})`;

              ctx.beginPath();
              ctx.arc(sp.x - spreadX, drawY - bounceH, 1.05 + sim.rainWeight * 0.45, 0, Math.PI * 2);
              ctx.arc(sp.x + spreadX * 0.9, drawY - bounceH * 0.85, 0.95 + sim.rainWeight * 0.4, 0, Math.PI * 2);
              ctx.arc(sp.x + (si % 2 === 0 ? 1.5 : -1.5), drawY - bounceH * 1.18, 0.9, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          if (!prefersReducedMotion) {
            sp.r += sp.speed * (0.78 + sim.rainWeight * 0.52);
            if (sp.r >= sp.maxR) {
              sp.r = 0.35;
              sp.x = Math.random() * width;
              sp.yRatio = 0.08 + Math.random() * 0.88;
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
