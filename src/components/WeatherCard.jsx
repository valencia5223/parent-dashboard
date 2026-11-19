import { useEffect, useState } from 'react';
import { fetchAir, fetchWeather, searchPlaces, timeText, useFetch } from '../api.js';
import { markDirty } from '../account.js';
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
const WEEK_SHOW = 4; // 처음에 보여 줄 날 수 (나머지는 '더 보기')

function Week({ d }) {
  const [all, setAll] = useState(false);
  const lo = Math.min(...d.temperature_2m_min);
  const hi = Math.max(...d.temperature_2m_max);
  const span = Math.max(1, hi - lo);
  return (
    <div className="week">
      <h3 className="week-title">주간 날씨</h3>
      <ol className="week-list">
        {d.time.slice(0, all ? d.time.length : WEEK_SHOW).map((day, i) => {
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
      {d.time.length > WEEK_SHOW && (
        <button type="button" className="btn btn-sm btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '접기' : `${d.time.length - WEEK_SHOW}일 더 보기`}
        </button>
      )}
    </div>
  );
}

// 한 곳의 날씨·미세먼지
function WeatherView({ pos, refresh }) {
  const state = useFetch(() => fetchWeather(pos), [pos.lat, pos.lng], { interval: 15 * 60e3 });
  // 미세먼지는 따로 받아 한쪽이 실패해도 다른 쪽은 보이게 한다
  const airState = useFetch(() => fetchAir(pos), [pos.lat, pos.lng], { interval: 30 * 60e3 });
  // 카드의 새로고침 버튼
  useEffect(() => { if (refresh) { state.reload(); airState.reload(); } }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
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
      {state.at && <p className="card-foot">{timeText(state.at)} 기준</p>}
    </>
  );
}

// 지금 위치 + 내가 고른 도시(계정에 저장, pd_wx_cities)를 탭으로. 고른 탭은 이 기기에 기억(pd_wx_tab).
const CITY_KEY = 'pd_wx_cities';
const loadCities = () => { try { const v = JSON.parse(localStorage.getItem(CITY_KEY)); return Array.isArray(v) ? v.filter((c) => c?.id && c.lat != null) : []; } catch { return []; } };
const saveCities = (v) => { try { localStorage.setItem(CITY_KEY, JSON.stringify(v)); } catch { /* 괜찮음 */ } markDirty(); };
const savedTab = () => { try { return localStorage.getItem('pd_wx_tab') || 'here'; } catch { return 'here'; } };

export default function WeatherCard({ pos }) {
  const [cities, setCities] = useState(loadCities);
  const [tab, setTab] = useState(savedTab);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const re = () => setCities(loadCities());
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, []);
  const city = cities.find((c) => c.id === tab);
  const pick = (id) => { setTab(id); setRemoving(false); try { localStorage.setItem('pd_wx_tab', id); } catch { /* 괜찮음 */ } };
  const update = (list) => { setCities(list); saveCities(list); };
  const add = (p) => {
    const id = `c${p.lat},${p.lng}`;
    if (!cities.some((c) => c.id === id)) update([...cities, { id, name: p.name, lat: p.lat, lng: p.lng }]);
    pick(id);
    setAdding(false);
  };
  const remove = () => { update(cities.filter((c) => c.id !== city.id)); pick('here'); };

  return (
    <Card title="날씨·미세먼지" icon="🌡️" onRefresh={() => setRefresh((n) => n + 1)}>
      <div className="chips chips-scroll" role="tablist" aria-label="날씨 볼 곳">
        <button type="button" role="tab" aria-selected={!city} className={`chip${!city ? ' chip-on' : ''}`} onClick={() => pick('here')}>📍 지금 위치</button>
        {cities.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={city?.id === c.id} className={`chip${city?.id === c.id ? ' chip-on' : ''}`} onClick={() => pick(c.id)}>{c.name}</button>
        ))}
        <button type="button" className="chip chip-add" onClick={() => setAdding(true)}>＋ 도시 추가</button>
      </div>
      {city && (removing ? (
        <div className="apt-manage apt-manage-warn">
          <span>‘{city.name}’ 탭을 뺄까요?</span>
          <button type="button" className="btn btn-sm btn-danger" onClick={remove}>빼기</button>
          <button type="button" className="btn btn-sm" onClick={() => setRemoving(false)}>취소</button>
        </div>
      ) : (
        <div className="apt-manage">
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setRemoving(true)}>✕ 탭에서 빼기</button>
        </div>
      ))}
      <WeatherView key={city ? city.id : 'here'} pos={city || pos} refresh={refresh} />
      {adding && <CityPicker onPick={add} onClose={() => setAdding(false)} />}
    </Card>
  );
}

// 도시 추가 창: 이름으로 찾아 고른다(카카오 검색, 글자마다 찾지 않고 '찾기'를 눌렀을 때만)
function CityPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState({ loading: false, results: null, error: '' });
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const search = async (e) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setSt({ loading: true, results: null, error: '' });
    try { setSt({ loading: false, results: await searchPlaces(text), error: '' }); } catch (err) { setSt({ loading: false, results: null, error: err.message || '찾지 못했어요' }); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="도시 추가" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>날씨 볼 도시 추가</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <form className="place-search" onSubmit={search}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 부산, 제주시, 강릉, 대전 유성구" aria-label="도시 이름" enterKeyHint="search" autoFocus />
          <button type="submit" className="btn btn-primary" disabled={st.loading}>찾기</button>
        </form>
        {st.loading && <p className="empty">찾는 중…</p>}
        {st.error && <p className="stale-note">{st.error}</p>}
        {st.results && (st.results.length === 0 ? <p className="empty">찾지 못했어요. 시·군·구 이름으로 찾아 보세요.</p> : (
          <ul className="place-list">
            {st.results.map((p) => (
              <li key={`${p.lat},${p.lng}`}>
                <button type="button" className="place-item" onClick={() => onPick(p)}>
                  <strong>{p.name}</strong>
                  <small>{p.detail}</small>
                </button>
              </li>
            ))}
          </ul>
        ))}
        <p className="card-foot">장소 검색: 카카오맵 · 추가한 도시는 계정에 저장돼요</p>
      </div>
    </div>
  );
}
