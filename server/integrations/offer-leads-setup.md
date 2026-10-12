# Offer lead delivery

The two offer forms POST to `/api/offer-leads` on the platform. A transaction
saves the lead plus three delivery jobs before acknowledging the submission.
The worker retries failed deliveries independently, up to once per hour.
Google Sheets deduplicates by lead UUID. Resend uses a stable idempotency key
(subject to the provider's retention period). SMTP cannot guarantee exactly-once delivery.

Destinations: `victorgeorgescu22@gmail.com`, `office@tratamente-turcia.ro`,
and the `Cereri site` tab in the user-supplied Google Sheet.

## Activation

1. Restrict the Sheet's sharing to the intended staff before collecting personal data.
2. Install `offer-leads.gs` in its bound Apps Script project.
3. Generate a random secret (at least 32 characters). Store it as
   `OFFER_SHEET_WEBHOOK_TOKEN` in Apps Script's Script Properties and in
   the platform Railway environment. Never commit it or send it to the browser.
4. Deploy the script as a Web App, executing as the owner. Authorize its
   spreadsheet access. Set endpoint access to Anyone; the script rejects all
   requests lacking the secret and does not expose sheet data.
5. Set `OFFER_SHEET_WEBHOOK_URL` on Railway to its `/exec` URL. Keep the existing
   Resend configuration. Deploy the backend before enabling the updated forms.
6. Submit one clearly labeled synthetic test through each offer form. Verify
   the database, sheet rows and both mailboxes. No real patient data is needed.

Missing sheet configuration leaves jobs pending rather than dropping them.
Monitor `offer_lead_deliveries` for `delivered_at is null`. The API success
message means the lead has been saved, not that an email has been read.

## Validation

Run `node --test server/test/offer-leads.test.js`. Perform a staging database
test for transaction rollback, concurrent retries, worker restart recovery and
duplicate request IDs before merging. Schema migrations run at server boot.
