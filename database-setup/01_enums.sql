create extension if not exists pgcrypto;

-- =========================
-- ENUMS
-- =========================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'school_type') then
    create type public.school_type as enum ('university', 'basic_ed', 'training_center');
  end if;

  if not exists (select 1 from pg_type where typname = 'academic_term') then
    create type public.academic_term as enum ('quarter', 'trimester', 'semester');
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_item_category') then
    create type public.plan_item_category as enum (
      'lesson',
      'review',
      'written_work',
      'performance_task',
      'exam'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'room_type') then
    create type public.room_type as enum ('lecture', 'laboratory');
  end if;

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

  if not exists (select 1 from pg_type where typname = 'record_status') then
    create type public.record_status as enum ('draft', 'published');
  end if;

  if not exists (select 1 from pg_type where typname = 'weekday_name') then
    create type public.weekday_name as enum (
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_entry_type') then
    create type public.plan_entry_type as enum (
      'recurring_class',
      'planned_item',
      'moved_item',
      'cancelled_item'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'calendar_event_type') then
    create type public.calendar_event_type as enum (
      'holiday',
      'suspension',
      'school_event',
      'exam_week',
      'other'
    );
  end if;
end $$;
