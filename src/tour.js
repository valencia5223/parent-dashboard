// 나들이: 한국관광공사 국문 관광정보 서비스(TourAPI 4.0, KorService2). 공공데이터포털 같은 키(활용신청 필요).
// 이 API 는 CORS 를 허용해서(사이트 주소를 그대로 돌려줌) 중계 없이 브라우저에서 바로 부른다. 하루 1,000번이라 오래 기억한다.
//   locationBasedList2  위치 기준 가까운 곳(관광지 12·문화시설 14·레포츠 28)
//   searchFestival2     전국 축제·행사(위치는 받은 뒤 거리로 거른다)
//   detailCommon2 / detailIntro2  소개 글 · 이용 시간·쉬는 날·요금·유모차·반려동물·주차
import { cached, dataKey, FetchError, getText, num, toArr } from './sources.js';

const BASE = 'https://apis.data.go.kr/B551011/KorService2';

async function tour(path, params) {
  const key = dataKey();
  if (!key) throw new FetchError('공공데이터포털 키가 설정되지 않았어요', 'NO_KEY');
  const q = new URLSearchParams({ serviceKey: key, MobileOS: 'ETC', MobileApp: 'ParentDashboard', _type: 'json', ...params });
  let text;
  try {
    text = await getText(`${BASE}/${path}?${q}`);
  } catch (e) {
    if (e.code === 'BAD_KEY') throw new FetchError('관광공사 정보 활용신청이 아직 반영되지 않았어요(신청 뒤 1시간쯤 걸려요)', 'BAD_KEY');
    throw e;
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new FetchError(/SERVICE_KEY|등록되지/.test(text) ? '관광공사 정보 활용신청이 아직 반영되지 않았어요' : '관광 정보를 읽지 못했어요'); }
  const head = j?.response?.header;
  if (head && !['0000', '00', '0'].includes(String(head.resultCode))) throw new FetchError(head.resultMsg || `관광 정보 오류 (${head.resultCode})`);
  if (j?.OpenAPI_ServiceResponse) throw new FetchError('관광공사 정보 활용신청이 아직 반영되지 않았어요', 'BAD_KEY');
  const items = j?.response?.body?.items;
  return toArr(items === '' ? [] : items?.item);
}

const distKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const kstNow = () => new Date(Date.now() + 9 * 3600e3);

const spotOf = (o) => ({
  id: String(o.contentid),
  type: String(o.contenttypeid || ''),
  title: String(o.title || '').trim(),
  addr: [o.addr1, o.addr2].filter(Boolean).join(' ').trim(),
  tel: String(o.tel || '').replace(/<[^>]*>/g, '').trim(),
  image: String(o.firstimage2 || o.firstimage || '').replace(/^http:/, 'https:'),
  lat: num(o.mapy),
  lng: num(o.mapx),
  start: o.eventstartdate ? String(o.eventstartdate) : '',
  end: o.eventenddate ? String(o.eventenddate) : '',
});

// 지역으로 찾기(areaBasedList2): 법정동 시·도 코드(lDongRegnCd, regions.json 코드 앞 2자리)·시·군·구(lDongSignguCd, 뒤 3자리).
// 사진 있는 곳을 최근 고친 순으로 100곳 받아 지금 위치에서 가까운 순으로 보여 준다.
// 구가 있는 시(수원시 장안구 41111 등)는 구 코드로 0곳이면 시 코드(41110)로 다시 묻는다.
const SIDO_WORD = (name) => String(name || '').slice(0, 2);
async function areaList(type, lawd, sidoName) {
  const p = { numOfRows: '100', pageNo: '1', arrange: 'Q', contentTypeId: type, lDongRegnCd: lawd.slice(0, 2) };
  if (lawd.length === 5) p.lDongSignguCd = lawd.slice(2);
  let list = (await tour('areaBasedList2', p)).map(spotOf).filter((s) => s.id && s.title);
  if (list.length === 0 && lawd.length === 5 && !lawd.endsWith('0')) {
    list = (await tour('areaBasedList2', { ...p, lDongSignguCd: `${lawd.slice(2, 4)}0` })).map(spotOf).filter((s) => s.id && s.title);
  }
  // 지역 조건이 안 먹어 전국이 오는 경우를 막는다(주소가 그 시·도로 시작하는 것만, 하나도 없으면 그대로)
  const w = SIDO_WORD(sidoName);
  const inSido = list.filter((s) => s.addr.startsWith(w));
  return inSido.length ? inSido : list;
}
export function fetchSpotsArea(pos, type, lawd, sidoName) {
  return cached(`tour:area:${type}:${lawd}`, 24 * 3600e3, () => areaList(type, lawd, sidoName), { persist: true })
    .then((list) => list
      .map((s) => ({ ...s, distance: s.lat && s.lng ? distKm(pos, s) : null }))
      .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9)));
}

// 가까운 곳(반경 radius m, 거리순 최대 40곳). 위치를 0.01도(약 1km)로 묶어 하루 보관
export function fetchSpots(pos, type, radius = 10000) {
  const la = pos.lat.toFixed(2);
  const lo = pos.lng.toFixed(2);
  return cached(`tour:spot:${type}:${radius}:${la},${lo}`, 24 * 3600e3, async () => {
    const list = await tour('locationBasedList2', {
      numOfRows: '40', pageNo: '1', arrange: 'E', mapX: lo, mapY: la, radius: String(radius), contentTypeId: type,
    });
    return list.map(spotOf).filter((s) => s.id && s.title);
  }, { persist: true }).then((list) => list
    .map((s) => ({ ...s, distance: s.lat && s.lng ? distKm(pos, s) : null }))
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9)));
}

