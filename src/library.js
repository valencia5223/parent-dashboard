// 도서관 (도서관 정보나루 Open API, 국립중앙도서관. 공공데이터포털과 다른 키: VITE_LIBRARY_KEY)
// http://data4library.kr/api/* 는 CORS 를 허용하지 않아 /api/lib 중계(render.yaml rewrite · vite proxy)로 부른다.
// 키는 기본 하루 500번까지라(서버 IP 를 등록할 수 없는 정적 사이트) 결과를 오래 기억해 다시 묻지 않는다.
//   libSrch        시·도의 도서관 목록(위치·휴관일·운영시간) — 일주일 보관
//   srchBooks      책 찾기 — 하루
//   libSrchByBook  이 책을 가진 시·도의 도서관 — 하루
//   bookExist      도서관 한 곳의 소장·대출 가능 — 30분
//   loanItemSrch   지역 인기 대출 책 — 하루
import { cached, FetchError, getText, num, toArr } from './sources.js';
import { HOLIDAYS } from './holidays.js';
import { pyxisAvailability, pyxisLibraries, systemsNear } from './pyxisLibs.js';

const libKey = () => (import.meta.env.VITE_LIBRARY_KEY || '').trim();
export const hasLibraryKey = () => !!libKey();

async function lib(path, params) {
  const key = libKey();
  if (!key) throw new FetchError('도서관 정보나루 인증키를 기다리고 있어요. 승인되면 바로 쓸 수 있어요.', 'NO_KEY');
  const q = new URLSearchParams({ authKey: key, format: 'json', ...params });
  const text = await getText(`/api/lib/${path}?${q}`);
  let j;
  try { j = JSON.parse(text); } catch { throw new FetchError('도서관 정보를 읽지 못했어요'); }
  const r = j?.response ?? j;
  if (r?.error) {
    const msg = String(r.error);
    throw new FetchError(/인증|key|키/i.test(msg) ? `도서관 정보나루 키 오류: ${msg}` : msg, /인증|key|키/i.test(msg) ? 'BAD_KEY' : undefined);
  }
  return r;
}
// 목록이 [{lib:{…}}] 이나 [{…}] 로 올 수 있어 둘 다 받는다
const unwrap = (list, inner) => toArr(list).map((x) => x?.[inner] ?? x).filter(Boolean);

// ---------- 시·도 코드 (정보나루 region) ----------
const SIDO = [
  ['서울', '11'], ['부산', '21'], ['대구', '22'], ['인천', '23'], ['광주', '24'], ['대전', '25'], ['울산', '26'], ['세종', '29'],
  ['경기', '31'], ['강원', '32'], ['충청북', '33'], ['충북', '33'], ['충청남', '34'], ['충남', '34'], ['전라북', '35'], ['전북', '35'],
  ['전라남', '36'], ['전남', '36'], ['경상북', '37'], ['경북', '37'], ['경상남', '38'], ['경남', '38'], ['제주', '39'],
];
const sidoCode = (name) => SIDO.find(([p]) => String(name || '').startsWith(p))?.[1] || null;

// 위치에서 10km 안에 걸치는 시·도(경계 근처면 둘 이상). regions.json 의 행정동 중심점으로 정한다.
async function sidosNear(pos) {
  const d = (await import('./regions.json')).default;
  const found = new Map();
  for (const [lat, lng, i] of d.pts) {
    const km = Math.hypot((lat - pos.lat) * 111, (lng - pos.lng) * 88);
    const code = sidoCode(d.sgg[i][1]);
    if (code && (!found.has(code) || km < found.get(code))) found.set(code, km);
  }
  const list = [...found.entries()].sort((a, b) => a[1] - b[1]);
  return list.filter(([, km], i) => i === 0 || km < 10).map(([c]) => c);
}

