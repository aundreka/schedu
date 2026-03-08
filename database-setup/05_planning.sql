-- =========================
-- LESSON PLANNING AND SCHEDULING
-- =========================

create table if not exists public.lesson_plans (
  lesson_plan_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('lp_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid not null references public.users(userid) on delete cascade,
  school_id uuid not null references public.schools(school_id) on delete cascade,
  subject_id uuid not null references public.subjects(subject_id) on delete cascade,
  section_id uuid not null references public.sections(section_id) on delete cascade,
  title text not null,
  academic_year text,
  term public.academic_term not null,
  start_date date not null,
  end_date date not null,
  status public.record_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_plans_date_check check (end_date >= start_date)
);

create table if not exists public.plan_entries (
  plan_entry_id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references public.lesson_plans(lesson_plan_id) on delete cascade,
  lesson_id uuid references public.lessons(lesson_id) on delete set null,
  entry_type public.plan_entry_type not null default 'planned_item',
  category public.plan_item_category not null,
  day public.weekday_name,
  scheduled_date date,
  start_time time,
  end_time time,
  room public.room_type,
  title text not null,
  description text,
  original_plan_entry_id uuid references public.plan_entries(plan_entry_id) on delete set null,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_entries_time_check check (
    start_time is null
    or end_time is null
    or end_time > start_time
  ),
  constraint plan_entries_schedule_presence_check check (
    day is not null or scheduled_date is not null
  )
);

create table if not exists public.school_calendar_events (
  event_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(school_id) on delete cascade,
  section_id uuid references public.sections(section_id) on delete cascade,
  subject_id uuid references public.subjects(subject_id) on delete cascade,
  event_type public.calendar_event_type not null,
  title text not null,
  description text,
  start_date date not null,
  end_date date not null,
  is_whole_day boolean not null default true,
  created_by uuid references public.users(userid) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_calendar_events_date_check check (end_date >= start_date)
);

create table if not exists public.teacher_absences (
  absence_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(userid) on delete cascade,
  school_id uuid not null references public.schools(school_id) on delete cascade,
  subject_id uuid references public.subjects(subject_id) on delete cascade,
  section_id uuid references public.sections(section_id) on delete cascade,
  absent_on date not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists lesson_plans_user_id_idx on public.lesson_plans(user_id);
create index if not exists lesson_plans_school_id_idx on public.lesson_plans(school_id);
create index if not exists lesson_plans_subject_id_idx on public.lesson_plans(subject_id);
create index if not exists lesson_plans_section_id_idx on public.lesson_plans(section_id);
create index if not exists lesson_plans_term_idx on public.lesson_plans(term);
create index if not exists lesson_plans_status_idx on public.lesson_plans(status);
create index if not exists lesson_plans_date_range_idx on public.lesson_plans(start_date, end_date);

create index if not exists plan_entries_lesson_plan_id_idx on public.plan_entries(lesson_plan_id);
create index if not exists plan_entries_lesson_id_idx on public.plan_entries(lesson_id);
create index if not exists plan_entries_category_idx on public.plan_entries(category);
create index if not exists plan_entries_entry_type_idx on public.plan_entries(entry_type);
create index if not exists plan_entries_day_idx on public.plan_entries(day);
create index if not exists plan_entries_scheduled_date_idx on public.plan_entries(scheduled_date);
create index if not exists plan_entries_original_plan_entry_id_idx on public.plan_entries(original_plan_entry_id);

create index if not exists school_calendar_events_school_id_idx on public.school_calendar_events(school_id);
create index if not exists school_calendar_events_section_id_idx on public.school_calendar_events(section_id);
create index if not exists school_calendar_events_subject_id_idx on public.school_calendar_events(subject_id);
create index if not exists school_calendar_events_event_type_idx on public.school_calendar_events(event_type);
create index if not exists school_calendar_events_date_idx on public.school_calendar_events(start_date, end_date);

create index if not exists teacher_absences_user_id_idx on public.teacher_absences(user_id);
create index if not exists teacher_absences_school_id_idx on public.teacher_absences(school_id);
create index if not exists teacher_absences_subject_id_idx on public.teacher_absences(subject_id);
create index if not exists teacher_absences_section_id_idx on public.teacher_absences(section_id);
create index if not exists teacher_absences_absent_on_idx on public.teacher_absences(absent_on);

create or replace trigger trg_lesson_plans_updated_at
before update on public.lesson_plans
for each row execute function public.set_updated_at();

create or replace trigger trg_plan_entries_updated_at
before update on public.plan_entries
for each row execute function public.set_updated_at();

create or replace trigger trg_school_calendar_events_updated_at
before update on public.school_calendar_events
for each row execute function public.set_updated_at();
