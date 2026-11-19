export type WeatherMood = 'storm' | 'rain' | 'fog' | 'cloudy' | 'clear_day' | 'clear_night';

export interface RajshahiWeather {
  mood: WeatherMood;
  isDay: boolean;
  temperatureC: number | null;
  windKmh: number | null;
  windDirectionDeg: number | null;
  cloudCover: number | null;
  sunriseDecimal: number;
  sunsetDecimal: number;
  descriptionBn: string;
  isLive: boolean;
  updatedAt: number;
}

export interface CelestialPosition {
  isDay: boolean;
  progress: number; // 0 = east horizon, 0.5 = zenith overhead, 1 = west horizon
  positionBn: string;
}

function getDhakaIsDayFallback(): boolean {
  const hour = getDhakaHourDecimal();
  return hour >= 6 && hour < 17.75;
}

export function getDhakaHourDecimal(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
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
}): CelestialPosition {
  const hourDec = getDhakaHourDecimal();
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

export function formatDhakaTimeBn(timestampMs: number): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
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

function createFallbackWeather(): RajshahiWeather {
  const isDay = getDhakaIsDayFallback();
  return {
    mood: 'rain',
    isDay,
    temperatureC: null,
    windKmh: null,
    windDirectionDeg: null,
    cloudCover: null,
    sunriseDecimal: 6.35,
    sunsetDecimal: 17.35,
    descriptionBn: isDay ? 'বৃষ্টির আকাশ' : 'বৃষ্টির রাত',
    isLive: false,
    updatedAt: Date.now(),
  };
}

function mapWmoCodeToMood(code: number, isDay: boolean): { mood: WeatherMood; descriptionBn: string } {
  if (code >= 95) {
    return { mood: 'storm', descriptionBn: 'ঝড় ও বজ্রবৃষ্টি' };
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return { mood: 'rain', descriptionBn: code >= 63 ? 'ঝুম বৃষ্টি' : 'হালকা বৃষ্টি' };
  }
  if (code === 45 || code === 48) {
    return { mood: 'fog', descriptionBn: 'কুয়াশাচ্ছন্ন আকাশ' };
  }
  if (code === 2 || code === 3) {
    return { mood: 'cloudy', descriptionBn: 'মেঘলা আকাশ' };
  }
  return isDay
    ? { mood: 'clear_day', descriptionBn: 'পরিষ্কার রোদেলা আকাশ' }
    : { mood: 'clear_night', descriptionBn: 'নিরিবিলি তারার রাত' };
}

/**
 * রাজশাহী, বাংলাদেশ (24.3745° N, 88.6042° E)-এর লাইভ আবহাওয়া ও সূর্যোদয়/সূর্যাস্তের সময় সংগ্রহ করে
 */
export async function fetchRajshahiWeather(): Promise<RajshahiWeather> {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=24.3745&longitude=88.6042&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,cloud_cover&daily=sunrise,sunset&forecast_days=1&timezone=Asia%2FDhaka';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return createFallbackWeather();
    const json = await res.json();
    const cur = json?.current;
    if (!cur || typeof cur.weather_code !== 'number') return createFallbackWeather();

    const isDay = cur.is_day === 1;
    const mapped = mapWmoCodeToMood(cur.weather_code, isDay);
    const sunriseDecimal = parseIsoHourDecimal(json?.daily?.sunrise?.[0], 6.35);
    const sunsetDecimal = parseIsoHourDecimal(json?.daily?.sunset?.[0], 17.35);

    return {
      mood: mapped.mood,
      isDay,
      temperatureC: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null,
      windKmh: typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null,
      windDirectionDeg:
        typeof cur.wind_direction_10m === 'number' ? Math.round(cur.wind_direction_10m) : null,
      cloudCover: typeof cur.cloud_cover === 'number' ? Math.round(cur.cloud_cover) : null,
      sunriseDecimal,
      sunsetDecimal,
      descriptionBn: mapped.descriptionBn,
      isLive: true,
      updatedAt: Date.now(),
    };
  } catch {
    return createFallbackWeather();
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
