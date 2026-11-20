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
