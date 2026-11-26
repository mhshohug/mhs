import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cake,
  Captions,
  Cloud,
  CloudFog,
  CloudSun,
  Image as ImageIcon,
  Images,
  LocateFixed,
  Lock,
  MapPin,
  Mic,
  Moon,
  ScrollText,
  Search,
  Sparkles,
  Sun,
  User,
  UserCheck,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AudioPlaybackSync, AudioPlayer } from './components/AudioPlayer';
import { ChirkutBox } from './components/ChirkutBox';
import { CoupleAuthModal } from './components/CoupleAuthModal';
import { NatureScenesBackdrop } from './components/NatureScenesBackdrop';
import { RainFloatingPhotos } from './components/RainFloatingPhotos';
import { ScenePicker } from './components/ScenePicker';
import { SinglePageStoryStream } from './components/SinglePageStoryStream';
import { SkySongLyrics } from './components/SkySongLyrics';
import { StormyBoyBackdrop } from './components/StormyBoyBackdrop';
import { VoiceChatMode } from './components/VoiceChatMode';
import { VoiceChatSettingsModal } from './components/VoiceChatSettingsModal';
import { VoiceVault } from './components/VoiceVault';
import { useCoupleAuth } from './contexts/CoupleAuthContext';
import {
  loadVoiceChatConfig,
  matchesWakeWord,
  saveVoiceChatConfig,
  VoiceChatConfig,
  VoiceChatServerStatus,
  VoiceProvider,
} from './lib/voiceChatConfig';
import { stormAudio } from './utils/stormAudio';
import { SCENE_CATALOG, SceneId } from './data/sceneCatalog';
import { computeBengaliPhenology } from './utils/bengaliCalendar';
import {
  getBirthdayEditionForProfile,
  resolveTodayBirthday,
} from './config/siteConfig';
import { AUTHORIZED_BOX_ID } from './lib/chirkutCrypto';
import {
  BUILTIN_PHOTOS,
  FloatingPhoto,
  loadExternalManifest,
} from './data/galleryPhotos';
import {
  checkCloudStorageConfigured,
  CloudMediaSnapshot,
  subscribeCloudMedia,
} from './lib/cloudMediaStore';
import {
  CitySearchResult,
  computeCelestialPosition,
  computeWeatherSeason,
  DEFAULT_RAJSHAHI_COORDS,
  fetchWeatherForLocation,
  formatDhakaTimeBn,
  RajshahiWeather,
  resolveCurrentLocation,
  searchCityLocations,
  toBengaliDigits,
  toBengaliText,
  WeatherLocationMode,
} from './utils/rajshahiWeather';

