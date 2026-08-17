/** Parse optional GPS / photo metadata from multipart or JSON bodies. */

function parseOptionalFloat(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function parsePhotoCaptureMetadata(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function serializePhotoCaptureMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  try {
    return JSON.stringify(meta);
  } catch {
    return null;
  }
}

module.exports = {
  parseOptionalFloat,
  parsePhotoCaptureMetadata,
  serializePhotoCaptureMetadata,
};
