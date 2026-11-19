// 키가 필요한 공공 API 를 브라우저에서 부른다.
// 브라우저가 직접 부르면 CORS 로 막히므로 같은 주소의 /api/* 로 부르고,
// 배포에서는 Render rewrite(render.yaml), 개발에서는 Vite proxy(vite.config.js)가 원래 주소로 넘긴다.
//   /api/gbis/*   → https://apis.data.go.kr/6410000/*   (경기도 버스)
//   /api/rtms/*   → https://apis.data.go.kr/1613000/*   (국토부 실거래가)
//   /api/opinet/* → https://www.opinet.co.kr/api/*     (오피넷)
//   /api/kma/*, /api/airkorea/* → 날씨·미세먼지 (src/weather.js)
//   /api/seoulbus/* → http://ws.bus.go.kr/api/rest/*   (서울 버스, 공공데이터포털 키, http 만 됨)
//   /api/seoulapi/* → http://openapi.seoul.go.kr:8088/* (서울 열린데이터광장: 지하철 시간표, 지하철 키)
// 키는 빌드할 때 환경변수(VITE_DATA_GO_KR_KEY, VITE_OPINET_KEY)로 들어와 화면 코드에 포함된다.
// 정적 사이트라 숨길 수 없으므로, 문제가 생기면 키를 재발급하면 된다.

export class FetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
const needKey = (name) => new FetchError(`${name} 키가 설정되지 않았어요`, 'NO_KEY');

// 공공데이터포털은 '인코딩' 키와 '디코딩' 키를 준다. 어느 쪽을 넣어도 되게 디코딩 키로 맞춘다.
export function dataKey() {
  const k = (import.meta.env.VITE_DATA_GO_KR_KEY || '').trim();
  if (!k) return '';
  try { return k.includes('%') ? decodeURIComponent(k) : k; } catch { return k; }
}
const opinetKey = () => (import.meta.env.VITE_OPINET_KEY || '').trim();

// ---------- 캐시: 메모리 + (오래 둘 것은) localStorage ----------
const mem = new Map();
export async function cached(key, ttlMs, fn, { persist = false } = {}) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (hit?.p) return hit.p;
  if (persist) {
    try {
      const s = JSON.parse(localStorage.getItem(`pd_cache:${key}`) || 'null');
      if (s && Date.now() - s.t < ttlMs) { mem.set(key, s); return s.v; }
    } catch { /* 저장소를 못 써도 괜찮음 */ }
  }
  const p = fn();
  mem.set(key, { ...hit, p });
  try {
    const v = await p;
    const entry = { t: Date.now(), v };
    mem.set(key, entry);
    if (persist) { try { localStorage.setItem(`pd_cache:${key}`, JSON.stringify(entry)); } catch { /* 가득 참 */ } }
    return v;
  } catch (e) {
    if (hit?.v !== undefined) mem.set(key, hit); else mem.delete(key);
    throw e;
  }
}

// AbortSignal.timeout 이 없는 오래된 핸드폰 브라우저도 있어서 직접 만든다
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export async function getText(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: timeoutSignal(15000) });
  } catch {
    throw new FetchError('인터넷 연결을 확인해 주세요', 'NETWORK');
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new FetchError('API 키가 거절됐어요(활용신청 승인 대기 중이거나 잘못된 키)', 'BAD_KEY');
  if (!res.ok) throw new FetchError(`정보 제공처 오류 (${res.status})`);
  // 개발 서버에 중계 설정이 없거나 배포 rewrite 가 빠지면 우리 index.html 이 돌아온다
  if (/^\s*<!doctype html/i.test(text)) throw new FetchError('중계 설정이 빠졌어요(render.yaml rewrite 확인)', 'SETUP');
  return text;
}

// ---------- XML 을 객체 목록으로 (공공데이터 API 는 XML 로만 답하는 것이 있음) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s) => s.replace(/&(#\d+|amp|lt|gt|quot|apos);/g, (_, e) => (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : ENT[e]));
function xmlItems(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const obj = {};
    for (const f of m[1].matchAll(/<([A-Za-z0-9_가-힣]+)>([^<]*)<\/\1>/g)) obj[f[1]] = unent(f[2]).trim();
    out.push(obj);
  }
  return out;
}
const xmlValue = (xml, tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();

// 공공데이터포털 공통 오류(키 문제 등)를 사람이 읽을 말로
export function checkGatewayError(text) {
  const reason = xmlValue(text, 'returnReasonCode') || text.match(/"returnReasonCode"\s*:\s*"(\d+)"/)?.[1];
  if (!reason) return;
  const msg = {
    30: '등록되지 않은 서비스키예요(이 API 활용신청이 아직 승인 전일 수 있어요)',
    20: '이 API 에 대한 활용신청이 없어요',
    22: '오늘 사용할 수 있는 횟수를 다 썼어요',
    31: '활용 기간이 끝난 키예요',
  }[reason] || `공공데이터포털 오류 (${reason})`;
  throw new FetchError(msg, reason === '22' ? 'LIMIT' : 'BAD_KEY');
}

import { HOLIDAYS } from './holidays.js';

export const toArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// 경기버스 v2 응답: JSON 이면 response.msgBody[listName], 아니면 XML
function gbisList(text, listName) {
  checkGatewayError(text);
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    const r = j.response || j;
    const code = String(r.msgHeader?.resultCode ?? '0');
    if (code === '4') return []; // 결과 없음
    if (code !== '0') throw new FetchError(r.msgHeader?.resultMessage || `버스 정보 오류 (${code})`);
    return toArr(r.msgBody?.[listName]);
  }
  const code = xmlValue(t, 'resultCode');
  if (code === '4') return [];
  if (code && code !== '0') throw new FetchError(xmlValue(t, 'resultMessage') || `버스 정보 오류 (${code})`);
  return xmlItems(t, listName);
}

