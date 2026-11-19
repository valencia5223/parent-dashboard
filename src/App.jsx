import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { reverseGeocode } from './api.js';
import WeatherCard from './components/WeatherCard.jsx';
import TransitCard from './components/TransitCard.jsx';
import GasCard from './components/GasCard.jsx';
import AptCard from './components/AptCard.jsx';
import HealthCard from './components/HealthCard.jsx';
import LifeCard from './components/LifeCard.jsx';
import PlacePicker from './components/PlacePicker.jsx';
import { initAccount, useAccount } from './account.js';

const AccountModal = lazy(() => import('./components/AccountModal.jsx'));
initAccount();

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
const LAST_GPS_KEY = 'pd_last_gps';
const MOVE_M = 100;
// 가까운 두 점 사이 거리(m), 동네 안에서는 이 정도 근사로 충분
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 88000);

function useLocation() {
  const saved = load(PLACE_KEY, null);
  // 직접 고른 곳이 없으면 지난번 GPS 위치로 바로 보여 주고, 새 위치는 뒤에서 찾는다
  const [pos, setPos] = useState(() => (saved ? { ...saved, source: 'manual' } : load(LAST_GPS_KEY, null)));
  const [status, setStatus] = useState(saved ? 'manual' : 'finding'); // finding | gps | manual | denied | unsupported
  const [label, setLabel] = useState('');
  const [recent, setRecent] = useState(() => load(RECENT_KEY, []));

  // GPS 로 지금 있는 곳 찾기. 성공했을 때만 위치를 바꾸고, 실패하면 보던 위치를 그대로 둔다.
  const [gpsError, setGpsError] = useState('');
  const locate = useCallback(() => {
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsError('이 기기에서는 위치를 찾을 수 없어요');
      setStatus((s) => (s === 'finding' ? 'unsupported' : s));
      setPos((p) => p || DEFAULT_POS);
      return;
    }
    setStatus('finding');
    // 정확한 GPS 는 실내에서 10초 넘게 걸리기도 한다. 그래서 빠른 대략 위치(와이파이·기지국)를 먼저 쓰고,
    // 정확한 위치가 나오면 100m 넘게 차이 날 때만 바꾼다(조금씩 흔들릴 때마다 모든 카드를 다시 부르지 않게).
    let found = false;
    const use = (p) => {
      found = true;
      const next = { lat: round(p.coords.latitude), lng: round(p.coords.longitude), source: 'gps' };
      store(PLACE_KEY, null);
      store(LAST_GPS_KEY, next);
      setPos((cur) => (cur?.source === 'gps' && meters(cur, next) < MOVE_M ? cur : next));
      setStatus('gps');
    };
    const fail = (err) => {
      if (found) return; // 대략 위치라도 찾았으면 그대로 쓴다
      setGpsError(err.code === 1
        ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요'
        : '지금 위치를 찾지 못했어요. 잠시 뒤 다시 눌러 주세요');
      setPos((p) => p || DEFAULT_POS);
      setStatus((s) => (s === 'finding' ? 'done' : s));
    };
    navigator.geolocation.getCurrentPosition(use, () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60e3 });
    navigator.geolocation.getCurrentPosition(use, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
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

  return { pos, status, label, recent, gpsError, locate, pick, removeRecent };
}

// 핸드폰에서는 아래쪽 탭 바로 카드를 하나씩 본다(PC 는 모두 보임). 고른 탭은 이 기기에 기억한다.
// 다른 카드도 숨겨진 채 계속 정보를 받아 두어서 탭을 누르면 바로 보인다.
const CARD_TABS = [
  { id: 'weather', label: '날씨', icon: '🌡️' },
  { id: 'transit', label: '교통', icon: '🚏' },
  { id: 'gas', label: '주유', icon: '⛽' },
  { id: 'apt', label: '집값', icon: '🏠' },
  { id: 'health', label: '병원', icon: '💊' },
  { id: 'life', label: '달력', icon: '📅' },
];
const MTAB_KEY = 'pd_mtab';

// 조준점 모양 '현재 위치' 아이콘
function LocateIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <line x1="12" y1="1.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22.5" y2="12" />
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15e3);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <p className="clock-date">{now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</p>
      <p className="clock-time">{now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</p>
    </div>
  );
}

