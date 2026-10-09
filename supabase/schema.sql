-- Lead Desk database. Paste this whole file into the Supabase SQL editor and
-- click Run. Safe to run again: every statement checks before it creates.
--
-- Row level security is ON with no policies, so the public (anon) key can read
-- and write nothing. Only the server, using the service role key from Vercel's
-- environment, can touch these tables.

create table if not exists runs (
  id             bigserial primary key,
  vertical       text not null,
  city           text,
  state          text,
  miles          integer,
  created_at     timestamptz not null default now(),
  found_count    integer not null default 0,
  new_count      integer not null default 0,
  existing_count integer not null default 0
);

create table if not exists leads (
  id              bigserial primary key,
  place_id        text not null unique,          -- Google listing id: the no-duplicates key
  vertical        text not null,                 -- the tab it was first found under; never changes
  name            text not null,
  address         text,
  phone           text,
  website         text,
  rating          numeric,
  review_count    integer,
  score           integer,
  bucket          text,
  track           text,
  confidence      text,
  why             jsonb not null default '[]',
  signals         jsonb not null default '[]',
  processor       jsonb not null default '[]',
  financing       jsonb not null default '[]',
  owner           jsonb,
  decision_makers jsonb not null default '[]',
  campaign        jsonb,
  hours           jsonb,
  source          text,
  market_city     text,
  market_state    text,
  -- Call tracking. Only the app writes these; a new run never overwrites them.
  status          text not null default 'to_call' check (status in ('to_call', 'worked', 'dnc')),
  last_outcome    text,
  last_touch_at   timestamptz,
  callback_on     date,
  notes           text not null default '',
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  first_run_id    bigint references runs(id) on delete set null,
  last_run_id     bigint references runs(id) on delete set null
);

create index if not exists leads_vertical_idx on leads (vertical, status);
create index if not exists leads_callback_idx on leads (callback_on) where callback_on is not null;

create table if not exists calls (
  id             bigserial primary key,
  lead_id        bigint not null references leads(id) on delete cascade,
  outcome        text not null check (outcome in
                   ('no_answer', 'voicemail', 'talked', 'meeting_set', 'not_a_fit', 'dnc')),
  decision_maker boolean not null default false,
  contact        text not null default '',
  notes          text not null default '',
  callback_on    date,
  call_date      date not null,                  -- the day in Central time, for the daily counter
  called_at      timestamptz not null default now()
);

create index if not exists calls_date_idx on calls (call_date);

alter table runs  enable row level security;
alter table leads enable row level security;
alter table calls enable row level security;

-- Save one search run. New businesses are inserted; ones already saved get
-- their score, signals and contact details refreshed, but keep their tab,
-- call status, notes, callback and first-seen date. Returns the run id, the
-- counts, and each lead's saved id and whether it was new.
create or replace function save_run(p_run jsonb, p_leads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id bigint;
  v_rows   jsonb;
  v_new    integer;
  v_total  integer;
begin
  insert into runs (vertical, city, state, miles, found_count)
  values (p_run->>'vertical', p_run->>'city', p_run->>'state',
          nullif(p_run->>'miles', '')::integer, jsonb_array_length(p_leads))
  returning id into v_run_id;

  with incoming as (
    select * from jsonb_to_recordset(p_leads) as x(
      place_id text, vertical text, name text, address text, phone text, website text,
      rating numeric, review_count integer, score integer, bucket text, track text,
      confidence text, why jsonb, signals jsonb, processor jsonb, financing jsonb,
      owner jsonb, decision_makers jsonb, campaign jsonb, hours jsonb, source text,
      market_city text, market_state text)
  ),
  saved as (
    insert into leads (place_id, vertical, name, address, phone, website, rating,
      review_count, score, bucket, track, confidence, why, signals, processor,
      financing, owner, decision_makers, campaign, hours, source, market_city,
      market_state, first_run_id, last_run_id)
    select place_id, vertical, name, address, phone, website, rating, review_count,
      score, bucket, track, confidence, coalesce(why, '[]'), coalesce(signals, '[]'),
      coalesce(processor, '[]'), coalesce(financing, '[]'), owner,
      coalesce(decision_makers, '[]'), campaign, hours, source, market_city,
      market_state, v_run_id, v_run_id
    from incoming
    on conflict (place_id) do update set
      name = excluded.name,
      address = excluded.address,
      phone = coalesce(excluded.phone, leads.phone),
      website = coalesce(excluded.website, leads.website),
      rating = excluded.rating,
      review_count = excluded.review_count,
      score = excluded.score,
      bucket = excluded.bucket,
      track = excluded.track,
      confidence = excluded.confidence,
      why = excluded.why,
      signals = excluded.signals,
      processor = excluded.processor,
      financing = excluded.financing,
      owner = coalesce(excluded.owner, leads.owner),
      decision_makers = excluded.decision_makers,
      campaign = excluded.campaign,
      hours = coalesce(excluded.hours, leads.hours),
      last_seen_at = now(),
      last_run_id = v_run_id
    returning id, place_id, status, (xmax = 0) as is_new
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'place_id', place_id, 'status', status, 'is_new', is_new)), '[]'),
         count(*) filter (where is_new),
         count(*)
    into v_rows, v_new, v_total
    from saved;

  update runs set new_count = v_new, existing_count = v_total - v_new where id = v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'new_count', v_new,
                            'existing_count', v_total - v_new, 'leads', v_rows);
end;
$$;

revoke all on function save_run(jsonb, jsonb) from public, anon, authenticated;
grant execute on function save_run(jsonb, jsonb) to service_role;