// ---------- 버스 (경기도 버스정보) ----------
export function fetchStations({ lat, lng }) {
  const key = dataKey();
  if (!key) return Promise.reject(needKey('공공데이터포털'));
  return cached(`st5:${lat.toFixed(4)},${lng.toFixed(4)}`, 30 * 60e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, x: String(lng), y: String(lat), format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busstationservice/v2/getBusStationAroundListv2?${q}`), 'busStationAroundList');
    const stations = list
      .map((s) => ({
        id: String(s.stationId),
        name: s.stationName,
        no: s.mobileNo ? String(s.mobileNo).trim() : '',
        region: s.regionName || '',
        distance: num(s.distance),
        lat: num(s.y),
        lng: num(s.x),
      }))
      // 버스가 서지 않는 곳(이름에 '미정차', 정류장 번호 00000)은 뺀다
      .filter((s) => !NO_STOP.test(s.name) && !/^0+$/.test(s.no))
      .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
      .slice(0, 16);
    // 같은 이름의 정류장(길 건너 맞은편 등)을 구분하려고 '다음 정류장 방면'을 붙인다. 못 찾아도 목록은 보여 준다.
    return withStopInfo(stations, key);
  }, { persist: true });
}

const NO_STOP = /미정차/;

// 노선의 정류장 순서 (여러 정류장이 같은 노선을 지나므로 메모리에 함께 둔다)
function routeStops(routeId, key) {
  return cached(`route:${routeId}`, 24 * 3600e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, routeId, format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busrouteservice/v2/getBusRouteStationListv2?${q}`), 'busRouteStationList');
    return list
      .map((s) => ({ id: String(s.stationId), name: s.stationName, seq: num(s.stationSeq) }))
      .sort((a, b) => a.seq - b.seq);
  });
}

// 정류장 이름에서 괄호(승강장·중앙차로 표시 등)를 뗀 이름. 같은 이름 정류장(길 건너 맞은편 등)을 묶을 때도 쓴다.
export const stopBaseName = (n) => String(n || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
// 알아보기 쉬운 곳: 지하철역 → 터미널·시청·병원 같은 큰 곳
const STATION_RE = /[가-힣A-Za-z0-9]+역(?![가-힣])/;
const LANDMARK_RE = /(터미널|환승센터|시청|구청|군청|병원|의료원|대학교|시장|공원|차고지)/;
// '산본역.롯데백화점' → '산본역', '군포시청.군포경찰서' → '군포시청'
function landmarkOf(name, re) {
  const part = stopBaseName(name).split(/[.·,]/).find((p) => re.test(p));
  if (!part) return '';
  return re === STATION_RE ? part.match(STATION_RE)[0] : part.trim();
}

// 이 정류장에 서는 경기 버스 노선(정류장은 잘 안 바뀌니 일주일 기억)
function gbisVia(stationId, key) {
  return cached(`via:${stationId}`, 7 * 24 * 3600e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, stationId, format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busstationservice/v2/getBusStationViaRouteListv2?${q}`), 'busRouteList');
    return list.map((r) => ({ routeId: String(r.routeId), name: String(r.routeName ?? ''), staOrder: num(r.staOrder) }));
  }, { persist: true });
}
// 서울 정류장에 서는 서울 버스 노선 이름 (/api/seoulbus 중계가 아직 없으면 빈 목록)
function seoulVia(arsId, key) {
  return cached(`svia:${arsId}`, 7 * 24 * 3600e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, arsId, resultType: 'json' });
    const j = JSON.parse(await getText(`/api/seoulbus/stationinfo/getRouteByStation?${q}`));
    return toArr(j?.msgBody?.itemList).map((r) => String(r.busRouteNm || r.busRouteAbrv || '')).filter(Boolean);
  }, { persist: true });
}
// 이 정류장에 서는 버스 번호 목록 (검색칸에서 '15-2' 처럼 버스 번호로 찾을 때 씀)
async function stationRouteNames(st, key) {
  const [g, sv] = await Promise.allSettled([
    gbisVia(st.id, key),
    isSeoulStop(st) && /^\d{5}$/.test(st.no) ? seoulVia(st.no, key) : Promise.resolve([]),
  ]);
  const names = [...(g.status === 'fulfilled' ? g.value.map((r) => r.name) : []), ...(sv.status === 'fulfilled' ? sv.value : [])];
  return [...new Set(names.filter(Boolean))];
}
// 정류장 목록에 방면·서는 버스 번호를 붙인다(못 찾아도 목록은 보여 준다)
async function withStopInfo(stations, key) {
  const [dirs, routes] = await Promise.all([
    Promise.allSettled(stations.map((s) => stationDirection(s.id, key))),
    Promise.allSettled(stations.map((s) => stationRouteNames(s, key))),
  ]);
  return stations.map((s, i) => ({
    ...s,
    toward: dirs[i].status === 'fulfilled' ? dirs[i].value : '',
    routes: routes[i].status === 'fulfilled' ? routes[i].value : [],
  }));
}

// 정류장 이름·번호로 넓게 찾기(경기도 버스정보, 서울 정류장도 나옴). 가까운 순 15곳.
export function searchStations(keyword, pos) {
  const key = dataKey();
  if (!key) return Promise.reject(needKey('공공데이터포털'));
  const k = String(keyword || '').trim();
  return cached(`stq:${k}`, 3600e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, keyword: k, format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busstationservice/v2/getBusStationListv2?${q}`), 'busStationList');
    const stations = list
      .map((s) => ({
        id: String(s.stationId),
        name: s.stationName,
        no: s.mobileNo ? String(s.mobileNo).trim() : '',
        region: s.regionName || '',
        lat: num(s.y),
        lng: num(s.x),
      }))
      .filter((s) => !NO_STOP.test(s.name))
      .map((s) => ({ ...s, distance: s.lat != null ? Math.round(distKm(pos, s) * 1000) : null }))
      .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
      .slice(0, 15);
    return withStopInfo(stations, key);
  }).then((list) => list.map((s) => ({ ...s, distance: s.lat != null ? Math.round(distKm(pos, s) * 1000) : null })));
}

