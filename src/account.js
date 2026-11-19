// 계정: 이메일+비밀번호로 로그인해야 생활 달력(pd_life_v1)·내 단지 목록(pd_apts)을 쓸 수 있고, 계정(Supabase 표 pd_user_data,
// 한 사람당 한 줄, data jsonb)에 저장해 다른 기기에서도 같게 보여 준다. 로그인 전 이 기기에 있던 것은 처음 로그인할 때 합친다.
// 화면은 계속 localStorage 를 읽고 쓰며, 저장할 때 markDirty() 를 부르면 잠시 뒤 계정에 올린다.
// 계정 데이터로 이 기기 저장을 바꾸면 'pd-data' 이벤트를 보내 카드가 다시 읽게 한다.
// supabase-js 는 로그인한 적이 있거나 로그인 창을 열 때만 불러온다.
import { useSyncExternalStore } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig.js';

const SYNC_KEYS = { life: 'pd_life_v1', apts: 'pd_apts' };
const AUTH_KEY = 'pd_auth';
const OWNER_KEY = 'pd_sync_owner'; // 이 기기 저장이 어느 계정 것인지
const DIRTY_KEY = 'pd_sync_dirty'; // 계정에 아직 못 올린 변경이 있음
const TABLE = 'pd_user_data';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 괜찮음 */ } },
};
const readJSON = (k) => { try { return JSON.parse(ls.get(k)); } catch { return null; } };

// ---------- 상태 (useAccount 로 화면에서 씀) ----------
let state = { ready: false, user: null, syncing: false, error: '', lastSync: 0, recovery: false };
const subs = new Set();
const setState = (p) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const useAccount = () => useSyncExternalStore(subscribe, () => state);

// ---------- Supabase ----------
let clientP = null;
export function getClient() {
  if (!clientP) {
    clientP = import('@supabase/supabase-js').then(({ createClient }) => {
      const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      c.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') setState({ recovery: true });
        const u = session?.user || null;
        if (event === 'SIGNED_OUT' || !u) { setState({ user: null, ready: true }); return; }
        const changed = state.user?.id !== u.id;
        setState({ user: { id: u.id, email: u.email }, ready: true });
        if (changed) setTimeout(() => pull(), 0); // 콜백 안에서 바로 supabase 를 부르면 멈출 수 있어 다음 차례로
      });
      return c;
    });
  }
  return clientP;
}

// 앱 시작 때 한 번: 로그인한 적이 있거나 메일 인증·비밀번호 재설정 링크로 들어왔으면 세션을 확인한다
let started = false;
export function initAccount() {
  if (started) return;
  started = true;
  const authUrl = /access_token=|type=recovery|type=signup|[?&]code=/.test(window.location.hash + window.location.search);
  if (ls.get(AUTH_KEY) || authUrl) {
    getClient().then((c) => c.auth.getSession()).then(({ data }) => {
      if (!data?.session) setState({ ready: true, user: null });
    }).catch(() => setState({ ready: true }));
  } else {
    setState({ ready: true });
  }
  // 다른 기기에서 고친 것을 가져오도록 이 화면으로 돌아올 때 다시 확인 (30초 간격 제한)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user && Date.now() - lastPull > 30e3) pull();
  });
}

// ---------- 이 기기 저장 ↔ 계정 ----------
const readLocal = () => ({ life: readJSON(SYNC_KEYS.life), apts: readJSON(SYNC_KEYS.apts) });
function writeLocal(d) {
  for (const [k, key] of Object.entries(SYNC_KEYS)) ls.set(key, d?.[k] == null ? null : JSON.stringify(d[k]));
  window.dispatchEvent(new Event('pd-data'));
}
const lifeEmpty = (l) => !l || (!l.events?.length && !Object.values(l.trash || {}).some((v) => v?.length));

// 처음 이 기기를 계정에 묶을 때: 계정에 있던 것 + 이 기기에서 만든 것을 합친다
function merge(remote, local) {
  const out = { ...(remote || {}) };
  const rl = remote?.life;
  const ll = local.life;
  if (lifeEmpty(rl)) out.life = lifeEmpty(ll) ? rl || ll || null : ll;
  else if (!lifeEmpty(ll)) {
    const newerLocal = (ll.updatedAt || 0) > (rl.updatedAt || 0);
    const byId = new Map(rl.events.map((e) => [e.id, e]));
    for (const e of ll.events) if (!byId.has(e.id) || newerLocal) byId.set(e.id, e);
    out.life = { ...rl, events: [...byId.values()], trash: newerLocal ? ll.trash : rl.trash, updatedAt: Math.max(ll.updatedAt || 0, rl.updatedAt || 0) };
  }
  const ra = remote?.apts;
  const la = local.apts;
  if (!Array.isArray(ra)) out.apts = la ?? null;
  else if (Array.isArray(la)) out.apts = [...ra, ...la.filter((a) => !ra.some((b) => b.id === a.id))];
  return out;
}

