import { useEffect, useRef, useState } from 'react';

import { FetchError, cached } from './sources.js';

export { fetchStations, fetchArrivals, fetchGas, fetchApt, fetchAptList, loadRegions, DEFAULT_APTS, fetchPharmacies, fetchEmergency, fetchKidsClinics, fetchMoonClinics, fetchSubwayStations, fetchSubwayArrivals, SUBWAY_LINES } from './sources.js';

// AbortSignal.timeout 이 없는 오래된 핸드폰 브라우저도 있어서 직접 만든다
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export async function getJSON(url, { timeout = 20000 } = {}) {
  let res;
  try {
    res = await fetch(url, { signal: timeoutSignal(timeout) });
  } catch (e) {
    throw new FetchError(e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? '응답이 너무 늦어요. 잠시 뒤 다시 눌러 주세요'
      : '인터넷 연결을 확인해 주세요', 'NETWORK');
  }
  let body = null;
  try { body = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) {
    // Open-Meteo 는 { error: true, reason: '...' } 로 알려 준다
    const msg = typeof body?.error === 'string' ? body.error : body?.reason;
    throw new FetchError(res.status === 429 ? '요청이 많아 잠시 막혔어요(429)' : `${msg || '불러오지 못했어요'} (${res.status})`, body?.code);
  }
  return body;
}

// Open-Meteo 를 핸드폰에서 바로 부르면 통신사 망(여러 사람이 같은 IP 를 씀)에서 막히거나 늦을 때가 있다.
// 8초 안에 안 되면 우리 사이트를 거쳐(render.yaml 의 /api/meteo/* rewrite) 한 번 더 부른다.
async function meteo(host, path) {
  try {
    return await getJSON(`https://${host}${path}`, { timeout: 8000 });
  } catch (first) {
    let j = null;
    try { j = await getJSON(`/api/meteo/${host}${path}`); } catch { /* 처음 오류를 보여 준다 */ }
    if (!j?.current) throw first; // 중계가 빠져 index.html 이 오면 json 이 아니다
    return j;
  }
}

// 날씨·미세먼지는 키 없이 브라우저에서 바로 (Open-Meteo)
// 예보 격자가 수 km 라 약 1km 단위로 맞추고, 이 기기에 10분 기억해 다시 열 때 바로 보여 준다.
const grid = (v) => Math.round(v * 100) / 100;
const TEN_MIN = 10 * 60e3;

export function fetchWeather(pos) {
  const lat = grid(pos.lat);
  const lng = grid(pos.lng);
  return cached(`wx:${lat},${lng}`, TEN_MIN, () => getWeather(lat, lng), { persist: true });
}

export function fetchAir(pos) {
  const lat = grid(pos.lat);
  const lng = grid(pos.lng);
  return cached(`air:${lat},${lng}`, TEN_MIN, () => getAir(lat, lng), { persist: true });
}

function getWeather(lat, lng) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: '7', // 주간 날씨까지
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset',
    wind_speed_unit: 'ms',
  });
  return meteo('api.open-meteo.com', `/v1/forecast?${q}`);
}

function getAir(lat, lng) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: '7', // 주간 날씨까지
    current: 'pm10,pm2_5', hourly: 'pm10,pm2_5',
  });
  return meteo('air-quality-api.open-meteo.com', `/v1/air-quality?${q}`);
}

export async function reverseGeocode({ lat, lng }) {
  const q = new URLSearchParams({ latitude: lat, longitude: lng, localityLanguage: 'ko' });
  const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}`);
  return [j.city, j.locality].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ') || j.principalSubdivision || '';
}

// 장소·주소 검색 (OpenStreetMap Nominatim, 키 없음. 이용 규칙: 1초에 한 번 이하, 입력할 때마다 찾지 말 것)
export async function searchPlaces(text) {
  const q = new URLSearchParams({
    q: text, format: 'jsonv2', countrycodes: 'kr', 'accept-language': 'ko', addressdetails: '1', limit: '6',
  });
  const list = await getJSON(`https://nominatim.openstreetmap.org/search?${q}`);
  const seen = new Set();
  return list
    .map((r) => {
      const a = r.address || {};
      const area = [a.province || a.state, a.city || a.county, a.borough, a.suburb || a.quarter || a.village || a.town]
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(' ');
      const name = r.name || r.display_name.split(',')[0];
      return {
        lat: Math.round(Number(r.lat) * 10000) / 10000,
        lng: Math.round(Number(r.lon) * 10000) / 10000,
        name,
        detail: area || r.display_name,
      };
    })
    .filter((p) => {
      const k = `${p.name}|${p.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// 불러오기 + (선택) 주기적 새로고침. 새로고침 중에는 이전 값을 그대로 보여 준다.
export function useFetch(fn, deps, { interval = 0, enabled = true } = {}) {
  const [state, setState] = useState({ loading: enabled, data: null, error: null, at: null });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = async (showLoading) => {
      if (showLoading) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fnRef.current();
        if (alive) setState({ loading: false, data, error: null, at: new Date() });
      } catch (error) {
        if (alive) setState((s) => ({ ...s, loading: false, error }));
      }
    };
    run(true);
    const timer = interval ? setInterval(() => { if (!document.hidden) run(false); }, interval) : null;
    const onVisible = () => { if (!document.hidden && interval) run(false); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

export const timeText = (d) => (d ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '');
