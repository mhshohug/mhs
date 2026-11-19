import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CloudLightning,
  CloudRain,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import {
  AudioTrack,
  BIRTHDAY_PLAYLIST,
  NORMAL_PLAYLIST,
} from '../config/siteConfig';
import { stormAudio } from '../utils/stormAudio';

interface AudioPlayerProps {
  isBirthdayMode: boolean;
  isWeatherMode?: boolean;
  weatherHasRain?: boolean;
  weatherHasThunder?: boolean;
}

const MELODY_SCALES: Record<AudioTrack['melodyPreset'], number[]> = {
  rain: [220.0, 261.63, 329.63, 349.23, 329.63, 293.66, 261.63, 246.94],
  nostalgia: [261.63, 293.66, 329.63, 392.0, 440.0, 392.0, 329.63, 293.66],
  starlight: [293.66, 349.23, 440.0, 523.25, 440.0, 392.0, 349.23, 329.63],
  devotion: [246.94, 293.66, 369.99, 440.0, 392.0, 369.99, 293.66, 246.94],
  birthday_chime: [
    261.63, 261.63, 293.66, 261.63, 349.23, 329.63,
    261.63, 261.63, 293.66, 261.63, 392.0, 349.23,
    261.63, 261.63, 523.25, 440.0, 349.23, 329.63, 293.66,
    466.16, 466.16, 440.0, 349.23, 392.0, 349.23,
  ],
  birthday_waltz: [329.63, 392.0, 440.0, 523.25, 493.88, 440.0, 392.0, 329.63],
};

interface ResolvedPlaylist {
  tracks: AudioTrack[];
  hasRealFiles: boolean;
}

async function resolveFolderPlaylist(isBirthdayMode: boolean): Promise<ResolvedPlaylist> {
  const folder = isBirthdayMode ? './audio/birthday' : './audio/normal';
  const fallbackList = isBirthdayMode ? BIRTHDAY_PLAYLIST : NORMAL_PLAYLIST;
  const candidateTracks: AudioTrack[] = [...fallbackList];

  // Check common extra numbered filenames inside the folder too
  const extraFiles = isBirthdayMode
    ? ['birthday-3.mp3', 'birthday-4.mp3', '1.mp3', '2.mp3', '3.mp3']
    : ['song-5.mp3', 'song-6.mp3', '1.mp3', '2.mp3', '3.mp3', '4.mp3'];

  extraFiles.forEach((file, idx) => {
    const src = `${folder}/${file}`;
    if (!candidateTracks.some((t) => t.src === src)) {
      candidateTracks.push({
        id: `extra-${isBirthdayMode ? 'bday' : 'norm'}-${idx}`,
        title: file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        subtitle: isBirthdayMode ? 'জন্মদিনের বিশেষ সুর' : 'স্বাভাবিক প্লেলিস্ট',
        src,
        melodyPreset: isBirthdayMode ? 'birthday_chime' : 'rain',
        durationSec: 200,
      });
    }
  });

  // Also load custom filenames listed in manifest.json inside public/audio/normal/ or public/audio/birthday/
  try {
    const manifestRes = await fetch(`${folder}/manifest.json`, { cache: 'no-store' });
    const ct = manifestRes.headers.get('content-type') || '';
    if (manifestRes.ok && ct.includes('application/json')) {
      const items = (await manifestRes.json()) as Array<string | { title?: string; file?: string; src?: string }>;
      if (Array.isArray(items)) {
        items.forEach((item, idx) => {
          const file = typeof item === 'string' ? item : item?.file || item?.src;
          if (!file) return;
          const src = file.startsWith('./') || file.startsWith('/') ? file : `${folder}/${file}`;
          if (!candidateTracks.some((t) => t.src === src)) {
            candidateTracks.unshift({
              id: `custom-${isBirthdayMode ? 'bday' : 'norm'}-${idx}`,
              title:
                typeof item === 'object' && item?.title
                  ? item.title
                  : file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
              subtitle: isBirthdayMode ? 'জন্মদিনের বিশেষ সুর' : 'স্বাভাবিক প্লেলিস্ট',
              src,
              melodyPreset: isBirthdayMode ? 'birthday_chime' : 'rain',
              durationSec: 200,
            });
          }
        });
      }
    }
  } catch {
    // Ignore invalid/missing manifest
  }

  const existingRealTracks: AudioTrack[] = [];
  const seenSrcs = new Set<string>();

  try {
    const mediaRes = await fetch('/api/media/list', { cache: 'no-store' });
    if (mediaRes.ok) {
      const mediaData = (await mediaRes.json()) as {
        normalAudio?: Array<{ src: string; filename: string }>;
        birthdayAudio?: Array<{ src: string; filename: string }>;
      };
      const serverTracks = isBirthdayMode ? mediaData.birthdayAudio : mediaData.normalAudio;
      if (Array.isArray(serverTracks)) {
        serverTracks.forEach((item, idx) => {
          if (!item.src || seenSrcs.has(item.src)) return;
          seenSrcs.add(item.src);
          existingRealTracks.push({
            id: `folder-audio-${isBirthdayMode ? 'bday' : 'norm'}-${idx}`,
            title: item.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
            subtitle: isBirthdayMode ? 'জন্মদিনের বিশেষ সুর' : 'স্বাভাবিক প্লেলিস্ট',
            src: item.src,
            melodyPreset: isBirthdayMode ? 'birthday_chime' : 'rain',
            durationSec: 200,
          });
        });
      }
    }
  } catch {
    // Ignore and fall back to HEAD scan
  }

  await Promise.all(
    candidateTracks.map(async (track) => {
      if (seenSrcs.has(track.src)) return;
      try {
        const res = await fetch(track.src, { method: 'HEAD' });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.startsWith('audio/')) {
          seenSrcs.add(track.src);
          existingRealTracks.push(track);
        }
      } catch {
        // File not uploaded yet
      }
    })
  );

  if (existingRealTracks.length > 0) {
    return { tracks: existingRealTracks, hasRealFiles: true };
  }

  return { tracks: fallbackList, hasRealFiles: false };
}

