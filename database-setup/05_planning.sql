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
  meeting_type public.meeting_type,
  session_category public.session_category,
  session_subcategory public.session_subcategory,
  room public.room_type,
  instance_no integer,
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
    entry_type = 'planned_item'
    or day is not null
    or scheduled_date is not null
  ),
  constraint plan_entries_recurring_fields_check check (
    entry_type <> 'recurring_class'
    or (
      day is not null
      and start_time is not null
      and end_time is not null
      and room is not null
      and instance_no is not null
      and instance_no > 0
    )
  ),
  constraint plan_entries_session_category_matches_category_check check (
    session_category is null
    or session_category::text = category::text
  ),
  constraint plan_entries_session_pair_check check (
    (session_category is null and session_subcategory is null)
    or (session_category = 'lesson' and session_subcategory in ('lecture', 'laboratory'))
    or (session_category = 'written_work' and session_subcategory in ('assignment', 'seatwork', 'quiz'))
    or (session_category = 'performance_task' and session_subcategory in ('activity', 'lab_report', 'reporting', 'project'))
    or (session_category = 'exam' and session_subcategory in ('prelim', 'midterm', 'final'))
  )
);

create table if not exists public.plan_subject_content (
  plan_subject_content_id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references public.lesson_plans(lesson_plan_id) on delete cascade,
  subject_id uuid not null references public.subjects(subject_id) on delete cascade,
  unit_id uuid references public.units(unit_id) on delete set null,
  chapter_id uuid references public.chapters(chapter_id) on delete set null,
  lesson_id uuid references public.lessons(lesson_id) on delete set null,
  content_level text not null check (content_level in ('unit', 'chapter', 'lesson')),
  sequence_no integer not null default 1,
  selected_title text,
  selected_content text,
  learning_objectives text,
  estimated_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_calendar_events (
  event_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(school_id) on delete cascade,
  section_id uuid references public.sections(section_id) on delete cascade,
  subject_id uuid references public.subjects(subject_id) on delete cascade,
  event_type public.calendar_event_type not null,
  blackout_reason public.plan_blackout_reason not null default 'event',
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
  blackout_reason public.plan_blackout_reason not null default 'leave',
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
create index if not exists plan_entries_meeting_type_idx on public.plan_entries(meeting_type);
create index if not exists plan_entries_session_category_idx on public.plan_entries(session_category);
create index if not exists plan_entries_session_subcategory_idx on public.plan_entries(session_subcategory);
create index if not exists plan_entries_original_plan_entry_id_idx on public.plan_entries(original_plan_entry_id);
create index if not exists plan_entries_day_instance_idx on public.plan_entries(lesson_plan_id, day, instance_no);
create index if not exists plan_subject_content_lesson_plan_idx on public.plan_subject_content(lesson_plan_id);
create index if not exists plan_subject_content_subject_idx on public.plan_subject_content(subject_id);
create index if not exists plan_subject_content_content_level_idx on public.plan_subject_content(content_level);

create index if not exists school_calendar_events_school_id_idx on public.school_calendar_events(school_id);
create index if not exists school_calendar_events_section_id_idx on public.school_calendar_events(section_id);
create index if not exists school_calendar_events_subject_id_idx on public.school_calendar_events(subject_id);
create index if not exists school_calendar_events_event_type_idx on public.school_calendar_events(event_type);
create index if not exists school_calendar_events_blackout_reason_idx on public.school_calendar_events(blackout_reason);
create index if not exists school_calendar_events_date_idx on public.school_calendar_events(start_date, end_date);

create index if not exists teacher_absences_user_id_idx on public.teacher_absences(user_id);
create index if not exists teacher_absences_school_id_idx on public.teacher_absences(school_id);
create index if not exists teacher_absences_subject_id_idx on public.teacher_absences(subject_id);
create index if not exists teacher_absences_section_id_idx on public.teacher_absences(section_id);
create index if not exists teacher_absences_absent_on_idx on public.teacher_absences(absent_on);
create index if not exists teacher_absences_blackout_reason_idx on public.teacher_absences(blackout_reason);

create or replace trigger trg_lesson_plans_updated_at
before update on public.lesson_plans
for each row execute function public.set_updated_at();

create or replace trigger trg_plan_entries_updated_at
before update on public.plan_entries
for each row execute function public.set_updated_at();

create or replace trigger trg_plan_subject_content_updated_at
before update on public.plan_subject_content
for each row execute function public.set_updated_at();

create or replace trigger trg_school_calendar_events_updated_at
before update on public.school_calendar_events
for each row execute function public.set_updated_at();
