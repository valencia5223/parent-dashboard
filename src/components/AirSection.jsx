// 날씨 카드 안의 미세먼지: 온도 오른쪽 작은 표시(AirMini) + 나쁠 때만 안내(airTips)
// 값은 WeatherCard 가 받아 넘긴다.

import { level } from '../air.js';

function Badge({ name, kind, value }) {
  const lv = level(kind, value);
  return (
    <div className={`air-badge air-${lv.key}`} title={`${name} ${Math.round(value)} ㎍/㎥`}>
      <span className="air-badge-name">{name} <small>{Math.round(value)}</small></span>
      <span className="air-badge-level"><span aria-hidden>{lv.emoji}</span> {lv.label}</span>
    </div>
  );
}

export function AirMini({ state }) {
  if (state.data == null) {
    return state.error
      ? <div className="air-mini air-mini-empty">미세먼지 정보를<br />못 받았어요</div>
      : <div className="air-mini"><div className="skeleton" /><div className="skeleton" /></div>;
  }
  const { pm10, pm2_5: pm25 } = state.data.current;
  return (
    <div className="air-mini">
      <Badge name="미세먼지" kind="pm10" value={pm10} />
      <Badge name="초미세먼지" kind="pm2_5" value={pm25} />
    </div>
  );
}
