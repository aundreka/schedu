-- Add session taxonomy + blackout reasons and backfill existing data.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'meeting_type') then
    create type public.meeting_type as enum ('lecture', 'laboratory');
  end if;

  if not exists (select 1 from pg_type where typname = 'session_category') then
    create type public.session_category as enum (
      'lesson',
      'written_work',
      'performance_task',
      'exam'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'session_subcategory') then
    create type public.session_subcategory as enum (
      'lecture',
      'laboratory',
      'assignment',
      'seatwork',
      'quiz',
      'activity',
      'lab_report',
      'reporting',
      'project',
      'prelim',
      'midterm',
      'final'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_blackout_reason') then
    create type public.plan_blackout_reason as enum (
      'event',
      'exam_week',
      'holiday',
      'leave',
      'sick',
      'suspended',
      'other'
    );
  end if;
end $$;

alter table public.plan_entries
  add column if not exists meeting_type public.meeting_type,
  add column if not exists session_category public.session_category,
  add column if not exists session_subcategory public.session_subcategory;

update public.plan_entries
set meeting_type = room::text::public.meeting_type
where meeting_type is null
  and room is not null;

update public.plan_entries
set session_category = category::text::public.session_category
where session_category is null
  and category::text in ('lesson', 'written_work', 'performance_task', 'exam');

update public.plan_entries
set session_subcategory = case
  when session_category = 'lesson' then coalesce(meeting_type::text, room::text)::public.session_subcategory
  when session_category = 'written_work' then
    (case
      when lower(coalesce(title, '')) like '%quiz%' then 'quiz'
      when lower(coalesce(title, '')) like '%seatwork%' then 'seatwork'
      when lower(coalesce(description, '')) like '%quiz%' then 'quiz'
      when lower(coalesce(description, '')) like '%seatwork%' then 'seatwork'
      else 'assignment'
    end)::public.session_subcategory
  when session_category = 'performance_task' then
    (case
      when lower(coalesce(title, '')) like '%project%' then 'project'
      when lower(coalesce(description, '')) like '%project%' then 'project'
      when lower(coalesce(title, '')) like '%lab report%' then 'lab_report'
      when lower(coalesce(description, '')) like '%lab report%' then 'lab_report'
      when lower(coalesce(title, '')) like '%reporting%' then 'reporting'
      when lower(coalesce(description, '')) like '%reporting%' then 'reporting'
      else 'activity'
    end)::public.session_subcategory
  when session_category = 'exam' then
    (case
      when lower(coalesce(title, '')) like '%prelim%' then 'prelim'
      when lower(coalesce(title, '')) like '%midterm%' then 'midterm'
      else 'final'
    end)::public.session_subcategory
  else null
end
where session_subcategory is null;

create index if not exists plan_entries_meeting_type_idx on public.plan_entries(meeting_type);
create index if not exists plan_entries_session_category_idx on public.plan_entries(session_category);
create index if not exists plan_entries_session_subcategory_idx on public.plan_entries(session_subcategory);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plan_entries_session_category_matches_category_check'
  ) then
    alter table public.plan_entries
      add constraint plan_entries_session_category_matches_category_check check (
        session_category is null
        or session_category::text = category::text
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'plan_entries_session_pair_check'
  ) then
    alter table public.plan_entries
      add constraint plan_entries_session_pair_check check (
        (session_category is null and session_subcategory is null)
        or (session_category = 'lesson' and session_subcategory in ('lecture', 'laboratory'))
        or (session_category = 'written_work' and session_subcategory in ('assignment', 'seatwork', 'quiz'))
        or (session_category = 'performance_task' and session_subcategory in ('activity', 'lab_report', 'reporting', 'project'))
        or (session_category = 'exam' and session_subcategory in ('prelim', 'midterm', 'final'))
      );
  end if;
end $$;

alter table public.school_calendar_events
  add column if not exists blackout_reason public.plan_blackout_reason not null default 'event';

update public.school_calendar_events
set blackout_reason = case
  when event_type = 'holiday' then 'holiday'::public.plan_blackout_reason
  when event_type = 'suspension' then 'suspended'::public.plan_blackout_reason
  when event_type = 'exam_week' then 'exam_week'::public.plan_blackout_reason
  when event_type = 'school_event' then 'event'::public.plan_blackout_reason
  else 'other'::public.plan_blackout_reason
end
where blackout_reason is null or blackout_reason = 'event';

alter table public.teacher_absences
  add column if not exists blackout_reason public.plan_blackout_reason not null default 'leave';

update public.teacher_absences
set blackout_reason = case
  when lower(coalesce(reason, '')) like '%sick%' then 'sick'::public.plan_blackout_reason
  when lower(coalesce(reason, '')) like '%suspend%' then 'suspended'::public.plan_blackout_reason
  when lower(coalesce(reason, '')) like '%leave%' then 'leave'::public.plan_blackout_reason
  else 'other'::public.plan_blackout_reason
end
where blackout_reason is null or blackout_reason = 'leave';

create index if not exists school_calendar_events_blackout_reason_idx on public.school_calendar_events(blackout_reason);
create index if not exists teacher_absences_blackout_reason_idx on public.teacher_absences(blackout_reason);
