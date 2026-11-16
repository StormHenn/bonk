// bonk: a tiny streak tracker for two people keeping their boundaries.
//
// This file is the app itself: every rule and every API route. It doesn't know
// where the data is kept. Whoever calls handleApi() passes in a storage:
//   server.js                   keeps it in data.json (your own computer, or any host with a disk)
//   netlify/functions/api.mjs   keeps it in Netlify Blobs

import crypto from 'node:crypto';

// The milestones a new setup starts with. After setup they only change by proposal.
const SEED_TIERS = [
  { day: 10, reward: 'Coffee Club', description: 'One-on-one coffee in a public place', emoji: '☕' },
  { day: 20, reward: 'Lunch Club', description: 'One-on-one lunch', emoji: '🥪' },
  { day: 30, reward: 'Activity Partners', description: 'A planned one-on-one activity', emoji: '🎳' },
  { day: 40, reward: 'Passenger Princess', description: 'A short, pre-planned daytime drive', emoji: '🚗' },
  { day: 50, reward: 'Quality Time', description: 'An extended outing or activity', emoji: '🌿' },
  { day: 60, reward: 'Dinner Club', description: 'Evening dinner together in public', emoji: '🍝' },
  { day: 75, reward: 'Home Ground', description: 'A home visit with a pre-agreed time', emoji: '🏡' },
  { day: 90, reward: 'The Big Conversation', description: 'Talk about compatibility and the future', emoji: '💬' },
];

// Kinds of bonk. Only a crossing resets the streak; the rest are logged so you can talk about them.
const BONK_TYPES = ['crossed', 'near_miss', 'setback', 'misunderstanding'];
const FEELS = ['good', 'unsure', 'space'];

// The whole state, as one JSON object. It's loaded fresh for every request.
let db;
// Dev mode shows a "Skip to tomorrow" button so you can test streaks.
let DEV = false;

function emptyState() {
  return {
    config: { timezone: 'America/New_York', secret: crypto.randomBytes(32).toString('hex'), retroEvery: 7, milestonesV2: true },
    users: [],
    boundaries: [],
    tiers: SEED_TIERS.map((t) => ({ id: newId(), ...t })),
    checkins: [],
    bonks: [],
    unlocks: [],
    proposals: [],
    log: [],
    failedLogins: {},
    pauses: [],
    answers: [],
    truths: [],
    retros: [],
    goods: [],
    best: 0,
  };
}

// Data saved by an older version of bonk gets the newer fields filled in.
// Runs on every load; it changes nothing that's already there.
function migrate() {
  for (const key of ['pauses', 'answers', 'truths', 'retros', 'goods']) db[key] ||= [];
  db.config.retroEvery ||= 7;
  for (const b of db.bonks) b.type ||= 'crossed'; // every bonk before types existed was a crossing
  db.best ??= Math.max(0, ...db.unlocks.map((u) => u.day));

  // Once: an app set up with the first version's default rewards gets the new default
  // milestones, as long as nobody changed that list or redeemed anything from it.
  if (!db.config.milestonesV2) {
    db.config.milestonesV2 = true;
    const tiers = [...db.tiers].sort((a, b) => a.day - b.day);
    const untouched = tiers.length === FIRST_SEED.length && tiers.every((t, i) => t.day === FIRST_SEED[i][0] && t.reward === FIRST_SEED[i][1]);
    if (untouched && !db.unlocks.some((u) => u.redeemed)) {
      db.tiers = SEED_TIERS.map((t) => ({ id: newId(), ...t }));
      db.unlocks = [];
      db.proposals = db.proposals.filter((p) => !(p.target === 'tier' && p.status === 'pending'));
      if (db.users.length) syncUnlocks(); // unlock whatever the current streak has already reached
    }
  }
}

// The default rewards in the first version of bonk, as [day, reward].
const FIRST_SEED = [[3, 'a kind text, allowed'], [10, 'coffee together'], [21, 'a walk together'], [35, 'a movie together'],
  [50, 'dinner out'], [75, 'a full day together'], [100, "sit down and decide what's next"]];

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

// Whole days from a to b, both YYYY-MM-DD.
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const addDays = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const startDate = () => db.log.find((e) => e.type === 'start')?.date ?? today();

