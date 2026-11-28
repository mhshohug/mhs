import { BengalSixSeason } from './bengaliCalendar';
import {
  BotanicalSpritePack,
  clamp01,
  drawTaperedCurve,
  evalQuadBezier,
  lerp,
  lerpRgb,
  RGB,
  rgbCss,
  sampleLocalWind,
  smoothTurb1d,
} from './proceduralAtmosphere';

/**
 * Pure Canvas2D articulated birds (crow, pigeon, sparrow, doel, egret, gull, eagle),
 * 3-tier Bezier-connected Bengali trees with independent leaf flutter & 5 distinct species,
 * 3D extruded Bengali village homesteads & city buildings, roadside টং দোকান tea stalls,
 * side-profile walking & activity humans, Dhaka vehicles, boats, dolphins & fishing nets.
 */

export type BirdSpecies = 'crow' | 'pigeon' | 'sparrow' | 'doel' | 'egret' | 'gull' | 'eagle';

/** Continuous convex tapered limb segment with outward joint end-caps (zero concave joint gaps) */
function drawSmoothLimb(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  colMid: RGB,
  colShade: RGB
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const midX = (x0 + x1) * 0.5;
  const midY = (y0 + y1) * 0.5;
  const rMid = (r0 + r1) * 0.54;

  const grad = ctx.createLinearGradient(x0 - nx * r0, y0 - ny * r0, x0 + nx * r0, y0 + ny * r0);
  grad.addColorStop(0, rgbCss(colShade));
  grad.addColorStop(0.52, rgbCss(colMid));
  grad.addColorStop(1, rgbCss(lerpRgb(colMid, [255, 250, 245], 0.14)));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
  ctx.quadraticCurveTo(midX + nx * rMid, midY + ny * rMid, x1 + nx * r1, y1 + ny * r1);
  ctx.arc(x1, y1, r1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
  ctx.quadraticCurveTo(midX - nx * rMid, midY - ny * rMid, x0 - nx * r0, y0 - ny * r0);
  ctx.arc(x0, y0, r0, Math.atan2(-ny, -nx), Math.atan2(ny, nx), true);
  ctx.closePath();
  ctx.fill();
}

export function drawRealisticBird(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  wingPhase: number,
  isGliding: boolean,
  isPerched: boolean,
  bodyCss: string,
  huddle = 0,
  rimCss: string | null = null,
  species: BirdSpecies = 'sparrow',
  carryingFood = false,
  headTilt = 0
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);
  const squ = 1 - huddle * 0.22;
  ctx.scale(1 + huddle * 0.14, squ);

  // Special slender long-necked Water Egret (সাদা বক) for River / Haor / Sea shallow shores
  if (species === 'egret') {
    const legCol = 'rgba(32, 34, 38, 0.92)';
    const featherCss = bodyCss;
    if (isPerched) {
      // Wading stance with subtly bent knee joint in shallow water
      ctx.strokeStyle = legCol;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(-1.2, 3);
      ctx.lineTo(-3.2, 9);
      ctx.lineTo(-2.5, 16);
      ctx.moveTo(2, 3);
      ctx.lineTo(1.5, 9.5);
      ctx.lineTo(3, 16);
      ctx.stroke();

      ctx.fillStyle = featherCss;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8.2, 4.4, -0.18, 0, Math.PI * 2);
      ctx.fill();

      // Graceful S-curved neck reacting to headTilt (for dipping/scanning water)
      ctx.strokeStyle = featherCss;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(5.8, -1.5);
      ctx.bezierCurveTo(10, -4 + headTilt * 4, 4, -10.5 + headTilt * 6, 8.2 + headTilt * 3, -13.5 + headTilt * 7);
      ctx.stroke();

      ctx.fillStyle = featherCss;
      ctx.beginPath();
      ctx.ellipse(9.2 + headTilt * 3, -14 + headTilt * 7, 2.7, 2.0, 0.1 + headTilt * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Long pointed yellow-orange bill
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.moveTo(11.4 + headTilt * 3, -14.8 + headTilt * 7);
      ctx.lineTo(18.5 + headTilt * 3, -13.2 + headTilt * 9);
      ctx.lineTo(11.4 + headTilt * 3, -12.8 + headTilt * 7);
      ctx.closePath();
      ctx.fill();
    } else {
      const flap = Math.sin(wingPhase * 0.8);
      const wingY = flap * 12;
      ctx.fillStyle = featherCss;
      // Trailing long legs in flight
      ctx.strokeStyle = legCol;
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(-6, 1.5);
      ctx.lineTo(-19, 3.2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-1, 0);
      ctx.quadraticCurveTo(2, -7 - wingY * 0.9, -10, -11 - wingY * 1.35);
      ctx.quadraticCurveTo(-5, -2 - wingY * 0.4, 4, 0.2);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0.5, 8.5, 3.1, -0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = featherCss;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(6.5, -0.2);
      ctx.quadraticCurveTo(9, -3, 12, -2);
      ctx.stroke();
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.moveTo(13, -2.5);
      ctx.lineTo(19, -1.2);
      ctx.lineTo(13, -0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const beakCol =
    species === 'gull'
      ? '#f59e0b'
      : species === 'crow' || species === 'eagle'
        ? '#334155'
        : species === 'pigeon'
          ? '#94a3b8'
          : '#e2b76e';

  if (isPerched) {
    // Articulated tarsi & gripping curved claws wrapping onto twig/rim so bird sits cleanly (never glued!)
    ctx.strokeStyle = 'rgba(28, 22, 18, 0.94)';
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Back leg + gripping toes
    ctx.moveTo(-2.2, 3.2);
    ctx.lineTo(-3.4, 6.4);
    ctx.lineTo(-1.8, 9.4);
    ctx.moveTo(-3.2, 9.2);
    ctx.quadraticCurveTo(-1.8, 10.6, 0.2, 9.8);
    // Front leg + gripping toes
    ctx.moveTo(1.8, 3.4);
    ctx.lineTo(0.8, 6.6);
    ctx.lineTo(2.4, 9.4);
    ctx.moveTo(0.9, 9.2);
    ctx.quadraticCurveTo(2.6, 10.7, 4.4, 9.7);
    ctx.stroke();

    // Tail feathers with subtle natural balance bob
    const tailLift = (species === 'doel' ? -5.5 : 6.2) + headTilt * 2.2;
    ctx.fillStyle = bodyCss;
    ctx.beginPath();
    ctx.moveTo(-5, 1.5);
    ctx.lineTo(-14.5, tailLift);
    ctx.lineTo(-12.5, tailLift + 2.2);
    ctx.lineTo(-3, 4);
    ctx.closePath();
    ctx.fill();

    // Perched torso with soft feathered breast contour
    const rx = species === 'crow' || species === 'pigeon' ? 8.2 : 7.0;
    const ry = species === 'pigeon' ? 5.0 : 4.2;
    ctx.beginPath();
    ctx.ellipse(0, 0.5, rx, ry, -0.22 + headTilt * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Wing + distinctive markings
    ctx.fillStyle = species === 'doel' ? 'rgba(241, 245, 249, 0.88)' : 'rgba(10, 14, 22, 0.28)';
    ctx.beginPath();
    ctx.ellipse(-1.2, 0.9, species === 'doel' ? 4.4 : 5.4, species === 'doel' ? 1.5 : 2.6, -0.15, 0, Math.PI * 2);
    ctx.fill();

    if (species === 'doel') {
      // Crisp white underbelly patch on Doel
      ctx.fillStyle = 'rgba(241, 245, 249, 0.92)';
      ctx.beginPath();
      ctx.ellipse(1.5, 2.7, 4.4, 2.0, -0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Articulated head pivoting gently for feeding/scanning
    ctx.save();
    ctx.translate(5.8, -3.0);
    ctx.rotate(headTilt);

    ctx.fillStyle = bodyCss;
    ctx.beginPath();
    ctx.arc(0.2, -0.2, species === 'crow' ? 3.4 : 2.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = beakCol;
    ctx.beginPath();
    ctx.moveTo(2.5, -0.8);
    ctx.lineTo(species === 'crow' ? 7.2 : 5.6, 0.5);
    ctx.lineTo(2.4, 1.3);
    ctx.closePath();
    ctx.fill();

    if (carryingFood) {
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(4.8, 0.4);
      ctx.quadraticCurveTo(6.8, 2.5, 5.2, 4.2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(1.0, -0.6, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    const flap = isGliding ? Math.sin(wingPhase * 0.32) * 0.14 : Math.sin(wingPhase);
    const wingSpread = species === 'eagle' ? 1.45 : species === 'gull' ? 1.25 : 1.0;
    const wingY = flap * 10.5 * wingSpread;
    const elbowY = flap * 5.2 * wingSpread;

    // Far wing
    ctx.fillStyle = bodyCss;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.quadraticCurveTo(-5, -4 - wingY * 0.85, -13 * wingSpread, -6 - wingY * 1.15);
    ctx.quadraticCurveTo(-6, -1 - elbowY * 0.5, 3, -0.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Tail fan
    ctx.beginPath();
    ctx.moveTo(-5, 0.5);
    ctx.lineTo(-14.5, species === 'eagle' ? -3.0 : -1.8);
    ctx.lineTo(-15.5, species === 'eagle' ? 3.2 : 1.8);
    ctx.lineTo(-5.5, 2.5);
    ctx.closePath();
    ctx.fill();

    // Sleek torso + head
    ctx.beginPath();
    ctx.ellipse(0.5, 0.6, 7.6, species === 'pigeon' ? 3.5 : 3.0, -0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7.3, -0.7, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Near wing
    ctx.beginPath();
    ctx.moveTo(-2, 0.2);
    if (species === 'gull') {
      ctx.quadraticCurveTo(1, -7.5 - elbowY, -12 * wingSpread, -8 - wingY * 1.25);
      ctx.quadraticCurveTo(-4, -2.5 - elbowY * 0.6, 4.5, 0.4);
    } else {
      ctx.quadraticCurveTo(-1, -6 - elbowY, -11 * wingSpread, -9 - wingY * 1.35);
      ctx.quadraticCurveTo(-2, -2 - elbowY * 0.65, 4.5, 0.4);
    }
    ctx.closePath();
    ctx.fill();

    if (species === 'doel') {
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      ctx.beginPath();
      ctx.ellipse(-2, -1.5 - elbowY * 0.35, 3.6, 1.3, -0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    if (rimCss) {
      ctx.strokeStyle = rimCss;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(9.2, -0.8);
      ctx.quadraticCurveTo(3, -3.5, -10.5 * wingSpread, -8.5 - wingY * 1.3);
      ctx.stroke();
    }

    ctx.fillStyle = beakCol;
    ctx.beginPath();
    ctx.moveTo(9.4, -1.0);
    ctx.lineTo(species === 'crow' ? 13.6 : 12.6, -0.3);
    ctx.lineTo(9.4, 0.6);
    ctx.closePath();
    ctx.fill();

    if (carryingFood) {
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(11.6, -0.3);
      ctx.quadraticCurveTo(13.8, 1.8, 12.2, 3.6);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Woven Bird Nest with Hungry Chicks (পাখির বাসা ও বাচ্চা) — either a twig cup nest on a branch fork
 * or an iconic hanging Baya Weaver nest (বাবুই পাখির বাসা) swaying on palm/tree tips!
 */
export function drawBirdNestWithChicks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  style: 'cup' | 'weaver',
  scale: number,
  tSec: number,
  chicksActive: boolean,
  feedingNow: boolean,
  amb: number,
  windFactor = 0.2,
  windSign = 1
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  const strawDark = rgbCss(lerpRgb([28, 22, 14], [96, 72, 42], amb));
  const strawMid = rgbCss(lerpRgb([44, 34, 20], [148, 114, 62], amb));
  const strawLit = rgbCss(lerpRgb([62, 48, 28], [194, 158, 92], amb));

  if (style === 'weaver') {
    const swing = windSign * windFactor * 0.14 + Math.sin(tSec * 2.1 + x * 0.05) * 0.06;
    ctx.rotate(swing);
    // Suspension stalk knotted strictly at (0,0) hanging DOWN from palm frond leaflet!
    ctx.strokeStyle = strawDark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 14);
    ctx.stroke();

    // Woven pear-shaped golden Baya Weaver nest + dangling funnel tunnel
    ctx.fillStyle = strawMid;
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.bezierCurveTo(12, 17, 13, 33, 6, 41);
    ctx.lineTo(4.5, 54);
    ctx.lineTo(-1, 54);
    ctx.lineTo(-1.5, 42);
    ctx.bezierCurveTo(-12, 35, -11, 17, 0, 13);
    ctx.closePath();
    ctx.fill();

    // Woven grass cross-hatch texture strands
    ctx.strokeStyle = strawLit;
    ctx.lineWidth = 0.85;
    for (let st = 0; st < 7; st++) {
      const sy = 19 + st * 4.2;
      ctx.beginPath();
      ctx.moveTo(-7 + (st % 2) * 2, sy);
      ctx.quadraticCurveTo(0, sy + 2.5, 7 - (st % 2) * 2, sy + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(10, 8, 6, 0.82)';
    ctx.beginPath();
    ctx.ellipse(1.8, 53.5, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Cup Nest sitting stably in a tree branch fork with visible chicks peeking out!
  if (chicksActive) {
    const chickDefs = [
      { cx: -4.2, phase: 0 },
      { cx: 1.0, phase: 1.7 },
      { cx: 5.5, phase: 3.1 },
    ];
    chickDefs.forEach((ch, ci) => {
      const stretch = feedingNow ? 2.8 + Math.max(0, Math.sin(tSec * 9 + ch.phase)) * 2.4 : 0.4 + Math.max(0, Math.sin(tSec * 2.2 + ch.phase)) * 1.4;
      const openWide = feedingNow || (Math.sin(tSec * 2.5 + ci) > 0.55);
      // Downy chick head + tiny eye
      ctx.fillStyle = rgbCss(lerpRgb([48, 42, 34], [148, 128, 102], amb));
      ctx.beginPath();
      ctx.arc(ch.cx, -2.5 - stretch, 3.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(ch.cx + 0.8, -3.1 - stretch, 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Open bright orange-yellow diamond mouth begging for food!
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(ch.cx - 1.4, -4.4 - stretch);
      ctx.lineTo(ch.cx + 0.2, openWide ? -8.4 - stretch : -6.2 - stretch);
      ctx.lineTo(ch.cx + 1.8, -4.4 - stretch);
      ctx.closePath();
      ctx.fill();
      if (openWide) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(ch.cx + 0.2, -5.6 - stretch, 1.0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Cup nest exterior woven twig rim
  ctx.fillStyle = strawDark;
  ctx.beginPath();
  ctx.ellipse(0, 3.5, 13.5, 7.2, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = strawMid;
  ctx.beginPath();
  ctx.ellipse(0, 1.2, 13.5, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = strawDark;
  ctx.beginPath();
  ctx.ellipse(0, 0.6, 9.8, 3.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Protruding twig ends woven cleanly into rim
  ctx.strokeStyle = strawLit;
  ctx.lineWidth = 1.05;
  for (let tw = -3; tw <= 3; tw++) {
    ctx.beginPath();
    ctx.moveTo(tw * 3.4, 2.2);
    ctx.lineTo(tw * 4.4 + (tw % 2 === 0 ? 4 : -4), 4.6);
    ctx.stroke();
  }

  ctx.restore();
}

export type TreeSpecies =
  | 'mango'
  | 'jamun'
  | 'jackfruit'
  | 'lychee'
  | 'krishnachura'
  | 'banyan'
  | 'koroi'
  | 'hijol'
  | 'kadamba'
  | 'shimul';

export type TreeRootVariant = 'buttress' | 'spread_left' | 'spread_right' | 'slender';

export interface BengalTreeOptions {
  viewW: number;
  baseX: number;
  baseY: number;
  heightPx: number;
  trunkW: number;
  seed: number;
  windFactor: number;
  windSign: number;
  tSec: number;
  orbX: number;
  orbY: number;
  dayWeight: number;
  sunlightFactor: number;
  twilight: number;
  moonVis: number;
  rainWeight: number;
  fogWeight: number;
  season: BengalSixSeason;
  summerBloomWeight: number;
  monsoonVineWeight: number;
  winterShedWeight: number;
  springNewLeafWeight: number;
  pack: BotanicalSpritePack;
  alpha?: number;
  species?: TreeSpecies;
  inPlanter?: boolean;
  rootVariant?: TreeRootVariant;
  renderForkNest?: (crotch: { x: number; y: number }) => void;
}

export interface BengalTreeAnchors {
  forkCrotches: Array<{ x: number; y: number }>;
  perches: Array<{ x: number; y: number; face: 1 | -1 }>;
}

/**
 * Draws an ultra-realistic, organically 3-tier branched Bengali tree where every primary limb
 * originates strictly from an exact quadratic Bezier sample on the curved trunk (`evalQuadBezier`),
 * with varied, deeply embedded root bases anchored behind earth & grass tufts (zero floating round trunks!).
 * Returns exact world-space fork crotch & limb perch coordinates for nests and birds.
 */
export function drawLeafyBengalTree(ctx: CanvasRenderingContext2D, opts: BengalTreeOptions): BengalTreeAnchors {
  const {
    viewW,
    baseX,
    baseY,
    heightPx,
    trunkW,
    seed,
    windFactor,
    windSign,
    tSec,
    orbX,
    orbY,
    dayWeight,
    sunlightFactor,
    twilight,
    moonVis,
    rainWeight,
    fogWeight,
    season,
    summerBloomWeight,
    monsoonVineWeight,
    winterShedWeight,
    springNewLeafWeight,
    pack,
    alpha = 1,
    species = 'mango',
    inPlanter = false,
    rootVariant,
  } = opts;

  const w = sampleLocalWind(baseX, viewW, tSec, windFactor, windSign, 0.95, seed);
  const organicLean = Math.sin(seed * 17.3) * (trunkW * (species === 'hijol' ? 1.55 : species === 'shimul' ? 0.35 : 0.85));
  const topBend =
    windSign * Math.min(heightPx * 0.088, w.bend * (heightPx * (species === 'shimul' ? 0.056 : 0.078)));
  const crownRatio =
    species === 'koroi'
      ? 0.65
      : species === 'banyan'
        ? 0.55
        : species === 'shimul'
          ? 0.72
          : species === 'krishnachura'
            ? 0.62
            : species === 'kadamba' || species === 'jackfruit'
              ? 0.64
              : 0.68;
  const crownX = baseX + organicLean + topBend;
  const crownY = baseY - heightPx * crownRatio;

  const toSunX = orbX - crownX;
  const sunDirX = toSunX >= 0 ? 1 : -1;

  const barkBaseRgb: RGB =
    species === 'koroi'
      ? [64, 54, 46]
      : species === 'banyan'
        ? [58, 48, 38]
        : species === 'shimul'
          ? [86, 78, 72]
          : species === 'kadamba' || species === 'jamun'
            ? [68, 56, 44]
            : species === 'jackfruit'
              ? [56, 42, 30]
              : [52, 38, 28];
  const barkRgb = lerpRgb([14, 12, 12], barkBaseRgb, dayWeight * (1 - fogWeight * 0.4));
  const barkCss = rgbCss(barkRgb, alpha);
  const barkDarkRgb = lerpRgb([6, 5, 5], [24, 17, 12], dayWeight);
  const rimCol =
    sunlightFactor > 0.14
      ? rgbCss(lerpRgb([196, 168, 102], [255, 198, 114], twilight), 0.7 * sunlightFactor * alpha)
      : moonVis > 0.15
        ? rgbCss([168, 198, 232], 0.42 * moonVis * alpha)
        : null;

  ctx.save();
  ctx.globalAlpha = alpha;

  const variants: TreeRootVariant[] = ['buttress', 'spread_left', 'spread_right', 'slender'];
  const resolvedRoot: TreeRootVariant =
    rootVariant ??
    (inPlanter
      ? 'slender'
      : species === 'banyan'
        ? 'buttress'
        : variants[Math.abs(Math.floor(seed * 7.3)) % variants.length]);

  const rootSinkY = inPlanter ? baseY + 3 : species === 'hijol' ? baseY + 5 : baseY + 9;
  const midTrunkX = baseX + organicLean * 0.38 + Math.cos(seed * 9.1) * (trunkW * 0.52) + topBend * 0.3;
  const midTrunkY = baseY - heightPx * (crownRatio * 0.58);
  const steps = 10;
  const leftEdge: Array<{ x: number; y: number }> = [];
  const rightEdge: Array<{ x: number; y: number }> = [];

  const leftFlare =
    resolvedRoot === 'slender'
      ? 0.24
      : resolvedRoot === 'spread_left'
        ? 1.15
        : resolvedRoot === 'buttress'
          ? 1.05
          : 0.48;
  const rightFlare =
    resolvedRoot === 'slender'
      ? 0.24
      : resolvedRoot === 'spread_right'
        ? 1.15
        : resolvedRoot === 'buttress'
          ? 0.92
          : 0.48;

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    const px = u * u * baseX + 2 * u * t * midTrunkX + t * t * crownX;
    const py = u * u * rootSinkY + 2 * u * t * midTrunkY + t * t * crownY;
    const tx = 2 * u * (midTrunkX - baseX) + 2 * t * (crownX - midTrunkX);
    const ty = 2 * u * (midTrunkY - rootSinkY) + 2 * t * (crownY - midTrunkY);
    const mag = Math.hypot(tx, ty) || 1;
    const nx = -ty / mag;
    const ny = tx / mag;
    const flareCurve = Math.exp(-t * 8.2);
    const baseHalf = trunkW * (0.48 - t * 0.3);
    leftEdge.push({ x: px + nx * (baseHalf + flareCurve * trunkW * leftFlare * 0.55), y: py + ny * (baseHalf + flareCurve * trunkW * leftFlare * 0.22) });
    rightEdge.push({ x: px - nx * (baseHalf + flareCurve * trunkW * rightFlare * 0.55), y: py - ny * (baseHalf + flareCurve * trunkW * rightFlare * 0.22) });
  }

  // Sun-side vs shadow-side bark gradient across single unified trunk (3D cylindrical bark volume)
  const barkGrad = ctx.createLinearGradient(
    baseX - sunDirX * trunkW,
    baseY,
    baseX + sunDirX * trunkW,
    baseY
  );
  const litBark = lerpRgb(barkRgb, [122, 98, 72], sunlightFactor * 0.55 + 0.15);
  const shadeBark = lerpRgb(barkRgb, barkDarkRgb, 0.62);
  barkGrad.addColorStop(0, rgbCss(sunDirX > 0 ? litBark : shadeBark, alpha));
  barkGrad.addColorStop(0.5, barkCss);
  barkGrad.addColorStop(1, rgbCss(sunDirX > 0 ? shadeBark : litBark, alpha));

  // Soft flat earth contact shadow strictly behind/beside soil seam (NEVER round bottom!)
  if (!inPlanter && species !== 'hijol') {
    ctx.fillStyle = rgbCss([8, 12, 8], 0.38 * alpha);
    ctx.beginPath();
    ctx.ellipse(baseX + sunDirX * -3, baseY + 6, trunkW * 1.55, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (inPlanter) {
    ctx.fillStyle = rgbCss([8, 10, 8], 0.35 * alpha);
    ctx.beginPath();
    ctx.ellipse(baseX, baseY + 2, trunkW * 0.88, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = barkGrad;
  ctx.beginPath();
  ctx.moveTo(leftEdge[0].x, rootSinkY);
  for (let s = 1; s <= steps; s++) ctx.lineTo(leftEdge[s].x, leftEdge[s].y);
  for (let s = steps; s >= 0; s--) ctx.lineTo(rightEdge[s].x, s === 0 ? rootSinkY : rightEdge[s].y);
  ctx.closePath();
  ctx.fill();

  // Organic non-uniform root toes gripping sideways into earth (never uniform symmetrical arcs)
  if (!inPlanter && species !== 'hijol' && resolvedRoot !== 'slender') {
    const toeDirs =
      resolvedRoot === 'buttress'
        ? [-1.22, -0.45, 0.95]
        : resolvedRoot === 'spread_left'
          ? [-1.3, -0.65, 0.5]
          : [-0.45, 0.72, 1.3];
    toeDirs.forEach((td, ti) => {
      const startX = baseX + Math.sign(td) * trunkW * 0.28;
      const startY = baseY + 1 + (ti % 2) * 1.5;
      const endX = baseX + td * trunkW * 1.18;
      const endY = baseY + 8 + (ti % 2) * 1.5;
      drawTaperedCurve(ctx, startX, startY, (startX + endX) * 0.5, startY + 3, endX, endY, Math.max(2.4, trunkW * 0.3), 0.7, barkCss, null, sunDirX);
    });
  }

  // Foreground curving grass collar ("ঘুরি ঘুরি ঘাস") wrapping cleanly IN FRONT of trunk & root toes so it sits in the soil
  if (!inPlanter && species !== 'hijol') {
    const moundCol = rgbCss(lerpRgb([10, 18, 10], [32, 62, 24], dayWeight), 0.45 * alpha);
    ctx.fillStyle = moundCol;
    ctx.beginPath();
    ctx.ellipse(baseX, baseY + 7.5, trunkW * 1.55, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    const collarDark = rgbCss(lerpRgb([10, 22, 12], [28, 68, 26], dayWeight), 0.96 * alpha);
    const collarMid = rgbCss(lerpRgb([14, 28, 14], [48, 96, 36], dayWeight), 0.94 * alpha);
    const collarLit = rgbCss(lerpRgb([16, 32, 16], [76, 132, 46], dayWeight), 0.92 * alpha);
    const tuftCount = Math.max(14, Math.round(trunkW * 1.25));
    ctx.lineCap = 'round';
    for (let gi = 0; gi < tuftCount; gi++) {
      const u = gi / (tuftCount - 1) - 0.5;
      const jitter = Math.sin(seed * 5.3 + gi * 2.7) * 2.2;
      const gx = baseX + u * trunkW * 3.0 + jitter;
      const gy = baseY + 8 + ((gi * 3) % 3) * 1.2;
      const bh = 7 + ((gi * 5 + Math.floor(seed * 3)) % 8) + Math.min(4, trunkW * 0.22);
      const curlDir = (u >= 0 ? 1 : -1) * (3.5 + ((gi * 7) % 5)) + Math.sin(seed + gi * 1.9) * 3.2;
      const windPush = Math.sin(tSec * 2.1 + gi * 0.9 + seed) * (1.0 + windFactor * 1.8) + windSign * windFactor * 2.4;
      const tipX = gx + curlDir + windPush;
      const tipY = gy - bh + Math.abs(curlDir) * 0.22;

      ctx.strokeStyle =
        gi % 3 === 0 && sunlightFactor > 0.14 ? collarLit : gi % 2 === 0 ? collarMid : collarDark;
      ctx.lineWidth = gi % 3 === 0 ? 1.55 : 1.25;
      ctx.beginPath();
      ctx.moveTo(gx, gy + 1.5);
      ctx.quadraticCurveTo(gx + curlDir * 0.22 + windPush * 0.35, gy - bh * 0.62, tipX, tipY);
      ctx.stroke();
    }
  }

  if (rimCol) {
    const rimSide = sunDirX >= 0 ? leftEdge : rightEdge;
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = Math.max(1.2, trunkW * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rimSide[1].x, rimSide[1].y);
    for (let s = 2; s <= steps; s++) ctx.lineTo(rimSide[s].x, rimSide[s].y);
    ctx.stroke();
  }

  // Subtle organic bark striations curving gently up the unified trunk
  ctx.strokeStyle = rgbCss(barkDarkRgb, 0.52 * alpha);
  ctx.lineWidth = 1.0;
  for (let bk = -2; bk <= 2; bk++) {
    if (bk === 0) continue;
    const offX = bk * (trunkW * 0.16);
    ctx.beginPath();
    ctx.moveTo(baseX + offX * 1.35, baseY + 1);
    ctx.quadraticCurveTo(midTrunkX + offX * 0.85, midTrunkY, crownX + offX * 0.35, crownY + heightPx * 0.06);
    ctx.stroke();
  }

  // Species-specific branching architecture: ZERO branches ever spawn at the same height/point!
  const spreadMult =
    species === 'koroi'
      ? 1.25
      : species === 'banyan'
        ? 1.28
        : species === 'krishnachura'
          ? 1.32
          : species === 'kadamba' || species === 'jamun'
            ? 1.12
            : species === 'lychee' || species === 'jackfruit'
              ? 1.06
              : 1.0;
  const branchConfigs =
    species === 'koroi' || species === 'krishnachura'
      ? [
          { t: 0.48, ang: -2.42, len: 0.44 },
          { t: 0.57, ang: -0.68, len: 0.46 },
          { t: 0.69, ang: -2.18, len: 0.48 },
          { t: 0.77, ang: -0.95, len: 0.49 },
          { t: 0.88, ang: -1.86, len: 0.45 },
          { t: 0.94, ang: -1.32, len: 0.46 },
          { t: 0.99, ang: -1.58, len: 0.39 },
        ]
      : species === 'shimul'
        ? [
            { t: 0.44, ang: -2.72, len: 0.36 },
            { t: 0.52, ang: -0.42, len: 0.38 },
            { t: 0.66, ang: -2.54, len: 0.34 },
            { t: 0.74, ang: -0.62, len: 0.35 },
            { t: 0.86, ang: -2.18, len: 0.30 },
            { t: 0.92, ang: -0.96, len: 0.31 },
            { t: 0.98, ang: -1.57, len: 0.28 },
          ]
        : [
            { t: 0.34, ang: -2.48, len: 0.39 },
            { t: 0.43, ang: -0.64, len: 0.41 },
            { t: 0.56, ang: -2.14, len: 0.43 },
            { t: 0.65, ang: -0.94, len: 0.45 },
            { t: 0.78, ang: -1.82, len: 0.42 },
            { t: 0.86, ang: -1.24, len: 0.43 },
            { t: 0.96, ang: -1.56, len: 0.37 },
          ];

  const tips: Array<{ x: number; y: number; r: number; seedOff: number; tier: 'inner' | 'mid' | 'outer' }> = [];
  const forkCrotches: Array<{ x: number; y: number }> = [];
  const perches: Array<{ x: number; y: number; face: 1 | -1 }> = [];

  branchConfigs.forEach((b, bi) => {
    // EXACT Bezier curve point along the curved trunk — zero visual detachment!
    const attach = evalQuadBezier(baseX, baseY + 3, midTrunkX, midTrunkY, crownX, crownY, b.t);
    // Overlap inside trunk core slightly for seamless bark union
    const startX = attach.x;
    const startY = attach.y + 1.5;
    const effWind = Math.min(1.25, windFactor / (1 + windFactor * 0.26));
    const fl =
      windFactor > 0.015
        ? Math.sin(tSec * 1.95 + seed + bi * 1.85) * w.pocket * effWind * 0.052
        : 0;
    const branchBend = windSign * Math.min(0.16, w.bend * 0.115);
    const ang = b.ang + (Math.sin(seed * 5.7 + bi * 3.1) * 0.09) + branchBend + fl;
    const len = heightPx * b.len * spreadMult;
    const endX = startX + Math.cos(ang) * len;
    const endY = startY + Math.sin(ang) * len;
    const midX = (startX + endX) * 0.5 + (bi % 2 === 0 ? -9 : 9) + windSign * Math.min(len * 0.095, w.bend * len * 0.072);
    const midY = (startY + endY) * 0.5 - len * 0.11;

    const limbW0 = Math.max(2.6, trunkW * (0.42 - b.t * 0.22));
    const limbW1 = Math.max(1.2, limbW0 * 0.34);
    drawTaperedCurve(ctx, startX, startY, midX, midY, endX, endY, limbW0, limbW1, barkCss, rimCol, sunDirX);

    // Record exact interior branch fork crotches (`দুটা ডালের মাঝে`) for nests & exact limb perches for birds!
    if (bi >= 1 && bi <= 4) {
      const forkSeat = evalQuadBezier(startX, startY, midX, midY, endX, endY, 0.44);
      forkCrotches.push({ x: forkSeat.x, y: forkSeat.y - limbW0 * 0.32 });
    }
    if (bi >= 2 && bi <= 5) {
      const perchPt = evalQuadBezier(startX, startY, midX, midY, endX, endY, 0.72);
      perches.push({
        x: perchPt.x,
        y: perchPt.y - limbW0 * 0.28,
        face: Math.cos(ang) >= 0 ? 1 : -1,
      });
    }

    // Banyan aerial roots dropping down from heavy horizontal limbs
    if (species === 'banyan' && bi < 4) {
      const rootP = evalQuadBezier(startX, startY, midX, midY, endX, endY, 0.58);
      const rootLen = (baseY - rootP.y) * 0.72;
      const sway = windSign * w.bend * 9 + Math.sin(tSec * 1.1 + bi) * 2;
      ctx.strokeStyle = barkCss;
      ctx.lineWidth = Math.max(1.3, trunkW * 0.09);
      ctx.beginPath();
      ctx.moveTo(rootP.x, rootP.y);
      ctx.quadraticCurveTo(rootP.x + sway * 0.5, rootP.y + rootLen * 0.55, rootP.x + sway, rootP.y + rootLen);
      ctx.stroke();
    }

    // Secondary forked sub-branches attached strictly onto exact points of the primary limb!
    for (let sb = 0; sb < 2; sb++) {
      const forkT = sb === 0 ? 0.52 : 0.8;
      const forkBase = evalQuadBezier(startX, startY, midX, midY, endX, endY, forkT);
      const subSide = sb === 0 ? -1 : 1;
      const subAng = ang + subSide * (0.42 + (bi % 2) * 0.14) + windSign * Math.min(0.11, w.bend * 0.07) + fl * 0.85;
      const subLen = len * (sb === 0 ? 0.48 : 0.38);
      const sEndX = forkBase.x + Math.cos(subAng) * subLen;
      const sEndY = forkBase.y + Math.sin(subAng) * subLen;
      const sMidX = (forkBase.x + sEndX) * 0.5 + windSign * Math.min(subLen * 0.08, w.bend * subLen * 0.05);
      const sMidY = (forkBase.y + sEndY) * 0.5 - subLen * 0.08;
      drawTaperedCurve(
        ctx,
        forkBase.x,
        forkBase.y,
        sMidX,
        sMidY,
        sEndX,
        sEndY,
        Math.max(1.4, limbW0 * 0.48),
        0.9,
        barkCss,
        null,
        sunDirX
      );
      if (sb === 0 && bi >= 1 && bi <= 4) {
        // Exact crotch pocket seated directly inside primary limb & secondary fork V-junction!
        forkCrotches.unshift({ x: forkBase.x + Math.cos(ang) * 4, y: forkBase.y - 2.5 });
      }
      if (sb === 1 && bi >= 1 && bi <= 5) {
        const subPerch = evalQuadBezier(forkBase.x, forkBase.y, sMidX, sMidY, sEndX, sEndY, 0.58);
        perches.push({
          x: subPerch.x,
          y: subPerch.y - 1.5,
          face: Math.cos(subAng) >= 0 ? 1 : -1,
        });
      }
      tips.push({ x: sEndX, y: sEndY, r: heightPx * 0.25, seedOff: bi * 7 + sb * 3.1, tier: 'outer' });
      tips.push({ x: sMidX, y: sMidY, r: heightPx * 0.22, seedOff: bi * 5 + sb * 2.3, tier: 'mid' });
    }

    const shoulderPt = evalQuadBezier(startX, startY, midX, midY, endX, endY, 0.72);
    tips.push({ x: endX, y: endY, r: heightPx * 0.30, seedOff: bi * 11.1, tier: 'outer' });
    tips.push({ x: shoulderPt.x, y: shoulderPt.y - heightPx * 0.02, r: heightPx * 0.27, seedOff: bi * 6.7, tier: 'mid' });
    tips.push({ x: midX, y: midY - heightPx * 0.02, r: heightPx * 0.26, seedOff: bi * 4.3, tier: 'inner' });
  });

  // Extra central interior canopy crown density so tree crowns look lush & solid
  tips.push({ x: crownX, y: crownY - heightPx * 0.11, r: heightPx * 0.33, seedOff: 9.7, tier: 'inner' });
  tips.push({ x: crownX - heightPx * 0.1, y: crownY - heightPx * 0.04, r: heightPx * 0.29, seedOff: 4.1, tier: 'inner' });
  tips.push({ x: crownX + heightPx * 0.1, y: crownY - heightPx * 0.04, r: heightPx * 0.29, seedOff: 6.4, tier: 'inner' });

  // Hanging monsoon vines (বর্ষা)
  if (monsoonVineWeight > 0.18) {
    ctx.strokeStyle = rgbCss(lerpRgb([14, 34, 18], [32, 74, 34], dayWeight), 0.72 * monsoonVineWeight);
    ctx.lineWidth = 1.15;
    tips.slice(0, 6).forEach((tp, vi) => {
      const sway = windSign * w.bend * 14 + Math.sin(tSec * 1.4 + seed + vi) * 3;
      const vLen = heightPx * (0.14 + (vi % 2) * 0.08);
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y);
      ctx.quadraticCurveTo(tp.x + sway * 0.5, tp.y + vLen * 0.55, tp.x + sway, tp.y + vLen);
      ctx.stroke();
    });
  }

  // Winter leaf thinning (less thinning on evergreen mango/banyan/jackfruit/lychee; heavier on shimul!)
  const evergreenResist =
    species === 'mango' || species === 'banyan' || species === 'jackfruit' || species === 'lychee'
      ? 0.28
      : species === 'shimul'
        ? 0.72
        : 0.52;
  const foliageDensity = clamp01(1 - winterShedWeight * evergreenResist + monsoonVineWeight * 0.15);

  const drawSprigCluster = (packArr: HTMLCanvasElement[], opacity: number, onlyTiers?: boolean) => {
    if (opacity <= 0.02) return;
    ctx.save();
    const baseOpacity = opacity * foliageDensity * alpha;
    tips.forEach((tp, ti) => {
      if (onlyTiers && tp.tier === 'inner') return;
      // Leave delicate natural light gaps along outer perimeter branches so low sunset/sunrise sunbeams peek through
      const gapFade = tp.tier === 'outer' && ti % 4 === 1 ? 0.68 : 1.0;
      ctx.globalAlpha = baseOpacity * gapFade;
      const sz = tp.r * (species === 'koroi' ? 1.32 : 1.40);
      const spr = packArr[(Math.floor(seed * 7) + ti) % packArr.length];
      // Smooth, natural canopy leaf cluster sway & rustle in gusts (zero seismic jitter)
      const effWind = Math.min(1.25, windFactor / (1 + windFactor * 0.26));
      const leafWave =
        Math.sin(tSec * 2.38 + tp.seedOff + seed) * (0.028 + effWind * 0.095);
      const dx =
        windSign * Math.min(8.5, w.bend * 6.0) +
        Math.sin(tSec * 2.12 + tp.seedOff) * (0.45 + effWind * 1.85) * windSign;
      const dy = Math.cos(tSec * 2.35 + tp.seedOff) * (0.25 + effWind * 0.78);
      ctx.save();
      ctx.translate(tp.x + dx, tp.y + dy);
      ctx.rotate(w.flutter * 0.19 + leafWave + ((ti % 3) - 1) * 0.22);
      ctx.drawImage(spr, -sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();
    });
    ctx.restore();
  };

  if (winterShedWeight > 0.35) {
    drawSprigCluster(pack.sprigWinter, winterShedWeight * 0.82);
  }
  if (rainWeight > 0.18 || monsoonVineWeight > 0.2) {
    drawSprigCluster(pack.sprigMonsoon, Math.max(rainWeight, monsoonVineWeight) * 0.94);
  }
  drawSprigCluster(pack.sprigCool, 0.98 - winterShedWeight * 0.38);

  // Render nestled bird nests INSIDE the real V-crotch between rear foliage & sunlit canopy rim!
  if (opts.renderForkNest && forkCrotches.length > 0) {
    opts.renderForkNest(forkCrotches[0]);
  }

  if (sunlightFactor > 0.06) {
    drawSprigCluster(pack.sprigSun, sunlightFactor * (1 - twilight * 0.65) * 0.94);
    if (twilight > 0.12) {
      drawSprigCluster(pack.sprigGolden, sunlightFactor * twilight * 0.95);
    }
    const rimArr = twilight > 0.35 ? pack.sprigGoldenRim : pack.sprigSunRim;
    ctx.save();
    ctx.globalAlpha = sunlightFactor * 0.78 * foliageDensity * alpha;
    tips.forEach((tp, ti) => {
      if (tp.tier === 'inner') return;
      const sz = tp.r * 1.25;
      const spr = rimArr[(Math.floor(seed * 5) + ti) % rimArr.length];
      const effWind = Math.min(1.15, windFactor / (1 + windFactor * 0.32));
      const leafWave = Math.sin(tSec * 1.42 + tp.seedOff) * (0.024 + effWind * 0.075);
      const dx =
        windSign * Math.min(4.0, w.bend * 2.8) +
        Math.sin(tSec * 1.22 + tp.seedOff) * (0.3 + effWind * 1.15) * windSign;
      ctx.save();
      ctx.translate(tp.x + sunDirX * 5 + dx, tp.y - 4);
      ctx.rotate(leafWave + w.flutter * 0.15);
      ctx.drawImage(spr, -sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();
    });
    ctx.restore();
  }

  if (moonVis > 0.15) {
    drawSprigCluster(pack.sprigMoonRim, moonVis * 0.58, true);
  }

  // Independent outer fluttering individual leaf tufts (creates visible real individual leaf rustling!)
  if (tips.length > 0 && heightPx > 90) {
    const outerLeafRgb = lerpRgb(
      [14, 28, 16],
      sunlightFactor > 0.25 ? [88, 148, 48] : [36, 78, 34],
      0.22 + dayWeight * 0.78
    );
    ctx.save();
    ctx.fillStyle = rgbCss(outerLeafRgb, 0.88 * foliageDensity * alpha);
    tips.forEach((tp, ti) => {
      if (tp.tier !== 'outer') return;
      const effWind = Math.min(1.15, windFactor / (1 + windFactor * 0.32));
      for (let lf = 0; lf < 4; lf++) {
        const angBase = (lf / 4) * Math.PI * 2 + tp.seedOff;
        const dist = tp.r * (0.48 + (lf % 2) * 0.16);
        const leafPhase = tSec * 1.75 + ti * 2.3 + lf * 1.9 + seed;
        const lx = tp.x + Math.cos(angBase) * dist + windSign * Math.min(3.6, w.bend * 2.5) + Math.sin(leafPhase) * effWind * 0.85;
        const ly = tp.y + Math.sin(angBase) * dist * 0.72 + Math.cos(leafPhase * 0.9) * effWind * 0.45;
        const flutterAng =
          angBase +
          windSign * Math.min(0.32, w.bend * 0.24) +
          w.flutter * 0.14 +
          Math.sin(leafPhase) * (0.07 + effWind * 0.18);
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(flutterAng);
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.quadraticCurveTo(0, -2.1, 5.2, 0);
        ctx.quadraticCurveTo(0, 2.1, -4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    ctx.restore();
  }

  // Authentic 6-Season Fruit & Blossoms across Bengali Months (মুকুল, আম, জাম, কাঁঠাল, লিচু, কৃষ্ণচূড়া, কদম ও শিমুল)
  if (species === 'mango' && (summerBloomWeight > 0.12 || season === 'grishmo')) {
    const fruitA = clamp01(Math.max(summerBloomWeight, season === 'grishmo' ? 0.88 : 0)) * (0.45 + dayWeight * 0.55);
    ctx.save();
    tips.slice(0, 9).forEach((tp, bi) => {
      const swayX = windSign * w.bend * 2.6 + Math.sin(tSec * 2.4 + bi) * 1.2;
      ctx.strokeStyle = 'rgba(42, 62, 24, 0.72)';
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y + 3);
      ctx.lineTo(tp.x + swayX, tp.y + 12.5);
      ctx.stroke();
      ctx.fillStyle =
        bi % 2 === 0
          ? `rgba(245, 168, 28, ${fruitA.toFixed(2)})`
          : `rgba(116, 178, 44, ${fruitA.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(tp.x + swayX, tp.y + 15.8, 3.3, 4.8, 0.22, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  } else if (species === 'mango' && springNewLeafWeight > 0.18) {
    // Spring Mango Blossom Panicles (`আমের মুকুল`) in ফাল্গুন-চৈত্র
    const mA = clamp01(springNewLeafWeight) * (0.42 + dayWeight * 0.56);
    ctx.save();
    tips.slice(0, 8).forEach((tp, bi) => {
      ctx.fillStyle = `rgba(253, 230, 138, ${mA.toFixed(2)})`;
      for (let m = 0; m < 3; m++) {
        ctx.beginPath();
        ctx.ellipse(tp.x + (m - 1) * 4, tp.y + (bi % 2) * 3 - 4, 2.2, 4.2, (m - 1) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  } else if (species === 'jamun' && (summerBloomWeight > 0.14 || season === 'grishmo' || season === 'barsha')) {
    // Glossy deep-purple Jamun berry clusters (`কালো জাম`) hanging in জ্যৈষ্ঠ-আষাঢ়
    const jA = clamp01(Math.max(summerBloomWeight, season === 'grishmo' ? 0.85 : 0.58)) * (0.45 + dayWeight * 0.55);
    ctx.save();
    tips.slice(0, 8).forEach((tp, bi) => {
      for (let b = 0; b < 4; b++) {
        const bx = tp.x + ((b % 2) - 0.5) * 4.5 + (bi % 2 === 0 ? -3 : 3);
        const by = tp.y + 5 + b * 2.8;
        ctx.fillStyle = `rgba(62, 18, 86, ${jA.toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(bx, by, 1.9, 2.7, 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(192, 132, 252, ${(jA * 0.38).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(bx - 0.5, by - 0.8, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  } else if (species === 'lychee' && (summerBloomWeight > 0.14 || season === 'grishmo')) {
    // Ruby-red Lychee fruit bunches (`লিচু`) in জ্যৈষ্ঠ
    const lA = clamp01(Math.max(summerBloomWeight, season === 'grishmo' ? 0.9 : 0)) * (0.48 + dayWeight * 0.52);
    ctx.save();
    tips.slice(0, 8).forEach((tp, bi) => {
      ctx.strokeStyle = 'rgba(42, 72, 28, 0.75)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y + 2);
      ctx.lineTo(tp.x + (bi % 2 === 0 ? -2 : 2), tp.y + 9);
      ctx.stroke();
      for (let b = 0; b < 3; b++) {
        const bx = tp.x + (b - 1) * 3.4;
        const by = tp.y + 10.5 + (b % 2) * 2.5;
        ctx.fillStyle = `rgba(220, 38, 62, ${lA.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(254, 202, 202, ${(lA * 0.42).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(bx - 0.7, by - 0.7, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  // Jackfruit (`কাঁঠাল`) ONLY on genuine jackfruit trees (strictly 1 fruit type per tree!)
  if (
    species === 'jackfruit' &&
    (summerBloomWeight > 0.18 || season === 'grishmo' || season === 'barsha') &&
    !inPlanter
  ) {
    const jkCount = 3;
    const jkA = clamp01(Math.max(summerBloomWeight, season === 'grishmo' ? 0.86 : 0.65)) * (0.45 + dayWeight * 0.55);
    const tSamples = [0.46, 0.64, 0.78];
    for (let ji = 0; ji < jkCount; ji++) {
      const jPt = evalQuadBezier(baseX, baseY + 3, midTrunkX, midTrunkY, crownX, crownY, tSamples[ji % tSamples.length]);
      const side = ji % 2 === 0 ? 1 : -1;
      const jx = jPt.x + side * trunkW * 0.44;
      const jy = jPt.y + 3;
      ctx.fillStyle = `rgba(116, 152, 38, ${jkA.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(jx, jy, 4.8, 6.8, side * 0.12, 0, Math.PI * 2);
      ctx.fill();
      // Sunlit bumpy texture specks on কাঁঠাল skin
      ctx.fillStyle = `rgba(190, 214, 72, ${(jkA * 0.65).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(jx - side * 1.2, jy - 2, 1.1, 0, Math.PI * 2);
      ctx.arc(jx + side * 0.8, jy + 1.5, 1.0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (species === 'krishnachura' && (summerBloomWeight > 0.12 || season === 'grishmo' || season === 'basanta')) {
    const bloomA = clamp01(Math.max(summerBloomWeight, season === 'grishmo' ? 0.92 : 0.55)) * (0.48 + dayWeight * 0.52);
    ctx.save();
    tips.slice(0, 10).forEach((tp, bi) => {
      for (let k = 0; k < 6; k++) {
        const ox = Math.cos(k * 1.1 + bi) * (tp.r * 0.28);
        const oy = Math.sin(k * 1.5 + bi) * (tp.r * 0.18) - 3;
        ctx.fillStyle =
          k % 2 === 0
            ? `rgba(239, 68, 68, ${bloomA.toFixed(2)})`
            : `rgba(249, 115, 22, ${(bloomA * 0.92).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(tp.x + ox, tp.y + oy, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  } else if (species === 'shimul' && (springNewLeafWeight > 0.12 || season === 'basanta')) {
    const sA = clamp01(Math.max(springNewLeafWeight, 0.72)) * (0.48 + dayWeight * 0.52);
    ctx.save();
    tips.slice(0, 9).forEach((tp, bi) => {
      for (let k = 0; k < 5; k++) {
        const ox = Math.cos(k * 1.4 + bi) * (tp.r * 0.26);
        const oy = Math.sin(k * 1.9 + bi) * (tp.r * 0.16) - 2;
        ctx.fillStyle = k % 2 === 0 ? `rgba(220, 38, 38, ${sA.toFixed(2)})` : `rgba(234, 88, 12, ${(sA * 0.88).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(tp.x + ox, tp.y + oy, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  } else if (species === 'kadamba' && (monsoonVineWeight > 0.14 || season === 'barsha' || season === 'grishmo')) {
    // Fluffy golden-white Kadamba (`কদম ফুল`) spheres strictly on Kadamba trees!
    const kA = clamp01(Math.max(monsoonVineWeight, 0.86)) * (0.45 + dayWeight * 0.55);
    ctx.save();
    tips.slice(0, 9).forEach((tp, bi) => {
      const kx = tp.x + (bi % 2 === 0 ? -7 : 7);
      const ky = tp.y + 4;
      ctx.fillStyle = `rgba(250, 204, 21, ${kA.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(kx, ky, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${(kA * 0.76).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(kx - 0.8, ky - 0.8, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  ctx.restore();
  return { forkCrotches, perches };
}

export type HumanOutfit = 'panjabi' | 'sari' | 'lungi' | 'shirt' | 'office';
export type HumanActivity =
  | 'walking'
  | 'carrying_bucket'
  | 'watering'
  | 'carrying_pot'
  | 'dipping_pot'
  | 'sweeping'
  | 'sitting_bench'
  | 'eating_snack'
  | 'feeding_birds'
  | 'looking'
  | 'checking_watch'
  | 'carrying_basket'
  | 'drying_towel'
  | 'hanging_laundry'
  | 'collecting_laundry';

export interface PersonRenderOptions {
  x: number;
  y: number; // ground contact Y
  facing: 1 | -1; // +1 walking right, -1 walking left
  scale: number;
  walkPhase: number;
  outfit: HumanOutfit;
  coatRgb: RGB;
  lowerRgb: RGB;
  hasUmbrella: boolean;
  umbrellaRgb: RGB;
  dayWeight: number;
  sunlightFactor: number;
  moonVis: number;
  rainWeight: number;
  windFactor: number;
  windSign: number;
  fogWeight: number;
  shadowShiftX?: number;
  raisedArm?: boolean;
  action?: HumanActivity;
  idleSec?: number;
  carriedClothRgb?: RGB | null;
  bucketClothCount?: number;
}

/**
 * Draws an articulated, anatomically proportioned Bangladeshi person in side-profile
 * with sculpted brow/nose/jaw/chin silhouette, eye/ear detail, tapered collar & fabric drapery,
 * articulated palms & footwear, and purposeful story activities including rooftop laundry chores.
 */
export function drawRealisticPerson(ctx: CanvasRenderingContext2D, opts: PersonRenderOptions) {
  const {
    x,
    y,
    facing,
    scale,
    walkPhase,
    outfit,
    coatRgb,
    lowerRgb,
    hasUmbrella,
    umbrellaRgb,
    dayWeight,
    sunlightFactor,
    moonVis,
    rainWeight,
    windFactor,
    windSign,
    fogWeight,
    shadowShiftX = 0,
    raisedArm = false,
    action = 'walking',
    idleSec = 0,
    carriedClothRgb,
    bucketClothCount = 2,
  } = opts;

  const h = 45 * scale;
  const ambientLight = 0.28 + dayWeight * 0.72 * (1 - fogWeight * 0.25);
  const skinRgb: RGB = [
    Math.round(146 * ambientLight + 30),
    Math.round(100 * ambientLight + 20),
    Math.round(74 * ambientLight + 14),
  ];
  const skinShade: RGB = lerpRgb(skinRgb, [36, 18, 12], 0.26);
  const shirtCol = lerpRgb([22, 26, 36], coatRgb, ambientLight);
  const shirtShade = lerpRgb(shirtCol, [10, 12, 18], 0.36);
  const pantsCol = lerpRgb([14, 18, 26], lowerRgb, ambientLight);
  const hairCol: RGB = [18, 17, 22];

  const isStationaryPose =
    action === 'looking' ||
    action === 'checking_watch' ||
    action === 'watering' ||
    action === 'dipping_pot' ||
    action === 'sweeping' ||
    action === 'sitting_bench' ||
    action === 'eating_snack' ||
    action === 'feeding_birds' ||
    action === 'drying_towel' ||
    action === 'hanging_laundry' ||
    action === 'collecting_laundry';
  const stride = isStationaryPose ? Math.sin(idleSec * 1.1) * 0.08 : Math.sin(walkPhase);
  const strideOpp = -stride;
  const bobY =
    action === 'dipping_pot'
      ? 6.5 * scale
      : action === 'sitting_bench'
        ? 9.5 * scale
        : isStationaryPose
          ? Math.sin(idleSec * 2.1) * 0.35 * scale
          : Math.abs(Math.cos(walkPhase)) * 1.75 * scale;
  const headNod =
    action === 'looking'
      ? Math.sin(idleSec * 1.4) * 0.10
      : action === 'checking_watch' || action === 'dipping_pot' || action === 'feeding_birds'
        ? 0.22
        : action === 'hanging_laundry' || action === 'collecting_laundry'
          ? -0.09
          : 0;

  ctx.save();

  // Soft elliptical ground contact shadow
  ctx.fillStyle = `rgba(6, 10, 18, ${(0.26 + sunlightFactor * 0.16).toFixed(2)})`;
  ctx.beginPath();
  ctx.ellipse(x + shadowShiftX * 4 * scale, y + 1, 9.8 * scale, 2.7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  if (rainWeight > 0.12) {
    ctx.save();
    ctx.globalAlpha = 0.16 * rainWeight;
    ctx.fillStyle = rgbCss(shirtCol);
    ctx.beginPath();
    ctx.ellipse(x, y + 7 * scale, 4.5 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.translate(x, y - bobY);
  ctx.scale(facing, 1);

  const hipY = -h * 0.44;
  const shoulderY = -h * 0.76;
  const headY = -h * 0.905;

  const farHipX = -0.8 * scale;
  const farFootX = strideOpp * 7.8 * scale;
  const farSwing = Math.max(0, -strideOpp);
  const farKneeX = (farHipX + farFootX) * 0.5 + (Math.max(0, strideOpp) * 2.1 + 1.4) * scale;
  const farKneeY = -h * 0.22 - farSwing * 1.4 * scale;
  const farFootY = -farSwing * 2.1 * scale;

  const nearHipX = 0.6 * scale;
  const nearFootX = stride * 7.8 * scale;
  const nearSwing = Math.max(0, -stride);
  const nearKneeX = (nearHipX + nearFootX) * 0.5 + (Math.max(0, stride) * 2.1 + 1.4) * scale;
  const nearKneeY = -h * 0.22 - nearSwing * 1.4 * scale;
  const nearFootY = -nearSwing * 2.1 * scale;

  const drawTaperedLimb = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r0: number,
    r1: number,
    colMid: RGB,
    colShade: RGB
  ) => drawSmoothLimb(ctx, x0, y0, x1, y1, r0, r1, colMid, colShade);

  // Articulated Tapered Far Arm (shoulder -> bicep -> elbow -> forearm -> shaped palm)
  const farReach = action === 'hanging_laundry' || action === 'collecting_laundry';
  const farElbowX = farReach ? 4.4 * scale : stride * 2.6 * scale - 1.0 * scale;
  const farElbowY = farReach ? shoulderY - h * 0.04 : shoulderY + h * 0.15;
  const farHandX = farReach ? 8.2 * scale : stride * 7.0 * scale;
  const farHandY = farReach ? shoulderY - h * 0.16 + Math.sin(idleSec * 3.6) * 1.8 * scale : shoulderY + h * 0.295;
  const isSariOutfit = outfit === 'sari';
  drawTaperedLimb(0, shoulderY + 2.1 * scale, farElbowX, farElbowY, 1.62 * scale, 1.28 * scale, shirtShade, lerpRgb(shirtShade, [8, 10, 14], 0.25));
  drawTaperedLimb(
    farElbowX,
    farElbowY,
    farHandX,
    farHandY,
    isSariOutfit ? 1.18 * scale : 1.26 * scale,
    0.85 * scale,
    isSariOutfit ? skinShade : shirtShade,
    lerpRgb(isSariOutfit ? skinShade : shirtShade, [8, 10, 14], 0.25)
  );
  ctx.fillStyle = rgbCss(skinShade);
  ctx.beginPath();
  ctx.ellipse(farHandX + 0.45 * scale, farHandY, 1.45 * scale, 0.95 * scale, 0.18, 0, Math.PI * 2);
  ctx.fill();

  // Anatomical Far Leg (sculpted thigh -> calf -> continuous ankle collar -> sculpted shoe/sandal)
  const farPantsDark = lerpRgb(pantsCol, [8, 10, 14], 0.34);
  const farAnkleY = farFootY - 0.55 * scale;
  drawTaperedLimb(farHipX, hipY, farKneeX, farKneeY, 2.28 * scale, 1.66 * scale, farPantsDark, lerpRgb(farPantsDark, [6, 8, 12], 0.3));
  drawTaperedLimb(farKneeX, farKneeY, farFootX, farAnkleY, 1.66 * scale, 1.08 * scale, farPantsDark, lerpRgb(farPantsDark, [6, 8, 12], 0.3));
  drawTaperedLimb(farFootX, farAnkleY - 0.6 * scale, farFootX, farFootY + 0.1 * scale, 0.98 * scale, 0.88 * scale, skinShade, lerpRgb(skinShade, [10, 8, 8], 0.25));
  ctx.fillStyle = '#14171c';
  ctx.beginPath();
  ctx.moveTo(farFootX - 1.45 * scale, farFootY - 0.4 * scale);
  ctx.quadraticCurveTo(farFootX + 1.8 * scale, farFootY - 1.2 * scale, farFootX + 4.0 * scale, farFootY + 0.35 * scale);
  ctx.quadraticCurveTo(farFootX + 1.6 * scale, farFootY + 0.85 * scale, farFootX - 1.4 * scale, farFootY + 0.72 * scale);
  ctx.closePath();
  ctx.fill();

  if (outfit === 'sari' || outfit === 'lungi') {
    const sw = Math.abs(stride) * 3.8 * scale;
    const skirtGrad = ctx.createLinearGradient(-4.8 * scale, hipY, 4.8 * scale, 0);
    skirtGrad.addColorStop(0, rgbCss(lerpRgb(pantsCol, [8, 10, 14], 0.28)));
    skirtGrad.addColorStop(0.55, rgbCss(pantsCol));
    skirtGrad.addColorStop(1, rgbCss(lerpRgb(pantsCol, [255, 255, 255], 0.1)));
    ctx.fillStyle = skirtGrad;
    ctx.beginPath();
    ctx.moveTo(-4.0 * scale, hipY - 1.8 * scale);
    ctx.lineTo(4.0 * scale, hipY - 1.8 * scale);
    ctx.quadraticCurveTo(5.1 * scale, hipY * 0.45, (5.2 + sw * 0.58) * scale, -1.6 * scale);
    ctx.lineTo((-5.2 - sw * 0.62) * scale, -1.6 * scale);
    ctx.quadraticCurveTo(-4.8 * scale, hipY * 0.45, -4.0 * scale, hipY - 1.8 * scale);
    ctx.closePath();
    ctx.fill();
    // Pleat fold highlights + woven sari/lungi border stripe (`পাড়`)
    ctx.strokeStyle = `rgba(10, 12, 18, ${(0.22 * ambientLight).toFixed(2)})`;
    ctx.lineWidth = 0.8 * scale;
    ctx.beginPath();
    ctx.moveTo(-1.1 * scale, hipY);
    ctx.lineTo(-1.7 * scale, -2.5 * scale);
    ctx.moveTo(1.7 * scale, hipY);
    ctx.lineTo(2.3 * scale, -2.5 * scale);
    ctx.stroke();
    ctx.strokeStyle = rgbCss(lerpRgb(pantsCol, [245, 224, 178], 0.36), 0.78);
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.moveTo((-5.0 - sw * 0.58) * scale, -2.5 * scale);
    ctx.lineTo((5.0 + sw * 0.54) * scale, -2.5 * scale);
    ctx.stroke();
  }

  if (outfit !== 'sari') {
    const nearAnkleY = nearFootY - 0.55 * scale;
    drawTaperedLimb(nearHipX, hipY, nearKneeX, nearKneeY, 2.34 * scale, 1.70 * scale, pantsCol, lerpRgb(pantsCol, [6, 8, 12], 0.32));
    drawTaperedLimb(nearKneeX, nearKneeY, nearFootX, nearAnkleY, 1.70 * scale, 1.08 * scale, pantsCol, lerpRgb(pantsCol, [6, 8, 12], 0.32));
    drawTaperedLimb(nearFootX, nearAnkleY - 0.6 * scale, nearFootX, nearFootY + 0.1 * scale, 1.0 * scale, 0.9 * scale, skinRgb, skinShade);
  }
  ctx.fillStyle = outfit === 'sari' ? '#291e1a' : '#181c22';
  ctx.beginPath();
  ctx.moveTo(nearFootX - 1.35 * scale, nearFootY - 0.4 * scale);
  ctx.quadraticCurveTo(nearFootX + 1.9 * scale, nearFootY - 1.2 * scale, nearFootX + 4.1 * scale, nearFootY + 0.35 * scale);
  ctx.quadraticCurveTo(nearFootX + 1.6 * scale, nearFootY + 0.88 * scale, nearFootX - 1.35 * scale, nearFootY + 0.74 * scale);
  ctx.closePath();
  ctx.fill();

  // Bamboo woven back basket (`জুমের ঝুড়ি`) behind torso for hill dwellers
  if (action === 'carrying_basket') {
    ctx.fillStyle = rgbCss(lerpRgb([28, 20, 14], [156, 114, 64], ambientLight));
    ctx.beginPath();
    ctx.moveTo(-12.5 * scale, shoulderY - 1 * scale);
    ctx.lineTo(-3.8 * scale, shoulderY - 1 * scale);
    ctx.lineTo(-5.5 * scale, hipY + 2 * scale);
    ctx.lineTo(-10.5 * scale, hipY + 2 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 208, 168, 0.85)';
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.moveTo(2.5 * scale, headY - 2.6 * scale);
    ctx.lineTo(-10.5 * scale, shoulderY - 1 * scale);
    ctx.stroke();
  }

  // Sculpted Anatomical Torso with contoured waist & tailored shoulder/collar
  const shW = isSariOutfit ? 3.55 : 4.25;
  const waistW = isSariOutfit ? 3.05 : 3.75;
  const hipW = isSariOutfit ? 4.25 : 4.35;
  const torsoBotY = hipY + (outfit === 'panjabi' ? 6.8 * scale : 1.6 * scale);
  const torsoGrad = ctx.createLinearGradient(-4.5 * scale, shoulderY, 4.5 * scale, shoulderY);
  torsoGrad.addColorStop(0, rgbCss(shirtShade));
  torsoGrad.addColorStop(0.62, rgbCss(shirtCol));
  torsoGrad.addColorStop(1, rgbCss(lerpRgb(shirtCol, [255, 255, 255], 0.14)));
  ctx.fillStyle = torsoGrad;
  ctx.beginPath();
  ctx.moveTo(-shW * scale, shoulderY + 0.5 * scale);
  ctx.quadraticCurveTo(0, shoulderY - 1.6 * scale, shW * scale, shoulderY + 0.6 * scale);
  ctx.quadraticCurveTo((shW + 0.4) * scale, shoulderY + 5.2 * scale, waistW * scale, (shoulderY + hipY) * 0.56);
  ctx.quadraticCurveTo(hipW * scale, hipY - 1.2 * scale, hipW * scale, torsoBotY);
  ctx.lineTo(-hipW * scale, torsoBotY);
  ctx.quadraticCurveTo(-waistW * scale, (shoulderY + hipY) * 0.56, -shW * scale, shoulderY + 0.5 * scale);
  ctx.closePath();
  ctx.fill();

  // Shirt/Panjabi collar & subtle drapery crease lines
  ctx.strokeStyle = rgbCss(lerpRgb(shirtCol, [14, 16, 22], 0.45), 0.54);
  ctx.lineWidth = 0.72 * scale;
  ctx.beginPath();
  ctx.moveTo(2.0 * scale, shoulderY - 0.5 * scale);
  ctx.lineTo(3.4 * scale, shoulderY + 2.6 * scale);
  if (outfit === 'panjabi' || outfit === 'office' || outfit === 'shirt') {
    ctx.moveTo(3.3 * scale, shoulderY + 2.6 * scale);
    ctx.lineTo(3.3 * scale, shoulderY + 8.4 * scale);
  }
  ctx.stroke();

  if (outfit === 'sari') {
    const flutter = Math.sin(walkPhase * 1.4) * 1.2 * scale + windSign * facing * windFactor * 2.8 * scale;
    const palluBase = lerpRgb(pantsCol, [245, 220, 180], 0.22);
    const palluGrad = ctx.createLinearGradient(2.2 * scale, shoulderY, -6.2 * scale + flutter, hipY + 6.5 * scale);
    palluGrad.addColorStop(0, rgbCss(lerpRgb(palluBase, [255, 245, 230], 0.16), 0.98));
    palluGrad.addColorStop(0.7, rgbCss(palluBase, 0.96));
    palluGrad.addColorStop(1, rgbCss(lerpRgb(palluBase, [12, 14, 20], 0.22), 0.95));
    ctx.fillStyle = palluGrad;
    ctx.beginPath();
    ctx.moveTo(2.2 * scale, shoulderY - 0.2 * scale);
    ctx.lineTo(-4.1 * scale, shoulderY + 1.8 * scale);
    ctx.quadraticCurveTo(-6.6 * scale + flutter * 0.5, hipY - 2 * scale, -5.8 * scale + flutter, hipY + 6.8 * scale);
    ctx.lineTo(-1.6 * scale + flutter * 0.4, hipY + 2.8 * scale);
    ctx.closePath();
    ctx.fill();
    // Woven zari border along the sari pallu (`আঁচলের পাড়`)
    ctx.strokeStyle = rgbCss(lerpRgb(shirtCol, [250, 224, 158], 0.52), 0.78);
    ctx.lineWidth = 0.82 * scale;
    ctx.beginPath();
    ctx.moveTo(-3.9 * scale, shoulderY + 2.0 * scale);
    ctx.quadraticCurveTo(-6.2 * scale + flutter * 0.48, hipY - 1.8 * scale, -5.4 * scale + flutter, hipY + 6.6 * scale);
    ctx.stroke();
  }

  // Slender Anatomical Neck with chin/jawline depth shadow
  ctx.fillStyle = rgbCss(skinRgb);
  ctx.beginPath();
  ctx.moveTo(-0.85 * scale, headY + 2.1 * scale);
  ctx.lineTo(1.65 * scale, headY + 2.1 * scale);
  ctx.lineTo(1.95 * scale, shoulderY + 0.75 * scale);
  ctx.lineTo(-1.1 * scale, shoulderY + 0.75 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgbCss(skinShade, 0.48);
  ctx.beginPath();
  ctx.ellipse(0.5 * scale, headY + 3.15 * scale, 1.45 * scale, 0.65 * scale, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Graceful, Proportional Side-Profile Face (soft curved nose bridge, shaped lips, almond eye w/ sclera & iris, cheekbone tone & natural hair)
  ctx.save();
  ctx.translate(0.95 * scale, headY);
  ctx.rotate(headNod);

  const faceGrad = ctx.createLinearGradient(-3 * scale, -4 * scale, 4 * scale, 4 * scale);
  faceGrad.addColorStop(0, rgbCss(skinShade));
  faceGrad.addColorStop(0.52, rgbCss(skinRgb));
  faceGrad.addColorStop(1, rgbCss(lerpRgb(skinRgb, [255, 228, 204], 0.16)));
  ctx.fillStyle = faceGrad;
  ctx.beginPath();
  // Softly proportioned profile silhouette (ZERO sharp angular spikes!)
  ctx.moveTo(-2.7 * scale, -1.9 * scale);
  ctx.bezierCurveTo(-2.1 * scale, -4.1 * scale, 0.8 * scale, -4.4 * scale, 2.55 * scale, -3.15 * scale); // rounded crown & upper forehead
  ctx.quadraticCurveTo(3.15 * scale, -2.35 * scale, 2.98 * scale, -1.55 * scale); // gentle temple/brow notch
  ctx.quadraticCurveTo(3.45 * scale, -0.7 * scale, 3.88 * scale, 0.12 * scale); // smooth refined nose bridge -> soft tip
  ctx.quadraticCurveTo(3.85 * scale, 0.55 * scale, 3.35 * scale, 0.72 * scale); // delicate under-nose curve
  ctx.quadraticCurveTo(3.55 * scale, 1.08 * scale, 3.62 * scale, 1.24 * scale); // philtrum -> upper lip bow
  ctx.quadraticCurveTo(3.38 * scale, 1.46 * scale, 3.50 * scale, 1.72 * scale); // parted lips -> lower lip cushion
  ctx.quadraticCurveTo(3.18 * scale, 2.02 * scale, 3.22 * scale, 2.38 * scale); // under-lip hollow
  ctx.bezierCurveTo(3.32 * scale, 3.1 * scale, 2.58 * scale, 3.72 * scale, 1.65 * scale, 3.72 * scale); // graceful chin
  ctx.bezierCurveTo(0.1 * scale, 3.74 * scale, -1.55 * scale, 2.9 * scale, -2.35 * scale, 1.65 * scale); // clean sculpted jawline
  ctx.quadraticCurveTo(-3.2 * scale, 0.1 * scale, -2.7 * scale, -1.9 * scale);
  ctx.closePath();
  ctx.fill();

  // Warm soft cheek tone for lifelike facial depth
  const cheekGlow = ctx.createRadialGradient(1.4 * scale, 0.65 * scale, 0.1 * scale, 1.4 * scale, 0.65 * scale, 1.45 * scale);
  cheekGlow.addColorStop(0, `rgba(218, 114, 96, ${(0.22 * ambientLight).toFixed(2)})`);
  cheekGlow.addColorStop(1, 'rgba(218, 114, 96, 0)');
  ctx.fillStyle = cheekGlow;
  ctx.beginPath();
  ctx.arc(1.4 * scale, 0.65 * scale, 1.45 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Soft arched eyebrow + realistic almond eye (white sclera, dark iris, curved upper lash, subtle catchlight)
  ctx.strokeStyle = '#1d1614';
  ctx.lineWidth = (isSariOutfit ? 0.38 : 0.52) * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(1.65 * scale, -1.48 * scale);
  ctx.quadraticCurveTo(2.35 * scale, -1.75 * scale, 2.95 * scale, -1.38 * scale);
  ctx.stroke();

  // Sclera & iris
  ctx.fillStyle = `rgba(248, 248, 250, ${(0.72 + ambientLight * 0.24).toFixed(2)})`;
  ctx.beginPath();
  ctx.ellipse(2.38 * scale, -0.82 * scale, 0.62 * scale, 0.34 * scale, -0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#241814';
  ctx.beginPath();
  ctx.arc(2.56 * scale, -0.82 * scale, 0.31 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.beginPath();
  ctx.arc(2.65 * scale, -0.91 * scale, 0.09 * scale, 0, Math.PI * 2);
  ctx.fill();
  // Upper lash arch
  ctx.strokeStyle = '#141010';
  ctx.lineWidth = 0.34 * scale;
  ctx.beginPath();
  ctx.moveTo(1.78 * scale, -0.84 * scale);
  ctx.quadraticCurveTo(2.4 * scale, -1.18 * scale, 2.98 * scale, -0.82 * scale);
  ctx.stroke();

  // Soft natural lip tint & gentle lip parting crease
  ctx.fillStyle = rgbCss(lerpRgb(skinShade, [168, 72, 74], isSariOutfit ? 0.45 : 0.26), 0.72);
  ctx.beginPath();
  ctx.ellipse(3.26 * scale, 1.46 * scale, 0.36 * scale, 0.28 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgbCss(skinShade, 0.62);
  ctx.lineWidth = 0.32 * scale;
  ctx.beginPath();
  ctx.moveTo(2.86 * scale, 1.44 * scale);
  ctx.lineTo(3.52 * scale, 1.43 * scale);
  ctx.stroke();

  // Sculpted outer ear with inner shadow
  ctx.fillStyle = rgbCss(lerpRgb(skinRgb, skinShade, 0.45));
  ctx.beginPath();
  ctx.ellipse(-0.9 * scale, 0.15 * scale, 0.64 * scale, 1.08 * scale, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgbCss(skinShade, 0.55);
  ctx.lineWidth = 0.32 * scale;
  ctx.beginPath();
  ctx.arc(-0.92 * scale, 0.15 * scale, 0.38 * scale, -0.9, 1.1);
  ctx.stroke();

  // Natural Voluminous Layered Hair with soft sheen
  const hairSheen = lerpRgb(hairCol, [72, 68, 86], 0.32 * ambientLight);
  ctx.fillStyle = rgbCss(hairCol);
  ctx.beginPath();
  if (isSariOutfit) {
    ctx.moveTo(-2.85 * scale, 1.5 * scale);
    ctx.bezierCurveTo(-3.95 * scale, -1.5 * scale, -2.0 * scale, -4.45 * scale, 1.35 * scale, -4.3 * scale);
    ctx.quadraticCurveTo(2.85 * scale, -3.9 * scale, 3.05 * scale, -2.75 * scale);
    ctx.quadraticCurveTo(1.25 * scale, -3.05 * scale, -0.35 * scale, -1.55 * scale);
    ctx.quadraticCurveTo(-1.3 * scale, -0.35 * scale, -1.6 * scale, 1.75 * scale);
  } else {
    ctx.moveTo(-2.9 * scale, 1.2 * scale);
    ctx.bezierCurveTo(-3.8 * scale, -1.6 * scale, -1.9 * scale, -4.5 * scale, 1.3 * scale, -4.4 * scale);
    ctx.quadraticCurveTo(3.15 * scale, -3.95 * scale, 3.2 * scale, -2.6 * scale);
    ctx.quadraticCurveTo(1.5 * scale, -3.0 * scale, -0.35 * scale, -1.9 * scale);
    ctx.quadraticCurveTo(-1.2 * scale, -0.9 * scale, -1.35 * scale, 1.1 * scale);
  }
  ctx.closePath();
  ctx.fill();

  // Subtle hair highlight curve along crown
  ctx.strokeStyle = rgbCss(hairSheen, 0.55);
  ctx.lineWidth = 0.55 * scale;
  ctx.beginPath();
  ctx.moveTo(-1.8 * scale, -3.2 * scale);
  ctx.quadraticCurveTo(0.2 * scale, -4.0 * scale, 2.0 * scale, -3.3 * scale);
  ctx.stroke();

  if (outfit === 'sari') {
    // Soft sculpted low braided chignon bun (`খোঁপা`) + subtle jasmine flowers (`বেলি মালা`)
    ctx.fillStyle = rgbCss(hairCol);
    ctx.beginPath();
    ctx.ellipse(-3.55 * scale, 0.62 * scale, 1.88 * scale, 2.08 * scale, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(254, 249, 235, ${(0.55 + ambientLight * 0.35).toFixed(2)})`;
    [-0.55, 0.15, 0.85].forEach((gy, gi) => {
      ctx.beginPath();
      ctx.arc((-2.95 - gi * 0.18) * scale, gy * scale, 0.42 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();

  if (sunlightFactor > 0.16 || moonVis > 0.2) {
    ctx.strokeStyle =
      sunlightFactor > 0.16
        ? `rgba(255, 232, 182, ${(0.45 * sunlightFactor).toFixed(2)})`
        : `rgba(196, 220, 255, ${(0.35 * moonVis).toFixed(2)})`;
    ctx.lineWidth = 1.0 * scale;
    ctx.beginPath();
    ctx.moveTo(4.3 * scale, shoulderY + 0.5 * scale);
    ctx.lineTo(4.4 * scale, hipY);
    ctx.stroke();
  }

  if (hasUmbrella) {
    const handX = 4.9 * scale;
    const handY = shoulderY + h * 0.14;
    ctx.strokeStyle = rgbCss(shirtCol);
    ctx.lineWidth = 3.1 * scale;
    ctx.beginPath();
    ctx.moveTo(0.8 * scale, shoulderY + 2 * scale);
    ctx.lineTo(3.0 * scale, shoulderY + h * 0.17);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = rgbCss(skinRgb);
    ctx.beginPath();
    ctx.ellipse(handX + 0.4 * scale, handY, 1.55 * scale, 1.15 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    const tilt = 0.08 + windSign * facing * clamp01(windFactor) * 0.18;
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(tilt);

    const poleLen = h * 0.56;
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1.45 * scale;
    ctx.beginPath();
    ctx.moveTo(0, 3 * scale);
    ctx.lineTo(0, -poleLen - 2 * scale);
    ctx.stroke();

    const uCol = lerpRgb([18, 22, 30], umbrellaRgb, 0.25 + ambientLight * 0.75);
    const uDark = lerpRgb(uCol, [8, 10, 14], 0.32);
    const rad = h * 0.42;

    ctx.fillStyle = rgbCss(uCol);
    ctx.beginPath();
    ctx.moveTo(-rad, -poleLen + rad * 0.28);
    ctx.quadraticCurveTo(0, -poleLen - rad * 0.42, rad, -poleLen + rad * 0.28);
    ctx.quadraticCurveTo(rad * 0.5, -poleLen + rad * 0.14, 0, -poleLen + rad * 0.22);
    ctx.quadraticCurveTo(-rad * 0.5, -poleLen + rad * 0.14, -rad, -poleLen + rad * 0.28);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgbCss(uDark, 0.75);
    ctx.lineWidth = 0.9 * scale;
    ctx.beginPath();
    ctx.moveTo(0, -poleLen - rad * 0.08);
    ctx.quadraticCurveTo(-rad * 0.32, -poleLen + rad * 0.04, -rad * 0.48, -poleLen + rad * 0.19);
    ctx.moveTo(0, -poleLen - rad * 0.08);
    ctx.quadraticCurveTo(rad * 0.32, -poleLen + rad * 0.04, rad * 0.48, -poleLen + rad * 0.19);
    ctx.stroke();

    if (rainWeight > 0.1 || sunlightFactor > 0.2) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.25 + sunlightFactor * 0.2).toFixed(2)})`;
      ctx.lineWidth = 1.1 * scale;
      ctx.beginPath();
      ctx.moveTo(-rad * 0.65, -poleLen + rad * 0.04);
      ctx.quadraticCurveTo(0, -poleLen - rad * 0.36, rad * 0.65, -poleLen + rad * 0.04);
      ctx.stroke();
    }

    ctx.restore();
  } else {
    // Articulated 2-segment Near Arm + tapering forearm & palm silhouette
    let elbowX = strideOpp * 2.5 * scale + 1.5 * scale;
    let elbowY = shoulderY + h * 0.15;
    let nearHandX = strideOpp * 6.5 * scale;
    let nearHandY = shoulderY + h * 0.3;

    if (raisedArm) {
      elbowX = 4.6 * scale;
      elbowY = shoulderY - h * 0.07;
      nearHandX = 5.4 * scale;
      nearHandY = shoulderY - h * 0.24;
    } else if (action === 'hanging_laundry') {
      const clipWave = Math.sin(idleSec * 4.2) * 1.15 * scale;
      elbowX = 4.8 * scale;
      elbowY = shoulderY - h * 0.06;
      nearHandX = 8.4 * scale + clipWave * 0.25;
      nearHandY = shoulderY - h * 0.22 + clipWave * 0.7;
    } else if (action === 'collecting_laundry') {
      const pullWave = Math.sin(idleSec * 3.8) * 1.3 * scale;
      elbowX = 4.7 * scale;
      elbowY = shoulderY - h * 0.04;
      nearHandX = 8.3 * scale;
      nearHandY = shoulderY - h * 0.21 + pullWave * 0.7;
    } else if (action === 'carrying_bucket') {
      const swing = strideOpp * 1.4 * scale;
      elbowX = 2.6 * scale + swing * 0.3;
      elbowY = shoulderY + h * 0.16;
      nearHandX = 4.2 * scale + swing;
      nearHandY = hipY + 3.4 * scale;
    } else if (action === 'checking_watch') {
      elbowX = 4.2 * scale;
      elbowY = shoulderY + h * 0.12;
      nearHandX = 6.2 * scale;
      nearHandY = shoulderY + h * 0.01;
    } else if (action === 'carrying_pot') {
      elbowX = 4.8 * scale;
      elbowY = shoulderY + h * 0.18;
      nearHandX = 6.0 * scale;
      nearHandY = hipY + 1.5 * scale;
    } else if (action === 'dipping_pot') {
      const dipBob = Math.sin(idleSec * 2.6) * 2.0 * scale;
      elbowX = 6.2 * scale;
      elbowY = shoulderY + h * 0.18;
      nearHandX = 9.5 * scale;
      nearHandY = hipY + 5.5 * scale + dipBob;
    } else if (action === 'sweeping') {
      const sweep = Math.sin(idleSec * 4.4) * 3.8 * scale;
      elbowX = 5.0 * scale + sweep * 0.4;
      elbowY = shoulderY + h * 0.18;
      nearHandX = 7.4 * scale + sweep;
      nearHandY = hipY + 3.2 * scale;
    } else if (action === 'eating_snack') {
      const bite = Math.max(0, Math.sin(idleSec * 2.0)) * 3.5 * scale;
      elbowX = 4.6 * scale;
      elbowY = shoulderY + h * 0.14;
      nearHandX = 5.8 * scale;
      nearHandY = shoulderY - 1.5 * scale - bite;
    } else if (action === 'feeding_birds') {
      const toss = Math.sin(idleSec * 3.8) * 2.4 * scale;
      elbowX = 5.6 * scale;
      elbowY = shoulderY + h * 0.14;
      nearHandX = 9.2 * scale;
      nearHandY = shoulderY + h * 0.2 + toss;
    } else if (action === 'watering') {
      const pourBob = Math.sin(idleSec * 3.2) * 1.4 * scale;
      elbowX = 4.8 * scale;
      elbowY = shoulderY + h * 0.16;
      nearHandX = 8.4 * scale;
      nearHandY = shoulderY + h * 0.24 + pourBob;
    } else if (action === 'drying_towel') {
      const rub = Math.sin(idleSec * 4.8) * 2.6 * scale;
      elbowX = 5.2 * scale;
      elbowY = shoulderY + h * 0.04;
      nearHandX = 2.5 * scale + rub;
      nearHandY = shoulderY - h * 0.16;
    }

    // Tapered Anatomical Upper Arm + Forearm + Palm
    drawTaperedLimb(0.8 * scale, shoulderY + 2 * scale, elbowX, elbowY, 1.68 * scale, 1.32 * scale, shirtCol, shirtShade);
    const armCol = outfit === 'office' || outfit === 'panjabi' ? shirtCol : skinRgb;
    const armShade = outfit === 'office' || outfit === 'panjabi' ? shirtShade : skinShade;
    drawTaperedLimb(elbowX, elbowY, nearHandX, nearHandY, isSariOutfit ? 1.15 * scale : 1.3 * scale, 0.86 * scale, armCol, armShade);
    if (isSariOutfit) {
      // Delicate gold bangles (`চুড়ি`) near wrist
      ctx.strokeStyle = `rgba(250, 204, 21, ${(0.45 + ambientLight * 0.42).toFixed(2)})`;
      ctx.lineWidth = 0.65 * scale;
      ctx.beginPath();
      ctx.arc(nearHandX - (nearHandX - elbowX) * 0.14, nearHandY - (nearHandY - elbowY) * 0.14, 1.0 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Anatomical palm + thumb silhouette
    ctx.fillStyle = rgbCss(skinRgb);
    ctx.beginPath();
    ctx.ellipse(nearHandX + 0.55 * scale, nearHandY, 1.55 * scale, 1.02 * scale, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Realistic 3D Laundry Bucket (`বালতি`) helper used when carrying OR resting beside feet
    const drawLaundryBucket = (bx: number, byTop: number, holdingHandle: boolean, clothsInBucket: number) => {
      const bwTop = 4.6 * scale;
      const bwBot = 3.4 * scale;
      const bH = 7.4 * scale;
      // Folded clothes stacked neatly inside bucket rim
      const clothPalette: RGB[] = [
        [218, 86, 104],
        [92, 158, 212],
        [230, 174, 68],
      ];
      const showClothCount = Math.max(0, Math.min(3, clothsInBucket));
      for (let ci = 0; ci < showClothCount; ci++) {
        const cCol = lerpRgb([34, 28, 32], clothPalette[ci % clothPalette.length], ambientLight);
        ctx.fillStyle = rgbCss(cCol);
        ctx.beginPath();
        ctx.ellipse(
          bx + (ci - 1) * 1.1 * scale,
          byTop - (0.8 + ci * 0.65) * scale,
          2.6 * scale,
          1.35 * scale,
          (ci - 1) * 0.14,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      // Shaded cylindrical bucket body
      const bGrad = ctx.createLinearGradient(bx - bwTop, byTop, bx + bwTop, byTop);
      bGrad.addColorStop(0, rgbCss(lerpRgb([18, 28, 42], [44, 118, 168], ambientLight)));
      bGrad.addColorStop(0.55, rgbCss(lerpRgb([14, 22, 34], [32, 92, 136], ambientLight)));
      bGrad.addColorStop(1, rgbCss(lerpRgb([8, 14, 22], [18, 56, 86], ambientLight)));
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.moveTo(bx - bwTop, byTop);
      ctx.lineTo(bx + bwTop, byTop);
      ctx.lineTo(bx + bwBot, byTop + bH);
      ctx.quadraticCurveTo(bx, byTop + bH + 1.1 * scale, bx - bwBot, byTop + bH);
      ctx.closePath();
      ctx.fill();
      // Rolled bucket top rim collar + mid rib
      ctx.fillStyle = rgbCss(lerpRgb([28, 40, 56], [84, 152, 198], ambientLight));
      ctx.beginPath();
      ctx.roundRect(bx - bwTop - 0.5 * scale, byTop - 0.5 * scale, bwTop * 2 + 1.0 * scale, 1.35 * scale, 0.5 * scale);
      ctx.fill();
      ctx.strokeStyle = 'rgba(12, 20, 32, 0.36)';
      ctx.lineWidth = 0.65 * scale;
      ctx.beginPath();
      ctx.moveTo(bx - (bwTop + bwBot) * 0.49, byTop + bH * 0.36);
      ctx.lineTo(bx + (bwTop + bwBot) * 0.49, byTop + bH * 0.36);
      ctx.stroke();
      // Wire bail handle (held upward cleanly in hand OR draped against rim when resting)
      ctx.strokeStyle = rgbCss(lerpRgb([48, 54, 62], [198, 208, 218], ambientLight));
      ctx.lineWidth = 0.75 * scale;
      ctx.beginPath();
      if (holdingHandle) {
        ctx.moveTo(bx - bwTop + 0.3 * scale, byTop + 0.3 * scale);
        ctx.quadraticCurveTo(bx, byTop - 5.2 * scale, bx + bwTop - 0.3 * scale, byTop + 0.3 * scale);
      } else {
        ctx.moveTo(bx - bwTop + 0.3 * scale, byTop + 0.4 * scale);
        ctx.quadraticCurveTo(bx, byTop + 3.2 * scale, bx + bwTop - 0.3 * scale, byTop + 0.4 * scale);
      }
      ctx.stroke();
    };

    // Terracotta/brass pitcher (`কলসি`) braced at waist or dipped cleanly at ghat edge
    if (action === 'carrying_pot') {
      ctx.fillStyle = rgbCss(lerpRgb([48, 24, 14], [182, 88, 42], ambientLight));
      ctx.beginPath();
      ctx.ellipse(4.8 * scale, hipY - 0.5 * scale, 4.6 * scale, 5.2 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgbCss(lerpRgb([32, 16, 10], [126, 56, 26], ambientLight));
      ctx.fillRect(3.0 * scale, hipY - 6.6 * scale, 3.6 * scale, 2.2 * scale);
    } else if (action === 'carrying_bucket') {
      drawLaundryBucket(nearHandX + 0.4 * scale, nearHandY + 4.0 * scale, true, bucketClothCount);
    } else if (action === 'dipping_pot') {
      ctx.fillStyle = rgbCss(lerpRgb([48, 24, 14], [182, 88, 42], ambientLight));
      ctx.beginPath();
      ctx.ellipse(nearHandX + 2.8 * scale, nearHandY + 2.5 * scale, 4.4 * scale, 4.8 * scale, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 244, 255, 0.65)';
      ctx.lineWidth = 1.0 * scale;
      ctx.beginPath();
      ctx.ellipse(nearHandX + 3.5 * scale, nearHandY + 6.5 * scale, (7 + Math.sin(idleSec * 4) * 2.5) * scale, 2.0 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (action === 'sweeping') {
      const sweep = Math.sin(idleSec * 4.4) * 4.8 * scale;
      ctx.strokeStyle = rgbCss(lerpRgb([36, 28, 16], [148, 118, 62], ambientLight));
      ctx.lineWidth = 1.6 * scale;
      ctx.beginPath();
      ctx.moveTo(nearHandX - 1 * scale, nearHandY - 5 * scale);
      ctx.lineTo(nearHandX + 5.5 * scale + sweep, 0.5 * scale);
      ctx.stroke();
    } else if (action === 'eating_snack') {
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.moveTo(nearHandX - 1.4 * scale, nearHandY - 2 * scale);
      ctx.lineTo(nearHandX + 2.4 * scale, nearHandY - 5.2 * scale);
      ctx.lineTo(nearHandX + 1.4 * scale, nearHandY + 1.5 * scale);
      ctx.closePath();
      ctx.fill();
    } else if (action === 'feeding_birds') {
      ctx.fillStyle = 'rgba(253, 224, 130, 0.9)';
      for (let g = 0; g < 5; g++) {
        const tDrop = (idleSec * 1.4 + g * 0.2) % 1;
        ctx.beginPath();
        ctx.arc(nearHandX + (2 + tDrop * 9 + g * 0.8) * scale, nearHandY + tDrop * (Math.abs(nearHandY)) * 0.92, 0.85 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (action === 'hanging_laundry' || action === 'collecting_laundry') {
      // Resting realistic 3D laundry bucket beside her feet + realistic draped garment held up to clothesline
      ctx.fillStyle = 'rgba(4, 8, 14, 0.28)';
      ctx.beginPath();
      ctx.ellipse(-4.5 * scale, 0.6 * scale, 4.2 * scale, 1.3 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      drawLaundryBucket(-4.8 * scale, -7.4 * scale, false, bucketClothCount);

      if (carriedClothRgb !== null) {
        const clothRgbVal: RGB = carriedClothRgb ?? (action === 'hanging_laundry' ? [224, 96, 112] : [96, 165, 220]);
        const cMid = lerpRgb([28, 28, 36], clothRgbVal, ambientLight);
        const cShade = lerpRgb(cMid, [10, 12, 18], 0.32);
        const sway = Math.sin(idleSec * 3.2) * 0.9 * scale + windSign * facing * windFactor * 1.4 * scale;
        const clothGrad = ctx.createLinearGradient(nearHandX - 3 * scale, nearHandY, nearHandX + 4 * scale, nearHandY + 10 * scale);
        clothGrad.addColorStop(0, rgbCss(lerpRgb(cMid, [255, 255, 255], 0.12), 0.95));
        clothGrad.addColorStop(0.55, rgbCss(cMid, 0.94));
        clothGrad.addColorStop(1, rgbCss(cShade, 0.92));
        ctx.fillStyle = clothGrad;
        ctx.beginPath();
        ctx.moveTo(nearHandX - 2.2 * scale, nearHandY + 0.3 * scale);
        ctx.lineTo(nearHandX + 3.2 * scale, nearHandY + 0.3 * scale);
        ctx.quadraticCurveTo(nearHandX + 4.2 * scale + sway * 0.5, nearHandY + 5.2 * scale, nearHandX + 3.6 * scale + sway, nearHandY + 9.4 * scale);
        ctx.quadraticCurveTo(nearHandX + 0.8 * scale + sway * 0.8, nearHandY + 10.2 * scale, nearHandX - 2.6 * scale + sway * 0.7, nearHandY + 9.2 * scale);
        ctx.closePath();
        ctx.fill();
        // Fabric drape fold highlight line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.lineWidth = 0.65 * scale;
        ctx.beginPath();
        ctx.moveTo(nearHandX + 0.6 * scale, nearHandY + 1.2 * scale);
        ctx.quadraticCurveTo(nearHandX + 0.9 * scale + sway * 0.4, nearHandY + 5.5 * scale, nearHandX + 0.5 * scale + sway * 0.8, nearHandY + 8.8 * scale);
        ctx.stroke();
      }
    }

    // Watering can (`ঝাঝরি`) pouring gentle rose-nozzle water droplets cleanly inside rooftop pots
    if (action === 'watering') {
      const canBase = lerpRgb([18, 34, 24], [38, 128, 72], ambientLight);
      const canGrad = ctx.createLinearGradient(nearHandX - 1 * scale, nearHandY - 2 * scale, nearHandX + 6.5 * scale, nearHandY + 3.5 * scale);
      canGrad.addColorStop(0, rgbCss(lerpRgb(canBase, [255, 255, 255], 0.16)));
      canGrad.addColorStop(1, rgbCss(lerpRgb(canBase, [8, 14, 10], 0.32)));
      ctx.strokeStyle = rgbCss(canBase);
      ctx.lineWidth = 1.0 * scale;
      ctx.beginPath();
      ctx.arc(nearHandX + 2.2 * scale, nearHandY - 1.2 * scale, 2.5 * scale, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = canGrad;
      ctx.beginPath();
      ctx.roundRect(nearHandX - 1.2 * scale, nearHandY - 1.5 * scale, 7.2 * scale, 5.2 * scale, 1.3 * scale);
      ctx.fill();
      ctx.strokeStyle = rgbCss(canBase);
      ctx.lineWidth = 1.35 * scale;
      ctx.beginPath();
      ctx.moveTo(nearHandX + 5.6 * scale, nearHandY + 1.4 * scale);
      ctx.lineTo(nearHandX + 11.2 * scale, nearHandY - 1.2 * scale);
      ctx.stroke();
      ctx.fillStyle = rgbCss(lerpRgb([48, 56, 64], [196, 208, 220], ambientLight));
      ctx.beginPath();
      ctx.ellipse(nearHandX + 11.7 * scale, nearHandY - 1.1 * scale, 0.9 * scale, 1.5 * scale, 0.45, 0, Math.PI * 2);
      ctx.fill();
      // Multi-stream fine watering droplets landing squarely onto plant canopy & pot soil bowl
      ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
      for (let d = 0; d < 6; d++) {
        const dropProg = ((idleSec * 2.1 + d * 0.17) % 1);
        const dx = nearHandX + (12.0 + (d % 3) * 0.8 + dropProg * 1.4) * scale;
        const dy = nearHandY + (-0.6 + dropProg * 12.2) * scale;
        ctx.beginPath();
        ctx.ellipse(dx, dy, 0.52 * scale, 1.02 * scale, 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (action === 'drying_towel') {
      const rub = Math.sin(idleSec * 4.8) * 2.2 * scale;
      ctx.fillStyle = rgbCss(lerpRgb([48, 22, 18], [234, 88, 62], ambientLight));
      ctx.beginPath();
      ctx.roundRect(nearHandX - 4.2 * scale + rub * 0.3, nearHandY - 2.2 * scale, 8.6 * scale, 6.2 * scale, 1.4 * scale);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillRect(nearHandX - 3.8 * scale + rub * 0.3, nearHandY + 0.8 * scale, 7.8 * scale, 1.3 * scale);
    }

    // Office briefcase / shoulder bag & tie detail for urban office commuters
    if (outfit === 'office' && !raisedArm && action === 'walking') {
      ctx.fillStyle = rgbCss(lerpRgb([14, 10, 8], [62, 42, 28], ambientLight));
      ctx.beginPath();
      ctx.roundRect(nearHandX - 5.2 * scale, nearHandY - 1 * scale, 10.5 * scale, 7.6 * scale, 1.4 * scale);
      ctx.fill();
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
      ctx.lineWidth = 0.8 * scale;
      ctx.strokeRect(nearHandX - 5.2 * scale, nearHandY - 1 * scale, 10.5 * scale, 7.6 * scale);
    }
  }

  ctx.restore();
}

export type VehicleType = 'brtc_bus' | 'cng' | 'sedan' | 'rickshaw';

export interface VehicleRenderOptions {
  type: VehicleType;
  x: number;
  y: number; // ground tire contact Y
  facing: 1 | -1; // +1 driving right, -1 driving left
  scale: number;
  wheelRot: number;
  bodyRgb?: RGB;
  dayWeight: number;
  lightGlow: number;
  rainWeight: number;
  fogWeight: number;
  isBraking?: boolean;
  hasPassenger?: boolean;
}

export function drawRealisticVehicle(ctx: CanvasRenderingContext2D, opts: VehicleRenderOptions) {
  const { type, x, y, facing, scale, wheelRot, bodyRgb, dayWeight, lightGlow, rainWeight, fogWeight, isBraking = false, hasPassenger = false } = opts;

  const amb = 0.25 + dayWeight * 0.75 * (1 - fogWeight * 0.25);

  const drawSpokedWheel = (wx: number, wy: number, r: number, spokes = 6) => {
    ctx.fillStyle = '#0f1318';
    ctx.beginPath();
    ctx.arc(wx, wy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(wx, wy, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = Math.max(0.8, r * 0.11);
    for (let s = 0; s < spokes; s++) {
      const a = wheelRot + (s / spokes) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(a) * r * 0.56, wy + Math.sin(a) * r * 0.56);
      ctx.stroke();
    }
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(wx, wy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawHeadlightBeam = (hx: number, hy: number, len: number, spread: number) => {
    if (lightGlow <= 0.08) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bLen = len * 0.72;
    const g = ctx.createLinearGradient(hx, hy, hx + bLen, hy + spread * 0.25);
    g.addColorStop(0, `rgba(248, 224, 165, ${(0.22 * lightGlow).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(242, 200, 118, ${(0.08 * lightGlow).toFixed(3)})`);
    g.addColorStop(1, 'rgba(242, 200, 118, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(hx, hy - 2.5 * scale);
    ctx.lineTo(hx + bLen, hy - spread * 0.28);
    ctx.lineTo(hx + bLen, hy + spread * 0.62);
    ctx.lineTo(hx, hy + 3.5 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  if (type === 'brtc_bus') {
    const W = 176 * scale;
    const H = 62 * scale;
    const wheelR = 12 * scale;
    const baseCol = lerpRgb([24, 14, 16], bodyRgb ?? [192, 34, 42], amb);
    const roofCol = lerpRgb([42, 46, 52], [228, 224, 214], amb);

    ctx.fillStyle = 'rgba(4, 6, 12, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, W * 0.52, 4.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    if (rainWeight > 0.08 || lightGlow > 0.24) {
      ctx.save();
      ctx.globalAlpha = 0.14 * Math.max(rainWeight * 0.9, lightGlow * 0.4);
      ctx.fillStyle = rgbCss(baseCol);
      ctx.fillRect(-W * 0.48, 3, W * 0.96, H * 0.38);
      ctx.restore();
    }

    ctx.fillStyle = rgbCss(baseCol);
    ctx.beginPath();
    ctx.roundRect(-W * 0.5, -H - wheelR * 0.45, W, H, [6 * scale, 10 * scale, 4 * scale, 4 * scale]);
    ctx.fill();

    ctx.fillStyle = rgbCss(roofCol);
    ctx.fillRect(-W * 0.49, -H - wheelR * 0.45, W * 0.97, 8 * scale);

    const winAlpha = clamp01(lightGlow * 0.42 + 0.14);
    const winRgb = lightGlow > 0.2 ? '234, 198, 120' : '116, 152, 182';
    for (let wi = 0; wi < 6; wi++) {
      const wx = -W * 0.44 + wi * 24 * scale;
      ctx.fillStyle = `rgba(${winRgb}, ${winAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.roundRect(wx, -H + 8 * scale, 19.5 * scale, 19 * scale, 2.5 * scale);
      ctx.fill();
      if (wi !== 2 && amb > 0.16) {
        ctx.fillStyle = `rgba(18, 24, 34, ${(0.55 + lightGlow * 0.2).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(wx + 9.5 * scale, -H + 17.5 * scale, 3.2 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(wx + 5 * scale, -H + 20.5 * scale, 9 * scale, 6.5 * scale);
      }
    }
    ctx.fillStyle = `rgba(${winRgb}, ${Math.max(0.24, winAlpha * 0.78).toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(W * 0.34, -H + 8 * scale);
    ctx.lineTo(W * 0.485, -H + 10 * scale);
    ctx.lineTo(W * 0.49, -H + 28 * scale);
    ctx.lineTo(W * 0.34, -H + 28 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = lightGlow > 0.18 ? 'rgba(244, 218, 134, 0.72)' : '#e2e8f0';
    ctx.fillRect(W * 0.475, -wheelR - 11 * scale, 4.5 * scale, 6 * scale);
    ctx.fillStyle = isBraking ? '#e11d48' : '#b91c1c';
    ctx.fillRect(-W * 0.505, -wheelR - 11 * scale, 4 * scale, 6 * scale);
    if (isBraking) {
      const brk = ctx.createRadialGradient(-W * 0.51, -wheelR - 8 * scale, 1, -W * 0.51, -wheelR - 8 * scale, 16 * scale);
      brk.addColorStop(0, 'rgba(239, 68, 68, 0.42)');
      brk.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = brk;
      ctx.beginPath();
      ctx.arc(-W * 0.51, -wheelR - 8 * scale, 16 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    drawHeadlightBeam(W * 0.5, -wheelR - 8 * scale, 145 * scale, 36 * scale);

    drawSpokedWheel(-W * 0.28, -wheelR, wheelR, 7);
    drawSpokedWheel(W * 0.29, -wheelR, wheelR, 7);
  } else if (type === 'cng') {
    const W = 74 * scale;
    const H = 44 * scale;
    const wheelR = 8.2 * scale;
    const bodyCol = lerpRgb([14, 34, 24], bodyRgb ?? [22, 142, 74], amb);
    const hoodCol = lerpRgb([30, 34, 24], [224, 186, 46], amb);

    ctx.fillStyle = 'rgba(4, 6, 12, 0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, W * 0.48, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbCss(bodyCol);
    ctx.beginPath();
    ctx.moveTo(-W * 0.46, -wheelR * 0.6);
    ctx.lineTo(-W * 0.46, -H * 0.48);
    ctx.lineTo(W * 0.18, -H * 0.48);
    ctx.lineTo(W * 0.38, -H * 0.52);
    ctx.quadraticCurveTo(W * 0.5, -H * 0.26, W * 0.46, -wheelR * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgbCss(hoodCol);
    ctx.beginPath();
    ctx.moveTo(-W * 0.44, -H * 0.48);
    ctx.lineTo(-W * 0.36, -H - wheelR * 0.35);
    ctx.quadraticCurveTo(W * 0.08, -H - wheelR * 0.42, W * 0.3, -H * 0.88);
    ctx.lineTo(W * 0.41, -H * 0.48);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(18, 24, 32, 0.86)';
    ctx.beginPath();
    ctx.roundRect(-W * 0.33, -H + 1 * scale, W * 0.4, H * 0.45, 3 * scale);
    ctx.fill();
    ctx.strokeStyle = rgbCss(bodyCol);
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.moveTo(-W * 0.13, -H + 1 * scale);
    ctx.lineTo(-W * 0.13, -H * 0.48);
    ctx.stroke();

    ctx.fillStyle = lightGlow > 0.25 ? 'rgba(234, 206, 134, 0.28)' : 'rgba(148, 197, 232, 0.65)';
    ctx.beginPath();
    ctx.moveTo(W * 0.16, -H * 0.85);
    ctx.lineTo(W * 0.29, -H * 0.85);
    ctx.lineTo(W * 0.39, -H * 0.52);
    ctx.lineTo(W * 0.16, -H * 0.52);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = lightGlow > 0.16 ? 'rgba(244, 218, 134, 0.68)' : '#e2e8f0';
    ctx.beginPath();
    ctx.arc(W * 0.45, -wheelR - 8 * scale, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isBraking ? '#e11d48' : '#b91c1c';
    ctx.fillRect(-W * 0.47, -wheelR - 11 * scale, 3 * scale, 5 * scale);
    if (isBraking) {
      const brk = ctx.createRadialGradient(-W * 0.47, -wheelR - 8.5 * scale, 1, -W * 0.47, -wheelR - 8.5 * scale, 12 * scale);
      brk.addColorStop(0, 'rgba(239, 68, 68, 0.4)');
      brk.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = brk;
      ctx.beginPath();
      ctx.arc(-W * 0.47, -wheelR - 8.5 * scale, 12 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    drawHeadlightBeam(W * 0.46, -wheelR - 8 * scale, 95 * scale, 24 * scale);

    drawSpokedWheel(-W * 0.27, -wheelR, wheelR, 5);
    drawSpokedWheel(W * 0.3, -wheelR, wheelR, 5);
  } else if (type === 'sedan') {
    const W = 110 * scale;
    const H = 35 * scale;
    const wheelR = 9.2 * scale;
    const carCol = lerpRgb([24, 28, 36], bodyRgb ?? [148, 163, 184], amb);

    ctx.fillStyle = 'rgba(4, 6, 12, 0.52)';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, W * 0.5, 3.8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbCss(carCol);
    ctx.beginPath();
    ctx.moveTo(-W * 0.49, -wheelR * 0.55);
    ctx.lineTo(-W * 0.48, -H * 0.55);
    ctx.lineTo(-W * 0.34, -H * 0.62);
    ctx.lineTo(-W * 0.18, -H - wheelR * 0.25);
    ctx.lineTo(W * 0.12, -H - wheelR * 0.25);
    ctx.lineTo(W * 0.28, -H * 0.58);
    ctx.lineTo(W * 0.48, -H * 0.46);
    ctx.quadraticCurveTo(W * 0.52, -wheelR * 0.7, W * 0.48, -wheelR * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = lightGlow > 0.25 ? 'rgba(232, 200, 122, 0.22)' : 'rgba(56, 86, 118, 0.78)';
    ctx.beginPath();
    ctx.moveTo(-W * 0.25, -H * 0.6);
    ctx.lineTo(-W * 0.15, -H * 0.94);
    ctx.lineTo(W * 0.09, -H * 0.94);
    ctx.lineTo(W * 0.23, -H * 0.58);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.18 + dayWeight * 0.22).toFixed(2)})`;
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.moveTo(-W * 0.44, -H * 0.52);
    ctx.lineTo(W * 0.44, -H * 0.44);
    ctx.stroke();

    ctx.fillStyle = lightGlow > 0.16 ? 'rgba(244, 218, 134, 0.68)' : '#f1f5f9';
    ctx.fillRect(W * 0.45, -wheelR - 9 * scale, 4.5 * scale, 4 * scale);
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(-W * 0.49, -wheelR - 9.5 * scale, 4 * scale, 4.5 * scale);

    drawHeadlightBeam(W * 0.49, -wheelR - 7 * scale, 120 * scale, 26 * scale);

    drawSpokedWheel(-W * 0.28, -wheelR, wheelR, 5);
    drawSpokedWheel(W * 0.28, -wheelR, wheelR, 5);
  } else {
    const W = 68 * scale;
    const wheelR = 11.2 * scale;
    const hoodCol = lerpRgb([36, 18, 22], bodyRgb ?? [186, 36, 56], amb);
    const frameCol = lerpRgb([18, 32, 24], [22, 132, 86], amb);

    ctx.fillStyle = 'rgba(4, 6, 12, 0.42)';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, W * 0.48, 3.2 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    drawSpokedWheel(-W * 0.24, -wheelR, wheelR, 8);
    drawSpokedWheel(W * 0.34, -wheelR, wheelR * 0.94, 8);

    ctx.fillStyle = rgbCss(frameCol);
    ctx.beginPath();
    ctx.moveTo(-W * 0.42, -wheelR * 1.15);
    ctx.lineTo(-W * 0.04, -wheelR * 1.15);
    ctx.lineTo(-W * 0.12, -wheelR * 2.15);
    ctx.lineTo(-W * 0.44, -wheelR * 2.05);
    ctx.closePath();
    ctx.fill();

    if (hasPassenger) {
      // Visible seated passenger tucked beneath rickshaw hood!
      const pSkin = rgbCss(lerpRgb([48, 34, 26], [156, 108, 78], amb));
      const pCoat = rgbCss(lerpRgb([22, 28, 38], [218, 226, 238], amb));
      const pPan = rgbCss(lerpRgb([14, 18, 26], [28, 36, 52], amb));
      ctx.fillStyle = pCoat;
      ctx.beginPath();
      ctx.roundRect(-W * 0.28, -wheelR * 2.95, W * 0.16, wheelR * 0.95, 2.5 * scale);
      ctx.fill();
      ctx.fillStyle = pPan;
      ctx.fillRect(-W * 0.20, -wheelR * 2.05, W * 0.12, wheelR * 0.45);
      ctx.fillStyle = pSkin;
      ctx.beginPath();
      ctx.arc(-W * 0.18, -wheelR * 3.16, 3.3 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14171d';
      ctx.beginPath();
      ctx.arc(-W * 0.19, -wheelR * 3.24, 3.1 * scale, Math.PI * 0.7, Math.PI * 2.05);
      ctx.fill();
    }

    ctx.fillStyle = rgbCss(hoodCol);
    ctx.beginPath();
    ctx.moveTo(-W * 0.45, -wheelR * 2.0);
    ctx.quadraticCurveTo(-W * 0.48, -wheelR * 3.85, -W * 0.06, -wheelR * 3.65);
    ctx.lineTo(-W * 0.12, -wheelR * 2.0);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.8 * scale;
    ctx.beginPath();
    ctx.moveTo(-W * 0.06, -wheelR * 1.2);
    ctx.lineTo(W * 0.22, -wheelR * 1.45);
    ctx.lineTo(W * 0.34, -wheelR);
    ctx.moveTo(W * 0.22, -wheelR * 1.45);
    ctx.lineTo(W * 0.18, -wheelR * 2.5);
    ctx.stroke();

    const legCycle = Math.sin(wheelRot * 1.4) * 3.2 * scale;
    ctx.fillStyle = rgbCss(lerpRgb([18, 22, 28], [62, 114, 158], amb));
    ctx.beginPath();
    ctx.moveTo(W * 0.02, -wheelR * 2.2);
    ctx.lineTo(W * 0.15, -wheelR * 2.95);
    ctx.lineTo(W * 0.21, -wheelR * 2.8);
    ctx.lineTo(W * 0.1, -wheelR * 2.1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgbCss(lerpRgb([48, 34, 26], [156, 108, 78], amb));
    ctx.beginPath();
    ctx.arc(W * 0.19, -wheelR * 3.2, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(W * 0.14, -wheelR * 3.38, 6.2 * scale, 1.5 * scale);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2.6 * scale;
    ctx.beginPath();
    ctx.moveTo(W * 0.07, -wheelR * 2.15);
    ctx.lineTo(W * 0.11 + legCycle * 0.5, -wheelR * 1.55);
    ctx.lineTo(W * 0.08 + legCycle, -wheelR * 1.05);
    ctx.stroke();

    if (isBraking) {
      const brk = ctx.createRadialGradient(-W * 0.44, -wheelR * 1.4, 1, -W * 0.44, -wheelR * 1.4, 13 * scale);
      brk.addColorStop(0, 'rgba(255, 56, 56, 0.72)');
      brk.addColorStop(1, 'rgba(255, 56, 56, 0)');
      ctx.fillStyle = brk;
      ctx.beginPath();
      ctx.arc(-W * 0.44, -wheelR * 1.4, 13 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** 3D Dhaka City Corner Bus Stop Passenger Shelter (যাত্রী ছাউনি) */
export function drawBusStopShelter(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  amb: number,
  lightGlow: number
) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(scale, scale);

  // Concrete platform pad + shadow
  ctx.fillStyle = 'rgba(4, 6, 12, 0.34)';
  ctx.beginPath();
  ctx.ellipse(0, 1.5, 48, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  const steel = rgbCss(lerpRgb([18, 22, 30], [56, 74, 96], amb));
  const steelDark = rgbCss(lerpRgb([12, 16, 22], [38, 50, 68], amb));
  const roof = rgbCss(lerpRgb([16, 28, 42], [32, 92, 134], amb));
  const wallBack = rgbCss(lerpRgb([14, 18, 26], [84, 96, 114], amb));

  // Back glass/metal panel with 3D side return
  ctx.fillStyle = wallBack;
  ctx.fillRect(-38, -42, 76, 39);
  ctx.fillStyle = steelDark;
  ctx.beginPath();
  ctx.moveTo(38, -42);
  ctx.lineTo(48, -46);
  ctx.lineTo(48, -6);
  ctx.lineTo(38, -3);
  ctx.closePath();
  ctx.fill();

  // Blue municipal route signboard & steel bench inside shelter
  ctx.fillStyle = roof;
  ctx.fillRect(-34, -37, 68, 8);
  ctx.fillStyle = steel;
  ctx.fillRect(-26, -12, 52, 3);
  ctx.fillRect(-22, -9, 3, 9);
  ctx.fillRect(19, -9, 3, 9);

  // Slanted 3D steel canopy roof & pillars
  ctx.strokeStyle = steel;
  ctx.lineWidth = 3.0;
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.lineTo(-38, -45);
  ctx.moveTo(38, 0);
  ctx.lineTo(38, -45);
  ctx.stroke();

  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(-44, -42);
  ctx.lineTo(44, -42);
  ctx.lineTo(52, -49);
  ctx.lineTo(-36, -49);
  ctx.closePath();
  ctx.fill();

  // Pole sign on corner
  ctx.strokeStyle = steel;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-43, 0);
  ctx.lineTo(-43, -58);
  ctx.stroke();
  ctx.fillStyle = rgbCss(lerpRgb([16, 36, 62], [37, 99, 235], amb));
  ctx.fillRect(-49, -63, 12, 10);

  if (lightGlow > 0.14) {
    const g = ctx.createRadialGradient(0, -40, 1, 0, -40, 26);
    g.addColorStop(0, `rgba(242, 206, 128, ${(0.28 * lightGlow).toFixed(2)})`);
    g.addColorStop(1, 'rgba(234, 179, 56, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -40, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface BoatRenderOptions {
  type: 'paltola' | 'chhoi';
  x: number;
  y: number;
  facing: 1 | -1;
  scale: number;
  wavePitch: number;
  oarPhase: number;
  windFactor: number;
  windSign: number;
  sailRgb: RGB;
  dayWeight: number;
  lightGlow: number;
  hasLantern: boolean;
  sunlightFactor: number;
  isMoored?: boolean;
}

export function drawRealisticBoat(ctx: CanvasRenderingContext2D, opts: BoatRenderOptions) {
  const {
    type,
    x,
    y,
    facing,
    scale,
    wavePitch,
    oarPhase,
    windFactor,
    windSign,
    sailRgb,
    dayWeight,
    lightGlow,
    hasLantern,
    sunlightFactor,
    isMoored = false,
  } = opts;

  const amb = 0.25 + dayWeight * 0.75;
  const hullW = 98 * scale;
  const hullCol = rgbCss(lerpRgb([14, 10, 8], [58, 38, 26], amb));
  const hullInner = rgbCss(lerpRgb([8, 6, 4], [36, 22, 14], amb));
  const gunwaleRim = rgbCss(lerpRgb([24, 18, 14], [96, 68, 44], amb));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wavePitch * (isMoored ? 0.032 : 0.065));
  ctx.scale(facing, 1);

  // Subtle water reflection + bow/stern ripple lines
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = hullCol;
  ctx.beginPath();
  ctx.ellipse(0, 7 * scale, hullW * 0.46, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inner boat deck (3D hollow interior depth)
  ctx.fillStyle = hullInner;
  ctx.beginPath();
  ctx.moveTo(-hullW * 0.48, -6 * scale);
  ctx.quadraticCurveTo(0, -11 * scale, hullW * 0.49, -7 * scale);
  ctx.quadraticCurveTo(0, 1 * scale, -hullW * 0.48, -6 * scale);
  ctx.closePath();
  ctx.fill();

  // Outer sculpted wooden plank hull
  ctx.fillStyle = hullCol;
  ctx.beginPath();
  ctx.moveTo(-hullW * 0.56, -9 * scale);
  ctx.quadraticCurveTo(-hullW * 0.28, 9 * scale, 0, 8 * scale);
  ctx.quadraticCurveTo(hullW * 0.28, 9 * scale, hullW * 0.58, -11 * scale);
  ctx.quadraticCurveTo(hullW * 0.25, -1.5 * scale, 0, -2.5 * scale);
  ctx.quadraticCurveTo(-hullW * 0.25, -1.5 * scale, -hullW * 0.56, -9 * scale);
  ctx.closePath();
  ctx.fill();

  // Lit wooden gunwale edge + plank strake line
  ctx.strokeStyle = gunwaleRim;
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.moveTo(-hullW * 0.52, -7.5 * scale);
  ctx.quadraticCurveTo(0, -1.5 * scale, hullW * 0.54, -9.5 * scale);
  ctx.stroke();

  if (type === 'paltola' && !isMoored) {
    const mastH = 62 * scale;
    const belly = (8 + windFactor * 9) * scale * (windSign * facing >= 0 ? 1 : 0.45);
    ctx.strokeStyle = rgbCss(lerpRgb([24, 18, 12], [96, 72, 48], amb));
    ctx.lineWidth = 2.0 * scale;
    ctx.beginPath();
    ctx.moveTo(2 * scale, -2 * scale);
    ctx.lineTo(0, -mastH);
    ctx.stroke();

    const sCol = lerpRgb([38, 34, 30], sailRgb, 0.25 + amb * 0.75);
    ctx.fillStyle = rgbCss(sCol, 0.96);
    ctx.beginPath();
    ctx.moveTo(-14 * scale, -mastH * 0.92);
    ctx.quadraticCurveTo(2 * scale, -mastH * 0.98, 22 * scale, -mastH * 0.86);
    ctx.quadraticCurveTo(22 * scale + belly, -mastH * 0.45, 16 * scale, -mastH * 0.14);
    ctx.quadraticCurveTo(0, -mastH * 0.2, -16 * scale, -mastH * 0.18);
    ctx.quadraticCurveTo(-15 * scale + belly * 0.4, -mastH * 0.52, -14 * scale, -mastH * 0.92);
    ctx.closePath();
    ctx.fill();

    if (sunlightFactor > 0.15) {
      ctx.strokeStyle = `rgba(255, 244, 214, ${(0.35 * sunlightFactor).toFixed(2)})`;
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();
    }
  } else {
    // 3D Curved Bamboo/Straw Chhoi (ছই) canopy with arched rib bands & dark inner mouth
    const chhoiOuter = lerpRgb([24, 18, 12], [142, 108, 68], amb);
    const chhoiSide = lerpRgb([14, 10, 8], [96, 72, 44], amb);
    ctx.fillStyle = chhoiSide ? rgbCss(chhoiOuter) : '#6b4f32';
    ctx.beginPath();
    ctx.moveTo(-hullW * 0.24, -2 * scale);
    ctx.quadraticCurveTo(0, -27 * scale, hullW * 0.24, -2 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgbCss(chhoiSide, 0.65);
    ctx.lineWidth = 1.1 * scale;
    for (let rb = -2; rb <= 2; rb++) {
      ctx.beginPath();
      ctx.moveTo(rb * hullW * 0.08, -2 * scale);
      ctx.quadraticCurveTo(rb * hullW * 0.08, -22 * scale, rb * hullW * 0.06, -18 * scale);
      ctx.stroke();
    }

    // Warm glowing interior under the chhoi arch when moored for the night (মাঝি নৌকায় ঘুমাচ্ছে)
    if (isMoored && lightGlow > 0.1) {
      ctx.fillStyle = `rgba(234, 180, 86, ${(0.18 * lightGlow).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(hullW * 0.04, -7 * scale, hullW * 0.09, 6 * scale, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  // Two-armed Articulated Boatman rowing clearly ABOVE gunwale with visible elbows, wrists, hands & oar splash!
  if (!isMoored) {
    const oarDip = Math.sin(oarPhase);
    const oarCos = Math.cos(oarPhase);
    const bx = -hullW * 0.27;
    const torsoLean = oarDip * 2.2 * scale;
    const shY = -17.5 * scale;
    const oarTopX = bx - 5.5 * scale + oarDip * 5.2 * scale;
    const oarTopY = -19.5 * scale + oarCos * 2.4 * scale;
    const oarPivotX = bx - 10 * scale + oarDip * 1.4 * scale;
    const oarPivotY = -6 * scale;
    const oarBladeX = bx - 22 * scale - oarDip * 7.5 * scale;
    const oarBladeY = 10.5 * scale + oarCos * 3.8 * scale;
    const skinCss = rgbCss(lerpRgb([62, 42, 30], [166, 116, 82], amb));
    const shirtCss = rgbCss(lerpRgb([34, 42, 54], [216, 222, 228], amb));

    // Far arm (shoulder -> bent elbow -> hand gripping lower oar handle)
    const farElbX = bx + 4.5 * scale + torsoLean * 0.5;
    const farElbY = shY + 3.2 * scale;
    ctx.strokeStyle = rgbCss(lerpRgb([48, 32, 22], [134, 92, 64], amb));
    ctx.lineWidth = 2.4 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + 2.5 * scale + torsoLean, shY);
    ctx.lineTo(farElbX, farElbY);
    ctx.lineTo(oarTopX - 1.5 * scale, oarTopY + 3.2 * scale);
    ctx.stroke();

    // High-contrast light cotton shirt torso + red checkered gamcha + neck & head
    ctx.fillStyle = shirtCss;
    ctx.beginPath();
    ctx.moveTo(bx - 5.2 * scale, -2.5 * scale);
    ctx.lineTo(bx - 4.2 * scale + torsoLean, shY - 1 * scale);
    ctx.lineTo(bx + 4.4 * scale + torsoLean, shY);
    ctx.lineTo(bx + 3.8 * scale, -2.5 * scale);
    ctx.closePath();
    ctx.fill();

    // Red-white checkered gamosa draped cleanly across shoulder
    ctx.fillStyle = rgbCss(lerpRgb([46, 14, 14], [198, 42, 46], amb));
    ctx.beginPath();
    ctx.moveTo(bx - 1.5 * scale + torsoLean, shY - 0.5 * scale);
    ctx.lineTo(bx + 3.6 * scale + torsoLean, shY + 0.5 * scale);
    ctx.lineTo(bx + 2.4 * scale, shY + 6.5 * scale);
    ctx.lineTo(bx - 2.2 * scale, shY + 5.5 * scale);
    ctx.closePath();
    ctx.fill();

    // Neck + sculpted side-profile head + forehead gamcha headband
    ctx.fillStyle = skinCss;
    ctx.fillRect(bx - 0.4 * scale + torsoLean, shY - 3.6 * scale, 2.2 * scale, 3 * scale);
    ctx.beginPath();
    ctx.arc(bx + 0.8 * scale + torsoLean, shY - 5.2 * scale, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14171d';
    ctx.beginPath();
    ctx.arc(bx + 0.2 * scale + torsoLean, shY - 6.0 * scale, 3.1 * scale, Math.PI * 0.78, Math.PI * 2.02);
    ctx.fill();
    ctx.fillStyle = rgbCss(lerpRgb([46, 14, 14], [212, 52, 56], amb));
    ctx.fillRect(bx - 2.2 * scale + torsoLean, shY - 6.8 * scale, 6.2 * scale, 1.3 * scale);

    // Sculpted Wooden Oar Shaft + Broad Tapered Paddle Blade dipping water
    ctx.strokeStyle = '#6b4730';
    ctx.lineWidth = 2.0 * scale;
    ctx.beginPath();
    ctx.moveTo(oarTopX + 2 * scale, oarTopY - 2.2 * scale);
    ctx.lineTo(oarPivotX, oarPivotY);
    ctx.lineTo(oarBladeX, oarBladeY);
    ctx.stroke();

    ctx.fillStyle = '#533522';
    ctx.beginPath();
    ctx.ellipse(oarBladeX - 1.2 * scale, oarBladeY + 1.5 * scale, 4.4 * scale, 1.7 * scale, Math.atan2(oarBladeY - oarPivotY, oarBladeX - oarPivotX), 0, Math.PI * 2);
    ctx.fill();

    // Crisp splash ring around oar blade when pulling deep in water (`oarCos > 0.1`)
    if (oarCos > 0.05) {
      ctx.strokeStyle = `rgba(232, 246, 255, ${(0.55 * oarCos).toFixed(2)})`;
      ctx.lineWidth = 1.1 * scale;
      ctx.beginPath();
      ctx.ellipse(oarBladeX, oarBladeY + 1 * scale, (6 + oarCos * 6) * scale, (1.8 + oarCos * 1.4) * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Near arm clearly articulated (shoulder -> forward/down elbow -> gripping hand on top of oar handle!)
    const nearElbX = bx - 3.6 * scale + oarDip * 2.4 * scale;
    const nearElbY = shY + 4.4 * scale;
    ctx.strokeStyle = skinCss;
    ctx.lineWidth = 2.6 * scale;
    ctx.beginPath();
    ctx.moveTo(bx - 1.5 * scale + torsoLean, shY + 1.2 * scale);
    ctx.lineTo(nearElbX, nearElbY);
    ctx.lineTo(oarTopX + 0.6 * scale, oarTopY);
    ctx.stroke();

    // Visible gripping fists around wooden oar shaft
    ctx.fillStyle = skinCss;
    ctx.beginPath();
    ctx.arc(oarTopX + 0.6 * scale, oarTopY, 1.45 * scale, 0, Math.PI * 2);
    ctx.arc(oarTopX - 1.5 * scale, oarTopY + 3.2 * scale, 1.35 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hasLantern && lightGlow > 0.08) {
    const flicker = 0.91 + 0.09 * Math.sin(oarPhase * 3.1 + x * 0.04);
    const gIntensity = clamp01(lightGlow * 1.15) * flicker;
    const lx = isMoored ? hullW * 0.07 : hullW * 0.34;
    const ly = isMoored ? -10.5 * scale : -13.5 * scale;

    // Slender wooden lantern post at bow when boat is underway
    if (!isMoored) {
      ctx.strokeStyle = rgbCss(lerpRgb([22, 16, 12], [92, 66, 42], amb));
      ctx.lineWidth = Math.max(1.1, 1.5 * scale);
      ctx.beginPath();
      ctx.moveTo(lx - 1.5 * scale, -5 * scale);
      ctx.lineTo(lx - 1.5 * scale, ly - 3 * scale);
      ctx.lineTo(lx + 0.5 * scale, ly - 3 * scale);
      ctx.stroke();
    }

    // Wide warm hariken atmospheric aura
    const gR = (isMoored ? 44 : 38) * scale;
    const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, gR);
    lg.addColorStop(0, `rgba(255, 232, 156, ${(0.82 * gIntensity).toFixed(2)})`);
    lg.addColorStop(0.28, `rgba(248, 178, 62, ${(0.42 * gIntensity).toFixed(2)})`);
    lg.addColorStop(0.65, `rgba(232, 122, 32, ${(0.14 * gIntensity).toFixed(2)})`);
    lg.addColorStop(1, 'rgba(232, 115, 28, 0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(lx, ly, gR, 0, Math.PI * 2);
    ctx.fill();

    // Physical hariken lantern silhouette: iron cap, wire bail, glowing amber glass, flame core
    const hs = Math.max(0.75, scale);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 0.9 * hs;
    ctx.beginPath();
    ctx.arc(lx, ly - 2.6 * hs, 1.5 * hs, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#292524';
    ctx.fillRect(lx - 1.7 * hs, ly - 2.3 * hs, 3.4 * hs, 1.0 * hs);
    ctx.fillRect(lx - 1.9 * hs, ly + 1.8 * hs, 3.8 * hs, 1.0 * hs);
    ctx.fillStyle = `rgba(253, 210, 96, ${(0.72 + 0.28 * gIntensity).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 1.7 * hs, 2.2 * hs, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 250, 224, ${(0.85 * gIntensity).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(lx, ly, 0.95 * hs, 0, Math.PI * 2);
    ctx.fill();

    // Warm golden reflection ripples shimmering across dark water below the lantern
    for (let r = 0; r < 5; r++) {
      const rw = (11 - r * 1.6) * scale;
      const rAlpha = (0.44 - r * 0.065) * gIntensity;
      ctx.fillStyle = `rgba(251, 192, 76, ${Math.max(0.06, rAlpha).toFixed(2)})`;
      ctx.fillRect(lx - rw * 0.5 + Math.sin(oarPhase * 1.4 + r * 1.3) * 2.5, 7 * scale + r * 3.8 * scale, rw, 1.6 * scale);
    }
  }

  ctx.restore();
}

/**
 * True 3D oblique-extruded Bengali Rural Homestead Compound:
 * Front wall + shaded side perspective wall + concrete/mud plinth + clear door & shuttered windows +
 * 3D douchala corrugated tin roofs + front bamboo-pillar veranda + evening hurricane lamp & resting family.
 */
export function draw3DBengaliHomesteadCompound(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  scale: number,
  tSec: number,
  params: {
    dayWeight: number;
    twilight: number;
    fogWeight: number;
    sunlightFactor: number;
    effectiveMoonVis: number;
    windFactor: number;
    windSign: number;
    stormWeight: number;
    rainWeight: number;
    hasEveningVerandaFamily: boolean;
    sleepQuietNight: boolean;
  }
) {
  const {
    dayWeight,
    twilight,
    fogWeight,
    sunlightFactor,
    effectiveMoonVis,
    windFactor,
    windSign,
    stormWeight,
    hasEveningVerandaFamily,
    sleepQuietNight,
  } = params;

  const amb = 0.22 + dayWeight * 0.78 * (1 - fogWeight * 0.3);
  const w = 178 * scale;
  const hWall = 62 * scale;
  const depthX = 34 * scale;
  const depthY = -12 * scale;

  ctx.save();

  // Soft elliptical contact shadow
  ctx.fillStyle = `rgba(6, 10, 18, ${(0.28 + sunlightFactor * 0.22).toFixed(2)})`;
  ctx.beginPath();
  ctx.ellipse(hx + 12 * scale, hy + 5 * scale, w * 0.72, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const plinthFront = rgbCss(lerpRgb([18, 14, 12], [116, 86, 62], amb));
  const plinthSide = rgbCss(lerpRgb([12, 10, 8], [82, 58, 42], amb));
  const wallFront = rgbCss(lerpRgb([24, 22, 24], [198, 174, 146], amb));
  const wallSide = rgbCss(lerpRgb([16, 15, 18], [142, 120, 96], amb));
  const woodDark = rgbCss(lerpRgb([12, 8, 6], [68, 44, 26], amb));
  const frameWood = rgbCss(lerpRgb([18, 12, 8], [108, 72, 42], amb));

  // Raised 3D earthen plinth (ভিটা) + front steps
  const px0 = hx - w * 0.56;
  const px1 = hx + w * 0.42;
  ctx.fillStyle = plinthFront;
  ctx.fillRect(px0, hy - 9 * scale, px1 - px0, 12 * scale);
  ctx.fillStyle = plinthSide;
  ctx.beginPath();
  ctx.moveTo(px1, hy - 9 * scale);
  ctx.lineTo(px1 + depthX, hy - 9 * scale + depthY);
  ctx.lineTo(px1 + depthX, hy + 3 * scale + depthY);
  ctx.lineTo(px1, hy + 3 * scale);
  ctx.closePath();
  ctx.fill();
  // Veranda steps
  ctx.fillStyle = plinthFront;
  ctx.fillRect(hx - w * 0.14, hy + 1 * scale, 28 * scale, 5 * scale);

  // Main House 3D Box (Front + Oblique Right Gable Side Wall)
  const mx0 = hx - w * 0.5;
  const mx1 = hx + w * 0.12;
  const wallTopY = hy - hWall;
  ctx.fillStyle = wallFront;
  ctx.fillRect(mx0, wallTopY, mx1 - mx0, hWall - 8 * scale);

  // Shaded 3D right side gable wall
  ctx.fillStyle = wallSide;
  ctx.beginPath();
  ctx.moveTo(mx1, wallTopY);
  ctx.lineTo(mx1 + depthX * 0.5, wallTopY - 22 * scale + depthY * 0.4);
  ctx.lineTo(mx1 + depthX, wallTopY + depthY);
  ctx.lineTo(mx1 + depthX, hy - 8 * scale + depthY);
  ctx.lineTo(mx1, hy - 8 * scale);
  ctx.closePath();
  ctx.fill();

  // Side wall shuttered window in 3D perspective
  const swX = mx1 + depthX * 0.34;
  const swY = hy - hWall * 0.64 + depthY * 0.34;
  ctx.fillStyle = sleepQuietNight
    ? 'rgba(18, 18, 22, 0.92)'
    : hasEveningVerandaFamily || dayWeight < 0.45
      ? 'rgba(232, 178, 86, 0.30)'
      : '#261a14';
  ctx.beginPath();
  ctx.moveTo(swX, swY);
  ctx.lineTo(swX + 12 * scale, swY - 4 * scale);
  ctx.lineTo(swX + 12 * scale, swY + 13 * scale);
  ctx.lineTo(swX, swY + 17 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = frameWood;
  ctx.lineWidth = 1.4 * scale;
  ctx.stroke();

  // Front recessed Veranda Alcove (বারান্দা)
  const verX = hx - w * 0.44;
  const verW = w * 0.52;
  ctx.fillStyle = rgbCss(lerpRgb([10, 10, 14], [112, 88, 66], amb));
  ctx.fillRect(verX, wallTopY + 14 * scale, verW, hWall - 22 * scale);

  // Clear paneled Main Door + Shuttered Front Windows inside veranda
  const doorX = hx - w * 0.34;
  const doorY = hy - 40 * scale;
  ctx.fillStyle = woodDark;
  ctx.fillRect(doorX, doorY, 17 * scale, 32 * scale);
  ctx.strokeStyle = frameWood;
  ctx.lineWidth = 1.8 * scale;
  ctx.strokeRect(doorX, doorY, 17 * scale, 32 * scale);
  // Door center seam & latch
  ctx.beginPath();
  ctx.moveTo(doorX + 8.5 * scale, doorY);
  ctx.lineTo(doorX + 8.5 * scale, doorY + 32 * scale);
  ctx.stroke();

  // Two clear front windows with wooden shutters & gentle soft interior warmth
  const winGlowAlpha = sleepQuietNight ? 0.06 : clamp01((1 - dayWeight) * 0.85 + twilight * 0.42);
  [-0.08, -0.42].forEach((wxRatio) => {
    const wx = hx + w * wxRatio;
    const wy = hy - 36 * scale;
    ctx.fillStyle =
      winGlowAlpha > 0.14
        ? `rgba(238, 188, 96, ${(0.11 + winGlowAlpha * 0.30).toFixed(2)})`
        : '#1e1612';
    ctx.fillRect(wx, wy, 14 * scale, 16 * scale);
    ctx.strokeStyle = frameWood;
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeRect(wx, wy, 14 * scale, 16 * scale);
    // Open side shutter panels + vertical window grille bars
    ctx.fillStyle = frameWood;
    ctx.fillRect(wx - 4 * scale, wy, 4 * scale, 16 * scale);
    ctx.fillRect(wx + 14 * scale, wy, 4 * scale, 16 * scale);
    ctx.beginPath();
    ctx.moveTo(wx + 4.5 * scale, wy);
    ctx.lineTo(wx + 4.5 * scale, wy + 16 * scale);
    ctx.moveTo(wx + 9.5 * scale, wy);
    ctx.lineTo(wx + 9.5 * scale, wy + 16 * scale);
    ctx.stroke();
  });

  // Bamboo veranda bench (মাচা) & pillars
  ctx.fillStyle = frameWood;
  ctx.fillRect(hx - w * 0.16, hy - 14 * scale, 36 * scale, 4 * scale);
  ctx.fillRect(hx - w * 0.14, hy - 10 * scale, 3 * scale, 4 * scale);
  ctx.fillRect(hx + w * 0.02, hy - 10 * scale, 3 * scale, 4 * scale);

  // Evening (সন্ধ্যা) villagers resting & chatting organically on the veranda next to glowing হারিকেন lamp
  if (hasEveningVerandaFamily && !sleepQuietNight) {
    const vSkin = rgbCss(lerpRgb([56, 38, 28], [166, 114, 82], 0.45 + amb * 0.55));
    const vTalk = Math.sin(tSec * 2.1) * 1.8 * scale;

    // Person 1 (woman in warm red-border saree seated gently leaning left)
    ctx.fillStyle = rgbCss(lerpRgb([30, 18, 18], [186, 48, 56], 0.45 + amb * 0.55));
    ctx.beginPath();
    ctx.ellipse(hx - w * 0.095, hy - 14.5 * scale, 5.2 * scale, 2.8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx - w * 0.125, hy - 15 * scale);
    ctx.quadraticCurveTo(hx - w * 0.095, hy - 26.5 * scale, hx - w * 0.068, hy - 25.5 * scale);
    ctx.lineTo(hx - w * 0.065, hy - 15 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = vSkin;
    ctx.beginPath();
    ctx.arc(hx - w * 0.095, hy - 28.5 * scale, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14171d';
    ctx.beginPath();
    ctx.arc(hx - w * 0.105, hy - 29 * scale, 3.0 * scale, Math.PI * 0.7, Math.PI * 2.1);
    ctx.fill();

    // Person 2 (man sitting facing partner, gesturing softly while chatting)
    ctx.fillStyle = rgbCss(lerpRgb([14, 20, 28], [44, 72, 98], 0.45 + amb * 0.55));
    ctx.beginPath();
    ctx.ellipse(hx + w * 0.005, hy - 14.5 * scale, 5.4 * scale, 2.8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgbCss(lerpRgb([24, 28, 36], [230, 232, 236], 0.45 + amb * 0.55));
    ctx.beginPath();
    ctx.moveTo(hx - w * 0.015, hy - 15 * scale);
    ctx.quadraticCurveTo(hx + w * 0.015, hy - 27.5 * scale, hx + w * 0.04, hy - 26 * scale);
    ctx.lineTo(hx + w * 0.042, hy - 15 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = vSkin;
    ctx.beginPath();
    ctx.arc(hx + w * 0.012, hy - 29.8 * scale, 3.4 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14171d';
    ctx.beginPath();
    ctx.arc(hx + w * 0.018, hy - 30.6 * scale, 3.2 * scale, Math.PI * 0.85, Math.PI * 2.05);
    ctx.fill();
    ctx.strokeStyle = vSkin;
    ctx.lineWidth = 1.9 * scale;
    ctx.beginPath();
    ctx.moveTo(hx + w * 0.004, hy - 22 * scale);
    ctx.lineTo(hx - w * 0.032, hy - 21 * scale + vTalk);
    ctx.stroke();

    // Soft Hurricane Oil Lantern (হারিকেন) hanging/resting on veranda post (>=50% gentler glow)
    const lX = hx - w * 0.2;
    const lY = hy - 22 * scale;
    const lg = ctx.createRadialGradient(lX, lY, 1.5, lX, lY, 30 * scale);
    lg.addColorStop(0, 'rgba(245, 212, 132, 0.38)');
    lg.addColorStop(0.32, 'rgba(232, 146, 52, 0.16)');
    lg.addColorStop(1, 'rgba(232, 115, 22, 0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(lX, lY, 30 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(244, 210, 118, 0.72)';
    ctx.beginPath();
    ctx.arc(lX, lY, 2.0 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Front wooden veranda columns supporting the roof eave
  ctx.strokeStyle = frameWood;
  ctx.lineWidth = 2.6 * scale;
  [-0.45, -0.22, -0.02, 0.11].forEach((px) => {
    ctx.beginPath();
    ctx.moveTo(hx + w * px, wallTopY + 11 * scale);
    ctx.lineTo(hx + w * px, hy - 7 * scale);
    ctx.stroke();
  });

  // Adjacent Kitchen Hut (পাশের রান্নাঘর) in 3D behind-right
  const kx0 = hx + w * 0.15;
  const kx1 = hx + w * 0.45;
  const kh = hWall * 0.72;
  ctx.fillStyle = wallFront;
  ctx.fillRect(kx0, hy - kh, kx1 - kx0, kh - 8 * scale);
  ctx.fillStyle = wallSide;
  ctx.beginPath();
  ctx.moveTo(kx1, hy - kh);
  ctx.lineTo(kx1 + depthX * 0.75, hy - kh + depthY * 0.75);
  ctx.lineTo(kx1 + depthX * 0.75, hy - 8 * scale + depthY * 0.75);
  ctx.lineTo(kx1, hy - 8 * scale);
  ctx.closePath();
  ctx.fill();
  // Kitchen door
  ctx.fillStyle = woodDark;
  ctx.fillRect(kx0 + 10 * scale, hy - 32 * scale, 12 * scale, 24 * scale);

  // 3D Corrugated Tin Roofs (দোচালা টিনের চাল) with sunlit ridge + dark shaded side slope
  const roofLit = rgbCss(lerpRgb([18, 22, 30], [122, 136, 150], amb));
  const roofShade = rgbCss(lerpRgb([10, 14, 20], [74, 86, 100], amb));
  const ridgeTopX = hx - w * 0.18;
  const ridgeTopY = wallTopY - 34 * scale;

  // Main House Roof Right 3D Slope (darker back/side pitch)
  ctx.fillStyle = roofShade;
  ctx.beginPath();
  ctx.moveTo(ridgeTopX, ridgeTopY);
  ctx.lineTo(ridgeTopX + depthX * 0.88, ridgeTopY + depthY * 0.8);
  ctx.lineTo(mx1 + depthX * 1.06, wallTopY + 6 * scale + depthY * 0.88);
  ctx.lineTo(mx1 + 8 * scale, wallTopY + 12 * scale);
  ctx.closePath();
  ctx.fill();

  // Main House Front Tin Slope
  ctx.fillStyle = roofLit;
  ctx.beginPath();
  ctx.moveTo(mx0 - 10 * scale, wallTopY + 12 * scale);
  ctx.lineTo(ridgeTopX - 18 * scale, ridgeTopY);
  ctx.lineTo(ridgeTopX + 2 * scale, ridgeTopY);
  ctx.lineTo(mx1 + 8 * scale, wallTopY + 12 * scale);
  ctx.closePath();
  ctx.fill();

  // Kitchen Hut 3D Tin Roof
  ctx.fillStyle = roofShade;
  ctx.beginPath();
  ctx.moveTo(kx0 + 18 * scale, hy - kh - 22 * scale);
  ctx.lineTo(kx0 + 18 * scale + depthX * 0.65, hy - kh - 22 * scale + depthY * 0.6);
  ctx.lineTo(kx1 + depthX * 0.85, hy - kh + 5 * scale + depthY * 0.68);
  ctx.lineTo(kx1 + 6 * scale, hy - kh + 7 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = roofLit;
  ctx.beginPath();
  ctx.moveTo(kx0 - 6 * scale, hy - kh + 7 * scale);
  ctx.lineTo(kx0 + 10 * scale, hy - kh - 22 * scale);
  ctx.lineTo(kx0 + 20 * scale, hy - kh - 22 * scale);
  ctx.lineTo(kx1 + 6 * scale, hy - kh + 7 * scale);
  ctx.closePath();
  ctx.fill();

  // Metallic corrugated sheen ribs on front slope
  const ribA = 0.14 + sunlightFactor * 0.34 + effectiveMoonVis * 0.24;
  ctx.strokeStyle = `rgba(226, 238, 250, ${clamp01(ribA).toFixed(2)})`;
  ctx.lineWidth = 1.0 * scale;
  for (let ri = -3; ri <= 4; ri++) {
    const rx = ridgeTopX + ri * (w * 0.068);
    ctx.beginPath();
    ctx.moveTo(rx - 4 * scale, ridgeTopY + 3 * scale);
    ctx.lineTo(rx - 10 * scale, wallTopY + 10 * scale);
    ctx.stroke();
  }

  // Subtle shadow beneath overhanging tin roof eave & terracotta water pitcher (কলসি) on steps
  ctx.fillStyle = 'rgba(10, 8, 8, 0.24)';
  ctx.fillRect(mx0, wallTopY, mx1 - mx0, 7 * scale);
  // Clay water pitcher (কলসি) beside veranda steps
  ctx.fillStyle = rgbCss(lerpRgb([36, 18, 12], [156, 78, 46], amb));
  ctx.beginPath();
  ctx.ellipse(hx + w * 0.08, hy - 2 * scale, 5.2 * scale, 6.2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(hx + w * 0.08 - 2.4 * scale, hy - 9 * scale, 4.8 * scale, 2.5 * scale);

  // Adjacent bamboo courtyard fence (বাঁশের বেড়া) extending slightly to left
  ctx.strokeStyle = frameWood;
  ctx.lineWidth = 1.6 * scale;
  for (let fi = 0; fi < 4; fi++) {
    const fx = px0 - (4 + fi * 9) * scale;
    ctx.beginPath();
    ctx.moveTo(fx, hy + 2 * scale);
    ctx.lineTo(fx, hy - 20 * scale);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(px0 - 34 * scale, hy - 7 * scale);
  ctx.lineTo(px0, hy - 7 * scale);
  ctx.moveTo(px0 - 34 * scale, hy - 15 * scale);
  ctx.lineTo(px0, hy - 15 * scale);
  ctx.stroke();

  // Hearth cooking smoke rising from kitchen (day / early evening only)
  if (stormWeight < 0.7 && dayWeight > 0.1 && !sleepQuietNight) {
    const sAlpha = (1 - stormWeight * 0.7) * 0.16;
    for (let si = 0; si < 5; si++) {
      const drift = windSign * (10 + windFactor * 36) * ((si + 1) / 5);
      const sx = kx0 + 26 * scale + drift + Math.sin(tSec * 1.1 + si) * 5;
      const sy = hy - kh - 24 * scale - si * 14 * scale - ((tSec * 14 + si * 12) % 22);
      ctx.fillStyle = `rgba(226, 232, 240, ${(sAlpha * (1 - si / 5)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, (5.5 + si * 3.4) * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * True 3D oblique-extruded Urban Building for Dhaka City & Rooftop skyline
 * with distinct lit front facade, shaded side face, rooftop parapet, water tank, & glowing recessed windows.
 */
export function draw3DCityBuilding(
  ctx: CanvasRenderingContext2D,
  bx: number,
  baseY: number,
  bw: number,
  bh: number,
  sideDepth: number,
  seedIdx: number,
  amb: number,
  lightGlow: number,
  tintFront: RGB,
  tintSide: RGB
) {
  ctx.save();
  const style = Math.abs(seedIdx) % 6;
  const subSeed = Math.abs(seedIdx * 13 + 7);
  const sideRise = -sideDepth * 0.34;
  const topY = baseY - bh;

  // Distinct modern architectural palettes blended gently with scene tintFront/tintSide
  const styleFrontPalettes: RGB[] = [
    [68, 94, 118],  // 0: Cool architectural glass & steel
    [136, 126, 114], // 1: Warm sandstone terraced apartment
    [118, 92, 82],  // 2: Modern terracotta-concrete commercial
    [82, 92, 108],  // 3: Chamfered urban slate loft
    [126, 112, 94], // 4: Contemporary brick & cream limestone
    [86, 104, 102], // 5: Sage-grey bay-window residence
  ];
  const baseFrontTint = lerpRgb(tintFront, styleFrontPalettes[style], 0.56);
  const baseSideTint = lerpRgb(tintSide, lerpRgb(styleFrontPalettes[style], [18, 24, 34], 0.42), 0.56);

  const frontTopCol = rgbCss(lerpRgb([14, 18, 28], lerpRgb(baseFrontTint, [240, 244, 250], 0.12), amb));
  const frontBotCol = rgbCss(lerpRgb([10, 14, 22], lerpRgb(baseFrontTint, [22, 26, 36], 0.16), amb));
  const sideCol = rgbCss(lerpRgb([8, 10, 18], baseSideTint, amb));
  const trimCol = rgbCss(lerpRgb([22, 26, 36], lerpRgb(baseFrontTint, [235, 240, 245], 0.28), amb));
  const darkFrameCol = rgbCss(lerpRgb([6, 8, 14], [34, 40, 52], amb));

  const frontGrad = ctx.createLinearGradient(bx, topY, bx, baseY);
  frontGrad.addColorStop(0, frontTopCol);
  frontGrad.addColorStop(1, frontBotCol);

  // Helper to draw side 3D oblique wall cleanly for arbitrary roof step/slant
  const drawSideWall = (xEdge: number, yTop: number, depth: number, yBot: number, topSlopeOffset = 0) => {
    ctx.fillStyle = sideCol;
    ctx.beginPath();
    ctx.moveTo(xEdge, yTop);
    ctx.lineTo(xEdge + depth, yTop + sideRise + topSlopeOffset);
    ctx.lineTo(xEdge + depth, yBot + sideRise * 0.25);
    ctx.lineTo(xEdge, yBot);
    ctx.closePath();
    ctx.fill();
  };

  if (style === 0) {
    // 0: Modern Glass Curtain-Wall Mid-Rise with subtle diagonal sky sheen & pergola crown
    ctx.fillStyle = frontGrad;
    ctx.fillRect(bx, topY, bw, bh);
    drawSideWall(bx + bw, topY, sideDepth, baseY);

    // Tinted vertical curtain-glass panels with diagonal reflection sheen
    const glassGrad = ctx.createLinearGradient(bx, topY, bx + bw, baseY);
    glassGrad.addColorStop(0, rgbCss(lerpRgb([10, 18, 30], [74, 126, 166], amb), 0.72));
    glassGrad.addColorStop(0.45, rgbCss(lerpRgb([8, 14, 24], [52, 92, 128], amb), 0.78));
    glassGrad.addColorStop(0.55, rgbCss(lerpRgb([14, 22, 36], [126, 174, 206], amb), 0.65));
    glassGrad.addColorStop(1, rgbCss(lerpRgb([6, 12, 22], [38, 68, 96], amb), 0.85));
    ctx.fillStyle = glassGrad;
    ctx.fillRect(bx + 3, topY + 6, Math.max(4, bw - 6), Math.max(4, bh - 12));

    // Sleek floor spandrel bands + interior warm lit bays
    const rows = Math.max(2, Math.floor(bh / 14));
    const cols = Math.max(2, Math.floor(bw / 14));
    for (let r = 0; r < rows; r++) {
      const ry = topY + 8 + r * 14;
      if (ry > baseY - 12) break;
      for (let c = 0; c < cols; c++) {
        const isLit = lightGlow > 0.14 && ((seedIdx * 5 + r * 9 + c * 7) % 3 === 0);
        if (isLit) {
          const wx = bx + 4 + c * ((bw - 8) / cols);
          const ww = Math.max(4, (bw - 10) / cols - 2);
          const warm = (r + c + seedIdx) % 2 === 0 ? '250, 212, 134' : '192, 228, 248';
          ctx.fillStyle = `rgba(${warm}, ${(0.24 + 0.36 * lightGlow).toFixed(2)})`;
          ctx.fillRect(wx, ry, ww, 9);
        }
      }
      ctx.fillStyle = darkFrameCol;
      ctx.fillRect(bx + 2, ry + 10, bw - 4, 2.2);
    }
    // Vertical aluminum mullions
    ctx.fillStyle = 'rgba(20, 28, 40, 0.38)';
    for (let c = 1; c < cols; c++) {
      const mx = bx + 3 + c * ((bw - 6) / cols);
      ctx.fillRect(mx, topY + 6, 1.3, Math.max(2, bh - 12));
    }
    // Cantilevered rooftop pergola fin
    ctx.fillStyle = trimCol;
    ctx.fillRect(bx - 2, topY - 4, bw + 4, 4);
    ctx.fillStyle = darkFrameCol;
    ctx.fillRect(bx + bw * 0.15, topY - 9, bw * 0.7, 5);
  } else if (style === 1) {
    // 1: Stepped Terraced Contemporary Apartment with projecting glass balconies & rooftop terrace plants
    const mainH = bh * 0.78;
    const pentH = bh - mainH;
    const pentW = bw * 0.64;
    const pentX = bx + (subSeed % 2 === 0 ? bw * 0.08 : bw * 0.28);
    const mainTop = baseY - mainH;

    // Upper recessed penthouse box
    ctx.fillStyle = frontTopCol;
    ctx.fillRect(pentX, topY, pentW, pentH + 2);
    drawSideWall(pentX + pentW, topY, sideDepth * 0.7, mainTop);
    ctx.fillStyle = trimCol;
    ctx.fillRect(pentX - 2, topY - 3, pentW + 4, 3);

    // Main apartment body
    ctx.fillStyle = frontGrad;
    ctx.fillRect(bx, mainTop, bw, mainH);
    drawSideWall(bx + bw, mainTop, sideDepth, baseY);

    // Parapet & terrace garden shrubs on main step-back deck
    ctx.fillStyle = trimCol;
    ctx.fillRect(bx - 1.5, mainTop - 3, bw + 3, 3.5);
    const shrubCol = rgbCss(lerpRgb([10, 22, 12], [44, 92, 42], amb));
    ctx.fillStyle = shrubCol;
    for (let s = 0; s < 3; s++) {
      const sx = bx + (subSeed % 2 === 0 ? bw * 0.75 : bw * 0.12) + s * 6;
      ctx.beginPath();
      ctx.arc(sx, mainTop - 4.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Alternating projecting balconies with glass railings & warm sliding glass doors
    const rows = Math.max(2, Math.floor(mainH / 16));
    const cols = Math.max(2, Math.floor(bw / 20));
    for (let r = 0; r < rows; r++) {
      const ry = mainTop + 7 + r * 15;
      if (ry > baseY - 14) break;
      for (let c = 0; c < cols; c++) {
        const wx = bx + 5 + c * ((bw - 10) / cols);
        const ww = Math.max(6, (bw - 14) / cols);
        const isLit = lightGlow > 0.14 && ((seedIdx * 7 + r * 5 + c * 3) % 3 !== 0);
        ctx.fillStyle = isLit
          ? `rgba(248, 206, 126, ${(0.26 + 0.36 * lightGlow).toFixed(2)})`
          : rgbCss(lerpRgb([8, 12, 20], [54, 78, 102], amb * 0.72), 0.9);
        ctx.fillRect(wx, ry, ww, 9.5);

        // Glass-railed balcony slab on alternating bays
        if ((r + c) % 2 === 0) {
          ctx.fillStyle = rgbCss(lerpRgb([18, 26, 38], [134, 186, 212], amb), 0.36);
          ctx.fillRect(wx - 1, ry + 5.5, ww + 2, 4.5);
          ctx.fillStyle = trimCol;
          ctx.fillRect(wx - 1.5, ry + 9.5, ww + 3, 2.2);
        }
      }
    }
  } else if (style === 2) {
    // 2: Modern Vertical-Fin Commercial Plaza with horizontal ribbon windows & shopfront awning
    ctx.fillStyle = frontGrad;
    ctx.fillRect(bx, topY, bw, bh);
    drawSideWall(bx + bw, topY, sideDepth, baseY);

    // Distinct architectural roof cornice
    ctx.fillStyle = trimCol;
    ctx.fillRect(bx - 2, topY - 3, bw + 4, 4);

    // Horizontal ribbon glazing bands
    const rows = Math.max(2, Math.floor((bh - 16) / 14));
    for (let r = 0; r < rows; r++) {
      const ry = topY + 7 + r * 14;
      if (ry > baseY - 18) break;
      const bandLit = lightGlow > 0.14 && ((seedIdx + r * 3) % 2 === 0);
      ctx.fillStyle = bandLit
        ? `rgba(244, 208, 134, ${(0.20 + 0.34 * lightGlow).toFixed(2)})`
        : rgbCss(lerpRgb([8, 12, 20], [58, 86, 112], amb * 0.76), 0.88);
      ctx.fillRect(bx + 4, ry, bw - 8, 8);
      // Warm interior highlight patches inside ribbon glass
      if (lightGlow > 0.14) {
        const subCols = Math.max(2, Math.floor(bw / 16));
        for (let sc = 0; sc < subCols; sc++) {
          if ((seedIdx + r + sc) % 2 === 0) {
            ctx.fillStyle = `rgba(255, 236, 182, ${(0.20 + 0.32 * lightGlow).toFixed(2)})`;
            ctx.fillRect(bx + 6 + sc * ((bw - 12) / subCols), ry + 1, Math.max(4, (bw - 16) / subCols), 6);
          }
        }
      }
    }
    // Crisp vertical architectural fins
    const finCount = Math.max(2, Math.floor(bw / 16));
    ctx.fillStyle = trimCol;
    for (let f = 1; f < finCount; f++) {
      const fx = bx + f * (bw / finCount);
      ctx.fillRect(fx - 1, topY + 2, 2.2, Math.max(4, bh - 18));
    }
    // Ground-level cozy shopfront awning & warm storefront glow
    const awY = baseY - 13;
    ctx.fillStyle = lightGlow > 0.12
      ? `rgba(252, 214, 138, ${(0.34 + 0.42 * lightGlow).toFixed(2)})`
      : rgbCss(lerpRgb([14, 18, 26], [88, 108, 128], amb));
    ctx.fillRect(bx + 4, awY + 3, bw - 8, 10);
    const awningCol = subSeed % 2 === 0 ? [168, 56, 52] : [36, 108, 118];
    ctx.fillStyle = rgbCss(lerpRgb([22, 16, 16], awningCol as RGB, amb));
    ctx.beginPath();
    ctx.moveTo(bx + 2, awY);
    ctx.lineTo(bx + bw - 2, awY);
    ctx.lineTo(bx + bw + 1, awY + 4.5);
    ctx.lineTo(bx - 1, awY + 4.5);
    ctx.closePath();
    ctx.fill();
  } else if (style === 3) {
    // 3: Chamfered / Sloped-Roof Modern Loft with tall double-height French windows
    const slantDir = subSeed % 2 === 0 ? 1 : -1;
    const slantDelta = Math.min(12, bh * 0.12);
    const yL = slantDir > 0 ? topY : topY + slantDelta;
    const yR = slantDir > 0 ? topY + slantDelta : topY;

    ctx.fillStyle = frontGrad;
    ctx.beginPath();
    ctx.moveTo(bx, yL);
    ctx.lineTo(bx + bw, yR);
    ctx.lineTo(bx + bw, baseY);
    ctx.lineTo(bx, baseY);
    ctx.closePath();
    ctx.fill();
    drawSideWall(bx + bw, yR, sideDepth, baseY);

    // Crisp overhanging sloped roof fascia
    ctx.strokeStyle = trimCol;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(bx - 3, yL);
    ctx.lineTo(bx + bw + 3, yR);
    ctx.stroke();

    // Tall French windows with slim frames
    const startY = Math.max(yL, yR) + 8;
    const rows = Math.max(2, Math.floor((baseY - startY - 6) / 18));
    const cols = Math.max(2, Math.floor(bw / 17));
    for (let r = 0; r < rows; r++) {
      const ry = startY + r * 18;
      if (ry > baseY - 14) break;
      for (let c = 0; c < cols; c++) {
        const wx = bx + 6 + c * ((bw - 12) / cols);
        const ww = Math.max(5, (bw - 16) / cols);
        const isLit = lightGlow > 0.14 && ((seedIdx * 3 + r * 7 + c * 11) % 3 !== 1);
        ctx.fillStyle = darkFrameCol;
        ctx.fillRect(wx - 1, ry - 1, ww + 2, 13);
        ctx.fillStyle = isLit
          ? `rgba(250, 208, 128, ${(0.28 + 0.40 * lightGlow).toFixed(2)})`
          : rgbCss(lerpRgb([8, 12, 22], [62, 86, 114], amb * 0.72), 0.9);
        ctx.fillRect(wx, ry, ww, 11);
      }
    }
  } else if (style === 4) {
    // 4: Contemporary Brick & Cream Limestone Mid-Rise with arched upper windows & cornice
    ctx.fillStyle = frontGrad;
    ctx.fillRect(bx, topY, bw, bh);
    drawSideWall(bx + bw, topY, sideDepth, baseY);

    // Classic modern cornice & cream parapet band
    ctx.fillStyle = trimCol;
    ctx.fillRect(bx - 2, topY - 2, bw + 4, 5);
    ctx.fillRect(bx, topY + 6, bw, 2.2);

    const rows = Math.max(2, Math.floor(bh / 16));
    const cols = Math.max(2, Math.floor(bw / 16));
    for (let r = 0; r < rows; r++) {
      const ry = topY + 12 + r * 15;
      if (ry > baseY - 12) break;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(bx, ry + 11.5, bw, 1.4);
      for (let c = 0; c < cols; c++) {
        const wx = bx + 5 + c * ((bw - 10) / cols);
        const ww = Math.max(5, (bw - 16) / cols);
        const isLit = lightGlow > 0.14 && ((seedIdx * 11 + r * 5 + c * 7) % 3 !== 0);
        ctx.fillStyle = isLit
          ? `rgba(248, 206, 120, ${(0.26 + 0.36 * lightGlow).toFixed(2)})`
          : rgbCss(lerpRgb([8, 12, 20], [50, 74, 98], amb * 0.72), 0.9);
        ctx.beginPath();
        if (r === 0) {
          ctx.arc(wx + ww * 0.5, ry + 3, ww * 0.5, Math.PI, 0);
          ctx.lineTo(wx + ww, ry + 9);
          ctx.lineTo(wx, ry + 9);
          ctx.closePath();
        } else {
          ctx.roundRect(wx, ry, ww, 9, 1.2);
        }
        ctx.fill();
      }
    }
  } else {
    // 5: Sleek Dual-Tone Bay-Window Residence with vertical accent cladding strip & canopy
    ctx.fillStyle = frontGrad;
    ctx.fillRect(bx, topY, bw, bh);
    drawSideWall(bx + bw, topY, sideDepth, baseY);

    // Contrasting vertical architectural accent bay on one side
    const bayOnRight = subSeed % 2 === 0;
    const bayW = bw * 0.32;
    const bayX = bayOnRight ? bx + bw - bayW - 3 : bx + 3;
    ctx.fillStyle = rgbCss(lerpRgb([18, 22, 30], lerpRgb(baseFrontTint, [218, 168, 118], 0.38), amb));
    ctx.fillRect(bayX, topY - 4, bayW, bh + 4);

    // Rooftop canopy overhang
    ctx.fillStyle = trimCol;
    ctx.fillRect(bx - 1, topY - 2, bw + 2, 3);

    const rows = Math.max(2, Math.floor(bh / 15));
    for (let r = 0; r < rows; r++) {
      const ry = topY + 8 + r * 15;
      if (ry > baseY - 12) break;
      const litMain = lightGlow > 0.14 && ((seedIdx + r * 7) % 3 !== 0);
      const litBay = lightGlow > 0.14 && ((seedIdx + r * 5 + 1) % 2 === 0);

      // Wide panoramic window in main wing
      const mainX = bayOnRight ? bx + 5 : bx + bayW + 6;
      const mainW = Math.max(6, bw - bayW - 11);
      ctx.fillStyle = litMain
        ? `rgba(246, 206, 128, ${(0.25 + 0.35 * lightGlow).toFixed(2)})`
        : rgbCss(lerpRgb([8, 12, 20], [58, 84, 108], amb * 0.72), 0.9);
      ctx.fillRect(mainX, ry, mainW, 8.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(mainX, ry + 8.5, mainW, 1.5);

      // Corner window in accent bay
      ctx.fillStyle = litBay
        ? `rgba(202, 232, 248, ${(0.22 + 0.32 * lightGlow).toFixed(2)})`
        : rgbCss(lerpRgb([6, 10, 18], [44, 68, 94], amb * 0.72), 0.9);
      ctx.fillRect(bayX + 3, ry, Math.max(4, bayW - 6), 8.5);
    }
  }

  // Subtle side wall windows so 3D depth holds at night/dusk
  if (lightGlow > 0.16 && sideDepth >= 8) {
    const sRows = Math.max(2, Math.floor(bh / 18));
    for (let r = 0; r < sRows; r++) {
      const ry = topY + 12 + r * 17;
      if (ry > baseY - 14 || (seedIdx + r) % 2 === 0) continue;
      ctx.fillStyle = `rgba(246, 202, 118, ${(0.16 + 0.26 * lightGlow).toFixed(2)})`;
      ctx.fillRect(bx + bw + sideDepth * 0.32, ry + sideRise * 0.32, Math.max(3, sideDepth * 0.34), 6);
    }
  }

  ctx.restore();
}

/** Authentic Bengali roadside টং দোকান (Tea Stall) with full 3D anatomical vendor & customers */
export function drawRoadsideTeaStall(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  tSec: number,
  amb: number,
  lightGlow: number,
  showStaticCustomer = true
) {
  ctx.save();
  const W = 68 * scale;
  const H = 38 * scale;
  const pourWave = 0.5 + 0.5 * Math.sin(tSec * 2.2);
  const skinCol = rgbCss(lerpRgb([56, 38, 28], [156, 108, 78], amb));
  const skinShade = rgbCss(lerpRgb([42, 28, 20], [122, 82, 58], amb));

  // Soft 3D ground contact shadow
  ctx.fillStyle = 'rgba(4, 6, 12, 0.36)';
  ctx.beginPath();
  ctx.ellipse(x + W * 0.5, groundY + 1.5 * scale, W * 0.68, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Back wooden wall + 3D shaded right gable wall + tin roof overhang
  ctx.fillStyle = rgbCss(lerpRgb([14, 12, 14], [48, 68, 92], amb));
  ctx.fillRect(x, groundY - H, W, H);
  ctx.fillStyle = rgbCss(lerpRgb([8, 10, 14], [32, 46, 66], amb));
  ctx.beginPath();
  ctx.moveTo(x + W, groundY - H);
  ctx.lineTo(x + W + 10 * scale, groundY - H - 4 * scale);
  ctx.lineTo(x + W + 10 * scale, groundY - 4 * scale);
  ctx.lineTo(x + W, groundY);
  ctx.closePath();
  ctx.fill();

  // Soft interior warmth (>=50% gentler glow)
  const glowA = Math.max(0.14, lightGlow * 0.44);
  ctx.fillStyle = `rgba(236, 192, 98, ${(glowA * 0.68).toFixed(2)})`;
  ctx.fillRect(x + 4 * scale, groundY - H + 6 * scale, W - 8 * scale, H * 0.52);

  // Full 3D anatomical Vendor inside stall pouring milk tea from kettle with both arms
  const vx = x + W * 0.5;
  ctx.fillStyle = rgbCss(lerpRgb([22, 24, 30], [224, 228, 236], amb));
  ctx.beginPath();
  ctx.roundRect(vx - 5 * scale, groundY - 26 * scale, 10 * scale, 14 * scale, 3 * scale);
  ctx.fill();
  ctx.fillStyle = skinCol;
  ctx.beginPath();
  ctx.arc(vx, groundY - 29.5 * scale, 3.6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14171d';
  ctx.beginPath();
  ctx.arc(vx + 0.5 * scale, groundY - 30.5 * scale, 3.4 * scale, Math.PI, 0);
  ctx.fill();

  const pourHandY = groundY - (22 + pourWave * 5) * scale;
  ctx.strokeStyle = skinCol;
  ctx.lineWidth = 2.1 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(vx - 4 * scale, groundY - 23 * scale);
  ctx.lineTo(x + W * 0.36, pourHandY);
  ctx.moveTo(vx + 4 * scale, groundY - 22 * scale);
  ctx.lineTo(x + W * 0.54, groundY - 17 * scale);
  ctx.stroke();

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x + W * 0.3, pourHandY - 2.5 * scale, 5.5 * scale, 4.5 * scale);
  if (pourWave > 0.35) {
    ctx.strokeStyle = 'rgba(245, 222, 179, 0.88)';
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.moveTo(x + W * 0.32, pourHandY + 1 * scale);
    ctx.lineTo(x + W * 0.31, groundY - 13 * scale);
    ctx.stroke();
  }

  // 3D slanted corrugated tin awning
  ctx.fillStyle = rgbCss(lerpRgb([22, 24, 30], [116, 126, 142], amb));
  ctx.beginPath();
  ctx.moveTo(x - 6 * scale, groundY - H + 4 * scale);
  ctx.lineTo(x + W + 5 * scale, groundY - H + 4 * scale);
  ctx.lineTo(x + W + 11 * scale, groundY - H - 8 * scale);
  ctx.lineTo(x, groundY - H - 7 * scale);
  ctx.closePath();
  ctx.fill();

  // Serving counter + biscuit jars + steaming kettle + filled cup
  ctx.fillStyle = rgbCss(lerpRgb([18, 12, 10], [118, 78, 46], amb));
  ctx.fillRect(x + 2 * scale, groundY - 12 * scale, W - 4 * scale, 12 * scale);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(x + 8 * scale, groundY - 17 * scale, 4.5 * scale, 5 * scale);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(x + W * 0.29, groundY - 15 * scale, 3.2 * scale, 3 * scale);
  for (let s = 0; s < 3; s++) {
    const sy = groundY - 18 * scale - s * 4 - ((tSec * 12 + s * 6) % 10);
    ctx.fillStyle = 'rgba(241, 245, 249, 0.38)';
    ctx.beginPath();
    ctx.arc(x + W * 0.31 + Math.sin(tSec * 2 + s) * 2, sy, 2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wooden bench in front of stall
  const benchX = x + W + 5 * scale;
  ctx.fillStyle = rgbCss(lerpRgb([20, 14, 10], [92, 58, 34], amb));
  ctx.fillRect(benchX, groundY - 9 * scale, 26 * scale, 2.8 * scale);
  ctx.fillRect(benchX + 2 * scale, groundY - 6.5 * scale, 2.2 * scale, 6.5 * scale);
  ctx.fillRect(benchX + 21 * scale, groundY - 6.5 * scale, 2.2 * scale, 6.5 * scale);

  if (showStaticCustomer) {
    const c1x = benchX + 11 * scale;
    const sipLift = Math.max(0, Math.sin(tSec * 1.4)) * 3.2 * scale;
    ctx.strokeStyle = rgbCss(lerpRgb([12, 16, 22], [32, 42, 58], amb));
    ctx.lineWidth = 3.2 * scale;
    ctx.beginPath();
    ctx.moveTo(c1x + 1 * scale, groundY - 10 * scale);
    ctx.lineTo(c1x - 5 * scale, groundY - 9 * scale);
    ctx.lineTo(c1x - 6 * scale, groundY);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(c1x - 9 * scale, groundY - 1.5 * scale, 4.5 * scale, 2 * scale);

    ctx.fillStyle = rgbCss(lerpRgb([16, 22, 32], [58, 108, 164], amb));
    ctx.beginPath();
    ctx.roundRect(c1x - 3 * scale, groundY - 23 * scale, 7.5 * scale, 14 * scale, 2.5 * scale);
    ctx.fill();
    ctx.fillStyle = skinCol;
    ctx.beginPath();
    ctx.arc(c1x + 0.5 * scale, groundY - 26.5 * scale, 3.3 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14171d';
    ctx.beginPath();
    ctx.arc(c1x + 1 * scale, groundY - 27.5 * scale, 3.1 * scale, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.strokeStyle = skinShade;
    ctx.lineWidth = 2.0 * scale;
    ctx.beginPath();
    ctx.moveTo(c1x - 1 * scale, groundY - 20 * scale);
    ctx.lineTo(c1x - 6 * scale, groundY - 18 * scale - sipLift);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(c1x - 7.5 * scale, groundY - 19.5 * scale - sipLift, 2.6 * scale, 2.6 * scale);

    drawRealisticPerson(ctx, {
      x: x - 11 * scale,
      y: groundY,
      facing: 1,
      scale: scale * 0.72,
      walkPhase: 0.15,
      outfit: 'panjabi',
      coatRgb: [192, 138, 62],
      lowerRgb: [32, 38, 52],
      hasUmbrella: false,
      umbrellaRgb: [20, 24, 34],
      dayWeight: amb,
      sunlightFactor: 0.3,
      moonVis: 0,
      rainWeight: 0,
      windFactor: 0,
      windSign: 1,
      fogWeight: 0,
    });
  }

  // Soft hanging bulb inside stall
  const bx = x + W * 0.5;
  const by = groundY - H + 9 * scale;
  if (lightGlow > 0.14) {
    const g = ctx.createRadialGradient(bx, by, 1, bx, by, 22 * scale);
    g.addColorStop(0, `rgba(242, 206, 126, ${(0.34 * lightGlow).toFixed(2)})`);
    g.addColorStop(1, 'rgba(234, 179, 56, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, 22 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Authentic Dhaka Street Jhalmuri & Vaja-pora Pushcart (ঝালমুড়ি গাড়ি) with full 3D anatomical vendor & optional buyer */
export function drawJhalmuriCart(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  tSec: number,
  amb: number,
  lightGlow: number,
  showStaticCustomer = true
) {
  ctx.save();
  const W = 58 * scale;
  const H = 26 * scale;
  const skinCol = rgbCss(lerpRgb([56, 38, 28], [156, 108, 78], amb));

  // Full 3D anatomical Vendor behind cart shaking steel mixing bowl with both hands
  const shake = Math.sin(tSec * 9.5) * 2.2 * scale;
  const vx = x + W * 0.45;
  ctx.fillStyle = rgbCss(lerpRgb([22, 26, 34], [64, 128, 92], amb));
  ctx.beginPath();
  ctx.roundRect(vx - 5 * scale, groundY - 35 * scale, 10 * scale, 18 * scale, 3 * scale);
  ctx.fill();
  ctx.fillStyle = skinCol;
  ctx.beginPath();
  ctx.arc(vx, groundY - 38.5 * scale, 3.6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14171d';
  ctx.beginPath();
  ctx.arc(vx, groundY - 39.5 * scale, 3.5 * scale, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = skinCol;
  ctx.lineWidth = 2.0 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(vx - 4 * scale, groundY - 32 * scale);
  ctx.lineTo(x + W * 0.6 + shake, groundY - 26 * scale);
  ctx.moveTo(vx + 4 * scale, groundY - 31 * scale);
  ctx.lineTo(x + W * 0.72 + shake, groundY - 26 * scale);
  ctx.stroke();

  // Spoked Cart wheels & 3D pushcart body
  ctx.fillStyle = 'rgba(4, 6, 12, 0.36)';
  ctx.beginPath();
  ctx.ellipse(x + W * 0.5, groundY + 1 * scale, W * 0.58, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.6 * scale;
  [x + 12 * scale, x + W - 12 * scale].forEach((wx) => {
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(wx, groundY - 6 * scale, 6 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(wx, groundY - 6 * scale, 2.8 * scale, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = rgbCss(lerpRgb([22, 16, 12], [176, 88, 38], amb));
  ctx.fillRect(x + 4 * scale, groundY - 6 * scale - H * 0.68, W - 8 * scale, H * 0.68);
  // 3D side panel shading
  ctx.fillStyle = rgbCss(lerpRgb([14, 10, 8], [122, 56, 22], amb));
  ctx.beginPath();
  ctx.moveTo(x + W - 4 * scale, groundY - 6 * scale - H * 0.68);
  ctx.lineTo(x + W + 4 * scale, groundY - 9 * scale - H * 0.68);
  ctx.lineTo(x + W + 4 * scale, groundY - 9 * scale);
  ctx.lineTo(x + W - 4 * scale, groundY - 6 * scale);
  ctx.closePath();
  ctx.fill();

  // Glass snack display cabinet
  ctx.fillStyle = 'rgba(226, 242, 255, 0.35)';
  ctx.fillRect(x + 6 * scale, groundY - 6 * scale - H * 1.15, W * 0.45, H * 0.48);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(x + 8 * scale, groundY - 6 * scale - H * 0.92, W * 0.41, 5 * scale);

  // Steel mixing bowl & yellow mustard oil bottle on right counter
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.arc(x + W * 0.68 + shake, groundY - 6 * scale - H * 0.72, 4.5 * scale, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#eab308';
  ctx.fillRect(x + W * 0.84, groundY - 6 * scale - H * 0.95, 3 * scale, 7 * scale);

  if (lightGlow > 0.14) {
    const lx = x + W * 0.5;
    const ly = groundY - 40 * scale;
    const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, 20 * scale);
    g.addColorStop(0, `rgba(242, 206, 126, ${(0.32 * lightGlow).toFixed(2)})`);
    g.addColorStop(1, 'rgba(234, 179, 56, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  if (showStaticCustomer) {
    drawRealisticPerson(ctx, {
      x: x - 11 * scale,
      y: groundY,
      facing: 1,
      scale: scale * 0.7,
      walkPhase: Math.sin(tSec * 1.4) * 0.08,
      outfit: 'shirt',
      coatRgb: [186, 56, 78],
      lowerRgb: [28, 34, 48],
      hasUmbrella: false,
      umbrellaRgb: [20, 24, 34],
      dayWeight: amb,
      sunlightFactor: 0.3,
      moonVis: 0,
      rainWeight: 0,
      windFactor: 0,
      windSign: 1,
      fogWeight: 0,
    });
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(x - 4 * scale, groundY - 19 * scale);
    ctx.lineTo(x + 0.5 * scale, groundY - 22.5 * scale);
    ctx.lineTo(x - 1 * scale, groundY - 14.5 * scale);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** Graceful leaping dolphin arcing out of ocean waves */
export function drawLeapingDolphin(
  ctx: CanvasRenderingContext2D,
  cx: number,
  waterY: number,
  cycleT: number, // 0..1 during visible arc
  facing: 1 | -1,
  scale: number,
  amb: number
) {
  if (cycleT <= 0 || cycleT >= 1) return;
  const arcX = (cycleT - 0.5) * 86 * scale * facing;
  const arcY = -Math.sin(cycleT * Math.PI) * 44 * scale;
  const slopeAng = Math.cos(cycleT * Math.PI) * -0.95 * facing;

  ctx.save();
  ctx.translate(cx + arcX, waterY + arcY);
  ctx.rotate(slopeAng);
  ctx.scale(facing * scale, scale);

  const dorsalCol = rgbCss(lerpRgb([18, 28, 42], [72, 98, 128], amb));
  const bellyCol = rgbCss(lerpRgb([38, 52, 72], [186, 206, 224], amb));

  // Sleek arched dolphin body
  ctx.fillStyle = dorsalCol;
  ctx.beginPath();
  ctx.moveTo(-18, 3);
  ctx.quadraticCurveTo(-2, -10, 16, -1);
  ctx.lineTo(22, 1); // snout
  ctx.quadraticCurveTo(14, 5, 0, 4);
  ctx.quadraticCurveTo(-12, 4, -18, 3);
  ctx.closePath();
  ctx.fill();

  // Light belly crescent
  ctx.fillStyle = bellyCol;
  ctx.beginPath();
  ctx.ellipse(3, 2, 10, 2.2, 0, 0, Math.PI);
  ctx.fill();

  // Dorsal fin & tail fluke
  ctx.fillStyle = dorsalCol;
  ctx.beginPath();
  ctx.moveTo(-2, -4.5);
  ctx.quadraticCurveTo(-5, -13, -8, -5);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-16, 2.5);
  ctx.lineTo(-24, -2);
  ctx.lineTo(-22, 6);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // Entry/exit splash spray rings
  if (cycleT < 0.25 || cycleT > 0.75) {
    ctx.save();
    ctx.strokeStyle = `rgba(236, 248, 255, ${(0.55 * amb + 0.2).toFixed(2)})`;
    ctx.lineWidth = 1.4;
    const sx = cx + arcX;
    ctx.beginPath();
    ctx.ellipse(sx, waterY, 12 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Full-River / Haor Roaming Fishing Boat Story:
 * 1) Steers smoothly along open water, actively routing AROUND trees/obstacles (`avoidObstacles`)!
 * 2) Two-armed fisherman spots jumping fish -> throws dense 3D volumetric conical cast net (`ঝাঁকি জাল`)
 *    with sinker weights, cross-mesh diamonds, underwater submersion & water splash trigger (`onNetSplash`)!
 * 3) Hauls net UP WITH glinting silver fish visible inside lifted net & drops into bamboo boat basket!
 */
export function drawFishermanCastingNet(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  scale: number,
  tSec: number,
  amb: number,
  roamRadiusX = 32,
  roamRadiusY = 0,
  avoidObstacles: Array<{ x: number; y: number; r: number }> = [],
  onNetSplash?: (panX: number) => void,
  viewW = 1000,
  pauseCast = false
) {
  const storyLen = 24;
  const storyT = (tSec % storyLen) / storyLen;
  const zoneIdx = Math.floor(tSec / storyLen);

  // Helper: deflect any point safely clear of Hijol trees / piers
  const pushClear = (px: number, py: number) => {
    let ox = px;
    let oy = py;
    for (const obs of avoidObstacles) {
      const dx = ox - obs.x;
      const dy = (oy - obs.y) * 1.45;
      const d = Math.hypot(dx, dy);
      if (d < obs.r) {
        const push = obs.r - d + 8;
        const ux = d > 0.5 ? dx / d : 1;
        const uy = d > 0.5 ? dy / d : 0.4;
        ox += ux * push;
        oy += (uy / 1.45) * push;
      }
    }
    return { x: ox, y: oy };
  };

  const w0 = pushClear(centerX + Math.sin(zoneIdx * 2.3) * roamRadiusX, centerY + Math.cos(zoneIdx * 1.7) * roamRadiusY);
  const w1 = pushClear(centerX + Math.sin((zoneIdx + 1) * 2.3) * roamRadiusX, centerY + Math.cos((zoneIdx + 1) * 1.7) * roamRadiusY);

  const moveFrac = clamp01(storyT / 0.28);
  const easeMove = moveFrac * moveFrac * (3 - 2 * moveFrac);
  const midCurve = pushClear((w0.x + w1.x) * 0.5, (w0.y + w1.y) * 0.5 + ((zoneIdx % 2 === 0 ? 1 : -1) * Math.max(14, roamRadiusY * 0.45)));
  const u = 1 - easeMove;
  const rawX = u * u * w0.x + 2 * u * easeMove * midCurve.x + easeMove * easeMove * w1.x;
  const rawY = u * u * w0.y + 2 * u * easeMove * midCurve.y + easeMove * easeMove * w1.y;
  const steered = pushClear(rawX, rawY);
  const boatX = steered.x;
  const boatY = steered.y;

  const depthScale = scale * (1 + ((boatY - centerY) / Math.max(60, Math.abs(roamRadiusY) * 2.4)) * 0.28);
  // Stable unambiguous facing derived purely from overall drift toward casting station (zero mid-cast flip!)
  const facing: 1 | -1 = w1.x >= w0.x ? 1 : -1;

  // Target leaping fish ALWAYS strictly in front (+facing) of boat bow where net is cast!
  if (storyT > 0.12 && storyT < 0.48) {
    const fishX = w1.x + facing * 66 * depthScale;
    const fishY = w1.y + 6;
    const leapPeriod = tSec % 2.4;
    if (leapPeriod < 0.65) {
      const jt = leapPeriod / 0.65;
      const jumpH = Math.sin(jt * Math.PI) * 19 * depthScale;
      const arcX = fishX + facing * (jt - 0.5) * 18 * depthScale;
      const pitch = Math.cos(jt * Math.PI) * -0.85 * facing;
      ctx.save();
      ctx.translate(arcX, fishY - jumpH);
      ctx.rotate(pitch);
      ctx.scale(facing * depthScale * 0.9, depthScale * 0.9);
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.quadraticCurveTo(2, -2.5, -4, -1);
      ctx.lineTo(-7, -2.8);
      ctx.lineTo(-5.5, 0);
      ctx.lineTo(-7, 2.8);
      ctx.lineTo(-4, 1);
      ctx.quadraticCurveTo(2, 2.5, 6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (leapPeriod < 1.1) {
      const sp = leapPeriod / 1.1;
      ctx.save();
      ctx.strokeStyle = `rgba(232, 246, 255, ${(0.65 * (1 - sp)).toFixed(2)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(fishX, fishY, 8 + sp * 20, 2.5 + sp * 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  const isRowing = storyT < 0.28;
  // castCycle runs 0..1 from 0.28 -> 0.99:
  // 0.00..0.18 = Standing facing forward (+X), gathering & coiling wet net in front hands
  // 0.18..0.38 = Forward swing throwing wide cast net strictly AHEAD of bow (+20 -> +76)
  // 0.38..0.52 = Water impact splash crown & sinking lead-ring
  // 0.52..0.82 = Leaning brace pulling rope hand-over-hand strictly FROM ahead (+74 -> +22)
  // 0.82..1.00 = Lifting dripping pursed fish net over bow rail & shaking silver Hilsha INTO front midship Khalui (+14, -7.2)!
  const castCycle = pauseCast ? 0 : (storyT >= 0.28 ? clamp01((storyT - 0.28) / 0.71) : 0);
  if (onNetSplash && !pauseCast && castCycle >= 0.37 && castCycle <= 0.41) {
    onNetSplash(((boatX / Math.max(320, viewW)) - 0.5) * 1.4);
  }

  const bobY = Math.sin(tSec * 2.1) * 2.2 * depthScale;
  const rock =
    Math.sin(tSec * 1.8) * 0.035 +
    (castCycle >= 0.18 && castCycle < 0.40 ? Math.sin(((castCycle - 0.18) / 0.22) * Math.PI) * 0.06 : 0);

  const hullDark = rgbCss(lerpRgb([12, 8, 6], [42, 26, 18], amb));
  const hullMid = rgbCss(lerpRgb([18, 13, 10], [74, 48, 30], amb));
  const rimWood = rgbCss(lerpRgb([26, 20, 14], [108, 74, 46], amb));
  const skinRgb: RGB = [Math.round(156 * amb + 24), Math.round(108 * amb + 18), Math.round(78 * amb + 12)];
  const shirtCol = rgbCss(lerpRgb([28, 32, 38], [218, 224, 232], amb));
  const lungiCol = rgbCss(lerpRgb([16, 18, 26], [36, 78, 108], amb));

  ctx.save();
  ctx.translate(boatX, boatY + bobY);
  ctx.scale(facing * depthScale, depthScale);

  // Water reflection shadow
  ctx.fillStyle = 'rgba(6, 16, 24, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 48, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.rotate(rock);

  // 3D Wooden Dinghy Interior + Curved Planks
  ctx.fillStyle = hullDark;
  ctx.beginPath();
  ctx.moveTo(-45, -7);
  ctx.quadraticCurveTo(0, -13, 47, -8);
  ctx.quadraticCurveTo(0, 1, -45, -7);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hullMid;
  ctx.beginPath();
  ctx.moveTo(-51, -10);
  ctx.quadraticCurveTo(-25, 9, 0, 8);
  ctx.quadraticCurveTo(25, 9, 52, -11);
  ctx.quadraticCurveTo(22, -1, 0, -2);
  ctx.quadraticCurveTo(-22, -1, -51, -10);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rimWood;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-49, -9);
  ctx.quadraticCurveTo(0, -1.5, 50, -10);
  ctx.stroke();

  // Woven Bamboo Fish Basket (খালুই) seated securely in forward midship well (+16, -6.8) RIGHT IN FRONT of fisherman!
  const basketX = 16;
  const basketY = -7.2;
  ctx.fillStyle = rgbCss(lerpRgb([26, 20, 14], [156, 114, 64], amb));
  ctx.beginPath();
  ctx.ellipse(basketX, -6.5, 8.4, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgbCss(lerpRgb([14, 12, 10], [82, 56, 28], amb));
  ctx.beginPath();
  ctx.ellipse(basketX, basketY, 6.4, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.ellipse(basketX - 1.2, -7.4, 2.6, 1.0, 0.2, 0, Math.PI * 2);
  ctx.ellipse(basketX + 1.5, -7.1, 2.2, 0.9, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgbCss(lerpRgb([16, 12, 8], [102, 70, 34], amb));
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(basketX, basketY, 6.4, 2.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Rowing paddle held midship facing forward (+X), stowed cleanly along rear gunwale while casting!
  const oarSweep = isRowing ? Math.sin(tSec * 5.2) * 8 : 0;
  ctx.strokeStyle = '#6b4730';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  if (isRowing) {
    ctx.moveTo(-2, -12);
    ctx.lineTo(10 + oarSweep, 12);
  } else {
    ctx.moveTo(-42, -9);
    ctx.lineTo(-10, -8);
  }
  ctx.stroke();

  // Articulated Fisherman positioned at (-4, -3) facing strictly FORWARD (+X) toward bow & casting direction!
  const isCoiling = !isRowing && castCycle < 0.18;
  const isThrowing = !isRowing && castCycle >= 0.18 && castCycle < 0.36;
  const isHauling = !isRowing && castCycle >= 0.50 && castCycle < 0.82;
  const isLiftingCatch = !isRowing && castCycle >= 0.82;

  const haulStroke = isHauling ? Math.sin(tSec * 7.5) : 0;
  const throwLean = isRowing
    ? 0.12 + Math.sin(tSec * 5.2) * 0.10
    : isCoiling
      ? -0.06
      : isThrowing
        ? lerp(-0.14, 0.36, Math.min(1, (castCycle - 0.18) / 0.14))
        : isHauling
          ? -0.14 + haulStroke * 0.08
          : isLiftingCatch
            ? 0.24
            : 0.10;

  ctx.save();
  ctx.translate(-4, -3);
  ctx.rotate(throwLean);

  // Hand targets ALL stay in front (+X) matching body & gaze direction!
  let nHandX = 9;
  let nHandY = -21;
  let fHandX = 7;
  let fHandY = -22;

  if (isRowing) {
    nHandX = 6 + oarSweep * 0.45;
    nHandY = -13;
    fHandX = 9 + oarSweep * 0.45;
    fHandY = -16;
  } else if (isCoiling) {
    const p = castCycle / 0.18;
    nHandX = 7 + Math.sin(p * Math.PI * 2) * 3;
    nHandY = -21 - Math.sin(p * Math.PI) * 3;
    fHandX = 11;
    fHandY = -23;
  } else if (isThrowing) {
    const p = clamp01((castCycle - 0.18) / 0.14);
    const sweepAng = lerp(-1.55, 0.08, p);
    nHandX = 4 + Math.cos(sweepAng) * 15;
    nHandY = -29 + Math.sin(sweepAng) * 14;
    fHandX = 10;
    fHandY = -24;
  } else if (isHauling) {
    nHandX = 12 + haulStroke * 6.5;
    nHandY = -23 + Math.cos(tSec * 7.5) * 3.2;
    fHandX = 12 - haulStroke * 6.5;
    fHandY = -23 - Math.cos(tSec * 7.5) * 3.2;
  } else if (isLiftingCatch) {
    const p = (castCycle - 0.82) / 0.18;
    const shake = p > 0.55 ? Math.sin(tSec * 18) * 2.2 : 0;
    nHandX = lerp(16, 14, Math.min(1, p * 1.2)) + shake;
    nHandY = -25 - Math.sin(p * Math.PI) * 5;
    fHandX = nHandX - 3;
    fHandY = nHandY + 2;
  }

  // Far articulated arm
  const fElbX = (2 + fHandX) * 0.5 + 1.5;
  const fElbY = (-31 + fHandY) * 0.5 + 3;
  ctx.strokeStyle = rgbCss(lerpRgb(skinRgb, [20, 14, 10], 0.22));
  ctx.lineWidth = 2.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(2, -32);
  ctx.lineTo(fElbX, fElbY);
  ctx.lineTo(fHandX, fHandY);
  ctx.stroke();

  // Legs braced cleanly facing forward (+X)
  ctx.strokeStyle = rgbCss(skinRgb);
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-2, -15);
  ctx.lineTo(-4, -7);
  ctx.lineTo(-3, 0);
  ctx.moveTo(3, -15);
  ctx.lineTo(7, -7);
  ctx.lineTo(8, 0);
  ctx.stroke();

  // Folded Lungi + Contrast Light Cotton Shirt + Gamcha Waist-belt
  ctx.fillStyle = lungiCol;
  ctx.beginPath();
  ctx.moveTo(-6, -21);
  ctx.lineTo(6, -21);
  ctx.lineTo(8.5, -11);
  ctx.lineTo(-8.5, -11);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shirtCol;
  ctx.beginPath();
  ctx.moveTo(-5, -34);
  ctx.quadraticCurveTo(0, -36, 5.5, -33);
  ctx.lineTo(5, -20);
  ctx.lineTo(-5.5, -20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgbCss(lerpRgb([46, 14, 14], [196, 42, 46], amb));
  ctx.fillRect(-5.4, -22, 10.6, 2.2);

  // Clear side-profile head with nose, dark eye facing forward (+X) & woven মাথাল hat
  ctx.fillStyle = rgbCss(skinRgb);
  ctx.beginPath();
  ctx.ellipse(1.5, -39, 3.8, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Distinct nose bridge facing strictly forward (+X)
  ctx.beginPath();
  ctx.moveTo(4.8, -40);
  ctx.lineTo(6.3, -38.6);
  ctx.lineTo(4.6, -37.8);
  ctx.closePath();
  ctx.fill();
  // Forward eye
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(3.6, -39.5, 0.65, 0, Math.PI * 2);
  ctx.fill();

  // Asymmetric মাথাল hat tilted comfortably toward forward gaze
  ctx.fillStyle = rgbCss(lerpRgb([36, 26, 16], [176, 142, 84], amb));
  ctx.beginPath();
  ctx.moveTo(-8.5, -40.5);
  ctx.quadraticCurveTo(1.5, -48.5, 10.8, -39.8);
  ctx.quadraticCurveTo(1.5, -38.8, -8.5, -40.5);
  ctx.closePath();
  ctx.fill();

  // Near articulated throwing/hauling arm
  const nElbX = (2.5 + nHandX) * 0.5 + 2.5;
  const nElbY = (-31 + nHandY) * 0.5 + 2.5;
  ctx.strokeStyle = rgbCss(skinRgb);
  ctx.lineWidth = 2.9;
  ctx.beginPath();
  ctx.moveTo(2.5, -32);
  ctx.lineTo(nElbX, nElbY);
  ctx.lineTo(nHandX, nHandY);
  ctx.stroke();

  // Coiled wet net visible in FRONT hands before release
  if (isCoiling || (isThrowing && castCycle < 0.25)) {
    ctx.fillStyle = `rgba(226, 238, 248, ${(0.72 + amb * 0.22).toFixed(2)})`;
    ctx.strokeStyle = `rgba(116, 152, 180, ${(0.55 + amb * 0.25).toFixed(2)})`;
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(nHandX - 2, nHandY - 2);
    ctx.quadraticCurveTo(nHandX + 5, nHandY + 1, nHandX + 4, nHandY + 11);
    ctx.quadraticCurveTo(nHandX - 1, nHandY + 14, nHandX - 4, nHandY + 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1e293b';
    for (let lw = -2; lw <= 3; lw += 2.2) {
      ctx.beginPath();
      ctx.arc(nHandX + lw, nHandY + 12, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore(); // restores throwLean (-4, -3) transform
  ctx.restore(); // restores rock ONLY — keeps boat (boatX, boatY + bobY) & scale(facing * depthScale, depthScale) active so cast net aligns strictly with boat bow & water!

  // Helper to draw a REAL detailed shimmering river fish (`রুপালি ইলিশ/মাছ`)
  const drawDetailedSilverFish = (fx: number, fy: number, fScale: number, angle: number, wiggle: number) => {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(angle);
    ctx.scale(fScale, fScale);
    const fg = ctx.createLinearGradient(0, -3, 0, 3);
    fg.addColorStop(0, '#64748b');
    fg.addColorStop(0.35, '#e2e8f0');
    fg.addColorStop(0.85, '#ffffff');
    fg.addColorStop(1, '#94a3b8');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(6.5, 0);
    ctx.quadraticCurveTo(2.5, -2.8 + wiggle * 0.3, -4.5, -1.2);
    ctx.lineTo(-7.2, -3.2 + wiggle);
    ctx.lineTo(-5.8, wiggle * 0.4);
    ctx.lineTo(-7.2, 3.0 + wiggle);
    ctx.lineTo(-4.5, 1.2);
    ctx.quadraticCurveTo(2.5, 2.8 + wiggle * 0.3, 6.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.beginPath();
    ctx.moveTo(0.8, -2.1);
    ctx.lineTo(-1.2, -4.2);
    ctx.lineTo(-2.4, -1.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(4.4, -0.5, 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // True Forward-Cast 3D Net Physics (+X in boat space = exact forward water in front of boat bow!)
  if (castCycle >= 0.25 && castCycle < 0.995) {
    const netLight = `rgba(232, 242, 250, ${(0.60 + amb * 0.36).toFixed(2)})`;
    const netShade = `rgba(116, 152, 180, ${(0.36 + amb * 0.24).toFixed(2)})`;
    const sinkerCol = `rgba(30, 36, 44, ${(0.78 + amb * 0.20).toFixed(2)})`;

    if (castCycle < 0.46) {
      // Throwing arc: coiled mesh blooms smoothly out into wide circular umbrella ahead of bow (+16 -> +76)
      const t = (castCycle - 0.25) / 0.21;
      const apexX = lerp(14, 66, t);
      const apexY = lerp(-32, -3, Math.pow(t, 1.35)) - Math.sin(t * Math.PI * 0.82) * 19;
      const baseCenterX = lerp(18, 76, t);
      const baseCenterY = lerp(-22, 8.5, Math.pow(t, 1.15));
      const openEase = Math.sin(Math.min(1, t * 1.12) * Math.PI * 0.5);
      const rx = 10 + openEase * 34;
      const ry = rx * 0.32;

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.88)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(10, -26);
      ctx.quadraticCurveTo(apexX * 0.52, apexY + 8, apexX, apexY);
      ctx.stroke();

      if (t > 0.42) {
        ctx.fillStyle = `rgba(6, 18, 28, ${(0.22 * Math.min(1, (t - 0.42) / 0.35)).toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(baseCenterX, 8.8, rx * 1.02, ry * 1.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const backGrad = ctx.createLinearGradient(apexX - rx * 0.5, apexY, baseCenterX + rx * 0.5, baseCenterY);
      backGrad.addColorStop(0, `rgba(128, 166, 194, ${(0.24 + amb * 0.14).toFixed(2)})`);
      backGrad.addColorStop(1, `rgba(24, 68, 92, ${(0.30 + amb * 0.12).toFixed(2)})`);
      ctx.fillStyle = backGrad;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(baseCenterX - rx, baseCenterY);
      ctx.ellipse(baseCenterX, baseCenterY, rx, ry, 0, Math.PI, 0, false);
      ctx.closePath();
      ctx.fill();

      const frontGrad = ctx.createRadialGradient(apexX - 4, apexY + 6, 3, baseCenterX, baseCenterY, rx * 1.1);
      frontGrad.addColorStop(0, `rgba(244, 250, 255, ${(0.36 + amb * 0.22).toFixed(2)})`);
      frontGrad.addColorStop(0.58, `rgba(202, 228, 246, ${(0.22 + amb * 0.14).toFixed(2)})`);
      frontGrad.addColorStop(1, 'rgba(134, 184, 212, 0.12)');
      ctx.fillStyle = frontGrad;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(baseCenterX - rx, baseCenterY);
      ctx.ellipse(baseCenterX, baseCenterY, rx, ry, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fill();

      const spokes = 18;
      for (let s = 0; s < spokes; s++) {
        const ang0 = (s / spokes) * Math.PI * 2;
        const ang1 = ((s + 1) / spokes) * Math.PI * 2;
        const isFront = Math.sin(ang0) >= -0.05;
        const r0x = baseCenterX + Math.cos(ang0) * rx;
        const r0y = baseCenterY + Math.sin(ang0) * ry;
        const r1x = baseCenterX + Math.cos(ang1) * rx;
        const r1y = baseCenterY + Math.sin(ang1) * ry;

        ctx.strokeStyle = isFront ? netLight : netShade;
        ctx.lineWidth = isFront ? 0.92 : 0.58;
        ctx.beginPath();
        ctx.moveTo(apexX, apexY);
        ctx.quadraticCurveTo((apexX + r0x) * 0.5 + (isFront ? 2 : -2), (apexY + r0y) * 0.5 - 3, r0x, r0y);
        ctx.stroke();

        if (isFront) {
          for (let ring = 1; ring <= 4; ring++) {
            const rf = ring / 5;
            const rfNext = (ring + 1) / 5;
            ctx.strokeStyle = netLight;
            ctx.lineWidth = 0.65;
            ctx.beginPath();
            ctx.moveTo(lerp(apexX, r0x, rf), lerp(apexY, r0y, rf));
            ctx.lineTo(lerp(apexX, r1x, rfNext), lerp(apexY, r1y, rfNext));
            ctx.moveTo(lerp(apexX, r1x, rf), lerp(apexY, r1y, rf));
            ctx.lineTo(lerp(apexX, r0x, rfNext), lerp(apexY, r0y, rfNext));
            ctx.stroke();
          }
        }

        ctx.strokeStyle = sinkerCol;
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(r0x, r0y);
        ctx.quadraticCurveTo((r0x + r1x) * 0.5, (r0y + r1y) * 0.5 + 2.4, r1x, r1y);
        ctx.stroke();

        ctx.fillStyle = sinkerCol;
        ctx.beginPath();
        ctx.ellipse(r0x, r0y, isFront ? 1.8 : 1.2, isFront ? 1.15 : 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (t > 0.72) {
        const spT = (t - 0.72) / 0.28;
        ctx.strokeStyle = `rgba(244, 252, 255, ${(0.82 * (1 - spT * 0.3)).toFixed(2)})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(baseCenterX, 8.2, rx * (0.98 + spT * 0.32), ry * (0.98 + spT * 0.32), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (castCycle < 0.58) {
      // Smooth Water Entry & Lead-Line Sinking (ZERO abrupt disappearance between splash and hauling!)
      const st = (castCycle - 0.46) / 0.12;
      const baseCenterX = lerp(76, 70, st);
      const baseCenterY = lerp(8.5, 9.2, st);
      const rx = lerp(44, 22, st);
      const ry = lerp(14, 6.2, st);
      const apexX = lerp(66, 66, st);
      const apexY = lerp(-3, 5.5, st);

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.9)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(10, -26);
      ctx.quadraticCurveTo(apexX * 0.5, 2, apexX, apexY);
      ctx.stroke();

      // Expanding water splash ring & submerged settling conical mesh
      ctx.strokeStyle = `rgba(240, 250, 255, ${(0.76 * (1 - st * 0.65)).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(baseCenterX, 8.2, 46 + st * 22, 13 + st * 6, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(180, 218, 240, ${(0.38 * (1 - st * 0.32)).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(baseCenterX - rx, baseCenterY);
      ctx.ellipse(baseCenterX, baseCenterY, rx, ry, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fill();
    } else if (castCycle < 0.82) {
      // Hand-over-hand Hauling rope pulling closed sunken catch net strictly along surface (+70 -> +24)
      const ht = (castCycle - 0.58) / 0.24;
      const pullX = lerp(70, 24, ht);
      const pullY = lerp(7.5, 4.5, ht);

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.92)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(8 + haulStroke * 5, -25);
      ctx.lineTo(pullX, pullY);
      ctx.stroke();

      // Bubbling drag wake ripples along water ahead of bow
      ctx.strokeStyle = `rgba(232, 246, 255, ${(0.48 + amb * 0.22).toFixed(2)})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.ellipse(pullX + 6, 8, 17 * (1 - ht * 0.28), 4.6, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(186, 214, 234, ${(0.44 + amb * 0.22).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(pullX - 3, pullY);
      ctx.lineTo(pullX + 18 * (1 - ht * 0.32), pullY + 4);
      ctx.lineTo(pullX + 12 * (1 - ht * 0.32), pullY + 9);
      ctx.closePath();
      ctx.fill();
    } else {
      // Lifting Dripping Catch Over Bow Rail & Shaking Flopping Silver Hilsha into front Khalui Basket (+16, -7.2) + smoothly lowering emptied net!
      const lt = (castCycle - 0.82) / 0.175;
      const liftArc = Math.sin(Math.min(1, lt * 1.1) * Math.PI * 0.65);
      const pouchX = lerp(24, basketX, Math.min(1, lt * 1.15));
      const pouchY = lerp(3.5, lt > 0.82 ? -13 : -24, liftArc);

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.88)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(10, -26);
      ctx.lineTo(pouchX, pouchY - 9);
      ctx.stroke();

      const netFade = lt > 0.85 ? 1 - (lt - 0.85) / 0.15 : 1;
      const haulGrad = ctx.createLinearGradient(pouchX - 11, pouchY - 9, pouchX + 11, pouchY + 16);
      haulGrad.addColorStop(0, `rgba(236, 246, 255, ${(0.56 + amb * 0.24) * netFade})`);
      haulGrad.addColorStop(1, `rgba(68, 114, 146, ${(0.52 + amb * 0.22) * netFade})`);
      ctx.fillStyle = haulGrad;
      ctx.strokeStyle = `rgba(232, 242, 250, ${((0.60 + amb * 0.36) * netFade).toFixed(2)})`;
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(pouchX, pouchY - 10);
      ctx.bezierCurveTo(pouchX + 13, pouchY - 1, pouchX + 14, pouchY + 11, pouchX + 8, pouchY + 15);
      ctx.quadraticCurveTo(pouchX, pouchY + 19, pouchX - 8, pouchY + 15);
      ctx.bezierCurveTo(pouchX - 14, pouchY + 11, pouchX - 13, pouchY - 1, pouchX, pouchY - 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      for (let fi = 0; fi < 5; fi++) {
        const dropOut = lt > 0.42 ? Math.min(1, (lt - 0.42) / 0.48) : 0;
        if (dropOut >= 0.94) continue;
        const startFx = pouchX + (fi - 2) * 3.0;
        const startFy = pouchY + 6 + (fi % 2) * 3.2;
        const fx = lerp(startFx, basketX + (fi - 2) * 1.6, dropOut);
        const fy = lerp(startFy, basketY, dropOut * dropOut);
        const wiggle = Math.sin(tSec * 19 + fi * 2.1) * 1.4;
        drawDetailedSilverFish(fx, fy, 0.70 + (fi % 2) * 0.12, lerp(0.42 * (fi - 2), 0.15, dropOut), wiggle);
      }

      if (lt < 0.85) {
        ctx.fillStyle = 'rgba(232, 246, 255, 0.78)';
        for (let dp = 0; dp < 5; dp++) {
          const dy = pouchY + 15 + ((tSec * 40 + dp * 7) % 10);
          if (dy < -2) {
            ctx.beginPath();
            ctx.arc(pouchX - 5 + dp * 2.4, dy, 1.0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  ctx.restore(); // restores boat (boatX, boatY + bobY) & facing * depthScale
}

/** Glowing Riverside Canvas Camp Tent pitched on grassy bank at dusk/night while boatman sleeps inside */
export function drawRiversideCampTent(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  tSec: number,
  amb: number,
  lightGlow: number
) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(scale, scale);

  // Soft tent shadow
  ctx.fillStyle = 'rgba(6, 10, 14, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 34, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Side tent wall in warm canvas
  ctx.fillStyle = rgbCss(lerpRgb([28, 32, 38], [136, 106, 68], amb));
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-10, -28);
  ctx.lineTo(18, -28);
  ctx.lineTo(28, 0);
  ctx.closePath();
  ctx.fill();

  // Front A-frame triangular opening glowing softly from gentle lantern inside (>=50% softer)
  const glowA = Math.max(0.15, lightGlow * 0.44);
  ctx.fillStyle = `rgba(238, 192, 96, ${(0.34 * glowA).toFixed(2)})`;
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-10, -28);
  ctx.lineTo(4, 0);
  ctx.closePath();
  ctx.fill();

  // Sleeping silhouette tucked warmly inside tent floor
  ctx.fillStyle = 'rgba(28, 20, 16, 0.65)';
  ctx.beginPath();
  ctx.ellipse(-10, -4, 9, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Gentle hurricane lantern & campfire ember outside tent door
  const flicker = 0.85 + Math.sin(tSec * 7.2) * 0.15;
  const g = ctx.createRadialGradient(-28, -4, 1, -28, -4, 24 * flicker);
  g.addColorStop(0, `rgba(244, 208, 122, ${(0.40 * glowA).toFixed(2)})`);
  g.addColorStop(0.35, `rgba(232, 118, 34, ${(0.16 * glowA).toFixed(2)})`);
  g.addColorStop(1, 'rgba(232, 115, 22, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(-28, -4, 24 * flicker, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Realistic 3D Shaded Tea Plucker — waist-down hidden cleanly inside tea bushes while plucking, visible 3D legs/feet on trail or sitting at rest! */
export function drawTeaPlucker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  pluckPhase: number,
  sariRgb: RGB,
  amb: number,
  withRainUmbrella = false,
  activityMode: 'plucking' | 'resting' | 'walking_home' = 'plucking'
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);

  const skinRgb: RGB = lerpRgb([38, 26, 22], [206, 154, 116], amb);
  const skinShadeRgb = lerpRgb(skinRgb, [30, 18, 12], 0.28);
  const dressColRgb = lerpRgb([24, 18, 22], sariRgb, 0.3 + amb * 0.7);
  const dressCol = rgbCss(dressColRgb);
  const dressDarkRgb = lerpRgb([14, 10, 14], lerpRgb(sariRgb, [18, 12, 16], 0.45), 0.3 + amb * 0.7);
  const dressDark = rgbCss(dressDarkRgb);
  const sariDrape = rgbCss(lerpRgb([30, 22, 20], lerpRgb(sariRgb, [244, 212, 162], 0.25), 0.35 + amb * 0.65));
  const basketCol = rgbCss(lerpRgb([24, 18, 12], [148, 108, 62], amb));
  const basketDark = rgbCss(lerpRgb([14, 10, 8], [98, 68, 36], amb));

  if (activityMode === 'resting') {
    ctx.fillStyle = 'rgba(6, 10, 12, 0.3)';
    ctx.beginPath();
    ctx.ellipse(-3, 2, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cylindrical shaded bamboo tea basket beside seated worker
    const bkG = ctx.createLinearGradient(-21, -9, -9, -9);
    bkG.addColorStop(0, basketDark);
    bkG.addColorStop(0.55, basketCol);
    bkG.addColorStop(1, basketDark);
    ctx.fillStyle = bkG;
    ctx.beginPath();
    ctx.moveTo(-21, -18);
    ctx.lineTo(-9, -18);
    ctx.lineTo(-11, 0);
    ctx.quadraticCurveTo(-15, 2, -19, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgbCss(lerpRgb([18, 44, 16], [96, 174, 54], amb));
    ctx.beginPath();
    ctx.ellipse(-15, -18.5, 6.2, 3, 0, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = dressCol;
    ctx.beginPath();
    ctx.ellipse(2, -5, 9.5, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgbCss(skinRgb);
    ctx.beginPath();
    ctx.ellipse(11, -1, 3.2, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    const torsoG = ctx.createLinearGradient(-4, -15, 6, -15);
    torsoG.addColorStop(0, dressDark);
    torsoG.addColorStop(0.65, sariDrape);
    torsoG.addColorStop(1, dressDark);
    ctx.fillStyle = torsoG;
    ctx.beginPath();
    ctx.roundRect(-3.5, -22, 9.5, 15, 4);
    ctx.fill();
    ctx.fillStyle = rgbCss(skinRgb);
    ctx.beginPath();
    ctx.arc(2, -26, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14171d';
    ctx.beginPath();
    ctx.arc(0.5, -26.8, 3.5, Math.PI * 0.7, Math.PI * 1.98);
    ctx.fill();

    drawSmoothLimb(ctx, 3.5, -19, 6.2, -21, 1.4, 1.15, skinRgb, skinShadeRgb);
    drawSmoothLimb(ctx, 6.2, -21, 8.6, -23.5 + Math.sin(pluckPhase * 0.5) * 1.5, 1.15, 0.85, skinRgb, skinShadeRgb);

    ctx.restore();
    return;
  }

  // 3D Cylindrical Woven Cone Basket (টুকরি) strapped behind torso
  const bGrad = ctx.createLinearGradient(-15, -26, -2.5, -26);
  bGrad.addColorStop(0, basketDark);
  bGrad.addColorStop(0.55, basketCol);
  bGrad.addColorStop(1, basketDark);
  ctx.fillStyle = bGrad;
  ctx.beginPath();
  ctx.moveTo(-15.5, -36.5);
  ctx.lineTo(-2.2, -36.5);
  ctx.lineTo(-4.8, -16.5);
  ctx.quadraticCurveTo(-8.8, -14.5, -12.4, -16.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = basketDark;
  ctx.lineWidth = 0.85;
  for (let r = 0; r < 3; r++) {
    const ry = -32 + r * 5;
    ctx.beginPath();
    ctx.moveTo(-14.2 + r, ry);
    ctx.quadraticCurveTo(-8.8, ry + 1.4, -3 - r * 0.5, ry);
    ctx.stroke();
  }
  ctx.fillStyle = rgbCss(lerpRgb([18, 44, 16], [96, 174, 54], amb));
  ctx.beginPath();
  ctx.ellipse(-8.8, -36.5, 6.4, 3.0, 0, Math.PI, 0);
  ctx.fill();

  const isPluckingInBush = activityMode === 'plucking';
  const stride = Math.sin(pluckPhase) * (isPluckingInBush ? 1.4 : 4.6);
  const bob = isPluckingInBush ? Math.sin(pluckPhase * 0.6) * 0.55 : Math.abs(Math.sin(pluckPhase * 0.5)) * 1.3;

  // Tapered smooth legs/ankles & sandals on open trail — waist-down is concealed inside tea bushes while plucking!
  if (!isPluckingInBush) {
    ctx.fillStyle = 'rgba(6, 10, 12, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    drawSmoothLimb(ctx, -1.6, -7.5, -2.5 - stride * 0.5, -3.5, 1.6, 1.25, skinShadeRgb, lerpRgb(skinShadeRgb, [10, 8, 8], 0.28));
    drawSmoothLimb(ctx, -2.5 - stride * 0.5, -3.5, -3.0 - stride, 0.2, 1.25, 0.9, skinShadeRgb, lerpRgb(skinShadeRgb, [10, 8, 8], 0.28));
    drawSmoothLimb(ctx, 1.6, -7.5, 2.5 + stride * 0.5, -3.5, 1.65, 1.25, skinRgb, skinShadeRgb);
    drawSmoothLimb(ctx, 2.5 + stride * 0.5, -3.5, 3.4 + stride, 0.2, 1.25, 0.9, skinRgb, skinShadeRgb);

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.ellipse(-2.0 - stride, 1.0, 2.7, 1.0, 0, 0, Math.PI * 2);
    ctx.ellipse(4.4 + stride, 1.0, 2.7, 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(0, -bob);

  // Far reaching arm behind torso with smooth elbow articulation
  const farReach = isPluckingInBush ? Math.cos(pluckPhase * 1.15) * 2.5 : -stride * 0.45;
  const farElbX = isPluckingInBush ? 8.8 : 5.2;
  const farElbY = -22.5 + farReach * 0.7;
  const farHndX = isPluckingInBush ? 15 : 7.8;
  const farHndY = isPluckingInBush ? -19.5 + farReach : -15 + farReach;
  drawSmoothLimb(ctx, 3.6, -27.5, farElbX, farElbY, 1.45, 1.15, skinShadeRgb, lerpRgb(skinShadeRgb, [10, 8, 8], 0.28));
  drawSmoothLimb(ctx, farElbX, farElbY, farHndX, farHndY, 1.15, 0.85, skinShadeRgb, lerpRgb(skinShadeRgb, [10, 8, 8], 0.28));

  // 3D cylindrical shaded Draped Sari (cuts cleanly at waist depth -12 when nested inside bushes, ankles -4.5 on trail!)
  const hemY = isPluckingInBush ? -11.5 : -4.5;
  const sariGrad = ctx.createLinearGradient(-6.5, -18, 7.5, -18);
  sariGrad.addColorStop(0, dressDark);
  sariGrad.addColorStop(0.55, dressCol);
  sariGrad.addColorStop(1, dressDark);
  ctx.fillStyle = sariGrad;
  ctx.beginPath();
  ctx.moveTo(-5.2, -31);
  ctx.quadraticCurveTo(5.2, -32.5, 6.4, -26.5);
  ctx.lineTo(7.0, hemY);
  ctx.lineTo(-5.8, hemY);
  ctx.closePath();
  ctx.fill();

  // Layered pleated diagonal anchal with highlight edge
  ctx.fillStyle = sariDrape;
  ctx.beginPath();
  ctx.moveTo(4.0, -31.2);
  ctx.lineTo(-5.8, -28.8);
  ctx.lineTo(-8.4, -17.2);
  ctx.lineTo(0.8, -19.2);
  ctx.closePath();
  ctx.fill();

  // Sculpted Head + Hair Bun + Woven Head-strap
  ctx.fillStyle = rgbCss(skinRgb);
  ctx.beginPath();
  ctx.ellipse(2.8, -36.2, 3.6, 4.0, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14171d';
  ctx.beginPath();
  ctx.arc(1.2, -37, 3.6, Math.PI * 0.72, Math.PI * 1.98);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-2.6, -35.6, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(228, 210, 172, 0.88)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(4.6, -38.6);
  ctx.lineTo(-12.5, -34);
  ctx.stroke();

  // Near shaded plucking/walking arm with seamless tapered shoulder-elbow-wrist
  const reach = isPluckingInBush ? Math.sin(pluckPhase) * 3.0 : stride * 0.45;
  const elbowX = isPluckingInBush ? 8.0 : 5.5;
  const elbowY = -23.5 + reach * 0.45;
  const handX = isPluckingInBush ? 15.2 + Math.cos(pluckPhase) * 1.8 : 7.2 + stride * 0.6;
  const handY = isPluckingInBush ? -22.5 + reach : -15.5 + reach;
  drawSmoothLimb(ctx, 3.0, -28.5, elbowX, elbowY, 1.5, 1.18, skinRgb, skinShadeRgb);
  drawSmoothLimb(ctx, elbowX, elbowY, handX, handY, 1.18, 0.85, skinRgb, skinShadeRgb);

  // Waist-covering foreground dense serrated tea leaves when standing inside bushes!
  if (isPluckingInBush) {
    const fgBush = rgbCss(lerpRgb([14, 34, 14], [48, 112, 34], amb));
    const fgBushLit = rgbCss(lerpRgb([26, 56, 20], [92, 162, 48], amb));
    for (let lf = -12; lf <= 12; lf += 4.8) {
      ctx.fillStyle = Math.abs(lf) % 2 === 0 ? fgBush : fgBushLit;
      ctx.beginPath();
      ctx.ellipse(lf, -10.5 + (Math.abs(lf) % 3) * 1.1, 4.6, 2.4, lf * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (withRainUmbrella) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(-1, -29);
    ctx.lineTo(-1, -53);
    ctx.stroke();
    ctx.fillStyle = rgbCss(lerpRgb([20, 26, 34], [38, 92, 68], amb));
    ctx.beginPath();
    ctx.arc(-1, -51, 16, Math.PI, 0);
    ctx.fill();
  }

  ctx.restore();
}

/** Couple strolling or sitting together on the evening seashore (সমুদ্র সৈকতে যুগল) */
export function drawBeachCouple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  walkPhase: number,
  isSeated: boolean,
  dayWeight: number,
  sunlightFactor: number,
  rainWeight: number,
  windFactor: number,
  windSign: number,
  facing: 1 | -1 = 1
) {
  if (isSeated) {
    drawRealisticPerson(ctx, {
      x: x - 8 * scale,
      y,
      facing: -1,
      scale,
      walkPhase: 0,
      outfit: 'shirt',
      coatRgb: [62, 104, 148],
      lowerRgb: [30, 38, 52],
      hasUmbrella: rainWeight > 0.1,
      umbrellaRgb: [168, 38, 62],
      dayWeight,
      sunlightFactor,
      moonVis: 0,
      rainWeight,
      windFactor,
      windSign,
      fogWeight: 0,
      action: 'sitting_bench',
      idleSec: walkPhase * 0.25,
    });
    drawRealisticPerson(ctx, {
      x: x + 7 * scale,
      y: y + 1.5 * scale,
      facing: -1,
      scale: scale * 0.94,
      walkPhase: 0,
      outfit: 'sari',
      coatRgb: [192, 62, 82],
      lowerRgb: [228, 172, 82],
      hasUmbrella: false,
      umbrellaRgb: [168, 28, 46],
      dayWeight,
      sunlightFactor,
      moonVis: 0,
      rainWeight,
      windFactor,
      windSign,
      fogWeight: 0,
      action: 'sitting_bench',
      idleSec: walkPhase * 0.25 + 1.3,
    });
    return;
  }

  drawRealisticPerson(ctx, {
    x: x - 9 * scale * facing,
    y,
    facing,
    scale,
    walkPhase,
    outfit: 'shirt',
    coatRgb: [72, 118, 158],
    lowerRgb: [30, 38, 52],
    hasUmbrella: rainWeight > 0.1,
    umbrellaRgb: [30, 44, 68],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight,
    windFactor,
    windSign,
    fogWeight: 0,
  });
  drawRealisticPerson(ctx, {
    x: x + 8 * scale * facing,
    y: y + 2 * scale,
    facing,
    scale: scale * 0.94,
    walkPhase: walkPhase + 1.2,
    outfit: 'sari',
    coatRgb: [204, 62, 84],
    lowerRgb: [232, 168, 78],
    hasUmbrella: false,
    umbrellaRgb: [168, 28, 46],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight,
    windFactor,
    windSign,
    fogWeight: 0,
  });
}

/**
 * Village kids engaged in completely distinct forward-facing movements (zero moonwalking!):
 * - Kid 1 dribbles & kicks football cleanly facing velocity direction
 * - Kid 2 skips/runs along wide independent arc flying a Bangladeshi diamond kite (ঘুড়ি)
 * - Kid 3 chases playfully nearby on dry meadow
 * - At dusk (সন্ধ্যা): Kids sit attentively on courtyard mat (পাটি) listening to elder's story beside glowing হারিকেন!
 */
export function drawVillageFieldPlayers(
  ctx: CanvasRenderingContext2D,
  fieldCenterX: number,
  fieldY: number,
  homeX: number,
  tSec: number,
  dayWeight: number,
  sunlightFactor: number,
  windFactor: number,
  windSign: number,
  isDuskReturning: boolean,
  scaleMul = 1
) {
  if (isDuskReturning) {
    // Open-courtyard Evening Storytelling Circle on পাটি cleanly unobstructed in front of courtyard trees!
    const sitX = homeX;
    const sitY = fieldY - 6;
    const amb = 0.28 + dayWeight * 0.72;
    ctx.save();
    ctx.translate(sitX, sitY);
    ctx.scale(scaleMul, scaleMul);
    // Woven bamboo mat (পাটি)
    ctx.fillStyle = rgbCss(lerpRgb([36, 26, 16], [176, 138, 78], amb));
    ctx.beginPath();
    ctx.ellipse(0, 2, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Soft hurricane lantern right on mat corner (>=50% gentler)
    const lg = ctx.createRadialGradient(-2, -5, 1.5, -2, -5, 26);
    lg.addColorStop(0, 'rgba(244, 210, 126, 0.38)');
    lg.addColorStop(0.35, 'rgba(232, 146, 48, 0.16)');
    lg.addColorStop(1, 'rgba(232, 115, 22, 0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(-2, -5, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(245, 208, 118, 0.76)';
    ctx.beginPath();
    ctx.arc(-2, -5, 2.0, 0, Math.PI * 2);
    ctx.fill();

    // Elder seated left telling stories with contoured body & natural arm gesture
    const elderShirtRgb = lerpRgb([28, 30, 36], [228, 224, 214], amb);
    const skinRgbVal = lerpRgb([56, 38, 28], [156, 108, 78], amb);
    const skinShadeVal = lerpRgb(skinRgbVal, [22, 14, 10], 0.28);
    const elderShirt = rgbCss(elderShirtRgb);
    const skin = rgbCss(skinRgbVal);
    // Seated folded lap & contoured torso
    ctx.fillStyle = rgbCss(lerpRgb([18, 22, 28], [58, 76, 94], amb));
    ctx.beginPath();
    ctx.ellipse(-11.5, -2, 7.5, 3.0, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = elderShirt;
    ctx.beginPath();
    ctx.roundRect(-18, -14.5, 9, 13, 4);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(-13.5, -17.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
    drawSmoothLimb(ctx, -10, -11, -7.5, -10.5, 1.35, 1.05, skinRgbVal, skinShadeVal);
    drawSmoothLimb(ctx, -7.5, -10.5, -4.8, -12 + Math.sin(tSec * 2.4) * 2, 1.05, 0.8, skinRgbVal, skinShadeVal);

    // Two village kids sitting facing elder listening attentively!
    [
      { dx: 7, dy: 0, col: [234, 88, 48] as RGB, s: 0.95 },
      { dx: 17, dy: 2, col: [38, 152, 214] as RGB, s: 0.88 },
    ].forEach((kid, ki) => {
      const kColRgb = lerpRgb([20, 22, 30], kid.col, amb);
      ctx.fillStyle = rgbCss(lerpRgb([14, 18, 26], [34, 42, 58], amb));
      ctx.beginPath();
      ctx.ellipse(kid.dx + 1.2 * kid.s, -1.5 * kid.s + kid.dy, 5.2 * kid.s, 2.2 * kid.s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgbCss(kColRgb);
      ctx.beginPath();
      ctx.roundRect(kid.dx, -11 * kid.s + kid.dy, 7 * kid.s, 10 * kid.s, 3.5);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(kid.dx + 3.5 * kid.s, -13.8 * kid.s + kid.dy, 3.1 * kid.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14171d';
      ctx.beginPath();
      ctx.arc(kid.dx + 3.8 * kid.s, -14.8 * kid.s + kid.dy + Math.sin(tSec * 2 + ki) * 0.4, 2.8 * kid.s, Math.PI, 0);
      ctx.fill();
    });
    ctx.restore();
    return;
  }

  // Independent Kid 1: Dribbles/passes bouncing football back & forth — ALWAYS faces exact velocity direction!
  const k1Phase = tSec * 1.15;
  const k1X = fieldCenterX - 24 + Math.sin(k1Phase) * 32;
  const k1Vx = Math.cos(k1Phase);
  const k1Dir: 1 | -1 = k1Vx >= 0 ? 1 : -1;
  const ballX = k1X + k1Dir * 10;
  const ballBounce = Math.abs(Math.sin(tSec * 5.6)) * 6.5;

  drawRealisticPerson(ctx, {
    x: k1X,
    y: fieldY,
    facing: k1Dir,
    scale: 0.62 * scaleMul,
    walkPhase: tSec * 7.2,
    outfit: 'shirt',
    coatRgb: [234, 88, 48],
    lowerRgb: [30, 42, 62],
    hasUmbrella: false,
    umbrellaRgb: [20, 20, 20],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight: 0,
    windFactor,
    windSign,
    fogWeight: 0,
  });

  ctx.fillStyle = 'rgba(6, 10, 16, 0.25)';
  ctx.beginPath();
  ctx.ellipse(ballX, fieldY + 1, 3.2 * Math.max(1, scaleMul * 0.8), 1.2 * Math.max(1, scaleMul * 0.8), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(ballX, fieldY - 3 - ballBounce, 3.0 * Math.max(1, scaleMul * 0.85), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Independent Kid 2: Runs smoothly across wider path flying a diamond kite (completely different rhythm!)
  const k2Phase = tSec * 0.68 + 1.4;
  const k2X = fieldCenterX + 18 + Math.sin(k2Phase) * 38;
  const k2Vx = Math.cos(k2Phase);
  const k2Dir: 1 | -1 = k2Vx >= 0 ? 1 : -1;

  drawRealisticPerson(ctx, {
    x: k2X,
    y: fieldY + 4,
    facing: k2Dir,
    scale: 0.58 * scaleMul,
    walkPhase: tSec * 6.1 + 1.1,
    outfit: 'shirt',
    coatRgb: [38, 152, 214],
    lowerRgb: [28, 36, 48],
    hasUmbrella: false,
    umbrellaRgb: [20, 20, 20],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight: 0,
    windFactor,
    windSign,
    fogWeight: 0,
  });

  const kiteX = k2X + windSign * (32 + windFactor * 16) + Math.sin(tSec * 2.3) * 9;
  const kiteY = fieldY - 122 - (scaleMul - 1) * 18 + Math.cos(tSec * 1.9) * 8;
  ctx.save();
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(k2X + k2Dir * 2, fieldY - 22 * scaleMul);
  ctx.quadraticCurveTo((k2X + kiteX) * 0.5, fieldY - 62, kiteX, kiteY);
  ctx.stroke();

  ctx.translate(kiteX, kiteY);
  ctx.rotate(windSign * 0.28 + Math.sin(tSec * 2.9) * 0.12);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, 0);
  ctx.lineTo(0, 10);
  ctx.lineTo(-8, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.quadraticCurveTo(Math.sin(tSec * 7) * 6, 17, Math.cos(tSec * 6) * 8, 25);
  ctx.stroke();
  ctx.restore();
}

export type PottedFlowerKind = 'rose' | 'marigold' | 'bougainvillea' | 'hibiscus' | 'jasmine' | 'sunflower';

/**
 * Shaded 3D terracotta/ceramic pot planted cleanly on rooftop terrace concrete floor
 * with dark soil rim, lush multi-leaf foliage stems, trailing vines, and layered 3D blooms.
 */
export function draw3DPottedFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  flowerKind: PottedFlowerKind,
  bloomRgb: RGB,
  tSec: number,
  windFactor: number,
  windSign: number,
  amb: number,
  seed: number,
  trailing = false
) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(scale, scale);

  // Contact shadow on terrace concrete
  ctx.fillStyle = 'rgba(4, 8, 14, 0.36)';
  ctx.beginPath();
  ctx.ellipse(3, 1.5, 16, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Varied pot glaze palette (classic terracotta, warm clay, cream ceramic, muted teal ceramic)
  const potVariant = Math.floor(Math.abs(seed * 3.7)) % 4;
  const potColors: Array<[RGB, RGB, RGB]> = [
    [[186, 86, 52], [156, 68, 40], [98, 40, 22]],
    [[198, 112, 74], [168, 88, 56], [112, 54, 34]],
    [[212, 202, 184], [184, 174, 156], [122, 114, 102]],
    [[78, 134, 138], [58, 108, 114], [34, 68, 74]],
  ];
  const [pL, pM, pD] = potColors[potVariant];

  // 3D cylindrical/tapered terracotta/ceramic pot body with curved base & vertical lighting gradient
  const potGrad = ctx.createLinearGradient(-15, -24, 15, -24);
  potGrad.addColorStop(0, rgbCss(lerpRgb([38, 22, 18], pL, amb)));
  potGrad.addColorStop(0.55, rgbCss(lerpRgb([28, 16, 14], pM, amb)));
  potGrad.addColorStop(1, rgbCss(lerpRgb([16, 10, 8], pD, amb)));
  ctx.fillStyle = potGrad;
  ctx.beginPath();
  ctx.moveTo(-14, -22);
  ctx.lineTo(14, -22);
  ctx.lineTo(10.5, 0);
  ctx.quadraticCurveTo(0, 3.2, -10.5, 0);
  ctx.closePath();
  ctx.fill();

  // 3D beveled top rim collar + rich dark potting soil ellipse
  const rimGrad = ctx.createLinearGradient(-16, -26, 16, -26);
  rimGrad.addColorStop(0, rgbCss(lerpRgb([48, 28, 22], lerpRgb(pL, [255, 255, 255], 0.14), amb)));
  rimGrad.addColorStop(1, rgbCss(lerpRgb([20, 12, 10], pD, amb)));
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.roundRect(-16, -26, 32, 5.5, 2.5);
  ctx.fill();

  ctx.fillStyle = rgbCss(lerpRgb([10, 8, 6], [42, 30, 22], amb));
  ctx.beginPath();
  ctx.ellipse(0, -25.5, 13.2, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trailing balcony/rooftop vines cascading down front of pot
  if (trailing) {
    const sway = windSign * windFactor * 6 + Math.sin(tSec * 2.2 + seed) * 2.5;
    for (let v = -1; v <= 1; v += 2) {
      ctx.strokeStyle = rgbCss(lerpRgb([12, 26, 14], [38, 86, 36], amb));
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(v * 8, -24);
      ctx.quadraticCurveTo(v * 11 + sway * 0.4, -10, v * 9 + sway, 4);
      ctx.stroke();

      ctx.fillStyle = rgbCss(lerpRgb([14, 30, 14], [52, 108, 42], amb));
      for (let lv = 0; lv < 3; lv++) {
        const ly = -17 + lv * 7;
        const lx = v * 9.5 + sway * (lv / 3);
        ctx.beginPath();
        ctx.ellipse(lx, ly, 3.4, 1.8, v * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Multi-stem lush foliage & layered 3D petals
  const stemCount = 5;
  const leafDark = rgbCss(lerpRgb([10, 24, 12], [28, 72, 32], amb));
  const leafLit = rgbCss(lerpRgb([14, 34, 16], [56, 118, 46], amb));
  const bloomLight = rgbCss(lerpRgb([48, 28, 34], lerpRgb(bloomRgb, [255, 245, 235], 0.34), 0.25 + amb * 0.75));
  const bloomMid = rgbCss(lerpRgb([36, 18, 22], bloomRgb, 0.25 + amb * 0.75));
  const bloomDeep = rgbCss(lerpRgb([22, 10, 14], lerpRgb(bloomRgb, [18, 12, 16], 0.35), 0.25 + amb * 0.75));

  for (let s = 0; s < stemCount; s++) {
    const f = (s / (stemCount - 1)) * 2 - 1;
    const h = flowerKind === 'bougainvillea' ? 38 - Math.abs(f) * 10 : 31 - Math.abs(f) * 8;
    const sway = windSign * windFactor * 9 + Math.sin(tSec * 2.4 + seed + s * 1.1) * 2.2;
    const tx = f * 15 + sway;
    const ty = -25 - h;

    ctx.strokeStyle = leafDark;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(f * 5, -25);
    ctx.quadraticCurveTo(f * 10 + sway * 0.4, -25 - h * 0.55, tx, ty);
    ctx.stroke();

    // Rich leaf clusters along stem
    for (let l = 0; l < 2; l++) {
      const ly = -25 - h * (0.45 + l * 0.32);
      const lx = f * (7 + l * 4) + sway * (0.35 + l * 0.3);
      ctx.fillStyle = l === 0 ? leafDark : leafLit;
      ctx.beginPath();
      ctx.ellipse(lx - 4, ly, 5.2, 2.4, -0.55, 0, Math.PI * 2);
      ctx.ellipse(lx + 4, ly + 1, 5.2, 2.4, 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Multi-layered realistic petals per flower species
    if (flowerKind === 'marigold') {
      // Ruffled pom-pom marigold layers (গাঁদা ফুল)
      for (let p = 0; p < 7; p++) {
        const a = (p / 7) * Math.PI * 2 + s;
        ctx.fillStyle = p % 2 === 0 ? bloomDeep : bloomMid;
        ctx.beginPath();
        ctx.arc(tx + Math.cos(a) * 2.5, ty + Math.sin(a) * 1.8, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = bloomLight;
      ctx.beginPath();
      ctx.arc(tx - 0.6, ty - 0.8, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (flowerKind === 'bougainvillea') {
      for (let p = 0; p < 4; p++) {
        const ang = (p / 4) * Math.PI * 2 + s;
        ctx.fillStyle = p % 2 === 0 ? bloomLight : bloomMid;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(ang) * 3.8, ty + Math.sin(ang) * 2.6, 4.2, 2.7, ang, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.arc(tx, ty, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (flowerKind === 'jasmine') {
      // Fragrant white/ivory star-petal jasmine clusters (বেলি/জুঁই ফুল)
      for (let p = 0; p < 6; p++) {
        const ang = (p / 6) * Math.PI * 2 + s * 0.7;
        ctx.fillStyle = p % 2 === 0 ? bloomLight : bloomMid;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(ang) * 2.8, ty + Math.sin(ang) * 2.1, 3.2, 1.4, ang, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(tx, ty, 1.1, 0, Math.PI * 2);
      ctx.fill();
    } else if (flowerKind === 'sunflower') {
      // Bright golden-rayed sunflower with rich dark seed center (সূর্যমুখী)
      ctx.fillStyle = bloomMid;
      for (let p = 0; p < 10; p++) {
        const ang = (p / 10) * Math.PI * 2 + s * 0.4;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(ang) * 4.2, ty + Math.sin(ang) * 3.1, 3.4, 1.3, ang, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgbCss(lerpRgb([24, 14, 8], [72, 42, 18], amb));
      ctx.beginPath();
      ctx.ellipse(tx, ty, 2.9, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Spiral Rose & Hibiscus multi-petal layered blooms
      ctx.fillStyle = bloomDeep;
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2 + s;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(ang) * 2.2, ty + Math.sin(ang) * 1.6, 3.6, 2.6, ang, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = bloomMid;
      ctx.beginPath();
      ctx.ellipse(tx - 0.3, ty - 0.3, 3.8, 3.0, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bloomLight;
      ctx.beginPath();
      ctx.arc(tx - 0.8, ty - 1.0, 1.9, 0, Math.PI * 2);
      ctx.fill();
      if (flowerKind === 'hibiscus') {
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + 3.2, ty - 4.2);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

/** Realistic Rooftop Fruit Planter (টবে লেবু / পেয়ারা গাছ) with shaded spheres & glossy fruit highlights */
export function draw3DFruitPlanter(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  scale: number,
  fruitKind: 'lemon' | 'guava',
  tSec: number,
  windFactor: number,
  windSign: number,
  amb: number
) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(scale, scale);

  // Contact shadow
  ctx.fillStyle = 'rgba(4, 8, 14, 0.38)';
  ctx.beginPath();
  ctx.ellipse(3, 1.5, 19, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Heavy shaded glazed ceramic/terracotta planter pot
  const potGrad = ctx.createLinearGradient(-17, -26, 17, -26);
  potGrad.addColorStop(0, rgbCss(lerpRgb([48, 24, 16], [192, 96, 56], amb)));
  potGrad.addColorStop(1, rgbCss(lerpRgb([20, 10, 8], [94, 42, 24], amb)));
  ctx.fillStyle = potGrad;
  ctx.beginPath();
  ctx.moveTo(-16, -24);
  ctx.lineTo(16, -24);
  ctx.lineTo(12, 0);
  ctx.quadraticCurveTo(0, 3.5, -12, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgbCss(lerpRgb([10, 8, 6], [42, 30, 22], amb));
  ctx.beginPath();
  ctx.ellipse(0, -24, 15, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();

  const sway = windSign * windFactor * 6 + Math.sin(tSec * 2.1 + x * 0.05) * 1.8;
  // Woody branched dwarf fruit trunk & stems
  ctx.strokeStyle = rgbCss(lerpRgb([20, 16, 12], [96, 68, 42], amb));
  ctx.lineWidth = 3.0;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.quadraticCurveTo(sway * 0.25, -42, sway * 0.6, -58);
  ctx.moveTo(sway * 0.25, -42);
  ctx.lineTo(-14 + sway * 0.7, -56);
  ctx.moveTo(sway * 0.35, -46);
  ctx.lineTo(15 + sway * 0.8, -54);
  ctx.stroke();

  // Layered glossy dark & emerald foliage canopy
  const leafDark = rgbCss(lerpRgb([10, 24, 12], [24, 68, 28], amb));
  const leafLit = rgbCss(lerpRgb([14, 34, 16], [58, 126, 46], amb));
  const puffs = [
    { px: -12, py: -56, rx: 14, ry: 10 },
    { px: 13, py: -54, rx: 14, ry: 10 },
    { px: 0, py: -63, rx: 16, ry: 11 },
  ];
  puffs.forEach((pf) => {
    ctx.fillStyle = leafDark;
    ctx.beginPath();
    ctx.ellipse(pf.px + sway * 0.65, pf.py, pf.rx, pf.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = leafLit;
    ctx.beginPath();
    ctx.ellipse(pf.px - 2 + sway * 0.65, pf.py - 2.5, pf.rx * 0.72, pf.ry * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Dangling shaded 3D fruits (yellow-green lemons or emerald-blush guavas)
  const fruits = [
    { fx: -11, fy: -48, r: 3.6 },
    { fx: 2, fy: -54, r: 3.9 },
    { fx: 13, fy: -46, r: 3.5 },
  ];
  const fCol = fruitKind === 'lemon' ? rgbCss(lerpRgb([64, 62, 16], [234, 212, 52], amb)) : rgbCss(lerpRgb([28, 52, 22], [132, 198, 72], amb));
  fruits.forEach((fr, fi) => {
    const fSwing = Math.sin(tSec * 2.8 + fi) * windFactor * 2;
    ctx.fillStyle = fCol;
    ctx.beginPath();
    ctx.arc(fr.fx + sway * 0.65 + fSwing, fr.fy, fr.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(fr.fx - 1 + sway * 0.65 + fSwing, fr.fy - 1.1, fr.r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Cox's Bazar striped 3D Kitkot Beach Umbrella + Wooden Lounger with ANIMATED visitors:
 * sipping fresh green coconut (`ডাব`) with straw, waving, sitting up / reclining, or hiding in rain!
 */
export function drawBeachUmbrellaAndLounger(
  ctx: CanvasRenderingContext2D,
  x: number,
  sandY: number,
  scale: number,
  stripeA: RGB,
  stripeB: RGB,
  tSec: number,
  windFactor: number,
  windSign: number,
  amb: number,
  isRaining: boolean,
  hasOccupant: boolean,
  drinkingCoconut = false
) {
  ctx.save();
  ctx.translate(x, sandY);
  ctx.scale(scale, scale);

  ctx.fillStyle = `rgba(12, 16, 22, ${(0.24 + amb * 0.16).toFixed(2)})`;
  ctx.beginPath();
  ctx.ellipse(6, 3, 44, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const woodCol = rgbCss(lerpRgb([28, 20, 14], [146, 102, 58], amb));
  const woodDark = rgbCss(lerpRgb([18, 12, 8], [98, 66, 36], amb));
  const cushionCol = rgbCss(lerpRgb([28, 34, 44], [228, 232, 238], amb));

  ctx.strokeStyle = woodDark;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-16, -5);
  ctx.lineTo(-18, 2);
  ctx.moveTo(14, -5);
  ctx.lineTo(16, 2);
  ctx.stroke();

  ctx.fillStyle = woodCol;
  ctx.beginPath();
  ctx.roundRect(-20, -8, 38, 4.2, 1.5);
  ctx.fill();
  ctx.save();
  ctx.translate(-17, -6);
  ctx.rotate(-0.56);
  ctx.fillRect(0, -3, 18, 3.8);
  ctx.restore();

  ctx.fillStyle = cushionCol;
  ctx.beginPath();
  ctx.roundRect(-18, -10.5, 34, 3.2, 1.5);
  ctx.fill();

  if (hasOccupant) {
    const skin = rgbCss(lerpRgb([48, 34, 26], [166, 114, 84], amb));
    const shirt = rgbCss(lerpRgb([24, 28, 38], stripeA, 0.3 + amb * 0.7));
    const shorts = rgbCss(lerpRgb([16, 20, 28], [44, 66, 98], amb));
    const sipWave = 0.5 + 0.5 * Math.sin(tSec * 1.1 + x * 0.03);

    if (isRaining) {
      ctx.fillStyle = shorts;
      ctx.fillRect(-10, -14, 15, 5);
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.roundRect(-14, -25, 9, 13, 3);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(-9.5, -28.5, 3.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (drinkingCoconut) {
      // Sitting upright holding green tender coconut (`ডাব`) & lifting it with straw!
      ctx.fillStyle = shorts;
      ctx.beginPath();
      ctx.roundRect(-7, -14, 16, 4.6, 2);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.roundRect(7, -13.5, 9, 3.4, 1.5);
      ctx.fill();

      const torsoLean = -0.18 + sipWave * 0.14;
      ctx.save();
      ctx.translate(-8, -12);
      ctx.rotate(torsoLean);
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.roundRect(-4.5, -13, 9, 14, 3);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0.5, -16.5, 3.6, 0, Math.PI * 2);
      ctx.fill();
      // Raised forearm gripping green tender coconut
      const cocoX = 6 + sipWave * 1.5;
      const cocoY = -9 - sipWave * 5;
      ctx.strokeStyle = skin;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(2, -10);
      ctx.lineTo(cocoX, cocoY);
      ctx.stroke();
      ctx.fillStyle = rgbCss(lerpRgb([20, 44, 18], [76, 164, 52], amb));
      ctx.beginPath();
      ctx.arc(cocoX + 1, cocoY, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(cocoX + 1, cocoY - 3);
      ctx.lineTo(cocoX - 2, cocoY - 7);
      ctx.stroke();
      ctx.restore();
    } else {
      // Seated/lounging visitor gesturing subtly toward sea
      ctx.fillStyle = shorts;
      ctx.beginPath();
      ctx.roundRect(-5, -13.5, 17, 4.5, 2);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.roundRect(10, -13, 9, 3.2, 1.5);
      ctx.fill();
      ctx.save();
      ctx.translate(-9, -11);
      ctx.rotate(-0.44 + sipWave * 0.08);
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.roundRect(-4, -12, 8.5, 13, 3);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0.5, -15.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const canopySway = windSign * windFactor * 2.5 + Math.sin(tSec * 2.4) * 1.1;
  ctx.strokeStyle = woodCol;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.lineTo(canopySway * 0.4, -56);
  ctx.stroke();

  ctx.save();
  ctx.translate(canopySway * 0.4, -55);
  ctx.rotate(canopySway * 0.015);
  ctx.fillStyle = 'rgba(12, 18, 28, 0.52)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 37, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  const segments = 6;
  const colA = rgbCss(lerpRgb([28, 22, 22], stripeA, 0.25 + amb * 0.75));
  const colB = rgbCss(lerpRgb([28, 28, 32], stripeB, 0.25 + amb * 0.75));
  for (let i = 0; i < segments; i++) {
    const x0 = lerp(-38, 38, i / segments);
    const x1 = lerp(-38, 38, (i + 1) / segments);
    ctx.fillStyle = i % 2 === 0 ? colA : colB;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(x0 * 0.6, -12, x0, 2);
    ctx.quadraticCurveTo((x0 + x1) * 0.5, 5.5, x1, 2);
    ctx.quadraticCurveTo(x1 * 0.6, -12, 0, -14);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = woodCol;
  ctx.beginPath();
  ctx.arc(0, -15, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** Realistic Surf Bather splashing in waves OR towel-drying on shoreline (সমুদ্রে চান করা ও গা মোছা) */
export function drawBeachBather(
  ctx: CanvasRenderingContext2D,
  x: number,
  surfWaterY: number,
  scale: number,
  tSec: number,
  phase: number,
  shirtRgb: RGB,
  amb: number,
  batherMode: 'swimming' | 'wading' | 'towel_drying' = 'swimming'
) {
  ctx.save();
  const isDryTowel = batherMode === 'towel_drying';
  const isWading = batherMode === 'wading';
  const bob = isDryTowel ? 0 : Math.sin(tSec * 2.8 + phase) * 3.0 * scale;
  const waveJump = isDryTowel ? 0 : Math.max(0, Math.sin(tSec * 1.6 + phase)) * (isWading ? 2.2 : 5.2) * scale;
  ctx.translate(x, surfWaterY + bob - waveJump);
  ctx.scale(scale, scale);

  const skinRgb = lerpRgb([48, 34, 26], [166, 114, 84], amb);
  const skinShade = lerpRgb(skinRgb, [24, 14, 10], 0.28);
  const shirtMidRgb = lerpRgb([24, 28, 38], shirtRgb, 0.3 + amb * 0.7);
  const shortsRgb = lerpRgb([14, 18, 26], [30, 44, 68], amb);
  const shortsShade = lerpRgb(shortsRgb, [8, 10, 14], 0.35);
  const skin = rgbCss(skinRgb);
  const shirt = rgbCss(shirtMidRgb);
  const shortsCol = rgbCss(shortsRgb);

  if (isDryTowel) {
    // Ground contact shadow on wet sand while towel-drying head/shoulders!
    ctx.fillStyle = 'rgba(6, 12, 20, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 9, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Standing wet tapered legs (thighs + calves + feet)
    drawSmoothLimb(ctx, -2.5, -10.5, -2.9, -5.2, 1.8, 1.4, skinRgb, skinShade);
    drawSmoothLimb(ctx, -2.9, -5.2, -3.2, 0.2, 1.4, 1.0, skinRgb, skinShade);
    drawSmoothLimb(ctx, 2.5, -10.5, 2.9, -5.2, 1.8, 1.4, skinRgb, skinShade);
    drawSmoothLimb(ctx, 2.9, -5.2, 3.2, 0.2, 1.4, 1.0, skinRgb, skinShade);

    ctx.fillStyle = shortsCol;
    ctx.beginPath();
    ctx.roundRect(-5, -15.5, 10, 6.5, 2);
    ctx.fill();

    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(-5, -27.5, 10, 13, 3.8);
    ctx.fill();

    // Raised tapered arms rubbing a bright coastal towel across wet hair & shoulders!
    const rub = Math.sin(tSec * 5.2 + phase) * 2.5;
    drawSmoothLimb(ctx, -4.2, -24.5, -7.2 + rub * 0.4, -29.8, 1.45, 1.15, skinRgb, skinShade);
    drawSmoothLimb(ctx, -7.2 + rub * 0.4, -29.8, -3.2 + rub, -34, 1.15, 0.85, skinRgb, skinShade);
    drawSmoothLimb(ctx, 4.2, -24.5, 7.2 + rub * 0.4, -29.8, 1.45, 1.15, skinRgb, skinShade);
    drawSmoothLimb(ctx, 7.2 + rub * 0.4, -29.8, 3.2 + rub, -34, 1.15, 0.85, skinRgb, skinShade);

    // Colorful striped beach towel draped over shoulders & head
    ctx.fillStyle = rgbCss(lerpRgb([48, 20, 16], [244, 114, 64], amb));
    ctx.beginPath();
    ctx.roundRect(-6.5 + rub * 0.6, -37, 13, 7, 2.2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillRect(-5.5 + rub * 0.6, -34, 11, 1.5);

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -31.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14171d';
    ctx.beginPath();
    ctx.arc(0, -32.4, 3.5, Math.PI, 0);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Submerged surf foam ring around knees/waist
  ctx.strokeStyle = `rgba(240, 250, 255, ${(0.58 + amb * 0.32).toFixed(2)})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, 1, 13 + Math.sin(tSec * 4 + phase) * 2.5, 3.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (isWading) {
    drawSmoothLimb(ctx, -2.5, -5, -2.9, 0.5, 1.9, 1.4, shortsRgb, shortsShade);
    drawSmoothLimb(ctx, 2.5, -5, 2.9, 0.5, 1.9, 1.4, shortsRgb, shortsShade);
  }

  const splashArm = Math.sin(tSec * 5.2 + phase) * 6;
  const wOff = isWading ? 4 : 0;
  drawSmoothLimb(ctx, -4.2, -9 - wOff, -7.2, -6.5 - splashArm * 0.45 - wOff * 0.8, 1.4, 1.12, skinRgb, skinShade);
  drawSmoothLimb(ctx, -7.2, -6.5 - splashArm * 0.45 - wOff * 0.8, -10.2, -4 - splashArm - wOff * 0.75, 1.12, 0.84, skinRgb, skinShade);
  drawSmoothLimb(ctx, 4.2, -9 - wOff, 7.2, -7.2 + splashArm * 0.35 - wOff * 0.8, 1.4, 1.12, skinRgb, skinShade);
  drawSmoothLimb(ctx, 7.2, -7.2 + splashArm * 0.35 - wOff * 0.8, 10.2, -6 + splashArm * 0.8 - wOff * 0.75, 1.12, 0.84, skinRgb, skinShade);

  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.roundRect(-5, -13 - wOff, 10, 14, 3.8);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -17 - wOff, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14171d';
  ctx.beginPath();
  ctx.arc(0, -18 - wOff, 3.5, Math.PI, 0);
  ctx.fill();

  ctx.restore();
}

/** Two coastal visitors playing lively beach-ball volley toss cleanly across dry golden beach */
export function drawBeachPlayers(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  tSec: number,
  dayWeight: number,
  sunlightFactor: number,
  windFactor: number,
  windSign: number
) {
  const tossCyc = (tSec * 0.58) % 2;
  const ballU = tossCyc < 1 ? tossCyc : 2 - tossCyc; // 0 -> 1 -> 0 smoothly between left & right player
  const span = 44 * scale;
  const p1X = centerX - span + Math.sin(tSec * 1.4) * 6 * scale;
  const p2X = centerX + span + Math.cos(tSec * 1.5) * 6 * scale;
  const ballX = lerp(p1X + 8 * scale, p2X - 8 * scale, ballU);
  const ballH = Math.sin(ballU * Math.PI) * 38 * scale;

  drawRealisticPerson(ctx, {
    x: p1X,
    y: groundY,
    facing: 1,
    scale: scale * 0.82,
    walkPhase: Math.sin(tSec * 3.1) * 0.35,
    outfit: 'shirt',
    coatRgb: [234, 88, 62],
    lowerRgb: [30, 48, 72],
    hasUmbrella: false,
    umbrellaRgb: [20, 20, 20],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight: 0,
    windFactor,
    windSign,
    fogWeight: 0,
    raisedArm: tossCyc < 0.28 || tossCyc > 1.72,
    action: 'looking',
    idleSec: tSec,
  });

  drawRealisticPerson(ctx, {
    x: p2X,
    y: groundY + 2 * scale,
    facing: -1,
    scale: scale * 0.85,
    walkPhase: Math.cos(tSec * 3.1) * 0.35,
    outfit: 'shirt',
    coatRgb: [14, 165, 233],
    lowerRgb: [28, 36, 52],
    hasUmbrella: false,
    umbrellaRgb: [20, 20, 20],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight: 0,
    windFactor,
    windSign,
    fogWeight: 0,
    raisedArm: tossCyc > 0.72 && tossCyc < 1.28,
    action: 'looking',
    idleSec: tSec + 1.1,
  });

  // Ground shadow + Colorful striped beach ball soaring between players
  ctx.save();
  ctx.fillStyle = 'rgba(8, 16, 24, 0.22)';
  ctx.beginPath();
  ctx.ellipse(ballX, groundY + 1, 5.2 * scale, 1.8 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const ballY = groundY - 18 * scale - ballH;
  ctx.translate(ballX, ballY);
  ctx.rotate(tSec * 2.4);
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(0, 0, 4.8 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 4.8 * scale, -0.5, 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#eab308';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 4.8 * scale, 1.6, 2.75);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Realistic anatomical Village Pond Duck (পাতিহাঁস / রাজহাঁস) with S-neck, layered wings, bill & occasional water dabble */
export function drawRealisticDuck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: 1 | -1,
  scale: number,
  tSec: number,
  seed: number,
  isDrake: boolean,
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * scale, scale);

  // V-shaped water wake ripple
  ctx.strokeStyle = `rgba(226, 244, 255, ${(0.34 + amb * 0.24).toFixed(2)})`;
  ctx.lineWidth = 1.05;
  ctx.beginPath();
  ctx.moveTo(-5, 2.5);
  ctx.lineTo(-17, -1);
  ctx.moveTo(-5, 3.5);
  ctx.lineTo(-16, 6.2);
  ctx.stroke();

  const bodyCol = isDrake
    ? rgbCss(lerpRgb([74, 78, 86], [198, 204, 214], amb))
    : rgbCss(lerpRgb([142, 146, 152], [248, 250, 252], amb));
  const wingCol = isDrake
    ? rgbCss(lerpRgb([44, 48, 56], [122, 114, 102], amb))
    : rgbCss(lerpRgb([112, 118, 126], [220, 226, 234], amb));
  const headCol = isDrake
    ? rgbCss(lerpRgb([10, 32, 24], [22, 108, 68], amb))
    : bodyCol;

  const dabble = Math.max(0, Math.sin(tSec * 0.85 + seed)) > 0.88 ? 1 : 0;

  // Plump feathered swimming body with upturned tail
  ctx.fillStyle = bodyCol;
  ctx.beginPath();
  ctx.moveTo(-9, 0.5);
  ctx.lineTo(-12.5, -3.5); // crisp upturned duck tail!
  ctx.lineTo(-6, -2.5);
  ctx.quadraticCurveTo(0, -4.5, 6.5, -1.5);
  ctx.quadraticCurveTo(8, 2.5, 0, 3.2);
  ctx.quadraticCurveTo(-7, 3.2, -9, 0.5);
  ctx.closePath();
  ctx.fill();

  // Folded overlapping wing feather contour
  ctx.fillStyle = wingCol;
  ctx.beginPath();
  ctx.ellipse(-1.2, -0.6, 5.4, 2.3, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Graceful S-curved neck + head (either upright or dipping bill into pond!)
  ctx.strokeStyle = headCol;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4.5, -1);
  if (dabble) {
    ctx.quadraticCurveTo(8.5, -2.5, 9.5, 2.2);
    ctx.stroke();
    ctx.fillStyle = headCol;
    ctx.beginPath();
    ctx.arc(10.2, 2.6, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.bezierCurveTo(7.2, -2.5, 5.2, -6.8, 7.2, -8.5);
    ctx.stroke();
    ctx.fillStyle = headCol;
    ctx.beginPath();
    ctx.ellipse(7.8, -8.8, 2.7, 2.2, 0.08, 0, Math.PI * 2);
    ctx.fill();

    // Flat rounded orange duck bill + eye glint
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(10.0, -9.4);
    ctx.lineTo(13.8, -8.4);
    ctx.quadraticCurveTo(14.2, -7.2, 10.0, -7.4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(8.6, -9.2, 0.65, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Graceful Hill / Barking Deer (মায়া হরিণ) walking calmly, smoothly grazing, or lying curled resting — zero jittery jerks */
export function drawMountainDeer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  tSec: number,
  walkSpeedNorm: number,
  isGrazing: boolean,
  amb: number,
  isResting = false
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);

  const coat = rgbCss(lerpRgb([48, 28, 16], [176, 106, 54], amb));
  const coatDark = rgbCss(lerpRgb([30, 18, 10], [126, 72, 34], amb));
  const belly = rgbCss(lerpRgb([72, 58, 44], [234, 212, 182], amb));

  if (isResting) {
    ctx.fillStyle = 'rgba(6, 12, 8, 0.34)';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, 16, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Folded legs resting peacefully in grass
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.ellipse(-6, -2.2, 6.2, 2.6, 0.12, 0, Math.PI * 2);
    ctx.ellipse(6, -1.8, 5.5, 2.2, -0.1, 0, Math.PI * 2);
    ctx.fill();
    // Curled sleeping/resting torso & gentle breathing neck
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(0, -6.5, 13.5, 6.0, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = coat;
    ctx.lineWidth = 4.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(9, -8);
    ctx.lineTo(13, -15 + Math.sin(tSec * 1.1) * 0.5);
    ctx.stroke();
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(15, -16, 4.4, 2.4, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(12.2, -19.5, 1.3, 3.3, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(6, 12, 8, 0.34)';
  ctx.beginPath();
  ctx.ellipse(0, 1.5, 16, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const stride = walkSpeedNorm > 0.05 ? Math.sin(tSec * 4.4) * 5.2 : 0;

  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  [
    { x: -9, sx: -stride, col: coatDark },
    { x: 9, sx: stride, col: coatDark },
    { x: -7, sx: stride, col: coat },
    { x: 11, sx: -stride, col: coat },
  ].forEach((lg) => {
    ctx.strokeStyle = lg.col;
    ctx.beginPath();
    ctx.moveTo(lg.x, -16);
    ctx.lineTo(lg.x + lg.sx * 0.5, -8);
    ctx.lineTo(lg.x + lg.sx, 0);
    ctx.stroke();
  });

  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, -17, 13.5, 6.2, -0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(1, -13.5, 9.5, 2.4, 0, 0, Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-13.5, -18, 2.8, 1.4, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(254, 243, 199, ${(0.55 * amb + 0.15).toFixed(2)})`;
  [
    { sx: -4, sy: -19 },
    { sx: 1, sy: -17 },
    { sx: 5, sy: -19.5 },
    { sx: -2, sy: -15 },
  ].forEach((sp) => {
    ctx.beginPath();
    ctx.arc(sp.sx, sp.sy, 1.15, 0, Math.PI * 2);
    ctx.fill();
  });

  const neckDip = isGrazing ? 0.92 + Math.sin(tSec * 1.1) * 0.03 : 0.04 * Math.sin(tSec * 0.7);
  ctx.save();
  ctx.translate(10, -19);
  ctx.rotate(neckDip);

  ctx.strokeStyle = coat;
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(5.5, -11);
  ctx.stroke();

  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(8, -12, 4.6, 2.5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4.5, -16, 1.4, 3.6, -0.35, 0, Math.PI * 2);
  ctx.ellipse(6.5, -15.8, 1.3, 3.4, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(8.8, -12.6, 0.8, 0, Math.PI * 2);
  ctx.arc(12.2, -11.4, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** Nimble Three-Striped / Russet Highland Squirrel (কাঠবিড়ালি) scampering on trunks or perched nibbling a wild acorn */
export function drawMountainSquirrel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  tSec: number,
  isClimbing: boolean,
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);
  if (isClimbing) ctx.rotate(-1.25);

  const fur = rgbCss(lerpRgb([46, 30, 18], [164, 102, 52], amb));
  const cream = rgbCss(lerpRgb([68, 56, 44], [234, 214, 178], amb));
  const stripe = rgbCss(lerpRgb([22, 14, 10], [72, 42, 22], amb));
  const wag = Math.sin(tSec * 4.5) * 0.16;

  // Fluffy S-curved bushy tail
  ctx.save();
  ctx.rotate(wag);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(-4, -3);
  ctx.bezierCurveTo(-15, -5, -18, -19, -8, -21);
  ctx.bezierCurveTo(-12, -16, -9, -8, -2, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (isClimbing) {
    const hop = Math.sin(tSec * 9.5) * 2.5;
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, -4, 7.5, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cream;
    ctx.fillRect(-4, -2, 8, 1.6);
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(7, -5, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fur;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(-6 - hop, 1);
    ctx.moveTo(4, -2);
    ctx.lineTo(6 + hop, 1);
    ctx.stroke();
  } else {
    // Perched upright sitting on branch nibbling nut!
    const nibble = Math.sin(tSec * 7.5) * 0.9;
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, -5, 4.4, 6.2, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = stripe;
    ctx.fillRect(-3.2, -9, 1.5, 7);
    ctx.fillStyle = cream;
    ctx.beginPath();
    ctx.ellipse(2.6, -5, 2.0, 4.2, 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(2.5, -12, 3.0, 0, Math.PI * 2);
    ctx.fill();
    // Pointed ear tuft + tiny dark eye
    ctx.beginPath();
    ctx.ellipse(0.8, -15, 1.1, 2.1, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(3.6, -12.4, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Forepaws holding forest nut at mouth
    ctx.strokeStyle = fur;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(2.5, -8);
    ctx.lineTo(6.2, -10.2 + nibble);
    ctx.stroke();
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.arc(7.0, -10.4 + nibble, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Playful Hill Rhesus Macaque / Monkey (বানর) climbing tree limbs, sitting & eating forest wild fruit, or huddled in rain/night */
export function drawMountainMonkey(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  tSec: number,
  activity: 'climbing' | 'eating' | 'resting',
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);

  const fur = rgbCss(lerpRgb([44, 34, 24], [156, 118, 72], amb));
  const furDark = rgbCss(lerpRgb([28, 20, 14], [108, 78, 44], amb));
  const faceCol = rgbCss(lerpRgb([68, 48, 38], [226, 174, 148], amb));

  // Long articulated curved tail draping down or curling behind
  ctx.strokeStyle = furDark;
  ctx.lineWidth = 2.0;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, -3);
  const tailSway = Math.sin(tSec * 2.1) * 4;
  ctx.bezierCurveTo(-15, -1 + tailSway * 0.4, -17, -14 + tailSway, -11, -18 + tailSway);
  ctx.stroke();

  if (activity === 'resting') {
    // Huddled quietly tucked in sheltered inner tree fork during rain/night
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, -6, 6.2, 6.8, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = faceCol;
    ctx.beginPath();
    ctx.arc(3.5, -10.5, 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (activity === 'climbing') {
    const reach = Math.sin(tSec * 5.2) * 3.5;
    ctx.strokeStyle = furDark;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(-9 - reach, 1);
    ctx.moveTo(4, -7);
    ctx.lineTo(10 + reach, -1);
    ctx.stroke();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, -7, 8.2, 4.4, -0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(8.2, -9.8, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = faceCol;
    ctx.beginPath();
    ctx.ellipse(9.5, -9.4, 2.3, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(10.2, -10.0, 0.7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Perched seated comfortably on thick bough munching wild forest fruit!
    const biteLift = 0.5 + 0.5 * Math.sin(tSec * 2.8);
    ctx.strokeStyle = furDark;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(1, -4);
    ctx.lineTo(6, -3);
    ctx.lineTo(4, 2);
    ctx.stroke();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(-1, -8, 5.2, 7.6, 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(2.5, -17.5, 4.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = faceCol;
    ctx.beginPath();
    ctx.ellipse(4.0, -17.0, 2.5, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(-0.5, -18.2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(4.8, -17.6, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Raised hand bringing fruit to mouth
    const handX = 7.2 - biteLift * 1.4;
    const handY = -12.5 - biteLift * 3.8;
    ctx.strokeStyle = fur;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(2.0, -11.5);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(handX + 1.2, handY, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Bangladeshi Seasonal Crop Harvester (ধান/গম কাটা কৃষক):
 * - 'reaping': farmer in lungi & gamcha bending forward cutting ripe stalks with a curved metallic sickle (কাস্তে)
 * - 'carrying_sheaf': farmer walking along bund carrying a tied golden bundle of grain (আঁটি) on shoulder/head
 */
export function drawFarmerHarvestingPaddy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  tSec: number,
  task: 'reaping' | 'carrying_sheaf',
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);

  const skinRgb = lerpRgb([48, 32, 24], [156, 102, 74], amb);
  const skinShade = lerpRgb(skinRgb, [22, 14, 10], 0.28);
  const shirtRgb = lerpRgb([22, 28, 34], [198, 206, 212], amb);
  const lungiRgb = lerpRgb([14, 24, 20], [42, 92, 68], amb);
  const lungiShade = lerpRgb(lungiRgb, [8, 12, 10], 0.35);
  const skin = rgbCss(skinRgb);
  const shirt = rgbCss(shirtRgb);
  const gamcha = rgbCss(lerpRgb([44, 16, 16], [196, 46, 52], amb));
  const sheafGold = rgbCss(lerpRgb([64, 52, 16], [234, 192, 58], amb));
  const sheafShade = rgbCss(lerpRgb([42, 34, 10], [176, 134, 34], amb));

  if (task === 'reaping') {
    const cutWave = Math.sin(tSec * 2.8);
    // Squatting/bent continuous tapered leg stance in field
    drawSmoothLimb(ctx, -3.5, -14, -7, -7, 2.3, 1.7, lungiRgb, lungiShade);
    drawSmoothLimb(ctx, -7, -7, -5, 0, 1.7, 1.25, skinRgb, skinShade);
    drawSmoothLimb(ctx, 2, -14, 5, -7, 2.3, 1.7, lungiRgb, lungiShade);
    drawSmoothLimb(ctx, 5, -7, 4, 0, 1.7, 1.25, skinRgb, skinShade);

    // Bent torso leaning over golden grain stalks
    ctx.save();
    ctx.translate(0, -14);
    ctx.rotate(0.68 + cutWave * 0.08);
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(-4.2, -13, 8.5, 14, 3.8);
    ctx.fill();

    // Head with wrapped red-check gamcha headband
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0.5, -16.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gamcha;
    ctx.beginPath();
    ctx.arc(0.2, -17.8, 3.8, Math.PI, 0);
    ctx.fill();

    // Articulated shoulder -> elbow -> wrist swinging sickle cleanly through stalks
    const armSweep = cutWave * 4.5;
    drawSmoothLimb(ctx, 2, -10.5, 5.6 + armSweep * 0.2, -7.8 + armSweep * 0.15, 1.45, 1.15, skinRgb, skinShade);
    drawSmoothLimb(ctx, 5.6 + armSweep * 0.2, -7.8 + armSweep * 0.15, 9.2 + armSweep * 0.4, -5 + armSweep * 0.3, 1.15, 0.85, skinRgb, skinShade);

    // Curved metallic sickle (কাস্তে)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(12 + armSweep * 0.4, -3 + armSweep * 0.3, 4.5, -Math.PI * 0.3, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  } else {
    // Walking farmer carrying heavy golden harvested sheaf (ধানের আঁটি) on shoulder with continuous thigh->knee->ankle!
    const stride = Math.sin(tSec * 5.2) * 5.8;
    const kneeL = -stride * 0.5 + 1.4;
    const kneeR = stride * 0.5 + 1.4;
    drawSmoothLimb(ctx, -1, -17, kneeL, -8.5, 2.3, 1.65, lungiRgb, lungiShade);
    drawSmoothLimb(ctx, kneeL, -8.5, -stride, 0, 1.65, 1.1, skinShade, lerpRgb(skinShade, [10, 8, 8], 0.25));
    drawSmoothLimb(ctx, 1, -17, kneeR, -8.5, 2.3, 1.65, lungiRgb, lungiShade);
    drawSmoothLimb(ctx, kneeR, -8.5, stride, 0, 1.65, 1.1, skinRgb, skinShade);

    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(-4, -31, 8.5, 15, 3.8);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0.5, -34.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gamcha;
    ctx.beginPath();
    ctx.arc(0.2, -35.8, 3.8, Math.PI, 0);
    ctx.fill();

    // Large golden grain sheaf resting on shoulder, tied with straw rope in middle!
    ctx.save();
    ctx.translate(-1, -33);
    ctx.rotate(-0.18 + Math.sin(tSec * 5.2) * 0.03);
    ctx.fillStyle = sheafShade;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 14.5, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sheafGold;
    ctx.beginPath();
    ctx.ellipse(2, -1.5, 13.5, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.restore();

    // Hand reaching up cleanly through elbow to steady sheaf
    drawSmoothLimb(ctx, 2, -28, 4.8, -29.5, 1.45, 1.15, skinRgb, skinShade);
    drawSmoothLimb(ctx, 4.8, -29.5, 5.2, -33.2, 1.15, 0.85, skinRgb, skinShade);
  }

  ctx.restore();
}

/** Realistic Courtyard Hen & Fluffy Chicks (দেশি মুরগি ও ছানা) pecking grain around Bengali village yards */
export function drawCourtyardHens(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  tSec: number,
  amb: number
) {
  ctx.save();
  const henWalk = Math.sin(tSec * 0.55) * 14 * scale;
  const henDir: 1 | -1 = Math.cos(tSec * 0.55) >= 0 ? 1 : -1;
  const hx = centerX + henWalk;
  const hy = groundY;
  const peck = Math.max(0, Math.sin(tSec * 5.2)) > 0.72 ? 1 : 0;

  // Mother Hen
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(henDir * scale, scale);
  ctx.fillStyle = 'rgba(8, 12, 10, 0.24)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 8, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-2, -3);
  ctx.lineTo(-2, 0.5);
  ctx.moveTo(2, -3);
  ctx.lineTo(2, 0.5);
  ctx.stroke();

  const henCol = rgbCss(lerpRgb([48, 24, 14], [174, 78, 34], amb));
  const henWing = rgbCss(lerpRgb([32, 16, 10], [134, 54, 22], amb));
  ctx.fillStyle = henCol;
  ctx.beginPath();
  ctx.ellipse(0, -5.5, 6.8, 4.4, -0.1, 0, Math.PI * 2);
  ctx.fill();
  // Tail feathers
  ctx.beginPath();
  ctx.moveTo(-5.5, -7);
  ctx.lineTo(-10, -11.5);
  ctx.lineTo(-7, -4.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = henWing;
  ctx.beginPath();
  ctx.ellipse(-0.5, -5.2, 4.2, 2.5, 0.1, 0, Math.PI * 2);
  ctx.fill();

  const headX = peck ? 8.2 : 6.2;
  const headY = peck ? -3.0 : -10.2;
  ctx.fillStyle = henCol;
  ctx.beginPath();
  ctx.arc(headX, headY, 2.4, 0, Math.PI * 2);
  ctx.fill();
  // Red comb & yellow beak
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(headX - 0.3, headY - 2.4, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(headX + 2.0, headY - 0.5);
  ctx.lineTo(headX + 4.4, headY + 0.3);
  ctx.lineTo(headX + 2.0, headY + 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Two tiny fluffy chicks trailing mother hen
  [0, 1].forEach((ci) => {
    const cx = hx - henDir * (10 + ci * 8) * scale + Math.sin(tSec * 2.4 + ci * 1.9) * 3 * scale;
    const cy = hy + (ci === 0 ? 1.5 : -0.5) * scale;
    const cPeck = Math.sin(tSec * 6.5 + ci * 2.1) > 0.65 ? 1 : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(henDir * scale * 0.7, scale * 0.7);
    ctx.fillStyle = rgbCss(lerpRgb([74, 58, 16], [244, 198, 62], amb));
    ctx.beginPath();
    ctx.arc(0, -3.5, 3.0, 0, Math.PI * 2);
    ctx.arc(2.6, cPeck ? -2.2 : -5.8, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  ctx.restore();
}

/** Realistic Grazing Native Bangladeshi Cow (দেশি গরু) with hump, horns, dewlap & swishing tail */
export function drawGrazingCow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  tSec: number,
  isGrazing: boolean,
  coatRgb: RGB,
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);

  const coat = rgbCss(lerpRgb([28, 22, 18], coatRgb, amb));
  const coatDark = rgbCss(lerpRgb([16, 12, 10], lerpRgb(coatRgb, [24, 18, 14], 0.4), amb));
  const hornCol = rgbCss(lerpRgb([48, 44, 38], [218, 210, 190], amb));

  ctx.fillStyle = 'rgba(6, 10, 8, 0.30)';
  ctx.beginPath();
  ctx.ellipse(0, 1.5, 19, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Four legs anchored cleanly on meadow
  ctx.strokeStyle = coatDark;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  [-11, 9].forEach((lx) => {
    ctx.beginPath();
    ctx.moveTo(lx, -13);
    ctx.lineTo(lx - 0.5, 0);
    ctx.stroke();
  });
  ctx.strokeStyle = coat;
  [-8.5, 11.5].forEach((lx) => {
    ctx.beginPath();
    ctx.moveTo(lx, -13);
    ctx.lineTo(lx + 0.5, 0);
    ctx.stroke();
  });

  // Swishing tail
  const tailWag = Math.sin(tSec * 2.8 + x * 0.05) * 3.5;
  ctx.strokeStyle = coatDark;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-14, -18);
  ctx.quadraticCurveTo(-18, -11, -16 + tailWag, -4);
  ctx.stroke();

  // Body + native Zebu shoulder hump
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, -16.5, 14.5, 7.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(8.5, -22, 4.6, 0, Math.PI * 2);
  ctx.fill();

  // Neck & head dipping down to graze or held calm
  const headAng = isGrazing ? 0.58 + Math.sin(tSec * 1.4) * 0.05 : 0.06 * Math.sin(tSec * 0.9);
  ctx.save();
  ctx.translate(12, -19);
  ctx.rotate(headAng);
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(5, 0, 6.2, 3.6, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(10.5, 1.5, 4.4, 3.0, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Curved horns + ear + dark eye
  ctx.strokeStyle = hornCol;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(8.5, -1.2);
  ctx.quadraticCurveTo(6.5, -5.5, 9.2, -6.5);
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(10.2, 0.6, 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** Traditional Bangladeshi Field Scarecrow (কাকতাড়ুয়া) swaying in wind inside paddy/wheat plots */
export function drawFieldScarecrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  tSec: number,
  windFactor: number,
  windSign: number,
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const sway = windSign * (0.04 + windFactor * 0.09) + Math.sin(tSec * 1.9 + x * 0.03) * 0.03;
  ctx.rotate(sway);

  const bamboo = rgbCss(lerpRgb([28, 22, 16], [124, 96, 56], amb));
  const shirt = rgbCss(lerpRgb([38, 22, 18], [186, 62, 54], amb));
  const potCol = rgbCss(lerpRgb([24, 22, 22], [58, 52, 48], amb));

  // Bamboo post & crossbar arms
  ctx.strokeStyle = bamboo;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -34);
  ctx.moveTo(-14, -22);
  ctx.lineTo(14, -22);
  ctx.stroke();

  // Tattered hanging shirt
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(-12, -23);
  ctx.lineTo(12, -23);
  ctx.lineTo(10, -17);
  ctx.lineTo(5, -18);
  ctx.lineTo(6, -9);
  ctx.lineTo(-6, -9);
  ctx.lineTo(-5, -18);
  ctx.lineTo(-10, -17);
  ctx.closePath();
  ctx.fill();

  // Inverted black earthen clay pot head (`হাঁড়ি`) with white lime spots
  ctx.fillStyle = potCol;
  ctx.beginPath();
  ctx.arc(0, -29.5, 4.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(241, 245, 249, ${(0.55 * amb + 0.2).toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(-1.8, -30, 1.0, 0, Math.PI * 2);
  ctx.arc(1.8, -30, 1.0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Seated Riverbank Angler fishing with curved bamboo rod & floating bobber (`ছিপ দিয়ে মাছ ধরা`) */
export function drawRiverAngler(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  scale: number,
  tSec: number,
  amb: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);

  const skinRgb = lerpRgb([48, 32, 24], [156, 108, 78], amb);
  const skinShade = lerpRgb(skinRgb, [22, 14, 10], 0.28);
  const lungiRgb = lerpRgb([14, 24, 20], [44, 96, 114], amb);
  const lungiShade = lerpRgb(lungiRgb, [8, 12, 12], 0.35);
  const skin = rgbCss(skinRgb);
  const shirt = rgbCss(lerpRgb([22, 28, 36], [198, 206, 214], amb));
  const rodTug = Math.max(0, Math.sin(tSec * 0.45) - 0.82) * 5.5;

  // Seated body on bank slope
  ctx.fillStyle = 'rgba(6, 10, 14, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1.5, 9, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  drawSmoothLimb(ctx, 0, -4.5, 6.8, -3.2, 2.2, 1.75, lungiRgb, lungiShade);
  drawSmoothLimb(ctx, 6.8, -3.2, 8.0, 1.6, 1.55, 1.05, skinRgb, skinShade);

  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.roundRect(-4.5, -18, 9, 14, 3.8);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0.5, -21.5, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14171d';
  ctx.beginPath();
  ctx.arc(0, -22.5, 3.3, Math.PI * 0.8, Math.PI * 2.1);
  ctx.fill();

  // Bamboo fishing rod (`ছিপ`) curving forward over water
  const tipX = 36;
  const tipY = -28 - rodTug * 6;
  ctx.strokeStyle = rgbCss(lerpRgb([28, 22, 16], [136, 102, 58], amb));
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(4, -12);
  ctx.quadraticCurveTo(22, -26 - rodTug * 3, tipX, tipY);
  ctx.stroke();

  // Smooth tapered arm holding rod
  drawSmoothLimb(ctx, 2, -14.5, 4.8, -13.2, 1.35, 1.1, skinRgb, skinShade);
  drawSmoothLimb(ctx, 4.8, -13.2, 7.2, -14, 1.1, 0.85, skinRgb, skinShade);

  // Fishing line dipping to bobber on water below
  const bobY = -2 + Math.sin(tSec * 3.5) * (0.8 + rodTug * 1.4);
  ctx.strokeStyle = 'rgba(226, 240, 255, 0.45)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + 2, bobY);
  ctx.stroke();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(tipX + 2, bobY, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Authentic Cox's Bazar Curved-Prow Sampan Boat (`সাম্পান`) anchored rocking gently in coastal surf */
export function drawAnchoredSampan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  tSec: number,
  amb: number,
  lightGlow: number
) {
  ctx.save();
  ctx.translate(x, y + Math.sin(tSec * 1.6) * 2.2);
  ctx.rotate(Math.sin(tSec * 1.4) * 0.045);
  ctx.scale(scale, scale);

  ctx.fillStyle = 'rgba(8, 18, 28, 0.26)';
  ctx.beginPath();
  ctx.ellipse(0, 6, 32, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Curved up-swept Sampan wooden hull with colorful coastal stripe
  const hull = rgbCss(lerpRgb([18, 14, 12], [68, 42, 28], amb));
  const stripe = rgbCss(lerpRgb([28, 18, 14], [218, 86, 42], amb));
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-36, -12);
  ctx.quadraticCurveTo(-18, 7, 0, 6);
  ctx.quadraticCurveTo(22, 6, 38, -14);
  ctx.quadraticCurveTo(18, -3, 0, -4);
  ctx.quadraticCurveTo(-18, -3, -36, -12);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = stripe;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(-29, -8);
  ctx.quadraticCurveTo(0, 1, 31, -9);
  ctx.stroke();

  // Bamboo pole + hanging dusk/night hariken lantern with warm water reflection
  ctx.strokeStyle = rgbCss(lerpRgb([24, 18, 14], [116, 88, 56], amb));
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(6, -3);
  ctx.lineTo(6, -25);
  ctx.lineTo(9, -25);
  ctx.stroke();

  if (lightGlow > 0.08) {
    const flicker = 0.92 + 0.08 * Math.sin(tSec * 3.8 + x * 0.05);
    const gInt = clamp01(lightGlow * 1.15) * flicker;
    const lx = 9;
    const ly = -21;
    const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 36);
    lg.addColorStop(0, `rgba(255, 232, 156, ${(0.80 * gInt).toFixed(2)})`);
    lg.addColorStop(0.32, `rgba(246, 172, 54, ${(0.38 * gInt).toFixed(2)})`);
    lg.addColorStop(1, 'rgba(234, 148, 42, 0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(lx, ly, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#292524';
    ctx.fillRect(lx - 1.6, ly - 2.3, 3.2, 0.9);
    ctx.fillRect(lx - 1.8, ly + 1.6, 3.6, 0.9);
    ctx.fillStyle = `rgba(255, 246, 206, ${(0.92 * gInt).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 1.5, 2.0, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let r = 0; r < 4; r++) {
      const rw = 9 - r * 1.5;
      ctx.fillStyle = `rgba(251, 192, 76, ${((0.36 - r * 0.06) * gInt).toFixed(2)})`;
      ctx.fillRect(lx - rw * 0.5 + Math.sin(tSec * 2.2 + r) * 2, 7 + r * 3.6, rw, 1.5);
    }
  }

  ctx.restore();
}

/** Boatmen & Fishermen resting ashore on the calm riverbank after finishing fishing */
export function drawRestingFishermen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  tSec: number,
  dayWeight: number,
  sunlightFactor: number,
  windFactor: number,
  windSign: number
) {
  const amb = 0.24 + dayWeight * 0.76;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Wooden oar & folded cast net resting on the clay bank beside a woven bamboo fish basket (`খাঁচা`)
  ctx.strokeStyle = rgbCss(lerpRgb([22, 16, 12], [118, 86, 52], amb));
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(-24, 3);
  ctx.lineTo(14, -4);
  ctx.stroke();
  ctx.fillStyle = rgbCss(lerpRgb([26, 18, 12], [148, 108, 56], amb));
  ctx.beginPath();
  ctx.ellipse(15, -4.5, 6.2, 2.2, -0.18, 0, Math.PI * 2);
  ctx.fill();

  // Woven bamboo fish basket (`খাঁচা`)
  ctx.fillStyle = 'rgba(6, 10, 14, 0.25)';
  ctx.beginPath();
  ctx.ellipse(2, 3.2, 8.2, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgbCss(lerpRgb([32, 24, 14], [166, 126, 68], amb));
  ctx.beginPath();
  ctx.ellipse(2, -1.5, 6.5, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgbCss(lerpRgb([14, 12, 10], [42, 30, 18], amb));
  ctx.beginPath();
  ctx.ellipse(2, -5.2, 4.2, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Fisherman 1 seated peacefully facing river breeze
  drawRealisticPerson(ctx, {
    x: x - 14 * scale,
    y: y + 2 * scale,
    facing: 1,
    scale: scale * 0.88,
    walkPhase: 0,
    outfit: 'lungi',
    coatRgb: [212, 218, 224],
    lowerRgb: [36, 92, 108],
    hasUmbrella: false,
    umbrellaRgb: [20, 20, 20],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight: 0,
    windFactor,
    windSign,
    fogWeight: 0,
    action: 'sitting_bench',
    idleSec: tSec,
  });

  // Fisherman 2 seated relaxed chatting beside basket
  drawRealisticPerson(ctx, {
    x: x + 15 * scale,
    y: y + 3 * scale,
    facing: -1,
    scale: scale * 0.86,
    walkPhase: 0,
    outfit: 'lungi',
    coatRgb: [188, 102, 74],
    lowerRgb: [46, 78, 64],
    hasUmbrella: false,
    umbrellaRgb: [20, 20, 20],
    dayWeight,
    sunlightFactor,
    moonVis: 0,
    rainWeight: 0,
    windFactor,
    windSign,
    fogWeight: 0,
    action: 'sitting_bench',
    idleSec: tSec + 1.8,
  });
}






