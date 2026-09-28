-- 0010: public guest demo (anonymous sign-ins). Needs "Allow anonymous sign-ins" switched on in
-- Supabase → Authentication → Sign In / Providers.

-- Guest workspaces are temporary: delete anonymous users (and, by cascade, everything they own)
-- older than p_hours. Called by the queue worker every minute; cheap when there's nothing to delete.
create or replace function public.delete_expired_guests(p_hours int default 24)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  delete from auth.users where is_anonymous and created_at < now() - make_interval(hours => p_hours);
  get diagnostics n = row_count;
  return n;
end $$;

-- Demo-wide limits: how many guests started, and what their AI use cost, since a point in time.
create or replace function public.guest_stats(p_since timestamptz)
returns table (guests bigint, spend numeric)
language sql stable security definer set search_path = public, auth as $$
  select
    (select count(*) from auth.users where is_anonymous and created_at >= p_since),
    (select coalesce(sum(u.cost_usd), 0)
       from public.ai_usage u join auth.users a on a.id = u.recruiter_id
      where a.is_anonymous and u.created_at >= p_since);
$$;

revoke execute on function public.delete_expired_guests(int) from public, anon, authenticated;
revoke execute on function public.guest_stats(timestamptz) from public, anon, authenticated;

-- Everyone at or over their monthly AI budget, in one query (each guest workspace has a small
-- budget, so checking recruiters one by one would get slow as the demo is used).
create or replace function public.recruiters_over_budget(p_since timestamptz)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.recruiter_id
    from public.recruiter_settings s
   where s.monthly_ai_budget_usd is not null
     and s.monthly_ai_budget_usd <= coalesce(
       (select sum(u.cost_usd) from public.ai_usage u where u.recruiter_id = s.recruiter_id and u.created_at >= p_since), 0);
$$;
revoke execute on function public.recruiters_over_budget(timestamptz) from public, anon, authenticated;
