export type WeatherMood = 'storm' | 'rain' | 'fog' | 'cloudy' | 'clear_day' | 'clear_night';
export type WeatherLocationMode = 'rajshahi' | 'current';
export type BengalSeason = 'summer' | 'monsoon' | 'winter';

export interface RajshahiWeather {
  mood: WeatherMood;
  isDay: boolean;
  temperatureC: number | null;
  windKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  cloudCover: number | null;
  visibilityM: number | null;
  fogDensity: number; // 0 = crystal clear, 0.2-0.55 = light/moderate mist, 0.7-1.0 = dense fog
  humidityPct: number | null;
  rainIntensity: number; // 0 = dry, 0.2-0.4 = light drizzle, 0.55-0.75 = moderate rain, 0.85-1 = heavy rain/storm
  hasLightning: boolean; // true during thunderstorm, active METAR TS, or strong lightning potential
  hasThunder: boolean;   // true during thunderstorm or violent convective downpour
  sunriseDecimal: number;
  sunsetDecimal: number;
  descriptionBn: string;
  locationMode: WeatherLocationMode;
  locationLabelBn: string;
  locationAccuracy?: 'gps' | 'manual' | 'ip' | 'default';
  stationCode?: string;
  timezone: string;
  isLive: boolean;
  updatedAt: number;
}

export interface WeatherLocationOptions {
  mode?: WeatherLocationMode;
  latitude?: number;
  longitude?: number;
  locationLabelBn?: string;
  locationAccuracy?: 'gps' | 'manual' | 'ip' | 'default';
}

export interface CelestialPosition {
  isDay: boolean;
  progress: number; // 0 = east horizon, 0.5 = zenith overhead, 1 = west horizon
  positionBn: string;
}

export interface WeatherSeasonWeights {
  dominant: BengalSeason;
  seasonBn: string;
  summerWeight: number;
  monsoonWeight: number;
  winterWeight: number;
}

export const DEFAULT_RAJSHAHI_COORDS = {
  latitude: 24.3745,
  longitude: 88.6042,
  labelBn: 'রাজশাহী, বাংলাদেশ',
};

export function getDhakaHourDecimal(timeZone = 'Asia/Dhaka'): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return (h % 24) + m / 60;
  } catch {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
}

function getDhakaIsDayFallback(timeZone = 'Asia/Dhaka'): boolean {
  const hour = getDhakaHourDecimal(timeZone);
  return hour >= 6 && hour < 17.75;
}

function parseIsoHourDecimal(isoStr: unknown, fallback: number): number {
  if (typeof isoStr !== 'string') return fallback;
  const match = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return fallback;
  return Number(match[1]) + Number(match[2]) / 60;
}

export function computeCelestialPosition(weather: {
  isDay: boolean;
  sunriseDecimal: number;
  sunsetDecimal: number;
  timezone?: string;
}): CelestialPosition {
  const hourDec = getDhakaHourDecimal(weather.timezone || 'Asia/Dhaka');
  const sunrise = weather.sunriseDecimal;
  const sunset = weather.sunsetDecimal;
  const hasValidSolarSpan = Number.isFinite(sunrise) && Number.isFinite(sunset) && sunset - sunrise >= 4;
  const isDayNow = hasValidSolarSpan ? hourDec >= sunrise && hourDec < sunset : weather.isDay;

  if (isDayNow) {
    const span = Math.max(2, sunset - sunrise);
    const progress = Math.max(0.0, Math.min(1.0, (hourDec - sunrise) / span));
    let positionBn = 'সূর্য: মাথার ওপর';
    if (progress < 0.10) positionBn = 'সূর্যোদয়: পূর্ব দিগন্তে';
    else if (progress < 0.36) positionBn = 'সূর্য: পূর্ব আকাশে উঠছে';
    else if (progress <= 0.64) positionBn = 'সূর্য: মাথার ওপর (মধ্যাহ্ন)';
    else if (progress <= 0.89) positionBn = 'সূর্য: পশ্চিম আকাশে';
    else positionBn = 'সূর্যাস্ত: পশ্চিম দিগন্তে';

    return { isDay: true, progress, positionBn };
  }

  const nightSpan = 24 - sunset + sunrise;
  const elapsedNight = hourDec >= sunset ? hourDec - sunset : 24 - sunset + hourDec;
  const progress = Math.max(0.02, Math.min(0.98, elapsedNight / Math.max(2, nightSpan)));

  let positionBn = 'চাঁদ: মাঝ-আকাশে';
  if (progress < 0.14) positionBn = 'চাঁদ: পূর্ব দিগন্তে উঠছে';
  else if (progress < 0.35) positionBn = 'চাঁদ: পূর্ব আকাশে';
  else if (progress > 0.86) positionBn = 'ভোরের আলো ফোটার আগে';
  else if (progress > 0.65) positionBn = 'চাঁদ: পশ্চিম আকাশে';

  return { isDay: false, progress, positionBn };
}

