import { pool, query } from './db.js';
import { hashPassword } from './auth.js';

/* Creates or resets the first administrator, so a fresh deployment has a way
   in. Run once after the first deploy:
     ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin
   Re-running it resets that account's password rather than failing, which is
   also the recovery path if the admin password is ever lost. */

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Choose an admin password of at least 12 characters.');
  process.exit(1);
}

const hash = await hashPassword(password);
const { rows } = await query(
  `insert into accounts (email, password_hash, role, must_change_password)
   values ($1, $2, 'admin', false)
   on conflict (lower(email)) do update
     set password_hash = excluded.password_hash, role = 'admin'
   returning id, email`,
  [email.trim(), hash],
);

console.log(`admin ready: ${rows[0].email}`);
await pool.end();
