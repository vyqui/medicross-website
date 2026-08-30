import assert from 'node:assert/strict';

/* End-to-end exercise of the flows that matter: an admin creating a patient
   account, the patient seeing what the admin wrote, the discount rules being
   enforced server-side, and one patient being unable to reach another's data.

   Run against a disposable database:  npm run smoke
*/

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';
const ADMIN = { email: 'admin@medicross.ro', password: 'parola-admin-foarte-lunga' };

let passed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${label}`);
  } catch (err) {
    console.error(`  FAIL ${label}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

/** Minimal cookie jar: keeps the session cookie across calls. */
function makeClient() {
  let cookie = '';
  return async function call(method, url, body, opts = {}) {
    const headers = { ...(cookie ? { cookie } : {}) };
    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + url, { method, headers, body: payload, ...opts });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      if (pair.startsWith('mcx_session=')) cookie = pair;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };
}

const admin = makeClient();
const patient = makeClient();
const other = makeClient();
const anon = makeClient();

console.log('\nauthentication');

const badLogin = await admin('POST', '/api/auth/login',
  { email: ADMIN.email, password: 'wrong' });
check('a wrong password is rejected', () => assert.equal(badLogin.status, 401));

const login = await admin('POST', '/api/auth/login', ADMIN);
check('admin can sign in', () => assert.equal(login.status, 200));
check('the session reports the admin role', () => assert.equal(login.body.role, 'admin'));

const anonMe = await anon('GET', '/api/me');
check('an anonymous request to /api/me is refused', () => assert.equal(anonMe.status, 401));

const anonAdmin = await anon('GET', '/api/admin/patients');
check('an anonymous request to the admin API is refused',
  () => assert.equal(anonAdmin.status, 401));

console.log('\nadmin creates the patient account');

const stamp = Date.now();
const created = await admin('POST', '/api/admin/patients', {
  name: 'Ștefania Popescu',
  email: `stefania.${stamp}@example.ro`,
  phone: '+40 700 111 222',
  sex: 'f',
  password: 'parola-initiala',
  // An admin cannot assert GDPR consent on the patient's behalf — passing it
  // anyway must be silently ignored, checked just below.
  gdprAccepted: true,
});
check('the patient is created', () => assert.equal(created.status, 201));
check('initials are derived from the name', () => assert.equal(created.body.initials, 'ȘP'));
check('diacritics are stripped from the referral code',
  () => assert.match(created.body.referralCode, /^MEDI-STEFANIA-[A-Z2-9]{3}$/));
check('an admin-created account starts with GDPR unaccepted, regardless of what was sent',
  () => assert.equal(created.body.gdprAccepted, false));
check('and no acceptance timestamp exists yet',
  () => assert.equal(created.body.gdprAcceptedAt, null));

const pid = created.body.id;

const duplicate = await admin('POST', '/api/admin/patients', {
  name: 'Altcineva', email: `stefania.${stamp}@example.ro`, password: 'parola-initiala',
});
check('a duplicate e-mail is rejected', () => assert.equal(duplicate.status, 409));

console.log('\nadmin fills in the medical record');

await admin('PATCH', `/api/admin/patients/${pid}`, {
  details: 'Pacientă evaluată pentru Mommy Makeover la Liv Hospital.',
});

const gdprPatchAttempt = await admin('PATCH', `/api/admin/patients/${pid}`,
  { gdprAccepted: true });
check('admin has no way to flip GDPR consent through PATCH either',
  () => assert.equal(gdprPatchAttempt.body.gdprAccepted, false));
const withOp = await admin('PUT', `/api/admin/patients/${pid}/operations`, {
  name: 'Mommy Makeover',
  detail: 'Abdominoplastie + Mamare · Liv Hospital',
  status: 'programata',
  date: '12 Aug 2026',
  regions: 'abdomen,breast',
  active: true,
});
check('the operation is saved', () => assert.equal(withOp.body.operations.length, 1));
check('the operation is the active one',
  () => assert.equal(withOp.body.operations[0].active, true));

