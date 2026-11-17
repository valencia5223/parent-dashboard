import { useMemo, useState } from 'react';
import { fetchApt, useFetch } from '../api.js';
import Card, { Body } from './Card.jsx';

// 만원 → "6억 2,500만원"
function price(man) {
  if (man == null) return '-';
  const eok = Math.floor(man / 10000);
  const rest = man % 10000;
  if (!eok) return `${rest.toLocaleString('ko-KR')}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
}
const pyeong = (m2) => (m2 == null ? '' : `${(m2 * 0.3025).toFixed(1)}평`);
const dateText = (d) => `${Number(d.slice(2, 4))}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
// 면적은 소수점이 조금씩 달라도 같은 평형으로 묶는다
const areaKey = (m2) => Math.round(m2);

export default function AptCard() {
  const state = useFetch(fetchApt, [], { interval: 6 * 3600e3 });
  const [area, setArea] = useState('all');
  const [more, setMore] = useState(false);

  return (
    <Card title="삼익소월 실거래가" icon="🏠" state={state} onRefresh={state.reload} wide>
      <Body state={state} lines={5}>
        {(apt) => <AptBody apt={apt} area={area} setArea={setArea} more={more} setMore={setMore} />}
      </Body>
      <p className="card-foot">국토교통부 실거래가 공개 자료 · 신고 후 반영까지 시간이 걸려요(계약 후 30일 안 신고)</p>
    </Card>
  );
}

function AptBody({ apt, area, setArea, more, setMore }) {
  const valid = useMemo(() => apt.trades.filter((t) => !t.canceled), [apt.trades]);
  const areas = useMemo(() => {
    const m = new Map();
    for (const t of valid) {
      const k = areaKey(t.area);
      const g = m.get(k) || { key: k, area: t.area, count: 0, latest: t };
      g.count += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.key - b.key);
  }, [valid]);

  if (apt.trades.length === 0) {
    return (
      <div className="empty">
        <p>최근 1년({apt.from.slice(0, 4)}.{apt.from.slice(4)} ~ {apt.to.slice(0, 4)}.{apt.to.slice(4)}) {apt.dong} 거래가 없어요.</p>
        {apt.candidates.length > 0 && <p>비슷한 이름의 단지: {apt.candidates.join(', ')} — 이름 설정을 바꿔야 할 수 있어요</p>}
      </div>
    );
  }

  const shown = apt.trades.filter((t) => area === 'all' || areaKey(t.area) === area);
  const list = more ? shown : shown.slice(0, 8);

  return (
    <>
      <p className="apt-sub">{apt.complex} · 군포시 {apt.dong} · 최근 1년 {valid.length}건</p>
      <div className="apt-summary">
        {areas.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`apt-area${area === g.key ? ' apt-area-on' : ''}`}
            onClick={() => setArea(area === g.key ? 'all' : g.key)}
            aria-pressed={area === g.key}
          >
            <span className="apt-area-size">전용 {g.area}㎡ <small>({pyeong(g.area)})</small></span>
            <strong>{price(g.latest.amount)}</strong>
            <small>최근 {dateText(g.latest.date)} · {g.latest.floor}층 · 1년 {g.count}건</small>
          </button>
        ))}
      </div>
      <table className="apt-table">
        <thead>
          <tr><th>계약일</th><th>전용면적</th><th>층</th><th className="num">거래금액</th></tr>
        </thead>
        <tbody>
          {list.map((t, i) => (
            <tr key={`${t.date}-${t.area}-${t.floor}-${i}`} className={t.canceled ? 'apt-canceled' : ''}>
              <td>{dateText(t.date)}</td>
              <td>{t.area}㎡</td>
              <td>{t.floor}층</td>
              <td className="num">
                {price(t.amount)}
                {t.canceled && <small> 취소된 거래</small>}
                {t.kind === '직거래' && <small> 직거래</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length > 8 && (
        <button type="button" className="btn btn-block" onClick={() => setMore(!more)}>
          {more ? '접기' : `${shown.length - 8}건 더 보기`}
        </button>
      )}
    </>
  );
}
