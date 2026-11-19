import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const FORBIDDEN_PATTERN = /রাজশাহী|৯\s*বছর|নয়\s*বছর|চুমু|৭ই?\s*নভেম্বর|গ্যালারি|Gallery/gi;

function scrubForbiddenTerms(text: string): string {
  return text.replace(FORBIDDEN_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
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
  localTimeBn?: string;
}

interface EnrichRequestBody {
  weather?: WeatherPayload;
  existingStoryContext?: string[];
  isEid?: boolean;
}

const GEMINI_STORY_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
const STORY_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STORY_CACHE_FILE = '/tmp/vtr_gemini_story_cache_v1.json';

interface CachedStoryEntry {
  createdAt: number;
  data: {
    openingLabel: string;
    openingLines: string[];
    midReflectionLines: string[];
    deepHeartbreakLines: string[];
    closingWhisperLines: string[];
  };
}

const storyMemoryCache = new Map<string, CachedStoryEntry>();
const inFlightStoryRequests = new Map<string, Promise<CachedStoryEntry['data']>>();
const modelCooldownUntil = new Map<string, number>();
let lastSeenKeySignature = '';

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

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const sig = `${apiKey.length}:${apiKey.slice(-6)}`;
  if (sig !== lastSeenKeySignature) {
    lastSeenKeySignature = sig;
    modelCooldownUntil.clear();
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
    w.mood || 'clear_day',
    w.isDay ? 'day' : 'night',
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

    // 1. Return valid cached Gemini response immediately without calling the API
    const cached = storyMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < STORY_CACHE_TTL_MS) {
      res.json(cached.data);
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

    // 3. Check if all candidate models are already in quota cooldown
    const now = Date.now();
    const availableModels = GEMINI_STORY_MODELS.filter(
      (model) => (modelCooldownUntil.get(model) ?? 0) <= now
    );
    if (availableModels.length === 0) {
      const soonestUntil = Math.min(
        ...GEMINI_STORY_MODELS.map((m) => modelCooldownUntil.get(m) ?? now + 600_000)
      );
      const retryAfterSec = Math.max(60, Math.ceil((soonestUntil - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'আজকের Gemini ফ্রি-টিয়ার দৈনিক কোটা শেষ হয়েছে।',
        quotaExhausted: true,
        retryAfterSec,
      });
      return;
    }

    const existingContext = Array.isArray(body.existingStoryContext)
      ? body.existingStoryContext.slice(0, 24).join('\n')
      : '';

    const rainDesc =
      typeof w.rainIntensity === 'number' && w.rainIntensity > 0.02
        ? w.rainIntensity >= 0.7
          ? `তীব্র/ভারী বৃষ্টি (তীব্রতা ${Math.round(w.rainIntensity * 100)}%)`
          : w.rainIntensity >= 0.35
            ? `মাঝারি বৃষ্টি (তীব্রতা ${Math.round(w.rainIntensity * 100)}%)`
            : `হালকা গুঁড়ি গুঁড়ি বৃষ্টি (তীব্রতা ${Math.round(w.rainIntensity * 100)}%)`
        : 'বৃষ্টি নেই';

    const weatherSummary = [
      `আবহাওয়ার ধরন: ${w.descriptionBn || w.mood || 'স্বাভাবিক আকাশ'}`,
      `সময় ও আকাশের অবস্থা: ${w.isDay ? 'দিন' : 'রাত'}${w.celestialPositionBn ? ` (${w.celestialPositionBn})` : ''}`,
      w.localTimeBn ? `স্থানীয় সময়: ${w.localTimeBn}` : '',
      typeof w.temperatureC === 'number' ? `তাপমাত্রা: ${w.temperatureC}°C` : '',
      typeof w.cloudCover === 'number' ? `আকাশে মেঘের পরিমাণ: ${w.cloudCover}%` : '',
      typeof w.windKmh === 'number' ? `বাতাসের গতি: ${w.windKmh} কিমি/ঘণ্টা` : '',
      `বৃষ্টি: ${rainDesc}`,
      `বজ্রপাত/মেঘের গর্জন: ${w.hasLightning || w.hasThunder ? 'আছে (বজ্রপাত ও গর্জন)' : 'নেই'}`,
      body.isEid ? 'বিশেষ দিন: আজ ঈদের দিন' : '',
    ]
      .filter(Boolean)
      .join('\n');

    const systemInstruction = [
      'তুমি অত্যন্ত সংবেদনশীল, গভীর ও হৃদয়স্পর্শী বাংলা সাহিত্যিক কণ্ঠ।',
      'নিচে দেওয়া মূল লেখাগুলোর ভেতরের মানুষটিকে ও তার অনুভূতিকে গভীরভাবে ধারণ করে লিখতে হবে:',
      '১. লেখক ("আমি") কেমন মানুষ: সে নীরব, নিঃস্বার্থ, একনিষ্ঠ ও গভীর মায়ায় গড়া একজন মানুষ। রুপোর ছোট ছোট রাগ-অভিমান সে চোখ বন্ধ করে মেনে নিত; তার হ্যাঁ-তে হ্যাঁ, না-তে না বলত—কখনো তাকে হারতে দিত না। রুপোর মুখ দেখেই তার না বলা কষ্ট বুঝে নিত; রুপোর চোখে সামান্য জল দেখলে লেখকের বুক হাহাকার করে উঠত। কোনো অভিযোগ বা দাবি তার নেই—দূর থেকেও শুধু রুপোর ভালো থাকাটাই তার একমাত্র প্রার্থনা।',
      '২. সে কীভাবে ও কতটা ভালোবাসত: শব্দ দিয়ে মাপা যায় না এমন নিখুঁত, নিঃশর্ত যত্ন। রুপোর একটা ছোট্ট হাসিতেই তার সারাদিনের ক্লান্তি মুছে যেত, তার কণ্ঠস্বর শুনলে সময়ের হিসাব থেমে যেত।',
      '৩. সে চলে যাওয়ার পরের কষ্ট: রুপো তাকে রেখে চলে গেছে, তাদের পথ আলাদা হয়ে গেছে। এখন আর আগের মতো সারাদিন কথা হয় না, তার অভিমান ভাঙানোর সুযোগ আসে না। এই শূন্যতা, বুকের ভেতর জমে থাকা না বলা কথা, নীরব কান্না আর প্রতি মুহূর্তে তাকে খোঁজার যন্ত্রণা ভীষণ গভীর ও বাস্তব।',
      '৪. আবহাওয়া বিশ্লেষণ: প্রদত্ত বর্তমান আবহাওয়ার প্রতিটি সূক্ষ্ম তথ্য (তাপমাত্রা, রোদ বা চাঁদের অবস্থান, মেঘের ঘনত্ব %, মৃদু বা তীব্র বৃষ্টি, বজ্রগর্জন, বাতাসের গতি, কুয়াশা বা রাতের নিস্তব্ধতা) পুঙ্খানুপুঙ্খভাবে অনুভব করে তা লেখকের এই হারানোর কষ্ট ও গভীর ভালোবাসার সাথে এমনভাবে মিশিয়ে দাও যেন আবহাওয়াটাই তার মনের আয়না হয়ে কথা বলছে।',
      'কঠোর নিয়ম:',
      '- কখনো কোনো শহরের নাম লিখবে না।',
      '- কখনো কোনো তারিখ, বছর সংখ্যা বা নির্দিষ্ট সম্পর্কের মেয়াদ উল্লেখ করবে না।',
      '- চটুল বা কৃত্রিম শব্দ ব্যবহার করবে না; প্রতিটি বাক্য হবে সহজ, প্রাঞ্জল, আন্তরিক, বাস্তব ও বুক ভারী করা আবেগে ভরা বাংলা গদ্যকবিতার মতো।',
      '- কোনো ইংরেজি শব্দ বা মার্কডাউন রাখবে না।',
    ].join('\n');

    const prompt = [
      'বর্তমান লাইভ আবহাওয়ার বিস্তারিত তথ্য:',
      weatherSummary,
      '',
      'বর্তমান মূল লেখার ভাব ও প্রেক্ষাপট (এটি মনে রেখে এর সুর ও ব্যথার সাথে মিলিয়ে লেখো):',
      existingContext,
      '',
      'উপরের আবহাওয়া পুঙ্খানুপুঙ্খভাবে বিশ্লেষণ করে এবং রুপোর চলে যাওয়ার তীব্র কষ্ট, লেখকের নিঃস্বার্থ চরিত্র ও গভীর ভালোবাসাকে কেন্দ্র করে JSON আকারে নিচের ৪টি অংশ লেখো:',
      '- openingLabel: আবহাওয়া ও মনের অবস্থা মিলিয়ে একটি সংক্ষিপ্ত শিরোনাম (যেমন: "আজকের মেঘলা আকাশ ও বুকের ভেতরের ভার...")',
      '- openingLines: ২টি গভীর আবেগঘন অনুচ্ছেদ (প্রতিটি ২-৩ বাক্যের), যেখানে আজকের ঠিক এই আবহাওয়া (তাপমাত্রা/বাতাস/মেঘ/বৃষ্টি/রোদ/রাত) কীভাবে রুপোর চলে যাওয়ার ব্যথাকে জাগিয়ে তুলছে তা ফুটে উঠবে।',
      '- midReflectionLines: ২টি অনুচ্ছেদ, যেখানে লেখক কেমন মানুষ ছিল, কীভাবে রুপোর সব অভিমান মেনে নিত, মুখ দেখেই কষ্ট বুঝে নিত—আর আজ এই আবহাওয়ায় সেই দিনগুলো কতটা হাহাকার জাগাচ্ছে তা লিখবে।',
      '- deepHeartbreakLines: ২টি হৃদয়বিদারক অনুচ্ছেদ, যেখানে সে তাকে রেখে চলে যাওয়ায় বুকের ভেতরে যে ক্ষত ও শূন্যতা তৈরি হয়েছে, কোনো অভিযোগ না করেও কতটা ভেঙে পড়েছে—তা আজকের আবহাওয়ার সাথে মিলিয়ে ফুটে উঠবে।',
      '- closingWhisperLines: ২টি মৃদু ফিসফিসে লাইন, যা আজকের আবহাওয়ার নিস্তব্ধতার ভেতর রুপোর প্রতি আজও অটুট মায়া ও নীরব শুভকামনা প্রকাশ করবে।',
    ].join('\n');

    const cleanArray = (arr: unknown, maxLen = 3): string[] =>
      Array.isArray(arr)
        ? arr
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .slice(0, maxLen)
            .map((line) => scrubForbiddenTerms(line))
            .filter(Boolean)
        : [];

    const runGeneration = async (): Promise<CachedStoryEntry['data']> => {
      let lastError: unknown;

      for (const model of availableModels) {
        try {
          const response = await generateWithTransientRetry(() =>
            ai.models.generateContent({
              model,
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    openingLabel: {
                      type: Type.STRING,
                      description: 'Short Bengali atmospheric header reflecting current sky and emotion.',
                    },
                    openingLines: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 emotional Bengali paragraphs matching exact live weather and heartbreak.',
                    },
                    midReflectionLines: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 emotional Bengali paragraphs reflecting his selfless love and understanding.',
                    },
                    deepHeartbreakLines: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 deeply poignant Bengali paragraphs about the pain of her leaving.',
                    },
                    closingWhisperLines: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 quiet whispered closing Bengali lines matching the weather.',
                    },
                  },
                  required: [
                    'openingLabel',
                    'openingLines',
                    'midReflectionLines',
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
            openingLabel?: string;
            openingLines?: string[];
            midReflectionLines?: string[];
            deepHeartbreakLines?: string[];
            closingWhisperLines?: string[];
          };

          const result = {
            openingLabel: scrubForbiddenTerms(parsed.openingLabel || ''),
            openingLines: cleanArray(parsed.openingLines, 2),
            midReflectionLines: cleanArray(parsed.midReflectionLines, 2),
            deepHeartbreakLines: cleanArray(parsed.deepHeartbreakLines, 2),
            closingWhisperLines: cleanArray(parsed.closingWhisperLines, 3),
          };

          if (result.openingLines.length === 0 || result.deepHeartbreakLines.length === 0) {
            throw new Error('Gemini থেকে প্রাপ্ত লেখা অসম্পূর্ণ ছিল।');
          }

          storyMemoryCache.set(cacheKey, { createdAt: Date.now(), data: result });
          saveStoryDiskCache();
          return result;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (isQuotaExhaustedError(msg)) {
            const parsedDelay = parseRetryDelaySeconds(msg);
            const cooldownMs = isDailyQuotaError(msg)
              ? Math.min(Math.max(parsedDelay * 1000, 15 * 60 * 1000), 12 * 60 * 60 * 1000)
              : Math.max(parsedDelay * 1000, 60 * 1000);
            modelCooldownUntil.set(model, Date.now() + cooldownMs);
            console.warn(
              `Gemini model ${model} quota cooldown active for ${Math.round(cooldownMs / 1000)}s.`
            );
            continue;
          }
          throw err;
        }
      }

      throw lastError ?? new Error('All Gemini models exhausted quota.');
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
      const geoRes = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
      if (!geoRes.ok) {
        res.status(502).json({ error: 'লোকেশন শনাক্ত করা যায়নি।' });
        return;
      }
      const geo = (await geoRes.json()) as {
        latitude?: string | number;
        longitude?: string | number;
        city?: string;
        country?: string;
      };
      const latitude = Number(geo.latitude);
      const longitude = Number(geo.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.status(502).json({ error: 'সঠিক স্থানাঙ্ক পাওয়া যায়নি।' });
        return;
      }
      res.json({
        latitude,
        longitude,
        city: typeof geo.city === 'string' ? geo.city : '',
        country: typeof geo.country === 'string' ? geo.country : '',
      });
    } catch {
      res.status(502).json({ error: 'লোকেশন শনাক্ত করা যায়নি।' });
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
