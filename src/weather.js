// 기상청(공공데이터포털) 날씨와 에어코리아 미세먼지를 받아, 날씨 카드가 쓰는 모양(Open-Meteo 와 같은 모양)으로 바꾼다.
//   /api/kma/*      → https://apis.data.go.kr/1360000/*   (기상청 단기예보·중기예보)
//   /api/airkorea/* → https://apis.data.go.kr/B552584/*   (에어코리아 대기오염정보·측정소정보)
// 둘 다 Render rewrite(render.yaml) / Vite proxy(vite.config.js)로 중계한다.
import { FetchError, cached, checkGatewayError, dataKey, getText, num, toArr } from './sources.js';

const HOUR = 3600e3;

// ---------- 공통 ----------
async function dataGo(path, params) {
  const key = dataKey();
  if (!key) throw new FetchError('공공데이터포털 키가 설정되지 않았어요', 'NO_KEY');
  const q = new URLSearchParams({ serviceKey: key, ...params });
  const text = await getText(`${path}?${q}`);
  checkGatewayError(text);
  let j;
  try { j = JSON.parse(text); } catch { throw new FetchError('날씨 정보를 읽지 못했어요'); }
  const r = j.response || j;
  const code = String(r.header?.resultCode ?? '00');
  if (code === '03') return []; // 자료 없음
  if (code !== '00') throw new FetchError(r.header?.resultMsg || `기상청 오류 (${code})`);
  return toArr(r.body?.items?.item ?? r.body?.items);
}

// 한국 시간 기준 날짜·시각 (기기 시간대와 상관없이)
const kst = (t = Date.now()) => new Date(t + 9 * HOUR);
const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const isoDay = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // 20261118 → 2026-11-18
const addDays = (s, n) => ymd(new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n) + 0));

// ---------- 위경도 → 기상청 격자 (기상청 제공 LCC 변환식) ----------
function toGrid(lat, lng) {
  const RE = 6371.00877 / 5.0;
  const DEG = Math.PI / 180;
  const slat1 = 30 * DEG; const slat2 = 60 * DEG; const olon = 126 * DEG; const olat = 38 * DEG;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (sf ** sn * Math.cos(slat1)) / sn;
  const ro = (RE * sf) / Math.tan(Math.PI * 0.25 + olat * 0.5) ** sn;
  const ra = (RE * sf) / Math.tan(Math.PI * 0.25 + lat * DEG * 0.5) ** sn;
  let theta = lng * DEG - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
}

// ---------- 하늘 상태 → 날씨 카드가 쓰는 WMO 코드 ----------
// PTY(강수형태) 1 비 2 비/눈 3 눈 4 소나기 5 빗방울 6 빗방울눈날림 7 눈날림, SKY 1 맑음 3 구름많음 4 흐림
const PTY_CODE = { 1: 63, 2: 68, 3: 73, 4: 80, 5: 51, 6: 56, 7: 71 };
const SKY_CODE = { 1: 0, 3: 2, 4: 3 };
const wmo = (sky, pty) => PTY_CODE[pty] ?? SKY_CODE[sky] ?? 0;
// 중기예보 문장('구름많고 비', '흐리고 비/눈' …) → WMO 코드
function wmoText(wf = '') {
  if (wf.includes('소나기')) return 80;
  if (wf.includes('비/눈') || wf.includes('눈/비')) return 68;
  if (wf.includes('눈')) return 73;
  if (wf.includes('비')) return 63;
  if (wf.startsWith('흐')) return 3;
  if (wf.includes('구름')) return 2;
  return 0;
}
const RAINY = (c) => c >= 51;

// 해가 떠 있는지 (태양 고도 계산, 몇 분 오차는 괜찮음)
function isDay(lat, lng, utcMs) {
  const d = new Date(utcMs);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (utcMs - start) / 864e5;
  const g = (2 * Math.PI / 365) * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + eqt + 4 * lng;
  const ha = ((minutes / 4) - 180) * Math.PI / 180;
  const la = lat * Math.PI / 180;
  const elev = Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha));
  return elev > -0.833 * Math.PI / 180 ? 1 : 0;
}
// '20261118' + '1500' (한국 시간) → UTC ms
const kstMs = (date, time) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4)) - 9 * HOUR;

// 겨울 체감온도(기상청 식). 10도 넘거나 바람이 약하면 기온 그대로
function feels(t, ms) {
  const v = ms * 3.6;
  if (t == null || t > 10 || v < 4.8) return t;
  return 13.12 + 0.6215 * t - 11.37 * v ** 0.16 + 0.3965 * v ** 0.16 * t;
}

