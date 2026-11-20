import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { DEFAULT_APTS, fetchApt, useFetch } from '../api.js';
import { markDirty, openLogin, useAccount } from '../account.js';
import Card, { Body } from './Card.jsx';
import { KaptInfo, PriceChart } from './AptExtras.jsx';
import { areaKey, median, oddTrades } from '../aptStats.js';

const AptPicker = lazy(() => import('./AptPicker.jsx'));

// 만원 → "6억 2,500만원"
function price(man) {
  if (man == null) return '-';
  const eok = Math.floor(man / 10000);
  const rest = man % 10000;
  if (!eok) return `${rest.toLocaleString('ko-KR')}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
}
const pyeong = (m2) => (m2 == null ? '' : `${(m2 * 0.3025).toFixed(1)}평`);
const APT_SHOW = 4; // 처음에 보여 줄 거래 수 (나머지는 '더 보기')
const dateText = (d) => `${Number(d.slice(2, 4))}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;

// 'YYYY-MM-DD' 에서 n일 전 날짜
const daysBefore = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const mid = (list) => median(list.map((t) => t.amount));
// 1년 전 대비: 이 평형의 최근 거래일 기준 3개월 중앙값 ↔ 1년 전 같은 3개월 중앙값(직거래·시세와 차이 큰 거래 뺀 것). 어느 쪽이든 거래가 없으면 null
function yearChange(trades) {
  if (!trades.length) return null;
  const last = trades[0].date; // 최신순
  const recent = trades.filter((t) => t.date > daysBefore(last, 90));
  const base = trades.filter((t) => t.date <= daysBefore(last, 365) && t.date > daysBefore(last, 455));
  if (!recent.length || !base.length) return null;
  return { pct: ((mid(recent) - mid(base)) / mid(base)) * 100, base: mid(base), n: base.length };
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

// 단지 목록(pd_apts)과 고른 단지(pd_apt)는 이 기기에 기억한다(로그인하면 목록은 계정에도, account.js). 목록 저장이 없으면 기본 단지.
const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮음 */ } };
const loadApts = () => {
  const v = loadJSON('pd_apts');
  return Array.isArray(v) && v.every((a) => a?.id && a.lawd && a.dong && a.name) ? v : DEFAULT_APTS;
};
const savedId = () => { try { return localStorage.getItem('pd_apt'); } catch { return null; } };

