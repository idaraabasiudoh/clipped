-- Clipped: shared folders for pictures and videos.
--
-- Data model
--   public.folders     one row per folder (top-level or sub-folder)
--     id       short random id, used in the share URL (/f/<id>)
--     name     display name
--     created  creation timestamp
--     dir      path of folder ids from the root down to this folder, e.g. "/a1b2c3/d4e5f6"
--     content  { "folders": { "<id>": {id, name, created} },
--                "files":   { "<id>": {id, name, path, kind, mime, size, created} } }
--              "path" is the object's key in the "media" bucket.
--
--   storage bucket "media"
--     pictures/<folder id>/<file id>.<ext>
--     videos/<folder id>/<file id>.<ext>
--
-- The table is not directly readable or writable by clients. Everything goes through
-- the security-definer functions below, so folders are only reachable by someone who
-- knows their id, and concurrent uploads can't clobber each other's "content" updates.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.short_id(len int default 10)
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
                  1 + (get_byte(b, i) % 62), 1),
           '')
  from (select extensions.gen_random_bytes(len) as b) s,
       generate_series(0, len - 1) as i;
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.folders (
  id      text primary key default public.short_id(),
  name    text not null check (char_length(name) between 1 and 120),
  created timestamptz not null default now(),
  dir     text not null,
  content jsonb not null default '{"folders": {}, "files": {}}'::jsonb
);

create index if not exists folders_dir_idx on public.folders (dir text_pattern_ops);

alter table public.folders enable row level security;
-- No policies on purpose: clients use the RPC functions below.
revoke all on public.folders from anon, authenticated;

create or replace function public.folder_exists(p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.folders where id = p_id);
$$;

-- ---------------------------------------------------------------------------
-- RPC: read a folder (with breadcrumb trail)
-- ---------------------------------------------------------------------------

create or replace function public.get_folder(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', f.id,
           'name', f.name,
           'created', f.created,
           'dir', f.dir,
           'content', f.content,
           'trail', coalesce((
             select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by t.ord)
             from unnest(string_to_array(trim(both '/' from f.dir), '/')) with ordinality as t(id, ord)
             join public.folders a on a.id = t.id
           ), '[]'::jsonb)
         )
  from public.folders f
  where f.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create a folder (top-level when p_parent is null)
-- ---------------------------------------------------------------------------

create or replace function public.create_folder(p_name text, p_parent text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     text := public.short_id();
  v_parent public.folders;
  v_row    public.folders;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Folder name must be 1-120 characters';
  end if;

  if p_parent is not null then
    -- Lock the parent so concurrent sub-folder creates serialize their content update.
    select * into v_parent from public.folders where id = p_parent for update;
    if not found then
      raise exception 'Parent folder not found';
    end if;
  end if;

  insert into public.folders (id, name, dir)
  values (v_id, v_name, coalesce(v_parent.dir, '') || '/' || v_id)
  returning * into v_row;

  if p_parent is not null then
    update public.folders
       set content = jsonb_set(
             content, array['folders', v_id],
             jsonb_build_object('id', v_id, 'name', v_name, 'created', v_row.created))
     where id = p_parent;
  end if;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'created', v_row.created, 'dir', v_row.dir);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: register an uploaded file in a folder
-- The object must already exist in the bucket under pictures/<folder>/ or videos/<folder>/.
-- Size and mime type are taken from storage, not trusted from the client.
-- ---------------------------------------------------------------------------

create or replace function public.add_file(p_folder text, p_path text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_path, '/');
  v_obj   storage.objects;
  v_id    text;
  v_entry jsonb;
begin
  if array_length(v_parts, 1) <> 3
     or v_parts[1] not in ('pictures', 'videos')
     or v_parts[2] <> p_folder then
    raise exception 'Invalid file path';
  end if;

  perform 1 from public.folders where id = p_folder for update;
  if not found then
    raise exception 'Folder not found';
  end if;

  select * into v_obj from storage.objects where bucket_id = 'media' and name = p_path;
  if not found then
    raise exception 'Uploaded object not found';
  end if;

  if (v_parts[1] = 'pictures' and coalesce(v_obj.metadata ->> 'mimetype', '') not like 'image/%')
     or (v_parts[1] = 'videos' and coalesce(v_obj.metadata ->> 'mimetype', '') not like 'video/%') then
    raise exception 'File type does not match its folder';
  end if;

  v_id := split_part(v_parts[3], '.', 1);
  v_entry := jsonb_build_object(
    'id', v_id,
    'name', left(coalesce(nullif(btrim(p_name), ''), v_parts[3]), 255),
    'path', p_path,
    'kind', case v_parts[1] when 'pictures' then 'picture' else 'video' end,
    'mime', v_obj.metadata ->> 'mimetype',
    'size', (v_obj.metadata ->> 'size')::bigint,
    'created', now()
  );

  update public.folders
     set content = jsonb_set(content, array['files', v_id], v_entry)
   where id = p_folder;

  return v_entry;
end;
$$;

revoke all on function public.short_id(int) from public, anon, authenticated;
revoke all on function public.folder_exists(text) from public;
grant execute on function public.folder_exists(text) to anon, authenticated;
grant execute on function public.get_folder(text) to anon, authenticated;
grant execute on function public.create_folder(text, text) to anon, authenticated;
grant execute on function public.add_file(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Live updates: broadcast a small "changed" ping on topic folder:<id> whenever a
-- folder's content changes, so everyone viewing it refreshes.
-- ---------------------------------------------------------------------------

create or replace function public.notify_folder_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id), 'changed', 'folder:' || new.id, false);
  return new;
end;
$$;

drop trigger if exists folders_notify_change on public.folders;
create trigger folders_notify_change
  after update of content on public.folders
  for each row execute function public.notify_folder_change();

-- ---------------------------------------------------------------------------
-- Storage bucket
-- Public read so media loads straight from the CDN at original quality (no image
-- transformations are used anywhere). file_size_limit = null means "use the
-- project's global upload limit" — raise that in Dashboard > Storage > Settings
-- if you want large videos.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, null, array['image/*', 'video/*'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Make the two top-level folders visible in the dashboard even before any upload.
insert into storage.objects (bucket_id, name)
values ('media', 'pictures/.emptyFolderPlaceholder'),
       ('media', 'videos/.emptyFolderPlaceholder')
on conflict do nothing;

-- Anyone may upload, but only into pictures/<existing folder>/ or videos/<existing folder>/.
-- No update/delete policies: uploads can't overwrite or remove existing files.
drop policy if exists "media: anyone can upload into a folder" on storage.objects;
create policy "media: anyone can upload into a folder"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in ('pictures', 'videos')
    and public.folder_exists((storage.foldername(name))[2])
  );