export const distKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// '설&middot;추석' 처럼 HTML 기호가 섞여 온다
const unent = (v) => String(v || '').replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, ' ').trim();
const libOf = (o) => ({
  code: String(o.libCode ?? ''),
  name: unent(o.libName),
  address: o.address || '',
  tel: o.tel || '',
  homepage: o.homepage || '',
  closed: unent(o.closed),
  hours: unent(o.operatingTime),
  lat: num(o.latitude),
  lng: num(o.longitude),
});

// 시·도 하나의 도서관 전부(일주일 보관)
function sidoLibraries(region) {
  return cached(`lib:sido:${region}`, 7 * 24 * 3600e3, async () => {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await lib('libSrch', { region, pageNo: String(page), pageSize: '1000' });
      const list = unwrap(r.libs, 'lib').map(libOf).filter((l) => l.code);
      out.push(...list);
      if (list.length < 1000) break;
    }
    return out;
  }, { persist: true });
}

// 근처 도서관(10km 안, 가까운 순). 정보나루 + 정보나루에 없는 시의 도서관 홈페이지 자료(pyxisLibs.js)
export async function fetchLibraries(pos) {
  const regions = await sidosNear(pos);
  const systems = systemsNear(pos);
  const [main, extra] = await Promise.all([
    Promise.allSettled(regions.map((r) => sidoLibraries(r))),
    Promise.allSettled(systems.map((s) => pyxisLibraries(s))),
  ]);
  const extraLibs = extra.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const mainLibs = main.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (mainLibs.length === 0 && extraLibs.length === 0) {
    const err = main.find((r) => r.status === 'rejected');
    if (err) throw err.reason;
  }
  const replaced = new Set(systems.filter((s, i) => extra[i].status === 'fulfilled').flatMap((s) => s.replaces));
  const seen = new Set();
  return [...mainLibs.filter((l) => !replaced.has(l.code)), ...extraLibs]
    .filter((l) => l.lat && l.lng && !seen.has(l.code) && seen.add(l.code))
    .map((l) => ({ ...l, distance: distKm(pos, l) }))
    .filter((l) => l.distance <= 10)
    .sort((a, b) => a.distance - b.distance);
}

// ---------- 책 ----------
const bookOf = (o) => ({
  isbn: String(o.isbn13 || o.isbn || '').trim(),
  title: String(o.bookname || '').trim(),
  authors: String(o.authors || '').replace(/^지은이\s*:\s*/, '').trim(),
  publisher: String(o.publisher || '').trim(),
  year: String(o.publication_year || '').trim(),
  cover: String(o.bookImageURL || '').replace(/^http:/, 'https:'),
  loans: num(o.loan_count ?? o.loanCnt),
});

// 책 찾기. 정보나루의 keyword 검색은 여러 단어('국민이 먼저입니다')면 0건이 되거나 엉뚱한 책이 나와서
// 제목(title)·저자(author) 검색을 같이 부르고, 입력한 글자와 맞는 정도로 다시 줄 세운다.
// 제목 검색은 낱말 일부만 맞아도 대출 많은 순으로 잔뜩 오므로 100권을 받아 그 안에서 고른다.
const squash = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
function matchScore(b, q, words) {
  const t = squash(b.title);
  const a = squash(b.authors);
  if (t.startsWith(q)) return 5;
  if (t.includes(q)) return 4;
  if (a.includes(q)) return 4;
  if (words.length > 1 && words.every((w) => t.includes(w) || a.includes(w))) return 2;
  if (words.some((w) => w.length > 1 && t.includes(w))) return 1;
  return 0;
}
export function searchBooks(text) {
  const k = String(text || '').trim().replace(/\s+/g, ' ');
  return cached(`lib:q2:${k}`, 24 * 3600e3, async () => {
    const isbn = k.replace(/[-\s]/g, '');
    if (/^\d{13}$/.test(isbn)) {
      const r = await lib('srchBooks', { isbn13: isbn, pageNo: '1', pageSize: '5' });
      return unwrap(r.docs, 'doc').map(bookOf).filter((b) => b.isbn && b.title);
    }
    const tries = await Promise.allSettled([
      lib('srchBooks', { title: k, pageNo: '1', pageSize: '100' }),
      lib('srchBooks', { author: k, pageNo: '1', pageSize: '30' }),
    ]);
    if (tries.every((r) => r.status === 'rejected')) throw tries[0].reason;
    const q = squash(k);
    const words = k.split(' ').map(squash).filter(Boolean);
    const seen = new Set();
    const all = tries
      .flatMap((r) => (r.status === 'fulfilled' ? unwrap(r.value.docs, 'doc') : []))
      .map(bookOf)
      .filter((b) => b.isbn && b.title && !seen.has(b.isbn) && seen.add(b.isbn))
      .map((b) => ({ b, s: matchScore(b, q, words) }));
    const good = all.filter((x) => x.s > 0);
    return (good.length ? good : all)
      .sort((x, y) => (y.s - x.s) || ((y.b.loans || 0) - (x.b.loans || 0)))
      .slice(0, 20)
      .map((x) => x.b);
  });
}

