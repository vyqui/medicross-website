-- ---------------------------------------------------------------------------
-- Initial schema.
--
-- The shapes here are taken directly from seed() in assets/portal-data.js, so
-- the API can return a patient object the existing portal and admin UIs already
-- know how to render.
-- ---------------------------------------------------------------------------

create table patients (
  id             uuid primary key default gen_random_uuid(),
  name           text        not null,
  initials       text        not null,
  email          text,
  phone          text,
  sex            text        not null default 'f' check (sex in ('f', 'm')),

  -- The patient's own code, handed to friends. Unique across the table.
  referral_code  text        not null unique,
  -- Someone else's code this patient signed up with. Deliberately not a foreign
  -- key: the code is validated in the application so that deleting the owner
  -- never rewrites another patient's discount history.
  used_code      text,
  used_code_at   timestamptz,

  gdpr_accepted    boolean     not null default false,
  gdpr_accepted_at timestamptz,

  -- Free text the team writes; shown to the patient in their portal.
  details        text        not null default '',

  -- 3D body map state.
  active_op      text,
  view_mode      text        not null default 'surface'
                 check (view_mode in ('surface', 'internal')),

  trip_title     text        not null default 'Călătoria mea',
  trip_subtitle  text        not null default '',

  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text        not null,
  password_hash text        not null,
  role          text        not null check (role in ('patient', 'admin')),
  patient_id    uuid        references patients (id) on delete cascade,
  -- Accounts the admin creates start with a shared initial password.
  must_change_password boolean not null default false,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,

  -- A patient account must point at a patient; an admin account must not.
  constraint account_patient_link check (
    (role = 'patient' and patient_id is not null) or
    (role = 'admin'   and patient_id is null)
  )
);

-- Case-insensitive uniqueness without requiring the citext extension.
create unique index accounts_email_key on accounts (lower(email));

create table sessions (
  id         uuid        primary key default gen_random_uuid(),
  account_id uuid        not null references accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip         text
);

create index sessions_account_idx on sessions (account_id);
create index sessions_expiry_idx  on sessions (expires_at);

create table operations (
  id         uuid        primary key default gen_random_uuid(),
  patient_id uuid        not null references patients (id) on delete cascade,
  name       text        not null,
  detail     text        not null default '',
  status     text        not null default 'evaluare'
             check (status in ('evaluare', 'programata', 'finalizata')),
  -- Kept as free text because the UI shows "12 Aug 2026" and sometimes a range.
  date_text  text        not null default '',
  regions    text        not null default '',
  view_mode  text        not null default 'surface',
  is_active  boolean     not null default false,
  position   integer     not null default 0
);

create index operations_patient_idx on operations (patient_id, position);

create table trip_items (
  id          uuid    primary key default gen_random_uuid(),
  patient_id  uuid    not null references patients (id) on delete cascade,
  date_text   text    not null default '',
  description text    not null default '',
  icon        text    not null default 'tag',
  is_surgery  boolean not null default false,
  hospital    text    not null default '',
  position    integer not null default 0
);

create index trip_items_patient_idx on trip_items (patient_id, position);

create table documents (
  id          uuid        primary key default gen_random_uuid(),
  patient_id  uuid        not null references patients (id) on delete cascade,
  name        text        not null,
  size_bytes  bigint      not null,
  mime        text        not null default 'application/octet-stream',
  -- Opaque key in the storage backend. The bytes never live in Postgres.
  storage_key text        not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by text        not null default 'pacient'
              check (uploaded_by in ('pacient', 'staff'))
);

create index documents_patient_idx on documents (patient_id, uploaded_at desc);

create table referrals (
  id                  uuid        primary key default gen_random_uuid(),
  -- The patient who made the referral and stands to earn from it.
  patient_id          uuid        not null references patients (id) on delete cascade,
  name                text        not null,
  referred_patient_id uuid        references patients (id) on delete set null,
  status              text        not null default 'inscris'
                      check (status in ('inscris', 'operat', 'anulat')),
  created_at          timestamptz not null default now(),
  operated_at         timestamptz
);

create index referrals_patient_idx on referrals (patient_id);

-- One row per social action a patient has claimed.
--
-- claimed_at is the patient pressing the button; verified_at is a member of
-- staff confirming the follow/review/share actually exists. Only verified_at
-- earns money — see src/discounts.js, which is the sole authority on amounts.
create table discount_actions (
  patient_id  uuid        not null references patients (id) on delete cascade,
  action_key  text        not null check (action_key in
                ('instagram', 'facebook', 'review', 'share')),
  claimed_at  timestamptz not null default now(),
  verified_at timestamptz,
  verified_by text,
  primary key (patient_id, action_key)
);

create table activity_log (
  id         bigserial   primary key,
  patient_id uuid        not null references patients (id) on delete cascade,
  at         timestamptz not null default now(),
  who        text        not null default 'sistem',
  what       text        not null
);

create index activity_log_patient_idx on activity_log (patient_id, at desc);

-- Enquiries from the public contact and hero forms. Until now these opened
-- WhatsApp and were never recorded anywhere.
create table leads (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null default '',
  phone       text        not null default '',
  email       text        not null default '',
  procedure   text        not null default '',
  message     text        not null default '',
  source_page text        not null default '',
  created_at  timestamptz not null default now(),
  status      text        not null default 'nou'
              check (status in ('nou', 'contactat', 'inchis'))
);

create index leads_created_idx on leads (created_at desc);