// 이 정류장을 지나는 노선을 따라가며 '○○ 방면'을 정한다: 12정류장 안의 지하철역 → 큰 곳 → 바로 다음 정류장 이름.
// 정류장은 잘 안 바뀌니 일주일 기억한다.
function stationDirection(stationId, key) {
  return cached(`dir2:${stationId}`, 7 * 24 * 3600e3, async () => {
    const routes = await gbisVia(stationId, key);
    for (const r of routes.slice(0, 3)) {
      const stops = await routeStops(String(r.routeId), key);
      // staOrder 로 찾되, 순환 노선처럼 같은 정류장이 두 번 나오면 그 순서의 것을 쓴다
      let i = stops.findIndex((s) => s.seq === num(r.staOrder) && s.id === String(stationId));
      if (i === -1) i = stops.findIndex((s) => s.id === String(stationId));
      if (i === -1) continue;
      const here = stopBaseName(stops[i].name);
      const ahead = stops.slice(i + 1).filter((s) => !NO_STOP.test(s.name) && stopBaseName(s.name) !== here);
      if (!ahead.length) continue;
      const near = ahead.slice(0, 12);
      const hereStation = landmarkOf(here, STATION_RE);
      for (const re of [STATION_RE, LANDMARK_RE]) {
        const hit = near.map((s) => landmarkOf(s.name, re)).find((v) => v && v !== hereStation);
        if (hit) return hit;
      }
      return stopBaseName(ahead[0].name);
    }
    return '';
  }, { persist: true });
}

// 오늘이 평일·토요일·일요일(공휴일 포함) 중 무엇인지. 새벽 3시 전은 전날 운행으로 본다(막차가 자정을 넘김).
export function serviceDay(now = Date.now()) {
  const d = new Date(now + 9 * 3600e3 - 3 * 3600e3);
  const ymd = d.toISOString().slice(0, 10);
  const w = d.getUTCDay();
  if (w === 0 || HOLIDAYS.has(ymd)) return 'sun';
  return w === 6 ? 'sat' : 'we';
}

// 혼잡도는 1 여유 · 2 보통 · 3 혼잡 · 4 매우 혼잡 으로 맞춘다(경기: 1~4, 서울: 3~6, 0 은 정보 없음)
const gbisCrowd = (v) => (num(v) >= 1 && num(v) <= 4 ? num(v) : null);
const seoulCrowd = (v) => (num(v) >= 3 && num(v) <= 6 ? num(v) - 2 : null);
// 서울 정류장(정류장 id 가 1로 시작하는 9자리, 경기도 버스정보도 같은 id 를 씀)
const isSeoulStop = (s) => s.region === '서울' || /^1[0-2]\d{7}$/.test(String(s.id));
const hhmm = (v) => { const t = String(v || '').trim(); return /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : ''; };

// station: { id, no(정류장 번호 = 서울 arsId), region }
export function fetchArrivals(station) {
  const key = dataKey();
  if (!key) return Promise.reject(needKey('공공데이터포털'));
  return cached(`arr2:${station.id}`, 20e3, async () => {
    const seoul = isSeoulStop(station) && /^\d{5}$/.test(String(station.no || '').trim());
    // 서울 정류장은 경기 버스(경기도 자료) + 서울 버스(서울시 자료)를 합친다. 한쪽만 실패하면 다른 쪽만 보여 준다.
    const [g, s] = await Promise.allSettled([gbisArrivals(station.id, key), seoul ? seoulArrivals(String(station.no).trim(), key) : Promise.resolve([])]);
    if (g.status === 'rejected' && (!seoul || s.status === 'rejected')) throw g.reason;
    const sl = s.status === 'fulfilled' ? s.value : [];
    const names = new Set(sl.map((b) => b.route));
    const gl = g.status === 'fulfilled' ? g.value.filter((b) => !names.has(b.route)) : [];
    return [...gl, ...sl].sort((a, b) => (a.min1 ?? 999) - (b.min1 ?? 999));
  });
}

async function gbisArrivals(stationId, key) {
  const q = new URLSearchParams({ serviceKey: key, stationId, format: 'json' });
  const list = gbisList(await getText(`/api/gbis/busarrivalservice/v2/getBusArrivalListv2?${q}`), 'busArrivalList');
  // 빈자리는 좌석버스(직행좌석 11·좌석 12·광역급행 14·시외 16 등)만 의미가 있다. 일반버스는 0 이나 -1 로 온다.
  const SEAT_TYPES = new Set(['11', '12', '14', '16', '21', '22']);
  const seat = (b) => (SEAT_TYPES.has(String(b.routeTypeCd)) && num(b.remainSeatCnt1) != null && num(b.remainSeatCnt1) >= 0 ? num(b.remainSeatCnt1) : null);
  return list.map((b) => ({
    src: 'gbis',
    routeId: String(b.routeId),
    route: b.routeName ? String(b.routeName) : String(b.routeId),
    dest: b.routeDestName || '',
    min1: num(b.predictTime1),
    min2: num(b.predictTime2),
    stops1: num(b.locationNo1),
    seats1: seat(b),
    low1: String(b.lowPlate1) === '1',
    low2: String(b.lowPlate2) === '1',
    crowd1: gbisCrowd(b.crowded1),
    staOrder: num(b.staOrder),
    turnSeq: num(b.turnSeq),
  }));
}

// 서울 버스 도착 메시지: '5분후[1번째 전]', '3분20초후[2번째 전]', '곧 도착', '운행종료', '출발대기'
function seoulMsg(msg) {
  const m = String(msg || '');
  if (!m) return { min: null, stops: null, note: '' };
  if (/곧 도착/.test(m)) return { min: 0, stops: null, note: '' };
  const min = m.match(/(\d+)분/);
  const stops = m.match(/\[(\d+)번째 전\]/);
  if (!min) return { min: null, stops: null, note: m.replace(/\[.*?\]/g, '').trim() };
  return { min: Number(min[1]), stops: stops ? Number(stops[1]) : null, note: '' };
}

