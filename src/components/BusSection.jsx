import { useEffect, useState } from 'react';
import { fetchArrivals, fetchRouteTimes, fetchStations, searchStations, useFetch } from '../api.js';
import { markDirty } from '../account.js';
import { Body, Loading, ErrorBox } from './Card.jsx';

const SHOW = 4; // 처음에 보여 줄 노선 수 (나머지는 '더 보기')
const STOP_SHOW = 6; // 처음에 보여 줄 정류장 수
const minText = (m) => (m == null ? '' : m <= 1 ? '곧 도착' : `${m}분`);

const CROWD = { 1: ['여유', 'crowd-1'], 2: ['보통', 'crowd-2'], 3: ['혼잡', 'crowd-3'], 4: ['매우 혼잡', 'crowd-4'] };

// 노선을 누르면 펼치는 첫차·막차·배차 간격 (서울 버스는 도착 정보에 같이 오고, 경기 버스는 노선 정보를 따로 받는다)
function BusTimes({ b }) {
  const state = useFetch(() => (b.times ? Promise.resolve(b.times) : fetchRouteTimes(b)), [b.routeId]);
  if (state.error) return <p className="bus-times">첫차·막차 정보를 받지 못했어요</p>;
  if (state.loading) return <p className="bus-times">불러오는 중…</p>;
  const t = state.data;
  if (!t || (!t.first && !t.last)) return <p className="bus-times">첫차·막차 정보가 없어요</p>;
  return (
    <p className="bus-times">
      {t.first && <span>첫차 <b>{t.first}</b></span>}
      {t.last && <span>막차 <b>{t.last}</b></span>}
      {t.alloc && <span>배차 <b>{t.alloc}</b></span>}
      <small>{t.here ? '이 정류장 기준' : `${t.from ? `${t.from} ` : '기점 '}출발 기준 · 이 정류장은 더 늦게 와요`}</small>
    </p>
  );
}

function BusRow({ b, focus }) {
  const [open, setOpen] = useState(false);
  const crowd = CROWD[b.crowd1];
  const sub = [
    b.stops1 != null && `${b.stops1}정류장 전`,
    b.seats1 != null && (b.seats1 === 0 ? '빈자리 없음' : `빈자리 ${b.seats1}`),
  ].filter(Boolean).join(' · ');
  return (
    <li className={[b.min1 != null && b.min1 <= 3 && 'bus-soon', focus && 'bus-focus'].filter(Boolean).join(' ')}>
      <button type="button" className="bus-row" onClick={() => setOpen(!open)} aria-expanded={open} title="눌러서 첫차·막차 보기">
        <div className="bus-left">
          <span className="bus-route">
            {b.route}
            {b.low1 && <span className="bus-tag tag-low" title="저상버스(계단 없음)">♿ 저상</span>}
            {b.last1 && <span className="bus-tag tag-last">막차</span>}
          </span>
          {b.dest && <span className="bus-dest">{b.dest} 방면</span>}
        </div>
        <div className="bus-right">
          <strong className="bus-min">
            {crowd && <span className={`bus-crowd ${crowd[1]}`}>{crowd[0]}</span>}
            {minText(b.min1) || b.note1 || '정보 없음'}
          </strong>
          {sub && <small>{sub}</small>}
          {b.min2 != null && <small>다음 {minText(b.min2)}{b.low2 ? ' (저상)' : ''}</small>}
        </div>
      </button>
      {open && <BusTimes b={b} />}
    </li>
  );
}

function Arrivals({ station, focus }) {
  const state = useFetch(() => fetchArrivals(station), [station.id], { interval: 30e3 });
  const [all, setAll] = useState(false);
  if (state.data == null) return state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : <Loading lines={4} />;

  // 도착 정보가 있는 노선을 먼저, 없는 노선은 뒤로
  // 검색한 버스 번호가 있으면 그 노선을 맨 위에
  const list = [...state.data].sort((a, b) => (focus ? (b.route === focus) - (a.route === focus) : 0) || (a.min1 == null) - (b.min1 == null) || (a.min1 ?? 0) - (b.min1 ?? 0));
  const shown = all ? list : list.slice(0, SHOW);
  return (
    <>
      {state.error && <p className="stale-note">최신 정보를 못 받아 이전 정보를 보여 드려요</p>}
      {list.length === 0 ? (
        <p className="empty">지금 오는 버스가 없어요</p>
      ) : (
        <ul className="bus-list">
          {shown.map((b) => <BusRow key={b.routeId} b={b} focus={b.route === focus} />)}
        </ul>
      )}
      {list.length > SHOW && (
        <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '접기' : `노선 ${list.length - SHOW}개 더 보기`}
        </button>
      )}
      <p className="card-foot">30초마다 저절로 새로 고쳐요 · 노선을 누르면 첫차·막차 · 혼잡도는 교통카드 기록으로 추정한 값</p>
    </>
  );
}

