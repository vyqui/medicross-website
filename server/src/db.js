import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env, or attach a Postgres service in Railway.');
}

/* Railway's managed Postgres terminates TLS with its own certificate chain, so
   verification is relaxed there and there only. Locally there is no TLS at all. */
const needsSsl = /\bsslmode=require\b/.test(process.env.DATABASE_URL)
  || (process.env.NODE_ENV === 'production' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
