import { useCallback, useEffect, useState } from 'react';
import { reverseGeocode } from './api.js';
import WeatherCard from './components/WeatherCard.jsx';
import AirCard from './components/AirCard.jsx';
import BusCard from './components/BusCard.jsx';
import GasCard from './components/GasCard.jsx';
import AptCard from './components/AptCard.jsx';
import PlacePicker from './components/PlacePicker.jsx';

// 위치를 못 받으면 산본역 근처로
const DEFAULT_POS = { lat: 37.3586, lng: 126.933, source: 'default' };
const round = (v) => Math.round(v * 10000) / 10000; // 약 10m 단위로 맞춰 쓸데없는 재요청을 줄임

// 직접 고른 위치(pd_place)와 최근에 고른 곳(pd_recent_places)은 이 기기에 기억한다
const PLACE_KEY = 'pd_place';
const RECENT_KEY = 'pd_recent_places';
const RECENT_MAX = 6;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮음 */ } };
const samePlace = (a, b) => a.lat === b.lat && a.lng === b.lng;

function useLocation() {
  const saved = load(PLACE_KEY, null);
  const [pos, setPos] = useState(() => (saved ? { ...saved, source: 'manual' } : null));
  const [status, setStatus] = useState(saved ? 'manual' : 'finding'); // finding | gps | manual | denied | unsupported
  const [label, setLabel] = useState('');
  const [recent, setRecent] = useState(() => load(RECENT_KEY, []));

  const locate = useCallback(() => {
    store(PLACE_KEY, null);
    if (!navigator.geolocation) {
      setStatus('unsupported');
      setPos(DEFAULT_POS);
      return;
    }
    setStatus('finding');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: round(p.coords.latitude), lng: round(p.coords.longitude), source: 'gps' });
        setStatus('gps');
      },
      () => {
        setStatus('denied');
        setPos((p) => (p && p.source !== 'manual' ? p : DEFAULT_POS));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60e3 },
    );
  }, []);

  const pick = useCallback((place) => {
    const p = { lat: place.lat, lng: place.lng, name: place.name, detail: place.detail };
    store(PLACE_KEY, p);
    setPos({ ...p, source: 'manual' });
    setStatus('manual');
    setRecent((list) => {
      const next = [p, ...list.filter((x) => !samePlace(x, p))].slice(0, RECENT_MAX);
      store(RECENT_KEY, next);
      return next;
    });
  }, []);

  const removeRecent = useCallback((place) => {
    setRecent((list) => {
      const next = list.filter((x) => !samePlace(x, place));
      store(RECENT_KEY, next);
      return next;
    });
  }, []);

  // 처음 열 때 직접 고른 위치가 없으면 GPS 로
  useEffect(() => { if (!saved) locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS 위치는 동네 이름을 찾아 보여 준다(직접 고른 곳은 고른 이름 그대로)
  useEffect(() => {
    if (!pos || pos.source !== 'gps') return undefined;
    let alive = true;
    setLabel('');
    reverseGeocode(pos).then((l) => alive && setLabel(l)).catch(() => {});
    return () => { alive = false; };
  }, [pos]);

  return { pos, status, label, recent, locate, pick, removeRecent };
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15e3);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <p className="clock-date">{now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
      <p className="clock-time">{now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</p>
    </div>
  );
}

export default function App() {
  const { pos, status, label, recent, locate, pick, removeRecent } = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [picking, setPicking] = useState(false);

  let where;
  if (status === 'finding') where = '현재 위치를 찾는 중…';
  else if (pos?.source === 'manual') where = pos.name;
  else if (pos?.source === 'default') where = '산본역 근처 (위치를 못 받아 기본 위치로 보여 드려요)';
  else where = label || '지금 있는 곳';

  const closePicker = useCallback(() => setPicking(false), []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>우리 동네 생활정보</h1>
          <p className="where">
            <span aria-hidden>{pos?.source === 'manual' ? '📌' : '📍'}</span>
            <strong>{where}</strong>
            {pos?.source === 'gps' && <small>(지금 있는 곳)</small>}
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>위치 바꾸기</button>
          </p>
        </div>
        <Clock />
      </header>

      {pos ? (
        <main className="grid" key={refreshKey}>
          <WeatherCard pos={pos} />
          <AirCard pos={pos} />
          <BusCard pos={pos} />
          <GasCard pos={pos} />
          <AptCard />
        </main>
      ) : (
        <div className="empty big">
          <p>위치를 확인하고 있어요. 위치 사용을 묻는 창이 뜨면 &lsquo;허용&rsquo;을 눌러 주세요.</p>
          <button type="button" className="btn" onClick={() => setPicking(true)}>직접 위치 고르기</button>
        </div>
      )}

      <footer className="app-foot">
        <button type="button" className="btn" onClick={() => setRefreshKey((k) => k + 1)}>전체 새로고침</button>
        <p>날씨·미세먼지 Open-Meteo · 버스 경기도 버스정보 · 주유소 오피넷 · 실거래가 국토교통부 · 지도 검색 OpenStreetMap</p>
      </footer>

      {picking && (
        <PlacePicker
          current={pos || DEFAULT_POS}
          recent={recent}
          onPick={(p) => { pick(p); setPicking(false); }}
          onUseGps={() => { locate(); setPicking(false); }}
          onRemoveRecent={removeRecent}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
