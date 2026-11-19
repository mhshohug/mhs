import { useEffect, useState } from 'react';
import { Cloud, CloudFog, CloudSun, Lock, Moon, Sun } from 'lucide-react';
import { AudioPlayer } from './components/AudioPlayer';
import { RainFloatingPhotos } from './components/RainFloatingPhotos';
import { SinglePageStoryStream } from './components/SinglePageStoryStream';
import { StormyBoyBackdrop } from './components/StormyBoyBackdrop';
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
  computeCelestialPosition,
  fetchRajshahiWeather,
  formatDhakaTimeBn,
  RajshahiWeather,
  toBengaliDigits,
} from './utils/rajshahiWeather';

export default function App() {
  const [photos, setPhotos] = useState<FloatingPhoto[]>(BUILTIN_PHOTOS);
  const [requestAllPhotosView, setRequestAllPhotosView] = useState(false);
  const [isWeatherMode, setIsWeatherMode] = useState(false);
  const [weather, setWeather] = useState<RajshahiWeather>({
    mood: 'rain',
    isDay: false,
    temperatureC: null,
    windKmh: null,
    windDirectionDeg: null,
    cloudCover: null,
    sunriseDecimal: 6.35,
    sunsetDecimal: 17.35,
    descriptionBn: 'বৃষ্টির রাত',
    isLive: false,
    updatedAt: Date.now(),
  });

  const [now] = useState(() => new Date());
  const isRealBirthdayToday = checkIsBirthday(now);
  const [previewBirthday, setPreviewBirthday] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('birthday') === 'true' || params.get('birthday') === '1';
  });

  const isBirthdayMode = isRealBirthdayToday || previewBirthday;
  const currentYear = now.getFullYear();
  const birthdayEdition = getBirthdayEditionForYear(currentYear);

  useEffect(() => {
    let mounted = true;
    loadExternalManifest().then((externalPhotos) => {
      if (mounted && externalPhotos.length > 0) {
        setPhotos([...externalPhotos, ...BUILTIN_PHOTOS]);
      }
    });
    fetchRajshahiWeather().then((liveWeather) => {
      if (mounted) {
        setWeather(liveWeather);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Poll live weather every 15 minutes cleanly when Weather Mode is active
  useEffect(() => {
    if (!isWeatherMode || isBirthdayMode) return;
    let active = true;
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
    let lastFetchedAt = weather.updatedAt;

    const refreshWeather = () => {
      lastFetchedAt = Date.now();
      fetchRajshahiWeather().then((liveWeather) => {
        if (active) {
          lastFetchedAt = liveWeather.updatedAt;
          setWeather(liveWeather);
        }
      });
    };

    const intervalId = window.setInterval(refreshWeather, FIFTEEN_MINUTES_MS);
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastFetchedAt >= FIFTEEN_MINUTES_MS
      ) {
        refreshWeather();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isWeatherMode, isBirthdayMode]);

  const handleToggleWeatherMode = () => {
    setIsWeatherMode((prev) => {
      const next = !prev;
      if (next) {
        setPreviewBirthday(false);
        const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
        if (!weather.isLive || Date.now() - weather.updatedAt >= FIFTEEN_MINUTES_MS) {
          fetchRajshahiWeather().then((liveWeather) => setWeather(liveWeather));
        }
      }
      return next;
    });
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

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#020408] text-[#f3efe8]">
      {/* Stormy Video+Rain+Lightning | Live Weather Sky | Birthday Balloons+Fireworks */}
      <StormyBoyBackdrop
        isBirthdayMode={isBirthdayMode}
        isWeatherMode={isWeatherMode}
        accentHex={birthdayEdition.accentHex}
        secondaryHex={birthdayEdition.secondaryHex}
        weatherMood={weather.mood}
        weatherIsDay={weather.isDay}
        temperatureC={weather.temperatureC}
        windKmh={weather.windKmh}
        windDirectionDeg={weather.windDirectionDeg}
        cloudCover={weather.cloudCover}
        sunriseDecimal={weather.sunriseDecimal}
        sunsetDecimal={weather.sunsetDecimal}
      />

      {/* Compact Mobile-Friendly Top Bar */}
      <header className="pointer-events-none relative z-40 flex h-11 items-center justify-between gap-1.5 px-2.5 sm:h-12 sm:px-6">
        <div className="pointer-events-auto flex min-w-0 items-baseline gap-2">
          <span className="font-display truncate whitespace-nowrap text-[13px] font-semibold tracking-tight text-slate-100 drop-shadow sm:text-base">
            {isBirthdayMode ? 'আজকে তোমার জন্মদিন' : 'ভালো থেকো, রুপো'}
          </span>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!isRealBirthdayToday && (
            <button
              type="button"
              onClick={handleToggleWeatherMode}
              className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[10.5px] font-medium backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-sky-300 sm:h-8 sm:px-3 sm:text-xs ${
                isWeatherMode && !isBirthdayMode
                  ? 'border border-sky-300/50 bg-sky-400/20 text-sky-100 hover:bg-sky-400/30'
                  : 'border border-white/15 bg-black/50 text-slate-200 hover:bg-white/15'
              }`}
            >
              <CloudSun className="h-3 w-3 text-amber-200" />
              <span>ওয়েদার মোড</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setRequestAllPhotosView(true)}
            className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border border-white/15 bg-black/50 px-2 text-[10.5px] font-medium text-slate-100 backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-sky-300 sm:h-8 sm:px-3 sm:text-xs"
          >
            <Lock className="h-3 w-3 text-sky-300" />
            <span>সব ছবি</span>
          </button>

          {!isRealBirthdayToday && (
            <button
              type="button"
              onClick={handleToggleBirthdayPreview}
              className={`inline-flex h-7 items-center whitespace-nowrap rounded-lg px-2 text-[10.5px] font-medium backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-sky-300 sm:h-8 sm:px-3 sm:text-xs ${
                previewBirthday
                  ? 'border border-amber-300/45 bg-amber-400/20 text-amber-200 hover:bg-amber-400/30'
                  : 'border border-white/15 bg-black/50 text-slate-200 hover:bg-white/15'
              }`}
            >
              {previewBirthday ? 'স্বাভাবিক দৃশ্য' : 'জন্মদিন প্রিভিউ'}
            </button>
          )}
        </div>
      </header>

      {/* Live Weather Readout (Updates every 15 minutes while Weather Mode is active, zero city name) */}
      {isWeatherMode && !isBirthdayMode && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed left-2.5 top-12 z-30 inline-flex max-w-[calc(100vw-20px)] items-center gap-1.5 px-2.5 py-1 text-[10.5px] font-medium leading-snug text-white/90 drop-shadow-md sm:left-6 sm:top-14 sm:text-xs"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300 animate-pulse shadow-[0_0_6px_#34d399]"
          />
          <span className="shrink-0">{renderWeatherIcon()}</span>
          <span>
            {weather.temperatureC !== null ? `${toBengaliDigits(weather.temperatureC)}°সে · ` : ''}
            {weather.descriptionBn}
            {` · ${celestial.positionBn}`}
            {weather.cloudCover !== null ? ` · মেঘ ${toBengaliDigits(weather.cloudCover)}%` : ''}
            {weather.windKmh !== null ? ` · বাতাস ${toBengaliDigits(weather.windKmh)} কিমি/ঘ` : ''}
            {` · লাইভ ${formatDhakaTimeBn(weather.updatedAt)}`}
          </span>
        </div>
      )}

      {/* Mobile-Friendly Continuous Auto-Scroll + Manual Touch/Wheel Scroll Story */}
      <main className="pointer-events-none relative z-20 mx-auto flex h-[calc(100dvh-44px)] max-w-7xl items-stretch justify-center px-2.5 pb-12 sm:h-[calc(100dvh-48px)] sm:px-6 lg:justify-end lg:pb-10">
        <SinglePageStoryStream
          isBirthdayMode={isBirthdayMode}
          edition={birthdayEdition}
          weather={weather}
        />
      </main>

      {/* Wind-Drifting Nameless Blurred Photos + Password-Protected All-Photos Viewer */}
      <RainFloatingPhotos
        photos={photos}
        requestAllPhotosView={requestAllPhotosView}
        onCloseAllPhotosView={() => setRequestAllPhotosView(false)}
      />

      {/* Automatic Folder Playlist Display */}
      <AudioPlayer isBirthdayMode={isBirthdayMode} />
    </div>
  );
}
