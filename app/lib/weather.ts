import { HOME_PLACE } from './calendar/local';
import {
  weatherCondition,
  type Snapshot,
  type Weather,
  type WeatherDay,
} from './widgets/model';

export type WeatherPlace = {
  name: string;
  latitude: number;
  longitude: number;
};

/**
 * The household's location: Cloudflare request geo when deployed, the widget's
 * last known coordinates otherwise, then the home fallback for local dev.
 */
export function weatherPlace(
  request?: Request,
  previous?: Weather,
): WeatherPlace {
  const cf = (
    request as
      | (Request & {
          cf?: { latitude?: string; longitude?: string; city?: string };
        })
      | undefined
  )?.cf;
  const latitude = Number(cf?.latitude),
    longitude = Number(cf?.longitude);
  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    (latitude !== 0 || longitude !== 0)
  )
    return { name: cf?.city || previous?.place || HOME_PLACE.name, latitude, longitude };
  if (
    previous &&
    Number.isFinite(previous.latitude) &&
    Number.isFinite(previous.longitude)
  )
    return {
      name: previous.place,
      latitude: previous.latitude,
      longitude: previous.longitude,
    };
  return HOME_PLACE;
}

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
  };
};

export async function fetchWeather(place: WeatherPlace): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    current:
      'temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '6',
    wind_speed_unit: 'kmh',
  });
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`,
    {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    },
  );
  if (!response.ok)
    throw Error('The weather service could not be reached.');
  const data = (await response.json()) as OpenMeteoResponse,
    current = data.current,
    daily = data.daily;
  if (
    !current ||
    !daily?.time?.length ||
    ![
      current.temperature_2m,
      current.apparent_temperature,
      current.weather_code,
      current.wind_speed_10m,
    ].every(Number.isFinite)
  )
    throw Error('The weather service returned an unexpected response.');
  const days: WeatherDay[] = daily.time.slice(0, 6).map((date, i) => {
    const code = daily.weather_code?.[i] ?? 0;
    return {
      date,
      code,
      condition: weatherCondition(code),
      high: daily.temperature_2m_max?.[i] ?? 0,
      low: daily.temperature_2m_min?.[i] ?? 0,
      rainChance: Math.round(
        daily.precipitation_probability_max?.[i] ?? 0,
      ),
    };
  });
  return {
    place: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    temperature: current.temperature_2m!,
    feelsLike: current.apparent_temperature!,
    code: current.weather_code!,
    condition: weatherCondition(current.weather_code!),
    isDay: current.is_day !== 0,
    windKmh: current.wind_speed_10m!,
    days,
  };
}

/**
 * Fetch a fresh weather snapshot. On failure the previous snapshot is kept
 * with `weatherError` set (like `calendarError`), so the last good forecast
 * stays visible and a retry is scheduled sooner than the normal cadence.
 */
export async function weatherSnapshot(
  place: WeatherPlace,
  previous?: Snapshot,
): Promise<Snapshot> {
  const staleIn = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString();
  try {
    const weather = await fetchWeather(place),
      now = new Date().toISOString();
    return {
      data: { weather },
      source: `Open-Meteo · ${weather.place}`,
      sources: [{ title: 'Open-Meteo', url: 'https://open-meteo.com/' }],
      fetchedAt: now,
      staleAt: staleIn(45),
      expiresAt: null,
    };
  } catch {
    if (previous?.data.weather)
      return {
        ...previous,
        data: {
          ...previous.data,
          weatherError: 'The latest weather could not be loaded.',
        },
        staleAt: staleIn(10),
      };
    return {
      data: { weatherError: 'The weather could not be loaded.' },
      source: 'Open-Meteo',
      sources: [],
      fetchedAt: new Date().toISOString(),
      staleAt: staleIn(10),
      expiresAt: null,
    };
  }
}