let lastPull = 0;
let pulling = null;
export function pull() {
  if (!state.user) return Promise.resolve();
  if (pulling) return pulling;
  const uid = state.user.id;
  lastPull = Date.now();
  setState({ syncing: true, error: '' });
  pulling = (async () => {
    const c = await getClient();
    const { data: row, error } = await c.from(TABLE).select('data, updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    const local = readLocal();
    if (ls.get(OWNER_KEY) !== uid) {
      writeLocal(merge(row?.data, local));
      ls.set(OWNER_KEY, uid);
      await push();
    } else if (ls.get(DIRTY_KEY)) {
      await push(); // 연결이 끊긴 동안 이 기기에서 고친 것
    } else if (row) {
      const same = Object.keys(SYNC_KEYS).every((k) => JSON.stringify(row.data?.[k] ?? null) === JSON.stringify(local[k]));
      if (!same) writeLocal(row.data);
      setState({ lastSync: Date.now() });
    } else {
      await push();
    }
  })().catch((e) => setState({ error: friendly(e) }))
    .finally(() => { pulling = null; setState({ syncing: false }); });
  return pulling;
}

async function push() {
  if (!state.user) return;
  const uid = state.user.id;
  const c = await getClient();
  const { error } = await c.from(TABLE).upsert({ user_id: uid, data: readLocal(), updated_at: new Date().toISOString() });
  if (error) throw error;
  ls.set(DIRTY_KEY, null);
  setState({ lastSync: Date.now(), error: '' });
}

// 카드가 저장할 때마다 부른다. 로그인 중이면 1.5초 뒤 한 번에 올린다.
let pushTimer = 0;
export function markDirty() {
  if (!state.user) return;
  ls.set(DIRTY_KEY, '1');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    setState({ syncing: true });
    push().catch((e) => setState({ error: friendly(e) })).finally(() => setState({ syncing: false }));
  }, 1500);
}
// 화면을 닫기 직전에 남은 변경을 바로 올린다
window.addEventListener('pagehide', () => {
  if (pushTimer && ls.get(DIRTY_KEY) && state.user) { clearTimeout(pushTimer); push().catch(() => {}); }
});

// 카드에서 로그인 창 열기 (App 이 듣는다)
export const openLogin = () => window.dispatchEvent(new Event('pd-login'));

// ---------- 로그인 ----------
function friendly(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return '이메일이나 비밀번호가 맞지 않아요.';
  if (/Email not confirmed/i.test(m)) return '메일함에서 인증 링크를 먼저 눌러 주세요.';
  if (/already registered|already been registered/i.test(m)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (/at least 6|Password should/i.test(m)) return '비밀번호는 6자 이상이어야 해요.';
  if (/rate limit|too many|security purposes/i.test(m)) return '잠시 뒤에 다시 해 주세요.';
  if (/invalid.*email|Unable to validate email/i.test(m)) return '이메일 주소를 다시 확인해 주세요.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return '인터넷 연결을 확인해 주세요.';
  return '잠시 문제가 생겼어요. 다시 해 주세요.';
}
const run = async (fn) => {
  try { return { ok: true, ...(await fn(await getClient())) }; } catch (e) { return { ok: false, error: friendly(e) }; }
};

export const signIn = (email, password) => run(async (c) => {
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
});
export const signUp = (email, password) => run(async (c) => {
  // is_approved: false — 같은 Supabase 를 쓰는 Library of Mind 에는 관리자 승인 없이 못 들어가게
  const { data, error } = await c.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin, data: { is_approved: false, app: 'parent-dashboard' } },
  });
  if (error) throw error;
  if (data.user && !data.user.identities?.length) throw new Error('already registered');
  return { needConfirm: !data.session };
});
export const resetPassword = (email) => run(async (c) => {
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
});
export const setNewPassword = (password) => run(async (c) => {
  const { error } = await c.auth.updateUser({ password });
  if (error) throw error;
  setState({ recovery: false });
});
// 로그아웃하면 이 기기의 내 일정·단지를 지운다(다시 로그인하면 계정에서 돌아옴)
export async function signOut() {
  clearTimeout(pushTimer);
  if (ls.get(DIRTY_KEY)) await push().catch(() => {});
  const c = await getClient();
  await c.auth.signOut().catch(() => {});
  ls.set(OWNER_KEY, null);
  ls.set(DIRTY_KEY, null);
  writeLocal(null);
  setState({ user: null, lastSync: 0, error: '', recovery: false });
}
