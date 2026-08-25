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

    /* Content-Disposition is always attachment: it stops a crafted upload from
       being rendered as HTML in the context of the platform's own origin. */
    const safeName = doc.name.replace(/["\\]/g, '');
    reply
      .header('Content-Type', doc.mime)
      .header('Content-Length', doc.size_bytes)
      .header('Content-Disposition',
        `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff');

    return reply.send(storage.open(doc.storage_key));
  });
}
