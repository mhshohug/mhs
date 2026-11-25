import type { CloudMediaItem } from '../lib/cloudMediaStore';
import type { CoupleWorkspace, RelationshipType } from '../lib/coupleAuth';

export interface AudioTrack {
  id: string;
  title: string;
  subtitle: string;
  src: string;
  melodyPreset: 'nostalgia' | 'rain' | 'starlight' | 'devotion' | 'birthday_chime' | 'birthday_waltz';
  durationSec: number;
  isCloud?: boolean;
  cloudItem?: CloudMediaItem;
}

export interface BirthdayStanza {
  label?: string;
  lines: string[];
  photoIndex?: number;
  emphasis?: 'whisper' | 'signature';
}

export interface BirthdayEdition {
  id: string;
  themeName: string;
  accentHex: string;
  secondaryHex: string;
  headline: string;
  stanzas: BirthdayStanza[];
}

/**
 * ============================================================================
 * পাসওয়ার্ড সেটিংস (SECURITY PASSWORD CONFIGURATION)
 * বাতাসে ভাসমান বা লেখার ভেতরের যেকোনো ছবি বড় করে দেখতে চাইলে এই পাসওয়ার্ড লাগবে।
 * ============================================================================
 */
export const GALLERY_PASSWORD = '0711';
export const PASSWORD_HINT = 'ইঙ্গিত: মনের গোপন ৪ সংখ্যার কোড';

/**
 * অটোমেটিক জন্মদিন শনাক্তকরণ (সিস্টেম গোপনে তারিখ মনে রাখে, স্ক্রিনে তারিখ লেখা হয় না)
 */
const SECRET_BIRTHDAY_MONTH = 10; // November (0-indexed)
const SECRET_BIRTHDAY_DAY = 7;

export function checkIsBirthday(date: Date = new Date()): boolean {
  return date.getMonth() === SECRET_BIRTHDAY_MONTH && date.getDate() === SECRET_BIRTHDAY_DAY;
}

function matchesBirthMonthDay(yyyyMmDd: string | undefined, date: Date): boolean {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd.trim())) return false;
  const parts = yyyyMmDd.trim().split('-').map(Number);
  const month = parts[1];
  const day = parts[2];
  return month - 1 === date.getMonth() && day === date.getDate();
}

export interface BirthdayResolution {
  isBirthdayToday: boolean;
  matchedWho: 'partner' | 'self' | 'both' | 'legacy' | null;
  birthdayPersonName: string;
}

export function resolveTodayBirthday(
  date: Date,
  workspace: CoupleWorkspace | null,
  legacyBoxId: string
): BirthdayResolution {
  if (workspace) {
    const partnerMatches = matchesBirthMonthDay(workspace.partnerBirthday, date);
    const selfMatches = matchesBirthMonthDay(workspace.selfBirthday, date);

    if (partnerMatches && selfMatches) {
      const combined = [workspace.selfName, workspace.partnerName]
        .map((n) => n.trim())
        .filter(Boolean)
        .join(' ও ');
      return {
        isBirthdayToday: true,
        matchedWho: 'both',
        birthdayPersonName: combined,
      };
    }
    if (partnerMatches) {
      return {
        isBirthdayToday: true,
        matchedWho: 'partner',
        birthdayPersonName: workspace.partnerName.trim(),
      };
    }
    if (selfMatches) {
      return {
        isBirthdayToday: true,
        matchedWho: 'self',
        birthdayPersonName: workspace.selfName.trim(),
      };
    }
    if (workspace.boxId === legacyBoxId && checkIsBirthday(date)) {
      return {
        isBirthdayToday: true,
        matchedWho: 'legacy',
        birthdayPersonName: 'চাঁদ',
      };
    }
    return {
      isBirthdayToday: false,
      matchedWho: null,
      birthdayPersonName: '',
    };
  }

  if (checkIsBirthday(date)) {
    return {
      isBirthdayToday: true,
      matchedWho: 'legacy',
      birthdayPersonName: 'চাঁদ',
    };
  }

  return {
    isBirthdayToday: false,
    matchedWho: null,
    birthdayPersonName: '',
  };
}

