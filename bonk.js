// bonk: a tiny streak tracker for two people keeping their boundaries.
//
// This file is the app itself: every rule and every API route. It doesn't know
// where the data is kept. Whoever calls handleApi() passes in a storage:
//   server.js                   keeps it in data.json (your own computer, or any host with a disk)
//   netlify/functions/api.mjs   keeps it in Netlify Blobs

import crypto from 'node:crypto';

const SEED_TIERS = [
  { day: 3, reward: 'a kind text, allowed', emoji: '💌' },
  { day: 10, reward: 'coffee together', emoji: '☕' },
  { day: 21, reward: 'a walk together', emoji: '🌳' },
  { day: 35, reward: 'a movie together', emoji: '🎬' },
  { day: 50, reward: 'dinner out', emoji: '🍝' },
  { day: 75, reward: 'a full day together', emoji: '☀️' },
  { day: 100, reward: "sit down and decide what's next", emoji: '🌈' },
];

// The whole state, as one JSON object. It's loaded fresh for every request.
let db;
// Dev mode shows a "Skip to tomorrow" button so you can test streaks.
let DEV = false;

function emptyState() {
  return {
    config: { timezone: 'America/New_York', secret: crypto.randomBytes(32).toString('hex') },
    users: [],
    boundaries: [],
    tiers: SEED_TIERS.map((t) => ({ id: newId(), ...t })),
    checkins: [],
    bonks: [],
    unlocks: [],
    proposals: [],
    log: [],
    failedLogins: {},
  };
}

function newId() {
  return crypto.randomBytes(5).toString('hex');
}
const now = () => new Date().toISOString();

/* ----------------------------------------------------------------- dates */

// "Today" is always decided in the one configured timezone, as YYYY-MM-DD.
function today() {
  const when = Date.now() + (db.devDayOffset || 0) * 86400000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: db.config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(when);
}

/* ---------------------------------------------------------------- streak */

// Dates where both people checked in, oldest first.
function fullDays() {
  const who = {};
  for (const c of db.checkins) (who[c.date] ||= new Set()).add(c.userId);
  return Object.keys(who).filter((d) => who[d].size === 2).sort();
}

// The streak is never stored. It's rebuilt from history every time:
// the latest bonk sets a starting point, and each full day after it adds one.
// A day nobody (or only one person) checked in simply doesn't count. No penalty.
function streak() {
  const days = fullDays();
  const lastBonk = db.bonks.at(-1);
  if (!lastBonk) return days.length;
  return lastBonk.resetTo + days.filter((d) => d > lastBonk.date).length;
}

const sortedTiers = () => [...db.tiers].sort((a, b) => a.day - b.day);
const tierAt = (n) => sortedTiers().filter((t) => t.day <= n).at(-1) || null;
const nextTier = (n) => sortedTiers().find((t) => t.day > n) || null;

// Owning a slip costs you the tier you're on: the streak drops to the start
// of the tier before it. At 25 (past day 21, a walk) that's day 10 (coffee).
// Being called out on a slip always drops it to 0.
function selfReportResetTo(n) {
  const reached = sortedTiers().filter((t) => t.day <= n);
  return reached.length >= 2 ? reached.at(-2).day : 0;
}

// Keep db.unlocks in step with the streak. A tier unlocks when the streak
// reaches it, and is lost again if a bonk drops the streak below it.
function syncUnlocks() {
  const n = streak();
  for (const tier of db.tiers) {
    const active = db.unlocks.find((u) => u.tierId === tier.id && !u.lostAt);
    if (tier.day <= n && !active) {
      db.unlocks.push({
        id: newId(), tierId: tier.id, day: tier.day, reward: tier.reward, emoji: tier.emoji,
        at: now(), date: today(), seenBy: [], redeemed: null, lostAt: null,
      });
      addLog('unlock', null, { day: tier.day, reward: tier.reward, emoji: tier.emoji });
    } else if (tier.day > n && active) {
      active.lostAt = now();
    }
  }
}

function addLog(type, by, fields = {}) {
  db.log.push({ id: newId(), type, by, at: now(), date: today(), ...fields });
}

/* ------------------------------------------------------------------ auth */

