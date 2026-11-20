import { useMemo, useRef, useState } from 'react';
import { useFetch } from '../api.js';
import { kaptInfo, kaptList, matchKapt } from '../sources.js';

// ---------- 시세 흐름 그래프: 평형 하나의 월별 평균 거래가(선) + 아래에 월별 거래 건수(막대, 따로 그린 작은 그래프) ----------
const short = (man) => {
  if (man == null) return '-';
  if (man >= 10000) return `${(man / 10000).toFixed(man >= 100000 ? 0 : 1).replace(/\.0$/, '')}억`;
  return `${Math.round(man / 100) / 10}천`;
};
const priceText = (man) => {
  if (man == null) return '-';
  const eok = Math.floor(man / 10000);
  const rest = Math.round(man % 10000);
  if (!eok) return `${rest.toLocaleString('ko-KR')}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
};
function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const end = Number(to);
  while (y * 100 + m <= end) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
const W = 600;
const H = 170;
const PAD = { l: 44, r: 12, t: 14, b: 22 };
const VH = 46;

export function PriceChart({ trades, from, to, title }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const months = useMemo(() => {
    const ms = monthsBetween(from, to);
    return ms.map((ym) => {
      const list = trades.filter((t) => !t.canceled && t.amount && t.date.slice(0, 7).replace('-', '') === ym);
      const sum = list.reduce((s, t) => s + t.amount, 0);
      return { ym, n: list.length, avg: list.length ? Math.round(sum / list.length) : null, max: list.length ? Math.max(...list.map((t) => t.amount)) : null };
    });
  }, [trades, from, to]);
  const vals = months.filter((m) => m.avg != null);
  if (vals.length < 2) return <p className="apt-chart-empty">{title} · 2년 동안 거래가 적어 그래프를 그리지 못했어요</p>;

  let lo = Math.min(...vals.map((m) => m.avg));
  let hi = Math.max(...vals.map((m) => m.avg));
  const span = Math.max(hi - lo, hi * 0.08);
  lo = Math.max(0, lo - span * 0.15);
  hi += span * 0.15;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (months.length === 1 ? iw / 2 : (i / (months.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  // 이어진 달끼리는 실선, 거래 없는 달을 건너뛰면 점선
  const segs = [];
  let prev = null;
  months.forEach((m, i) => {
    if (m.avg == null) return;
    if (prev) segs.push({ x1: x(prev.i), y1: y(prev.avg), x2: x(i), y2: y(m.avg), gap: i - prev.i > 1 });
    prev = { i, avg: m.avg };
  });
  const maxN = Math.max(...months.map((m) => m.n), 1);
  const first = vals[0];
  const last = vals[vals.length - 1];
  const pct = ((last.avg - first.avg) / first.avg) * 100;

  const pick = (clientX) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((clientX - r.left) / r.width) * W;
    let best = null;
    let bd = Infinity;
    months.forEach((m, i) => { const d = Math.abs(x(i) - px); if (m.n && d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const h = hover != null ? months[hover] : null;
  const label = (ym) => `${ym.slice(2, 4)}.${Number(ym.slice(4))}`;

  return (
    <figure className="apt-chart">
      <figcaption>
        <b>{title}</b> 월평균 거래가 (2년)
        <span className={`apt-chart-pct ${pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : ''}`}>
          {label(first.ym)} → {label(last.ym)} {pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {Math.abs(pct).toFixed(1)}%
        </span>
      </figcaption>
      <div className="apt-chart-tip" aria-live="polite">
        {h ? <>{`20${label(h.ym)}월`} · 평균 <b>{priceText(h.avg)}</b> · {h.n}건{h.n > 1 ? ` · 최고 ${priceText(h.max)}` : ''}</>
          : <span className="muted">그래프를 누르면 그달 평균 가격이 보여요</span>}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="apt-chart-svg"
        role="img"
        aria-label={`${title} 월평균 거래가 그래프. 처음 ${priceText(first.avg)}, 최근 ${priceText(last.avg)}`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="apt-chart-grid" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="apt-chart-axis">{short(Math.round(v))}</text>
          </g>
        ))}
        {months.map((m, i) => ((i % 6 === 0 || i === months.length - 1) && (
          <text key={m.ym} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'} className="apt-chart-axis">{label(m.ym)}</text>
        )))}
        {h && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="apt-chart-cross" />}
        {segs.map((s) => <line key={`${s.x1}`} {...s} gap={undefined} className={`apt-chart-line${s.gap ? ' gap' : ''}`} />)}
        {months.map((m, i) => m.avg != null && (
          <circle key={m.ym} cx={x(i)} cy={y(m.avg)} r={hover === i ? 6 : 4} className="apt-chart-dot" />
        ))}
      </svg>
      <svg viewBox={`0 0 ${W} ${VH}`} className="apt-chart-vol" role="img" aria-label="월별 거래 건수">
        <text x={PAD.l - 6} y={12} textAnchor="end" className="apt-chart-axis">건수</text>
        {months.map((m, i) => {
          const bw = Math.max(4, iw / months.length - 4);
          const bh = m.n ? Math.max(3, (m.n / maxN) * (VH - 16)) : 0;
          return m.n ? <rect key={m.ym} x={x(i) - bw / 2} y={VH - bh} width={bw} height={bh} rx={2} className={`apt-chart-bar${hover === i ? ' on' : ''}`} /> : null;
        })}
        <text x={W - PAD.r} y={12} textAnchor="end" className="apt-chart-axis">최다 {maxN}건</text>
      </svg>
    </figure>
  );
}

// ---------- 단지 정보 (K-apt) ----------
const yearsOld = (used) => {
  const y = Number(used.slice(0, 4));
  const now = new Date(Date.now() + 9 * 3600e3);
  return y ? now.getUTCFullYear() - y + 1 : null;
};
export function KaptInfo({ apt, built, canEdit, onPick }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const match = useFetch(() => matchKapt(apt, built), [apt.lawd, apt.dong, apt.name, built], { enabled: !apt.kapt });
  const code = apt.kapt || match.data || null;
  const info = useFetch(() => kaptInfo(code), [code], { enabled: !!code });
  const list = useFetch(() => kaptList(apt.lawd), [apt.lawd], { enabled: editing });

  const searching = !apt.kapt && match.loading;
  const picker = editing && (
    <div className="apt-manage">
      <select
        className="kapt-select"
        value={code || ''}
        onChange={(e) => { if (e.target.value) { onPick(e.target.value); setEditing(false); } }}
        aria-label="K-apt 단지 고르기"
      >
        <option value="">{list.loading ? '단지 목록을 받는 중…' : '단지를 골라 주세요'}</option>
        {(list.data || [])
          .slice()
          .sort((a, b) => (b.dong === apt.dong) - (a.dong === apt.dong) || a.name.localeCompare(b.name, 'ko'))
          .map((k) => <option key={k.code} value={k.code}>{k.name} ({k.dong})</option>)}
      </select>
      <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>취소</button>
    </div>
  );

  if (searching || (code && info.loading && !info.data)) return <div className="kapt"><p className="muted">🏢 단지 정보를 찾는 중…</p></div>;
  if (!code || (info.error && !info.data)) {
    return (
      <div className="kapt">
        <p className="muted">
          🏢 {info.error ? '단지 정보를 받지 못했어요' : '이 단지의 공동주택 정보(K-apt)를 찾지 못했어요'}
          {canEdit && !editing && <> · <button type="button" className="link-btn" onClick={() => setEditing(true)}>직접 고르기</button></>}
        </p>
        {picker}
      </div>
    );
  }
  const d = info.data;
  const age = d.used ? yearsOld(d.used) : null;
  const park = (d.parkUp || 0) + (d.parkDown || 0);
  const perHouse = park && d.households ? (park / d.households).toFixed(2) : null;
  const facts = [
    d.used && `${d.used.slice(0, 4)}.${Number(d.used.slice(5, 7))} 준공${age ? ` (${age}년 차)` : ''}`,
    d.households && `${d.households.toLocaleString('ko-KR')}세대`,
    d.dongs && `${d.dongs}개 동`,
    d.topFloor && `최고 ${d.topFloor}층`,
  ].filter(Boolean);
  const rows = [
    ['주차', park ? `${park.toLocaleString('ko-KR')}대${perHouse ? ` (세대당 ${perHouse}대)` : ''}${d.parkDown ? ` · 지하 ${d.parkDown.toLocaleString('ko-KR')}대` : ''}${d.evCharger ? ` · 전기차 충전 ${d.evCharger}기` : ''}` : ''],
    ['난방·구조', [d.heat, d.hall].filter(Boolean).join(' · ')],
    ['지하철', d.subway ? `${d.subway}${d.subwayTime ? ` · 걸어서 ${d.subwayTime}` : ''}` : ''],
    ['버스', d.busTime ? `정류장까지 ${d.busTime}` : ''],
    ['학교', d.school],
    ['단지 시설', d.welfare],
    ['승강기·CCTV', [d.elev && `승강기 ${d.elev}대`, d.cctv && `CCTV ${d.cctv}대`].filter(Boolean).join(' · ')],
    ['시공·관리', [d.builder, d.mgr].filter(Boolean).join(' · ')],
    ['주소', d.addr],
  ].filter(([, v]) => v);
  return (
    <div className="kapt">
      <button type="button" className="kapt-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="kapt-title">🏢 단지 정보</span>
        <span className="kapt-facts">{facts.join(' · ')}</span>
        <span className="kapt-more" aria-hidden>{open ? '접기 ▲' : '자세히 ▼'}</span>
      </button>
      {open && (
        <>
          <dl className="kapt-list">
            {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            {d.tel && <div><dt>관리사무소</dt><dd><a href={`tel:${d.tel.replace(/[^\d]/g, '')}`}>{d.tel.replace(/^(0\d{1,2})(\d{3,4})(\d{4})$/, '$1-$2-$3')}</a></dd></div>}
          </dl>
          <p className="kapt-src">
            K-apt 단지 이름: {d.name}
            {canEdit && !editing && <> · <button type="button" className="link-btn" onClick={() => setEditing(true)}>다른 단지예요</button></>}
          </p>
          {picker}
        </>
      )}
    </div>
  );
}
