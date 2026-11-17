import { fetchAir, fetchWeather, useFetch } from '../api.js';
import Card, { Body } from './Card.jsx';
import AirSection from './AirSection.jsx';

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

export default function WeatherCard({ pos }) {
  const state = useFetch(() => fetchWeather(pos), [pos.lat, pos.lng], { interval: 15 * 60e3 });
  // 미세먼지는 따로 받아 한쪽이 실패해도 다른 쪽은 보이게 한다
  const air = useFetch(() => fetchAir(pos), [pos.lat, pos.lng], { interval: 30 * 60e3 });
  const reloadAll = () => { state.reload(); air.reload(); };
  return (
    <Card title="날씨·미세먼지" icon="🌡️" state={state} onRefresh={reloadAll}>
      <Body state={state} lines={4}>
        {(w) => {
          const cur = w.current;
          const d = w.daily;
          const [emoji, label] = sky(cur.weather_code, cur.is_day);
          const nowIdx = Math.max(0, w.hourly.time.findIndex((t) => t >= cur.time.slice(0, 13)));
          const hours = [1, 3, 6, 9, 12].map((h) => nowIdx + h).filter((i) => i < w.hourly.time.length);
          const tips = advice(cur, d);
          return (
            <>
              <div className="weather-now">
                <span className="weather-emoji" aria-hidden>{emoji}</span>
                <div>
                  <p className="big-num">{r(cur.temperature_2m)}°</p>
                  <p className="weather-label">{label}</p>
                </div>
                <dl className="weather-facts">
                  <div><dt>체감</dt><dd>{r(cur.apparent_temperature)}°</dd></div>
                  <div><dt>최고/최저</dt><dd>{r(d.temperature_2m_max[0])}° / {r(d.temperature_2m_min[0])}°</dd></div>
                  <div><dt>비 올 확률</dt><dd>{d.precipitation_probability_max[0] ?? 0}%</dd></div>
                  <div><dt>습도·바람</dt><dd>{cur.relative_humidity_2m}% · {cur.wind_speed_10m.toFixed(1)}m/s</dd></div>
                </dl>
              </div>
              {tips.length > 0 && <p className="tip">{tips.join(' · ')}</p>}
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
              <p className="card-foot">내일 {sky(d.weather_code[1])[1]} · {r(d.temperature_2m_min[1])}° ~ {r(d.temperature_2m_max[1])}° · 비 {d.precipitation_probability_max[1] ?? 0}%</p>
            </>
          );
        }}
      </Body>
      <AirSection state={air} />
      <p className="card-foot">미세먼지는 위성·모델 예측값이라 동네 측정소 수치와 조금 다를 수 있어요</p>
    </Card>
  );
}
