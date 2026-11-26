import { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, MoreVertical, RefreshCw, Edit3, Trash2, Sparkles, X } from 'lucide-react';
import type { AudioPlaybackSync } from './AudioPlayer';
import {
  deleteSavedSongLyrics,
  getSavedSongLyrics,
  resolveSongLyricsDocId,
  saveSongLyricsToFirestore,
} from '../lib/songLyricsStore';
import { LyricsEditModal } from './LyricsEditModal';

interface LyricLine {
  startSec: number;
  endSec: number;
  text: string;
}

interface SongLyricsResult {
  songTitle?: string;
  artist?: string;
  instrumental?: boolean;
  sourceType: 'audio' | 'search' | 'manual';
  lines: LyricLine[];
  sources?: Array<{ title: string; uri: string }>;
}

interface SkySongLyricsProps {
  isVisible: boolean;
  isWeatherMode: boolean;
  isBirthdayMode: boolean;
  playback: AudioPlaybackSync;
  activeBoxId?: string | null;
}

const CLIENT_LYRICS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memoryLyricsCache = new Map<string, SongLyricsResult>();

function makeTrackCacheKey(src: string, title: string): string {
  return `vtr_lyrics_v3:${src}:${title.trim().toLowerCase()}`;
}

export function parseTwoLineLyrics(text: string): { original: string; translation?: string } {
  if (!text) return { original: '' };
  if (text.includes('\n')) {
    const parts = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { original: parts[0], translation: parts.slice(1).join(' · ') };
    }
    return { original: parts[0] || text };
  }
  if (text.includes(' || ')) {
    const parts = text.split(' || ').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { original: parts[0], translation: parts.slice(1).join(' · ') };
    }
  }
  return { original: text.trim() };
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
  activeBoxId = null,
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
        const saved = await getSavedSongLyrics(activeBoxId, lyricsDocId).catch(() => null);
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

        if (activeBoxId && (json.instrumental || (Array.isArray(json.lines) && json.lines.length >= 2))) {
          void saveSongLyricsToFirestore({
            boxId: activeBoxId,
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
  }, [isVisible, playback.hasRealFiles, track, trackKey, lyricsDocId, activeBoxId]);

  if (!isVisible || !playback.hasRealFiles || !track) {
    return null;
  }

  const t = playback.currentTimeSec;
  const rawLines = lyricsData?.lines ?? [];
  const trackDur = playback.durationSec > 0 ? playback.durationSec : track?.durationSec || 200;
  const lastLineEnd = rawLines[rawLines.length - 1]?.endSec || trackDur;

  // Dynamically scale timestamps if lyrics duration differs from actual audio track duration
  const scale = lastLineEnd > 10 && Math.abs(lastLineEnd - trackDur) > 3 ? trackDur / lastLineEnd : 1.0;
  const lines = rawLines.map((l) => ({
    startSec: l.startSec * scale,
    endSec: Math.max(l.startSec * scale + 1.5, l.endSec * scale),
    text: l.text,
  }));

  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (t >= line.startSec - 0.3 && t <= line.endSec + 0.5) {
      activeIndex = i;
      break;
    }
  }

  // If between lines, find the closest upcoming or recent line to prevent gaps
  if (activeIndex === -1 && lines.length > 0) {
    if (t < lines[0].startSec) {
      activeIndex = 0;
    } else if (t > lines[lines.length - 1].endSec) {
      activeIndex = lines.length - 1;
    } else {
      for (let i = 0; i < lines.length - 1; i++) {
        if (t >= lines[i].endSec && t < lines[i + 1].startSec) {
          activeIndex = t - lines[i].endSec < lines[i + 1].startSec - t ? i : i + 1;
          break;
        }
      }
    }
  }

  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isAiReloading, setIsAiReloading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Click-outside listener for dropdown menu
  useEffect(() => {
    if (!showMenu) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('touchstart', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [showMenu]);

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 0 || e.pointerType === 'touch') {
      pressStartPosRef.current = { x: e.clientX, y: e.clientY };
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        setShowMenu(true);
      }, 500);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pressStartPosRef.current) {
      const dist = Math.hypot(
        e.clientX - pressStartPosRef.current.x,
        e.clientY - pressStartPosRef.current.y
      );
      if (dist > 10) {
        cancelLongPress();
      }
    }
  };

  const handlePointerUp = () => {
    cancelLongPress();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    cancelLongPress();
    setShowMenu(true);
  };

  const handleAiReload = async () => {
    if (!track || !trackKey || !lyricsDocId || isAiReloading) return;
    setShowMenu(false);
    setIsAiReloading(true);
    setActionNotice('এআই ভুল শুধরে নতুন করে লিরিক্স তৈরি করছে...');

    try {
      removeCachedSongLyrics(track.src, track.title);

      const res = await fetch('/api/songs/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: track.title,
          subtitle: track.subtitle,
          src: track.src,
          durationSec: durationRef.current,
          forceRefresh: true,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as SongLyricsResult & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || 'নতুন লিরিক্স তৈরি করা যায়নি।');
      }

      writeCachedLyrics(trackKey, json);
      setLyricsData(json);
      setErrorText(null);

      if (activeBoxId) {
        await saveSongLyricsToFirestore({
          boxId: activeBoxId,
          lyricsId: lyricsDocId,
          fallbackTitle: track.title,
          data: json,
          overwrite: true,
        });
      }

      setActionNotice('এআই দিয়ে নতুন নিখুঁত লিরিক্স সংরক্ষিত হয়েছে!');
      setTimeout(() => setActionNotice(null), 3500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'রিলোড করতে সমস্যা হয়েছে।';
      setActionNotice(msg);
      setTimeout(() => setActionNotice(null), 4000);
    } finally {
      setIsAiReloading(false);
    }
  };

  const handleDeleteLyrics = async () => {
    if (!track || !trackKey || !lyricsDocId) return;
    const confirmed = window.confirm('আপনি কি এই গানের সংরক্ষিত লিরিক্স মুছে ফেলতে চান?');
    if (!confirmed) return;

    setShowMenu(false);
    try {
      removeCachedSongLyrics(track.src, track.title);
      setLyricsData(null);
      if (activeBoxId) {
        await deleteSavedSongLyrics(activeBoxId, lyricsDocId);
      }
      setActionNotice('সংরক্ষিত লিরিক্স মুছে ফেলা হয়েছে।');
      setTimeout(() => setActionNotice(null), 3000);
    } catch {
      setActionNotice('লিরিক্স মুছতে সমস্যা হয়েছে।');
      setTimeout(() => setActionNotice(null), 3000);
    }
  };

  const handleSaveEditedLyrics = async (
    updatedLines: Array<{ startSec: number; endSec: number; text: string }>
  ) => {
    if (!track || !trackKey || !lyricsDocId) return;
    const updatedData: SongLyricsResult = {
      songTitle: lyricsData?.songTitle || track.title,
      artist: lyricsData?.artist || track.subtitle,
      instrumental: false,
      sourceType: 'manual',
      lines: updatedLines,
    };
    writeCachedLyrics(trackKey, updatedData);
    setLyricsData(updatedData);
    if (activeBoxId) {
      await saveSongLyricsToFirestore({
        boxId: activeBoxId,
        lyricsId: lyricsDocId,
        fallbackTitle: track.title,
        data: updatedData,
        overwrite: true,
      });
    }
    setActionNotice('সংশোধিত লিরিক্স সফলভাবে সংরক্ষিত হয়েছে!');
    setTimeout(() => setActionNotice(null), 3000);
  };

  // During short pauses between lines, keep the most recently sung line softly drifting above
  let fadingPrevIndex = -1;
  if (activeIndex > 0) {
    fadingPrevIndex = activeIndex - 1;
  }

  const activeLine = activeIndex >= 0 ? lines[activeIndex] : null;
  const prevLine = fadingPrevIndex >= 0 ? lines[fadingPrevIndex] : null;
  const showIntroCue =
    !activeLine &&
    !prevLine &&
    lines.length > 0 &&
    t < lines[0].startSec - 0.5;

  const topOffsetClass =
    isWeatherMode && !isBirthdayMode
      ? 'top-[6.6rem] sm:top-[5.4rem]'
      : 'top-14 sm:top-16';

  return (
    <div
      aria-live="polite"
      onClick={() => setShowMenu((prev) => !prev)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      className={`pointer-events-auto fixed inset-x-0 ${topOffsetClass} z-[25] mx-auto flex max-w-7xl cursor-pointer justify-center px-4 sm:px-6 lg:justify-start`}
      title="ট্যাপ করুন বা চেপে ধরে রাখুন (লিরিক্স মেনু)"
    >
      <div className="relative flex w-full max-w-xl flex-col items-center text-center lg:items-start lg:text-left">
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
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={handleContextMenu}
            className="pointer-events-auto group relative flex min-h-[3.5rem] w-full cursor-pointer select-none flex-col items-center justify-end gap-1.5 lg:items-start"
            title="চাপ দিয়ে ধরে রাখুন (লিরিক্স মেনু)"
          >
            {/* 3-dots trigger button visible on hover / focus */}
            <div className="absolute -top-3 right-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 lg:left-auto lg:right-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu((prev) => !prev);
                }}
                className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 px-2 py-0.5 text-[10px] text-amber-200 backdrop-blur-md hover:bg-slate-800"
                title="লিরিক্স অপশন"
              >
                <MoreVertical className="h-3 w-3" />
                <span>মেনু</span>
              </button>
            </div>

            {prevLine && (() => {
              const parsed = parseTwoLineLyrics(prevLine.text);
              return (
                <div
                  key={`${trackKey}-prev-${fadingPrevIndex}`}
                  className="flex max-w-lg -translate-y-1 flex-col items-center gap-0.5 text-center font-display text-xs font-normal tracking-wide text-slate-200/45 transition-all duration-700 sm:text-sm lg:items-start lg:text-left [text-shadow:0_2px_10px_rgba(2,6,18,0.88)]"
                >
                  <span>{parsed.original}</span>
                  {parsed.translation && (
                    <span className="text-[11px] text-sky-200/40 sm:text-xs">
                      {parsed.translation}
                    </span>
                  )}
                </div>
              );
            })()}

            {activeLine && (() => {
              const parsed = parseTwoLineLyrics(activeLine.text);
              return (
                <div
                  key={`${trackKey}-active-${activeIndex}`}
                  className={`animate-sky-lyric-rise flex max-w-xl flex-col items-center gap-1 text-center font-display leading-tight tracking-wide lg:items-start lg:text-left ${
                    playback.isPlaying ? '' : 'credits-paused'
                  }`}
                >
                  <p className="text-base font-semibold text-amber-200 sm:text-lg [text-shadow:0_2px_14px_rgba(2,6,18,0.96),0_0_24px_rgba(245,158,11,0.35)]">
                    {parsed.original}
                  </p>
                  {parsed.translation && (
                    <p className="text-xs font-normal text-sky-300 sm:text-sm [text-shadow:0_2px_12px_rgba(2,6,18,0.94),0_0_20px_rgba(56,189,248,0.3)]">
                      {parsed.translation}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Dropdown Menu Popup */}
            {showMenu && (
              <div
                ref={menuRef}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-full z-50 mt-2 w-64 rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 text-slate-100 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-amber-200">
                      লিরিক্স অপশন
                    </p>
                    <p className="line-clamp-1 text-[10px] text-slate-400">
                      {lyricsData?.songTitle || track.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMenu(false)}
                    className="rounded p-1 text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="py-1">
                  {/* Option 1: AI Reload */}
                  <button
                    type="button"
                    onClick={handleAiReload}
                    disabled={isAiReloading}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors hover:bg-amber-400/10 hover:text-amber-200 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`mt-0.5 h-4 w-4 shrink-0 text-amber-400 ${
                        isAiReloading ? 'animate-spin' : ''
                      }`}
                    />
                    <div>
                      <span className="font-medium text-slate-100">
                        এআই দিয়ে ভুল শুধরে রিলোড
                      </span>
                      <p className="text-[10px] text-slate-400">
                        নতুন করে নিখুঁত লিরিক্স তৈরি ও সেভ করবে
                      </p>
                    </div>
                  </button>

                  {/* Option 2: Edit Lyrics */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setShowEditModal(true);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors hover:bg-sky-400/10 hover:text-sky-200"
                  >
                    <Edit3 className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                    <div>
                      <span className="font-medium text-slate-100">
                        লিরিক্স এডিট করুন
                      </span>
                      <p className="text-[10px] text-slate-400">
                        উচ্চারণ ও বাংলা অর্থ নিজের মতো পরিবর্তন
                      </p>
                    </div>
                  </button>

                  {/* Option 3: Delete Lyrics */}
                  <button
                    type="button"
                    onClick={handleDeleteLyrics}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    <div>
                      <span className="font-medium text-rose-200">
                        পূর্বের লিরিক্স ডিলিট
                      </span>
                      <p className="text-[10px] text-slate-400">
                        সংরক্ষিত লিরিক্স সম্পূর্ণ মুছে ফেলবে
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action feedback notice */}
        {actionNotice && (
          <div className="pointer-events-none mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-slate-950/90 px-3 py-1 text-[11px] font-medium text-amber-200 shadow-lg backdrop-blur-md">
            <Sparkles className="h-3 w-3 animate-pulse text-amber-300" />
            <span>{actionNotice}</span>
          </div>
        )}

        {/* Lyrics Edit Modal */}
        {showEditModal && (
          <LyricsEditModal
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            songTitle={lyricsData?.songTitle || track.title}
            initialLines={lyricsData?.lines || []}
            onSave={handleSaveEditedLyrics}
          />
        )}
      </div>
    </div>
  );
}
