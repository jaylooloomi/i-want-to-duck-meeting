/**
 * Local HTTP server that imitates Google Meet's English UI closely enough to integration-test
 * the bot against it (no dependencies, node:http only).
 *
 * Routes:
 * - `GET /<code>` (code = `abc-defg-hij`)  → the mock meeting page (public/meet.html); the page
 *   reads its behaviour from the query string (see public/config.js):
 *   `scenario` (happy|denied|blocked|lobby_timeout|removed|alone|signin|notfound|continue_dialog,
 *   default happy; unknown values → 400), `lobbyMs` (1500), `signedin` (1 → no name input,
 *   CTA "Join now"), `endAfterMs` (2000), `captionStepMs` (timeline time multiplier, 1),
 *   `captionLeadMs` (8000), `maxCallMs` (never), `account` (signed-in display name).
 * - `GET /v3/signin/identifier`             → fake Google sign-in page ("Sign in" heading).
 * - `GET /`                                 → fake Meet home page ("Return to home screen").
 * - `GET /static/<file>`                    → public/<file>; `/static/timeline.js` is ../timeline.js.
 * @module mock-meet/server
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');

/** Every scenario the mock page understands. */
export const SCENARIOS = Object.freeze([
  'happy', 'denied', 'blocked', 'lobby_timeout', 'removed', 'alone', 'signin', 'notfound', 'continue_dialog',
]);

const MEET_PATH = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/;

/** Static files served from outside public/ (shared with the Node tests). */
const STATIC_ALIASES = { 'timeline.js': path.join(HERE, 'timeline.js') };

const PAGES = {
  '/': 'home.html',
  '/v3/signin/identifier': 'signin.html',
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

/**
 * Start the mock Meet server on 127.0.0.1.
 * @param {{ port?: number }} [opts] port 0 (default) picks a free port
 * @returns {Promise<{ origin: string, port: number, urlFor: (code: string, params?: Record<string, unknown>) => string, close: () => Promise<void> }>}
 */
export async function startMockMeet({ port = 0 } = {}) {
  const host = '127.0.0.1';
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', `mock-meet error: ${err.message}\n`);
      else res.destroy(err);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actualPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const origin = `http://${host}:${actualPort}`;

  /** @type {Promise<void> | null} */
  let closing = null;
  return {
    origin,
    port: actualPort,
    /**
     * URL of a mock meeting, e.g. `http://127.0.0.1:PORT/abc-defg-hij?hl=en&scenario=denied`.
     * `hl=en` always comes first (like the bot's normalized URLs); null/undefined params are skipped.
     */
    urlFor(code, params = {}) {
      const url = new URL(`/${code}`, origin);
      url.searchParams.set('hl', 'en');
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
      return url.toString();
    },
    /** Stop listening and drop open (keep-alive) connections. Idempotent. */
    close() {
      closing ??= new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed\n');
  }
  const url = new URL(req.url ?? '/', 'http://mock.invalid');
  const { pathname } = url;

  if (MEET_PATH.test(pathname)) {
    const scenario = url.searchParams.get('scenario');
    if (scenario !== null && !SCENARIOS.includes(scenario)) {
      return send(res, 400, 'text/plain; charset=utf-8', `unknown scenario "${scenario}"; use one of: ${SCENARIOS.join(', ')}\n`);
    }
    return sendFile(res, path.join(PUBLIC_DIR, 'meet.html'));
  }
  if (Object.hasOwn(PAGES, pathname)) return sendFile(res, path.join(PUBLIC_DIR, PAGES[pathname]));
  if (pathname === '/favicon.ico') return send(res, 204, null, null);
  if (pathname.startsWith('/static/')) {
    const file = resolveStatic(pathname.slice('/static/'.length));
    if (file) return sendFile(res, file);
  }
  return notFound(res);
}

/**
 * Map a /static/ sub-path to a file inside public/ (or an alias); null if it escapes.
 * @param {string} encoded
 * @returns {string | null}
 */
function resolveStatic(encoded) {
  let rel;
  try {
    rel = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0') || rel.includes('\\') || rel.split('/').some((seg) => seg === '..' || seg === '.')) {
    return null;
  }
  if (Object.hasOwn(STATIC_ALIASES, rel)) return STATIC_ALIASES[rel];
  const file = path.resolve(PUBLIC_DIR, rel);
  return file.startsWith(PUBLIC_DIR + path.sep) ? file : null;
}

/**
 * @param {http.ServerResponse} res
 * @param {string} file
 */
async function sendFile(res, file) {
  let body;
  try {
    body = await readFile(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') return notFound(res);
    throw err;
  }
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return send(res, 200, type, body);
}

/** @param {http.ServerResponse} res */
function notFound(res) {
  return send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string | null} type
 * @param {string | Buffer | null} body
 */
function send(res, status, type, body) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (type) headers['Content-Type'] = type;
  if (body !== null) headers['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(status, headers);
  res.end(res.req.method === 'HEAD' ? undefined : body ?? undefined);
}
