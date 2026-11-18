// 키가 필요한 공공 API 를 브라우저에서 부른다.
// 브라우저가 직접 부르면 CORS 로 막히므로 같은 주소의 /api/* 로 부르고,
// 배포에서는 Render rewrite(render.yaml), 개발에서는 Vite proxy(vite.config.js)가 원래 주소로 넘긴다.
//   /api/gbis/*   → https://apis.data.go.kr/6410000/*   (경기도 버스)
//   /api/rtms/*   → https://apis.data.go.kr/1613000/*   (국토부 실거래가)
//   /api/opinet/* → https://www.opinet.co.kr/api/*     (오피넷)
// 키는 빌드할 때 환경변수(VITE_DATA_GO_KR_KEY, VITE_OPINET_KEY)로 들어와 화면 코드에 포함된다.
// 정적 사이트라 숨길 수 없으므로, 문제가 생기면 키를 재발급하면 된다.

export class FetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
const needKey = (name) => new FetchError(`${name} 키가 설정되지 않았어요`, 'NO_KEY');

// 공공데이터포털은 '인코딩' 키와 '디코딩' 키를 준다. 어느 쪽을 넣어도 되게 디코딩 키로 맞춘다.
function dataKey() {
  const k = (import.meta.env.VITE_DATA_GO_KR_KEY || '').trim();
  if (!k) return '';
  try { return k.includes('%') ? decodeURIComponent(k) : k; } catch { return k; }
}
const opinetKey = () => (import.meta.env.VITE_OPINET_KEY || '').trim();