// ---------- 단기예보 (오늘~3일 뒤, 1시간 간격) ----------
const VILAGE_BASES = [2, 5, 8, 11, 14, 17, 20, 23]; // 발표 시각, 10분쯤 뒤부터 받을 수 있다

function vilage(g, date, time) {
  return cached(`kma:v:${g.nx},${g.ny}:${date}${time}`, 3 * HOUR, () => dataGo('/api/kma/VilageFcstInfoService_2.0/getVilageFcst', {
    pageNo: '1', numOfRows: '1500', dataType: 'JSON', base_date: date, base_time: time, nx: String(g.nx), ny: String(g.ny),
  }));
}

// 가장 최근 발표분 + 오늘 02시 발표분(오늘 최저·최고와 지나간 시간까지 들어 있음)을 합친다
async function shortTerm(g) {
  const now = kst(Date.now() - 15 * 60e3);
  const today = ymd(now);
  const h = now.getUTCHours();
  const lastBase = [...VILAGE_BASES].reverse().find((b) => b <= h);
  const latest = lastBase != null ? [today, `${String(lastBase).padStart(2, '0')}00`] : [addDays(today, -1), '2300'];
  const jobs = [vilage(g, ...latest)];
  if (lastBase != null && lastBase !== 2) jobs.push(vilage(g, today, '0200').catch(() => []));
  const [fresh, early = []] = await Promise.all(jobs);
  if (!fresh.length) throw new FetchError('기상청 예보가 아직 없어요. 잠시 뒤 다시 눌러 주세요');
  const slots = new Map(); // 'YYYYMMDDHHmm' → { TMP, POP, SKY, PTY, ... }
  const put = (items) => {
    for (const it of items) {
      const k = it.fcstDate + it.fcstTime;
      if (!slots.has(k)) slots.set(k, { date: it.fcstDate, time: it.fcstTime });
      slots.get(k)[it.category] = it.fcstValue;
    }
  };
  put(early);
  put(fresh); // 최근 발표가 덮어쓴다
  return [...slots.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ---------- 초단기실황 (지금 관측값) ----------
async function nowcast(g) {
  const t = kst(Date.now() - 45 * 60e3); // 정시 관측은 40분쯤 뒤에 나온다
  const date = ymd(t);
  const time = `${String(t.getUTCHours()).padStart(2, '0')}00`;
  const items = await cached(`kma:n:${g.nx},${g.ny}:${date}${time}`, HOUR, () => dataGo('/api/kma/VilageFcstInfoService_2.0/getUltraSrtNcst', {
    pageNo: '1', numOfRows: '20', dataType: 'JSON', base_date: date, base_time: time, nx: String(g.nx), ny: String(g.ny),
  }));
  const o = {};
  for (const it of items) o[it.category] = num(it.obsrValue);
  return o;
}

// ---------- 중기예보 (4~10일 뒤) ----------
// 기온 예보 지역(도시) — 가장 가까운 곳을 쓴다. 코드는 기상청 중기기온 지역 코드(모두 응답 확인함).
const MID_CITIES = [
  ['11B10101', 37.5665, 126.978], ['11B20201', 37.4563, 126.7052], ['11B20601', 37.2636, 127.0286], ['11B20605', 37.42, 127.1265],
  ['11B20602', 37.3943, 126.9568], ['11B10103', 37.4786, 126.8646], ['11B10102', 37.4292, 126.9876], ['11B20610', 37.3616, 126.9352],
  ['11B20609', 37.3448, 126.9683], ['11B20203', 37.3219, 126.8309], ['11B20202', 37.38, 126.8029], ['11B20204', 37.5034, 126.766],
  ['11B20302', 37.6584, 126.832], ['11B20305', 37.76, 126.78], ['11B20301', 37.7381, 127.0337], ['11B20612', 37.2411, 127.1776],
  ['11B20604', 37.1995, 126.8312], ['11B20606', 36.9921, 127.1129], ['11B20603', 37.1498, 127.0772], ['11B20701', 37.272, 127.435],
  ['11B20703', 37.2984, 127.6371], ['11B20503', 37.4917, 127.4875], ['11B20502', 37.636, 127.2165], ['11B20501', 37.5943, 127.1296],
  ['11B20504', 37.5393, 127.2149], ['11B20702', 37.4295, 127.2551], ['11B20102', 37.6153, 126.7156], ['11D10301', 37.8813, 127.7298],
  ['11D10401', 37.3422, 127.9202], ['11D20501', 37.7519, 128.8761], ['11C20401', 36.3504, 127.3845], ['11C10301', 36.6424, 127.489],
  ['11C20404', 36.48, 127.289], ['11C20301', 36.8151, 127.1139], ['11F10201', 35.8242, 127.148], ['11F20501', 35.1595, 126.8526],
  ['21F20801', 34.8118, 126.3922], ['11F20401', 34.7604, 127.6622], ['11H10701', 35.8714, 128.6014], ['11H20201', 35.1796, 129.0756],
  ['11H20101', 35.5384, 129.3114], ['11H20301', 35.2281, 128.6811], ['11H10201', 36.019, 129.3435], ['11H10501', 36.5684, 128.7294],
  ['11G00201', 33.4996, 126.5312], ['11G00401', 33.2541, 126.56],
];
// 하늘·비 예보 지역(광역)
function landRegion(cityCode) {
  if (cityCode.startsWith('11B')) return '11B00000';
  if (cityCode.startsWith('11D1')) return '11D10000';
  if (cityCode.startsWith('11D2')) return '11D20000';
  if (cityCode.startsWith('11C1')) return '11C10000';
  if (cityCode.startsWith('11C2')) return '11C20000';
  if (cityCode.startsWith('11F1')) return '11F10000';
  if (cityCode.startsWith('11H1')) return '11H10000';
  if (cityCode.startsWith('11H2')) return '11H20000';
  if (cityCode.startsWith('11G')) return '11G00000';
  return '11F20000'; // 광주·전남(21F 포함)
}
function nearestCity(lat, lng) {
  let best = MID_CITIES[0]; let d0 = Infinity;
  for (const c of MID_CITIES) {
    const d = (c[1] - lat) ** 2 + ((c[2] - lng) * 0.8) ** 2;
    if (d < d0) { d0 = d; best = c; }
  }
  return best[0];
}

async function midTerm(lat, lng) {
  const now = kst(Date.now() - 30 * 60e3); // 06시·18시 발표
  const h = now.getUTCHours();
  const today = ymd(now);
  const tmFc = h >= 18 ? `${today}1800` : h >= 6 ? `${today}0600` : `${addDays(today, -1)}1800`;
  const city = nearestCity(lat, lng);
  const land = landRegion(city);
  const get = (op, regId) => cached(`kma:m:${op}:${regId}:${tmFc}`, 12 * HOUR, () => dataGo(`/api/kma/MidFcstInfoService/${op}`, {
    pageNo: '1', numOfRows: '10', dataType: 'JSON', regId, tmFc,
  }));
  const [ta, ld] = await Promise.all([get('getMidTa', city), get('getMidLandFcst', land)]);
  const t = ta[0] || {};
  const l = ld[0] || {};
  const days = [];
  for (let n = 4; n <= 10; n++) {
    const min = num(t[`taMin${n}`]);
    const max = num(t[`taMax${n}`]);
    if (min == null || max == null) continue;
    const am = l[`wf${n}Am`]; const pm = l[`wf${n}Pm`];
    const codes = [am, pm, l[`wf${n}`]].filter(Boolean).map(wmoText);
    const rain = Math.max(...[l[`rnSt${n}Am`], l[`rnSt${n}Pm`], l[`rnSt${n}`]].map((v) => num(v) ?? 0));
    days.push({
      date: addDays(tmFc.slice(0, 8), n),
      min, max, rain,
      code: codes.find(RAINY) ?? codes[codes.length - 1] ?? 0,
    });
  }
  return days;
}

// ---------- 날씨 카드가 쓰는 모양으로 ----------
export async function kmaWeather(lat, lng) {
  const g = toGrid(lat, lng);
  const [slots, obs, mid] = await Promise.all([
    shortTerm(g),
    nowcast(g).catch(() => ({})), // 실황이 없으면 예보 값으로
    midTerm(lat, lng).catch(() => []), // 중기예보가 없으면 3일 뒤까지만
  ]);
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [] };
  for (const s of slots) {
    if (s.TMP == null) continue;
    hourly.time.push(`${isoDay(s.date)}T${s.time.slice(0, 2)}:00`);
    hourly.temperature_2m.push(num(s.TMP));
    hourly.precipitation_probability.push(num(s.POP) ?? 0);
    hourly.weather_code.push(wmo(num(s.SKY), num(s.PTY)));
    hourly.is_day.push(isDay(lat, lng, kstMs(s.date, s.time)));
  }

  // 지금: 관측값(기온·습도·바람·비) + 이번 시간 예보(하늘)
  const n = kst();
  const nowKey = `${isoDay(ymd(n))}T${String(n.getUTCHours()).padStart(2, '0')}:00`;
  let i = hourly.time.indexOf(nowKey);
  if (i === -1) i = 0;
  const slot = slots.find((s) => `${isoDay(s.date)}T${s.time.slice(0, 2)}:00` === hourly.time[i]) || {};
  const temp = obs.T1H ?? hourly.temperature_2m[i];
  const wind = obs.WSD ?? num(slot.WSD) ?? 0;
  const pty = obs.PTY ?? num(slot.PTY);
  const current = {
    time: nowKey,
    temperature_2m: temp,
    apparent_temperature: feels(temp, wind),
    relative_humidity_2m: obs.REH ?? num(slot.REH) ?? 0,
    wind_speed_10m: wind,
    precipitation: obs.RN1 ?? 0,
    weather_code: wmo(num(slot.SKY), pty),
    is_day: isDay(lat, lng, Date.now()),
  };

  // 하루씩: 단기예보 날은 시간별 값으로, 그 뒤는 중기예보로
  const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], weather_code: [] };
  const byDate = new Map();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  const todayYmd = ymd(n);
  for (const [date, list] of byDate) {
    if (date < todayYmd) continue;
    const temps = list.map((s) => num(s.TMP)).filter((v) => v != null);
    const tmn = list.map((s) => num(s.TMN)).find((v) => v != null);
    const tmx = list.map((s) => num(s.TMX)).find((v) => v != null);
    if (!temps.length && tmn == null) continue;
    if (list.length < 12 && tmn == null && date !== todayYmd) continue; // 끝자락에 몇 시간만 있는 날은 중기예보로
    const day = list.filter((s) => s.time >= '0600' && s.time <= '2100');
    const codes = (day.length ? day : list).map((s) => wmo(num(s.SKY), num(s.PTY)));
    const counts = {};
    for (const c of codes) counts[c] = (counts[c] || 0) + 1;
    daily.time.push(isoDay(date));
    daily.temperature_2m_min.push(Math.min(tmn ?? Infinity, ...temps));
    daily.temperature_2m_max.push(Math.max(tmx ?? -Infinity, ...temps));
    daily.precipitation_probability_max.push(Math.max(0, ...list.map((s) => num(s.POP) ?? 0)));
    daily.weather_code.push(codes.find(RAINY) ?? Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]));
  }
  for (const d of mid) {
    const iso = isoDay(d.date);
    if (daily.time.includes(iso) || daily.time.length >= 7) continue;
    daily.time.push(iso);
    daily.temperature_2m_min.push(d.min);
    daily.temperature_2m_max.push(d.max);
    daily.precipitation_probability_max.push(d.rain);
    daily.weather_code.push(d.code);
  }
  return { source: 'kma', current, hourly, daily };
}

