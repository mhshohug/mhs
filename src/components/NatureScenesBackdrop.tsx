import { useEffect, useRef } from 'react';
import { SceneId } from '../data/sceneCatalog';
import { BengaliCalendarState, computeBengaliPhenology } from '../utils/bengaliCalendar';
import {
  BirdSpecies,
  draw3DBengaliHomesteadCompound,
  draw3DCityBuilding,
  draw3DFruitPlanter,
  draw3DPottedFlower,
  drawAnchoredSampan,
  drawBeachBather,
  drawBeachCouple,
  drawBeachPlayers,
  drawBeachUmbrellaAndLounger,
  drawBirdNestWithChicks,
  drawBusStopShelter,
  drawCourtyardHens,
  drawFarmerHarvestingPaddy,
  drawFieldScarecrow,
  drawFishermanCastingNet,
  drawGrazingCow,
  drawJhalmuriCart,
  drawLeafyBengalTree,
  drawLeapingDolphin,
  drawMountainDeer,
  drawMountainMonkey,
  drawMountainSquirrel,
  drawRealisticBird,
  drawRealisticBoat,
  drawRealisticDuck,
  drawRealisticPerson,
  drawRealisticVehicle,
  drawRestingFishermen,
  drawRiverAngler,
  drawRiversideCampTent,
  drawRoadsideTeaStall,
  drawTeaPlucker,
  drawVillageFieldPlayers,
  HumanActivity,
  HumanOutfit,
  PottedFlowerKind,
  TreeRootVariant,
  TreeSpecies,
  VehicleType,
} from '../utils/proceduralActors';
import {
  AtmosphericSkyContext,
  BotanicalSpritePack,
  buildBotanicalSpritePack,
  clamp01,
  createSkyPools,
  drawArticulatedPalm,
  drawBambooClump,
  drawBananaPlant,
  drawGrassTuftBand,
  lerp,
  lerpRgb,
  renderAtmosphericSkyAndCelestials,
  renderForegroundRainAndWind,
  RGB,
  rgbCss,
  sampleLocalWind,
  SkyPools,
} from '../utils/proceduralAtmosphere';
import {
  computeCelestialPosition,
  getDhakaHourDecimal,
  WeatherMood,
} from '../utils/rajshahiWeather';
import { stormAudio } from '../utils/stormAudio';

interface NatureScenesBackdropProps {
  sceneId: Exclude<SceneId, 'forest'>;
  previewBengaliMonth: number | null;
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

interface PedestrianAgent {
  xFrac: number;
  dir: 1 | -1;
  speed: number;
  laneFrac: number;
  scale: number;
  walkPhase: number;
  outfit: HumanOutfit;
  coatRgb: RGB;
  lowerRgb: RGB;
  umbrellaRgb: RGB;
}

interface VehicleAgent {
  type: VehicleType;
  lane: number;
  x: number;
  speed: number;
  wheelRot: number;
  bodyRgb?: RGB;
}

interface BoatAgent {
  type: 'paltola' | 'chhoi';
  x: number;
  dir: 1 | -1;
  speed: number;
  yRatio: number;
  scale: number;
  sailRgb: RGB;
  phase: number;
}

interface BirdAgent {
  x: number;
  yRatio: number;
  dir: 1 | -1;
  speed: number;
  scale: number;
  wingPhase: number;
  flapSpeed: number;
  glide: boolean;
}

interface FireflyAgent {
  xFrac: number;
  yFrac: number;
  vx: number;
  vy: number;
  phase: number;
  size: number;
}

interface PetalAgent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  size: number;
}

interface GlassBead {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  trail: number;
}