export function computeWeatherSeason(
  weather: {
    mood: WeatherMood;
    temperatureC: number | null;
    rainIntensity: number;
  },
  now: Date = new Date()
): WeatherSeasonWeights {
  const month = now.getMonth();

  let summerWeight = month >= 2 && month <= 4 ? 0.9 : month === 5 ? 0.25 : 0;
  let monsoonWeight = month >= 5 && month <= 8 ? 0.92 : month === 9 ? 0.35 : 0;
  let winterWeight = month === 10 || month === 11 || month === 0 || month === 1 ? 0.88 : month === 9 ? 0.38 : 0;

  if (weather.rainIntensity >= 0.3 || weather.mood === 'storm' || weather.mood === 'rain') {
    monsoonWeight = Math.min(1, monsoonWeight + 0.55 + weather.rainIntensity * 0.45);
    summerWeight *= 0.35;
    winterWeight *= 0.45;
  }

  if (weather.mood === 'fog' || (weather.temperatureC !== null && weather.temperatureC <= 21)) {
    const coldFactor =
      weather.temperatureC !== null ? Math.min(1, Math.max(0, (23 - weather.temperatureC) / 8)) : 0.65;
    winterWeight = Math.min(1, Math.max(winterWeight, 0.55 + coldFactor * 0.45));
    summerWeight *= 0.2;
  }

  if (
    weather.temperatureC !== null &&
    weather.temperatureC >= 29 &&
    weather.rainIntensity < 0.1 &&
    weather.mood !== 'fog'
  ) {
    const heatFactor = Math.min(1, (weather.temperatureC - 27) / 8);
    summerWeight = Math.min(1, Math.max(summerWeight, 0.5 + heatFactor * 0.5));
    winterWeight *= 0.25;
  }

  if (summerWeight < 0.2 && monsoonWeight < 0.2 && winterWeight < 0.2) {
    summerWeight = 0.45;
  }

  let dominant: BengalSeason = 'summer';
  let seasonBn = 'গ্রীষ্মকাল';
  if (monsoonWeight >= summerWeight && monsoonWeight >= winterWeight) {
    dominant = 'monsoon';
    seasonBn = 'বর্ষাকাল';
  } else if (winterWeight >= summerWeight && winterWeight >= monsoonWeight) {
    dominant = 'winter';
    seasonBn = 'শীতকাল';
  }

  return {
    dominant,
    seasonBn,
    summerWeight: Math.max(0, Math.min(1, summerWeight)),
    monsoonWeight: Math.max(0, Math.min(1, monsoonWeight)),
    winterWeight: Math.max(0, Math.min(1, winterWeight)),
  };
}

export function formatDhakaTimeBn(timestampMs: number, timeZone = 'Asia/Dhaka'): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestampMs));
    return toBengaliText(formatted);
  } catch {
    const d = new Date(timestampMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return toBengaliText(`${hh}:${mm}`);
  }
}

