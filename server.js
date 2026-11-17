// Parent Dashboard 서버: dist/ 화면을 내보내고, 키가 필요한 공공 API 를 /api/* 로 대신 불러 준다.
// 키는 환경변수(Render 의 Environment, 로컬은 .env)에만 둔다. 브라우저에는 절대 보내지 않는다.
//   DATA_GO_KR_KEY : 공공데이터포털 일반 인증키(경기도 버스 정류소·도착정보, 국토부 아파트 매매 실거래가)
//   OPINET_KEY     : 오피넷 무료 API 키(주변 주유소)
//   APT_LAWD_CD    : 실거래가 지역 코드(기본 41410 군포시)
//   APT_DONG       : 법정동(기본 산본동)
//   APT_KEYWORDS   : 단지 이름에 모두 들어가야 하는 글자, 쉼표로(기본 소월,삼익)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT) || 8787;
const DIST = path.join(ROOT, 'dist');

function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// 공공데이터포털은 '인코딩' 키와 '디코딩' 키를 준다. 어느 쪽을 넣어도 되게 디코딩 키로 맞춘다.
function dataKey() {
  const k = (process.env.DATA_GO_KR_KEY || '').trim();
  if (!k) return '';
  try { return k.includes('%') ? decodeURIComponent(k) : k; } catch { return k; }
}
const opinetKey = () => (process.env.OPINET_KEY || '').trim();

class ApiError extends Error {
  constructor(message, code = 'UPSTREAM', status = 502) { super(message); this.code = code; this.status = status; }
}
const needKey = (name) => new ApiError(`${name} 키가 설정되지 않았어요`, 'NO_KEY', 503);

// ---------- 작은 캐시 (같은 요청이 몰려도 외부 API 는 한 번만) ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (hit?.p) return hit.p;
  const p = fn();
  cache.set(key, { ...hit, p });
  try {
    const v = await p;
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return v;
  } catch (e) {
    if (hit?.v !== undefined) cache.set(key, hit); else cache.delete(key);
    throw e;
  }
}

