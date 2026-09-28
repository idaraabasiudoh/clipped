-- File systems.
--
-- A file system is a top-level folder whose id is a human-chosen name (its "link"),
-- e.g. clipped.app/lagos-trip -> folders.id = 'lagos-trip', dir = '/lagos-trip'.
-- Every other folder lives beneath one, so folders.dir always starts with '/<fs name>'.
-- Names are lowercase-only; generated sub-folder ids are mixed-case, so they don't collide
-- in practice, and open_filesystem() refuses a name that belongs to a non-root folder anyway.

-- ---------------------------------------------------------------------------
-- RPC: open a file system, creating it if it doesn't exist yet
-- ---------------------------------------------------------------------------

create or replace function public.open_filesystem(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name    text := lower(btrim(coalesce(p_name, '')));
  v_new     text;
  v_dir     text;
begin
  if v_name !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' then
    raise exception 'File system names are 3-48 characters: lowercase letters, numbers and dashes';
  end if;

  insert into public.folders (id, name, dir)
  values (v_name, v_name, '/' || v_name)
  on conflict (id) do nothing
  returning id into v_new;

  select dir into v_dir from public.folders where id = v_name;
  if v_dir <> '/' || v_name then
    raise exception 'That name is not available';
  end if;

  return public.get_folder(v_name) || jsonb_build_object('isNew', v_new is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: every folder in a file system (id, name, dir) for the sidebar tree
-- ---------------------------------------------------------------------------

create or replace function public.get_tree(p_fs text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'dir', dir) order by dir), '[]'::jsonb)
  from public.folders
  where p_fs ~ '^[a-z0-9-]+$'
    and (dir = '/' || p_fs or dir like '/' || p_fs || '/%');
$$;

-- ---------------------------------------------------------------------------
-- create_folder now always needs a parent: top-level folders are file systems.
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
  if v_name ~ '[/\\]' then
    raise exception 'Folder names can''t contain slashes';
  end if;
  if p_parent is null then
    raise exception 'A parent folder is required';
  end if;

  -- Lock the parent so concurrent sub-folder creates serialize their content update.
  select * into v_parent from public.folders where id = p_parent for update;
  if not found then
    raise exception 'Parent folder not found';
  end if;

  insert into public.folders (id, name, dir)
  values (v_id, v_name, v_parent.dir || '/' || v_id)
  returning * into v_row;

  update public.folders
     set content = jsonb_set(
           content, array['folders', v_id],
           jsonb_build_object('id', v_id, 'name', v_name, 'created', v_row.created))
   where id = p_parent;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'created', v_row.created, 'dir', v_row.dir);
end;
$$;

-- ---------------------------------------------------------------------------
-- Live updates: one broadcast topic per file system (fs:<name>), carrying the id of
-- the folder that changed, so a client can refresh both the tree and the open folder.
-- ---------------------------------------------------------------------------

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
    'fs:' || split_part(new.dir, '/', 2),
    false);
  return new;
end;
$$;

grant execute on function public.open_filesystem(text) to anon, authenticated;
grant execute on function public.get_tree(text) to anon, authenticated;
