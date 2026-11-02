const SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'apikey',
  'api_key',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'refreshtoken',
  'refreshtokenhash',
  'privatekey',
]);

function isSecretKey(key: string) {
  const k = key.toLowerCase().replace(/[-_]/g, '');
  return (
    SECRET_KEYS.has(k) ||
    k.includes('password') ||
    k.includes('apikey') ||
    k.includes('authorization') ||
    k.includes('cookie') ||
    k.endsWith('secret') ||
    k.endsWith('privatekey') ||
    k.endsWith('tokenhash') ||
    k.endsWith('token')
  );
}

export function sanitizeForAudit(value: any, depth = 0): any {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForAudit(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 4000) {
    return value.slice(0, 4000) + '...[TRUNCATED]';
  }
  return value;
}

export function truncateJson(value: any, maxBytes = 64 * 1024): any {
  try {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return value;
    return { truncated: true, preview: text.slice(0, Math.floor(maxBytes / 2)) };
  } catch {
    return { truncated: true, note: 'unserializable' };
  }
}