// 즐겨찾는 정류장: 계정에 저장(account.js). 지금 위치와 상관없이 맨 앞에 보여 준다.
const FAV_KEY = 'pd_bus_favs';
const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; } };
const saveFavs = (v) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮음 */ } markDirty(); };
// 가까운 두 점 사이 거리(m), 동네 안에서는 이 정도 근사로 충분
const meters = (a, b) => Math.round(Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 88000));
const distText = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);

// 즐겨찾기(가까운 순) → 나머지 주변 정류장(가까운 순)
function arrange(nearby, favs, pos) {
  const near = new Map(nearby.map((s) => [s.id, s]));
  const favList = favs
    .map((f) => {
      const s = near.get(f.id) || f; // 주변 목록에 있으면 새 정보로
      const distance = near.has(f.id) ? s.distance : (s.lat != null ? meters(s, pos) : null);
      return { ...s, distance, fav: true };
    })
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
  const favIds = new Set(favs.map((f) => f.id));
  return [...favList, ...nearby.filter((s) => !favIds.has(s.id))];
}

// 검색칸: 버스 번호(그 버스가 서는 정류장) · 정류장 번호(표지판의 5자리) · 이름 일부
const norm = (v) => String(v || '').replace(/\s/g, '').toLowerCase();
function matchStop(s, q) {
  const k = norm(q);
  if (!k) return { ok: true };
  const route = (s.routes || []).find((r) => norm(r) === k);
  if (route) return { ok: true, route };
  if (s.no && norm(s.no) === k) return { ok: true };
  if (norm(s.name).includes(k) || norm(s.toward).includes(k)) return { ok: true };
  return { ok: false };
}

function StopButton({ s, on, route, onPick }) {
  return (
    <button type="button" role="tab" aria-selected={on} className={`stop${on ? ' stop-on' : ''}`} onClick={() => onPick(s)}>
      <span className="stop-name">{s.fav && <span className="stop-star" aria-label="즐겨찾기">★ </span>}{s.name}</span>
      {s.toward && <span className="stop-dir">→ {s.toward} 방면</span>}
      <small>{[route && `${route}번 정차`, distText(s.distance), s.no].filter(Boolean).join(' · ')}</small>
    </button>
  );
}