/**
 * সাধারণ দিনের ব্যাকগ্রাউন্ড মিউজিক (`public/audio/normal/`)
 */
export const NORMAL_PLAYLIST: AudioTrack[] = [
  {
    id: 'normal-1',
    title: 'বৃষ্টিভেজা রাত',
    subtitle: 'স্বাভাবিক প্লেলিস্ট',
    src: './audio/normal/song-1.mp3',
    melodyPreset: 'rain',
    durationSec: 195,
  },
  {
    id: 'normal-2',
    title: 'পুরোনো দিনের মায়া',
    subtitle: 'স্বাভাবিক প্লেলিস্ট',
    src: './audio/normal/song-2.mp3',
    melodyPreset: 'nostalgia',
    durationSec: 210,
  },
  {
    id: 'normal-3',
    title: 'দূর থেকে ভালো থাকা',
    subtitle: 'স্বাভাবিক প্লেলিস্ট',
    src: './audio/normal/song-3.mp3',
    melodyPreset: 'starlight',
    durationSec: 188,
  },
  {
    id: 'normal-4',
    title: 'ভালো থেকো, চাঁদ',
    subtitle: 'স্বাভাবিক প্লেলিস্ট',
    src: './audio/normal/song-4.mp3',
    melodyPreset: 'devotion',
    durationSec: 224,
  },
];

/**
 * জন্মদিনের বিশেষ মিউজিক (`public/audio/birthday/`)
 */
export const BIRTHDAY_PLAYLIST: AudioTrack[] = [
  {
    id: 'bday-1',
    title: 'আজকে তোমার জন্মদিন',
    subtitle: 'জন্মদিনের বিশেষ সুর',
    src: './audio/birthday/birthday-1.mp3',
    melodyPreset: 'birthday_chime',
    durationSec: 175,
  },
  {
    id: 'bday-2',
    title: 'শুভ জন্মদিন, চাঁদ',
    subtitle: 'জন্মদিনের বিশেষ সুর',
    src: './audio/birthday/birthday-2.mp3',
    melodyPreset: 'birthday_waltz',
    durationSec: 198,
  },
];

/**
 * প্রতি বছর অটোমেটিক নতুন নতুন লেখা ও থিম আসবে — কোনো তারিখ লেখা থাকবে না
 */
