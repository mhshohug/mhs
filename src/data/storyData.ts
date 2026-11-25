import { RajshahiWeather, toBengaliDigits } from '../utils/rajshahiWeather';

export interface StoryStanza {
  label?: string;
  lines: string[];
  emphasis?: 'whisper' | 'signature';
}

/** Check if today is Eid-ul-Fitr or Eid-ul-Adha based on Gregorian date ranges */
function checkIsEidToday(date: Date): boolean {
  const m = date.getMonth(); // 0-11
  const d = date.getDate();
  const y = date.getFullYear();

  // Example approximate Gregorian ranges for Eid in 2026/2027 (can be adjusted or expanded)
  // Eid-ul-Fitr 2026: ~March 20-22. Eid-ul-Adha 2026: ~May 27-29.
  if (y === 2026) {
    if (m === 2 && d >= 20 && d <= 23) return true; // March Eid-ul-Fitr
    if (m === 4 && d >= 26 && d <= 29) return true; // May Eid-ul-Adha
  }
  if (y === 2027) {
    if (m === 2 && d >= 10 && d <= 13) return true;
    if (m === 4 && d >= 16 && d <= 19) return true;
  }

  // Fallback generic check (e.g. if explicitly tested or general Islamic festive window)
  return false;
}

function getWeatherSyncedOpening(weather: RajshahiWeather): StoryStanza[] {
  const tempText =
    weather.temperatureC !== null ? ` · ${toBengaliDigits(weather.temperatureC)}°C` : '';
  const skyLabel = `আজকের আকাশ ও পরিবেশ · ${weather.descriptionBn}${tempText}`;

  const isEid = checkIsEidToday(new Date());
  const festivePrefix = isEid
    ? 'আজ ঈদের আনন্দের দিনেও চারপাশের এই উৎসবমুখর হাওয়ায় কেন যেন তোমার অনুপস্থিতিটা আরও বেশি করে অনুভব করছি, চাঁদ।'
    : '';

  switch (weather.mood) {
    case 'storm':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'আকাশ চিরে আজ প্রচণ্ড বিদ্যুৎ চমকাচ্ছে, ঝড়ো বাতাস আর অবিরাম বৃষ্টি নামছে বাইরে। এমন ঝড়ের দিনে ভেতরের জমানো কষ্টগুলো আরও বেশি করে ভেঙে পড়ে, চাঁদ।',
            'বাইরের বজ্রপাতের চেয়েও নীরব, তবু বুকের ভেতর তোমাকে হারানোর শূন্যতাটা আজ ভীষণভাবে বাজে।',
          ],
        },
      ];
    case 'rain':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরের রাস্তায় আজ ঝিরিঝিরি বৃষ্টি ঝরছে। টিনের চালে বা জানালার কাঁচে বৃষ্টির প্রতিটা ফোঁটার শব্দের ভেতর আজও শুধু তোমার কথাই মনে পড়ে, চাঁদ।',
            'চারপাশের এই ভেজা বাতাস যেন বারবার মনে করিয়ে দেয়—একসময় এই বৃষ্টির দিনে তুমি পাশে থাকলে আর কিছুরই দরকার হতো না।',
          ],
        },
      ];
    case 'fog':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাতাসে আজ ভারী কুয়াশা আর হিমেল হাওয়া বইছে। দূর থেকে সবকিছু যেমন ঝাপসা দেখায়, সময়ের সাথে সাথে আমাদের পথগুলোও ঠিক তেমনই দূরে সরে গেছে।',
            'তবু এই কুয়াশাচ্ছন্ন ভেতরেও তোমার জন্য আমাদের পুরোনো দিনের মায়াটুকু একটুও কমেনি, চাঁদ।',
          ],
        },
      ];
    case 'cloudy':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরের আকাশটা আজ ঘন মেঘে ঢাকা—ঠিক যেমন আমার মনটা তোমার কথা ভেবে ভারী হয়ে থাকে। রোদ নেই, শুধু থমথমে এক নীরবতা।',
            'মেঘলা এমন দিনে বারবার মনে হয়, যদি আরেকবার তোমার একটুখানি হাসি দেখতে পেতাম!',
          ],
        },
      ];
    case 'clear_day':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরে আজ পরিষ্কার রোদ উঠেছে, চারপাশটা আলোকিত। অথচ বাইরে এত আলো থাকা সত্ত্বেও আমার ভেতরের আকাশে আজও সেই একাকী বৃষ্টিটাই ঝরে, চাঁদ।',
            'মানুষ বাইরে থেকে স্বাভাবিক থাকে ঠিকই, কিন্তু মনের কোণে জমে থাকা মেঘগুলো কেউ দেখতে পায় না।',
          ],
        },
      ];
    case 'clear_night':
    default:
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'রাতের আকাশটা আজ একদম নিস্তব্ধ। শহরের কোলাহল থেমে গেলে এই নির্জন রাতে কেবল তোমার স্মৃতিগুলোই বুকের ভেতর জেগে ওঠে, চাঁদ।',
            'বাইরে আকাশ যতই শান্ত থাকুক, তোমাকে মনে পড়লে ভেতরের মানুষটা আজও নীরবে কেঁদে ওঠে।',
          ],
        },
      ];
  }
}

