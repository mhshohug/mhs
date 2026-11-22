export type SceneId =
  | 'forest'
  | 'village'
  | 'city'
  | 'river'
  | 'sea'
  | 'mountain'
  | 'train'
  | 'bus'
  | 'rooftop'
  | 'haor'
  | 'teagarden'
  | 'railbridge';

export interface SceneCatalogItem {
  id: SceneId;
  nameBn: string;
  subtitleBn: string;
  categoryBn: string;
  skySwatch: string;
  groundSwatch: string;
  accentHex: string;
}

export const SCENE_CATALOG: SceneCatalogItem[] = [
  {
    id: 'forest',
    nameBn: 'গহীন বন-জঙ্গল',
    subtitleBn: 'মেঠোপথ, হরিণ ও পাতায় ঘেরা নীরব অরণ্য',
    categoryBn: 'প্রকৃতি',
    skySwatch: '#1e3a4c',
    groundSwatch: '#1f331c',
    accentHex: '#86efac',
  },
  {
    id: 'village',
    nameBn: 'বাংলার শ্যামল গ্রাম',
    subtitleBn: 'মাটির ঘর, বাঁশঝাড়, ফসলের মাঠ ও ঋতুর ফুল-ফল',
    categoryBn: 'গ্রাম',
    skySwatch: '#2b5876',
    groundSwatch: '#3b5e2b',
    accentHex: '#fde047',
  },
  {
    id: 'city',
    nameBn: 'শহরের ব্যস্ত পথ',
    subtitleBn: 'উঁচু দালান, রাস্তার আলো ও ভেজা পিচে প্রতিফলন',
    categoryBn: 'শহর',
    skySwatch: '#162238',
    groundSwatch: '#1e2430',
    accentHex: '#fbbf24',
  },
  {
    id: 'river',
    nameBn: 'নদীর শান্ত তীর',
    subtitleBn: 'পালতোলা নৌকা, নদীর ঢেউ ও তীরের কাশফুল',
    categoryBn: 'জলপ্রকৃতি',
    skySwatch: '#27597a',
    groundSwatch: '#1b4965',
    accentHex: '#7dd3fc',
  },
  {
    id: 'sea',
    nameBn: 'উত্তাল সমুদ্র সৈকত',
    subtitleBn: 'ফেনিল ঢেউ, ভেজা বালুচর ও দূরের বাতিঘর',
    categoryBn: 'জলপ্রকৃতি',
    skySwatch: '#1a4a6b',
    groundSwatch: '#2d5a7b',
    accentHex: '#38bdf8',
  },
  {
    id: 'mountain',
    nameBn: 'কুয়াশাচ্ছন্ন পাহাড়',
    subtitleBn: 'স্তরে স্তরে পাহাড়, মেঘের উপত্যকা ও পাহাড়ি বন',
    categoryBn: 'পাহাড়',
    skySwatch: '#2f4562',
    groundSwatch: '#243b36',
    accentHex: '#a5b4fc',
  },
  {
    id: 'train',
    nameBn: 'চলন্ত ট্রেনের জানালা',
    subtitleBn: 'কামরার ভেতর থেকে ছুটতে থাকা প্রকৃতি ও কাঁচে বৃষ্টি',
    categoryBn: 'ভ্রমণ',
    skySwatch: '#264653',
    groundSwatch: '#2a3d29',
    accentHex: '#fcd34d',
  },
  {
    id: 'bus',
    nameBn: 'চলন্ত বাসের জানালা',
    subtitleBn: 'আধুনিক বাসের ভেতর থেকে মহাসড়কের ছুটে চলা দৃশ্য',
    categoryBn: 'ভ্রমণ',
    skySwatch: '#1d3557',
    groundSwatch: '#28303d',
    accentHex: '#93c5fd',
  },
  {
    id: 'rooftop',
    nameBn: 'শহরের ছাদ',
    subtitleBn: 'টবের ফুল-লতাপাতা, মরিচবাতি ও দূরের আকাশরেখা',
    categoryBn: 'শহর',
    skySwatch: '#222b45',
    groundSwatch: '#2f3542',
    accentHex: '#fda4af',
  },
  {
    id: 'haor',
    nameBn: 'বিস্তীর্ণ হাওর প্রান্তর',
    subtitleBn: 'আকাশছোঁয়া জলের আয়না, হিজল গাছ ও হারিকেনের নৌকা',
    categoryBn: 'জলপ্রকৃতি',
    skySwatch: '#2b4d66',
    groundSwatch: '#1f4159',
    accentHex: '#67e8f9',
  },
  {
    id: 'teagarden',
    nameBn: 'সবুজ চা-বাগান',
    subtitleBn: 'ঢেউখেলানো চা-পাহাড়, ছায়াবৃক্ষ ও সকালের কুয়াশা',
    categoryBn: 'পাহাড়',
    skySwatch: '#2c5364',
    groundSwatch: '#275933',
    accentHex: '#6ee7b7',
  },
  {
    id: 'railbridge',
    nameBn: 'নদীর ওপর রেলসেতু',
    subtitleBn: 'লোহার সেতু, জলের ঝিলিক ও সন্ধ্যায় জোনাকির আলো',
    categoryBn: 'ভ্রমণ',
    skySwatch: '#1c2e4a',
    groundSwatch: '#1a364d',
    accentHex: '#fed7aa',
  },
];
