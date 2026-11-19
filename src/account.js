// 계정: 이메일+비밀번호로 가입하고 관리자가 승인(pd_members.approved)해야 생활 달력(pd_life_v1)·내 단지 목록(pd_apts)을 쓸 수 있고, 계정(Supabase 표 pd_user_data,
// 한 사람당 한 줄, data jsonb)에 저장해 다른 기기에서도 같게 보여 준다. 로그인 전 이 기기에 있던 것은 처음 로그인할 때 합친다.
// 화면은 계속 localStorage 를 읽고 쓰며, 저장할 때 markDirty() 를 부르면 잠시 뒤 계정에 올린다.
// 계정 데이터로 이 기기 저장을 바꾸면 'pd-data' 이벤트를 보내 카드가 다시 읽게 한다.
// supabase-js 는 로그인한 적이 있거나 로그인 창을 열 때만 불러온다.
import { useSyncExternalStore } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig.js';

// 계정에 저장하는 것: 생활 달력·내 단지 목록·버스 즐겨찾기 정류장·지하철 즐겨찾기 역·날씨 도시·최근 고른 위치·주유소 기름 종류와 반경
const SYNC_KEYS = {
  life: 'pd_life_v1', apts: 'pd_apts', busFavs: 'pd_bus_favs', subwayFavs: 'pd_subway_favs', weatherCities: 'pd_wx_cities', recentPlaces: 'pd_recent_places', fuel: 'pd_fuel', radius: 'pd_radius',
};
const RAW = new Set(['fuel', 'radius']); // JSON 이 아니라 글자 그대로 저장하는 것
const AUTH_KEY = 'pd_auth';
const OWNER_KEY = 'pd_sync_owner'; // 이 기기 저장이 어느 계정 것인지
const DIRTY_KEY = 'pd_sync_dirty'; // 계정에 아직 못 올린 변경이 있음
const TABLE = 'pd_user_data';
const APPROVED_KEY = 'pd_approved'; // 승인된 계정 id (다음 시작 때 바로 들어오게)

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 괜찮음 */ } },
};
const readJSON = (k) => { try { return JSON.parse(ls.get(k)); } catch { return null; } };

// ---------- 상태 (useAccount 로 화면에서 씀) ----------
// approved: null(확인 중) | false(관리자 승인 대기) | true. 생활 달력·단지 추가는 active(로그인 + 승인)일 때만.
let state = { ready: false, user: null, approved: null, active: false, syncing: false, error: '', lastSync: 0, recovery: false };
const subs = new Set();
const setState = (p) => { state = { ...state, ...p }; state.active = !!(state.user && state.approved); subs.forEach((f) => f()); };
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
        if (event === 'SIGNED_OUT' || !u) { setState({ user: null, approved: null, ready: true }); return; }
        const changed = state.user?.id !== u.id;
        // 지난번 승인 여부를 먼저 써서(인터넷이 느리거나 끊겨도) 바로 화면을 보여 주고, 뒤에서 다시 확인한다
        if (changed) setState({ user: { id: u.id, email: u.email }, approved: ls.get(APPROVED_KEY) === u.id ? true : null, ready: true });
        else setState({ ready: true });
        if (changed) setTimeout(() => checkApproval(), 0); // 콜백 안에서 바로 supabase 를 부르면 멈출 수 있어 다음 차례로
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
  // 로그인해야 쓰는 앱이라 처음부터 세션을 확인한다(저장된 세션이 있으면 자동 로그인)
  getClient().then((c) => c.auth.getSession()).then(({ data }) => {
    if (!data?.session) setState({ ready: true, user: null });
  }).catch(() => setState({ ready: true }));
  // 다른 기기에서 고친 것을 가져오도록 이 화면으로 돌아올 때 다시 확인 (30초 간격 제한)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.user || Date.now() - lastPull < 30e3) return;
    if (state.approved) pull(); else checkApproval();
  });
}

// 가입 승인 확인: pd_members 에 내 줄이 없으면 '승인 대기'로 만든다. 관리자가 Supabase Table Editor 에서
// approved 를 true 로 바꾸면 쓸 수 있다(RLS 도 승인된 사람만 pd_user_data 를 읽고 쓰게 막음).
let checking = null;
export function checkApproval() {
  if (!state.user) return Promise.resolve();
  if (checking) return checking;
  const { id, email } = state.user;
  lastPull = Date.now();
  checking = (async () => {
    const c = await getClient();
    let { data: row, error } = await c.from('pd_members').select('approved').eq('user_id', id).maybeSingle();
    if (error) throw error;
    if (!row) {
      const r = await c.from('pd_members').insert({ user_id: id, email });
      if (r.error && r.error.code !== '23505') throw r.error;
      row = { approved: false };
    }
    if (state.user?.id !== id) return;
    ls.set(APPROVED_KEY, row.approved ? id : null);
    setState({ approved: !!row.approved, error: '' });
    if (row.approved) await pull();
  })().catch((e) => setState({ error: friendly(e) })).finally(() => { checking = null; });
  return checking;
}

// ---------- 이 기기 저장 ↔ 계정 ----------
const readLocal = () => Object.fromEntries(Object.entries(SYNC_KEYS).map(([k, key]) => [k, RAW.has(k) ? ls.get(key) : readJSON(key)]));
function writeLocal(d) {
  for (const [k, key] of Object.entries(SYNC_KEYS)) {
    const v = d?.[k];
    ls.set(key, v == null ? null : RAW.has(k) ? String(v) : JSON.stringify(v));
  }
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
  // 목록은 계정 것 뒤에 이 기기에만 있던 것을 붙이고, 나머지는 계정 값이 없을 때만 이 기기 값
  const union = (ra, la, same) => (!Array.isArray(ra) ? la ?? null : !Array.isArray(la) ? ra : [...ra, ...la.filter((a) => !ra.some((b) => same(a, b)))]);
  out.apts = union(remote?.apts, local.apts, (a, b) => a.id === b.id);
  out.busFavs = union(remote?.busFavs, local.busFavs, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  out.subwayFavs = union(remote?.subwayFavs, local.subwayFavs, (a, b) => a.name === b.name);
  out.weatherCities = union(remote?.weatherCities, local.weatherCities, (a, b) => a.id === b.id);
  out.recentPlaces = union(remote?.recentPlaces, local.recentPlaces, (a, b) => a.lat === b.lat && a.lng === b.lng);
  for (const k of ['fuel', 'radius']) out[k] = remote?.[k] ?? local[k] ?? null;
  return out;
}

let lastPull = 0;
let pulling = null;
export function pull() {
  if (!state.active) return Promise.resolve();
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
  if (!state.active) return;
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
  if (!state.active) return;
  ls.set(DIRTY_KEY, '1');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    setState({ syncing: true });
    push().catch((e) => setState({ error: friendly(e) })).finally(() => setState({ syncing: false }));
  }, 1500);
}
// 화면을 닫기 직전에 남은 변경을 바로 올린다
window.addEventListener('pagehide', () => {
  if (pushTimer && ls.get(DIRTY_KEY) && state.active) { clearTimeout(pushTimer); push().catch(() => {}); }
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
    options: { data: { is_approved: false, app: 'parent-dashboard' } },
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
  ls.set(APPROVED_KEY, null);
  writeLocal(null);
  setState({ user: null, approved: null, lastSync: 0, error: '', recovery: false });
}