function drawWaterShimmer(
  ctx: CanvasRenderingContext2D,
  orbX: number,
  topY: number,
  bottomY: number,
  tSec: number,
  sky: AtmosphericSkyContext
) {
  const glintVis =
    sky.dayWeight > 0.45
      ? sky.sunlightFactor * 0.48
      : sky.effectiveMoonVis * 0.44;
  if (glintVis <= 0.025) return;

  const colStr =
    sky.dayWeight > 0.45
      ? sky.twilight > 0.3
        ? '255, 206, 134'
        : '255, 246, 204'
      : '202, 226, 255';

  ctx.save();
  const rows = 26;
  for (let i = 0; i < rows; i++) {
    const f = i / rows;
    const y = lerp(topY + 4, bottomY - 4, Math.pow(f, 1.15));
    const spread = 14 + f * 72;
    const waveOffset = Math.sin(tSec * (1.8 + f * 1.4) + i * 1.9) * (6 + f * 14);
    const barW = 10 + (1 - Math.abs(f - 0.5)) * 28 + Math.cos(tSec * 2.5 + i) * 5;
    const alpha = glintVis * (0.28 + (1 - f) * 0.48) * (0.65 + 0.35 * Math.sin(tSec * 3.1 + i));
    ctx.fillStyle = `rgba(${colStr}, ${clamp01(alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(orbX + waveOffset - barW * 0.5 + Math.sin(i * 3.1) * spread * 0.16, y, barW, 1.5 + f * 2.2, 2);
    ctx.fill();
  }
  ctx.restore();
}

export function NatureScenesBackdrop(props: NatureScenesBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const celestial = computeCelestialPosition({
      isDay: props.weatherIsDay,
      sunriseDecimal: props.sunriseDecimal,
      sunsetDecimal: props.sunsetDecimal,
      timezone: props.timezone,
    });
    const pheno = computeBengaliPhenology(new Date(), props.previewBengaliMonth);
    stormAudio.setSceneMode('weather', {
      sceneId: props.sceneId,
      bengaliSeason: pheno.season,
      weatherMood: props.weatherMood,
      isDay: props.weatherIsDay,
      windKmh: props.windKmh,
      temperatureC: props.temperatureC,
      sunProgress: celestial.progress,
      rainIntensity: props.rainIntensity,
      hasThunder: props.hasThunder,
    });
  }, [
    props.sceneId,
    props.previewBengaliMonth,
    props.weatherMood,
    props.weatherIsDay,
    props.windKmh,
    props.temperatureC,
    props.rainIntensity,
    props.hasThunder,
    props.sunriseDecimal,
    props.sunsetDecimal,
    props.timezone,
  ]);

  useEffect(() => {
    return stormAudio.onUnlockChange((unlocked) => {
      if (unlocked) {
        stormAudio.unlockAndStart(propsRef.current.weatherMood);
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const computeSceneZoom = (screenW: number) =>
      screenW < 480
        ? Math.max(0.46, Math.min(0.56, screenW / 760))
        : screenW < 640
          ? 0.58
          : screenW < 1024
            ? 0.82
            : 0.88;
    let screenW = window.innerWidth;
    let screenH = window.innerHeight;
    let sceneZoom = computeSceneZoom(screenW);
    let width = Math.ceil(screenW / sceneZoom);
    let height = Math.ceil(screenH / sceneZoom);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
      sceneZoom = computeSceneZoom(screenW);
      width = Math.ceil(screenW / sceneZoom);
      height = Math.ceil(screenH / sceneZoom);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(screenW * dpr);
      canvas.height = Math.round(screenH * dpr);
      canvas.style.width = `${screenW}px`;
      canvas.style.height = `${screenH}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const pools: SkyPools = createSkyPools(width, height);
    const sprigPack: BotanicalSpritePack = buildBotanicalSpritePack();

    const pedestrians: PedestrianAgent[] = [
      {
        xFrac: 0.18,
        dir: 1,
        speed: 0.022,
        laneFrac: 0.1,
        scale: 0.92,
        walkPhase: 0.4,
        outfit: 'sari',
        coatRgb: [190, 48, 66],
        lowerRgb: [224, 174, 82],
        umbrellaRgb: [168, 28, 46],
      },
      {
        xFrac: 0.78,
        dir: -1,
        speed: 0.023,
        laneFrac: 0.42,
        scale: 0.98,
        walkPhase: 2.1,
        outfit: 'panjabi',
        coatRgb: [232, 236, 240],
        lowerRgb: [36, 44, 58],
        umbrellaRgb: [22, 28, 38],
      },
      {
        xFrac: 0.46,
        dir: 1,
        speed: 0.021,
        laneFrac: 0.72,
        scale: 0.85,
        walkPhase: 4.0,
        outfit: 'lungi',
        coatRgb: [72, 134, 168],
        lowerRgb: [48, 86, 68],
        umbrellaRgb: [28, 78, 138],
      },
      {
        xFrac: 0.62,
        dir: -1,
        speed: 0.024,
        laneFrac: 0.25,
        scale: 1.0,
        walkPhase: 1.1,
        outfit: 'office',
        coatRgb: [226, 234, 246],
        lowerRgb: [26, 32, 46],
        umbrellaRgb: [18, 24, 34],
      },
      {
        xFrac: 0.34,
        dir: 1,
        speed: 0.023,
        laneFrac: 0.56,
        scale: 0.95,
        walkPhase: 3.1,
        outfit: 'office',
        coatRgb: [96, 146, 198],
        lowerRgb: [30, 38, 52],
        umbrellaRgb: [28, 44, 72],
      },
    ];

    const vehicles: VehicleAgent[] = [
      { type: 'brtc_bus', lane: 0, x: width * 0.82, speed: 92, wheelRot: 0, bodyRgb: [196, 36, 46] },
      { type: 'cng', lane: 1, x: width * 0.12, speed: 118, wheelRot: 0, bodyRgb: [22, 146, 76] },
      { type: 'sedan', lane: 0, x: width * 0.28, speed: 132, wheelRot: 0, bodyRgb: [158, 174, 192] },
      { type: 'rickshaw', lane: 1, x: width * 0.56, speed: 56, wheelRot: 0, bodyRgb: [194, 38, 62] },
      { type: 'cng', lane: 0, x: width * 0.52, speed: 108, wheelRot: 0, bodyRgb: [24, 152, 82] },
    ];

    const boats: BoatAgent[] = [
      { type: 'paltola', x: width * 0.2, dir: 1, speed: 22, yRatio: 0.62, scale: 0.72, sailRgb: [232, 134, 62], phase: 0.3 },
      { type: 'chhoi', x: width * 0.74, dir: -1, speed: 16, yRatio: 0.7, scale: 0.95, sailRgb: [228, 224, 214], phase: 2.1 },
      { type: 'paltola', x: width * 0.55, dir: 1, speed: 14, yRatio: 0.56, scale: 0.54, sailRgb: [244, 238, 224], phase: 4.2 },
    ];

    const birds: BirdAgent[] = Array.from({ length: 8 }, (_, i) => ({
      x: width * (0.1 + i * 0.12),
      yRatio: 0.14 + (i % 4) * 0.06,
      dir: i % 2 === 0 ? 1 : -1,
      speed: 16 + (i % 4) * 5,
      scale: 0.62 + (i % 3) * 0.18,
      wingPhase: i * 1.3,
      flapSpeed: 3.8 + (i % 3) * 1.1,
      glide: i % 3 === 1,
    }));

    const fireflies: FireflyAgent[] = Array.from({ length: 24 }, (_, i) => ({
      xFrac: ((i * 37) % 100) / 100,
      yFrac: 0.58 + ((i * 23) % 34) / 100,
      vx: ((i % 2 === 0 ? 1 : -1) * (0.008 + (i % 4) * 0.004)),
      vy: ((i % 3 === 0 ? 1 : -1) * 0.005),
      phase: i * 0.9,
      size: 1.5 + (i % 3) * 0.55,
    }));

    const seasonalPetals: PetalAgent[] = Array.from({ length: 26 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 14 + (i % 5) * 6,
      vy: 18 + (i % 4) * 8,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 2.2,
      size: 2.6 + (i % 3) * 1.1,
    }));

    const glassBeads: GlassBead[] = Array.from({ length: 58 }, () => ({
      x: 0.12 + Math.random() * 0.76,
      y: Math.random(),
      r: 1.6 + Math.random() * 2.2,
      vy: 0.24 + Math.random() * 0.34,
      vx: 0.16 + Math.random() * 0.22,
      trail: 12 + Math.random() * 22,
    }));

    let bridgeTrainX = -460;
    let bridgeTrainWait = 1.5;
    const cityStory = {
      rickStopTimer: 0,
      rickCooldown: 0,
      rickPassengerInSeat: false,
      hailerXFrac: 0.08,
      busStopTimer: 0,
      busCooldown: 0,
    };

    const initHour = getDhakaHourDecimal(propsRef.current.timezone || 'Asia/Dhaka');
    const initDay = propsRef.current.weatherIsDay ? 1 : initHour > 6 && initHour < 18 ? 0.5 : 0;
    const sim = {
      dayWeight: initDay,
      windKmh: propsRef.current.windKmh ?? 6,
      windDirSign:
        propsRef.current.windDirectionDeg !== null &&
        propsRef.current.windDirectionDeg >= 10 &&
        propsRef.current.windDirectionDeg < 190
          ? -1
          : 1,
      cloudCover:
        propsRef.current.cloudCover !== null
          ? propsRef.current.cloudCover / 100
          : propsRef.current.weatherMood === 'cloudy' || propsRef.current.rainIntensity > 0.2
            ? 0.8
            : 0.2,
      rainWeight: clamp01(propsRef.current.rainIntensity),
      stormWeight: propsRef.current.weatherMood === 'storm' ? 1 : 0,
      lightningWeight: propsRef.current.hasLightning ? 1 : 0,
      fogWeight: Math.max(
        propsRef.current.weatherMood === 'fog' ? 0.78 : 0,
        clamp01(propsRef.current.fogDensity ?? 0)
      ),
    };

    let tickCount = 0;
    let tSec = 0;
    let lastMs = performance.now();
    let rafId = 0;
    let disposed = false;
    const sceneTransitionOpacity = { current: 1, lastId: propsRef.current.sceneId };

    // Smooth organic treeline silhouette (curved layered tree crowns — never jagged or triangular!)
    const drawHorizonTreeline = (
      baseY: number,
      amp: number,
      seedShift: number,
      fillCss: string
    ) => {
      ctx.fillStyle = fillCss;
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, baseY);
      const step = Math.max(10, Math.floor(width / 64));
      for (let x = 0; x <= width + step; x += step) {
        const crown =
          Math.sin(x * 0.012 + seedShift) * amp * 0.44 +
          Math.sin(x * 0.031 + seedShift * 2.1) * amp * 0.32 +
          Math.sin(x * 0.072 + seedShift * 4.3) * amp * 0.18;
        ctx.lineTo(x, baseY - Math.abs(crown));
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    };

    const renderSeasonalDrift = (pheno: BengaliCalendarState, sky: AtmosphericSkyContext, dt: number) => {
      let col: RGB | null = null;
      let amount = 0;
      if (pheno.summerBloomWeight > 0.22) {
        col = [239, 68, 68];
        amount = pheno.summerBloomWeight * 0.7;
      } else if (pheno.springNewLeafWeight > 0.22) {
        col = [244, 63, 94];
        amount = pheno.springNewLeafWeight * 0.8;
      } else if (pheno.autumnKashWeight > 0.28) {
        col = [248, 250, 252];
        amount = pheno.autumnKashWeight * 0.65;
      } else if (pheno.winterShedWeight > 0.28) {
        col = [180, 118, 44];
        amount = pheno.winterShedWeight * 0.6;
      }
      if (!col || amount < 0.1 || sky.rainWeight > 0.45) return;

      const count = Math.floor(seasonalPetals.length * clamp01(amount));
      const lit = 0.35 + sky.dayWeight * 0.65;
      const css = rgbCss(lerpRgb([24, 24, 28], col, lit), 0.78);
      ctx.save();
      for (let i = 0; i < count; i++) {
        const p = seasonalPetals[i];
        if (!prefersReducedMotion) {
          p.x += dt * (p.vx * sky.windSign + sky.windSign * sky.windFactor * 26);
          p.y += dt * p.vy;
          p.rot += dt * p.vRot;
          if (p.y > height + 16) {
            p.y = -12;
            p.x = Math.random() * width;
          }
          if (p.x > width + 20) p.x = -16;
          if (p.x < -20) p.x = width + 16;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = css;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    };

    const renderFireflies = (sky: AtmosphericSkyContext, dt: number, minYRatio = 0.56, maxYRatio = 0.92) => {
      if (sky.nightVis < 0.25 || sky.rainWeight > 0.55) return;
      const vis = sky.nightVis * (1 - sky.rainWeight * 0.85);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const ff of fireflies) {
        if (!prefersReducedMotion) {
          ff.xFrac += dt * ff.vx;
          ff.yFrac += dt * ff.vy;
          if (ff.xFrac > 0.98 || ff.xFrac < 0.02) ff.vx *= -1;
          if (ff.yFrac > maxYRatio || ff.yFrac < minYRatio) ff.vy *= -1;
        }
        const pulse = 0.22 + 0.72 * Math.pow(0.5 + 0.5 * Math.sin(tSec * 2.4 + ff.phase), 2);
        const fx = ff.xFrac * width;
        const fy = ff.yFrac * height;
        const g = ctx.createRadialGradient(fx, fy, 0.3, fx, fy, ff.size * 3.6);
        g.addColorStop(0, `rgba(217, 249, 157, ${(0.38 * pulse * vis).toFixed(3)})`);
        g.addColorStop(0.35, `rgba(163, 230, 53, ${(0.15 * pulse * vis).toFixed(3)})`);
        g.addColorStop(1, 'rgba(163, 230, 53, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, ff.size * 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    // Scene-specific living birds, nests & chick feeding stories:
    // - Rain / Storm: Parent shelters huddled over chicks in nest; flyers shelter inside canopies
    // - Clear / Mild Day: Natural wind-coupled branch perches with gripping toes, head-tilt looking around, nest feeding arcs & aerial flights
    // - Dusk: Homing V/line flock returning to treetops
    // - Night: Quiet sheltered roosting
    const renderSceneBirds = (
      sky: AtmosphericSkyContext,
      dt: number,
      speciesList: BirdSpecies[],
      maxRatioY = 0.42,
      perchPoints?: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; windTreeX?: number; exact?: boolean; headTilt?: number }>,
      nestSpots?: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; windTreeX?: number; exact?: boolean; skipNestBody?: boolean }>,
      minYRatio = 0.08,
      birdScaleMul = 1.0,
      suppressPerchHops = false
    ) => {
      if (sky.fogWeight > 0.8) return;
      const isRainingOrStorm = sky.rainWeight > 0.12 || sky.stormWeight > 0.25;
      const isNight = sky.dayWeight < 0.16;
      const isEveningOrLater = sky.dayWeight < 0.50 || sky.twilight > 0.14;
      const amb = 0.22 + sky.dayWeight * 0.78;
      const rimCol =
        sky.sunlightFactor > 0.2
          ? `rgba(255, 228, 168, ${(0.45 * sky.sunlightFactor).toFixed(2)})`
          : null;

      // Render woven bird nests anchored inside real branch forks/fronds (ZERO flying after dusk/evening!)
      if (nestSpots && nestSpots.length > 0) {
        nestSpots.forEach((ns, ni) => {
          const wN = ns.exact ? null : sampleLocalWind(ns.windTreeX ?? ns.x, width, tSec, sky.windFactor, sky.windSign, 0.95, ni + 3.2);
          const nx = ns.x + (wN ? sky.windSign * wN.bend * 5.5 : 0);
          const ny = ns.y + (wN ? Math.sin(tSec * 1.8 + ni) * (0.4 + sky.windFactor * 0.9) : 0);
          const feedCycle = ((tSec * 0.048 + ni * 0.37) % 1);
          const parentSheltering = isRainingOrStorm || isNight || isEveningOrLater;
          const feedingNow = !parentSheltering && feedCycle >= 0.56 && feedCycle < 0.84;
          const chicksActive = ns.style === 'cup' && !isNight && !isEveningOrLater;

          if (!ns.skipNestBody) {
            drawBirdNestWithChicks(
              ctx,
              nx,
              ny,
              ns.style,
              ns.scale ?? 0.96,
              tSec,
              chicksActive,
              feedingNow,
              amb,
              sky.windFactor,
              sky.windSign
            );
          }

          const pCol =
            ns.species === 'pigeon'
              ? rgbCss(lerpRgb([48, 56, 72], [116, 128, 146], sky.dayWeight), 0.95)
              : rgbCss(lerpRgb([16, 20, 28], [32, 36, 44], sky.dayWeight), 0.95);

          if (ns.style === 'cup') {
            if (parentSheltering) {
              drawRealisticBird(ctx, nx - 1, ny - 9, 1, 0.72, 0, false, true, pCol, 0.78, null, ns.species, false, 0.06);
            } else {
              const forageSpan = Math.min(96, width * 0.16);
              if (feedCycle < 0.38) {
                const fT = feedCycle / 0.38;
                const fx = nx + Math.sin(fT * Math.PI) * (ni % 2 === 0 ? forageSpan : -forageSpan);
                const fy = ny - 32 - Math.sin(fT * Math.PI) * 26;
                const fDir: 1 | -1 = Math.cos(fT * Math.PI) * (ni % 2 === 0 ? 1 : -1) >= 0 ? 1 : -1;
                drawRealisticBird(ctx, fx, fy, fDir, 0.68, tSec * 9.5, false, false, pCol, 0, rimCol, ns.species, false);
              } else if (feedCycle < 0.56) {
                const rT = (feedCycle - 0.38) / 0.18;
                const sx = nx + (ni % 2 === 0 ? forageSpan * 0.82 : -forageSpan * 0.82);
                const sy = ny - 38;
                const rx = lerp(sx, nx - 11, rT);
                const ry = lerp(sy, ny - 10, rT) - Math.sin(rT * Math.PI) * 14;
                drawRealisticBird(ctx, rx, ry, ni % 2 === 0 ? -1 : 1, 0.7, tSec * 10.5, rT > 0.75, false, pCol, 0, rimCol, ns.species, true);
              } else if (feedCycle < 0.84) {
                const dip = 0.52 * Math.abs(Math.sin((feedCycle - 0.56) * Math.PI * 10));
                const stillHasFood = feedCycle < 0.72;
                drawRealisticBird(ctx, nx - 11, ny - 10, 1, 0.72, 0, false, true, pCol, 0, rimCol, ns.species, stillHasFood, dip);
              } else {
                const lookTilt = Math.sin(tSec * 2.2) * 0.18;
                drawRealisticBird(ctx, nx - 11, ny - 10, 1, 0.72, 0, false, true, pCol, 0, rimCol, ns.species, false, lookTilt);
              }
            }
          } else {
            if (!isNight && Math.sin(tSec * 0.4 + ni) > -0.35) {
              const weaverCol = rgbCss(lerpRgb([48, 42, 16], [196, 158, 38], sky.dayWeight), 0.96);
              drawRealisticBird(ctx, nx + 7, ny + 42, -1, 0.62, 0, false, true, weaverCol, isRainingOrStorm || isEveningOrLater ? 0.65 : 0, rimCol, 'sparrow', false, Math.sin(tSec * 2.1) * 0.15);
            }
          }
        });
      }

      // Sheltered perched/roosting birds during rain, evening dusk, or night — ZERO flying birds anywhere!
      if (isRainingOrStorm || isEveningOrLater || isNight) {
        if (perchPoints && perchPoints.length > 0 && sky.stormWeight < 0.78) {
          const count = Math.min(3, perchPoints.length);
          for (let i = 0; i < count; i++) {
            const pp = perchPoints[i];
            const wP = pp.exact ? null : sampleLocalWind(pp.windTreeX ?? pp.x, width, tSec, sky.windFactor, sky.windSign, 0.95, i + 1.4);
            const sp = pp.species ?? speciesList[i % speciesList.length];
            const footLift = sp === 'egret' ? 11.2 : 6.2;
            const col =
              sp === 'gull' || sp === 'egret'
                ? rgbCss(lerpRgb([118, 126, 142], [228, 232, 238], sky.dayWeight), 0.85)
                : sp === 'pigeon'
                  ? rgbCss(lerpRgb([38, 44, 58], [96, 108, 124], sky.dayWeight), 0.88)
                  : rgbCss(lerpRgb([14, 18, 26], [34, 38, 44], sky.dayWeight), 0.88);
            const huddle = isNight ? 0.85 : 0.72;
            drawRealisticBird(ctx, pp.x + (wP ? sky.windSign * wP.bend * 6 : 0), pp.y - footLift, pp.face ?? (i % 2 === 0 ? 1 : -1), 0.68, 0, false, true, col, huddle, null, sp);
          }
        }
        return;
      }

      // Active daytime perched birds gripping exact twigs
      if (perchPoints && perchPoints.length > 0) {
        perchPoints.forEach((pp, idx) => {
          const sp = pp.species ?? speciesList[idx % speciesList.length];
          const footLift = sp === 'egret' ? 11.2 : 6.2;
          const wP = pp.exact ? null : sampleLocalWind(pp.windTreeX ?? pp.x, width, tSec, sky.windFactor, sky.windSign, 0.95, idx + 1.4);
          const branchShiftX = wP ? sky.windSign * wP.bend * 6.5 : 0;
          const hopWave = Math.sin(tSec * 1.9 + idx * 1.9);
          const hop = Math.abs(hopWave) > 0.94 ? -2.4 : 0;
          const headTilt = pp.headTilt ?? Math.sin(tSec * 1.8 + idx * 2.3) * 0.22;
          let bx = pp.x + branchShiftX;
          let by = pp.y - footLift + hop;
          let bFace: 1 | -1 = hopWave < -0.55 ? ((pp.face ?? 1) === 1 ? -1 : 1) : (pp.face ?? (idx % 2 === 0 ? 1 : -1));
          let isPerched = true;
          let wingPh = 0;

          if (!suppressPerchHops && perchPoints.length > 1 && idx === 0) {
            const target = perchPoints[1];
            const dist = Math.hypot(target.x - pp.x, target.y - pp.y);
            if (dist > 24 && dist < width * 0.42) {
              const flightSec = Math.max(2.4, dist / 52);
              const totalCycle = 12 + flightSec * 2;
              const cycT = tSec % totalCycle;
              if (cycT > 10.5 && cycT < 10.5 + flightSec * 2) {
                const ft = (cycT - 10.5) / (flightSec * 2);
                const tLeg = ft < 0.5 ? ft * 2 : (1 - ft) * 2;
                const arc = Math.sin(tLeg * Math.PI);
                const tgtLift = (target.species ?? speciesList[1 % speciesList.length]) === 'egret' ? 11.2 : 6.2;
                bx = lerp(pp.x + branchShiftX, target.x, tLeg);
                by = lerp(pp.y - footLift, target.y - tgtLift, tLeg) - arc * Math.min(34, 14 + dist * 0.14);
                bFace = (ft < 0.5 ? target.x - pp.x : pp.x - target.x) >= 0 ? 1 : -1;
                isPerched = false;
                wingPh = tSec * 10.5;
              }
            }
          }

          const col =
            sp === 'gull' || sp === 'egret'
              ? rgbCss(lerpRgb([128, 140, 158], [244, 248, 252], sky.dayWeight), 0.95)
              : sp === 'pigeon'
                ? rgbCss(lerpRgb([48, 56, 72], [116, 128, 146], sky.dayWeight), 0.94)
                : rgbCss(lerpRgb([16, 20, 28], [30, 34, 42], sky.dayWeight), 0.94);
          drawRealisticBird(ctx, bx, by, bFace, 0.72, wingPh, false, isPerched, col, 0, rimCol, sp, false, headTilt);
        });
      }

      // Daytime Aerial Sky Birds (STRICTLY daytime only — never fly in evening or night!)
      birds.slice(0, 5).forEach((b, idx) => {
        const sp = speciesList[idx % speciesList.length];
        const distFade = birdScaleMul < 0.7 ? 0.68 : 0.94;
        const birdCol =
          sp === 'gull' || sp === 'egret'
            ? rgbCss(lerpRgb(sky.horRgb, [240, 246, 252], birdScaleMul < 0.7 ? 0.48 : 0.85), distFade)
            : sp === 'pigeon'
              ? rgbCss(lerpRgb([48, 56, 72], [116, 128, 146], sky.dayWeight), distFade)
              : rgbCss(lerpRgb([14, 18, 28], [26, 32, 42], sky.dayWeight), distFade);

        if (sp === 'eagle') {
          const orbitAng = tSec * 0.42 + idx * 1.9;
          const cx = width * (0.48 + Math.sin(tSec * 0.05) * 0.14);
          const cy = Math.max(height * minYRatio, Math.min(height * maxRatioY, height * 0.21));
          const bx = cx + Math.cos(orbitAng) * (width * 0.22);
          const by = cy + Math.sin(orbitAng * 2) * (height * 0.035);
          const vx = -Math.sin(orbitAng);
          const dir: 1 | -1 = vx >= 0 ? 1 : -1;
          const gliding = Math.sin(tSec * 0.9 + idx) > -0.45;
          drawRealisticBird(ctx, bx, by, dir, b.scale * 1.04 * birdScaleMul, tSec * 4.5 + idx, gliding, false, birdCol, 0, rimCol, sp);
          return;
        }

        if (!prefersReducedMotion) {
          b.x += dt * b.dir * (b.speed + sky.windFactor * 12);
          b.wingPhase += dt * b.flapSpeed;
          if (b.dir > 0 && b.x > width + 60) b.x = -60;
          if (b.dir < 0 && b.x < -60) b.x = width + 60;
        }
        const waveAmp = (sp === 'gull' || sp === 'egret' ? 16 : 10) * Math.min(1, birdScaleMul + 0.25);
        const waveFreq = sp === 'gull' ? 1.15 : 1.7;
        const glideMoment = sp === 'gull' ? Math.sin(tSec * 0.8 + idx) > 0.15 : b.glide;
        const mappedRatio = lerp(minYRatio + 0.02, maxRatioY - 0.02, clamp01((b.yRatio - 0.12) / 0.22));
        const by = Math.max(
          height * minYRatio,
          Math.min(
            height * maxRatioY,
            height * mappedRatio + Math.sin(tSec * waveFreq + idx * 1.4) * waveAmp
          )
        );
        drawRealisticBird(ctx, b.x, by, b.dir, b.scale * birdScaleMul, b.wingPhase, glideMoment, false, birdCol, 0, rimCol, sp);
      });
    };

    const treeCommon = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState) => ({
      viewW: width,
      windFactor: sky.windFactor,
      windSign: sky.windSign,
      tSec,
      orbX: sky.orbX,
      orbY: sky.orbY,
      dayWeight: sky.dayWeight,
      sunlightFactor: sky.sunlightFactor,
      twilight: sky.twilight,
      moonVis: sky.effectiveMoonVis,
      rainWeight: sky.rainWeight,
      fogWeight: sky.fogWeight,
      season: pheno.season,
      summerBloomWeight: pheno.summerBloomWeight,
      monsoonVineWeight: pheno.monsoonVineWeight,
      winterShedWeight: pheno.winterShedWeight,
      springNewLeafWeight: pheno.springNewLeafWeight,
      pack: sprigPack,
    });

    /** Shared flowing river surface ripples + drifting water hyacinths (কচুরিপানা) */
    const drawAnimatedWaterSurface = (
      topY: number,
      botY: number,
      amb: number,
      sky: AtmosphericSkyContext,
      withHyacinth = false
    ) => {
      const spanY = Math.max(20, botY - topY);
      ctx.save();
      ctx.lineWidth = 1.25;
      const rows = 28;
      for (let r = 0; r < rows; r++) {
        const f = r / rows;
        const ry = topY + 6 + f * (spanY - 12);
        const rx =
          ((r * 163 + tSec * (20 + f * 22 + sky.windFactor * 24) * sky.windSign) % (width + 180)) - 90;
        const rw = 26 + f * 36 + (r % 3) * 12;
        const waveY = Math.sin(tSec * 2.4 + r * 0.9) * (1.2 + f * 2.0);
        ctx.strokeStyle = `rgba(226, 242, 255, ${(0.09 + amb * 0.16 + f * 0.06).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(rx, ry + waveY);
        ctx.quadraticCurveTo(rx + rw * 0.5, ry - waveY, rx + rw, ry + waveY * 0.5);
        ctx.stroke();
      }

      if (withHyacinth) {
        const leafCol = rgbCss(lerpRgb([10, 22, 14], [38, 86, 36], amb));
        const bloomCol = 'rgba(192, 132, 252, 0.85)';
        for (let h = 0; h < 6; h++) {
          const hx = ((h * 217 + tSec * 7 * sky.windSign) % (width + 120)) - 60;
          const hy = topY + spanY * (0.28 + (h % 3) * 0.22) + Math.sin(tSec * 1.6 + h) * 2.5;
          ctx.fillStyle = leafCol;
          ctx.beginPath();
          ctx.ellipse(hx, hy, 14, 5, 0, 0, Math.PI * 2);
          ctx.ellipse(hx + 10, hy + 2, 11, 4, 0.2, 0, Math.PI * 2);
          ctx.fill();
          if (h % 2 === 0 && amb > 0.3) {
            ctx.fillStyle = bloomCol;
            ctx.beginPath();
            ctx.arc(hx + 2, hy - 4, 2.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    };

    /**
     * Shared Organic Natural Bengali Pond (পুকুর):
     * Irregular multi-lobed natural shoreline with damp clay banks, curved grassy tufts, brick ঘাট,
     * water hyacinths/শাপলা lilies & swimming ducks — ZERO geometric compass-drawn ellipses!
     */
    const draw3DBengaliPond = (
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      amb: number,
      sky: AtmosphericSkyContext,
      withSafetyFence = false,
      seedSalt = 1.7
    ) => {
      ctx.save();
      const tracePondContour = (sx: number, sy: number, offY = 0) => {
        const n = 36;
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          // Natural multi-lobed pond cove/peninsula contour modulation
          const lobe =
            1.0 +
            0.15 * Math.sin(2 * a + seedSalt) +
            0.11 * Math.cos(3 * a - seedSalt * 1.6) +
            0.06 * Math.sin(5 * a + seedSalt * 2.3);
          pts.push({
            x: cx + Math.cos(a) * rx * sx * lobe,
            y: cy + offY + Math.sin(a) * ry * sy * lobe,
          });
        }
        ctx.beginPath();
        const last = pts[n - 1];
        const first = pts[0];
        ctx.moveTo((last.x + first.x) * 0.5, (last.y + first.y) * 0.5);
        for (let i = 0; i < n; i++) {
          const cur = pts[i];
          const nxt = pts[(i + 1) % n];
          ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) * 0.5, (cur.y + nxt.y) * 0.5);
        }
        ctx.closePath();
      };

      // 1) Raised lush irregular grassy embankment mound cradling the pond
      const bankGrad = ctx.createRadialGradient(cx, cy, ry * 0.65, cx, cy, rx * 1.32);
      bankGrad.addColorStop(0, rgbCss(lerpRgb([12, 22, 12], [44, 78, 32], amb)));
      bankGrad.addColorStop(1, rgbCss(lerpRgb([16, 26, 14], [58, 98, 42], amb)));
      ctx.fillStyle = bankGrad;
      tracePondContour(1.19, 1.27, 0);
      ctx.fill();

      // 2) Inner damp eroded clay/mud slope descending into water (subtle wet-earth ring)
      ctx.fillStyle = rgbCss(lerpRgb([14, 13, 10], [72, 54, 38], amb));
      tracePondContour(1.05, 1.11, 2.5);
      ctx.fill();

      // 3) Deep layered natural pond water with sky reflection gradient & dark shore under-shadow
      const wGrad = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
      wGrad.addColorStop(0, rgbCss(lerpRgb(sky.horRgb, [36, 86, 108], 0.54)));
      wGrad.addColorStop(0.55, rgbCss(lerpRgb(sky.midRgb, [22, 66, 88], 0.65)));
      wGrad.addColorStop(1, rgbCss(lerpRgb([10, 22, 30], [16, 48, 66], amb)));
      ctx.fillStyle = wGrad;
      tracePondContour(1.0, 1.0, 4.5);
      ctx.fill();

      // Soft dark overhanging mud/bank shadow along upper shoreline
      ctx.save();
      tracePondContour(1.0, 1.0, 4.5);
      ctx.clip();
      ctx.strokeStyle = 'rgba(6, 14, 18, 0.36)';
      ctx.lineWidth = 6.5;
      tracePondContour(1.0, 1.0, 2.5);
      ctx.stroke();
      drawWaterShimmer(ctx, cx, cy - ry * 0.72, cy + ry * 0.72, tSec, sky);

      // Stepped Weathered Brick Ghat (বাঁধানো ঘাট) tucked into natural left cove
      const ghatX = cx - rx * 0.52;
      const ghatY = cy - ry * 0.24;
      const brickLit = rgbCss(lerpRgb([36, 20, 16], [148, 76, 54], amb));
      const brickShade = rgbCss(lerpRgb([22, 12, 10], [98, 48, 34], amb));
      for (let st = 0; st < 4; st++) {
        const sy = ghatY + st * 5.0;
        const sx = ghatX + st * 3.5;
        ctx.fillStyle = brickLit;
        ctx.fillRect(sx, sy, 23 - st * 1.4, 4.0);
        ctx.fillStyle = brickShade;
        ctx.fillRect(sx + 2, sy + 4.0, 23 - st * 1.4, 2.2);
      }

      // Floating Water Hyacinth (কচুরিপানা) & Water Lilies (শাপলা) drifting softly in coves
      const hLeafCol = rgbCss(lerpRgb([10, 26, 14], [34, 88, 36], amb));
      const coveHx = cx + rx * 0.44;
      const coveHy = cy - ry * 0.14 + Math.sin(tSec * 1.2) * 1.0;
      ctx.fillStyle = hLeafCol;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(coveHx + (k - 1.5) * 7, coveHy + (k % 2) * 3, 6.5, 2.6, k * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (amb > 0.25) {
        ctx.fillStyle = 'rgba(192, 132, 252, 0.85)';
        ctx.beginPath();
        ctx.arc(coveHx + 2, coveHy - 2.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let li = 0; li < 5; li++) {
        const lx = cx + (li - 2) * (rx * 0.22);
        const ly = cy + (li % 2 === 0 ? -ry * 0.16 : ry * 0.24) + Math.sin(tSec * 1.4 + li) * 1.0;
        ctx.fillStyle = hLeafCol;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 8.0, 3.2, 0, 0.28, Math.PI * 1.84);
        ctx.lineTo(lx, ly);
        ctx.closePath();
        ctx.fill();
        if (li % 2 === 0 && amb > 0.25) {
          ctx.fillStyle = li === 0 ? '#fda4af' : '#f8fafc';
          for (let p = -1; p <= 1; p++) {
            ctx.beginPath();
            ctx.ellipse(lx + 1 + p * 1.5, ly - 2.4, 1.4, 2.6, p * 0.42, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(lx + 1, ly - 2.0, 0.85, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Swimming Ducks inside natural water contour
      if (sky.dayWeight > 0.22) {
        for (let di = 0; di < 2; di++) {
          const swimT = tSec * 0.34 + di * 2.4;
          const dx = cx + Math.sin(swimT) * (rx * 0.32);
          const dy = cy + (di === 0 ? 5 : -5) + Math.cos(tSec * 0.45 + di) * 2.8;
          const dir: 1 | -1 = Math.cos(swimT) >= 0 ? 1 : -1;
          drawRealisticDuck(ctx, dx, dy, dir, di === 1 ? 0.94 : 0.84, tSec, di * 2.7, di === 1, amb);
        }
      }
      ctx.restore();

      // Natural organic shoreline reeds & grass tufts breaking the pond rim
      const reedCol = rgbCss(lerpRgb([10, 22, 12], [38, 84, 34], amb), 0.94);
      ctx.strokeStyle = reedCol;
      ctx.lineWidth = 1.4;
      for (let t = 0; t < 16; t++) {
        const ang = (t / 16) * Math.PI * 2 + 0.3;
        const lobe = 1.0 + 0.15 * Math.sin(2 * ang + seedSalt) + 0.11 * Math.cos(3 * ang - seedSalt * 1.6);
        const sx = cx + Math.cos(ang) * rx * 1.03 * lobe;
        const sy = cy + 3 + Math.sin(ang) * ry * 1.04 * lobe;
        const th = 7 + (t % 3) * 3.5;
        const lean = sky.windSign * sky.windFactor * 3 + Math.sin(tSec * 2 + t) * 1.2;
        ctx.beginPath();
        ctx.moveTo(sx - 1.5, sy);
        ctx.quadraticCurveTo(sx + lean * 0.5, sy - th * 0.6, sx - 2 + lean, sy - th);
        ctx.moveTo(sx + 1.5, sy);
        ctx.quadraticCurveTo(sx + 2 + lean * 0.5, sy - th * 0.5, sx + 3 + lean, sy - th * 0.85);
        ctx.stroke();
      }

      if (withSafetyFence) {
        const fx0 = cx - rx * 1.16;
        const fx1 = cx + rx * 0.9;
        const fy = cy - ry * 0.94;
        const bambooCol = rgbCss(lerpRgb([28, 24, 16], [136, 114, 68], amb));
        ctx.strokeStyle = bambooCol;
        ctx.lineWidth = 2.0;
        for (let px = fx0; px <= fx1; px += 18) {
          const py = fy + Math.pow((px - cx) / (rx * 1.25), 2) * ry * 0.55;
          ctx.beginPath();
          ctx.moveTo(px, py + 4);
          ctx.lineTo(px, py - 11);
          ctx.stroke();
        }
        ctx.lineWidth = 1.5;
        for (const railOff of [-4, -9]) {
          ctx.beginPath();
          for (let px = fx0; px <= fx1; px += 8) {
            const py = fy + Math.pow((px - cx) / (rx * 1.25), 2) * ry * 0.55 + railOff;
            if (px === fx0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }

      // Dry earthen/brick top landing slab on left embankment strictly OUTSIDE pond shoreline!
      const dryAng = Math.PI * 1.08;
      const dryLobe =
        1.0 +
        0.15 * Math.sin(2 * dryAng + seedSalt) +
        0.11 * Math.cos(3 * dryAng - seedSalt * 1.6) +
        0.06 * Math.sin(5 * dryAng + seedSalt * 2.3);
      const stepX = cx + Math.cos(dryAng) * rx * dryLobe * 1.07;
      const stepY = cy + 2 + Math.sin(dryAng) * ry * dryLobe * 1.07;
      ctx.fillStyle = rgbCss(lerpRgb([34, 20, 16], [148, 78, 56], amb));
      ctx.beginPath();
      ctx.roundRect(stepX - 18, stepY - 3, 24, 6.5, 2);
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb([22, 12, 10], [96, 48, 34], amb));
      ctx.fillRect(stepX - 16, stepY + 3.5, 22, 2.5);

      ctx.restore();
    };

    const getPondDryBankPoint = (
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      seedSalt: number,
      angleRad = Math.PI * 1.08,
      dryMarginScale = 1.15
    ) => {
      const lobe =
        1.0 +
        0.15 * Math.sin(2 * angleRad + seedSalt) +
        0.11 * Math.cos(3 * angleRad - seedSalt * 1.6) +
        0.06 * Math.sin(5 * angleRad + seedSalt * 2.3);
      return {
        x: cx + Math.cos(angleRad) * rx * lobe * dryMarginScale,
        y: cy + 2 + Math.sin(angleRad) * ry * lobe * dryMarginScale,
      };
    };

    /**
     * Authentic Botanical Agricultural Plot Renderer synced with Bengali Calendar Months & 6 Seasons:
     * Renders true multi-part Paddy (ধান + শীষ + জলমগ্ন চারা + নাড়া/আঁটি), Bearded Wheat (শুংযুক্ত সোনালি গম),
     * Maize with Tassels & Silk Cobs (ভুট্টার মোচা ও চূড়া), Star-leafed Jute (পাট), Yellow Mustard (সরিষা ফুল),
     * plus live Crop Harvesting Farmers (কাস্তে দিয়ে কাটা ও আঁটি বয়ে নেওয়া) during harvest months!
     */
    type CountrysideCropKind = 'paddy' | 'wheat' | 'jute' | 'mustard' | 'maize' | 'strawberry' | 'chili_veg' | 'pond_homestead';
    const renderCountrysideBackdrop = (
      sky: AtmosphericSkyContext,
      pheno: BengaliCalendarState,
      horizonY: number,
      groundBotY: number,
      scrollSpeedPx: number,
      amb: number,
      seedSalt: number
    ) => {
      const common = treeCommon(sky, pheno);
      // Far organic rolling treeline behind solid horizon earth ridge
      const farShift = (tSec * (scrollSpeedPx * 0.16)) % 360;
      ctx.fillStyle = rgbCss(lerpRgb([12, 22, 18], [40, 74, 48], amb * 0.85));
      ctx.beginPath();
      ctx.moveTo(0, horizonY + 8);
      for (let x = -40; x <= width + 60; x += 26) {
        const yOff = Math.sin((x + farShift + seedSalt) * 0.022) * 19 + Math.cos((x + farShift) * 0.055) * 10;
        ctx.lineTo(x, horizonY - Math.abs(yOff));
      }
      ctx.lineTo(width, horizonY + 8);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = rgbCss(lerpRgb([14, 22, 14], [48, 76, 36], amb));
      ctx.fillRect(0, horizonY - 2, width, 10);

      // Select authentic crop plot rotation for the active Bengali month (includes স্ট্রবেরি ও মরিচ/সবজি ক্ষেত!)
      const seasonalCrops: CountrysideCropKind[] =
        pheno.monthIndex >= 8 && pheno.monthIndex <= 9
          ? ['mustard', 'strawberry', 'wheat', 'chili_veg', 'paddy', 'pond_homestead'] // পৌষ-মাঘ: সরিষা, স্ট্রবেরি, গম, মরিচ-সবজি, ধান নাড়া
          : pheno.monthIndex >= 10 && pheno.monthIndex <= 11
            ? ['wheat', 'strawberry', 'maize', 'chili_veg', 'mustard', 'pond_homestead'] // ফাল্গুন-চৈত্র: পাকা গম, স্ট্রবেরি, ভুট্টা, মরিচ
            : pheno.monthIndex >= 0 && pheno.monthIndex <= 1
              ? ['paddy', 'jute', 'chili_veg', 'maize', 'paddy', 'pond_homestead'] // বৈশাখ-জ্যৈষ্ঠ: বোরো ধান কাটা, পাট, মরিচ, ভুট্টা
              : pheno.monthIndex >= 2 && pheno.monthIndex <= 4
                ? ['paddy', 'jute', 'chili_veg', 'paddy', 'pond_homestead'] // আষাঢ়-শ্রাবণ-ভাদ্র: জলমগ্ন আমন চারা, পাট, সবজি-মরিচ
                : ['paddy', 'chili_veg', 'maize', 'paddy', 'strawberry', 'pond_homestead']; // আশ্বিন-কার্তিক-অগ্রহায়ণ: সোনালি আমন ধান ও নবান্ন

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, horizonY + 3, width, groundBotY - horizonY + 8);
      ctx.clip();

      const patchSpan = 420;
      const scroll = tSec * (scrollSpeedPx * 0.56);
      const fieldH = Math.max(40, groundBotY - horizonY);

      for (let pi = -1; pi <= Math.ceil(width / patchSpan) + 2; pi++) {
        const worldIdx = Math.floor(scroll / patchSpan) + pi;
        const px = pi * patchSpan - (scroll % patchSpan);
        const plotIdx = (((worldIdx * 3 + Math.floor(seedSalt)) % seasonalCrops.length) + seasonalCrops.length) % seasonalCrops.length;
        const kind = seasonalCrops[plotIdx];

        const isFloodedSeedling = kind === 'paddy' && pheno.paddyStage === 'seedling';
        const isGoldenPaddy = kind === 'paddy' && (pheno.paddyStage === 'ripening' || pheno.paddyStage === 'harvesting');
        const isStubble = kind === 'paddy' && pheno.paddyStage === 'stubble';
        const isGoldenWheat = kind === 'wheat' && (pheno.wheatStage === 'golden' || pheno.wheatStage === 'harvesting');

        const baseCol: RGB = isFloodedSeedling
          ? lerpRgb([14, 28, 38], lerpRgb(sky.horRgb, [48, 96, 86], 0.45), amb)
          : isGoldenPaddy || isGoldenWheat
            ? lerpRgb([36, 32, 12], [182, 152, 42], amb)
            : isStubble
              ? lerpRgb([24, 20, 14], [122, 98, 56], amb)
              : kind === 'mustard'
                ? lerpRgb([26, 30, 10], [134, 134, 30], amb)
                : kind === 'strawberry'
                  ? lerpRgb([20, 16, 12], [74, 58, 38], amb)
                  : kind === 'chili_veg'
                    ? lerpRgb([12, 26, 12], [42, 82, 34], amb)
                    : lerpRgb([10, 32, 12], [32, 102, 34], amb);

        const fGrad = ctx.createLinearGradient(0, horizonY + 3, 0, groundBotY);
        fGrad.addColorStop(0, rgbCss(lerpRgb(baseCol, sky.horRgb, 0.16)));
        fGrad.addColorStop(0.55, rgbCss(baseCol));
        fGrad.addColorStop(1, rgbCss(lerpRgb(baseCol, [14, 38, 16], 0.24)));
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.moveTo(px + 28, horizonY + 3);
        ctx.lineTo(px + patchSpan + 32, horizonY + 3);
        ctx.lineTo(px + patchSpan - 12, groundBotY + 4);
        ctx.lineTo(px - 16, groundBotY + 4);
        ctx.closePath();
        ctx.fill();

        // Perspective raised mud field bund (মাঠের আইল)
        ctx.strokeStyle = rgbCss(lerpRgb([18, 16, 12], [96, 82, 54], amb));
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(px + 28, horizonY + 3);
        ctx.lineTo(px - 16, groundBotY + 4);
        ctx.stroke();

        // In শরৎ (ভাদ্র-আশ্বিন), tufts of white কাশফুল blossom along field bunds!
        if (pheno.autumnKashWeight > 0.25 && kind !== 'pond_homestead') {
          for (let ki = 0; ki < 5; ki++) {
            const kf = 0.2 + ki * 0.18;
            const kx = lerp(px + 28, px - 16, kf);
            const ky = lerp(horizonY + 3, groundBotY + 4, kf);
            ctx.strokeStyle = rgbCss(lerpRgb([22, 34, 18], [76, 114, 52], amb));
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(kx, ky);
            ctx.lineTo(kx + sky.windSign * 4, ky - 14 * kf);
            ctx.stroke();
            ctx.fillStyle = `rgba(248, 250, 252, ${(0.65 * pheno.autumnKashWeight * amb).toFixed(2)})`;
            ctx.beginPath();
            ctx.ellipse(kx + sky.windSign * 4, ky - 16 * kf, 1.8, 5.2 * kf, 0.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (kind === 'pond_homestead') {
          draw3DBengaliPond(px + patchSpan * 0.36, horizonY + fieldH * 0.58, 86, fieldH * 0.24, amb, sky, false, worldIdx * 0.9);
          draw3DBengaliHomesteadCompound(ctx, px + patchSpan * 0.77, horizonY + fieldH * 0.48, 0.44, tSec, {
            dayWeight: sky.dayWeight,
            twilight: sky.twilight,
            fogWeight: sky.fogWeight,
            sunlightFactor: sky.sunlightFactor,
            effectiveMoonVis: sky.effectiveMoonVis,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            stormWeight: sky.stormWeight,
            rainWeight: sky.rainWeight,
            hasEveningVerandaFamily: false,
            sleepQuietNight: sky.dayWeight < 0.15,
          });
          if (sky.dayWeight >= 0.50 && sky.twilight <= 0.14) {
            drawRealisticBird(
              ctx,
              px + patchSpan * 0.18,
              horizonY + fieldH * 0.72,
              1,
              0.72,
              0,
              false,
              true,
              rgbCss([244, 248, 252]),
              0,
              null,
              'egret',
              false,
              Math.sin(tSec * 2.1 + worldIdx) * 0.28
            );
            drawCourtyardHens(ctx, px + patchSpan * 0.66, horizonY + fieldH * 0.66, 0.56, tSec + worldIdx, amb);
          }
        } else {
          // Layered Dense Grass-Tuft Botanical Crops (`ঘাসের মতো` lush paddy, wheat, mustard, veg tufts!)
          const bands = 9;
          const isHarvestPatch =
            (kind === 'paddy' && pheno.paddyStage === 'harvesting') ||
            (kind === 'wheat' && pheno.wheatStage === 'harvesting');
          for (let b = 0; b < bands; b++) {
            const dFrac = b / (bands - 1);
            const pDepth = Math.pow(dFrac, 1.42);
            const ry = lerp(horizonY + 6, groundBotY - 3, pDepth);
            const skewX = lerp(26, -12, pDepth);
            const baseH =
              kind === 'maize'
                ? 25
                : kind === 'jute'
                  ? 23
                  : kind === 'strawberry'
                    ? 12
                    : kind === 'chili_veg'
                      ? 15
                      : isStubble
                        ? 6.5
                        : isFloodedSeedling
                          ? 11
                          : 17;
            const canopyH = baseH * lerp(0.36, 1.62, Math.pow(dFrac, 1.10));
            const fogFade = 0.16 * (1 - dFrac);

            if (kind === 'strawberry' && b % 2 === 1) {
              // Dark straw-mulched raised bed stripe under strawberry rows
              ctx.fillStyle = rgbCss(lerpRgb([18, 14, 10], [56, 42, 28], amb), 0.58);
              ctx.fillRect(px + skewX + 4, ry - 2.5 * dFrac, patchSpan - 8, 4.5 + dFrac * 5.2);
            }

            // Lush dense grass-tuft carpet cushion underneath leafy/ripening crop carpets
            if (!isStubble && !isFloodedSeedling && kind !== 'maize' && kind !== 'jute') {
              const clumpW = lerp(38, 76, dFrac);
              const clumpH = Math.max(14, canopyH * 1.24);
              const stepSpr = lerp(20, 34, dFrac);
              const isRipeningGold = (kind === 'paddy' && isGoldenPaddy) || (kind === 'wheat' && isGoldenWheat);
              const maxSprX = isHarvestPatch ? patchSpan * 0.54 : patchSpan - 6;
              for (let cxSpr = 8; cxSpr < maxSprX; cxSpr += stepSpr) {
                const sIdx = Math.abs(Math.floor(worldIdx * 11 + b * 7 + cxSpr));
                const sxDraw = px + cxSpr + skewX;
                ctx.save();
                ctx.translate(sxDraw, ry + 3);
                const tiltSpr = sky.windSign * sky.windFactor * 0.12 + Math.sin(tSec * 1.7 + sIdx * 0.6) * 0.03;
                ctx.transform(1, 0, tiltSpr, 1, 0, 0);
                ctx.globalAlpha = isRipeningGold ? 0.56 * (1 - fogFade) : 0.96 * (1 - fogFade);
                ctx.drawImage(sprigPack.grassDark[sIdx % sprigPack.grassDark.length], -clumpW * 0.5, -clumpH + 3, clumpW, clumpH);
                if (sky.sunlightFactor > 0.06) {
                  ctx.globalAlpha = clamp01((isRipeningGold ? 0.36 : 0.86) * Math.max(0.28, sky.sunlightFactor)) * (1 - fogFade);
                  ctx.drawImage(sprigPack.grassLit[sIdx % sprigPack.grassLit.length], -clumpW * 0.5, -clumpH + 3, clumpW, clumpH);
                }
                ctx.restore();
              }
            }

            const spacing =
              kind === 'maize'
                ? lerp(18, 14, dFrac)
                : kind === 'strawberry' || kind === 'chili_veg'
                  ? lerp(14, 10.5, dFrac)
                  : lerp(8.2, 5.6, dFrac);
            for (let sx = 6; sx < patchSpan - 6; sx += spacing) {
              // Half of harvest patches clearly show already-cut stubble (`নাড়া`) & tied golden bundles (`আঁটি`)!
              const isCutSection = isHarvestPatch && sx > patchSpan * 0.56;
              const x = px + sx + skewX + (b % 2) * 3.5;
              const wave = Math.sin((worldIdx * patchSpan + sx + b * 23) * 0.032 - tSec * (2.5 + sky.windFactor) * sky.windSign);
              const tipLean = (wave * (3.0 + sky.windFactor * 4.2) + sky.windSign * 2.8) * lerp(0.28, 1.0, dFrac);

              if (isStubble || isCutSection) {
                // Short cut golden rice/wheat stubble (`নাড়া`) after sickle harvest
                const stubH = canopyH * 0.28;
                ctx.strokeStyle = rgbCss(lerpRgb(lerpRgb([48, 38, 16], [192, 152, 54], amb), sky.horRgb, fogFade), 0.9);
                ctx.lineWidth = lerp(0.8, 1.4, dFrac);
                ctx.beginPath();
                ctx.moveTo(x - 1.5, ry);
                ctx.lineTo(x - 2.2 + tipLean * 0.15, ry - stubH);
                ctx.moveTo(x + 1.5, ry);
                ctx.lineTo(x + 2.0 + tipLean * 0.15, ry - stubH * 0.9);
                ctx.stroke();
                continue;
              }

              const tx = x + tipLean;
              const ty = ry - canopyH * (0.94 + wave * 0.06);

              if (kind === 'paddy') {
                // Vivid grassy Rice Tuft (`ঘাসের মতো সবুজ ধান গাছ`) warming golden-yellow when ripe + clear drooping ধানের শীষ!
                const deepLeaf = isGoldenPaddy
                  ? lerpRgb([30, 44, 14], [98, 118, 32], amb)
                  : lerpRgb([8, 30, 10], [22, 74, 22], amb);
                const midLeaf = isGoldenPaddy
                  ? lerpRgb([58, 66, 16], [176, 160, 42], amb)
                  : lerpRgb([14, 48, 14], [48, 134, 36], amb);
                const litLeaf = isGoldenPaddy
                  ? lerpRgb([82, 82, 22], [222, 194, 54], amb)
                  : lerpRgb([22, 68, 18], [108, 182, 52], amb);
                const grainRgb = isGoldenPaddy ? lerpRgb([96, 76, 20], [248, 214, 72], amb) : lerpRgb([26, 66, 20], [148, 202, 68], amb);

                const bladeSpecs = [
                  { ox: -2.2, spread: -10.5, hMul: 0.62, col: deepLeaf, w: 1.50 },
                  { ox: -1.1, spread: -5.4, hMul: 0.86, col: midLeaf, w: 1.55 },
                  { ox: -0.1, spread: -1.2, hMul: 1.02, col: midLeaf, w: 1.60 },
                  { ox: 0.8, spread: 3.4, hMul: 0.95, col: litLeaf, w: 1.55 },
                  { ox: 2.0, spread: 9.2, hMul: 0.72, col: litLeaf, w: 1.45 },
                ];
                ctx.lineCap = 'round';
                for (let bi = 0; bi < bladeSpecs.length; bi++) {
                  const bs = bladeSpecs[bi];
                  const bx = x + bs.ox * dFrac;
                  const splay = bs.spread * lerp(0.42, 1.08, dFrac) + tipLean * (0.42 + bs.hMul * 0.58);
                  const bh = canopyH * bs.hMul * (0.94 + wave * 0.06);
                  const bTipX = bx + splay;
                  const bTipY = ry - bh + Math.abs(splay) * 0.16;
                  ctx.strokeStyle = rgbCss(lerpRgb(bs.col, sky.horRgb, fogFade * 0.62), 0.96);
                  ctx.lineWidth = lerp(0.95, bs.w, dFrac);
                  ctx.beginPath();
                  ctx.moveTo(bx, ry + 1.8);
                  ctx.bezierCurveTo(
                    bx + splay * 0.15,
                    ry - bh * 0.45,
                    bx + splay * 0.56,
                    ry - bh * 0.88,
                    bTipX,
                    bTipY
                  );
                  ctx.stroke();
                }

                if (!isFloodedSeedling) {
                  // Heavy arching multi-bead rice panicles (`ধানের শীষ`) clearly hanging over lush grassy blades!
                  const panDir = tipLean >= 0 ? 1 : -1;
                  const headTipX = x + tipLean * 0.95;
                  const headTipY = ty;
                  ctx.strokeStyle = rgbCss(lerpRgb(midLeaf, grainRgb, 0.45), 0.88);
                  ctx.lineWidth = lerp(0.75, 1.15, dFrac);
                  ctx.beginPath();
                  ctx.moveTo(headTipX - panDir * 1.0, headTipY + 2.0);
                  ctx.quadraticCurveTo(headTipX + panDir * 4.5 * dFrac, headTipY - 1.2 * dFrac, headTipX + panDir * 9.5 * dFrac, headTipY + 6.5 * dFrac);
                  ctx.stroke();

                  ctx.fillStyle = rgbCss(lerpRgb(grainRgb, sky.horRgb, fogFade * 0.55), 0.98);
                  for (let g = 0; g < 6; g++) {
                    const gf = g / 5;
                    const gx = headTipX + panDir * (gf * 9.2 * dFrac + 0.6);
                    const gy = headTipY + gf * gf * 5.8 * dFrac - Math.sin(gf * Math.PI) * 1.4 * dFrac;
                    ctx.beginPath();
                    ctx.ellipse(gx, gy, 1.15 + dFrac * 1.05, 0.68 + dFrac * 0.55, panDir * (0.35 + g * 0.11), 0, Math.PI * 2);
                    ctx.fill();
                  }
                }
              } else if (kind === 'wheat') {
                // Lush Grassy Multi-Blade Wheat Clump (`ঘাসের মতো গম গাছ`) -> braided yellow-gold grain ears + bristled awns!
                const wLeafDark = isGoldenWheat ? lerpRgb([40, 48, 14], [122, 128, 34], amb) : lerpRgb([10, 32, 12], [24, 78, 22], amb);
                const wLeafLit = isGoldenWheat ? lerpRgb([68, 68, 18], [198, 174, 46], amb) : lerpRgb([18, 56, 16], [94, 168, 48], amb);
                const wHead = isGoldenWheat ? lerpRgb([88, 68, 16], [248, 206, 66], amb) : lerpRgb([24, 58, 20], [134, 194, 68], amb);
                ctx.lineCap = 'round';
                const wBlades = [
                  { ox: -2.0, spread: -9.2, hMul: 0.66, col: wLeafDark },
                  { ox: -0.9, spread: -4.2, hMul: 0.88, col: wLeafLit },
                  { ox: 0.0, spread: -0.5, hMul: 1.02, col: wLeafLit },
                  { ox: 1.2, spread: 5.0, hMul: 0.84, col: wLeafLit },
                  { ox: 2.1, spread: 9.0, hMul: 0.68, col: wLeafDark },
                ];
                for (let wi = 0; wi < wBlades.length; wi++) {
                  const wb = wBlades[wi];
                  const splay = wb.spread * lerp(0.42, 1.06, dFrac) + tipLean * wb.hMul;
                  const bh = canopyH * wb.hMul;
                  ctx.strokeStyle = rgbCss(lerpRgb(wb.col, sky.horRgb, fogFade * 0.62), 0.96);
                  ctx.lineWidth = lerp(0.95, 1.55, dFrac);
                  ctx.beginPath();
                  ctx.moveTo(x + wb.ox * dFrac, ry + 1.8);
                  ctx.bezierCurveTo(
                    x + splay * 0.16,
                    ry - bh * 0.45,
                    x + splay * 0.56,
                    ry - bh * 0.88,
                    x + splay,
                    ry - bh + Math.abs(splay) * 0.14
                  );
                  ctx.stroke();
                }

                // Multi-tiered braided wheat spikelet cluster + crisp fine bristle awns (`গমের শীষ ও শুং`)
                ctx.fillStyle = rgbCss(lerpRgb(wHead, sky.horRgb, fogFade * 0.55), 0.98);
                for (let spk = -1; spk <= 1; spk++) {
                  ctx.beginPath();
                  ctx.ellipse(tx + spk * (0.9 + dFrac * 0.6), ty + Math.abs(spk) * 1.4, 1.15 + dFrac * 0.85, 2.2 + dFrac * 2.2, spk * 0.18 + tipLean * 0.03, 0, Math.PI * 2);
                  ctx.fill();
                }
                if (dFrac > 0.28) {
                  ctx.strokeStyle = rgbCss(lerpRgb([96, 78, 24], [254, 228, 124], amb), 0.86);
                  ctx.lineWidth = 0.7;
                  ctx.beginPath();
                  ctx.moveTo(tx - 1, ty - 2);
                  ctx.lineTo(tx - 2.8 + tipLean * 0.12, ty - 8.2 * dFrac);
                  ctx.moveTo(tx, ty - 2.6);
                  ctx.lineTo(tx + tipLean * 0.14, ty - 9.0 * dFrac);
                  ctx.moveTo(tx + 1, ty - 2);
                  ctx.lineTo(tx + 2.8 + tipLean * 0.12, ty - 8.2 * dFrac);
                  ctx.stroke();
                }
              } else if (kind === 'strawberry') {
                // Authentic Lush Bangladeshi Strawberry Field (`স্ট্রবেরি ক্ষেত`): scalloped emerald leaf mounds + white flowers + ruby berries!
                const leafDark = rgbCss(lerpRgb([10, 26, 12], [28, 92, 34], amb), 0.95);
                const leafLit = rgbCss(lerpRgb([14, 34, 16], [52, 134, 46], amb), 0.92);
                const rBush = 2.6 + dFrac * 4.8;
                ctx.fillStyle = leafDark;
                ctx.beginPath();
                ctx.arc(x - rBush * 0.55 + tipLean * 0.25, ry - rBush * 0.42, rBush * 0.65, 0, Math.PI * 2);
                ctx.arc(x + rBush * 0.55 + tipLean * 0.25, ry - rBush * 0.42, rBush * 0.65, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = leafLit;
                ctx.beginPath();
                ctx.arc(x + tipLean * 0.3, ry - rBush * 0.68, rBush * 0.72, 0, Math.PI * 2);
                ctx.fill();
                // Ruby red strawberries & tiny white blossoms
                if (dFrac > 0.24) {
                  ctx.fillStyle = rgbCss(lerpRgb([74, 14, 18], [225, 29, 72], amb), 0.96);
                  ctx.beginPath();
                  ctx.arc(x - rBush * 0.35, ry - rBush * 0.22, 1.1 + dFrac * 1.4, 0, Math.PI * 2);
                  ctx.arc(x + rBush * 0.42, ry - rBush * 0.34, 1.0 + dFrac * 1.25, 0, Math.PI * 2);
                  ctx.fill();
                  if ((sx + b) % 3 === 0) {
                    ctx.fillStyle = `rgba(255, 255, 255, ${(0.88 * amb).toFixed(2)})`;
                    ctx.beginPath();
                    ctx.arc(x + tipLean * 0.3, ry - rBush * 0.92, 0.9 + dFrac * 0.9, 0, Math.PI * 2);
                    ctx.fill();
                  }
                }
              } else if (kind === 'chili_veg') {
                // Lush Green Chili & Vegetable Field (`মরিচ ও সবজি ক্ষেত`): leafy branched shrubs + bright green & crimson peppers!
                const vegCol = rgbCss(lerpRgb([10, 26, 12], [38, 104, 36], amb), 0.94);
                const vegHi = rgbCss(lerpRgb([16, 36, 16], [64, 142, 48], amb), 0.92);
                ctx.strokeStyle = vegCol;
                ctx.lineWidth = lerp(0.9, 1.8, dFrac);
                ctx.beginPath();
                ctx.moveTo(x, ry);
                ctx.lineTo(tx, ty + 2 * dFrac);
                ctx.stroke();
                ctx.fillStyle = vegHi;
                ctx.beginPath();
                ctx.ellipse(tx - 2.4 * dFrac, ty + 2 * dFrac, 2.2 + dFrac * 2.4, 1.4 + dFrac * 1.5, -0.35, 0, Math.PI * 2);
                ctx.ellipse(tx + 2.4 * dFrac, ty + 1.5 * dFrac, 2.2 + dFrac * 2.4, 1.4 + dFrac * 1.5, 0.35, 0, Math.PI * 2);
                ctx.fill();
                if (dFrac > 0.28 && (sx + b) % 2 === 0) {
                  ctx.fillStyle = (sx % 4 === 0)
                    ? rgbCss(lerpRgb([74, 16, 12], [239, 44, 44], amb), 0.96)
                    : rgbCss(lerpRgb([20, 48, 16], [132, 204, 22], amb), 0.94);
                  ctx.beginPath();
                  ctx.ellipse(tx + 1.5 * dFrac, ty + 3.2 * dFrac, 0.7 + dFrac * 0.7, 1.8 + dFrac * 1.6, 0.25, 0, Math.PI * 2);
                  ctx.fill();
                }
              } else if (kind === 'maize') {
                // True Tall Corn / Maize (`ভুট্টা গাছ`): thick jointed stem, 3 broad arching corn leaves, crown tassel (`চূড়া`) & silk cob (`মোচা`)!
                const mStem = rgbCss(lerpRgb([12, 28, 12], [44, 108, 38], amb), 0.94);
                const mLeaf = rgbCss(lerpRgb([16, 36, 16], [66, 138, 48], amb), 0.92);
                ctx.strokeStyle = mStem;
                ctx.lineWidth = lerp(1.15, 2.5, dFrac);
                ctx.beginPath();
                ctx.moveTo(x, ry);
                ctx.lineTo(tx, ty);
                ctx.stroke();

                // 3 Broad arching maize leaves undulating naturally
                ctx.strokeStyle = mLeaf;
                ctx.lineWidth = lerp(0.95, 2.1, dFrac);
                ctx.beginPath();
                ctx.moveTo(x + tipLean * 0.25, ry - canopyH * 0.32);
                ctx.quadraticCurveTo(x - 6.5 * dFrac, ry - canopyH * 0.46, x - 9.5 * dFrac, ry - canopyH * 0.26);
                ctx.moveTo(x + tipLean * 0.45, ry - canopyH * 0.54);
                ctx.quadraticCurveTo(x + 7 * dFrac, ry - canopyH * 0.66, x + 10.5 * dFrac, ry - canopyH * 0.44);
                ctx.moveTo(x + tipLean * 0.72, ry - canopyH * 0.76);
                ctx.quadraticCurveTo(x - 5.5 * dFrac, ry - canopyH * 0.88, x - 8.5 * dFrac, ry - canopyH * 0.68);
                ctx.stroke();

                // Feathery male tassel crowning top + golden silk corn cob (`ভুট্টার মোচা`) if mature
                ctx.strokeStyle = rgbCss(lerpRgb([56, 48, 22], [216, 184, 86], amb), 0.86);
                ctx.lineWidth = 0.85;
                ctx.beginPath();
                ctx.moveTo(tx, ty);
                ctx.lineTo(tx - 2.8, ty - 4.4 * dFrac);
                ctx.moveTo(tx, ty);
                ctx.lineTo(tx, ty - 5.0 * dFrac);
                ctx.moveTo(tx, ty);
                ctx.lineTo(tx + 2.8, ty - 4.4 * dFrac);
                ctx.stroke();
                if (pheno.maizeStage === 'cobs' && dFrac > 0.3) {
                  const cobX = x + tipLean * 0.48 + 2.5 * dFrac;
                  const cobY = ry - canopyH * 0.48;
                  ctx.fillStyle = rgbCss(lerpRgb([68, 52, 14], [234, 184, 42], amb), 0.96);
                  ctx.beginPath();
                  ctx.ellipse(cobX, cobY, 1.65 * dFrac, 3.5 * dFrac, 0.45, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.strokeStyle = rgbCss(lerpRgb([74, 34, 18], [198, 92, 46], amb), 0.85);
                  ctx.lineWidth = 0.7;
                  ctx.beginPath();
                  ctx.moveTo(cobX + 1.2 * dFrac, cobY - 2.6 * dFrac);
                  ctx.lineTo(cobX + 2.6 * dFrac, cobY - 4.4 * dFrac);
                  ctx.stroke();
                }
              } else if (kind === 'jute') {
                // Tall Star-Leafed Jute (`পাট গাছ`): jointed stalk with alternate stem leaves + lush 6-leaf star-whorl crown!
                const jStem = rgbCss(lerpRgb([18, 28, 16], [78, 108, 48], amb), 0.92);
                const jLeaf = rgbCss(lerpRgb([14, 34, 16], [56, 138, 48], amb), 0.95);
                ctx.strokeStyle = jStem;
                ctx.lineWidth = lerp(0.95, 1.85, dFrac);
                ctx.beginPath();
                ctx.moveTo(x, ry);
                ctx.lineTo(tx, ty);
                ctx.stroke();
                ctx.fillStyle = jLeaf;
                if (dFrac > 0.28) {
                  ctx.beginPath();
                  ctx.ellipse(x + tipLean * 0.45 - 3.2 * dFrac, ry - canopyH * 0.56, 2.3 * dFrac, 0.95 * dFrac, -0.5, 0, Math.PI * 2);
                  ctx.ellipse(x + tipLean * 0.65 + 3.2 * dFrac, ry - canopyH * 0.72, 2.3 * dFrac, 0.95 * dFrac, 0.5, 0, Math.PI * 2);
                  ctx.fill();
                }
                for (let li = 0; li < 6; li++) {
                  const ang = -1.35 + li * 0.54;
                  ctx.beginPath();
                  ctx.ellipse(tx + Math.sin(ang) * 3.8 * dFrac, ty + Math.abs(ang) * 1.35, 2.4 * dFrac + 0.85, 0.95 * dFrac + 0.4, ang, 0, Math.PI * 2);
                  ctx.fill();
                }
              } else {
                // Vivid Grassy Mustard Carpet (`ঘাসের মতো সরিষা ক্ষেত`): lush multi-blade green cushion + 4-petal yellow florets!
                const mDark = lerpRgb([10, 28, 12], [32, 76, 26], amb);
                const mLit = lerpRgb([18, 44, 18], [72, 134, 42], amb);
                ctx.lineCap = 'round';
                ctx.strokeStyle = rgbCss(lerpRgb(mDark, sky.horRgb, fogFade * 0.85), 0.92);
                ctx.lineWidth = lerp(0.9, 1.45, dFrac);
                ctx.beginPath();
                ctx.moveTo(x - 1.2 * dFrac, ry + 1);
                ctx.quadraticCurveTo(x - 3.6 * dFrac + tipLean * 0.3, ry - canopyH * 0.55, tx - 3.8 * dFrac, ty + 2.2 * dFrac);
                ctx.moveTo(x, ry + 1);
                ctx.quadraticCurveTo(x + tipLean * 0.4, ry - canopyH * 0.58, tx, ty);
                ctx.stroke();
                ctx.strokeStyle = rgbCss(lerpRgb(mLit, sky.horRgb, fogFade * 0.85), 0.9);
                ctx.beginPath();
                ctx.moveTo(x + 1.1 * dFrac, ry + 1);
                ctx.quadraticCurveTo(x + 3.4 * dFrac + tipLean * 0.4, ry - canopyH * 0.52, tx + 3.6 * dFrac, ty + 2.0 * dFrac);
                ctx.stroke();
                ctx.fillStyle = rgbCss(lerpRgb([84, 72, 14], [250, 208, 28], amb), 0.96);
                ctx.beginPath();
                ctx.arc(tx - 1.4 * dFrac, ty, 1.45 + dFrac * 1.25, 0, Math.PI * 2);
                ctx.arc(tx + 1.4 * dFrac, ty + 0.7 * dFrac, 1.35 + dFrac * 1.15, 0, Math.PI * 2);
                ctx.arc(tx + 3.1 * dFrac, ty + 2.0 * dFrac, 1.15 + dFrac * 1.0, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }

          // Live Crop Harvesting, Scarecrows, Grazing Cows & Strawberry/Chili Basket Tending Action during daytime!
          if (!isFloodedSeedling && (kind === 'paddy' || kind === 'wheat') && Math.abs(worldIdx) % 3 === 1) {
            drawFieldScarecrow(
              ctx,
              px + patchSpan * 0.29,
              horizonY + fieldH * 0.60,
              0.88,
              tSec + worldIdx,
              sky.windFactor,
              sky.windSign,
              amb
            );
          }
          if (!isFloodedSeedling && Math.abs(worldIdx) % 4 === 2 && sky.dayWeight > 0.22) {
            drawGrazingCow(
              ctx,
              px + patchSpan * 0.72,
              horizonY + fieldH * 0.76,
              worldIdx % 2 === 0 ? 1 : -1,
              0.68,
              tSec + worldIdx * 0.7,
              true,
              worldIdx % 2 === 0 ? [184, 126, 78] : [214, 208, 198],
              amb
            );
          }
          if ((isHarvestPatch || kind === 'strawberry' || kind === 'chili_veg') && sky.dayWeight > 0.25 && sky.rainWeight < 0.2) {
            const farmY = horizonY + fieldH * 0.68;
            if (isHarvestPatch) {
              for (let sh = 0; sh < 3; sh++) {
                ctx.fillStyle = rgbCss(lerpRgb([56, 44, 14], [224, 182, 48], amb));
                ctx.beginPath();
                ctx.ellipse(px + patchSpan * (0.72 + sh * 0.05), farmY + 4, 10, 4.2, -0.15, 0, Math.PI * 2);
                ctx.fill();
              }
              drawFarmerHarvestingPaddy(ctx, px + patchSpan * 0.56, farmY, 1, 0.68, tSec, 'reaping', amb);
              drawFarmerHarvestingPaddy(ctx, px + patchSpan * 0.86, farmY + 6, -1, 0.72, tSec + 1.2, 'carrying_sheaf', amb);
            } else {
              drawFarmerHarvestingPaddy(ctx, px + patchSpan * 0.44, farmY + 2, 1, 0.68, tSec + 0.5, 'reaping', amb);
            }
          }
        }
      }
      ctx.restore();

      // Diverse deeply grounded trees along countryside border scrolling at midground speed
      const treeSlotSpan = 165;
      const treeScroll = tSec * (scrollSpeedPx * 0.72);
      const speciesCycle: TreeSpecies[] = [
        'mango',
        'jackfruit',
        'jamun',
        'lychee',
        'krishnachura',
        'banyan',
        'koroi',
        'kadamba',
        'shimul',
        'hijol',
      ];
      const rootVariants: TreeRootVariant[] = ['buttress', 'spread_left', 'spread_right', 'slender'];
      for (let ti = -1; ti <= Math.ceil(width / treeSlotSpan) + 2; ti++) {
        const slotIdx = Math.floor(treeScroll / treeSlotSpan) + ti;
        const hash = Math.abs(Math.sin(slotIdx * 17.3 + seedSalt) * 43758.54);
        const frac = hash - Math.floor(hash);
        const tx = ti * treeSlotSpan - (treeScroll % treeSlotSpan) + (frac - 0.5) * 44;
        const ty = groundBotY - 4 + ((slotIdx * 7) % 3) * 4;
        const kind = Math.floor(frac * 7);

        if (kind <= 3) {
          const sp = speciesCycle[Math.abs(slotIdx) % speciesCycle.length];
          const rv = rootVariants[Math.abs(slotIdx * 3) % rootVariants.length];
          const th = 78 + (Math.floor(frac * 100) % 58);
          drawLeafyBengalTree(ctx, {
            ...common,
            baseX: tx,
            baseY: ty,
            heightPx: th,
            trunkW: 7 + (th / 28),
            seed: 1.5 + (Math.abs(slotIdx) % 13) * 0.9,
            species: sp,
            rootVariant: rv,
          });
        } else if (kind === 4) {
          drawArticulatedPalm(
            ctx,
            width,
            tx,
            ty,
            92 + (Math.abs(slotIdx) % 4) * 14,
            ((slotIdx % 3) - 1) * 0.1,
            8,
            2.1 + (slotIdx % 5),
            0.95,
            sky.windFactor,
            sky.windSign,
            tSec,
            sky.orbX,
            sky.orbY,
            rgbCss(lerpRgb([16, 14, 12], [62, 50, 38], amb)),
            null,
            rgbCss(lerpRgb([12, 26, 16], [34, 72, 34], amb)),
            rgbCss([132, 186, 76], 0.8),
            sky.sunlightFactor,
            true,
            pheno.palmSapPotActive && slotIdx % 2 === 0
          );
        } else if (kind === 5) {
          drawBananaPlant(ctx, width, tx, ty, 44 + (slotIdx % 3) * 8, 3.1 + (slotIdx % 4), sky.windFactor, sky.windSign, tSec, sky.dayWeight, sky.sunlightFactor, sky.effectiveMoonVis);
        } else {
          drawBambooClump(ctx, width, tx, ty, 82 + (slotIdx % 3) * 14, 5, 2.2 + (slotIdx % 4), sky.windFactor, sky.windSign, tSec, sky.dayWeight, sky.sunlightFactor, sprigPack);
        }
      }
    };

    // =========================================================================
    //  11 VOLUMETRIC CANVAS2D ENVIRONMENTS
    // =========================================================================

    const renderVillage = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const horY = height * 0.55;
      const amb = 0.22 + sky.dayWeight * 0.78 * (1 - sky.fogWeight * 0.25);
      const isEvening = sky.twilight > 0.14 || (sky.dayWeight >= 0.12 && sky.dayWeight <= 0.62);
      const isSleepNight = sky.dayWeight < 0.12 && sky.twilight <= 0.14;
      const common = treeCommon(sky, pheno);

      drawHorizonTreeline(horY, 26, 1.4, rgbCss(lerpRgb([12, 22, 22], [46, 76, 62], amb * 0.85)));
      drawHorizonTreeline(horY + 14, 20, 4.1, rgbCss(lerpRgb([10, 20, 16], [34, 68, 38], amb * 0.92)));

      // Authentic Monthly Agricultural Horizon Field (ধানের শীষ, ফসল কাটা, গম/সরিষা/ভুট্টা/জলমগ্ন চারা)!
      const isFloodedVillagePaddy = pheno.paddyStage === 'seedling' && pheno.mustardWeight < 0.25;
      const isVillageGoldPaddy = pheno.paddyStage === 'ripening' || pheno.paddyStage === 'harvesting';
      const isVillageHarvest = pheno.paddyStage === 'harvesting' || pheno.wheatStage === 'harvesting';
      const isVillageMustard = pheno.mustardWeight > 0.32;

      const baseGrass = lerpRgb([14, 26, 16], [56, 108, 42], amb);
      const goldPaddy = lerpRgb([38, 32, 14], [198, 158, 48], amb);
      const winterMustard = lerpRgb([42, 38, 12], [218, 188, 32], amb);
      const floodedWaterCol = lerpRgb([14, 26, 36], lerpRgb(sky.horRgb, [56, 108, 92], 0.45), amb);
      let fieldCol = isFloodedVillagePaddy
        ? floodedWaterCol
        : lerpRgb(baseGrass, goldPaddy, isVillageGoldPaddy ? 0.92 : pheno.harvestGoldWeight * 0.88);
      if (isVillageMustard) {
        fieldCol = lerpRgb(fieldCol, winterMustard, pheno.mustardWeight * 0.72);
      }

      const gGrad = ctx.createLinearGradient(0, horY + 10, 0, height);
      gGrad.addColorStop(0, rgbCss(fieldCol));
      gGrad.addColorStop(0.42, rgbCss(lerpRgb([10, 20, 12], [42, 84, 34], amb)));
      gGrad.addColorStop(1, rgbCss(lerpRgb([8, 14, 10], [26, 52, 22], amb)));
      ctx.fillStyle = gGrad;
      ctx.fillRect(0, horY + 10, width, height - horY);

      // Detailed botanical seasonal crop rows across village backdrop meadow (with live harvest!)
      const cropCount = Math.min(125, Math.floor(width / 8.5));
      ctx.lineWidth = 1.4;
      for (let i = 0; i < cropCount; i++) {
        const cx = (i + 0.5) * (width / cropCount);
        const cy = horY + 28 + (i % 4) * 7;
        const w = sampleLocalWind(cx, width, tSec, sky.windFactor, sky.windSign, 1.3, i);
        const isCutSpot = isVillageHarvest && cx > width * 0.52 && cx < width * 0.65;

        if (isCutSpot || (pheno.paddyStage === 'stubble' && !isVillageMustard)) {
          // Cut stubble (`নাড়া`) in harvested section
          ctx.strokeStyle = rgbCss(lerpRgb([48, 38, 16], [186, 146, 52], amb), 0.82);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + sky.windSign * 2, cy - 5);
          ctx.stroke();
          continue;
        }

        const tipX = cx + sky.windSign * w.bend * 12;
        const tipY = cy - (isFloodedVillagePaddy ? 9 : 14 + (i % 3) * 4);
        ctx.strokeStyle = rgbCss(lerpRgb(fieldCol, isVillageGoldPaddy ? [232, 188, 56] : [86, 152, 48], 0.65), 0.84);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + sky.windSign * w.bend * 4, (cy + tipY) * 0.5, tipX, tipY);
        ctx.stroke();

        if (isVillageMustard && i % 2 === 0) {
          ctx.fillStyle = `rgba(250, 204, 21, ${(pheno.mustardWeight * amb * 0.94).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(tipX - 1.5, tipY, 2.0, 0, Math.PI * 2);
          ctx.arc(tipX + 1.8, tipY + 0.8, 1.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (isVillageGoldPaddy && !isFloodedVillagePaddy) {
          // Drooping golden beaded rice panicle (`ধানের শীষ`)
          ctx.fillStyle = rgbCss(lerpRgb([74, 58, 18], [244, 204, 66], amb), 0.95);
          ctx.beginPath();
          ctx.ellipse(tipX + 2.5, tipY + 2.0, 3.0, 1.3, 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (pheno.autumnKashWeight > 0.3 && i % 4 === 0) {
          ctx.fillStyle = `rgba(248, 250, 252, ${(0.58 * pheno.autumnKashWeight * amb).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(tipX, tipY - 3, 1.8, 5.5, 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Live Village Harvest Farmer reaping golden paddy & stacked sheaves (`আঁটি`) during harvest season!
      if (isVillageHarvest && sky.dayWeight > 0.24 && sky.rainWeight < 0.2 && sky.stormWeight < 0.3) {
        drawFarmerHarvestingPaddy(ctx, width * 0.56, horY + 38, 1, 0.72, tSec, 'reaping', amb);
        drawFarmerHarvestingPaddy(ctx, width * 0.63, horY + 42, -1, 0.76, tSec + 0.8, 'carrying_sheaf', amb);
      }

      // Organic Multi-Lobed Natural Village Pond completely inside right meadow!
      draw3DBengaliPond(width * 0.79, height * 0.74, width * 0.135, height * 0.068, amb, sky, true, 2.4);

      const midVillageSpecies: TreeSpecies =
        pheno.season === 'barsha'
          ? 'kadamba'
          : pheno.season === 'basanta'
            ? 'shimul'
            : 'krishnachura';
      const rightOrchardSpecies: TreeSpecies =
        pheno.season === 'grishmo'
          ? 'jackfruit'
          : pheno.season === 'basanta' || pheno.season === 'sharat'
            ? 'lychee'
            : 'jamun';

      // Draw background grove & bamboo strictly BEFORE neighbor homestead (`height * 0.62`) so no tree ever draws on top of the house!
      drawBambooClump(ctx, width, width * 0.09, height * 0.595, height * 0.27, 8, 3.1, sky.windFactor, sky.windSign, tSec, sky.dayWeight, sky.sunlightFactor, sprigPack);
      const vBanyan = drawLeafyBengalTree(ctx, { ...common, baseX: width * 0.92, baseY: height * 0.60, heightPx: Math.min(height * 0.39, 255), trunkW: 16, seed: 2.3, species: 'banyan', rootVariant: 'buttress' });
      const vKrishnachura = drawLeafyBengalTree(ctx, { ...common, baseX: width * 0.46, baseY: height * 0.59, heightPx: Math.min(height * 0.34, 215), trunkW: 13, seed: 6.8, species: midVillageSpecies, rootVariant: 'spread_right' });
      drawLeafyBengalTree(ctx, { ...common, baseX: width * 0.54, baseY: height * 0.585, heightPx: Math.min(height * 0.29, 182), trunkW: 11, seed: 9.4, species: rightOrchardSpecies, rootVariant: 'slender' });

      // Neighbor distant homestead on right back cleanly in front of back trees
      draw3DBengaliHomesteadCompound(ctx, width * 0.67, height * 0.62, Math.min(0.68, width / 980 + 0.25), tSec, {
        dayWeight: sky.dayWeight,
        twilight: sky.twilight,
        fogWeight: sky.fogWeight,
        sunlightFactor: sky.sunlightFactor,
        effectiveMoonVis: sky.effectiveMoonVis,
        windFactor: sky.windFactor,
        windSign: sky.windSign,
        stormWeight: sky.stormWeight,
        rainWeight: sky.rainWeight,
        hasEveningVerandaFamily: isEvening,
        sleepQuietNight: isSleepNight,
      });

      // Tall Coconut Palm grounded FIRMLY BEHIND main homestead compound (with winter sap clay pot in পৌষ-মাঘ!)
      const homeBaseY = height * 0.69;
      const vPalm = drawArticulatedPalm(
        ctx,
        width,
        width * 0.24,
        homeBaseY - 12,
        Math.min(height * 0.39, 238),
        0.07,
        9,
        1.7,
        0.95,
        sky.windFactor,
        sky.windSign,
        tSec,
        sky.orbX,
        sky.orbY,
        rgbCss(lerpRgb([18, 16, 14], [62, 50, 38], amb)),
        sky.sunlightFactor > 0.16 ? rgbCss([220, 178, 112], 0.65) : null,
        rgbCss(lerpRgb([12, 26, 16], [34, 72, 34], amb)),
        rgbCss(sky.twilight > 0.3 ? [232, 176, 86] : [132, 186, 76], 0.85),
        sky.sunlightFactor,
        true,
        pheno.palmSapPotActive
      );

      // Soft rising morning/evening cooking-hearth mist wisps in village during cool/winter season
      if ((pheno.winterShedWeight > 0.25 || isEvening) && sky.rainWeight < 0.2) {
        const smX = width * 0.29;
        const smY = homeBaseY - 46;
        for (let s = 0; s < 4; s++) {
          const sf = ((tSec * 0.3 + s * 0.25) % 1);
          ctx.fillStyle = `rgba(226, 232, 240, ${((1 - sf) * 0.16 * amb).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(smX + Math.sin(tSec * 1.4 + s) * 6 + sky.windSign * sf * 18, smY - sf * 34, 4 + sf * 7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Traditional stacked golden haystack (খড়ের গাদা) beside homestead compound
      const hayX = width * 0.16;
      const hayY = homeBaseY + 2;
      ctx.fillStyle = 'rgba(8, 12, 8, 0.28)';
      ctx.beginPath();
      ctx.ellipse(hayX, hayY + 2, 24, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb([48, 38, 18], [192, 152, 68], amb));
      ctx.beginPath();
      ctx.moveTo(hayX - 20, hayY);
      ctx.quadraticCurveTo(hayX - 22, hayY - 26, hayX, hayY - 34);
      ctx.quadraticCurveTo(hayX + 22, hayY - 26, hayX + 20, hayY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb([28, 22, 12], [148, 112, 46], amb));
      ctx.beginPath();
      ctx.moveTo(hayX, hayY - 34);
      ctx.quadraticCurveTo(hayX + 22, hayY - 26, hayX + 20, hayY);
      ctx.lineTo(hayX + 2, hayY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgbCss(lerpRgb([22, 16, 10], [116, 82, 32], amb));
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hayX, hayY - 34);
      ctx.lineTo(hayX, hayY - 40);
      ctx.stroke();

      // Main 3D Bengali Homestead Compound (left-center courtyard)
      draw3DBengaliHomesteadCompound(ctx, width * 0.27, homeBaseY, Math.min(1.06, width / 650 + 0.36), tSec, {
        dayWeight: sky.dayWeight,
        twilight: sky.twilight,
        fogWeight: sky.fogWeight,
        sunlightFactor: sky.sunlightFactor,
        effectiveMoonVis: sky.effectiveMoonVis,
        windFactor: sky.windFactor,
        windSign: sky.windSign,
        stormWeight: sky.stormWeight,
        rainWeight: sky.rainWeight,
        hasEveningVerandaFamily: isEvening,
        sleepQuietNight: isSleepNight,
      });

      drawBananaPlant(ctx, width, width * 0.44, homeBaseY - 4, 54, 4.7, sky.windFactor, sky.windSign, tSec, sky.dayWeight, sky.sunlightFactor, sky.effectiveMoonVis);
      drawBananaPlant(ctx, width, width * 0.47, homeBaseY - 2, 42, 7.1, sky.windFactor, sky.windSign, tSec, sky.dayWeight, sky.sunlightFactor, sky.effectiveMoonVis);

      // 14-Minute (840s) Multi-Chapter Village Story Progression
      const vStoryT = tSec % 840;
      const vChapter = Math.floor(vStoryT / 140); // 6 chapters x 140s
      const vSubT = (vStoryT % 140) / 140;

      // Grazing native cow on open left meadow edge & pecking courtyard hen with chicks!
      if (!isSleepNight && sky.dayWeight > 0.20 && sky.rainWeight < 0.25) {
        drawGrazingCow(
          ctx,
          width * 0.145,
          height * 0.745,
          vChapter % 2 === 0 ? 1 : -1,
          0.95,
          tSec,
          vSubT < 0.72,
          [194, 134, 82],
          amb
        );
        drawCourtyardHens(ctx, width * 0.365, homeBaseY + 19, 0.96, tSec, amb);
      }

      // Kids play actively across field in daytime & gather in evening courtyard storytelling circle!
      if (!isSleepNight && sky.dayWeight > 0.14 && sky.rainWeight < 0.15 && sky.stormWeight < 0.25) {
        if (isEvening || vChapter !== 3 || vSubT < 0.72) {
          drawVillageFieldPlayers(
            ctx,
            width * 0.48,
            height * 0.76,
            width * 0.35,
            tSec,
            sky.dayWeight,
            sky.sunlightFactor,
            sky.windFactor,
            sky.windSign,
            isEvening
          );
        }
      }

      // Earthen footpath
      const pathTopY = height * 0.78;
      const pathCol = lerpRgb([24, 20, 16], [122, 98, 72], amb);
      ctx.fillStyle = rgbCss(pathCol);
      ctx.beginPath();
      ctx.moveTo(0, pathTopY + 12);
      ctx.quadraticCurveTo(width * 0.45, pathTopY - 6, width, pathTopY + 18);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      // Ultra-dense meadow grass carpet along footpath border
      drawGrassTuftBand(
        ctx,
        width,
        0,
        width,
        (gx) => pathTopY + 9 + Math.sin(gx * 0.008) * 5,
        Math.min(130, Math.floor(width / 7)),
        7,
        15,
        2.9,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([10, 20, 12], [28, 66, 26], amb),
        [96, 152, 48],
        sky.sunlightFactor,
        pheno.winterShedWeight > 0.2 ? [250, 204, 21] : null,
        sprigPack
      );

      // Varied Road Villagers with strict lane depth sort & non-overlapping spacing
      if (!isSleepNight && sky.dayWeight > 0.26) {
        const useUmbrella = sky.rainWeight > 0.08 || (sky.sunlightFactor > 0.68 && (propsRef.current.temperatureC ?? 28) > 33);
        const roadCount = vChapter % 2 === 0 ? 3 : 2;
        for (let i = 0; i < roadCount; i++) {
          const p = pedestrians[i];
          const restingNow = i === 1 && vChapter % 3 === 1 && vSubT > 0.45 && vSubT < 0.7;
          if (!prefersReducedMotion && !restingNow) {
            p.xFrac += dt * p.dir * p.speed * (i === 0 ? 0.75 : 0.68);
            p.walkPhase += dt * (p.speed * 185);
            if (p.xFrac > 1.08) p.xFrac = -0.08;
            if (p.xFrac < -0.08) p.xFrac = 1.08;
          }
        }
        const vOrder = Array.from({ length: roadCount }, (_, idx) => idx);
        for (let oi = 0; oi < vOrder.length; oi++) {
          const i = vOrder[oi];
          const p = pedestrians[i];
          const restingNow = i === 1 && vChapter % 3 === 1 && vSubT > 0.45 && vSubT < 0.7;
          const pedAction =
            restingNow
              ? 'looking'
              : i === 2 && (vChapter === 1 || vChapter === 4)
                ? 'carrying_basket'
                : 'walking';
          drawRealisticPerson(ctx, {
            x: p.xFrac * width,
            y: height * (0.82 + i * 0.038),
            facing: p.dir,
            scale: p.scale * (0.88 + i * 0.08),
            walkPhase: restingNow ? 0 : p.walkPhase,
            outfit: p.outfit,
            coatRgb: p.coatRgb,
            lowerRgb: p.lowerRgb,
            hasUmbrella: useUmbrella,
            umbrellaRgb: p.umbrellaRgb,
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: pedAction,
            idleSec: tSec,
            shadowShiftX: (width * 0.5 - sky.orbX) / width,
          });
        }
      }

      // Authentic Multi-Chapter Homestead Woman Story (STRICTLY dry pond embankment step — NEVER inside water!):
      // Alternates across 840s chapters between fetching water at pond ghat (dipping_pot), sweeping courtyard, feeding ducks on dry bank & resting!
      if (!isSleepNight && sky.dayWeight > 0.24 && sky.rainWeight < 0.25 && sky.stormWeight < 0.35) {
        const dryGhat = getPondDryBankPoint(width * 0.79, height * 0.74, width * 0.135, height * 0.068, 2.4, Math.PI * 1.08, 1.15);
        const yardX = width * 0.34;
        const yardY = homeBaseY + 14;
        const sweepX = width * 0.37;

        const evalVillageWoman = (timeSec: number) => {
          const st = timeSec % 840;
          const ch = Math.floor(st / 140);
          const u = (st % 140) / 140;

          if (ch === 0 || ch === 2 || ch === 4) {
            // Chapter A: Walk cleanly across foreground courtyard (clear of banana clump) -> dry ghat step (dipping_pot) -> carry pitcher home -> sweep/rest
            if (u < 0.22) {
              const f = u / 0.22;
              return { x: lerp(yardX, dryGhat.x, f), y: lerp(yardY, dryGhat.y, f) + Math.sin(f * Math.PI) * 14, action: 'walking' as const, fixedFace: null as 1 | -1 | null };
            } else if (u < 0.42) {
              return { x: dryGhat.x, y: dryGhat.y, action: 'dipping_pot' as const, fixedFace: 1 as const };
            } else if (u < 0.66) {
              const f = (u - 0.42) / 0.24;
              return { x: lerp(dryGhat.x, yardX, f), y: lerp(dryGhat.y, yardY, f) + Math.sin(f * Math.PI) * 14, action: 'carrying_pot' as const, fixedFace: null as 1 | -1 | null };
            } else if (u < 0.86) {
              return { x: sweepX, y: yardY + 2, action: 'sweeping' as const, fixedFace: 1 as const };
            } else {
              return { x: yardX, y: yardY, action: 'looking' as const, fixedFace: 1 as const };
            }
          } else if (ch === 1 || ch === 3) {
            // Chapter B: Sweep courtyard -> stroll to dry ghat rim & feed pond ducks -> return chatting!
            if (u < 0.30) {
              return { x: sweepX + Math.sin(u * Math.PI * 4) * 10, y: yardY + 1, action: 'sweeping' as const, fixedFace: 1 as const };
            } else if (u < 0.50) {
              const f = (u - 0.30) / 0.20;
              return { x: lerp(sweepX, dryGhat.x - 10, f), y: lerp(yardY + 1, dryGhat.y + 1, f) + Math.sin(f * Math.PI) * 14, action: 'walking' as const, fixedFace: null as 1 | -1 | null };
            } else if (u < 0.72) {
              return { x: dryGhat.x - 10, y: dryGhat.y + 1, action: 'feeding_birds' as const, fixedFace: 1 as const };
            } else {
              const f = (u - 0.72) / 0.28;
              return { x: lerp(dryGhat.x - 10, yardX, f), y: lerp(dryGhat.y + 1, yardY, f) + Math.sin(f * Math.PI) * 14, action: 'walking' as const, fixedFace: null as 1 | -1 | null };
            }
          } else {
            // Chapter C: Calm courtyard & veranda chore -> slow meadow outlook walk -> dipping pitcher once
            if (u < 0.35) {
              return { x: yardX, y: yardY, action: 'sitting_bench' as const, fixedFace: 1 as const };
            } else if (u < 0.58) {
              const f = (u - 0.35) / 0.23;
              return { x: lerp(yardX, dryGhat.x, f), y: lerp(yardY, dryGhat.y, f) + Math.sin(f * Math.PI) * 14, action: 'walking' as const, fixedFace: null as 1 | -1 | null };
            } else if (u < 0.76) {
              return { x: dryGhat.x, y: dryGhat.y, action: 'dipping_pot' as const, fixedFace: 1 as const };
            } else {
              const f = (u - 0.76) / 0.24;
              return { x: lerp(dryGhat.x, yardX, f), y: lerp(dryGhat.y, yardY, f) + Math.sin(f * Math.PI) * 14, action: 'carrying_pot' as const, fixedFace: null as 1 | -1 | null };
            }
          }
        };

        const curW = evalVillageWoman(tSec);
        const nxtW = evalVillageWoman(tSec + 0.08);
        const wDx = nxtW.x - curW.x;
        const wMoving = Math.abs(wDx) > 0.04;
        const wFace: 1 | -1 = curW.fixedFace ?? (wMoving ? (wDx >= 0 ? 1 : -1) : 1);

        drawRealisticPerson(ctx, {
          x: curW.x,
          y: curW.y,
          facing: wFace,
          scale: 0.78,
          walkPhase: wMoving && (curW.action === 'walking' || curW.action === 'carrying_pot') ? tSec * 6.0 : 0,
          outfit: 'sari',
          coatRgb: [198, 72, 86],
          lowerRgb: [224, 178, 92],
          hasUmbrella: false,
          umbrellaRgb: [20, 20, 20],
          dayWeight: sky.dayWeight,
          sunlightFactor: sky.sunlightFactor,
          moonVis: sky.effectiveMoonVis,
          rainWeight: sky.rainWeight,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          fogWeight: sky.fogWeight,
          action: curW.action,
          idleSec: tSec,
        });
      }

      const mangoH = Math.min(height * 0.48, 310);
      const vNestSheltering = sky.rainWeight > 0.12 || sky.stormWeight > 0.25 || sky.dayWeight < 0.16;
      const vNestFeeding = !vNestSheltering && sky.twilight <= 0.18 && sky.dayWeight >= 0.46 && ((tSec * 0.048) % 1) >= 0.56 && ((tSec * 0.048) % 1) < 0.84;
      const vMango = drawLeafyBengalTree(ctx, {
        ...common,
        baseX: width * 0.035,
        baseY: height * 0.96,
        heightPx: mangoH,
        trunkW: 21,
        seed: 5.5,
        species: 'mango',
        rootVariant: 'spread_left',
        renderForkNest: (c) => {
          drawBirdNestWithChicks(ctx, c.x, c.y - 1, 'cup', 0.95, tSec, sky.dayWeight >= 0.16, vNestFeeding, amb, sky.windFactor, sky.windSign);
        },
      });

      const vPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [];
      if (vKrishnachura.perches[0]) vPerches.push({ ...vKrishnachura.perches[0], species: 'doel', exact: true });
      if (vBanyan.perches[0]) vPerches.push({ ...vBanyan.perches[0], species: 'sparrow', exact: true });
      if (vMango.perches[0]) vPerches.push({ ...vMango.perches[0], species: 'doel', exact: true });

      const vNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean; skipNestBody?: boolean }> = [];
      if (vMango.forkCrotches[0]) {
        vNests.push({ x: vMango.forkCrotches[0].x, y: vMango.forkCrotches[0].y - 1, species: 'doel', style: 'cup', scale: 0.95, exact: true, skipNestBody: true });
      }
      if (vPalm.frondTips.length > 0) {
        const wTip = vPalm.frondTips[2 % vPalm.frondTips.length];
        vNests.push({ x: wTip.x, y: wTip.y, species: 'sparrow', style: 'weaver', scale: 0.9, exact: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['doel', 'sparrow', 'doel', 'sparrow'],
        0.42,
        vPerches,
        vNests
      );
      renderSeasonalDrift(pheno, sky, dt);
      renderFireflies(sky, dt);
      return height * 0.78;
    };

    const renderCity = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const roadTop = height * 0.70;
      const roadBot = height * 0.84;
      const amb = 0.2 + sky.dayWeight * 0.8 * (1 - sky.fogWeight * 0.22);
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.25 + sky.rainWeight * 0.45 + sky.stormWeight * 0.35);
      const common = treeCommon(sky, pheno);

      // Far 3D city skyline behind main street
      const farCount = Math.max(7, Math.ceil(width / 82));
      for (let b = 0; b < farCount; b++) {
        const bx = (b / farCount) * width;
        const bw = width / farCount - 8;
        const bh = height * (0.22 + ((b * 17) % 11) * 0.02);
        draw3DCityBuilding(ctx, bx, roadTop - 8, bw, bh, 12, b + 11, amb * 0.85, lightGlow, [72, 86, 108], [46, 58, 76]);
      }

      // Near 3D Dhaka office & commercial buildings cleanly behind back sidewalk
      const nearCount = Math.max(5, Math.ceil(width / 128));
      for (let b = 0; b < nearCount; b++) {
        const bx = (b / nearCount) * width + 6;
        const bw = width / nearCount - 22;
        const bh = height * (0.18 + ((b * 13) % 7) * 0.026);
        draw3DCityBuilding(ctx, bx, roadTop - 4, bw, bh, 16, b + 3, amb, lightGlow, [62, 72, 88], [38, 46, 58]);
      }

      // Back sidewalk & curb
      ctx.fillStyle = rgbCss(lerpRgb([18, 22, 30], [74, 80, 90], amb));
      ctx.fillRect(0, roadTop - 10, width, 12);

      // Left Stall: টং চা দোকান; Mid-Right: 3D যাত্রী ছাউনি (Bus Stop Shelter); Right Bay: ঝালমুড়ি গাড়ি!
      // All sidewalk tree planters are recessed onto back edge (`0.06, 0.47, 0.94` at `roadTop - 3`) so NO walking patron crosses any trunk!
      const cityStallScale = Math.max(0.68, width / 960 + 0.32);
      const teaStallX = width * 0.18;
      const busStopX = width * 0.60;
      const jhalmuriX = width * 0.77;
      drawRoadsideTeaStall(ctx, teaStallX, roadTop - 1, cityStallScale, tSec, amb, lightGlow, false);
      drawBusStopShelter(ctx, busStopX, roadTop - 1, cityStallScale * 0.92, amb, lightGlow);
      drawJhalmuriCart(ctx, jhalmuriX, roadTop - 1, cityStallScale, tSec, amb, lightGlow, false);

      const streetSpecies: TreeSpecies[] =
        pheno.season === 'basanta'
          ? ['shimul', 'koroi', 'krishnachura']
          : pheno.season === 'barsha'
            ? ['kadamba', 'mango', 'koroi']
            : ['krishnachura', 'koroi', 'jamun'];
      const streetRoots: TreeRootVariant[] = ['slender', 'spread_left', 'buttress'];
      const streetAnchors: ReturnType<typeof drawLeafyBengalTree>[] = [];
      const cityNestSheltering = sky.rainWeight > 0.12 || sky.stormWeight > 0.25 || sky.dayWeight < 0.16;
      const cityNestFeeding = !cityNestSheltering && sky.twilight <= 0.18 && sky.dayWeight >= 0.46 && ((tSec * 0.048) % 1) >= 0.56 && ((tSec * 0.048) % 1) < 0.84;
      const cityPlanterFracs = [0.06, 0.46, 0.93];
      for (let t = 0; t < 3; t++) {
        const tx = width * cityPlanterFracs[t];
        const ty = roadTop - 2;
        ctx.fillStyle = rgbCss(lerpRgb([14, 12, 10], [52, 40, 30], amb));
        ctx.beginPath();
        ctx.ellipse(tx, ty + 2, 19, 4.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgbCss(lerpRgb([34, 24, 20], [136, 68, 52], amb));
        ctx.lineWidth = 2.4;
        ctx.stroke();

        streetAnchors.push(
          drawLeafyBengalTree(ctx, {
            ...common,
            baseX: tx,
            baseY: ty,
            heightPx: Math.min(height * 0.31, 200),
            trunkW: 12,
            seed: 7.2 + t * 2.1,
            species: streetSpecies[t % streetSpecies.length],
            inPlanter: true,
            rootVariant: streetRoots[t % streetRoots.length],
            renderForkNest: t === 0
              ? (c) => {
                  drawBirdNestWithChicks(ctx, c.x, c.y - 1, 'cup', 0.84, tSec, sky.dayWeight >= 0.16, cityNestFeeding, amb, sky.windFactor, sky.windSign);
                }
              : undefined,
          })
        );
      }

      // Ambiently Illuminated Asphalt Road + readable lane divider & crosswalk at night (ZERO torchlight/flashlight cones!)
      const nightRoadBoost = lightGlow * 0.45;
      const roadGrad = ctx.createLinearGradient(0, roadTop, 0, roadBot);
      roadGrad.addColorStop(0, rgbCss(lerpRgb([28, 34, 46], [56, 62, 74], Math.max(amb, nightRoadBoost))));
      roadGrad.addColorStop(0.55, rgbCss(lerpRgb([24, 30, 42], [44, 50, 62], Math.max(amb, nightRoadBoost * 0.9))));
      roadGrad.addColorStop(1, rgbCss(lerpRgb([30, 36, 48], [66, 72, 84], Math.max(amb, nightRoadBoost))));
      ctx.fillStyle = roadGrad;
      ctx.fillRect(0, roadTop, width, roadBot - roadTop);

      // Soft wide horizontal ambient streetlight wash across entire roadway corridor
      if (lightGlow > 0.08) {
        const streetWash = ctx.createLinearGradient(0, roadTop - 8, 0, roadBot + 6);
        streetWash.addColorStop(0, `rgba(248, 206, 118, ${(0.07 * lightGlow).toFixed(2)})`);
        streetWash.addColorStop(0.5, `rgba(244, 192, 92, ${(0.12 * lightGlow).toFixed(2)})`);
        streetWash.addColorStop(1, `rgba(240, 182, 82, ${(0.06 * lightGlow).toFixed(2)})`);
        ctx.fillStyle = streetWash;
        ctx.fillRect(0, roadTop - 8, width, roadBot - roadTop + 14);
      }

      const midLaneY = (roadTop + roadBot) * 0.5;
      ctx.fillStyle = `rgba(226, 232, 240, ${(0.44 + amb * 0.30).toFixed(2)})`;
      for (let lx = 20; lx < width; lx += 56) {
        ctx.fillRect(lx, midLaneY - 1.5, 30, 3);
      }

      // Realistic Dhaka Zebra Crosswalk Stripes & Damp Road Manhole Detail
      const zX = width * 0.32;
      ctx.fillStyle = `rgba(226, 232, 240, ${(0.28 + amb * 0.24).toFixed(2)})`;
      for (let zi = 0; zi < 5; zi++) {
        ctx.fillRect(zX, roadTop + 5 + zi * ((roadBot - roadTop - 10) / 5), 22, 4.5);
      }
      ctx.fillStyle = `rgba(15, 23, 42, ${(0.45 * amb + 0.15).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(width * 0.68, roadBot - 9, 10, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Street pigeons pecking crumbs near sidewalk cart in calm daytime (quiet before dusk)
      if (sky.dayWeight >= 0.50 && sky.twilight <= 0.14 && sky.rainWeight < 0.2) {
        [0, 1].forEach((pi) => {
          const px = jhalmuriX + (pi === 0 ? 18 : 29) + Math.sin(tSec * 1.1 + pi * 2.4) * 5;
          drawRealisticBird(ctx, px, roadTop + 1, pi === 0 ? -1 : 1, 0.58, 0, false, true, rgbCss(lerpRgb([56, 64, 78], [136, 148, 166], amb)), 0, null, 'pigeon', false, Math.max(0, Math.sin(tSec * 5.2 + pi * 1.9)) * 0.55);
        });
      }

      // Realistic Soft Sodium/LED Streetlamps — natural wide spherical halo & broad soft road bounce (NO flashlight beam cones!)
      const cityLampFracs = width < 640 ? [0.12, 0.37, 0.63, 0.88] : [0.10, 0.30, 0.50, 0.70, 0.90];
      for (const lp of cityLampFracs) {
        const lx = width * lp;
        const poleTop = roadTop - height * 0.14;
        ctx.strokeStyle = rgbCss(lerpRgb([24, 30, 42], [76, 84, 96], amb));
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(lx, roadTop + 2);
        ctx.lineTo(lx, poleTop + 12);
        ctx.quadraticCurveTo(lx + 4, poleTop, lx + 20, poleTop + 4);
        ctx.stroke();

        const hx = lx + 20;
        const hy = poleTop + 5;
        // Lamp hood
        ctx.fillStyle = rgbCss(lerpRgb([30, 36, 48], [96, 106, 120], amb));
        ctx.beginPath();
        ctx.ellipse(hx, hy - 1.5, 5.2, 2.2, 0, Math.PI, 0);
        ctx.fill();

        if (lightGlow > 0.08) {
          // Smooth spherical evening lamp aura (no harsh geometric cone!)
          const hg = ctx.createRadialGradient(hx, hy, 1.5, hx, hy, 68);
          hg.addColorStop(0, `rgba(255, 244, 198, ${(0.70 * lightGlow).toFixed(2)})`);
          hg.addColorStop(0.20, `rgba(248, 206, 106, ${(0.28 * lightGlow).toFixed(2)})`);
          hg.addColorStop(0.55, `rgba(244, 182, 72, ${(0.10 * lightGlow).toFixed(2)})`);
          hg.addColorStop(1, 'rgba(244, 174, 54, 0)');
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.arc(hx, hy, 68, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = `rgba(255, 250, 226, ${(0.86 * lightGlow).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
          ctx.fill();

          // Broad overlapping soft ambient street-surface illumination pools (naturally fades across whole road width)
          const poolY = roadTop + (roadBot - roadTop) * 0.45;
          const poolR = width < 640 ? 78 : 112;
          const roadPool = ctx.createRadialGradient(hx, poolY, 6, hx, poolY, poolR);
          const poolBoost = 1 + sky.rainWeight * 0.4;
          roadPool.addColorStop(0, `rgba(252, 212, 122, ${(0.16 * lightGlow * poolBoost).toFixed(2)})`);
          roadPool.addColorStop(0.55, `rgba(244, 184, 78, ${(0.07 * lightGlow * poolBoost).toFixed(2)})`);
          roadPool.addColorStop(1, 'rgba(244, 174, 56, 0)');
          ctx.fillStyle = roadPool;
          ctx.beginPath();
          ctx.ellipse(hx, poolY, poolR, (roadBot - roadTop) * 0.68, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const farLaneY = roadTop + (roadBot - roadTop) * 0.42;
      const nearLaneY = roadTop + (roadBot - roadTop) * 0.88;
      const scaleFactor = Math.max(0.56, Math.min(1.02, width / 940 + 0.34));

      const isDeepNight = sky.dayWeight < 0.12 && sky.twilight < 0.12;
      const trafficVis = isDeepNight ? 0.42 : 1.0;

      // Dynamic Back-Sidewalk Tea Stall & Jhalmuri Cart Customers + Velocity-Matched Bus Shelter Waiter across 840s story!
      if (!isDeepNight) {
        const cityCh = Math.floor((tSec % 840) / 140);

        // 1) Tea Stall Dynamic Patron: brisk walk in clear curb bay -> brief tea sip / chat -> stands & walks off!
        const teaU = (tSec % 84) / 84;
        if (teaU < 0.78) {
          const benchSeatX = teaStallX + 68 * cityStallScale;
          const teaStartX = cityCh % 2 === 0 ? width * 0.10 : width * 0.42;
          const teaEndX = cityCh % 2 === 0 ? width * 0.42 : width * 0.10;
          const evalTeaPatron = (u: number) => {
            if (u < 0.24) return { x: lerp(teaStartX, benchSeatX, u / 0.24), act: 'walking' as const };
            if (u < 0.50) return { x: benchSeatX, act: (cityCh % 2 === 0 ? 'sitting_bench' : 'eating_snack') as 'sitting_bench' | 'eating_snack' };
            return { x: lerp(benchSeatX, teaEndX, (u - 0.50) / 0.28), act: 'walking' as const };
          };
          const tp0 = evalTeaPatron(teaU);
          const tp1 = evalTeaPatron(Math.min(0.779, teaU + 0.004));
          const tpDx = tp1.x - tp0.x;
          const tpMoving = tp0.act === 'walking' && Math.abs(tpDx) > 0.03;
          const tpFace: 1 | -1 = tpMoving ? (tpDx >= 0 ? 1 : -1) : -1;
          drawRealisticPerson(ctx, {
            x: tp0.x,
            y: roadTop + 3,
            facing: tpFace,
            scale: 0.71 * scaleFactor,
            walkPhase: tpMoving ? tSec * 6.1 : 0,
            outfit: cityCh % 2 === 0 ? 'panjabi' : 'office',
            coatRgb: cityCh % 2 === 0 ? [192, 138, 62] : [94, 146, 186],
            lowerRgb: [30, 36, 48],
            hasUmbrella: false,
            umbrellaRgb: [20, 24, 34],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: tp0.act,
            idleSec: tSec,
          });
        }

        // 2) Jhalmuri Cart Dynamic Patron (cleanly inside bay `0.52..0.88`, brief ~6s stop with subtle stroll — ZERO static corner figure!):
        const jhU = ((tSec + 28) % 68) / 68;
        if (jhU < 0.72 && sky.rainWeight < 0.28) {
          const jhWaitX = jhalmuriX - 12 * cityStallScale;
          const jhStartX = cityCh % 2 === 0 ? width * 0.88 : width * 0.52;
          const jhEndX = cityCh % 2 === 0 ? width * 0.52 : width * 0.88;
          const evalJhPatron = (u: number) => {
            if (u < 0.26) return { x: lerp(jhStartX, jhWaitX, u / 0.26), act: 'walking' as const };
            if (u < 0.40) return { x: jhWaitX, act: 'eating_snack' as const };
            return { x: lerp(jhWaitX, jhEndX, (u - 0.40) / 0.32), act: 'walking' as const };
          };
          const jp0 = evalJhPatron(jhU);
          const jp1 = evalJhPatron(Math.min(0.719, jhU + 0.004));
          const jpDx = jp1.x - jp0.x;
          const jpMoving = jp0.act === 'walking' && Math.abs(jpDx) > 0.03;
          const jpFace: 1 | -1 = jpMoving ? (jpDx >= 0 ? 1 : -1) : 1;
          const jhColors: RGB[] = [[72, 134, 168], [224, 168, 62], [58, 148, 122]];
          drawRealisticPerson(ctx, {
            x: jp0.x,
            y: roadTop + 3,
            facing: jpFace,
            scale: 0.70 * scaleFactor,
            walkPhase: jpMoving ? tSec * 6.4 : 0,
            outfit: cityCh % 2 === 0 ? 'office' : 'shirt',
            coatRgb: jhColors[cityCh % jhColors.length],
            lowerRgb: [28, 34, 48],
            hasUmbrella: false,
            umbrellaRgb: [20, 24, 34],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: jp0.act,
            idleSec: tSec,
          });
        }

        // 3) Bus Shelter Commuter — velocity-derived facing (ZERO moonwalk!), rotating bench sitting / pacing / watch-check!
        const isBoarding = cityStory.busStopTimer > 0;
        const waitCycle = (tSec % 24) / 24;
        const evalWaiterX = (wt: number) => {
          const wc = (wt % 24) / 24;
          if (cityCh % 3 === 1 && wc > 0.25 && wc < 0.72) return busStopX + 8;
          return busStopX + 10 + Math.sin(wt * 0.56) * 9;
        };
        const curWaitX = evalWaiterX(tSec);
        const nxtWaitX = evalWaiterX(tSec + 0.08);
        const waitVx = nxtWaitX - curWaitX;
        const isPacing = !isBoarding && Math.abs(waitVx) > 0.05;
        const isSittingShelter = !isBoarding && cityCh % 3 === 1 && waitCycle > 0.25 && waitCycle < 0.72;
        const shelterWaiterX = isBoarding
          ? lerp(busStopX + 6, busStopX - 8, 1 - cityStory.busStopTimer / 2.8)
          : curWaitX;
        const shelterWaiterY = isBoarding ? lerp(roadTop + 2, farLaneY - 2, 1 - cityStory.busStopTimer / 2.8) : roadTop + 2;
        const waitFace: 1 | -1 = isBoarding ? -1 : isPacing ? (waitVx >= 0 ? 1 : -1) : -1;
        const shelterOutfits: HumanOutfit[] = ['office', 'panjabi', 'sari'];
        const shelterCoats: RGB[] = [[86, 132, 178], [218, 224, 232], [186, 72, 92]];
        if (!isBoarding || cityStory.busStopTimer > 0.5) {
          drawRealisticPerson(ctx, {
            x: shelterWaiterX,
            y: shelterWaiterY,
            facing: waitFace,
            scale: 0.72 * scaleFactor,
            walkPhase: isBoarding || isPacing ? tSec * 6.5 : 0,
            outfit: shelterOutfits[cityCh % shelterOutfits.length],
            coatRgb: shelterCoats[cityCh % shelterCoats.length],
            lowerRgb: cityCh % 3 === 2 ? [226, 182, 92] : [28, 34, 48],
            hasUmbrella: false,
            umbrellaRgb: [20, 24, 34],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: isSittingShelter ? 'sitting_bench' : !isBoarding && !isPacing ? 'checking_watch' : 'walking',
            idleSec: tSec,
          });
        }
      }

      // Interactive Dhaka Curb Commuter Story (ZERO popping!):
      // Passenger walks steadily along sidewalk from offscreen left -> stands at curb (hailX - 18), raises hand as rickshaw nears,
      // steps forward to board stopped rickshaw, then rides seated inside rickshaw until rickshaw exits screen right!
      const hailX = width * 0.44;
      const hailWaitFrac = (hailX - 18) / Math.max(320, width);
      if (!prefersReducedMotion && !isDeepNight) {
        if (!cityStory.rickPassengerInSeat && cityStory.rickStopTimer <= 0) {
          if (cityStory.hailerXFrac < hailWaitFrac) {
            cityStory.hailerXFrac = Math.min(hailWaitFrac, cityStory.hailerXFrac + dt * 0.036);
          }
        }
        if (cityStory.rickCooldown > 0) cityStory.rickCooldown -= dt;
        if (cityStory.rickStopTimer > 0) {
          cityStory.rickStopTimer -= dt;
          if (cityStory.rickStopTimer <= 0) {
            cityStory.rickPassengerInSeat = true;
            cityStory.rickCooldown = 9.0;
          }
        } else if (
          cityStory.rickCooldown <= 0 &&
          !cityStory.rickPassengerInSeat &&
          cityStory.hailerXFrac >= hailWaitFrac - 0.02 &&
          Math.abs(vehicles[3].x - hailX) < 18
        ) {
          cityStory.rickStopTimer = 3.0;
        }

        if (cityStory.busCooldown > 0) cityStory.busCooldown -= dt;
        if (cityStory.busStopTimer > 0) {
          cityStory.busStopTimer -= dt;
          if (cityStory.busStopTimer <= 0) cityStory.busCooldown = 9.5;
        } else if (cityStory.busCooldown <= 0 && Math.abs(vehicles[0].x - busStopX) < 20) {
          cityStory.busStopTimer = 2.8;
        }
      }

      const activeVehicles = vehicles.filter((_, vi) => !(isDeepNight && vi > 2));
      const wrapSpan = width + 440;
      const vStates = activeVehicles.map((v, vi) => {
        const dir: 1 | -1 = v.lane === 0 ? -1 : 1;
        let curSpeed = v.speed * trafficVis;
        let braking = false;

        if (!isDeepNight && v.type === 'rickshaw' && cityStory.rickStopTimer > 0) {
          curSpeed = 0;
          braking = true;
        } else if (!isDeepNight && v.type === 'brtc_bus' && cityStory.busStopTimer > 0) {
          curSpeed = 0;
          braking = true;
        } else if (!isDeepNight && v.type === 'rickshaw' && !cityStory.rickPassengerInSeat && cityStory.rickCooldown <= 0 && hailX - v.x > 0 && hailX - v.x < 70) {
          curSpeed *= 0.45;
          braking = true;
        } else {
          for (let oi = 0; oi < activeVehicles.length; oi++) {
            if (oi === vi || activeVehicles[oi].lane !== v.lane) continue;
            const other = activeVehicles[oi];
            const distAhead = dir === 1 ? (other.x - v.x + wrapSpan) % wrapSpan : (v.x - other.x + wrapSpan) % wrapSpan;
            const safeDist = (v.type === 'brtc_bus' || other.type === 'brtc_bus' ? 165 : 108) * scaleFactor;
            if (distAhead > 0 && distAhead < safeDist) {
              curSpeed = Math.min(curSpeed, distAhead < safeDist * 0.72 ? 0 : other.speed * trafficVis * 0.5);
              braking = true;
            }
          }
        }

        if (!prefersReducedMotion) {
          v.x += dt * dir * curSpeed;
          v.wheelRot += dt * dir * curSpeed * 0.08;
          if (dir === 1 && v.x > width + 220) {
            v.x = -220;
            if (v.type === 'rickshaw' && cityStory.rickPassengerInSeat) {
              cityStory.rickPassengerInSeat = false;
              cityStory.hailerXFrac = -0.04;
            }
          }
          if (dir === -1 && v.x < -220) v.x = width + 220;
        }
        return { v, dir, braking };
      });

      vStates.forEach(({ v, dir, braking }) => {
        drawRealisticVehicle(ctx, {
          type: v.type,
          x: v.x,
          y: v.lane === 0 ? farLaneY : nearLaneY,
          facing: dir,
          scale: v.lane === 0 ? scaleFactor * 0.74 : scaleFactor * 0.94,
          wheelRot: v.wheelRot,
          bodyRgb: v.bodyRgb,
          dayWeight: sky.dayWeight,
          lightGlow,
          rainWeight: sky.rainWeight,
          fogWeight: sky.fogWeight,
          isBraking: braking,
          hasPassenger: v.type === 'rickshaw' && cityStory.rickPassengerInSeat,
        });
      });

      // Wider Foreground Sidewalk + Seamless No-Pop Commuter & Walking Pedestrians
      ctx.fillStyle = rgbCss(lerpRgb([18, 22, 30], [72, 78, 88], amb));
      ctx.fillRect(0, roadBot, width, height - roadBot);
      ctx.fillStyle = rgbCss(lerpRgb([30, 36, 48], [108, 114, 126], amb));
      ctx.fillRect(0, roadBot, width, 4);

      if (lightGlow > 0.08) {
        const swSpan = Math.max(24, height - roadBot);
        for (const lp of cityLampFracs) {
          const hx = width * lp + 20;
          const swGlow = ctx.createRadialGradient(hx, roadBot + 6, 4, hx, roadBot + 6, width < 640 ? 64 : 90);
          swGlow.addColorStop(0, `rgba(250, 204, 102, ${(0.14 * lightGlow).toFixed(2)})`);
          swGlow.addColorStop(0.6, `rgba(244, 178, 64, ${(0.06 * lightGlow).toFixed(2)})`);
          swGlow.addColorStop(1, 'rgba(244, 174, 56, 0)');
          ctx.fillStyle = swGlow;
          ctx.beginPath();
          ctx.ellipse(hx, roadBot + swSpan * 0.28, width < 640 ? 64 : 90, Math.min(30, swSpan * 0.62), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const useUmbrella = sky.rainWeight > 0.08 || (sky.sunlightFactor > 0.7 && (propsRef.current.temperatureC ?? 28) > 33);

      // Draw continuous sidewalk commuter walking smoothly from left edge -> curb -> stepping onto stopped rickshaw!
      if (!isDeepNight && !cityStory.rickPassengerInSeat) {
        const boardingT = cityStory.rickStopTimer > 0 ? clamp01(1 - cityStory.rickStopTimer / 3.0) : 0;
        const hx = lerp(cityStory.hailerXFrac * width, hailX - 10, boardingT);
        const hy = lerp(roadBot + 15, nearLaneY + 3, boardingT);
        const walkingToCurb = cityStory.hailerXFrac < hailWaitFrac - 0.005 || boardingT > 0.05;
        const rickDist = hailX - vehicles[3].x;
        const isHailing = cityStory.hailerXFrac >= hailWaitFrac - 0.02 && rickDist > 12 && rickDist < 175 && cityStory.rickStopTimer <= 0;
        if (boardingT < 0.78) {
          drawRealisticPerson(ctx, {
            x: hx,
            y: hy,
            facing: boardingT > 0.05 ? 1 : cityStory.hailerXFrac < hailWaitFrac - 0.005 ? 1 : -1,
            scale: 0.94 * scaleFactor,
            walkPhase: walkingToCurb ? tSec * 7.2 : 0,
            outfit: 'office',
            coatRgb: [224, 232, 244],
            lowerRgb: [28, 36, 52],
            hasUmbrella: false,
            umbrellaRgb: [20, 26, 36],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            raisedArm: isHailing,
          });
        }
      }

      const activePeds = isDeepNight ? 0 : pedestrians.length;
      for (let pi = 0; pi < activePeds; pi++) {
        const p = pedestrians[pi];
        if (!prefersReducedMotion) {
          p.xFrac += dt * p.dir * p.speed;
          p.walkPhase += dt * (p.speed * 220);
          if (p.xFrac > 1.08) p.xFrac = -0.08;
          if (p.xFrac < -0.08) p.xFrac = 1.08;
        }
      }
      // Strict front-to-back lane depth sort so closer sidewalk pedestrians ALWAYS cleanly occlude rear pedestrians!
      const sortedPeds = pedestrians.slice(0, activePeds).sort((a, b) => a.laneFrac - b.laneFrac);
      for (let pi = 0; pi < sortedPeds.length; pi++) {
        const p = sortedPeds[pi];
        drawRealisticPerson(ctx, {
          x: p.xFrac * width,
          y: roadBot + 22 + p.laneFrac * Math.max(24, height - roadBot - 30),
          facing: p.dir,
          scale: p.scale * scaleFactor,
          walkPhase: p.walkPhase,
          outfit: p.outfit,
          coatRgb: p.coatRgb,
          lowerRgb: p.lowerRgb,
          hasUmbrella: useUmbrella,
          umbrellaRgb: p.umbrellaRgb,
          dayWeight: sky.dayWeight,
          sunlightFactor: sky.sunlightFactor,
          moonVis: sky.effectiveMoonVis,
          rainWeight: sky.rainWeight,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          fogWeight: sky.fogWeight,
        });
      }

      const cityPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [
        { x: width * cityLampFracs[0] + 15, y: roadTop - height * 0.14 + 3, species: 'crow', face: 1, exact: true },
        { x: width * cityLampFracs[cityLampFracs.length - 1] + 15, y: roadTop - height * 0.14 + 3, species: 'pigeon', face: -1, exact: true },
      ];
      if (streetAnchors[1]?.perches[0]) cityPerches.push({ ...streetAnchors[1].perches[0], species: 'sparrow', exact: true });
      if (streetAnchors[2]?.perches[0]) cityPerches.push({ ...streetAnchors[2].perches[0], species: 'crow', exact: true });

      const cityNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean; skipNestBody?: boolean }> = [];
      if (streetAnchors[0]?.forkCrotches[0]) {
        cityNests.push({ x: streetAnchors[0].forkCrotches[0].x, y: streetAnchors[0].forkCrotches[0].y - 1, species: 'sparrow', style: 'cup', scale: 0.84, exact: true, skipNestBody: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['crow', 'pigeon', 'sparrow', 'crow'],
        0.33,
        cityPerches,
        cityNests
      );
      return roadTop;
    };

    const renderRiver = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const horY = height * 0.44;
      const bankTopY = height * 0.645;
      const amb = 0.24 + sky.dayWeight * 0.76;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.2 + sky.rainWeight * 0.25);
      const isNightSleep = sky.dayWeight <= 0.16;
      const isCampEvening = sky.dayWeight < 0.44 || sky.twilight > 0.18;
      const rChapter = Math.floor((tSec % 840) / 140);
      const rSubU = (tSec % 140) / 140;
      const fisherResting = rChapter % 2 === 1 && rSubU > 0.45;

      drawHorizonTreeline(horY, 18, 2.7, rgbCss(lerpRgb([14, 24, 28], [46, 78, 66], amb * 0.75)));

      const wGrad = ctx.createLinearGradient(0, horY, 0, bankTopY + 14);
      wGrad.addColorStop(0, rgbCss(lerpRgb(sky.horRgb, [28, 66, 94], 0.35)));
      wGrad.addColorStop(0.55, rgbCss(lerpRgb(sky.midRgb, [20, 56, 82], 0.55)));
      wGrad.addColorStop(1, rgbCss(lerpRgb([12, 26, 40], [22, 62, 84], amb)));
      ctx.fillStyle = wGrad;
      ctx.fillRect(0, horY, width, bankTopY - horY + 16);

      drawAnimatedWaterSurface(horY, bankTopY, amb, sky, true);
      drawWaterShimmer(ctx, sky.orbX, horY, bankTopY, tSec, sky);

      if (!isNightSleep) {
        const riverDepthLanes: Array<{ bIdx: number; yFrac: number; sc: number; spdMul: number }> = [
          { bIdx: 2, yFrac: 0.49, sc: 0.48, spdMul: rChapter % 2 === 0 ? 0.56 : 0.46 },
          { bIdx: 0, yFrac: 0.54, sc: 0.64, spdMul: rChapter % 3 === 1 ? 0.90 : 0.76 },
        ];
        riverDepthLanes.forEach(({ bIdx, yFrac, sc, spdMul }) => {
          const bt = boats[bIdx];
          if (!prefersReducedMotion) {
            bt.x += dt * bt.dir * (bt.speed * spdMul + sky.windFactor * 5);
            bt.phase += dt * 2.2;
            if (bt.dir > 0 && bt.x > width + 110) bt.x = -110;
            if (bt.dir < 0 && bt.x < -110) bt.x = width + 110;
          }
          drawRealisticBoat(ctx, {
            type: bt.type,
            x: bt.x,
            y: height * yFrac + Math.sin(tSec * 1.8 + bt.phase) * 2.0,
            facing: bt.dir,
            scale: sc * Math.max(0.75, width / 960 + 0.3),
            wavePitch: Math.sin(tSec * 2.1 + bt.phase),
            oarPhase: bt.phase,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            sailRgb: bt.sailRgb,
            dayWeight: sky.dayWeight,
            lightGlow,
            hasLantern: bt.type === 'chhoi' || lightGlow > 0.25,
            sunlightFactor: sky.sunlightFactor,
          });
        });

        // Boat casting net on mid-river during active fishing chapters (when not resting ashore!)
        if (!fisherResting) {
          const fishCenterX = width * (rChapter % 3 === 1 ? 0.46 : rChapter % 3 === 2 ? 0.58 : 0.52);
          const riverBoatNearFish = Math.abs(boats[0].x - fishCenterX) < 145 || Math.abs(boats[1].x - fishCenterX) < 145;
          drawFishermanCastingNet(
            ctx,
            fishCenterX,
            height * 0.595,
            0.82,
            tSec + 4.0,
            amb,
            width * 0.14,
            height * 0.014,
            [],
            (pan) => stormAudio.triggerNetSplash(pan),
            width,
            riverBoatNearFish
          );
        }

        const fgBoat = boats[1];
        if (!prefersReducedMotion) {
          fgBoat.x += dt * fgBoat.dir * (fgBoat.speed * (rChapter % 2 === 0 ? 1.08 : 0.92) + sky.windFactor * 7);
          fgBoat.phase += dt * 2.2;
          if (fgBoat.dir > 0 && fgBoat.x > width + 110) fgBoat.x = -110;
          if (fgBoat.dir < 0 && fgBoat.x < -110) fgBoat.x = width + 110;
        }
        drawRealisticBoat(ctx, {
          type: fgBoat.type,
          x: fgBoat.x,
          y: height * 0.618 + Math.sin(tSec * 1.8 + fgBoat.phase) * 2.1,
          facing: fgBoat.dir,
          scale: 0.84 * Math.max(0.75, width / 960 + 0.3),
          wavePitch: Math.sin(tSec * 2.1 + fgBoat.phase),
          oarPhase: fgBoat.phase,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          sailRgb: fgBoat.sailRgb,
          dayWeight: sky.dayWeight,
          lightGlow,
          hasLantern: true,
          sunlightFactor: sky.sunlightFactor,
        });
      }

      // Moored wooden country boat tied neatly to shoreline mooring stakes (`খুঁটি`) when resting / evening / night!
      if (fisherResting || isCampEvening || isNightSleep) {
        const mooredX = width * 0.25;
        const mooredY = bankTopY - 3 + Math.sin(tSec * 1.4) * 1.4;
        ctx.strokeStyle = 'rgba(180, 150, 110, 0.78)';
        ctx.lineWidth = 1.45;
        ctx.beginPath();
        ctx.moveTo(width * 0.18, bankTopY + 5);
        ctx.quadraticCurveTo((width * 0.18 + mooredX - 34) * 0.5, mooredY + 6, mooredX - 34, mooredY - 3);
        ctx.stroke();

        drawRealisticBoat(ctx, {
          type: 'chhoi',
          x: mooredX,
          y: mooredY,
          facing: 1,
          scale: 0.88,
          wavePitch: Math.sin(tSec * 1.3) * 0.5,
          oarPhase: 0,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          sailRgb: [228, 224, 214],
          dayWeight: sky.dayWeight,
          lightGlow: Math.max(0.32, lightGlow),
          hasLantern: true,
          sunlightFactor: sky.sunlightFactor,
          isMoored: true,
        });
      }

      // Open Serene Sandy-Clay Bengal Riverbank (`নদীর বালু-মাটির পাড়`) with a subtle worn sandy footpath & natural grass
      const pathYAt = (px: number) => {
        const u = clamp01(px / Math.max(1, width));
        return bankTopY + 39 - Math.sin(u * Math.PI * 0.92 + 0.18) * 7.5 + Math.sin(u * Math.PI * 2.3) * 2.5;
      };

      const bankGrad = ctx.createLinearGradient(0, bankTopY - 8, 0, height);
      bankGrad.addColorStop(0, rgbCss(lerpRgb([28, 24, 18], [142, 120, 88], amb)));
      bankGrad.addColorStop(0.18, rgbCss(lerpRgb([24, 21, 16], [126, 108, 78], amb)));
      bankGrad.addColorStop(0.42, rgbCss(lerpRgb([18, 22, 15], [84, 96, 54], amb)));
      bankGrad.addColorStop(0.75, rgbCss(lerpRgb([13, 18, 12], [54, 74, 38], amb)));
      bankGrad.addColorStop(1, rgbCss(lerpRgb([10, 14, 10], [38, 56, 28], amb)));
      ctx.fillStyle = bankGrad;
      ctx.beginPath();
      ctx.moveTo(0, bankTopY + 12);
      ctx.quadraticCurveTo(width * 0.45, bankTopY - 8, width, bankTopY + 10);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      // Gentle wet golden-sand water rim + smooth alluvial shoreline curve
      ctx.fillStyle = rgbCss(lerpRgb([20, 18, 14], [160, 138, 102], amb), 0.68);
      ctx.beginPath();
      ctx.moveTo(0, bankTopY + 14);
      ctx.quadraticCurveTo(width * 0.45, bankTopY - 6, width, bankTopY + 11);
      ctx.lineTo(width, bankTopY + 23);
      ctx.quadraticCurveTo(width * 0.45, bankTopY + 7, 0, bankTopY + 25);
      ctx.closePath();
      ctx.fill();

      // Soft mossy-grass patches flanking upper & lower bank around the worn path (irregular organic shapes)
      ctx.fillStyle = rgbCss(lerpRgb([14, 24, 14], [64, 96, 42], amb), 0.48);
      ctx.beginPath();
      ctx.ellipse(width * 0.13, bankTopY + 29, width * 0.10, 8.5, 0.05, 0, Math.PI * 2);
      ctx.ellipse(width * 0.81, bankTopY + 28, width * 0.13, 9.5, -0.04, 0, Math.PI * 2);
      ctx.ellipse(width * 0.24, bankTopY + 78, width * 0.22, 22, 0.03, 0, Math.PI * 2);
      ctx.ellipse(width * 0.68, bankTopY + 86, width * 0.25, 24, -0.02, 0, Math.PI * 2);
      ctx.fill();

      // Subtle, naturally worn sandy-soil footpath (`হালকা পায়ে চলা বালু-মাটির রাস্তা`) winding along the bank
      ctx.save();
      const tracePathStrip = (halfW: number) => {
        ctx.beginPath();
        const segs = 28;
        for (let s = 0; s <= segs; s++) {
          const px = (s / segs) * width;
          const wVar = halfW * (0.86 + 0.18 * Math.sin(s * 0.65) + 0.12 * (s / segs));
          const py = pathYAt(px) - wVar;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        for (let s = segs; s >= 0; s--) {
          const px = (s / segs) * width;
          const wVar = halfW * (0.86 + 0.18 * Math.sin(s * 0.65) + 0.12 * (s / segs));
          const py = pathYAt(px) + wVar;
          ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      // Outer feathered grassy-sand blend
      ctx.fillStyle = rgbCss(lerpRgb([22, 20, 15], [134, 114, 82], amb), 0.34);
      tracePathStrip(13);
      ctx.fill();
      // Inner soft sandy-earth trodden surface
      ctx.fillStyle = rgbCss(lerpRgb([28, 24, 18], [162, 138, 100], amb), 0.44);
      tracePathStrip(7.5);
      ctx.fill();
      // Subtle center sandy wear + tiny scattered river pebbles along path
      ctx.fillStyle = rgbCss(lerpRgb([32, 28, 22], [176, 152, 114], amb), 0.32);
      tracePathStrip(3.8);
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb([20, 18, 14], [116, 98, 72], amb), 0.45);
      for (let pb = 0; pb < 18; pb++) {
        const px = width * ((pb * 0.061 + 0.03) % 0.96);
        const py = pathYAt(px) + Math.sin(pb * 3.7) * 5.2;
        ctx.beginPath();
        ctx.ellipse(px, py, 1.5 + (pb % 3) * 0.6, 0.85, (pb % 4) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Sturdy wooden boat mooring stakes (`খুঁটি`) hammered visibly into the sandy bank
      ctx.strokeStyle = rgbCss(lerpRgb([18, 14, 10], [88, 62, 40], amb));
      ctx.lineWidth = 4.2;
      [0.14, 0.18].forEach((px, pi) => {
        const sx = width * px;
        const sy = bankTopY + 15;
        ctx.fillStyle = 'rgba(8, 10, 14, 0.22)';
        ctx.beginPath();
        ctx.ellipse(sx + 2, sy + 1, 5.5, 2.0, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (pi === 0 ? -2.5 : 1.5), sy - 24);
        ctx.stroke();
      });

      // Softly glowing Riverside Camp Tent pitched cleanly on upper left bank at dusk/night (>=50% gentler)!
      if (isCampEvening) {
        drawRiversideCampTent(ctx, width * 0.28, bankTopY + 42, 0.96, tSec, amb, Math.max(0.32, lightGlow * 0.45));
      }

      // Fishermen resting ashore after finishing fishing (`মাছ মারা শেষ হলে জেলেরা এখানে এসে রেস্ট করে`)
      if (!isNightSleep && sky.dayWeight > 0.24 && sky.stormWeight < 0.38 && (fisherResting || rChapter % 2 === 0)) {
        drawRestingFishermen(
          ctx,
          width * 0.44,
          bankTopY + 44,
          0.95,
          tSec,
          sky.dayWeight,
          sky.sunlightFactor,
          sky.windFactor,
          sky.windSign
        );
      }

      // Peaceful Seated Riverbank Angler fishing calmly on right bank during daytime
      if (!isNightSleep && sky.dayWeight > 0.26 && sky.stormWeight < 0.38) {
        drawRiverAngler(ctx, width * 0.72, bankTopY + 24, -1, 0.92, tSec, amb);
      }

      // Graceful corner Bamboo Clump (`নদীর পাড়ের এক কোণায় বাঁশঝাড়`) clear of sandy footpath, resting fishermen & central sky!
      drawBambooClump(ctx, width, width * 0.945, bankTopY + 34, height * 0.24, 7, 4.6, sky.windFactor, sky.windSign, tSec, sky.dayWeight, sky.sunlightFactor, sprigPack);

      // Occasional calm riverbank stroller rotating across stories & outfits along the sandy footpath
      if (!isNightSleep && sky.dayWeight > 0.30 && sky.stormWeight < 0.35) {
        if (rChapter % 2 === 1 && rSubU < 0.74) {
          const fromLeft = rChapter === 1 || rChapter === 5;
          const x0 = fromLeft ? -32 : width + 32;
          const x1 = fromLeft ? width + 32 : -32;
          const stopX = width * (fromLeft ? 0.56 : 0.40);
          const evalRivWalker = (u: number) => {
            if (u < 0.28) return { x: lerp(x0, stopX, u / 0.28), act: 'walking' as const, dist: Math.abs(lerp(x0, stopX, u / 0.28) - x0) };
            if (u < 0.48) return { x: stopX, act: (rChapter === 5 ? 'checking_watch' : 'looking') as HumanActivity, dist: Math.abs(stopX - x0) };
            const curX = lerp(stopX, x1, (u - 0.48) / 0.26);
            return { x: curX, act: 'walking' as const, dist: Math.abs(stopX - x0) + Math.abs(curX - stopX) };
          };
          const rw0 = evalRivWalker(rSubU);
          const rw1 = evalRivWalker(Math.min(0.739, rSubU + 0.004));
          const rDx = rw1.x - rw0.x;
          const rMoving = rw0.act === 'walking' && Math.abs(rDx) > 0.03;
          const rivOutfit: HumanOutfit = rChapter === 3 ? 'sari' : rChapter === 5 ? 'shirt' : 'panjabi';
          const rivCoat: RGB = rChapter === 3 ? [188, 62, 78] : rChapter === 5 ? [74, 134, 168] : [224, 228, 236];
          drawRealisticPerson(ctx, {
            x: rw0.x,
            y: pathYAt(rw0.x) + 2,
            facing: rMoving ? (rDx >= 0 ? 1 : -1) : (fromLeft ? 1 : -1),
            scale: 0.84,
            walkPhase: rMoving ? rw0.dist * 0.22 : 0,
            outfit: rivOutfit,
            coatRgb: rivCoat,
            lowerRgb: rChapter === 3 ? [226, 178, 92] : [38, 48, 64],
            hasUmbrella: sky.rainWeight > 0.08,
            umbrellaRgb: [28, 42, 68],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: rw0.act,
            idleSec: tSec,
          });
        }
      }

      // Natural Organic Riverbank Grass (`স্বাভাবিক নদীর ঘাস` — asymmetrical patchy tufts, zero lined-up rows!)
      // Plus strictly ONE or TWO modest wildflower plants tucked naturally amidst the grass!
      const grassDarkCol = lerpRgb([14, 34, 14], [32, 74, 24], amb);
      const grassMidCol = lerpRgb([24, 56, 22], [68, 132, 42], amb);
      const grassSunCol = lerpRgb([34, 74, 28], [124, 178, 62], amb);

      const drawOrganicGrassPatch = (gx: number, gy: number, blades: number, spreadW: number, hMin: number, hMax: number, seedVal: number) => {
        const w = sampleLocalWind(gx, width, tSec, sky.windFactor, sky.windSign, 1.0, seedVal);
        // Soft creeping turf shadow underneath clump
        ctx.fillStyle = rgbCss(lerpRgb([10, 18, 10], [34, 62, 24], amb), 0.34);
        ctx.beginPath();
        ctx.ellipse(gx, gy + 1.5, spreadW * 0.65, 3.4, Math.sin(seedVal) * 0.12, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineCap = 'round';
        for (let b = 0; b < blades; b++) {
          const jitter = Math.sin(seedVal * 3.7 + b * 2.9);
          const bx = gx + jitter * (spreadW * 0.52);
          const by = gy + Math.cos(seedVal * 2.1 + b * 1.7) * 2.8;
          const bh = lerp(hMin, hMax, 0.5 + 0.5 * Math.sin(seedVal * 4.3 + b * 2.3));
          const lean = jitter * (4 + spreadW * 0.28) + Math.cos(b * 1.8 + seedVal) * 3.5;
          const windBend = sky.windSign * (w.bend * 7.5 + sky.windFactor * 4.5) + Math.sin(tSec * 2.0 + seedVal + b * 0.8) * 1.5;
          const tipX = bx + lean + windBend;
          const tipY = by - bh + Math.abs(lean) * 0.18;

          ctx.strokeStyle = b % 3 === 0 ? rgbCss(grassDarkCol, 0.94) : b % 2 === 0 ? rgbCss(grassSunCol, 0.92) : rgbCss(grassMidCol, 0.95);
          ctx.lineWidth = b % 3 === 0 ? 1.7 : 1.25;
          ctx.beginPath();
          ctx.moveTo(bx, by + 1);
          ctx.quadraticCurveTo(bx + lean * 0.35 + windBend * 0.4, by - bh * 0.58, tipX, tipY);
          ctx.stroke();
        }
      };

      const drawSingleWildflowerPlant = (fxBase: number, fyBase: number, petalRgb: RGB, seedVal: number, blooms = 2) => {
        const w = sampleLocalWind(fxBase, width, tSec, sky.windFactor, sky.windSign, 1.15, seedVal);
        // Small bushy green leaves at plant base
        drawOrganicGrassPatch(fxBase, fyBase + 2, 10, 16, 10, 19, seedVal + 0.9);
        for (let bi = 0; bi < blooms; bi++) {
          const bSeed = seedVal + bi * 2.1;
          const dx = (bi - (blooms - 1) * 0.5) * 6.5 + Math.sin(bSeed) * 2.0;
          const stemH = 19 + bi * 4;
          const windBend = sky.windSign * (w.bend * 8.5 + sky.windFactor * 4.8) + Math.sin(tSec * 2.1 + bSeed) * 1.8;
          const bx = fxBase + dx + windBend;
          const by = fyBase - stemH;

          ctx.strokeStyle = rgbCss(grassMidCol, 0.96);
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(fxBase + dx * 0.25, fyBase + 1);
          ctx.quadraticCurveTo(fxBase + dx * 0.55 + windBend * 0.4, fyBase - stemH * 0.55, bx, by);
          ctx.stroke();

          ctx.fillStyle = rgbCss(lerpRgb([88, 84, 76], petalRgb, 0.35 + amb * 0.65), 0.96);
          for (let p = 0; p < 5; p++) {
            const ang = (p / 5) * Math.PI * 2 + bSeed;
            ctx.beginPath();
            ctx.ellipse(bx + Math.cos(ang) * 2.3, by + Math.sin(ang) * 1.85, 1.95, 1.35, ang, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = rgbCss(lerpRgb([108, 80, 22], [248, 202, 28], 0.36 + amb * 0.64), 0.98);
          ctx.beginPath();
          ctx.arc(bx, by, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      // 1) Irregular natural grass patches along upper bank edges (above footpath, leaving path & fishermen clear)
      const upperGrassPatches: Array<{ xf: number; dy: number; n: number; sw: number; h1: number; h2: number; sd: number }> = [
        { xf: 0.06, dy: 24, n: 14, sw: 26, h1: 10, h2: 19, sd: 1.2 },
        { xf: 0.11, dy: 27, n: 12, sw: 20, h1: 9, h2: 17, sd: 2.7 },
        { xf: 0.22, dy: 25, n: 12, sw: 22, h1: 9, h2: 17, sd: 4.1 },
        { xf: 0.59, dy: 23, n: 13, sw: 24, h1: 10, h2: 18, sd: 5.5 },
        { xf: 0.79, dy: 24, n: 14, sw: 26, h1: 10, h2: 19, sd: 6.8 },
        { xf: 0.88, dy: 26, n: 13, sw: 24, h1: 10, h2: 18, sd: 7.6 },
        { xf: 0.94, dy: 28, n: 14, sw: 22, h1: 11, h2: 19, sd: 8.3 },
      ];
      upperGrassPatches.forEach((p) => {
        drawOrganicGrassPatch(width * p.xf, bankTopY + p.dy, p.n, p.sw, p.h1, p.h2, p.sd);
      });

      // 2) Organic grassy meadow patches below the sandy footpath (clustered irregularly — NO neat rows, scales to screen width!)
      const maxFgY = Math.max(bankTopY + 76, height - 82);
      const lowerPatchCount = Math.max(22, Math.min(44, Math.floor(width / 20)));
      for (let pi = 0; pi < lowerPatchCount; pi++) {
        const s1 = Math.sin(pi * 12.9898 + 3.1) * 43758.5453;
        const r1 = s1 - Math.floor(s1);
        const s2 = Math.sin(pi * 78.233 + 1.7) * 24634.6345;
        const r2 = s2 - Math.floor(s2);
        const s3 = Math.sin(pi * 39.425 + 5.3) * 19283.1415;
        const r3 = s3 - Math.floor(s3);
        const px = width * clamp01((pi + 0.22 + r1 * 0.56) / lowerPatchCount);
        const minLowerY = pathYAt(px) + 17;
        const spanLower = Math.max(24, maxFgY - minLowerY);
        const py = minLowerY + spanLower * (0.10 + r2 * 0.82);
        const nBlades = 13 + Math.floor(r3 * 8);
        const spreadW = 26 + r1 * 16;
        const h1 = 10 + r2 * 4;
        const h2 = 18 + r3 * 9;
        drawOrganicGrassPatch(px, py, nBlades, spreadW, h1, h2, pi * 1.47 + 1.4);
      }

      // 3) Strictly ONLY TWO (2) modest wildflower plants nestled naturally in the grass!
      const wf1X = width * 0.19;
      const wf1Y = pathYAt(wf1X) + 18 + Math.max(22, maxFgY - (pathYAt(wf1X) + 18)) * 0.52;
      drawSingleWildflowerPlant(wf1X, wf1Y, [252, 248, 232], 3.4, 2);

      const wf2X = width * 0.83;
      const wf2Y = bankTopY + 25;
      drawSingleWildflowerPlant(wf2X, wf2Y, [250, 212, 74], 7.8, 2);

      // Subtle margin reeds strictly at extreme outer borders (`< 0.07` & `> 0.93`) so central bank stays wide open
      const kashBoost = 0.34 + pheno.autumnKashWeight * 0.66;
      const reedCount = Math.min(48, Math.floor(width / 18));
      for (let i = 0; i < reedCount; i++) {
        const kx = (i + 0.4) * (width / reedCount);
        if (kx > width * 0.075 && kx < width * 0.925) continue;
        const ky = bankTopY + 12 + (i % 4) * 7;
        const w = sampleLocalWind(kx, width, tSec, sky.windFactor, sky.windSign, 1.4, i);
        const hStem = 24 + (i % 3) * 7;
        const topX = kx + sky.windSign * w.bend * 14 + Math.sin(tSec * 2.2 + i) * (1.0 + sky.windFactor * 2.5);
        const topY = ky - hStem;
        ctx.strokeStyle = rgbCss(lerpRgb([16, 30, 18], [72, 114, 48], amb), 0.9);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(kx, ky + 4);
        ctx.quadraticCurveTo(kx + sky.windSign * w.bend * 5, (ky + topY) * 0.5, topX, topY);
        ctx.stroke();
        if (pheno.autumnKashWeight > 0.08 || i % 2 === 0) {
          const litPlume = rgbCss(lerpRgb([168, 174, 182], [250, 252, 255], amb), 0.48 + 0.4 * kashBoost);
          ctx.fillStyle = litPlume;
          ctx.beginPath();
          ctx.ellipse(topX + sky.windSign * w.bend * 2, topY - 4, 2.2, 8.5, sky.windSign * w.bend * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Sky Birds small & distant far high above the river (`আকাশের পাখি নদীর উপর দিয়ে দূর দিয়ে উঠবে`) — ZERO birds over foreground bank, ZERO birds after evening!
      renderSceneBirds(
        sky,
        dt,
        ['gull', 'egret', 'gull'],
        0.24,
        undefined,
        undefined,
        0.11,
        0.42,
        true
      );
      renderSeasonalDrift(pheno, sky, dt);
      renderFireflies(sky, dt, 0.68, 0.92);
      return horY;
    };

    const renderSea = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const horY = height * 0.53;
      const surfY = height * 0.75;
      const amb = 0.24 + sky.dayWeight * 0.76;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.25 + sky.rainWeight * 0.3);
      const isEveningCoupleTime = sky.dayWeight > 0.08 && (sky.twilight > 0.12 || sky.dayWeight < 0.75);
      const isRaining = sky.rainWeight > 0.1;

      // 1) Bathymetric True Ocean Gradient: Horizon Sky-Mist -> Deep Pelagic Cobalt -> Translucent Emerald-Jade Coastal Shelf
      const seaGrad = ctx.createLinearGradient(0, horY, 0, surfY);
      seaGrad.addColorStop(0, rgbCss(lerpRgb([14, 24, 42], lerpRgb(sky.horRgb, [66, 114, 152], 0.48), amb)));
      seaGrad.addColorStop(0.22, rgbCss(lerpRgb([10, 24, 46], [22, 68, 112], amb)));
      seaGrad.addColorStop(0.58, rgbCss(lerpRgb([10, 34, 54], [20, 96, 124], amb)));
      seaGrad.addColorStop(0.86, rgbCss(lerpRgb([12, 42, 58], [34, 126, 134], amb)));
      seaGrad.addColorStop(1, rgbCss(lerpRgb([16, 48, 60], [64, 146, 144], amb)));
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, horY, width, surfY - horY);

      // Soft horizon atmospheric haze blending distant sea smoothly into sky
      const horMist = ctx.createLinearGradient(0, horY - 2, 0, horY + 20);
      horMist.addColorStop(0, rgbCss(sky.horRgb, 0.52));
      horMist.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = horMist;
      ctx.fillRect(0, horY - 2, width, 22);

      // Distant misty coastal fishing trawler silhouette far out near left horizon
      const trawlerX = width * (0.14 + Math.sin(tSec * 0.015) * 0.04);
      const trawlerY = horY + 6;
      ctx.fillStyle = rgbCss(lerpRgb([14, 22, 34], [54, 72, 92], amb), 0.56);
      ctx.beginPath();
      ctx.moveTo(trawlerX - 15, trawlerY);
      ctx.lineTo(trawlerX + 16, trawlerY);
      ctx.lineTo(trawlerX + 12, trawlerY + 4);
      ctx.lineTo(trawlerX - 13, trawlerY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(trawlerX - 5, trawlerY - 5, 7, 5);
      ctx.fillRect(trawlerX + 4, trawlerY - 9, 1.4, 9);

      // Perspective-foreshortened smooth ocean capillary wavelets (layered trough shadows & sky-lit crests)
      ctx.save();
      ctx.lineCap = 'round';
      for (let fRow = 0; fRow < 38; fRow++) {
        const dFrac = Math.pow(fRow / 37, 1.68);
        const fy = lerp(horY + 3, surfY - 6, dFrac);
        const segLen = lerp(16, 68, dFrac);
        const drift = tSec * lerp(6, 22, dFrac) * sky.windSign;
        const startX = ((fRow * 83 + drift) % (width + 140)) - 70;
        const rowAlph = (0.05 + amb * 0.085) * (0.35 + dFrac * 0.65);
        ctx.strokeStyle =
          fRow % 3 === 0
            ? `rgba(6, 26, 44, ${(rowAlph * 1.15).toFixed(3)})`
            : rgbCss(lerpRgb([148, 198, 222], sky.horRgb, 0.38), rowAlph * 0.92);
        ctx.lineWidth = lerp(0.6, 2.0, dFrac);
        for (let fx = (startX % 88) - 88; fx < width; fx += 78 + (fRow % 3) * 24) {
          const wL = segLen * (0.65 + ((fx + fRow) % 5) * 0.14);
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.quadraticCurveTo(fx + wL * 0.5, fy - 0.9 * dFrac, fx + wL, fy + 0.3);
          ctx.stroke();
        }
      }
      ctx.restore();

      drawWaterShimmer(ctx, sky.orbX, horY, surfY - 8, tSec, sky);

      // Multi-frequency organic wave height helper
      const oceanProfile = (x: number, seedW: number, scaleAmp: number) =>
        (Math.sin(x * 0.0064 + tSec * 0.88 + seedW) * 0.54 +
          Math.sin(x * 0.0165 - tSec * 1.22 + seedW * 1.7) * 0.30 +
          Math.sin(x * 0.036 + tSec * 0.58 + seedW * 3.1) * 0.16) *
        scaleAmp;

      // 2) Six Sculpted Realistic Ocean Swells — Translucent Backlit Jade Curls, Soft Shaded Troughs & Lacy Cellular Seafoam!
      const swellSpeed = 0.52 + sky.windFactor * 0.32 + sky.stormWeight * 0.38;
      const swellCount = 6;
      for (let wv = 0; wv < swellCount; wv++) {
        const cycle = (tSec * swellSpeed * 0.14 + wv / swellCount) % 1;
        const wy = lerp(horY + 12, surfY + 8, Math.pow(cycle, 1.58));
        const crestH = (2.6 + cycle * 11.4) * (1 + sky.windFactor * 0.20 + sky.stormWeight * 0.30);
        const crestAlpha = Math.sin(cycle * Math.PI) * (0.44 + amb * 0.52);
        const seedW = wv * 2.13;

        // Sun/sky-tinted translucent swell crown fading smoothly into deep shaded trough
        const waveFace = ctx.createLinearGradient(0, wy - crestH * 0.65, 0, wy + crestH * 2.1);
        waveFace.addColorStop(0, `rgba(146, 224, 228, ${(crestAlpha * 0.42).toFixed(2)})`);
        waveFace.addColorStop(0.24, `rgba(28, 134, 148, ${(crestAlpha * 0.72).toFixed(2)})`);
        waveFace.addColorStop(0.62, `rgba(10, 62, 86, ${(crestAlpha * 0.58).toFixed(2)})`);
        waveFace.addColorStop(1, `rgba(6, 28, 44, ${(crestAlpha * 0.04).toFixed(2)})`);
        ctx.fillStyle = waveFace;
        ctx.beginPath();
        ctx.moveTo(0, wy + crestH * 2.15);
        for (let x = 0; x <= width + 10; x += 10) {
          ctx.lineTo(x, wy + oceanProfile(x, seedW, 1.5 + cycle * 3.4));
        }
        ctx.lineTo(width, wy + crestH * 2.15);
        ctx.closePath();
        ctx.fill();

        // Delicate backlit glossy wave crest shoulder highlight
        ctx.strokeStyle = `rgba(218, 248, 252, ${(crestAlpha * (0.20 + amb * 0.24)).toFixed(2)})`;
        ctx.lineWidth = lerp(0.8, 1.9, cycle);
        ctx.beginPath();
        for (let x = 0; x <= width; x += 10) {
          const py = wy + oceanProfile(x, seedW, 1.5 + cycle * 3.4);
          if (x === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.stroke();

        // Smooth Organic Breaking Seafoam Ribbon + Multi-Scale Lacy Cellular Foam Pockets (ZERO spiky triangles!)
        if (cycle > 0.34) {
          const breakFrac = (cycle - 0.34) / 0.66;
          const surfEnv = Math.sin(breakFrac * Math.PI);
          for (let x = 8; x < width; x += 16) {
            const breakEnergy =
              0.52 +
              0.38 * Math.sin(x * 0.011 + wv * 1.9 - tSec * 0.58) +
              0.24 * Math.cos(x * 0.029 - wv * 2.4 + tSec * 0.44);
            if (breakEnergy <= 0.52) continue;

            const e = Math.min(1, (breakEnergy - 0.52) * 2.0);
            const py = wy + oceanProfile(x, seedW, 1.5 + cycle * 3.4);
            const fH = (1.6 + breakFrac * 4.4) * e;
            const fa = clamp01(crestAlpha * surfEnv * (0.42 + e * 0.44));

            // Soft billowy whitewater curl cloud (smooth rotated layered ellipses)
            ctx.fillStyle = `rgba(248, 252, 255, ${(fa * 0.68).toFixed(2)})`;
            ctx.beginPath();
            ctx.ellipse(x, py + fH * 0.12, 9.5 + e * 4.5, 1.4 + fH * 0.42, Math.sin(x * 0.03 + wv) * 0.14, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(232, 248, 254, ${(fa * 0.46).toFixed(2)})`;
            ctx.beginPath();
            ctx.ellipse(x + Math.sin(x + wv) * 3, py - fH * 0.24, 6.2 + e * 3.0, 1.0 + fH * 0.28, -0.1, 0, Math.PI * 2);
            ctx.fill();

            // Aerated turquoise-white cellular lacy trailing wake behind crest
            ctx.fillStyle = `rgba(206, 242, 248, ${(fa * 0.26).toFixed(2)})`;
            ctx.beginPath();
            ctx.ellipse(x + 2, py + fH * 0.85, 11.5, 1.8 + fH * 0.35, 0, 0, Math.PI * 2);
            ctx.fill();

            if (sky.windFactor > 0.35 && ((x + wv * 13) % 32) < 16) {
              ctx.fillStyle = `rgba(255, 255, 255, ${(fa * 0.42).toFixed(2)})`;
              ctx.beginPath();
              ctx.arc(x + sky.windSign * 6, py - fH * 0.72, 0.85 + e * 0.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      if (sky.dayWeight > 0.25) {
        const dZone = Math.floor((tSec * 0.22) / 2.6) % 3;
        const dBaseFrac = dZone === 0 ? 0.28 : dZone === 1 ? 0.56 : 0.76;
        const dFace: 1 | -1 = dZone === 2 ? -1 : 1;
        const dCycle1 = (tSec * 0.22) % 2.6;
        if (dCycle1 < 1.0) drawLeapingDolphin(ctx, width * dBaseFrac, horY + (surfY - horY) * 0.45, dCycle1, dFace, 0.92, amb);
        const dCycle2 = ((tSec * 0.22) + 0.14) % 2.6;
        if (dCycle2 < 1.0) drawLeapingDolphin(ctx, width * (dBaseFrac + 0.06 * dFace), horY + (surfY - horY) * 0.48, dCycle2, dFace, 0.72, amb);
      }

      // 3) True Mirror-Wet Foreshore Reflective Sand -> Warm Golden Upper Beach
      const sandGrad = ctx.createLinearGradient(0, surfY, 0, height);
      sandGrad.addColorStop(0, rgbCss(lerpRgb([14, 22, 32], lerpRgb([74, 74, 76], sky.horRgb, 0.36), amb)));
      sandGrad.addColorStop(0.28, rgbCss(lerpRgb([18, 24, 30], lerpRgb([112, 102, 86], sky.horRgb, 0.22), amb)));
      sandGrad.addColorStop(0.56, rgbCss(lerpRgb([28, 26, 26], [168, 144, 110], amb)));
      sandGrad.addColorStop(1, rgbCss(lerpRgb([22, 20, 20], [142, 118, 90], amb)));
      ctx.fillStyle = sandGrad;
      ctx.fillRect(0, surfY, width, height - surfY);

      // Glossy sky/sun mirror wash across wet foreshore sand
      const wetH = (height - surfY) * 0.44;
      const wetRef = ctx.createLinearGradient(0, surfY, 0, surfY + wetH);
      wetRef.addColorStop(0, rgbCss(lerpRgb(sky.horRgb, [218, 236, 248], 0.26), 0.44 * amb + 0.12));
      wetRef.addColorStop(0.65, rgbCss(sky.horRgb, 0.14 * amb));
      wetRef.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = wetRef;
      ctx.fillRect(0, surfY, width, wetH);

      // Glassy Tidal Swash Sheets gliding smoothly up wet sand with delicate organic filigree seafoam lace edges
      const washWave = 0.5 + 0.5 * Math.sin(tSec * 0.88);
      const washWave2 = 0.5 + 0.5 * Math.sin(tSec * 0.88 - 1.85);
      const washWave3 = 0.5 + 0.5 * Math.sin(tSec * 0.88 - 3.4);
      [
        { frac: washWave * 0.34, alpha: 0.20 + amb * 0.24, phase: 0.2 },
        { frac: washWave2 * 0.28, alpha: 0.14 + amb * 0.18, phase: 2.1 },
        { frac: washWave3 * 0.22, alpha: 0.10 + amb * 0.14, phase: 4.0 },
      ].forEach((ws) => {
        const yEdgeBase = surfY + ws.frac * (height - surfY);
        const swGrad = ctx.createLinearGradient(0, surfY, 0, yEdgeBase + 6);
        swGrad.addColorStop(0, `rgba(148, 208, 224, ${(ws.alpha * 0.42).toFixed(2)})`);
        swGrad.addColorStop(0.75, `rgba(196, 232, 244, ${(ws.alpha * 0.64).toFixed(2)})`);
        swGrad.addColorStop(1, `rgba(248, 252, 255, ${(ws.alpha * 0.78).toFixed(2)})`);
        ctx.fillStyle = swGrad;
        ctx.beginPath();
        ctx.moveTo(0, surfY);
        ctx.lineTo(width, surfY);
        for (let x = width; x >= 0; x -= 10) {
          const lobe =
            Math.sin(x * 0.0085 + tSec * 0.9 + ws.phase) * 5.6 +
            Math.cos(x * 0.024 - ws.phase) * 2.9 +
            Math.sin(x * 0.058 + ws.phase * 1.4) * 1.1;
          ctx.lineTo(x, yEdgeBase + lobe);
        }
        ctx.closePath();
        ctx.fill();

        // Delicate filigree lace margin + fine foam beads along swash edge
        ctx.strokeStyle = `rgba(255, 255, 255, ${clamp01(ws.alpha * 1.55).toFixed(2)})`;
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 10) {
          const lobe =
            Math.sin(x * 0.0085 + tSec * 0.9 + ws.phase) * 5.6 +
            Math.cos(x * 0.024 - ws.phase) * 2.9 +
            Math.sin(x * 0.058 + ws.phase * 1.4) * 1.1;
          if (x === 0) ctx.moveTo(x, yEdgeBase + lobe);
          else ctx.lineTo(x, yEdgeBase + lobe);
        }
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 255, 255, ${clamp01(ws.alpha * 0.9).toFixed(2)})`;
        for (let bx = 18; bx < width; bx += 42) {
          const lobe =
            Math.sin(bx * 0.0085 + tSec * 0.9 + ws.phase) * 5.6 +
            Math.cos(bx * 0.024 - ws.phase) * 2.9 +
            Math.sin(bx * 0.058 + ws.phase * 1.4) * 1.1;
          ctx.beginPath();
          ctx.ellipse(bx, yEdgeBase + lobe - 1.5, 4.2, 1.1, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // St. Martin / Cox's Bazar Lighthouse on right headland
      const lhX = width * 0.87;
      const lhBaseY = horY + 14;
      ctx.fillStyle = rgbCss(lerpRgb([14, 16, 22], [58, 56, 54], amb));
      ctx.beginPath();
      ctx.moveTo(width * 0.74, lhBaseY + 8);
      ctx.quadraticCurveTo(width * 0.86, lhBaseY - 20, width + 10, lhBaseY + 6);
      ctx.lineTo(width + 10, lhBaseY + 18);
      ctx.closePath();
      ctx.fill();

      const lhH = Math.min(height * 0.23, 120);
      const lhTopY = lhBaseY - lhH;
      for (let s = 0; s < 4; s++) {
        const sy0 = lerp(lhBaseY - 10, lhTopY, s / 4);
        const sy1 = lerp(lhBaseY - 10, lhTopY, (s + 1) / 4);
        const w0 = lerp(14, 8, s / 4);
        const w1 = lerp(14, 8, (s + 1) / 4);
        ctx.fillStyle = rgbCss(lerpRgb([28, 28, 34], s % 2 === 0 ? [226, 232, 240] : [185, 28, 28], amb));
        ctx.beginPath();
        ctx.moveTo(lhX - w0, sy0);
        ctx.lineTo(lhX + w0, sy0);
        ctx.lineTo(lhX + w1, sy1);
        ctx.lineTo(lhX - w1, sy1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
        ctx.beginPath();
        ctx.moveTo(lhX + w0 * 0.2, sy0);
        ctx.lineTo(lhX + w0, sy0);
        ctx.lineTo(lhX + w1, sy1);
        ctx.lineTo(lhX + w1 * 0.2, sy1);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = lightGlow > 0.12 ? 'rgba(244, 218, 126, 0.68)' : '#e2e8f0';
      ctx.fillRect(lhX - 6, lhTopY - 11, 12, 11);
      if (lightGlow > 0.12 || sky.fogWeight > 0.3) {
        const sweep = Math.sin(tSec * 0.72) * 0.9;
        const beamLen = width * 0.60;
        const bx = lhX - Math.cos(sweep * 0.35) * beamLen;
        const by = lhTopY - 6 + Math.sin(sweep) * 90;
        const bAlpha = clamp01(Math.max(lightGlow, sky.fogWeight * 0.65)) * 0.14;
        const bg = ctx.createLinearGradient(lhX, lhTopY - 6, bx, by);
        bg.addColorStop(0, `rgba(250, 232, 168, ${bAlpha.toFixed(2)})`);
        bg.addColorStop(1, 'rgba(250, 232, 168, 0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(lhX, lhTopY - 10);
        ctx.lineTo(bx, by - 52);
        ctx.lineTo(bx, by + 52);
        ctx.lineTo(lhX, lhTopY - 2);
        ctx.closePath();
        ctx.fill();
      }

      // Mirror-wet gentle vertical lighthouse glimmer on wet sand below
      ctx.fillStyle = `rgba(250, 232, 168, ${(0.03 + lightGlow * 0.06).toFixed(2)})`;
      ctx.fillRect(lhX - 7, surfY + 4, 14, wetH * 0.62);

      // Authentic Cox's Bazar Curved-Prow Sampan Boat rocking gently in left coastal surf
      drawAnchoredSampan(ctx, width * 0.19, surfY - 6, 0.92, tSec, amb, lightGlow);

      // Delicate foreshore shells & tiny scuttling red ghost crabs (লাল কাঁকড়া) during calm daytime!
      if (sky.dayWeight > 0.35 && !isRaining) {
        for (let cr = 0; cr < 2; cr++) {
          const cx = width * (0.50 + cr * 0.14) + Math.sin(tSec * 1.6 + cr * 3.1) * 16;
          const cy = surfY + (height - surfY) * (0.42 + cr * 0.08);
          ctx.fillStyle = rgbCss(lerpRgb([74, 18, 16], [220, 48, 38], amb));
          ctx.beginPath();
          ctx.ellipse(cx, cy, 3.2, 2.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = rgbCss(lerpRgb([56, 52, 48], [234, 224, 206], amb), 0.72);
      [0.36, 0.54, 0.77].forEach((sf, si) => {
        ctx.beginPath();
        ctx.ellipse(width * sf, surfY + (height - surfY) * (0.48 + (si % 2) * 0.18), 2.4, 1.4, si * 0.6, 0, Math.PI * 2);
        ctx.fill();
      });

      const seaCh = Math.floor((tSec % 840) / 140);
      // Surf Bathers lifecycle: splashing in waves -> wading ashore -> drying with striped beach towel on wet sand!
      const batherPalette: RGB[] = [[239, 68, 68], [234, 179, 8], [16, 185, 129]];
      const mainBatherCol = batherPalette[seaCh % batherPalette.length];
      if (sky.dayWeight > 0.48 && sky.stormWeight < 0.35 && !isRaining) {
        const bathPhaseU = (tSec % 42) / 42;
        if (bathPhaseU < 0.48) {
          drawBeachBather(ctx, width * (seaCh % 2 === 0 ? 0.31 : 0.38), surfY - 2, 0.92, tSec, 0.2, mainBatherCol, amb, 'swimming');
        } else if (bathPhaseU < 0.64) {
          const wFrac = (bathPhaseU - 0.48) / 0.16;
          drawBeachBather(
            ctx,
            width * lerp(seaCh % 2 === 0 ? 0.31 : 0.38, 0.34, wFrac),
            lerp(surfY - 2, surfY + (height - surfY) * 0.24, wFrac),
            0.94,
            tSec,
            0.2,
            mainBatherCol,
            amb,
            'wading'
          );
        } else {
          drawBeachBather(ctx, width * 0.34, surfY + (height - surfY) * 0.24, 0.96, tSec, 0.2, mainBatherCol, amb, 'towel_drying');
        }

        if (seaCh % 2 === 0) {
          drawBeachBather(ctx, width * 0.49, surfY + 4, 0.98, tSec, 2.3, [14, 165, 233], amb, bathPhaseU > 0.72 ? 'wading' : 'swimming');
        }
      }

      // Beach-Ball Volley Game on Dry Sand in bright daytime!
      if (sky.dayWeight > 0.46 && !isRaining && sky.stormWeight < 0.3 && seaCh % 2 === 0) {
        drawBeachPlayers(ctx, width * 0.61, height * 0.88, 0.92, tSec, sky.dayWeight, sky.sunlightFactor, sky.windFactor, sky.windSign);
      }

      // Cox's Bazar Striped Kitkot Beach Umbrellas + Loungers + Visitors sipping green coconut (ডাব) rotating across chapters!
      if (sky.dayWeight > 0.14) {
        drawBeachUmbrellaAndLounger(
          ctx,
          width * 0.26,
          height * 0.89,
          0.95,
          [220, 38, 38],
          [248, 250, 252],
          tSec,
          sky.windFactor,
          sky.windSign,
          amb,
          isRaining,
          sky.dayWeight > 0.26 && seaCh !== 4,
          true
        );
        drawBeachUmbrellaAndLounger(
          ctx,
          width * 0.41,
          height * 0.87,
          0.88,
          [14, 165, 233],
          [250, 204, 21],
          tSec + 1.2,
          sky.windFactor,
          sky.windSign,
          amb,
          isRaining,
          !isRaining && sky.dayWeight > 0.32 && seaCh % 2 === 0,
          (tSec % 46) > 14
        );
        drawBeachUmbrellaAndLounger(
          ctx,
          width * 0.84,
          height * 0.90,
          0.92,
          [234, 88, 12],
          [254, 249, 195],
          tSec + 2.4,
          sky.windFactor,
          sky.windSign,
          amb,
          isRaining,
          sky.dayWeight > 0.26 && seaCh !== 1,
          true
        );
      }

      drawGrassTuftBand(
        ctx,
        width,
        0,
        width * 0.24,
        () => height * 0.94,
        64,
        8,
        17,
        6.1,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([12, 22, 14], [42, 78, 36], amb),
        [108, 156, 56],
        sky.sunlightFactor,
        null,
        sprigPack
      );

      // Animated Shorebirds: Daytime Egrets fishing shallow tide & Plovers (quiet before dusk!)
      if (sky.dayWeight >= 0.50 && sky.twilight <= 0.14 && sky.rainWeight < 0.22) {
        const waveSurge = washWave > 0.78;
        [
          { bx: 0.67, phase: 0.2, sc: 0.98, sp: 'egret' as BirdSpecies, yMul: 0.24 },
          { bx: 0.74, phase: 2.3, sc: 0.86, sp: 'egret' as BirdSpecies, yMul: 0.26 },
          { bx: 0.61, phase: 1.1, sc: 0.62, sp: 'doel' as BirdSpecies, yMul: 0.34 },
          { bx: 0.71, phase: 3.4, sc: 0.58, sp: 'doel' as BirdSpecies, yMul: 0.31 },
        ].forEach((eg, ei) => {
          const walkSpeed = eg.sp === 'egret' ? 0.55 : 1.45;
          const walkSpan = eg.sp === 'egret' ? 28 : 42;
          const walkCycle = tSec * walkSpeed + eg.phase;
          const ex = width * eg.bx + Math.sin(walkCycle) * walkSpan;
          const eDir: 1 | -1 = Math.cos(walkCycle) >= 0 ? 1 : -1;
          const eyBase = surfY + (height - surfY) * eg.yMul;
          const strikeWindow = ((tSec * 0.4 + ei * 1.7) % 4.5);
          const isFlyingHop = waveSurge && ei === 0;
          const flyLift = isFlyingHop ? Math.sin(((washWave - 0.78) / 0.22) * Math.PI) * 24 : 0;
          const dipTilt = !isFlyingHop && strikeWindow < 0.55 ? Math.sin((strikeWindow / 0.55) * Math.PI) * 0.85 : Math.sin(tSec * 1.7 + ei) * 0.14;

          drawRealisticBird(
            ctx,
            ex,
            eyBase - flyLift,
            eDir,
            eg.sc,
            isFlyingHop ? tSec * 9.0 : 0,
            false,
            !isFlyingHop,
            eg.sp === 'egret'
              ? rgbCss(lerpRgb([168, 174, 184], [248, 250, 252], sky.dayWeight))
              : rgbCss(lerpRgb([96, 86, 76], [198, 178, 152], sky.dayWeight)),
            0,
            null,
            eg.sp,
            false,
            dipTilt
          );
          if (eg.sp === 'egret' && dipTilt > 0.62) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.ellipse(ex + eDir * 12, eyBase + 6, 8, 2.5, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }

      // 14-Minute (840s) Multi-Chapter Beach Couple Story with smooth distance-calibrated stride
      if (isEveningCoupleTime) {
        const evalBeachCouple = (timeSec: number) => {
          const st = timeSec % 840;
          const ch = Math.floor(st / 140);
          const u = (st % 140) / 140;
          const reverseWalk = ch % 2 === 1;
          const startX = reverseWalk ? width * 0.90 : width * 0.21;
          const sitX = width * (ch % 3 === 1 ? 0.50 : 0.58);
          const endX = reverseWalk ? width * 0.21 : width * 0.90;
          if (u < 0.28) {
            const curX = lerp(startX, sitX, u / 0.28);
            return { x: curX, y: height * 0.815, sitting: false, dist: Math.abs(curX - startX) };
          } else if (u < 0.68) {
            return { x: sitX, y: height * 0.86, sitting: true, dist: Math.abs(sitX - startX) };
          } else {
            const curX = lerp(sitX, endX, (u - 0.68) / 0.32);
            return { x: curX, y: height * 0.815, sitting: false, dist: Math.abs(sitX - startX) + Math.abs(curX - sitX) };
          }
        };
        const cp0 = evalBeachCouple(tSec);
        const cp1 = evalBeachCouple(tSec + 0.08);
        const cpDx = cp1.x - cp0.x;
        const cpDir: 1 | -1 = Math.abs(cpDx) > 0.02 ? (cpDx >= 0 ? 1 : -1) : 1;
        if (!cp0.sitting) {
          ctx.fillStyle = `rgba(14, 22, 34, ${(0.16 * amb).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(cp0.x, cp0.y + 11, 14, 4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        drawBeachCouple(
          ctx,
          cp0.x,
          cp0.y,
          0.95,
          cp0.sitting ? tSec * 2.0 : cp0.dist * 0.22,
          cp0.sitting,
          sky.dayWeight,
          sky.sunlightFactor,
          sky.rainWeight,
          sky.windFactor,
          sky.windSign,
          cpDir
        );
      }

      if (sky.dayWeight > 0.28) {
        const p = pedestrians[1];
        const seaU = (tSec % 140) / 140;
        const pausingWaves = seaCh % 2 === 1 && seaU > 0.48 && seaU < 0.66;
        if (!prefersReducedMotion && !pausingWaves) {
          p.xFrac += dt * p.dir * (p.speed * 0.72);
          p.walkPhase += dt * (p.speed * 0.72 * width * 0.22);
          if (p.xFrac > 0.98) p.dir = -1;
          if (p.xFrac < 0.22) p.dir = 1;
        }
        if (p.xFrac < 0.22) p.xFrac = 0.22;
        const seaWalkerOutfits: HumanOutfit[] = ['panjabi', 'sari', 'shirt'];
        const seaWalkerCoats: RGB[] = [[228, 232, 240], [188, 64, 82], [68, 146, 178]];
        drawRealisticPerson(ctx, {
          x: p.xFrac * width,
          y: height * 0.84,
          facing: p.dir,
          scale: 0.9,
          walkPhase: pausingWaves ? 0 : p.walkPhase,
          outfit: seaWalkerOutfits[seaCh % seaWalkerOutfits.length],
          coatRgb: seaWalkerCoats[seaCh % seaWalkerCoats.length],
          lowerRgb: seaCh % 3 === 1 ? [226, 178, 92] : [38, 46, 58],
          hasUmbrella: sky.rainWeight > 0.08,
          umbrellaRgb: [24, 34, 52],
          dayWeight: sky.dayWeight,
          sunlightFactor: sky.sunlightFactor,
          moonVis: sky.effectiveMoonVis,
          rainWeight: sky.rainWeight,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          fogWeight: sky.fogWeight,
          action: pausingWaves ? 'looking' : 'walking',
          idleSec: tSec,
        });
      }

      // Draw Foreground Left Coconut Palms LAST (`y = height * 0.93`) so they always sit cleanly in front!
      let mainSeaPalm: ReturnType<typeof drawArticulatedPalm> | null = null;
      [
        { xFrac: 0.06, h: 0.44, lean: 0.2, seed: 4.2, fronds: 9 },
        { xFrac: 0.14, h: 0.34, lean: 0.08, seed: 7.6, fronds: 8 },
        { xFrac: 0.02, h: 0.28, lean: -0.05, seed: 9.1, fronds: 7 },
      ].forEach((pm, pIdx) => {
        const pAnchors = drawArticulatedPalm(
          ctx,
          width,
          width * pm.xFrac,
          height * 0.93,
          Math.min(height * pm.h, 265),
          pm.lean,
          pm.fronds,
          pm.seed,
          1.05,
          sky.windFactor,
          sky.windSign,
          tSec,
          sky.orbX,
          sky.orbY,
          rgbCss(lerpRgb([16, 14, 14], [62, 50, 40], amb)),
          sky.sunlightFactor > 0.16 ? rgbCss([220, 178, 112], 0.58) : null,
          rgbCss(lerpRgb([10, 24, 16], [30, 68, 36], amb)),
          rgbCss([128, 178, 76], 0.85),
          sky.sunlightFactor
        );
        if (pIdx === 0) mainSeaPalm = pAnchors;
      });

      const seaPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [
        { x: lhX, y: lhTopY - 11, species: 'gull', face: -1, exact: true },
      ];
      const seaNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean }> = [];
      if (mainSeaPalm) {
        const pMid = (mainSeaPalm as { frondMids: Array<{ x: number; y: number }>; frondTips: Array<{ x: number; y: number }> }).frondMids[0];
        const pTip = (mainSeaPalm as { frondMids: Array<{ x: number; y: number }>; frondTips: Array<{ x: number; y: number }> }).frondTips[1];
        if (pMid) seaPerches.push({ x: pMid.x, y: pMid.y, species: 'eagle', face: 1, exact: true });
        if (pTip) seaNests.push({ x: pTip.x, y: pTip.y, species: 'sparrow', style: 'weaver', scale: 0.9, exact: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['gull', 'egret', 'eagle', 'gull'],
        0.42,
        seaPerches,
        seaNests
      );
      renderSeasonalDrift(pheno, sky, dt);
      return surfY;
    };

    const renderMountain = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const amb = 0.2 + sky.dayWeight * 0.8;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.2 + sky.rainWeight * 0.25);
      const common = treeCommon(sky, pheno);
      const sunSide = sky.orbX <= width * 0.5 ? -1 : 1;

      // Craggy multi-octave triangle/ridged fractal mountain profile (ZERO cartoonish sine hills or semi-circle bumps!)
      const cragHeight = (x: number, amp: number, seed: number) => {
        const t1 = 1 - Math.abs(Math.sin(x * 0.0042 + seed));
        const t2 = 1 - Math.abs(Math.sin(x * 0.0115 - seed * 1.9));
        const t3 = 1 - Math.abs(Math.cos(x * 0.029 + seed * 3.7));
        const jag = Math.sin(x * 0.072 + seed * 5.1) * 0.08;
        return amp * (Math.pow(t1, 1.35) * 0.56 + Math.pow(t2, 1.25) * 0.28 + t3 * 0.16 + jag);
      };

      const ridgeDefs = [
        { yBase: 0.35, amp: 124, seed: 1.2, farRgb: [94, 118, 152] as RGB, shadeRgb: [56, 78, 114] as RGB, nightRgb: [16, 26, 46] as RGB },
        { yBase: 0.45, amp: 112, seed: 3.8, farRgb: [64, 92, 118] as RGB, shadeRgb: [36, 58, 84] as RGB, nightRgb: [13, 22, 38] as RGB },
        { yBase: 0.56, amp: 92, seed: 6.4, farRgb: [42, 76, 80] as RGB, shadeRgb: [22, 46, 54] as RGB, nightRgb: [10, 19, 30] as RGB },
        { yBase: 0.66, amp: 74, seed: 9.1, farRgb: [30, 66, 48] as RGB, shadeRgb: [16, 40, 30] as RGB, nightRgb: [8, 16, 22] as RGB },
      ];

      ridgeDefs.forEach((r, ri) => {
        const y0 = height * r.yBase;
        const stepX = 14;
        const pts: Array<{ x: number; y: number }> = [];
        for (let x = -stepX; x <= width + stepX; x += stepX) {
          pts.push({ x, y: y0 - cragHeight(x, r.amp, r.seed) });
        }

        // Lit base mountain silhouette
        const litRgb = lerpRgb(r.nightRgb, lerpRgb(r.farRgb, sky.horRgb, 0.22 * (3 - ri)), amb);
        const shadeRgb = lerpRgb(r.nightRgb, lerpRgb(r.shadeRgb, sky.horRgb, 0.16 * (3 - ri)), amb);
        const rGrad = ctx.createLinearGradient(0, y0 - r.amp, 0, y0 + 90);
        rGrad.addColorStop(0, rgbCss(litRgb));
        rGrad.addColorStop(0.65, rgbCss(lerpRgb(litRgb, shadeRgb, 0.45)));
        rGrad.addColorStop(1, rgbCss(lerpRgb(shadeRgb, sky.horRgb, 0.35)));
        ctx.fillStyle = rGrad;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, height);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pts[pts.length - 1].x, height);
        ctx.closePath();
        ctx.fill();

        // Faceted 3D chiseled cliff shadows on slopes facing away from sun + crisp sunlit ridge highlights!
        ctx.fillStyle = rgbCss(shadeRgb, 0.72);
        for (let i = 1; i < pts.length - 1; i++) {
          const p0 = pts[i - 1];
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const slope = p2.y - p0.y;
          const isShadedSlope = sunSide > 0 ? slope < -1.2 : slope > 1.2;
          if (isShadedSlope) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.lineTo(p2.x - sunSide * 24, y0 + 42);
            ctx.lineTo(p1.x - sunSide * 18, y0 + 42);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Irregular organic conifer & hill-forest silhouette tufts along lower ridges (NO semi-circle arcs!)
        if (ri >= 2) {
          const treeDark = rgbCss(lerpRgb([8, 16, 12], [18 + ri * 4, 46 + ri * 6, 30], amb), 0.92);
          ctx.fillStyle = treeDark;
          ctx.beginPath();
          ctx.moveTo(0, height);
          for (let i = 0; i < pts.length; i++) {
            const px = pts[i].x;
            const py = pts[i].y + 10;
            const spike = ((i * 7 + ri * 11) % 5) * 2.2 + 5;
            ctx.lineTo(px - 4, py + 3);
            ctx.lineTo(px, py - spike);
            ctx.lineTo(px + 4, py + 2);
          }
          ctx.lineTo(width, height);
          ctx.closePath();
          ctx.fill();
        }

        // Mist banks drifting between craggy valleys so peaks tower crisply above cool valley clouds
        if (ri < 3) {
          const mistY = y0 + 18;
          const mistA = 0.16 + sky.fogWeight * 0.28 + sky.rainWeight * 0.14;
          const mShift = ((tSec * (11 + ri * 4) * sky.windSign) % (width + 420)) - 210;
          for (let m = -1; m <= 2; m++) {
            const mx = mShift + m * (width * 0.62);
            const mg = ctx.createRadialGradient(mx, mistY, 8, mx, mistY, width * 0.40);
            mg.addColorStop(0, `rgba(228, 238, 248, ${mistA.toFixed(2)})`);
            mg.addColorStop(1, 'rgba(228, 238, 248, 0)');
            ctx.fillStyle = mg;
            ctx.beginPath();
            ctx.ellipse(mx, mistY, width * 0.40, height * 0.056, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      if (lightGlow > 0.14) {
        [
          { cx: width * 0.68, cy: height * 0.64 },
          { cx: width * 0.34, cy: height * 0.59 },
        ].forEach((hut) => {
          ctx.fillStyle = rgbCss([26, 22, 20]);
          ctx.fillRect(hut.cx - 14, hut.cy - 10, 28, 12);
          ctx.fillStyle = `rgba(236, 192, 98, ${(0.20 + lightGlow * 0.20).toFixed(2)})`;
          ctx.fillRect(hut.cx - 5, hut.cy - 6, 5, 4);
          ctx.fillRect(hut.cx + 4, hut.cy - 6, 4, 4);
        });
      }

      // Shimmering Multi-Tier Highland Waterfall (`পাহাড়ি ঝরনা`) flanked by dark stratified cliff rock!
      const wfX = width * 0.23;
      const wfTopY = height * 0.46;
      const wfBotY = height * 0.66;
      ctx.fillStyle = rgbCss(lerpRgb([14, 18, 22], [38, 44, 52], amb), 0.88);
      ctx.beginPath();
      ctx.moveTo(wfX - 18, wfTopY + 4);
      ctx.lineTo(wfX - 6, wfTopY - 6);
      ctx.lineTo(wfX + 10, wfTopY - 2);
      ctx.lineTo(wfX + 20, wfBotY + 4);
      ctx.lineTo(wfX - 20, wfBotY + 4);
      ctx.closePath();
      ctx.fill();

      const wfGrad = ctx.createLinearGradient(wfX - 6, wfTopY, wfX + 6, wfBotY);
      wfGrad.addColorStop(0, `rgba(220, 240, 254, ${(0.52 + amb * 0.38).toFixed(2)})`);
      wfGrad.addColorStop(0.55, `rgba(238, 248, 255, ${(0.58 + amb * 0.38).toFixed(2)})`);
      wfGrad.addColorStop(1, 'rgba(226, 242, 252, 0.14)');
      ctx.fillStyle = wfGrad;
      ctx.beginPath();
      ctx.moveTo(wfX - 5, wfTopY);
      ctx.lineTo(wfX + 5, wfTopY);
      ctx.lineTo(wfX + 10, wfBotY);
      ctx.lineTo(wfX - 8, wfBotY);
      ctx.closePath();
      ctx.fill();
      for (let ws = 0; ws < 6; ws++) {
        const sU = (tSec * 1.45 + ws * 0.17) % 1;
        const sy = lerp(wfTopY, wfBotY - 4, sU);
        const sx = wfX + (ws - 2.5) * 2.0;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(Math.sin(sU * Math.PI) * (0.52 + amb * 0.38)).toFixed(2)})`;
        ctx.lineWidth = 1.45;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy + 13);
        ctx.stroke();
      }
      const plungeMist = ctx.createRadialGradient(wfX, wfBotY - 2, 3, wfX, wfBotY - 2, 38);
      plungeMist.addColorStop(0, `rgba(236, 246, 255, ${(0.42 + amb * 0.30).toFixed(2)})`);
      plungeMist.addColorStop(1, 'rgba(236, 246, 255, 0)');
      ctx.fillStyle = plungeMist;
      ctx.beginPath();
      ctx.ellipse(wfX, wfBotY - 2, 38, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      // Winding mountain stream outflow below waterfall plunge pool
      ctx.strokeStyle = `rgba(196, 228, 246, ${(0.28 + amb * 0.24).toFixed(2)})`;
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(wfX, wfBotY + 3);
      ctx.quadraticCurveTo(wfX + 26, wfBotY + 20, wfX - 8, wfBotY + 42);
      ctx.stroke();

      const fgY = height * 0.78;
      const fgGrad = ctx.createLinearGradient(0, fgY - 20, 0, height);
      fgGrad.addColorStop(0, rgbCss(lerpRgb([10, 18, 14], [42, 74, 34], amb)));
      fgGrad.addColorStop(1, rgbCss(lerpRgb([6, 12, 10], [22, 46, 20], amb)));
      ctx.fillStyle = fgGrad;
      ctx.beginPath();
      ctx.moveTo(0, fgY + 18);
      ctx.quadraticCurveTo(width * 0.35, fgY - 18, width, fgY + 8);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      drawGrassTuftBand(
        ctx,
        width,
        0,
        width,
        (gx) => fgY + 10 + Math.sin(gx * 0.006) * 12,
        Math.min(130, Math.floor(width / 7.5)),
        8,
        18,
        5.5,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([8, 18, 10], [28, 66, 24], amb),
        [98, 158, 52],
        sky.sunlightFactor,
        [244, 188, 64],
        sprigPack
      );

      const mtCh = Math.floor((tSec % 840) / 140);
      // 14-Minute (840s) Multi-Chapter Mountain Deer Herd Story (walking, grazing, alert listening, curled shade rest)
      if (sky.dayWeight > 0.2 && sky.stormWeight < 0.45 && sky.rainWeight < 0.25) {
        const evalDeer = (timeSec: number) => {
          const st = timeSec % 840;
          const ch = Math.floor(st / 140);
          const u = (st % 140) / 140;
          const baseL = width * 0.40;
          const baseR = width * 0.66;
          if (ch % 2 === 0) {
            if (u < 0.28) return { x: lerp(baseL, baseR, u / 0.28), grazing: false, resting: false };
            if (u < 0.56) return { x: baseR, grazing: true, resting: false };
            if (u < 0.78) return { x: baseR, grazing: false, resting: true };
            return { x: lerp(baseR, baseL, (u - 0.78) / 0.22), grazing: false, resting: false };
          } else {
            if (u < 0.24) return { x: lerp(baseR, width * 0.50, u / 0.24), grazing: false, resting: false };
            if (u < 0.52) return { x: width * 0.50, grazing: true, resting: false };
            if (u < 0.74) return { x: width * 0.50, grazing: false, resting: false };
            return { x: lerp(width * 0.50, baseR, (u - 0.74) / 0.26), grazing: false, resting: false };
          }
        };
        const d0 = evalDeer(tSec);
        const d1 = evalDeer(tSec + 0.08);
        const dDx = d1.x - d0.x;
        const dWalking = Math.abs(dDx) > 0.03;
        const deerDir: 1 | -1 = dWalking ? (dDx >= 0 ? 1 : -1) : (mtCh % 2 === 0 ? 1 : -1);
        drawMountainDeer(ctx, d0.x, fgY + 22, deerDir, 0.92, tSec, dWalking ? 1 : 0, d0.grazing, amb, d0.resting);
        drawMountainDeer(ctx, d0.x - deerDir * 38, fgY + 28, deerDir, 0.78, tSec + 0.9, dWalking ? 1 : 0, d0.grazing, amb, d0.resting);
      }

      const koroiX = width * 0.85;
      const koroiY = height * 0.82;
      const koroiH = Math.min(height * 0.34, 210);
      const banyanX = width * 0.11;
      const banyanY = height * 0.89;
      const banyanH = Math.min(height * 0.45, 290);

      const mtNestSheltering = sky.rainWeight > 0.12 || sky.stormWeight > 0.25 || sky.dayWeight < 0.16;
      const mtNestFeeding = !mtNestSheltering && sky.twilight <= 0.18 && sky.dayWeight >= 0.46 && ((tSec * 0.048) % 1) >= 0.56 && ((tSec * 0.048) % 1) < 0.84;
      const mtMidSpecies: TreeSpecies =
        pheno.season === 'basanta'
          ? 'shimul'
          : pheno.season === 'barsha'
            ? 'kadamba'
            : 'jackfruit';
      const mtKoroi = drawLeafyBengalTree(ctx, { ...common, baseX: koroiX, baseY: koroiY, heightPx: koroiH, trunkW: 13, seed: 3.3, species: pheno.season === 'grishmo' ? 'krishnachura' : 'koroi', rootVariant: 'spread_right' });
      const mtBanyan = drawLeafyBengalTree(ctx, {
        ...common,
        baseX: banyanX,
        baseY: banyanY,
        heightPx: banyanH,
        trunkW: 19,
        seed: 8.8,
        species: 'banyan',
        rootVariant: 'buttress',
        renderForkNest: (c) => {
          drawBirdNestWithChicks(ctx, c.x, c.y - 1, 'cup', 0.94, tSec, sky.dayWeight >= 0.16, mtNestFeeding, amb, sky.windFactor, sky.windSign);
        },
      });
      const mtMango = drawLeafyBengalTree(ctx, { ...common, baseX: width * 0.3, baseY: height * 0.88, heightPx: Math.min(height * 0.28, 180), trunkW: 12, seed: 11.4, species: mtMidSpecies, rootVariant: 'spread_left' });

      // Foreground Highland Ridge Path (`height * 0.935` strictly IN FRONT of all background trees — ZERO trunk overlap!)
      if (sky.dayWeight > 0.22 && sky.rainWeight < 0.28 && sky.stormWeight < 0.38) {
        const evalTrekker = (timeSec: number) => {
          const st = timeSec % 840;
          const ch = Math.floor(st / 140);
          const u = (st % 140) / 140;
          if (ch % 2 === 1 && u > 0.55) return null;
          const spanU = ch % 2 === 1 ? u / 0.55 : u;
          const rev = ch === 2 || ch === 5;
          const x0 = rev ? width + 38 : -36;
          const x1 = rev ? -36 : width + 38;
          const stopX = width * (rev ? 0.48 : 0.56);
          if (spanU < 0.42) return { x: lerp(x0, stopX, spanU / 0.42), act: 'carrying_basket' as const };
          if (spanU < 0.58) return { x: stopX, act: 'looking' as const };
          return { x: lerp(stopX, x1, (spanU - 0.58) / 0.42), act: 'carrying_basket' as const };
        };
        const tr0 = evalTrekker(tSec);
        if (tr0) {
          const tr1 = evalTrekker(tSec + 0.08) ?? tr0;
          const tDx = tr1.x - tr0.x;
          const tMoving = tr0.act === 'carrying_basket' && Math.abs(tDx) > 0.03;
          const tFace: 1 | -1 = tMoving ? (tDx >= 0 ? 1 : -1) : 1;
          const hy = height * 0.935 + Math.sin(tr0.x * 0.008) * 4;
          drawRealisticPerson(ctx, {
            x: tr0.x,
            y: hy,
            facing: tFace,
            scale: 0.84,
            walkPhase: tMoving ? tSec * 5.8 : 0,
            outfit: 'shirt',
            coatRgb: [198, 76, 62],
            lowerRgb: [36, 48, 52],
            hasUmbrella: false,
            umbrellaRgb: [20, 20, 20],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: tr0.act,
            idleSec: tSec,
          });
        }
      }

      // Animated Highland Wildlife across chapters: Squirrels & Monkeys resting, climbing, or eating on exact tree limbs
      const isBadWeather = sky.rainWeight > 0.14 || sky.stormWeight > 0.25 || sky.dayWeight < 0.18;
      if (sky.dayWeight > 0.2 && sky.rainWeight < 0.22 && sky.stormWeight < 0.35) {
        const sqT = (tSec * 0.18) % 1;
        const sqClimb = mtCh % 2 === 0 && sqT < 0.42;
        const sqY = sqClimb ? lerp(banyanY - 22, banyanY - banyanH * 0.48, Math.sin((sqT / 0.42) * Math.PI)) : banyanY - banyanH * 0.48;
        drawMountainSquirrel(ctx, banyanX + (sqClimb ? -6 : 14), sqY, sqClimb ? 1 : -1, 0.95, tSec, sqClimb, amb);
        drawMountainSquirrel(ctx, koroiX - 4, koroiY - koroiH * 0.38, 1, 0.86, tSec + 2.1, mtCh % 3 === 1 && sqT > 0.6, amb);
      }

      if (sky.dayWeight > 0.12) {
        const mkCycle = (tSec * 0.10) % 1;
        const mkActivity: 'climbing' | 'eating' | 'resting' = isBadWeather ? 'resting' : mtCh % 3 === 2 ? 'resting' : mkCycle < 0.4 ? 'climbing' : 'eating';
        const mkLimb = mtKoroi.perches[1] ?? mtKoroi.perches[0] ?? { x: koroiX + 18, y: koroiY - koroiH * 0.56 };
        const mkX = mkActivity === 'climbing' ? lerp(koroiX - 20, mkLimb.x, Math.sin((mkCycle / 0.4) * Math.PI)) : mkLimb.x;
        const mkY = mkActivity === 'climbing' ? koroiY - koroiH * 0.52 : mkLimb.y;
        drawMountainMonkey(ctx, mkX, mkY, mkActivity === 'climbing' && mkCycle > 0.2 ? -1 : 1, 0.92, tSec, mkActivity, amb);
        const banLimb = mtBanyan.perches[0] ?? { x: banyanX + 24, y: banyanY - banyanH * 0.54 };
        drawMountainMonkey(ctx, banLimb.x, banLimb.y, -1, 0.82, tSec + 1.4, isBadWeather || mtCh % 2 === 1 ? 'resting' : 'eating', amb);
      }

      const mtPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [];
      if (mtMango.perches[0]) mtPerches.push({ ...mtMango.perches[0], species: 'sparrow', exact: true });
      if (mtKoroi.perches[0]) mtPerches.push({ ...mtKoroi.perches[0], species: 'doel', exact: true });
      const mtNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean; skipNestBody?: boolean }> = [];
      if (mtBanyan.forkCrotches[0]) {
        mtNests.push({ x: mtBanyan.forkCrotches[0].x, y: mtBanyan.forkCrotches[0].y - 1, species: 'doel', style: 'cup', scale: 0.94, exact: true, skipNestBody: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['eagle', 'sparrow', 'eagle', 'doel'],
        0.38,
        mtPerches,
        mtNests
      );
      renderSeasonalDrift(pheno, sky, dt);
      renderFireflies(sky, dt, 0.72, 0.94);
      return fgY;
    };

    const renderTrainWindow = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const horY = height * 0.49;
      const embY = height * 0.79;
      const amb = 0.22 + sky.dayWeight * 0.78;
      const speedPx = prefersReducedMotion ? 0 : 145;

      renderCountrysideBackdrop(sky, pheno, horY, embY, speedPx, amb, 1.0);

      // Railway utility poles & catenary wire outside window
      const poleSpan = 340;
      const poleShift = (tSec * speedPx) % poleSpan;
      ctx.strokeStyle = rgbCss(lerpRgb([12, 14, 18], [52, 58, 66], amb));
      let prevPoleX = -poleSpan - poleShift;
      for (let x = -poleShift; x < width + poleSpan; x += poleSpan) {
        ctx.lineWidth = 4.0;
        ctx.beginPath();
        ctx.moveTo(x, horY - height * 0.16);
        ctx.lineTo(x, embY + 6);
        ctx.stroke();

        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(prevPoleX, horY - height * 0.14);
        ctx.quadraticCurveTo((prevPoleX + x) * 0.5, horY - height * 0.1, x, horY - height * 0.14);
        ctx.stroke();
        prevPoleX = x;
      }

      // Passing railway yellow-black kilometer milestone marker post outside track
      const kmSpan = 620;
      const kmX = width - ((tSec * speedPx * 0.85) % kmSpan);
      ctx.fillStyle = rgbCss(lerpRgb([46, 42, 18], [234, 194, 48], amb));
      ctx.fillRect(kmX, embY - 24, 10, 24);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(kmX, embY - 24, 10, 6);

      // Narrow foreground railway gravel embankment strip (0.79..0.88)
      ctx.fillStyle = rgbCss(lerpRgb([16, 16, 18], [66, 62, 56], amb));
      ctx.fillRect(0, embY, width, height - embY);

      const winL = width * 0.08;
      const winT = height * 0.13;
      const winW = width * 0.84;
      const winH = height * 0.72;

      if (sky.rainWeight > 0.04) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(winL, winT, winW, winH, 16);
        ctx.clip();
        const cnt = Math.max(12, Math.floor(glassBeads.length * sky.rainWeight));
        for (let i = 0; i < cnt; i++) {
          const bd = glassBeads[i];
          if (!prefersReducedMotion) {
            bd.y += dt * bd.vy * (0.6 + sky.rainWeight);
            bd.x += dt * bd.vx * (0.8 + sky.windFactor * 0.5);
            if (bd.y > 1 || bd.x > 1.05) {
              bd.y = Math.random() * 0.25;
              bd.x = 0.05 + Math.random() * 0.85;
            }
          }
          const bx = winL + bd.x * winW;
          const by = winT + bd.y * winH;
          ctx.strokeStyle = `rgba(226, 240, 255, ${(0.24 * sky.rainWeight).toFixed(2)})`;
          ctx.lineWidth = bd.r * 0.75;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - bd.trail * 0.75, by - bd.trail * 0.85);
          ctx.stroke();
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.62 * sky.rainWeight).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(bx, by, bd.r * 0.65, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.save();
      // Subtle train window glass reflection streak
      ctx.strokeStyle = `rgba(226, 240, 255, ${(0.06 + amb * 0.04).toFixed(2)})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(winL + winW * 0.76, winT + 14);
      ctx.lineTo(winL + winW * 0.90, winT + 86);
      ctx.stroke();

      ctx.fillStyle = rgbCss(lerpRgb([10, 12, 18], [26, 32, 42], amb * 0.7));
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.roundRect(winL, winT, winW, winH, 18);
      ctx.fill('evenodd');

      ctx.strokeStyle = rgbCss(lerpRgb([32, 38, 48], [108, 118, 132], amb));
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(winL, winT, winW, winH, 18);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(winL, winT + winH * 0.34);
      ctx.lineTo(winL + winW, winT + winH * 0.34);
      ctx.stroke();

      const cFlutter = Math.sin(tSec * 3.8) * (4 + sky.windFactor * 5);
      ctx.fillStyle = rgbCss(lerpRgb([28, 22, 32], [116, 48, 56], amb));
      ctx.beginPath();
      ctx.moveTo(winL + 2, winT + 2);
      ctx.lineTo(winL + winW * 0.11, winT + 2);
      ctx.quadraticCurveTo(winL + winW * 0.09 + cFlutter, winT + winH * 0.5, winL + winW * 0.13 + cFlutter, winT + winH - 2);
      ctx.lineTo(winL + 2, winT + winH - 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      renderSeasonalDrift(pheno, sky, dt);
      return horY;
    };

    const renderBusWindow = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      // Countryside crops fill 0.48..0.77; highway occupies only narrow foreground strip (0.77..0.88)!
      const horY = height * 0.48;
      const roadTopY = height * 0.77;
      const amb = 0.22 + sky.dayWeight * 0.78;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.2 + sky.rainWeight * 0.35);
      const bgSpeed = prefersReducedMotion ? 0 : 138;

      renderCountrysideBackdrop(sky, pheno, horY, roadTopY, bgSpeed, amb, 7.3);

      // Narrow highway asphalt shoulder + guardrail posts along 0.77..0.88
      const postSpan = 120;
      const postShift = (tSec * bgSpeed) % postSpan;
      ctx.fillStyle = rgbCss(lerpRgb([18, 22, 28], [168, 174, 184], amb));
      ctx.fillRect(0, roadTopY - 3, width, 3.5);
      for (let x = -postShift; x < width + postSpan; x += postSpan) {
        ctx.fillRect(x, roadTopY - 6, 4, 8);
      }

      const roadGrad = ctx.createLinearGradient(0, roadTopY, 0, height);
      roadGrad.addColorStop(0, rgbCss(lerpRgb([14, 18, 26], [52, 58, 68], amb)));
      roadGrad.addColorStop(1, rgbCss(lerpRgb([8, 12, 18], [32, 38, 46], amb)));
      ctx.fillStyle = roadGrad;
      ctx.fillRect(0, roadTopY, width, height - roadTopY);

      const dashSpan = 160;
      const dashShift = (tSec * (prefersReducedMotion ? 0 : 250)) % dashSpan;
      ctx.fillStyle = `rgba(241, 245, 249, ${(0.45 + amb * 0.4).toFixed(2)})`;
      for (let x = -dashShift; x < width + dashSpan; x += dashSpan) {
        ctx.fillRect(x, roadTopY + (height - roadTopY) * 0.38, 64, 4);
      }

      if (lightGlow > 0.14 && !prefersReducedMotion) {
        const carCycle = (tSec * 0.48) % 2.4;
        if (carCycle < 1.0) {
          const cx = lerp(width * 0.9, -120, carCycle);
          const cy = roadTopY + 18;
          const hg = ctx.createRadialGradient(cx, cy, 1.5, cx, cy, 24);
          hg.addColorStop(0, `rgba(248, 232, 178, ${(0.32 * lightGlow).toFixed(2)})`);
          hg.addColorStop(1, 'rgba(248, 232, 178, 0)');
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.arc(cx, cy, 24, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const winL = width * 0.05;
      const winT = height * 0.11;
      const winW = width * 0.9;
      const winH = height * 0.76;

      if (sky.rainWeight > 0.04) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(winL, winT, winW, winH, 20);
        ctx.clip();
        const cnt = Math.max(14, Math.floor(glassBeads.length * sky.rainWeight));
        for (let i = 0; i < cnt; i++) {
          const bd = glassBeads[i];
          if (!prefersReducedMotion) {
            bd.y += dt * bd.vy * (0.65 + sky.rainWeight);
            bd.x -= dt * bd.vx * (0.85 + sky.windFactor * 0.45);
            if (bd.y > 1 || bd.x < -0.05) {
              bd.y = Math.random() * 0.25;
              bd.x = 0.1 + Math.random() * 0.85;
            }
          }
          const bx = winL + bd.x * winW;
          const by = winT + bd.y * winH;
          ctx.strokeStyle = `rgba(226, 240, 255, ${(0.22 * sky.rainWeight).toFixed(2)})`;
          ctx.lineWidth = bd.r * 0.75;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + bd.trail * 0.7, by - bd.trail * 0.8);
          ctx.stroke();
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.6 * sky.rainWeight).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(bx, by, bd.r * 0.65, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = rgbCss(lerpRgb([8, 12, 20], [22, 28, 38], amb * 0.65));
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.roundRect(winL, winT, winW, winH, 22);
      ctx.fill('evenodd');

      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(winL, winT, winW, winH, 22);
      ctx.stroke();

      ctx.fillStyle = rgbCss(lerpRgb([14, 18, 28], [38, 48, 66], amb));
      ctx.beginPath();
      ctx.roundRect(width * 0.76, height * 0.76, width * 0.22, height * 0.28, 22);
      ctx.fill();
      ctx.restore();

      renderSeasonalDrift(pheno, sky, dt);
      return horY;
    };

    const renderRooftop = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const wallY = height * 0.73;
      const amb = 0.2 + sky.dayWeight * 0.8;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.25 + sky.rainWeight * 0.35);
      const common = treeCommon(sky, pheno);
      const floorTop = wallY + height * 0.075;

      // Neighboring 3D apartment buildings across skyline
      const bCount = Math.max(6, Math.ceil(width / 108));
      for (let b = 0; b < bCount; b++) {
        const bx = (b / bCount) * width;
        const bw = width / bCount - 14;
        const bh = height * (0.16 + ((b * 11) % 7) * 0.028);
        draw3DCityBuilding(ctx, bx, wallY, bw, bh, 16, b + 5, amb * 0.9, lightGlow, [68, 82, 102], [44, 54, 70]);

        const chX = bx + bw * 0.62;
        const chY = wallY - bh;
        ctx.fillStyle = '#1e1b18';
        ctx.fillRect(chX + 3, chY - 10, 6, 10);
      }

      // Left foreground rooftop stair-room (চিলেকোঠার দরজা, গ্রিল-দেওয়া জানালা ও ছাদের পানির ট্যাংক)
      const chBaseX = width * 0.03;
      const chW = Math.min(136, width * 0.22);
      const chH = 148;
      const roofScale = Math.max(1.85, Math.min(2.40, height / 250));

      const wallGrad = ctx.createLinearGradient(chBaseX, wallY - chH, chBaseX, wallY);
      wallGrad.addColorStop(0, rgbCss(lerpRgb([26, 30, 38], [142, 148, 158], amb)));
      wallGrad.addColorStop(1, rgbCss(lerpRgb([18, 22, 28], [108, 114, 124], amb)));
      ctx.fillStyle = wallGrad;
      ctx.fillRect(chBaseX, wallY - chH, chW, chH);

      // Side perspective brick/plaster wall
      ctx.fillStyle = rgbCss(lerpRgb([14, 18, 24], [82, 88, 98], amb));
      ctx.beginPath();
      ctx.moveTo(chBaseX + chW, wallY - chH);
      ctx.lineTo(chBaseX + chW + 24, wallY - chH - 12);
      ctx.lineTo(chBaseX + chW + 24, wallY - 12);
      ctx.lineTo(chBaseX + chW, wallY);
      ctx.closePath();
      ctx.fill();

      // Overhanging rooftop stair-room cornice slab + weathered shadow lip
      ctx.fillStyle = rgbCss(lerpRgb([30, 34, 44], [156, 162, 172], amb));
      ctx.fillRect(chBaseX - 5, wallY - chH - 6, chW + 10, 7);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(chBaseX, wallY - chH + 1, chW, 4);

      // Overhead ribbed black water tank on concrete plinths + outlet PVC pipe
      ctx.fillStyle = rgbCss(lerpRgb([22, 26, 32], [102, 108, 118], amb));
      ctx.fillRect(chBaseX + 24, wallY - chH - 12, 8, 6);
      ctx.fillRect(chBaseX + 56, wallY - chH - 12, 8, 6);
      const tankGrad = ctx.createLinearGradient(chBaseX + 20, wallY - chH - 42, chBaseX + 68, wallY - chH - 42);
      tankGrad.addColorStop(0, rgbCss(lerpRgb([18, 22, 28], [46, 52, 62], amb)));
      tankGrad.addColorStop(0.5, rgbCss(lerpRgb([12, 16, 22], [28, 32, 40], amb)));
      tankGrad.addColorStop(1, rgbCss(lerpRgb([6, 8, 12], [16, 18, 24], amb)));
      ctx.fillStyle = tankGrad;
      ctx.beginPath();
      ctx.roundRect(chBaseX + 20, wallY - chH - 42, 48, 30, 5);
      ctx.fill();
      ctx.fillRect(chBaseX + 36, wallY - chH - 45, 16, 4);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      for (let tr = 1; tr <= 3; tr++) {
        const tryY = wallY - chH - 42 + tr * 7.5;
        ctx.beginPath();
        ctx.moveTo(chBaseX + 21, tryY);
        ctx.lineTo(chBaseX + 67, tryY);
        ctx.stroke();
      }
      // PVC water pipe running down beside stair-room
      ctx.strokeStyle = rgbCss(lerpRgb([30, 34, 42], [148, 156, 166], amb));
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(chBaseX + 20, wallY - chH - 18);
      ctx.lineTo(chBaseX + 10, wallY - chH - 18);
      ctx.lineTo(chBaseX + 10, wallY);
      ctx.stroke();

      // Recessed Paneled Wooden Door + Brass Handle + Threshold Step
      const doorFrameX = chBaseX + 16;
      const doorW = Math.min(36, chW * 0.34);
      const doorH = 94;
      ctx.fillStyle = '#18100c';
      ctx.fillRect(doorFrameX - 2, wallY - doorH - 2, doorW + 4, doorH + 2);
      const woodGrad = ctx.createLinearGradient(doorFrameX, wallY - doorH, doorFrameX + doorW, wallY);
      woodGrad.addColorStop(0, rgbCss(lerpRgb([28, 18, 12], [82, 52, 34], amb)));
      woodGrad.addColorStop(1, rgbCss(lerpRgb([18, 12, 8], [56, 34, 22], amb)));
      ctx.fillStyle = woodGrad;
      ctx.fillRect(doorFrameX, wallY - doorH, doorW, doorH);
      ctx.strokeStyle = 'rgba(18, 10, 6, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(doorFrameX + 4, wallY - doorH + 7, doorW - 8, 34);
      ctx.strokeRect(doorFrameX + 4, wallY - doorH + 48, doorW - 8, 38);
      ctx.fillStyle = rgbCss(lerpRgb([84, 68, 32], [216, 178, 76], amb));
      ctx.beginPath();
      ctx.arc(doorFrameX + doorW - 6, wallY - 46, 2, 0, Math.PI * 2);
      ctx.fill();

      // Recessed Grilled Window (balanced warm evening interior light, matching city windows cleanly)
      const winX = chBaseX + chW - 38;
      const winY = wallY - 90;
      ctx.fillStyle = rgbCss(lerpRgb([18, 22, 28], [76, 82, 92], amb));
      ctx.fillRect(winX - 2, winY - 2, 26, 30);
      ctx.fillStyle = lightGlow > 0.14 ? `rgba(244, 202, 114, ${(0.28 + 0.30 * lightGlow).toFixed(2)})` : '#1e293b';
      ctx.fillRect(winX, winY, 22, 26);
      ctx.strokeStyle = 'rgba(20, 24, 32, 0.85)';
      ctx.lineWidth = 1.1;
      for (let gx = 5; gx < 22; gx += 6) {
        ctx.beginPath();
        ctx.moveTo(winX + gx, winY);
        ctx.lineTo(winX + gx, winY + 26);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(winX, winY + 13);
      ctx.lineTo(winX + 22, winY + 13);
      ctx.stroke();

      // 3D Weathered Masonry Parapet Wall + Coping Stone Ledge + Brick Mortar Detail
      ctx.fillStyle = rgbCss(lerpRgb([18, 22, 30], [78, 82, 92], amb));
      ctx.fillRect(0, wallY, width, height * 0.075);
      ctx.fillStyle = `rgba(12, 16, 24, ${(0.22 + amb * 0.12).toFixed(2)})`;
      for (let br = 0; br < width; br += 36) {
        ctx.fillRect(br, wallY + 8, 1.2, 8);
        ctx.fillRect(br + 18, wallY + 18, 1.2, 8);
      }
      ctx.fillStyle = rgbCss(lerpRgb([28, 32, 42], [122, 128, 138], amb));
      ctx.fillRect(0, wallY - 6, width, 7);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(0, wallY + 1, width, 2.5);

      const floorGrad = ctx.createLinearGradient(0, floorTop, 0, height);
      floorGrad.addColorStop(0, rgbCss(lerpRgb([14, 18, 24], [68, 72, 82], amb)));
      floorGrad.addColorStop(1, rgbCss(lerpRgb([10, 12, 18], [50, 54, 64], amb)));
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, floorTop, width, height - floorTop);

      // Subtle concrete terrace tile grid lines in perspective
      ctx.strokeStyle = `rgba(15, 23, 42, ${(0.25 + amb * 0.18).toFixed(2)})`;
      ctx.lineWidth = 1;
      for (let gx = 0; gx < width; gx += 68) {
        ctx.beginPath();
        ctx.moveTo(gx, floorTop);
        ctx.lineTo(gx + (gx - width * 0.5) * 0.28, height);
        ctx.stroke();
      }

      // Shared Rooftop Chore Coordinates & Chapter Timeline (100% depth, speed & bird-feeding synchronized!)
      const doorX = doorFrameX + doorW * 0.5;
      const walkY = floorTop + height * 0.132;
      const tendY = floorTop + height * 0.036;
      const lineX0 = chBaseX + chW + 8;
      const lineX1 = Math.max(lineX0 + 115, width * 0.45);
      const handLineY = tendY - 43.8 * roofScale;
      const lineAnchorY = Math.min(wallY - 24, handLineY - 5);
      const lineY0 = lineAnchorY - 2;
      const lineY1 = lineAnchorY;
      const lineCtrlY = lineAnchorY + 8;
      const ropeYAt = (f: number) => {
        const u = 1 - f;
        return u * u * lineY0 + 2 * u * f * lineCtrlY + f * f * lineY1;
      };

      const clothDefs = [
        { frac: 0.22, kind: 'saree' as const, w: 22, h: 28, col: [224, 96, 112] as RGB },
        { frac: 0.52, kind: 'shirt' as const, w: 20, h: 24, col: [96, 165, 220] as RGB },
        { frac: 0.80, kind: 'towel' as const, w: 18, h: 25, col: [234, 178, 72] as RGB },
      ];
      const handOffX = 8.4 * roofScale;
      const clothSpotX = clothDefs.map((cl) => lerp(lineX0, lineX1, cl.frac) - handOffX);

      // Rooftop Garden Coordinates (cleanly separated right of clothesline!)
      const rackX = width * 0.55;
      const rackY = floorTop + height * 0.038;
      const rackW = Math.min(112, width * 0.16);
      const potLemonX = width * 0.50;
      const potLemonY = floorTop + height * 0.042;
      const potDrum1X = width * 0.725;
      const potDrum1Y = floorTop + height * 0.042;
      const potBougX = width * 0.805;
      const potBougY = floorTop + height * 0.046;
      const potGuavaX = width * 0.875;
      const potGuavaY = floorTop + height * 0.046;
      const potDrum2X = width * 0.945;
      const potDrum2Y = floorTop + height * 0.040;
      const bowlX = width * 0.455;
      const bowlY = floorTop + height * 0.135;

      // Exact same 2.5D floor plane (`y = potY + 2`) and horizontal reach so pouring water hits inside pot foliage & soil!
      const waterSpotFor = (potX: number, potY: number, face: 1 | -1) => ({
        x: potX - face * (21.5 * roofScale),
        y: Math.max(floorTop + 10, potY + 2),
      });

      const isRoofEvening = sky.dayWeight <= 0.52 || sky.twilight > 0.12;
      const roofSt = tSec % 780;
      const roofCh = Math.floor(roofSt / 130);
      const secInCh = roofSt % 130;
      // Uniform natural human terrace walking speed (`~46 px/s`) for BOTH couple partners!
      const roofWalkSpeed = Math.max(42, Math.min(54, width * 0.068));
      const moveSeg = (x0: number, y0: number, x1: number, y1: number): number =>
        Math.max(1.4, Math.hypot(x1 - x0, y1 - y0) / roofWalkSpeed);

      type RoofStep =
        | {
            kind: 'move';
            x0: number;
            y0: number;
            x1: number;
            y1: number;
            dur: number;
            act?: HumanActivity;
            bucketCount?: number;
          }
        | {
            kind: 'act';
            x: number;
            y: number;
            act: HumanActivity;
            faceLock: 1 | -1;
            dur: number;
            clothIdx?: number;
            bucketCount?: number;
          };

      const buildRoofSteps = (ch: number): RoofStep[] => {
        if (ch === 0) {
          const w1 = waterSpotFor(potLemonX, potLemonY, 1);
          const w2 = waterSpotFor(potBougX, potBougY, 1);
          const w3 = waterSpotFor(potGuavaX, potGuavaY, 1);
          const d0 = moveSeg(doorX, walkY, clothSpotX[0], tendY);
          const d1 = moveSeg(clothSpotX[0], tendY, clothSpotX[1], tendY);
          const d2 = moveSeg(clothSpotX[1], tendY, clothSpotX[2], tendY);
          const dDrop = moveSeg(clothSpotX[2], tendY, doorX + 20, walkY);
          const dw1 = moveSeg(doorX + 20, walkY, w1.x, w1.y);
          const dw2 = moveSeg(w1.x, w1.y, w2.x, w2.y);
          const dw3 = moveSeg(w2.x, w2.y, w3.x, w3.y);
          const dEnd = moveSeg(w3.x, w3.y, doorX, walkY);
          return [
            { kind: 'move', x0: doorX, y0: walkY, x1: clothSpotX[0], y1: tendY, dur: d0, act: 'carrying_bucket', bucketCount: 3 },
            { kind: 'act', x: clothSpotX[0], y: tendY, act: 'hanging_laundry', faceLock: 1, dur: 9, clothIdx: 0, bucketCount: 2 },
            { kind: 'move', x0: clothSpotX[0], y0: tendY, x1: clothSpotX[1], y1: tendY, dur: d1, act: 'carrying_bucket', bucketCount: 2 },
            { kind: 'act', x: clothSpotX[1], y: tendY, act: 'hanging_laundry', faceLock: 1, dur: 9, clothIdx: 1, bucketCount: 1 },
            { kind: 'move', x0: clothSpotX[1], y0: tendY, x1: clothSpotX[2], y1: tendY, dur: d2, act: 'carrying_bucket', bucketCount: 1 },
            { kind: 'act', x: clothSpotX[2], y: tendY, act: 'hanging_laundry', faceLock: 1, dur: 9, clothIdx: 2, bucketCount: 0 },
            { kind: 'move', x0: clothSpotX[2], y0: tendY, x1: doorX + 20, y1: walkY, dur: dDrop, act: 'carrying_bucket', bucketCount: 0 },
            { kind: 'move', x0: doorX + 20, y0: walkY, x1: w1.x, y1: w1.y, dur: dw1 },
            { kind: 'act', x: w1.x, y: w1.y, act: 'watering', faceLock: 1, dur: 9 },
            { kind: 'move', x0: w1.x, y0: w1.y, x1: w2.x, y1: w2.y, dur: dw2 },
            { kind: 'act', x: w2.x, y: w2.y, act: 'watering', faceLock: 1, dur: 9 },
            { kind: 'move', x0: w2.x, y0: w2.y, x1: w3.x, y1: w3.y, dur: dw3 },
            { kind: 'act', x: w3.x, y: w3.y, act: 'watering', faceLock: 1, dur: 9 },
            { kind: 'act', x: w3.x, y: w3.y, act: 'looking', faceLock: 1, dur: 6 },
            { kind: 'move', x0: w3.x, y0: w3.y, x1: doorX, y1: walkY, dur: dEnd },
          ];
        } else if (ch === 1) {
          const d1 = moveSeg(doorX, walkY, bowlX + 34, walkY);
          const d2 = moveSeg(bowlX + 34, walkY, width * 0.62, walkY);
          const d3 = moveSeg(width * 0.62, walkY, doorX, walkY);
          return [
            { kind: 'move', x0: doorX, y0: walkY, x1: bowlX + 34, y1: walkY, dur: d1 },
            { kind: 'act', x: bowlX + 34, y: walkY, act: 'feeding_birds', faceLock: -1, dur: 26 },
            { kind: 'move', x0: bowlX + 34, y0: walkY, x1: width * 0.62, y1: walkY, dur: d2 },
            { kind: 'act', x: width * 0.62, y: walkY, act: 'checking_watch', faceLock: 1, dur: 14 },
            { kind: 'act', x: width * 0.62, y: walkY, act: 'looking', faceLock: -1, dur: 16 },
            { kind: 'move', x0: width * 0.62, y0: walkY, x1: doorX, y1: walkY, dur: d3 },
          ];
        } else if (ch === 2) {
          const w1 = waterSpotFor(potDrum1X, potDrum1Y, 1);
          const w2 = waterSpotFor(potDrum2X, potDrum2Y, 1);
          const d0 = moveSeg(doorX, walkY, clothSpotX[2], tendY);
          const d1 = moveSeg(clothSpotX[2], tendY, clothSpotX[1], tendY);
          const d2 = moveSeg(clothSpotX[1], tendY, clothSpotX[0], tendY);
          const dDrop = moveSeg(clothSpotX[0], tendY, doorX + 20, walkY);
          const dw1 = moveSeg(doorX + 20, walkY, w1.x, w1.y);
          const dw2 = moveSeg(w1.x, w1.y, w2.x, w2.y);
          const dEnd = moveSeg(w2.x, w2.y, doorX, walkY);
          return [
            { kind: 'move', x0: doorX, y0: walkY, x1: clothSpotX[2], y1: tendY, dur: d0, act: 'carrying_bucket', bucketCount: 0 },
            { kind: 'act', x: clothSpotX[2], y: tendY, act: 'collecting_laundry', faceLock: 1, dur: 8, clothIdx: 2, bucketCount: 0 },
            { kind: 'move', x0: clothSpotX[2], y0: tendY, x1: clothSpotX[1], y1: tendY, dur: d1, act: 'carrying_bucket', bucketCount: 1 },
            { kind: 'act', x: clothSpotX[1], y: tendY, act: 'collecting_laundry', faceLock: 1, dur: 8, clothIdx: 1, bucketCount: 1 },
            { kind: 'move', x0: clothSpotX[1], y0: tendY, x1: clothSpotX[0], y1: tendY, dur: d2, act: 'carrying_bucket', bucketCount: 2 },
            { kind: 'act', x: clothSpotX[0], y: tendY, act: 'collecting_laundry', faceLock: 1, dur: 8, clothIdx: 0, bucketCount: 2 },
            { kind: 'move', x0: clothSpotX[0], y0: tendY, x1: doorX + 20, y1: walkY, dur: dDrop, act: 'carrying_bucket', bucketCount: 3 },
            { kind: 'move', x0: doorX + 20, y0: walkY, x1: w1.x, y1: w1.y, dur: dw1 },
            { kind: 'act', x: w1.x, y: w1.y, act: 'watering', faceLock: 1, dur: 10 },
            { kind: 'move', x0: w1.x, y0: w1.y, x1: w2.x, y1: w2.y, dur: dw2 },
            { kind: 'act', x: w2.x, y: w2.y, act: 'watering', faceLock: 1, dur: 10 },
            { kind: 'move', x0: w2.x, y0: w2.y, x1: doorX, y1: walkY, dur: dEnd },
          ];
        } else if (ch === 3) {
          const d1 = moveSeg(doorX, walkY, width * 0.44, walkY);
          const d2 = moveSeg(width * 0.44, walkY, width * 0.62, walkY);
          const d3 = moveSeg(width * 0.62, walkY, doorX, walkY);
          return [
            { kind: 'move', x0: doorX, y0: walkY, x1: width * 0.44, y1: walkY, dur: d1 },
            { kind: 'act', x: width * 0.44, y: walkY, act: 'sweeping', faceLock: 1, dur: 28 },
            { kind: 'move', x0: width * 0.44, y0: walkY, x1: width * 0.62, y1: walkY, dur: d2 },
            { kind: 'act', x: width * 0.62, y: walkY, act: 'looking', faceLock: -1, dur: 22 },
            { kind: 'move', x0: width * 0.62, y0: walkY, x1: doorX, y1: walkY, dur: d3 },
          ];
        } else if (ch === 4) {
          const w1 = waterSpotFor(potLemonX, potLemonY, 1);
          const w2 = waterSpotFor(potDrum1X, potDrum1Y, 1);
          const w3 = waterSpotFor(potBougX, potBougY, 1);
          const d1 = moveSeg(doorX, walkY, w1.x, w1.y);
          const d2 = moveSeg(w1.x, w1.y, w2.x, w2.y);
          const d3 = moveSeg(w2.x, w2.y, w3.x, w3.y);
          const d4 = moveSeg(w3.x, w3.y, bowlX + 34, walkY);
          const d5 = moveSeg(bowlX + 34, walkY, doorX, walkY);
          return [
            { kind: 'move', x0: doorX, y0: walkY, x1: w1.x, y1: w1.y, dur: d1 },
            { kind: 'act', x: w1.x, y: w1.y, act: 'watering', faceLock: 1, dur: 10 },
            { kind: 'move', x0: w1.x, y0: w1.y, x1: w2.x, y1: w2.y, dur: d2 },
            { kind: 'act', x: w2.x, y: w2.y, act: 'watering', faceLock: 1, dur: 10 },
            { kind: 'move', x0: w2.x, y0: w2.y, x1: w3.x, y1: w3.y, dur: d3 },
            { kind: 'act', x: w3.x, y: w3.y, act: 'watering', faceLock: 1, dur: 10 },
            { kind: 'move', x0: w3.x, y0: w3.y, x1: bowlX + 34, y1: walkY, dur: d4 },
            { kind: 'act', x: bowlX + 34, y: walkY, act: 'feeding_birds', faceLock: -1, dur: 22 },
            { kind: 'move', x0: bowlX + 34, y0: walkY, x1: doorX, y1: walkY, dur: d5 },
          ];
        } else {
          const d1 = moveSeg(doorX, walkY, width * 0.58, walkY);
          const d2 = moveSeg(width * 0.58, walkY, doorX, walkY);
          return [
            { kind: 'move', x0: doorX, y0: walkY, x1: width * 0.58, y1: walkY, dur: d1 },
            { kind: 'act', x: width * 0.58, y: walkY, act: 'looking', faceLock: 1, dur: 24 },
            { kind: 'act', x: width * 0.58, y: walkY, act: 'checking_watch', faceLock: -1, dur: 16 },
            { kind: 'move', x0: width * 0.58, y0: walkY, x1: doorX, y1: walkY, dur: d2 },
          ];
        }
      };

      const activeSteps = buildRoofSteps(roofCh);
      const pinSecs: [number, number, number] = [999, 999, 999];
      const unpinSecs: [number, number, number] = [999, 999, 999];
      {
        let tAcc = 0;
        for (const stp of activeSteps) {
          if (stp.kind === 'act' && stp.clothIdx !== undefined) {
            if (stp.act === 'hanging_laundry') pinSecs[stp.clothIdx] = tAcc + stp.dur * 0.72;
            if (stp.act === 'collecting_laundry') unpinSecs[stp.clothIdx] = tAcc + stp.dur * 0.30;
          }
          tAcc += stp.dur;
        }
      }

      // Interactive Clothesline (`কাপড়ের তার`): tucked inside cleanly as soon as evening arrives!
      const showClothesLine = !isRoofEvening && sky.rainWeight < 0.08 && sky.stormWeight < 0.2;
      if (showClothesLine) {
        ctx.strokeStyle = rgbCss(lerpRgb([24, 28, 36], [98, 108, 122], amb));
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(chBaseX + chW, lineY0 + 3);
        ctx.lineTo(lineX0, lineY0);
        ctx.moveTo(lineX1, wallY - 4);
        ctx.lineTo(lineX1, lineY1 - 4);
        ctx.stroke();
        ctx.fillStyle = rgbCss(lerpRgb([28, 34, 44], [122, 134, 148], amb));
        ctx.beginPath();
        ctx.arc(lineX0, lineY0, 2.5, 0, Math.PI * 2);
        ctx.arc(lineX1, lineY1, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(203, 213, 225, 0.78)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(lineX0, lineY0);
        ctx.quadraticCurveTo((lineX0 + lineX1) * 0.5, lineCtrlY, lineX1, lineY1);
        ctx.stroke();

        const clothWave = Math.sin(tSec * 3.1) * (2.6 + sky.windFactor * 6.5) * sky.windSign;
        const tLocalNow = secInCh - 5;
        clothDefs.forEach((cl, ci) => {
          const isVisible =
            roofCh === 0
              ? secInCh >= 5 && tLocalNow >= pinSecs[ci]
              : roofCh === 1
                ? true
                : roofCh === 2
                  ? secInCh < 5 || tLocalNow < unpinSecs[ci]
                  : false;
          if (!isVisible) return;
          const cx = lerp(lineX0, lineX1, cl.frac);
          const cy = ropeYAt(cl.frac);
          const baseC = lerpRgb([26, 22, 26], cl.col, amb);
          const shadeC = lerpRgb(baseC, [10, 12, 18], 0.34);
          const hiC = lerpRgb(baseC, [255, 250, 240], 0.16);
          const gGrad = ctx.createLinearGradient(cx - cl.w * 0.5, cy, cx + cl.w * 0.5, cy + cl.h);
          gGrad.addColorStop(0, rgbCss(hiC, 0.96));
          gGrad.addColorStop(0.55, rgbCss(baseC, 0.94));
          gGrad.addColorStop(1, rgbCss(shadeC, 0.92));
          ctx.fillStyle = gGrad;

          if (cl.kind === 'shirt') {
            ctx.beginPath();
            ctx.moveTo(cx - cl.w * 0.34, cy);
            ctx.lineTo(cx + cl.w * 0.34, cy);
            ctx.lineTo(cx + cl.w * 0.62 + clothWave * 0.4, cy + 7.5);
            ctx.lineTo(cx + cl.w * 0.46 + clothWave * 0.4, cy + 9.5);
            ctx.lineTo(cx + cl.w * 0.34 + clothWave * 0.5, cy + 7.2);
            ctx.lineTo(cx + cl.w * 0.38 + clothWave * 1.15, cy + cl.h);
            ctx.lineTo(cx - cl.w * 0.40 + clothWave * 0.95, cy + cl.h);
            ctx.lineTo(cx - cl.w * 0.34 + clothWave * 0.5, cy + 7.2);
            ctx.lineTo(cx - cl.w * 0.48 + clothWave * 0.4, cy + 9.5);
            ctx.lineTo(cx - cl.w * 0.62 + clothWave * 0.4, cy + 7.5);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(cx, cy + 1);
            ctx.lineTo(cx + clothWave * 0.6, cy + cl.h * 0.65);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(cx - cl.w * 0.42, cy);
            ctx.lineTo(cx + cl.w * 0.42, cy);
            ctx.quadraticCurveTo(cx + cl.w * 0.52 + clothWave, cy + cl.h * 0.55, cx + cl.w * 0.36 + clothWave * 1.15, cy + cl.h);
            ctx.lineTo(cx - cl.w * 0.44 + clothWave * 0.85, cy + cl.h);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle =
              cl.kind === 'saree'
                ? 'rgba(253, 230, 138, 0.58)'
                : 'rgba(185, 28, 28, 0.48)';
            ctx.lineWidth = cl.kind === 'saree' ? 1.6 : 2.1;
            ctx.beginPath();
            ctx.moveTo(cx - cl.w * 0.38 + clothWave * 0.72, cy + cl.h - 4.5);
            ctx.lineTo(cx + cl.w * 0.34 + clothWave * 1.0, cy + cl.h - 4.5);
            ctx.stroke();
          }
          ctx.fillStyle = '#d97706';
          ctx.fillRect(cx - cl.w * 0.26, cy - 3.0, 2.2, 4.5);
          ctx.fillRect(cx + cl.w * 0.24, cy - 3.0, 2.2, 4.5);
        });
      }

      // Overhead festoon lights (মরিচবাতি — >=50% softer night glow)
      const sag = 24;
      const p0y = height * 0.28;
      const p1y = height * 0.24;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, p0y);
      ctx.quadraticCurveTo(width * 0.5, (p0y + p1y) * 0.5 + sag, width, p1y);
      ctx.stroke();

      const bulbCount = 9;
      for (let bi = 1; bi < bulbCount; bi++) {
        const t = bi / bulbCount;
        const u = 1 - t;
        const bx = width * t + Math.sin(tSec * 2 + bi) * sky.windFactor * 3;
        const by = u * u * p0y + 2 * u * t * ((p0y + p1y) * 0.5 + sag) + t * t * p1y;
        ctx.fillStyle = lightGlow > 0.12 ? 'rgba(244, 212, 118, 0.68)' : '#cbd5e1';
        ctx.beginPath();
        ctx.arc(bx, by + 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (lightGlow > 0.12) {
          const g = ctx.createRadialGradient(bx, by + 4, 1, bx, by + 4, 18);
          g.addColorStop(0, `rgba(244, 200, 96, ${(0.22 * lightGlow).toFixed(2)})`);
          g.addColorStop(1, 'rgba(244, 200, 96, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by + 4, 18, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3D Terracotta Flower Pots seated squarely on right parapet
      const parapetPots: Array<{ x: number; kind: PottedFlowerKind; col: RGB; sc: number; trail: boolean }> = [
        { x: 0.52, kind: 'rose', col: [244, 63, 94], sc: 0.78, trail: true },
        { x: 0.63, kind: 'marigold', col: [245, 158, 11], sc: 0.74, trail: false },
        { x: 0.75, kind: 'hibiscus', col: [239, 68, 68], sc: 0.78, trail: false },
        { x: 0.87, kind: 'bougainvillea', col: [217, 70, 239], sc: 0.80, trail: true },
      ];
      parapetPots.forEach((ps, pi) => {
        draw3DPottedFlower(
          ctx,
          width * ps.x,
          wallY - 4,
          ps.sc,
          ps.kind,
          ps.col,
          tSec,
          sky.windFactor,
          sky.windSign,
          amb,
          pi * 1.9,
          ps.trail
        );
      });

      const roofDrumSpecies: TreeSpecies =
        pheno.season === 'barsha'
          ? 'kadamba'
          : pheno.season === 'basanta'
            ? 'shimul'
            : 'lychee';
      const tubTrees: Array<{ x: number; y: number; h: number; sp: TreeSpecies; seed: number }> = [
        { x: potDrum1X, y: potDrum1Y, h: 60, sp: 'krishnachura', seed: 8.1 },
        { x: potDrum2X, y: potDrum2Y, h: 64, sp: roofDrumSpecies, seed: 5.9 },
      ];
      const tubAnchors: ReturnType<typeof drawLeafyBengalTree>[] = [];
      tubTrees.forEach((tt) => {
        ctx.fillStyle = 'rgba(4, 8, 14, 0.38)';
        ctx.beginPath();
        ctx.ellipse(tt.x + 3, tt.y + 1, 20, 5.0, 0, 0, Math.PI * 2);
        ctx.fill();

        const drumGrad = ctx.createLinearGradient(tt.x - 17, tt.y - 24, tt.x + 17, tt.y - 24);
        drumGrad.addColorStop(0, rgbCss(lerpRgb([18, 30, 40], [52, 92, 124], amb)));
        drumGrad.addColorStop(0.6, rgbCss(lerpRgb([14, 24, 32], [38, 72, 98], amb)));
        drumGrad.addColorStop(1, rgbCss(lerpRgb([8, 16, 22], [24, 48, 68], amb)));
        ctx.fillStyle = drumGrad;
        ctx.beginPath();
        ctx.roundRect(tt.x - 16, tt.y - 24, 32, 24, [2, 2, 5, 5]);
        ctx.fill();
        ctx.fillStyle = rgbCss(lerpRgb([28, 36, 46], [68, 112, 148], amb));
        ctx.fillRect(tt.x - 17.5, tt.y - 25, 35, 3.5);
        ctx.fillRect(tt.x - 16.5, tt.y - 13, 33, 2.0);
        ctx.fillStyle = rgbCss(lerpRgb([10, 8, 6], [42, 30, 22], amb));
        ctx.beginPath();
        ctx.ellipse(tt.x, tt.y - 24.5, 14, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();

        tubAnchors.push(
          drawLeafyBengalTree(ctx, {
            ...common,
            baseX: tt.x,
            baseY: tt.y - 23.5,
            heightPx: tt.h,
            trunkW: 4.8,
            seed: tt.seed,
            species: tt.sp,
            inPlanter: true,
            rootVariant: 'slender',
          })
        );
      });

      const rackCol = rgbCss(lerpRgb([20, 16, 14], [92, 68, 48], amb));
      ctx.strokeStyle = rackCol;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(rackX, rackY);
      ctx.lineTo(rackX, rackY - 24);
      ctx.moveTo(rackX + rackW, rackY);
      ctx.lineTo(rackX + rackW, rackY - 24);
      ctx.stroke();
      ctx.fillStyle = rackCol;
      ctx.fillRect(rackX - 4, rackY - 24, rackW + 8, 3.8);
      ctx.fillRect(rackX - 4, rackY - 11, rackW + 8, 3.2);

      draw3DPottedFlower(ctx, rackX + rackW * 0.2, rackY - 24, 0.70, 'rose', [244, 63, 94], tSec, sky.windFactor, sky.windSign, amb, 5.2, false);
      draw3DPottedFlower(ctx, rackX + rackW * 0.52, rackY - 24, 0.68, 'marigold', [245, 158, 11], tSec, sky.windFactor, sky.windSign, amb, 6.4, true);
      draw3DPottedFlower(ctx, rackX + rackW * 0.84, rackY - 24, 0.70, 'hibiscus', [239, 68, 68], tSec, sky.windFactor, sky.windSign, amb, 3.8, false);

      draw3DFruitPlanter(ctx, potLemonX, potLemonY, 0.90, 'lemon', tSec, sky.windFactor, sky.windSign, amb);
      draw3DPottedFlower(ctx, potBougX, potBougY, 0.92, 'bougainvillea', [232, 121, 249], tSec, sky.windFactor, sky.windSign, amb, 7.8, true);
      draw3DFruitPlanter(ctx, potGuavaX, potGuavaY, 0.88, 'guava', tSec, sky.windFactor, sky.windSign, amb);

      ctx.fillStyle = rgbCss(lerpRgb([44, 22, 16], [156, 74, 46], amb));
      ctx.beginPath();
      ctx.ellipse(bowlX, bowlY, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb(sky.horRgb, [56, 124, 168], 0.55));
      ctx.beginPath();
      ctx.ellipse(bowlX, bowlY - 1.5, 11, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Rooftop people/couple strictly during clear daytime; once evening (`isRoofEvening`) arrives, everyone goes back inside `চিলেকোঠা`!
      let isFeedingBirdsNow = false;
      if (!isRoofEvening && sky.rainWeight < 0.25 && sky.stormWeight < 0.35) {
        const evalRoofActor = (timeSec: number) => {
          const st = timeSec % 780;
          const ch = Math.floor(st / 130);
          const sInCh = st % 130;
          if (sInCh < 5 || sInCh > 125) {
            return {
              hidden: true,
              x: doorX,
              y: walkY,
              dist: 0,
              act: 'walking' as HumanActivity,
              faceLock: null as 1 | -1 | null,
              carriedClothRgb: null as RGB | null | undefined,
              bucketCount: 2,
            };
          }
          const tLocal = sInCh - 5;
          const steps = buildRoofSteps(ch);
          let acc = 0;
          let accDist = 0;
          for (const stp of steps) {
            if (tLocal <= acc + stp.dur) {
              if (stp.kind === 'move') {
                const f = clamp01((tLocal - acc) / stp.dur);
                const curX = lerp(stp.x0, stp.x1, f);
                const curY = lerp(stp.y0, stp.y1, f);
                return {
                  hidden: false,
                  x: curX,
                  y: curY,
                  dist: accDist + Math.hypot(curX - stp.x0, curY - stp.y0),
                  act: (stp.act ?? 'walking') as HumanActivity,
                  faceLock: null as 1 | -1 | null,
                  carriedClothRgb: undefined,
                  bucketCount: stp.bucketCount ?? 2,
                };
              }
              let carriedClothRgb: RGB | null | undefined = undefined;
              let bCount = stp.bucketCount ?? 2;
              if (stp.clothIdx !== undefined) {
                const prog = clamp01((tLocal - acc) / stp.dur);
                if (stp.act === 'hanging_laundry') {
                  carriedClothRgb = prog < 0.72 ? clothDefs[stp.clothIdx].col : null;
                } else if (stp.act === 'collecting_laundry') {
                  carriedClothRgb = prog >= 0.30 && prog < 0.78 ? clothDefs[stp.clothIdx].col : null;
                  if (prog >= 0.78) bCount += 1;
                }
              }
              return {
                hidden: false,
                x: stp.x,
                y: stp.y,
                dist: accDist,
                act: stp.act,
                faceLock: stp.faceLock,
                carriedClothRgb,
                bucketCount: bCount,
              };
            }
            if (stp.kind === 'move') {
              accDist += Math.hypot(stp.x1 - stp.x0, stp.y1 - stp.y0);
            }
            acc += stp.dur;
          }
          return {
            hidden: true,
            x: doorX,
            y: walkY,
            dist: 0,
            act: 'walking' as HumanActivity,
            faceLock: null as 1 | -1 | null,
            carriedClothRgb: null as RGB | null | undefined,
            bucketCount: 2,
          };
        };

        const r0 = evalRoofActor(tSec);
        isFeedingBirdsNow = !r0.hidden && r0.act === 'feeding_birds';

        if (!r0.hidden) {
          const r1 = evalRoofActor(tSec + 0.08);
          const rDx = r1.x - r0.x;
          const rDy = r1.y - r0.y;
          const isWalkPose = r0.act === 'walking' || r0.act === 'carrying_bucket';
          const rMoving = isWalkPose && Math.hypot(rDx, rDy) > 0.03;
          const rFace: 1 | -1 = r0.faceLock ?? (rMoving && Math.abs(rDx) > 0.01 ? (rDx >= 0 ? 1 : -1) : 1);
          const walkRad = rMoving ? r0.dist * (0.22 / Math.max(1.2, roofScale)) : 0;

          const roofWomanCoats: RGB[] = [[46, 134, 152], [182, 74, 112], [68, 138, 96]];
          const roofPartnerCoats: RGB[] = [[194, 72, 86], [72, 138, 172], [218, 132, 54]];
          drawRealisticPerson(ctx, {
            x: r0.x,
            y: r0.y,
            facing: rFace,
            scale: roofScale,
            walkPhase: walkRad,
            outfit: roofCh % 2 === 1 ? 'panjabi' : 'sari',
            coatRgb: roofCh % 2 === 1 ? [216, 224, 236] : roofWomanCoats[Math.floor(roofCh / 2) % roofWomanCoats.length],
            lowerRgb: roofCh % 2 === 1 ? [34, 42, 58] : [228, 178, 86],
            hasUmbrella: false,
            umbrellaRgb: [20, 20, 20],
            dayWeight: sky.dayWeight,
            sunlightFactor: sky.sunlightFactor,
            moonVis: sky.effectiveMoonVis,
            rainWeight: sky.rainWeight,
            windFactor: sky.windFactor,
            windSign: sky.windSign,
            fogWeight: sky.fogWeight,
            action: r0.act,
            idleSec: tSec,
            carriedClothRgb: r0.carriedClothRgb,
            bucketClothCount: r0.bucketCount,
          });

          // Rooftop Couple Partner walking side-by-side at IDENTICAL calm human speed & synced stride in Ch 1/3/5!
          if (roofCh % 2 === 1) {
            const partnerX = r0.x - rFace * (24 * roofScale);
            const partnerY = r0.y + 4;
            const partnerAct: HumanActivity = rMoving ? 'walking' : r0.act === 'sweeping' ? 'looking' : r0.act === 'feeding_birds' ? 'looking' : r0.act;
            drawRealisticPerson(ctx, {
              x: partnerX,
              y: partnerY,
              facing: rFace,
              scale: roofScale * 0.94,
              walkPhase: rMoving ? walkRad + 1.15 : 0,
              outfit: 'sari',
              coatRgb: roofPartnerCoats[Math.floor(roofCh / 2) % roofPartnerCoats.length],
              lowerRgb: [232, 186, 98],
              hasUmbrella: false,
              umbrellaRgb: [20, 20, 20],
              dayWeight: sky.dayWeight,
              sunlightFactor: sky.sunlightFactor,
              moonVis: sky.effectiveMoonVis,
              rainWeight: sky.rainWeight,
              windFactor: sky.windFactor,
              windSign: sky.windSign,
              fogWeight: sky.fogWeight,
              action: partnerAct,
              idleSec: tSec + 0.9,
            });
          }
        }
      }

      // Live Rooftop Bird Flock eating scattered grain right beside `bowlX` whenever feeding_birds is active!
      if (isFeedingBirdsNow) {
        ctx.fillStyle = 'rgba(253, 224, 130, 0.85)';
        for (let gk = 0; gk < 9; gk++) {
          ctx.beginPath();
          ctx.ellipse(bowlX - 24 + gk * 5.2, bowlY + 4 + ((gk * 7) % 5) - 2, 1.5, 0.85, gk * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        const feedingBirds: Array<{ x: number; y: number; face: 1 | -1; sp: BirdSpecies; ph: number }> = [
          { x: bowlX - 22, y: bowlY + 2, face: 1, sp: 'pigeon', ph: 0.4 },
          { x: bowlX - 7, y: bowlY + 5, face: 1, sp: 'pigeon', ph: 2.1 },
          { x: bowlX + 7, y: bowlY + 3, face: -1, sp: 'sparrow', ph: 1.3 },
          { x: bowlX + 18, y: bowlY + 6, face: -1, sp: 'pigeon', ph: 3.5 },
        ];
        feedingBirds.forEach((fb) => {
          const hop = Math.abs(Math.sin(tSec * 2.8 + fb.ph)) > 0.92 ? -2.2 : 0;
          const peckTilt = Math.max(0, Math.sin(tSec * 5.4 + fb.ph)) * 0.72;
          const col =
            fb.sp === 'pigeon'
              ? rgbCss(lerpRgb([48, 56, 72], [122, 134, 152], sky.dayWeight), 0.96)
              : rgbCss(lerpRgb([52, 38, 28], [136, 98, 66], sky.dayWeight), 0.96);
          drawRealisticBird(ctx, fb.x, fb.y + hop, fb.face, fb.sp === 'pigeon' ? 0.82 : 0.72, 0, false, true, col, 0, null, fb.sp, false, peckTilt);
        });
      }

      const roofPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean; headTilt?: number }> = [
        {
          x: bowlX - 11,
          y: bowlY - 1.5,
          species: 'pigeon',
          face: 1,
          exact: true,
          headTilt: Math.max(0, Math.sin(tSec * 2.1)) * 0.65,
        },
      ];
      if (tubAnchors[0]?.perches[0]) roofPerches.push({ ...tubAnchors[0].perches[0], species: 'sparrow', exact: true });
      if (tubAnchors[1]?.perches[0]) roofPerches.push({ ...tubAnchors[1].perches[0], species: 'doel', exact: true });

      renderSceneBirds(
        sky,
        dt,
        ['pigeon', 'sparrow', 'doel', 'crow'],
        0.34,
        roofPerches,
        undefined,
        0.08,
        1.0,
        isFeedingBirdsNow
      );
      renderSeasonalDrift(pheno, sky, dt);
      return wallY;
    };

    const renderHaor = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const horY = height * 0.52;
      const amb = 0.22 + sky.dayWeight * 0.78;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.25 + sky.rainWeight * 0.25);
      const common = treeCommon(sky, pheno);
      const isNightSleep = sky.dayWeight <= 0.16;

      drawHorizonTreeline(horY, 18, 0.7, rgbCss(lerpRgb([12, 20, 32], [86, 118, 146], amb * 0.65)));

      // Distant haor island homestead mound (হাটি) on horizon right with muted dusk lantern speck
      const hatiX = width * 0.80;
      ctx.fillStyle = rgbCss(lerpRgb([12, 18, 24], [52, 74, 52], amb));
      ctx.beginPath();
      ctx.moveTo(hatiX - 58, horY + 4);
      ctx.quadraticCurveTo(hatiX, horY - 12, hatiX + 58, horY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb([18, 22, 26], [108, 114, 122], amb));
      ctx.fillRect(hatiX - 18, horY - 10, 22, 8);
      if (lightGlow > 0.18) {
        ctx.fillStyle = `rgba(234, 192, 98, ${(0.28 * lightGlow).toFixed(2)})`;
        ctx.fillRect(hatiX - 11, horY - 7, 3, 3);
      }

      const hGrad = ctx.createLinearGradient(0, horY, 0, height);
      hGrad.addColorStop(0, rgbCss(lerpRgb(sky.horRgb, [28, 62, 88], 0.28)));
      hGrad.addColorStop(0.5, rgbCss(lerpRgb(sky.midRgb, [18, 48, 72], 0.48)));
      hGrad.addColorStop(1, rgbCss(lerpRgb(sky.topRgb, [12, 34, 54], 0.58)));
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, horY, width, height - horY);

      drawAnimatedWaterSurface(horY, height, amb, sky, true);
      drawWaterShimmer(ctx, sky.orbX, horY, height, tSec, sky);

      // Well-spaced Submerged Hijol grove & strict Painter's Depth Sort queue so ZERO boat or net overlaps ANY tree!
      const hijols = [
        { hx: 0.11, hy: 0.66, h: 0.29, seed: 10.2, rv: 'buttress' as TreeRootVariant },
        { hx: 0.21, hy: 0.71, h: 0.23, seed: 14.5, rv: 'spread_left' as TreeRootVariant },
        { hx: 0.89, hy: 0.69, h: 0.31, seed: 18.1, rv: 'spread_right' as TreeRootVariant },
      ];

      if (!prefersReducedMotion && !isNightSleep) {
        const farBoat = boats[2];
        farBoat.x += dt * farBoat.dir * (farBoat.speed * 0.54);
        farBoat.phase += dt * 1.9;
        if (farBoat.dir > 0 && farBoat.x > width + 110) farBoat.x = -110;
        if (farBoat.dir < 0 && farBoat.x < -110) farBoat.x = width + 110;

        const nearBoat = boats[1];
        nearBoat.x += dt * nearBoat.dir * (nearBoat.speed * 1.15);
        nearBoat.phase += dt * 2.1;
        if (nearBoat.dir > 0 && nearBoat.x > width + 110) nearBoat.x = -110;
        if (nearBoat.dir < 0 && nearBoat.x < -110) nearBoat.x = width + 110;
      }

      const drawQueue: Array<{ sortY: number; draw: () => void }> = [];
      const hijolAnchors: Array<ReturnType<typeof drawLeafyBengalTree> | null> = [null, null, null];
      const hNestSheltering = sky.rainWeight > 0.12 || sky.stormWeight > 0.25 || sky.dayWeight < 0.16;
      const hNestFeeding = !hNestSheltering && sky.twilight <= 0.18 && sky.dayWeight >= 0.46 && ((tSec * 0.048) % 1) >= 0.56 && ((tSec * 0.048) % 1) < 0.84;

      hijols.forEach((ht, hi) => {
        const tx = width * ht.hx;
        const ty = height * ht.hy;
        drawQueue.push({
          sortY: ty,
          draw: () => {
            ctx.save();
            ctx.globalAlpha = 0.24;
            ctx.fillStyle = rgbCss([10, 18, 24]);
            ctx.beginPath();
            ctx.ellipse(tx, ty + 24, 34, 14, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            hijolAnchors[hi] = drawLeafyBengalTree(ctx, {
              ...common,
              baseX: tx,
              baseY: ty,
              heightPx: Math.min(height * ht.h, 195),
              trunkW: 13,
              seed: ht.seed,
              species: 'hijol',
              rootVariant: ht.rv,
              renderForkNest: hi === 0
                ? (c) => {
                    drawBirdNestWithChicks(ctx, c.x, c.y - 1, 'cup', 0.9, tSec, sky.dayWeight >= 0.16, hNestFeeding, amb, sky.windFactor, sky.windSign);
                  }
                : undefined,
            });
            ctx.strokeStyle = `rgba(226, 242, 255, ${(0.22 + amb * 0.18).toFixed(2)})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.ellipse(tx, ty + 3, 22 + Math.sin(tSec * 1.8 + hi) * 3, 4.5, 0, 0, Math.PI * 2);
            ctx.stroke();
          },
        });
      });

      const hChapter = Math.floor((tSec % 840) / 140);
      const hSubU = (tSec % 140) / 140;

      // Swimming Haor Mother Ducks + trailing tiny ducklings paddling across wetland lanes
      if (sky.dayWeight > 0.2 && !isNightSleep) {
        drawQueue.push({
          sortY: height * 0.74,
          draw: () => {
            const duckBaseX = width * (hChapter % 2 === 0 ? 0.28 : 0.72);
            for (let di = 0; di < 2; di++) {
              const sT = tSec * 0.28 + di * 2.1;
              const dx = duckBaseX + Math.sin(sT) * 42;
              const dy = height * 0.74 + di * 8 + Math.cos(tSec * 0.5 + di) * 3;
              const dDir: 1 | -1 = Math.cos(sT) >= 0 ? 1 : -1;
              drawRealisticDuck(ctx, dx, dy, dDir, di === 0 ? 0.92 : 0.82, tSec, di * 2.1, di === 0, amb);
              if (di === 0) {
                drawRealisticDuck(ctx, dx - dDir * 19, dy + 4, dDir, 0.48, tSec, 1.4, false, amb);
                drawRealisticDuck(ctx, dx - dDir * 31, dy + 6, dDir, 0.44, tSec, 2.2, false, amb);
              }
            }
          },
        });
      }

      if (!isNightSleep) {
        const farBoat = boats[2];
        const farY = height * (hChapter % 2 === 0 ? 0.56 : 0.58) + Math.sin(tSec * 1.6 + farBoat.phase) * 2.0;
        drawQueue.push({
          sortY: farY,
          draw: () =>
            drawRealisticBoat(ctx, {
              type: farBoat.type,
              x: farBoat.x,
              y: farY,
              facing: farBoat.dir,
              scale: 0.55,
              wavePitch: Math.sin(tSec * 1.9 + farBoat.phase),
              oarPhase: farBoat.phase,
              windFactor: sky.windFactor,
              windSign: sky.windSign,
              sailRgb: farBoat.sailRgb,
              dayWeight: sky.dayWeight,
              lightGlow,
              hasLantern: true,
              sunlightFactor: sky.sunlightFactor,
            }),
        });

        // Keep continuous time `tSec + 1.5` so fisherman cast/haul motion NEVER jumps abruptly during resting beats!
        const hijolObstacles = hijols.map((h) => ({ x: width * h.hx, y: height * h.hy, r: 90 }));
        const netCenterX = width * (hChapter % 3 === 1 ? 0.46 : hChapter % 3 === 2 ? 0.56 : 0.51);
        const netRestingNow = hChapter % 2 === 1 && hSubU > 0.66;
        const boatNearNet = Math.abs(farBoat.x - netCenterX) < 145 || Math.abs(boats[1].x - netCenterX) < 145;
        drawQueue.push({
          sortY: height * 0.685,
          draw: () =>
            drawFishermanCastingNet(
              ctx,
              netCenterX,
              height * 0.685,
              0.94,
              tSec + 1.5,
              amb,
              width * 0.085,
              height * 0.012,
              hijolObstacles,
              (pan) => stormAudio.triggerNetSplash(pan),
              width,
              boatNearNet || netRestingNow
            ),
        });

        const nearBoat = boats[1];
        const nearY = height * 0.845 + Math.sin(tSec * 1.6 + nearBoat.phase) * 2.4;
        drawQueue.push({
          sortY: nearY,
          draw: () =>
            drawRealisticBoat(ctx, {
              type: nearBoat.type,
              x: nearBoat.x,
              y: nearY,
              facing: nearBoat.dir,
              scale: 1.04,
              wavePitch: Math.sin(tSec * 1.9 + nearBoat.phase),
              oarPhase: nearBoat.phase,
              windFactor: sky.windFactor,
              windSign: sky.windSign,
              sailRgb: nearBoat.sailRgb,
              dayWeight: sky.dayWeight,
              lightGlow,
              hasLantern: true,
              sunlightFactor: sky.sunlightFactor,
            }),
        });

        drawQueue.sort((a, b) => a.sortY - b.sortY);
        drawQueue.forEach((item) => item.draw());
      } else {
        drawQueue.sort((a, b) => a.sortY - b.sortY);
        drawQueue.forEach((item) => item.draw());
        const treeX = width * 0.24;
        const treeY = height * 0.69;
        const mooredX = width * 0.34;
        const mooredY = height * 0.72 + Math.sin(tSec * 1.3) * 1.8;

        ctx.strokeStyle = 'rgba(186, 154, 114, 0.76)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(treeX + 5, treeY - 6);
        ctx.quadraticCurveTo((treeX + mooredX - 38) * 0.5, mooredY + 4, mooredX - 42, mooredY - 5);
        ctx.stroke();

        drawRealisticBoat(ctx, {
          type: 'chhoi',
          x: mooredX,
          y: mooredY,
          facing: 1,
          scale: 1.05,
          wavePitch: Math.sin(tSec * 1.4) * 0.55,
          oarPhase: 0,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          sailRgb: [228, 224, 214],
          dayWeight: sky.dayWeight,
          lightGlow: Math.max(0.45, lightGlow),
          hasLantern: true,
          sunlightFactor: sky.sunlightFactor,
          isMoored: true,
        });
      }

      const haorPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [];
      if (hijolAnchors[0]?.perches[0]) haorPerches.push({ ...hijolAnchors[0].perches[0], species: 'egret', exact: true });
      if (hijolAnchors[2]?.perches[0]) haorPerches.push({ ...hijolAnchors[2].perches[0], species: 'egret', exact: true });
      const haorNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean; skipNestBody?: boolean }> = [];
      if (hijolAnchors[0]?.forkCrotches[0]) {
        haorNests.push({ x: hijolAnchors[0].forkCrotches[0].x, y: hijolAnchors[0].forkCrotches[0].y - 1, species: 'doel', style: 'cup', scale: 0.9, exact: true, skipNestBody: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['egret', 'egret', 'doel', 'gull'],
        0.36,
        haorPerches,
        haorNests
      );
      renderSeasonalDrift(pheno, sky, dt);
      return horY;
    };

    const renderTeaGarden = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const amb = 0.24 + sky.dayWeight * 0.76;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.2 + sky.rainWeight * 0.25);
      const common = treeCommon(sky, pheno);
      const isDeepNight = sky.dayWeight < 0.14 && sky.twilight <= 0.14;
      const isDuskWalkHome = sky.twilight > 0.14 || (sky.dayWeight >= 0.14 && sky.dayWeight < 0.48);

      // Distant estate bungalow atop far ridge (চা বাগানের বাংলো) with gentle muted window glow
      const bngX = width * 0.72;
      const bngY = height * 0.44;
      ctx.fillStyle = rgbCss(lerpRgb([16, 20, 22], [186, 182, 168], amb), 0.85);
      ctx.fillRect(bngX - 18, bngY - 12, 36, 12);
      ctx.fillStyle = rgbCss(lerpRgb([22, 14, 14], [128, 48, 38], amb));
      ctx.beginPath();
      ctx.moveTo(bngX - 24, bngY - 11);
      ctx.lineTo(bngX, bngY - 21);
      ctx.lineTo(bngX + 24, bngY - 11);
      ctx.closePath();
      ctx.fill();
      if (lightGlow > 0.18) {
        ctx.fillStyle = `rgba(236, 192, 98, ${(0.28 * lightGlow).toFixed(2)})`;
        ctx.fillRect(bngX - 9, bngY - 8, 5, 4);
        ctx.fillRect(bngX + 4, bngY - 8, 5, 4);
      }

      // 4 Undulating Sculpted 3D Tea Hillside Terraces (solid opaque overlapping 3D tea cushions — NEVER flat horizontal stripes!)
      const slopes = [
        { yBase: 0.45, freq: 0.0075, amp: 28, rgb: [20, 62, 28] as RGB, bandRows: 2 },
        { yBase: 0.56, freq: 0.0095, amp: 34, rgb: [24, 76, 32] as RGB, bandRows: 3 },
        { yBase: 0.69, freq: 0.0085, amp: 30, rgb: [28, 90, 34] as RGB, bandRows: 3 },
        { yBase: 0.82, freq: 0.0105, amp: 22, rgb: [22, 70, 28] as RGB, bandRows: 3 },
      ];

      slopes.forEach((s, si) => {
        const y0 = height * s.yBase;
        const fillCol = lerpRgb([9, 20, 14], s.rgb, amb);
        const shadeUnder = lerpRgb([6, 14, 10], lerpRgb(s.rgb, [8, 22, 12], 0.45), amb);
        const hillGrad = ctx.createLinearGradient(0, y0 - s.amp, 0, y0 + 130);
        hillGrad.addColorStop(0, rgbCss(fillCol));
        hillGrad.addColorStop(1, rgbCss(shadeUnder));
        ctx.fillStyle = hillGrad;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 20; x += 20) {
          const y = y0 + Math.sin(x * s.freq + si * 1.8) * s.amp;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // Tightly shingled matte leafy tea shrub hedges with organic organic vertical/scale variation (zero ribbon domes!)
        const bushW = 92 + si * 14;
        const bushH = 52 + si * 9;
        const stepX = 24 + si * 4;
        for (let row = 0; row < s.bandRows; row++) {
          for (let bx = -24; bx <= width + stepX; bx += stepX) {
            const idx = Math.abs(Math.floor(bx / stepX + si * 7 + row * 13));
            const jitterY = Math.sin(idx * 2.7 + si) * 5.5;
            const scaleVar = 0.92 + ((idx % 4) * 0.06);
            const by = y0 + row * (20 + si * 5) + Math.sin(bx * s.freq + si * 1.8) * s.amp + 8 + jitterY;
            const waveTilt = Math.sin(bx * 0.025 - tSec * (1.8 + sky.windFactor) * sky.windSign + row) * (0.03 + sky.windFactor * 0.045);

            ctx.save();
            ctx.translate(bx + (row % 2) * (stepX * 0.45), by);
            ctx.transform(1, 0, waveTilt, 1, 0, 0);
            ctx.globalAlpha = 0.98;
            ctx.drawImage(sprigPack.teaDark[idx % sprigPack.teaDark.length], -bushW * 0.5 * scaleVar, -bushH * 0.65 * scaleVar, bushW * scaleVar, bushH * scaleVar);
            if (amb > 0.28) {
              ctx.globalAlpha = clamp01((amb - 0.16) * (0.76 + sky.sunlightFactor * 0.24));
              ctx.drawImage(sprigPack.teaSun[idx % sprigPack.teaSun.length], -bushW * 0.5 * scaleVar, -bushH * 0.65 * scaleVar, bushW * scaleVar, bushH * scaleVar);
            }
            ctx.restore();
          }
        }

        if (si < 2 && (sky.fogWeight > 0.1 || sky.rainWeight > 0.2)) {
          const mg = ctx.createLinearGradient(0, y0 - 12, 0, y0 + 24);
          mg.addColorStop(0, 'rgba(226, 238, 246, 0)');
          mg.addColorStop(0.5, `rgba(226, 238, 246, ${(0.16 + sky.fogWeight * 0.24).toFixed(2)})`);
          mg.addColorStop(1, 'rgba(226, 238, 246, 0)');
          ctx.fillStyle = mg;
          ctx.fillRect(0, y0 - 12, width, 36);
        }
      });

      // Perspective Red-Clay Tea Estate Trail carved naturally between lush grassy shoulders (NEVER a thin pencil stroke!)
      const trailBotY = height * 0.94;
      const trailTopY = height * 0.79;
      const trailGrad = ctx.createLinearGradient(0, trailTopY, 0, height);
      trailGrad.addColorStop(0, rgbCss(lerpRgb([24, 16, 12], [124, 72, 46], amb)));
      trailGrad.addColorStop(1, rgbCss(lerpRgb([18, 12, 10], [156, 94, 58], amb)));

      // Soft shaded earthen shoulder embankment under trail
      ctx.fillStyle = rgbCss(lerpRgb([12, 18, 12], [44, 76, 30], amb));
      ctx.beginPath();
      ctx.moveTo(0, trailBotY - 38);
      ctx.quadraticCurveTo(width * 0.52, trailTopY - 12, width, trailTopY + 4);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = trailGrad;
      ctx.beginPath();
      ctx.moveTo(0, trailBotY - 22);
      ctx.quadraticCurveTo(width * 0.52, trailTopY - 2, width, trailTopY + 10);
      ctx.lineTo(width, trailTopY + 26);
      ctx.quadraticCurveTo(width * 0.52, trailTopY + 34, 0, height + 6);
      ctx.closePath();
      ctx.fill();

      // Subtle darker wheel/footpath track ruts & warm trail edge highlight
      ctx.strokeStyle = `rgba(38, 20, 12, ${(0.16 + amb * 0.14).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, trailBotY - 6);
      ctx.quadraticCurveTo(width * 0.52, trailTopY + 14, width, trailTopY + 19);
      ctx.stroke();

      // Lush grassy borders flanking trail cleanly
      drawGrassTuftBand(
        ctx,
        width,
        0,
        width,
        (gx) => lerp(trailBotY - 22, trailTopY + 10, gx / width) - Math.sin((gx / width) * Math.PI) * 10,
        Math.min(125, Math.floor(width / 7.5)),
        7,
        15,
        3.9,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([10, 22, 12], [32, 72, 28], amb),
        [104, 162, 52],
        sky.sunlightFactor,
        null,
        sprigPack
      );

      // Tea Shade Trees positioned off to left (`0.11`) and right (`0.89`) so center sky stays wide open for Sun & Moon!
      // Plus a graceful slender coconut palm off-center left (`0.33`) clear of central sun arc!
      const koroiSpecs: Array<{ kx: number; ky: number; rv: TreeRootVariant; sp: TreeSpecies }> = [
        { kx: 0.11, ky: 0.61, rv: 'spread_left', sp: 'koroi' },
        { kx: 0.89, ky: 0.67, rv: 'spread_right', sp: pheno.season === 'basanta' ? 'shimul' : pheno.season === 'barsha' ? 'kadamba' : 'krishnachura' },
      ];
      const teaTreeAnchors: ReturnType<typeof drawLeafyBengalTree>[] = [];
      const teaNestSheltering = sky.rainWeight > 0.12 || sky.stormWeight > 0.25 || sky.dayWeight < 0.16;
      const teaNestFeeding = !teaNestSheltering && sky.twilight <= 0.18 && sky.dayWeight >= 0.46 && ((tSec * 0.048) % 1) >= 0.56 && ((tSec * 0.048) % 1) < 0.84;

      koroiSpecs.forEach((ks, ki) => {
        const tx = width * ks.kx;
        const ty = height * ks.ky;
        ctx.fillStyle = rgbCss(lerpRgb([10, 20, 12], [34, 72, 30], amb));
        ctx.beginPath();
        ctx.ellipse(tx, ty + 3, 28, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        teaTreeAnchors.push(
          drawLeafyBengalTree(ctx, {
            ...common,
            baseX: tx,
            baseY: ty,
            heightPx: Math.min(height * 0.34, 215),
            trunkW: 14,
            seed: 12.4 + ki * 4.3,
            species: ks.sp,
            rootVariant: ks.rv,
            renderForkNest: ki === 0
              ? (c) => {
                  drawBirdNestWithChicks(ctx, c.x, c.y - 1, 'cup', 0.92, tSec, sky.dayWeight >= 0.16, teaNestFeeding, amb, sky.windFactor, sky.windSign);
                }
              : undefined,
          })
        );
      });

      // Slender off-center estate Coconut Palm planted on mossy earthen terrace mound
      ctx.fillStyle = rgbCss(lerpRgb([10, 20, 12], [34, 72, 30], amb));
      ctx.beginPath();
      ctx.ellipse(width * 0.33, height * 0.65 + 4, 18, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      drawArticulatedPalm(
        ctx,
        width,
        width * 0.33,
        height * 0.65,
        Math.min(height * 0.26, 168),
        -0.08,
        8,
        5.8,
        0.92,
        sky.windFactor,
        sky.windSign,
        tSec,
        sky.orbX,
        sky.orbY,
        rgbCss(lerpRgb([16, 14, 12], [62, 50, 38], amb)),
        sky.sunlightFactor > 0.16 ? rgbCss([220, 178, 112], 0.55) : null,
        rgbCss(lerpRgb([12, 26, 16], [34, 72, 34], amb)),
        rgbCss([132, 186, 76], 0.82),
        sky.sunlightFactor
      );

      const teaCh = Math.floor((tSec % 840) / 140);
      // 14-Minute (840s) Multi-Chapter Tea Garden Workday Story — facing ALWAYS derived strictly from velocity dx!
      if (!isDeepNight && sky.dayWeight > 0.22) {
        const evalTeaPos = (timeSec: number, workerShift: number) => {
          const st = (timeSec + workerShift) % 840;
          const ch = Math.floor(st / 140);
          const u = (st % 140) / 140;
          const revDir = ch % 2 === 1;
          const entryX = revDir ? width + 44 : -44;
          const exitX = revDir ? -44 : width + 44;
          const pluckStart = revDir ? width * 0.68 : width * 0.25;
          const pluckEnd = revDir ? width * 0.26 : width * 0.66;
          const slopeY = ch % 3 === 1 ? height * 0.66 : height * 0.725;

          if (u < 0.18) {
            const p = u / 0.18;
            return { x: lerp(entryX, pluckStart, p), y: lerp(trailBotY - 10, slopeY, p), mode: 'walking_home' as const };
          } else if (u < 0.60) {
            const p = (u - 0.18) / 0.42;
            return { x: lerp(pluckStart, pluckEnd, p) + Math.sin(p * Math.PI * 2) * 10, y: slopeY + Math.sin(p * Math.PI) * 8, mode: 'plucking' as const };
          } else if (u < 0.78) {
            const shadeX = width * (ch % 2 === 0 ? 0.68 : 0.25);
            const p = Math.min(1, (u - 0.60) / 0.08);
            return { x: lerp(pluckEnd, shadeX, p), y: lerp(slopeY, height * 0.69, p), mode: (p > 0.9 ? 'resting' : 'walking_home') as 'resting' | 'walking_home' };
          } else {
            const shadeX = width * (ch % 2 === 0 ? 0.68 : 0.25);
            const p = (u - 0.78) / 0.22;
            return { x: lerp(shadeX, exitX, p), y: lerp(height * 0.69, trailTopY + 14, p), mode: 'walking_home' as const };
          }
        };

        const teaStoryPos = (shift: number) => {
          const cur = evalTeaPos(tSec, shift);
          const next = evalTeaPos(tSec + 0.08, shift);
          const dx = next.x - cur.x;
          const dir: 1 | -1 = Math.abs(dx) > 0.03 ? (dx >= 0 ? 1 : -1) : 1;
          return { ...cur, dir };
        };

        const w1 = teaStoryPos(0);
        const w2 = teaStoryPos(48);
        const rainUm = sky.rainWeight > 0.1;
        drawTeaPlucker(ctx, w1.x, w1.y, w1.dir, 0.92, tSec * 3.1, [196, 48, 72], amb, rainUm, isDuskWalkHome && w1.mode === 'plucking' ? 'walking_home' : w1.mode);
        drawTeaPlucker(ctx, w2.x, w2.y + 8, w2.dir, 0.96, tSec * 2.9 + 1.4, [234, 148, 38], amb, rainUm, isDuskWalkHome && w2.mode === 'plucking' ? 'walking_home' : w2.mode);
      }

      // Tea Garden Visitor + Basket-Carrying Estate Porter walking along open foreground red-clay trail!
      if (!isDeepNight && sky.dayWeight > 0.26 && sky.stormWeight < 0.35) {
        const visitorUmbrella = sky.rainWeight > 0.08 || (sky.sunlightFactor > 0.7 && (propsRef.current.temperatureC ?? 28) > 33);
        const p = pedestrians[0];
        const teaU = (tSec % 140) / 140;
        const admiringView = Math.abs(p.xFrac - (teaCh % 2 === 0 ? 0.48 : 0.62)) < 0.06 && teaU > 0.35 && teaU < 0.50;
        if (!prefersReducedMotion && !admiringView) {
          p.xFrac += dt * p.dir * (p.speed * 0.70);
          p.walkPhase += dt * (p.speed * 170);
          if (p.xFrac > 1.06) p.xFrac = -0.06;
          if (p.xFrac < -0.06) p.xFrac = 1.06;
        }
        const vx = clamp01(p.xFrac);
        const vy = lerp(trailBotY - 2, trailTopY + 20, vx) - Math.sin(vx * Math.PI) * 6;
        const visitorOutfits: HumanOutfit[] = ['sari', 'panjabi', 'office'];
        const visitorCoats: RGB[] = [[190, 48, 66], [224, 228, 236], [76, 134, 174]];
        drawRealisticPerson(ctx, {
          x: p.xFrac * width,
          y: vy,
          facing: p.dir,
          scale: 0.92,
          walkPhase: admiringView ? 0 : p.walkPhase,
          outfit: visitorOutfits[teaCh % visitorOutfits.length],
          coatRgb: visitorCoats[teaCh % visitorCoats.length],
          lowerRgb: teaCh % 3 === 0 ? [224, 174, 82] : [34, 42, 54],
          hasUmbrella: visitorUmbrella,
          umbrellaRgb: [168, 28, 46],
          dayWeight: sky.dayWeight,
          sunlightFactor: sky.sunlightFactor,
          moonVis: sky.effectiveMoonVis,
          rainWeight: sky.rainWeight,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          fogWeight: sky.fogWeight,
          action: admiringView ? 'looking' : 'walking',
          idleSec: tSec,
        });

        // Second trail figure: estate porter carrying plucked leaf basket (`carrying_basket`) briskly in opposite chapter flow
        const pt = pedestrians[2];
        if (!prefersReducedMotion) {
          pt.xFrac += dt * pt.dir * (pt.speed * 0.68);
          pt.walkPhase += dt * (pt.speed * 165);
          if (pt.xFrac > 1.08) pt.xFrac = -0.08;
          if (pt.xFrac < -0.08) pt.xFrac = 1.08;
        }
        const pxT = clamp01(pt.xFrac);
        const pyT = lerp(trailBotY + 4, trailTopY + 24, pxT) - Math.sin(pxT * Math.PI) * 6;
        drawRealisticPerson(ctx, {
          x: pt.xFrac * width,
          y: pyT,
          facing: pt.dir,
          scale: 0.88,
          walkPhase: pt.walkPhase,
          outfit: 'shirt',
          coatRgb: [72, 134, 96],
          lowerRgb: [36, 46, 42],
          hasUmbrella: false,
          umbrellaRgb: [24, 34, 52],
          dayWeight: sky.dayWeight,
          sunlightFactor: sky.sunlightFactor,
          moonVis: sky.effectiveMoonVis,
          rainWeight: sky.rainWeight,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          fogWeight: sky.fogWeight,
          action: 'carrying_basket',
          idleSec: tSec,
        });
      }

      const teaPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [];
      if (teaTreeAnchors[0]?.perches[0]) teaPerches.push({ ...teaTreeAnchors[0].perches[0], species: 'sparrow', exact: true });
      if (teaTreeAnchors[1]?.perches[0]) teaPerches.push({ ...teaTreeAnchors[1].perches[0], species: 'doel', exact: true });
      const teaNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean; skipNestBody?: boolean }> = [];
      if (teaTreeAnchors[0]?.forkCrotches[0]) {
        teaNests.push({ x: teaTreeAnchors[0].forkCrotches[0].x, y: teaTreeAnchors[0].forkCrotches[0].y - 1, species: 'doel', style: 'cup', scale: 0.92, exact: true, skipNestBody: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['doel', 'sparrow', 'doel', 'sparrow'],
        0.36,
        teaPerches,
        teaNests
      );
      renderSeasonalDrift(pheno, sky, dt);
      return height * 0.48;
    };

    const renderRailBridge = (sky: AtmosphericSkyContext, pheno: BengaliCalendarState, dt: number): number => {
      const horY = height * 0.56;
      const deckY = height * 0.59;
      const bankY = height * 0.85;
      const amb = 0.2 + sky.dayWeight * 0.8;
      const lightGlow = clamp01((1 - sky.dayWeight) * 1.25 + sky.rainWeight * 0.3);
      const common = treeCommon(sky, pheno);
      const isNightSleep = sky.dayWeight <= 0.16;

      drawHorizonTreeline(horY, 16, 5.1, rgbCss(lerpRgb([12, 20, 22], [44, 72, 54], amb * 0.8)));

      const rGrad = ctx.createLinearGradient(0, horY, 0, bankY);
      rGrad.addColorStop(0, rgbCss(lerpRgb(sky.horRgb, [22, 52, 76], 0.35)));
      rGrad.addColorStop(1, rgbCss(lerpRgb([10, 22, 36], [18, 48, 72], amb)));
      ctx.fillStyle = rGrad;
      ctx.fillRect(0, horY, width, bankY - horY + 10);

      drawAnimatedWaterSurface(horY, bankY, amb, sky, false);
      drawWaterShimmer(ctx, sky.orbX, horY, bankY, tSec, sky);

      // 1) Draw river boat FIRST so it passes strictly BEHIND the bridge columns!
      const bt = boats[0];
      if (!isNightSleep) {
        if (!prefersReducedMotion) {
          bt.x += dt * bt.dir * (bt.speed * 0.72);
          bt.phase += dt * 1.9;
          if (bt.x > width + 110) bt.x = -110;
        }
        drawRealisticBoat(ctx, {
          type: 'chhoi',
          x: bt.x,
          y: height * 0.73,
          facing: 1,
          scale: 0.74,
          wavePitch: Math.sin(tSec * 1.8),
          oarPhase: bt.phase,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          sailRgb: [228, 224, 214],
          dayWeight: sky.dayWeight,
          lightGlow,
          hasLantern: lightGlow > 0.18,
          sunlightFactor: sky.sunlightFactor,
        });
      }

      // 2) Concrete Bridge Abutments + Riprap Boulders + 3D Cutwater Masonry Piers standing firmly IN FRONT of river & boat!
      const spans = 4;
      const spanW = width / spans;
      const pierCol = rgbCss(lerpRgb([16, 18, 22], [86, 88, 94], amb));
      const pierShade = rgbCss(lerpRgb([10, 12, 16], [52, 54, 62], amb));
      const pierCap = rgbCss(lerpRgb([22, 24, 28], [116, 118, 126], amb));
      // Shoreline riprap masonry abutment flanks on left and right edges
      ctx.fillStyle = pierShade;
      ctx.fillRect(0, deckY + 4, 24, bankY - deckY - 6);
      ctx.fillRect(width - 24, deckY + 4, 24, bankY - deckY - 6);

      for (let i = 1; i < spans; i++) {
        const px = i * spanW;
        const pierBotY = bankY - 12;
        ctx.fillStyle = pierCap;
        ctx.fillRect(px - 17, deckY + 6, 36, 7);
        ctx.fillStyle = pierCol;
        ctx.fillRect(px - 14, deckY + 13, 18, pierBotY - deckY - 13);
        ctx.fillStyle = pierShade;
        ctx.fillRect(px + 4, deckY + 13, 11, pierBotY - deckY - 13);
        ctx.fillStyle = 'rgba(8, 14, 22, 0.36)';
        ctx.fillRect(px - 14, pierBotY - 10, 29, 10);
        ctx.strokeStyle = `rgba(226, 242, 255, ${(0.24 + amb * 0.24).toFixed(2)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(px, pierBotY, 22 + Math.sin(tSec * 2 + i) * 3, 4.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 3) Back 3D Steel Truss + Left Approach Railway Signal Post
      const trussH = Math.min(height * 0.16, 88);
      const backSteel = rgbCss(lerpRgb([8, 12, 18], [42, 48, 58], amb));
      const steelCol = rgbCss(lerpRgb([14, 18, 24], [74, 82, 96], amb));

      ctx.strokeStyle = backSteel;
      ctx.lineWidth = 2.0;
      for (let i = 0; i < spans; i++) {
        const x0 = i * spanW + 8;
        const x1 = (i + 1) * spanW + 8;
        const midY = deckY - 8 - trussH;
        ctx.beginPath();
        ctx.moveTo(x0, deckY - 6);
        ctx.lineTo(x0 + spanW * 0.16, midY);
        ctx.lineTo(x1 - spanW * 0.16, midY);
        ctx.lineTo(x1, deckY - 6);
        ctx.stroke();
      }

      // Left Railway Semaphore Signal Post with soft green/amber beacon
      const sigX = width * 0.045;
      ctx.strokeStyle = steelCol;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(sigX, deckY);
      ctx.lineTo(sigX, deckY - 52);
      ctx.stroke();
      ctx.fillStyle = bridgeTrainX > -460 && bridgeTrainX < width + 180 ? 'rgba(74, 222, 128, 0.42)' : 'rgba(245, 158, 11, 0.36)';
      ctx.beginPath();
      ctx.arc(sigX + 4, deckY - 46, 2.4, 0, Math.PI * 2);
      ctx.fill();

      // Solid steel girder deck + railway sleepers
      ctx.fillStyle = steelCol;
      ctx.fillRect(0, deckY, width, 11);
      ctx.fillStyle = rgbCss(lerpRgb([10, 10, 12], [38, 32, 28], amb));
      for (let sx = 0; sx < width; sx += 14) {
        ctx.fillRect(sx, deckY - 2, 7, 3);
      }

      // 4) Slower Majestic Intercity Train gliding smoothly across varied 13-min multi-chapter rail schedule!
      const rbCh = Math.floor((tSec % 780) / 130);
      if (!prefersReducedMotion) {
        if (bridgeTrainWait > 0) {
          bridgeTrainWait -= dt;
        } else {
          bridgeTrainX += dt * (rbCh % 2 === 0 ? 76 : 68);
          if (bridgeTrainX > width + 220) {
            bridgeTrainX = -480;
            bridgeTrainWait = 7.0 + (rbCh % 3) * 4.0;
          }
        }
      }
      if (bridgeTrainX > -470 && bridgeTrainX < width + 200) {
        if (!prefersReducedMotion && bridgeTrainX > -290 && bridgeTrainX < width + 50) {
          stormAudio.triggerTrainRumbleTick(((bridgeTrainX + 160 - width * 0.5) / Math.max(320, width)) * 1.1);
        }
        const trY = deckY - 20;
        const cars = 5;
        const carW = 68;
        for (let c = 0; c < cars; c++) {
          const cx = bridgeTrainX + c * (carW + 4);
          ctx.fillStyle = rgbCss(lerpRgb([18, 22, 28], c === cars - 1 ? [184, 42, 42] : [36, 98, 72], amb));
          ctx.beginPath();
          ctx.roundRect(cx, trY, carW, 18, [3, c === cars - 1 ? 6 : 3, 1, 1]);
          ctx.fill();
          ctx.fillStyle = rgbCss(lerpRgb([10, 12, 16], [136, 144, 156], amb));
          ctx.fillRect(cx + 2, trY - 2, carW - 4, 2.5);
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(cx + 10, trY + 17, 14, 3);
          ctx.fillRect(cx + carW - 24, trY + 17, 14, 3);

          const wCol = lightGlow > 0.14 ? `rgba(238, 198, 108, ${(0.18 + 0.24 * lightGlow).toFixed(2)})` : 'rgba(148, 197, 232, 0.7)';
          ctx.fillStyle = wCol;
          for (let wi = 0; wi < 5; wi++) {
            ctx.fillRect(cx + 6 + wi * 12, trY + 5, 8, 6);
          }
          // Subtle train window reflection shimmer in river water below at dusk/night
          if (lightGlow > 0.2) {
            ctx.fillStyle = `rgba(234, 196, 104, ${(0.06 * lightGlow).toFixed(2)})`;
            ctx.fillRect(cx + 6, bankY - 34, carW - 12, 24);
          }
        }
        const locoX = bridgeTrainX + cars * (carW + 4);
        if (lightGlow > 0.12) {
          const beam = ctx.createLinearGradient(locoX, trY + 8, locoX + 115, trY + 14);
          beam.addColorStop(0, `rgba(248, 232, 174, ${(0.26 * lightGlow).toFixed(2)})`);
          beam.addColorStop(1, 'rgba(248, 232, 174, 0)');
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(locoX, trY + 6);
          ctx.lineTo(locoX + 115, trY - 9);
          ctx.lineTo(locoX + 115, trY + 28);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 5) Front 3D Trapezoidal Warren/Pratt Truss Chords, Verticals, Diagonals & Overhead Portal Bracing
      for (let i = 0; i < spans; i++) {
        const x0 = i * spanW;
        const x1 = (i + 1) * spanW;
        const p1x = x0 + spanW * 0.16;
        const p2x = x1 - spanW * 0.16;
        const topY = deckY - trussH;

        ctx.strokeStyle = steelCol;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(x0, deckY);
        ctx.lineTo(p1x, topY);
        ctx.lineTo(p2x, topY);
        ctx.lineTo(x1, deckY);
        ctx.stroke();

        ctx.strokeStyle = backSteel;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p1x, topY);
        ctx.lineTo(p1x + 8, topY - 8);
        ctx.moveTo(p2x, topY);
        ctx.lineTo(p2x + 8, topY - 8);
        ctx.stroke();

        ctx.strokeStyle = steelCol;
        ctx.lineWidth = 1.75;
        const subs = 5;
        for (let s = 0; s < subs; s++) {
          const ax = lerp(x0, x1, s / subs);
          const bx = lerp(x0, x1, (s + 1) / subs);
          const chordY = (px: number) =>
            px < p1x
              ? lerp(deckY, topY, (px - x0) / (p1x - x0))
              : px > p2x
                ? lerp(topY, deckY, (px - p2x) / (x1 - p2x))
                : topY;
          const ay = chordY(ax);
          const by = chordY(bx);
          ctx.beginPath();
          ctx.moveTo(ax, deckY);
          ctx.lineTo(ax, ay);
          ctx.lineTo(bx, deckY);
          ctx.moveTo(ax, deckY);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }

      // Lush shaded foreground embankment + 2 dense overlapping grass layers + riverbank reed clumps!
      const bankGrad = ctx.createLinearGradient(0, bankY - 14, 0, height);
      bankGrad.addColorStop(0, rgbCss(lerpRgb([14, 24, 14], [48, 86, 36], amb)));
      bankGrad.addColorStop(1, rgbCss(lerpRgb([8, 14, 10], [26, 52, 22], amb)));
      ctx.fillStyle = bankGrad;
      ctx.beginPath();
      ctx.moveTo(0, bankY);
      ctx.quadraticCurveTo(width * 0.5, bankY - 14, width, bankY + 6);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      drawGrassTuftBand(
        ctx,
        width,
        0,
        width,
        (gx) => bankY - 2 + Math.sin(gx * 0.008) * 6,
        Math.min(200, Math.floor(width / 4.8)),
        9,
        18,
        9.4,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([8, 16, 10], [28, 62, 24], amb),
        [96, 152, 48],
        sky.sunlightFactor,
        [248, 212, 82],
        sprigPack
      );
      drawGrassTuftBand(
        ctx,
        width,
        0,
        width,
        (gx) => bankY + 10 + Math.sin(gx * 0.011 + 1.5) * 6,
        Math.min(190, Math.floor(width / 5.0)),
        10,
        20,
        6.8,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([9, 18, 11], [31, 68, 26], amb),
        [102, 160, 50],
        sky.sunlightFactor,
        null,
        sprigPack
      );
      drawGrassTuftBand(
        ctx,
        width,
        0,
        width,
        (gx) => bankY + 22 + Math.cos(gx * 0.009) * 7,
        Math.min(180, Math.floor(width / 5.4)),
        11,
        22,
        4.1,
        sky.windFactor,
        sky.windSign,
        tSec,
        lerpRgb([10, 20, 12], [34, 74, 28], amb),
        [108, 166, 54],
        sky.sunlightFactor,
        null,
        sprigPack
      );

      // Riverside wild reed/কাশবন clumps with volumetric plumes on left & right banks
      const reedCols = Math.min(46, Math.floor(width / 20));
      for (let i = 0; i < reedCols; i++) {
        if (i > reedCols * 0.28 && i < reedCols * 0.72 && i % 2 === 1) continue;
        const kx = (i + 0.5) * (width / reedCols);
        const ky = bankY + 5 + (i % 3) * 5;
        const w = sampleLocalWind(kx, width, tSec, sky.windFactor, sky.windSign, 1.3, i);
        const topX = kx + sky.windSign * w.bend * 18;
        const topY = ky - (25 + (i % 4) * 8);
        ctx.strokeStyle = rgbCss(lerpRgb([14, 28, 16], [56, 102, 42], amb), 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(kx, ky + 6);
        ctx.quadraticCurveTo(kx + sky.windSign * w.bend * 5, (ky + topY) * 0.5, topX, topY);
        ctx.stroke();
        if (pheno.autumnKashWeight > 0.1 || i % 2 === 0) {
          for (let pt = -1; pt <= 1; pt++) {
            ctx.fillStyle = pt === 0 ? `rgba(248, 250, 252, ${(0.48 + amb * 0.44).toFixed(2)})` : `rgba(216, 224, 232, ${(0.38 + amb * 0.34).toFixed(2)})`;
            ctx.beginPath();
            ctx.ellipse(topX + pt * 1.8, topY - 5, 2.3, 9.5, sky.windSign * w.bend * 0.4 + pt * 0.14, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Seated angler on right embankment bank + 13-Minute Multi-Chapter Riverbank Villager Story
      if (!isNightSleep && sky.dayWeight > 0.24 && sky.stormWeight < 0.35) {
        drawRiverAngler(ctx, width * 0.74, bankY + 12, -1, 0.92, tSec + 1.5, amb);

        const rbPed = pedestrians[0];
        const rbSubU = (tSec % 130) / 130;
        const trainPassing = bridgeTrainX > -280 && bridgeTrainX < width * 0.85;
        const restingOnBank = !trainPassing && rbCh % 3 === 1 && rbSubU > 0.45 && rbSubU < 0.70;
        if (!prefersReducedMotion && !trainPassing && !restingOnBank) {
          rbPed.xFrac += dt * rbPed.dir * (rbPed.speed * 0.7);
          rbPed.walkPhase += dt * (rbPed.speed * 170);
          if (rbPed.xFrac > 1.06) rbPed.xFrac = -0.06;
          if (rbPed.xFrac < -0.06) rbPed.xFrac = 1.06;
        }
        const px = rbPed.xFrac * width;
        const py = bankY + 24 + Math.sin(px * 0.008) * 6;
        const rbOutfits: HumanOutfit[] = ['lungi', 'panjabi', 'shirt'];
        const rbCoats: RGB[] = [[224, 228, 236], [234, 178, 72], [74, 134, 168]];
        drawRealisticPerson(ctx, {
          x: px,
          y: py,
          facing: trainPassing ? -1 : rbPed.dir,
          scale: 0.88,
          walkPhase: trainPassing || restingOnBank ? 0 : rbPed.walkPhase,
          outfit: rbOutfits[rbCh % rbOutfits.length],
          coatRgb: rbCoats[rbCh % rbCoats.length],
          lowerRgb: rbCh % 3 === 0 ? [38, 86, 114] : [32, 38, 52],
          hasUmbrella: sky.rainWeight > 0.08,
          umbrellaRgb: [24, 34, 52],
          dayWeight: sky.dayWeight,
          sunlightFactor: sky.sunlightFactor,
          moonVis: sky.effectiveMoonVis,
          rainWeight: sky.rainWeight,
          windFactor: sky.windFactor,
          windSign: sky.windSign,
          fogWeight: sky.fogWeight,
          action: trainPassing ? 'looking' : restingOnBank ? 'sitting_bench' : 'walking',
          idleSec: tSec,
        });
      }

      const rbLeftH = Math.min(height * 0.32, 200);
      const rbRightH = Math.min(height * 0.29, 185);
      const rbNestSheltering = sky.rainWeight > 0.12 || sky.stormWeight > 0.25 || sky.dayWeight < 0.16;
      const rbNestFeeding = !rbNestSheltering && sky.twilight <= 0.18 && sky.dayWeight >= 0.46 && ((tSec * 0.048) % 1) >= 0.56 && ((tSec * 0.048) % 1) < 0.84;
      const rbRightSpecies: TreeSpecies =
        pheno.season === 'barsha'
          ? 'kadamba'
          : pheno.season === 'basanta'
            ? 'shimul'
            : 'koroi';

      const rbLeftTree = drawLeafyBengalTree(ctx, {
        ...common,
        baseX: width * 0.08,
        baseY: height * 0.9,
        heightPx: rbLeftH,
        trunkW: 14,
        seed: 4.5,
        species: 'mango',
        rootVariant: 'spread_left',
        renderForkNest: (c) => {
          drawBirdNestWithChicks(ctx, c.x, c.y - 1, 'cup', 0.9, tSec, sky.dayWeight >= 0.16, rbNestFeeding, amb, sky.windFactor, sky.windSign);
        },
      });
      const rbRightTree = drawLeafyBengalTree(ctx, { ...common, baseX: width * 0.92, baseY: height * 0.91, heightPx: rbRightH, trunkW: 12, seed: 9.1, species: rbRightSpecies, rootVariant: 'buttress' });

      const rbPerches: Array<{ x: number; y: number; species?: BirdSpecies; face?: 1 | -1; exact?: boolean }> = [];
      if (rbRightTree.perches[0]) rbPerches.push({ ...rbRightTree.perches[0], species: 'sparrow', exact: true });
      if (rbLeftTree.perches[0]) rbPerches.push({ ...rbLeftTree.perches[0], species: 'doel', exact: true });
      const rbNests: Array<{ x: number; y: number; species: BirdSpecies; style: 'cup' | 'weaver'; scale?: number; exact?: boolean; skipNestBody?: boolean }> = [];
      if (rbLeftTree.forkCrotches[0]) {
        rbNests.push({ x: rbLeftTree.forkCrotches[0].x, y: rbLeftTree.forkCrotches[0].y - 1, species: 'doel', style: 'cup', scale: 0.9, exact: true, skipNestBody: true });
      }

      renderSceneBirds(
        sky,
        dt,
        ['egret', 'doel', 'gull', 'sparrow'],
        0.36,
        rbPerches,
        rbNests
      );
      renderSeasonalDrift(pheno, sky, dt);
      renderFireflies(sky, dt, 0.76, 0.96);
      return horY;
    };

    // =========================================================================
    //  60FPS MAIN LOOP
    // =========================================================================
    const loop = (nowMs: number) => {
      if (disposed) return;
      const dt = Math.min(0.055, Math.max(0.001, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      tickCount += 1;
      tSec += dt;

      const tgt = propsRef.current;
      if (tgt.sceneId !== sceneTransitionOpacity.lastId) {
        sceneTransitionOpacity.lastId = tgt.sceneId;
        sceneTransitionOpacity.current = 0;
      }
      if (sceneTransitionOpacity.current < 1) {
        sceneTransitionOpacity.current = Math.min(1, sceneTransitionOpacity.current + dt * 3.2);
      }

      const baseWind = tgt.windKmh ?? 6;
      const gustExtra =
        tgt.windGustKmh !== null && tgt.windGustKmh !== undefined && tgt.windGustKmh > baseWind
          ? (tgt.windGustKmh - baseWind) * (0.25 + 0.4 * Math.max(0, Math.sin(tSec * 0.42)))
          : 0;
      const tgtWind = baseWind + gustExtra;
      const tgtDir =
        tgt.windDirectionDeg !== null && tgt.windDirectionDeg >= 10 && tgt.windDirectionDeg < 190
          ? -1
          : 1;
      const tgtRain = clamp01(tgt.rainIntensity);
      const tgtStorm = tgt.weatherMood === 'storm' ? 1 : tgtRain > 0.78 ? 0.45 : 0;
      const tgtLight = tgt.hasLightning ? 1 : 0;
      const tgtFog = Math.max(tgt.weatherMood === 'fog' ? 0.78 : 0, clamp01(tgt.fogDensity ?? 0));
      const tgtCloud =
        tgt.cloudCover !== null
          ? tgt.cloudCover / 100
          : tgt.weatherMood === 'cloudy' || tgtRain > 0.2
            ? 0.82
            : 0.18;

      const liveHourDec = getDhakaHourDecimal(tgt.timezone || 'Asia/Dhaka');
      let tgtDay = tgt.weatherIsDay ? 1 : 0;
      if (tgt.sunsetDecimal - tgt.sunriseDecimal >= 4) {
        if (liveHourDec >= tgt.sunriseDecimal + 0.35 && liveHourDec <= tgt.sunsetDecimal - 0.35) {
          tgtDay = 1;
        } else if (liveHourDec > tgt.sunriseDecimal - 0.55 && liveHourDec < tgt.sunriseDecimal + 0.35) {
          tgtDay = clamp01((liveHourDec - (tgt.sunriseDecimal - 0.55)) / 0.9);
        } else if (liveHourDec > tgt.sunsetDecimal - 0.35 && liveHourDec < tgt.sunsetDecimal + 0.55) {
          tgtDay = clamp01(1 - (liveHourDec - (tgt.sunsetDecimal - 0.35)) / 0.9);
        } else {
          tgtDay = 0;
        }
      }

      const k = 1 - Math.exp(-1.9 * dt);
      sim.windKmh += (tgtWind - sim.windKmh) * k;
      sim.windDirSign += (tgtDir - sim.windDirSign) * k;
      sim.cloudCover += (tgtCloud - sim.cloudCover) * k;
      sim.rainWeight += (tgtRain - sim.rainWeight) * k;
      sim.stormWeight += (tgtStorm - sim.stormWeight) * k;
      sim.lightningWeight += (tgtLight - sim.lightningWeight) * k;
      sim.fogWeight += (tgtFog - sim.fogWeight) * k;
      sim.dayWeight += (tgtDay - sim.dayWeight) * k;

      const windSign = sim.windDirSign >= 0 ? 1 : -1;
      const windFactor = Math.min(2.2, sim.windKmh * 0.032 + sim.stormWeight * 0.45);
      const celestial = computeCelestialPosition({
        isDay: sim.dayWeight >= 0.45,
        sunriseDecimal: tgt.sunriseDecimal,
        sunsetDecimal: tgt.sunsetDecimal,
        timezone: tgt.timezone,
      });
      const pheno = computeBengaliPhenology(new Date(), tgt.previewBengaliMonth);

      ctx.save();
      ctx.setTransform(dpr * sceneZoom, 0, 0, dpr * sceneZoom, 0, 0);
      ctx.clearRect(0, 0, width + 4, height + 4);

      const sky = renderAtmosphericSkyAndCelestials(
        ctx,
        pools,
        width,
        height,
        tickCount,
        prefersReducedMotion,
        {
          dayWeight: sim.dayWeight,
          effectiveCloud: clamp01(sim.cloudCover),
          rainWeight: sim.rainWeight,
          stormWeight: sim.stormWeight,
          fogWeight: sim.fogWeight,
          lightningWeight: sim.lightningWeight,
          windKmh: sim.windKmh,
          windFactor,
          windSign,
          isHotDay: (tgt.temperatureC ?? 27) >= 34,
          liveHourDec,
          sunriseDecimal: tgt.sunriseDecimal,
          sunsetDecimal: tgt.sunsetDecimal,
          celestialProgress: celestial.progress,
          horizonYRatio: 0.72,
          onThunderTrigger: (intensity) => {
            if (tgt.hasThunder) {
              stormAudio.triggerThunder(intensity, 'distant');
            }
          },
        }
      );

      let splashCutY = height * 0.76;
      const isInteriorScene = tgt.sceneId === 'train' || tgt.sceneId === 'bus';

      switch (tgt.sceneId) {
        case 'village':
          splashCutY = renderVillage(sky, pheno, dt);
          break;
        case 'city':
          splashCutY = renderCity(sky, pheno, dt);
          break;
        case 'river':
          splashCutY = renderRiver(sky, pheno, dt);
          break;
        case 'sea':
          splashCutY = renderSea(sky, pheno, dt);
          break;
        case 'mountain':
          splashCutY = renderMountain(sky, pheno, dt);
          break;
        case 'train':
          splashCutY = renderTrainWindow(sky, pheno, dt);
          break;
        case 'bus':
          splashCutY = renderBusWindow(sky, pheno, dt);
          break;
        case 'rooftop':
          splashCutY = renderRooftop(sky, pheno, dt);
          break;
        case 'haor':
          splashCutY = renderHaor(sky, pheno, dt);
          break;
        case 'teagarden':
          splashCutY = renderTeaGarden(sky, pheno, dt);
          break;
        case 'railbridge':
          splashCutY = renderRailBridge(sky, pheno, dt);
          break;
      }

      renderForegroundRainAndWind(
        ctx,
        pools,
        sky,
        width,
        height,
        tickCount,
        prefersReducedMotion,
        () => splashCutY,
        isInteriorScene
      );

      if (sceneTransitionOpacity.current < 0.995) {
        ctx.fillStyle = `rgba(6, 10, 18, ${(1 - sceneTransitionOpacity.current).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.restore();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="fixed inset-0 z-[1] h-full w-full pointer-events-none bg-[#060b14]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-16 bg-gradient-to-b from-black/35 to-transparent"
      />
    </>
  );
}
