// 공휴일: 한국천문연구원 특일 정보 API(공공데이터포털, 같은 키, CORS 허용)를 쓰고, 키가 이 API 에 등록되지 않았거나
// 실패하면 아래 표를 쓴다. 표는 해마다 추가할 것(API 를 신청하면 표가 없어도 됨).
const BUILT_IN = {
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)', '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)', '2026-06-03': '전국동시지방선거',
  '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일(개천절)', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴',
  '2027-02-09': '대체공휴일(설날)', '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일', '2027-08-15': '광복절', '2027-08-16': '대체공휴일(광복절)',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-10-03': '개천절',
  '2027-10-04': '대체공휴일(개천절)', '2027-10-09': '한글날', '2027-10-11': '대체공휴일(한글날)',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일(성탄절)',
};

// 쉬는 날(날짜 문자열) 모음. API 로 받은 날도 여기에 더해져 병원 진료시간 계산(공휴일 칸)에도 쓰인다.
export const HOLIDAYS = new Set(Object.keys(BUILT_IN));

const API = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const mem = new Map();

function dataKey() {
  const k = (import.meta.env.VITE_DATA_GO_KR_KEY || '').trim();
  if (!k) return '';
  try { return k.includes('%') ? decodeURIComponent(k) : k; } catch { return k; }
}

async function fromApi(year) {
  const key = dataKey();
  if (!key) return null;
  const cacheKey = `pd_cache:holidays:${year}`;
  try {
    const s = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (s && Date.now() - s.t < 7 * 864e5) return s.v;
  } catch { /* 저장소를 못 써도 괜찮음 */ }
  const q = new URLSearchParams({ serviceKey: key, solYear: String(year), numOfRows: '100', _type: 'json' });
  const res = await fetch(`${API}?${q}`);
  const j = await res.json().catch(() => null);
  const items = j?.response?.body?.items?.item;
  if (!j?.response?.header || !['00', '0'].includes(String(j.response.header.resultCode))) return null;
  const out = {};
  for (const it of [items || []].flat()) {
    if (it.isHoliday !== 'Y') continue;
    const d = String(it.locdate);
    out[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = it.dateName;
  }
  try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v: out })); } catch { /* 괜찮음 */ }
  return out;
}

// 한 해의 공휴일 { 'YYYY-MM-DD': 이름 }
export function fetchHolidays(year) {
  if (!mem.has(year)) {
    mem.set(year, (async () => {
      const api = await fromApi(year).catch(() => null);
      const list = api && Object.keys(api).length
        ? api
        : Object.fromEntries(Object.entries(BUILT_IN).filter(([d]) => d.startsWith(`${year}-`)));
      for (const d of Object.keys(list)) HOLIDAYS.add(d);
      return list;
    })());
  }
  return mem.get(year);
}