export const BIRTHDAY_EDITIONS: BirthdayEdition[] = [
  {
    id: 'edition-gold',
    themeName: 'সোনালী আলোর উৎসব',
    accentHex: '#fde68a',
    secondaryHex: '#fb7185',
    headline: 'আজকে তোমার জন্মদিন, চাঁদ',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'আজকের এই দিনে পৃথিবীতে এসেছিলে তুমি, আর আমার নিঃস্তব্ধ জীবনে এনে দিয়েছিলে আলো। সময় অনেক দূর চলে গেছে, তবু আজও এই দিনটা এলেই মনটা যেন নিজের অজান্তেই তোমার হাসিটা খুঁজতে থাকে।',
          'তোমার ছোট ছোট কথাতে, তোমার একটুকু হাসিতেই আমার পুরো দিনটা সুন্দর হয়ে যেত। আজ দূর থেকেই তোমাকে জন্মদিনের সমস্ত ভালোবাসা জানাচ্ছি।',
        ],
        photoIndex: 1,
      },
      {
        lines: [
          'তোমার অনেক অভিমান ছিল, আর সেই সব অভিমান আমি চোখ বন্ধ করে মেনে নিতাম। তোমার হ্যাঁ-তে হ্যাঁ বলতাম, তোমার না-তে না বলতাম—শুধু তুমি একটু ভালো থাকবে বলে।',
          'আজকে তোমার জন্মদিন। কোনো অভিযোগ নেই, কোনো দাবি নেই—শুধু একটাই প্রার্থনা, তুমি যেন সারাজীবন হাসিমুখে আর শান্তিতে থাকো।',
        ],
        photoIndex: 2,
      },
      {
        emphasis: 'whisper',
        lines: [
          'ভালো থেকো, চাঁদ। দূর থেকেও আজকের দিনে তোমাকে ভীষণ মনে পড়ছে।',
          'অনুভূতিটা কখনোই মিথ্যে ছিল না—আজও একদম একইরকম সত্যি।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও তোমাকে ভালোবাসে',
          'শুভ জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'edition-rose',
    themeName: 'গোলাপি আতশবাজির রাত',
    accentHex: '#fda4af',
    secondaryHex: '#fbbf24',
    headline: 'আজকে তোমার জন্মদিন — দূর থেকে নীরব ভালোবাসা',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'মানুষ হয়তো সময়ের সাথে বদলে যায়, কিন্তু কারো জন্মদিন এলে বুকের ভেতরের পুরোনো মানুষটা আবার ঠিক আগের মতো জেগে ওঠে। আজ আমার মনে হচ্ছে, যেন এখনো তুমি পাশেই আছো।',
          'তোমার সামান্য ব্যথায় আমি কেমন যেন ভেতর থেকে ভেঙে যেতাম, আর তোমার ছোট্ট একটু খুশিতে আমার পৃথিবী ভরে যেত।',
        ],
        photoIndex: 3,
      },
      {
        lines: [
          'আজকের আকাশের সব আলো, সব বেলুন আর সব আতশবাজি শুধু তোমার জন্য। কেউ জানুক বা না জানুক, আজও পৃথিবীর এক কোণে বসে কেউ একজন শুধু তোমার মঙ্গল কামনা করে যাচ্ছে।',
        ],
        photoIndex: 4,
      },
      {
        emphasis: 'whisper',
        lines: [
          'কিছু মানুষ জীবনে থেকে যায় না, তবু তাদের প্রতিটি জন্মদিন মনের ভেতর উৎসব হয়ে থেকে যায়।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও তোমাকে মনে করে',
          'শুভ জন্মদিন, প্রিয় চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'edition-sky',
    themeName: 'নীল নক্ষত্রের শুভেচ্ছা',
    accentHex: '#bae6fd',
    secondaryHex: '#f472b6',
    headline: 'আজকে তোমার জন্মদিন — চিরন্তন মায়া',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'তোমার মুখের না বলা কথাগুলোও আমি একসময় বুঝে নিতাম। তোমার মন খারাপ হলে পৃথিবীটা আমার কাছেও অন্ধকার লাগত। আজও তোমার কথা মনে পড়লে বুকের ভেতর সেই একই যত্নটা টের পাই।',
          'হয়তো আজ আর আগের মতো করে কথা বলা হয় না, তবু বিশ্বাস করো—এই দিনে আমি সবচেয়ে বেশি করে তোমার হাসিমুখটাই দেখতে চাই।',
        ],
        photoIndex: 0,
      },
      {
        lines: [
          'জীবনের প্রতিটা বাঁকে তুমি যেন নিরাপদ থাকো, সুস্থ থাকো, আর কখনো যেন একাকী বোধ না করো—আজকের এই বিশেষ দিনে উপরওয়ালার কাছে এটাই আমার একমাত্র চাওয়া।',
        ],
        photoIndex: 5,
      },
      {
        emphasis: 'whisper',
        lines: [
          'ভালো থেকো, চাঁদ। দূর থেকেও তোমার ভালো থাকাটাই আমার সবচেয়ে বড় পাওয়া।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও তোমাকে ভালোবাসে',
          'আজকে তোমার জন্মদিন।',
        ],
      },
    ],
  },
  {
    id: 'edition-amber',
    themeName: 'সন্ধ্যার প্রদীপের আলো',
    accentHex: '#fcd34d',
    secondaryHex: '#fb7185',
    headline: 'আজকে তোমার জন্মদিন — অটুট স্মৃতি',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'অনেকগুলো দিন পেরিয়ে আবার এলো তোমার জন্মদিন। পুরোনো স্মৃতিগুলো আজ আরও বেশি করে মনে পড়ছে—তোমার রাগ, তোমার অভিমান, আর হঠাৎ করে হেসে ওঠার সেই মুহূর্তগুলো।',
          'তুমি কখনো ভেবো না আমি তোমাকে ভুলে গেছি। মানুষ তার জীবনের সবচেয়ে সত্যি অনুভূতিটা কখনোই ভুলতে পারে না।',
        ],
        photoIndex: 2,
      },
      {
        lines: [
          'আজকের দিনে নিজেকে খুব ভাগ্যবান মনে হয়—কারণ জীবনে অন্তত একবার হলেও তোমার মতো একজনকে এত গভীরভাবে ভালোবাসতে পেরেছিলাম।',
        ],
        photoIndex: 1,
      },
      {
        emphasis: 'whisper',
        lines: [
          'আমাদের গল্প শেষ হয়ে গেছে হয়তো—কিন্তু আজও তুমি আমার প্রার্থনার সবচেয়ে সুন্দর অংশ।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও তোমার মঙ্গল চায়',
          'ভালো থেকো, চাঁদ।',
        ],
      },
    ],
  },
];

