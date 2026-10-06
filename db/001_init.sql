-- S.C.A.L.E. — initial schema
--
-- The product thesis, encoded:
--
--   A one-off audit does not justify a subscription. A tracked trajectory
--   does. So `scans` is an append-only time series and nothing ever updates
--   a historical row. The score on any given day is interesting; the line it
--   draws over six months is the thing people pay for. That is Siamak's own
--   fifth stage -- "monthly measurement ... refine, repeat, compound" --
--   turned into the business model rather than a closing chapter.
--
-- The five score dimensions map 1:1 onto S.C.A.L.E., so the scoreboard IS the
-- framework rather than a generic SEO report wearing its name:
--
--   visibility  (Scan)      can AI systems find, read and cite this business
--   clarity     (Clarify)   is the positioning unambiguous and repeatable
--   structure   (Amplify)   schema, content architecture, retrievability
--   authority   (Leverage)  third-party citation and trust transfer
--   momentum    (Evaluate)  direction and rate of change over time
--
-- momentum is deliberately uncomputable on a first scan. It needs history,
-- which is the honest reason to come back next month.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- businesses
-- A user may own more than one. The MVP UI shows the first, but modelling it
-- now costs nothing and retrofitting multi-tenancy later costs a rewrite.
create table businesses (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  website_url     text not null,
  industry        text,
  locale          text default 'en-US',
  -- billing lives on the business, not the user: someone may pay for one
  -- business and not another.
  plan            text not null default 'free'
                  check (plan in ('free','growth','scale')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index businesses_owner_idx on businesses(owner_id);
create unique index businesses_stripe_customer_idx
  on businesses(stripe_customer_id) where stripe_customer_id is not null;

-- --------------------------------------------------------------------- scans
-- Append-only. A re-scan is a NEW row, never an update, or the trajectory --
-- the entire product -- is destroyed in place.
create table scans (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  status        text not null default 'queued'
                check (status in ('queued','running','complete','failed')),
  trigger       text not null default 'manual'
                check (trigger in ('manual','scheduled','onboarding')),

  overall_score  int check (overall_score between 0 and 100),
  -- {visibility,clarity,structure,authority,momentum}, each 0-100.
  -- momentum is null on a first scan; there is nothing to measure against.
  scores         jsonb,
  -- [{dimension,severity,title,evidence}] -- what the score is actually made of
  findings       jsonb,
  -- the unabridged engine payload, kept so a scoring change can be replayed
  -- against old scans instead of invalidating them
  raw            jsonb,

  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  error         text
);
create index scans_business_time_idx on scans(business_id, started_at desc);
-- One scan in flight per business. Without this a user hammering the button
-- bills us for N parallel model calls and writes a race into the history.
create unique index scans_one_active_idx on scans(business_id)
  where status in ('queued','running');

-- ------------------------------------------------------------ stage_progress
create table stage_progress (
  business_id   uuid not null references businesses(id) on delete cascade,
  stage         text not null
                check (stage in ('scan','clarify','amplify','leverage','evaluate')),
  status        text not null default 'locked'
                check (status in ('locked','available','in_progress','complete')),
  started_at    timestamptz,
  completed_at  timestamptz,
  primary key (business_id, stage)
);

-- ------------------------------------------------------------------- actions
-- What the app tells someone to DO. The scan produces the diagnosis; this is
-- the prescription, and it is where the app earns its keep over a PDF report.
create table actions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  scan_id       uuid references scans(id) on delete set null,
  stage         text not null
                check (stage in ('scan','clarify','amplify','leverage','evaluate')),
  title         text not null,
  detail        text,
  -- 1-5 each. Ranked impact-first, so the list opens on the thing that
  -- actually moves the number rather than the thing that is easiest to write.
  impact        int check (impact between 1 and 5),
  effort        int check (effort between 1 and 5),
  status        text not null default 'open'
                check (status in ('open','doing','done','dismissed')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index actions_business_idx on actions(business_id, status, impact desc);

-- --------------------------------------------------------------- positioning
-- The Clarify artefact, versioned. Siamak's test for this stage is that a
-- model and a human can both repeat it back, so each version keeps the
-- machine readback that was produced when it was written.
create table positioning (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  version         int not null,
  statement       text not null,
  audience        text,
  differentiators jsonb,
  proof           jsonb,
  machine_readback text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (business_id, version)
);

-- ---------------------------------------------------------------------- RLS
-- Self-serve and multi-tenant: every table is owner-scoped with no exceptions.
-- The service role bypasses RLS, which is how the scan worker writes.
alter table businesses     enable row level security;
alter table scans          enable row level security;
alter table stage_progress enable row level security;
alter table actions        enable row level security;
alter table positioning    enable row level security;

create policy own_businesses on businesses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Scans are read-only to users. They are written by the worker under the
-- service role, so a user cannot forge a score or rewrite their own history.
create policy read_own_scans on scans
  for select using (exists (
    select 1 from businesses b where b.id = scans.business_id and b.owner_id = auth.uid()));

create policy own_stage_progress on stage_progress
  for all using (exists (
    select 1 from businesses b where b.id = stage_progress.business_id and b.owner_id = auth.uid()))
  with check (exists (
    select 1 from businesses b where b.id = stage_progress.business_id and b.owner_id = auth.uid()));

-- Users may work their action list (status changes) but not invent actions;
-- those come from a scan.
create policy read_own_actions on actions
  for select using (exists (
    select 1 from businesses b where b.id = actions.business_id and b.owner_id = auth.uid()));
create policy update_own_actions on actions
  for update using (exists (
    select 1 from businesses b where b.id = actions.business_id and b.owner_id = auth.uid()))
  with check (exists (
    select 1 from businesses b where b.id = actions.business_id and b.owner_id = auth.uid()));

create policy own_positioning on positioning
  for all using (exists (
    select 1 from businesses b where b.id = positioning.business_id and b.owner_id = auth.uid()))
  with check (exists (
    select 1 from businesses b where b.id = positioning.business_id and b.owner_id = auth.uid()));

-- ------------------------------------------------------------------ triggers
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger businesses_touch before update on businesses
  for each row execute function touch_updated_at();

-- A new business starts with Scan available and the rest locked: "every
-- engagement starts here. No exceptions, no shortcuts."
create or replace function seed_stages() returns trigger
language plpgsql as $$
begin
  insert into stage_progress (business_id, stage, status) values
    (new.id,'scan','available'), (new.id,'clarify','locked'),
    (new.id,'amplify','locked'), (new.id,'leverage','locked'),
    (new.id,'evaluate','locked');
  return new;
end $$;

create trigger businesses_seed_stages after insert on businesses
  for each row execute function seed_stages();
