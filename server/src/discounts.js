/* ---------------------------------------------------------------------------
   The sole authority on discount money.

   In the prototype these amounts lived in client-side JavaScript, which meant
   anyone with devtools could award themselves the full €190. Nothing here is
   ever read from the request body: the server recomputes every total from rows
   it owns, and the browser only renders the result.

   The other half of that rule is `verified_at`. A patient pressing "am dat
   follow" writes claimed_at and earns nothing. A member of staff confirming the
   follow actually exists writes verified_at, and only then does it count.
   --------------------------------------------------------------------------- */

export const ACTION_REWARD = Object.freeze({
  instagram: 7.5,
  facebook: 7.5,
  review: 7.5,
  share: 7.5,
});

export const REFERRAL_OPERATED = 70;  // per referred patient who has surgery
export const CODE_USED = 20;          // once, for signing up on someone's code

export const ACTION_KEYS = Object.freeze(Object.keys(ACTION_REWARD));

/** The full social bundle, if every action were verified. */
export const SOCIAL_MAX = Object.values(ACTION_REWARD).reduce((a, b) => a + b, 0);

/**
 * @param {object}   patient    row from `patients`
 * @param {object[]} actions    rows from `discount_actions`
 * @param {object[]} referrals  rows from `referrals`
 */
export function computeDiscount(patient, actions, referrals) {
  const byKey = new Map(actions.map((a) => [a.action_key, a]));
  const lines = [];

  let social = 0;
  for (const key of ACTION_KEYS) {
    const row = byKey.get(key);
    const claimed = Boolean(row);
    const verified = Boolean(row?.verified_at);
    if (verified) social += ACTION_REWARD[key];
    lines.push({
      key,
      kind: 'action',
      eur: ACTION_REWARD[key],
      earned: verified,
      claimed,
      /* Lets the UI show "waiting on us" rather than a silent zero. */
      pendingVerification: claimed && !verified,
    });
  }

  const operated = referrals.filter((r) => r.status === 'operat').length;
  const pending = referrals.filter((r) => r.status === 'inscris').length;
  const referral = operated * REFERRAL_OPERATED;

  lines.push({
    key: 'referral',
    kind: 'referral',
    eur: REFERRAL_OPERATED,
    earned: operated > 0,
    count: operated,
    pending,
  });

  const code = patient.used_code ? CODE_USED : 0;
  lines.push({
    key: 'usedCode',
    kind: 'code',
    eur: CODE_USED,
    earned: Boolean(patient.used_code),
    code: patient.used_code ?? null,
  });

  return {
    lines,
    social,
    socialMax: SOCIAL_MAX,
    referral,
    operated,
    pending,
    code,
    total: social + referral + code,
    /* Everything still on the table: the untaken social bundle, the code, and
       every referral including those not yet operated. */
    potential: SOCIAL_MAX + code + (operated + pending) * REFERRAL_OPERATED,
  };
}