function getWeatherSyncedMidNote(weather: RajshahiWeather): StoryStanza {
  const isEid = checkIsEidToday(new Date());
  switch (weather.mood) {
    case 'storm':
    case 'rain':
      return {
        lines: [
          isEid
            ? 'এই ভেজা আকাশের নিচে ঈদের দিনেও মনে হয়, তোমার ওখানেও কি আজ ঠিক এমনই বাতাস বইছে? তুমি কি জানো, এখনো এমন বিশেষ দিনে আমি সবার আগে তোমার কথাই ভাবی?'
            : 'এই ভেজা আকাশের নিচে বসে মনে হয়, তোমার ওখানেও কি আজ ঠিক এমনই বাতাস বইছে? তুমি কি জানো, এখনো এমন দিনে আমি সবার আগে তোমার কথাই ভাবی?',
        ],
      };
    case 'fog':
      return {
        lines: [
          isEid
            ? 'কুয়াশায় যেমন চারপাশ ঢেকে যায়, ঈদের নতুন পোশাক বা আনন্দের ভিড়েও তোমার সেই চেনা মুখটা আমি প্রতি মুহূর্তে খুঁজি, চাঁদ।'
            : 'শীতের কুয়াশায় যেমন সব ঢেকে যায়, সময়ের ধুলোয় সব কিছু ঢেকে গেলেও তোমার নামটা আমার হৃদয় থেকে কখনো মুছতে পারেনি।',
        ],
      };
    case 'cloudy':
      return {
        lines: [
          isEid
            ? 'উৎসবের এই মেঘলা দিনে মনে জমে থাকা না বলা কথাগুলো আরও ভারী হয়ে ওঠে—আজও ঈদের খুশির মাঝেও তোমাকে বড্ড বেশি মনে পড়ে।'
            : 'আকাশের মেঘগুলো যেমন ভারী হয়ে থাকে, না বলা কথাগুলোও ঠিক তেমনই বুকের ভেতর জমে আছে—আজও তোমাকে ভীষণ মনে পড়ে।',
        ],
      };
    case 'clear_day':
      return {
        lines: [
          isEid
            ? 'আজকের এই রোদেলা উৎসবের দিনেও বুকটা কেমন যেন খালি হয়ে আসে—কারণ তোমার সেই ছোট্ট মিষ্টি হাসি ছাড়া কোনো ঈদই আর আগের মতো পূর্ণ হয় না।'
            : 'আজকের এই রোদের মাঝেও বুকটা ভারী হয়ে আসে—কারণ তোমার ছোট্ট একটু হাসি ছাড়া আমার কাছে কোনো আলোই আর আগের মতো লাগে না।',
        ],
      };
    case 'clear_night':
    default:
      return {
        lines: [
          isEid
            ? 'ঈদের রাতের এই নিস্তব্ধ বাতাস সাক্ষী, দূর থেকেও আমি প্রতিটি মুহূর্তে তোমার জীবন সুখের ও সুন্দর হোক—এই দোয়াই করে গেছি।'
            : 'রাতের এই নিস্তব্ধ বাতাস সাক্ষী, দূর থেকেও আমি প্রতিটি মুহূর্তে শুধু তোমার ভালো থাকাটাই চেয়ে গেছি।',
        ],
      };
  }
}

