/**
 * Same operator submission must insert once.
 * Immediate POST + later Sync button reuse the same client_submission_id
 * (mobile local row id) and client_submitted_at (original tap time).
 * No 2-minute window — hours later sync still maps to the same row.
 */

function normalizeSubmittedAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString();
}

function pickSubmission(fields) {
  return {
    submissionId: String(
      fields.submissionId || fields.client_submission_id || fields.local_id || ''
    ).trim(),
    submittedAt: normalizeSubmittedAt(
      fields.submittedAt || fields.client_submitted_at || fields.created_at || ''
    )
  };
}

async function findRecentInwardDuplicate(db, fields) {
  const { submissionId, submittedAt } = pickSubmission(fields);
  if (submissionId) {
    const [byId] = await db.query(
      `SELECT inward_id AS id, reference_no
       FROM inward_temp_logs
       WHERE client_submission_id = ?
       LIMIT 1`,
      [submissionId]
    );
    if (byId[0]) return byId[0];
  }
  if (submittedAt && fields.date && fields.vehicle) {
    const [byTime] = await db.query(
      `SELECT inward_id AS id, reference_no
       FROM inward_temp_logs
       WHERE inward_entry_date = ?
         AND TRIM(LOWER(inward_vehicle_no)) = TRIM(LOWER(?))
         AND TRIM(LOWER(IFNULL(operator_email,''))) = TRIM(LOWER(IFNULL(?,'')))
         AND client_submitted_at = ?
       LIMIT 1`,
      [fields.date, String(fields.vehicle).trim(), fields.operator || '', submittedAt]
    );
    if (byTime[0]) return byTime[0];
  }
  return null;
}

async function findRecentOutwardDuplicate(db, fields) {
  const { submissionId, submittedAt } = pickSubmission(fields);
  if (submissionId) {
    const [byId] = await db.query(
      `SELECT outward_id AS id, reference_no
       FROM outward_temp_logs
       WHERE client_submission_id = ?
       LIMIT 1`,
      [submissionId]
    );
    if (byId[0]) return byId[0];
  }
  if (submittedAt && fields.date && fields.vehicle) {
    const [byTime] = await db.query(
      `SELECT outward_id AS id, reference_no
       FROM outward_temp_logs
       WHERE outward_entry_date = ?
         AND TRIM(LOWER(outward_vehicle_no)) = TRIM(LOWER(?))
         AND TRIM(LOWER(IFNULL(operator_email,''))) = TRIM(LOWER(IFNULL(?,'')))
         AND client_submitted_at = ?
       LIMIT 1`,
      [fields.date, String(fields.vehicle).trim(), fields.operator || '', submittedAt]
    );
    if (byTime[0]) return byTime[0];
  }
  return null;
}

module.exports = {
  normalizeSubmittedAt,
  pickSubmission,
  findRecentInwardDuplicate,
  findRecentOutwardDuplicate
};
