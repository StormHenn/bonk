// Runs bonk on your own computer, or any host with a disk: `npm start`.
// All state lives in data.json. The rules themselves are in bonk.js.
// (On Netlify this file isn't used. netlify/functions/api.mjs takes its place.)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './bonk.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(ROOT, 'data.json'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEV = process.env.DEV === '1'; // shows a "Skip to tomorrow" button so you can test streaks

/* ------------------------------------------------------------- data.json */

const storage = {
  async load() {
    try {
      return { data: JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
    } catch (err) {
      if (err.code === 'ENOENT') return { data: null }; // first run
      throw err;
    }
  },

  // Write a temp file, then rename it over data.json. Rename is atomic,
  // so a crash mid-write can never leave a half-written data.json behind.
  async save(data) {
    const tmp = DATA_FILE + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, DATA_FILE);
    return true;
  },
};

/* ---------------------------------------------------------------- server */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) { reject(new Error('too big')); req.destroy(); }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, cookie) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, pathname) {
  const file = path.join(PUBLIC_DIR, path.normalize(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) return serveStatic(res, decodeURIComponent(pathname));

    let body = '';
    if (req.method === 'POST') {
      try { body = await readBody(req); } catch { return sendJson(res, 413, { error: 'That is too much text.' }); }
    }
    const out = await handleApi({
      method: req.method,
      path: pathname,
      cookie: req.headers.cookie,
      https: req.headers['x-forwarded-proto'] === 'https',
      body,
    }, { storage, dev: DEV });
    sendJson(res, out.status, out.body, out.cookie);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) { res.writeHead(400); res.end(); }
  }
}).listen(PORT, () => {
  console.log(`bonk is running on http://localhost:${PORT}`);
  console.log(`data file: ${DATA_FILE}${DEV ? '  (dev mode: "Skip to tomorrow" button is on)' : ''}`);
});
