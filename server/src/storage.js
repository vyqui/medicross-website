import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/* ---------------------------------------------------------------------------
   Document storage.

   Patient documents are health data, so they are never public: the bytes sit
   outside the web root and are only ever served through an authenticated route
   that re-checks ownership on every request.

   This is deliberately a small interface — put, open, remove — so swapping the
   disk driver for Cloudflare R2 later touches this file and nothing else. On
   Railway, STORAGE_DIR must point at a mounted volume; without one the files
   are wiped on every redeploy.
   --------------------------------------------------------------------------- */

const ROOT = path.resolve(process.env.STORAGE_DIR || './var/documents');

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/* What a medical document legitimately arrives as. Anything else is refused
   outright rather than stored and worried about later. */
export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export async function init() {
  await mkdir(ROOT, { recursive: true });
}

/**
 * Writes a buffer and returns its opaque storage key.
 * Keys are namespaced per patient so a stray key can never read across
 * patients, and the filename on disk is a UUID rather than anything the
 * uploader chose.
 */
export async function put(patientId, buffer) {
  const key = `${patientId}/${randomUUID()}`;
  const target = path.join(ROOT, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer, { mode: 0o600 });
  return key;
}

/** Resolves a key to a path, refusing anything that escapes the root. */
function resolveKey(key) {
  const target = path.resolve(ROOT, key);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    throw new Error('Storage key escapes the storage root.');
  }
  return target;
}

export function open(key) {
  return createReadStream(resolveKey(key));
}

export async function exists(key) {
  try {
    await stat(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function remove(key) {
  try {
    await unlink(resolveKey(key));
  } catch (err) {
    /* Already gone is a success for our purposes — the caller wants the file
       not to exist, and it doesn't. */
    if (err.code !== 'ENOENT') throw err;
  }
}
