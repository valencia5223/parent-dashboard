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