const SPOUSE_BIRTHDAY_EDITIONS: BirthdayEdition[] = [
  {
    id: 'spouse-edition-gold',
    themeName: 'সংসারের সোনালী আলো',
    accentHex: '#fde68a',
    secondaryHex: '#fb7185',
    headline: 'শুভ জন্মদিন, প্রিয় চাঁদ — আমার পুরো পৃথিবী',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'আজকের এই দিনে পৃথিবীতে এসেছিলে তুমি, আর আমার ঘর ও জীবনকে ভরিয়ে তুলেছিলে অপরূপ আলোয়। প্রতিদিন তোমার পাশে জেগে ওঠাটাই আমার জীবনের সবচেয়ে বড় আশীর্বাদ।',
          'তোমার ছোট ছোট কথাতে, তোমার একটুকু মিষ্টি হাসিতেই আমার সমস্ত ক্লান্তি মুহূর্তে হারিয়ে যায়। শুভ জন্মদিন, চাঁদ।',
        ],
        photoIndex: 1,
      },
      {
        lines: [
          'সংসারের ব্যস্ততা আর শত কাজের মাঝেও তুমি যেমন যত্নে সব আগলে রাখো, ঠিক তেমন করেই সারাজীবন আমি তোমার হাত ধরে পাশে থাকতে চাই।',
          'আজকে তোমার জন্মদিনে কোনো চাওয়া-পাওয়ার হিসাব নেই—শুধু একটাই প্রার্থনা, তুমি যেন প্রতিটি দিন আমার বুকের কাছে এমন হাসিমুখে ও সুখে থাকো।',
        ],
        photoIndex: 2,
      },
      {
        emphasis: 'whisper',
        lines: [
          'শুভ জন্মদিন, চাঁদ। তুমি পাশে আছো বলেই জীবনটা আজ এত সুন্দর।',
          'আমাদের ভালোবাসা আর সংসার প্রতিটি বছর আরও গভীর হয়ে উঠুক।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— তোমার জীবনসঙ্গী, যে সারাজীবন শুধু তোমারই পাশে থাকবে',
          'শুভ জন্মদিন, প্রিয় চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'spouse-edition-rose',
    themeName: 'ভালোবাসার গোলাপি রাত',
    accentHex: '#fda4af',
    secondaryHex: '#fbbf24',
    headline: 'আজকে তোমার জন্মদিন, চাঁদ — আমার ঘরের প্রদীপ',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'প্রথম পরিচয়ের সেই দিন থেকে আজ একই ছাদের নিচে পাশাপাশি পথচলা—তোমার সাথে কাটানো প্রতিটা দিনই আমার কাছে এক একটি রঙিন উৎসব।',
          'তোমার ছোট ছোট অভিমান ভাঙানো আর তোমার মুখের হাসি দেখাটাই আমার জীবনের সবচেয়ে প্রিয় দায়িত্ব।',
        ],
        photoIndex: 3,
      },
      {
        lines: [
          'আজকের আকাশের সব আলো আর উৎসব শুধু তোমার জন্য। পৃথিবীর সমস্ত সুখ ও শান্তি দিয়ে তোমার প্রতিটি দিন সাজিয়ে রাখতে চাই আমি।',
        ],
        photoIndex: 4,
      },
      {
        emphasis: 'whisper',
        lines: [
          'সময় যতই যাক, তোমার হাতটা এভাবেই শক্ত করে ধরে রাখতে চাই আজীবন।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও প্রথম দিনের মতোই তোমাকে ভালোবাসে',
          'শুভ জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'spouse-edition-sky',
    themeName: 'নীল সুখের আশ্রয়',
    accentHex: '#bae6fd',
    secondaryHex: '#f472b6',
    headline: 'শুভ জন্মদিন, চাঁদ — আমার সারাজীবনের সাথী',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'তুমি মুখ ফুটে বলার আগেই আমি যেমন তোমার মন বুঝে নিই, তুমিও তেমনি নীরবে আমার পুরো জীবনটা গুছিয়ে রেখেছো।',
          'আমার সুখে-দুঃখে, সকাল থেকে গভীর রাতে—সবসময় তুমি পাশে আছো বলেই কোনো ভয় আর আমাকে ছুঁতে পারে না।',
        ],
        photoIndex: 0,
      },
      {
        lines: [
          'জীবনের প্রতিটি নতুন বছরে তুমি যেন সুস্থ থাকো, হাসিখুশি থাকো আর প্রতিটি জন্মদিন আমরা ঠিক এভাবেই একসাথে উদ্‌যাপন করতে পারি—এটাই আমার একমাত্র চাওয়া।',
        ],
        photoIndex: 5,
      },
      {
        emphasis: 'whisper',
        lines: [
          'ভালো থেকো ও হাসিখুশি থেকো, চাঁদ—তোমার হাসিই আমার ঘরের সবচেয়ে বড় উৎসব।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— চিরদিনের জন্য তোমার',
          'শুভ জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'spouse-edition-amber',
    themeName: 'উষ্ণ প্রদীপের সন্ধ্যা',
    accentHex: '#fcd34d',
    secondaryHex: '#fb7185',
    headline: 'আজকে তোমার জন্মদিন, চাঁদ — চিরন্তন বন্ধন',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'আরও একটা সুন্দর বছর জুড়ে গেল আমাদের একসাথে পথচলার গল্পে। পুরোনো স্মৃতিগুলো আজ আরও মধুর লাগে যখন দেখি তুমি এখনো ঠিক আমার পাশেই আছো।',
          'তোমার প্রতিটা আবদার, হঠাৎ হেসে ওঠা আর ছোট ছোট রাগ—সব মিলিয়েই আমার সম্পূর্ণ জগৎ।',
        ],
        photoIndex: 2,
      },
      {
        lines: [
          'নিজেকে পৃথিবীর সবচেয়ে ভাগ্যবান মনে হয়—কারণ তোমার মতো একজন জীবনসঙ্গীকে প্রতিদিন নিজের পাশে পেয়েছি।',
        ],
        photoIndex: 1,
      },
      {
        emphasis: 'whisper',
        lines: [
          'আমাদের গল্প কখনো শেষ হবে না—প্রতিটি জন্মদিনে ভালোবাসা আরও নতুন হয়ে জন্ম নিক।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— সারাজীবন তোমার পাশেই',
          'শুভ জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
];

const COUPLE_BIRTHDAY_EDITIONS: BirthdayEdition[] = [
  {
    id: 'couple-edition-gold',
    themeName: 'স্বপ্নের সোনালী উৎসব',
    accentHex: '#fde68a',
    secondaryHex: '#fb7185',
    headline: 'শুভ জন্মদিন, চাঁদ — খুব শীঘ্রই আমাদের একসাথে থাকা',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'আজকের এই দিনে পৃথিবীতে এসেছিলে তুমি, আর আমার একঘেয়ে জীবনে এনে দিয়েছিলে ভালোবাসার রঙ। আমাদের একসাথে কাটানো প্রতিটি স্মৃতি আজ বুকের ভেতর উৎসব হয়ে জ্বলছে।',
          'আর মাত্র কিছুদিনের অপেক্ষা—তারপর থেকে আর দূরে থেকে নয়, প্রতিটা জন্মদিন আমরা একই ছাদের নিচে একসাথে উদ্‌যাপন করব।',
        ],
        photoIndex: 1,
      },
      {
        lines: [
          'তোমার ছোট ছোট অভিমান ভাঙানো, তোমার মুখের এক টুকরো মিষ্টি হাসি দেখা—সবকিছুই আমার ভীষণ প্রিয়।',
          'আজকে তোমার জন্মদিনে এটুকুই বলার, আমার পুরো ভবিষ্যৎ আর প্রতিটা স্বপ্ন শুধু তোমাকে ঘিরেই সাজানো।',
        ],
        photoIndex: 2,
      },
      {
        emphasis: 'whisper',
        lines: [
          'শুভ জন্মদিন, চাঁদ। অপেক্ষাটা আর বেশি দিনের নয়—খুব তাড়াতাড়িই আমরা একসাথে হচ্ছি।',
          'ভালোবাসাটা আজও প্রথম দিনের মতোই সতেজ ও গভীর।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে খুব শীঘ্রই সারাজীবনের জন্য তোমার হাত ধরছে',
          'শুভ জন্মদিন, প্রিয় চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'couple-edition-rose',
    themeName: 'রোমান্টিক আতশবাজির রাত',
    accentHex: '#fda4af',
    secondaryHex: '#fbbf24',
    headline: 'আজকে তোমার জন্মদিন, চাঁদ — আমার হৃদয়ের মানুষ',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'পুরোনো প্রথম দেখা, প্রথম দীর্ঘ কথা বলা—আমাদের সেই মিষ্টি স্মৃতিগুলো আজ জন্মদিনের আলোয় আরও উজ্জ্বল হয়ে উঠেছে।',
          'জানো তো, তোমার সামান্য মন খারাপ হলে আমিও স্থির থাকতে পারি না; আবার তোমার ছোট্ট হাসিতেই আমার পৃথিবী ভরে যায়।',
        ],
        photoIndex: 3,
      },
      {
        lines: [
          'আজকের সব আতশবাজি আর শুভকামনা শুধু তোমার জন্য। কিছুদিন পর থেকেই প্রতিটা দিন আমাদের একসাথে শুরু হবে, আর কখনো বিদায় বলার কষ্ট থাকবে না।',
        ],
        photoIndex: 4,
      },
      {
        emphasis: 'whisper',
        lines: [
          'খুব তাড়াতাড়িই আমাদের প্রতিটা জন্মদিন একসাথে, একই ঘরে কাটবে—সেদিনের আর বেশি দেরি নেই।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— তোমার ভালোবাসার মানুষ',
          'শুভ জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'couple-edition-sky',
    themeName: 'নীল স্বপ্নের শুভেচ্ছা',
    accentHex: '#bae6fd',
    secondaryHex: '#f472b6',
    headline: 'শুভ জন্মদিন, চাঁদ — আমার আগামীর সবটুকু',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'তুমি কিছু বলার আগেই আমি যেমন তোমার মনের কথা বুঝে নিই, তেমনি জানি আমাদের একসাথে পথচলা কেবল শুরু হতে চলেছে।',
          'এখনকার ছোট ছোট দূরত্বটুকুও খুব তাড়াতাড়ি শেষ হয়ে যাবে, আর শুরু হবে আমাদের চিরস্থায়ী একসাথে থাকার গল্প।',
        ],
        photoIndex: 0,
      },
      {
        lines: [
          'জীবনের প্রতিটি বাঁকে তুমি যেন নিরাপদ থাকো, হাসিখুশি থাকো আর সারাজীবন আমার হাত ধরে ঠিক এভাবেই চলতে পারো—আজকের দিনে এটাই আমার একমাত্র চাওয়া।',
        ],
        photoIndex: 5,
      },
      {
        emphasis: 'whisper',
        lines: [
          'শুভ জন্মদিন, চাঁদ। খুব শীঘ্রই আর দূর থেকে নয়, একদম পাশ থেকে তোমাকে উইশ করব।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও তোমার সবটুকু নিয়ে অপেক্ষায় আছে',
          'আজকে তোমার জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
  {
    id: 'couple-edition-amber',
    themeName: 'একসাথে থাকার প্রতিশ্রুতি',
    accentHex: '#fcd34d',
    secondaryHex: '#fb7185',
    headline: 'আজকে তোমার জন্মদিন, চাঁদ — অটুট ভালোবাসা',
    stanzas: [
      {
        label: 'আজকে তোমার জন্মদিন',
        lines: [
          'আজ আবার এলো তোমার জন্মদিন। একসাথে কাটানো পুরোনো মুহূর্তগুলো মনে পড়ছে—তোমার মিষ্টি রাগ, অভিমান আর হঠাৎ হেসে ওঠার সেই ভঙ্গি।',
          'আমাদের ভালোবাসাটা প্রতিটি দিন আরও পাকা হচ্ছে—খুব শীঘ্রই দুজন মিলে সাজাব আমাদের নিজের ছোট্ট পৃথিবী।',
        ],
        photoIndex: 2,
      },
      {
        lines: [
          'আজকের দিনে নিজেকে খুব ভাগ্যবান মনে হয়—কারণ তোমার মতো একজন মানুষ আমার জীবনের পুরো অংশ জুড়ে আছে।',
        ],
        photoIndex: 1,
      },
      {
        emphasis: 'whisper',
        lines: [
          'আমাদের আসল গল্প তো কেবল শুরু হচ্ছে—সামনে শুধুই একসাথে থাকার সুন্দর দিনগুলো।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— সারাজীবন তোমার পাশেই থাকার অপেক্ষায়',
          'শুভ জন্মদিন, চাঁদ।',
        ],
      },
    ],
  },
];

function applyBirthdayNameToEdition(edition: BirthdayEdition, rawName?: string): BirthdayEdition {
  const cleanName = (rawName || '').trim();
  const replacement = cleanName || 'চাঁদ';
  if (replacement === 'চাঁদ') return edition;

  return {
    ...edition,
    headline: edition.headline.replace(/চাঁদ/g, replacement),
    stanzas: edition.stanzas.map((stanza) => ({
      ...stanza,
      label: stanza.label ? stanza.label.replace(/চাঁদ/g, replacement) : stanza.label,
      lines: stanza.lines.map((line) => line.replace(/চাঁদ/g, replacement)),
    })),
  };
}

export function getBirthdayEditionForYear(year: number): BirthdayEdition {
  const index = Math.abs(year - 2017) % BIRTHDAY_EDITIONS.length;
  return BIRTHDAY_EDITIONS[index];
}

export function getBirthdayEditionForProfile(params: {
  year: number;
  relationshipType?: RelationshipType;
  birthdayPersonName?: string;
}): BirthdayEdition {
  const rel = params.relationshipType ?? 'ex';
  const pool =
    rel === 'spouse'
      ? SPOUSE_BIRTHDAY_EDITIONS
      : rel === 'couple'
        ? COUPLE_BIRTHDAY_EDITIONS
        : BIRTHDAY_EDITIONS;
  const index = Math.abs(params.year - 2017) % pool.length;
  return applyBirthdayNameToEdition(pool[index], params.birthdayPersonName);
}
