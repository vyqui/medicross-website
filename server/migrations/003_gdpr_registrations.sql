-- A record of each completed GDPR travel-registration form, kept as a
-- backup/search record in case the emailed PDF is ever lost. Deliberately
-- minimal: the CNP and the signature image are never written here — they
-- exist only in the PDF attachment sent to office@tratamente-turcia.ro.
create table gdpr_registrations (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null,
  email               text        not null,
  phone               text        not null,
  address             text        not null default '',
  date_of_birth       date,
  procedure_category  text        not null default '',
  procedure_name      text        not null default '',
  source_page         text        not null default '',
  email_sent          boolean     not null default false,
  created_at          timestamptz not null default now()
);

create index gdpr_registrations_created_idx on gdpr_registrations (created_at desc);
