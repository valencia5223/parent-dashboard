import { useEffect, useRef, useState } from 'react';

import { FetchError } from './sources.js';

export { fetchStations, fetchArrivals, fetchGas, fetchApt, fetchAptList, loadRegions, DEFAULT_APTS, fetchPharmacies, fetchEmergency, fetchKidsClinics, fetchMoonClinics, fetchSubwayStations, fetchSubwayArrivals, SUBWAY_LINES } from './sources.js';

export async function getJSON(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new FetchError('인터넷 연결을 확인해 주세요', 'NETWORK');
  }
  let body = null;
  try { body = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) throw new FetchError(body?.error || `불러오지 못했어요 (${res.status})`, body?.code);
  return body;
}

// 날씨·미세먼지는 키 없이 브라우저에서 바로 (Open-Meteo)
export function fetchWeather({ lat, lng }) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: '7', // 주간 날씨까지
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset',
    wind_speed_unit: 'ms',
  });
  return getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
}

export function fetchAir({ lat, lng }) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: '7', // 주간 날씨까지
    current: 'pm10,pm2_5', hourly: 'pm10,pm2_5',
  });
  return getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`);
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