// Login cookie is "<userId>.<signature>", signed with a secret kept in the data.
const sign = (userId) => crypto.createHmac('sha256', db.config.secret).update(userId).digest('base64url');
const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');

function userFromCookie(cookieHeader) {
  const match = /(?:^|;\s*)bonk=([^;]+)/.exec(cookieHeader || '');
  if (!match) return null;
  const [userId = '', sig = ''] = decodeURIComponent(match[1]).split('.');
  const expected = sign(userId);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return db.users.find((u) => u.id === userId) || null;
}

const cookie = (value, maxAgeSeconds, https) =>
  `bonk=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${https ? '; Secure' : ''}`;

/* ------------------------------------------------------- what the app sees */

// Everything a logged-in person's phone needs to draw every screen.
function view(me) {
  if (!db.users.length) return { needsSetup: true };
  const users = db.users.map((u) => ({ id: u.id, name: u.name, hasPin: !!u.pinHash }));
  if (!me) return { me: null, users };

  const t = today();
  const n = streak();
  const tierInfo = (u) => db.tiers.find((x) => x.id === u.tierId) || u;

  return {
    me: me.id,
    users,
    today: t,
    timezone: db.config.timezone,
    dev: DEV,
    streak: n,
    tier: tierAt(n),
    next: nextTier(n),
    checkins: Object.fromEntries(db.users.map((u) => [u.id, db.checkins.find((c) => c.date === t && c.userId === u.id) || null])),
    checkinBlocked: checkinBlocker(me),
    pendingBonks: db.bonks.filter((b) => !b.ack),
    proposals: db.proposals.filter((p) => p.status === 'pending'),
    ifBonk: { owned: selfReportResetTo(n), calledOut: 0 },
    boundaries: db.boundaries,
    tiers: sortedTiers().map((tier) => {
      const active = db.unlocks.find((u) => u.tierId === tier.id && !u.lostAt);
      return {
        ...tier,
        status: !active ? 'locked' : active.redeemed ? 'redeemed' : 'unlocked',
        unlockId: active?.id ?? null,
        unlockedOn: active?.date ?? null,
        memories: db.unlocks.filter((u) => u.tierId === tier.id && u.redeemed).map((u) => u.redeemed),
      };
    }),
    // Unlocks this person hasn't celebrated yet.
    celebrate: db.unlocks
      .filter((u) => !u.lostAt && !u.seenBy.includes(me.id))
      .map((u) => ({ id: u.id, day: tierInfo(u).day, reward: tierInfo(u).reward, emoji: tierInfo(u).emoji })),
  };
}

// Returns a reason this person can't check in right now, or null if they can.
function checkinBlocker(me) {
  if (db.checkins.some((c) => c.date === today() && c.userId === me.id)) return "You've checked in today.";
  const open = db.bonks.find((b) => !b.ack);
  if (open) {
    return open.by === me.id
      ? `Check-ins are paused until ${nameOf(otherUser(me).id)} reads your bonk.`
      : 'Check-ins are paused until you read the bonk above.';
  }
  if (db.bonks.some((b) => b.date === today())) return 'Today had a bonk, so it doesn\'t count. Check-ins start again tomorrow.';
  return null;
}

function requireNoOpenBonk() {
  if (db.bonks.some((b) => !b.ack)) fail(400, 'Acknowledge the open bonk first.');
}

const otherUser = (me) => db.users.find((u) => u.id !== me.id);
const nameOf = (id) => db.users.find((u) => u.id === id)?.name ?? 'Someone';

/* ---------------------------------------------------------------- routes */

const routes = [];
function api(method, pattern, handler, { open = false } = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, open });
}

class Oops extends Error {
  constructor(status, message, keep) { super(message); this.status = status; this.keep = keep; }
}
// Stops the request with an error. Any changes made so far are thrown away,
// unless keep is true (used to remember a wrong PIN).
function fail(status, message, { keep = false } = {}) { throw new Oops(status, message, keep); }

function text(value, max, label) {
  const s = String(value ?? '').trim().slice(0, max);
  if (label && !s) fail(400, `${label} can't be empty.`);
  return s;
}

// Handlers that return nothing respond with view(me).
// Whatever a POST changes in db is saved automatically.

api('GET', '/api/state', ({ me }) => view(me), { open: true });