await admin('PUT', `/api/admin/patients/${pid}/trip`, {
  title: 'Călătoria mea · Istanbul', subtitle: '11–16 August 2026',
});
await admin('PUT', `/api/admin/patients/${pid}/trip/items`, {
  date: '11 Aug', desc: 'Zbor București→Istanbul', icon: 'plane',
});
const withTrip = await admin('PUT', `/api/admin/patients/${pid}/trip/items`, {
  date: '12 Aug', desc: 'Intervenție', icon: 'plus', surgery: true,
  hospital: 'Liv Hospital Vadistanbul',
});
check('both trip stages are stored', () => assert.equal(withTrip.body.trip.items.length, 2));
check('the trip title is stored',
  () => assert.equal(withTrip.body.trip.title, 'Călătoria mea · Istanbul'));

console.log('\nthe patient signs in and sees it');

const pLogin = await patient('POST', '/api/auth/login',
  { email: `stefania.${stamp}@example.ro`, password: 'parola-initiala' });
check('the patient can sign in', () => assert.equal(pLogin.status, 200));
check('the patient is told to change the issued password',
  () => assert.equal(pLogin.body.mustChangePassword, true));

console.log('\nGDPR consent is the patient\'s own act, not admin\'s');

const beforeAccept = await patient('GET', '/api/me');
check('the freshly created account is unaccepted, exactly as the admin left it',
  () => assert.equal(beforeAccept.body.gdprAccepted, false));

const adminGdprAttempt = await admin('POST', '/api/me/gdpr');
check('an admin session has no patient_id of its own to call this with',
  () => assert.equal(adminGdprAttempt.status, 400));

const accepted = await patient('POST', '/api/me/gdpr');
check('the patient accepting sets it to true', () => assert.equal(accepted.body.gdprAccepted, true));
check('with a timestamp', () => assert.ok(accepted.body.gdprAcceptedAt));

const acceptAgain = await patient('POST', '/api/me/gdpr');
check('accepting a second time is a harmless no-op, not a new timestamp',
  () => assert.equal(acceptAgain.body.gdprAcceptedAt, accepted.body.gdprAcceptedAt));

const me = await patient('GET', '/api/me');
check('the patient sees the admin-written details',
  () => assert.match(me.body.details, /Mommy Makeover la Liv Hospital/));
check('the patient sees their operation',
  () => assert.equal(me.body.operations[0].name, 'Mommy Makeover'));
check('the patient sees the trip agenda', () => assert.equal(me.body.trip.items.length, 2));
check('the activity log is populated', () => assert.ok(me.body.log.length > 0));

const reachAdmin = await patient('GET', '/api/admin/patients');
check('a patient cannot reach the admin API', () => assert.equal(reachAdmin.status, 404));

console.log('\ndiscounts are decided by the server, not the browser');

check('a new patient has no discount', () => assert.equal(me.body.discount.total, 0));

const claimed = await patient('POST', '/api/me/actions/instagram', {});
check('claiming a social action earns nothing on its own',
  () => assert.equal(claimed.body.discount.total, 0));
check('the claim is recorded as awaiting verification', () => {
  const line = claimed.body.discount.lines.find((l) => l.key === 'instagram');
  assert.equal(line.claimed, true);
  assert.equal(line.earned, false);
  assert.equal(line.pendingVerification, true);
});

const verified = await admin('POST', `/api/admin/patients/${pid}/actions/instagram/verify`, {});
check('staff verification awards exactly 7.50 €',
  () => assert.equal(verified.body.discount.total, 7.5));

const unclaimed = await admin('POST', `/api/admin/patients/${pid}/actions/facebook/verify`, {});
check('an action the patient never claimed cannot be verified',
  () => assert.equal(unclaimed.status, 404));

const ref = await admin('POST', `/api/admin/patients/${pid}/referrals`, { name: 'Ioana P.' });
check('a referral pending surgery earns nothing yet',
  () => assert.equal(ref.body.discount.total, 7.5));
check('the pending referral is counted', () => assert.equal(ref.body.discount.pending, 1));

