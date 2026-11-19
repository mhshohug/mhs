export type WeatherMood = 'storm' | 'rain' | 'fog' | 'cloudy' | 'clear_day' | 'clear_night';
export type WeatherLocationMode = 'rajshahi' | 'current';
export type BengalSeason = 'summer' | 'monsoon' | 'winter';

export interface RajshahiWeather {
  mood: WeatherMood;
  isDay: boolean;
  temperatureC: number | null;
  windKmh: number | null;
  windDirectionDeg: number | null;
  cloudCover: number | null;
  rainIntensity: number; // 0 = dry, 0.2-0.4 = light drizzle, 0.55-0.75 = moderate rain, 0.85-1 = heavy rain/storm
  hasLightning: boolean; // true only during WMO thunderstorm (>= 95)
  hasThunder: boolean;   // true during thunderstorm or violent convective downpour
  sunriseDecimal: number;
  sunsetDecimal: number;
  descriptionBn: string;
  locationMode: WeatherLocationMode;
  locationLabelBn: string;
  timezone: string;
  isLive: boolean;
  updatedAt: number;
}

export interface WeatherLocationOptions {
  mode?: WeatherLocationMode;
  latitude?: number;
  longitude?: number;
  locationLabelBn?: string;
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

  if (weather.isDay) {
    const span = Math.max(2, sunset - sunrise);
    const progress = Math.max(0.03, Math.min(0.97, (hourDec - sunrise) / span));
    let positionBn = 'সূর্য: মাথার ওপর';
    if (progress < 0.16) positionBn = 'সূর্য: পূর্ব দিগন্তে';
    else if (progress < 0.38) positionBn = 'সূর্য: পূর্ব আকাশে উঠছে';
    else if (progress <= 0.62) positionBn = 'সূর্য: মাথার ওপর (মধ্যাহ্ন)';
    else if (progress <= 0.84) positionBn = 'সূর্য: পশ্চিম আকাশে';
    else positionBn = 'সূর্য: পশ্চিম দিগন্তে';

    return { isDay: true, progress, positionBn };
  }

  // Night arc from sunset to next sunrise
  const nightSpan = 24 - sunset + sunrise;
  const elapsedNight = hourDec >= sunset ? hourDec - sunset : 24 - sunset + hourDec;
  const progress = Math.max(0.04, Math.min(0.96, elapsedNight / Math.max(2, nightSpan)));

  let positionBn = 'চাঁদ: মাঝ-আকাশে';
  if (progress < 0.25) positionBn = 'চাঁদ: পূর্ব আকাশে';
  else if (progress > 0.75) positionBn = 'চাঁদ: পশ্চিম আকাশে';

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
  const month = now.getMonth(); // 0 = Jan ... 11 = Dec

  // Calendar seasonal baseline for Bengal
  let summerWeight = month >= 2 && month <= 4 ? 0.9 : month === 5 ? 0.25 : 0;
  let monsoonWeight = month >= 5 && month <= 8 ? 0.92 : month === 9 ? 0.35 : 0;
  let winterWeight = month === 10 || month === 11 || month === 0 || month === 1 ? 0.88 : month === 9 ? 0.38 : 0;

  // Dynamic live-weather adjustments
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

  // Normalize slightly if everything is low (spring/autumn mild days)
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
    windDirectionDeg: null,
    cloudCover: null,
    rainIntensity: 0,
    hasLightning: false,
    hasThunder: false,
    sunriseDecimal: 6.35,
    sunsetDecimal: 17.35,
    descriptionBn: isDay ? 'স্বাভাবিক দিনের আকাশ' : 'নিরিবিলি রাতের আকাশ',
    locationMode: mode,
    locationLabelBn: labelBn,
    timezone: 'Asia/Dhaka',
    isLive: false,
    updatedAt: Date.now(),
  };
}