api('POST', '/api/setup', ({ body }) => {
  if (db.users.length) fail(400, 'bonk is already set up.');
  const names = (body.names || []).map((n) => text(n, 24, 'Name'));
  if (names.length !== 2) fail(400, 'bonk is for exactly two people.');
  if (names[0].toLowerCase() === names[1].toLowerCase()) fail(400, 'Use two different names.');
  const timezone = String(body.timezone || '').trim();
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    fail(400, `"${timezone}" isn't a timezone. Try something like America/Chicago.`);
  }
  db.config.timezone = timezone;
  db.users = names.map((name) => ({ id: newId(), name, pinHash: null, salt: null }));
  db.boundaries = (body.boundaries || [])
    .map((b) => text(b, 80)).filter(Boolean)
    .map((title) => ({ id: newId(), title, description: '' }));
  addLog('start', null);
}, { open: true });

api('POST', '/api/login', ({ body, setCookie }) => {
  const user = db.users.find((u) => u.id === body.userId) || fail(404, 'Pick a name first.');
  const pin = String(body.pin || '');
  if (!/^\d{4}$/.test(pin)) fail(400, 'A PIN is 4 digits.');
  const failed = (db.failedLogins ||= {}); // userId -> { count, until }
  const f = failed[user.id];
  if (f && f.until > Date.now()) fail(429, `Too many wrong tries. Wait ${Math.ceil((f.until - Date.now()) / 60000)} min.`);

  if (!user.pinHash) {
    // First login: whatever they type becomes their PIN.
    user.salt = crypto.randomBytes(16).toString('hex');
    user.pinHash = hashPin(pin, user.salt);
  } else if (hashPin(pin, user.salt) !== user.pinHash) {
    const count = (f?.count || 0) + 1;
    failed[user.id] = { count, until: count >= 5 ? Date.now() + 5 * 60000 : 0 };
    fail(401, 'That PIN is wrong.', { keep: true });
  }
  delete failed[user.id];
  setCookie(`${user.id}.${sign(user.id)}`, 400 * 86400);
  return view(user);
}, { open: true });

api('POST', '/api/logout', ({ setCookie }) => {
  setCookie('', 0);
  return view(null);
}, { open: true });

api('POST', '/api/checkin', ({ me, body }) => {
  const blocked = checkinBlocker(me);
  if (blocked) fail(400, blocked);
  const t = today();
  const note = text(body.note, 140);
  db.checkins.push({ id: newId(), userId: me.id, date: t, note, at: now() });
  addLog('checkin', me.id, { note });
  if (db.checkins.filter((c) => c.date === t).length === 2) {
    addLog('day', null, { day: streak() });
    syncUnlocks();
  }
});

api('POST', '/api/unlocks/seen', ({ me, body }) => {
  for (const u of db.unlocks) {
    if ((body.ids || []).includes(u.id) && !u.seenBy.includes(me.id)) u.seenBy.push(me.id);
  }
});

api('POST', '/api/unlocks/:id/redeem', ({ me, body, params }) => {
  const unlock = db.unlocks.find((u) => u.id === params.id) || fail(404, 'That reward is gone.');
  if (unlock.redeemed) fail(400, 'That reward is already redeemed.');
  requireNoOpenBonk();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today();
  const note = text(body.note, 500);
  const tier = db.tiers.find((t) => t.id === unlock.tierId) || unlock;
  unlock.redeemed = { by: me.id, at: now(), date, note, reward: tier.reward };
  addLog('redeem', me.id, { day: tier.day, reward: tier.reward, emoji: tier.emoji, note, memoryDate: date });
});

/* ---- bonks */

api('POST', '/api/bonks', ({ me, body }) => {
  const boundary = db.boundaries.find((b) => b.id === body.boundaryId) || fail(400, 'Pick which boundary this was about.');
  if (!['me', 'them'].includes(body.about)) fail(400, 'Say whether this is about you or them.');
  const reflection = text(body.reflection, 1000, 'The reflection');
  const selfReported = body.about === 'me';
  const before = streak();
  const bonk = {
    id: newId(),
    by: me.id,
    about: selfReported ? me.id : otherUser(me).id,
    selfReported,
    boundaryId: boundary.id,
    boundaryTitle: boundary.title,
    reflection,
    date: today(),
    at: now(),
    streakBefore: before,
    resetTo: selfReported ? selfReportResetTo(before) : 0,
    ack: null,
  };
  db.bonks.push(bonk);
  addLog('bonk', me.id, {
    bonkId: bonk.id, about: bonk.about, selfReported, boundaryTitle: boundary.title,
    reflection, streakBefore: before, resetTo: bonk.resetTo,
  });
  syncUnlocks();
});