const refId = ref.body.referrals[0].id;
const operated = await admin('PATCH', `/api/admin/patients/${pid}/referrals/${refId}`,
  { status: 'operat' });
check('marking the referral operated awards 70 €',
  () => assert.equal(operated.body.discount.total, 77.5));

console.log('\ndiscount codes');

const second = await admin('POST', '/api/admin/patients', {
  name: 'Maria Ionescu', email: `maria.${stamp}@example.ro`,
  password: 'parola-initiala', sex: 'f',
});
const otherId = second.body.id;

const ownCode = await admin('PUT', `/api/admin/patients/${otherId}/used-code`,
  { code: second.body.referralCode });
check('a patient cannot use their own code', () => assert.equal(ownCode.status, 400));

const missing = await admin('PUT', `/api/admin/patients/${otherId}/used-code`,
  { code: 'MEDI-NIMENI-XYZ' });
check('an unknown code is rejected', () => assert.equal(missing.status, 404));

const usedCode = await admin('PUT', `/api/admin/patients/${otherId}/used-code`,
  { code: created.body.referralCode });
check('using a valid code awards 20 €', () => assert.equal(usedCode.body.discount.total, 20));

const referrerAfter = await admin('GET', `/api/admin/patients/${pid}`);
check('the referrer gains the matching referral', () => {
  const names = referrerAfter.body.referrals.map((r) => r.name);
  assert.ok(names.includes('Maria Ionescu'), `expected Maria in ${JSON.stringify(names)}`);
});

console.log('\none patient cannot reach another');

await other('POST', '/api/auth/login',
  { email: `maria.${stamp}@example.ro`, password: 'parola-initiala' });
const otherMe = await other('GET', '/api/me');
check('the second patient sees only their own record',
  () => assert.equal(otherMe.body.id, otherId));
check('and does not inherit the first patient details',
  () => assert.equal(otherMe.body.operations.length, 0));

const crossRead = await other('GET', `/api/documents/${pid}`);
check('a fabricated document id is reported as missing, not forbidden',
  () => assert.equal(crossRead.status, 404));

console.log('\npassword change');

const weak = await patient('POST', '/api/auth/password', { newPassword: 'scurt' });
check('a short password is rejected', () => assert.equal(weak.status, 400));

const changed = await patient('POST', '/api/auth/password',
  { newPassword: 'o-parola-noua-lunga' });
check('the patient can set a new password', () => assert.equal(changed.status, 200));

const stillWorks = await patient('GET', '/api/me');
check('the current device stays signed in', () => assert.equal(stillWorks.status, 200));

const reLogin = await makeClient()('POST', '/api/auth/login',
  { email: `stefania.${stamp}@example.ro`, password: 'o-parola-noua-lunga' });
check('the new password works', () => assert.equal(reLogin.status, 200));
check('and the change flag is cleared',
  () => assert.equal(reLogin.body.mustChangePassword, false));

console.log('\nlead capture');

const noContact = await anon('POST', '/api/leads', { name: 'Cineva' });
check('a lead with no phone or e-mail is refused',
  () => assert.equal(noContact.status, 400));

const lead = await anon('POST', '/api/leads', {
  name: 'Andrei M.', phone: '+40 733 444 555',
  procedure: 'Rinoplastie', sourcePage: '/rinoplastie',
});
check('a real lead is stored', () => assert.equal(lead.status, 201));

const bot = await anon('POST', '/api/leads', {
  name: 'Bot', phone: '+40 700 000 000', website: 'http://spam.example',
});
check('a honeypot submission is silently accepted', () => assert.equal(bot.status, 200));

const leads = await admin('GET', '/api/admin/leads');
check('the honeypot lead was never stored', () => {
  const names = leads.body.leads.map((l) => l.name);
  assert.ok(names.includes('Andrei M.'), 'real lead missing');
  assert.ok(!names.includes('Bot'), 'honeypot lead was stored');
});

console.log('\nsign out');

await patient('POST', '/api/auth/logout');
const afterLogout = await patient('GET', '/api/me');
check('the session is dead after signing out', () => assert.equal(afterLogout.status, 401));

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}\n`);