function createFallbackWeather(opts?: WeatherLocationOptions): RajshahiWeather {
  const mode: WeatherLocationMode = opts?.mode === 'current' ? 'current' : 'rajshahi';
  const labelBn =
    mode === 'current'
      ? opts?.locationLabelBn || 'বর্তমান লোকেশন'
      : DEFAULT_RAJSHAHI_COORDS.labelBn;
  const isDay = getDhakaIsDayFallback('Asia/Dhaka');
  return {
    mood: isDay ? 'clear_day' : 'clear_night',
    isDay,
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
    descriptionBn: isDay ? 'স্বাভাবিক দিনের আকাশ' : 'নিরিবিলি রাতের আকাশ',
    locationMode: mode,
    locationLabelBn: labelBn,
    locationAccuracy: opts?.locationAccuracy || (mode === 'rajshahi' ? 'default' : undefined),
    timezone: 'Asia/Dhaka',
    isLive: false,
    updatedAt: Date.now(),
  };
}

interface ClosestMetarObs {
  icaoId: string;
  distanceKm: number;
  ageMinutes: number;
  tempC: number | null;
  dewPointC: number | null;
  windDirDeg: number | null;
  windKmh: number | null;
  windGustKmh: number | null;
  visibilityM: number | null;
  wxString: string;
  cloudCoverPct: number | null;
}

interface FusedWeatherSignals {
  mood: WeatherMood;
  descriptionBn: string;
  rainIntensity: number;
  hasLightning: boolean;
  hasThunder: boolean;
  fogDensity: number;
}

