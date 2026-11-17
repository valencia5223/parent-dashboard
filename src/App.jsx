import { useCallback, useEffect, useState } from 'react';
import { reverseGeocode } from './api.js';
import WeatherCard from './components/WeatherCard.jsx';
import AirCard from './components/AirCard.jsx';
import BusCard from './components/BusCard.jsx';
import GasCard from './components/GasCard.jsx';
import AptCard from './components/AptCard.jsx';

// 위치를 못 받으면 산본역 근처로
const DEFAULT_POS = { lat: 37.3586, lng: 126.933, source: 'default' };
const round = (v) => Math.round(v * 10000) / 10000; // 약 10m 단위로 맞춰 쓸데없는 재요청을 줄임

function useLocation() {
  const [pos, setPos] = useState(null);
  const [status, setStatus] = useState('finding'); // finding | gps | denied | unsupported
  const [label, setLabel] = useState('');

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported');
      setPos((p) => p || DEFAULT_POS);
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
        setPos((p) => p || DEFAULT_POS);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60e3 },
    );
  }, []);

  useEffect(() => { locate(); }, [locate]);

  useEffect(() => {
    if (!pos) return;
    let alive = true;
    reverseGeocode(pos).then((l) => alive && setLabel(l)).catch(() => alive && setLabel(''));
    return () => { alive = false; };
  }, [pos]);

  return { pos, status, label, locate };
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
  const { pos, status, label, locate } = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);

  const where =
    status === 'finding' ? '현재 위치를 찾는 중…'
      : pos?.source === 'default' ? `산본역 근처 (위치 권한이 없어 기본 위치로 보여 드려요)`
        : label || '현재 위치';

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>우리 동네 생활정보</h1>
          <p className="where">
            <span aria-hidden>📍</span> {where}
            <button type="button" className="link-btn" onClick={locate}>위치 다시 찾기</button>
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
        <p className="empty big">위치를 확인하고 있어요. 위치 사용을 묻는 창이 뜨면 &lsquo;허용&rsquo;을 눌러 주세요.</p>
      )}

      <footer className="app-foot">
        <button type="button" className="btn" onClick={() => setRefreshKey((k) => k + 1)}>전체 새로고침</button>
        <p>날씨·미세먼지 Open-Meteo · 버스 경기도 버스정보 · 주유소 오피넷 · 실거래가 국토교통부</p>
      </footer>
    </div>
  );
}