// 전국 축제·행사(두 달 전 시작한 것부터, 반나절 메모리 보관) → 근처 within km 안, 오늘 이후 끝나는 것
function allFestivals() {
  const from = new Date(kstNow().getTime() - 60 * 86400e3);
  return cached(`tour:fest:${ymd(kstNow())}`, 12 * 3600e3, async () => {
    const out = [];
    for (let page = 1; page <= 4; page++) {
      const list = await tour('searchFestival2', { numOfRows: '1000', pageNo: String(page), arrange: 'C', eventStartDate: ymd(from) });
      out.push(...list.map(spotOf));
      if (list.length < 1000) break;
    }
    return out;
  });
}
// 시·도: 축제 주소(addr1)의 앞부분으로 거른다('경기도 …', '강원특별자치도 …', '전북특별자치도 …' 등)
export const SIDOS = [
  { id: 'all', label: '전국', re: null },
  { id: '서울', label: '서울', re: /^서울/ },
  { id: '경기', label: '경기', re: /^경기/ },
  { id: '인천', label: '인천', re: /^인천/ },
  { id: '강원', label: '강원', re: /^강원/ },
  { id: '충북', label: '충북', re: /^(충청북|충북)/ },
  { id: '충남', label: '충남', re: /^(충청남|충남)/ },
  { id: '대전', label: '대전', re: /^대전/ },
  { id: '세종', label: '세종', re: /^세종/ },
  { id: '전북', label: '전북', re: /^(전라북|전북)/ },
  { id: '전남', label: '전남', re: /^(전라남|전남)/ },
  { id: '광주', label: '광주', re: /^광주광역/ },
  { id: '경북', label: '경북', re: /^(경상북|경북)/ },
  { id: '경남', label: '경남', re: /^(경상남|경남)/ },
  { id: '대구', label: '대구', re: /^대구/ },
  { id: '울산', label: '울산', re: /^울산/ },
  { id: '부산', label: '부산', re: /^부산/ },
  { id: '제주', label: '제주', re: /^제주/ },
];
// 지금 위치의 시·도(regions.json 의 가장 가까운 행정동)
export async function sidoOf(pos) {
  const d = (await import('./regions.json')).default;
  let best = null;
  let bd = Infinity;
  for (const [lat, lng, i] of d.pts) {
    const dd = (lat - pos.lat) ** 2 + ((lng - pos.lng) * 0.8) ** 2;
    if (dd < bd) { bd = dd; best = d.sgg[i][1]; }
  }
  return SIDOS.find((s) => s.re && s.re.test(best || ''))?.id || 'all';
}

// 고른 시·도의 축제·행사(오늘 이후 끝나는 것). 진행 중인 것 먼저(가까운 순), 다음은 곧 시작하는 순
export function fetchFestivals(pos, sido = 'all') {
  const today = ymd(kstNow());
  const s = SIDOS.find((x) => x.id === sido) || SIDOS[0];
  return cached(`tour:festsido:${today}:${s.id}`, 12 * 3600e3, async () => (await allFestivals())
    .filter((f) => (!f.end || f.end >= today) && (!s.re || s.re.test(f.addr))), { persist: s.id !== 'all' })
    .then((list) => list
      .map((f) => ({ ...f, distance: f.lat && f.lng ? distKm(pos, f) : null, ongoing: !!f.start && f.start <= today }))
      .sort((a, b) => (b.ongoing - a.ongoing) || (a.ongoing ? (a.distance ?? 1e9) - (b.distance ?? 1e9) : a.start.localeCompare(b.start) || (a.distance ?? 1e9) - (b.distance ?? 1e9))));
}

// HTML 조각을 글로 (<br> 은 줄바꿈)
const clean = (v) => String(v ?? '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const pick = (o, names) => { for (const n of names) { const v = clean(o?.[n]); if (v) return v; } return ''; };

// 자세히: 소개 · 이용 시간 · 쉬는 날 · 요금 · 유모차 · 반려동물 · 주차 (일주일 보관)
export function fetchSpotDetail(spot) {
  return cached(`tour:detail:${spot.id}`, 7 * 24 * 3600e3, async () => {
    const [common, intro] = await Promise.all([
      tour('detailCommon2', { contentId: spot.id }).catch(() => []),
      spot.type ? tour('detailIntro2', { contentId: spot.id, contentTypeId: spot.type }).catch(() => []) : [],
    ]);
    const c = common[0] || {};
    const i = intro[0] || {};
    const homepage = (String(c.homepage || '').match(/href="([^"]+)"/) || [])[1] || '';
    return {
      overview: clean(c.overview),
      homepage,
      hours: pick(i, ['usetime', 'usetimeculture', 'usetimeleports', 'playtime']),
      rest: pick(i, ['restdate', 'restdateculture', 'restdateleports']),
      fee: pick(i, ['usefee', 'usefeeleports', 'usetimefestival']),
      place: pick(i, ['eventplace']),
      age: pick(i, ['expagerange', 'expagerangeleports', 'agelimit']),
      stroller: pick(i, ['chkbabycarriage', 'chkbabycarriageculture', 'chkbabycarriageleports']),
      pet: pick(i, ['chkpet', 'chkpetculture', 'chkpetleports']),
      parking: pick(i, ['parking', 'parkingculture', 'parkingleports']),
      tel: pick(i, ['infocenter', 'infocenterculture', 'infocenterleports', 'sponsor1tel']) || clean(c.tel),
    };
  }, { persist: true });
}
