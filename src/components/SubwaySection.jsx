import { useEffect, useState } from 'react';
import { fetchSubwayArrivals, fetchSubwayStations, SUBWAY_LINES, useFetch } from '../api.js';
import { Body, Loading, ErrorBox } from './Card.jsx';

const ARRIVED = { 0: '진입 중', 1: '도착', 2: '출발' };

// 남은 시간: 서울 API 의 barvlDt(초)는 받은 시각(recptnDt) 기준이라 지난 시간만큼 뺀다. 0 이면 안내 문구 그대로
function whenText(t, now) {
  if (ARRIVED[t.code] && t.code !== '2') return ARRIVED[t.code];
  if (t.sec > 0) {
    const left = t.sec - (t.at ? Math.max(0, (now - t.at) / 1000) : 0);
    if (left <= 60) return '곧 도착';
    return `${Math.round(left / 60)}분 후`;
  }
  return t.msg.replace(/\[(\d+)\]번째 전역/, '$1역 전').replace(/\s*\(.*\)$/, '') || '정보 없음';
}

function Arrivals({ station }) {
  const state = useFetch(() => fetchSubwayArrivals(station.name), [station.name], { interval: 30e3 });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15e3); return () => clearInterval(t); }, []);
  if (state.data == null) return state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : <Loading lines={3} />;
  if (state.data.length === 0) return <p className="empty">지금 {station.name}역에 오는 열차 정보가 없어요(운행 시간이 아니거나 정보가 없는 역)</p>;

  // 노선별 → 방향별(상행/하행), 방향마다 먼저 오는 2대
  const lines = new Map();
  for (const t of state.data) {
    if (!lines.has(t.line)) lines.set(t.line, new Map());
    const dirs = lines.get(t.line);
    if (!dirs.has(t.dir)) dirs.set(t.dir, []);
    dirs.get(t.dir).push(t);
  }
  return (
    <>
      {state.error && <p className="stale-note">최신 정보를 못 받아 이전 정보를 보여 드려요</p>}
      {[...lines].map(([line, dirs]) => {
        const [name, color] = SUBWAY_LINES[line] || [`${line}`, '#64748b'];
        return (
          <div key={line} className="sub-line">
            <p className="sub-line-name"><span className="sub-dot" style={{ background: color }} />{name}</p>
            <div className="sub-dirs">
              {[...dirs].map(([dir, trains]) => (
                <div key={dir} className="sub-dir">
                  <p className="sub-dir-name">{dir}{trains[0]?.way && <small> · {trains[0].way}</small>}</p>
                  <ul>
                    {trains.sort((a, b) => a.order.localeCompare(b.order)).slice(0, 2).map((t) => {
                      const w = whenText(t, now);
                      const soon = w === '곧 도착' || w === '도착' || w === '진입 중' || /^1역 전|^[12]분 후/.test(w);
                      return (
                        <li key={t.id}>
                          <span className="sub-dest">{t.dest}행{t.kind && <em> {t.kind}</em>}</span>
                          <strong className={soon ? 'sub-when sub-soon' : 'sub-when'}>{w}</strong>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="card-foot">30초마다 저절로 새로 고쳐요 · 서울 열린데이터광장 실시간 도착정보</p>
    </>
  );
}

// 버스·지하철 카드(TransitCard)의 '지하철' 탭
export default function SubwaySection({ pos }) {
  const stations = useFetch(() => fetchSubwayStations(pos), [pos.lat, pos.lng]);
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [pos.lat, pos.lng]);

  return (
      <Body state={stations} lines={3}>
        {(list) => {
          if (list.length === 0) return <p className="empty">3km 안에 지하철역이 없어요</p>;
          const station = list.find((s) => s.name === picked) || list[0];
          return (
            <>
              <div className="chips chips-scroll" role="tablist" aria-label="역 고르기">
                {list.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    role="tab"
                    aria-selected={s.name === station.name}
                    className={`chip${s.name === station.name ? ' chip-on' : ''}`}
                    onClick={() => setPicked(s.name)}
                  >
                    {s.name}역
                    <small>{s.distance < 1000 ? `${s.distance}m` : `${(s.distance / 1000).toFixed(1)}km`}</small>
                  </button>
                ))}
              </div>
              <Arrivals key={station.name} station={station} />
            </>
          );
        }}
      </Body>
  );
}
