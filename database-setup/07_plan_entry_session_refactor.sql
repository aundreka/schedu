-- Refactor plan_entries to use only session_category/session_subcategory.
-- This migration keeps existing values by converting enum-backed columns to text,
-- recreating the enums, and then casting back.

alter table if exists public.plan_entries
  drop constraint if exists plan_entries_session_category_matches_category_check;

alter table if exists public.plan_entries
  drop constraint if exists plan_entries_session_pair_check;

alter table if exists public.plan_entries
  alter column session_category drop not null;

alter table if exists public.plan_entries
  alter column session_category type text using session_category::text,
  alter column session_subcategory type text using session_subcategory::text;

alter table if exists public.plan_entries
  drop column if exists category;

drop type if exists public.plan_item_category;
drop type if exists public.session_subcategory;
drop type if exists public.session_category;

create type public.session_category as enum (
  'lesson',
  'written_work',
  'performance_task',
  'exam',
  'buffer'
);

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
  'final',
  'review',
  'preparation',
  'other'
);

alter table if exists public.plan_entries
  alter column session_category type public.session_category using session_category::public.session_category,
  alter column session_subcategory type public.session_subcategory using session_subcategory::public.session_subcategory,
  alter column session_category set not null;

alter table if exists public.plan_entries
  add constraint plan_entries_session_pair_check check (
    (session_category = 'lesson' and session_subcategory in ('lecture', 'laboratory'))
    or (session_category = 'written_work' and session_subcategory in ('assignment', 'seatwork', 'quiz'))
    or (session_category = 'performance_task' and session_subcategory in ('activity', 'lab_report', 'reporting', 'project'))
    or (session_category = 'exam' and session_subcategory in ('prelim', 'midterm', 'final'))
    or (session_category = 'buffer' and session_subcategory in ('review', 'preparation', 'other'))
  );
