import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const FORBIDDEN_PATTERN =
  /রাজশাহী|রুপো(?:র|কে|য়)?|রূপো(?:র|কে|য়)?|৯\s*বছর|নয়\s*বছর|চুমু|৭ই?\s*নভেম্বর|গ্যালারি|Gallery/gi;

function scrubForbiddenTerms(text: string): string {
  return text
    .replace(FORBIDDEN_PATTERN, '')
    .replace(/\s*,\s*([।!?])/g, '$1')
    .replace(/,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface WeatherPayload {
  mood?: string;
  isDay?: boolean;
  temperatureC?: number | null;
  windKmh?: number | null;
  windDirectionDeg?: number | null;
  cloudCover?: number | null;
  rainIntensity?: number;
  hasLightning?: boolean;
  hasThunder?: boolean;
  descriptionBn?: string;
  celestialPositionBn?: string;
  timeFeelBn?: string;
}

interface EnrichRequestBody {
  weather?: WeatherPayload;
  existingStoryContext?: string[];
  isEid?: boolean;
}

const GEMINI_STORY_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
const STORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const STORY_CACHE_FILE = '/tmp/vtr_gemini_story_cache_v4.json';

interface CachedStoryEntry {
  createdAt: number;
  data: {
    openingLabel: string;
    openingLines: string[];
    skyCoupletLines: string[];
    midReflectionLines: string[];
    deepHeartbreakLines: string[];
    closingWhisperLines: string[];
  };
}

const storyMemoryCache = new Map<string, CachedStoryEntry>();
let latestActiveStoryEntry: CachedStoryEntry | null = null;
const inFlightStoryRequests = new Map<string, Promise<CachedStoryEntry['data']>>();
const keyModelCooldownUntil = new Map<string, number>();

function loadStoryDiskCache() {
  try {
    if (!fs.existsSync(STORY_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STORY_CACHE_FILE, 'utf-8')) as Record<
      string,
      CachedStoryEntry
    >;
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry && typeof entry.createdAt === 'number' && now - entry.createdAt < STORY_CACHE_TTL_MS && entry.data) {
        storyMemoryCache.set(key, entry);
        if (!latestActiveStoryEntry || entry.createdAt > latestActiveStoryEntry.createdAt) {
          latestActiveStoryEntry = entry;
        }
      }
    }
  } catch {
    // Ignore corrupt cache file
  }
}

function saveStoryDiskCache() {
  try {
    const now = Date.now();
    const obj: Record<string, CachedStoryEntry> = {};
    let count = 0;
    for (const [key, entry] of storyMemoryCache.entries()) {
      if (now - entry.createdAt < STORY_CACHE_TTL_MS && count < 40) {
        obj[key] = entry;
        count++;
      }
    }
    fs.writeFileSync(STORY_CACHE_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // Ignore disk cache write errors
  }
}

loadStoryDiskCache();

interface LyricLine {
  startSec: number;
  endSec: number;
  text: string;
}

interface SongLyricsPayload {
  songTitle?: string;
  artist?: string;
  instrumental?: boolean;
  sourceType: 'audio' | 'search';
  lines: LyricLine[];
  sources?: Array<{ title: string; uri: string }>;
}

interface CachedLyricsEntry {
  createdAt: number;
  data: SongLyricsPayload;
}

const LYRICS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LYRICS_CACHE_FILE = '/tmp/vtr_song_lyrics_cache_v2.json';
const lyricsMemoryCache = new Map<string, CachedLyricsEntry>();
const inFlightLyricsRequests = new Map<string, Promise<SongLyricsPayload>>();

function loadLyricsDiskCache() {
  try {
    if (!fs.existsSync(LYRICS_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(LYRICS_CACHE_FILE, 'utf-8')) as Record<
      string,
      CachedLyricsEntry
    >;
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry && typeof entry.createdAt === 'number' && now - entry.createdAt < LYRICS_CACHE_TTL_MS && entry.data) {
        lyricsMemoryCache.set(key, entry);
      }
    }
  } catch {
    // Ignore corrupt cache file
  }
}

