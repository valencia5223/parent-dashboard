import { useEffect, useState } from 'react';
import { fetchArrivals, fetchStations, useFetch } from '../api.js';
import Card, { Body, Loading, ErrorBox } from './Card.jsx';

const minText = (m) => (m == null ? '' : m <= 1 ? '곧 도착' : `${m}분`);

function Arrivals({ station }) {
  const state = useFetch(() => fetchArrivals(station.id), [station.id], { interval: 30e3 });
  if (state.data == null) return state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : <Loading lines={4} />;
  const list = state.data;
  return (
    <>
      {state.error && <p className="stale-note">최신 정보를 못 받아 이전 정보를 보여 드려요</p>}
      {list.length === 0 ? (
        <p className="empty">지금 오는 버스가 없어요</p>
      ) : (
        <ul className="bus-list">
          {list.map((b) => (
            <li key={b.routeId} className={b.min1 != null && b.min1 <= 3 ? 'bus-soon' : ''}>
              <span className="bus-route">{b.route}</span>
              <span className="bus-dest">{b.dest && `${b.dest} 방면`}</span>
              <span className="bus-time">
                <strong>{minText(b.min1) || '정보 없음'}</strong>
                {b.stops1 != null && <small>{b.stops1}정류장 전</small>}
                {b.seats1 != null && <small>{b.seats1 === 0 ? '빈자리 없음' : `빈자리 ${b.seats1}`}</small>}
              </span>
              <span className="bus-next">{b.min2 != null && `다음 ${minText(b.min2)}`}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="card-foot">30초마다 저절로 새로 고쳐요</p>
    </>
  );
}

export default function BusCard({ pos }) {
  const stations = useFetch(() => fetchStations(pos), [pos.lat, pos.lng]);
  const [picked, setPicked] = useState(null);

  // 위치가 바뀌면 가장 가까운 정류장으로 돌아간다
  useEffect(() => { setPicked(null); }, [pos.lat, pos.lng]);

  return (
    <Card title="가까운 버스 정류장" icon="🚌" onRefresh={stations.reload}>
      <Body state={stations} lines={4}>
        {(list) => {
          if (list.length === 0) return <p className="empty">주변 500m 안에 정류장을 찾지 못했어요</p>;
          const station = list.find((s) => s.id === picked) || list[0];
          return (
            <>
              <div className="chips" role="tablist" aria-label="정류장 고르기">
                {list.slice(0, 4).map((s) => (
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
    </Card>
  );
}
