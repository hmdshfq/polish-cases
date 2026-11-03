// /api/progress — keeps one person's study state in D1.
//
//   GET  /api/progress            → { code } with a fresh sync code
//   GET  /api/progress/:code      → { rev, data, updatedAt } or 404
//   PUT  /api/progress/:code      → body { data, rev } → { rev, updatedAt }
//
// Last write wins: the code is not a password, it is a private random key.
// Nothing else is stored, and the client keeps a copy on the device, so a
// missing or failing database never costs a runner their progress.
const MAX_BYTES = 512 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

// A code is a private random key, not a password. New codes are 12 characters
// from Crockford's base32, which drops I, L, O and U so a code read aloud or
// copied by hand cannot be mistyped for another one. 12 × 5 bits is 60 bits of
// entropy, far beyond guessing, and 256 is a multiple of 32, so the modulo
// below introduces no bias. The client shows a code in three groups of four.
// Old 32-hex codes keep working; the check below accepts both.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % 32]).join('');
}

// Forgiving on the way in: spaces, dashes and case are dropped, and the
// confusable spellings O, I and L read as 0 and 1. Legacy hex survives in the
// database in lowercase, so a 32-character code keeps its lowercase form.
function normalizeCode(raw) {
  const c = String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  return c.length === 32 ? c.toLowerCase() : c;
}
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$|^[0-9a-f]{32}$/;

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = env.DB;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Without a binding the site still works; the client falls back to the device.
  if (!db) {
    if (request.method === 'GET' && !(Array.isArray(params.code) ? params.code[0] : params.code))
      return json({ code: null, enabled: false });
    return json({ enabled: false, error: 'progress sync is not configured' }, 503);
  }

  // An optional catch-all arrives as an array; take the one segment.
  let code = Array.isArray(params.code) ? params.code[0] : params.code;

  if (request.method === 'GET' && !code) {
    return json({ code: newCode(), enabled: true });
  }

  if (code) {
    code = normalizeCode(code);
    if (!CODE_RE.test(code)) {
      return json({ error: 'a sync code is 12 letters and digits' }, 400);
    }
  }

  try {
    if (request.method === 'GET') {
      const row = await db
        .prepare('SELECT rev, data, updated_at FROM progress WHERE profile = ?')
        .bind(code)
        .first();
      if (!row) return json({ error: 'no progress saved under that code' }, 404);
      return json({ rev: row.rev, data: JSON.parse(row.data), updatedAt: row.updated_at });
    }

    if (request.method === 'PUT') {
      const raw = await request.text();
      if (raw.length > MAX_BYTES) return json({ error: 'too much to save' }, 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: 'body must be JSON' }, 400);
      }
      if (!body || typeof body.data !== 'object' || body.data === null) {
        return json({ error: 'missing data' }, 400);
      }
      const data = JSON.stringify(body.data);
      const items = Object.keys(body.data.items || {}).length;
      const now = new Date().toISOString();
      // The revision is a millisecond stamp from the device, so the newest
      // save wins by wall clock and a late save from an older state loses.
      const rev = Math.max(1, Math.floor(Number(body.rev) || 0));
      await db
        .prepare(
          `INSERT INTO progress (profile, rev, data, items, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(profile) DO UPDATE SET
             rev = excluded.rev,
             data = excluded.data,
             items = excluded.items,
             updated_at = excluded.updated_at
           WHERE excluded.rev >= progress.rev`
        )
        .bind(code, rev, data, items, now)
        .run();

      const row = await db
        .prepare('SELECT rev, updated_at FROM progress WHERE profile = ?')
        .bind(code)
        .first();
      return json({ rev: row ? row.rev : rev, updatedAt: row ? row.updated_at : now });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    return json({ error: 'the database could not be reached', detail: String(err) }, 500);
  }
}
