import { useEffect, useRef } from 'react';
import { BirthdayEdition } from '../config/siteConfig';
import { buildWeatherSyncedStory } from '../data/storyData';
import { RajshahiWeather } from '../utils/rajshahiWeather';

interface SinglePageStoryStreamProps {
  isBirthdayMode: boolean;
  edition: BirthdayEdition;
  weather: RajshahiWeather;
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

  const stanzas = isBirthdayMode ? edition.stanzas : buildWeatherSyncedStory(weather);

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
