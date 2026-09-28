-- Restructure into separate files and folders tables.
-- files: id, name, path (filesystem location), cloudflare (R2 key), created.
-- folders: id, name, path (from root), content ([{folder: id}, {file: id}, ...]), created.

-- ---- 1. Create files table ------------------------------------------------

create table public.files (
  id text primary key default gen_random_uuid()::text,
  name text not null check (char_length(name) between 1 and 255),
  path text not null,
  cloudflare text not null,
  created timestamptz not null default now()
);

create index files_cloudflare_idx on public.files (cloudflare);

alter table public.files enable row level security;
revoke all on public.files from anon, authenticated;

-- ---- 2. Migrate embedded file data into the files table --------------------

insert into public.files (id, name, path, cloudflare, created)
select
  f.key,
  coalesce(f.value ->> 'name', f.key),
  fld.dir,
  f.value ->> 'path',
  coalesce((f.value ->> 'created')::timestamptz, now())
from public.folders fld,
     jsonb_each(fld.content -> 'files') f
where jsonb_typeof(fld.content -> 'files') = 'object'
on conflict (id) do nothing;

-- ---- 3. Convert content from {folders:{}, files:{}} to [{folder:id}, …] ----

update public.folders
set content = coalesce(
  (select jsonb_agg(item)
   from (
     select jsonb_build_object('folder', key) as item
     from jsonb_each(
       case when jsonb_typeof(content -> 'folders') = 'object'
            then content -> 'folders' else '{}'::jsonb end)
     union all
     select jsonb_build_object('file', key) as item
     from jsonb_each(
       case when jsonb_typeof(content -> 'files') = 'object'
            then content -> 'files' else '{}'::jsonb end)
   ) s),
  '[]'::jsonb);

-- ---- 4. Rename dir → path and set new default -----------------------------

alter table public.folders rename column dir to path;
alter table public.folders alter column content set default '[]'::jsonb;
alter index if exists folders_dir_idx rename to folders_path_idx;

-- ---- 5. Drop old add_file overloads ----------------------------------------

drop function if exists public.add_file(text, text, text);
drop function if exists public.add_file(text, text, text, text, bigint);

-- ---- 6. RPC functions ------------------------------------------------------

create or replace function public.get_folder(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder public.folders;
  v_content jsonb;
  v_trail jsonb;
begin
  select * into v_folder from public.folders where id = p_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(resolved order by ord), '[]'::jsonb)
  into v_content
  from (
    select t.ord,
      case
        when t.item ? 'folder' then
          (select jsonb_build_object('folder', jsonb_build_object(
            'id', f2.id, 'name', f2.name, 'created', f2.created))
           from public.folders f2 where f2.id = t.item ->> 'folder')
        when t.item ? 'file' then
          (select jsonb_build_object('file', jsonb_build_object(
            'id', fi.id, 'name', fi.name, 'path', fi.path,
            'cloudflare', fi.cloudflare, 'created', fi.created))
           from public.files fi where fi.id = t.item ->> 'file')
      end as resolved
    from jsonb_array_elements(v_folder.content) with ordinality as t(item, ord)
  ) sub
  where resolved is not null;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by t.ord),
    '[]'::jsonb)
  into v_trail
  from unnest(string_to_array(trim(both '/' from v_folder.path), '/'))
       with ordinality as t(id, ord)
  join public.folders a on a.id = t.id;

  return jsonb_build_object(
    'id', v_folder.id,
    'name', v_folder.name,
    'created', v_folder.created,
    'path', v_folder.path,
    'content', v_content,
    'trail', v_trail);
end;
$$;

create or replace function public.open_filesystem(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_new  text;
begin
  if v_name !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' then
    raise exception 'File system names are 3-48 characters: lowercase letters, numbers and dashes';
  end if;

  insert into public.folders (id, name, path)
  values (v_name, v_name, '/' || v_name)
  on conflict (id) do nothing
  returning id into v_new;

  perform 1 from public.folders where id = v_name and path = '/' || v_name;
  if not found then
    raise exception 'That name is not available';
  end if;

  return public.get_folder(v_name) || jsonb_build_object('isNew', v_new is not null);
end;
$$;

create or replace function public.get_tree(p_fs text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'name', name, 'path', path) order by path),
    '[]'::jsonb)
  from public.folders
  where p_fs ~ '^[a-z0-9-]+$'
    and (path = '/' || p_fs or path like '/' || p_fs || '/%');
$$;

create or replace function public.create_folder(p_name text, p_parent text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     text := gen_random_uuid()::text;
  v_parent public.folders;
  v_row    public.folders;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Folder name must be 1-120 characters';
  end if;
  if v_name ~ '[/\\]' then
    raise exception 'Folder names can''t contain slashes';
  end if;
  if p_parent is null then
    raise exception 'A parent folder is required';
  end if;

  select * into v_parent from public.folders where id = p_parent for update;
  if not found then
    raise exception 'Parent folder not found';
  end if;

  insert into public.folders (id, name, path)
  values (v_id, v_name, v_parent.path || '/' || v_id)
  returning * into v_row;

  update public.folders
     set content = content || jsonb_build_array(jsonb_build_object('folder', v_id))
   where id = p_parent;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'created', v_row.created, 'path', v_row.path);
end;
$$;

create or replace function public.add_file(p_folder text, p_cloudflare text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parts  text[] := string_to_array(p_cloudflare, '/');
  v_folder public.folders;
  v_id     text := gen_random_uuid()::text;
  v_file   public.files;
begin
  if array_length(v_parts, 1) <> 3
     or v_parts[1] not in ('pictures', 'videos')
     or v_parts[2] <> p_folder then
    raise exception 'Invalid file path';
  end if;

  select * into v_folder from public.folders where id = p_folder for update;
  if not found then
    raise exception 'Folder not found';
  end if;

  insert into public.files (id, name, path, cloudflare)
  values (v_id,
          left(coalesce(nullif(btrim(p_name), ''), v_parts[3]), 255),
          v_folder.path,
          p_cloudflare)
  returning * into v_file;

  update public.folders
     set content = content || jsonb_build_array(jsonb_build_object('file', v_id))
   where id = p_folder;

  return jsonb_build_object(
    'id', v_file.id,
    'name', v_file.name,
    'path', v_file.path,
    'cloudflare', v_file.cloudflare,
    'created', v_file.created);
end;
$$;

-- ---- 7. Trigger (uses renamed column) --------------------------------------

create or replace function public.notify_folder_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id),
    'changed',
    'fs:' || split_part(new.path, '/', 2),
    false);
  return new;
end;
$$;

drop trigger if exists folders_notify_change on public.folders;
create trigger folders_notify_change
  after update of content on public.folders
  for each row execute function public.notify_folder_change();

revoke all on function public.notify_folder_change() from public, anon, authenticated;

-- ---- 8. Permissions --------------------------------------------------------

grant execute on function public.get_folder(text) to anon, authenticated;
grant execute on function public.open_filesystem(text) to anon, authenticated;
grant execute on function public.get_tree(text) to anon, authenticated;
grant execute on function public.create_folder(text, text) to anon, authenticated;
grant execute on function public.add_file(text, text, text) to anon, authenticated;
