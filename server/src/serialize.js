import { computeDiscount, ACTION_KEYS, ACTION_REWARD } from './discounts.js';

/* ---------------------------------------------------------------------------
   Assembles the patient object in exactly the shape seed() produced in
   assets/portal-data.js.

   This is what makes the frontend migration cheap: portal.js and admin.js
   already know how to render this object, so if the API hands back the same
   structure, neither file has to change at all.
   --------------------------------------------------------------------------- */

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function serializePatient({ patient, operations, tripItems, documents, referrals, actions, log }) {
  const byKey = new Map(actions.map((a) => [a.action_key, a]));

  const actionMap = {};
  for (const key of ACTION_KEYS) {
    const row = byKey.get(key);
    actionMap[key] = {
      done: Boolean(row),
      /* Only staff confirmation earns the money; the UI shows the difference. */
      verified: Boolean(row?.verified_at),
      consent: false,
      needsConsent: false,
      eur: ACTION_REWARD[key],
    };
  }

  return {
    id: patient.id,
    name: patient.name,
    initials: patient.initials,
    email: patient.email,
    phone: patient.phone,
    sex: patient.sex,

    referralCode: patient.referral_code,
    usedCode: patient.used_code
      ? { code: patient.used_code, at: iso(patient.used_code_at) }
      : null,

    gdprAccepted: patient.gdpr_accepted,
    gdprAcceptedAt: iso(patient.gdpr_accepted_at),

    details: patient.details,
    activeOp: patient.active_op,
    mode: patient.view_mode,

    actions: actionMap,

    operations: operations.map((o) => ({
      id: o.id,
      name: o.name,
      detail: o.detail,
      status: o.status,
      date: o.date_text,
      regions: o.regions,
      viewMode: o.view_mode,
      active: o.is_active,
    })),

    trip: {
      title: patient.trip_title,
      subtitle: patient.trip_subtitle,
      items: tripItems.map((t) => ({
        id: t.id,
        date: t.date_text,
        desc: t.description,
        icon: t.icon,
        surgery: t.is_surgery,
        hospital: t.hospital,
      })),
    },

    documents: documents.map((d) => ({
      id: d.id,
      name: d.name,
      size: Number(d.size_bytes),
      type: d.mime,
      uploadedAt: iso(d.uploaded_at),
      by: d.uploaded_by,
      /* Replaces the prototype's inline base64 dataUrl. The bytes are fetched
         on demand from an authenticated route, so nothing sensitive sits in the
         JSON payload or in the browser's memory until it is asked for. */
      url: `/api/documents/${d.id}`,
    })),

    referrals: referrals.map((r) => ({
      id: r.id,
      name: r.name,
      patientId: r.referred_patient_id,
      status: r.status,
      at: iso(r.created_at),
      operatedAt: iso(r.operated_at),
    })),

    log: log.map((l) => ({ t: iso(l.at), who: l.who, what: l.what })),

    discount: computeDiscount(patient, actions, referrals),
  };
}

/** The compact row the admin console's patient list renders. */
export function serializePatientSummary(patient, discountTotal) {
  return {
    id: patient.id,
    name: patient.name,
    initials: patient.initials,
    email: patient.email,
    phone: patient.phone,
    sex: patient.sex,
    referralCode: patient.referral_code,
    gdprAccepted: patient.gdpr_accepted,
    discountTotal,
  };
}