function getSpouseWeatherSyncedOpening(weather: RajshahiWeather): StoryStanza[] {
  const tempText =
    weather.temperatureC !== null ? ` · ${toBengaliDigits(weather.temperatureC)}°C` : '';
  const skyLabel = `আজকের আকাশ ও আমাদের ঘর · ${weather.descriptionBn}${tempText}`;
  const isEid = checkIsEidToday(new Date());
  const festivePrefix = isEid
    ? 'ঈদের এই আনন্দের দিনে তোমাকে পাশে পেয়েই আমার পুরো পৃথিবীটা ভরে উঠেছে। তুমি পাশে থাকলে প্রতিটা দিনই যেন উৎসব!'
    : '';

  switch (weather.mood) {
    case 'storm':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরে আজ ঝড়-বৃষ্টি আর মেঘের গর্জন, কিন্তু তোমার হাতটা আমার হাতে থাকলে কোনো ঝড়ই আমার মন ছুঁতে পারে না।',
            'আমাদের ছোট্ট ঘরের উষ্ণতায় আজ তোমার হাসিমুখটাই সবচেয়ে সুন্দর আশ্রয়।',
          ],
        },
      ];
    case 'rain':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'জানালার বাইরে আজ ঝিরিঝিরি বৃষ্টি ঝরছে—এমন দিনে একসাথে পাশে বসে চায়ের কাপে গল্প করার আনন্দটাই আলাদা।',
            'পুরোনো দিনের মধুর স্মৃতিগুলো আজও আমাদের এই ভেজা বিকেলের ভালোবাসাকে আরও গভীর করে তোলে।',
          ],
        },
      ];
    case 'fog':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাতাসে আজ হালকা কুয়াশা আর হিমেল হাওয়া—ঠিক এমন শীতল সন্ধ্যায় তোমার উষ্ণ ভালোবাসা আমাকে জড়িয়ে রাখে।',
            'সময় যতই গড়াক, আমাদের একসাথে পথচলার এই মিষ্টি মায়াটা প্রতিদিন আরও নতুন হয়ে ওঠে।',
          ],
        },
      ];
    case 'cloudy':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরের আকাশটা আজ মেঘলা থাকলেও আমার মনের আকাশ শুধু তোমাকে ঘিরেই আলোয় ভরা।',
            'সারাদিনের ব্যস্ততা ভুলে তোমার একটুখানি হাসিতেই আমার সমস্ত প্রশান্তি লুকিয়ে থাকে।',
          ],
        },
      ];
    case 'clear_day':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরের ঝলমলে রোদের মতোই তুমি আমার সংসার আর প্রতিদিনকার জীবনকে আলোকিত করে রেখেছো।',
            'সকালে চোখ খুলে তোমার মুখটা দেখতে পাওয়াই আমার জীবনের সবচেয়ে সুন্দর শুরু।',
          ],
        },
      ];
    case 'clear_night':
    default:
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'শহরের কোলাহল থেমে গেলে এই শান্ত রাতে তোমার পাশে নিঃশ্বাস নিতে পারাটাই সবচেয়ে বড় সুখ।',
            'কত স্মৃতি পেরিয়ে আজ আমরা একসাথে—প্রতিটি রাত তোমার ভালোবাসায় নিরাপদ ও সুন্দর।',
          ],
        },
      ];
  }
}