/* ---------------------------------------------------------------- streak */

// Dates where both people checked in, oldest first.
function fullDays() {
  const who = {};
  for (const c of db.checkins) (who[c.date] ||= new Set()).add(c.userId);
  return Object.keys(who).filter((d) => who[d].size === 2).sort();
}

// A bonk resets the streak only when it's a crossing that's been owned or agreed.
// (A called-out crossing has no resetTo until the other person agrees.)
const resets = (b) => b.type === 'crossed' && b.resetTo != null;

// The most recent crossing that counted, by date.
function lastCrossing() {
  return db.bonks.filter(resets).reduce((last, b) => (!last || b.date >= last.date ? b : last), null);
}

// The streak is never stored. It's rebuilt from history every time:
// the latest crossing sets a starting point, and each full day after it adds one.
// A day nobody (or only one person) checked in simply doesn't count. No penalty.
function streak() {
  const days = fullDays();
  const last = lastCrossing();
  if (!last) return days.length;
  return last.resetTo + days.filter((d) => d > last.date).length;
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
  db.best = Math.max(db.best || 0, n); // the furthest you've ever got; truth box prompts open by this
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
  const crossing = lastCrossing();
  // A private note only ever goes back to the person who wrote it.
  const checkinFor = (u) => {
    const c = db.checkins.find((x) => x.date === t && x.userId === u.id);
    if (!c) return null;
    const { privateNote, ...shared } = c;
    return u.id === me.id ? c : shared;
  };

  return {
    me: me.id,
    users,
    today: t,
    startDate: startDate(),
    timezone: db.config.timezone,
    dev: DEV,
    streak: n,
    best: Math.max(db.best || 0, n),
    sinceCrossing: { days: diffDays(crossing?.date ?? startDate(), t), ever: !!crossing },
    tier: tierAt(n),
    next: nextTier(n),
    checkins: Object.fromEntries(db.users.map((u) => [u.id, checkinFor(u)])),
    checkinBlocked: checkinBlocker(me),
    pause: activePause(),
    pendingBonks: db.bonks.filter((b) => !b.ack),
    proposals: db.proposals.filter((p) => p.status === 'pending'),
    ifBonk: { owned: selfReportResetTo(n), calledOut: 0 },
    boundaries: db.boundaries,
    retroEvery: db.config.retroEvery,
    question: questionView(me),
    pastQuestions: pastQuestions(me),
    truths: truthsView(me),
    retro: retroView(me),
    goods: [...db.goods].reverse(),
    prompts: { truth: TRUTH_PROMPTS, good: GOOD_PROMPTS, retro: RETRO_PROMPTS },
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

// A called-out crossing that the person it's about hasn't agreed to or disputed yet.
// (Called-out bonks from before this existed already reset, so they have a resetTo.)
const awaitsAnswer = (b) => b.type === 'crossed' && !b.selfReported && !b.ack && b.resetTo == null;

// A crossing nobody has resolved yet: an owned one the other person hasn't read,
// or a called-out one the other person hasn't answered. It pauses check-ins.
const openCrossing = () => db.bonks.find((b) => b.type === 'crossed' && !b.ack);

// Returns a reason this person can't check in right now, or null if they can.
function checkinBlocker(me) {
  if (db.checkins.some((c) => c.date === today() && c.userId === me.id)) return "You've checked in today.";
  const open = openCrossing();
  if (open) {
    const them = nameOf(otherUser(me).id);
    if (!awaitsAnswer(open)) {
      return open.by === me.id ? `Check-ins are paused until ${them} reads your bonk.` : 'Check-ins are paused until you read the bonk above.';
    }
    return open.by === me.id ? `Check-ins are paused until ${them} answers your bonk.` : 'Check-ins are paused until you answer the bonk above.';
  }
  if (db.bonks.some((b) => b.date === today() && resets(b))) return 'Today had a crossing, so it doesn\'t count. Check-ins start again tomorrow.';
  return null;
}

function requireNoOpenBonk() {
  if (openCrossing()) fail(400, 'Answer the open bonk first.');
}

// The space someone asked for, if it's still on. It ends when they say so,
// or by itself the day after the day they said they'd check back in.
function activePause() {
  const p = db.pauses.at(-1);
  if (!p || p.endedAt || (p.until && today() > p.until)) return null;
  return p;
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
  const privateNote = text(body.privateNote, 1000);
  const feel = FEELS.includes(body.feel) ? body.feel : null;
  db.checkins.push({ id: newId(), userId: me.id, date: t, note, feel, privateNote, at: now() });
  addLog('checkin', me.id, { note, feel }); // never the private note: the timeline is shared
  // "I need space" can ask for it right here, with a day to check back in.
  if (feel === 'space' && body.spaceDays !== undefined && !activePause()) startPause(me, body.spaceDays, '');
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

// A bonk is anything that crossed, or nearly crossed, a line. Who logs it and what kind it is
// decide what happens next:
//   you own a crossing        the streak drops a tier now; check-ins pause until they've read it
//   you call out a crossing   nothing resets yet; check-ins pause until they answer (see /respond)
//   near miss, setback, misunderstanding   logged and talked about, never reset
api('POST', '/api/bonks', ({ me, body }) => {
  const type = BONK_TYPES.includes(body.type) ? body.type : fail(400, 'Pick what kind of bonk this is.');
  if (type === 'crossed') requireNoOpenBonk(); // one crossing at a time
  if (!['me', 'them'].includes(body.about)) fail(400, 'Say whether this is about you or them.');
  const boundary = db.boundaries.find((b) => b.id === body.boundaryId) || null;
  if (!boundary && type === 'crossed') fail(400, 'Pick which boundary was crossed.');
  const reflection = text(body.reflection, 1000, 'What happened');
  const selfReported = body.about === 'me';
  const before = streak();
  const bonk = {
    id: newId(),
    type,
    by: me.id,
    about: selfReported ? me.id : otherUser(me).id,
    selfReported,
    boundaryId: boundary?.id ?? null,
    boundaryTitle: boundary?.title ?? '',
    reflection,
    ledUpTo: text(body.ledUpTo, 600),
    felt: text(body.felt, 600),
    nextTime: text(body.nextTime, 600),
    date: today(),
    at: now(),
    streakBefore: before,
    resetTo: type === 'crossed' && selfReported ? selfReportResetTo(before) : null,
    ack: null,
  };
  db.bonks.push(bonk);
  const { id: bonkId, by, at, date, ack, type: kind, ...fields } = bonk;
  addLog('bonk', me.id, { bonkId, kind, ...fields }); // "kind", because a log entry's own "type" is 'bonk'
  syncUnlocks();
});

// The other person reads a bonk: an owned one, or any that isn't a crossing.
api('POST', '/api/bonks/:id/ack', ({ me, body, params }) => {
  const bonk = db.bonks.find((b) => b.id === params.id) || fail(404, 'That bonk is gone.');
  if (bonk.by === me.id) fail(403, `${nameOf(otherUser(me).id)} has to be the one to read and acknowledge this.`);
  if (bonk.ack) fail(400, 'That bonk was already acknowledged.');
  if (awaitsAnswer(bonk)) fail(400, 'This one needs an answer: do you agree it was a crossing?');
  const note = text(body.note, 300);
  bonk.ack = { by: me.id, at: now(), note };
  addLog('bonk_ack', me.id, { bonkId: bonk.id, note, boundaryTitle: bonk.boundaryTitle, kind: bonk.type });
});

// Called out on a crossing, you answer it. Agreeing resets the streak to 0.
// Seeing it differently logs it as a near miss or a misunderstanding, with no reset,
// so a reset is always something you both agreed happened.
api('POST', '/api/bonks/:id/respond', ({ me, body, params }) => {
  const bonk = db.bonks.find((b) => b.id === params.id) || fail(404, 'That bonk is gone.');
  if (!awaitsAnswer(bonk)) fail(400, "That bonk doesn't need an answer.");
  if (bonk.about !== me.id) fail(403, `${nameOf(bonk.about)} has to answer this one.`);
  const note = text(body.note, 500);
  if (body.agree === true) {
    bonk.resetTo = 0;
    bonk.ack = { by: me.id, at: now(), note, agreed: true };
  } else {
    const seenAs = ['near_miss', 'misunderstanding'].includes(body.seenAs) ? body.seenAs : 'misunderstanding';
    if (!note) fail(400, 'Say how you see it, so you can talk it through.');
    bonk.calledAs = bonk.type;
    bonk.type = seenAs;
    bonk.ack = { by: me.id, at: now(), note, agreed: false, seenAs };
  }
  addLog('bonk_ack', me.id, {
    bonkId: bonk.id, note, boundaryTitle: bonk.boundaryTitle, response: bonk.ack.agreed ? 'agreed' : bonk.type,
    streakBefore: bonk.streakBefore, resetTo: bonk.resetTo,
  });
  syncUnlocks();
});

/* ---- space */

const SPACE_DAYS = [0, 1, 3, 7]; // 0: "I'll say when"
function startPause(me, days, note) {
  const d = SPACE_DAYS.includes(Number(days)) ? Number(days) : 0;
  const pause = { id: newId(), by: me.id, from: today(), until: d ? addDays(today(), d) : null, note, at: now(), endedAt: null };
  db.pauses.push(pause);
  addLog('pause_start', me.id, { until: pause.until, note });
}

api('POST', '/api/pause', ({ me, body }) => {
  const on = activePause();
  if (on) fail(400, on.by === me.id ? "You've already asked for space." : `${nameOf(on.by)} already asked for space. It's on for both of you.`);
  startPause(me, body.days, text(body.note, 300));
});

api('POST', '/api/pause/end', ({ me }) => {
  const on = activePause() || fail(400, "There's no space request on right now.");
  if (on.by !== me.id) fail(403, `Only ${nameOf(on.by)} can end it. They asked for the space.`);
  on.endedAt = now();
  addLog('pause_end', me.id);
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
    const item = action === 'add' ? null : db.tiers.find((t) => t.id === targetId) || fail(404, 'That milestone no longer exists.');
    if (action === 'add' || action === 'edit') {
      const day = Number(data.day);
      if (!Number.isInteger(day) || day < 1 || day > 1000) fail(400, 'The day has to be a whole number from 1 to 1000.');
      if (db.tiers.some((t) => t.day === day && t.id !== item?.id)) fail(400, `There's already a milestone on day ${day}.`);
      const clean = {
        day,
        reward: text(data.reward, 60, 'The milestone'),
        description: text(data.description, 120),
        emoji: text(data.emoji, 16) || '🎁',
      };
      if (action === 'edit' && ['day', 'reward', 'description', 'emoji'].every((k) => clean[k] === (item[k] ?? ''))) fail(400, 'Nothing was changed.');
      return {
        data: clean,
        before: item,
        summary: action === 'add' ? `Add a milestone on day ${day}: ${clean.reward}`
          : `Change day ${item.day} (${item.reward}) to day ${day}: ${clean.reward}`,
      };
    }
    if (action === 'remove') return { data: {}, before: item, summary: `Remove the day ${item.day} milestone: ${item.reward}` };
  }
  // How often you do the retro: every week or every two weeks.
  if (target === 'retro' && action === 'edit') {
    const every = Number(data.every) === 14 ? 14 : 7;
    if (every === db.config.retroEvery) fail(400, `The retro is already every ${every === 7 ? 'week' : 'two weeks'}.`);
    return { data: { every }, before: { every: db.config.retroEvery }, summary: `Do the retro every ${every === 7 ? 'week' : 'two weeks'}` };
  }
  fail(400, "That isn't a change bonk knows how to make.");
}

function applyProposal({ target, action, targetId, data }) {
  if (target === 'retro') { db.config.retroEvery = data.every; return; }
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

/* ---- daily question: both answer, and the answers open once you both have */

// One question a day, the same for both of you, in order from the day you started.
function questionOf(date) {
  const i = diffDays(startDate(), date);
  return QUESTIONS[((i % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}

function questionView(me) {
  const t = today();
  const mine = db.answers.find((a) => a.date === t && a.userId === me.id);
  const theirs = db.answers.find((a) => a.date === t && a.userId !== me.id);
  return { date: t, text: questionOf(t), mine: mine?.text ?? null, theirs: mine && theirs ? theirs.text : null, theyAnswered: !!theirs };
}

// Earlier questions you answered. Theirs shows only where they answered too.
function pastQuestions(me) {
  const byDate = {};
  for (const a of db.answers) if (a.date < today()) (byDate[a.date] ||= []).push(a);
  return Object.keys(byDate).sort().reverse().flatMap((date) => {
    const mine = byDate[date].find((a) => a.userId === me.id);
    const theirs = byDate[date].find((a) => a.userId !== me.id);
    return mine ? [{ date, question: mine.question, mine: mine.text, theirs: theirs?.text ?? null }] : [];
  });
}

api('POST', '/api/question', ({ me, body }) => {
  const t = today();
  if (db.answers.some((a) => a.date === t && a.userId === me.id)) fail(400, "You've already answered today's question.");
  const question = questionOf(t);
  db.answers.push({ id: newId(), date: t, userId: me.id, question, text: text(body.text, 1000, 'Your answer'), at: now() });
  const both = db.answers.filter((a) => a.date === t);
  if (both.length === 2) addLog('question', null, { question, answers: Object.fromEntries(both.map((a) => [a.userId, a.text])) });
});

/* ---- truth box: written privately, shared only when its writer chooses */

function truthsView(me) {
  return {
    mine: db.truths.filter((t) => t.by === me.id).reverse(),
    theirs: db.truths.filter((t) => t.by !== me.id && t.sharedAt).reverse(), // never their drafts
  };
}

const myTruth = (me, id) => db.truths.find((t) => t.id === id && t.by === me.id) || fail(404, "That entry isn't there any more.");
function shareTruth(truth) {
  truth.sharedAt = now();
  truth.sharedOn = today(); // the day in your timezone, for showing; sharedAt is UTC
  addLog('truth_shared', truth.by, { prompt: truth.prompt }); // the words stay in the truth box
}

api('POST', '/api/truths', ({ me, body }) => {
  const prompt = TRUTH_PROMPTS.find((p) => p.text === body.prompt) || fail(400, 'Pick a prompt.');
  if (prompt.day > Math.max(db.best || 0, streak())) fail(400, `That prompt opens on day ${prompt.day}.`);
  const truth = { id: newId(), by: me.id, prompt: prompt.text, text: text(body.text, 2000, 'What you wrote'), at: now(), sharedAt: null, read: null };
  db.truths.push(truth);
  if (body.share === 'now') shareTruth(truth);
});

api('POST', '/api/truths/:id/edit', ({ me, body, params }) => {
  const truth = myTruth(me, params.id);
  if (truth.sharedAt) fail(400, "It's already shared, so it can't be changed.");
  truth.text = text(body.text, 2000, 'What you wrote');
});

api('POST', '/api/truths/:id/share', ({ me, params }) => {
  const truth = myTruth(me, params.id);
  if (truth.sharedAt) fail(400, "You've already shared that one.");
  shareTruth(truth);
});

api('POST', '/api/truths/:id/delete', ({ me, params }) => {
  const truth = myTruth(me, params.id);
  if (truth.sharedAt) fail(400, "It's already shared, so it stays.");
  db.truths.splice(db.truths.indexOf(truth), 1);
});

api('POST', '/api/truths/:id/read', ({ me, body, params }) => {
  const truth = db.truths.find((t) => t.id === params.id && t.by !== me.id && t.sharedAt) || fail(404, "That entry isn't there any more.");
  if (truth.read) fail(400, "You've already read that one.");
  truth.read = { at: now(), reply: text(body.reply, 1000) };
  addLog('truth_read', me.id, { prompt: truth.prompt });
});

/* ---- retro: each answers alone; answers open once you've both done it */

// Retros run in blocks of 7 or 14 days, counted from the day you started.
function retroPeriod() {
  const every = db.config.retroEvery;
  const start = addDays(startDate(), Math.floor(diffDays(startDate(), today()) / every) * every);
  return { start, end: addDays(start, every - 1), every };
}

function retroView(me) {
  const p = retroPeriod();
  const of = (period) => db.retros.filter((r) => r.period === period);
  const mine = of(p.start).find((r) => r.userId === me.id);
  const theirs = of(p.start).find((r) => r.userId !== me.id);
  const periods = [...new Set(db.retros.map((r) => r.period))].filter((x) => x !== p.start).sort().reverse();
  const past = periods.flatMap((period) => {
    const m = of(period).find((r) => r.userId === me.id);
    const t = of(period).find((r) => r.userId !== me.id);
    return m ? [{ start: period, end: m.end, mine: m.answers, theirs: t?.answers ?? null }] : [];
  });
  return { ...p, mine: mine?.answers ?? null, theirs: mine && theirs ? theirs.answers : null, theyDone: !!theirs, past };
}

api('POST', '/api/retro', ({ me, body }) => {
  const p = retroPeriod();
  if (db.retros.some((r) => r.period === p.start && r.userId === me.id)) fail(400, "You've already done this retro.");
  const answers = Object.fromEntries(RETRO_PROMPTS.map((q) => [q.key, text(body[q.key], 1000)]));
  if (!Object.values(answers).some(Boolean)) fail(400, 'Answer at least one question.');
  db.retros.push({ id: newId(), userId: me.id, period: p.start, end: p.end, answers, at: now() });
  if (db.retros.filter((r) => r.period === p.start).length === 2) addLog('retro', null, { start: p.start, end: p.end });
});

/* ---- good stuff */

api('POST', '/api/good', ({ me, body }) => {
  const prompt = GOOD_PROMPTS.includes(body.prompt) ? body.prompt : GOOD_PROMPTS[0];
  const good = { id: newId(), by: me.id, prompt, text: text(body.text, 500, 'What happened'), date: today(), at: now() };
  db.goods.push(good);
  addLog('good', me.id, { prompt, text: good.text });
});

/* ---- timeline */

// The timeline is shared, so it never holds private notes. Your own come back to you here.
api('GET', '/api/timeline', ({ me }) => ({
  events: [...db.log].reverse().map((e) => {
    if (e.type !== 'checkin' || e.by !== me.id) return e;
    const c = db.checkins.find((x) => x.userId === me.id && x.date === e.date);
    return c?.privateNote ? { ...e, privateNote: c.privateNote } : e;
  }),
}));

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
      const stored = loaded.data ? JSON.stringify(db) : null;
      migrate();
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

      // Save whatever a POST changed. Also save once when a migration changed saved data,
      // even on a GET, so anything it created (like new ids) stays the same next time.
      const changed = method === 'POST' ? JSON.stringify(db) !== (stored ?? before) : stored !== null && before !== stored;
      if (!changed || await storage.save(db, loaded.version)) return { status, body: result, cookie: setCookie };
    }
    fail(409, 'Someone else was saving at the same moment. Try again.');
  } catch (err) {
    if (err instanceof Oops) return { status: err.status, body: { error: err.message }, cookie: null };
    console.error(err);
    return { status: 500, body: { error: 'Something broke on the server.' }, cookie: null };
  }
}

/* --------------------------------------------------------------- prompts */

// The daily question, in order from the day you started. Some silly, some serious.
const QUESTIONS = [
  "What's something people often misunderstand about you?",
  "What's your biggest irrational fear?",
  "What's something you've always wanted to do but haven't yet?",
  'What makes you feel appreciated?',
  "What's your biggest pet peeve?",
  'What does a perfect Sunday look like for you?',
  "What's one thing you wish you were better at?",
  "What's something you never compromise on?",
  "What's a smell that instantly takes you back somewhere?",
  'What were you like at twelve years old?',
  "What's a hill you're willing to die on?",
  'Which food could you eat every day for a month?',
  "What's the best advice you've ever been given?",
  "What's something you've changed your mind about in the last few years?",
  "What's a small thing that reliably makes your day better?",
  "Who's someone who shaped how you see the world?",
  "What's a skill you'd learn instantly if you could?",
  'What song have you had on repeat lately?',
  'What do you do when you need to recharge?',
  "What's a compliment you still remember?",
  'If you could live anywhere for a year, where would it be?',
  "What's something you're quietly proud of?",
  "What's the most you thing you own?",
  "What's a habit you're trying to build or break?",
  "What's a movie or show you could rewatch forever?",
  "What's your go-to comfort food?",
  'What scares you about getting older, and what excites you?',
  "What's something you believed as a kid that turned out to be wrong?",
  "What's a tradition you'd like to keep or start?",
  "How do you like to be comforted when you're upset?",
  "What's the weirdest job you'd actually enjoy?",
  'What does a good friendship look like to you?',
  "What's a book, podcast or video that changed how you think?",
  "What's something that always makes you laugh?",
  "What's your earliest memory?",
  'When do you feel most like yourself?',
  "What's a risk you're glad you took?",
  "What's something you're looking forward to this month?",
  "What's a place that feels like home to you?",
  'Which three words would your closest friends use to describe you?',
  "What's an unpopular opinion you hold?",
  'What did you want to be when you grew up?',
  "What's something you find really hard to ask for?",
  "What's a lesson you had to learn more than once?",
  'Cats, dogs, or neither? Defend your answer.',
  "What's a guilty pleasure you don't actually feel guilty about?",
  "What's a goal you have for the next year?",
  'How do you usually handle conflict, and how would you like to?',
  "What's the best trip you've ever taken?",
  "What's a small act of kindness you still think about?",
  'What do you wish more people asked you about?',
  'What drains your energy faster than anything else?',
  "What's a mistake that taught you something important?",
  'If you had a free day with no responsibilities, what would you do?',
  'Which season suits you best, and why?',
  "What's something you're curious about right now?",
  "What's the most spontaneous thing you've ever done?",
  "What's a boundary you've set in your life that you're proud of?",
  "What's your relationship with your phone like?",
  'What would your ideal birthday look like?',
  "What's something you're still figuring out?",
  'What does home mean to you?',
  'Are you a morning person, and do you wish you were?',
  "What's something about your family that shaped you?",
  "What's an achievement nobody gave you enough credit for?",
  "What's the best meal you've ever had?",
  'If you wrote a book, what would it be about?',
  'What helps you feel calm when things get chaotic?',
  "What's your most-used emoji, and what does it say about you?",
  "What's something you've forgiven someone for?",
  'What would you do with a surprise extra hour every day?',
  "What's a version of yourself you're working towards?",
  "What's something that made you feel brave?",
  'How do you like to spend a rainy day?',
  "What's a hobby you dropped that you'd like to pick back up?",
  'What does respect look like to you, day to day?',
  "What's something you're grateful for this week?",
  'If you could ask your future self one question, what would it be?',
  "What's a fact you know that most people don't?",
  "What kind of support helps you most when you're struggling?",
  "What's a song that sums up this year so far?",
  "What's the most useful thing you've learned from a job?",
  'What do you value most in the people around you?',
  "What's a dream you've let go of, and how do you feel about it?",
  "What's your perfect amount of plans in a week?",
  "What's something you're really good at that doesn't show on a CV?",
  "What's the kindest thing you've done for yourself lately?",
  'What do you hope people feel after spending time with you?',
  'What would you tell your younger self about relationships of any kind?',
  "What's a moment from the last few weeks you'd want to remember?",
  "What's an everyday thing you think is underrated?",
  "What's something you'd like to understand better about yourself?",
  "What's a question you've been wanting to ask me?",
];

// Truth box prompts. Each opens once your best streak reaches its day, and stays open.
const TRUTH_PROMPTS = [
  { text: 'Something I appreciate about you', day: 0 },
  { text: 'Something I need clarity on', day: 0 },
  { text: "Something I've been holding back", day: 10 },
  { text: 'Something I need you to understand', day: 10 },
  { text: "Something I'm confused about", day: 10 },
  { text: 'Looking back on our first month', day: 30 },
  { text: "Something I'm scared to ask", day: 30 },
  { text: "What I've learned about myself through this", day: 60 },
  { text: "What I'd want to be different between us", day: 60 },
  { text: 'Where I hope we go from here', day: 90 },
  { text: 'What these 90 days meant to me', day: 90 },
];

const GOOD_PROMPTS = [
  'Something I appreciated about you today',
  'Something you did that made me smile',
  'A moment our friendship felt healthy',
  'Something I learned about you',
  'A small win',
];

// {period} and {next} become "this week" / "next week", or the two-week versions.
const RETRO_PROMPTS = [
  { key: 'worked', text: 'What worked well {period}?' },
  { key: 'didnt', text: "What didn't work?" },
  { key: 'respected', text: 'Did I feel respected?' },
  { key: 'change', text: 'What would I like to change {next}?' },
  { key: 'proud', text: 'What am I proud of?' },
];