// 인기 대출 책 장르. kdc = 한국십진분류 대분류, addCode 0 = 일반 도서(어린이책을 빼야 과학·역사 등이 '흔한남매'로 덮이지 않음), 7 = 아동
export const GENRES = [
  { id: 'all', label: '전체', p: {} },
  { id: 'lit', label: '소설·문학', p: { kdc: '8', addCode: '0' } },
  { id: 'soc', label: '경제·사회', p: { kdc: '3', addCode: '0' } },
  { id: 'mind', label: '마음·철학', p: { kdc: '1', addCode: '0' } },
  { id: 'sci', label: '과학', p: { kdc: '4', addCode: '0' } },
  { id: 'life', label: '건강·생활', p: { kdc: '5', addCode: '0' } },
  { id: 'art', label: '예술·취미', p: { kdc: '6', addCode: '0' } },
  { id: 'hist', label: '역사·여행', p: { kdc: '9', addCode: '0' } },
  { id: 'kids', label: '어린이', p: { addCode: '7' } },
];
// 같은 책이 권·판마다 따로 올라와서 제목(부제·권 번호 뺀)으로 하나만 남긴다
const titleKey = (t) => String(t || '').split(/\s*[:=]/)[0].replace(/[\s()（）]/g, '').replace(/\d+$/, '');
export async function fetchPopular(pos, genre = 'all') {
  const [region] = await sidosNear(pos);
  const g = GENRES.find((x) => x.id === genre) || GENRES[0];
  const day = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
  return cached(`lib:pop2:${region}:${g.id}:${day(1)}`, 24 * 3600e3, async () => {
    const r = await lib('loanItemSrch', { startDt: day(31), endDt: day(1), region, pageNo: '1', pageSize: '40', ...g.p });
    const seen = new Set();
    return unwrap(r.docs, 'doc').map(bookOf)
      .filter((b) => b.isbn && b.title && !seen.has(titleKey(b.title)) && seen.add(titleKey(b.title)))
      .slice(0, 15);
  }, { persist: true });
}

// 이 책을 가진 근처 도서관 코드(시·도 단위로 묻고, 근처 목록과 겹치는 것만 쓴다)
function holders(isbn, region) {
  return cached(`lib:has:${region}:${isbn}`, 24 * 3600e3, async () => {
    const r = await lib('libSrchByBook', { isbn, region, pageNo: '1', pageSize: '500' });
    return unwrap(r.libs, 'lib').map((o) => String(o.libCode ?? '')).filter(Boolean);
  }, { persist: true });
}

function bookExist(code, isbn) {
  return cached(`lib:ex:${code}:${isbn}`, 30 * 60e3, async () => {
    const r = await lib('bookExist', { libCode: code, isbn13: isbn });
    const res = r.result ?? r;
    return { has: res.hasBook === 'Y', available: res.loanAvailable === 'Y' };
  }, { persist: true });
}

