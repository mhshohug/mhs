import { useEffect, useMemo, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import type { AudioPlaybackSync } from './AudioPlayer';
import {
  getSavedSongLyrics,
  resolveSongLyricsDocId,
  saveSongLyricsToFirestore,
} from '../lib/songLyricsStore';

interface LyricLine {
  startSec: number;
  endSec: number;
  text: string;
}

interface SongLyricsResult {
  songTitle?: string;
  artist?: string;
  instrumental?: boolean;
  sourceType: 'audio' | 'search';
  lines: LyricLine[];
  sources?: Array<{ title: string; uri: string }>;
}

interface SkySongLyricsProps {
  isVisible: boolean;
  isWeatherMode: boolean;
  isBirthdayMode: boolean;
  playback: AudioPlaybackSync;
}

const CLIENT_LYRICS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memoryLyricsCache = new Map<string, SongLyricsResult>();

function makeTrackCacheKey(src: string, title: string): string {
  return `vtr_lyrics_v2:${src}:${title.trim().toLowerCase()}`;
}

export function removeCachedSongLyrics(src: string, title: string): void {
  const key = makeTrackCacheKey(src, title);
  memoryLyricsCache.delete(key);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage removal errors
  }
}

function readCachedLyrics(key: string): SongLyricsResult | null {
  const mem = memoryLyricsCache.get(key);
  if (mem) return mem;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: SongLyricsResult };
    if (
      parsed &&
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt < CLIENT_LYRICS_CACHE_TTL_MS &&
      parsed.data &&
      Array.isArray(parsed.data.lines)
    ) {
      memoryLyricsCache.set(key, parsed.data);
      return parsed.data;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function writeCachedLyrics(key: string, data: SongLyricsResult): void {
  memoryLyricsCache.set(key, data);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function SkySongLyrics({
  isVisible,
  isWeatherMode,
  isBirthdayMode,
  playback,
}: SkySongLyricsProps) {
  const track = playback.track;
  const trackKey = useMemo(
    () => (track ? makeTrackCacheKey(track.src, track.title) : ''),
    [track]
  );
  const lyricsDocId = useMemo(
    () =>
      track
        ? resolveSongLyricsDocId({
            trackId: track.id,
            isCloud: track.isCloud,
            src: track.src,
          })
        : '',
    [track]
  );

  const [lyricsData, setLyricsData] = useState<SongLyricsResult | null>(() =>
    trackKey ? readCachedLyrics(trackKey) : null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const durationRef = useRef<number>(playback.durationSec > 0 ? playback.durationSec : track?.durationSec || 200);
  durationRef.current = playback.durationSec > 0 ? playback.durationSec : track?.durationSec || 200;

  useEffect(() => {
    if (!isVisible || !playback.hasRealFiles || !track || !trackKey || !lyricsDocId) {
      return;
    }

    const cached = readCachedLyrics(trackKey);
    if (cached) {
      setLyricsData(cached);
      setIsLoading(false);
      setErrorText(null);
      return;
    }

    let cancelled = false;
    setLyricsData(null);
    setErrorText(null);
    setIsLoading(true);

    (async () => {
      try {
        const saved = await getSavedSongLyrics(lyricsDocId).catch(() => null);
        if (cancelled) return;
        if (saved) {
          const fromCloud: SongLyricsResult = {
            songTitle: saved.songTitle,
            artist: saved.artist,
            instrumental: saved.instrumental,
            sourceType: saved.sourceType,
            lines: saved.lines,
          };
          writeCachedLyrics(trackKey, fromCloud);
          setLyricsData(fromCloud);
          setErrorText(null);
          return;
        }

        const res = await fetch('/api/songs/lyrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: track.title,
            subtitle: track.subtitle,
            src: track.src,
            durationSec: durationRef.current,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as SongLyricsResult & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || 'গানের লিরিক্স পাওয়া যায়নি।');
        }
        if (cancelled) return;

        writeCachedLyrics(trackKey, json);
        setLyricsData(json);
        setErrorText(null);

        if (json.instrumental || (Array.isArray(json.lines) && json.lines.length >= 2)) {
          void saveSongLyricsToFirestore({
            lyricsId: lyricsDocId,
            fallbackTitle: track.title,
            data: json,
          }).catch(() => undefined);
        }
      } catch (err) {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : 'গানের লিরিক্স পাওয়া যায়নি।');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isVisible, playback.hasRealFiles, track, trackKey, lyricsDocId]);

  if (!isVisible || !playback.hasRealFiles || !track) {
    return null;
  }

  const t = playback.currentTimeSec;
  const lines = lyricsData?.lines ?? [];

  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (t >= line.startSec - 0.15 && t <= line.endSec + 0.35) {
      activeIndex = i;
      break;
    }
  }

  // During short pauses between lines, keep the most recently sung line softly drifting above
  let fadingPrevIndex = -1;
  if (activeIndex > 0) {
    fadingPrevIndex = activeIndex - 1;
  } else if (activeIndex === -1 && lines.length > 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (t > lines[i].endSec && t - lines[i].endSec < 5.5) {
        fadingPrevIndex = i;
        break;
      }
    }
  }

  const activeLine = activeIndex >= 0 ? lines[activeIndex] : null;
  const prevLine = fadingPrevIndex >= 0 ? lines[fadingPrevIndex] : null;
  const showIntroCue =
    !activeLine &&
    !prevLine &&
    lines.length > 0 &&
    t < lines[0].startSec;

  const topOffsetClass =
    isWeatherMode && !isBirthdayMode
      ? 'top-[6.6rem] sm:top-[5.4rem]'
      : 'top-14 sm:top-16';

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 ${topOffsetClass} z-[25] mx-auto flex max-w-7xl justify-center px-4 sm:px-6 lg:justify-start`}
    >
      <div className="flex w-full max-w-xl flex-col items-center text-center lg:items-start lg:text-left">
        {isLoading && (
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-100/80 [text-shadow:0_2px_8px_rgba(2,6,18,0.9)]">
            <Music2 className="h-3 w-3 animate-pulse text-amber-200" />
            <span>আকাশে গানের কথা সাজানো হচ্ছে...</span>
          </div>
        )}

        {!isLoading && errorText && (
          <p className="text-[11px] font-medium text-rose-200/85 [text-shadow:0_2px_8px_rgba(2,6,18,0.9)]">
            {errorText}
          </p>
        )}

        {!isLoading && !errorText && lyricsData?.instrumental && t < 8 && (
          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-100/75 [text-shadow:0_2px_8px_rgba(2,6,18,0.9)]">
            <Music2 className="h-3 w-3 text-sky-200/80" />
            <span>{track.title} · সুর ও যন্ত্রসঙ্গীত</span>
          </p>
        )}

        {!isLoading && !errorText && showIntroCue && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-100/80 transition-opacity duration-700 [text-shadow:0_2px_10px_rgba(2,6,18,0.92)]">
            <Music2 className="h-3.5 w-3.5 text-amber-200/90" />
            <span>{lyricsData?.songTitle || track.title}</span>
          </p>
        )}

        {!isLoading && !errorText && (prevLine || activeLine) && (
          <div className="relative flex min-h-[3.5rem] w-full flex-col items-center justify-end gap-1 lg:items-start">
            {prevLine && (
              <p
                key={`${trackKey}-prev-${fadingPrevIndex}`}
                className="max-w-lg -translate-y-1.5 font-display text-xs font-normal tracking-wide text-slate-200/45 transition-all duration-700 sm:text-sm [text-shadow:0_2px_10px_rgba(2,6,18,0.88)]"
              >
                {prevLine.text}
              </p>
            )}

            {activeLine && (
              <p
                key={`${trackKey}-active-${activeIndex}`}
                className={`animate-sky-lyric-rise max-w-xl font-display text-[15px] font-medium leading-relaxed tracking-wide text-amber-50/95 sm:text-lg ${
                  playback.isPlaying ? '' : 'credits-paused'
                } [text-shadow:0_2px_12px_rgba(2,6,18,0.94),0_0_24px_rgba(12,20,38,0.75)]`}
              >
                {activeLine.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
