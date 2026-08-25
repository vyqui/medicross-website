import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, transaction } from './db.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');

/* Applied migrations are recorded by filename, so re-running is a no-op. This
   runs automatically on boot, which means a Railway deploy needs no separate
   release command. */
export async function migrate({ log = console } = {}) {
  await pool.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query('select filename from schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const filename of files) {
    if (applied.has(filename)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    await transaction(async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [filename]);
    });
    /* Fastify's logger exposes .info, plain console exposes .log. Bind once
       rather than calling both — console.info returns undefined, so a `??`
       chain here logs the line twice. */
    const write = typeof log.info === 'function' ? log.info.bind(log) : log.log.bind(log);
    write(`migrated ${filename}`);
    count += 1;
  }
  return count;
}

/* `npm run migrate` runs this file directly. */
if (process.argv[1] === import.meta.filename) {
  const n = await migrate();
  console.log(n === 0 ? 'schema already up to date' : `applied ${n} migration(s)`);
  await pool.end();
}
