import { fetchAir, useFetch } from '../api.js';
import Card, { Body } from './Card.jsx';

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
      <p className="air-name">{name}</p>
      <p className="air-emoji" aria-hidden>{lv.emoji}</p>
      <p className="air-level">{lv.label}</p>
      <p className="air-value">{Math.round(value)} ㎍/㎥</p>
    </div>
  );
}

export default function AirCard({ pos }) {
  const state = useFetch(() => fetchAir(pos), [pos.lat, pos.lng], { interval: 30 * 60e3 });
  return (
    <Card title="미세먼지" icon="🌫️" state={state} onRefresh={state.reload}>
      <Body state={state} lines={3}>
        {(a) => {
          const { pm10, pm2_5: pm25 } = a.current;
          const worst = [level('pm10', pm10), level('pm2_5', pm25)].sort((x, y) => LEVELS.indexOf(y) - LEVELS.indexOf(x))[0];
          // 오늘 남은 시간 중 가장 나쁜 때
          const nowIdx = Math.max(0, a.hourly.time.findIndex((t) => t >= a.current.time.slice(0, 13)));
          const rest = a.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({ t, v: a.hourly.pm2_5[nowIdx + i] }));
          const peak = rest.reduce((m, x) => (x.v > (m?.v ?? -1) ? x : m), null);
          const peakLv = peak ? level('pm2_5', peak.v) : null;
          return (
            <>
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
              <p className="card-foot">위성·모델 예측값이라 동네 측정소 수치와 조금 다를 수 있어요</p>
            </>
          );
        }}
      </Body>
    </Card>
  );
}
