import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { BirthdayEdition } from '../config/siteConfig';
import {
  AiDesignedStanza,
  buildAiOnlyWeatherStanzas,
  buildWeatherSyncedStory,
  extractStoryContextLines,
  GeminiEmotionalEnrichment,
} from '../data/storyData';
import {
  computeCelestialPosition,
  RajshahiWeather,
} from '../utils/rajshahiWeather';

interface SinglePageStoryStreamProps {
  isBirthdayMode: boolean;
  isWeatherMode: boolean;
  isVisible?: boolean;
  edition: BirthdayEdition;
  weather: RajshahiWeather;
}

const CLIENT_STORY_CACHE_KEY = 'vtr_gemini_story_cache_v4';
const CLIENT_ACTIVE_STORY_KEY = 'vtr_gemini_active_story_30m_v4';
const CLIENT_QUOTA_COOLDOWN_KEY = 'vtr_gemini_quota_cooldown_v1';
const CLIENT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredEnrichmentEntry {
  createdAt: number;
  data: GeminiEmotionalEnrichment;
}

function readActive30mStory(): GeminiEmotionalEnrichment | null {
  try {
    const raw = window.localStorage.getItem(CLIENT_ACTIVE_STORY_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as StoredEnrichmentEntry;
    if (!entry || typeof entry.createdAt !== 'number' || !entry.data) return null;
    if (Date.now() - entry.createdAt >= CLIENT_CACHE_TTL_MS) {
      window.localStorage.removeItem(CLIENT_ACTIVE_STORY_KEY);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writeActive30mStory(data: GeminiEmotionalEnrichment) {
  try {
    const payload: StoredEnrichmentEntry = { createdAt: Date.now(), data };
    window.localStorage.setItem(CLIENT_ACTIVE_STORY_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota/privacy errors
  }
}

function readStoredEnrichment(signature: string): GeminiEmotionalEnrichment | null {
  try {
    const raw = window.localStorage.getItem(CLIENT_STORY_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StoredEnrichmentEntry>;
    const entry = map[signature];
    if (!entry || typeof entry.createdAt !== 'number') return null;
    if (Date.now() - entry.createdAt >= CLIENT_CACHE_TTL_MS) return null;
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
      .filter(([, v]) => v && typeof v.createdAt === 'number' && now - v.createdAt < CLIENT_CACHE_TTL_MS)
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

function clearClientQuotaCooldown() {
  try {
    window.localStorage.removeItem(CLIENT_QUOTA_COOLDOWN_KEY);
  } catch {
    // Ignore
  }
}

function getLocalHourDecimal(timezone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Dhaka',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h + m / 60;
  } catch {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
}

function getTimeFeelBn(weather: RajshahiWeather): string {
  const hourDec = getLocalHourDecimal(weather.timezone);
  const sunrise = weather.sunriseDecimal ?? 6;
  const sunset = weather.sunsetDecimal ?? 18;

  if (hourDec >= sunrise - 0.8 && hourDec < sunrise + 0.7) return 'ভোরের আলো';
  if (hourDec >= sunrise + 0.7 && hourDec < 11.5) return 'সকাল';
  if (hourDec >= 11.5 && hourDec < 15.2) return 'দুপুর';
  if (hourDec >= 15.2 && hourDec < sunset - 0.7) return 'বিকেল';
  if (hourDec >= sunset - 0.7 && hourDec < sunset + 0.45) return 'গোধূলি';
  if (hourDec >= sunset + 0.45 && hourDec < 20.5) return 'সন্ধ্যা';
  if (hourDec >= 20.5 && hourDec < 23.5) return 'রাত';
  return 'গভীর নিস্তব্ধ রাত';
}

export function SinglePageStoryStream({
  isBirthdayMode,
  isWeatherMode,
  isVisible = true,
  edition,
  weather,
}: SinglePageStoryStreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualTopRef = useRef(0);
  const manualTimeoutRef = useRef<number | null>(null);
  const isManualActiveRef = useRef(false);

  const enrichmentCacheRef = useRef<Map<string, GeminiEmotionalEnrichment>>(new Map());
  const [enrichedStory, setEnrichedStory] = useState<GeminiEmotionalEnrichment | null>(() =>
    readActive30mStory()
  );
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<'quota' | 'error' | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const baseWeatherStanzas = useMemo(() => buildWeatherSyncedStory(weather), [weather]);
  const celestial = useMemo(() => computeCelestialPosition(weather), [weather]);
  const timeFeelBn = useMemo(() => getTimeFeelBn(weather), [weather]);

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
      timeFeelBn,
      tempBucket,
      cloudBucket,
      rainBucket,
      windBucket,
      weather.hasLightning ? 'lt' : 'no-lt',
    ].join('|');
  }, [
    weather.mood,
    timeFeelBn,
    weather.temperatureC,
    weather.cloudCover,
    weather.rainIntensity,
    weather.windKmh,
    weather.hasLightning,
  ]);

  // Fetch Gemini AI emotional story strictly for Weather Mode (valid for 30 minutes)
  useEffect(() => {
    if (isBirthdayMode || !isWeatherMode) {
      return;
    }

    setAiError(null);

    const active30m = readActive30mStory();
    if (active30m) {
      enrichmentCacheRef.current.set(weatherSignature, active30m);
      setEnrichedStory(active30m);
      setIsLoadingAi(false);
      return;
    }

    const memCached = enrichmentCacheRef.current.get(weatherSignature);
    if (memCached) {
      writeActive30mStory(memCached);
      setEnrichedStory(memCached);
      setIsLoadingAi(false);
      return;
    }

    const diskCached = readStoredEnrichment(weatherSignature);
    if (diskCached) {
      enrichmentCacheRef.current.set(weatherSignature, diskCached);
      writeActive30mStory(diskCached);
      setEnrichedStory(diskCached);
      setIsLoadingAi(false);
      return;
    }

    if (isClientQuotaCooldownActive()) {
      setEnrichedStory(null);
      setIsLoadingAi(false);
      setAiError('quota');
      return;
    }

    setEnrichedStory(null);
    setIsLoadingAi(true);

    const delayMs = weather.isLive ? 0 : 400;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
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
              timeFeelBn,
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
          setIsLoadingAi(false);
          setAiError('quota');
          return;
        }

        if (!res.ok) {
          setIsLoadingAi(false);
          setAiError('error');
          return;
        }

        const valid: GeminiEmotionalEnrichment = {
          openingLabel: '',
          openingLines: Array.isArray(raw.openingLines) ? raw.openingLines : [],
          skyCoupletLines: Array.isArray(raw.skyCoupletLines) ? raw.skyCoupletLines : [],
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
          valid.skyCoupletLines?.length === 0 &&
          valid.deepHeartbreakLines.length === 0 &&
          valid.closingWhisperLines.length === 0
        ) {
          setIsLoadingAi(false);
          setAiError('error');
          return;
        }

        enrichmentCacheRef.current.set(weatherSignature, valid);
        writeStoredEnrichment(weatherSignature, valid);
        writeActive30mStory(valid);
        setEnrichedStory(valid);
        setIsLoadingAi(false);
        setAiError(null);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setIsLoadingAi(false);
        setAiError('error');
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isBirthdayMode, isWeatherMode, weatherSignature, weather.isLive, retryTrigger]);

  const aiWeatherCards = useMemo(() => {
    if (isBirthdayMode || !isWeatherMode) return [];
    return buildAiOnlyWeatherStanzas(weather, enrichedStory);
  }, [isBirthdayMode, isWeatherMode, weather, enrichedStory]);

  const stanzas = useMemo(() => {
    if (isBirthdayMode) return edition.stanzas;
    return baseWeatherStanzas;
  }, [isBirthdayMode, edition.stanzas, baseWeatherStanzas]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = 0;
      virtualTopRef.current = 0;
    }
  }, [isBirthdayMode, isWeatherMode, weatherSignature, aiWeatherCards.length]);

  useEffect(() => {
    if (!isVisible) return;
    if (!isBirthdayMode && isWeatherMode && aiWeatherCards.length === 0) return;

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
  }, [isVisible, isBirthdayMode, isWeatherMode, weather.mood, aiWeatherCards.length]);

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

  if (!isVisible) {
    return null;
  }

  // Pure floating typography directly over the sky & forest (no boxes, no borders, no backdrop cards)
  const renderAiCard = (card: AiDesignedStanza, key: string) => {
    switch (card.variant) {
      case 'sky_frame':
        return (
          <article key={key} className="px-4 py-4 sm:px-6 sm:py-5">
            {card.lines.map((line, idx) => (
              <p
                key={idx}
                className="font-display text-[15.5px] leading-relaxed text-[#f1f3f5] drop-shadow-[0_2px_10px_rgba(0,0,0,0.92)] sm:text-[18px] sm:leading-8"
              >
                {line}
              </p>
            ))}
          </article>
        );

      case 'poetic_couplet':
        return (
          <article key={key} className="mx-auto max-w-sm px-4 py-4 text-center sm:py-5">
            <div className="space-y-1.5">
              {card.lines.map((line, idx) => (
                <p
                  key={idx}
                  className="font-display text-[16.5px] leading-8 text-amber-50/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.92)] sm:text-[19px] sm:leading-9"
                >
                  {line}
                </p>
              ))}
            </div>
          </article>
        );

      case 'letter_sheet':
      case 'nocturne_plaque':
        return (
          <article key={key} className="px-4 py-4 sm:px-6 sm:py-5">
            {card.lines.map((line, idx) => (
              <p
                key={idx}
                className="text-[14.5px] leading-7 text-slate-100/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.92)] sm:text-[16px] sm:leading-8"
              >
                {line}
              </p>
            ))}
          </article>
        );

      case 'whisper_finale':
      default:
        return (
          <article key={key} className="mx-auto max-w-md px-4 py-4 text-center sm:py-5">
            {card.lines.map((line, idx) => (
              <p
                key={idx}
                className="font-display text-[15.5px] leading-relaxed text-amber-100/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.92)] sm:text-[18px] sm:leading-relaxed"
              >
                {line}
              </p>
            ))}
          </article>
        );
    }
  };

  const renderAiCycleBlock = (cycleKey: string) => (
    <div key={cycleKey} className="space-y-6 pb-[40dvh] pt-4">
      {aiWeatherCards.map((card, idx) => renderAiCard(card, `${cycleKey}-ai-${idx}`))}
    </div>
  );

  const renderNormalCycleBlock = (cycleKey: string) => (
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

  // Weather Mode: discreet corner icon while AI writes; unobstructed floating light-ash cards when ready
  if (!isBirthdayMode && isWeatherMode) {
    return (
      <section
        aria-label="আবহাওয়ার সাথে এআই-এর লেখা"
        className="pointer-events-none relative z-20 flex h-full w-full max-w-lg flex-col"
      >
        {aiWeatherCards.length > 0 ? (
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
            {renderAiCycleBlock('first')}
            {renderAiCycleBlock('second')}
          </div>
        ) : (
          <div className="pointer-events-none fixed bottom-20 right-3 z-30 sm:bottom-20 sm:right-6">
            {isLoadingAi || !aiError ? (
              <span
                title="এআই লিখছে..."
                aria-label="এআই লিখছে"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-zinc-300/20 text-white/90 backdrop-blur-md shadow-sm"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  clearClientQuotaCooldown();
                  setAiError(null);
                  setRetryTrigger((n) => n + 1);
                }}
                title={
                  aiError === 'quota'
                    ? 'এআই কোটা পূর্ণ — আবার চেষ্টা করতে ক্লিক করুন'
                    : 'আবার চেষ্টা করুন'
                }
                aria-label="এআই লেখা আবার চেষ্টা করুন"
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-zinc-300/20 text-white/90 backdrop-blur-md transition-colors hover:bg-zinc-300/35"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

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
        {renderNormalCycleBlock('first')}
        {renderNormalCycleBlock('second')}
      </div>
    </section>
  );
}
