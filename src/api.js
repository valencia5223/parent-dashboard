import { useEffect, useRef, useState } from 'react';

import { FetchError, cached, timeoutSignal } from './sources.js';
import { kmaWeather, airKorea } from './weather.js';

export { fetchStations, fetchArrivals, fetchGas, fetchApt, fetchAptList, loadRegions, DEFAULT_APTS, fetchPharmacies, fetchEmergency, fetchKidsClinics, fetchMoonClinics, fetchSubwayStations, fetchSubwayArrivals, fetchSubwayTimes, fetchRouteTimes, trainTime, stopBaseName, searchStations, SUBWAY_LINES } from './sources.js';

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

// 날씨는 기상청(단기·중기예보), 미세먼지는 에어코리아. 둘 다 /api/* 중계로 부른다(src/weather.js).
// 그쪽이 실패하면 Open-Meteo 를 바로 불러 본다(핸드폰 통신사 망에서는 막힐 때가 있어 보조로만 씀).
// 약 1km 단위로 맞추고, 이 기기에 10분 기억해 다시 열 때 바로 보여 준다.
const grid = (v) => Math.round(v * 100) / 100;
const TEN_MIN = 10 * 60e3;

async function withFallback(main, backup) {
  try {
    return await main();
  } catch (first) {
    try { return await backup(); } catch { throw first; }
  }
}

export function fetchWeather(pos) {
  const lat = grid(pos.lat);
  const lng = grid(pos.lng);
  return cached(`wx2:${lat},${lng}`, TEN_MIN, () => withFallback(() => kmaWeather(lat, lng), () => meteoWeather(lat, lng)), { persist: true });
}

export function fetchAir(pos) {
  const lat = grid(pos.lat);
  const lng = grid(pos.lng);
  return cached(`air2:${lat},${lng}`, TEN_MIN, () => withFallback(() => airKorea(lat, lng), () => meteoAir(lat, lng)), { persist: true });
}

function meteoWeather(lat, lng) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: '7', // 주간 날씨까지
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset',
    wind_speed_unit: 'ms',
  });
  return getJSON(`https://api.open-meteo.com/v1/forecast?${q}`, { timeout: 10000 });
}

function meteoAir(lat, lng) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: '2',
    current: 'pm10,pm2_5', hourly: 'pm10,pm2_5',
  });
  return getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`, { timeout: 10000 });
}

export async function reverseGeocode({ lat, lng }) {
  const q = new URLSearchParams({ latitude: lat, longitude: lng, localityLanguage: 'ko' });
  const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}`);
  return [j.city, j.locality].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ') || j.principalSubdivision || '';
}

// 카카오맵 JavaScript 키(등록한 도메인에서만 동작하는 공개 키). 빌드 환경변수로 바꿀 수 있다.
const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY || '45bf99e1706679483f873f50488085ba';
let kakaoReady = null;
function loadKakao() {
  if (!kakaoReady) {
    kakaoReady = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=services&autoload=false`;
      sc.onload = () => (window.kakao?.maps ? window.kakao.maps.load(() => resolve(window.kakao)) : reject(new Error('카카오 지도를 불러오지 못했어요')));
      sc.onerror = () => reject(new Error('카카오 지도를 불러오지 못했어요'));
      document.head.appendChild(sc);
    }).catch((e) => { kakaoReady = null; throw e; });
  }
  return kakaoReady;
}
const round4 = (v) => Math.round(Number(v) * 10000) / 10000;
// 주소(시·군·구·동·도로명) 검색과 장소(아파트·가게·역 등) 검색을 같이 해서 주소 먼저
async function kakaoSearch(text) {
  const kakao = await loadKakao();
  const svc = kakao.maps.services;
  const call = (fn) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('카카오 검색 응답이 없어요')), 8000);
    fn((data, status) => {
      clearTimeout(t);
      if (status === svc.Status.OK) resolve(data);
      else if (status === svc.Status.ZERO_RESULT) resolve([]);
      else reject(new Error('카카오 검색 실패'));
    });
  });
  const [addrs, places] = await Promise.all([
    call((cb) => new svc.Geocoder().addressSearch(text, cb, { size: 5 })),
    call((cb) => new svc.Places().keywordSearch(text, cb, { size: 10 })),
  ]);
  const list = [
    ...addrs.map((r) => ({
      lat: round4(r.y), lng: round4(r.x),
      name: r.address_type === 'REGION' || r.address_type === 'ROAD' ? r.address_name : (r.road_address?.building_name || r.address_name),
      detail: r.address_type === 'REGION' || r.address_type === 'ROAD' ? '주소' : (r.road_address?.address_name || r.address_name),
    })),
    ...places.map((r) => ({
      lat: round4(r.y), lng: round4(r.x),
      name: r.place_name,
      detail: [r.road_address_name || r.address_name, r.category_name?.split(' > ').pop()].filter(Boolean).join(' · '),
    })),
  ];
  const seen = new Set();
  return list.filter((p) => {
    const k = `${p.lat},${p.lng}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 장소·주소 검색: 카카오(아파트·가게까지) → 실패하면 OpenStreetMap
export async function searchPlaces(text) {
  try { return await kakaoSearch(text); } catch { return osmSearch(text); }
}

// OpenStreetMap Nominatim (키 없음. 이용 규칙: 1초에 한 번 이하, 입력할 때마다 찾지 말 것)
async function osmSearch(text) {
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
