// 생활 달력: 내 날짜(생일·기념일·납부일 등)·쓰레기 버리는 요일 저장과 날짜 계산.
// 지금은 이 기기(localStorage pd_life_v1)에만 저장한다. 나중에 계정에 묶을 때 이 객체를 통째로 올리면 된다.
// 날짜는 모두 한국 시간 'YYYY-MM-DD' 문자열로 다룬다.

const KEY = 'pd_life_v1';

export const KINDS = [
  { id: 'birthday', icon: '🎂', label: '생일' },
  { id: 'anniv', icon: '💝', label: '기념일' },
  { id: 'money', icon: '💰', label: '납부·돈' },
  { id: 'car', icon: '🚗', label: '자동차' },
  { id: 'health', icon: '🏥', label: '건강' },
  { id: 'etc', icon: '📌', label: '기타' },
];
export const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];

export const REPEATS = [
  { id: 'yearly', label: '매년' },
  { id: 'monthly', label: '매달' },
  { id: 'once', label: '한 번' },
];

export const TRASH = [
  { id: 'general', icon: '🗑️', label: '일반 쓰레기' },
  { id: 'recycle', icon: '♻️', label: '재활용' },
  { id: 'food', icon: '🍲', label: '음식물' },
];
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const empty = () => ({ v: 1, events: [], trash: { general: [], recycle: [], food: [] }, updatedAt: 0 });

export function loadLife() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.v === 1 && Array.isArray(s.events)) return { ...empty(), ...s, trash: { ...empty().trash, ...s.trash } };
  } catch { /* 저장소를 못 써도 괜찮음 */ }
  return empty();
}
export function saveLife(data) {
  const v = { ...data, updatedAt: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮음 */ }
  return v;
}

// ---------- 날짜 ----------
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const todayStr = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const parts = (s) => s.split('-').map(Number);
export const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
export const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// 없는 날(2월 30일 등)은 그 달 마지막 날로
const clampYmd = (y, m, d) => ymd(y, m, Math.min(d, lastDay(y, m)));

export const dayText = (s) => { const [, m, d] = parts(s); return `${m}월 ${d}일 (${WEEK[dow(s)]})`; };
export function ddayText(n) {
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === 2) return '모레';
  return n > 0 ? `D-${n}` : `${-n}일 지남`;
}

// ---------- 음력 (korean-lunar-calendar, 필요할 때 불러옴) ----------
let lunarLib = null;
export async function loadLunar() {
  if (!lunarLib) lunarLib = (await import('korean-lunar-calendar')).default;
  return lunarLib;
}
export function solarToLunar(s) {
  if (!lunarLib) return null;
  const c = new lunarLib();
  const [y, m, d] = parts(s);
  c.setSolarDate(y, m, d);
  return c.getLunarCalendar(); // { year, month, day, intercalation }
}
function lunarToSolar(y, m, d) {
  if (!lunarLib) return null;
  const c = new lunarLib();
  // 작은달이라 30일이 없으면 29일로
  if (!c.setLunarDate(y, m, d, false) && !(d === 30 && c.setLunarDate(y, m, 29, false))) return null;
  const r = c.getSolarCalendar();
  return r?.year ? ymd(r.year, r.month, r.day) : null;
}

// 한 일정이 [from, to] 안에서 돌아오는 날짜들. 음력 매년 일정은 음력 라이브러리가 불러와진 뒤에만 계산된다.
export function occurrences(ev, from, to) {
  const [fy, fm] = parts(from);
  const [ty] = parts(to);
  const [, em, ed] = parts(ev.date);
  const out = [];
  const push = (s) => { if (s && s >= from && s <= to && s >= ev.date) out.push(s); };
  if (ev.repeat === 'once') {
    if (ev.date >= from && ev.date <= to) out.push(ev.date);
  } else if (ev.repeat === 'monthly') {
    let y = fy;
    let m = fm;
    for (let i = 0; i < 40; i++) {
      const s = clampYmd(y, m, ed);
      if (s > to) break;
      push(s);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else if (ev.lunar) {
    for (let y = fy - 1; y <= ty; y++) push(lunarToSolar(y, em, ed));
  } else {
    for (let y = fy; y <= ty; y++) push(clampYmd(y, em, ed));
  }
  return [...new Set(out)].sort();
}

// 생일은 만 나이, 기념일은 몇 주년 (처음 날짜의 해가 지났을 때만)
export function yearsText(ev, on) {
  if (ev.repeat !== 'yearly') return '';
  const n = parts(on)[0] - parts(ev.date)[0] - (ev.lunar && parts(on)[1] < parts(ev.date)[1] ? 1 : 0);
  if (n <= 0) return '';
  if (ev.kind === 'birthday') return `만 ${n}세`;
  if (ev.kind === 'anniv') return `${n}주년`;
  return '';
}

// 공휴일과 앞뒤 주말을 이어 '연휴'로 묶는다(3일 이상만): [{ from, to, days, name }]
export function longBreaks(holidays, from, to) {
  const off = (s) => holidays[s] || dow(s) === 0 || dow(s) === 6;
  const out = [];
  let s = from;
  while (s <= to) {
    if (off(s)) {
      let e = s;
      while (off(addDays(e, 1))) e = addDays(e, 1);
      const days = daysBetween(s, e) + 1;
      const names = [];
      for (let d = s; d <= e; d = addDays(d, 1)) if (holidays[d]) names.push(holidays[d].replace(/ 연휴$/, '').replace(/^대체공휴일\((.+)\)$/, '$1'));
      if (days >= 3 && names.length) out.push({ from: s, to: e, days, name: [...new Set(names)][0] });
      s = addDays(e, 1);
    } else {
      s = addDays(s, 1);
    }
  }
  return out;
}
