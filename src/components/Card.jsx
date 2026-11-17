import { timeText } from '../api.js';

export default function Card({ title, icon, state, onRefresh, actions, children, wide }) {
  return (
    <section className={`card${wide ? ' card-wide' : ''}`}>
      <header className="card-head">
        <h2><span className="card-icon" aria-hidden>{icon}</span>{title}</h2>
        <div className="card-tools">
          {actions}
          {onRefresh && (
            <button type="button" className="btn-icon" onClick={onRefresh} aria-label={`${title} 새로고침`} title="새로고침">
              ↻
            </button>
          )}
        </div>
      </header>
      {children}
      {state?.at && <p className="card-foot">{timeText(state.at)} 기준</p>}
    </section>
  );
}

export function Loading({ lines = 3 }) {
  return (
    <div className="skeleton-wrap" aria-label="불러오는 중">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const noKey = error?.code === 'NO_KEY';
  return (
    <div className={`error-box${noKey ? ' error-setup' : ''}`}>
      <p className="error-title">{noKey ? '아직 연결 준비 중이에요' : '정보를 불러오지 못했어요'}</p>
      <p className="error-msg">{error?.message}</p>
      {!noKey && onRetry && <button type="button" className="btn" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

// 로딩·오류·내용 중 하나를 보여 준다 (이미 받은 값이 있으면 새로고침 오류여도 값을 유지)
export function Body({ state, lines, children }) {
  if (state.data != null) {
    return (
      <>
        {state.error && <p className="stale-note">최신 정보를 못 받아 이전 정보를 보여 드려요</p>}
        {children(state.data)}
      </>
    );
  }
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  return <Loading lines={lines} />;
}