function fuseWeatherSignals(params: {
  wmoCode: number;
  isDay: boolean;
  rainMm: number;
  cloudCover: number | null;
  visibilityM: number | null;
  humidityPct: number | null;
  dewPointSpreadC: number | null;
  windKmh: number | null;
  windGustKmh: number | null;
  cape: number | null;
  lightningPotential: number | null;
  metar: ClosestMetarObs | null;
}): FusedWeatherSignals {
  const {
    wmoCode,
    isDay,
    rainMm,
    cloudCover,
    visibilityM,
    humidityPct,
    dewPointSpreadC,
    windKmh,
    windGustKmh,
    cape,
    lightningPotential,
    metar,
  } = params;

  const wx = (metar?.wxString || '').toUpperCase();
  const isVeryCloseMetar = Boolean(metar && metar.distanceKm <= 30 && metar.ageMinutes <= 60);

  // 1. Real-time Fog & Mist Density (continuous 0..1 from WMO, METAR FG/BR, visibility & dewpoint spread)
  let fogDensity = 0;
  const hasMetarDenseFog = isVeryCloseMetar && /\b(FG|FZFG|MIFG|BCFG)\b/.test(wx);
  const hasMetarMist = isVeryCloseMetar && /\b(BR|HZ)\b/.test(wx);

  if (wmoCode === 45 || wmoCode === 48 || hasMetarDenseFog) {
    fogDensity = Math.max(
      0.78,
      visibilityM !== null ? Math.min(1, Math.max(0.75, 1.05 - visibilityM / 1400)) : 0.88
    );
  } else if (visibilityM !== null && visibilityM < 1000) {
    fogDensity = Math.min(1, Math.max(0.7, 1.05 - visibilityM / 1150));
  } else if (visibilityM !== null && visibilityM < 3200) {
    const visFactor = (3200 - visibilityM) / 2200; // 0..1
    const humidBoost =
      (humidityPct !== null && humidityPct >= 82) ||
      (dewPointSpreadC !== null && dewPointSpreadC <= 2.8) ||
      hasMetarMist
        ? 1
        : 0.58;
    fogDensity = Math.min(0.66, Math.max(0.14, visFactor * 0.56 * humidBoost));
  } else if (hasMetarMist && visibilityM !== null && visibilityM <= 5000) {
    fogDensity = Math.min(0.42, Math.max(0.16, (5000 - visibilityM) / 6500));
  } else if (
    humidityPct !== null &&
    humidityPct >= 93 &&
    dewPointSpreadC !== null &&
    dewPointSpreadC <= 1.2 &&
    rainMm < 0.05
  ) {
    fogDensity = 0.28;
  }

  // 2. Real-time Lightning & Thunder Detection
  const metarThunder = Boolean(metar && metar.distanceKm <= 48 && metar.ageMinutes <= 60 && /\b(TS|VCTS|TSRA|TSGR|LTG)\b/.test(wx));
  const modelThunder = wmoCode >= 95;
  const highLightningPotential =
    lightningPotential !== null &&
    lightningPotential >= 1200 &&
    (rainMm >= 0.2 || (wmoCode >= 80 && wmoCode <= 82) || (cape !== null && cape >= 1100));
  const heavyConvectiveSquall =
    rainMm >= 5 && cape !== null && cape >= 1400;

  const hasLightning = modelThunder || metarThunder || highLightningPotential;
  const hasThunder =
    hasLightning ||
    heavyConvectiveSquall ||
    wmoCode === 65 ||
    wmoCode === 67 ||
    wmoCode === 82 ||
    rainMm >= 6;

  // 3. Real-time Rain Detection (Open-Meteo + 15-min slot + physical METAR station)
  const metarHeavyRain = isVeryCloseMetar && /\+(RA|SHRA|TSRA)/.test(wx);
  const metarModRain = isVeryCloseMetar && !/-(RA|DZ|SHRA)/.test(wx) && /\b(RA|SHRA|TSRA)\b/.test(wx);
  const metarLightRain = isVeryCloseMetar && /(-RA|-DZ|DZ|-SHRA)/.test(wx);
  const isRainWmo = (wmoCode >= 51 && wmoCode <= 67) || (wmoCode >= 80 && wmoCode <= 82);

  let rainIntensity = 0;
  if (hasLightning || modelThunder || metarThunder) {
    const baseStormRain = metarHeavyRain
      ? 0.92
      : metarModRain
        ? 0.72
        : metarLightRain
          ? 0.36
          : isRainWmo || rainMm > 0
            ? Math.max(0.55, 0.5 + rainMm / 12)
            : 0.25;
    rainIntensity = Math.min(1, baseStormRain);
  } else if (isRainWmo || rainMm >= 0.04 || metarHeavyRain || metarModRain || metarLightRain) {
    let base = 0.14;
    if (wmoCode === 51 || wmoCode === 56) base = 0.18;
    else if (wmoCode === 53 || wmoCode === 55 || wmoCode === 57) base = 0.34;
    else if (wmoCode === 61 || wmoCode === 80) base = 0.48;
    else if (wmoCode === 63 || wmoCode === 81) base = 0.7;
    else if (wmoCode === 65 || wmoCode === 67 || wmoCode === 82) base = 0.94;
    else if (metarHeavyRain) base = 0.9;
    else if (metarModRain) base = 0.62;
    else if (metarLightRain) base = 0.24;

    const mmIntensity = rainMm > 0 ? Math.min(1, 0.1 + Math.pow(rainMm / 8.5, 0.84) * 0.9) : 0;
    rainIntensity = Math.max(base, mmIntensity);
  }

  // 4. Severe Wind / Kalboishakhi Squall Storm
  const peakWind = Math.max(windKmh ?? 0, windGustKmh ?? 0);
  const isGaleWindStorm = (windKmh !== null && windKmh >= 34) || peakWind >= 48;

  if (hasLightning || metarThunder || (isGaleWindStorm && rainIntensity >= 0.2)) {
    return {
      mood: 'storm',
      descriptionBn:
        wmoCode >= 96 || metarHeavyRain || peakWind >= 55
          ? 'তীব্র ঝড় ও বজ্রবৃষ্টি'
          : 'ঝড় ও বজ্রবৃষ্টি',
      rainIntensity: Math.max(0.25, rainIntensity),
      hasLightning,
      hasThunder: true,
      fogDensity: Math.max(fogDensity, rainIntensity * 0.2),
    };
  }

  if (isGaleWindStorm) {
    return {
      mood: 'storm',
      descriptionBn: 'দমকা ঝোড়ো হাওয়া',
      rainIntensity,
      hasLightning: false,
      hasThunder: false,
      fogDensity,
    };
  }

  if (rainIntensity > 0.02) {
    let descriptionBn = 'মৃদু বৃষ্টি';
    if (rainIntensity < 0.25) descriptionBn = 'ঝিরি ঝিরি বৃষ্টি';
    else if (rainIntensity < 0.38) descriptionBn = 'গুঁড়ি গুঁড়ি বৃষ্টি';
    else if (rainIntensity < 0.56) descriptionBn = 'হালকা বৃষ্টি';
    else if (rainIntensity < 0.78) descriptionBn = 'মাঝারি বৃষ্টি';
    else descriptionBn = 'ঝুম বৃষ্টি';

    return {
      mood: 'rain',
      descriptionBn,
      rainIntensity,
      hasLightning: false,
      hasThunder,
      fogDensity: Math.max(fogDensity, rainIntensity * 0.18),
    };
  }

  if (fogDensity >= 0.62 || wmoCode === 45 || wmoCode === 48 || hasMetarDenseFog) {
    return {
      mood: 'fog',
      descriptionBn: fogDensity >= 0.85 ? 'ঘন কুয়াশাচ্ছন্ন আকাশ' : 'কুয়াশাচ্ছন্ন আকাশ',
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
      fogDensity: Math.max(0.68, fogDensity),
    };
  }

  if (fogDensity >= 0.22) {
    return {
      mood: 'fog',
      descriptionBn: 'হালকা কুয়াশা ও ধোঁয়াশা',
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
      fogDensity,
    };
  }

  if (wmoCode === 2 || wmoCode === 3 || (cloudCover !== null && cloudCover >= 55)) {
    const gustNote = peakWind >= 30 ? ' ও দমকা বাতাস' : '';
    return {
      mood: 'cloudy',
      descriptionBn:
        (cloudCover !== null && cloudCover >= 85 ? 'ঘন মেঘলা আকাশ' : 'আংশিক মেঘলা আকাশ') + gustNote,
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
      fogDensity,
    };
  }

  if (wmoCode === 1 || (cloudCover !== null && cloudCover >= 20)) {
    return {
      mood: isDay ? 'clear_day' : 'clear_night',
      descriptionBn: isDay ? 'হালকা মেঘ ও রোদ' : 'হালকা মেঘলা রাত',
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
      fogDensity,
    };
  }

  return {
    mood: isDay ? 'clear_day' : 'clear_night',
    descriptionBn: isDay ? 'পরিষ্কার রোদেলা আকাশ' : 'নিরিবিলি তারার রাত',
    rainIntensity: 0,
    hasLightning: false,
    hasThunder: false,
    fogDensity,
  };
}

