import { useEffect, useState } from 'react';

// 핸드폰 아래 바의 '더보기': 바에 없는 카드를 고르고, 바에 둘 카드(최대 max 개)를 바꾼다
export default function MoreSheet({ tabs, bar, current, max, onPick, onSaveBar, onClose }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bar);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rest = tabs.filter((t) => !bar.includes(t.id));
  const toggle = (id) => setDraft((d) => (d.includes(id) ? (d.length > 1 ? d.filter((x) => x !== id) : d) : d.length < max ? [...d, id] : d));
  const save = () => { onSaveBar(tabs.map((t) => t.id).filter((id) => draft.includes(id))); setEditing(false); };

  return (
    <div className="modal-backdrop more-backdrop" onClick={onClose}>
      <div className="modal more-sheet" role="dialog" aria-modal="true" aria-label="더보기" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{editing ? '아래 바에 둘 카드' : '더보기'}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        {!editing ? (
          <>
            {rest.length === 0 ? (
              <p className="empty">모든 카드가 아래 바에 있어요.</p>
            ) : (
              <div className="more-grid">
                {rest.map((t) => (
                  <button key={t.id} type="button" className={`more-item${current === t.id ? ' on' : ''}`} onClick={() => onPick(t.id)}>
                    <span className="more-icon" aria-hidden>{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-block" onClick={() => { setDraft(bar); setEditing(true); }}>✎ 아래 바 바꾸기</button>
          </>
        ) : (
          <>
            <p className="more-help">자주 보는 카드를 {max}개까지 고르세요. 나머지는 ‘더보기’에 들어가요. ({draft.length}/{max})</p>
            <div className="more-grid">
              {tabs.map((t) => {
                const on = draft.includes(t.id);
                return (
                  <button key={t.id} type="button" className={`more-item${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(t.id)} disabled={!on && draft.length >= max}>
                    <span className="more-icon" aria-hidden>{t.icon}</span>
                    <span>{t.label}</span>
                    <small>{on ? '✓ 바에 둠' : '더보기'}</small>
                  </button>
                );
              })}
            </div>
            <div className="more-actions">
              <button type="button" className="btn" onClick={() => setEditing(false)}>취소</button>
              <button type="button" className="btn btn-primary" onClick={save}>저장</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
