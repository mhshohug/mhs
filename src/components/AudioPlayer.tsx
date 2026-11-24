import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudLightning,
  CloudRain,
  KeyRound,
  Music,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AudioTrack,
  BIRTHDAY_PLAYLIST,
  NORMAL_PLAYLIST,
} from '../config/siteConfig';
import {
  CloudMediaItem,
  CloudPlaylistKind,
  deleteCloudMedia,
  formatStorageBytesBn,
  uploadCloudMedia,
} from '../lib/cloudMediaStore';
import { removeCachedSongLyrics } from './SkySongLyrics';
import { stormAudio } from '../utils/stormAudio';

export interface AudioPlaybackSync {
  track: AudioTrack | null;
  currentTimeSec: number;
  durationSec: number;
  isPlaying: boolean;
  hasRealFiles: boolean;
}

interface AudioPlayerProps {
  isBirthdayMode: boolean;
  isWeatherMode?: boolean;
  weatherHasRain?: boolean;
  weatherHasThunder?: boolean;
  cloudNormalSongs?: CloudMediaItem[];
  cloudBirthdaySongs?: CloudMediaItem[];
  cloudConfigured?: boolean;
  totalCloudBytes?: number;
  suspendedByVoiceChat?: boolean;
  onPlaybackSync?: (sync: AudioPlaybackSync) => void;
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
  cloudNormalSongs = [],
  cloudBirthdaySongs = [],
  cloudConfigured = false,
  totalCloudBytes = 0,
  suspendedByVoiceChat = false,
  onPlaybackSync,
}: AudioPlayerProps) {
  const [folderPlaylist, setFolderPlaylist] = useState<ResolvedPlaylist>(() => ({
    tracks: isBirthdayMode ? BIRTHDAY_PLAYLIST : NORMAL_PLAYLIST,
    hasRealFiles: false,
  }));
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioUnlocked, setAudioUnlocked] = useState(() => stormAudio.isUnlocked());
  const [rainMuted, setRainMuted] = useState(() => stormAudio.getRainMuted());
  const [thunderMuted, setThunderMuted] = useState(() => stormAudio.getThunderMuted());

  // Song upload UI state
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [songFile, setSongFile] = useState<File | null>(null);
  const [songTitle, setSongTitle] = useState('');
  const [songSubtitle, setSongSubtitle] = useState('');
  const [songPlaylistKind, setSongPlaylistKind] = useState<CloudPlaylistKind>(() =>
    isBirthdayMode ? 'birthday' : 'normal'
  );
  const [songPin, setSongPin] = useState('');
  const [songUploadError, setSongUploadError] = useState<string | null>(null);
  const [songNotice, setSongNotice] = useState<string | null>(null);
  const [isUploadingSong, setIsUploadingSong] = useState(false);

  // Song PIN-protected delete state
  const [deleteTarget, setDeleteTarget] = useState<AudioTrack | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingSong, setIsDeletingSong] = useState(false);

  useEffect(() => {
    setSongPlaylistKind(isBirthdayMode ? 'birthday' : 'normal');
  }, [isBirthdayMode]);

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
        setFolderPlaylist(result);
      }
    });
    return () => {
      active = false;
    };
  }, [isBirthdayMode]);

  // Merge cloud songs with local real files (or replace unplayable synth placeholders when cloud songs exist)
  const { playlist, hasRealFiles } = useMemo(() => {
    const activeCloud = isBirthdayMode ? cloudBirthdaySongs : cloudNormalSongs;
    const cloudTracks: AudioTrack[] = activeCloud.map((item) => ({
      id: item.id,
      title: item.title,
      subtitle:
        item.subtitle || (isBirthdayMode ? 'জন্মদিনের বিশেষ সুর' : 'ক্লাউড প্লেলিস্ট'),
      src: item.url,
      melodyPreset: isBirthdayMode ? 'birthday_chime' : 'rain',
      durationSec: item.durationSec && item.durationSec > 0 ? item.durationSec : 210,
      isCloud: true,
      cloudItem: item,
    }));

    if (cloudTracks.length > 0) {
      const merged = folderPlaylist.hasRealFiles
        ? [...cloudTracks, ...folderPlaylist.tracks]
        : cloudTracks;
      return { playlist: merged, hasRealFiles: true };
    }

    return {
      playlist: folderPlaylist.tracks,
      hasRealFiles: folderPlaylist.hasRealFiles,
    };
  }, [isBirthdayMode, cloudBirthdaySongs, cloudNormalSongs, folderPlaylist]);

  useEffect(() => {
    if (trackIndex >= playlist.length) {
      setTrackIndex(0);
      setElapsedSec(0);
    }
  }, [playlist.length, trackIndex]);

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
    if (!audio || !currentTrack) return;

    stopSynth();

    if (!isPlaying || suspendedByVoiceChat) {
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
  }, [currentTrack, hasRealFiles, isPlaying, suspendedByVoiceChat, audioUnlocked, startSynth, stopSynth]);

  const emitPlaybackSync = useCallback(() => {
    if (!onPlaybackSync) return;
    const audio = audioElRef.current;
    const realDur =
      hasRealFiles && audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : currentTrack?.durationSec || 0;
    const currentTimeSec =
      hasRealFiles && audio && Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : elapsedSec;

    onPlaybackSync({
      track: currentTrack || null,
      currentTimeSec,
      durationSec: realDur,
      isPlaying: hasRealFiles && audio ? !audio.paused && isPlaying : isPlaying,
      hasRealFiles,
    });
  }, [onPlaybackSync, currentTrack, hasRealFiles, isPlaying, elapsedSec]);

  useEffect(() => {
    emitPlaybackSync();
  }, [emitPlaybackSync]);

  useEffect(() => {
    if (!isPlaying || suspendedByVoiceChat || !currentTrack) return;
    const timer = window.setInterval(() => {
      if (hasRealFiles && audioElRef.current && !audioElRef.current.paused) {
        setElapsedSec(Math.floor(audioElRef.current.currentTime));
        emitPlaybackSync();
      } else if (!hasRealFiles && audioUnlocked) {
        setElapsedSec((prev) => {
          if (prev + 1 >= currentTrack.durationSec) {
            handleNext();
            return 0;
          }
          return prev + 1;
        });
      }
    }, hasRealFiles ? 250 : 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, suspendedByVoiceChat, hasRealFiles, audioUnlocked, currentTrack, handleNext, emitPlaybackSync]);

  const handleSongFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSongUploadError(null);
    if (!file) {
      setSongFile(null);
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setSongUploadError('গানের ফাইল ৩০ মেগাবাইটের চেয়ে ছোট হতে হবে।');
      setSongFile(null);
      return;
    }
    setSongFile(file);
    if (!songTitle.trim()) {
      setSongTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 80));
    }
  };

  const handleSongUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isUploadingSong) return;
    if (!songFile) {
      setSongUploadError('প্রথমে একটি গানের ফাইল (MP3/M4A/WAV) বাছুন।');
      return;
    }

    setSongUploadError(null);
    setIsUploadingSong(true);
    try {
      await uploadCloudMedia({
        kind: 'song',
        fileOrBlob: songFile,
        pin: songPin,
        title: songTitle,
        subtitle: songSubtitle,
        playlistKind: songPlaylistKind,
      });

      setSongFile(null);
      setSongTitle('');
      setSongSubtitle('');
      setSongPin('');
      setShowUploadPanel(false);
      if ((songPlaylistKind === 'birthday') === isBirthdayMode) {
        setTrackIndex(0);
        setElapsedSec(0);
        setIsPlaying(true);
      }
      setSongNotice('গানটি ক্লাউডে সফলভাবে যুক্ত হয়েছে।');
      window.setTimeout(() => setSongNotice(null), 3500);
    } catch (err) {
      setSongUploadError(err instanceof Error ? err.message : 'গান আপলোড করা যায়নি।');
    } finally {
      setIsUploadingSong(false);
    }
  };

  const handleConfirmDeleteSong = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteTarget?.cloudItem || isDeletingSong) return;

    setDeleteError(null);
    setIsDeletingSong(true);
    try {
      await deleteCloudMedia({
        item: deleteTarget.cloudItem,
        pin: deletePin,
      });
      removeCachedSongLyrics(deleteTarget.src, deleteTarget.title);
      if (currentTrack?.id === deleteTarget.id && audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.removeAttribute('data-src');
        setTrackIndex(0);
        setElapsedSec(0);
      }
      setDeleteTarget(null);
      setDeletePin('');
      setSongNotice('গানটি ক্লাউড থেকে মুছে ফেলা হয়েছে।');
      window.setTimeout(() => setSongNotice(null), 3500);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'গানটি মুছে ফেলা যায়নি।');
    } finally {
      setIsDeletingSong(false);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <aside
      aria-label="গানের প্লেয়ার"
      className={
        suspendedByVoiceChat
          ? 'hidden'
          : 'fixed bottom-2.5 right-2.5 z-40 flex max-w-[calc(100vw-20px)] flex-col items-end gap-2 sm:bottom-4 sm:right-4'
      }
    >
      <audio
        ref={audioElRef}
        onEnded={handleNext}
        onTimeUpdate={emitPlaybackSync}
        onLoadedMetadata={emitPlaybackSync}
        onPlay={emitPlaybackSync}
        onPause={emitPlaybackSync}
        preload="auto"
      />

      {isExpanded && (
        <div className="w-76 max-w-[calc(100vw-20px)] rounded-xl border border-white/12 bg-[#080c16]/95 p-3 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-sky-200/90">
                {isBirthdayMode ? 'জন্মদিনের গানের প্লেলিস্ট' : 'সাধারণ দিনের গানের প্লেলিস্ট'}
              </p>
              <p className="truncate text-[11px] text-slate-400">
                {totalCloudBytes > 0
                  ? `ক্লাউড: ${formatStorageBytesBn(totalCloudBytes)}`
                  : isBirthdayMode
                    ? 'আজকে তোমার জন্মদিন'
                    : 'একটির পর একটি অটোমেটিক চলবে'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setShowUploadPanel((v) => !v);
                  setSongUploadError(null);
                  setDeleteTarget(null);
                }}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                  showUploadPanel
                    ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                    : 'border-white/15 bg-white/5 text-sky-200 hover:bg-white/10'
                }`}
              >
                <Plus className="h-3 w-3" />
                <span>{showUploadPanel ? 'তালিকা' : 'গান যোগ'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="বন্ধ করুন"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
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

          {songNotice && (
            <div className="mb-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] text-emerald-200">
              {songNotice}
            </div>
          )}

          {showUploadPanel ? (
            <form onSubmit={handleSongUploadSubmit} className="space-y-2.5">
              {!cloudConfigured && (
                <div className="rounded-lg border border-amber-300/25 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-200">
                  গান ক্লাউডে সেভ করতে AI Studio-র Settings &gt; Secrets-এ Cloudinary কী দিন।
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ['normal', 'সাধারণ প্লেলিস্ট'],
                  ['birthday', 'জন্মদিনের প্লেলিস্ট'],
                ] as const).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setSongPlaylistKind(kind)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      songPlaylistKind === kind
                        ? 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                        : 'border-white/10 bg-black/30 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 bg-black/40 px-3 py-2 text-xs text-slate-200 hover:border-sky-300/60">
                <Upload className="h-3.5 w-3.5 text-sky-300" />
                <span className="truncate">
                  {songFile ? songFile.name : 'অডিও ফাইল বাছুন (MP3/M4A/WAV)'}
                </span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleSongFileChange}
                  className="hidden"
                />
              </label>

              <input
                type="text"
                maxLength={120}
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                placeholder="গানের নাম..."
                className="w-full rounded-lg border border-white/15 bg-black/45 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/60 focus:outline-none"
              />

              <input
                type="text"
                maxLength={120}
                value={songSubtitle}
                onChange={(e) => setSongSubtitle(e.target.value)}
                placeholder="শিল্পী বা ছোট কথা (ঐচ্ছিক)..."
                className="w-full rounded-lg border border-white/15 bg-black/45 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/60 focus:outline-none"
              />

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-amber-200/80" />
                  <input
                    type="password"
                    inputMode="numeric"
                    value={songPin}
                    onChange={(e) => {
                      setSongPin(e.target.value);
                      if (songUploadError) setSongUploadError(null);
                    }}
                    placeholder="৪ সংখ্যার পিন..."
                    className="w-full rounded-lg border border-white/15 bg-black/50 py-1.5 pl-7 pr-2.5 text-xs text-white placeholder:text-slate-500 focus:border-amber-200/70 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isUploadingSong}
                  className="shrink-0 rounded-lg bg-sky-300 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-200 disabled:opacity-60"
                >
                  {isUploadingSong ? 'আপলোড...' : 'সংরক্ষণ'}
                </button>
              </div>

              {songUploadError && <p className="text-[11px] text-rose-400">{songUploadError}</p>}
            </form>
          ) : (
            <div className="space-y-2">
              {deleteTarget && (
                <form
                  onSubmit={handleConfirmDeleteSong}
                  className="space-y-2 rounded-lg border border-rose-400/35 bg-rose-950/35 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-rose-100">
                      মুছবেন: {deleteTarget.title}?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteTarget(null);
                        setDeletePin('');
                        setDeleteError(null);
                      }}
                      className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      inputMode="numeric"
                      autoFocus
                      value={deletePin}
                      onChange={(e) => {
                        setDeletePin(e.target.value);
                        if (deleteError) setDeleteError(null);
                      }}
                      placeholder="ডিলিট পিন..."
                      className="min-w-0 flex-1 rounded-md border border-rose-300/30 bg-black/50 px-2.5 py-1 text-[11px] text-white placeholder:text-slate-500 focus:border-rose-300 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isDeletingSong}
                      className="shrink-0 rounded-md bg-rose-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
                    >
                      {isDeletingSong ? '...' : 'মুছুন'}
                    </button>
                  </div>
                  {deleteError && <p className="text-[10.5px] text-rose-300">{deleteError}</p>}
                </form>
              )}

              <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {playlist.map((track, idx) => {
                  const active = idx === trackIndex;
                  return (
                    <li key={track.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setTrackIndex(idx);
                          setElapsedSec(0);
                          setIsPlaying(true);
                        }}
                        className={`flex min-w-0 flex-1 items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                          active
                            ? 'bg-white/12 text-white'
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 pr-2">
                          {track.isCloud && <Cloud className="h-3 w-3 shrink-0 text-sky-300/80" />}
                          <span className="truncate font-medium">{track.title}</span>
                        </span>
                        <span className="font-mono-tabular shrink-0 text-[11px] text-slate-400">
                          {formatTime(track.durationSec)}
                        </span>
                      </button>

                      {track.isCloud && track.cloudItem && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(track);
                            setDeletePin('');
                            setDeleteError(null);
                          }}
                          title="গানটি মুছুন"
                          aria-label={`${track.title} মুছুন`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-300/20 bg-rose-500/10 text-rose-200 transition-colors hover:bg-rose-500 hover:text-white"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
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
            <p className="truncate text-[11px] font-medium text-slate-100">{currentTrack?.title || 'গান'}</p>
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