export function AudioPlayer({
  isBirthdayMode,
  isWeatherMode = false,
  weatherHasRain = true,
  weatherHasThunder = true,
}: AudioPlayerProps) {
  const [playlist, setPlaylist] = useState<AudioTrack[]>(() =>
    isBirthdayMode ? BIRTHDAY_PLAYLIST : NORMAL_PLAYLIST
  );
  const [hasRealFiles, setHasRealFiles] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioUnlocked, setAudioUnlocked] = useState(() => stormAudio.isUnlocked());
  const [rainMuted, setRainMuted] = useState(() => stormAudio.getRainMuted());
  const [thunderMuted, setThunderMuted] = useState(() => stormAudio.getThunderMuted());

  const toggleRain = () => {
    const next = !rainMuted;
    setRainMuted(next);
    stormAudio.setRainMuted(next);
  };

  const toggleThunder = () => {
    const next = !thunderMuted;
    setThunderMuted(next);
    stormAudio.setThunderMuted(next);
  };

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const synthTimerRef = useRef<number | null>(null);
  const noteIdxRef = useRef(0);

  // Discover real songs inside public/audio/normal or public/audio/birthday automatically
  useEffect(() => {
    let active = true;
    setTrackIndex(0);
    setElapsedSec(0);
    setIsPlaying(true);
    resolveFolderPlaylist(isBirthdayMode).then((result) => {
      if (active) {
        setPlaylist(result.tracks);
        setHasRealFiles(result.hasRealFiles);
      }
    });
    return () => {
      active = false;
    };
  }, [isBirthdayMode]);

  useEffect(() => {
    return stormAudio.onUnlockChange((unlocked) => {
      setAudioUnlocked(unlocked);
    });
  }, []);

  const currentTrack = playlist[trackIndex % playlist.length];

  const stopSynth = useCallback(() => {
    if (synthTimerRef.current !== null) {
      window.clearInterval(synthTimerRef.current);
      synthTimerRef.current = null;
    }
  }, []);

  const startSynth = useCallback(
    (track: AudioTrack) => {
      stopSynth();
      const scale = MELODY_SCALES[track.melodyPreset];
      const isBirthdayTune =
        track.melodyPreset === 'birthday_chime' || track.melodyPreset === 'birthday_waltz';
      noteIdxRef.current = 0;

      const intervalMs = track.melodyPreset === 'birthday_chime' ? 540 : 940;
      stormAudio.playMusicNote(scale[0], !isBirthdayTune);
      synthTimerRef.current = window.setInterval(() => {
        noteIdxRef.current = (noteIdxRef.current + 1) % scale.length;
        stormAudio.playMusicNote(scale[noteIdxRef.current], !isBirthdayTune);
      }, intervalMs);
    },
    [stopSynth]
  );

  const handleNext = useCallback(() => {
    setElapsedSec(0);
    setTrackIndex((prev) => (prev + 1) % playlist.length);
  }, [playlist.length]);

  const handlePrev = useCallback(() => {
    setElapsedSec(0);
    setTrackIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
  }, [playlist.length]);

  // Play / Pause / Auto-play songs strictly independently of Rain & Thunder sound
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;

    stopSynth();

    if (!isPlaying) {
      audio.pause();
      return;
    }

    let cancelled = false;

    const startPlayback = async () => {
      if (hasRealFiles) {
        if (audio.getAttribute('data-src') !== currentTrack.src) {
          audio.src = currentTrack.src;
          audio.setAttribute('data-src', currentTrack.src);
        }
        audio.volume = 0.95;
        try {
          await audio.play();
        } catch {
          // Will resume automatically when audioUnlocked updates after user gesture
        }
      } else {
        audio.pause();
        if (audioUnlocked && !cancelled) {
          startSynth(currentTrack);
        }
      }
    };

    startPlayback();

    return () => {
      cancelled = true;
      stopSynth();
    };
  }, [currentTrack, hasRealFiles, isPlaying, audioUnlocked, startSynth, stopSynth]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      if (hasRealFiles && audioElRef.current && !audioElRef.current.paused) {
        setElapsedSec(Math.floor(audioElRef.current.currentTime));
      } else if (!hasRealFiles && audioUnlocked) {
        setElapsedSec((prev) => {
          if (prev + 1 >= currentTrack.durationSec) {
            handleNext();
            return 0;
          }
          return prev + 1;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, hasRealFiles, audioUnlocked, currentTrack.durationSec, handleNext]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <aside
      aria-label="গানের প্লেয়ার"
      className="fixed bottom-2.5 right-2.5 z-40 flex max-w-[calc(100vw-20px)] flex-col items-end gap-2 sm:bottom-4 sm:right-4"
    >
      <audio ref={audioElRef} onEnded={handleNext} preload="auto" />

      {isExpanded && (
        <div className="w-68 rounded-xl border border-white/12 bg-[#080c16]/95 p-3 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
            <div>
              <p className="text-xs font-medium text-sky-200/90">
                {isBirthdayMode ? 'জন্মদিনের গানের প্লেলিস্ট' : 'সাধারণ দিনের গানের প্লেলিস্ট'}
              </p>
              <p className="text-[11px] text-slate-400">
                {isBirthdayMode ? 'আজকে তোমার জন্মদিন' : 'একটির পর একটি অটোমেটিক চলবে'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="বন্ধ করুন"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {!isBirthdayMode && !isWeatherMode && (
            <div className="mb-2.5 flex items-center gap-2 border-b border-white/10 pb-2.5">
              <button
                type="button"
                onClick={toggleRain}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  !rainMuted
                    ? 'border border-sky-400/30 bg-sky-500/20 text-sky-200'
                    : 'border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <CloudRain className="h-3.5 w-3.5 shrink-0" />
                <span>{`বৃষ্টি: ${!rainMuted ? 'চালু' : 'বন্ধ'}`}</span>
              </button>
              <button
                type="button"
                onClick={toggleThunder}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  !thunderMuted
                    ? 'border border-amber-400/30 bg-amber-500/20 text-amber-200'
                    : 'border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <CloudLightning className="h-3.5 w-3.5 shrink-0" />
                <span>{`মেঘের গর্জন: ${!thunderMuted ? 'চালু' : 'বন্ধ'}`}</span>
              </button>
            </div>
          )}

          <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {playlist.map((track, idx) => {
              const active = idx === trackIndex;
              return (
                <li key={track.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTrackIndex(idx);
                      setElapsedSec(0);
                      setIsPlaying(true);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'bg-white/12 text-white'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="truncate pr-2 font-medium">{track.title}</span>
                    <span className="font-mono-tabular shrink-0 text-[11px] text-slate-400">
                      {formatTime(track.durationSec)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex h-10 items-center gap-1.5 rounded-xl border border-white/12 bg-[#080c16]/88 px-2 shadow-xl backdrop-blur-md">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/5"
        >
          <Music className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          <div className="min-w-0 max-w-[82px] sm:max-w-[140px]">
            <p className="truncate text-[11px] font-medium text-slate-100">{currentTrack.title}</p>
            <p className="font-mono-tabular truncate text-[10px] text-slate-400">
              {formatTime(elapsedSec)} · {isBirthdayMode ? 'জন্মদিন' : 'স্বাভাবিক'}
            </p>
          </div>
          <ChevronUp
            className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        {!isBirthdayMode && !isWeatherMode && (
          <div className="flex items-center gap-1 border-l border-white/10 pl-1">
            <button
              type="button"
              onClick={toggleRain}
              title={!rainMuted ? 'বৃষ্টি বন্ধ করুন' : 'বৃষ্টি চালু করুন'}
              aria-label={!rainMuted ? 'বৃষ্টি বন্ধ করুন' : 'বৃষ্টি চালু করুন'}
              aria-pressed={!rainMuted}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                !rainMuted
                  ? 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30'
                  : 'text-slate-500 hover:bg-white/10 hover:text-slate-300'
              }`}
            >
              <CloudRain className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={toggleThunder}
              title={!thunderMuted ? 'মেঘের গর্জন বন্ধ করুন' : 'মেঘের গর্জন চালু করুন'}
              aria-label={!thunderMuted ? 'মেঘের গর্জন বন্ধ করুন' : 'মেঘের গর্জন চালু করুন'}
              aria-pressed={!thunderMuted}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                !thunderMuted
                  ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                  : 'text-slate-500 hover:bg-white/10 hover:text-slate-300'
              }`}
            >
              <CloudLightning className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-0.5 border-l border-white/10 pl-1">
          <button
            type="button"
            onClick={handlePrev}
            aria-label="আগের গান"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'গান পুশ করুন' : 'গান প্লে করুন'}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-950 transition-colors hover:bg-white"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-[0.5px]" />}
          </button>

          <button
            type="button"
            onClick={handleNext}
            aria-label="পরের গান"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
