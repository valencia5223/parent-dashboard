import { Loading, ErrorBox } from './Card.jsx';

// 날씨 카드 아래쪽에 붙는 미세먼지 구역 (값은 WeatherCard 가 받아 넘김)

// 환경부 예보 등급 기준 (㎍/㎥)
const GRADES = {
  pm10: [30, 80, 150],
  pm2_5: [15, 35, 75],
};
const LEVELS = [
  { key: 'good', label: '좋음', emoji: '😊', tip: '바깥 활동하기 좋아요' },
  { key: 'normal', label: '보통', emoji: '🙂', tip: '평소처럼 지내셔도 돼요' },
  { key: 'bad', label: '나쁨', emoji: '😷', tip: '외출할 때 마스크를 쓰세요' },
  { key: 'worst', label: '매우 나쁨', emoji: '🚫', tip: '되도록 밖에 나가지 마세요' },
];
function level(kind, v) {
  const i = GRADES[kind].findIndex((max) => v <= max);
  return LEVELS[i === -1 ? 3 : i];
}

function Gauge({ name, kind, value }) {
  const lv = level(kind, value);
  return (
    <div className={`air-item air-${lv.key}`}>
      <span className="air-emoji" aria-hidden>{lv.emoji}</span>
      <div>
        <p className="air-name">{name}</p>
        <p className="air-level">{lv.label}</p>
        <p className="air-value">{Math.round(value)} ㎍/㎥</p>
      </div>
    </div>
  );
}

export default function AirSection({ state }) {
  let body;
  if (state.data == null) {
    body = state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : <Loading lines={2} />;
  } else {
    const a = state.data;
    const { pm10, pm2_5: pm25 } = a.current;
    const worst = [level('pm10', pm10), level('pm2_5', pm25)].sort((x, y) => LEVELS.indexOf(y) - LEVELS.indexOf(x))[0];
    // 앞으로 12시간 중 가장 나쁜 때
    const nowIdx = Math.max(0, a.hourly.time.findIndex((t) => t >= a.current.time.slice(0, 13)));
    const rest = a.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({ t, v: a.hourly.pm2_5[nowIdx + i] }));
    const peak = rest.reduce((m, x) => (x.v > (m?.v ?? -1) ? x : m), null);
    const peakLv = peak ? level('pm2_5', peak.v) : null;
    body = (
      <>
        {state.error && <p className="stale-note">최신 정보를 못 받아 이전 정보를 보여 드려요</p>}
        <div className="air-row">
          <Gauge name="미세먼지" kind="pm10" value={pm10} />
          <Gauge name="초미세먼지" kind="pm2_5" value={pm25} />
        </div>
        <p className="tip">{worst.tip}</p>
        {peakLv && LEVELS.indexOf(peakLv) > LEVELS.indexOf(worst) && (
          <p className="tip tip-warn">
            {Number(peak.t.slice(11, 13))}시쯤 초미세먼지가 &lsquo;{peakLv.label}&rsquo;으로 나빠질 수 있어요
          </p>
        )}
      </>
    );
  }
  return (
    <div className="air-section">
      <h3 className="section-title"><span aria-hidden>🌫️</span>미세먼지</h3>
      {body}
    </div>
  );
}
