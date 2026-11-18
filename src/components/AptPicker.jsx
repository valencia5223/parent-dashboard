import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAptList, loadRegions, useFetch } from '../api.js';
import { Body } from './Card.jsx';

// '단지 추가' 창: 시·도 → 시·군·구를 고르면(처음엔 지금 위치의 시·군·구) 최근 1년 동안 거래가 있었던 단지를 보여 주고,
// 누르면 탭에 추가한다. 이름이 국토부 자료 그대로라 화면 이름은 나중에 '이름 바꾸기'로 고친다.
const dateText = (d) => `${Number(d.slice(2, 4))}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const norm = (v) => v.replace(/\s/g, '').toLowerCase();

export default function AptPicker({ pos, existing, onAdd, onClose }) {
  const [regions, setRegions] = useState(null);
  const [sido, setSido] = useState('');
  const [lawd, setLawd] = useState('');
  const [q, setQ] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const startPos = useRef(pos);

  // 처음 한 번만: 지역 목록을 불러와 지금 위치의 시·군·구를 고른다
  useEffect(() => {
    let alive = true;
    loadRegions().then((r) => {
      if (!alive) return;
      setRegions(r);
      const near = startPos.current ? r.nearest(startPos.current) : r.sgg[0];
      setSido(near.sido);
      setLawd(near.code);
    });
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, []);

  const sidos = useMemo(() => (regions ? [...new Set(regions.sgg.map((s) => s.sido))] : []), [regions]);
  const sggs = useMemo(() => (regions ? regions.sgg.filter((s) => s.sido === sido).sort((a, b) => a.name.localeCompare(b.name, 'ko')) : []), [regions, sido]);
  const region = sggs.find((s) => s.code === lawd);
  const state = useFetch(() => fetchAptList(lawd), [lawd], { enabled: !!lawd });
  const ready = state.data?.lawd === lawd ? state : { ...state, data: null };

  const pickSido = (v) => {
    setSido(v);
    const first = regions.sgg.filter((s) => s.sido === v).sort((a, b) => a.name.localeCompare(b.name, 'ko'))[0];
    setLawd(first?.code || '');
    setQ('');
  };
  const has = (o) => existing.some((a) => a.lawd === lawd && a.dong === o.dong && a.name === o.name);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="단지 추가" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>단지 추가</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {!regions ? <p className="empty">지역 목록을 불러오는 중…</p> : (
          <div className="apt-regions">
            <select value={sido} onChange={(e) => pickSido(e.target.value)} aria-label="시·도">
              {sidos.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={lawd} onChange={(e) => { setLawd(e.target.value); setQ(''); }} aria-label="시·군·구">
              {sggs.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </div>
        )}

        <input
          className="apt-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="단지 이름이나 동으로 찾기 (예: 가야, 산본동)"
          aria-label="단지 찾기"
        />

        {lawd && !ready.data && !ready.error && <p className="apt-pick-count">최근 1년 거래를 모으는 중이에요. 몇 초 걸려요…</p>}
        {lawd && (
          <Body state={ready} lines={6}>
            {({ list }) => {
              const k = norm(q);
              const shown = k ? list.filter((o) => norm(`${o.name}${o.dong}`).includes(k)) : list;
              if (list.length === 0) return <p className="empty">최근 1년 동안 이 지역에 아파트 거래가 없어요.</p>;
              if (shown.length === 0) return <p className="empty">‘{q}’ 단지를 찾지 못했어요. 이름 일부만 넣어 보세요(예: ‘한라’). 최근 1년 거래가 없던 단지는 목록에 없어요.</p>;
              return (
                <>
                  <p className="apt-pick-count">{region?.name} · 최근 1년 거래가 있었던 단지 {shown.length}곳</p>
                  <ul className="place-list">
                    {shown.map((o) => {
                      const added = has(o);
                      return (
                        <li key={`${o.dong}|${o.name}`}>
                          <button
                            type="button"
                            className={`place-item${added ? ' place-on' : ''}`}
                            disabled={added}
                            onClick={() => onAdd({ id: `a${lawd}-${o.dong}-${o.name}`, label: o.name, lawd, region: region?.name || '', dong: o.dong, name: o.name })}
                          >
                            <strong>{o.name}{added && <span className="apt-added"> · 추가됨</span>}</strong>
                            <small>{o.dong}{o.built ? ` · ${o.built}년` : ''} · 1년 {o.count}건 · 최근 {dateText(o.last)}</small>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            }}
          </Body>
        )}
        <p className="card-foot">단지 이름은 국토교통부 자료에 적힌 이름이에요(예: 한라주공2차 → ‘한라주공4-2’). 추가한 뒤 ‘이름 바꾸기’로 고칠 수 있어요.</p>
      </div>
    </div>
  );
}
