-- The generated PDF used to exist only for the length of one request — built
-- in memory, emailed, then discarded. Staff had no way to see it again short
-- of digging through the office@ mailbox. Persisting it alongside the row
-- lets the admin console show and download it later, the same way patient-
-- uploaded documents already work (see src/storage.js).
--
-- Nullable: a registration whose PDF failed to save (disk hiccup) still
-- keeps its row and its e-mails; it just has nothing to show in admin.
alter table gdpr_registrations
  add column pdf_storage_key text,
  add column pdf_size_bytes  bigint;
