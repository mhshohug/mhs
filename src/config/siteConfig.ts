export interface AudioTrack {
  id: string;
  title: string;
  subtitle: string;
  src: string;
  melodyPreset: 'nostalgia' | 'rain' | 'starlight' | 'devotion' | 'birthday_chime' | 'birthday_waltz';
  durationSec: number;
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
    title: 'ভালো থেকো, রুপো',
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
    title: 'শুভ জন্মদিন, রুপো',
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
    headline: 'আজকে তোমার জন্মদিন, রুপো',
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
          'ভালো থেকো, রুপো। দূর থেকেও আজকের দিনে তোমাকে ভীষণ মনে পড়ছে।',
          'অনুভূতিটা কখনোই মিথ্যে ছিল না—আজও একদম একইরকম সত্যি।',
        ],
      },
      {
        emphasis: 'signature',
        lines: [
          '— যে আজও তোমাকে ভালোবাসে',
          'শুভ জন্মদিন, রুপো।',
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
          'শুভ জন্মদিন, প্রিয় রুপো।',
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
          'ভালো থেকো, রুপো। দূর থেকেও তোমার ভালো থাকাটাই আমার সবচেয়ে বড় পাওয়া।',
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
          'ভালো থেকো, রুপো।',
        ],
      },
    ],
  },
];

export function getBirthdayEditionForYear(year: number): BirthdayEdition {
  const index = Math.abs(year - 2017) % BIRTHDAY_EDITIONS.length;
  return BIRTHDAY_EDITIONS[index];
}