export default function App() {
  const { user, workspace, activeBoxId, relationshipType, authReady, workspaceLoading } =
    useCoupleAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [basePhotos, setBasePhotos] = useState<FloatingPhoto[]>(BUILTIN_PHOTOS);
  const [cloudMedia, setCloudMedia] = useState<CloudMediaSnapshot>({
    photos: [],
    voices: [],
    normalSongs: [],
    birthdaySongs: [],
    totalBytes: 0,
  });
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [requestAllPhotosView, setRequestAllPhotosView] = useState(false);
  const [showStoryStream, setShowStoryStream] = useState(false);
  const [showSongLyrics, setShowSongLyrics] = useState(false);
  const [lyricsMenuTrigger, setLyricsMenuTrigger] = useState(0);
  const lyricsLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricsLongPressPosRef = useRef<{ x: number; y: number } | null>(null);
  const lyricsLongPressTriggeredRef = useRef(false);
  const [showFloatingPhotos, setShowFloatingPhotos] = useState(false);
  const [weatherVolumePct, setWeatherVolumePct] = useState(() =>
    Math.round(stormAudio.getAmbienceVolume() * 100)
  );
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const volumePopoverRef = useRef<HTMLDivElement | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceChatConfig>(() => loadVoiceChatConfig());
  const [voiceServerStatus, setVoiceServerStatus] = useState<VoiceChatServerStatus | null>(null);
  const [isVoiceChatMode, setIsVoiceChatMode] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [wakeInitialPrompt, setWakeInitialPrompt] = useState<string | null>(null);
  const [startedByWakeWord, setStartedByWakeWord] = useState(false);
  const [playbackSync, setPlaybackSync] = useState<AudioPlaybackSync>({
    track: null,
    currentTimeSec: 0,
    durationSec: 0,
    isPlaying: false,
    hasRealFiles: false,
    bufferedPct: 0,
    isFullyLoaded: false,
  });
  const seekAudioRef = useRef<((sec: number) => void) | null>(null);
  const scrubberTrackRef = useRef<HTMLDivElement | null>(null);
  const [dragSec, setDragSec] = useState<number | null>(null);
  const [isWeatherMode, setIsWeatherMode] = useState(true);
  const [selectedScene, setSelectedScene] = useState<SceneId>(() => {
    if (typeof window === 'undefined') return 'forest';
    try {
      const saved = window.localStorage.getItem('vtr_selected_scene_v1');
      if (saved && SCENE_CATALOG.some((s) => s.id === saved)) {
        return saved as SceneId;
      }
    } catch {
      // Ignore storage access errors
    }
    return 'forest';
  });
  const [previewBengaliMonth, setPreviewBengaliMonth] = useState<number | null>(null);
  const [locationMode, setLocationMode] = useState<WeatherLocationMode>('rajshahi');
  const [customLocation, setCustomLocation] = useState<{
    latitude: number;
    longitude: number;
    labelBn: string;
    locationAccuracy?: 'gps' | 'manual' | 'ip';
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showCitySearch, setShowCitySearch] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<CitySearchResult[]>([]);
  const [isSearchingCity, setIsSearchingCity] = useState(false);

  const [weather, setWeather] = useState<RajshahiWeather>({
    mood: 'clear_day',
    isDay: true,
    temperatureC: null,
    windKmh: null,
    windGustKmh: null,
    windDirectionDeg: null,
    cloudCover: null,
    visibilityM: null,
    fogDensity: 0,
    humidityPct: null,
    rainIntensity: 0,
    hasLightning: false,
    hasThunder: false,
    sunriseDecimal: 6.35,
    sunsetDecimal: 17.35,
    descriptionBn: 'স্বাভাবিক আকাশ',
    locationMode: 'rajshahi',
    locationLabelBn: DEFAULT_RAJSHAHI_COORDS.labelBn,
    locationAccuracy: 'default',
    timezone: 'Asia/Dhaka',
    isLive: false,
    updatedAt: Date.now(),
  });

  const [now, setNow] = useState(() => new Date());
  const birthdayMatch = useMemo(
    () => resolveTodayBirthday(now, workspace, AUTHORIZED_BOX_ID),
    [now, workspace]
  );
  const isRealBirthdayToday = birthdayMatch.isBirthdayToday;
  const [previewBirthday, setPreviewBirthday] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('birthday') === 'true' || params.get('birthday') === '1';
  });

  const isBirthdayMode = isRealBirthdayToday || previewBirthday;
  const currentYear = now.getFullYear();
  const activeBirthdayName = isRealBirthdayToday
    ? birthdayMatch.birthdayPersonName
    : workspace?.partnerName?.trim() || workspace?.selfName?.trim() || 'চাঁদ';
  const birthdayEdition = useMemo(
    () =>
      getBirthdayEditionForProfile({
        year: currentYear,
        relationshipType,
        birthdayPersonName: activeBirthdayName,
      }),
    [currentYear, relationshipType, activeBirthdayName]
  );

  const fetchActiveWeather = () => {
    if (locationMode === 'current' && customLocation) {
      return fetchWeatherForLocation({
        mode: 'current',
        latitude: customLocation.latitude,
        longitude: customLocation.longitude,
        locationLabelBn: customLocation.labelBn,
        locationAccuracy: customLocation.locationAccuracy,
      });
    }
    return fetchWeatherForLocation({ mode: 'rajshahi', locationAccuracy: 'default' });
  };

  useEffect(() => {
    let mounted = true;
    loadExternalManifest().then((externalPhotos) => {
      if (mounted && externalPhotos.length > 0) {
        setBasePhotos([...externalPhotos, ...BUILTIN_PHOTOS]);
      }
    });
    checkCloudStorageConfigured().then((ok) => {
      if (mounted) setCloudConfigured(ok);
    });
    fetch('/api/voice-chat/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((status: VoiceChatServerStatus | null) => {
        if (mounted && status) setVoiceServerStatus(status);
      })
      .catch(() => {});
    fetchWeatherForLocation({ mode: 'rajshahi' }).then((liveWeather) => {
      if (mounted) {
        setWeather(liveWeather);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribeMedia = subscribeCloudMedia(
      activeBoxId,
      (snapshot) => {
        if (active) setCloudMedia(snapshot);
      },
      (err) => {
        console.warn('Cloud media sync notice:', err.message);
      }
    );
    return () => {
      active = false;
      unsubscribeMedia();
    };
  }, [activeBoxId, user?.uid]);

  const photos = useMemo<FloatingPhoto[]>(() => {
    const cloudFloating: FloatingPhoto[] = cloudMedia.photos.map((item) => ({
      id: item.id,
      src: item.url,
      title: item.title,
      dateLabel: item.dateLabel || 'ক্লাউড স্মৃতি',
      location: item.location || 'চেনা পথ',
      caption:
        item.caption ||
        'কিছু মানুষ জীবনে থেকে যায় না, তবু তাদের সঙ্গে কাটানো সময়টা স্মৃতির ভেতর থেকে যায়।',
      aspect: item.aspect || 'landscape',
      isCloud: true,
      cloudItem: item,
    }));
    return [...cloudFloating, ...basePhotos];
  }, [cloudMedia.photos, basePhotos]);

  // Keep clock/solar readout live every minute + exact midnight tick so Birthday Mode auto-triggers immediately even if app stays open
  useEffect(() => {
    const clockId = window.setInterval(() => {
      setNow(new Date());
    }, 30 * 1000);

    let midnightTimeoutId = 0;
    const scheduleMidnightTick = () => {
      const cur = new Date();
      const nextMidnight = new Date(
        cur.getFullYear(),
        cur.getMonth(),
        cur.getDate() + 1,
        0,
        0,
        1
      );
      const msUntilMidnight = Math.max(1000, nextMidnight.getTime() - cur.getTime());
      midnightTimeoutId = window.setTimeout(() => {
        setNow(new Date());
        scheduleMidnightTick();
      }, msUntilMidnight);
    };
    scheduleMidnightTick();

    return () => {
      window.clearInterval(clockId);
      window.clearTimeout(midnightTimeoutId);
    };
  }, []);

  useEffect(() => {
    if (isBirthdayMode) return;
    let active = true;
    const TWO_MINUTES_MS = 2 * 60 * 1000;
    let lastFetchedAt = weather.updatedAt;

    const refreshWeather = () => {
      lastFetchedAt = Date.now();
      fetchActiveWeather().then((liveWeather) => {
        if (active) {
          lastFetchedAt = liveWeather.updatedAt;
          setWeather(liveWeather);
        }
      });
    };

    const intervalId = window.setInterval(refreshWeather, TWO_MINUTES_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
        if (Date.now() - lastFetchedAt >= TWO_MINUTES_MS) {
          refreshWeather();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isBirthdayMode, locationMode, customLocation]);

  const handleToggleWeatherMode = () => {
    setIsWeatherMode((prev) => {
      const next = !prev;
      if (next) {
        setPreviewBirthday(false);
        const TWO_MINUTES_MS = 2 * 60 * 1000;
        if (!weather.isLive || Date.now() - weather.updatedAt >= TWO_MINUTES_MS) {
          fetchActiveWeather().then((liveWeather) => setWeather(liveWeather));
        }
      }
      return next;
    });
  };

  const handleSwitchLocation = async () => {
    setLocationError(null);
    if (locationMode === 'current') {
      setLocationMode('rajshahi');
      setShowCitySearch(false);
      const liveWeather = await fetchWeatherForLocation({ mode: 'rajshahi' });
      setWeather(liveWeather);
      return;
    }

    setIsLocating(true);
    try {
      const resolved = await resolveCurrentLocation();
      if (!resolved) {
        setLocationError('লোকেশন শনাক্ত করা যায়নি, নিচ থেকে শহর লিখে সেট করুন');
        setShowCitySearch(true);
        return;
      }

      const loc = {
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        labelBn: resolved.labelBn,
        locationAccuracy: resolved.source,
      } as const;
      setCustomLocation(loc);
      setLocationMode('current');
      setShowCitySearch(false);

      const liveWeather = await fetchWeatherForLocation({
        mode: 'current',
        latitude: loc.latitude,
        longitude: loc.longitude,
        locationLabelBn: loc.labelBn,
        locationAccuracy: loc.locationAccuracy,
      });
      setWeather(liveWeather);
    } finally {
      setIsLocating(false);
    }
  };

  const handleCitySearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (cityQuery.trim().length < 2) return;
    setIsSearchingCity(true);
    setLocationError(null);
    try {
      const results = await searchCityLocations(cityQuery);
      setCityResults(results);
      if (results.length === 0) {
        setLocationError('এই নামে কোনো শহর পাওয়া যায়নি');
      }
    } finally {
      setIsSearchingCity(false);
    }
  };

  const handleSelectCity = async (city: CitySearchResult) => {
    const label = [city.name, city.admin1, city.country].filter(Boolean).join(', ');
    const loc = {
      latitude: city.latitude,
      longitude: city.longitude,
      labelBn: label,
      locationAccuracy: 'manual' as const,
    };
    setCustomLocation(loc);
    setLocationMode('current');
    setShowCitySearch(false);
    setCityQuery('');
    setCityResults([]);
    setLocationError(null);

    const liveWeather = await fetchWeatherForLocation({
      mode: 'current',
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationLabelBn: loc.labelBn,
      locationAccuracy: 'manual',
    });
    setWeather(liveWeather);
  };

  const handleSelectScene = (sceneId: SceneId) => {
    setSelectedScene(sceneId);
    try {
      window.localStorage.setItem('vtr_selected_scene_v1', sceneId);
    } catch {
      // Ignore storage write errors
    }
    if (sceneId !== 'forest') {
      setPreviewBirthday(false);
      setIsWeatherMode(true);
      const TWO_MINUTES_MS = 2 * 60 * 1000;
      if (!weather.isLive || Date.now() - weather.updatedAt >= TWO_MINUTES_MS) {
        fetchActiveWeather().then((liveWeather) => setWeather(liveWeather));
      }
    }
  };

  const handleToggleBirthdayPreview = () => {
    setPreviewBirthday((prev) => {
      const next = !prev;
      if (next) {
        setIsWeatherMode(false);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!showVolumeControl) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (
        volumePopoverRef.current &&
        !volumePopoverRef.current.contains(event.target as Node)
      ) {
        setShowVolumeControl(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowVolumeControl(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showVolumeControl]);

  const handleChangeWeatherVolume = (nextPct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextPct)));
    setWeatherVolumePct(clamped);
    stormAudio.setAmbienceVolume(clamped / 100);
  };

  useEffect(() => {
    stormAudio.setVoiceChatSuspended(isVoiceChatMode);
  }, [isVoiceChatMode]);

  useEffect(() => {
    if (!showVoiceSettings && !isVoiceChatMode) return;
    fetch('/api/voice-chat/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((status: VoiceChatServerStatus | null) => {
        if (status) setVoiceServerStatus(status);
      })
      .catch(() => {});
  }, [showVoiceSettings, isVoiceChatMode]);

  // Passive background wake-word listening when a custom wake name is configured
  useEffect(() => {
    if (
      !voiceConfig.wakeWordStandby ||
      !voiceConfig.assistantName.trim() ||
      isVoiceChatMode ||
      typeof window === 'undefined'
    ) {
      return;
    }

    type RecCtor = new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((ev: {
        resultIndex: number;
        results: { length: number; [k: number]: { isFinal: boolean; 0?: { transcript?: string } } };
      }) => void) | null;
      onerror: ((ev: { error?: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };

    const w = window as unknown as {
      SpeechRecognition?: RecCtor;
      webkitSpeechRecognition?: RecCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    let active = true;
    let triggered = false;
    let rec: InstanceType<RecCtor> | null = null;
    let restartTimer: number | null = null;
    let cleanupGestureRetry: (() => void) | null = null;

    const armGestureRetry = () => {
      if (cleanupGestureRetry || !active || triggered) return;
      const onFirstGesture = () => {
        if (cleanupGestureRetry) {
          cleanupGestureRetry();
          cleanupGestureRetry = null;
        }
        if (active && !triggered) {
          startStandby();
        }
      };
      window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
      window.addEventListener('keydown', onFirstGesture, { once: true });
      cleanupGestureRetry = () => {
        window.removeEventListener('pointerdown', onFirstGesture);
        window.removeEventListener('keydown', onFirstGesture);
      };
    };

    const startStandby = () => {
      if (!active || triggered) return;
      try {
        rec = new Ctor();
        rec.lang = 'bn-BD';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (event) => {
          if (!active || triggered) return;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const item = event.results[i];
            const spoken = item?.[0]?.transcript || '';
            const match = matchesWakeWord(spoken, voiceConfig.assistantName);
            if (match.matched) {
              triggered = true;
              stormAudio.setVoiceChatSuspended(true);
              try {
                rec?.stop();
              } catch {
                // Ignore stop error
              }
              setStartedByWakeWord(true);
              setWakeInitialPrompt(
                item.isFinal && match.remainder.length >= 2 ? match.remainder : null
              );
              setIsVoiceChatMode(true);
              return;
            }
          }
        };

        rec.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            active = false;
          }
        };

        rec.onend = () => {
          if (active && !triggered) {
            restartTimer = window.setTimeout(startStandby, 500);
          }
        };

        rec.start();
      } catch {
        // Browser may require user gesture before SpeechRecognition starts
        armGestureRetry();
      }
    };

    startStandby();

    return () => {
      active = false;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      if (cleanupGestureRetry) {
        cleanupGestureRetry();
        cleanupGestureRetry = null;
      }
      if (rec) {
        try {
          rec.onend = null;
          rec.onresult = null;
          rec.stop();
        } catch {
          // Ignore cleanup error
        }
      }
    };
  }, [voiceConfig.wakeWordStandby, voiceConfig.assistantName, isVoiceChatMode]);

  const handleSaveVoiceConfig = (next: VoiceChatConfig) => {
    const saved = saveVoiceChatConfig(next);
    setVoiceConfig(saved);
  };

  const renderWeatherIcon = () => {
    if (weather.mood === 'clear_day') return <Sun className="h-3.5 w-3.5 text-amber-300" />;
    if (weather.mood === 'clear_night') return <Moon className="h-3.5 w-3.5 text-sky-200" />;
    if (weather.mood === 'fog') return <CloudFog className="h-3.5 w-3.5 text-slate-300" />;
    if (weather.mood === 'cloudy') return <Cloud className="h-3.5 w-3.5 text-slate-200" />;
    return <CloudSun className="h-3.5 w-3.5 text-amber-200" />;
  };

  const celestial = computeCelestialPosition(weather);
  const season = computeWeatherSeason(weather, now);
  const bengaliCalendar = computeBengaliPhenology(now, previewBengaliMonth);
  const activeCustomScene =
    isWeatherMode && !isBirthdayMode && selectedScene !== 'forest' ? selectedScene : null;

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#020408] text-[#f3efe8]">
      {!isVoiceChatMode && (
        <>
          {/* Stormy Video+Rain+Lightning | Live Weather Sky (12 Scenes) | Birthday Balloons+Fireworks */}
          {activeCustomScene ? (
            <NatureScenesBackdrop
              sceneId={activeCustomScene}
              previewBengaliMonth={previewBengaliMonth}
              weatherMood={weather.mood}
              weatherIsDay={weather.isDay}
              temperatureC={weather.temperatureC}
              windKmh={weather.windKmh}
              windGustKmh={weather.windGustKmh}
              windDirectionDeg={weather.windDirectionDeg}
              cloudCover={weather.cloudCover}
              fogDensity={weather.fogDensity}
              rainIntensity={weather.rainIntensity}
              hasLightning={weather.hasLightning}
              hasThunder={weather.hasThunder}
              sunriseDecimal={weather.sunriseDecimal}
              sunsetDecimal={weather.sunsetDecimal}
              timezone={weather.timezone}
            />
          ) : (
            <StormyBoyBackdrop
              isBirthdayMode={isBirthdayMode}
              isWeatherMode={isWeatherMode}
              accentHex={birthdayEdition.accentHex}
              secondaryHex={birthdayEdition.secondaryHex}
              weatherMood={weather.mood}
              weatherIsDay={weather.isDay}
              temperatureC={weather.temperatureC}
              windKmh={weather.windKmh}
              windGustKmh={weather.windGustKmh}
              windDirectionDeg={weather.windDirectionDeg}
              cloudCover={weather.cloudCover}
              fogDensity={weather.fogDensity}
              rainIntensity={weather.rainIntensity}
              hasLightning={weather.hasLightning}
              hasThunder={weather.hasThunder}
              sunriseDecimal={weather.sunriseDecimal}
              sunsetDecimal={weather.sunsetDecimal}
              timezone={weather.timezone}
            />
          )}

          {/* Compact Mobile-Friendly Top Bar with Logo Icons */}
          <header className="pointer-events-none relative z-40 flex h-12 items-center justify-between gap-1 px-2 sm:h-14 sm:gap-2 sm:px-6">
            <div className="pointer-events-auto flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                title={user ? 'সংযুক্ত অ্যাকাউন্ট (সাইন আউট / তথ্য)' : 'সাইন ইন / সাইন আপ'}
                aria-label={user ? 'সংযুক্ত অ্যাকাউন্ট' : 'সাইন ইন / সাইন আপ'}
                className={`relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-sky-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
                  user
                    ? 'border border-emerald-300/50 bg-emerald-400/20 text-emerald-100 shadow-[0_0_10px_rgba(52,211,153,0.22)] hover:bg-emerald-400/30'
                    : 'border border-white/15 bg-black/50 text-slate-200 hover:bg-white/15 hover:text-white'
                }`}
              >
                {user ? (
                  <UserCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                ) : (
                  <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                )}
              </button>
              {isBirthdayMode && (
                <span className="font-display truncate whitespace-nowrap text-[13px] font-semibold tracking-tight text-slate-100 drop-shadow sm:text-base">
                  আজকে তোমার জন্মদিন
                  {activeBirthdayName ? `, ${activeBirthdayName}` : ''}
                </span>
              )}
            </div>

            {/* Logo-Style Action Controls + Voice Chat Controls + Top-Right Protected Voice Box */}
            <div className="pointer-events-auto flex shrink-0 flex-nowrap items-center justify-end gap-1 sm:gap-2">
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setStartedByWakeWord(false);
                    setIsVoiceChatMode(true);
                  }}
                  title={
                    voiceConfig.assistantName.trim()
                      ? `${voiceConfig.assistantName.trim()} ভয়েস চ্যাট অন করুন`
                      : 'ভয়েস চ্যাট অন করুন'
                  }
                  aria-label={
                    voiceConfig.assistantName.trim()
                      ? `${voiceConfig.assistantName.trim()} ভয়েস চ্যাট অন করুন`
                      : 'ভয়েস চ্যাট অন করুন'
                  }
                  className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl border border-emerald-300/45 bg-emerald-400/20 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.22)] backdrop-blur-md transition-all hover:bg-emerald-400/30 focus-visible:outline-2 focus-visible:outline-emerald-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9"
                >
                  <Mic className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                </button>
              </div>


          <button
            type="button"
            onClick={() => setShowStoryStream((v) => !v)}
            title={showStoryStream ? 'স্ক্রল লেখা বন্ধ করুন' : 'স্ক্রল লেখা চালু করুন'}
            aria-label={showStoryStream ? 'স্ক্রল লেখা বন্ধ করুন' : 'স্ক্রল লেখা চালু করুন'}
            aria-pressed={showStoryStream}
            className={`relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-amber-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
              showStoryStream
                ? 'border border-amber-200/45 bg-amber-300/20 text-amber-100 shadow-[0_0_10px_rgba(251,191,36,0.2)] hover:bg-amber-300/30'
                : 'border border-white/15 bg-black/50 text-slate-400 hover:bg-white/15 hover:text-slate-200'
            }`}
          >
            <ScrollText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {!showStoryStream && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-5 w-[1.5px] rotate-45 rounded-full bg-current"
              />
            )}
          </button>

          <button
            type="button"
            data-lyrics-menu-trigger="true"
            onPointerDown={(e) => {
              if (e.button === 0 || e.pointerType === 'touch') {
                lyricsLongPressTriggeredRef.current = false;
                lyricsLongPressPosRef.current = { x: e.clientX, y: e.clientY };
                if (lyricsLongPressTimerRef.current) {
                  clearTimeout(lyricsLongPressTimerRef.current);
                }
                lyricsLongPressTimerRef.current = setTimeout(() => {
                  lyricsLongPressTimerRef.current = null;
                  lyricsLongPressTriggeredRef.current = true;
                  setShowSongLyrics(true);
                  setLyricsMenuTrigger((n) => n + 1);
                }, 450);
              }
            }}
            onPointerMove={(e) => {
              if (lyricsLongPressPosRef.current) {
                const dist = Math.hypot(
                  e.clientX - lyricsLongPressPosRef.current.x,
                  e.clientY - lyricsLongPressPosRef.current.y
                );
                if (dist > 10 && lyricsLongPressTimerRef.current) {
                  clearTimeout(lyricsLongPressTimerRef.current);
                  lyricsLongPressTimerRef.current = null;
                }
              }
            }}
            onPointerUp={() => {
              if (lyricsLongPressTimerRef.current) {
                clearTimeout(lyricsLongPressTimerRef.current);
                lyricsLongPressTimerRef.current = null;
              }
            }}
            onPointerCancel={() => {
              if (lyricsLongPressTimerRef.current) {
                clearTimeout(lyricsLongPressTimerRef.current);
                lyricsLongPressTimerRef.current = null;
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (lyricsLongPressTimerRef.current) {
                clearTimeout(lyricsLongPressTimerRef.current);
                lyricsLongPressTimerRef.current = null;
              }
              lyricsLongPressTriggeredRef.current = true;
              setShowSongLyrics(true);
              setLyricsMenuTrigger((n) => n + 1);
            }}
            onClick={() => {
              if (lyricsLongPressTimerRef.current) {
                clearTimeout(lyricsLongPressTimerRef.current);
                lyricsLongPressTimerRef.current = null;
              }
              if (lyricsLongPressTriggeredRef.current) {
                lyricsLongPressTriggeredRef.current = false;
                return;
              }
              setShowSongLyrics((v) => !v);
            }}
            title={
              showSongLyrics
                ? 'গানের লিরিক্স বন্ধ করুন (চাপ দিয়ে ধরলে মেনু)'
                : 'গানের লিরিক্স চালু করুন (চাপ দিয়ে ধরলে মেনু)'
            }
            aria-label={showSongLyrics ? 'গানের লিরিক্স বন্ধ করুন' : 'গানের লিরিক্স চালু করুন'}
            aria-pressed={showSongLyrics}
            className={`relative inline-flex h-[26px] w-[26px] shrink-0 select-none items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-amber-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
              showSongLyrics
                ? 'border border-amber-200/45 bg-amber-300/20 text-amber-100 shadow-[0_0_10px_rgba(251,191,36,0.2)] hover:bg-amber-300/30'
                : 'border border-white/15 bg-black/50 text-slate-400 hover:bg-white/15 hover:text-slate-200'
            }`}
          >
            <Captions className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {!showSongLyrics && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-5 w-[1.5px] rotate-45 rounded-full bg-current"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowFloatingPhotos((v) => !v)}
            title={showFloatingPhotos ? 'উড়ে যাওয়া ছবি বন্ধ করুন' : 'উড়ে যাওয়া ছবি চালু করুন'}
            aria-label={showFloatingPhotos ? 'উড়ে যাওয়া ছবি বন্ধ করুন' : 'উড়ে যাওয়া ছবি চালু করুন'}
            aria-pressed={showFloatingPhotos}
            className={`relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-sky-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
              showFloatingPhotos
                ? 'border border-sky-200/45 bg-sky-400/20 text-sky-100 shadow-[0_0_10px_rgba(56,189,248,0.2)] hover:bg-sky-400/30'
                : 'border border-white/15 bg-black/50 text-slate-400 hover:bg-white/15 hover:text-slate-200'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {!showFloatingPhotos && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-5 w-[1.5px] rotate-45 rounded-full bg-current"
              />
            )}
          </button>

          {!isRealBirthdayToday && (
            <button
              type="button"
              onClick={handleToggleWeatherMode}
              title={isWeatherMode && !isBirthdayMode ? 'স্বাভাবিক দৃশ্যে ফিরুন' : 'ওয়েদার মোড'}
              aria-label="ওয়েদার মোড"
              className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-sky-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
                isWeatherMode && !isBirthdayMode
                  ? 'border border-sky-300/60 bg-sky-400/25 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.28)] hover:bg-sky-400/35'
                  : 'border border-white/15 bg-black/50 text-amber-200 hover:bg-white/15'
              }`}
            >
              <CloudSun className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setRequestAllPhotosView(true)}
            title="সব ছবি দেখুন (পাসওয়ার্ড সংরক্ষিত)"
            aria-label="সব ছবি"
            className="relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/50 text-sky-200 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9"
          >
            <Images className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-900 bg-sky-300 text-[#050810] shadow"
            >
              <Lock className="h-2 w-2" />
            </span>
          </button>

          {!isRealBirthdayToday && (
            <button
              type="button"
              onClick={handleToggleBirthdayPreview}
              title={previewBirthday ? 'স্বাভাবিক দৃশ্য' : 'জন্মদিন প্রিভিউ'}
              aria-label={previewBirthday ? 'স্বাভাবিক দৃশ্য' : 'জন্মদিন প্রিভিউ'}
              className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-amber-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
                previewBirthday
                  ? 'border border-amber-300/60 bg-amber-400/25 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.28)] hover:bg-amber-400/35'
                  : 'border border-white/15 bg-black/50 text-amber-200 hover:bg-white/15'
              }`}
            >
              {previewBirthday ? (
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              ) : (
                <Cake className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              )}
            </button>
          )}

          <div ref={volumePopoverRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowVolumeControl((prev) => !prev)}
              title="আবহাওয়া ও প্রকৃতির সাউন্ড কমানো-বাড়ানো (গান চলবে)"
              aria-label="আবহাওয়া ও প্রকৃতির সাউন্ড নিয়ন্ত্রণ"
              aria-expanded={showVolumeControl}
              className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-emerald-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9 ${
                weatherVolumePct > 0
                  ? 'border border-emerald-200/40 bg-emerald-400/18 text-emerald-100 shadow-[0_0_10px_rgba(52,211,153,0.18)] hover:bg-emerald-400/28'
                  : 'border border-white/15 bg-black/50 text-slate-400 hover:bg-white/15 hover:text-slate-200'
              }`}
            >
              {weatherVolumePct === 0 ? (
                <VolumeX className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              ) : weatherVolumePct < 55 ? (
                <Volume1 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              )}
            </button>

            {showVolumeControl && (
              <div
                role="dialog"
                aria-label="আবহাওয়া ও প্রকৃতির সাউন্ড"
                className="absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl border border-white/15 bg-[#080d18]/95 p-3 text-slate-100 shadow-2xl backdrop-blur-xl"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-emerald-100/95">
                    আবহাওয়া ও প্রকৃতির সাউন্ড
                  </span>
                  <span className="font-mono-tabular text-[11px] font-semibold text-emerald-200">
                    {toBengaliDigits(weatherVolumePct)}%
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={weatherVolumePct}
                  onChange={(e) => handleChangeWeatherVolume(Number(e.target.value))}
                  aria-label="আবহাওয়া ও প্রকৃতির সাউন্ড মাত্রা"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-emerald-300"
                />

                <div className="mt-2.5 flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleChangeWeatherVolume(0)}
                    className={`flex-1 rounded-lg border px-2 py-1 text-[10.5px] font-medium transition-colors ${
                      weatherVolumePct === 0
                        ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    ০% (নীরব)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeWeatherVolume(100)}
                    className={`flex-1 rounded-lg border px-2 py-1 text-[10.5px] font-medium transition-colors ${
                      weatherVolumePct === 100
                        ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    ১০০% (ফুল)
                  </button>
                </div>

                <p className="mt-2 text-center text-[10px] text-slate-400">
                  গানের সাউন্ড আলাদাভাবে চলবে
                </p>
              </div>
            )}
          </div>

          {/* Top-Right Corner Password & Code Protected Voice Conversations Icon */}
          <VoiceVault
            cloudVoices={cloudMedia.voices}
            cloudConfigured={cloudConfigured}
            totalCloudBytes={cloudMedia.totalBytes}
            activeBoxId={activeBoxId}
            onRequireAuth={() => setShowAuthModal(true)}
          />
        </div>
      </header>

      {/* Live Weather Readout + Default Rajshahi / Current GPS Location Switch */}
      {isWeatherMode && !isBirthdayMode && (
        <div
          aria-live="polite"
          className="pointer-events-auto fixed left-2.5 top-12 z-30 flex max-w-[calc(100vw-20px)] flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-[10.5px] font-medium leading-snug text-white/95 drop-shadow-md sm:left-6 sm:top-14 sm:text-xs"
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300 animate-pulse shadow-[0_0_6px_#34d399]"
            />
            <span className="shrink-0">{renderWeatherIcon()}</span>
            <span>
              <strong className="font-semibold text-sky-100">{weather.locationLabelBn}</strong>
              {weather.locationAccuracy === 'gps' ? ' (GPS)' : weather.locationAccuracy === 'ip' ? ' (IP)' : ''}
              {' · '}
              {weather.temperatureC !== null ? `${toBengaliDigits(weather.temperatureC)}°সে · ` : ''}
              {weather.descriptionBn}
              {` · ${bengaliCalendar.formattedDateBn || season.seasonBn}`}
              {` · ${celestial.positionBn}`}
              {weather.cloudCover !== null ? ` · মেঘ ${toBengaliDigits(weather.cloudCover)}%` : ''}
              {weather.windKmh !== null
                ? ` · বাতাস ${toBengaliDigits(weather.windKmh)}${
                    weather.windGustKmh !== null && weather.windGustKmh > weather.windKmh + 4
                      ? ` (দমকা ${toBengaliDigits(weather.windGustKmh)})`
                      : ''
                  } কিমি/ঘ`
                : ''}
              {weather.fogDensity >= 0.22 && weather.visibilityM !== null
                ? ` · দৃশ্যমানতা ${toBengaliText((weather.visibilityM / 1000).toFixed(1))} কিমি`
                : ''}
              {weather.hasLightning ? ' · বজ্রপাত সক্রিয়' : ''}
              {` · লাইভ ${formatDhakaTimeBn(weather.updatedAt, weather.timezone)}`}
            </span>
          </span>

          <button
            type="button"
            onClick={handleSwitchLocation}
            disabled={isLocating}
            title={
              locationMode === 'current'
                ? 'ডিফল্ট রাজশাহী, বাংলাদেশ সেট করুন'
                : 'বর্তমান লোকেশনের আবহাওয়া দেখুন'
            }
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-medium text-sky-200 backdrop-blur-md transition-colors hover:border-sky-300/50 hover:bg-sky-400/20 disabled:opacity-60"
          >
            {locationMode === 'current' ? (
              <>
                <MapPin className="h-3 w-3 text-amber-200" />
                <span>রাজশাহী ফিরুন</span>
              </>
            ) : (
              <>
                <LocateFixed className="h-3 w-3 text-emerald-300" />
                <span>{isLocating ? 'খোঁজা হচ্ছে...' : 'কারেন্ট লোকেশন'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowCitySearch((v) => !v)}
            title="নিজের পছন্দমতো শহর খুঁজুন"
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-medium text-slate-200 backdrop-blur-md transition-colors hover:border-white/40 hover:bg-white/15"
          >
            <Search className="h-2.5 w-2.5 text-amber-200" />
            <span>শহর সেট</span>
          </button>

          {locationError && <span className="text-[10px] text-rose-300">{locationError}</span>}

          {showCitySearch && (
            <div className="mt-1 w-full max-w-xs rounded-xl border border-white/15 bg-[#090e1a]/95 p-2.5 shadow-xl backdrop-blur-md">
              <form onSubmit={handleCitySearchSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  placeholder="শহরের নাম লিখুন (যেমন: Dhaka, Sylhet)..."
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 text-[11px] text-white placeholder:text-slate-400 focus:border-sky-300/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSearchingCity}
                  className="shrink-0 rounded-lg bg-sky-400/85 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-60"
                >
                  {isSearchingCity ? '...' : 'খুঁজুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCitySearch(false)}
                  aria-label="বন্ধ করুন"
                  className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
              {cityResults.length > 0 && (
                <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto">
                  {cityResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCity(c)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[11px] text-slate-200 hover:bg-white/10"
                    >
                      <span className="truncate">
                        {c.name}
                        {c.admin1 ? `, ${c.admin1}` : ''}
                      </span>
                      <span className="ml-2 shrink-0 text-[10px] text-slate-400">{c.country}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Upper-Sky Song Lyrics across Page 1 & Page 2 */}
      <SkySongLyrics
        isVisible={showSongLyrics}
        isWeatherMode={isWeatherMode}
        isBirthdayMode={isBirthdayMode}
        playback={playbackSync}
        activeBoxId={activeBoxId}
        openMenuTrigger={lyricsMenuTrigger}
      />

      {/* Mobile-Friendly Continuous Auto-Scroll + Manual Touch/Wheel Scroll Story */}
      <main
        className={`pointer-events-none relative z-20 mx-auto flex h-[calc(100dvh-48px)] max-w-7xl items-stretch justify-center px-2.5 pb-12 sm:h-[calc(100dvh-56px)] sm:px-6 lg:justify-end lg:pb-10 ${
          isWeatherMode && !isBirthdayMode ? 'pt-24 sm:pt-14 lg:pt-0' : ''
        }`}
      >
        <SinglePageStoryStream
          isBirthdayMode={isBirthdayMode}
          isWeatherMode={isWeatherMode}
          isVisible={showStoryStream}
          edition={birthdayEdition}
          weather={weather}
          relationshipType={relationshipType}
          isAuthLoading={!authReady || workspaceLoading}
        />
      </main>

      {/* Wind-Drifting Nameless Blurred Photos + Password-Protected All-Photos Viewer */}
      <RainFloatingPhotos
        photos={photos}
        requestAllPhotosView={requestAllPhotosView}
        onCloseAllPhotosView={() => setRequestAllPhotosView(false)}
        showFloatingPhotos={showFloatingPhotos}
        cloudConfigured={cloudConfigured}
        totalCloudBytes={cloudMedia.totalBytes}
        activeBoxId={activeBoxId}
        onRequireAuth={() => setShowAuthModal(true)}
      />
        </>
      )}

      {!isVoiceChatMode && (
        <>
          {/* Independent Bottom-Left Chirkut Box & Scene Picker */}
          <div className="fixed bottom-2.5 left-2.5 z-30 flex items-center gap-1.5 sm:bottom-4 sm:left-6">
            <ChirkutBox
              activeBoxId={activeBoxId}
              onRequireAuth={() => setShowAuthModal(true)}
            />
            <ScenePicker
              selectedScene={selectedScene}
              onSelectScene={handleSelectScene}
              previewBengaliMonth={previewBengaliMonth}
              onChangePreviewMonth={setPreviewBengaliMonth}
              now={now}
            />
          </div>

          {/* Faint Thin Song Scrubber Line with Glowing Pointer (Appears only when playing) */}
          {playbackSync.isPlaying && (() => {
            const effectiveDuration = playbackSync.durationSec > 0 ? playbackSync.durationSec : 200;
            const canSeek = !playbackSync.hasRealFiles || playbackSync.isFullyLoaded;
            const displaySec = dragSec !== null ? dragSec : playbackSync.currentTimeSec;
            const playedPct = Math.min(100, Math.max(0, (displaySec / effectiveDuration) * 100));
            const bufferedPct = canSeek
              ? 100
              : Math.min(100, Math.max(0, playbackSync.bufferedPct));

            const computeSecFromClientX = (clientX: number) => {
              const el = scrubberTrackRef.current;
              if (!el) return 0;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0) return 0;
              const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
              return ratio * effectiveDuration;
            };

            return (
              <div className="fixed bottom-[54px] left-4 right-4 z-30 flex items-center sm:bottom-[64px] sm:left-12 sm:right-12">
                <div
                  ref={scrubberTrackRef}
                  role="slider"
                  tabIndex={canSeek ? 0 : -1}
                  aria-label={
                    canSeek
                      ? 'গান সামনে-পিছে টানার লাইন (সম্পূর্ণ লোড হয়েছে)'
                      : `গান লোড হচ্ছে (${bufferedPct}%)`
                  }
                  aria-valuemin={0}
                  aria-valuemax={Math.round(effectiveDuration)}
                  aria-valuenow={Math.round(displaySec)}
                  title={
                    canSeek
                      ? 'সম্পূর্ণ লোড হয়েছে — বামে বা ডানে টেনে গান শোনা যাবে'
                      : `গান লোড হচ্ছে (${bufferedPct}%) — পুরো লোড হলেই টানা যাবে`
                  }
                  onPointerDown={(e) => {
                    if (!canSeek) return;
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDragSec(computeSecFromClientX(e.clientX));
                  }}
                  onPointerMove={(e) => {
                    if (!canSeek || dragSec === null) return;
                    setDragSec(computeSecFromClientX(e.clientX));
                  }}
                  onPointerUp={(e) => {
                    if (!canSeek || dragSec === null) return;
                    const targetSec = computeSecFromClientX(e.clientX);
                    setDragSec(null);
                    setPlaybackSync((prev) => ({ ...prev, currentTimeSec: targetSec }));
                    seekAudioRef.current?.(targetSec);
                  }}
                  onPointerCancel={() => {
                    setDragSec(null);
                  }}
                  onKeyDown={(e) => {
                    if (!canSeek) return;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const next = Math.min(effectiveDuration, displaySec + 5);
                      seekAudioRef.current?.(next);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const prev = Math.max(0, displaySec - 5);
                      seekAudioRef.current?.(prev);
                    }
                  }}
                  className={`relative flex h-7 w-full touch-none select-none items-center ${
                    canSeek ? 'cursor-grab active:cursor-grabbing' : 'cursor-wait'
                  }`}
                >
                  {/* Base ultra-thin faint track */}
                  <div className="relative h-[2px] w-full overflow-hidden rounded-full bg-white/15">
                    {/* Buffer / Full-Load sweep fill */}
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ${
                        canSeek ? 'bg-sky-200/35' : 'bg-amber-300/45'
                      }`}
                      style={{ width: `${bufferedPct}%` }}
                    />
                    {/* Played progress fill */}
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${
                        canSeek ? 'bg-sky-300/80' : 'bg-amber-200/65'
                      }`}
                      style={{ width: `${playedPct}%` }}
                    />
                  </div>

                  {/* Small glowing pointer dot */}
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute rounded-full transition-transform duration-100 ${
                      dragSec !== null
                        ? 'h-3 w-3 scale-125 bg-white shadow-[0_0_14px_#38bdf8,0_0_6px_#ffffff]'
                        : canSeek
                          ? 'h-2.5 w-2.5 animate-pulse bg-emerald-300 shadow-[0_0_11px_#34d399,0_0_4px_#ffffff]'
                          : 'h-2 w-2 animate-pulse bg-amber-300/90 shadow-[0_0_8px_rgba(252,211,77,0.8)]'
                    }`}
                    style={{
                      left: `${playedPct}%`,
                      transform: 'translateX(-50%)',
                    }}
                  />
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* Automatic Folder Playlist Display (pauses cleanly when Voice Chat Mode is ON) */}
      <AudioPlayer
        isBirthdayMode={isBirthdayMode}
        isWeatherMode={isWeatherMode}
        weatherHasRain={weather.rainIntensity > 0.01}
        weatherHasThunder={weather.hasThunder}
        cloudNormalSongs={cloudMedia.normalSongs}
        cloudBirthdaySongs={cloudMedia.birthdaySongs}
        cloudConfigured={cloudConfigured}
        totalCloudBytes={cloudMedia.totalBytes}
        activeBoxId={activeBoxId}
        onRequireAuth={() => setShowAuthModal(true)}
        suspendedByVoiceChat={isVoiceChatMode}
        seekHandlerRef={seekAudioRef}
        onPlaybackSync={setPlaybackSync}
      />

      {/* Full-Screen Voice Chat Mode */}
      {isVoiceChatMode && (
        <VoiceChatMode
          config={voiceConfig}
          serverStatus={voiceServerStatus}
          initialPrompt={wakeInitialPrompt}
          startedByWakeWord={startedByWakeWord}
          onConsumeInitialPrompt={() => setWakeInitialPrompt(null)}
          onConsumeWakeTrigger={() => setStartedByWakeWord(false)}
          onUpdateConfig={handleSaveVoiceConfig}
          onOpenSettings={() => setShowVoiceSettings(true)}
          onClose={() => {
            setStartedByWakeWord(false);
            setIsVoiceChatMode(false);
          }}
        />
      )}

      {/* Voice Model Settings Modal */}
      <VoiceChatSettingsModal
        isOpen={showVoiceSettings}
        config={voiceConfig}
        serverStatus={voiceServerStatus}
        onSave={handleSaveVoiceConfig}
        onClose={() => setShowVoiceSettings(false)}
        onOpenVoiceChat={
          isVoiceChatMode
            ? undefined
            : () => {
                setStartedByWakeWord(false);
                setIsVoiceChatMode(true);
              }
        }
      />

      {/* Couple 2-Email Auth Modal */}
      <CoupleAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