function getCoupleWeatherSyncedOpening(weather: RajshahiWeather): StoryStanza[] {
  const tempText =
    weather.temperatureC !== null ? ` · ${toBengaliDigits(weather.temperatureC)}°C` : '';
  const skyLabel = `আজকের আকাশ ও আমাদের স্বপ্ন · ${weather.descriptionBn}${tempText}`;
  const isEid = checkIsEidToday(new Date());
  const festivePrefix = isEid
    ? 'ঈদের এই খুশির দিনে মনে হচ্ছে—আর মাত্র কিছুদিন, তারপর থেকে প্রতিটি উৎসব আমাদের একসাথে হাত ধরে শুরু হবে!'
    : '';

  switch (weather.mood) {
    case 'storm':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরে আজ ঝোড়ো হাওয়া ও বৃষ্টি নামছে—এই ঝড়ের দিনে শুধু ভাবি, আর ক’টা দিন পরই আমরা একসাথে একই জানালায় বৃষ্টি দেখব।',
            'দূরত্বটা এখন শুধুই সময়ের ব্যাপার; বুকের ভেতর আমাদের একসাথে থাকার স্বপ্নটা প্রতিদিন আরও কাছাকাছি আসছে।',
          ],
        },
      ];
    case 'rain':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'টিনের চালে আজ টাপুরটুপুর বৃষ্টি—প্রতিটি ফোঁটা যেন বলে যায়, খুব শীঘ্রই আমাদের এই অপেক্ষার প্রহর শেষ হতে চলেছে।',
            'পুরোনো মিষ্টি স্মৃতিগুলো মনে করতে করতে আজ শুধু ভাবি, একসাথে পাশাপাশি হাঁটার দিনটা আর বেশি দূরে নেই।',
          ],
        },
      ];
    case 'fog':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'চারপাশে আজ মিষ্টি কুয়াশা—এই হিমেল বাতাসে তোমার হাতটা ধরে একসাথে ভবিষ্যতের দিকে এগিয়ে যাওয়ার স্বপ্ন দেখি।',
            'আমাদের ভালোবাসা আর একসাথে কাটানো প্রতিটা মুহূর্ত খুব তাড়াতাড়ি চিরস্থায়ী ঘরে রূপ নেবে।',
          ],
        },
      ];
    case 'cloudy':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'মেঘলা এই দিনে তোমাকে একটু বেশি করে কাছে পেতে ইচ্ছে করছে—খুব শীঘ্রই আর এভাবে আলাদা থাকতে হবে না।',
            'প্রতিদিন আমাদের একসাথে থাকার দিনটা একটু একটু করে এগিয়ে আসছে, সেই আনন্দে মনটা ভরে থাকে।',
          ],
        },
      ];
    case 'clear_day':
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'বাইরের এই সুন্দর রোদের মতোই আমাদের সম্পর্কটা প্রতিদিন আরও উজ্জ্বল আর শক্ত হচ্ছে।',
            'কিছুদিন পর থেকেই প্রতিদিন সকালে একই আকাশের নিচে, একই সাথে আমাদের নতুন জীবন শুরু হবে।',
          ],
        },
      ];
    case 'clear_night':
    default:
      return [
        {
          label: skyLabel,
          lines: [
            ...(festivePrefix ? [festivePrefix] : []),
            'রাতের এই নিস্তব্ধ আকাশের নিচে বসে ভাবি—আর মাত্র কিছুদিনের অপেক্ষা, তারপর প্রতিটি রাত হবে আমাদের দুজনের একসাথে।',
            'তোমার কণ্ঠ আর তোমার মিষ্টি স্মৃতিগুলো নিয়েই এখন নতুন স্বপ্নের প্রহর গুনছি।',
          ],
        },
      ];
  }
}

function buildSpouseWeatherSyncedStory(weather: RajshahiWeather): StoryStanza[] {
  const isEid = checkIsEidToday(new Date());
  return [
    ...getSpouseWeatherSyncedOpening(weather),
    {
      lines: [
        isEid
          ? 'ঈদের সকালে তোমার হাসিমুখ দেখেই আমার সব ক্লান্তি দূর হয়ে যায়। সংসারের ছোট্ট ছোট্ট আনন্দে তোমাকে জড়িয়ে রাখাই আমার সবচেয়ে বড় প্রাপ্তি।'
          : 'তোমাকে কতটা ভালোবাসি, তা হয়তো প্রতিবার ভাষায় বলা হয় না—কিন্তু তুমি মুখ ফুটে বলার আগেই আমি তোমার মনের সব কথা বুঝে নিই।',
        'কখন তোমার মন খারাপ, কখন একটু আদর চাও—পাশে থেকে তোমার প্রতিটা অনুভূতি আগলে রাখতেই আমার সমস্ত সুখ।',
      ],
    },
    {
      lines: [
        'তোমার ছোট ছোট অভিমান আমার কাছে পৃথিবীর সবচেয়ে মিষ্টি আবদার। তুমি রাগ করলে আমি হাসিমুখে সব মেনে নিই, শুধু তোমার মুখে হাসি দেখব বলে।',
        'আমাদের পুরোনো দিনের প্রথম পরিচয়ের সেই মায়া আর আজকের এই সংসারের ভালোবাসা—দুটোই প্রতিদিন আমাকে নতুন করে তোমার প্রেমে ফেলে।',
      ],
    },
    {
      lines: [
        'তুমি সামান্য কষ্ট পেলে আমার বুকের ভেতরটা অস্থির হয়ে ওঠে—ইচ্ছে করে পৃথিবীর সব দুঃখ আড়াল করে শুধু তোমাকেই শান্তিতে রাখি।',
        isEid
          ? 'ঈদের এই সুন্দর দিনে উপরওয়ালার কাছে একটাই প্রার্থনা—আমাদের এই বন্ধন ও সুখের সংসার যেন আজীবন অটুট থাকে।'
          : 'প্রতিদিনের ব্যস্ততার পর বাড়ি ফিরে তোমার পাশে বসার মুহূর্তটাই আমার জীবনের সবচেয়ে বড় আশ্রয়।',
      ],
    },
    {
      emphasis: 'whisper',
      lines: [
        'সময় যতই বদলাক, হাত দুটো যেন সারাজীবন ঠিক এভাবেই একসাথে থাকে।',
        'প্রতিটা সকাল আর প্রতিটা রাত শুধু তোমারই ভালোবাসায় পূর্ণ হোক।',
      ],
    },
    {
      emphasis: 'signature',
      lines: [
        '— যে সারাজীবন শুধু তোমারই পাশে থাকতে চায়',
        'এই পাতাটি শুধু আমাদের সংসার ও ভালোবাসার গল্প ধরে রাখার জন্য।',
      ],
    },
  ];
}

