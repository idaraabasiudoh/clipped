-- notify_folder_change is a trigger function only; it should not be directly callable via RPC.
revoke all on function public.notify_folder_change() from public, anon, authenticated;
