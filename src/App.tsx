import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Cake,
  Cloud,
  CloudFog,
  CloudSun,
  Image as ImageIcon,
  Images,
  LocateFixed,
  Lock,
  MapPin,
  Moon,
  ScrollText,
  Search,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { AudioPlayer } from './components/AudioPlayer';
import { ChirkutBox } from './components/ChirkutBox';
import { NatureScenesBackdrop } from './components/NatureScenesBackdrop';
import { RainFloatingPhotos } from './components/RainFloatingPhotos';
import { ScenePicker } from './components/ScenePicker';
import { SinglePageStoryStream } from './components/SinglePageStoryStream';
import { StormyBoyBackdrop } from './components/StormyBoyBackdrop';
import { VoiceVault } from './components/VoiceVault';
import { SCENE_CATALOG, SceneId } from './data/sceneCatalog';
import { computeBengaliPhenology } from './utils/bengaliCalendar';
import {
  checkIsBirthday,
  getBirthdayEditionForYear,
} from './config/siteConfig';
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
  const [showStoryStream, setShowStoryStream] = useState(true);
  const [showFloatingPhotos, setShowFloatingPhotos] = useState(true);
  const [isWeatherMode, setIsWeatherMode] = useState(false);
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
  const isRealBirthdayToday = checkIsBirthday(now);
  const [previewBirthday, setPreviewBirthday] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('birthday') === 'true' || params.get('birthday') === '1';
  });

  const isBirthdayMode = isRealBirthdayToday || previewBirthday;
  const currentYear = now.getFullYear();
  const birthdayEdition = getBirthdayEditionForYear(currentYear);

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
    fetchWeatherForLocation({ mode: 'rajshahi' }).then((liveWeather) => {
      if (mounted) {
        setWeather(liveWeather);
      }
    });
    const unsubscribeMedia = subscribeCloudMedia(
      (snapshot) => {
        if (mounted) setCloudMedia(snapshot);
      },
      (err) => {
        console.warn('Cloud media sync notice:', err.message);
      }
    );
    return () => {
      mounted = false;
      unsubscribeMedia();
    };
  }, []);

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

  // Keep clock/solar readout live every minute and poll real-time weather every 2 minutes
  useEffect(() => {
    const clockId = window.setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => window.clearInterval(clockId);
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
      <header className="pointer-events-none relative z-40 flex h-12 items-center justify-between gap-2 px-2.5 sm:h-14 sm:px-6">
        <div className="pointer-events-auto flex min-w-0 items-baseline gap-2">
          <span className="font-display truncate whitespace-nowrap text-[14px] font-semibold tracking-tight text-slate-100 drop-shadow sm:text-base">
            {isBirthdayMode ? 'আজকে তোমার জন্মদিন' : 'ভালো থেকো, রুপো'}
          </span>
        </div>

        {/* Logo-Style Action Controls + Top-Right Protected Voice Box */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setShowStoryStream((v) => !v)}
            title={showStoryStream ? 'স্ক্রল লেখা বন্ধ করুন' : 'স্ক্রল লেখা চালু করুন'}
            aria-label={showStoryStream ? 'স্ক্রল লেখা বন্ধ করুন' : 'স্ক্রল লেখা চালু করুন'}
            aria-pressed={showStoryStream}
            className={`relative inline-flex h-8 w-8 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-amber-300 sm:h-9 sm:w-9 ${
              showStoryStream
                ? 'border border-amber-200/45 bg-amber-300/20 text-amber-100 shadow-[0_0_10px_rgba(251,191,36,0.2)] hover:bg-amber-300/30'
                : 'border border-white/15 bg-black/50 text-slate-400 hover:bg-white/15 hover:text-slate-200'
            }`}
          >
            <ScrollText className="h-4 w-4" />
            {!showStoryStream && (
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
            className={`relative inline-flex h-8 w-8 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-sky-300 sm:h-9 sm:w-9 ${
              showFloatingPhotos
                ? 'border border-sky-200/45 bg-sky-400/20 text-sky-100 shadow-[0_0_10px_rgba(56,189,248,0.2)] hover:bg-sky-400/30'
                : 'border border-white/15 bg-black/50 text-slate-400 hover:bg-white/15 hover:text-slate-200'
            }`}
          >
            <ImageIcon className="h-4 w-4" />
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
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-sky-300 sm:h-9 sm:w-9 ${
                isWeatherMode && !isBirthdayMode
                  ? 'border border-sky-300/60 bg-sky-400/25 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.28)] hover:bg-sky-400/35'
                  : 'border border-white/15 bg-black/50 text-amber-200 hover:bg-white/15'
              }`}
            >
              <CloudSun className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setRequestAllPhotosView(true)}
            title="সব ছবি দেখুন (পাসওয়ার্ড সংরক্ষিত)"
            aria-label="সব ছবি"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-black/50 text-sky-200 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 sm:h-9 sm:w-9"
          >
            <Images className="h-4 w-4" />
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
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-amber-300 sm:h-9 sm:w-9 ${
                previewBirthday
                  ? 'border border-amber-300/60 bg-amber-400/25 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.28)] hover:bg-amber-400/35'
                  : 'border border-white/15 bg-black/50 text-amber-200 hover:bg-white/15'
              }`}
            >
              {previewBirthday ? <Sparkles className="h-4 w-4" /> : <Cake className="h-4 w-4" />}
            </button>
          )}

          {/* Top-Right Corner Password & Code Protected Voice Conversations Icon */}
          <VoiceVault
            cloudVoices={cloudMedia.voices}
            cloudConfigured={cloudConfigured}
            totalCloudBytes={cloudMedia.totalBytes}
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
      />

      {/* PIN-Protected Envelope Note Box (Icon Only) + 12-Scene & Season Picker */}
      <ChirkutBox />
      <ScenePicker
        selectedScene={selectedScene}
        onSelectScene={handleSelectScene}
        previewBengaliMonth={previewBengaliMonth}
        onChangePreviewMonth={setPreviewBengaliMonth}
        now={now}
      />

      {/* Automatic Folder Playlist Display */}
      <AudioPlayer
        isBirthdayMode={isBirthdayMode}
        isWeatherMode={isWeatherMode}
        weatherHasRain={weather.rainIntensity > 0.01}
        weatherHasThunder={weather.hasThunder}
        cloudNormalSongs={cloudMedia.normalSongs}
        cloudBirthdaySongs={cloudMedia.birthdaySongs}
        cloudConfigured={cloudConfigured}
        totalCloudBytes={cloudMedia.totalBytes}
      />
    </div>
  );
}
