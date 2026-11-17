import { fetchAir, fetchWeather, useFetch } from '../api.js';
import Card, { Body } from './Card.jsx';
import { AirMini, airTips } from './AirSection.jsx';

// WMO 날씨 코드 → 한국어
function sky(code, isDay = 1) {
  if (code === 0) return isDay ? ['☀️', '맑음'] : ['🌙', '맑음'];
  if (code <= 2) return isDay ? ['🌤️', '구름 조금'] : ['☁️', '구름 조금'];
  if (code === 3) return ['☁️', '흐림'];
  if (code <= 48) return ['🌫️', '안개'];
  if (code <= 57) return ['🌦️', '이슬비'];
  if (code <= 67) return ['🌧️', '비'];
  if (code <= 77) return ['🌨️', '눈'];
  if (code <= 82) return ['🌧️', '소나기'];
  if (code <= 86) return ['🌨️', '눈보라'];
  return ['⛈️', '천둥번개'];
}

function advice(cur, today) {
  const tips = [];
  const t = cur.apparent_temperature;
  if (today.precipitation_probability_max?.[0] >= 50) tips.push('우산을 챙기세요');
  if (t <= -5) tips.push('아주 추워요. 두꺼운 외투와 장갑을 챙기세요');
  else if (t <= 5) tips.push('쌀쌀해요. 따뜻하게 입으세요');
  else if (t >= 31) tips.push('더워요. 물을 자주 드세요');
  if (cur.wind_speed_10m >= 9) tips.push('바람이 세요');
  return tips;
}

const r = (v) => Math.round(v);
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 주간 날씨: 요일 · 하늘 · 비 확률 · 최저~최고(이번 주 전체 범위 안에서 막대로)
function Week({ d }) {
  const lo = Math.min(...d.temperature_2m_min);
  const hi = Math.max(...d.temperature_2m_max);
  const span = Math.max(1, hi - lo);
  return (
    <div className="week">
      <h3 className="week-title">주간 날씨</h3>
      <ol className="week-list">
        {d.time.map((day, i) => {
          const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
          const name = i === 0 ? '오늘' : i === 1 ? '내일' : DAYS[dow];
          const rain = d.precipitation_probability_max[i] ?? 0;
          const min = d.temperature_2m_min[i];
          const max = d.temperature_2m_max[i];
          const [e, label] = sky(d.weather_code[i]);
          return (
            <li key={day} className={dow === 0 ? 'week-sun' : dow === 6 ? 'week-sat' : ''}>
              <span className="week-day">{name}<small>{Number(day.slice(8, 10))}일</small></span>
              <span className="week-sky" title={label}><span aria-hidden>{e}</span><span className="sr-only">{label}</span></span>
              <span className={`week-rain${rain >= 50 ? ' week-rain-hi' : ''}`}>{rain >= 20 ? `${rain}%` : ''}</span>
              <span className="week-min">{r(min)}°</span>
              <span className="week-bar" aria-hidden>
                <span style={{ left: `${((min - lo) / span) * 100}%`, right: `${((hi - max) / span) * 100}%` }} />
              </span>
              <span className="week-max">{r(max)}°</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function WeatherCard({ pos }) {
  const state = useFetch(() => fetchWeather(pos), [pos.lat, pos.lng], { interval: 15 * 60e3 });
  // 미세먼지는 따로 받아 한쪽이 실패해도 다른 쪽은 보이게 한다
  const airState = useFetch(() => fetchAir(pos), [pos.lat, pos.lng], { interval: 30 * 60e3 });
  const reloadAll = () => { state.reload(); airState.reload(); };
  return (
    <Card title="날씨·미세먼지" icon="🌡️" state={state} onRefresh={reloadAll}>
      <Body state={state} lines={4}>
        {(w) => {
          const cur = w.current;
          const d = w.daily;
          const [emoji, label] = sky(cur.weather_code, cur.is_day);
          const nowIdx = Math.max(0, w.hourly.time.findIndex((t) => t >= cur.time.slice(0, 13)));
          const hours = [1, 3, 6, 9, 12].map((h) => nowIdx + h).filter((i) => i < w.hourly.time.length);
          const air = airTips(airState);
          const tips = [...advice(cur, d), air.tip].filter(Boolean);
          return (
            <>
              <div className="weather-now">
                <span className="weather-emoji" aria-hidden>{emoji}</span>
                <div>
                  <p className="big-num">{r(cur.temperature_2m)}°</p>
                  <p className="weather-label">{label}</p>
                </div>
                <AirMini state={airState} />
                <dl className="weather-facts">
                  <div><dt>체감</dt><dd>{r(cur.apparent_temperature)}°</dd></div>
                  <div><dt>최고/최저</dt><dd>{r(d.temperature_2m_max[0])}° / {r(d.temperature_2m_min[0])}°</dd></div>
                  <div><dt>비 올 확률</dt><dd>{d.precipitation_probability_max[0] ?? 0}%</dd></div>
                  <div><dt>습도·바람</dt><dd>{cur.relative_humidity_2m}% · {cur.wind_speed_10m.toFixed(1)}m/s</dd></div>
                </dl>
              </div>
              {tips.length > 0 && <p className="tip">{tips.join(' · ')}</p>}
              {air.warn && <p className="tip tip-warn">{air.warn}</p>}
              <ol className="hourly">
                {hours.map((i) => {
                  const [e] = sky(w.hourly.weather_code[i], w.hourly.is_day[i]);
                  const hour = Number(w.hourly.time[i].slice(11, 13));
                  return (
                    <li key={i}>
                      <span className="hourly-time">{hour < 12 ? '오전' : '오후'} {hour % 12 || 12}시</span>
                      <span className="hourly-emoji" aria-hidden>{e}</span>
                      <span className="hourly-temp">{r(w.hourly.temperature_2m[i])}°</span>
                      <span className="hourly-rain">{w.hourly.precipitation_probability[i] ?? 0}%</span>
                    </li>
                  );
                })}
              </ol>
              <Week d={d} />
            </>
          );
        }}
      </Body>
    </Card>
  );
}
