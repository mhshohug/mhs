import { useEffect, useMemo, useRef, useState } from 'react';
import { BirthdayEdition } from '../config/siteConfig';
import {
  buildWeatherSyncedStory,
  extractStoryContextLines,
  GeminiEmotionalEnrichment,
  mergeGeminiEnrichedStory,
} from '../data/storyData';
import {
  computeCelestialPosition,
  formatDhakaTimeBn,
  RajshahiWeather,
} from '../utils/rajshahiWeather';

interface SinglePageStoryStreamProps {
  isBirthdayMode: boolean;
  edition: BirthdayEdition;
  weather: RajshahiWeather;
}

const CLIENT_STORY_CACHE_KEY = 'vtr_gemini_story_cache_v1';
const CLIENT_QUOTA_COOLDOWN_KEY = 'vtr_gemini_quota_cooldown_v1';
const CLIENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface StoredEnrichmentEntry {
  createdAt: number;
  data: GeminiEmotionalEnrichment;
}

function readStoredEnrichment(signature: string): GeminiEmotionalEnrichment | null {
  try {
    const raw = window.localStorage.getItem(CLIENT_STORY_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StoredEnrichmentEntry>;
    const entry = map[signature];
    if (!entry || typeof entry.createdAt !== 'number') return null;
    if (Date.now() - entry.createdAt > CLIENT_CACHE_TTL_MS) return null;
    return entry.data ?? null;
  } catch {
    return null;
  }
}

function writeStoredEnrichment(signature: string, data: GeminiEmotionalEnrichment) {
  try {
    const raw = window.localStorage.getItem(CLIENT_STORY_CACHE_KEY);
    const map: Record<string, StoredEnrichmentEntry> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    const cleaned: Record<string, StoredEnrichmentEntry> = {};
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.createdAt === 'number' && now - v.createdAt <= CLIENT_CACHE_TTL_MS)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, 11);
    for (const [k, v] of entries) {
      cleaned[k] = v;
    }
    cleaned[signature] = { createdAt: now, data };
    window.localStorage.setItem(CLIENT_STORY_CACHE_KEY, JSON.stringify(cleaned));
  } catch {
    // Ignore localStorage quota/privacy errors
  }
}

