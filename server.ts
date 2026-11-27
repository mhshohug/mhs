import 'dotenv/config';
import { execFile as execFileCb } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';

const execFile = promisify(execFileCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const FORBIDDEN_AI_NAME_PATTERN =
  /রুপো(?:র|কে|য়|তে|ও|ই|টা|টি)?|রূপো(?:র|কে|য়|তে|ও|ই|টা|টি)?|(?<![\u0980-\u09FF])(?:রুপা|রূপা)(?:র|কে|য়|তে|ও|ই|টা|টি)?(?![\u0980-\u09FF])|\bRupo(?:'s|s|r|ke|y|te)?\b/gi;

const FORBIDDEN_PATTERN =
  /রাজশাহী|রুপো(?:র|কে|য়|তে|ও|ই|টা|টি)?|রূপো(?:র|কে|য়|তে|ও|ই|টা|টি)?|(?<![\u0980-\u09FF])(?:রুপা|রূপা)(?:র|কে|য়|তে|ও|ই|টা|টি)?(?![\u0980-\u09FF])|\bRupo(?:'s|s|r|ke|y|te)?\b|৯\s*বছর|নয়\s*বছর|চুমু|৭ই?\s*নভেম্বর|গ্যালারি|Gallery/gi;

function scrubAiForbiddenName(text: string): string {
  return text
    .replace(FORBIDDEN_AI_NAME_PATTERN, '')
    .replace(/[“"‘']\s*[”"’']/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/\s*,\s*([।!?])/g, '$1')
    .replace(/\s+([।!?])/g, '$1')
    .replace(/^[\s,।!?;:—-]+$/g, '')
    .replace(/^[\s,।!?;:—-]+(?=\S)/, '')
    .replace(/,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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

type RelationshipType = 'ex' | 'spouse' | 'couple';

function parseRelationshipType(raw: unknown): RelationshipType {
  if (raw === 'spouse' || raw === 'couple' || raw === 'ex') return raw;
  return 'ex';
}

interface EnrichRequestBody {
  weather?: WeatherPayload;
  existingStoryContext?: string[];
  isEid?: boolean;
  relationshipType?: RelationshipType;
}

const GEMINI_STORY_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
const STORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const STORY_CACHE_FILE = '/tmp/vtr_gemini_story_cache_v5.json';

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
const latestActiveStoryByType: Record<RelationshipType, CachedStoryEntry | null> = {
  ex: null,
  spouse: null,
  couple: null,
};
const inFlightStoryRequests = new Map<string, Promise<CachedStoryEntry['data']>>();
const keyModelCooldownUntil = new Map<string, number>();
const keyGlobalCooldownUntil = new Map<string, number>();
const keyModelQuotaHits = new Map<string, { count: number; lastHitAt: number }>();

type GeminiWorkload =
  | 'story'
  | 'voice-chat'
  | 'tts'
  | 'lyrics-search'
  | 'lyrics-audio'
  | 'lyrics-translate'
  | 'live-transcribe';

const WORKLOAD_BASE_SLOT: Record<GeminiWorkload, number> = {
  story: 0,
  'voice-chat': 1,
  tts: 2,
  'lyrics-search': 3,
  'lyrics-audio': 4,
  'lyrics-translate': 5,
  'live-transcribe': 1,
};

const workloadRoundRobinCursor = new Map<GeminiWorkload, number>();

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
        const relType: RelationshipType = key.startsWith('v5|spouse|')
          ? 'spouse'
          : key.startsWith('v5|couple|')
            ? 'couple'
            : 'ex';
        const prev = latestActiveStoryByType[relType];
        if (!prev || entry.createdAt > prev.createdAt) {
          latestActiveStoryByType[relType] = entry;
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
  sourceType: 'audio' | 'search' | 'manual';
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

interface GeminiKeyEntry {
  envName: string;
  apiKey: string;
  index: number;
}

const GEMINI_PLACEHOLDER_KEYS = new Set([
  'MY_GEMINI_API_KEY',
  'YOUR_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'UNDEFINED',
  'NULL',
]);

function parseGeminiKeyValueTokens(rawValue: string): string[] {
  const outer = rawValue.trim().replace(/^["']+|["']+$/g, '').trim();
  if (!outer) return [];

  if (outer.startsWith('[') && outer.endsWith(']')) {
    try {
      const parsed = JSON.parse(outer) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().replace(/^["']+|["']+$/g, '').trim())
          .filter(Boolean);
      }
    } catch {
      // Fall through to delimiter splitting
    }
  }

  return outer
    .split(/[\s,;]+/)
    .map((token) => token.trim().replace(/^["']+|["']+$/g, '').trim())
    .filter(Boolean);
}

function isUsableGeminiApiKey(candidate: string): boolean {
  if (!candidate || candidate.length < 16) return false;
  if (GEMINI_PLACEHOLDER_KEYS.has(candidate.toUpperCase())) return false;
  if (/^MY_[A-Z0-9_]+$/i.test(candidate)) return false;
  return true;
}

function getGeminiKeyEntries(): GeminiKeyEntry[] {
  const orderedVarNames: string[] = [
    'GEMINI_API_KEY',
    'GOOGLE_GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_KEY',
  ];

  for (let i = 1; i <= 30; i++) {
    orderedVarNames.push(`GEMINI_API_KEY_${i}`);
    orderedVarNames.push(`GEMINI_API_KEY${i}`);
    orderedVarNames.push(`GEMINI_KEY_${i}`);
    orderedVarNames.push(`GEMINI_KEY${i}`);
    orderedVarNames.push(`GOOGLE_GEMINI_API_KEY_${i}`);
    orderedVarNames.push(`GOOGLE_API_KEY_${i}`);
  }

  orderedVarNames.push('GEMINI_API_KEYS', 'GEMINI_KEYS', 'GOOGLE_GEMINI_API_KEYS', 'GOOGLE_API_KEYS');

  const dynamicExtraNames = Object.keys(process.env)
    .filter(
      (name) =>
        !name.startsWith('VITE_') &&
        !/VOICE|MODEL|URL|HOST|PORT|PROJECT|BUCKET|REGION/i.test(name) &&
        /^(?:GEMINI|GOOGLE_GEMINI|GOOGLE)_(?:API_)?KEYS?(?:[_-]?\d+)?$/i.test(name) &&
        !orderedVarNames.includes(name)
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const allCandidateNames = [...orderedVarNames, ...dynamicExtraNames];
  const seenKeys = new Set<string>();
  const entries: GeminiKeyEntry[] = [];

  for (const envName of allCandidateNames) {
    const raw = process.env[envName];
    if (!raw) continue;
    const tokens = parseGeminiKeyValueTokens(raw);
    for (const token of tokens) {
      if (!isUsableGeminiApiKey(token) || seenKeys.has(token)) continue;
      seenKeys.add(token);
      entries.push({
        envName,
        apiKey: token,
        index: entries.length,
      });
    }
  }

  return entries;
}

function getGeminiApiKeys(): string[] {
  return getGeminiKeyEntries().map((entry) => entry.apiKey);
}

function getGeminiKeyEnvNames(): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of getGeminiKeyEntries()) {
    if (!seen.has(entry.envName)) {
      seen.add(entry.envName);
      names.push(entry.envName);
    }
  }
  return names;
}

function getKeySig(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
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

function getRotatedKeyEntries(
  entries: GeminiKeyEntry[],
  workload?: GeminiWorkload,
  rotatePerCall?: boolean
): GeminiKeyEntry[] {
  if (entries.length <= 1 || !workload) return entries;
  const baseSlot = WORKLOAD_BASE_SLOT[workload] ?? 0;
  const currentOffset = workloadRoundRobinCursor.get(workload) ?? 0;
  const startIdx = (baseSlot + currentOffset) % entries.length;
  if (rotatePerCall) {
    workloadRoundRobinCursor.set(workload, (currentOffset + 1) % entries.length);
  }
  return [...entries.slice(startIdx), ...entries.slice(0, startIdx)];
}

function isKeyModelAvailable(apiKey: string, model: string, now = Date.now()): boolean {
  const sig = getKeySig(apiKey);
  if ((keyGlobalCooldownUntil.get(sig) ?? 0) > now) return false;
  return (keyModelCooldownUntil.get(`${sig}::${model}`) ?? 0) <= now;
}

function getAvailableKeyModelPairs(
  models: readonly string[],
  now = Date.now(),
  options?: { workload?: GeminiWorkload; rotatePerCall?: boolean }
): Array<{ entry: GeminiKeyEntry; apiKey: string; model: string }> {
  const entries = getRotatedKeyEntries(
    getGeminiKeyEntries(),
    options?.workload,
    options?.rotatePerCall
  );
  const pairs: Array<{ entry: GeminiKeyEntry; apiKey: string; model: string }> = [];
  for (const model of models) {
    for (const entry of entries) {
      if (isKeyModelAvailable(entry.apiKey, model, now)) {
        pairs.push({ entry, apiKey: entry.apiKey, model });
      }
    }
  }
  return pairs;
}

function isKeyAuthFailure(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('api key expired') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    msg.includes('401') ||
    msg.includes('403') ||
    (msg.includes('400') && (lower.includes('api key') || lower.includes('api_key')))
  );
}

function isKeyFailoverError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    isQuotaExhaustedError(msg) ||
    isKeyAuthFailure(msg) ||
    lower.includes('unavailable') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    lower.includes('internal') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('not_found') ||
    msg.includes('404')
  );
}

function markKeyModelCooldown(apiKey: string, model: string, msg: string): number {
  const sig = getKeySig(apiKey);
  const ck = `${sig}::${model}`;
  const now = Date.now();
  const lower = msg.toLowerCase();
  let cooldownMs = 65 * 1000;

  if (isKeyAuthFailure(msg)) {
    cooldownMs = 30 * 60 * 1000;
    keyGlobalCooldownUntil.set(sig, now + cooldownMs);
    return cooldownMs;
  }

  if (isQuotaExhaustedError(msg)) {
    const parsedDelay = parseRetryDelaySeconds(msg);
    if (isDailyQuotaError(msg)) {
      cooldownMs = Math.min(Math.max(parsedDelay * 1000, 30 * 60 * 1000), 12 * 60 * 60 * 1000);
    } else {
      const prev = keyModelQuotaHits.get(ck);
      const count = prev && now - prev.lastHitAt < 30 * 60 * 1000 ? prev.count + 1 : 1;
      keyModelQuotaHits.set(ck, { count, lastHitAt: now });
      const escalatedMinMs = count >= 3 ? 30 * 60 * 1000 : count === 2 ? 5 * 60 * 1000 : 65 * 1000;
      cooldownMs = Math.max(parsedDelay * 1000, escalatedMinMs);
    }
  } else if (lower.includes('not_found') || msg.includes('404')) {
    cooldownMs = 15 * 60 * 1000;
  } else {
    cooldownMs = 45 * 1000;
  }

  keyModelCooldownUntil.set(ck, now + cooldownMs);
  return cooldownMs;
}

function clearKeyModelCooldownState(apiKey: string, model: string): void {
  const sig = getKeySig(apiKey);
  const ck = `${sig}::${model}`;
  keyModelCooldownUntil.delete(ck);
  keyModelQuotaHits.delete(ck);
}

async function executeWithGeminiKeyFailover<T>(
  models: readonly string[],
  task: (ai: GoogleGenAI, model: string) => Promise<T>,
  options?: { apiVersion?: string; workload?: GeminiWorkload; rotatePerCall?: boolean }
): Promise<T> {
  const entries = getGeminiKeyEntries();
  if (entries.length === 0) {
    const err = new Error('GEMINI_API_KEY সেট করা নেই। Settings > Secrets থেকে API Key যুক্ত করুন।');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const pairs = getAvailableKeyModelPairs(models, Date.now(), {
    workload: options?.workload,
    rotatePerCall: options?.rotatePerCall,
  });
  if (pairs.length === 0) {
    const err = new Error('সবগুলো Gemini API Key-এর ফ্রি কোটা সাময়িকভাবে পূর্ণ হয়েছে।');
    (err as Error & { statusCode?: number }).statusCode = 429;
    throw err;
  }

  let lastError: unknown;
  for (const { entry, apiKey, model } of pairs) {
    const ai = createAiClientForKey(apiKey, options?.apiVersion);
    try {
      const result = await task(ai, model);
      clearKeyModelCooldownState(apiKey, model);
      return result;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isKeyFailoverError(msg)) {
        const cooldownMs = markKeyModelCooldown(apiKey, model, msg);
        console.warn(
          `Gemini key #${entry.index + 1} (${entry.envName}) failover on ${model}, cooldown ${Math.round(cooldownMs / 1000)}s.`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('All Gemini keys/models exhausted.');
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
  const lower = msg.toLowerCase();
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('generaterequestsperday') ||
    lower.includes('generaterequestsperminute') ||
    lower.includes('ratelimitexceeded') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('limit: 0') ||
    msg.includes('429')
  );
}

function isDailyQuotaError(msg: string): boolean {
  if (!isQuotaExhaustedError(msg)) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('perday') ||
    lower.includes('generaterequestsperday') ||
    lower.includes('limit: 0') ||
    lower.includes('exceeded your current quota') ||
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
      if (isQuotaExhaustedError(msg) || isKeyAuthFailure(msg)) {
        // Never retry quota exhaustion or key auth failures on the same key; immediately swap keys
        throw err;
      }
      const lower = msg.toLowerCase();
      const isTransient =
        msg.includes('503') ||
        msg.includes('500') ||
        lower.includes('unavailable') ||
        lower.includes('etimedout') ||
        lower.includes('econnreset');
      if (!isTransient || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

function buildServerWeatherCacheKey(
  w: WeatherPayload,
  relationshipType: RelationshipType,
  isEid?: boolean
): string {
  const tempBucket = typeof w.temperatureC === 'number' ? Math.round(w.temperatureC / 3) * 3 : 'na';
  const cloudBucket = typeof w.cloudCover === 'number' ? Math.round(w.cloudCover / 25) * 25 : 'na';
  const r = typeof w.rainIntensity === 'number' ? w.rainIntensity : 0;
  const rainBucket = r > 0.02 ? (r >= 0.7 ? 3 : r >= 0.35 ? 2 : 1) : 0;
  const windBucket = typeof w.windKmh === 'number' ? Math.round(w.windKmh / 10) * 10 : 'na';
  return [
    'v5',
    relationshipType,
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

  const detectedGeminiKeys = getGeminiKeyEntries();
  if (detectedGeminiKeys.length > 0) {
    console.log(
      `Gemini key pool initialized: ${detectedGeminiKeys.length} key(s) [${detectedGeminiKeys.map((k) => k.envName).join(', ')}]`
    );
  }

  app.post('/api/story/emotional-enrich', async (req, res) => {
    if (getGeminiApiKeys().length === 0) {
      res.status(503).json({
        error: 'GEMINI_API_KEY সেট করা নেই। Settings > Secrets থেকে API Key যুক্ত করুন।',
      });
      return;
    }

    const body = (req.body || {}) as EnrichRequestBody;
    const w = body.weather || {};
    const relationshipType = parseRelationshipType(body.relationshipType);
    const cacheKey = buildServerWeatherCacheKey(w, relationshipType, body.isEid);

    // 1. Return valid 30-minute cached Gemini response for this relationship type immediately without calling the API
    const now = Date.now();
    const cached = storyMemoryCache.get(cacheKey);
    if (cached && now - cached.createdAt < STORY_CACHE_TTL_MS) {
      res.json(cached.data);
      return;
    }
    const latestForType = latestActiveStoryByType[relationshipType];
    if (latestForType && now - latestForType.createdAt < STORY_CACHE_TTL_MS) {
      res.json(latestForType.data);
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
    const availablePairs = getAvailableKeyModelPairs(GEMINI_STORY_MODELS, checkNow, {
      workload: 'story',
    });
    if (availablePairs.length === 0) {
      const allCooldowns: number[] = [];
      for (const m of GEMINI_STORY_MODELS) {
        for (const k of getGeminiApiKeys()) {
          const sig = getKeySig(k);
          allCooldowns.push(
            Math.max(
              keyGlobalCooldownUntil.get(sig) ?? 0,
              keyModelCooldownUntil.get(`${sig}::${m}`) ?? checkNow + 600_000
            )
          );
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

    const voicePersonaLine =
      relationshipType === 'spouse'
        ? 'মানুষটি বিবাহিত জীবনসঙ্গী (স্বামী বা স্ত্রী); সে তার প্রিয় মানুষটির সাথে একই সংসারে/পাশেই আছে। গভীর রোমান্টিক ভালোবাসা, পুরোনো মধুর স্মৃতিচারণ, ঝড়-বৃষ্টি-রোদ-রাতে সঙ্গীর কাছে থাকার প্রশান্তি ও আদর-যত্নের অনুভূতি কথায় মিশে থাকে। কোনো বিচ্ছেদ বা "দূরে চলে যাওয়া এক্স"-এর কষ্ট একদমই আনবে না।'
        : relationshipType === 'couple'
          ? 'মানুষটি গভীর প্রেমে থাকা প্রেমিক বা প্রেমিকা (কাপল); একসাথে কাটানো মধুর স্মৃতিচারণ ও মিষ্টি অভিমান যেমন আছে, তেমনি খুব শীঘ্রই আর ক’দিন পরই দুজন চিরতরে একসাথে থাকবে/একই ছাদের নিচে নতুন জীবন শুরু করবে—সেই আনন্দময় রোমান্টিক অপেক্ষার অনুভূতি প্রতিটি কথায় মিশে থাকে। কোনো বিচ্ছেদ বা প্রাক্তন হওয়ার দুঃখ আনবে না।'
          : 'মানুষটি স্বভাবে নীরব, নিঃস্বার্থ ও গভীর মায়ায় গড়া; সে প্রিয় মানুষটিকে ভীষণ ভালোবাসে ও মিস করে, তার সব রাগ-অভিমান নীরবে মেনে নিত—সে সরি না বললেও নিজের দিক থেকেই সব মেনে নিত, আর সে একবার সরি বললেই সব ভুল মুহূর্তে মাফ করে দিয়ে তার জন্য সবকিছু করতে প্রস্তুত থাকত। তাকে কতটা আদরে ও যত্নে রাখতে চায়, সেই নিখাদ অনুভূতিই তার প্রতিটি কথায় মিশে থাকে।';

    const deepEmotionHint =
      relationshipType === 'spouse'
        ? '- deepHeartbreakLines: ১টি সংক্ষিপ্ত গভীর রোমান্টিক কথা (১৬-১৮ শব্দ), যেখানে জীবনসঙ্গীকে পাশে পেয়ে পুরোনো স্মৃতি ও আজকের ভালোবাসার মায়া ফুটে উঠবে।'
        : relationshipType === 'couple'
          ? '- deepHeartbreakLines: ১টি সংক্ষিপ্ত গভীর রোমান্টিক কথা (১৬-১৮ শব্দ), যেখানে মধুর স্মৃতি ও কিছুদিন পরই একসাথে থাকার আনন্দময় অপেক্ষা ফুটে উঠবে।'
          : '- deepHeartbreakLines: ১টি সংক্ষিপ্ত গভীর আবেগের কথা (১৬-১৮ শব্দ), যেখানে চলে যাওয়ার পর বুকের নীরব শূন্যতা ও নিঃস্বার্থ মায়া ফুটে উঠবে।';

    const systemInstruction = [
      'তুমি খুব সাধারণ, সংবেদনশীল ও গভীর ভালোবাসায় ভরা একজন মানুষের কণ্ঠ—একদম মানুষ যেমন নিজের ভেতরের আদর, যত্ন ও অনুভূতি প্রকাশ করে, ঠিক তেমন।',
      voicePersonaLine,
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
      deepEmotionHint,
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
      return executeWithGeminiKeyFailover(
        GEMINI_STORY_MODELS,
        async (client, model) => {
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
        latestActiveStoryByType[relationshipType] = freshEntry;
        saveStoryDiskCache();
        return result;
      }, { workload: 'story' });
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

  let firebaseProjectId = '';
  try {
    const cfgRaw = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf-8')
    ) as { projectId?: string };
    firebaseProjectId = typeof cfgRaw.projectId === 'string' ? cfgRaw.projectId.trim() : '';
  } catch {
    firebaseProjectId = '';
  }

  let cachedFirebaseCerts: Record<string, string> = {};
  let cachedFirebaseCertsExpiryMs = 0;

  async function getFirebasePublicCerts(): Promise<Record<string, string>> {
    if (Date.now() < cachedFirebaseCertsExpiryMs && Object.keys(cachedFirebaseCerts).length > 0) {
      return cachedFirebaseCerts;
    }
    const resp = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) {
      throw new Error('Failed to fetch Firebase auth certificates');
    }
    const certs = (await resp.json()) as Record<string, string>;
    const cc = resp.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
    cachedFirebaseCerts = certs;
    cachedFirebaseCertsExpiryMs = Date.now() + maxAgeSec * 1000;
    return certs;
  }

  async function verifyFirebaseBearerToken(authHeader: unknown): Promise<string | null> {
    if (!firebaseProjectId || typeof authHeader !== 'string') return null;
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8')) as {
        alg?: string;
        kid?: string;
      };
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as {
        aud?: string;
        iss?: string;
        sub?: string;
        exp?: number;
        iat?: number;
      };
      if (header.alg !== 'RS256' || !header.kid) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      if (
        payload.aud !== firebaseProjectId ||
        payload.iss !== `https://securetoken.google.com/${firebaseProjectId}` ||
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        typeof payload.exp !== 'number' ||
        payload.exp <= nowSec - 30 ||
        typeof payload.iat !== 'number' ||
        payload.iat > nowSec + 300
      ) {
        return null;
      }

      const certs = await getFirebasePublicCerts();
      const pem = certs[header.kid];
      if (!pem) return null;

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${parts[0]}.${parts[1]}`);
      verifier.end();
      const sig = Buffer.from(parts[2], 'base64url');
      return verifier.verify(pem, sig) ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async function isAuthorizedMediaRequest(req: express.Request): Promise<boolean> {
    const token = String(req.headers['x-voice-pin-token'] || '').trim();
    if (token === AUTHORIZED_VOICE_TOKEN) {
      return true;
    }
    const uid = await verifyFirebaseBearerToken(req.headers.authorization);
    return Boolean(uid);
  }

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
    async (req, res) => {
      if (!(await isAuthorizedMediaRequest(req))) {
        res.status(403).json({ error: 'অনুমতি নেই। অনুগ্রহ করে সাইন ইন বা সঠিক পিন দিন।' });
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
      if (!(await isAuthorizedMediaRequest(req))) {
        res.status(403).json({ error: 'অনুমতি নেই। অনুগ্রহ করে সাইন ইন বা সঠিক পিন দিন।' });
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
    if (!(await isAuthorizedMediaRequest(req))) {
      res.status(403).json({ error: 'অনুমতি নেই। অনুগ্রহ করে সাইন ইন বা সঠিক পিন দিন।' });
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

  const MAX_LYRICS_AUDIO_BYTES = 25 * 1024 * 1024;
  const MIME_BY_AUDIO_EXT: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
  };
  const EXT_BY_AUDIO_MIME: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/opus': '.opus',
    'audio/webm': '.webm',
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
        const audioRes = await fetch(parsed.toString(), { signal: AbortSignal.timeout(18000) });
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

  function parseLrcOrSrtLyrics(
    rawText: string,
    fallbackDurationSec = 200
  ): { hasTimestamps: boolean; lines: LyricLine[]; plainLines: string[] } {
    const normalized = rawText.replace(/\r\n?/g, '\n');
    const rawLines = normalized.split('\n');

    // 1. Check for LRC format: [mm:ss.xx] text (including multiple timestamps on one line)
    const lrcTagRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const lrcEntries: Array<{ startSec: number; text: string }> = [];
    for (const row of rawLines) {
      const trimmed = row.trim();
      if (!trimmed) continue;
      if (/^\[(ti|ar|al|by|offset|re|ve|length):/i.test(trimmed)) continue;

      const tags: number[] = [];
      let match: RegExpExecArray | null;
      lrcTagRegex.lastIndex = 0;
      while ((match = lrcTagRegex.exec(trimmed)) !== null) {
        const mins = Number(match[1]);
        const secs = Number(match[2]);
        const fracRaw = match[3] || '';
        const frac =
          fracRaw.length === 3
            ? Number(fracRaw) / 1000
            : fracRaw.length === 2
              ? Number(fracRaw) / 100
              : fracRaw.length === 1
                ? Number(fracRaw) / 10
                : 0;
        if (Number.isFinite(mins) && Number.isFinite(secs) && Number.isFinite(frac)) {
          tags.push(mins * 60 + secs + frac);
        }
      }
      if (tags.length > 0) {
        const cleanText = trimmed
          .replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleanText.length >= 1) {
          for (const t of tags) {
            lrcEntries.push({ startSec: Number(t.toFixed(2)), text: cleanText });
          }
        }
      }
    }

    if (lrcEntries.length >= 2) {
      lrcEntries.sort((a, b) => a.startSec - b.startSec);
      const lines: LyricLine[] = lrcEntries.map((entry, idx) => {
        const next = lrcEntries[idx + 1];
        const maxSpan = next ? Math.min(next.startSec - 0.08, entry.startSec + 8.5) : Math.min(fallbackDurationSec, entry.startSec + 6);
        const endSec = Number(Math.max(entry.startSec + 1.1, maxSpan).toFixed(2));
        return {
          startSec: entry.startSec,
          endSec,
          text: entry.text,
        };
      });
      return {
        hasTimestamps: true,
        lines,
        plainLines: lines.map((l) => l.text),
      };
    }

    // 2. Check for SRT format: HH:MM:SS,mmm --> HH:MM:SS,mmm
    const srtRegex =
      /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
    const srtLines: LyricLine[] = [];
    const blocks = normalized.split(/\n{2,}/);
    for (const block of blocks) {
      const bLines = block.split('\n').map((s) => s.trim()).filter(Boolean);
      const timeIdx = bLines.findIndex((l) => srtRegex.test(l));
      if (timeIdx === -1) continue;
      const m = srtRegex.exec(bLines[timeIdx]);
      if (!m) continue;
      const toSec = (h?: string, min?: string, s?: string, ms?: string) => {
        const hh = h ? Number(h) : 0;
        const mm = Number(min || 0);
        const ss = Number(s || 0);
        const mss = ms ? Number(ms.padEnd(3, '0').slice(0, 3)) / 1000 : 0;
        return hh * 3600 + mm * 60 + ss + mss;
      };
      const startSec = Number(toSec(m[1], m[2], m[3], m[4]).toFixed(2));
      const endSec = Number(Math.max(startSec + 1.2, toSec(m[5], m[6], m[7], m[8])).toFixed(2));
      const body = bLines
        .slice(timeIdx + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (body.length >= 1) {
        srtLines.push({ startSec, endSec, text: body });
      }
    }
    if (srtLines.length >= 2) {
      srtLines.sort((a, b) => a.startSec - b.startSec);
      return {
        hasTimestamps: true,
        lines: srtLines,
        plainLines: srtLines.map((l) => l.text),
      };
    }

    // 3. Plain text lyrics lines (remove empty lines and structural labels like [Verse 1], [Chorus])
    const plainLines = rawLines
      .map((row) =>
        row
          .replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter((line) => {
        if (line.length < 2) return false;
        if (/^\[(?:verse|chorus|bridge|intro|outro|pre-chorus|hook|interlude|instrumental|music)[^\]]*\]$/i.test(line)) {
          return false;
        }
        if (/^\((?:music|instrumental|interlude|guitar|piano|violin)[^)]*\)$/i.test(line)) {
          return false;
        }
        return true;
      })
      .slice(0, 200);

    return {
      hasTimestamps: false,
      lines: [],
      plainLines,
    };
  }

  async function fetchLrclibSyncedLyrics(
    title: string,
    subtitle: string,
    durationSec: number
  ): Promise<{
    syncedLines?: LyricLine[];
    plainLines?: string[];
    lrclibDuration?: number;
    songTitle?: string;
    artist?: string;
  } | null> {
    const cleanTitle = title
      .replace(/\([^)]*(?:official|audio|video|lyrics|hd|4k|mp3|full song)[^)]*\)/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanTitle || cleanTitle.length < 2) return null;
    if (/^(?:song|track|birthday|audio|untitled|\d+)[\s_-]*\d*$/i.test(cleanTitle)) {
      return null;
    }

    const ignoredSubtitle = /জন্মদিনের বিশেষ সুর|স্বাভাবিক প্লেলিস্ট|ক্লাউড প্লেলিস্ট/i.test(subtitle);
    const cleanArtist = ignoredSubtitle ? '' : subtitle.trim();
    const query = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;

    try {
      const res = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
        {
          headers: { 'User-Agent': 'ValoThekoLyricsSync/1.0' },
          signal: AbortSignal.timeout(5500),
        }
      );
      if (!res.ok) return null;
      const items = (await res.json()) as Array<{
        trackName?: string;
        artistName?: string;
        duration?: number;
        instrumental?: boolean;
        syncedLyrics?: string;
        plainLyrics?: string;
      }>;
      if (!Array.isArray(items) || items.length === 0) return null;

      const titleLower = cleanTitle.toLowerCase();
      const titleTokens = titleLower.split(/\s+/).filter((t) => t.length >= 2);

      let best: {
        score: number;
        item: (typeof items)[number];
      } | null = null;

      for (const item of items) {
        if (item.instrumental) continue;
        if (!item.syncedLyrics && !item.plainLyrics) continue;
        const candTitle = (item.trackName || '').toLowerCase();
        if (!candTitle) continue;

        let score = 0;
        if (candTitle === titleLower) score += 40;
        else if (candTitle.includes(titleLower) || titleLower.includes(candTitle)) score += 25;
        else if (titleTokens.length > 0) {
          const matched = titleTokens.filter((tok) => candTitle.includes(tok)).length;
          if (matched === 0) continue;
          score += (matched / titleTokens.length) * 20;
        }

        if (cleanArtist && item.artistName?.toLowerCase().includes(cleanArtist.toLowerCase())) {
          score += 12;
        }
        if (item.syncedLyrics) {
          score += 20;
        }
        if (typeof item.duration === 'number' && item.duration > 15 && durationSec > 15) {
          const diff = Math.abs(item.duration - durationSec);
          if (diff <= 3.5) score += 25;
          else if (diff <= 8) score += 12;
          else if (diff > 25) score -= 30;
        }

        if (!best || score > best.score) {
          best = { score, item };
        }
      }

      if (!best || best.score < 22) return null;

      const picked = best.item;
      const effectiveDur = typeof picked.duration === 'number' && picked.duration > 15 ? picked.duration : durationSec;
      const parsedSynced = picked.syncedLyrics
        ? parseLrcOrSrtLyrics(picked.syncedLyrics, effectiveDur)
        : null;
      const parsedPlain = picked.plainLyrics
        ? parseLrcOrSrtLyrics(picked.plainLyrics, effectiveDur)
        : null;

      return {
        syncedLines: parsedSynced?.hasTimestamps ? parsedSynced.lines : undefined,
        plainLines:
          parsedSynced?.plainLines && parsedSynced.plainLines.length >= 4
            ? parsedSynced.plainLines
            : parsedPlain?.plainLines,
        lrclibDuration: typeof picked.duration === 'number' ? picked.duration : undefined,
        songTitle: picked.trackName || title,
        artist: picked.artistName || cleanArtist,
      };
    } catch {
      return null;
    }
  }

  interface AudioChunk {
    index: number;
    startSec: number;
    endSec: number;
    durationSec: number;
    base64: string;
    mimeType: 'audio/mpeg';
  }

  async function sliceAudioIntoChunksWithFfmpeg(
    audioBuffer: Buffer,
    mimeType: string,
    fallbackDurationSec: number
  ): Promise<{ actualDurationSec: number; chunks: AudioChunk[] } | null> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtr_lyrics_'));
    const ext = EXT_BY_AUDIO_MIME[mimeType] || '.mp3';
    const inputPath = path.join(tmpDir, `input${ext}`);

    try {
      fs.writeFileSync(inputPath, audioBuffer);

      let actualDurationSec = fallbackDurationSec;
      try {
        const { stdout } = await execFile(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath],
          { timeout: 8000 }
        );
        const probed = Number(stdout.trim());
        if (Number.isFinite(probed) && probed > 5) {
          actualDurationSec = probed;
        }
      } catch {
        // Fallback to ffmpeg stderr duration or caller duration
      }

      const CHUNK_WINDOW = 45;
      const CHUNK_STEP = 40;
      const specs: Array<{ index: number; startSec: number; endSec: number; durationSec: number }> = [];

      if (actualDurationSec <= 50) {
        specs.push({
          index: 0,
          startSec: 0,
          endSec: Number(actualDurationSec.toFixed(2)),
          durationSec: Number(actualDurationSec.toFixed(2)),
        });
      } else {
        let idx = 0;
        for (let start = 0; start < actualDurationSec - 2; start += CHUNK_STEP) {
          const end = Math.min(actualDurationSec, start + CHUNK_WINDOW);
          const dur = end - start;
          if (dur < 3) break;
          specs.push({
            index: idx++,
            startSec: Number(start.toFixed(2)),
            endSec: Number(end.toFixed(2)),
            durationSec: Number(dur.toFixed(2)),
          });
          if (end >= actualDurationSec) break;
        }
      }

      const chunks = await Promise.all(
        specs.map(async (spec): Promise<AudioChunk> => {
          const outPath = path.join(tmpDir, `chunk_${spec.index}.mp3`);
          await execFile(
            'ffmpeg',
            [
              '-y',
              '-ss',
              String(spec.startSec),
              '-t',
              String(spec.durationSec),
              '-i',
              inputPath,
              '-vn',
              '-ar',
              '16000',
              '-ac',
              '1',
              '-b:a',
              '48k',
              '-f',
              'mp3',
              outPath,
            ],
            { timeout: 15000 }
          );
          const buf = fs.readFileSync(outPath);
          return {
            ...spec,
            base64: buf.toString('base64'),
            mimeType: 'audio/mpeg',
          };
        })
      );

      return { actualDurationSec, chunks };
    } catch (err) {
      console.warn('ffmpeg audio slicing fallback:', err instanceof Error ? err.message.slice(0, 120) : err);
      return null;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore tmp cleanup error
      }
    }
  }

  async function alignLinesWithAudioChunks(
    audioAsset: { buffer: Buffer; mimeType: string },
    plainLines: string[],
    durationSec: number
  ): Promise<LyricLine[]> {
    const cleanLines = plainLines
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 1)
      .slice(0, 200);
    if (cleanLines.length === 0) return [];

    const sliced = await sliceAudioIntoChunksWithFfmpeg(
      audioAsset.buffer,
      audioAsset.mimeType,
      durationSec
    );

    const indexedListText = cleanLines.map((line, i) => `[${i}] ${line}`).join('\n');

    if (sliced && sliced.chunks.length > 0) {
      const candidatesByIndex = new Map<
        number,
        Array<{ absStart: number; absEnd: number; centrality: number }>
      >();

      const processChunk = async (chunk: AudioChunk) => {
        const chunkPrompt = [
          `This audio clip is ${chunk.durationSec.toFixed(1)} seconds long (from ${chunk.startSec.toFixed(1)}s to ${chunk.endSec.toFixed(1)}s of the full song).`,
          'Below is the numbered list of the song lyrics in chronological order:',
          indexedListText,
          '',
          'TASK: Listen carefully to the singing voice in THIS clip ONLY.',
          `Identify ONLY the lines from the numbered list that are actually sung in THIS ${chunk.durationSec.toFixed(1)}s audio clip.`,
          `Return exact "startSec" and "endSec" measured from the START OF THIS CLIP (0.00 to ${chunk.durationSec.toFixed(1)}).`,
          'CRITICAL ACCURACY RULES:',
          '1. Do NOT guess or include lines that are not sung in this clip.',
          '2. If the clip is instrumental or has silence before singing begins, skip the silence and report the exact second singing starts.',
          '3. Return JSON matching: {"matches": [{"index": 0, "startSec": 4.2, "endSec": 8.1}, ...]}',
        ].join('\n');

        const parsed = await executeWithGeminiKeyFailover(
          GEMINI_STORY_MODELS,
          async (client, model) => {
            const response = await generateWithTransientRetry(() =>
              client.models.generateContent({
                model,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: chunk.mimeType,
                        data: chunk.base64,
                      },
                    },
                    { text: chunkPrompt },
                  ],
                },
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      matches: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            index: { type: Type.INTEGER },
                            startSec: { type: Type.NUMBER },
                            endSec: { type: Type.NUMBER },
                          },
                          required: ['index', 'startSec', 'endSec'],
                        },
                      },
                    },
                    required: ['matches'],
                  },
                },
              })
            );
            return JSON.parse((response.text ?? '{}').trim()) as {
              matches?: Array<{ index?: number; startSec?: number; endSec?: number }>;
            };
          },
          { workload: 'lyrics-audio', rotatePerCall: true }
        );

        if (!Array.isArray(parsed.matches)) return;
        for (const m of parsed.matches) {
          const idx = Number(m.index);
          const relStart = Number(m.startSec);
          const relEnd = Number(m.endSec);
          if (!Number.isInteger(idx) || idx < 0 || idx >= cleanLines.length) continue;
          if (!Number.isFinite(relStart) || relStart < -0.5 || relStart > chunk.durationSec + 0.5) continue;

          const clampedRelStart = Math.max(0, Math.min(chunk.durationSec - 0.3, relStart));
          const clampedRelEnd = Number.isFinite(relEnd)
            ? Math.max(clampedRelStart + 0.8, Math.min(chunk.durationSec + 1.5, relEnd))
            : Math.min(chunk.durationSec + 0.5, clampedRelStart + 3.2);

          // Score centrality so non-edge overlap hits win cleanly
          const distFromEdge = Math.min(clampedRelStart, chunk.durationSec - clampedRelStart);
          const absStart = Number((chunk.startSec + clampedRelStart).toFixed(2));
          const absEnd = Number((chunk.startSec + clampedRelEnd).toFixed(2));

          const arr = candidatesByIndex.get(idx) || [];
          arr.push({ absStart, absEnd, centrality: distFromEdge });
          candidatesByIndex.set(idx, arr);
        }
      };

      // Run chunks with small concurrency (2 at a time) rotating across keys for speed + quota friendliness
      for (let i = 0; i < sliced.chunks.length; i += 2) {
        const batch = sliced.chunks.slice(i, i + 2);
        await Promise.all(batch.map((c) => processChunk(c).catch(() => undefined)));
      }

      // Select strictly monotonic timestamps for indices 0..N-1
      const aligned: Array<LyricLine | null> = new Array(cleanLines.length).fill(null);
      let prevTime = -0.1;

      for (let idx = 0; idx < cleanLines.length; idx++) {
        const cands = (candidatesByIndex.get(idx) || [])
          .filter((c) => c.absStart >= prevTime - 0.3)
          .sort((a, b) => {
            // Prefer central matches when candidates are within 4s of each other; otherwise earliest chronological match
            if (Math.abs(a.absStart - b.absStart) <= 4.5) {
              return b.centrality - a.centrality;
            }
            return a.absStart - b.absStart;
          });

        if (cands.length > 0) {
          const chosen = cands[0];
          const startSec = Number(Math.max(prevTime + 0.15, chosen.absStart).toFixed(2));
          const endSec = Number(Math.max(startSec + 1.1, chosen.absEnd).toFixed(2));
          aligned[idx] = { startSec, endSec, text: cleanLines[idx] };
          prevTime = startSec;
        }
      }

      const matchedCount = aligned.filter(Boolean).length;
      if (matchedCount >= Math.max(2, Math.floor(cleanLines.length * 0.25))) {
        const totalDur = sliced.actualDurationSec || durationSec;
        // Fill any unmatched gap lines smoothly between their matched neighbours
        for (let i = 0; i < cleanLines.length; i++) {
          if (aligned[i]) continue;
          let prevIdx = i - 1;
          while (prevIdx >= 0 && !aligned[prevIdx]) prevIdx--;
          let nextIdx = i + 1;
          while (nextIdx < cleanLines.length && !aligned[nextIdx]) nextIdx++;

          const winStart = prevIdx >= 0 ? aligned[prevIdx]!.endSec + 0.1 : 1.0;
          const winEnd = nextIdx < cleanLines.length ? aligned[nextIdx]!.startSec - 0.1 : Math.max(winStart + 4, totalDur - 1);
          const gapCount = nextIdx - prevIdx - 1;
          const posInGap = i - prevIdx - 1;
          const step = Math.max(1.2, (winEnd - winStart) / Math.max(1, gapCount));
          const startSec = Number(Math.max(0, winStart + posInGap * step).toFixed(2));
          const endSec = Number(Math.max(startSec + 1.1, startSec + step - 0.08).toFixed(2));
          aligned[i] = { startSec, endSec, text: cleanLines[i] };
        }

        const finalized = aligned.filter((x): x is LyricLine => Boolean(x));
        // Clamp endSec so each line cleanly ends right before the next line begins
        for (let i = 0; i < finalized.length - 1; i++) {
          if (finalized[i].endSec > finalized[i + 1].startSec - 0.06) {
            finalized[i].endSec = Number(Math.max(finalized[i].startSec + 0.8, finalized[i + 1].startSec - 0.06).toFixed(2));
          }
        }
        return finalized;
      }
    }

    // Fallback: single-pass alignment over full audio if ffmpeg was unavailable
    try {
      const audioBase64 = audioAsset.buffer.toString('base64');
      const fullPrompt = [
        `Listen carefully to this song audio (duration ~${Math.round(durationSec)}s).`,
        'Align these exact numbered lyric lines to the exact seconds they are sung:',
        indexedListText,
        'Return JSON {"lines": [{"index": 0, "startSec": ..., "endSec": ...}, ...]} for every line.',
      ].join('\n');

      const parsed = await executeWithGeminiKeyFailover(
        GEMINI_STORY_MODELS,
        async (client, model) => {
          const response = await generateWithTransientRetry(() =>
            client.models.generateContent({
              model,
              contents: {
                parts: [
                  { inlineData: { mimeType: audioAsset.mimeType, data: audioBase64 } },
                  { text: fullPrompt },
                ],
              },
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    lines: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          index: { type: Type.INTEGER },
                          startSec: { type: Type.NUMBER },
                          endSec: { type: Type.NUMBER },
                        },
                        required: ['index', 'startSec', 'endSec'],
                      },
                    },
                  },
                  required: ['lines'],
                },
              },
            })
          );
          return JSON.parse((response.text ?? '{}').trim()) as {
            lines?: Array<{ index?: number; startSec?: number; endSec?: number }>;
          };
        },
        { workload: 'lyrics-audio', rotatePerCall: true }
      );

      if (Array.isArray(parsed.lines) && parsed.lines.length >= 2) {
        const byIdx = new Map<number, { startSec: number; endSec: number }>();
        for (const item of parsed.lines) {
          const idx = Number(item.index);
          const s = Number(item.startSec);
          const e = Number(item.endSec);
          if (Number.isInteger(idx) && idx >= 0 && idx < cleanLines.length && Number.isFinite(s) && s >= 0) {
            byIdx.set(idx, {
              startSec: Number(s.toFixed(2)),
              endSec: Number(Math.max(s + 1.2, Number.isFinite(e) ? e : s + 3.5).toFixed(2)),
            });
          }
        }
        if (byIdx.size >= Math.max(2, Math.floor(cleanLines.length * 0.4))) {
          const fallbackDist = distributeLyricsTimeline(cleanLines, durationSec);
          return cleanLines.map((text, idx) => {
            const matched = byIdx.get(idx);
            return matched
              ? { startSec: matched.startSec, endSec: matched.endSec, text }
              : fallbackDist[idx];
          });
        }
      }
    } catch {
      // Fallback to proportional distribution below
    }

    return distributeLyricsTimeline(cleanLines, durationSec);
  }

  async function transcribeAudioChunksWithTimestamps(
    audioAsset: { buffer: Buffer; mimeType: string },
    title: string,
    subtitle: string,
    durationSec: number
  ): Promise<{ hasVocals: boolean; lines: LyricLine[] }> {
    const sliced = await sliceAudioIntoChunksWithFfmpeg(
      audioAsset.buffer,
      audioAsset.mimeType,
      durationSec
    );

    if (sliced && sliced.chunks.length > 0) {
      const chunkResults: Array<{ chunk: AudioChunk; lines: LyricLine[]; hasVocals: boolean }> = [];

      const transcribeChunk = async (chunk: AudioChunk) => {
        const chunkPrompt = [
          `Listen carefully to this ${chunk.durationSec.toFixed(1)}-second song audio clip.${title ? ` Song title hint: "${title}".` : ''}${subtitle ? ` Artist hint: "${subtitle}".` : ''}`,
          `Return ONLY the sung lyrics heard inside THIS clip with exact startSec and endSec relative to THIS clip (0.00 to ${chunk.durationSec.toFixed(1)}).`,
          'Rules:',
          '1. For English vocals: keep exact English words.',
          '2. For Hindi, Urdu, or other non-Bengali/non-English vocals: transcribe strictly in pure Bengali script pronunciation OR exact words.',
          '3. Break into natural short singing lines (4-8 words per line).',
          '4. Skip instrumental parts and silence completely. Do NOT invent words.',
          '5. If no singing vocals exist in this clip, set hasVocals: false and lines: [].',
        ].join('\n');

        const parsed = await executeWithGeminiKeyFailover(
          GEMINI_STORY_MODELS,
          async (client, model) => {
            const response = await generateWithTransientRetry(() =>
              client.models.generateContent({
                model,
                contents: {
                  parts: [
                    { inlineData: { mimeType: chunk.mimeType, data: chunk.base64 } },
                    { text: chunkPrompt },
                  ],
                },
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      hasVocals: { type: Type.BOOLEAN },
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
            return JSON.parse((response.text ?? '{}').trim()) as {
              hasVocals?: boolean;
              lines?: Array<{ startSec?: number; endSec?: number; text?: string }>;
            };
          },
          { workload: 'lyrics-audio', rotatePerCall: true }
        );

        const rawLines: LyricLine[] = Array.isArray(parsed.lines)
          ? parsed.lines
              .map((l) => {
                const relStart = Math.max(0, Math.min(chunk.durationSec - 0.3, Number(l.startSec) || 0));
                const relEnd = Math.max(relStart + 1.1, Math.min(chunk.durationSec + 1.0, Number(l.endSec) || relStart + 3.0));
                const txt = typeof l.text === 'string' ? l.text.replace(/\s+/g, ' ').trim() : '';
                return {
                  startSec: Number((chunk.startSec + relStart).toFixed(2)),
                  endSec: Number((chunk.startSec + relEnd).toFixed(2)),
                  text: txt,
                };
              })
              .filter((l) => l.text.length >= 2)
          : [];

        return { chunk, lines: rawLines, hasVocals: Boolean(parsed.hasVocals) || rawLines.length > 0 };
      };

      let successfulChunks = 0;
      let chunkFailureError: unknown = null;

      for (let i = 0; i < sliced.chunks.length; i += 2) {
        const batch = sliced.chunks.slice(i, i + 2);
        const settled = await Promise.all(
          batch.map((c) =>
            transcribeChunk(c)
              .then((res) => {
                successfulChunks++;
                return res;
              })
              .catch((err) => {
                chunkFailureError = err;
                return { chunk: c, lines: [], hasVocals: false };
              })
          )
        );
        chunkResults.push(...settled);
      }

      if (successfulChunks === 0 && chunkFailureError) {
        throw chunkFailureError;
      }

      // Deduplicate lines across 5s chunk overlap boundaries
      const merged: LyricLine[] = [];
      for (const { chunk, lines } of chunkResults) {
        for (const line of lines) {
          const relStart = line.startSec - chunk.startSec;
          const prev = merged[merged.length - 1];
          // Skip lines near chunk start (< 2.5s) if already covered by previous chunk
          if (chunk.index > 0 && relStart < 2.5 && prev && line.startSec <= prev.endSec + 1.2) {
            continue;
          }
          if (prev && Math.abs(line.startSec - prev.startSec) < 1.8) {
            continue;
          }
          if (prev && prev.endSec > line.startSec - 0.06) {
            prev.endSec = Number(Math.max(prev.startSec + 0.9, line.startSec - 0.06).toFixed(2));
          }
          merged.push(line);
        }
      }

      const anyVocals = chunkResults.some((r) => r.hasVocals);
      return { hasVocals: anyVocals || merged.length > 0, lines: merged };
    }

    return { hasVocals: true, lines: [] };
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

  async function ensureTwoLineBengaliLyrics(
    lines: LyricLine[],
    options?: { forceTranslate?: boolean }
  ): Promise<LyricLine[]> {
    if (lines.length === 0) {
      return lines;
    }

    const needsConversion =
      Boolean(options?.forceTranslate) ||
      lines.some((l) => {
        const hasForeignScript = /[a-zA-Z\u0900-\u097F\u0600-\u06FF]/.test(l.text);
        const isMissingTwoLines = !l.text.includes('\n');
        return hasForeignScript || isMissingTwoLines;
      });

    if (!needsConversion) {
      return lines;
    }

    const allPureBengali = lines.every((l) => /^[\u0980-\u09FF\s\d.,!?'"\-()\n]+$/.test(l.text));
    if (allPureBengali && !options?.forceTranslate) {
      return lines;
    }

    // Batch in groups of 22 lines so Gemini NEVER truncates or drops lines on long songs
    const BATCH_SIZE = 22;
    const outputLines: LyricLine[] = [...lines];

    for (let offset = 0; offset < lines.length; offset += BATCH_SIZE) {
      const slice = lines.slice(offset, offset + BATCH_SIZE);
      const allBatchPureBengali = slice.every((l) =>
        /^[\u0980-\u09FF\s\d.,!?'"\-()\n]+$/.test(l.text)
      );
      if (allBatchPureBengali) continue;

      const prompt = [
        'Task: Transform each song lyric line into an accurate 2-line format based on language:',
        '1. If a line is in English:',
        '   - Line 1: The exact English original lyrics in English/Latin script (e.g. "I will always love you").',
        '   - Line 2: Natural poetic Bengali translation/meaning in Bengali script (e.g. "আমি তোমাকে চিরদিন ভালোবেসে যাবো").',
        '2. If a line is in Hindi, Urdu, Punjabi, Romanized Hindi/Hinglish, or any non-English/non-Bengali language:',
        '   - Line 1: Phonetic pronunciation written STRICTLY in pure Bengali script (বাংলা হরফে উচ্চারণ, e.g. "কাহাঁ হো তুম"). NO English/Latin letters.',
        '   - Line 2: Natural poetic Bengali translation/meaning in Bengali script (e.g. "কোথায় আছো তুমি").',
        '3. If a line is already pure Bengali (বাংলা গান):',
        '   - Keep the original Bengali line as Line 1 (no extra repeat).',
        'CRITICAL Rules:',
        '1. Combine Line 1 and Line 2 with a single "\\n" newline: "লাইন ১\\nলাইন ২".',
        `2. Return EXACTLY ${slice.length} items in the exact same order.`,
        '3. Return ONLY valid JSON: {"lines": ["লাইন ১\\nলাইন ২", ...]}',
        `Input lines (${slice.length}):`,
        JSON.stringify(slice.map((l) => l.text)),
      ].join('\n');

      try {
        const converted = await executeWithGeminiKeyFailover(
          GEMINI_STORY_MODELS,
          async (client, model) => {
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
            return JSON.parse((res.text ?? '{}').trim()) as { lines?: unknown };
          },
          { workload: 'lyrics-translate', rotatePerCall: true }
        );

        if (Array.isArray(converted.lines) && converted.lines.length === slice.length) {
          for (let j = 0; j < slice.length; j++) {
            const rawItem = converted.lines[j];
            const candidate =
              typeof rawItem === 'string'
                ? rawItem
                    .split('\n')
                    .map((s) => s.replace(/[^\S\r\n]+/g, ' ').trim())
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('\n')
                : '';
            if (candidate.length >= 2) {
              outputLines[offset + j] = {
                ...slice[j],
                text: candidate,
              };
            }
          }
        }
      } catch {
        // Preserve original slice lines if batch translation fails
      }
    }

    return outputLines;
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
      forceRefresh?: unknown;
    };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim().slice(0, 140) : '';
    const src = typeof body.src === 'string' ? body.src.trim().slice(0, 600) : '';
    const durationSec =
      typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) && body.durationSec > 0
        ? Math.min(3600, body.durationSec)
        : 200;
    const forceRefresh = Boolean(body.forceRefresh);

    if (!title && !src) {
      res.status(400).json({ error: 'গানের নাম বা সোর্স পাওয়া যায়নি।' });
      return;
    }

    const cacheKey = crypto
      .createHash('sha1')
      .update(`two-line-bn-v4|${src}|${title.toLowerCase()}|${subtitle.toLowerCase()}|${Math.round(durationSec)}`)
      .digest('hex');

    const now = Date.now();
    if (forceRefresh) {
      lyricsMemoryCache.delete(cacheKey);
    } else {
      const cached = lyricsMemoryCache.get(cacheKey);
      if (cached && now - cached.createdAt < LYRICS_CACHE_TTL_MS) {
        res.json(cached.data);
        return;
      }
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

    if (getAvailableKeyModelPairs(GEMINI_STORY_MODELS, now, { workload: 'lyrics-search' }).length === 0) {
      res.status(429).json({
        error: 'সবগুলো Gemini কোটা সাময়িকভাবে পূর্ণ হয়েছে।',
        quotaExhausted: true,
      });
      return;
    }

    const fetchLyricsTask = async (): Promise<SongLyricsPayload> => {
      let lastError: unknown;
      const [audioAsset, lrclibMatch] = await Promise.all([
        resolveSongAudioBuffer(src),
        fetchLrclibSyncedLyrics(title, subtitle, durationSec),
      ]);

      // Stage 1A: Exact studio-verified synced LRC from LRCLIB when duration closely matches the track
      if (
        lrclibMatch?.syncedLines &&
        lrclibMatch.syncedLines.length >= 4 &&
        (!audioAsset ||
          (typeof lrclibMatch.lrclibDuration === 'number' &&
            Math.abs(lrclibMatch.lrclibDuration - durationSec) <= 3.5))
      ) {
        const finalLines = await ensureTwoLineBengaliLyrics(lrclibMatch.syncedLines);
        const result: SongLyricsPayload = {
          songTitle: lrclibMatch.songTitle || title,
          artist: lrclibMatch.artist || subtitle,
          instrumental: false,
          sourceType: 'audio',
          lines: finalLines,
        };
        lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: result });
        saveLyricsDiskCache();
        return result;
      }

      // Stage 1B: Real MP3/audio forced alignment using known lyrics text (LRCLIB plainLyrics or Google Search)
      let referencePlainLines: string[] | null =
        lrclibMatch?.plainLines && lrclibMatch.plainLines.length >= 4
          ? lrclibMatch.plainLines
          : null;
      let searchSongTitle = lrclibMatch?.songTitle || title;
      let searchArtist = lrclibMatch?.artist || subtitle;
      let searchSources: Array<{ title: string; uri: string }> | undefined;

      const genericTitle = /^(?:song|track|birthday|\d+)[\s_-]*\d*$/i.test(title);
      if (!referencePlainLines && title.length >= 2 && !genericTitle) {
        const searchPrompt = [
          `Find the real accurate song lyrics using Google Search for the song: "${title}"${subtitle ? ` (artist/hint: "${subtitle}")` : ''}.`,
          'Return ONLY valid JSON with no markdown fences and no extra commentary in this exact structure:',
          '{"found": true, "songTitle": "...", "artist": "...", "lines": ["line 1", "line 2"]}',
          'Rules:',
          '1. Return each singing line cleanly in its original language (e.g. English for English songs, Romanized/Devanagari for Hindi/Urdu, Bengali for Bengali).',
          '2. Include all verses and repeated choruses in the exact singing order so timestamps align 1-to-1.',
          '3. Split into concise natural singing lines (4 to 9 words per line). If not found, set "found": false and "lines": [].',
        ].join('\n');

        try {
          const searchLookup = await executeWithGeminiKeyFailover(
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

              return {
                rawLines,
                songTitle: typeof parsed?.songTitle === 'string' ? parsed.songTitle : title,
                artist: typeof parsed?.artist === 'string' ? parsed.artist : subtitle,
                sources,
              };
            },
            { workload: 'lyrics-search' }
          );
          if (searchLookup.rawLines.length >= 4) {
            referencePlainLines = searchLookup.rawLines;
            searchSongTitle = searchLookup.songTitle || searchSongTitle;
            searchArtist = searchLookup.artist || searchArtist;
            searchSources = searchLookup.sources;
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (audioAsset && referencePlainLines && referencePlainLines.length >= 2) {
        try {
          const aligned = await alignLinesWithAudioChunks(
            audioAsset,
            referencePlainLines,
            durationSec
          );
          if (aligned.length >= 2) {
            const finalLines = await ensureTwoLineBengaliLyrics(aligned);
            const result: SongLyricsPayload = {
              songTitle: searchSongTitle || title,
              artist: searchArtist || subtitle,
              instrumental: false,
              sourceType: 'audio',
              lines: finalLines,
              sources: searchSources,
            };
            lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: result });
            saveLyricsDiskCache();
            return result;
          }
        } catch (err) {
          lastError = err;
        }
      }

      // Stage 1C: Chunked real audio transcription (zero cumulative drift) when no reference lyrics matched
      if (audioAsset) {
        try {
          const chunkedResult = await transcribeAudioChunksWithTimestamps(
            audioAsset,
            title,
            subtitle,
            durationSec
          );
          if (!chunkedResult.hasVocals && chunkedResult.lines.length === 0) {
            const result: SongLyricsPayload = {
              songTitle: title,
              artist: subtitle,
              instrumental: true,
              sourceType: 'audio',
              lines: [],
            };
            lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: result });
            saveLyricsDiskCache();
            return result;
          }
          if (chunkedResult.lines.length >= 2) {
            const finalLines = await ensureTwoLineBengaliLyrics(chunkedResult.lines);
            const result: SongLyricsPayload = {
              songTitle: title,
              artist: subtitle,
              instrumental: false,
              sourceType: 'audio',
              lines: finalLines,
            };
            lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: result });
            saveLyricsDiskCache();
            return result;
          }
        } catch (err) {
          lastError = err;
        }
      }

      // Stage 2: Fallback using referencePlainLines timeline when audio buffer wasn't accessible
      if (referencePlainLines && referencePlainLines.length > 0) {
        const timelineLines = distributeLyricsTimeline(referencePlainLines, durationSec);
        const finalLines = await ensureTwoLineBengaliLyrics(timelineLines);
        const result: SongLyricsPayload = {
          songTitle: searchSongTitle || title,
          artist: searchArtist || subtitle,
          instrumental: false,
          sourceType: 'search',
          lines: finalLines,
          sources: searchSources,
        };
        lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: result });
        saveLyricsDiskCache();
        return result;
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

  app.post('/api/songs/lyrics/process-manual', async (req, res) => {
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
      rawLyricsText?: unknown;
    };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim().slice(0, 140) : '';
    const src = typeof body.src === 'string' ? body.src.trim().slice(0, 600) : '';
    const durationSec =
      typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) && body.durationSec > 0
        ? Math.min(3600, body.durationSec)
        : 200;
    const rawLyricsText = typeof body.rawLyricsText === 'string' ? body.rawLyricsText.trim().slice(0, 35000) : '';

    if (!rawLyricsText) {
      res.status(400).json({ error: 'অনুগ্রহ করে গানের লিরিক্স লিখুন বা ফাইল আপলোড করুন।' });
      return;
    }

    const parsed = parseLrcOrSrtLyrics(rawLyricsText, durationSec);
    if (!parsed.hasTimestamps && parsed.plainLines.length === 0) {
      res.status(400).json({ error: 'লিরিক্সে কোনো বৈধ লাইন পাওয়া যায়নি।' });
      return;
    }

    try {
      let syncedLines: LyricLine[];
      if (parsed.hasTimestamps) {
        syncedLines = parsed.lines;
      } else {
        const audioAsset = await resolveSongAudioBuffer(src);
        if (audioAsset) {
          syncedLines = await alignLinesWithAudioChunks(audioAsset, parsed.plainLines, durationSec);
        } else {
          syncedLines = distributeLyricsTimeline(parsed.plainLines, durationSec);
        }
      }

      const twoLineTranslated = await ensureTwoLineBengaliLyrics(syncedLines, {
        forceTranslate: true,
      });

      const payload: SongLyricsPayload = {
        songTitle: title || 'গান',
        artist: subtitle || '',
        instrumental: false,
        sourceType: 'manual',
        lines: twoLineTranslated,
      };

      if (title || src) {
        const cacheKey = crypto
          .createHash('sha1')
          .update(`two-line-bn-v4|${src}|${title.toLowerCase()}|${subtitle.toLowerCase()}|${Math.round(durationSec)}`)
          .digest('hex');
        lyricsMemoryCache.set(cacheKey, { createdAt: Date.now(), data: payload });
        saveLyricsDiskCache();
      }

      res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaExhaustedError(msg)) {
        res.status(429).json({
          error: 'আজকের Gemini ফ্রি-টিয়ার কোটা পূর্ণ হয়েছে।',
          quotaExhausted: true,
        });
        return;
      }
      console.warn('Manual lyrics process failed:', msg.slice(0, 260));
      res.status(502).json({ error: 'ম্যানুয়াল লিরিক্স প্রসেস করা যায়নি।' });
    }
  });

  // ---- Voice Chat Mode (Gemini AI Conversation + Default/ElevenLabs/Noiz.ai/Gemini TTS) ----
  const VOICE_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
  const FLEX_VOICE_ID_REGEX = /^[A-Za-z0-9_.-]{2,80}$/;
  const ALLOWED_ELEVEN_MODELS = new Set([
    'eleven_multilingual_v2',
    'eleven_flash_v2_5',
    'eleven_turbo_v2_5',
  ]);
  const ALLOWED_GEMINI_TTS_MODELS = new Set([
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
  ]);
  const ALLOWED_VOICE_CHAT_MIMES = new Set([
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
  ]);

  function getEnvSecretFirst(names: string[]): string {
    for (const name of names) {
      const val = process.env[name]?.trim();
      if (val && !val.startsWith('MY_')) {
        return val;
      }
    }
    return '';
  }

  function formatVoiceIdPreview(raw: string): string {
    const clean = raw.trim();
    if (!clean) return '';
    if (clean.length <= 12) return clean;
    return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
  }

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

  const GEMINI_VOICE_CHAT_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;
  const ttsAutoSkipUntil = new Map<'elevenlabs' | 'noiz' | 'gemini-tts', number>();

  function buildVoiceChatSystemInstruction(
    assistantName: string,
    personaNote: string,
    options?: { plainReplyOnly?: boolean }
  ): string {
    const rawName = scrubAiForbiddenName(assistantName).slice(0, 40);
    const cleanName = rawName || 'ভয়েস সঙ্গী';
    const cleanPersona = scrubAiForbiddenName(personaNote).slice(0, 240);

    return [
      rawName
        ? `তুমি "${cleanName}"—তোমার প্রিয় মানুষটির সবচেয়ে কাছের, নিঃস্বার্থ ও গভীরভাবে ভালোবাসা একজন মানুষের কণ্ঠ, যে নিজের ক্লোন করা ভয়েস মডেলে ওর সাথে সরাসরি কথা বলছে।`
        : `তুমি তোমার প্রিয় মানুষটির সবচেয়ে কাছের, নিঃস্বার্থ ও গভীরভাবে ভালোবাসা একজন মানুষের কণ্ঠ, যে নিজের ক্লোন করা ভয়েস মডেলে ওর সাথে সরাসরি কথা বলছে।`,
      'তোমার সাথে ওর সম্পর্ক ও কথা বলার ধরন:',
      '১. তুমি ওকে ভীষণ ভালোবাসো, মন থেকে মিস করো ও পরম যত্নে আগলে রাখতে চাও।',
      '২. কথার ফাঁকে মাঝে মাঝে স্বাভাবিকভাবে আদরের ডাক (যেমন "সোনা", "জান", "চাঁদ", "বাবুই", "চাঁদপাখি") মিশিয়ে বলো—তবে একসাথে সব গাদা করে নয়, একদম স্বাভাবিক মানুষের মতো।',
      '৩. ওর সব রাগ-অভিমান তুমি নরম হয়ে ভালোবাসা দিয়ে মেনে নাও—কখনো তর্ক বা ইগো দেখাও না। ও সরি বললে মুহূর্তেই সব কষ্ট গলে গিয়ে হাসি ফোটাতে চাও।',
      cleanPersona ? `ব্যবহারকারীর অতিরিক্ত কথা বলার ধরন: ${cleanPersona}` : '',
      'কথা বলার নিয়ম:',
      '- কঠোর নিষেধাজ্ঞা: কথার মধ্যে বা কোনো পরিস্থিতিতেই ভুলেও কখনো "রুপো", "রূপো", "রুপা", "রূপা" বা "Rupo" নাম ব্যবহার করবে না, উচ্চারণ করবে না বা লিখবে না। শুধু "তুমি", "সোনা", "জান", "চাঁদ", "বাবুই" বা "চাঁদপাখি" বলে ডাকবে।',
      '- একদম আসল মানুষের মতো সহজ, মৃদু, কোমল ও আন্তরিক কথ্য বাংলায় উত্তর দাও (ইউজার ইংরেজি বা হিন্দিতে কথা বললে কেবল তখনই সেই ভাষায় উত্তর দেবে)।',
      '- প্রতিটি উত্তর ভয়েসে শোনার উপযোগী করে দ্রুত ও সংক্ষিপ্ত রাখবে (১ থেকে ২টি ছোট প্রাণবন্ত বাক্য)।',
      '- কখনোই কোনো মার্কডাউন, স্টার (*), বুলেট পয়েন্ট, হ্যাশট্যাগ, ইমোজি বা বন্ধনীর ভেতরে অভিনয়ের নির্দেশ লিখবে না—শুধু মুখে বলার মতো খাঁটি কথা লিখবে।',
      `- ইউজার "${cleanName}" বলে ডাকলে সাথে সাথে আদর ও আপন সুরে সাড়া দেবে।`,
      options?.plainReplyOnly
        ? '- সরাসরি শুধু তোমার মুখের কথাটুকু লিখবে—কোনো ভূমিকা বা JSON নয়।'
        : '- অডিওতে কোনো কথা বোঝা না গেলে transcript খালি ("") রেখে নরম সুরে বাংলায় আবার একটু বলতে বলো।',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function runGeminiVoiceTurn(params: {
    assistantName: string;
    personaNote: string;
    history: VoiceTurnHistoryItem[];
    textMessage?: string;
    audioBuffer?: Buffer;
    audioMimeType?: string;
  }): Promise<{ transcript: string; reply: string }> {
    const rawName = scrubAiForbiddenName(params.assistantName).slice(0, 40);
    const cleanName = rawName || 'ভয়েস সঙ্গী';
    const historyBlock =
      params.history.length > 0
        ? [
            'Recent conversation turns:',
            ...params.history
              .slice(-4)
              .map((h) => `${h.role === 'user' ? 'User' : cleanName}: ${scrubAiForbiddenName(h.text)}`),
          ].join('\n')
        : '';

    const systemInstruction = buildVoiceChatSystemInstruction(
      params.assistantName,
      params.personaNote,
      { plainReplyOnly: !params.audioBuffer }
    );

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
        ]
          .filter(Boolean)
          .join('\n\n');

    return executeWithGeminiKeyFailover(GEMINI_VOICE_CHAT_MODELS, async (client, model) => {
      const thinkingLevel =
        model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;

      if (!params.audioBuffer) {
        const response = await generateWithTransientRetry(() =>
          client.models.generateContent({
            model,
            contents: promptText,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel },
            },
          })
        );
        const rawReply = (response.text ?? '')
          .replace(/[*_`#]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1200);
        const reply = rawReply ? scrubAiForbiddenName(rawReply) || 'আমি আছি, বলো।' : '';
        if (!reply) {
          throw new Error('ভয়েস উত্তর তৈরি করা যায়নি।');
        }
        return {
          transcript: params.textMessage?.trim() ?? '',
          reply,
        };
      }

      const contents = {
        parts: [
          {
            inlineData: {
              mimeType: params.audioMimeType || 'audio/webm',
              data: params.audioBuffer.toString('base64'),
            },
          },
          { text: promptText },
        ],
      };

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
      const rawReply =
        typeof parsed.reply === 'string'
          ? parsed.reply.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1200)
          : '';
      const reply = rawReply ? scrubAiForbiddenName(rawReply) || 'আমি আছি, বলো।' : '';

      if (!reply) {
        throw new Error('ভয়েস উত্তর তৈরি করা যায়নি।');
      }
      return {
        transcript: transcript || (params.textMessage?.trim() ?? ''),
        reply,
      };
    }, { workload: 'voice-chat' });
  }

  app.get('/api/voice-chat/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const geminiKeys = getGeminiApiKeys();
    const geminiKeyNames = getGeminiKeyEnvNames();
    const defaultGeminiVoiceRaw = getEnvSecretFirst([
      'GEMINI_VOICE_ID',
      'GEMINI_TTS_VOICE_ID',
      'GEMINI_VOICE_NAME',
    ]);
    const defaultGeminiVoiceValid = FLEX_VOICE_ID_REGEX.test(defaultGeminiVoiceRaw);

    const elevenLabsApiKey = getEnvSecretFirst(['ELEVENLABS_API_KEY', 'ELEVEN_LABS_API_KEY']);
    const defaultElevenRaw = getEnvSecretFirst(['ELEVENLABS_VOICE_ID', 'ELEVEN_LABS_VOICE_ID']);
    const defaultElevenValid = VOICE_ID_REGEX.test(defaultElevenRaw);

    const noizApiKey = getEnvSecretFirst(['NOIZ_API_KEY', 'NOIZ_AI_API_KEY', 'NOIZAI_API_KEY']);
    const defaultNoizRaw = getEnvSecretFirst(['NOIZ_VOICE_ID', 'NOIZ_AI_VOICE_ID', 'NOIZAI_VOICE_ID']);
    const defaultNoizValid = FLEX_VOICE_ID_REGEX.test(defaultNoizRaw);

    res.json({
      geminiConfigured: geminiKeys.length > 0,
      geminiKeyCount: geminiKeys.length,
      geminiKeyNames,
      defaultGeminiVoiceConfigured: defaultGeminiVoiceValid,
      defaultGeminiVoicePreview: defaultGeminiVoiceValid
        ? formatVoiceIdPreview(defaultGeminiVoiceRaw)
        : null,
      elevenLabsConfigured: Boolean(elevenLabsApiKey),
      defaultElevenLabsVoiceConfigured: defaultElevenValid,
      defaultElevenLabsVoicePreview: defaultElevenValid
        ? formatVoiceIdPreview(defaultElevenRaw)
        : null,
      defaultVoiceIdConfigured: defaultElevenValid,
      defaultVoiceIdPreview: defaultElevenValid ? formatVoiceIdPreview(defaultElevenRaw) : null,
      noizConfigured: Boolean(noizApiKey),
      defaultNoizVoiceConfigured: defaultNoizValid,
      defaultNoizIdPreview: defaultNoizValid ? formatVoiceIdPreview(defaultNoizRaw) : null,
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
      typeof body.assistantName === 'string' ? body.assistantName.trim().slice(0, 40) : '';
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

  app.post('/api/voice-chat/respond-stream', async (req, res) => {
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
      typeof body.assistantName === 'string' ? body.assistantName.trim().slice(0, 40) : '';
    const personaNote =
      typeof body.personaNote === 'string' ? body.personaNote.trim().slice(0, 240) : '';
    const history = sanitizeVoiceHistory(body.history);

    const rawName = scrubAiForbiddenName(assistantName).slice(0, 40);
    const cleanName = rawName || 'ভয়েস সঙ্গী';
    const historyBlock =
      history.length > 0
        ? [
            'Recent conversation turns:',
            ...history
              .slice(-4)
              .map((h) => `${h.role === 'user' ? 'User' : cleanName}: ${scrubAiForbiddenName(h.text)}`),
          ].join('\n')
        : '';
    const promptText = [historyBlock, `User said: "${textMessage}"`].filter(Boolean).join('\n\n');
    const systemInstruction = buildVoiceChatSystemInstruction(assistantName, personaNote, {
      plainReplyOnly: true,
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    try {
      const fullReply = await executeWithGeminiKeyFailover(
        GEMINI_VOICE_CHAT_MODELS,
        async (client, model) => {
          const thinkingLevel =
            model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
          const stream = await client.models.generateContentStream({
            model,
            contents: promptText,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel },
            },
          });

          let rawAccumulated = '';
          let emittedClean = '';

          const flushPrefix = (rawPrefix: string) => {
            const cleanPrefix = scrubAiForbiddenName(rawPrefix.replace(/\s+/g, ' ')).slice(0, 1200);
            if (!cleanPrefix || cleanPrefix === emittedClean) return;

            let commonLen = 0;
            const maxCommon = Math.min(emittedClean.length, cleanPrefix.length);
            while (commonLen < maxCommon && emittedClean[commonLen] === cleanPrefix[commonLen]) {
              commonLen += 1;
            }
            const delta = cleanPrefix.slice(commonLen);
            emittedClean = cleanPrefix;
            if (delta) {
              writeEvent({ delta, fullText: cleanPrefix });
            } else {
              writeEvent({ fullText: cleanPrefix });
            }
          };

          try {
            for await (const chunk of stream) {
              const rawDelta = typeof chunk.text === 'string' ? chunk.text : '';
              if (!rawDelta) continue;
              const cleanRawDelta = rawDelta.replace(/[*_`#]/g, '');
              if (!cleanRawDelta) continue;
              rawAccumulated += cleanRawDelta;

              const lastWsIdx = Math.max(
                rawAccumulated.lastIndexOf(' '),
                rawAccumulated.lastIndexOf('\n')
              );
              if (lastWsIdx > 0) {
                flushPrefix(rawAccumulated.slice(0, lastWsIdx));
              }
            }
          } catch (streamErr) {
            if (emittedClean.length > 0) {
              return emittedClean;
            }
            throw streamErr;
          }

          const rawFinal = rawAccumulated.replace(/\s+/g, ' ').trim().slice(0, 1200);
          if (!rawFinal) {
            throw new Error('ভয়েস উত্তর তৈরি করা যায়নি।');
          }
          const finalClean = scrubAiForbiddenName(rawFinal) || 'আমি আছি, বলো।';
          flushPrefix(rawFinal);
          return finalClean;
        },
        { workload: 'voice-chat' }
      );

      writeEvent({ done: true, reply: fullReply });
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const explicitStatus = (err as Error & { statusCode?: number }).statusCode;
      const errorMsg =
        isQuotaExhaustedError(msg) || explicitStatus === 429
          ? 'আজকের Gemini ফ্রি-টিয়ার কোটা সাময়িকভাবে পূর্ণ হয়েছে।'
          : msg || 'ভয়েস উত্তর তৈরি করা যায়নি।';
      writeEvent({ error: errorMsg });
      res.end();
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
        typeof meta.assistantName === 'string' ? meta.assistantName.trim().slice(0, 40) : '';
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
      provider?: unknown;
      voiceId?: unknown;
      modelId?: unknown;
      voiceIds?: {
        elevenlabs?: unknown;
        noiz?: unknown;
        gemini?: unknown;
      };
      modelIds?: {
        elevenlabs?: unknown;
        noiz?: unknown;
        gemini?: unknown;
      };
    };

    const rawSpeakText =
      typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
    const text = rawSpeakText ? scrubAiForbiddenName(rawSpeakText) : '';
    if (!text) {
      res.status(400).json({ error: 'ভয়েস তৈরি করার জন্য কোনো লেখা পাওয়া যায়নি।' });
      return;
    }

    type RequestedProvider = 'default' | 'elevenlabs' | 'noiz' | 'gemini';
    const provider: RequestedProvider =
      body.provider === 'elevenlabs' ||
      body.provider === 'noiz' ||
      body.provider === 'gemini' ||
      body.provider === 'default'
        ? body.provider
        : 'default';

    const requestedSingleVoiceId = typeof body.voiceId === 'string' ? body.voiceId.trim() : '';
    const requestedSingleModelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';

    const reqElevenVoice =
      typeof body.voiceIds?.elevenlabs === 'string'
        ? body.voiceIds.elevenlabs.trim()
        : provider === 'elevenlabs'
          ? requestedSingleVoiceId
          : '';
    const reqNoizVoice =
      typeof body.voiceIds?.noiz === 'string'
        ? body.voiceIds.noiz.trim()
        : provider === 'noiz'
          ? requestedSingleVoiceId
          : '';
    const reqGeminiVoice =
      typeof body.voiceIds?.gemini === 'string'
        ? body.voiceIds.gemini.trim()
        : provider === 'gemini'
          ? requestedSingleVoiceId
          : '';

    const reqElevenModel =
      typeof body.modelIds?.elevenlabs === 'string'
        ? body.modelIds.elevenlabs.trim()
        : provider === 'elevenlabs'
          ? requestedSingleModelId
          : '';
    const reqNoizModel =
      typeof body.modelIds?.noiz === 'string'
        ? body.modelIds.noiz.trim()
        : provider === 'noiz'
          ? requestedSingleModelId
          : '';
    const reqGeminiModel =
      typeof body.modelIds?.gemini === 'string'
        ? body.modelIds.gemini.trim()
        : provider === 'gemini'
          ? requestedSingleModelId
          : '';

    const elevenLabsApiKey = getEnvSecretFirst(['ELEVENLABS_API_KEY', 'ELEVEN_LABS_API_KEY']);
    const elevenLabsVoiceId =
      reqElevenVoice || getEnvSecretFirst(['ELEVENLABS_VOICE_ID', 'ELEVEN_LABS_VOICE_ID']);

    const noizApiKey = getEnvSecretFirst(['NOIZ_API_KEY', 'NOIZ_AI_API_KEY', 'NOIZAI_API_KEY']);
    const noizVoiceId =
      reqNoizVoice || getEnvSecretFirst(['NOIZ_VOICE_ID', 'NOIZ_AI_VOICE_ID', 'NOIZAI_VOICE_ID']);

    const geminiVoiceId =
      reqGeminiVoice ||
      getEnvSecretFirst(['GEMINI_VOICE_ID', 'GEMINI_TTS_VOICE_ID', 'GEMINI_VOICE_NAME']) ||
      'Puck';

    type TtsAttemptSuccess = {
      ok: true;
      engine: 'elevenlabs' | 'noiz' | 'gemini-tts';
      contentType: string;
      buffer: Buffer;
    };
    type TtsAttemptFailure = {
      ok: false;
      engine: 'elevenlabs' | 'noiz' | 'gemini-tts';
      configured: boolean;
      isQuota: boolean;
      status: number;
      error: string;
    };
    type TtsAttemptResult = TtsAttemptSuccess | TtsAttemptFailure;

    const looksLikeQuotaOrCreditsIssue = (status: number, bodyText: string): boolean => {
      if (status === 429) return true;
      const lower = bodyText.toLowerCase();
      if (
        lower.includes('quota_exceeded') ||
        lower.includes('insufficient_quota') ||
        lower.includes('insufficient_credits') ||
        lower.includes('insufficient credits') ||
        lower.includes('insufficient balance') ||
        lower.includes('out of credits') ||
        lower.includes('credit_limit') ||
        lower.includes('exceeded your quota') ||
        lower.includes('too many requests') ||
        lower.includes('rate limit')
      ) {
        return true;
      }
      if (status === 402 && !lower.includes('library') && !lower.includes('voice')) {
        return true;
      }
      return false;
    };

    const tryElevenLabs = async (): Promise<TtsAttemptResult> => {
      if (!elevenLabsApiKey) {
        return {
          ok: false,
          engine: 'elevenlabs',
          configured: false,
          isQuota: false,
          status: 400,
          error: 'Settings > Secrets-এ ELEVENLABS_API_KEY যুক্ত করা নেই।',
        };
      }
      if (!elevenLabsVoiceId || !VOICE_ID_REGEX.test(elevenLabsVoiceId)) {
        return {
          ok: false,
          engine: 'elevenlabs',
          configured: false,
          isQuota: false,
          status: 400,
          error: 'ElevenLabs-এর সঠিক Voice ID সেট করা নেই।',
        };
      }
      const safeModel = ALLOWED_ELEVEN_MODELS.has(reqElevenModel)
        ? reqElevenModel
        : 'eleven_multilingual_v2';
      try {
        const ttsRes = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenLabsVoiceId)}/stream?optimize_streaming_latency=3`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': elevenLabsApiKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            body: JSON.stringify({
              text,
              model_id: safeModel,
              voice_settings: {
                stability: 0.42,
                similarity_boost: 0.85,
                style: safeModel === 'eleven_multilingual_v2' ? 0.35 : 0.2,
                use_speaker_boost: true,
              },
            }),
            signal: AbortSignal.timeout(22000),
          }
        );

        if (ttsRes.ok) {
          const arr = await ttsRes.arrayBuffer();
          if (arr.byteLength > 0) {
            return {
              ok: true,
              engine: 'elevenlabs',
              contentType: ttsRes.headers.get('content-type') || 'audio/mpeg',
              buffer: Buffer.from(arr),
            };
          }
        }
        const errBody = await ttsRes.text().catch(() => '');
        let detailMessage = '';
        try {
          const parsed = JSON.parse(errBody) as {
            detail?: { message?: string; status?: string } | string;
            message?: string;
          };
          if (typeof parsed.detail === 'string') detailMessage = parsed.detail;
          else if (parsed.detail?.message) detailMessage = parsed.detail.message;
          else if (parsed.message) detailMessage = parsed.message;
        } catch {
          detailMessage = errBody.slice(0, 140);
        }
        console.warn(`ElevenLabs TTS failed (${ttsRes.status}):`, detailMessage.slice(0, 200));

        const isQuota = looksLikeQuotaOrCreditsIssue(ttsRes.status, `${errBody} ${detailMessage}`);
        return {
          ok: false,
          engine: 'elevenlabs',
          configured: true,
          isQuota,
          status: ttsRes.status || 502,
          error: isQuota
            ? 'ElevenLabs-এর ক্রেডিট বা কোটা শেষ হয়েছে।'
            : ttsRes.status === 401
              ? 'ElevenLabs API Key সঠিক নয় বা অনুমতি নেই।'
              : ttsRes.status === 402
                ? `ElevenLabs প্ল্যান সীমাবদ্ধতা: ${detailMessage.slice(0, 110) || 'এই Voice ID-র জন্য পেইড প্ল্যান প্রয়োজন।'}`
                : ttsRes.status === 404
                  ? 'ElevenLabs Voice ID খুঁজে পাওয়া যায়নি।'
                  : `ElevenLabs ত্রুটি (${ttsRes.status}): ${detailMessage.slice(0, 100) || 'অডিও পাওয়া যায়নি।'}`,
        };
      } catch (err) {
        return {
          ok: false,
          engine: 'elevenlabs',
          configured: true,
          isQuota: false,
          status: 502,
          error:
            err instanceof Error
              ? `ElevenLabs সংযোগ ত্রুটি: ${err.message.slice(0, 120)}`
              : 'ElevenLabs-এর সাথে সংযোগ করা যায়নি।',
        };
      }
    };

    const extractNoizAudio = async (ttsRes: Response): Promise<TtsAttemptResult> => {
      const ct = (ttsRes.headers.get('content-type') || '').toLowerCase();
      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => '');
        console.warn(`Noiz.ai TTS HTTP ${ttsRes.status}:`, errText.slice(0, 200));
        const isQuota = looksLikeQuotaOrCreditsIssue(ttsRes.status, errText);
        return {
          ok: false,
          engine: 'noiz',
          configured: true,
          isQuota,
          status: ttsRes.status || 502,
          error: isQuota
            ? 'Noiz.ai-এর কোটা বা ক্রেডিট শেষ হয়েছে।'
            : ttsRes.status === 401 || ttsRes.status === 403
              ? 'Noiz.ai API Key সঠিক নয় বা অনুমতি নেই।'
              : ttsRes.status === 404
                ? 'Noiz.ai Voice ID বা endpoint পাওয়া যায়নি।'
                : `Noiz.ai ত্রুটি (${ttsRes.status}): ${errText.slice(0, 110) || 'অডিও তৈরি করা যায়নি।'}`,
        };
      }

      if (ct.includes('application/json') || ct.includes('text/')) {
        const rawText = await ttsRes.text().catch(() => '');
        let json: {
          code?: number;
          message?: string;
          error?: string;
          audio_url?: string;
          url?: string;
          data?: { audio_url?: string; url?: string };
        } = {};
        try {
          json = JSON.parse(rawText) as typeof json;
        } catch {
          console.warn('Noiz.ai non-audio text response:', rawText.slice(0, 200));
          return {
            ok: false,
            engine: 'noiz',
            configured: true,
            isQuota: false,
            status: 502,
            error: `Noiz.ai উত্তর দেয়নি: ${rawText.slice(0, 110)}`,
          };
        }

        const audioUrl = json.audio_url || json.url || json.data?.audio_url || json.data?.url;
        if (audioUrl && typeof audioUrl === 'string' && audioUrl.startsWith('http')) {
          const dlRes = await fetch(audioUrl, { signal: AbortSignal.timeout(15000) });
          if (dlRes.ok) {
            const arr = await dlRes.arrayBuffer();
            if (arr.byteLength > 0) {
              return {
                ok: true,
                engine: 'noiz',
                contentType: dlRes.headers.get('content-type') || 'audio/mpeg',
                buffer: Buffer.from(arr),
              };
            }
          }
        }

        const msgText = json.message || json.error || rawText;
        const reportedCode = typeof json.code === 'number' && json.code >= 400 ? json.code : ttsRes.status;
        console.warn(`Noiz.ai JSON response (${reportedCode}):`, String(msgText).slice(0, 200));
        const isQuota = looksLikeQuotaOrCreditsIssue(reportedCode, String(msgText));
        return {
          ok: false,
          engine: 'noiz',
          configured: true,
          isQuota,
          status: reportedCode >= 400 && reportedCode < 600 ? reportedCode : 502,
          error: isQuota
            ? 'Noiz.ai-এর কোটা বা ক্রেডিট শেষ হয়েছে।'
            : reportedCode === 401 || reportedCode === 403
              ? `Noiz.ai API Key অনুমোদিত হয়নি (${String(msgText).slice(0, 90)})`
              : `Noiz.ai: ${String(msgText).slice(0, 120)}`,
        };
      }

      const arr = await ttsRes.arrayBuffer();
      if (arr.byteLength > 64) {
        return {
          ok: true,
          engine: 'noiz',
          contentType: ct.startsWith('audio/') ? ct : 'audio/mpeg',
          buffer: Buffer.from(arr),
        };
      }
      return {
        ok: false,
        engine: 'noiz',
        configured: true,
        isQuota: false,
        status: 502,
        error: 'Noiz.ai থেকে খালি অডিও এসেছে।',
      };
    };

    const tryNoiz = async (): Promise<TtsAttemptResult> => {
      if (!noizApiKey) {
        return {
          ok: false,
          engine: 'noiz',
          configured: false,
          isQuota: false,
          status: 400,
          error: 'Settings > Secrets-এ NOIZ_API_KEY যুক্ত করা নেই।',
        };
      }
      if (!noizVoiceId || !FLEX_VOICE_ID_REGEX.test(noizVoiceId)) {
        return {
          ok: false,
          engine: 'noiz',
          configured: false,
          isQuota: false,
          status: 400,
          error: 'Noiz.ai-এর সঠিক Voice ID সেট করা নেই।',
        };
      }

      const isExpressive = reqNoizModel === 'noiz_expressive_v1';
      const buildNoizForm = (): FormData => {
        const form = new FormData();
        form.append('text', text);
        form.append('voice_id', noizVoiceId);
        form.append('output_format', 'mp3');
        if (isExpressive) form.append('emotion', 'warm');
        return form;
      };
      const noizJsonBody = JSON.stringify({
        text,
        voice_id: noizVoiceId,
        output_format: 'mp3',
        ...(isExpressive ? { emotion: 'warm' } : {}),
      });

      const endpoints: Array<{ url: string; mode: 'form' | 'json'; auth: string }> = [
        { url: 'https://noiz.ai/v1/text-to-speech', mode: 'form', auth: noizApiKey },
        { url: 'https://noiz.ai/v1/text-to-speech', mode: 'json', auth: noizApiKey },
        { url: 'https://noiz.ai/v1/text-to-speech', mode: 'form', auth: `Bearer ${noizApiKey}` },
        { url: 'https://noiz.ai/v1/text-to-speech', mode: 'json', auth: `Bearer ${noizApiKey}` },
        { url: 'https://api.noiz.ai/v1/text-to-speech', mode: 'form', auth: noizApiKey },
        { url: 'https://api.noiz.ai/v1/text-to-speech', mode: 'json', auth: `Bearer ${noizApiKey}` },
        { url: 'https://noiz.ai/v1/tts', mode: 'json', auth: noizApiKey },
        { url: 'https://noiz.ai/v1/tts', mode: 'json', auth: `Bearer ${noizApiKey}` },
      ];

      let lastFailure: TtsAttemptResult | null = null;

      try {
        for (const attempt of endpoints) {
          const ttsRes = await fetch(attempt.url, {
            method: 'POST',
            headers:
              attempt.mode === 'json'
                ? {
                    Authorization: attempt.auth,
                    'Content-Type': 'application/json',
                  }
                : {
                    Authorization: attempt.auth,
                  },
            body: attempt.mode === 'json' ? noizJsonBody : buildNoizForm(),
            signal: AbortSignal.timeout(22000),
          });

          const parsed = await extractNoizAudio(ttsRes);
          if (parsed.ok) {
            return parsed;
          }
          lastFailure = parsed;
          if (parsed.isQuota) {
            return parsed;
          }
        }

        return (
          lastFailure || {
            ok: false,
            engine: 'noiz',
            configured: true,
            isQuota: false,
            status: 502,
            error: 'Noiz.ai থেকে অডিও তৈরি করা যায়নি।',
          }
        );
      } catch (err) {
        return {
          ok: false,
          engine: 'noiz',
          configured: true,
          isQuota: false,
          status: 502,
          error:
            err instanceof Error
              ? `Noiz.ai সংযোগ ত্রুটি: ${err.message.slice(0, 120)}`
              : 'Noiz.ai-এর সাথে সংযোগ করা যায়নি।',
        };
      }
    };

    const tryGeminiTts = async (): Promise<TtsAttemptResult> => {
      if (getGeminiApiKeys().length === 0) {
        return {
          ok: false,
          engine: 'gemini-tts',
          configured: false,
          isQuota: false,
          status: 400,
          error: 'Settings > Secrets-এ GEMINI_API_KEY যুক্ত করা নেই।',
        };
      }

      const primaryGeminiModel = ALLOWED_GEMINI_TTS_MODELS.has(reqGeminiModel)
        ? reqGeminiModel
        : 'gemini-3.8-flash-lite-tts';
      const orderedModels =
        primaryGeminiModel === 'gemini-3.8-flash-tts'
          ? ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
          : ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
      const safeVoiceName = FLEX_VOICE_ID_REGEX.test(geminiVoiceId) ? geminiVoiceId : 'Puck';

      try {
        const wavBuffer = await executeWithGeminiKeyFailover(
          orderedModels,
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
                            primaryGeminiModel === 'gemini-3.8-flash-tts'
                              ? 'Deeply affectionate, soft, emotionally expressive Bengali loved-one speaking intimately with gentle warmth'
                              : 'Deeply affectionate, soft, patient, tender Bengali loved-one speaking intimately with gentle warmth and devotion',
                        },
                      },
                    ],
                  },
                ],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: safeVoiceName },
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
          { apiVersion: 'v1beta', workload: 'tts' }
        );

        return {
          ok: true,
          engine: 'gemini-tts',
          contentType: 'audio/wav',
          buffer: wavBuffer,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const explicitStatus = (err as Error & { statusCode?: number }).statusCode;
        const isQuota = isQuotaExhaustedError(msg) || explicitStatus === 429;
        return {
          ok: false,
          engine: 'gemini-tts',
          configured: true,
          isQuota,
          status: explicitStatus || (isQuota ? 429 : 502),
          error: isQuota
            ? 'Gemini TTS-এর কোটা সাময়িকভাবে পূর্ণ হয়েছে।'
            : `Gemini TTS ত্রুটি: ${msg.slice(0, 140)}`,
        };
      }
    };

    const sendSuccessAudio = (result: TtsAttemptSuccess, switchNote?: string) => {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('X-Voice-Engine', result.engine);
      if (switchNote) {
        res.setHeader('X-Voice-Note', encodeURIComponent(switchNote));
      }
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.buffer);
    };

    // Strict Single-Provider Modes (so user can test & use ElevenLabs / Noiz.ai / Gemini separately)
    if (provider === 'elevenlabs') {
      const r = await tryElevenLabs();
      if (r.ok) {
        sendSuccessAudio(r);
        return;
      }
      res.status(r.status).json({ error: r.error, engine: r.engine });
      return;
    }

    if (provider === 'noiz') {
      const r = await tryNoiz();
      if (r.ok) {
        sendSuccessAudio(r);
        return;
      }
      res.status(r.status).json({ error: r.error, engine: r.engine });
      return;
    }

    if (provider === 'gemini') {
      const r = await tryGeminiTts();
      if (r.ok) {
        sendSuccessAudio(r);
        return;
      }
      res.status(r.status).json({ error: r.error, engine: r.engine });
      return;
    }

    // Default Mode ('default'): Smart Auto-Switch across ElevenLabs -> Noiz.ai -> Gemini TTS
    const failures: TtsAttemptFailure[] = [];
    const attempts: Array<{
      engine: 'elevenlabs' | 'noiz' | 'gemini-tts';
      run: () => Promise<TtsAttemptResult>;
    }> = [
      { engine: 'elevenlabs', run: tryElevenLabs },
      { engine: 'noiz', run: tryNoiz },
      { engine: 'gemini-tts', run: tryGeminiTts },
    ];

    const nowMs = Date.now();
    for (const attempt of attempts) {
      if ((ttsAutoSkipUntil.get(attempt.engine) ?? 0) > nowMs) {
        continue;
      }
      const result = await attempt.run();
      if (result.ok) {
        ttsAutoSkipUntil.delete(result.engine);
        const failedConfigured = failures.filter((f) => f.configured);
        let note = '';
        if (failedConfigured.length > 0) {
          const prevEngineLabel =
            failedConfigured[0].engine === 'elevenlabs'
              ? 'ElevenLabs'
              : failedConfigured[0].engine === 'noiz'
                ? 'Noiz.ai'
                : 'Gemini';
          const nextEngineLabel =
            result.engine === 'elevenlabs'
              ? 'ElevenLabs'
              : result.engine === 'noiz'
                ? 'Noiz.ai'
                : 'Gemini';
          note = failedConfigured[0].isQuota
            ? `${prevEngineLabel} কোটা শেষ — স্বয়ংক্রিয়ভাবে ${nextEngineLabel}-এ সুইচ হয়েছে।`
            : `${prevEngineLabel} ব্যর্থ হওয়ায় স্বয়ংক্রিয়ভাবে ${nextEngineLabel} চলছে।`;
        }
        sendSuccessAudio(result, note || undefined);
        return;
      }
      if (result.configured && (result.isQuota || result.status === 402 || result.status === 401)) {
        ttsAutoSkipUntil.set(result.engine, Date.now() + 4 * 60 * 1000);
      }
      failures.push(result);
    }

    // If all non-skipped engines failed (or all were temporarily skipped), run any skipped configured engine as final check
    if (failures.length === 0) {
      for (const attempt of attempts) {
        const result = await attempt.run();
        if (result.ok) {
          ttsAutoSkipUntil.delete(result.engine);
          sendSuccessAudio(result);
          return;
        }
        failures.push(result);
      }
    }

    const lastConfiguredFailure =
      [...failures].reverse().find((f) => f.configured) || failures[failures.length - 1];
    res.status(lastConfiguredFailure?.status || 502).json({
      error:
        lastConfiguredFailure?.error ||
        'কোনো ভয়েস ইঞ্জিনই সাড়া দেয়নি। Settings > Secrets ও Voice ID যাচাই করুন।',
    });
  });

  const httpServer = http.createServer(app);
  const liveTranscribeWss = new WebSocketServer({ noServer: true });

  liveTranscribeWss.on('connection', async (clientWs: WebSocket) => {
    let liveSession: {
      sendRealtimeInput: (params: {
        audio?: { data: string; mimeType: string };
        audioStreamEnd?: boolean;
      }) => void;
      close: () => void;
    } | null = null;
    let closed = false;

    const closeAll = () => {
      if (closed) return;
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // ignore close error
      }
      liveSession = null;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    };

    try {
      const pairs = getAvailableKeyModelPairs(['gemini-3.5-transcribe-live'], Date.now(), {
        workload: 'live-transcribe',
        rotatePerCall: true,
      });
      if (pairs.length === 0) {
        clientWs.send(JSON.stringify({ error: 'Gemini Live key unavailable' }));
        closeAll();
        return;
      }

      let connected = false;
      let lastConnectError = '';
      const liveApiVersions: Array<string | undefined> = ['v1alpha', 'v1beta', undefined];
      for (const { apiKey, model } of pairs) {
        if (closed || connected) break;
        for (const apiVersion of liveApiVersions) {
          if (closed || connected) break;
          try {
            const ai = createAiClientForKey(apiKey, apiVersion);
            liveSession = await ai.live.connect({
              model,
              config: {
                responseModalities: [Modality.TEXT],
                inputAudioTranscription: {
                  languageCodes: [],
                },
              },
              callbacks: {
                onmessage: (message: LiveServerMessage) => {
                  if (closed || clientWs.readyState !== WebSocket.OPEN) return;
                  const content = message.serverContent;
                  if (content?.interimInputTranscription?.text) {
                    clientWs.send(
                      JSON.stringify({
                        interimTranscript: content.interimInputTranscription.text,
                      })
                    );
                  }
                  if (content?.inputTranscription?.text) {
                    clientWs.send(
                      JSON.stringify({
                        transcript: content.inputTranscription.text,
                      })
                    );
                  }
                },
                onerror: (ev: { message?: string }) => {
                  if (ev?.message && isKeyFailoverError(ev.message)) {
                    markKeyModelCooldown(apiKey, model, ev.message);
                  }
                  if (!closed && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(
                      JSON.stringify({ error: ev?.message || 'Live transcription error' })
                    );
                  }
                },
                onclose: () => {
                  closeAll();
                },
              },
            });
            connected = true;
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            lastConnectError = msg;
            if (isKeyFailoverError(msg) && !isKeyAuthFailure(msg) && !isQuotaExhaustedError(msg) && (msg.includes('404') || msg.includes('NOT_FOUND'))) {
              continue;
            }
            if (isKeyFailoverError(msg)) {
              markKeyModelCooldown(apiKey, model, msg);
              break;
            }
            throw err;
          }
        }
      }

      if (!connected || !liveSession) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({ error: lastConnectError || 'Live transcription unavailable' })
          );
        }
        closeAll();
        return;
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ ready: true }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Gemini Live transcribe connect failed:', msg.slice(0, 180));
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: msg }));
      }
      closeAll();
      return;
    }

    clientWs.on('message', (rawData) => {
      if (closed || !liveSession) return;
      try {
        const parsed = JSON.parse(rawData.toString()) as {
          audio?: string;
          flush?: boolean;
        };
        if (parsed.audio && typeof parsed.audio === 'string') {
          liveSession.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (parsed.flush) {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        }
      } catch {
        // ignore malformed ws message
      }
    });

    clientWs.on('close', closeAll);
    clientWs.on('error', closeAll);
  });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (urlPath === '/api/voice-chat/live-transcribe') {
        liveTranscribeWss.handleUpgrade(req, socket, head, (ws) => {
          liveTranscribeWss.emit('connection', ws, req);
        });
      }
    } catch {
      // ignore non-matching upgrade requests
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: {
          server: httpServer,
        },
      },
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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
