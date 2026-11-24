import imgFirstRain from '../assets/images/memory_first_rain_1795038451060.jpg';
import imgFirstKiss from '../assets/images/memory_first_kiss_1795038451156.jpg';
import imgRooftopStars from '../assets/images/memory_rooftop_stars_1795038453229.jpg';
import imgAutumnWalk from '../assets/images/memory_autumn_walk_1795038453002.jpg';
import imgTrainWindow from '../assets/images/memory_train_window_1795038454205.jpg';
import imgMidnightMoon from '../assets/images/memory_midnight_moon_1795038453103.jpg';
import type { CloudMediaItem } from '../lib/cloudMediaStore';

export interface FloatingPhoto {
  id: string;
  src: string;
  title: string;
  dateLabel: string;
  location: string;
  caption: string;
  aspect: 'portrait' | 'landscape' | 'square';
  isCloud?: boolean;
  cloudItem?: CloudMediaItem;
}

export const BUILTIN_PHOTOS: FloatingPhoto[] = [
  {
    id: 'mem-01',
    src: imgFirstRain,
    title: 'এক ছাতার নিচে বৃষ্টিভেজা বিকেল',
    dateLabel: 'পুরোনো এক বিকেল',
    location: 'চেনা শহরের গলি',
    caption:
      'সেদিন রাস্তায় বৃষ্টির শব্দ ছাড়া আর কোনো কোলাহল ছিল না। পাশাপাশি হাঁটতে হাঁটতে মনে হয়েছিল, এই সময়টা বুঝি আর কখনোই ফুরাবে না। সবকিছু শেষ হয়ে গেলেও সেই ভেজা বিকেলের অনুভূতিটা আজও একদম সত্যি।',
    aspect: 'landscape',
  },
  {
    id: 'mem-02',
    src: imgFirstKiss,
    title: 'নদীর ধারে নিস্তব্ধ গোধূলি',
    dateLabel: 'সন্ধ্যার আকাশ',
    location: 'শান্ত নদীর পাড়',
    caption:
      'আকাশের রং তখন ধীরে ধীরে গাঢ় হচ্ছিল। জলের ওপর সূর্যের শেষ আলো আর আমাদের নীরব উপস্থিতি। মানুষ জীবনে থেকে যায় না, তবু সেই বিকেলে দাঁড়িয়ে থাকা মুহূর্তগুলো মনের ভেতর চিরস্থায়ী হয়ে থেকে যায়।',
    aspect: 'portrait',
  },
  {
    id: 'mem-03',
    src: imgRooftopStars,
    title: 'ছাদের কার্নিশে দুই কাপ চা',
    dateLabel: 'নিঝুম রাত',
    location: 'পুরোনো ছাদ',
    caption:
      'মাথার ওপর খোলা আকাশ, সামনে হালকা আলো আর অসংখ্য না বলা গল্প। সেসব রাতের কথা মনে পড়লে আজও বুকের ভেতর অদ্ভুত এক মায়া জমে ওঠে।',
    aspect: 'landscape',
  },
  {
    id: 'mem-04',
    src: imgAutumnWalk,
    title: 'ঝরা পাতার পথ ধরে হাঁটা',
    dateLabel: 'শীতের আগে এক সন্ধ্যা',
    location: 'নীরব পথ',
    caption:
      'হলুদ ল্যাম্পপোস্টের আলোয় ঝরা পাতার ওপর পায়ের শব্দ। কথা কম ছিল, কিন্তু একে অপরের পাশে থাকার অনুভূতিটা ছিল ভীষণ গভীর।',
    aspect: 'landscape',
  },
  {
    id: 'mem-05',
    src: imgTrainWindow,
    title: 'জানালার ওপারে দূরে সরে যাওয়া দিগন্ত',
    dateLabel: 'ফেরার পথ',
    location: 'সন্ধ্যার ট্রেন',
    caption:
      'কিছু পথ আলাদা হয়ে যায়, কিছু মানুষ দূরে সরে যায়। তবু জানালার বাইরে ডুবে যাওয়া সূর্যের মতো করেই তোমার জন্য মনের ভেতর শান্ত এক শুভকামনা থেকে যায়—ভালো থেকো, রুপো।',
    aspect: 'landscape',
  },
  {
    id: 'mem-06',
    src: imgMidnightMoon,
    title: 'মেঘের আড়ালে একাকী চাঁদ',
    dateLabel: 'অন্ধকার রাত',
    location: 'দূরের আকাশ',
    caption:
      'গল্পটা হয়তো শেষ হয়ে গেছে, তবু অনুভূতিটা কখনোই মিথ্যে ছিল না। দূর থেকেও শুধু এটুকুই চাই—তুমি যেখানেই থাকো, ভীষণ ভালো থেকো।',
    aspect: 'square',
  },
];

/**
 * `/api/media/list` এবং `/public/images/manifest.json` থেকে যেকোনো নামের আপলোড করা ছবি স্বয়ংক্রিয়ভাবে লোড করে
 */
export async function loadExternalManifest(): Promise<FloatingPhoto[]> {
  const discovered: FloatingPhoto[] = [];
  const seenSrc = new Set<string>();

  try {
    const response = await fetch('./images/manifest.json', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        data
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && item.src))
          .forEach((item, idx) => {
            const src =
              String(item.src).startsWith('./') || String(item.src).startsWith('http')
                ? String(item.src)
                : `./images/${String(item.src).replace(/^\/+/, '')}`;
            seenSrc.add(src);
            discovered.push({
              id: String(item.id ?? `ext-${idx + 1}`),
              src,
              title: String(item.title ?? `পুরোনো স্মৃতি #${idx + 1}`),
              dateLabel: String(item.dateLabel ?? 'স্মৃতির পাতা'),
              location: String(item.location ?? 'চেনা পথ'),
              caption: String(
                item.caption ??
                  'কিছু মানুষ জীবনে থেকে যায় না, তবু তাদের সঙ্গে কাটানো সময়টা স্মৃতির ভেতর থেকে যায়।'
              ),
              aspect: (['portrait', 'landscape', 'square'].includes(String(item.aspect))
                ? item.aspect
                : 'landscape') as 'portrait' | 'landscape' | 'square',
            });
          });
      }
    }
  } catch {
    // Ignore missing manifest
  }

  try {
    const mediaRes = await fetch('/api/media/list', { cache: 'no-store' });
    if (mediaRes.ok) {
      const mediaData = (await mediaRes.json()) as {
        images?: Array<{ src: string; filename: string }>;
      };
      if (Array.isArray(mediaData.images)) {
        mediaData.images.forEach((img, idx) => {
          if (!img.src || seenSrc.has(img.src)) return;
          seenSrc.add(img.src);
          discovered.push({
            id: `folder-img-${idx}-${img.filename}`,
            src: img.src,
            title: img.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || `স্মৃতি #${idx + 1}`,
            dateLabel: 'সংরক্ষিত স্মৃতি',
            location: 'চেনা পথ',
            caption: 'কিছু মানুষ জীবনে থেকে যায় না, তবু তাদের সঙ্গে কাটানো সময়টা স্মৃতির ভেতর থেকে যায়।',
            aspect: 'landscape',
          });
        });
      }
    }
  } catch {
    // Fallback gracefully
  }

  return discovered;
}
