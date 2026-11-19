import { useEffect, useState } from 'react';
import { fetchArrivals, fetchStations, useFetch } from '../api.js';
import { markDirty } from '../account.js';
import { Body, Loading, ErrorBox } from './Card.jsx';

const SHOW = 4; // 처음에 보여 줄 노선 수 (나머지는 '더 보기')
const STOP_SHOW = 6; // 처음에 보여 줄 정류장 수
const minText = (m) => (m == null ? '' : m <= 1 ? '곧 도착' : `${m}분`);

function BusRow({ b }) {
  const sub = [
    b.stops1 != null && `${b.stops1}정류장 전`,
    b.seats1 != null && (b.seats1 === 0 ? '빈자리 없음' : `빈자리 ${b.seats1}`),
  ].filter(Boolean).join(' · ');
  return (
    <li className={b.min1 != null && b.min1 <= 3 ? 'bus-soon' : ''}>
      <div className="bus-left">
        <span className="bus-route">{b.route}</span>
        {b.dest && <span className="bus-dest">{b.dest} 방면</span>}
      </div>
      <div className="bus-right">
        <strong className="bus-min">{minText(b.min1) || '정보 없음'}</strong>
        {sub && <small>{sub}</small>}
        {b.min2 != null && <small>다음 {minText(b.min2)}</small>}
      </div>
    </li>
  );
}

function Arrivals({ station }) {
  const state = useFetch(() => fetchArrivals(station.id), [station.id], { interval: 30e3 });
  const [all, setAll] = useState(false);
  if (state.data == null) return state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : <Loading lines={4} />;

  // 도착 정보가 있는 노선을 먼저, 없는 노선은 뒤로
  const list = [...state.data].sort((a, b) => (a.min1 == null) - (b.min1 == null) || (a.min1 ?? 0) - (b.min1 ?? 0));
  const shown = all ? list : list.slice(0, SHOW);
  return (
    <>
      {state.error && <p className="stale-note">최신 정보를 못 받아 이전 정보를 보여 드려요</p>}
      {list.length === 0 ? (
        <p className="empty">지금 오는 버스가 없어요</p>
      ) : (
        <ul className="bus-list">
          {shown.map((b) => <BusRow key={b.routeId} b={b} />)}
        </ul>
      )}
      {list.length > SHOW && (
        <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '접기' : `노선 ${list.length - SHOW}개 더 보기`}
        </button>
      )}
      <p className="card-foot">30초마다 저절로 새로 고쳐요</p>
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

// 버스·지하철 카드(TransitCard)의 '버스' 탭
export default function BusSection({ pos }) {
  const stations = useFetch(() => fetchStations(pos), [pos.lat, pos.lng]);
  const [picked, setPicked] = useState(null);
  const [allStops, setAllStops] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  // 계정에서 받은 즐겨찾기로 바뀌면 다시 읽는다
  useEffect(() => {
    const re = () => setFavs(loadFavs());
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, []);

  // 위치가 바뀌면 맨 앞(즐겨찾기 또는 가장 가까운) 정류장으로 돌아간다
  useEffect(() => { setPicked(null); setAllStops(false); }, [pos.lat, pos.lng]);

  const toggleFav = (s) => {
    setFavs((list) => {
      const next = list.some((f) => f.id === s.id)
        ? list.filter((f) => f.id !== s.id)
        : [...list, { id: s.id, name: s.name, no: s.no, toward: s.toward, lat: s.lat, lng: s.lng }];
      saveFavs(next);
      return next;
    });
    setPicked(s.id); // 별을 눌러 순서가 바뀌어도 보던 정류장을 그대로
  };

  return (
      <Body state={stations} lines={4}>
        {(nearby) => {
          const list = arrange(nearby, favs, pos);
          if (list.length === 0) return <p className="empty">주변 500m 안에 정류장을 찾지 못했어요</p>;
          const station = list.find((s) => s.id === picked) || list[0];
          const isFav = favs.some((f) => f.id === station.id);
          // 고른 정류장이 접힌 쪽에 있어도 보이게
          const shown = allStops ? list : list.filter((s, i) => i < STOP_SHOW || s.id === station.id);
          return (
            <>
              <div className="stop-grid" role="tablist" aria-label="정류장 고르기">
                {shown.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={s.id === station.id}
                    className={`stop${s.id === station.id ? ' stop-on' : ''}`}
                    onClick={() => setPicked(s.id)}
                  >
                    <span className="stop-name">{s.fav && <span className="stop-star" aria-label="즐겨찾기">★ </span>}{s.name}</span>
                    {s.toward && <span className="stop-dir">→ {s.toward} 방면</span>}
                    <small>{[distText(s.distance), s.no].filter(Boolean).join(' · ')}</small>
                  </button>
                ))}
              </div>
              {list.length > STOP_SHOW && (
                <button type="button" className="btn btn-sm btn-block" onClick={() => setAllStops(!allStops)} aria-expanded={allStops}>
                  {allStops ? '정류장 접기' : `정류장 ${list.length - STOP_SHOW}곳 더 보기`}
                </button>
              )}
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
              <Arrivals key={station.id} station={station} />
            </>
          );
        }}
      </Body>
  );
}