function buildCoupleWeatherSyncedStory(weather: RajshahiWeather): StoryStanza[] {
  const isEid = checkIsEidToday(new Date());
  return [
    ...getCoupleWeatherSyncedOpening(weather),
    {
      lines: [
        isEid
          ? 'আজকের ঈদের আনন্দও আরও বেশি সুন্দর লাগে যখন ভাবি—আগামী দিনগুলোতে আমরা একসাথেই প্রতিটি উৎসব সাজাব।'
          : 'শুরুর দিনের সেই মিষ্টি কথাগুলো, তোমার লাজুক হাসি আর আমাদের একসাথে কাটানো প্রতিটা স্মৃতি আজও বুকের ভেতর তাজা হয়ে আছে।',
        'তুমি কিছু বলার আগেই যেমন বুঝে নিই তোমার মন কেমন আছে, তেমনি জানি—আমাদের একসাথে পথচলা কেবল শুরু হতে চলেছে।',
      ],
    },
    {
      lines: [
        'তোমার ছোট ছোট রাগ আর মিষ্টি অভিমান ভাঙাতে আমার একটুও ক্লান্তি লাগে না; বরং তোমার সব আবদার আগলে রাখতেই ভালোবাসি।',
        'হাতে হাত রেখে একসাথে ঘোরার সেই স্মৃতিগুলো মনে পড়ে, আর মনটা আরও অস্থির হয়ে ওঠে কবে আমরা সারাক্ষণ পাশাপাশি থাকব।',
      ],
    },
    {
      lines: [
        'আর মাত্র কিছুদিনের অপেক্ষা—তারপর আর বিদায় বলার কষ্ট থাকবে না, থাকবে না ফোনের ওপাশ থেকে শুধু কণ্ঠ শোনার আক্ষেপ।',
        isEid
          ? 'আমাদের ভালোবাসা আর একসাথে ঘর বাঁধার স্বপ্নটা খুব শীঘ্রই সুন্দর বাস্তবে রূপ নেবে।'
          : 'খুব শীঘ্রই একই ছাদের নিচে আমাদের হাসি-কান্না আর ভালোবাসার প্রতিটা দিন একসাথে শুরু হবে।',
      ],
    },
    {
      emphasis: 'whisper',
      lines: [
        'অপেক্ষাটা আর বেশি দিনের নয়—খুব তাড়াতাড়িই আমরা চিরতরে একসাথে হচ্ছি।',
        'সেদিন পর্যন্ত প্রতিটা স্মৃতি এভাবেই যত্নে সাজানো থাকুক।',
      ],
    },
    {
      emphasis: 'signature',
      lines: [
        '— যে খুব শীঘ্রই সারাজীবনের জন্য তোমার পাশে আসছে',
        'এই পাতাটি আমাদের ভালোবাসা আর একসাথে থাকার স্বপ্নের জন্য।',
      ],
    },
  ];
}

/**
 * লাইভ আবহাওয়ার সাথে মিলিয়ে তৈরি আবেগঘন লেখার ধারা (সম্পর্কের ধরন অনুযায়ী)
 */
