-- parent-dashboard 계정 저장 표. Library-of-Mind Supabase 프로젝트(swyfwbjyuphlbdtvycyt)에 만들어 둠.
-- 한 사람당 한 줄, data = { life: pd_life_v1, apts: pd_apts }. RLS 로 자기 줄만.
create table if not exists public.pd_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.pd_user_data enable row level security;
drop policy if exists pd_own_select on public.pd_user_data;
drop policy if exists pd_own_insert on public.pd_user_data;
drop policy if exists pd_own_update on public.pd_user_data;
drop policy if exists pd_own_delete on public.pd_user_data;
create policy pd_own_select on public.pd_user_data for select to authenticated using (auth.uid() = user_id);
create policy pd_own_insert on public.pd_user_data for insert to authenticated with check (auth.uid() = user_id);
create policy pd_own_update on public.pd_user_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy pd_own_delete on public.pd_user_data for delete to authenticated using (auth.uid() = user_id);
revoke all on public.pd_user_data from anon;
grant select, insert, update, delete on public.pd_user_data to authenticated;

-- ===== 가입 승인 (pd_members) =====
-- 가입 승인: 관리자가 Supabase Table Editor 에서 pd_members.approved 를 true 로 바꾸면 쓸 수 있다.
create table if not exists public.pd_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
alter table public.pd_members enable row level security;
drop policy if exists pd_members_select on public.pd_members;
drop policy if exists pd_members_insert on public.pd_members;
create policy pd_members_select on public.pd_members for select to authenticated using (auth.uid() = user_id);
create policy pd_members_insert on public.pd_members for insert to authenticated with check (auth.uid() = user_id and approved = false and approved_at is null);
revoke all on public.pd_members from anon;
revoke all on public.pd_members from authenticated;
grant select, insert on public.pd_members to authenticated;

-- 승인 시각 자동 기록
create or replace function public.pd_members_stamp() returns trigger language plpgsql as $$
begin
  if new.approved and not coalesce(old.approved, false) then new.approved_at := now(); end if;
  if not new.approved then new.approved_at := null; end if;
  return new;
end $$;
drop trigger if exists pd_members_stamp on public.pd_members;
create trigger pd_members_stamp before update on public.pd_members for each row execute function public.pd_members_stamp();

-- 승인된 사람만 자기 데이터를 읽고 쓴다
create or replace function public.pd_is_approved() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pd_members where user_id = auth.uid() and approved);
$$;
revoke all on function public.pd_is_approved() from public, anon;
grant execute on function public.pd_is_approved() to authenticated;
drop policy if exists pd_own_select on public.pd_user_data;
drop policy if exists pd_own_insert on public.pd_user_data;
drop policy if exists pd_own_update on public.pd_user_data;
drop policy if exists pd_own_delete on public.pd_user_data;
create policy pd_own_select on public.pd_user_data for select to authenticated using (auth.uid() = user_id and public.pd_is_approved());
create policy pd_own_insert on public.pd_user_data for insert to authenticated with check (auth.uid() = user_id and public.pd_is_approved());
create policy pd_own_update on public.pd_user_data for update to authenticated using (auth.uid() = user_id and public.pd_is_approved()) with check (auth.uid() = user_id and public.pd_is_approved());
create policy pd_own_delete on public.pd_user_data for delete to authenticated using (auth.uid() = user_id and public.pd_is_approved());
