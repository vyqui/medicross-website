create table offer_lead_deliveries (
  lead_id uuid not null references leads(id) on delete cascade,
  destination text not null check (destination in ('victor', 'office', 'sheet')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (lead_id, destination)
);
create index offer_lead_delivery_pending on offer_lead_deliveries(next_attempt_at)
  where delivered_at is null;