function pickCurrentMinutelyIndex(times: unknown, currentIso: unknown): number {
  if (!Array.isArray(times) || times.length === 0) return -1;
  if (typeof currentIso === 'string') {
    const exactIdx = times.indexOf(currentIso);
    if (exactIdx >= 0) return exactIdx;
  }
  const nowMs = Date.now();
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(String(times[i]));
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - nowMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function buildWeatherFromRaw(
  omJson: any,
  metar: ClosestMetarObs | null,
  opts: {
    mode: WeatherLocationMode;
    labelBn: string;
    locationAccuracy?: 'gps' | 'manual' | 'ip' | 'default';
  }
): RajshahiWeather | null {
  const cur = omJson?.current;
  if (!cur && !metar) return null;

  const min15 = omJson?.minutely_15;
  const mIdx = min15 ? pickCurrentMinutelyIndex(min15.time, cur?.time) : -1;
  const mVal = (arr: unknown): number | null =>
    mIdx >= 0 && Array.isArray(arr) && typeof arr[mIdx] === 'number' ? arr[mIdx] : null;

  const isDay =
    typeof cur?.is_day === 'number'
      ? cur.is_day === 1
      : getDhakaIsDayFallback(typeof omJson?.timezone === 'string' ? omJson.timezone : 'Asia/Dhaka');

  const isCloseMetar = Boolean(metar && metar.distanceKm <= 30 && metar.ageMinutes <= 60);

  const omTemp = typeof cur?.temperature_2m === 'number' ? cur.temperature_2m : null;
  const tempC =
    isCloseMetar && metar?.tempC !== null && metar!.ageMinutes <= 35
      ? Math.round(metar!.tempC)
      : omTemp !== null
        ? Math.round(omTemp)
        : metar?.tempC !== null && metar?.tempC !== undefined
          ? Math.round(metar.tempC)
          : null;

  const dewC =
    isCloseMetar && metar?.dewPointC !== null
      ? metar!.dewPointC
      : typeof cur?.dew_point_2m === 'number'
        ? cur.dew_point_2m
        : null;
  const dewPointSpreadC = tempC !== null && dewC !== null ? tempC - dewC : null;

  const humidityPct =
    typeof cur?.relative_humidity_2m === 'number' ? Math.round(cur.relative_humidity_2m) : null;

  const omCloud = typeof cur?.cloud_cover === 'number' ? Math.round(cur.cloud_cover) : null;
  const cloudCover =
    isCloseMetar && metar?.cloudCoverPct !== null && omCloud !== null
      ? Math.round(metar!.cloudCoverPct * 0.6 + omCloud * 0.4)
      : omCloud ?? metar?.cloudCoverPct ?? null;

  const omVis = mVal(min15?.visibility) ?? (typeof cur?.visibility === 'number' ? cur.visibility : null);
  const visibilityM =
    isCloseMetar && metar?.visibilityM !== null
      ? metar!.visibilityM
      : omVis !== null
        ? Math.round(omVis)
        : metar?.visibilityM ?? null;

  const omWind = typeof cur?.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null;
  const omGust = mVal(min15?.wind_gusts_10m) ?? (typeof cur?.wind_gusts_10m === 'number' ? Math.round(cur.wind_gusts_10m) : null);
  const windKmh =
    isCloseMetar && metar?.windKmh !== null && metar!.ageMinutes <= 35
      ? metar!.windKmh
      : omWind ?? metar?.windKmh ?? null;
  const windGustKmh =
    isCloseMetar && metar?.windGustKmh !== null
      ? Math.max(metar!.windGustKmh, omGust ?? 0)
      : omGust ?? metar?.windGustKmh ?? null;

  const windDirectionDeg =
    isCloseMetar && metar?.windDirDeg !== null
      ? metar!.windDirDeg
      : typeof cur?.wind_direction_10m === 'number'
        ? Math.round(cur.wind_direction_10m)
        : metar?.windDirDeg ?? null;

  const precipMm = typeof cur?.precipitation === 'number' ? cur.precipitation : 0;
  const rainVal = typeof cur?.rain === 'number' ? cur.rain : 0;
  const showersVal = typeof cur?.showers === 'number' ? cur.showers : 0;
  const min15Precip = mVal(min15?.precipitation) ?? 0;
  const min15Rain = mVal(min15?.rain) ?? 0;
  const totalRainMm = Math.max(precipMm, rainVal + showersVal, min15Precip, min15Rain);

  const wmoCode =
    typeof cur?.weather_code === 'number'
      ? cur.weather_code
      : (mVal(min15?.weather_code) ?? 0);

  const cape = mVal(min15?.cape);
  const lightningPotential = mVal(min15?.lightning_potential);

  const fused = fuseWeatherSignals({
    wmoCode,
    isDay,
    rainMm: totalRainMm,
    cloudCover,
    visibilityM,
    humidityPct,
    dewPointSpreadC,
    windKmh,
    windGustKmh,
    cape,
    lightningPotential,
    metar,
  });

  const sunriseDecimal = parseIsoHourDecimal(omJson?.daily?.sunrise?.[0], 6.35);
  const sunsetDecimal = parseIsoHourDecimal(omJson?.daily?.sunset?.[0], 17.35);
  const timezone = typeof omJson?.timezone === 'string' ? omJson.timezone : 'Asia/Dhaka';

  return {
    mood: fused.mood,
    isDay,
    temperatureC: tempC,
    windKmh,
    windGustKmh,
    windDirectionDeg,
    cloudCover,
    visibilityM,
    fogDensity: fused.fogDensity,
    humidityPct,
    rainIntensity: fused.rainIntensity,
    hasLightning: fused.hasLightning,
    hasThunder: fused.hasThunder,
    sunriseDecimal,
    sunsetDecimal,
    descriptionBn: fused.descriptionBn,
    locationMode: opts.mode,
    locationLabelBn: opts.labelBn,
    locationAccuracy: opts.locationAccuracy,
    stationCode: isCloseMetar ? metar?.icaoId : undefined,
    timezone,
    isLive: true,
    updatedAt: Date.now(),
  };
}

/**
 * ডিফল্ট রাজশাহী, বাংলাদেশ অথবা ব্যবহারকারীর এক্সাক্ট লোকেশনের রিয়েল-টাইম লাইভ আবহাওয়া সংগ্রহ করে
 */
export async function fetchWeatherForLocation(
  opts?: WeatherLocationOptions
): Promise<RajshahiWeather> {
  const mode: WeatherLocationMode =
    opts?.mode === 'current' &&
    typeof opts.latitude === 'number' &&
    typeof opts.longitude === 'number'
      ? 'current'
      : 'rajshahi';

  const lat = mode === 'current' ? opts!.latitude! : DEFAULT_RAJSHAHI_COORDS.latitude;
  const lon = mode === 'current' ? opts!.longitude! : DEFAULT_RAJSHAHI_COORDS.longitude;
  const labelBn =
    mode === 'current'
      ? opts?.locationLabelBn || 'বর্তমান লোকেশন'
      : DEFAULT_RAJSHAHI_COORDS.labelBn;
  const locationAccuracy = opts?.locationAccuracy || (mode === 'rajshahi' ? 'default' : 'manual');

  // 1. Primary: Multi-source live weather endpoint (/api/weather/live: Open-Meteo 15m + Live METAR ground sensor)
  try {
    const apiUrl = `/api/weather/live?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
    const res = await fetch(apiUrl, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const payload = (await res.json()) as {
        openMeteo?: any;
        closestMetar?: ClosestMetarObs | null;
      };
      const built = buildWeatherFromRaw(payload.openMeteo, payload.closestMetar ?? null, {
        mode,
        labelBn,
        locationAccuracy,
      });
      if (built) return built;
    }
  } catch {
    // Fallback directly to Open-Meteo in client if backend proxy unavailable
  }

  // 2. Direct Open-Meteo fallback
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
      `&current=temperature_2m,relative_humidity_2m,dew_point_2m,is_day,precipitation,rain,showers,weather_code,cloud_cover,cloud_cover_low,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility` +
      `&minutely_15=precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,visibility,cape,lightning_potential` +
      `&daily=sunrise,sunset&forecast_days=1&timezone=auto`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return createFallbackWeather({ mode, locationLabelBn: labelBn, locationAccuracy });
    const json = await res.json();
    const built = buildWeatherFromRaw(json, null, { mode, labelBn, locationAccuracy });
    return built ?? createFallbackWeather({ mode, locationLabelBn: labelBn, locationAccuracy });
  } catch {
    return createFallbackWeather({ mode, locationLabelBn: labelBn, locationAccuracy });
  }
}

export async function fetchRajshahiWeather(): Promise<RajshahiWeather> {
  return fetchWeatherForLocation({ mode: 'rajshahi' });
}

export interface ResolvedLocationResult {
  latitude: number;
  longitude: number;
  labelBn: string;
  source: 'gps' | 'ip';
}

export interface CitySearchResult {
  id: number;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

export async function reverseGeocodeCoords(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/location/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(4500) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { labelBn?: string };
    return data.labelBn && data.labelBn.trim() ? data.labelBn.trim() : null;
  } catch {
    return null;
  }
}

export async function resolveCurrentLocation(): Promise<ResolvedLocationResult | null> {
  // 1. Try high-accuracy device GPS first (fresh coordinates, zero stale cache)
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const getPos = (highAccuracy: boolean, timeout: number, maximumAge: number) =>
      new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          () => resolve(null),
          { enableHighAccuracy: highAccuracy, timeout, maximumAge }
        );
      });

    const gpsCoords =
      (await getPos(true, 9000, 0)) || (await getPos(false, 4500, 60000));

    if (gpsCoords) {
      const exactLabel = await reverseGeocodeCoords(gpsCoords.latitude, gpsCoords.longitude);
      return {
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
        labelBn: exactLabel || 'বর্তমান GPS লোকেশন',
        source: 'gps',
      };
    }
  }

  // 2. Fallback to browser-side HTTPS IP geolocation (no permission prompt needed inside iframe)
  try {
    const ipRes = await fetch('https://get.geojs.io/v1/ip/geo.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4500),
    });
    if (ipRes.ok) {
      const geo = (await ipRes.json()) as {
        latitude?: string | number;
        longitude?: string | number;
        city?: string;
        country?: string;
      };
      const lat = Number(geo.latitude);
      const lon = Number(geo.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const reverseLabel = await reverseGeocodeCoords(lat, lon);
        const label =
          reverseLabel ||
          [geo.city, geo.country].filter(Boolean).join(', ') ||
          'বর্তমান লোকেশন';
        return { latitude: lat, longitude: lon, labelBn: label, source: 'ip' };
      }
    }
  } catch {
    // try server endpoint fallback
  }

  // 3. Fallback to Express IP resolver
  try {
    const srvRes = await fetch('/api/location/auto', { cache: 'no-store' });
    if (srvRes.ok) {
      const geo = (await srvRes.json()) as {
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
      };
      if (typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
        const reverseLabel = await reverseGeocodeCoords(geo.latitude, geo.longitude);
        const label =
          reverseLabel ||
          [geo.city, geo.country].filter(Boolean).join(', ') ||
          'বর্তমান লোকেশন';
        return {
          latitude: geo.latitude,
          longitude: geo.longitude,
          labelBn: label,
          source: 'ip',
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function searchCityLocations(query: string): Promise<CitySearchResult[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];

  // 1. Combined Open-Meteo + OpenStreetMap hyper-local search (villages, upazilas, wards, cities)
  try {
    const res = await fetch(`/api/location/search?q=${encodeURIComponent(clean)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = (await res.json()) as { results?: CitySearchResult[] };
      if (Array.isArray(json.results) && json.results.length > 0) {
        return json.results;
      }
    }
  } catch {
    // Fallback to Open-Meteo Geocoding direct
  }

  // 2. Direct Open-Meteo Geocoding fallback
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=6&language=en&format=json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: Array<{
        id: number;
        name: string;
        country?: string;
        admin1?: string;
        latitude: number;
        longitude: number;
      }>;
    };
    if (!Array.isArray(json.results)) return [];
    return json.results.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country || '',
      admin1: r.admin1,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  } catch {
    return [];
  }
}

export function toBengaliText(value: string): string {
  const digits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return value
    .split('')
    .map((ch) => (ch >= '0' && ch <= '9' ? digits[Number(ch)] : ch))
    .join('');
}

export function toBengaliDigits(num: number): string {
  return toBengaliText(String(num));
}
