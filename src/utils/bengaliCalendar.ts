import { toBengaliDigits } from './rajshahiWeather';

export type BengalSixSeason =
  | 'grishmo'   // গ্রীষ্ম (বৈশাখ - জ্যৈষ্ঠ)
  | 'barsha'    // বর্ষা (আষাঢ় - শ্রাবণ)
  | 'sharat'    // শরৎ (ভাদ্র - আশ্বিন)
  | 'hemonto'   // হেমন্ত (কার্তিক - অগ্রহায়ণ)
  | 'sheet'     // শীত (পৌষ - মাঘ)
  | 'basanta';  // বসন্ত (ফাল্গুন - চৈত্র)

export type PaddyCropStage = 'seedling' | 'growing' | 'ripening' | 'harvesting' | 'stubble';
export type WheatCropStage = 'none' | 'green' | 'golden' | 'harvesting';
export type MaizeCropStage = 'none' | 'growing' | 'cobs';
export type JuteCropStage = 'none' | 'sprout' | 'tall';

export interface BengaliCalendarState {
  banglaYear: number;
  monthIndex: number; // 0 = বৈশাখ ... 11 = চৈত্র
  monthNameBn: string;
  dayOfMonth: number;
  dayOfBanglaYear: number; // 1..365
  yearProgress: number;    // 0..1 continuous across the entire year
  season: BengalSixSeason;
  seasonNameBn: string;
  formattedDateBn: string;
  // Continuous day-by-day 0..1 seasonal phenology weights for flora, foliage, blooms & fruit
  summerBloomWeight: number;   // কৃষ্ণচূড়া, আম-কাঁঠাল, তীব্র রোদের সোনালি ভাব
  monsoonVineWeight: number;   // ঘন সবুজ লতাপাতা, কদম ফুল, ভেজা প্রাণবন্ত প্রকৃতি
  autumnKashWeight: number;    // সাদা কাশফুল, স্বচ্ছ নীল-সাদা আবহ
  harvestGoldWeight: number;   // পাকা সোনালি ধান, ভোরের শিশির
  winterShedWeight: number;    // পাতা ঝরা, পাতলা ডালপালা, হলুদ সর্ষে ফুল, হিমেল ধোঁয়াশা
  springNewLeafWeight: number; // কচি সবুজ পাতা, শিমুল-পলাশ ফুল, ঝরা পাপড়ি
  // Authentic monthly agricultural & botanical lifecycle stages
  paddyStage: PaddyCropStage;
  wheatStage: WheatCropStage;
  mustardWeight: number;
  maizeStage: MaizeCropStage;
  juteStage: JuteCropStage;
  mangoFruitWeight: number;
  palmSapPotActive: boolean;
}

export const BENGALI_MONTHS_BN = [
  'বৈশাখ',
  'জ্যৈষ্ঠ',
  'আষাঢ়',
  'শ্রাবণ',
  'ভাদ্র',
  'আশ্বিন',
  'কার্তিক',
  'অগ্রহায়ণ',
  'পৌষ',
  'মাঘ',
  'ফাল্গুন',
  'চৈত্র',
] as const;

const SEASON_NAMES_BN: Record<BengalSixSeason, string> = {
  grishmo: 'গ্রীষ্মকাল',
  barsha: 'বর্ষাকাল',
  sharat: 'শরৎকাল',
  hemonto: 'হেমন্তকাল',
  sheet: 'শীতকাল',
  basanta: 'বসন্তকাল',
};

function isGregorianLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * বাংলা একাডেমি সংশোধিত পঞ্জিকা অনুসারে গ্রেগরিয়ান তারিখ -> বঙ্গাব্দ তারিখ ও ৬ ঋতু
 */
