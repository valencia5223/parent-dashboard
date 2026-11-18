import { useEffect, useState } from 'react';
import { fetchArrivals, fetchStations, useFetch } from '../api.js';
import { Body, Loading, ErrorBox } from './Card.jsx';

const SHOW = 4; // 처음에 보여 줄 노선 수 (나머지는 '더 보기')
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

// 버스·지하철 카드(TransitCard)의 '버스' 탭
export default function BusSection({ pos }) {
  const stations = useFetch(() => fetchStations(pos), [pos.lat, pos.lng]);
  const [picked, setPicked] = useState(null);

  // 위치가 바뀌면 가장 가까운 정류장으로 돌아간다
  useEffect(() => { setPicked(null); }, [pos.lat, pos.lng]);

  return (
      <Body state={stations} lines={4}>
        {(list) => {
          if (list.length === 0) return <p className="empty">주변 500m 안에 정류장을 찾지 못했어요</p>;
          const station = list.find((s) => s.id === picked) || list[0];
          return (
            <>
              <div className="chips chips-scroll" role="tablist" aria-label="정류장 고르기">
                {list.slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={s.id === station.id}
                    className={`chip${s.id === station.id ? ' chip-on' : ''}`}
                    onClick={() => setPicked(s.id)}
                  >
                    {s.name}
                    <small>{s.distance != null ? `${s.distance}m` : ''}{s.no ? ` · ${s.no}` : ''}</small>
                  </button>
                ))}
              </div>
              <Arrivals key={station.id} station={station} />
            </>
          );
        }}
      </Body>
  );
}