function isClientQuotaCooldownActive(): boolean {
  try {
    const raw = window.localStorage.getItem(CLIENT_QUOTA_COOLDOWN_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (Number.isFinite(until) && Date.now() < until) {
      return true;
    }
    window.localStorage.removeItem(CLIENT_QUOTA_COOLDOWN_KEY);
    return false;
  } catch {
    return false;
  }
}

function setClientQuotaCooldown(retryAfterSec?: number) {
  try {
    const boundedSec = Math.min(Math.max(Number(retryAfterSec) || 600, 120), 900);
    window.localStorage.setItem(CLIENT_QUOTA_COOLDOWN_KEY, String(Date.now() + boundedSec * 1000));
  } catch {
    // Ignore localStorage errors
  }
}

export function SinglePageStoryStream({
  isBirthdayMode,
  edition,
  weather,
}: SinglePageStoryStreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualTopRef = useRef(0);
  const manualTimeoutRef = useRef<number | null>(null);
  const isManualActiveRef = useRef(false);

  const enrichmentCacheRef = useRef<Map<string, GeminiEmotionalEnrichment>>(new Map());
  const [enrichedStory, setEnrichedStory] = useState<GeminiEmotionalEnrichment | null>(null);

  const baseWeatherStanzas = useMemo(() => buildWeatherSyncedStory(weather), [weather]);

  const weatherSignature = useMemo(() => {
    const tempBucket =
      weather.temperatureC !== null ? Math.round(weather.temperatureC / 3) * 3 : 'na';
    const cloudBucket =
      weather.cloudCover !== null ? Math.round(weather.cloudCover / 25) * 25 : 'na';
    const rainBucket =
      weather.rainIntensity > 0.02
        ? weather.rainIntensity >= 0.7
          ? 3
          : weather.rainIntensity >= 0.35
            ? 2
            : 1
        : 0;
    const windBucket = weather.windKmh !== null ? Math.round(weather.windKmh / 10) * 10 : 'na';
    return [
      weather.mood,
      weather.isDay ? 'day' : 'night',
      tempBucket,
      cloudBucket,
      rainBucket,
      windBucket,
      weather.hasLightning ? 'lt' : 'no-lt',
    ].join('|');
  }, [
    weather.mood,
    weather.isDay,
    weather.temperatureC,
    weather.cloudCover,
    weather.rainIntensity,
    weather.windKmh,
    weather.hasLightning,
  ]);

  // Fetch Gemini weather-analyzed emotional enrichment on non-birthday modes
  useEffect(() => {
    if (isBirthdayMode) {
      return;
    }

    const memCached = enrichmentCacheRef.current.get(weatherSignature);
    if (memCached) {
      setEnrichedStory(memCached);
      return;
    }

    const diskCached = readStoredEnrichment(weatherSignature);
    if (diskCached) {
      enrichmentCacheRef.current.set(weatherSignature, diskCached);
      setEnrichedStory(diskCached);
      return;
    }

    if (isClientQuotaCooldownActive()) {
      return;
    }

    // Wait for live weather before calling Gemini so startup doesn't fire both init and live requests
    const delayMs = weather.isLive ? 350 : 3500;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const celestial = computeCelestialPosition(weather);
        const contextLines = extractStoryContextLines(baseWeatherStanzas);
        const res = await fetch('/api/story/emotional-enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            weather: {
              mood: weather.mood,
              isDay: weather.isDay,
              temperatureC: weather.temperatureC,
              windKmh: weather.windKmh,
              windDirectionDeg: weather.windDirectionDeg,
              cloudCover: weather.cloudCover,
              rainIntensity: weather.rainIntensity,
              hasLightning: weather.hasLightning,
              hasThunder: weather.hasThunder,
              descriptionBn: weather.descriptionBn,
              celestialPositionBn: celestial.positionBn,
              localTimeBn: formatDhakaTimeBn(Date.now(), weather.timezone),
            },
            existingStoryContext: contextLines,
          }),
        });

        const raw = (await res.json().catch(() => ({}))) as Partial<GeminiEmotionalEnrichment> & {
          error?: string;
          quotaExhausted?: boolean;
          retryAfterSec?: number;
        };

        if (res.status === 429 || raw.quotaExhausted) {
          setClientQuotaCooldown(raw.retryAfterSec);
          return;
        }

        if (!res.ok) {
          return;
        }

        const valid: GeminiEmotionalEnrichment = {
          openingLabel: typeof raw.openingLabel === 'string' ? raw.openingLabel : '',
          openingLines: Array.isArray(raw.openingLines) ? raw.openingLines : [],
          midReflectionLines: Array.isArray(raw.midReflectionLines) ? raw.midReflectionLines : [],
          deepHeartbreakLines: Array.isArray(raw.deepHeartbreakLines)
            ? raw.deepHeartbreakLines
            : [],
          closingWhisperLines: Array.isArray(raw.closingWhisperLines)
            ? raw.closingWhisperLines
            : [],
        };

        if (
          valid.openingLines.length === 0 &&
          valid.midReflectionLines.length === 0 &&
          valid.deepHeartbreakLines.length === 0 &&
          valid.closingWhisperLines.length === 0
        ) {
          return;
        }

        enrichmentCacheRef.current.set(weatherSignature, valid);
        writeStoredEnrichment(weatherSignature, valid);
        setEnrichedStory(valid);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isBirthdayMode, weatherSignature, weather.isLive]);

  const stanzas = useMemo(() => {
    if (isBirthdayMode) return edition.stanzas;
    return mergeGeminiEnrichedStory(baseWeatherStanzas, weather, enrichedStory);
  }, [isBirthdayMode, edition.stanzas, baseWeatherStanzas, weather, enrichedStory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = 0;
      virtualTopRef.current = 0;
    }
  }, [isBirthdayMode, weather.mood]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    let animId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(64, now - lastTime);
      lastTime = now;

      if (!isManualActiveRef.current) {
        const halfHeight = el.scrollHeight / 2;
        virtualTopRef.current += (24 * dt) / 1000;

        if (halfHeight > 0 && virtualTopRef.current >= halfHeight) {
          virtualTopRef.current -= halfHeight;
        }
        el.scrollTop = virtualTopRef.current;
      }

      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(animId);
      if (manualTimeoutRef.current !== null) {
        window.clearTimeout(manualTimeoutRef.current);
      }
    };
  }, [isBirthdayMode, weather.mood]);

  const handleManualActivity = () => {
    const el = scrollRef.current;
    if (el) {
      virtualTopRef.current = el.scrollTop;
    }
    isManualActiveRef.current = true;
    if (manualTimeoutRef.current !== null) {
      window.clearTimeout(manualTimeoutRef.current);
    }
    manualTimeoutRef.current = window.setTimeout(() => {
      if (scrollRef.current) {
        virtualTopRef.current = scrollRef.current.scrollTop;
      }
      isManualActiveRef.current = false;
    }, 1200);
  };

  const renderCycleBlock = (cycleKey: string) => (
    <div key={cycleKey} className="space-y-8">
      {stanzas.map((stanza, idx) => (
        <article
          key={`${cycleKey}-${idx}`}
          className="space-y-3 px-4 py-6 sm:px-6 sm:py-8"
        >
          {stanza.label && (
            <p
              className="text-xs font-medium tracking-wider"
              style={{
                color: isBirthdayMode ? edition.accentHex : 'rgba(186, 230, 253, 0.9)',
              }}
            >
              {stanza.label}
            </p>
          )}

          {isBirthdayMode && idx === 0 && (
            <h1 className="font-display text-2xl font-bold leading-snug text-white sm:text-3xl">
              {edition.headline}
            </h1>
          )}

          {stanza.lines.map((line, lIdx) => (
            <p
              key={lIdx}
              className={
                stanza.emphasis === 'whisper'
                  ? 'font-display text-base leading-relaxed text-amber-100/95 sm:text-xl sm:leading-relaxed'
                  : stanza.emphasis === 'signature'
                  ? lIdx === 0
                    ? 'font-display pt-2 text-base font-medium text-white sm:text-lg'
                    : 'text-xs text-slate-300'
                  : 'text-[14px] leading-7 text-slate-100/95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)] sm:text-base sm:leading-8'
              }
            >
              {line}
            </p>
          ))}
        </article>
      ))}

      {/* Clear Visual End-of-Story Marker + Generous Breathing Gap Before Restarting */}
      <div className="flex flex-col items-center justify-center pt-10 pb-[42dvh] text-center">
        <div className="h-px w-24 bg-white/20" />
        <p className="mt-4 text-xs tracking-widest text-slate-400">~ সমাপ্ত ~</p>
      </div>
    </div>
  );

  return (
    <section
      aria-label="মনের কিছু কথা"
      className="pointer-events-none relative z-20 flex h-full w-full max-w-lg flex-col"
    >
      <div
        ref={scrollRef}
        onWheel={handleManualActivity}
        onTouchStart={handleManualActivity}
        onTouchMove={handleManualActivity}
        onScroll={() => {
          if (isManualActiveRef.current && scrollRef.current) {
            virtualTopRef.current = scrollRef.current.scrollTop;
          }
        }}
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%)',
          scrollbarWidth: 'none',
        }}
        className="pointer-events-auto h-full overflow-y-auto px-2 py-8 sm:px-5 [&::-webkit-scrollbar]:hidden"
      >
        {renderCycleBlock('first')}
        {renderCycleBlock('second')}
      </div>
    </section>
  );
}
