import assert from 'node:assert/strict';
import { test } from 'node:test';
import './prepare-widget-api-test.mjs';
const { weatherPlace, fetchWeather } = await import(
  '../.wrangler/widget-api-tests/weather.mjs'
);
const { HOME_PLACE } = await import(
  '../.wrangler/widget-api-tests/local.mjs'
);

const previous = {
  place: 'Melbourne',
  latitude: -37.8,
  longitude: 144.9,
  temperature: 12,
  feelsLike: 10,
  code: 3,
  condition: 'Overcast',
  isDay: true,
  windKmh: 20,
  days: [],
};
const geoRequest = (cf) => ({ cf });

test('weather location prefers request geo, then the last fix, then home', () => {
  const fromCf = weatherPlace(
    geoRequest({ latitude: '-33.86', longitude: '151.2', city: 'Sydney' }),
    previous,
  );
  assert.deepEqual(fromCf, {
    name: 'Sydney',
    latitude: -33.86,
    longitude: 151.2,
  });
  const noGeo = weatherPlace(geoRequest({}), previous);
  assert.deepEqual(noGeo, {
    name: 'Melbourne',
    latitude: -37.8,
    longitude: 144.9,
  });
  assert.deepEqual(weatherPlace(undefined, undefined), HOME_PLACE);
  const outOfRange = weatherPlace(
    geoRequest({ latitude: '999', longitude: '151.2' }),
    previous,
  );
  assert.equal(outOfRange.name, 'Melbourne');
});

test('weather fetch maps a forecast and rejects malformed responses', async () => {
  const originalFetch = globalThis.fetch;
  const day = (i) => `2026-09-${String(22 + i).padStart(2, '0')}`;
  globalThis.fetch = async () =>
    Response.json({
      current: {
        temperature_2m: 16.3,
        apparent_temperature: 14.1,
        is_day: 1,
        weather_code: 61,
        wind_speed_10m: 18,
      },
      daily: {
        time: Array.from({ length: 6 }, (_, i) => day(i)),
        weather_code: [61, 80, 3, 0, 95, 71],
        temperature_2m_max: [18, 19, 20, 21, 15, 14],
        temperature_2m_min: [9, 10, 11, 12, 8, 7],
        precipitation_probability_max: [96, 60, 10, 0, 80, 40],
      },
    });
  try {
    const weather = await fetchWeather({
      name: 'Sydney',
      latitude: -33.86,
      longitude: 151.2,
    });
    assert.equal(weather.condition, 'Light rain');
    assert.equal(weather.days.length, 6);
    assert.equal(weather.days[0].rainChance, 96);
    assert.equal(weather.days[4].condition, 'Thunderstorm');
    assert.equal(weather.windKmh, 18);

    globalThis.fetch = async () => Response.json({ current: null });
    await assert.rejects(() => fetchWeather(previous), /unexpected/);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(() => fetchWeather(previous), /reached/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
