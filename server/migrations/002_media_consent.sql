-- Separate, optional consent for using a patient's photos/video/testimonials
-- in marketing — distinct from gdpr_accepted (the core, mandatory data-
-- processing acknowledgment already on patients). Nullable on purpose: null
-- means "not asked yet", not "no". Unlike gdpr_accepted this is not
-- one-directional — a patient may change their mind either way.
alter table patients
  add column media_consent    boolean,
  add column media_consent_at timestamptz;