export default function AptCard({ pos }) {
  const { user } = useAccount();
  const [saved, setSaved] = useState(loadApts);
  // 단지 추가·이름 바꾸기·빼기는 로그인해야 쓸 수 있고, 로그인 전에는 기본 단지만 보여 준다
  const apts = user ? saved : DEFAULT_APTS;
  const [id, setId] = useState(() => (apts.some((a) => a.id === savedId()) ? savedId() : apts[0]?.id));
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState(null); // 'rename' | 'remove'
  const [draft, setDraft] = useState('');
  const apt = apts.find((a) => a.id === id) || apts[0];
  const state = useFetch(() => fetchApt(apt), [apt?.id, apt?.label], { interval: 6 * 3600e3, enabled: !!apt });

  const pick = (v) => { setId(v); setMode(null); try { localStorage.setItem('pd_apt', v); } catch { /* 저장 못 해도 괜찮음 */ } };
  const update = (list) => { if (!user) return; setSaved(list); saveJSON('pd_apts', list); markDirty(); };
  // 계정에서 받은 목록으로 바뀌면 다시 읽는다
  useEffect(() => {
    const re = () => setSaved(loadApts());
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, []);
  const add = (a) => {
    if (!apts.some((x) => x.id === a.id)) update([...apts, a]);
    pick(a.id);
    setAdding(false);
  };
  const rename = (e) => {
    e.preventDefault();
    const label = draft.trim();
    if (label) update(apts.map((a) => (a.id === apt.id ? { ...a, label } : a)));
    setMode(null);
  };
  const remove = () => {
    const list = apts.filter((a) => a.id !== apt.id);
    update(list);
    if (list[0]) pick(list[0].id); else setMode(null);
  };

  return (
    <Card title="부동산 · 아파트 실거래가" icon="🏠" state={apt ? state : null} onRefresh={apt ? state.reload : undefined}>
      <div className="chips" role="tablist" aria-label="단지 고르기">
        {apts.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={apt?.id === a.id} className={`chip${apt?.id === a.id ? ' chip-on' : ''}`} onClick={() => pick(a.id)}>
            {a.label}
          </button>
        ))}
        {user
          ? <button type="button" className="chip chip-add" onClick={() => setAdding(true)}>＋ 단지 추가</button>
          : <button type="button" className="chip chip-add" onClick={openLogin} title="로그인하면 원하는 단지를 추가할 수 있어요">🔒 로그인하고 단지 추가</button>}
      </div>

      {!apt ? (
        <div className="empty"><p>보고 싶은 아파트를 ‘＋ 단지 추가’로 넣어 주세요.</p></div>
      ) : (
        <>
          {mode === 'rename' ? (
            <form className="apt-manage" onSubmit={rename}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={20} aria-label="탭에 보일 이름" autoFocus />
              <button type="submit" className="btn btn-sm btn-primary">저장</button>
              <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>취소</button>
            </form>
          ) : mode === 'remove' ? (
            <div className="apt-manage apt-manage-warn">
              <span>‘{apt.label}’ 탭을 뺄까요?</span>
              <button type="button" className="btn btn-sm btn-danger" onClick={remove}>빼기</button>
              <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>취소</button>
            </div>
          ) : user && (
            <div className="apt-manage">
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => { setDraft(apt.label); setMode('rename'); }}>✏️ 이름 바꾸기</button>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => setMode('remove')}>✕ 탭에서 빼기</button>
            </div>
          )}
          {/* 단지를 바꾸는 동안에는 이전 단지 표 대신 뼈대를 보여 준다 */}
          <Body state={state.data?.id === apt.id ? state : { ...state, data: null }} lines={5}>
            {(data) => (
              <AptBody
                key={data.id}
                apt={{ ...data, label: apt.label }}
                source={apt}
                canEdit={!!user}
                onPickKapt={(code) => update(apts.map((a) => (a.id === apt.id ? { ...a, kapt: code } : a)))}
              />
            )}
          </Body>
        </>
      )}
      <p className="card-foot">국토교통부 실거래가 공개 자료 · 단지 정보: 공동주택관리정보시스템(K-apt) · 신고 후 반영까지 시간이 걸려요(계약 후 30일 안 신고) · {user ? '단지 목록은 계정에 저장돼요' : '로그인하면 원하는 단지를 추가할 수 있어요'}</p>
      {adding && (
        <Suspense fallback={null}>
          <AptPicker pos={pos} existing={apts} onAdd={add} onClose={() => setAdding(false)} />
        </Suspense>
      )}
    </Card>
  );
}

