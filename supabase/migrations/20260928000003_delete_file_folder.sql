-- Delete file: remove from files table and parent folder's content array.
-- Returns the cloudflare key so the client can delete from R2.

create or replace function public.delete_file(p_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_file public.files;
begin
  delete from public.files where id = p_id returning * into v_file;
  if not found then
    raise exception 'File not found';
  end if;

  update public.folders
     set content = coalesce(
       (select jsonb_agg(elem)
        from jsonb_array_elements(content) as elem
        where elem ->> 'file' is distinct from p_id),
       '[]'::jsonb)
   where content @> jsonb_build_array(jsonb_build_object('file', p_id));

  return jsonb_build_object('cloudflare', v_file.cloudflare);
end;
$$;

-- Delete folder: recursively collect all cloudflare keys from nested files,
-- delete all descendant folders and files, remove from parent's content array.
-- Returns an array of cloudflare keys for R2 cleanup.

create or replace function public.delete_folder(p_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_folder public.folders;
  v_keys jsonb;
begin
  select * into v_folder from public.folders where id = p_id;
  if not found then
    raise exception 'Folder not found';
  end if;

  -- Prevent deleting root folders (filesystem roots)
  if v_folder.path = '/' || v_folder.id then
    raise exception 'Cannot delete a root folder';
  end if;

  -- Collect all cloudflare keys from files in this folder and all descendants
  select coalesce(jsonb_agg(f.cloudflare), '[]'::jsonb)
  into v_keys
  from public.files f
  where f.path like v_folder.path || '%';

  -- Delete all files in this folder and descendants
  delete from public.files
  where path like v_folder.path || '%';

  -- Delete all descendant folders (children first doesn't matter, no FK)
  delete from public.folders
  where id <> p_id
    and path like v_folder.path || '/%';

  -- Delete the folder itself
  delete from public.folders where id = p_id;

  -- Remove from parent's content array
  update public.folders
     set content = coalesce(
       (select jsonb_agg(elem)
        from jsonb_array_elements(content) as elem
        where elem ->> 'folder' is distinct from p_id),
       '[]'::jsonb)
   where content @> jsonb_build_array(jsonb_build_object('folder', p_id));

  return jsonb_build_object('keys', v_keys);
end;
$$;

grant execute on function public.delete_file(text) to anon, authenticated;
grant execute on function public.delete_folder(text) to anon, authenticated;
