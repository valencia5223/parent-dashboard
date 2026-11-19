import { useState } from 'react';
import { checkApproval, signOut } from '../account.js';
import { SignIn } from './AccountModal.jsx';

// 로그인 전·승인 대기·확인 중 화면. 로그인하고 관리자가 승인(Supabase 표 pd_members 의 approved)해야 대시보드를 쓴다.

function Shell({ children }) {
  return (
    <div className="auth-page">
      <div className="auth-box">
        <p className="auth-logo" aria-hidden>🏡</p>
        <h1>우리 동네 생활정보</h1>
        {children}
      </div>
    </div>
  );
}

export function Splash({ error }) {
  return (
    <Shell>
      {error ? (
        <>
          <p className="account-msg" role="alert">{error}</p>
          <button type="button" className="btn btn-primary btn-wide" onClick={() => window.location.reload()}>다시 시도</button>
        </>
      ) : <p className="auth-sub">들어가는 중…</p>}
    </Shell>
  );
}

export function LoginScreen() {
  return (
    <Shell>
      <p className="auth-sub">날씨·교통·주유소·집값·병원·생활 달력을 한 화면에서 봐요.</p>
      <div className="life-form account">
        <SignIn />
      </div>
    </Shell>
  );
}

export function PendingScreen({ acc }) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const recheck = async () => { setBusy(true); await checkApproval(); setBusy(false); setChecked(true); };
  return (
    <Shell>
      <p className="auth-wait" aria-hidden>⏳</p>
      <p><strong>관리자 승인을 기다리고 있어요</strong></p>
      <p className="auth-sub">{acc.user.email} 으로 가입됐어요. 관리자가 승인하면 바로 쓸 수 있어요.</p>
      {acc.error && <p className="account-msg" role="alert">{acc.error}</p>}
      {checked && !acc.error && <p className="account-msg ok" role="status">아직 승인 전이에요.</p>}
      <button type="button" className="btn btn-primary btn-wide" onClick={recheck} disabled={busy}>{busy ? '확인하는 중…' : '승인됐는지 다시 확인'}</button>
      <button type="button" className="btn btn-quiet" onClick={() => signOut()}>다른 계정으로 로그인</button>
    </Shell>
  );
}