// '2년 최고가': 평형마다 받아 둔 2년 치 거래 중 가장 비싼 거래 딱 1건(같은 금액이면 가장 최근 것).
// 직거래·시세와 차이 큰 거래는 빼고, 그 평형 거래가 4건 이상일 때만
function recordSet(trades, odd) {
  const best = new Map();
  const count = new Map();
  for (const t of trades) { // 최신순이라 같은 금액이면 먼저 나온(최근) 거래가 남는다
    if (t.canceled || !t.amount || odd.has(t)) continue;
    const k = areaKey(t.area);
    count.set(k, (count.get(k) || 0) + 1);
    if (!best.has(k) || t.amount > best.get(k).amount) best.set(k, t);
  }
  return new Set([...best].filter(([k]) => count.get(k) >= 4).map(([, t]) => t));
}
const ymOf = (offset) => {
  const now = new Date(Date.now() + 9 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function AptBody({ apt, source, canEdit, onPickKapt }) {
  const [area, setArea] = useState('all');
  const [more, setMore] = useState(false);
  // 화면에 보여 주는 것은 최근 13개월, 변화율 계산에는 더 오래된 거래까지 쓴다
  const since = `${apt.from.slice(0, 4)}-${apt.from.slice(4)}-01`;
  const recentAll = useMemo(() => apt.trades.filter((t) => t.date >= since), [apt.trades, since]);
  const valid = useMemo(() => recentAll.filter((t) => !t.canceled), [recentAll]);
  const odd = useMemo(() => oddTrades(apt.trades), [apt.trades]);
  const areas = useMemo(() => {
    const ok = apt.trades.filter((t) => !t.canceled && t.amount && !odd.has(t));
    const m = new Map();
    for (const t of valid) {
      const k = areaKey(t.area);
      const g = m.get(k) || { key: k, area: t.area, count: 0, latest: t };
      g.count += 1;
      m.set(k, g);
    }
    for (const g of m.values()) {
      const same = ok.filter((t) => areaKey(t.area) === g.key);
      g.change = yearChange(same);
      const highs = valid.filter((t) => areaKey(t.area) === g.key && !odd.has(t)).map((t) => t.amount || 0);
      g.high = highs.length ? Math.max(...highs) : null;
      g.trades = same;
    }
    return [...m.values()].sort((a, b) => a.key - b.key);
  }, [valid, apt.trades, odd]);
  const records = useMemo(() => recordSet(apt.trades, odd), [apt.trades, odd]);
  const built = useMemo(() => apt.trades.find((t) => t.built)?.built || null, [apt.trades]);
  const thisMonth = valid.filter((t) => t.date.startsWith(ymOf(0))).length;
  const lastMonth = valid.filter((t) => t.date.startsWith(ymOf(1))).length;

  const kapt = <KaptInfo apt={source} built={built} canEdit={canEdit} onPick={onPickKapt} />;
  if (recentAll.length === 0) {
    return (
      <>
        {kapt}
        <div className="empty">
          <p>최근 1년({apt.from.slice(0, 4)}.{apt.from.slice(4)} ~ {apt.to.slice(0, 4)}.{apt.to.slice(4)}) {apt.dong} 거래가 없어요.</p>
        </div>
      </>
    );
  }
  // 그래프는 고른 평형, 고르지 않았으면 거래가 가장 많은 평형
  const chartGroup = areas.find((g) => g.key === area) || [...areas].sort((a, b) => b.count - a.count)[0];

  const shown = recentAll.filter((t) => area === 'all' || areaKey(t.area) === area);
  const list = more ? shown : shown.slice(0, APT_SHOW);

  return (
    <>
      <p className="apt-sub">{apt.label} · {apt.region} {apt.dong} · 최근 1년 {valid.length}건 <small className="apt-month">(이번 달 {thisMonth}건 · 지난달 {lastMonth}건, 신고가 늦게 들어와요)</small></p>
      {kapt}
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
            <small>1년 최고 {g.high ? price(g.high) : '-'}{records.has(g.latest) && <span className="apt-record">2년 최고가</span>}</small>
            <Change c={g.change} />
          </button>
        ))}
      </div>
      {chartGroup && (
        <PriceChart
          key={chartGroup.key}
          trades={chartGroup.trades}
          from={apt.chartFrom || apt.from}
          to={apt.to}
          title={`전용 ${chartGroup.area}㎡`}
        />
      )}
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
                {odd.has(t) && <small className={`apt-odd${odd.get(t) === '직거래' ? '' : ' warn'}`}> {odd.get(t)}</small>}
                {records.has(t) && <span className="apt-record">2년 최고가</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length > APT_SHOW && (
        <button type="button" className="btn btn-block" onClick={() => setMore(!more)}>
          {more ? '접기' : `${shown.length - APT_SHOW}건 더 보기`}
        </button>
      )}
    </>
  );
}
