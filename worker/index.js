// The site's Worker: dist/ as static assets, plus the one endpoint that keeps
// a learner's study state in D1 so it follows them between devices.
//
//   GET  /api/progress            → { code } with a fresh sync code
//   GET  /api/progress/:code      → { rev, data, updatedAt } or 404
//   PUT  /api/progress/:code      → body { data, baseRev } → { rev, updatedAt }
//                                   or 409 when another device saved first
//
// The site is static, so `run_worker_first` sends /api/* here and leaves
// everything else to the asset server — a page view never costs an invocation.
//
// The code is not a password, it is a private random key: whoever holds it can
// read and write that one record and nothing else. It arrives in an x-sync-code
// header so it stays out of request logs and traces; the path segment still
// works for a link pasted into a browser, or a client from before the header.
//
// The revision is stamped here, never by the device: two phones with wrong
// clocks must not be able to make an old save win. The caller sends the
// revision it read in baseRev, and the upsert only applies while that is still
// the stored one. Nothing here is logged with the code in it, for the reason
// above — the code is the credential.
const API = '/api/progress';
const MAX_BYTES = 512 * 1024;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

// A code is a private random key, not a password. New codes are 12 characters
// from Crockford's base32, which drops I, L, O and U so a code read aloud or
// copied by hand cannot be mistyped for another one. 12 × 5 bits is 60 bits of
// entropy, far beyond guessing, and 256 is a multiple of 32, so the modulo
// below introduces no bias. The client shows a code in three groups of four.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % 32]).join('');
}

// Forgiving on the way in: spaces, dashes and case are dropped, and the
// confusable spellings O, I and L read as 0 and 1.
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
}
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === API || pathname.startsWith(API + '/')) {
      return progress(request, env, pathname);
    }
    if (!env.ASSETS) return new Response('assets not configured', { status: 503 });
    return env.ASSETS.fetch(request);
  },
};

// Null when the URL names no code at all, '' when it names an empty one.
function pathCode(pathname) {
  if (pathname === API) return null;
  return pathname.slice(API.length).replace(/^\/+|\/+$/g, '');
}

async function progress(request, env, pathname) {
  const fromPath = pathCode(pathname);
  if (fromPath === '') return json({ error: 'a sync code is 12 letters and digits' }, 400);

  const fromHeader = request.headers.get('x-sync-code');
  const given = fromHeader || fromPath;
  const code = normalizeCode(given || '');
  // Only a request that named no code at all is asking for a new one; a junk
  // code is a bad request, not a mint.
  const minting = request.method === 'GET' && !given;

  if (request.method !== 'GET' && request.method !== 'PUT') {
    return json({ error: 'method not allowed' }, 405, { allow: 'GET, PUT' });
  }

  const db = env.DB;
  // Without a binding the site still works; the client falls back to the device.
  if (!db) {
    if (minting) return json({ code: null, enabled: false });
    return json({ enabled: false, error: 'progress sync is not configured' }, 503);
  }

  if (minting) return json({ code: newCode(), enabled: true });
  if (!CODE_RE.test(code)) {
    return json({ error: 'a sync code is 12 letters and digits' }, 400);
  }

  try {
    if (request.method === 'GET') {
      const row = await db
        .prepare('SELECT rev, data, updated_at FROM progress WHERE profile = ?')
        .bind(code)
        .first();
      if (!row) return json({ error: 'no progress saved under that code' }, 404);
      let data;
      try {
        data = JSON.parse(row.data);
      } catch {
        // A damaged document is not an outage, and saying so keeps the two apart.
        console.error(
          JSON.stringify({ event: 'progress_unreadable', updated_at: row.updated_at, bytes: row.data.length })
        );
        return json({ error: 'the saved progress could not be read' }, 500);
      }
      return json({ rev: row.rev, data, updatedAt: row.updated_at });
    }

    // Refuse an oversized body before reading it. A chunked upload declares no
    // length, so the same cap is checked again on the bytes that arrived —
    // characters are not bytes, and this content is Polish.
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return json({ error: 'too much to save' }, 413);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
      return json({ error: 'too much to save' }, 413);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }
    if (!body || typeof body.data !== 'object' || body.data === null) {
      return json({ error: 'missing data' }, 400);
    }

    // A caller that read nothing sends no baseRev, and the comparison is then a
    // no-op: that is the one case where a save overwrites blind.
    const base = Number.isInteger(body.baseRev) && body.baseRev >= 0 ? body.baseRev : null;
    const row = await db
      .prepare(
        `INSERT INTO progress (profile, rev, data, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(profile) DO UPDATE SET
           rev = progress.rev + 1,
           data = excluded.data,
           updated_at = excluded.updated_at
         WHERE progress.rev = COALESCE(?, progress.rev)
         RETURNING rev, updated_at`
      )
      // `items` is left out: nothing reads it, so nothing may drift from the
      // document the client owns.
      .bind(code, JSON.stringify(body.data), new Date().toISOString(), base)
      .first();

    if (!row) return json({ error: 'someone else saved first' }, 409);
    return json({ rev: row.rev, updatedAt: row.updated_at });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'progress_failed',
        method: request.method,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return json({ error: 'the database could not be reached' }, 500);
  }
}