export function buildWeatherSyncedStory(
  weather: RajshahiWeather,
  relationshipType: 'ex' | 'spouse' | 'couple' = 'ex'
): StoryStanza[] {
  if (relationshipType === 'spouse') {
    return buildSpouseWeatherSyncedStory(weather);
  }
  if (relationshipType === 'couple') {
    return buildCoupleWeatherSyncedStory(weather);
  }

  const isEid = checkIsEidToday(new Date());

  return [
    ...getWeatherSyncedOpening(weather),
    {
      lines: [
        isEid
          ? 'আমি তোমাকে কতটা ভালোবাসতাম, তা হয়তো কোনোদিন পুরোপুরি শব্দ দিয়ে বোঝাতে পারিনি। ঈদের খুশির দিনেও তোমার মুখের সেই আনন্দ দেখতে পাওয়ার মাঝে আমার সমস্ত সুখ লুকিয়ে থাকত।'
          : 'আমি তোমাকে কতটা ভালোবাসতাম, তা হয়তো কোনোদিন পুরোপুরি শব্দ দিয়ে বোঝাতে পারিনি। তোমার মুখের দিকে তাকালেই আমি তোমার না বলা কথাগুলো বুঝে যেতাম।',
        isEid
          ? 'তোমার ছোট ছোট আবদার, নতুন জামা পছন্দ করা—সব কিছুতেই আমার পৃথিবীটা রঙিন হয়ে উঠত।'
          : 'তুমি কিছু বলার আগেই বুঝতে পারতাম কখন তোমার মন খারাপ, কখন তুমি ভেতরে ভেতরে কষ্ট পাচ্ছো। আমার সমস্ত পৃথিবী যেন শুধু তোমাকে ঘিরেই আবর্তিত হতো.',
      ],
    },
    {
      lines: [
        isEid
          ? 'তোমার মুখের এক টুকরো হাসিতেই আমার সারাটা উৎসব সার্থক হয়ে যেত। যত ক্লান্তিই থাকুক, ঈদের সকালে তোমার সালামি বা হাসিমুখ দেখলে সব কষ্ট দূর হয়ে যেত।'
          : 'তোমার ছোট ছোট কথাতে, তোমার একটুকু ছোট্ট হাসিতেই আমার সারাটা দিন ভালো যেত। যত ক্লান্তিই থাকুক, তোমার একটা হাসি দেখলে মনে হতো পৃথিবীতে আর কোনো দুঃখই নেই।',
        'তুমি যখন মন খুলে কথা বলতে, আমি মুগ্ধ হয়ে শুনতাম—যেন সেই মুহূর্তটার বাইরে আর কোনো সময় নেই।',
      ],
    },
    {
      lines: [
        'তোমার অনেক অভিমান ছিল, চাঁদ। ছোট ছোট কারণে তুমি রাগ করতে, মুখ ফিরিয়ে নিতে—আর আমি তোমার সেই সব অভিমান হাসিমুখে মেনে নিতাম।',
        'কখনো তর্ক করিনি, কখনো তোমাকে হারতে দিইনি। তোমার হ্যাঁ-তে হ্যাঁ বলতাম, তোমার না-তে না বলতাম—কারণ তোমার ইচ্ছের চেয়ে বড় কিছু আমার কাছে কখনো ছিল না।',
      ],
    },
    getWeatherSyncedMidNote(weather),
    {
      lines: [
        'তুমি কখনো একটুখানি ব্যথা পেলে, তোমার চোখে সামান্য জল এলে আমার বুকের ভেতরটা হাহাকার করে উঠত। তোমার ব্যথায় আমি ব্যথা পেতাম।',
        isEid
          ? 'মনে হতো পৃথিবীর সমস্ত কষ্ট নিজের কাঁধে তুলে নিয়ে হলেও ঈদের এই দিনে শুধু তোমাকে সবচেয়ে সুখে রাখি।'
          : 'মনে হতো পৃথিবীর সমস্ত কষ্ট নিজের কাঁধে তুলে নিয়ে হলেও শুধু তোমাকে একটু শান্তিতে রাখি।',
      ],
    },
    {
      lines: [
        isEid
          ? 'সময়ের স্রোতে আজ আমরা দুজন দুই প্রান্তে। এখন আর আগের মতো উৎসবের দিনে একসাথে শুভেচ্ছা বিনিময় হয় না, তোমার অভিমান ভাঙানোর সুযোগও আর আসে না।'
          : 'সময়ের স্রোতে আজ আমরা দুজন দুই প্রান্তে। এখন আর আগের মতো সারাদিন কথা হয় না, তোমার অভিমান ভাঙানোর সুযোগও আর আসে না।',
        isEid
          ? 'তবু বিশ্বাস করো—ঈদের প্রতিটা মোনাজাতে আজও আমি তোমার ভালো থাকাটাই আল্লাহর কাছে চেয়েছি।'
          : 'তবু বিশ্বাস করো—একটা দিনের জন্যও তোমার কথা ভুলে থাকা আমার পক্ষে সম্ভব হয়নি। প্রতিটা নীরব মুহূর্তে আজও আমি তোমাকেই খুঁজি।',
      ],
    },
    {
      lines: [
        isEid
          ? 'আমাদের ভালোবাসা বা অনুভূতিগুলো মিথ্যে ছিল না। যদি কোনোদিন উৎসবের দিনে পুরোনো দিনগুলোর কথা মনে পড়ে, জেনে রেখো—কেউ একজন ছিল, যে তোমাকে খুব যত্নে, খুব গভীরভাবে ভালোবেসেছিল।'
          : 'অনুভূতিটাও মিথ্যে ছিল না। যদি কোনোদিন পুরোনো দিনগুলোর কথা মনে পড়ে, জেনে রেখো—কেউ একজন ছিল, যে তোমাকে খুব যত্ন করে, খুব গভীরভাবে ভালোবেসেছিল।',
      ],
    },
    {
      lines: [
        isEid
          ? 'তোমার ওপর আমার কোনো রাগ নেই, কোনো অভিযোগও নেই। আমি শুধু চেয়েছি, ঈদের এই পবিত্র দিনে তুমি যেভাবেই থাকো, যেখানেই থাকো—মন থেকে যেন খুব ভালো থাকো।'
          : 'তোমার ওপর আমার কোনো রাগ নেই, কোনো অভিযোগও নেই। আমি শুধু চেয়েছি, তুমি যেভাবেই থাকো, যেখানেই থাকো—মন থেকে যেন ভালো থাকো।',
        isEid
          ? 'ভালো থেকো, চাঁদ। তোমার জন্য আমার মনের ভেতর আজও অনেক মায়া রয়ে গেছে। দূরে থেকেও তোমার ঈদ আনন্দময় হোক।'
          : 'ভালো থেকো, চাঁদ। তোমার জন্য আমার মনের ভেতর আজও অনেক মায়া রয়ে গেছে। দূরে থেকেও তোমার ভালো থাকাটাই চাই।',
      ],
    },
    {
      lines: [
        'রাস্তা আলাদা হয়ে গেলে মানুষ হয়তো চোখের আড়াল হয়ে যায়, কিন্তু যে মানুষটাকে এত যত্নে মনের ভেতর রাখা হয়েছে, তাকে কি কখনো মুছে ফেলা যায়?',
        isEid
          ? 'যেখানেই থাকো, কখনো যদি নিজেকে একা মনে হয়, মনে রেখো—একসময় কেউ একজন ঈদের চাঁদ দেখার সময়ও শুধু তোমার কথাই ভেবেছিল।'
          : 'যেখানেই থাকো, কখনো যদি নিজেকে একা মনে হয়, মনে রেখো—একসময় কেউ একজন তোমাকে নিজের চেয়েও বেশি আগলে রাখতে চেয়েছিল।',
      ],
    },
    {
      emphasis: 'whisper',
      lines: [
        'কিছু মানুষ জীবনে থেকে যায় না,',
        isEid ? 'তবু তাদের সঙ্গে কাটানো উৎসবের মুহূর্তগুলো স্মৃতির ভেতর বেঁচে থাকে।' : 'তবু তাদের সঙ্গে কাটানো সময়টা স্মৃতির ভেতর থেকে যায়।',
        'আমাদের গল্প শেষ হয়ে গেছে হয়তো—কিন্তু সেই সময়টা আমার জীবনের সত্যি একটা অংশ।',
      ],
    },
    {
      emphasis: 'signature',
      lines: [
        isEid ? '— যে আজও তোমার সুখে থাকার দোয়া করে' : '— যে আজও তোমাকে ভালোবাসে',
        'এই পাতাটি শুধু মনের কিছু কথা ধরে রাখার জন্য।',
      ],
    },
  ];
}

