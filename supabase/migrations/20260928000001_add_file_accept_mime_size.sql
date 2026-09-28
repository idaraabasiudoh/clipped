-- add_file: accept mime and size from the client instead of looking them up
-- in storage.objects, since files are uploaded directly to R2 (not Supabase Storage).

create or replace function public.add_file(p_folder text, p_path text, p_name text, p_mime text default null, p_size bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_path, '/');
  v_id    text;
  v_kind  text;
  v_mime  text := coalesce(nullif(btrim(p_mime), ''), 'application/octet-stream');
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

  if (v_parts[1] = 'pictures' and v_mime not like 'image/%')
     or (v_parts[1] = 'videos' and v_mime not like 'video/%') then
    raise exception 'File type does not match its folder';
  end if;

  v_id := split_part(v_parts[3], '.', 1);
  v_entry := jsonb_build_object(
    'id', v_id,
    'name', left(coalesce(nullif(btrim(p_name), ''), v_parts[3]), 255),
    'path', p_path,
    'kind', case v_parts[1] when 'pictures' then 'picture' else 'video' end,
    'mime', v_mime,
    'size', p_size,
    'created', now()
  );

  update public.folders
     set content = jsonb_set(content, array['files', v_id], v_entry)
   where id = p_folder;

  return v_entry;
end;
$$;