export default function App() {
  const { pos, status, label, recent, gpsError, locate, pick, removeRecent } = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [picking, setPicking] = useState(false);
  const acc = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);
  // 비밀번호 재설정 링크로 들어오면 새 비밀번호 창을 연다
  useEffect(() => { if (acc.recovery) setAccountOpen(true); }, [acc.recovery]);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const [mtab, setMtab] = useState(() => {
    const v = load(MTAB_KEY, 'weather');
    return CARD_TABS.some((t) => t.id === v) ? v : 'weather';
  });
  const pickTab = (id) => {
    setMtab(id);
    store(MTAB_KEY, id);
    window.scrollTo({ top: 0 });
  };
  // PC: 위쪽 바로가기 줄을 누르면 그 카드로 스크롤 (slot 은 display: contents 라 안의 카드로 간다)
  const jumpTo = (id) => {
    const el = document.querySelector(`[data-card="${id}"] > *`);
    if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  const slot = (id) => `slot${mtab === id ? ' slot-on' : ''}`;

  let where;
  if (status === 'finding' && !pos) where = '현재 위치를 찾는 중…';
  else if (pos?.source === 'manual') where = pos.name;
  else if (pos?.source === 'default') where = '산본역 근처 (기본 위치)';
  else where = label || '지금 있는 곳';

  const closePicker = useCallback(() => setPicking(false), []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="head-main">
          <h1>우리 동네 생활정보</h1>
          <p className="where">
            <span aria-hidden>{pos?.source === 'manual' ? '📌' : '📍'}</span>
            <strong className="where-name" title={where}>{where}</strong>
            {pos?.source === 'gps' && <small className="where-note">(지금 있는 곳)</small>}
            <span className="where-tools">
              <button
                type="button"
                className={['btn', 'btn-sm', 'btn-locate', pos?.source === 'gps' && 'btn-on', status === 'finding' && 'is-finding'].filter(Boolean).join(' ')}
                onClick={locate}
                disabled={status === 'finding'}
                aria-label="지금 있는 곳 찾기"
                title="지금 있는 곳 찾기"
              >
                <LocateIcon />
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>위치 바꾸기</button>
            </span>
          </p>
          {gpsError && <p className="gps-error" role="alert">{gpsError}</p>}
        </div>
        <div className="head-side">
          <Clock />
          <button
            type="button"
            className={`btn btn-sm btn-account${acc.user ? ' btn-on' : ''}`}
            onClick={() => setAccountOpen(true)}
            title={acc.user ? `${acc.user.email} 로 로그인됨` : '로그인하면 내 일정·단지가 계정에 저장돼요'}
          >
            <span aria-hidden>👤</span> {acc.user ? '내 계정' : '로그인'}
          </button>
        </div>
      </header>
      {accountOpen && <Suspense fallback={null}><AccountModal onClose={closeAccount} /></Suspense>}

      {pos ? (
        <>
        <nav className="jump-bar" aria-label="카드로 바로 가기">
          {CARD_TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => jumpTo(t.id)}>
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
        <main className="grid" key={refreshKey}>
          <div className={slot('weather')} data-card="weather"><WeatherCard pos={pos} /></div>
          <div className={slot('transit')} data-card="transit"><TransitCard pos={pos} /></div>
          <div className={slot('gas')} data-card="gas"><GasCard pos={pos} /></div>
          <div className={slot('apt')} data-card="apt"><AptCard pos={pos} /></div>
          <div className={slot('health')} data-card="health"><HealthCard pos={pos} /></div>
          <div className={slot('life')} data-card="life"><LifeCard /></div>
        </main>
        </>
      ) : (
        <div className="empty big">
          <p>위치를 확인하고 있어요. 위치 사용을 묻는 창이 뜨면 &lsquo;허용&rsquo;을 눌러 주세요.</p>
          <button type="button" className="btn" onClick={() => setPicking(true)}>직접 위치 고르기</button>
        </div>
      )}

      {pos && (
        <nav className="mobile-tabbar" aria-label="카드 고르기">
          {CARD_TABS.map((t) => (
            <button key={t.id} type="button" className={mtab === t.id ? 'on' : ''} onClick={() => pickTab(t.id)} aria-current={mtab === t.id ? 'page' : undefined}>
              <span className="mtab-icon" aria-hidden>{t.icon}</span>
              <span className="mtab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      )}

      <footer className="app-foot">
        <button type="button" className="btn" onClick={() => setRefreshKey((k) => k + 1)}>전체 새로고침</button>
        <p>날씨 기상청 · 미세먼지 에어코리아 · 버스 경기도 버스정보 · 지하철 서울 열린데이터광장·OpenStreetMap · 주유소 오피넷 · 약국·병원·응급실 국립중앙의료원 · 실거래가 국토교통부 · 지도 검색 OpenStreetMap</p>
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
