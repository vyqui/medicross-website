import { requireAuth } from '../auth.js';
import { query } from '../db.js';
import * as storage from '../storage.js';

/* The only route that serves document bytes.

   Ownership is re-checked on every single request rather than trusted from a
   URL: a patient may read their own files, staff may read any. Nothing is
   served from a public path, and the storage key is never exposed. */
export default async function documentRoutes(app) {
  app.get('/api/documents/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { rows } = await query('select * from documents where id = $1', [request.params.id]);
    const doc = rows[0];

    /* A document belonging to someone else is reported as missing, not as
       forbidden — otherwise the response confirms it exists. */
    if (!doc) return reply.code(404).send({ error: 'Document inexistent.' });
    if (request.session.role !== 'admin' && request.session.patient_id !== doc.patient_id) {
      return reply.code(404).send({ error: 'Document inexistent.' });
    }

    if (!await storage.exists(doc.storage_key)) {
      request.log.error({ documentId: doc.id }, 'document row has no file behind it');
      return reply.code(410).send({ error: 'Fișierul nu mai este disponibil.' });
    }

    /* Only a mime type a browser can safely just display — never Word docs,
       which a browser can't render anyway and would otherwise try to hand off
       to some other application — gets to be inline, and only alongside
       X-Content-Type-Options: nosniff. That header is what actually makes
       this safe: it stops the browser from reinterpreting a mismatched upload
       as HTML no matter what Content-Type or disposition says, so inline
       can't become a way to run a crafted upload in the platform's origin.
       ?download forces the save-as prompt even for a previewable type. */
    const PREVIEWABLE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
    const disposition = (PREVIEWABLE.has(doc.mime) && !request.query.download) ? 'inline' : 'attachment';
    const safeName = doc.name.replace(/["\\]/g, '');
    reply
      .header('Content-Type', doc.mime)
      .header('Content-Length', doc.size_bytes)
      .header('Content-Disposition',
        `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff');

    return reply.send(storage.open(doc.storage_key));
  });
}
