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

create table if not exists public.slots (
  slot_id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references public.lesson_plans(lesson_plan_id) on delete cascade,
  title text,
  slot_date date not null,
  weekday public.weekday_name not null,
  start_time time not null,
  end_time time not null,
  meeting_type public.meeting_type,
  room public.room_type,
  slot_number integer not null default 1,
  series_key text not null,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slots_time_check check (end_time > start_time),
  constraint slots_number_check check (slot_number > 0),
  constraint slots_unique_occurrence unique (lesson_plan_id, slot_date, slot_number)
);

create table if not exists public.blocks (
  block_id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references public.lesson_plans(lesson_plan_id) on delete cascade,
  slot_id uuid references public.slots(slot_id) on delete set null,
  root_block_id uuid references public.blocks(block_id) on delete set null,
  lesson_id uuid references public.lessons(lesson_id) on delete set null,
  algorithm_block_key text not null,
  block_key text not null,
  title text not null,
  description text,
  session_category public.session_category not null,
  session_subcategory public.session_subcategory,
  meeting_type public.meeting_type,
  estimated_minutes integer not null default 60,
  min_minutes integer,
  max_minutes integer,
  required boolean not null default true,
  splittable boolean not null default false,
  overlay_mode text not null default 'major' check (overlay_mode in ('exclusive', 'major', 'minor')),
  preferred_session_type text not null default 'any' check (preferred_session_type in ('lecture', 'laboratory', 'mixed', 'any')),
  dependency_keys text[] not null default '{}',
  order_no integer not null default 1,
  is_locked boolean not null default false,
  ww_subtype public.session_subcategory,
  pt_subtype public.session_subcategory,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blocks_order_check check (order_no > 0),
  constraint blocks_minutes_check check (estimated_minutes > 0),
  constraint blocks_range_check check (
    min_minutes is null
    or max_minutes is null
    or max_minutes >= min_minutes
  ),
  constraint blocks_unique_algorithm_key unique (lesson_plan_id, algorithm_block_key),
  constraint blocks_session_pair_check check (
    (session_category = 'lesson' and session_subcategory in ('lecture', 'laboratory'))
    or (session_category = 'written_work' and session_subcategory in ('assignment', 'seatwork', 'quiz'))
    or (session_category = 'performance_task' and session_subcategory in ('activity', 'lab_report', 'reporting', 'project'))
    or (session_category = 'exam' and session_subcategory in ('prelim', 'midterm', 'final'))
    or (session_category = 'buffer' and session_subcategory in ('review', 'preparation', 'orientation', 'other'))
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

create table if not exists public.delays (
  delay_id uuid primary key default gen_random_uuid(),
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

create index if not exists slots_lesson_plan_id_idx on public.slots(lesson_plan_id);
create index if not exists slots_slot_date_idx on public.slots(slot_date);
create index if not exists slots_weekday_idx on public.slots(weekday);
create index if not exists slots_series_key_idx on public.slots(lesson_plan_id, series_key);
create index if not exists slots_room_idx on public.slots(room);

create index if not exists blocks_lesson_plan_id_idx on public.blocks(lesson_plan_id);
create index if not exists blocks_slot_id_idx on public.blocks(slot_id);
create index if not exists blocks_root_block_id_idx on public.blocks(root_block_id);
create index if not exists blocks_lesson_id_idx on public.blocks(lesson_id);
create index if not exists blocks_category_idx on public.blocks(session_category);
create index if not exists blocks_subcategory_idx on public.blocks(session_subcategory);
create index if not exists blocks_block_key_idx on public.blocks(lesson_plan_id, block_key);
create index if not exists blocks_order_idx on public.blocks(slot_id, order_no);
create index if not exists blocks_locked_idx on public.blocks(is_locked);

create index if not exists plan_subject_content_lesson_plan_idx on public.plan_subject_content(lesson_plan_id);
create index if not exists plan_subject_content_subject_idx on public.plan_subject_content(subject_id);
create index if not exists plan_subject_content_content_level_idx on public.plan_subject_content(content_level);

create index if not exists school_calendar_events_school_id_idx on public.school_calendar_events(school_id);
create index if not exists school_calendar_events_section_id_idx on public.school_calendar_events(section_id);
create index if not exists school_calendar_events_subject_id_idx on public.school_calendar_events(subject_id);
create index if not exists school_calendar_events_event_type_idx on public.school_calendar_events(event_type);
create index if not exists school_calendar_events_blackout_reason_idx on public.school_calendar_events(blackout_reason);
create index if not exists school_calendar_events_date_idx on public.school_calendar_events(start_date, end_date);

create index if not exists delays_user_id_idx on public.delays(user_id);
create index if not exists delays_school_id_idx on public.delays(school_id);
create index if not exists delays_subject_id_idx on public.delays(subject_id);
create index if not exists delays_section_id_idx on public.delays(section_id);
create index if not exists delays_absent_on_idx on public.delays(absent_on);
create index if not exists delays_blackout_reason_idx on public.delays(blackout_reason);

create or replace trigger trg_lesson_plans_updated_at
before update on public.lesson_plans
for each row execute function public.set_updated_at();

create or replace trigger trg_slots_updated_at
before update on public.slots
for each row execute function public.set_updated_at();

create or replace trigger trg_blocks_updated_at
before update on public.blocks
for each row execute function public.set_updated_at();

create or replace function public.sync_lesson_estimated_minutes(p_lesson_id uuid)
returns void
language plpgsql
as $$
begin
  if p_lesson_id is null then
    return;
  end if;

  update public.lessons as lesson
  set estimated_minutes = coalesce((
    select sum(
      greatest(
        0,
        floor(extract(epoch from (slot.end_time - slot.start_time)) / 60)
      )::integer
    )
    from public.blocks as block
    join public.slots as slot on slot.slot_id = block.slot_id
    where block.lesson_id = p_lesson_id
  ), 0)
  where lesson.lesson_id = p_lesson_id;
end;
$$;

create or replace function public.handle_blocks_lesson_minutes_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.slot_id is not null then
      perform public.sync_lesson_estimated_minutes(old.lesson_id);
    end if;
    return null;
  end if;

  if tg_op = 'UPDATE' and old.slot_id is not null then
    perform public.sync_lesson_estimated_minutes(old.lesson_id);
  end if;

  if new.slot_id is not null then
    perform public.sync_lesson_estimated_minutes(new.lesson_id);
  end if;

  return null;
end;
$$;

create or replace function public.handle_slots_lesson_minutes_sync()
returns trigger
language plpgsql
as $$
declare
  affected_lesson_id uuid;
begin
  for affected_lesson_id in
    select distinct block.lesson_id
    from public.blocks as block
    where block.slot_id = new.slot_id
      and block.lesson_id is not null
  loop
    perform public.sync_lesson_estimated_minutes(affected_lesson_id);
  end loop;

  return null;
end;
$$;

create or replace trigger trg_blocks_lesson_minutes_sync
after insert or update or delete on public.blocks
for each row execute function public.handle_blocks_lesson_minutes_sync();

create or replace trigger trg_slots_lesson_minutes_sync
after update of start_time, end_time on public.slots
for each row execute function public.handle_slots_lesson_minutes_sync();

create or replace trigger trg_plan_subject_content_updated_at
before update on public.plan_subject_content
for each row execute function public.set_updated_at();

create or replace trigger trg_school_calendar_events_updated_at
before update on public.school_calendar_events
for each row execute function public.set_updated_at();