// 버스·지하철 카드(TransitCard)의 '버스' 탭
export default function BusSection({ pos }) {
  const stations = useFetch(() => fetchStations(pos), [pos.lat, pos.lng]);
  const [picked, setPicked] = useState(null);
  const [allStops, setAllStops] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  const [q, setQ] = useState('');
  const [wide, setWide] = useState({ q: '', loading: false, list: null, error: '' }); // 근처 밖 검색
  const [extra, setExtra] = useState(null); // 넓게 찾아 고른 정류장
  // 계정에서 받은 즐겨찾기로 바뀌면 다시 읽는다
  useEffect(() => {
    const re = () => setFavs(loadFavs());
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, []);

  // 위치가 바뀌면 맨 앞(즐겨찾기 또는 가장 가까운) 정류장으로 돌아간다
  useEffect(() => { setPicked(null); setAllStops(false); setExtra(null); }, [pos.lat, pos.lng]);

  const toggleFav = (s) => {
    setFavs((list) => {
      const next = list.some((f) => f.id === s.id)
        ? list.filter((f) => f.id !== s.id)
        : [...list, { id: s.id, name: s.name, no: s.no, toward: s.toward, lat: s.lat, lng: s.lng, routes: s.routes }];
      saveFavs(next);
      return next;
    });
    setPicked(s.id); // 별을 눌러 순서가 바뀌어도 보던 정류장을 그대로
  };
  const typed = (v) => { setQ(v); if (wide.list || wide.error) setWide({ q: '', loading: false, list: null, error: '' }); };
  const searchWide = async () => {
    const text = q.trim();
    if (!text) return;
    setWide({ q: text, loading: true, list: null, error: '' });
    try { setWide({ q: text, loading: false, list: await searchStations(text, pos), error: '' }); } catch (e) { setWide({ q: text, loading: false, list: null, error: e.message || '찾지 못했어요' }); }
  };
  const pickWide = (s) => { setExtra(s); setPicked(s.id); setQ(''); setWide({ q: '', loading: false, list: null, error: '' }); };

  return (
      <Body state={stations} lines={4}>
        {(nearby) => {
          const base = arrange(nearby, favs, pos);
          // 넓게 찾아 고른 정류장은 고른 동안 맨 앞에
          const all = extra && picked === extra.id && !base.some((s) => s.id === extra.id)
            ? [{ ...extra, fav: favs.some((f) => f.id === extra.id) }, ...base]
            : base;
          const searching = q.trim() !== '';
          const matches = all.map((s) => ({ s, m: matchStop(s, q) })).filter((x) => x.m.ok);
          const list = matches.map((x) => x.s);
          const routeOf = new Map(matches.map((x) => [x.s.id, x.m.route]));
          const focusRoute = searching ? matches.find((x) => x.m.route)?.m.route : null;
          if (all.length === 0) return <p className="empty">주변 500m 안에 정류장을 찾지 못했어요</p>;
          const station = list.find((s) => s.id === picked) || list[0] || null;
          const isFav = station && favs.some((f) => f.id === station.id);
          // 찾는 중에는 모두, 아니면 고른 정류장이 접힌 쪽에 있어도 보이게
          const shown = searching || allStops ? list : list.filter((s, i) => i < STOP_SHOW || s.id === station?.id);
          return (
            <>
              <form className="stop-search" onSubmit={(e) => { e.preventDefault(); searchWide(); }} role="search">
                <input
                  type="search"
                  value={q}
                  onChange={(e) => typed(e.target.value)}
                  placeholder="버스 번호·정류장 번호·이름 (예: 15-2, 26046, 시청)"
                  aria-label="정류장 찾기"
                  enterKeyHint="search"
                />
                {searching && <button type="button" className="btn btn-sm" onClick={() => typed('')}>지우기</button>}
              </form>
              {searching && (
                <p className="stop-search-note">
                  {list.length > 0
                    ? (focusRoute ? `근처에서 ${focusRoute}번이 서는 정류장 ${list.length}곳` : `근처 정류장 ${list.length}곳`)
                    : `근처 정류장 중에 ‘${q.trim()}’ 이(가) 없어요`}
                </p>
              )}
              {shown.length > 0 && (
                <div className="stop-grid" role="tablist" aria-label="정류장 고르기">
                  {shown.map((s) => (
                    <StopButton key={s.id} s={s} on={s.id === station?.id} route={searching ? routeOf.get(s.id) : null} onPick={(x) => setPicked(x.id)} />
                  ))}
                </div>
              )}
              {!searching && list.length > STOP_SHOW && (
                <button type="button" className="btn btn-sm btn-block" onClick={() => setAllStops(!allStops)} aria-expanded={allStops}>
                  {allStops ? '정류장 접기' : `정류장 ${list.length - STOP_SHOW}곳 더 보기`}
                </button>
              )}
              {searching && !wide.list && !focusRoute && (
                <button type="button" className="btn btn-sm btn-block" onClick={searchWide} disabled={wide.loading}>
                  {wide.loading ? '찾는 중…' : `근처 밖에서도 ‘${q.trim()}’ 정류장 찾기`}
                </button>
              )}
              {wide.error && <p className="stale-note">{wide.error}</p>}
              {wide.list && (
                wide.list.length === 0 ? (
                  <p className="empty">‘{wide.q}’ 정류장을 찾지 못했어요. 버스 번호는 근처 정류장에서만 찾을 수 있어요.</p>
                ) : (
                  <>
                    <p className="stop-search-note">‘{wide.q}’ 로 찾은 정류장 (가까운 순)</p>
                    <div className="stop-grid" role="tablist" aria-label="찾은 정류장">
                      {wide.list.map((s) => (
                        <StopButton key={s.id} s={{ ...s, fav: favs.some((f) => f.id === s.id) }} on={false} onPick={pickWide} />
                      ))}
                    </div>
                  </>
                )
              )}
              {station && (
                <>
                  <div className="stop-head">
                    <p>
                      <strong>{station.name}</strong>
                      {station.toward && <small> {station.toward} 방면</small>}
                    </p>
                    <button
                      type="button"
                      className={`btn btn-sm btn-fav${isFav ? ' btn-fav-on' : ''}`}
                      onClick={() => toggleFav(station)}
                      aria-pressed={isFav}
                    >
                      {isFav ? '★ 즐겨찾기 됨' : '☆ 즐겨찾기'}
                    </button>
                  </div>
                  <Arrivals key={station.id} station={station} focus={routeOf.get(station.id) || null} />
                </>
              )}
            </>
          );
        }}
      </Body>
  );
}
