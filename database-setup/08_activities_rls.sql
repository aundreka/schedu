-- =========================
-- ACTIVITIES RLS
-- =========================

alter table public.activities enable row level security;

drop policy if exists "users can read own activities" on public.activities;
create policy "users can read own activities"
on public.activities for select
using (
  auth.uid() = user_id
);

drop policy if exists "users can insert own activities in accessible subjects" on public.activities;
create policy "users can insert own activities in accessible subjects"
on public.activities for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.subjects s
    join public.user_schools us on us.school_id = s.school_id
    where s.subject_id = activities.subject_id
      and s.school_id = activities.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can update own activities" on public.activities;
create policy "users can update own activities"
on public.activities for update
using (
  auth.uid() = user_id
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.subjects s
    join public.user_schools us on us.school_id = s.school_id
    where s.subject_id = activities.subject_id
      and s.school_id = activities.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can delete own activities" on public.activities;
create policy "users can delete own activities"
on public.activities for delete
using (
  auth.uid() = user_id
);
