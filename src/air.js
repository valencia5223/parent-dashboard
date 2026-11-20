// 미세먼지 등급(환경부 예보 기준)과 날씨 카드 안내 문구. 화면은 components/AirSection.jsx
// 환경부 예보 등급 기준 (㎍/㎥)
const GRADES = {
  pm10: [30, 80, 150],
  pm2_5: [15, 35, 75],
};
const LEVELS = [
  { key: 'good', label: '좋음', emoji: '😊' },
  { key: 'normal', label: '보통', emoji: '🙂' },
  { key: 'bad', label: '나쁨', emoji: '😷', tip: '미세먼지가 나빠요. 외출할 때 마스크를 쓰세요' },
  { key: 'worst', label: '매우 나쁨', emoji: '🚫', tip: '미세먼지가 매우 나빠요. 되도록 밖에 나가지 마세요' },
];
export function level(kind, v) {
  const i = GRADES[kind].findIndex((max) => v <= max);
  return LEVELS[i === -1 ? 3 : i];
}

// 지금 나쁘면 그 안내, 앞으로 12시간 안에 더 나빠지면 경고
export function airTips(state) {
  const a = state.data;
  if (!a) return { tip: null, warn: null };
  const { pm10, pm2_5: pm25 } = a.current;
  const worst = [level('pm10', pm10), level('pm2_5', pm25)].sort((x, y) => LEVELS.indexOf(y) - LEVELS.indexOf(x))[0];
  const nowIdx = Math.max(0, a.hourly.time.findIndex((t) => t >= a.current.time.slice(0, 13)));
  const rest = a.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({ t, v: a.hourly.pm2_5[nowIdx + i] }));
  const peak = rest.reduce((m, x) => (x.v > (m?.v ?? -1) ? x : m), null);
  const peakLv = peak ? level('pm2_5', peak.v) : null;
  const warn = peakLv && LEVELS.indexOf(peakLv) > LEVELS.indexOf(worst) && LEVELS.indexOf(peakLv) >= 2
    ? `${Number(peak.t.slice(11, 13))}시쯤 초미세먼지가 '${peakLv.label}'으로 나빠질 수 있어요`
    : null;
  return { tip: worst.tip || null, warn };
}