// 근처에서 이 책을 가진 도서관과 지금 빌릴 수 있는지. 즐겨찾는 도서관 → 가까운 곳 순으로 최대 limit 곳만 대출 여부를 묻는다.
// 도서관 홈페이지 자료(군포 등)는 한 번에 모든 지점의 실시간 상태가 와서 따로 세지 않는다.
export async function bookAvailability(pos, isbn, favCodes = [], limit = 6) {
  const [near, regions] = await Promise.all([fetchLibraries(pos), sidosNear(pos)]);
  const systems = systemsNear(pos);
  const [codeLists, extra] = await Promise.all([
    Promise.all(regions.map((r) => holders(isbn, r).catch(() => []))),
    Promise.all(systems.map((s) => pyxisAvailability(s, isbn).catch(() => ({})))),
  ]);
  const codes = new Set(codeLists.flat());
  const live = Object.assign({}, ...extra);
  const fav = new Set(favCodes);
  const byFavDist = (a, b) => (fav.has(b.code) - fav.has(a.code)) || a.distance - b.distance;
  const liveLibs = near.filter((l) => live[l.code]).map((l) => ({ ...l, ...live[l.code] }));
  const have = near.filter((l) => codes.has(l.code) && !live[l.code] && !String(l.code).includes(':')).sort(byFavDist);
  const checked = await Promise.all(have.slice(0, limit).map(async (l) => {
    try { return { ...l, ...(await bookExist(l.code, isbn)) }; } catch { return { ...l, has: true, available: null }; }
  }));
  const known = [...liveLibs, ...checked].sort(byFavDist);
  return { libs: [...known, ...have.slice(limit).map((l) => ({ ...l, has: true, available: null }))], nearCount: near.length };
}

// ---------- 오늘 휴관인지 (휴관일 글은 도서관마다 제각각이라 흔한 꼴만 읽는다) ----------
const DAYS = '일월화수목금토';
const ORD = { 첫: 1, 둘: 2, 셋: 3, 넷: 4, 다섯: 5 };
// 반환: true 쉬는 날 / false 여는 날 / null 모름
export function closedToday(text, now = new Date(Date.now() + 9 * 3600e3)) {
  const t = String(text || '');
  if (!t) return null;
  const ymd = now.toISOString().slice(0, 10);
  const wd = DAYS[now.getUTCDay()];
  const date = now.getUTCDate();
  const nth = Math.ceil(date / 7);
  const last = date + 7 > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  // '2026/8/31 부터 전체 휴관, 27년 재개관 예정' 같은 오랜 휴관
  if (/재개관|리모델링|공사\s*중|부터\s*(전체\s*)?휴관|휴관\s*중/.test(t)) return true;
  let understood = false;
  // '둘째·넷째 월요일', '2,4째주' 는 한 덩어리로 둔다
  for (const seg of t.split(/,(?!\s*\d)|，|\/|및|\n|;/)) {
    if (/공휴일|국경일|명절|설날|추석/.test(seg)) {
      understood = true;
      if (HOLIDAYS.has(ymd) && !/공휴일\s*(정상|개관|운영)/.test(seg)) return true;
    }
    const days = [...seg.matchAll(/([일월화수목금토])요일/g)].map((m) => m[1]);
    if (days.length === 0) continue;
    understood = true;
    if (!days.includes(wd)) continue;
    const ords = [...seg.matchAll(/(첫|둘|셋|넷|다섯)째/g)].map((m) => ORD[m[1]]);
    const nums = [...seg.matchAll(/제?\s*([1-5])\s*(?:,|째|주)/g)].map((m) => Number(m[1]));
    const weeks = [...ords, ...nums];
    if (/마지막/.test(seg) && last) return true;
    if (weeks.length === 0 && !/마지막/.test(seg)) return true; // 매주
    if (weeks.includes(nth)) return true;
  }
  return understood ? false : null;
}