// ---------- 에어코리아 미세먼지 ----------
// 가까운 측정소(측정소정보 API, 좌표는 TM 중부원점)에서 실시간 값을 받는다. 값이 '-'(통신장애)면 다음 측정소로.
const TM_MID = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

async function nearbyStations(lat, lng) {
  return cached(`ak:near:${lat},${lng}`, 7 * 24 * HOUR, async () => {
    const { default: proj4 } = await import('proj4');
    const [x, y] = proj4('WGS84', TM_MID, [lng, lat]);
    const list = await dataGo('/api/airkorea/MsrstnInfoInqireSvc/getNearbyMsrstnList', {
      returnType: 'json', tmX: x.toFixed(1), tmY: y.toFixed(1), ver: '1.1',
    });
    return list.map((s) => s.stationName).filter(Boolean).slice(0, 3);
  }, { persist: true });
}

export async function airKorea(lat, lng) {
  const names = await nearbyStations(lat, lng);
  if (!names.length) throw new FetchError('가까운 측정소를 찾지 못했어요');
  const val = (v) => (v == null || v === '-' || v === '' ? null : Number(v));
  let pm10 = null; let pm25 = null; let time = ''; let station = '';
  for (const name of names) {
    const items = await dataGo('/api/airkorea/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty', {
      returnType: 'json', numOfRows: '3', pageNo: '1', stationName: name, dataTerm: 'DAILY', ver: '1.3',
    }).catch(() => []);
    // 가장 최근 시간부터, 값이 있는 것
    const p10 = items.map((it) => val(it.pm10Value)).find((v) => v != null);
    const p25 = items.map((it) => val(it.pm25Value)).find((v) => v != null);
    if (pm10 == null && p10 != null) pm10 = p10;
    if (pm25 == null && p25 != null) pm25 = p25;
    if (!time && items[0]?.dataTime) { time = items[0].dataTime; station = name; }
    if (pm10 != null && pm25 != null) break;
  }
  if (pm10 == null || pm25 == null) throw new FetchError('측정소 값이 지금 비어 있어요');
  // 에어코리아 실시간에는 앞으로의 시간별 예보가 없어서 hourly 는 비워 둔다(나빠짐 경고는 안 뜸)
  return { source: 'airkorea', station, current: { time: time.replace(' ', 'T'), pm10, pm2_5: pm25 }, hourly: { time: [], pm2_5: [] } };
}