async function seoulArrivals(arsId, key) {
  const q = new URLSearchParams({ serviceKey: key, arsId, resultType: 'json' });
  const text = await getText(`/api/seoulbus/stationinfo/getStationByUid?${q}`);
  checkGatewayError(text);
  let j;
  try { j = JSON.parse(text); } catch { throw new FetchError('서울 버스 정보를 읽지 못했어요'); }
  const code = String(j?.msgHeader?.headerCd ?? '0');
  if (code === '4') return [];
  if (code !== '0') throw new FetchError(j?.msgHeader?.headerMsg || `서울 버스 정보 오류 (${code})`);
  return toArr(j?.msgBody?.itemList).map((b) => {
    const a1 = seoulMsg(b.arrmsg1);
    const a2 = seoulMsg(b.arrmsg2);
    return {
      src: 'seoul',
      routeId: `s${b.busRouteId}`,
      route: String(b.rtNm || b.busRouteAbrv || ''),
      dest: b.adirection || '',
      min1: a1.min,
      min2: a2.min,
      stops1: a1.stops,
      note1: a1.note, // 운행종료·출발대기 등
      seats1: null,
      low1: String(b.busType1) === '1',
      low2: String(b.busType2) === '1',
      crowd1: seoulCrowd(b.congestion1),
      last1: String(b.isLast1) === '1', // 이 버스가 막차
      // 서울 자료는 이 정류장 기준 첫차·막차와 배차 간격이 같이 온다
      times: { first: hhmm(b.firstTm), last: hhmm(b.lastTm), alloc: num(b.term) ? `${num(b.term)}분` : '', here: true },
    };
  });
}