// ---------- 캐시: 메모리 + (오래 둘 것은) localStorage ----------
const mem = new Map();
async function cached(key, ttlMs, fn, { persist = false } = {}) {
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

async function getText(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
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
function checkGatewayError(text) {
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

const toArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

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
  return cached(`st:${lat.toFixed(4)},${lng.toFixed(4)}`, 30 * 60e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, x: String(lng), y: String(lat), format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busstationservice/v2/getBusStationAroundListv2?${q}`), 'busStationAroundList');
    return list
      .map((s) => ({
        id: String(s.stationId),
        name: s.stationName,
        no: s.mobileNo ? String(s.mobileNo).trim() : '',
        region: s.regionName || '',
        distance: num(s.distance),
      }))
      .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
      .slice(0, 6);
  }, { persist: true });
}

export function fetchArrivals(stationId) {
  const key = dataKey();
  if (!key) return Promise.reject(needKey('공공데이터포털'));
  return cached(`arr:${stationId}`, 20e3, async () => {
    const q = new URLSearchParams({ serviceKey: key, stationId, format: 'json' });
    const list = gbisList(await getText(`/api/gbis/busarrivalservice/v2/getBusArrivalListv2?${q}`), 'busArrivalList');
    // 빈자리는 좌석버스(직행좌석 11·좌석 12·광역급행 14·시외 16 등)만 의미가 있다. 일반버스는 0 이나 -1 로 온다.
    const SEAT_TYPES = new Set(['11', '12', '14', '16', '21', '22']);
    const seat = (b) => (SEAT_TYPES.has(String(b.routeTypeCd)) && num(b.remainSeatCnt1) != null && num(b.remainSeatCnt1) >= 0 ? num(b.remainSeatCnt1) : null);
    return list
      .map((b) => ({
        routeId: String(b.routeId),
        route: b.routeName ? String(b.routeName) : String(b.routeId),
        dest: b.routeDestName || '',
        min1: num(b.predictTime1),
        min2: num(b.predictTime2),
        stops1: num(b.locationNo1),
        seats1: seat(b),
      }))
      .sort((a, b) => (a.min1 ?? 999) - (b.min1 ?? 999));
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
// 단지 이름은 국토부 자료의 aptNm·umdNm 그대로(화면 이름과 다름). 군포시(41410) 한 번 받아 세 단지를 같이 거른다.
//   삼익소월: 산본역 근처지만 법정동은 금정동, aptNm '삼익소월…'
//   가야주공1차: 산본동 '가야주공' ('가야3주공' 은 다른 단지)
//   한라주공2차: 산본동 '한라주공4-2' ('한라주공4' 는 1차)
const LAWD = '41410';
export const APTS = [
  { id: 'soweol', label: '삼익소월', dong: '금정동', match: (n) => n.includes('삼익') && n.includes('소월') },
  { id: 'gaya1', label: '가야주공1차', dong: '산본동', match: (n) => n === '가야주공' },
  { id: 'halla2', label: '한라주공2차', dong: '산본동', match: (n) => n === '한라주공4-2' },
];
const aptOf = (t) => APTS.find((a) => t.dong === a.dong && a.match(t.name));

function recentMonths(n) {
  const now = new Date(Date.now() + 9 * 3600e3); // 한국 시간
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// 한 달치를 받아 위 단지들에 걸리는 줄만 단지 id 를 붙여 저장(지난달 이전은 하루, 최근 두 달은 3시간)
// 단지를 바꿀 때는 캐시 이름(apt3)을 올릴 것
function aptMonth(key, ym, isRecent) {
  return cached(`apt3:${LAWD}:${ym}`, (isRecent ? 3 : 24) * 3600e3, async () => {
    const rows = [];
    for (let page = 1; page <= 5; page++) {
      const q = new URLSearchParams({ serviceKey: key, LAWD_CD: LAWD, DEAL_YMD: ym, numOfRows: '1000', pageNo: String(page) });
      const text = await getText(`/api/rtms/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?${q}`);
      checkGatewayError(text);
      const code = xmlValue(text, 'resultCode');
      if (code && !['00', '000', '0'].includes(code)) throw new FetchError(xmlValue(text, 'resultMsg') || `실거래가 오류 (${code})`);
      const items = xmlItems(text, 'item');
      rows.push(...items);
      const total = Number(xmlValue(text, 'totalCount') || 0);
      if (rows.length >= total || items.length === 0) break;
    }
    return rows
      .map((r) => ({
        name: (r.aptNm ?? r['아파트'] ?? '').trim(),
        dong: (r.umdNm ?? r['법정동'] ?? '').trim(),
        amount: Number(String(r.dealAmount ?? r['거래금액'] ?? '').replace(/[,\s]/g, '')) || null, // 만원
        year: Number(r.dealYear ?? r['년']),
        month: Number(r.dealMonth ?? r['월']),
        day: Number(r.dealDay ?? r['일']),
        area: num(r.excluUseAr ?? r['전용면적']),
        floor: num(r.floor ?? r['층']),
        canceled: (r.cdealType ?? r['해제여부'] ?? '').trim() === 'O',
        kind: (r.dealingGbn ?? '').trim(), // 중개거래 / 직거래
      }))
      .map((t) => ({ ...t, apt: aptOf(t)?.id }))
      .filter((t) => t.apt);
  }, { persist: true });
}

export async function fetchApt(id) {
  const key = dataKey();
  if (!key) throw needKey('공공데이터포털');
  const apt = APTS.find((a) => a.id === id) || APTS[0];
  // 화면 목록은 최근 13개월, 1년 전 대비 변화를 구하려고 3개월 더(16개월) 받는다
  const months = recentMonths(16);
  const monthly = await Promise.all(months.map((ym, i) => aptMonth(key, ym, i < 2)));
  const trades = monthly.flat()
    .filter((t) => t.apt === apt.id)
    .map((t) => ({ ...t, date: `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` }))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.amount ?? 0) - (a.amount ?? 0));
  return { id: apt.id, label: apt.label, dong: apt.dong, from: months[12], to: months[0], trades };
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
      sec: num(t.barvlDt) || 0,
      at: t.recptnDt ? Date.parse(t.recptnDt.replace(' ', 'T') + '+09:00') : null,
      msg: t.arvlMsg2 || '',
      where: t.arvlMsg3 || '',
      code: String(t.arvlCd ?? ''),
      order: t.ordkey || '',
    }));
  });
}