api('POST', '/api/bonks/:id/ack', ({ me, body, params }) => {
  const bonk = db.bonks.find((b) => b.id === params.id) || fail(404, 'That bonk is gone.');
  if (bonk.by === me.id) fail(403, `${nameOf(otherUser(me).id)} has to be the one to read and acknowledge this.`);
  if (bonk.ack) fail(400, 'That bonk was already acknowledged.');
  const note = text(body.note, 300);
  bonk.ack = { by: me.id, at: now(), note };
  addLog('bonk_ack', me.id, { bonkId: bonk.id, note, boundaryTitle: bonk.boundaryTitle });
});

/* ---- proposals: nobody changes boundaries or rewards alone */

// Checks a proposed change against the current lists and describes it.
// Runs when it's proposed, and again when it's approved (things may have moved since).
function checkProposal({ target, action, targetId, data = {} }) {
  if (target === 'boundary') {
    const item = action === 'add' ? null : db.boundaries.find((b) => b.id === targetId) || fail(404, 'That boundary no longer exists.');
    if (action === 'add' || action === 'edit') {
      const clean = { title: text(data.title, 80, 'The boundary'), description: text(data.description, 400) };
      if (action === 'edit' && clean.title === item.title && clean.description === item.description) fail(400, 'Nothing was changed.');
      const summary = action === 'add' ? `Add a boundary: “${clean.title}”`
        : clean.title !== item.title ? `Change “${item.title}” to “${clean.title}”`
        : `Change the details of “${item.title}”`;
      return { data: clean, before: item, summary };
    }
    if (action === 'remove') return { data: {}, before: item, summary: `Remove the boundary “${item.title}”` };
    if (action === 'move') {
      const dir = data.dir === 'up' ? 'up' : 'down';
      return { data: { dir }, before: item, summary: `Move “${item.title}” ${dir} the list` };
    }
  }
  if (target === 'tier') {
    const item = action === 'add' ? null : db.tiers.find((t) => t.id === targetId) || fail(404, 'That reward no longer exists.');
    if (action === 'add' || action === 'edit') {
      const day = Number(data.day);
      if (!Number.isInteger(day) || day < 1 || day > 1000) fail(400, 'The day has to be a whole number from 1 to 1000.');
      if (db.tiers.some((t) => t.day === day && t.id !== item?.id)) fail(400, `There's already a reward on day ${day}.`);
      const clean = { day, reward: text(data.reward, 60, 'The reward'), emoji: text(data.emoji, 16) || '🎁' };
      if (action === 'edit' && clean.day === item.day && clean.reward === item.reward && clean.emoji === item.emoji) fail(400, 'Nothing was changed.');
      return {
        data: clean,
        before: item,
        summary: action === 'add' ? `Add a reward on day ${day}: ${clean.reward}`
          : `Change day ${item.day} (${item.reward}) to day ${day}: ${clean.reward}`,
      };
    }
    if (action === 'remove') return { data: {}, before: item, summary: `Remove the day ${item.day} reward: ${item.reward}` };
  }
  fail(400, "That isn't a change bonk knows how to make.");
}

function applyProposal({ target, action, targetId, data }) {
  const list = target === 'boundary' ? db.boundaries : db.tiers;
  const i = list.findIndex((x) => x.id === targetId);
  if (action === 'add') list.push({ id: newId(), ...data });
  if (action === 'edit') Object.assign(list[i], data);
  if (action === 'remove') list.splice(i, 1);
  if (action === 'move') {
    const j = i + (data.dir === 'up' ? -1 : 1);
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  }
}