// 경기 버스 노선의 첫차·막차·배차 간격(기점·종점 출발 기준). 이 정류장이 회차 전이면 기점, 뒤면 종점 출발 시각.
export function fetchRouteTimes(b) {
  const key = dataKey();
  if (!key) return Promise.reject(needKey('공공데이터포털'));
  return cached(`rinfo:${b.routeId}`, 24 * 3600e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, routeId: b.routeId, format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busrouteservice/v2/getBusRouteInfoItemv2?${q}`), 'busRouteInfoItem');
    return list[0] || null;
  }, { persist: true }).then((info) => {
    if (!info) return null;
    const day = serviceDay();
    const down = b.staOrder != null && b.turnSeq != null && b.turnSeq > 1 && b.staOrder >= b.turnSeq;
    const dir = down ? 'Down' : 'Up';
    const pick = (k) => info[`${day}${k}`] ?? info[k[0].toLowerCase() + k.slice(1)] ?? null;
    const peak = num(pick('PeekAlloc'));
    const normal = num(pick('NPeekAlloc'));
    const allocs = [...new Set([peak, normal].filter((v) => v > 0))].sort((x, y) => x - y);
    const val = (k) => { const v = String(pick(k) ?? '').trim(); return /^\d{1,2}:\d{2}$/.test(v) ? v : ''; };
    let first = val(`${dir}FirstTime`);
    let last = val(`${dir}LastTime`);
    let from = down ? info.endStationName || info.turnStNm || '' : info.startStationName || '';
    // 순환 노선(마을버스 등)은 종점 출발 시각이 0 으로 온다 → 기점에서 한 바퀴 도는 시각을 쓴다
    if (down && !first && !last) { first = val('UpFirstTime'); last = val('UpLastTime'); from = info.startStationName || ''; }
    return { first, last, alloc: allocs.length ? `${allocs.join('~')}분` : '', from, here: false };
  });
}

// ---------- 주유소 (오피넷, 좌표는 KATEC) ----------
const KATEC = '+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
const BRANDS = {
  SKE: 'SK에너지', GSC: 'GS칼텍스', HDO: 'HD현대오일뱅크', SOL: 'S-OIL', RTE: '알뜰주유소', RTX: '고속도로 알뜰',
  NHO: '농협 알뜰', ETC: '자가상표', E1G: 'E1', SKG: 'SK가스',
};
const FUELS = { gasoline: 'B027', diesel: 'D047', premium: 'B034', lpg: 'K015' };

export function fetchGas({ lat, lng }, fuel, radius) {
  const key = opinetKey();
  if (!key) return Promise.reject(needKey('오피넷'));
  const prodcd = FUELS[fuel] || FUELS.gasoline;
  const r = Math.min(5000, Math.max(1000, radius || 3000));
  return cached(`gas:${lat.toFixed(3)},${lng.toFixed(3)}:${prodcd}:${r}`, 30 * 60e3, async () => {
    const { default: proj4 } = await import('proj4'); // 주유소 카드에서만 쓰므로 따로 불러옴
    const [x, y] = proj4('WGS84', KATEC, [lng, lat]);
    const q = new URLSearchParams({ code: key, x: x.toFixed(1), y: y.toFixed(1), radius: String(r), sort: '1', prodcd, out: 'json' });
    const text = await getText(`/api/opinet/aroundAll.do?${q}`);
    let j;
    try { j = JSON.parse(text); } catch {
      throw new FetchError('오피넷 응답을 읽지 못했어요(키를 확인해 주세요)', 'BAD_KEY');
    }
    return toArr(j?.RESULT?.OIL)
      .map((o) => {
        const [glng, glat] = proj4(KATEC, 'WGS84', [Number(o.GIS_X_COOR), Number(o.GIS_Y_COOR)]);
        const brand = o.POLL_DIV_CD || o.POLL_DIV_CO || '';
        return { id: o.UNI_ID, name: o.OS_NM, brand: BRANDS[brand] || brand, price: num(o.PRICE), distance: num(o.DISTANCE), lat: glat, lng: glng };
      })
      .filter((o) => o.price > 0)
      .sort((a, b) => a.price - b.price || (a.distance ?? 0) - (b.distance ?? 0));
  }, { persist: true });
}

// ---------- 아파트 매매 실거래가 (국토교통부) ----------
// 단지는 국토부 자료의 시군구 코드(lawd)·법정동(umdNm)·단지 이름(aptNm) 그대로 찾는다(화면 이름 label 과 다를 수 있음).
// 사용자가 '단지 추가'로 고른 단지는 이 기기(localStorage pd_apts)에 저장되고, 저장이 없으면 아래 기본 단지를 쓴다.
//   삼익소월: 산본역 근처지만 법정동은 금정동
//   가야주공1차: 산본동 '가야주공' ('가야3주공' 은 다른 단지)
//   한라주공2차: 산본동 '한라주공4-2' ('한라주공4' 는 1차)
export const DEFAULT_APTS = [
  { id: 'soweol', label: '삼익소월', lawd: '41410', region: '군포시', dong: '금정동', name: '삼익소월' },
  { id: 'gaya1', label: '가야주공1차', lawd: '41410', region: '군포시', dong: '산본동', name: '가야주공' },
  { id: 'halla2', label: '한라주공2차', lawd: '41410', region: '군포시', dong: '산본동', name: '한라주공4-2' },
];

// 예전 캐시(세 단지만 걸러 저장하던 apt3:)는 지운다
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith('pd_cache:apt3:')) localStorage.removeItem(k);
  }
} catch { /* 저장소를 못 써도 괜찮음 */ }

function recentMonths(n) {
  const now = new Date(Date.now() + 9 * 3600e3); // 한국 시간
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const tradeOf = (r) => {
  const year = Number(r.dealYear ?? r['년']);
  const month = Number(r.dealMonth ?? r['월']);
  const day = Number(r.dealDay ?? r['일']);
  return {
    name: (r.aptNm ?? r['아파트'] ?? '').trim(),
    dong: (r.umdNm ?? r['법정동'] ?? '').trim(),
    amount: Number(String(r.dealAmount ?? r['거래금액'] ?? '').replace(/[,\s]/g, '')) || null, // 만원
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    area: num(r.excluUseAr ?? r['전용면적']),
    floor: num(r.floor ?? r['층']),
    built: num(r.buildYear),
    canceled: (r.cdealType ?? r['해제여부'] ?? '').trim() === 'O',
    kind: (r.dealingGbn ?? '').trim(), // 중개거래 / 직거래
  };
};

// 시군구 하나의 한 달치 거래 전체. 커서 localStorage 에는 두지 않고 메모리에만(지난달 이전은 하루, 최근 두 달은 3시간)
function rtmsMonth(key, lawd, ym, isRecent) {
  return cached(`rtms:${lawd}:${ym}`, (isRecent ? 3 : 24) * 3600e3, async () => {
    const rows = [];
    for (let page = 1; page <= 5; page++) {
      const q = new URLSearchParams({ serviceKey: key, LAWD_CD: lawd, DEAL_YMD: ym, numOfRows: '1000', pageNo: String(page) });
      const text = await getText(`/api/rtms/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?${q}`);
      checkGatewayError(text);
      const code = xmlValue(text, 'resultCode');
      if (code && !['00', '000', '0'].includes(code)) throw new FetchError(xmlValue(text, 'resultMsg') || `실거래가 오류 (${code})`);
      const items = xmlItems(text, 'item');
      rows.push(...items);
      const total = Number(xmlValue(text, 'totalCount') || 0);
      if (rows.length >= total || items.length === 0) break;
    }
    return rows.map(tradeOf);
  });
}

// 단지 하나의 최근 16개월 거래(화면 목록은 13개월, 1년 전 대비 변화를 구하려고 3개월 더).
// 걸러 낸 결과만 3시간 동안 이 기기에 저장해 다시 열 때 바로 보인다.
export async function fetchApt(apt) {
  const key = dataKey();
  if (!key) throw needKey('공공데이터포털');
  const months = recentMonths(16);
  const trades = await cached(`apt4:${apt.lawd}:${apt.dong}:${apt.name}`, 3 * 3600e3, async () => {
    const monthly = await Promise.all(months.map((ym, i) => rtmsMonth(key, apt.lawd, ym, i < 2)));
    return monthly.flat()
      .filter((t) => t.dong === apt.dong && t.name === apt.name)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.amount ?? 0) - (a.amount ?? 0));
  }, { persist: true });
  return { id: apt.id, label: apt.label, region: apt.region, dong: apt.dong, from: months[12], to: months[0], trades };
}

// '단지 추가' 목록: 시군구 하나에서 최근 1년 동안 거래가 있었던 단지(동·이름별 건수·최근 거래일·지은 해)
export async function fetchAptList(lawd) {
  const key = dataKey();
  if (!key) throw needKey('공공데이터포털');
  const monthly = await Promise.all(recentMonths(12).map((ym, i) => rtmsMonth(key, lawd, ym, i < 2)));
  const map = new Map();
  for (const t of monthly.flat()) {
    if (!t.name || t.canceled) continue;
    const k = `${t.dong}|${t.name}`;
    const o = map.get(k) || { dong: t.dong, name: t.name, count: 0, last: '', built: t.built };
    o.count += 1;
    if (t.date > o.last) o.last = t.date;
    map.set(k, o);
  }
  return { lawd, list: [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')) };
}

// 시·군·구 목록(법정 시군구 코드)과 행정동 중심점: 위치에서 가장 가까운 시·군·구를 기본으로 고른다.
// regions.json 은 vuski/admdongkor 행정동 경계(2026-10)에서 뽑았고, 코드는 모두 실거래가 API 로 확인했다. '단지 추가'를 열 때만 불러온다.
export async function loadRegions() {
  const d = (await import('./regions.json')).default;
  const sgg = d.sgg.map(([code, sido, name]) => ({ code, sido, name: name.replace(/^(.+?시)(.+구)$/, '$1 $2') }));
  return {
    sgg,
    nearest(pos) {
      let best = null;
      let bd = Infinity;
      for (const [lat, lng, i] of d.pts) {
        const dd = (lat - pos.lat) ** 2 + ((lng - pos.lng) * 0.8) ** 2;
        if (dd < bd) { bd = dd; best = sgg[i]; }
      }
      return best;
    },
  };
}

// ---------- 약국·응급실 (국립중앙의료원, 공공데이터포털 같은 키) ----------
// 이 API 는 CORS 를 허용해서(사이트 주소를 그대로 돌려줌) 중계 없이 브라우저에서 바로 부른다.
const NMC = 'https://apis.data.go.kr/B552657';
async function nmcItems(path, params) {
  const key = dataKey();
  if (!key) throw needKey('공공데이터포털');
  const q = new URLSearchParams({ serviceKey: key, pageNo: '1', ...params });
  const text = await getText(`${NMC}${path}?${q}`);
  checkGatewayError(text);
  const code = xmlValue(text, 'resultCode');
  if (code && !['00', '000', '0'].includes(code)) throw new FetchError(xmlValue(text, 'resultMsg') || `의료기관 정보 오류 (${code})`);
  return xmlItems(text, 'item');
}
// '031-00-0000' 처럼 빈 번호는 버린다
const tel = (v) => { const t = (v || '').trim(); return t.replace(/\D/g, '').length >= 8 && !/-00-0000$/.test(t) ? t : ''; };
const hm = (v) => (/^\d{3,4}$/.test(v || '') ? Number(v) : null);

// 가까운 약국 100곳(산본역 근처면 1.5km 남짓)과 오늘 요일의 여닫는 시각(HHMM)
export function fetchPharmacies({ lat, lng }) {
  return cached(`pharm:${lat.toFixed(3)},${lng.toFixed(3)}`, 30 * 60e3, async () => {
    const list = await nmcItems('/ErmctInsttInfoInqireService/getParmacyLcinfoInqire', { WGS84_LON: String(lng), WGS84_LAT: String(lat), numOfRows: '100' });
    return list.map((o) => ({
      id: o.hpid, name: o.dutyName, addr: o.dutyAddr || '', tel: tel(o.dutyTel1),
      distance: num(o.distance), lat: num(o.latitude), lng: num(o.longitude),
      start: hm(o.startTime), end: hm(o.endTime),
    }));
  }, { persist: true });
}

// 가까운 응급실(20km 안 최대 12곳, 화면은 5곳 + 더 보기) + 실시간 남은 병상(hvec, 병원이 입력한 값. 0 이하면 꽉 참)
export function fetchEmergency({ lat, lng }) {
  return cached(`er:${lat.toFixed(3)},${lng.toFixed(3)}`, 3 * 60e3, async () => {
    const list = (await nmcItems('/ErmctInfoInqireService/getEgytLcinfoInqire', { WGS84_LON: String(lng), WGS84_LAT: String(lat), numOfRows: '12' }))
      .filter((o) => num(o.distance) == null || num(o.distance) <= 20);
    // 병상은 시도 단위로 한 번에 받아 병원 id 로 맞춘다(경기도 약 70곳)
    const stages = [...new Set(list.map((o) => (o.dutyAddr || '').split(' ')[0]).filter(Boolean))];
    const beds = new Map();
    await Promise.all(stages.map(async (s) => {
      try {
        const rows = await nmcItems('/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire', { STAGE1: s, numOfRows: '500' });
        for (const b of rows) beds.set(b.hpid, b);
      } catch { /* 병상을 못 받아도 목록은 보여 준다 */ }
    }));
    return list.map((o) => {
      const b = beds.get(o.hpid);
      return {
        id: o.hpid, name: o.dutyName, kind: o.dutyDivName || '', addr: o.dutyAddr || '',
        distance: num(o.distance), lat: num(o.latitude), lng: num(o.longitude),
        tel: tel(b?.dutyTel3) || tel(o.dutyTel1),
        beds: b ? num(b.hvec) : null,
        bedsAt: b?.hvidate || '', // YYYYMMDDHHMMSS
      };
    });
  });
}

// ---------- 아이 병원(국립중앙의료원 병·의원 찾기 서비스) ----------
// 1) 달빛어린이병원: getBabyListInfoInqire(시도별). 진료시간이 '달빛 진료시간'(예: 평일 18~23시)이라 일반 목록보다 정확하다.
// 2) 소아청소년과(QD=D002) 진료 병·의원: getHsptlMdcncListInfoInqire(시·군별) 요일별 진료시간으로 '지금 진료 중'을 계산.
const HSP = '/HsptlAsembySearchService/getHsptlMdcncListInfoInqire';
const BABY = '/HsptlAsembySearchService/getBabyListInfoInqire';

// 병·의원 목록 한 줄 → 화면용(요일별 진료시간 times[1=월…7=일, 8=공휴일] = [시작, 끝] HHMM)
function clinicOf(o) {
  const times = {};
  for (let d = 1; d <= 8; d++) {
    const s = hm(o[`dutyTime${d}s`]);
    const e = hm(o[`dutyTime${d}c`]);
    if (s != null && e != null) times[d] = [s, e];
  }
  const inf = (o.dutyInf || '').replace(/\s+/g, ' ').trim();
  return {
    id: o.hpid, name: o.dutyName, kind: o.dutyDivNam || o.dutyDivName || '', addr: o.dutyAddr || '',
    tel: tel(o.dutyTel1) || tel(o.dutyTel3), lat: num(o.wgs84Lat), lng: num(o.wgs84Lon),
    times, note: inf.length <= 40 ? inf : '',
  };
}

// 근처 시·군(주소 앞 두 마디, 예: 경기도 안양시) — 가까운 응급실 주소로 정한다(위치마다 하루 보관)
function nearbyRegions({ lat, lng }) {
  return cached(`regions:${lat.toFixed(2)},${lng.toFixed(2)}`, 24 * 3600e3, async () => {
    const list = await nmcItems('/ErmctInfoInqireService/getEgytLcinfoInqire', { WGS84_LON: String(lng), WGS84_LAT: String(lat), numOfRows: '12' });
    const out = [];
    list.forEach((o, i) => {
      const [q0, q1] = (o.dutyAddr || '').split(' ');
      if (!q0 || !q1 || (i > 0 && num(o.distance) > 7)) return;
      if (!out.some((r) => r.q0 === q0 && r.q1 === q1)) out.push({ q0, q1 });
    });
    return out.slice(0, 4);
  }, { persist: true });
}

// 시·군 하나의 소아 진료 의원(진료시간은 자주 안 바뀌어 하루 보관)
function kidsRegion({ q0, q1 }) {
  return cached(`kids2:${q0}:${q1}`, 24 * 3600e3, async () => {
    const rows = [];
    for (let page = 1; page <= 4; page++) {
      const items = await nmcItems(HSP, { Q0: q0, Q1: q1, QD: 'D002', numOfRows: '500', pageNo: String(page) });
      rows.push(...items);
      if (items.length < 500) break;
    }
    // 요양병원은 소아청소년과가 진료과목에 있어도 아이를 데려갈 곳이 아니라 뺀다
    return rows.filter((o) => !/요양/.test(`${o.dutyName}${o.dutyDivNam || ''}`)).map(clinicOf);
  }, { persist: true });
}

const distKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// 시도 하나의 달빛어린이병원(경기도 약 45곳, 하루 보관)
function moonRegion(q0) {
  return cached(`moon:${q0}`, 24 * 3600e3, async () => (await nmcItems(BABY, { Q0: q0, numOfRows: '300' })).map(clinicOf), { persist: true });
}

// 근처 25km 안 달빛어린이병원 (달빛 진료시간 포함)
export async function fetchMoonClinics(pos) {
  const regions = await nearbyRegions(pos);
  const q0s = [...new Set(regions.map((r) => r.q0))];
  const lists = await Promise.all(q0s.map((q) => moonRegion(q).catch(() => [])));
  return lists.flat()
    .filter((o) => o.lat && o.lng)
    .map((o) => ({ ...o, distance: distKm(pos, o) }))
    .filter((o) => o.distance <= 25)
    .sort((a, b) => a.distance - b.distance);
}

// 근처 10km 안 소아 진료 의원 (요일별 진료시간 포함, 지금 진료 중인지는 화면에서 계산)
export async function fetchKidsClinics(pos) {
  const regions = await nearbyRegions(pos);
  const lists = await Promise.all(regions.map((r) => kidsRegion(r).catch(() => [])));
  const seen = new Set();
  return lists.flat()
    .filter((o) => o.lat && o.lng && !seen.has(o.id) && seen.add(o.id))
    .map((o) => ({ ...o, distance: distKm(pos, o) }))
    .filter((o) => o.distance <= 10)
    .sort((a, b) => a.distance - b.distance);
}

// ---------- 지하철 (가까운 역: 앱에 넣어 둔 수도권 역 목록, 실시간 도착: 서울 열린데이터광장) ----------
// 서울 API 는 http 만 되어 https 사이트에서 바로 못 부른다 → /api/subway 중계(render.yaml rewrite·vite proxy).
// 키는 서울 열린데이터광장 '실시간 지하철' 인증키(VITE_SEOUL_SUBWAY_KEY, 공공데이터포털 키와 다름).
// 역 위치(src/subwayStations.json, [이름, 위도, 경도] 약 600곳)는 OpenStreetMap 에서 한 번 뽑아 넣었다.
// Overpass 를 화면에서 부르면 자주 '용량 초과'·406 으로 실패해서다. 새 역이 생기면 다시 뽑을 것.
const subwayKey = () => (import.meta.env.VITE_SEOUL_SUBWAY_KEY || '').trim();

// 반경 3km 안 지하철역(이름은 서울 API 의 statnNm 처럼 '역' 을 뗀 이름), 가까운 4곳
export async function fetchSubwayStations({ lat, lng }) {
  const { default: all } = await import('./subwayStations.json'); // 지하철 탭을 열 때만 불러옴
  const seen = new Set();
  return all
    .map(([name, la, lo]) => ({ name, lat: la, lng: lo, distance: Math.round(distKm({ lat, lng }, { lat: la, lng: lo }) * 1000) }))
    .filter((s) => s.distance <= 3000)
    .sort((a, b) => a.distance - b.distance)
    .filter((s) => !seen.has(s.name) && seen.add(s.name))
    .slice(0, 4);
}

export const SUBWAY_LINES = {
  1001: ['1호선', '#0052a4'], 1002: ['2호선', '#00a84d'], 1003: ['3호선', '#ef7c1c'], 1004: ['4호선', '#00a5de'],
  1005: ['5호선', '#996cac'], 1006: ['6호선', '#cd7c2f'], 1007: ['7호선', '#747f00'], 1008: ['8호선', '#e6186c'],
  1009: ['9호선', '#bdb092'], 1032: ['GTX-A', '#9a6292'], 1063: ['경의중앙선', '#77c4a3'], 1065: ['공항철도', '#0090d2'],
  1067: ['경춘선', '#0c8e72'], 1075: ['수인분당선', '#fabe00'], 1077: ['신분당선', '#d4003b'], 1081: ['경강선', '#0054a6'],
  1092: ['우이신설선', '#b0ce18'], 1093: ['서해선', '#8fc31f'], 1094: ['신림선', '#6789ca'],
};

export function fetchSubwayArrivals(station) {
  const key = subwayKey();
  if (!key) return Promise.reject(needKey('서울 열린데이터광장 실시간 지하철'));
  return cached(`subarr:${station}`, 20e3, async () => {
    // 끝의 ?_= 는 매번 다른 주소로 만들어, 중계 설정을 고치기 전 브라우저가 기억한 301(http 로 이동 → 차단)을 피한다
    const text = await getText(`/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/30/${encodeURIComponent(station)}?_=${Date.now()}`, { cache: 'no-store' });
    let j;
    try { j = JSON.parse(text); } catch { throw new FetchError('지하철 정보를 읽지 못했어요'); }
    const err = j.errorMessage || j;
    const code = String(err.code || '');
    if (code === 'INFO-200') return []; // 해당 역 정보 없음(지금 운행 없음)
    if (code.startsWith('INFO-1') || code === 'ERROR-300') throw new FetchError('서울 열린데이터광장 인증키가 맞지 않아요', 'BAD_KEY');
    if (code && code !== 'INFO-000') throw new FetchError(err.message || `지하철 정보 오류 (${code})`);
    return (j.realtimeArrivalList || []).map((t) => ({
      id: `${t.subwayId}-${t.btrainNo}-${t.updnLine}`,
      line: String(t.subwayId),
      dir: t.updnLine || '', // 상행·하행(2호선은 내선·외선)
      dest: t.bstatnNm || (t.trainLineNm || '').split('행')[0],
      way: ((t.trainLineNm || '').split('-')[1] || '').replace(/\(.*\)/, '').trim(), // '대야미방면' ('(급행)' 은 kind 로)
      kind: t.btrainSttus && t.btrainSttus !== '일반' ? t.btrainSttus : '', // 급행 등
      last: String(t.lstcarAt) === '1', // 막차
      sec: num(t.barvlDt) || 0,
      at: t.recptnDt ? Date.parse(t.recptnDt.replace(' ', 'T') + '+09:00') : null,
      msg: t.arvlMsg2 || '',
      where: t.arvlMsg3 || '',
      code: String(t.arvlCd ?? ''),
      order: t.ordkey || '',
    }));
  });
}

// ---------- 지하철 막차·첫차 (서울 열린데이터광장 시간표, 실시간 도착과 같은 키) ----------
// 역 이름 → 노선별 역 코드(SearchInfoBySubwayNameService) → 요일·방향별 시간표(SearchSTNTimeTableByIDService).
// 2026-11 확인: 이 시간표 API 는 역마다 자료가 비어 오는 일이 잦고, 같은 역도 시간에 따라 있다 없다 한다.
// 없으면 막차 줄을 숨기고(기억하지 않아 다음에 다시 물어봄), 실시간 도착의 막차 표시(lstcarAt)는 늘 쓴다.
// openapi.seoul.go.kr:8088 도 http 만 되어 /api/seoulapi 로 중계한다.
const lineKey = (v) => String(v || '').replace(/\s/g, '').replace(/^0+/, '').replace(/선$/, '');
// 실시간 노선 이름(SUBWAY_LINES, '4호선'·'경의중앙선')과 시간표 노선 이름(LINE_NUM, '04호선'·'경의선')을 맞춘다
const sameLine = (a, b) => { const x = lineKey(a); const y = lineKey(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };

function subwayCodes(station) {
  const key = subwayKey();
  // 시간표 쪽 역 이름은 '서울'(GTX-A)과 '서울역'(1·4호선 등)처럼 '역' 이 붙기도 해서 둘 다 찾는다
  return cached(`subcd2:${station}`, 30 * 24 * 3600e3, async () => {
    const out = [];
    for (const name of [station, `${station}역`]) {
      const text = await getText(`/api/seoulapi/${encodeURIComponent(key)}/json/SearchInfoBySubwayNameService/1/20/${encodeURIComponent(name)}/`);
      let j;
      try { j = JSON.parse(text); } catch { throw new FetchError('지하철 역 정보를 읽지 못했어요'); }
      for (const r of j?.SearchInfoBySubwayNameService?.row || []) {
        if (r.STATION_NM === name) out.push({ code: String(r.STATION_CD), line: String(r.LINE_NUM) });
      }
    }
    if (!out.length) throw new FetchError('역 코드 없음', 'NO_TT'); // 빈 결과는 기억하지 않는다
    return out;
  }, { persist: true });
}

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
// '24:34:00' → '0:34'
export const trainTime = (t) => { const [h, m] = String(t).split(':').map(Number); return `${h % 24}:${String(m).padStart(2, '0')}`; };

// 한 역·노선·방향(상행/내선 = 1, 하행/외선 = 2)의 오늘 첫차·막차 { first, last, lastDest, passed }
export function fetchSubwayTimes(station, lineId, dir) {
  const key = subwayKey();
  if (!key) return Promise.reject(needKey('서울 열린데이터광장 지하철'));
  const io = /상행|내선/.test(dir) ? '1' : '2';
  const week = { we: '1', sat: '2', sun: '3' }[serviceDay()];
  const lineName = SUBWAY_LINES[lineId]?.[0] || '';
  return cached(`subtt2:${station}:${lineId}:${week}:${io}`, 7 * 24 * 3600e3, async () => {
    const codes = await subwayCodes(station);
    const c = codes.find((x) => sameLine(x.line, lineName));
    if (!c) throw new FetchError('시간표 없는 노선', 'NO_TT');
    const text = await getText(`/api/seoulapi/${encodeURIComponent(key)}/json/SearchSTNTimeTableByIDService/1/500/${c.code}/${week}/${io}/`);
    let j;
    try { j = JSON.parse(text); } catch { throw new FetchError('지하철 시간표를 읽지 못했어요'); }
    const rows = (j?.SearchSTNTimeTableByIDService?.row || [])
      // 이 역이 종착인 열차(타지 못함)는 뺀다
      .filter((r) => r.SUBWAYENAME !== r.STATION_NM && `${r.SUBWAYENAME}역` !== r.STATION_NM)
      .map((r) => ({ t: r.LEFTTIME && r.LEFTTIME !== '00:00:00' ? r.LEFTTIME : r.ARRIVETIME, dest: r.SUBWAYENAME || '' }))
      .filter((r) => r.t && r.t !== '00:00:00')
      .sort((a, b) => toMin(a.t) - toMin(b.t));
    // 자료가 없으면 기억하지 않고(던져서) 다음에 다시 물어본다(같은 역도 때에 따라 비어 오는 일이 있음)
    if (!rows.length) throw new FetchError('시간표 없음', 'NO_TT');
    return { first: rows[0].t, last: rows[rows.length - 1].t, lastDest: rows[rows.length - 1].dest };
  }, { persist: true }).then((r) => {
    if (!r) return null;
    // 지금이 막차 뒤인지 (새벽 3시 전은 전날의 연장으로 본다)
    const d = new Date(Date.now() + 9 * 3600e3);
    let now = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (now < 180) now += 1440;
    return { ...r, passed: now > toMin(r.last) };
  });
}