async function getText(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json, application/xml, text/xml, */*' } });
  } catch {
    throw new ApiError('정보 제공처에 연결하지 못했어요');
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new ApiError('API 키가 거절됐어요(신청 승인 대기 중이거나 잘못된 키)', 'BAD_KEY');
  if (!res.ok) throw new ApiError(`정보 제공처 오류 (${res.status})`);
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
    '30': '등록되지 않은 서비스키예요(이 API 활용신청이 아직 승인 전일 수 있어요)',
    '20': '이 API 에 대한 활용신청이 없어요',
    '22': '오늘 사용할 수 있는 횟수를 다 썼어요',
    '31': '활용 기간이 끝난 키예요',
  }[reason] || `공공데이터포털 오류 (${reason})`;
  throw new ApiError(msg, reason === '22' ? 'LIMIT' : 'BAD_KEY');
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
    if (code !== '0') throw new ApiError(r.msgHeader?.resultMessage || `버스 정보 오류 (${code})`);
    return toArr(r.msgBody?.[listName]);
  }
  const code = xmlValue(t, 'resultCode');
  if (code === '4') return [];
  if (code && code !== '0') throw new ApiError(xmlValue(t, 'resultMessage') || `버스 정보 오류 (${code})`);
  return xmlItems(t, listName);
}

// ---------- 버스 (경기도 버스정보) ----------
const GBIS = 'https://apis.data.go.kr/6410000';

async function busStations(lat, lng) {
  const key = dataKey();
  if (!key) throw needKey('공공데이터포털');
  const k = `st:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return cached(k, 10 * 60e3, async () => {
    const u = new URL(`${GBIS}/busstationservice/v2/getBusStationAroundListv2`);
    u.search = new URLSearchParams({ serviceKey: key, x: String(lng), y: String(lat), format: 'json' });
    const list = gbisList(await getText(u), 'busStationAroundList');
    return list
      .map((s) => ({
        id: String(s.stationId),
        name: s.stationName,
        no: s.mobileNo ? String(s.mobileNo).trim() : '',
        region: s.regionName || '',
        distance: num(s.distance),
        lat: num(s.y),
        lng: num(s.x),
      }))
      .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
      .slice(0, 6);
  });
}

async function busArrivals(stationId) {
  const key = dataKey();
  if (!key) throw needKey('공공데이터포털');
  return cached(`arr:${stationId}`, 20e3, async () => {
    const u = new URL(`${GBIS}/busarrivalservice/v2/getBusArrivalListv2`);
    u.search = new URLSearchParams({ serviceKey: key, stationId, format: 'json' });
    const list = gbisList(await getText(u), 'busArrivalList');
    const seat = (v) => (num(v) == null || num(v) < 0 ? null : num(v));
    return list
      .map((b) => ({
        routeId: String(b.routeId),
        route: b.routeName ? String(b.routeName) : String(b.routeId),
        dest: b.routeDestName || '',
        min1: num(b.predictTime1),
        min2: num(b.predictTime2),
        stops1: num(b.locationNo1),
        stops2: num(b.locationNo2),
        seats1: seat(b.remainSeatCnt1),
        lowFloor1: String(b.lowPlate1) === '1',
        flag: b.flag || '',
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

async function gasStations(lat, lng, fuel, radius) {
  const key = opinetKey();
  if (!key) throw needKey('오피넷');
  const prodcd = FUELS[fuel] || FUELS.gasoline;
  const r = Math.min(5000, Math.max(1000, radius || 3000));
  const k = `gas:${lat.toFixed(3)},${lng.toFixed(3)}:${prodcd}:${r}`;
  return cached(k, 15 * 60e3, async () => {
    const [x, y] = proj4('WGS84', KATEC, [lng, lat]);
    const u = new URL('https://www.opinet.co.kr/api/aroundAll.do');
    u.search = new URLSearchParams({ code: key, x: x.toFixed(1), y: y.toFixed(1), radius: String(r), sort: '1', prodcd, out: 'json' });
    const text = await getText(u);
    let j;
    try { j = JSON.parse(text); } catch {
      throw new ApiError(/key|code|인증/i.test(text) ? '오피넷 키가 올바르지 않아요' : '오피넷 응답을 읽지 못했어요', 'BAD_KEY');
    }
    return toArr(j?.RESULT?.OIL)
      .map((o) => {
        const [glng, glat] = proj4(KATEC, 'WGS84', [Number(o.GIS_X_COOR), Number(o.GIS_Y_COOR)]);
        const brand = o.POLL_DIV_CD || o.POLL_DIV_CO || '';
        return {
          id: o.UNI_ID,
          name: o.OS_NM,
          brand: BRANDS[brand] || brand,
          price: num(o.PRICE),
          distance: num(o.DISTANCE),
          lat: glat,
          lng: glng,
        };
      })
      .filter((o) => o.price > 0)
      .sort((a, b) => a.price - b.price || (a.distance ?? 0) - (b.distance ?? 0));
  });
}

// ---------- 아파트 매매 실거래가 (국토교통부) ----------
function recentMonths(n) {
  const now = new Date(Date.now() + 9 * 3600e3); // 한국 시간
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function aptMonth(lawd, ym, isRecent) {
  const key = dataKey();
  return cached(`apt:${lawd}:${ym}`, (isRecent ? 3 : 24) * 3600e3, async () => {
    const rows = [];
    for (let page = 1; page <= 5; page++) {
      const u = new URL('https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade');
      u.search = new URLSearchParams({ serviceKey: key, LAWD_CD: lawd, DEAL_YMD: ym, numOfRows: '1000', pageNo: String(page) });
      const text = await getText(u);
      checkGatewayError(text);
      const code = xmlValue(text, 'resultCode');
      if (code && !['00', '000', '0'].includes(code)) throw new ApiError(xmlValue(text, 'resultMsg') || `실거래가 오류 (${code})`);
      const items = xmlItems(text, 'item');
      rows.push(...items);
      const total = Number(xmlValue(text, 'totalCount') || 0);
      if (rows.length >= total || items.length === 0) break;
    }
    return rows;
  });
}

async function aptTrades() {
  if (!dataKey()) throw needKey('공공데이터포털');
  const lawd = process.env.APT_LAWD_CD || '41410';
  const dong = process.env.APT_DONG || '산본동';
  const keywords = (process.env.APT_KEYWORDS || '소월,삼익').split(',').map((s) => s.trim()).filter(Boolean);
  const months = recentMonths(13);
  const monthly = await Promise.all(months.map((ym, i) => aptMonth(lawd, ym, i < 2)));
  const all = monthly.flat().map((r) => ({
    name: r.aptNm ?? r['아파트'] ?? '',
    dong: (r.umdNm ?? r['법정동'] ?? '').trim(),
    amount: Number(String(r.dealAmount ?? r['거래금액'] ?? '').replace(/[,\s]/g, '')) || null, // 만원
    year: Number(r.dealYear ?? r['년']),
    month: Number(r.dealMonth ?? r['월']),
    day: Number(r.dealDay ?? r['일']),
    area: num(r.excluUseAr ?? r['전용면적']),
    floor: num(r.floor ?? r['층']),
    built: num(r.buildYear ?? r['건축년도']),
    canceled: (r.cdealType ?? r['해제여부'] ?? '').trim() === 'O',
    kind: (r.dealingGbn ?? '').trim(), // 중개거래 / 직거래
  }));
  const inDong = all.filter((t) => t.dong.includes(dong.replace(/동$/, '')));
  const pick = inDong.filter((t) => keywords.every((k) => t.name.includes(k)));
  const candidates = [...new Set(inDong.filter((t) => keywords.some((k) => t.name.includes(k))).map((t) => t.name))];
  const trades = pick
    .map((t) => ({ ...t, date: `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` }))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.amount ?? 0) - (a.amount ?? 0));
  return {
    complex: trades[0]?.name || keywords.join(' '),
    dong,
    from: months.at(-1),
    to: months[0],
    trades,
    candidates: trades.length ? [] : candidates,
  };
}

// ---------- 라우팅 ----------
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function coords(q) {
  const lat = Number(q.get('lat'));
  const lng = Number(q.get('lng'));
  if (!(lat > 33 && lat < 39.5 && lng > 124 && lng < 132)) throw new ApiError('위치가 한국 안이 아니에요', 'BAD_POS', 400);
  return { lat, lng };
}

async function handleApi(url, res) {
  const q = url.searchParams;
  try {
    switch (url.pathname) {
      case '/api/health':
        return sendJson(res, 200, { ok: true, keys: { data: !!dataKey(), opinet: !!opinetKey() } });
      case '/api/bus/stations': {
        const { lat, lng } = coords(q);
        return sendJson(res, 200, await busStations(lat, lng));
      }
      case '/api/bus/arrivals': {
        const id = q.get('stationId') || '';
        if (!/^\d{3,12}$/.test(id)) throw new ApiError('정류장 번호가 이상해요', 'BAD_REQ', 400);
        return sendJson(res, 200, await busArrivals(id));
      }
      case '/api/gas': {
        const { lat, lng } = coords(q);
        return sendJson(res, 200, await gasStations(lat, lng, q.get('fuel'), Number(q.get('radius'))));
      }
      case '/api/apt':
        return sendJson(res, 200, await aptTrades());
      default:
        return sendJson(res, 404, { error: '없는 주소예요', code: 'NOT_FOUND' });
    }
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    const err = e instanceof ApiError ? e : new ApiError('서버에서 문제가 생겼어요', 'SERVER', 500);
    return sendJson(res, err.status, { error: err.message, code: err.code });
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
function serveStatic(url, res) {
  let rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('dist/ 가 없어요. npm run build 를 먼저 하거나, 개발 중이면 npm run dev 로 여세요.');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return handleApi(url, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(url, res);
  })
  .listen(PORT, () => console.log(`Parent Dashboard 서버: http://localhost:${PORT}`));