function mapWmoToWeatherSignals(
  code: number,
  isDay: boolean,
  rainMm: number,
  cloudCover: number | null
): {
  mood: WeatherMood;
  descriptionBn: string;
  rainIntensity: number;
  hasLightning: boolean;
  hasThunder: boolean;
} {
  // Thunderstorm codes (95, 96, 99) -> actual storm, lightning, thunder, and heavy rain
  if (code >= 95) {
    const intensity = Math.min(1, Math.max(0.75, 0.72 + rainMm / 12));
    return {
      mood: 'storm',
      descriptionBn: code >= 96 ? 'তীব্র ঝড় ও বজ্রবৃষ্টি' : 'ঝড় ও বজ্রবৃষ্টি',
      rainIntensity: intensity,
      hasLightning: true,
      hasThunder: true,
    };
  }

  const isRainWmo = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  if (isRainWmo || rainMm >= 0.15) {
    let baseIntensity = 0.35;
    if (code === 51 || code === 56) baseIntensity = 0.24;
    else if (code === 53 || code === 55 || code === 57) baseIntensity = 0.38;
    else if (code === 61 || code === 80) baseIntensity = 0.44;
    else if (code === 63 || code === 81) baseIntensity = 0.68;
    else if (code === 65 || code === 67 || code === 82) baseIntensity = 0.94;
    else if (rainMm > 0) baseIntensity = Math.min(0.95, 0.22 + rainMm / 8);

    const mmIntensity = rainMm > 0 ? Math.min(1, 0.22 + rainMm / 9) : 0;
    const intensity = Math.max(baseIntensity, mmIntensity);
    const violentRain = code === 65 || code === 67 || code === 82 || rainMm >= 6;

    let descriptionBn = 'মৃদু বৃষ্টি';
    if (intensity < 0.35) descriptionBn = 'গুঁড়ি গুঁড়ি বৃষ্টি';
    else if (intensity < 0.56) descriptionBn = 'হালকা বৃষ্টি';
    else if (intensity < 0.8) descriptionBn = 'মাঝারি বৃষ্টি';
    else descriptionBn = 'ঝুম বৃষ্টি';

    return {
      mood: 'rain',
      descriptionBn,
      rainIntensity: intensity,
      hasLightning: false,
      hasThunder: violentRain,
    };
  }

  if (code === 45 || code === 48) {
    return {
      mood: 'fog',
      descriptionBn: 'কুয়াশাচ্ছন্ন আকাশ',
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
    };
  }

  if (code === 2 || code === 3 || (cloudCover !== null && cloudCover >= 55)) {
    return {
      mood: 'cloudy',
      descriptionBn: cloudCover !== null && cloudCover >= 85 ? 'ঘন মেঘলা আকাশ' : 'আংশিক মেঘলা আকাশ',
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
    };
  }

  if (code === 1 || (cloudCover !== null && cloudCover >= 20)) {
    return {
      mood: isDay ? 'clear_day' : 'clear_night',
      descriptionBn: isDay ? 'হালকা মেঘ ও রোদ' : 'হালকা মেঘলা রাত',
      rainIntensity: 0,
      hasLightning: false,
      hasThunder: false,
    };
  }

  return {
    mood: isDay ? 'clear_day' : 'clear_night',
    descriptionBn: isDay ? 'পরিষ্কার রোদেলা আকাশ' : 'নিরিবিলি তারার রাত',
    rainIntensity: 0,
    hasLightning: false,
    hasThunder: false,
  };
}

/**
 * ডিফল্ট রাজশাহী, বাংলাদেশ অথবা ব্যবহারকারীর বর্তমান লোকেশনের লাইভ আবহাওয়া সংগ্রহ করে
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
  const tzParam = mode === 'current' ? 'auto' : 'Asia%2FDhaka';
  const labelBn =
    mode === 'current'
      ? opts?.locationLabelBn || 'বর্তমান লোকেশন'
      : DEFAULT_RAJSHAHI_COORDS.labelBn;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,is_day,precipitation,rain,showers,wind_speed_10m,wind_direction_10m,cloud_cover&daily=sunrise,sunset&forecast_days=1&timezone=${tzParam}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return createFallbackWeather({ mode, locationLabelBn: labelBn });
    const json = await res.json();
    const cur = json?.current;
    if (!cur || typeof cur.weather_code !== 'number') {
      return createFallbackWeather({ mode, locationLabelBn: labelBn });
    }

    const isDay = cur.is_day === 1;
    const cloudCover = typeof cur.cloud_cover === 'number' ? Math.round(cur.cloud_cover) : null;
    const precipMm = typeof cur.precipitation === 'number' ? cur.precipitation : 0;
    const rainVal = typeof cur.rain === 'number' ? cur.rain : 0;
    const showersVal = typeof cur.showers === 'number' ? cur.showers : 0;
    const totalRainMm = Math.max(precipMm, rainVal + showersVal);

    const mapped = mapWmoToWeatherSignals(cur.weather_code, isDay, totalRainMm, cloudCover);
    const sunriseDecimal = parseIsoHourDecimal(json?.daily?.sunrise?.[0], 6.35);
    const sunsetDecimal = parseIsoHourDecimal(json?.daily?.sunset?.[0], 17.35);
    const timezone = typeof json?.timezone === 'string' ? json.timezone : 'Asia/Dhaka';

    return {
      mood: mapped.mood,
      isDay,
      temperatureC: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null,
      windKmh: typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null,
      windDirectionDeg:
        typeof cur.wind_direction_10m === 'number' ? Math.round(cur.wind_direction_10m) : null,
      cloudCover,
      rainIntensity: mapped.rainIntensity,
      hasLightning: mapped.hasLightning,
      hasThunder: mapped.hasThunder,
      sunriseDecimal,
      sunsetDecimal,
      descriptionBn: mapped.descriptionBn,
      locationMode: mode,
      locationLabelBn: labelBn,
      timezone,
      isLive: true,
      updatedAt: Date.now(),
    };
  } catch {
    return createFallbackWeather({ mode, locationLabelBn: labelBn });
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

export async function resolveCurrentLocation(): Promise<ResolvedLocationResult | null> {
  // 1. Try browser GPS first
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const gpsResult = await new Promise<ResolvedLocationResult | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            labelBn: 'বর্তমান লোকেশন',
            source: 'gps',
          });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }
      );
    });
    if (gpsResult) return gpsResult;
  }

  // 2. Fallback to browser-side HTTPS IP geolocation (no permission prompt needed inside iframe)
  try {
    const ipRes = await fetch('https://get.geojs.io/v1/ip/geo.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
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
        const label = [geo.city, geo.country].filter(Boolean).join(', ') || 'বর্তমান লোকেশন';
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
        const label = [geo.city, geo.country].filter(Boolean).join(', ') || 'বর্তমান লোকেশন';
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