api('POST', '/api/proposals', ({ me, body }) => {
  requireNoOpenBonk();
  const change = { target: body.target, action: body.action, targetId: body.targetId ?? null, data: body.data };
  const checked = checkProposal(change);
  db.proposals.push({
    id: newId(), by: me.id, at: now(), status: 'pending', reason: text(body.reason, 300),
    ...change, ...checked,
    before: checked.before ? { ...checked.before } : null, // a snapshot, not a live reference
  });
});

api('POST', '/api/proposals/:id/:decision', ({ me, params }) => {
  const p = db.proposals.find((x) => x.id === params.id && x.status === 'pending') || fail(404, 'That proposal was already decided.');
  const { decision } = params;
  if (decision === 'withdraw') {
    if (p.by !== me.id) fail(403, 'Only the person who proposed it can withdraw it.');
    p.status = 'withdrawn';
  } else if (decision === 'approve' || decision === 'reject') {
    if (p.by === me.id) fail(403, `${nameOf(otherUser(me).id)} has to decide on this one.`);
    if (decision === 'approve') {
      requireNoOpenBonk();
      checkProposal(p);
      applyProposal(p);
      syncUnlocks();
      addLog('rule', p.by, { summary: p.summary, action: p.action, target: p.target, before: p.before, data: p.data, reason: p.reason, approvedBy: me.id });
    }
    p.status = decision === 'approve' ? 'approved' : 'rejected';
  } else {
    fail(404, 'Not found.');
  }
  p.decidedBy = me.id;
  p.decidedAt = now();
});

/* ---- timeline */

api('GET', '/api/timeline', () => ({ events: [...db.log].reverse() }));

/* ---- dev only */

api('POST', '/api/dev/next-day', () => {
  if (!DEV) fail(404, 'Not found.');
  db.devDayOffset = (db.devDayOffset || 0) + 1;
});

/* ------------------------------------------------------- handling requests */

function parseBody(raw) {
  if (!raw) return {};
  if (raw.length > 100_000) fail(413, 'That is too much text.');
  let value;
  try { value = JSON.parse(raw); } catch { fail(400, 'Bad JSON.'); }
  return value && typeof value === 'object' ? value : {};
}

// Requests are handled one at a time, so two can never interleave in one process.
let queue = Promise.resolve();

/**
 * Handles one API request.
 *   request: { method, path, cookie, https, body }  (cookie is the raw Cookie header, body the raw text)
 *   storage: { load() -> { data, version }, save(data, version) -> true, or false if someone else saved first }
 * Resolves to { status, body, cookie }, where cookie is a Set-Cookie value or null.
 */
export function handleApi(request, { storage, dev = false }) {
  const run = queue.then(() => handle(request, storage, dev));
  queue = run.catch(() => {});
  return run;
}

async function handle({ method, path, cookie: cookieHeader, https, body: raw }, storage, dev) {
  DEV = dev;
  try {
    let route, match;
    for (const r of routes) {
      match = r.method === method && r.re.exec(path);
      if (match) { route = r; break; }
    }
    if (!route) fail(404, 'Not found.');
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const body = method === 'POST' ? parseBody(raw) : {};

    // Load, change, save. If the other phone saved in between, start over from
    // their version so neither change is lost. (Only matters on Netlify, where
    // two requests can run at the same moment on different machines.)
    for (let attempt = 0; attempt < 5; attempt++) {
      const loaded = await storage.load();
      db = loaded.data ?? emptyState();
      const before = JSON.stringify(db);

      let setCookie = null;
      let status = 200;
      let result;
      try {
        const me = userFromCookie(cookieHeader);
        if (!route.open && !me) fail(401, 'Please log in again.');
        result = route.handler({
          me, body, params,
          setCookie: (value, maxAge) => { setCookie = cookie(value, maxAge, https); },
        }) ?? view(me);
      } catch (err) {
        if (!(err instanceof Oops) || !err.keep) throw err;
        status = err.status;
        result = { error: err.message };
      }

      const changed = method === 'POST' && JSON.stringify(db) !== before;
      if (!changed || await storage.save(db, loaded.version)) return { status, body: result, cookie: setCookie };
    }
    fail(409, 'Someone else was saving at the same moment. Try again.');
  } catch (err) {
    if (err instanceof Oops) return { status: err.status, body: { error: err.message }, cookie: null };
    console.error(err);
    return { status: 500, body: { error: 'Something broke on the server.' }, cookie: null };
  }
}
