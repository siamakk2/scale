-- S.C.A.L.E. — billing
--
-- The plan lives per ACCOUNT, not per business: the Scale plan covers several
-- websites, and a plan column on each business row would have to be kept in
-- sync across all of them.
--
-- Users can read their own subscription and nothing more. Every write comes
-- from the Stripe webhook under the service role, so a plan can only change
-- because Stripe says money moved.

create table if not exists public.subscriptions (
  owner_id               uuid primary key references auth.users(id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free','growth','scale')),
  status                 text not null default 'none',   -- Stripe subscription status, or 'none'
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy read_own_subscription on public.subscriptions
  for select using (owner_id = auth.uid());

-- The plan a person is actually entitled to right now. past_due keeps access
-- while Stripe retries the card; anything else (canceled, unpaid, incomplete)
-- falls back to free.
create or replace function public.plan_for(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.plan from public.subscriptions s
    where s.owner_id = uid and s.status in ('active','trialing','past_due')
  ), 'free');
$$;
grant execute on function public.plan_for(uuid) to authenticated, service_role;

-- Close the hole the first schema left open: own_businesses is FOR ALL, so a
-- signed-in user could write plan or the Stripe ids on their own row. Users
-- may now only write the descriptive columns.
revoke insert, update on public.businesses from anon, authenticated;
grant insert (owner_id, name, website_url, industry, locale) on public.businesses to authenticated;
grant update (name, website_url, industry, locale) on public.businesses to authenticated;

-- Site limits per plan, enforced in the database so no client can skip them.
create or replace function public.enforce_site_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  have int;
  cap  int;
begin
  select count(*) into have from public.businesses where owner_id = new.owner_id;
  cap := case public.plan_for(new.owner_id) when 'scale' then 5 else 1 end;
  if have >= cap then
    raise exception 'site_limit: your plan allows % website%', cap, case when cap = 1 then '' else 's' end
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists businesses_site_limit on public.businesses;
create trigger businesses_site_limit before insert on public.businesses
  for each row execute function public.enforce_site_limit();
