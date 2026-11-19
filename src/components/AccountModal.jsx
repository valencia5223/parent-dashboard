import { useEffect, useState } from 'react';
import { pull, resetPassword, setNewPassword, signIn, signOut, signUp, useAccount } from '../account.js';

// 로그인·회원가입·내 계정 창. 로그인하면 생활 달력·내 단지 목록이 계정에 저장된다.
const timeText = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

export default function AccountModal({ onClose }) {
  const acc = useAccount();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let body;
  let title;
  if (acc.recovery) { title = '새 비밀번호'; body = <NewPassword />; }
  else if (acc.user) { title = '내 계정'; body = <Signed acc={acc} onClose={onClose} />; }
  else { title = '로그인 · 가입'; body = <SignIn onClose={onClose} />; }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal life-form account" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        {body}
      </div>
    </div>
  );
}

function Msg({ msg }) {
  if (!msg) return null;
  return <p className={`account-msg${msg.ok ? ' ok' : ''}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>;
}

function SignIn({ onClose }) {
  const [mode, setMode] = useState('in'); // in | up | forgot
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const go = (m) => { setMode(m); setMsg(null); };

  const submit = async (e) => {
    e.preventDefault();
    const em = email.trim();
    if (mode === 'up' && pw !== pw2) { setMsg({ text: '비밀번호 두 칸이 서로 달라요.' }); return; }
    setBusy(true);
    setMsg(null);
    if (mode === 'in') {
      const r = await signIn(em, pw);
      setBusy(false);
      if (r.ok) onClose(); else setMsg({ text: r.error });
    } else if (mode === 'up') {
      const r = await signUp(em, pw);
      setBusy(false);
      if (!r.ok) setMsg({ text: r.error });
      else if (r.needConfirm) { setMode('in'); setPw2(''); setMsg({ ok: true, text: `${em} 으로 인증 메일을 보냈어요. 메일의 링크를 누른 뒤 여기서 로그인해 주세요.` }); }
      else onClose();
    } else {
      const r = await resetPassword(em);
      setBusy(false);
      setMsg(r.ok ? { ok: true, text: '비밀번호를 바꾸는 링크를 메일로 보냈어요. 링크를 누르면 이 화면에서 새 비밀번호를 정해요.' } : { text: r.error });
    }
  };

  return (
    <form className="account-body" onSubmit={submit}>
      {mode !== 'forgot' && (
        <div className="toggle-row" role="tablist">
          <button type="button" className={`chip${mode === 'in' ? ' chip-on' : ''}`} aria-pressed={mode === 'in'} onClick={() => go('in')}>로그인</button>
          <button type="button" className={`chip${mode === 'up' ? ' chip-on' : ''}`} aria-pressed={mode === 'up'} onClick={() => go('up')}>처음이에요 (가입)</button>
        </div>
      )}
      <p className="account-note">
        {mode === 'forgot'
          ? '가입한 이메일을 넣으면 비밀번호를 바꾸는 링크를 보내 드려요.'
          : '로그인하면 생활 달력의 내 일정과 집값 카드의 단지 목록이 계정에 저장돼서, 핸드폰·컴퓨터 어디서든 똑같이 보여요.'}
      </p>
      <label className="field">
        <span>이메일</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required autoFocus />
      </label>
      {mode !== 'forgot' && (
        <label className="field">
          <span>비밀번호{mode === 'up' ? ' (6자 이상)' : ''}</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={6} required />
        </label>
      )}
      {mode === 'up' && (
        <label className="field">
          <span>비밀번호 한 번 더</span>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" minLength={6} required />
        </label>
      )}
      <Msg msg={msg} />
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
        {busy ? '잠시만요…' : mode === 'in' ? '로그인' : mode === 'up' ? '가입하기' : '링크 보내기'}
      </button>
      {mode === 'in' && <button type="button" className="btn btn-quiet" onClick={() => go('forgot')}>비밀번호를 잊었어요</button>}
      {mode === 'forgot' && <button type="button" className="btn btn-quiet" onClick={() => go('in')}>← 로그인으로</button>}
    </form>
  );
}

function Signed({ acc, onClose }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  let status;
  if (acc.syncing) status = '계정과 맞추는 중…';
  else if (acc.error) status = `⚠️ ${acc.error}`;
  else if (acc.lastSync) status = `✅ 계정에 저장됨 · ${timeText(acc.lastSync)}`;
  else status = '계정과 맞추는 중…';

  const out = async () => { setBusy(true); await signOut(); setBusy(false); onClose(); };
  return (
    <div className="account-body">
      <p className="account-email"><span aria-hidden>👤</span> {acc.user.email}</p>
      <p className={`account-msg${acc.error ? '' : ' ok'}`} role="status">{status}</p>
      <p className="account-note">생활 달력의 내 일정·쓰레기 요일과 집값 카드의 단지 목록이 이 계정에 저장돼요. 다른 기기에서 같은 이메일로 로그인하면 똑같이 보여요.</p>
      <button type="button" className="btn" onClick={() => pull()} disabled={acc.syncing}>지금 다시 맞추기</button>
      {confirm ? (
        <div className="account-confirm">
          <p>로그아웃하면 이 기기에서는 내 일정과 단지 목록이 보이지 않아요. 다시 로그인하면 그대로 돌아와요.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-danger" onClick={out} disabled={busy}>로그아웃</button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>취소</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-quiet" onClick={() => setConfirm(true)}>로그아웃</button>
      )}
    </div>
  );
}

function NewPassword() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await setNewPassword(pw);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: '비밀번호를 바꿨어요.' } : { text: r.error });
  };
  return (
    <form className="account-body" onSubmit={submit}>
      <label className="field">
        <span>새 비밀번호 (6자 이상)</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={6} required autoFocus />
      </label>
      <Msg msg={msg} />
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>{busy ? '잠시만요…' : '바꾸기'}</button>
    </form>
  );
}
