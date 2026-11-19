import { useEffect, useRef, useState } from 'react';
import { searchPlaces } from '../api.js';

// 위치 고르기 창: 장소 검색 / 현재 위치(GPS) / 최근에 고른 곳
export default function PlacePicker({ current, recent, onPick, onUseGps, onRemoveRecent, onClose }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: false, results: null, error: '' });
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 검색 서비스 이용 규칙상 글자마다 찾지 않고 '찾기'를 눌렀을 때만 찾는다
  const search = async (e) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setState({ loading: true, results: null, error: '' });
    try {
      setState({ loading: false, results: await searchPlaces(text), error: '' });
    } catch (err) {
      setState({ loading: false, results: null, error: err.message || '찾지 못했어요' });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="위치 바꾸기" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>위치 바꾸기</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <form className="place-search" onSubmit={search}>
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="예: 산본역, 삼익소월아파트, 군포시 금정동"
            aria-label="장소 또는 주소"
            enterKeyHint="search"
          />
          <button type="submit" className="btn btn-primary" disabled={state.loading}>찾기</button>
        </form>

        {state.loading && <p className="empty">찾는 중…</p>}
        {state.error && <p className="stale-note">{state.error}</p>}
        {state.results && (
          state.results.length === 0 ? (
            <p className="empty">찾지 못했어요. 역 이름·아파트 이름·동 이름으로 찾아 보세요.</p>
          ) : (
            <ul className="place-list">
              {state.results.map((p) => (
                <li key={`${p.lat},${p.lng}`}>
                  <button type="button" className="place-item" onClick={() => onPick(p)}>
                    <strong>{p.name}</strong>
                    <small>{p.detail}</small>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        <button type="button" className={`btn btn-block${current.source === 'gps' ? ' btn-on' : ''}`} onClick={onUseGps}>
          📍 지금 있는 곳(GPS)으로 보기
        </button>

        {recent.length > 0 && (
          <section>
            <h3 className="modal-sub">최근에 고른 곳</h3>
            <ul className="place-list">
              {recent.map((p) => {
                const on = current.source === 'manual' && current.lat === p.lat && current.lng === p.lng;
                return (
                  <li key={`${p.lat},${p.lng}`} className="place-row">
                    <button type="button" className={`place-item${on ? ' place-on' : ''}`} onClick={() => onPick(p)}>
                      <strong>{p.name}</strong>
                      <small>{p.detail}</small>
                    </button>
                    <button type="button" className="btn-icon" onClick={() => onRemoveRecent(p)} aria-label={`${p.name} 지우기`} title="목록에서 지우기">
                      🗑
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <p className="card-foot">장소 검색: 카카오맵</p>
      </div>
    </div>
  );
}