export interface GeminiEmotionalEnrichment {
  openingLabel?: string;
  openingLines: string[];
  skyCoupletLines?: string[];
  midReflectionLines: string[];
  deepHeartbreakLines: string[];
  closingWhisperLines: string[];
}

export type AiCardVariant =
  | 'sky_frame'
  | 'poetic_couplet'
  | 'letter_sheet'
  | 'nocturne_plaque'
  | 'whisper_finale';

export interface AiDesignedStanza extends StoryStanza {
  variant: AiCardVariant;
  kicker?: string;
  indexStamp?: string;
}

const FORBIDDEN_AI_NAME_REGEX = /চাঁদ(?:র|কে|য়)?|চাঁদ(?:র|কে|য়)?/gi;

const cleanAiLines = (arr?: string[]): string[] =>
  Array.isArray(arr)
    ? arr
        .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
        .map((l) =>
          l
            .replace(FORBIDDEN_AI_NAME_REGEX, '')
            .replace(/\s*,\s*([।!?])/g, '$1')
            .replace(/,\s*$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
        )
        .filter(Boolean)
    : [];

/**
 * ওয়েদার মোডের জন্য শুধুমাত্র জেমিনি এআই-এর লেখা অংশগুলো (কোনো শিরোনাম, সংখ্যা বা নাম ছাড়া)।
 */
export function buildAiOnlyWeatherStanzas(
  _weather: RajshahiWeather,
  enriched: GeminiEmotionalEnrichment | null
): AiDesignedStanza[] {
  if (!enriched) return [];

  const openingLines = cleanAiLines(enriched.openingLines);
  const skyCoupletLines = cleanAiLines(enriched.skyCoupletLines);
  const midReflectionLines = cleanAiLines(enriched.midReflectionLines);
  const deepHeartbreakLines = cleanAiLines(enriched.deepHeartbreakLines);
  const closingWhisperLines = cleanAiLines(enriched.closingWhisperLines);

  const cards: AiDesignedStanza[] = [];

  if (openingLines.length > 0) {
    cards.push({
      variant: 'sky_frame',
      lines: openingLines,
    });
  }

  if (skyCoupletLines.length > 0) {
    cards.push({
      variant: 'poetic_couplet',
      lines: skyCoupletLines,
    });
  }

  if (midReflectionLines.length > 0) {
    cards.push({
      variant: 'letter_sheet',
      lines: midReflectionLines,
    });
  }

  if (deepHeartbreakLines.length > 0) {
    cards.push({
      variant: 'nocturne_plaque',
      lines: deepHeartbreakLines,
    });
  }

  if (closingWhisperLines.length > 0) {
    cards.push({
      variant: 'whisper_finale',
      emphasis: 'whisper',
      lines: closingWhisperLines,
    });
  }

  return cards;
}

export function extractStoryContextLines(stanzas: StoryStanza[]): string[] {
  const lines: string[] = [];
  for (const s of stanzas) {
    for (const line of s.lines) {
      if (line.trim()) lines.push(line.trim());
    }
  }
  return lines;
}

export function mergeGeminiEnrichedStory(
  baseStanzas: StoryStanza[],
  weather: RajshahiWeather,
  enriched: GeminiEmotionalEnrichment | null
): StoryStanza[] {
  if (!Array.isArray(baseStanzas) || !enriched || baseStanzas.length < 6) {
    return Array.isArray(baseStanzas) ? baseStanzas : [];
  }

  const openingLines = cleanAiLines(enriched.openingLines);
  const midReflectionLines = cleanAiLines(enriched.midReflectionLines);
  const deepHeartbreakLines = cleanAiLines(enriched.deepHeartbreakLines);
  const closingWhisperLines = cleanAiLines(enriched.closingWhisperLines);

  const tempText =
    weather.temperatureC !== null ? ` · ${toBengaliDigits(weather.temperatureC)}°C` : '';
  const defaultLabel = `আজকের আকাশ ও পরিবেশ · ${weather.descriptionBn}${tempText}`;
  const openingLabel =
    typeof enriched.openingLabel === 'string' && enriched.openingLabel.trim()
      ? `${enriched.openingLabel.trim()}${tempText}`
      : defaultLabel;

  const updated = baseStanzas.map((stanza) => ({
    ...stanza,
    lines: Array.isArray(stanza.lines) ? [...stanza.lines] : [],
  }));

  if (openingLines.length > 0) {
    updated[0] = {
      label: openingLabel,
      lines: openingLines,
    };
  }

  if (midReflectionLines.length > 0 && updated[4]) {
    updated[4] = {
      ...updated[4],
      lines: midReflectionLines,
    };
  }

  const whisperIdx = updated.findIndex((s) => s.emphasis === 'whisper');
  if (closingWhisperLines.length > 0 && whisperIdx !== -1) {
    updated[whisperIdx] = {
      emphasis: 'whisper',
      lines: closingWhisperLines,
    };
  }

  if (deepHeartbreakLines.length > 0) {
    const insertAt = whisperIdx !== -1 ? whisperIdx : Math.max(1, updated.length - 1);
    updated.splice(insertAt, 0, {
      lines: deepHeartbreakLines,
    });
  }

  return updated;
}