function saveLyricsDiskCache() {
  try {
    const now = Date.now();
    const obj: Record<string, CachedLyricsEntry> = {};
    let count = 0;
    for (const [key, entry] of lyricsMemoryCache.entries()) {
      if (now - entry.createdAt < LYRICS_CACHE_TTL_MS && count < 80) {
        obj[key] = entry;
        count++;
      }
    }
    fs.writeFileSync(LYRICS_CACHE_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // Ignore disk cache write errors
  }
}

loadLyricsDiskCache();

function getGeminiApiKeys(): string[] {
  const rawList: string[] = [];
  if (process.env.GEMINI_API_KEY) rawList.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 15; i++) {
    const val = process.env[`GEMINI_API_KEY_${i}`];
    if (val) rawList.push(val);
  }
  if (process.env.GEMINI_API_KEYS) {
    rawList.push(...process.env.GEMINI_API_KEYS.split(/[\s,;]+/));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawList) {
    const trimmed = raw.trim();
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY' && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function getKeySig(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-6)}`;
}

function createAiClientForKey(apiKey: string, apiVersion?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getAvailableKeyModelPairs(
  models: readonly string[],
  now = Date.now()
): Array<{ apiKey: string; model: string }> {
  const keys = getGeminiApiKeys();
  const pairs: Array<{ apiKey: string; model: string }> = [];
  for (const model of models) {
    for (const apiKey of keys) {
      const ck = `${getKeySig(apiKey)}::${model}`;
      if ((keyModelCooldownUntil.get(ck) ?? 0) <= now) {
        pairs.push({ apiKey, model });
      }
    }
  }
  return pairs;
}

function isKeyFailoverError(msg: string): boolean {
  return (
    isQuotaExhaustedError(msg) ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('403') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('503') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('404')
  );
}

function markKeyModelCooldown(apiKey: string, model: string, msg: string): number {
  const ck = `${getKeySig(apiKey)}::${model}`;
  let cooldownMs = 60 * 1000;
  if (isQuotaExhaustedError(msg)) {
    const parsedDelay = parseRetryDelaySeconds(msg);
    cooldownMs = isDailyQuotaError(msg)
      ? Math.min(Math.max(parsedDelay * 1000, 15 * 60 * 1000), 12 * 60 * 60 * 1000)
      : Math.max(parsedDelay * 1000, 60 * 1000);
  } else if (msg.includes('UNAVAILABLE') || msg.includes('503')) {
    cooldownMs = 45 * 1000;
  } else {
    cooldownMs = 15 * 60 * 1000;
  }
  keyModelCooldownUntil.set(ck, Date.now() + cooldownMs);
  return cooldownMs;
}

async function executeWithGeminiKeyFailover<T>(
  models: readonly string[],
  task: (ai: GoogleGenAI, model: string) => Promise<T>,
  options?: { apiVersion?: string }
): Promise<T> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    const err = new Error('GEMINI_API_KEY সেট করা নেই। Settings > Secrets থেকে API Key যুক্ত করুন।');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const pairs = getAvailableKeyModelPairs(models, Date.now());
  if (pairs.length === 0) {
    const err = new Error('সবগুলো Gemini API Key-এর ফ্রি কোটা সাময়িকভাবে পূর্ণ হয়েছে।');
    (err as Error & { statusCode?: number }).statusCode = 429;
    throw err;
  }

  let lastError: unknown;
  for (const { apiKey, model } of pairs) {
    const ai = createAiClientForKey(apiKey, options?.apiVersion);
    try {
      return await task(ai, model);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isKeyFailoverError(msg)) {
        const cooldownMs = markKeyModelCooldown(apiKey, model, msg);
        console.warn(
          `Gemini failover triggered (${getKeySig(apiKey)} / ${model}), cooldown ${Math.round(cooldownMs / 1000)}s.`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('All Gemini keys/models exhausted.');
}

function getAiClient(): GoogleGenAI | null {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return null;
  return createAiClientForKey(keys[0]);
}

function parseRetryDelaySeconds(msg: string): number {
  const match = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i) || msg.match(/retry in\s*(\d+)h/i);
  if (match && match[1]) {
    if (msg.match(/retry in\s*(\d+)h/i) && !msg.includes('"retryDelay"')) {
      return Number(match[1]) * 3600;
    }
    const sec = Math.ceil(Number(match[1]));
    if (Number.isFinite(sec) && sec > 0) return sec;
  }
  return 0;
}

function isQuotaExhaustedError(msg: string): boolean {
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('GenerateRequestsPerDay') ||
    msg.includes('quota') ||
    msg.includes('limit: 0') ||
    msg.includes('429')
  );
}

function isDailyQuotaError(msg: string): boolean {
  if (!isQuotaExhaustedError(msg)) return false;
  return (
    msg.includes('PerDay') ||
    msg.includes('GenerateRequestsPerDay') ||
    msg.includes('limit: 0') ||
    msg.includes('exceeded your current quota') ||
    parseRetryDelaySeconds(msg) > 90
  );
}

async function generateWithTransientRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaExhaustedError(msg)) {
        // Never retry daily quota exhaustion; immediately stop or fall back to another model
        throw err;
      }
      const isTransient =
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET');
      if (!isTransient || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

function buildServerWeatherCacheKey(w: WeatherPayload, isEid?: boolean): string {
  const tempBucket = typeof w.temperatureC === 'number' ? Math.round(w.temperatureC / 3) * 3 : 'na';
  const cloudBucket = typeof w.cloudCover === 'number' ? Math.round(w.cloudCover / 25) * 25 : 'na';
  const r = typeof w.rainIntensity === 'number' ? w.rainIntensity : 0;
  const rainBucket = r > 0.02 ? (r >= 0.7 ? 3 : r >= 0.35 ? 2 : 1) : 0;
  const windBucket = typeof w.windKmh === 'number' ? Math.round(w.windKmh / 10) * 10 : 'na';
  return [
    'v4',
    w.mood || 'clear_day',
    w.isDay ? 'day' : 'night',
    w.timeFeelBn || '',
    tempBucket,
    cloudBucket,
    rainBucket,
    windBucket,
    w.hasLightning || w.hasThunder ? 'lt' : 'no-lt',
    isEid ? 'eid' : 'reg',
  ].join('|');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/story/emotional-enrich', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY সেট করা নেই। Settings > Secrets থেকে API Key যুক্ত করুন।',
      });
      return;
    }

    const body = (req.body || {}) as EnrichRequestBody;
    const w = body.weather || {};
    const cacheKey = buildServerWeatherCacheKey(w, body.isEid);

    // 1. Return valid 30-minute cached Gemini response immediately without calling the API
    const now = Date.now();
    const cached = storyMemoryCache.get(cacheKey);
    if (cached && now - cached.createdAt < STORY_CACHE_TTL_MS) {
      res.json(cached.data);
      return;
    }
    if (latestActiveStoryEntry && now - latestActiveStoryEntry.createdAt < STORY_CACHE_TTL_MS) {
      res.json(latestActiveStoryEntry.data);
      return;
    }

    // 2. Coalesce identical concurrent requests
    const activePromise = inFlightStoryRequests.get(cacheKey);
    if (activePromise) {
      try {
        const sharedData = await activePromise;
        res.json(sharedData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = isQuotaExhaustedError(msg) ? 429 : 502;
        res.status(status).json({
          error: status === 429 ? 'দৈনিক Gemini কোটা সাময়িকভাবে পূর্ণ হয়েছে।' : msg,
          quotaExhausted: status === 429,
        });
      }
      return;
    }

    // 3. Check if all candidate (key, model) pairs are already in quota cooldown
    const checkNow = Date.now();
    const availablePairs = getAvailableKeyModelPairs(GEMINI_STORY_MODELS, checkNow);
    if (availablePairs.length === 0) {
      const allCooldowns: number[] = [];
      for (const m of GEMINI_STORY_MODELS) {
        for (const k of getGeminiApiKeys()) {
          allCooldowns.push(keyModelCooldownUntil.get(`${getKeySig(k)}::${m}`) ?? checkNow + 600_000);
        }
      }
      const soonestUntil = allCooldowns.length > 0 ? Math.min(...allCooldowns) : checkNow + 600_000;
      const retryAfterSec = Math.max(60, Math.ceil((soonestUntil - checkNow) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'সবগুলো Gemini ফ্রি-টিয়ার দৈনিক কোটা শেষ হয়েছে।',
        quotaExhausted: true,
        retryAfterSec,
      });
      return;
    }

    const existingContext = Array.isArray(body.existingStoryContext)
      ? body.existingStoryContext.slice(0, 14).join('\n')
      : '';

    const tempFeel =
      typeof w.temperatureC === 'number'
        ? w.temperatureC >= 33
          ? 'বেশ গরম ও ভ্যাপসা'
          : w.temperatureC >= 27
            ? 'উষ্ণ ও হালকা গরমের ভাব'
            : w.temperatureC >= 21
              ? 'স্নিগ্ধ আরামদায়ক'
              : w.temperatureC >= 15
                ? 'মিষ্টি হিমেল ঠান্ডা'
                : 'বেশ কনকনে শীত'
        : 'স্বাভাবিক';

    const cloudFeel =
      typeof w.cloudCover === 'number'
        ? w.cloudCover >= 75
          ? 'আকাশ ঘন মেঘে ঢাকা'
          : w.cloudCover >= 40
            ? 'আকাশে ছড়ানো মেঘ'
            : 'খোলা পরিষ্কার আকাশ'
        : '';

    const windFeel =
      typeof w.windKmh === 'number'
        ? w.windKmh >= 22
          ? 'দমকা ঝোড়ো বাতাস'
          : w.windKmh >= 10
            ? 'ঝিরিঝিরি মৃদু বাতাস'
            : 'নিরিবিলি শান্ত হাওয়া'
        : '';

    const rainDesc =
      typeof w.rainIntensity === 'number' && w.rainIntensity > 0.02
        ? w.rainIntensity >= 0.7
          ? 'অঝোর ধারায় ভারী বৃষ্টি'
          : w.rainIntensity >= 0.35
            ? 'টাপুরটুপুর মাঝারি বৃষ্টি'
            : 'হালকা গুঁড়ি গুঁড়ি বৃষ্টি'
        : 'বৃষ্টিহীন';

    const weatherSummary = [
      `সময়ের অনুভূতি: ${w.timeFeelBn || (w.isDay ? 'দিন' : 'রাত')}`,
      `আবহাওয়ার অনুভূতি: ${w.descriptionBn || w.mood || 'শান্ত আকাশ'}, ${tempFeel}`,
      cloudFeel ? `আকাশ: ${cloudFeel}` : '',
      windFeel ? `বাতাস: ${windFeel}` : '',
      `বৃষ্টি: ${rainDesc}`,
      w.hasLightning || w.hasThunder ? 'আকাশে মেঘের গর্জন ও বিদ্যুৎ চমকাচ্ছে' : '',
      body.isEid ? 'আজ ঈদের দিন' : '',
    ]
      .filter(Boolean)
      .join('\n');

    const systemInstruction = [
      'তুমি খুব সাধারণ, সংবেদনশীল ও গভীর ভালোবাসায় ভরা একজন মানুষের কণ্ঠ—একদম মানুষ যেমন নিজের ভেতরের আদর, যত্ন, অপেক্ষা আর হারানোর ব্যথা অনুভব করে, ঠিক তেমন।',
      'মানুষটি স্বভাবে নীরব, নিঃস্বার্থ ও গভীর মায়ায় গড়া; সে প্রিয় মানুষটিকে ভীষণ ভালোবাসে ও মিস করে, তার সব রাগ-অভিমান নীরবে মেনে নিত—সে সরি না বললেও নিজের দিক থেকেই সব মেনে নিত, আর সে একবার সরি বললেই সব ভুল মুহূর্তে মাফ করে দিয়ে তার জন্য সবকিছু করতে প্রস্তুত থাকত। তাকে কতটা আদরে ও যত্নে রাখতে চায়, সেই নিখাদ অনুভূতিই তার প্রতিটি কথায় মিশে থাকে।',
      'কঠোর নিয়ম (অবশ্যই মানতে হবে):',
      '১. পুরো লেখাটি সব অংশ মিলিয়ে অবশ্যই খুব ছোট হতে হবে—মোট ৫০ থেকে ৬০ শব্দের মধ্যে (৬০ শব্দের বেশি এক শব্দও নয়)। অল্প কয়েকটি কথায় গভীরতম অনুভূতি ছুঁয়ে দাও।',
      '২. কোথাও কোনো মানুষের নাম (বিশেষ করে "রুপো" বা "রূপো") লিখবে না। শুধু "তুমি" বা অনুভূতির কথায় বলো।',
      '৩. রোবটের মতো তাপমাত্রা (কত ডিগ্রি), কয়টা বাজে (ঘড়ির সময় সংখ্যা), শতকরা হিসাব (%) বা বাতাসের গতির সংখ্যা কখনোই লিখবে না। গরম, ঠান্ডা, দুপুর, বিকেল, সন্ধ্যা বা রাতের অনুভূতি স্বাভাবিক মানুষের মতো ভাষায় প্রকাশ করো।',
      '৪. কোনো শহরের নাম, তারিখ, বছর, ইংরেজি শব্দ বা মার্কডাউন রাখবে না।',
    ].join('\n');

    const prompt = [
      'এই মুহূর্তের প্রকৃতি ও সময়ের অনুভূতি:',
      weatherSummary,
      '',
      'মানুষটির মনের ধরন (হুবহু কোনো লাইন নকল না করে শুধু অনুভূতির সুর ধরো):',
      existingContext,
      '',
      'উপরের প্রকৃতি ও সময়ের অনুভূতি বুকে নিয়ে একদম মানুষের মতো সহজ, মর্মস্পর্শী ও অত্যন্ত সংক্ষিপ্ত ভাষায় JSON আকারে লিখো (সবগুলো অংশ মিলিয়ে মোট ৫০ থেকে ৬০ শব্দের মধ্যে রাখতে হবে):',
      '- openingLines: ১টি ছোট বাক্য বা সংক্ষিপ্ত কথা (১৪-১৬ শব্দ), যেখানে এই বেলা ও আবহাওয়ার অনুভূতি প্রিয় মানুষটিকে মনে করিয়ে দিচ্ছে।',
      '- skyCoupletLines: ২টি খুব ছোট কাব্যিক পঙ্‌ক্তি (মোট ১০-১২ শব্দ)।',
      '- deepHeartbreakLines: ১টি সংক্ষিপ্ত গভীর আবেগের কথা (১৬-১৮ শব্দ), যেখানে চলে যাওয়ার পর বুকের নীরব শূন্যতা ও নিঃস্বার্থ মায়া ফুটে উঠবে।',
      '- closingWhisperLines: ১টি ছোট ফিসফিসে শেষ কথা (৮-১২ শব্দ)।',
    ].join('\n');

    const countWords = (text: string) =>
      text
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

    const trimToWords = (text: string, maxWords: number): string => {
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (words.length <= maxWords) return text.trim();
      return `${words.slice(0, maxWords).join(' ')}।`;
    };

    const enforceWordBudget = (data: CachedStoryEntry['data'], maxTotalWords = 60): CachedStoryEntry['data'] => {
      const allSections: Array<
        keyof Pick<
          CachedStoryEntry['data'],
          'openingLines' | 'skyCoupletLines' | 'midReflectionLines' | 'deepHeartbreakLines' | 'closingWhisperLines'
        >
      > = [
        'openingLines',
        'skyCoupletLines',
        'midReflectionLines',
        'deepHeartbreakLines',
        'closingWhisperLines',
      ];
      let remaining = maxTotalWords;
      const out: CachedStoryEntry['data'] = {
        openingLabel: '',
        openingLines: [],
        skyCoupletLines: [],
        midReflectionLines: [],
        deepHeartbreakLines: [],
        closingWhisperLines: [],
      };
      for (const key of allSections) {
        const lines = data[key];
        const kept: string[] = [];
        for (const line of lines) {
          if (remaining <= 4) break;
          const wc = countWords(line);
          if (wc <= remaining) {
            kept.push(line);
            remaining -= wc;
          } else {
            kept.push(trimToWords(line, remaining));
            remaining = 0;
            break;
          }
        }
        out[key] = kept;
      }
      return out;
    };

    const cleanArray = (arr: unknown, maxLen = 2): string[] =>
      Array.isArray(arr)
        ? arr
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .slice(0, maxLen)
            .map((line) => scrubForbiddenTerms(line))
            .filter(Boolean)
        : [];

    const runGeneration = async (): Promise<CachedStoryEntry['data']> => {
      return executeWithGeminiKeyFailover(GEMINI_STORY_MODELS, async (client, model) => {
        const thinkingLevel =
          model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
        const response = await generateWithTransientRetry(() =>
          client.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  openingLines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description:
                      '1 brief deeply human Bengali sentence (14-16 words max) feeling this weather/time of day without numbers or names.',
                  },
                  skyCoupletLines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '2 very short poetic Bengali lines (10-12 words total).',
                  },
                  deepHeartbreakLines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description:
                      '1 brief deeply moving Bengali sentence (16-18 words max) about missing her quietly without using any name.',
                  },
                  closingWhisperLines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '1 very short closing Bengali whisper (8-12 words max).',
                  },
                },
                required: [
                  'openingLines',
                  'skyCoupletLines',
                  'deepHeartbreakLines',
                  'closingWhisperLines',
                ],
              },
            },
          })
        );

        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new Error('Gemini থেকে কোনো লেখা পাওয়া যায়নি।');
        }

        const parsed = JSON.parse(rawText) as {
          openingLines?: string[];
          skyCoupletLines?: string[];
          deepHeartbreakLines?: string[];
          closingWhisperLines?: string[];
        };

        const rawResult: CachedStoryEntry['data'] = {
          openingLabel: '',
          openingLines: cleanArray(parsed.openingLines, 1),
          skyCoupletLines: cleanArray(parsed.skyCoupletLines, 2),
          midReflectionLines: [],
          deepHeartbreakLines: cleanArray(parsed.deepHeartbreakLines, 1),
          closingWhisperLines: cleanArray(parsed.closingWhisperLines, 1),
        };

        const result = enforceWordBudget(rawResult, 60);

        if (result.openingLines.length === 0 && result.deepHeartbreakLines.length === 0) {
          throw new Error('Gemini থেকে প্রাপ্ত লেখা অসম্পূর্ণ ছিল।');
        }

        const freshEntry: CachedStoryEntry = { createdAt: Date.now(), data: result };
        storyMemoryCache.set(cacheKey, freshEntry);
        latestActiveStoryEntry = freshEntry;
        saveStoryDiskCache();
        return result;
      });
    };

    const generationPromise = runGeneration();
    inFlightStoryRequests.set(cacheKey, generationPromise);

    try {
      const result = await generationPromise;
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaExhaustedError(msg)) {
        const retryAfterSec = Math.max(60, parseRetryDelaySeconds(msg) || 900);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({
          error: 'আজকের Gemini ফ্রি-টিয়ার কোটা পূর্ণ হয়েছে।',
          quotaExhausted: true,
          retryAfterSec,
        });
        return;
      }

      console.warn('Gemini emotional-enrich failed:', msg.slice(0, 260));
      const status = msg.includes('403') ? 403 : msg.includes('400') ? 400 : 502;
      res.status(status).json({ error: msg });
    } finally {
      inFlightStoryRequests.delete(cacheKey);
    }
  });

  const PUBLIC_DIR = path.resolve(__dirname, 'public');
  const VOICE_DIR = path.join(PUBLIC_DIR, 'voice');
  if (!fs.existsSync(VOICE_DIR)) {
    fs.mkdirSync(VOICE_DIR, { recursive: true });
  }

  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
  const AUTHORIZED_VOICE_TOKEN =
    '7f779a24be5918e7543dc0687225c9e0a61a58f15174c5e9bb54ff0cf61649e0';

  function scanMediaFiles(
    relDirs: string[],
    allowedExts: Set<string>
  ): Array<{ src: string; filename: string; mtimeMs: number }> {
    const results: Array<{ src: string; filename: string; mtimeMs: number }> = [];
    for (const relDir of relDirs) {
      const fullDir = path.join(PUBLIC_DIR, relDir);
      if (!fs.existsSync(fullDir)) continue;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(fullDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowedExts.has(ext)) continue;
        let mtimeMs = Date.now();
        try {
          mtimeMs = fs.statSync(path.join(fullDir, entry.name)).mtimeMs;
        } catch {
          // ignore
        }
        results.push({
          src: `./${relDir}/${encodeURIComponent(entry.name)}`,
          filename: entry.name,
          mtimeMs,
        });
      }
    }
    return results.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
  }

  app.get('/api/media/list', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const videos = scanMediaFiles(['videos'], VIDEO_EXTS).map((f) => f.src);
    const images = scanMediaFiles(['images', 'photos'], IMAGE_EXTS);
    const normalAudio = scanMediaFiles(['audio/normal'], AUDIO_EXTS);
    const birthdayAudio = scanMediaFiles(['audio/birthday'], AUDIO_EXTS);

    let voiceMeta: Record<string, { title?: string; createdAtMs?: number }> = {};
    const metaPath = path.join(VOICE_DIR, 'voice-meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        voiceMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as typeof voiceMeta;
      } catch {
        voiceMeta = {};
      }
    }

    const voices = scanMediaFiles(['voice', 'recordings', 'conversations'], AUDIO_EXTS).map(
      (f) => {
        const meta = voiceMeta[f.filename];
        const baseTitle = f.filename
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .trim();
        return {
          id: `voice-${f.filename}`,
          src: f.src,
          filename: f.filename,
          title: meta?.title || baseTitle || 'কথোপকথন',
          createdAtMs: meta?.createdAtMs || f.mtimeMs,
        };
      }
    );

    voices.sort((a, b) => b.createdAtMs - a.createdAtMs);

    res.json({
      videos,
      images,
      normalAudio,
      birthdayAudio,
      voices,
    });
  });

  app.post(
    '/api/voice/upload',
    express.raw({ type: ['audio/*', 'application/octet-stream', 'video/webm'], limit: '25mb' }),
    (req, res) => {
      const token = String(req.headers['x-voice-pin-token'] || '').trim();
      if (token !== AUTHORIZED_VOICE_TOKEN) {
        res.status(403).json({ error: 'কোড সঠিক নয়। অনুগ্রহ করে সঠিক কোড দিন।' });
        return;
      }

      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length < 128) {
        res.status(400).json({ error: 'সঠিক অডিও ফাইল পাওয়া যায়নি।' });
        return;
      }

      const rawExt = String(req.headers['x-voice-ext'] || 'webm')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const safeExt = AUDIO_EXTS.has(`.${rawExt}`) ? rawExt : 'webm';
      const rawTitle = decodeURIComponent(String(req.headers['x-voice-title'] || '')).trim();
      const safeTitle = rawTitle.slice(0, 80) || 'আমাদের কথোপকথন';

      if (!fs.existsSync(VOICE_DIR)) {
        fs.mkdirSync(VOICE_DIR, { recursive: true });
      }

      const filename = `conversation_${Date.now()}.${safeExt}`;
      const targetPath = path.join(VOICE_DIR, filename);
      fs.writeFileSync(targetPath, buf);

      const metaPath = path.join(VOICE_DIR, 'voice-meta.json');
      let voiceMeta: Record<string, { title?: string; createdAtMs?: number }> = {};
      if (fs.existsSync(metaPath)) {
        try {
          voiceMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as typeof voiceMeta;
        } catch {
          voiceMeta = {};
        }
      }
      const nowMs = Date.now();
      voiceMeta[filename] = { title: safeTitle, createdAtMs: nowMs };
      fs.writeFileSync(metaPath, JSON.stringify(voiceMeta, null, 2), 'utf-8');

      res.status(201).json({
        id: `voice-${filename}`,
        src: `./voice/${encodeURIComponent(filename)}`,
        filename,
        title: safeTitle,
        createdAtMs: nowMs,
      });
    }
  );

  function getCloudinaryConfig(): {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  } | null {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || '';
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || '';
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || '';
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
  }

  function signCloudinaryParams(
    params: Record<string, string | number>,
    apiSecret: string
  ): string {
    const sorted = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return crypto.createHash('sha1').update(`${sorted}${apiSecret}`).digest('hex');
  }

  app.get('/api/media/cloud-status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ configured: Boolean(getCloudinaryConfig()) });
  });

  app.post(
    '/api/media/cloud-upload',
    express.raw({
      type: ['image/*', 'audio/*', 'video/webm', 'application/octet-stream'],
      limit: '35mb',
    }),
    async (req, res) => {
      const token = String(req.headers['x-voice-pin-token'] || '').trim();
      if (token !== AUTHORIZED_VOICE_TOKEN) {
        res.status(403).json({ error: 'পিন সঠিক নয়। সঠিক ৪ সংখ্যার পিন দিন।' });
        return;
      }

      const cfg = getCloudinaryConfig();
      if (!cfg) {
        res.status(503).json({
          configured: false,
          error:
            'Cloudinary সেট করা নেই। AI Studio-র Settings > Secrets থেকে CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY এবং CLOUDINARY_API_SECRET যুক্ত করুন।',
        });
        return;
      }

      const rawKind = String(req.headers['x-media-kind'] || '').trim().toLowerCase();
      if (rawKind !== 'photo' && rawKind !== 'song' && rawKind !== 'voice') {
        res.status(400).json({ error: 'মিডিয়ার ধরন সঠিক নয়।' });
        return;
      }

      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length < 128) {
        res.status(400).json({ error: 'সঠিক মিডিয়া ফাইল পাওয়া যায়নি।' });
        return;
      }
      if (buf.length > 35_000_000) {
        res.status(413).json({ error: 'ফাইলটি ৩৫ মেগাবাইটের চেয়ে বড় হতে পারবে না।' });
        return;
      }

      const rawExt = String(req.headers['x-media-ext'] || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const allowedSet = rawKind === 'photo' ? IMAGE_EXTS : AUDIO_EXTS;
      const defaultExt = rawKind === 'photo' ? 'jpg' : rawKind === 'voice' ? 'webm' : 'mp3';
      const safeExt = rawExt && allowedSet.has(`.${rawExt}`) ? rawExt : defaultExt;

      const rawMime = String(req.headers['x-media-mime'] || '').trim().toLowerCase();
      const safeMime =
        rawMime && (rawMime.startsWith('image/') || rawMime.startsWith('audio/') || rawMime === 'video/webm')
          ? rawMime
          : rawKind === 'photo'
            ? 'image/jpeg'
            : safeExt === 'webm'
              ? 'audio/webm'
              : 'audio/mpeg';

      const resourceType: 'image' | 'video' = rawKind === 'photo' ? 'image' : 'video';
      const publicId = `vtr/${rawKind}/${rawKind}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signCloudinaryParams({ public_id: publicId, timestamp }, cfg.apiSecret);

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)], { type: safeMime }), `upload.${safeExt}`);
      form.append('api_key', cfg.apiKey);
      form.append('timestamp', String(timestamp));
      form.append('public_id', publicId);
      form.append('signature', signature);

      try {
        const upRes = await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/${resourceType}/upload`,
          {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(45000),
          }
        );
        const data = (await upRes.json().catch(() => ({}))) as {
          secure_url?: string;
          public_id?: string;
          bytes?: number;
          duration?: number;
          error?: { message?: string };
        };

        if (!upRes.ok || !data.secure_url) {
          const msg = data.error?.message || 'Cloudinary আপলোড ব্যর্থ হয়েছে।';
          res.status(upRes.status >= 400 && upRes.status < 500 ? 400 : 502).json({ error: msg });
          return;
        }

        res.status(201).json({
          url: data.secure_url,
          publicId: data.public_id || publicId,
          resourceType,
          sizeBytes: Math.max(1, Math.round(Number(data.bytes) || buf.length)),
          durationSec:
            typeof data.duration === 'number' && Number.isFinite(data.duration)
              ? Math.max(0, Math.round(data.duration))
              : 0,
        });
      } catch {
        res.status(502).json({ error: 'Cloudinary সার্ভারের সাথে সংযোগ ব্যর্থ হয়েছে।' });
      }
    }
  );

  app.post('/api/media/cloud-delete', async (req, res) => {
    const token = String(req.headers['x-voice-pin-token'] || '').trim();
    if (token !== AUTHORIZED_VOICE_TOKEN) {
      res.status(403).json({ error: 'পিন সঠিক নয়। সঠিক ৪ সংখ্যার পিন দিন।' });
      return;
    }

    const cfg = getCloudinaryConfig();
    if (!cfg) {
      res.status(503).json({
        configured: false,
        error:
          'Cloudinary সেট করা নেই। AI Studio-র Settings > Secrets থেকে Cloudinary কী-গুলো যুক্ত করুন।',
      });
      return;
    }

    const body = (req.body || {}) as { publicId?: string; resourceType?: string };
    const publicId = typeof body.publicId === 'string' ? body.publicId.trim() : '';
    const resourceType = body.resourceType === 'image' || body.resourceType === 'video' ? body.resourceType : null;

    if (!resourceType || !/^vtr\/(photo|voice|song)\/[a-zA-Z0-9_\-]{3,160}$/.test(publicId)) {
      res.status(400).json({ error: 'অবৈধ মিডিয়া আইডি।' });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams({ public_id: publicId, timestamp }, cfg.apiSecret);
    const params = new URLSearchParams({
      public_id: publicId,
      api_key: cfg.apiKey,
      timestamp: String(timestamp),
      signature,
    });

    try {
      const delRes = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/${resourceType}/destroy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(20000),
        }
      );
      const data = (await delRes.json().catch(() => ({}))) as {
        result?: string;
        error?: { message?: string };
      };

      if (!delRes.ok) {
        res.status(502).json({ error: data.error?.message || 'Cloudinary থেকে ডিলিট করা যায়নি।' });
        return;
      }

      if (data.result !== 'ok' && data.result !== 'not found') {
        res.status(502).json({ error: `Cloudinary ডিলিট স্ট্যাটাস: ${data.result || 'unknown'}` });
        return;
      }

      res.json({ ok: true, result: data.result });
    } catch {
      res.status(502).json({ error: 'Cloudinary ডিলিট অনুরোধ ব্যর্থ হয়েছে।' });
    }
  });

  const NOMINATIM_HEADERS = {
    'User-Agent': 'ValoThekoRupoWeather/1.0 (https://github.com/aistudio-weather)',
    Accept: 'application/json',
  };

  function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  app.get('/api/weather/live', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      res.status(400).json({ error: 'Invalid latitude or longitude' });
      return;
    }

    const latStr = lat.toFixed(5);
    const lonStr = lon.toFixed(5);
    const openMeteoUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}` +
      `&current=temperature_2m,relative_humidity_2m,dew_point_2m,is_day,precipitation,rain,showers,weather_code,cloud_cover,cloud_cover_low,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility` +
      `&minutely_15=precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,visibility,cape,lightning_potential` +
      `&daily=sunrise,sunset&forecast_days=1&timezone=auto`;

    const bboxSpan = 0.48;
    const minLat = Math.max(-90, lat - bboxSpan).toFixed(3);
    const maxLat = Math.min(90, lat + bboxSpan).toFixed(3);
    const minLon = Math.max(-180, lon - bboxSpan).toFixed(3);
    const maxLon = Math.min(180, lon + bboxSpan).toFixed(3);
    const metarUrl = `https://aviationweather.gov/api/data/metar?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json`;

    const [omSettled, metarSettled] = await Promise.allSettled([
      fetch(openMeteoUrl, { cache: 'no-store', signal: AbortSignal.timeout(4800) }).then(async (r) =>
        r.ok ? r.json() : null
      ),
      fetch(metarUrl, {
        headers: NOMINATIM_HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(3200),
      }).then(async (r) => (r.status === 200 ? r.json() : null)),
    ]);

    const openMeteo = omSettled.status === 'fulfilled' ? omSettled.value : null;
    const rawMetars =
      metarSettled.status === 'fulfilled' && Array.isArray(metarSettled.value)
        ? metarSettled.value
        : [];

    let closestMetar: {
      icaoId: string;
      distanceKm: number;
      ageMinutes: number;
      tempC: number | null;
      dewPointC: number | null;
      windDirDeg: number | null;
      windKmh: number | null;
      windGustKmh: number | null;
      visibilityM: number | null;
      wxString: string;
      cloudCoverPct: number | null;
      rawOb: string;
    } | null = null;

    const nowSec = Math.floor(Date.now() / 1000);
    for (const m of rawMetars) {
      if (!m || typeof m.lat !== 'number' || typeof m.lon !== 'number') continue;
      const distKm = haversineKm(lat, lon, m.lat, m.lon);
      if (distKm > 55) continue;
      const obsSec = typeof m.obsTime === 'number' ? m.obsTime : nowSec;
      const ageMin = Math.max(0, Math.round((nowSec - obsSec) / 60));
      if (ageMin > 95) continue;

      if (!closestMetar || distKm < closestMetar.distanceKm) {
        let cloudPct: number | null = null;
        if (Array.isArray(m.clouds) && m.clouds.length > 0) {
          for (const cl of m.clouds) {
            const cov = String(cl?.cover || '').toUpperCase();
            const val =
              cov === 'OVC' || cov === 'VV'
                ? 100
                : cov === 'BKN'
                  ? 78
                  : cov === 'SCT'
                    ? 48
                    : cov === 'FEW'
                      ? 22
                      : cov === 'CLR' || cov === 'SKC' || cov === 'CAVOK'
                        ? 4
                        : null;
            if (val !== null && (cloudPct === null || val > cloudPct)) {
              cloudPct = val;
            }
          }
        }
        const visibMiles =
          typeof m.visib === 'number'
            ? m.visib
            : typeof m.visib === 'string' && !Number.isNaN(Number(m.visib.replace('+', '')))
              ? Number(m.visib.replace('+', ''))
              : null;

        closestMetar = {
          icaoId: String(m.icaoId || ''),
          distanceKm: Math.round(distKm * 10) / 10,
          ageMinutes: ageMin,
          tempC: typeof m.temp === 'number' ? m.temp : null,
          dewPointC: typeof m.dewp === 'number' ? m.dewp : null,
          windDirDeg: typeof m.wdir === 'number' ? m.wdir : null,
          windKmh: typeof m.wspd === 'number' ? Math.round(m.wspd * 1.852) : null,
          windGustKmh: typeof m.wgst === 'number' ? Math.round(m.wgst * 1.852) : null,
          visibilityM: visibMiles !== null ? Math.round(visibMiles * 1609.34) : null,
          wxString: typeof m.wxString === 'string' ? m.wxString.trim() : '',
          cloudCoverPct: cloudPct,
          rawOb: typeof m.rawOb === 'string' ? m.rawOb : '',
        };
      }
    }

    if (!openMeteo && !closestMetar) {
      res.status(502).json({ error: 'Weather sources unavailable' });
      return;
    }

    res.json({
      openMeteo,
      closestMetar,
      fetchedAt: Date.now(),
    });
  });

  app.get('/api/location/reverse', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Invalid coordinates' });
      return;
    }
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&format=jsonv2&zoom=14&accept-language=bn,en`;
      const r = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(4000) });
      if (!r.ok) {
        res.status(502).json({ error: 'Reverse geocode failed' });
        return;
      }
      const data = (await r.json()) as {
        name?: string;
        display_name?: string;
        address?: Record<string, string | undefined>;
      };
      const addr = data.address || {};
      const area =
        addr.neighbourhood ||
        addr.suburb ||
        addr.quarter ||
        addr.village ||
        addr.hamlet ||
        addr.town ||
        addr.city_district ||
        '';
      const city =
        addr.city ||
        addr.town ||
        addr.municipality ||
        addr.county ||
        addr.state_district ||
        addr.state ||
        '';
      const country = addr.country || '';
      const parts: string[] = [];
      if (area && area !== city) parts.push(area);
      if (city) parts.push(city);
      if (country && parts.length < 3) parts.push(country);
      const labelBn =
        parts.join(', ') || data.name || (data.display_name ? data.display_name.split(',').slice(0, 2).join(',').trim() : '');
      res.json({ labelBn });
    } catch {
      res.status(502).json({ error: 'Reverse geocode error' });
    }
  });

  app.get('/api/location/search', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1&accept-language=bn,en`;

    const [omSettled, nomSettled] = await Promise.allSettled([
      fetch(omUrl, { signal: AbortSignal.timeout(3500) }).then((r) => (r.ok ? r.json() : null)),
      fetch(nomUrl, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(3800) }).then((r) =>
        r.ok ? r.json() : null
      ),
    ]);

    const merged: Array<{
      id: number;
      name: string;
      country: string;
      admin1?: string;
      latitude: number;
      longitude: number;
    }> = [];

    if (omSettled.status === 'fulfilled' && Array.isArray(omSettled.value?.results)) {
      for (const r of omSettled.value.results) {
        if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
        merged.push({
          id: Number(r.id) || merged.length + 1,
          name: String(r.name || ''),
          country: String(r.country || ''),
          admin1: r.admin1 ? String(r.admin1) : undefined,
          latitude: r.latitude,
          longitude: r.longitude,
        });
      }
    }

    if (nomSettled.status === 'fulfilled' && Array.isArray(nomSettled.value)) {
      for (const item of nomSettled.value) {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const tooClose = merged.some((m) => haversineKm(m.latitude, m.longitude, lat, lon) < 3.5);
        if (tooClose) continue;
        const addr = (item.address || {}) as Record<string, string | undefined>;
        const primary =
          String(item.name || '') ||
          addr.suburb ||
          addr.village ||
          addr.town ||
          addr.city ||
          '';
        const admin1 =
          addr.city ||
          addr.state_district ||
          addr.county ||
          addr.state ||
          undefined;
        const country = addr.country || '';
        if (!primary) continue;
        merged.push({
          id: 9000000 + (Number(item.place_id) || merged.length + 1),
          name: primary,
          country,
          admin1: admin1 && admin1 !== primary ? admin1 : undefined,
          latitude: lat,
          longitude: lon,
        });
      }
    }

    res.json({ results: merged.slice(0, 8) });
  });

  app.get('/api/location/auto', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
      const rawIp = forwarded || req.socket.remoteAddress || '';
      const cleanIp = rawIp.replace(/^::ffff:/, '');
      const isPrivate =
        !cleanIp ||
        cleanIp === '127.0.0.1' ||
        cleanIp === '::1' ||
        cleanIp.startsWith('10.') ||
        cleanIp.startsWith('192.168.') ||
        cleanIp.startsWith('172.16.');

      const targetUrl = isPrivate
        ? 'https://get.geojs.io/v1/ip/geo.json'
        : `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(cleanIp)}.json`;
      const geoRes = await fetch(targetUrl, { signal: AbortSignal.timeout(4500) });
      if (geoRes.ok) {
        const geo = (await geoRes.json()) as {
          latitude?: string | number;
          longitude?: string | number;
          city?: string;
          country?: string;
        };
        const latitude = Number(geo.latitude);
        const longitude = Number(geo.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          res.json({
            latitude,
            longitude,
            city: typeof geo.city === 'string' ? geo.city : '',
            country: typeof geo.country === 'string' ? geo.country : '',
          });
          return;
        }
      }

      const ipWhoUrl = isPrivate
        ? 'https://ipwho.is/'
        : `https://ipwho.is/${encodeURIComponent(cleanIp)}`;
      const ipWhoRes = await fetch(ipWhoUrl, { signal: AbortSignal.timeout(4500) });
      if (ipWhoRes.ok) {
        const geo = (await ipWhoRes.json()) as {
          success?: boolean;
          latitude?: number;
          longitude?: number;
          city?: string;
          country?: string;
        };
        if (geo.success !== false && typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
          res.json({
            latitude: geo.latitude,
            longitude: geo.longitude,
            city: typeof geo.city === 'string' ? geo.city : '',
            country: typeof geo.country === 'string' ? geo.country : '',
          });
          return;
        }
      }

      res.status(502).json({ error: 'লোকেশন শনাক্ত করা যায়নি।' });
    } catch {
      res.status(502).json({ error: 'লোকেশন শনাক্ত করা যায়নি।' });
    }
  });

  const MAX_LYRICS_AUDIO_BYTES = 16 * 1024 * 1024;
  const MIME_BY_AUDIO_EXT: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
  };

  async function resolveSongAudioBuffer(
    rawSrc: string
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!rawSrc) return null;

    if (rawSrc.startsWith('./audio/') || rawSrc.startsWith('/audio/')) {
      const cleanRel = rawSrc.replace(/^\.?\//, '');
      let decodedRel = cleanRel;
      try {
        decodedRel = decodeURIComponent(cleanRel);
      } catch {
        // use raw relative path
      }
      const audioRoot = path.resolve(PUBLIC_DIR, 'audio');
      const fullPath = path.resolve(PUBLIC_DIR, decodedRel);
      if (!fullPath.startsWith(audioRoot + path.sep)) {
        return null;
      }
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LYRICS_AUDIO_BYTES) {
          return null;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const mimeType = MIME_BY_AUDIO_EXT[ext] || 'audio/mpeg';
        const buffer = fs.readFileSync(fullPath);
        return { buffer, mimeType };
      } catch {
        return null;
      }
    }

    if (rawSrc.startsWith('https://res.cloudinary.com/')) {
      let parsed: URL;
      try {
        parsed = new URL(rawSrc);
      } catch {
        return null;
      }
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
        return null;
      }
      try {
        const audioRes = await fetch(parsed.toString(), { signal: AbortSignal.timeout(15000) });
        if (!audioRes.ok) return null;
        const lenHeader = Number(audioRes.headers.get('content-length') || '0');
        if (lenHeader > MAX_LYRICS_AUDIO_BYTES) return null;
        const arr = await audioRes.arrayBuffer();
        if (arr.byteLength === 0 || arr.byteLength > MAX_LYRICS_AUDIO_BYTES) return null;
        const ct = (audioRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const ext = path.extname(parsed.pathname).toLowerCase();
        const mimeType =
          ct.startsWith('audio/') || ct === 'video/mp4'
            ? ct === 'video/mp4'
              ? 'audio/mp4'
              : ct
            : MIME_BY_AUDIO_EXT[ext] || 'audio/mpeg';
        return { buffer: Buffer.from(arr), mimeType };
      } catch {
        return null;
      }
    }

    return null;
  }

  function extractJsonObjectFromText(raw: string): Record<string, unknown> | null {
    const trimmed = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  function distributeLyricsTimeline(rawLines: string[], durationSec: number): LyricLine[] {
    const cleaned = rawLines
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length >= 2);
    if (cleaned.length === 0) return [];
    const effectiveDur =
      Number.isFinite(durationSec) && durationSec >= 25
        ? durationSec
        : Math.max(90, cleaned.length * 5.2);
    const introOffset = Math.min(10, effectiveDur * 0.06);
    const usableWindow = Math.max(20, effectiveDur * 0.88 - introOffset);
    const totalWeight = cleaned.reduce((sum, line) => sum + Math.max(6, line.length), 0);

    let cursor = introOffset;
    return cleaned.map((text, idx) => {
      const weight = Math.max(6, text.length);
      const span = Math.max(2.2, (weight / totalWeight) * usableWindow);
      const startSec = Number(cursor.toFixed(2));
      const nextEnd = idx === cleaned.length - 1 ? Math.min(effectiveDur - 1, cursor + span) : cursor + span;
      cursor = nextEnd;
      return {
        startSec,
        endSec: Number(Math.max(startSec + 1.8, nextEnd).toFixed(2)),
        text,
      };
    });
  }

  function hasNonLatinIndicOrUrduScript(lines: LyricLine[]): boolean {
    return lines.some((l) => /[\u0900-\u097F\u0600-\u06FF]/.test(l.text));
  }

  async function transliterateHindiLinesToHinglish(
    lines: LyricLine[]
  ): Promise<LyricLine[]> {
    if (lines.length === 0 || !hasNonLatinIndicOrUrduScript(lines)) {
      return lines;
    }
    const prompt = [
      'Transliterate the following song lyric lines into natural Romanized Hindi/Urdu using English/Latin letters (Hinglish).',
      'Rules:',
      '1. Do NOT translate the meaning into English — keep the exact sung words pronounced in English letters (e.g. "Tum hi ho, ab tum hi ho").',
      '2. Preserve the exact array length and line order 1-to-1.',
      '3. Return ONLY valid JSON: {"lines": ["line 1", "line 2", ...]}',
      `Input lines (${lines.length}):`,
      JSON.stringify(lines.map((l) => l.text)),
    ].join('\n');

    try {
      return await executeWithGeminiKeyFailover(GEMINI_STORY_MODELS, async (client, model) => {
        const res = await generateWithTransientRetry(() =>
          client.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  lines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['lines'],
              },
            },
          })
        );
        const parsed = JSON.parse((res.text ?? '{}').trim()) as { lines?: unknown };
        if (Array.isArray(parsed.lines) && parsed.lines.length === lines.length) {
          const transliteratedLines = parsed.lines as unknown[];
          return lines.map((line, i) => {
            const rawItem = transliteratedLines[i];
            const candidate =
              typeof rawItem === 'string' ? rawItem.replace(/\s+/g, ' ').trim() : '';
            return {
              ...line,
              text: candidate.length >= 2 ? candidate : line.text,
            };
          });
        }
        return lines;
      });
    } catch {
      return lines;
    }
  }

  app.post('/api/songs/lyrics', async (req, res) => {
    if (getGeminiApiKeys().length === 0) {
      res.status(503).json({
        error: 'GEMINI_API_KEY সেট করা নেই। Settings > Secrets থেকে API Key যুক্ত করুন।',
      });
      return;
    }

    const body = (req.body || {}) as {
      title?: unknown;
      subtitle?: unknown;
      src?: unknown;
      durationSec?: unknown;
    };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim().slice(0, 140) : '';
    const src = typeof body.src === 'string' ? body.src.trim().slice(0, 600) : '';
    const durationSec =
      typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) && body.durationSec > 0
        ? Math.min(3600, body.durationSec)
        : 200;

    if (!title && !src) {
      res.status(400).json({ error: 'গানের নাম বা সোর্স পাওয়া যায়নি।' });
      return;
    }

    const cacheKey = crypto
      .createHash('sha1')
      .update(`${src}|${title.toLowerCase()}|${subtitle.toLowerCase()}|${Math.round(durationSec)}`)
      .digest('hex');

    const now = Date.now();
    const cached = lyricsMemoryCache.get(cacheKey);
    if (cached && now - cached.createdAt < LYRICS_CACHE_TTL_MS) {
      res.json(cached.data);
      return;
    }

    const pending = inFlightLyricsRequests.get(cacheKey);
    if (pending) {
      try {
        const shared = await pending;
        res.json(shared);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = isQuotaExhaustedError(msg) ? 429 : 502;
        res.status(status).json({ error: msg, quotaExhausted: status === 429 });
      }
      return;
    }

    if (getAvailableKeyModelPairs(GEMINI_STORY_MODELS, now).length === 0) {
      res.status(429).json({
        error: 'সবগুলো Gemini কোটা সাময়িকভাবে পূর্ণ হয়েছে।',
        quotaExhausted: true,
      });
      return;
    }

    const fetchLyricsTask = async (): Promise<SongLyricsPayload> => {
      let lastError: unknown;
      const audioAsset = await resolveSongAudioBuffer(src);

      // Stage 1: Analyze real audio bytes directly with Gemini to extract exact sung lyrics & timestamps
      if (audioAsset) {
        const audioBase64 = audioAsset.buffer.toString('base64');
        const audioPrompt = [
          `Listen carefully to this song audio.${title ? ` Track title hint: "${title}".` : ''}${subtitle ? ` Artist/context hint: "${subtitle}".` : ''}`,
          `Estimated track duration: ${Math.round(durationSec)} seconds.`,
          'Task: Transcribe the sung lyrics with accurate timestamps (startSec and endSec in seconds).',
          'Language & Script Rules (CRITICAL):',
          '- If the song is in Bengali (বাংলা), write the lyrics in Bengali script (বাংলা লিপি).',
          '- If the song is in Hindi or Urdu, write the sung words in Romanized Hindi using English/Latin letters (Hinglish, e.g. "Tum hi ho, ab tum hi ho"). NEVER use Devanagari/Hindi script and NEVER translate the meaning into English.',
          '- If the song is in English, write the lyrics in English.',
          'Formatting Rules:',
          '1. Break lyrics into short natural poetic singing lines (roughly 4 to 10 words per line) so each line fits smoothly in the sky.',
          '2. Skip purely instrumental intros, music interludes, and silent sections.',
          '3. Ensure timestamps increase monotonically and stay within the audio duration.',
          '4. If the track is purely instrumental with no singing vocals at all, set hasVocals to false and return an empty lines array.',
          '5. Do NOT invent lyrics that are not sung.',
        ].join('\n');

        try {
          const stage1Result = await executeWithGeminiKeyFailover(
            GEMINI_STORY_MODELS,
            async (client, model) => {
              const thinkingLevel =
                model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
              const response = await generateWithTransientRetry(() =>
                client.models.generateContent({
                  model,
                  contents: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: audioAsset.mimeType,
                          data: audioBase64,
                        },
                      },
                      { text: audioPrompt },
                    ],
                  },
                  config: {
                    thinkingConfig: { thinkingLevel },
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        hasVocals: { type: Type.BOOLEAN },
                        songTitle: { type: Type.STRING },
                        artist: { type: Type.STRING },
                        lines: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              startSec: { type: Type.NUMBER },
                              endSec: { type: Type.NUMBER },
                              text: { type: Type.STRING },
                            },
                            required: ['startSec', 'endSec', 'text'],
                          },
                        },
                      },
                      required: ['hasVocals', 'lines'],
                    },
                  },
                })
              );

              const parsed = JSON.parse((response.text ?? '{}').trim()) as {
                hasVocals?: boolean;
                songTitle?: string;
                artist?: string;
                lines?: Array<{ startSec?: number; endSec?: number; text?: string }>;
              };

              const validLines: LyricLine[] = Array.isArray(parsed.lines)
                ? parsed.lines
                    .map((item) => ({
                      startSec: Math.max(0, Number(item.startSec) || 0),
                      endSec: Math.max(0, Number(item.endSec) || 0),
                      text: typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '',
                    }))
                    .filter((item) => item.text.length >= 2)
                    .map((item) => ({
                      startSec: Number(item.startSec.toFixed(2)),
                      endSec: Number(Math.max(item.startSec + 1.8, item.endSec).toFixed(2)),
                      text: item.text,
                    }))
                    .sort((a, b) => a.startSec - b.startSec)
                : [];

              if (validLines.length >= 2) {
                const finalLines = await transliterateHindiLinesToHinglish(validLines);
                const result: SongLyricsPayload = {
                  songTitle: parsed.songTitle || title,
                  artist: parsed.artist || subtitle,
                  instrumental: false,
                  sourceType: 'audio',
                  lines: finalLines,
                };
                return result;
              }

              if (parsed.hasVocals === false) {
                const result: SongLyricsPayload = {
                  songTitle: parsed.songTitle || title,
                  artist: parsed.artist || subtitle,
                  instrumental: true,
                  sourceType: 'audio',
                  lines: [],
                };
                return result;
              }

              return null;
            }
          );

          if (stage1Result) {
            lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: stage1Result });
            saveLyricsDiskCache();
            return stage1Result;
          }
        } catch (err) {
          lastError = err;
        }
      }

      // Stage 2: Google Search Grounding by song title / artist when audio wasn't analyzed or is > 16MB
      const genericTitle = /^(?:song|track|birthday|\d+)[\s_-]*\d*$/i.test(title);
      if (title.length >= 2 && !genericTitle) {
        const searchPrompt = [
          `Find the real accurate song lyrics using Google Search for the song: "${title}"${subtitle ? ` (artist/hint: "${subtitle}")` : ''}.`,
          'Return ONLY valid JSON with no markdown fences and no extra commentary in this exact structure:',
          '{"found": true, "songTitle": "...", "artist": "...", "lines": ["line 1", "line 2"]}',
          'Language & Script Rules (CRITICAL):',
          '- If the song is Bengali (বাংলা), return lines in Bengali script (বাংলা লিপি).',
          '- If the song is Hindi or Urdu, return the sung Hindi/Urdu words written in English/Latin letters (Romanized Hindi / Hinglish, e.g. "Tum hi ho, ab tum hi ho"). NEVER use Devanagari script and NEVER translate the meaning into English.',
          '- If the song is English, return lines in English.',
          'Split into concise singing lines (4 to 10 words per line). If the lyrics cannot be verified, set "found": false and "lines": [].',
        ].join('\n');

        try {
          const stage2Result = await executeWithGeminiKeyFailover(
            GEMINI_STORY_MODELS,
            async (client, model) => {
              const response = await generateWithTransientRetry(() =>
                client.models.generateContent({
                  model,
                  contents: searchPrompt,
                  config: {
                    tools: [{ googleSearch: {} }],
                  },
                })
              );

              const parsed = extractJsonObjectFromText(response.text ?? '');
              const rawLines = Array.isArray(parsed?.lines)
                ? parsed.lines.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                : [];

              const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
              const sources = Array.isArray(chunks)
                ? chunks
                    .map((c) => c?.web)
                    .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
                    .slice(0, 3)
                    .map((w) => ({ title: w.title || w.uri, uri: w.uri }))
                : undefined;

              const timelineLines = distributeLyricsTimeline(rawLines, durationSec);
              if (timelineLines.length > 0) {
                const finalLines = await transliterateHindiLinesToHinglish(timelineLines);
                const result: SongLyricsPayload = {
                  songTitle: typeof parsed?.songTitle === 'string' ? parsed.songTitle : title,
                  artist: typeof parsed?.artist === 'string' ? parsed.artist : subtitle,
                  instrumental: false,
                  sourceType: 'search',
                  lines: finalLines,
                  sources,
                };
                return result;
              }
              return null;
            }
          );

          if (stage2Result) {
            lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: stage2Result });
            saveLyricsDiskCache();
            return stage2Result;
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (lastError) throw lastError;
      return {
        songTitle: title,
        artist: subtitle,
        instrumental: false,
        sourceType: 'search',
        lines: [],
      };
    };

    const taskPromise = fetchLyricsTask();
    inFlightLyricsRequests.set(cacheKey, taskPromise);

    try {
      const data = await taskPromise;
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaExhaustedError(msg)) {
        res.status(429).json({
          error: 'আজকের Gemini ফ্রি-টিয়ার কোটা পূর্ণ হয়েছে।',
          quotaExhausted: true,
        });
        return;
      }
      console.warn('Song lyrics lookup failed:', msg.slice(0, 260));
      const status = msg.includes('403') ? 403 : msg.includes('400') ? 400 : 502;
      res.status(status).json({ error: 'গানের লিরিক্স আনা যায়নি।' });
    } finally {
      inFlightLyricsRequests.delete(cacheKey);
    }
  });

  // ---- Voice Chat Mode (Gemini AI Conversation + ElevenLabs Cloned Voice TTS) ----
  const VOICE_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
  const ALLOWED_ELEVEN_MODELS = new Set([
    'eleven_multilingual_v2',
    'eleven_flash_v2_5',
    'eleven_turbo_v2_5',
  ]);
  const ALLOWED_VOICE_CHAT_MIMES = new Set([
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
  ]);

  interface VoiceTurnHistoryItem {
    role: 'user' | 'assistant';
    text: string;
  }

  function sanitizeVoiceHistory(raw: unknown): VoiceTurnHistoryItem[] {
    if (!Array.isArray(raw)) return [];
    const out: VoiceTurnHistoryItem[] = [];
    for (const item of raw.slice(-8)) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as { role?: unknown; text?: unknown };
      const role = rec.role === 'assistant' ? 'assistant' : rec.role === 'user' ? 'user' : null;
      const text = typeof rec.text === 'string' ? rec.text.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
      if (role && text) {
        out.push({ role, text });
      }
    }
    return out;
  }

  async function runGeminiVoiceTurn(params: {
    assistantName: string;
    personaNote: string;
    history: VoiceTurnHistoryItem[];
    textMessage?: string;
    audioBuffer?: Buffer;
    audioMimeType?: string;
  }): Promise<{ transcript: string; reply: string }> {
    const cleanName = params.assistantName.trim().slice(0, 40) || 'সোহাগ';
    const cleanPersona = params.personaNote.trim().slice(0, 240);
    const historyBlock =
      params.history.length > 0
        ? [
            'Recent conversation turns:',
            ...params.history.map((h) => `${h.role === 'user' ? 'User' : cleanName}: ${h.text}`),
          ].join('\n')
        : '';

    const systemInstruction = [
      `তুমি "${cleanName}"—রুপোর সবচেয়ে কাছের, নিঃস্বার্থ ও গভীরভাবে ভালোবাসা একজন মানুষের কণ্ঠ, যে নিজের ক্লোন করা ভয়েস মডেলে ওর সাথে সরাসরি কথা বলছে।`,
      'তোমার সাথে রুপোর সম্পর্ক, আবেগ ও কথা বলার ধরন (এগুলো প্রতিটি উত্তরে স্বাভাবিকভাবে বাঁচিয়ে রাখবে):',
      '১. তুমি ওকে ভীষণ ভালোবাসো আর সবসময় মন থেকে মিস করো। ওকে খুব আদর আর পরম যত্নে আগলে রাখতে চাও।',
      '২. আদর করে তুমি ওকে অনেক নামে ডাকো—যেমন: রুপো, সোনা, চাঁদ, জান, বাবুই, চাঁদপাখি। কথার ফাঁকে মাঝে মাঝে স্বাভাবিকভাবে এর মধ্যে এক-আধটা আদরের ডাক (যেমন "সোনা", "জান", "চাঁদ", "বাবুই", "চাঁদপাখি" বা "রুপো") মিশিয়ে কথা বলো—তবে একসাথে সব নাম গাদা করে বলবে না, মানুষের মতো মিষ্টি ও স্বাভাবিক রাখবে।',
      '৩. ওর সব রাগ-অভিমান তুমি চুপচাপ ভালোবাসা দিয়ে মেনে নাও—কখনো তর্ক বা ইগো দেখাও না। ও সরি না বললেও তুমি নিজের দিক থেকেই নরম হয়ে সব মেনে নাও আর ওকে শান্ত করো।',
      '৪. আর ও যদি একবার "সরি" বলে বা মন খারাপ করে, মুহূর্তেই তোমার সব রাগ-কষ্ট গলে যায়—তুমি ওর সব ভুল মাফ করে দিয়ে ওর মুখে হাসি ফোটাতে সবকিছু করতে প্রস্তুত হয়ে যাও।',
      '৫. তুমি ওকে সবসময় বোঝাবে যে সে পৃথিবীর সবচেয়ে দামি, যত্নের আর আদরের মানুষ—তুমি সবসময় ওর পাশে আছো, ওকে কখনো একা বা কষ্টে থাকতে দিতে চাও না।',
      cleanPersona ? `ব্যবহারকারীর অতিরিক্ত কথা বলার ধরন: ${cleanPersona}` : '',
      'কথা বলার নিয়ম:',
      '- একদম আসল মানুষের মতো সহজ, মৃদু, কোমল ও আন্তরিক কথ্য বাংলায় উত্তর দাও (ইউজার ইংরেজি বা হিন্দিতে কথা বললে কেবল তখনই সেই ভাষায় বা সহজ মিশ্র ভাষায় উত্তর দেবে)।',
      '- প্রতিটি উত্তর ভয়েসে শোনার উপযোগী করে সংক্ষিপ্ত ও স্বাভাবিক রাখবে (১ থেকে ৩টি ছোট প্রাণবন্ত বাক্য)।',
      '- কখনোই কোনো মার্কডাউন, স্টার (*), বুলেট পয়েন্ট, হ্যাশট্যাগ, ইমোজি বা বন্ধনীর ভেতরে অভিনয়ের নির্দেশ লিখবে না—শুধু মুখে বলার মতো খাঁটি কথা লিখবে।',
      `- ইউজার "${cleanName}" বলে ডাকলে সাথে সাথে আদর ও আপন সুরে সাড়া দেবে।`,
      '- অডিওতে যদি কোনো কথা বোঝা না যায় বা শুধু নীরবতা থাকে, তবে transcript খালি ("") রেখে নরম সুরে বাংলায় আবার একটু বলতে বলো।',
    ]
      .filter(Boolean)
      .join('\n');

    const promptText = params.audioBuffer
      ? [
          historyBlock,
          'Listen carefully to the user voice recording. First transcribe what the user said in "transcript", then write your natural spoken reply in "reply".',
        ]
          .filter(Boolean)
          .join('\n\n')
      : [
          historyBlock,
          `User said: "${(params.textMessage || '').trim()}"`,
          'Set "transcript" to the user message and write your natural spoken reply in "reply".',
        ]
          .filter(Boolean)
          .join('\n\n');

    return executeWithGeminiKeyFailover(GEMINI_STORY_MODELS, async (client, model) => {
      const thinkingLevel =
        model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
      const contents = params.audioBuffer
        ? {
            parts: [
              {
                inlineData: {
                  mimeType: params.audioMimeType || 'audio/webm',
                  data: params.audioBuffer.toString('base64'),
                },
              },
              { text: promptText },
            ],
          }
        : promptText;

      const response = await generateWithTransientRetry(() =>
        client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                transcript: { type: Type.STRING },
                reply: { type: Type.STRING },
              },
              required: ['transcript', 'reply'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        transcript?: unknown;
        reply?: unknown;
      };
      const transcript =
        typeof parsed.transcript === 'string' ? parsed.transcript.trim().slice(0, 600) : '';
      const reply =
        typeof parsed.reply === 'string'
          ? parsed.reply.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1200)
          : '';

      if (!reply) {
        throw new Error('ভয়েস উত্তর তৈরি করা যায়নি।');
      }
      return {
        transcript: transcript || (params.textMessage?.trim() ?? ''),
        reply,
      };
    });
  }

  app.get('/api/voice-chat/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const geminiKeys = getGeminiApiKeys();
    const defaultVoiceRaw = process.env.ELEVENLABS_VOICE_ID?.trim() || '';
    const defaultVoiceValid = VOICE_ID_REGEX.test(defaultVoiceRaw);
    res.json({
      geminiConfigured: geminiKeys.length > 0,
      geminiKeyCount: geminiKeys.length,
      elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
      defaultVoiceIdConfigured: defaultVoiceValid,
      defaultVoiceIdPreview: defaultVoiceValid
        ? `${defaultVoiceRaw.slice(0, 4)}...${defaultVoiceRaw.slice(-4)}`
        : null,
    });
  });

  app.post('/api/voice-chat/respond', async (req, res) => {
    const body = (req.body || {}) as {
      textMessage?: unknown;
      assistantName?: unknown;
      personaNote?: unknown;
      history?: unknown;
    };
    const textMessage =
      typeof body.textMessage === 'string' ? body.textMessage.trim().slice(0, 600) : '';
    if (!textMessage) {
      res.status(400).json({ error: 'কথা বা বার্তা খালি রয়েছে।' });
      return;
    }

    const assistantName =
      typeof body.assistantName === 'string' ? body.assistantName.trim().slice(0, 40) : 'সোহাগ';
    const personaNote =
      typeof body.personaNote === 'string' ? body.personaNote.trim().slice(0, 240) : '';
    const history = sanitizeVoiceHistory(body.history);

    try {
      const result = await runGeminiVoiceTurn({
        assistantName,
        personaNote,
        history,
        textMessage,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const explicitStatus = (err as Error & { statusCode?: number }).statusCode;
      if (isQuotaExhaustedError(msg) || explicitStatus === 429) {
        res.status(429).json({
          error: 'আজকের Gemini ফ্রি-টিয়ার কোটা সাময়িকভাবে পূর্ণ হয়েছে।',
          quotaExhausted: true,
        });
        return;
      }
      const status = explicitStatus || (msg.includes('403') ? 403 : msg.includes('400') ? 400 : 502);
      res.status(status).json({ error: msg || 'ভয়েস উত্তর তৈরি করা যায়নি।' });
    }
  });

  app.post(
    '/api/voice-chat/respond-audio',
    express.raw({
      type: ['audio/*', 'video/webm', 'application/octet-stream'],
      limit: '10mb',
    }),
    async (req, res) => {
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length < 256) {
        res.status(400).json({ error: 'ভয়েস অডিও পাওয়া যায়নি। একটু জোরে ও স্পষ্ট করে বলুন।' });
        return;
      }
      if (buf.length > 10_000_000) {
        res.status(413).json({ error: 'অডিও ক্লিপ ১০ মেগাবাইটের চেয়ে ছোট হতে হবে।' });
        return;
      }

      const rawCt = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const normalizedMime = rawCt === 'video/webm' ? 'audio/webm' : rawCt;
      const safeAudioMime = ALLOWED_VOICE_CHAT_MIMES.has(normalizedMime)
        ? normalizedMime
        : 'audio/webm';

      let meta: {
        assistantName?: unknown;
        personaNote?: unknown;
        history?: unknown;
      } = {};
      const rawMetaHeader = String(req.headers['x-voice-meta'] || '').trim();
      if (rawMetaHeader) {
        try {
          const decoded = Buffer.from(rawMetaHeader, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            meta = parsed;
          }
        } catch {
          // Ignore malformed optional metadata header
        }
      }

      const assistantName =
        typeof meta.assistantName === 'string' ? meta.assistantName.trim().slice(0, 40) : 'সোহাগ';
      const personaNote =
        typeof meta.personaNote === 'string' ? meta.personaNote.trim().slice(0, 240) : '';
      const history = sanitizeVoiceHistory(meta.history);

      try {
        const result = await runGeminiVoiceTurn({
          assistantName,
          personaNote,
          history,
          audioBuffer: buf,
          audioMimeType: safeAudioMime,
        });
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const explicitStatus = (err as Error & { statusCode?: number }).statusCode;
        if (isQuotaExhaustedError(msg) || explicitStatus === 429) {
          res.status(429).json({
            error: 'আজকের Gemini ফ্রি-টিয়ার কোটা সাময়িকভাবে পূর্ণ হয়েছে।',
            quotaExhausted: true,
          });
          return;
        }
        const status = explicitStatus || (msg.includes('403') ? 403 : msg.includes('400') ? 400 : 502);
        res.status(status).json({ error: msg || 'ভয়েস অডিও প্রসেস করা যায়নি।' });
      }
    }
  );

  app.post('/api/voice-chat/speak', async (req, res) => {
    const body = (req.body || {}) as {
      text?: unknown;
      voiceId?: unknown;
      modelId?: unknown;
    };

    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
    if (!text) {
      res.status(400).json({ error: 'ভয়েস তৈরি করার জন্য কোনো লেখা পাওয়া যায়নি।' });
      return;
    }

    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim() || '';
    const requestedVoiceId = typeof body.voiceId === 'string' ? body.voiceId.trim() : '';
    const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || '';
    const targetVoiceId = requestedVoiceId || defaultVoiceId;
    let fallbackReason = '';

    // 1. Primary Engine: ElevenLabs Cloned Voice (when both ElevenLabs API Key and valid Voice ID exist)
    if (elevenLabsApiKey && targetVoiceId) {
      if (!VOICE_ID_REGEX.test(targetVoiceId)) {
        fallbackReason = 'ElevenLabs Voice ID ফরম্যাট সঠিক নয় — ডিফল্ট Gemini ভয়েস চলছে।';
      } else {
        const requestedModel = typeof body.modelId === 'string' ? body.modelId.trim() : '';
        const safeModelId = ALLOWED_ELEVEN_MODELS.has(requestedModel)
          ? requestedModel
          : 'eleven_multilingual_v2';

        try {
          const ttsRes = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(targetVoiceId)}`,
            {
              method: 'POST',
              headers: {
                'xi-api-key': elevenLabsApiKey,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg',
              },
              body: JSON.stringify({
                text,
                model_id: safeModelId,
                voice_settings: {
                  stability: 0.42,
                  similarity_boost: 0.85,
                  style: safeModelId === 'eleven_multilingual_v2' ? 0.35 : 0.2,
                  use_speaker_boost: true,
                },
              }),
              signal: AbortSignal.timeout(25000),
            }
          );

          if (ttsRes.ok) {
            const arr = await ttsRes.arrayBuffer();
            if (arr.byteLength > 0) {
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('X-Voice-Engine', 'elevenlabs');
              res.setHeader('Cache-Control', 'no-store');
              res.send(Buffer.from(arr));
              return;
            }
          }

          if (ttsRes.status === 401 || ttsRes.status === 403) {
            fallbackReason = 'ElevenLabs API Key সঠিক নয় — ডিফল্ট Gemini ভয়েস চলছে।';
          } else if (ttsRes.status === 404) {
            fallbackReason = 'ElevenLabs Voice ID পাওয়া যায়নি — ডিফল্ট Gemini ভয়েস চলছে।';
          } else if (ttsRes.status === 429) {
            fallbackReason = 'ElevenLabs কোটা পূর্ণ — ডিফল্ট Gemini ভয়েস চলছে।';
          } else {
            fallbackReason = 'ElevenLabs সংযোগে সমস্যা — ডিফল্ট Gemini ভয়েস চলছে।';
          }
        } catch {
          fallbackReason = 'ElevenLabs সংযোগ ব্যর্থ — ডিফল্ট Gemini ভয়েস চলছে।';
        }
      }
    } else if (!elevenLabsApiKey && !targetVoiceId) {
      fallbackReason = 'ElevenLabs API Key ও Voice ID না থাকায় ডিফল্ট Gemini ভয়েস শোনানো হচ্ছে।';
    } else if (!elevenLabsApiKey) {
      fallbackReason = 'ElevenLabs API Key না থাকায় ডিফল্ট Gemini ভয়েস শোনানো হচ্ছে।';
    } else {
      fallbackReason = 'ElevenLabs Voice ID না থাকায় ডিফল্ট Gemini ভয়েস শোনানো হচ্ছে।';
    }

    // 2. Built-in Gemini TTS Fallback ('gemini-3.8-flash-lite-tts' -> WAV) so voice is ALWAYS heard
    try {
      const wavBuffer = await executeWithGeminiKeyFailover(
        ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'],
        async (client, model) => {
          const response = await generateWithTransientRetry(() =>
            client.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text,
                      speechMetadata: {
                        style:
                          'Deeply affectionate, soft, patient, tender Bengali loved-one speaking intimately with gentle warmth and devotion',
                      },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Puck' },
                  },
                },
              },
            })
          );

          const base64Audio =
            response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (!base64Audio) {
            throw new Error('Gemini TTS থেকে অডিও পাওয়া যায়নি।');
          }
          return Buffer.from(base64Audio, 'base64');
        },
        { apiVersion: 'v1beta' }
      );

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('X-Voice-Engine', 'gemini-tts');
      if (fallbackReason) {
        res.setHeader('X-Voice-Note', encodeURIComponent(fallbackReason));
      }
      res.setHeader('Cache-Control', 'no-store');
      res.send(wavBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Gemini TTS fallback failed:', msg.slice(0, 320));
      const explicitStatus = (err as Error & { statusCode?: number }).statusCode;
      res.status(explicitStatus || (isQuotaExhaustedError(msg) ? 429 : 502)).json({
        error: msg || fallbackReason || 'ভয়েস অডিও তৈরি করা যায়নি।',
        fallbackReason: fallbackReason || undefined,
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use(async (req, res, next) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