export function getBengaliDateInfo(date: Date = new Date()): {
  banglaYear: number;
  monthIndex: number;
  dayOfMonth: number;
  dayOfBanglaYear: number;
} {
  const gYear = date.getFullYear();
  const pohelaBoishakhThisYear = new Date(gYear, 3, 14); // April 14
  const todayMidnight = new Date(gYear, date.getMonth(), date.getDate());

  let startYear = gYear;
  let pohela = pohelaBoishakhThisYear;
  if (todayMidnight < pohelaBoishakhThisYear) {
    startYear = gYear - 1;
    pohela = new Date(startYear, 3, 14);
  }

  const banglaYear = startYear - 593;
  const elapsedDays = Math.floor(
    (todayMidnight.getTime() - pohela.getTime()) / (24 * 60 * 60 * 1000)
  );

  // Standard revised: Boishakh-Ashwin 31*6=186, Kartik-Magh 30*4=120, Falgun 29/30, Chaitra 30
  const falgunDays = isGregorianLeapYear(startYear + 1) ? 30 : 29;
  const chaitraDays = 30;
  const monthLengths = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, falgunDays, chaitraDays];

  let remaining = elapsedDays;
  let monthIndex = 0;
  for (let i = 0; i < monthLengths.length; i++) {
    if (remaining < monthLengths[i]) {
      monthIndex = i;
      break;
    }
    remaining -= monthLengths[i];
    if (i === monthLengths.length - 1) {
      monthIndex = 11;
    }
  }

  return {
    banglaYear,
    monthIndex,
    dayOfMonth: Math.max(1, remaining + 1),
    dayOfBanglaYear: Math.max(1, Math.min(365, elapsedDays + 1)),
  };
}

function circularBell(pos01: number, center01: number, width01: number): number {
  let d = Math.abs(pos01 - center01);
  if (d > 0.5) d = 1 - d;
  const t = Math.max(0, 1 - d / width01);
  return t * t * (3 - 2 * t);
}

/**
 * দিনের পর দিন পরিবর্তনশীল বাংলা মাসের ঋতুচক্র ও কৃষি-উদ্ভিদ পঞ্জিকা (সারা বছর ৩৬৫ দিন ধরে ফসল, পাতা ঝরা, ফুল, ফল বদলায়)
 * - overrideMonthIndex দিলে ব্যবহারকারী যেকোনো বাংলা মাসের প্রকৃতি তাৎক্ষণিক দেখতে পারবেন
 */
