import { useMemo, useState } from 'react';
import { APTS, fetchApt, useFetch } from '../api.js';
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

// 'YYYY-MM-DD' 에서 n일 전 날짜
const daysBefore = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const avg = (list) => list.reduce((s, t) => s + t.amount, 0) / list.length;
// 1년 전 대비: 이 평형의 최근 거래일 기준 3개월 평균 ↔ 1년 전 같은 3개월 평균. 어느 쪽이든 거래가 없으면 null
function yearChange(trades) {
  if (!trades.length) return null;
  const last = trades[0].date; // 최신순
  const recent = trades.filter((t) => t.date > daysBefore(last, 90));
  const base = trades.filter((t) => t.date <= daysBefore(last, 365) && t.date > daysBefore(last, 455));
  if (!recent.length || !base.length) return null;
  return { pct: ((avg(recent) - avg(base)) / avg(base)) * 100, base: Math.round(avg(base)), n: base.length };
}
function Change({ c }) {
  if (!c) return <small className="apt-change">1년 전 같은 때 거래 없음</small>;
  const p = Math.round(c.pct * 10) / 10;
  const cls = p > 0 ? 'up' : p < 0 ? 'down' : 'flat';
  const sign = p > 0 ? '▲' : p < 0 ? '▼' : '';
  return (
    <small className={`apt-change apt-change-${cls}`} title={`1년 전 같은 3개월 평균 ${price(c.base)} (${c.n}건)과 최근 3개월 평균 비교`}>
      1년 전보다 <b>{sign} {Math.abs(p).toFixed(1)}%</b>
    </small>
  );
}

const saved = () => { try { return localStorage.getItem('pd_apt'); } catch { return null; } };

export default function AptCard() {
  const [id, setId] = useState(() => (APTS.some((a) => a.id === saved()) ? saved() : APTS[0].id));
  const state = useFetch(() => fetchApt(id), [id], { interval: 6 * 3600e3 });
  const pick = (v) => { setId(v); try { localStorage.setItem('pd_apt', v); } catch { /* 저장 못 해도 괜찮음 */ } };

  return (
    <Card title="아파트 실거래가" icon="🏠" state={state} onRefresh={state.reload}>
      <div className="chips" role="tablist" aria-label="단지 고르기">
        {APTS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={id === a.id} className={`chip${id === a.id ? ' chip-on' : ''}`} onClick={() => pick(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      {/* 단지를 바꾸는 동안에는 이전 단지 표 대신 뼈대를 보여 준다 */}
      <Body state={state.data?.id === id ? state : { ...state, data: null }} lines={5}>
        {(apt) => <AptBody key={apt.id} apt={apt} />}
      </Body>
      <p className="card-foot">국토교통부 실거래가 공개 자료 · 신고 후 반영까지 시간이 걸려요(계약 후 30일 안 신고)</p>
    </Card>
  );
}

function AptBody({ apt }) {
  const [area, setArea] = useState('all');
  const [more, setMore] = useState(false);
  // 화면에 보여 주는 것은 최근 13개월, 변화율 계산에는 더 오래된 거래까지 쓴다
  const since = `${apt.from.slice(0, 4)}-${apt.from.slice(4)}-01`;
  const recentAll = useMemo(() => apt.trades.filter((t) => t.date >= since), [apt.trades, since]);
  const valid = useMemo(() => recentAll.filter((t) => !t.canceled), [recentAll]);
  const areas = useMemo(() => {
    const ok = apt.trades.filter((t) => !t.canceled && t.amount);
    const m = new Map();
    for (const t of valid) {
      const k = areaKey(t.area);
      const g = m.get(k) || { key: k, area: t.area, count: 0, latest: t };
      g.count += 1;
      m.set(k, g);
    }
    for (const g of m.values()) g.change = yearChange(ok.filter((t) => areaKey(t.area) === g.key));
    return [...m.values()].sort((a, b) => a.key - b.key);
  }, [valid, apt.trades]);

  if (recentAll.length === 0) {
    return (
      <div className="empty">
        <p>최근 1년({apt.from.slice(0, 4)}.{apt.from.slice(4)} ~ {apt.to.slice(0, 4)}.{apt.to.slice(4)}) {apt.dong} 거래가 없어요.</p>
      </div>
    );
  }

  const shown = recentAll.filter((t) => area === 'all' || areaKey(t.area) === area);
  const list = more ? shown : shown.slice(0, 8);

  return (
    <>
      <p className="apt-sub">{apt.label} · 군포시 {apt.dong} · 최근 1년 {valid.length}건</p>
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
            <Change c={g.change} />
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
