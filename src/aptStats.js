// 실거래가 통계에서 시세를 흐리는 거래를 거른다.
// - 직거래(dealingGbn '직거래'): 가족 간 거래 등 시세와 먼 값이 많다.
// - 시세와 차이 큰 거래: 같은 평형의 앞뒤 3개월 다른 거래(중개, 3건 이상) 중앙값보다 25% 넘게 싸거나 30% 넘게 비싼 거래.
// 그래프·최고가·1년 전 대비는 이 둘을 빼고(odd), 표에는 그대로 두고 꼬리표만 단다.
export const areaKey = (m2) => Math.round(m2);

export function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

const dayNum = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;

// 거래 → 이유('직거래' | '시세보다 낮음' | '시세보다 높음'). 문제없으면 Map 에 없음
export function oddTrades(trades) {
  const out = new Map();
  const ok = trades.filter((t) => !t.canceled && t.amount);
  for (const t of ok) if (t.kind === '직거래') out.set(t, '직거래');
  const byArea = new Map();
  for (const t of ok) {
    if (out.has(t)) continue;
    const k = areaKey(t.area);
    if (!byArea.has(k)) byArea.set(k, []);
    byArea.get(k).push(t);
  }
  for (const list of byArea.values()) {
    for (const t of list) {
      const d = dayNum(t.date);
      const near = list.filter((u) => u !== t && Math.abs(dayNum(u.date) - d) <= 92).map((u) => u.amount);
      if (near.length < 3) continue;
      const m = median(near);
      if (t.amount < m * 0.75) out.set(t, '시세보다 낮음');
      else if (t.amount > m * 1.3) out.set(t, '시세보다 높음');
    }
  }
  return out;
}

// n일 전 대비 변화: 이 평형의 마지막 거래일부터 거슬러 2개월 중간값 ↔ n일 전 같은 2개월 중간값.
// 3개월로 묶으면 빠르게 오른 단지에서 석 달 전 싼 거래가 섞여 오름폭이 작게 잡혀서 2개월로 한다.
// 어느 쪽이든 2개월 안 거래가 3건 미만이면 3개월로 넓힌다(몇 건 때문에 튀지 않게).
// trades 는 최신순, 직거래·시세와 차이 큰 거래를 뺀 것. 넓혀도 거래가 없으면 null.
// 평형 칸의 '1년 전보다'(365)와 그래프의 '2년 전보다'(730)가 같은 방식이다.
const daysBefore = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
// 돌려주는 구간: [start, end] (start 는 그날 포함하도록 하루 뒤로 맞춤)
function windowAmounts(trades, last, from) {
  const pick = (len) => ({
    amounts: trades.filter((t) => t.date <= daysBefore(last, from) && t.date > daysBefore(last, from + len)).map((t) => t.amount),
    start: daysBefore(last, from + len - 1),
    end: daysBefore(last, from),
  });
  const two = pick(60);
  return two.amounts.length >= 3 ? two : pick(90);
}
export function periodChange(trades, days) {
  if (!trades.length) return null;
  const last = trades[0].date;
  const recent = windowAmounts(trades, last, 0);
  const base = windowAmounts(trades, last, days);
  if (!recent.amounts.length || !base.amounts.length) return null;
  const now = median(recent.amounts);
  const was = median(base.amounts);
  return {
    pct: ((now - was) / was) * 100, now, base: was, n: base.amounts.length, nNow: recent.amounts.length,
    nowRange: [recent.start, recent.end], baseRange: [base.start, base.end],
  };
}