export function computeBengaliPhenology(
  now: Date = new Date(),
  overrideMonthIndex: number | null = null
): BengaliCalendarState {
  const baseInfo = getBengaliDateInfo(now);
  const monthIndex =
    overrideMonthIndex !== null && overrideMonthIndex >= 0 && overrideMonthIndex <= 11
      ? overrideMonthIndex
      : baseInfo.monthIndex;

  const dayOfMonth = overrideMonthIndex !== null ? 15 : baseInfo.dayOfMonth;
  const dayOfBanglaYear =
    overrideMonthIndex !== null ? Math.round((overrideMonthIndex + 0.5) * (365 / 12)) : baseInfo.dayOfBanglaYear;
  const yearProgress = (dayOfBanglaYear - 1) / 365;

  const seasonOrder: BengalSixSeason[] = [
    'grishmo',
    'grishmo',
    'barsha',
    'barsha',
    'sharat',
    'sharat',
    'hemonto',
    'hemonto',
    'sheet',
    'sheet',
    'basanta',
    'basanta',
  ];
  const season = seasonOrder[monthIndex] ?? 'grishmo';

  // Smooth overlapping day-by-day curves across the 12-month cycle (0.0 = 1st Boishakh)
  const summerBloomWeight = circularBell(yearProgress, 1.0 / 12, 0.16);
  const monsoonVineWeight = circularBell(yearProgress, 3.0 / 12, 0.18);
  const autumnKashWeight = circularBell(yearProgress, 5.0 / 12, 0.15);
  const harvestGoldWeight = circularBell(yearProgress, 7.0 / 12, 0.16);
  const winterShedWeight = circularBell(yearProgress, 9.0 / 12, 0.17);
  const springNewLeafWeight = circularBell(yearProgress, 11.0 / 12, 0.16);

  // Monthly crop lifecycles aligned with authentic Bangladesh seasons:
  // বৈশাখ (0): Boro harvest + young jute; জ্যৈষ্ঠ (1): Aman seedling + tall jute + ripe mango/jackfruit
  // আষাঢ়-শ্রাবণ (2..3): Flooded lush green paddy seedlings + tall jute; ভাদ্র-আশ্বিন (4..5): Tall green paddy + kashful
  // কার্তিক (6): Ripening golden paddy; অগ্রহায়ণ (7): Full golden paddy + harvest (reapers & sheaves!)
  // পৌষ-মাঘ (8..9): Mustard blooms, green/heading wheat, maize cobs, paddy stubble & date-palm sap
  // ফাল্গুন-চৈত্র (10..11): Golden bearded wheat + wheat harvest, maize cobs, Shimul-Palash blossoms, Boro green->gold
  const paddyByMonth: PaddyCropStage[] = [
    'harvesting', // বৈশাখ (Boro)
    'seedling',   // জ্যৈষ্ঠ
    'seedling',   // আষাঢ়
    'growing',    // শ্রাবণ
    'growing',    // ভাদ্র
    'ripening',   // আশ্বিন (late green-gold heading)
    'ripening',   // কার্তিক
    'harvesting', // অগ্রহায়ণ (নবান্ন ধান কাটা!)
    'stubble',    // পৌষ
    'stubble',    // মাঘ
    'growing',    // ফাল্গুন (বোরো)
    'ripening',   // চৈত্র
  ];

  const wheatByMonth: WheatCropStage[] = [
    'none',       // বৈশাখ
    'none',       // জ্যৈষ্ঠ
    'none',       // আষাঢ়
    'none',       // শ্রাবণ
    'none',       // ভাদ্র
    'none',       // আশ্বিন
    'none',       // কার্তিক
    'green',      // অগ্রহায়ণ (early sprout)
    'green',      // পৌষ
    'golden',     // মাঘ (heading golden)
    'golden',     // ফাল্গুন (পাকা সোনালি গম)
    'harvesting', // চৈত্র (গম কাটা)
  ];

  const maizeByMonth: MaizeCropStage[] = [
    'cobs',    // বৈশাখ
    'cobs',    // জ্যৈষ্ঠ
    'none',    // আষাঢ়
    'none',    // শ্রাবণ
    'none',    // ভাদ্র
    'none',    // আশ্বিন
    'growing', // কার্তিক
    'growing', // অগ্রহায়ণ
    'growing', // পৌষ
    'cobs',    // মাঘ
    'cobs',    // ফাল্গুন
    'cobs',    // চৈত্র
  ];

  const juteByMonth: JuteCropStage[] = [
    'sprout', // বৈশাখ
    'tall',   // জ্যৈষ্ঠ
    'tall',   // আষাঢ়
    'tall',   // শ্রাবণ
    'tall',   // ভাদ্র
    'none',   // আশ্বিন
    'none',   // কার্তিক
    'none',   // অগ্রহায়ণ
    'none',   // পৌষ
    'none',   // মাঘ
    'none',   // ফাল্গুন
    'sprout', // চৈত্র
  ];

  const mustardWeight = circularBell(yearProgress, 8.8 / 12, 0.14);
  const mangoFruitWeight = monthIndex === 0 ? 0.62 : monthIndex === 1 ? 1.0 : monthIndex === 2 ? 0.45 : monthIndex === 11 ? 0.25 : 0;
  const palmSapPotActive = monthIndex === 8 || monthIndex === 9 || (monthIndex === 7 && dayOfMonth > 15);

  const monthNameBn = BENGALI_MONTHS_BN[monthIndex];
  const seasonNameBn = SEASON_NAMES_BN[season];
  const formattedDateBn =
    overrideMonthIndex !== null
      ? `${monthNameBn} মাস (প্রিভিউ) · ${seasonNameBn}`
      : `${toBengaliDigits(dayOfMonth)} ${monthNameBn}, ${toBengaliDigits(baseInfo.banglaYear)} · ${seasonNameBn}`;

  return {
    banglaYear: baseInfo.banglaYear,
    monthIndex,
    monthNameBn,
    dayOfMonth,
    dayOfBanglaYear,
    yearProgress,
    season,
    seasonNameBn,
    formattedDateBn,
    summerBloomWeight,
    monsoonVineWeight,
    autumnKashWeight,
    harvestGoldWeight,
    winterShedWeight,
    springNewLeafWeight,
    paddyStage: paddyByMonth[monthIndex] ?? 'growing',
    wheatStage: wheatByMonth[monthIndex] ?? 'none',
    mustardWeight,
    maizeStage: maizeByMonth[monthIndex] ?? 'none',
    juteStage: juteByMonth[monthIndex] ?? 'none',
    mangoFruitWeight,
    palmSapPotActive,
  };
}
