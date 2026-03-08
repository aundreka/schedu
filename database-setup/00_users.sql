create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('teacher', 'admin', 'superadmin');
  end if;
end $$;

create table if not exists public.users (
  userID uuid primary key references auth.users(id) on delete cascade,
  publicID text not null unique, 
  first_name text,
  last_name text,
  username text unique,
  email text unique,

  role public.user_role not null default 'teacher',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_publicid_idx on public.users(publicID);
create index if not exists users_role_idx on public.users(role);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_users_updated_at on public.users;

create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_first text;
  v_last text;
begin
  v_email := new.email;

  v_first := coalesce(new.raw_user_meta_data->>'given_name', new.raw_user_meta_data->>'first_name');
  v_last  := coalesce(new.raw_user_meta_data->>'family_name', new.raw_user_meta_data->>'last_name');

  insert into public.users (userID, publicID, first_name, last_name, email)
  values (
    new.id,
    'usr_' || replace(gen_random_uuid()::text, '-', ''), 
    v_first,
    v_last,
    v_email
  )
  on conflict (userID) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.users enable row level security;

drop policy if exists "users can read own profile" on public.users;
create policy "users can read own profile"
on public.users for select
using (auth.uid() = userID);

drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile"
on public.users for update
using (auth.uid() = userID)
with check (auth.uid() = userID);

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

drop policy if exists "users can upload own files" on storage.objects;
create policy "users can upload own files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "users can read own files" on storage.objects;
create policy "users can read own files"
on storage.objects for select to authenticated
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "users can delete own files" on storage.objects;
create policy "users can delete own files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = auth.uid()::text
);

