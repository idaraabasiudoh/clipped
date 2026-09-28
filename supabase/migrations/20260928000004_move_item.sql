-- Move a file or folder to a different parent folder.
-- Updates paths for the item and all descendants, swaps content arrays atomically.

create or replace function public.move_item(p_id text, p_item_type text, p_new_parent text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_new_parent public.folders;
  v_old_parent_id text;
  v_old_path text;
  v_new_path text;
  v_path_parts text[];
begin
  select * into v_new_parent from public.folders where id = p_new_parent for update;
  if not found then raise exception 'Target folder not found'; end if;

  if p_item_type = 'file' then
    select path into v_old_path from public.files where id = p_id;
    if not found then raise exception 'File not found'; end if;

    v_path_parts := string_to_array(trim(both '/' from v_old_path), '/');
    v_old_parent_id := v_path_parts[array_length(v_path_parts, 1)];

    if v_old_parent_id = p_new_parent then return; end if;

    perform 1 from public.folders where id = v_old_parent_id for update;

    update public.files set path = v_new_parent.path where id = p_id;

    update public.folders
       set content = coalesce(
         (select jsonb_agg(elem) from jsonb_array_elements(content) as elem
          where elem ->> 'file' is distinct from p_id), '[]'::jsonb)
     where id = v_old_parent_id;

    update public.folders
       set content = content || jsonb_build_array(jsonb_build_object('file', p_id))
     where id = p_new_parent;

  elsif p_item_type = 'folder' then
    select path into v_old_path from public.folders where id = p_id;
    if not found then raise exception 'Folder not found'; end if;

    if v_old_path = '/' || p_id then
      raise exception 'Cannot move a root folder';
    end if;

    if p_new_parent = p_id or v_new_parent.path like v_old_path || '/%' then
      raise exception 'Cannot move a folder into itself or a descendant';
    end if;

    v_path_parts := string_to_array(trim(both '/' from v_old_path), '/');
    v_old_parent_id := v_path_parts[array_length(v_path_parts, 1) - 1];

    if v_old_parent_id = p_new_parent then return; end if;

    perform 1 from public.folders where id = v_old_parent_id for update;

    v_new_path := v_new_parent.path || '/' || p_id;

    -- Update descendant folders
    update public.folders
       set path = v_new_path || substring(path from length(v_old_path) + 1)
     where path like v_old_path || '/%';

    -- Update the folder itself
    update public.folders set path = v_new_path where id = p_id;

    -- Update files in this folder and all descendants
    update public.files
       set path = v_new_path || substring(path from length(v_old_path) + 1)
     where path = v_old_path or path like v_old_path || '/%';

    -- Remove from old parent
    update public.folders
       set content = coalesce(
         (select jsonb_agg(elem) from jsonb_array_elements(content) as elem
          where elem ->> 'folder' is distinct from p_id), '[]'::jsonb)
     where id = v_old_parent_id;

    -- Add to new parent
    update public.folders
       set content = content || jsonb_build_array(jsonb_build_object('folder', p_id))
     where id = p_new_parent;

  else
    raise exception 'Item type must be file or folder';
  end if;
end;
$$;

grant execute on function public.move_item(text, text, text) to anon, authenticated;
