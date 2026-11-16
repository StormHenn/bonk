'use strict';
// bonk: the whole front end. Plain JS, no build step.
// Each screen is a function that returns an HTML string built from `S`,
// the state object the server sends back after every action.

const app = document.getElementById('app');
let S = null;                                   // latest state from the server
const drafts = {};                              // text typed into inputs, kept across re-renders
const pin = { user: null, digits: '', first: null };
let celebrating = false;

/* ============================================================== helpers */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const userById = (id) => S.users.find((u) => u.id === id);
const nameOf = (id) => userById(id)?.name ?? 'Someone';
const partner = () => S.users.find((u) => u.id !== S.me);
const hue = (id) => (S.users[0]?.id === id ? 'peach' : 'lilac');
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
const buzz = (pattern = 8) => navigator.vibrate?.(pattern);

function prettyDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

async function call(path, body) {
  const opts = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// POST an action, store the fresh state, redraw. Returns true on success.
async function act(path, body = {}) {
  try {
    S = await call(path, body);
    timeline = null; // something happened, so the timeline needs a fresh copy
    render();
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

/* =============================================================== mascot */

// bonk the mochi. Moods are CSS classes: '', 'hop', 'happy', 'bonked'.
function mascot(mood = '') {
  return `<svg class="mascot ${mood}" viewBox="0 0 120 120" aria-hidden="true">
    <ellipse class="m-shadow" cx="60" cy="108" rx="36" ry="5"/>
    <g class="m-body">
      <circle class="m-bump" cx="77" cy="33" r="11"/>
      <path class="m-blob" d="M60 30C86 30 102 52 102 76C102 96 85 104 60 104C35 104 18 96 18 76C18 52 34 30 60 30Z"/>
      <ellipse class="m-shine" cx="40" cy="50" rx="9" ry="5" transform="rotate(-35 40 50)"/>
      <g class="m-eyes">
        <ellipse cx="47" cy="70" rx="4.5" ry="5.5"/><ellipse cx="73" cy="70" rx="4.5" ry="5.5"/>
        <circle class="m-glint" cx="48.6" cy="67.8" r="1.6"/><circle class="m-glint" cx="74.6" cy="67.8" r="1.6"/>
      </g>
      <g class="m-line m-eyes-happy"><path d="M41 72q6-8 12 0"/><path d="M67 72q6-8 12 0"/></g>
      <g class="m-line m-eyes-ouch"><path d="M42 65l9 5-9 5"/><path d="M78 65l-9 5 9 5"/></g>
      <ellipse class="m-cheek" cx="35" cy="80" rx="7" ry="4"/><ellipse class="m-cheek" cx="85" cy="80" rx="7" ry="4"/>
      <path class="m-line m-mouth" d="M54 80q6 6 12 0"/>
      <path class="m-line m-mouth-ouch" d="M52 85q4-4 8 0t8 0"/>
    </g>
    <g class="m-stars">
      <g transform="translate(36 18)"><path d="${STAR}"/></g>
      <g transform="translate(60 8)"><path d="${STAR}"/></g>
      <g transform="translate(86 20)"><path d="${STAR}"/></g>
    </g>
  </svg>`;
}
const STAR = 'M0-7L1.9-1.9 7 0 1.9 1.9 0 7-1.9 1.9-7 0-1.9-1.9Z';

// Plays the one-shot animation on a mascot (e.g. 'bonk-hit', 'hop'), then cleans up.
function playMascot(el, cls, ms = 1400) {
  if (!el) return;
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // restart the animation if it's already there
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/* ================================================================ render */

const TABS = [
  ['home', '🏡', 'Home'],
  ['boundaries', '🤝', 'Boundaries'],
  ['rewards', '🗺️', 'Rewards'],
  ['timeline', '📖', 'Timeline'],
];
const SCREENS = { home: homeScreen, boundaries: boundariesScreen, rewards: rewardsScreen, timeline: timelineScreen };

function currentTab() {
  const tab = location.hash.slice(1);
  return SCREENS[tab] ? tab : 'home';
}

function render() {
  if (!S) return;
  if (S.needsSetup) app.innerHTML = setupScreen();
  else if (!S.me) app.innerHTML = loginScreen();
  else {
    const tab = currentTab();
    app.innerHTML = `${header()}<main class="screen screen-${tab}">${SCREENS[tab]()}</main>${tabbar(tab)}`;
    winceAtNewBonks();
    celebrate();
  }
}

function header() {
  const me = userById(S.me);
  return `<header class="top">
    <a class="brand" href="#home">${mascot()}<span>bonk</span></a>
    <div class="top-right">
      ${S.dev ? `<button class="chip dev" data-action="devNextDay" title="Dev mode only">Skip to tomorrow</button>` : ''}
      <button class="avatar ${hue(me.id)}" data-action="openAccount" aria-label="Account">${esc(me.name[0])}</button>
    </div>
  </header>`;
}

function tabbar(active) {
  return `<nav class="tabbar">${TABS.map(([id, icon, label]) => `
    <a class="tab ${id === active ? 'on' : ''}" href="#${id}" ${id === active ? 'aria-current="page"' : ''}>
      <span class="ico">${icon}</span>${label}
    </a>`).join('')}</nav>`;
}

/* ================================================================= setup */

function setupScreen() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `<div class="solo">
    ${mascot('hop')}
    <h1 class="wordmark">bonk</h1>
    <p class="lead">Set this up together, on one phone. You only do it once.</p>
    <form class="card stack" data-submit="setup">
      <label>Your two names
        <span class="pair-inputs">
          <input name="a" required maxlength="24" placeholder="First name" autocomplete="off">
          <input name="b" required maxlength="24" placeholder="Second name" autocomplete="off">
        </span>
      </label>
      <label>Timezone
        <small>A new day starts at midnight here, for both of you.</small>
        <input name="tz" required value="${esc(tz)}" autocomplete="off">
      </label>
      <label>The boundaries you've agreed on
        <small>One per line. Later, any change needs both of you to say yes.</small>
        <textarea name="boundaries" rows="4" placeholder="No contact after 10pm&#10;Ask before dropping by"></textarea>
      </label>
      <button class="btn butter big">Start our streak</button>
    </form>
  </div>`;
}

/* ================================================================= login */

function loginScreen() {
  if (pin.user) return pinScreen();
  return `<div class="solo login">
    ${mascot()}
    <h1 class="wordmark">bonk</h1>
    <p class="lead">Who's checking in?</p>
    <div class="who">${S.users.map((u) => `
      <button class="who-btn" data-action="pickUser" data-id="${u.id}">
        <span class="avatar xl ${hue(u.id)}">${esc(u.name[0])}</span>
        <span>${esc(u.name)}</span>
      </button>`).join('')}
    </div>
  </div>`;
}

function pinScreen() {
  const u = userById(pin.user);
  const prompt = u.hasPin ? 'Enter your PIN'
    : pin.first === null ? 'Choose a 4-digit PIN' : 'Type it again to confirm';
  const key = (k) => `<button class="key" data-action="pinKey" data-key="${k}">${k}</button>`;
  return `<div class="solo pin">
    <span class="avatar xl ${hue(u.id)}">${esc(u.name[0])}</span>
    <h1 class="title">Hi, ${esc(u.name)}</h1>
    <p class="lead">${prompt}</p>
    <div class="dots" aria-live="polite">${[0, 1, 2, 3].map((i) => `<span class="${i < pin.digits.length ? 'on' : ''}"></span>`).join('')}</div>
    <div class="keypad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key).join('')}
      <button class="key soft" data-action="pinCancel">Not me</button>
      ${key('0')}
      <button class="key soft" data-action="pinKey" data-key="back" aria-label="Delete">⌫</button>
    </div>
  </div>`;
}

function drawDots() {
  document.querySelectorAll('.dots span').forEach((dot, i) => dot.classList.toggle('on', i < pin.digits.length));
}

async function pressPin(key) {
  buzz();
  if (key === 'back') pin.digits = pin.digits.slice(0, -1);
  else if (pin.digits.length < 4) pin.digits += key;
  drawDots();
  if (pin.digits.length < 4) return;

  const u = userById(pin.user);
  if (!u.hasPin && pin.first === null) {          // first time: ask for it twice
    pin.first = pin.digits;
    pin.digits = '';
    return setTimeout(render, 180);
  }
  if (!u.hasPin && pin.first !== pin.digits) {
    pin.first = null;
    return wrongPin("Those didn't match. Choose your PIN again.");
  }
  try {
    S = await call('/api/login', { userId: pin.user, pin: pin.digits });
    Object.assign(pin, { user: null, digits: '', first: null });
    location.hash = 'home';
    render();
  } catch (err) {
    wrongPin(err.message);
  }
}

function wrongPin(message) {
  buzz([30, 40, 30]);
  toast(message);
  pin.digits = '';
  document.querySelector('.dots')?.classList.add('shake');
  setTimeout(render, 450);
}

/* ================================================================== home */

function homeScreen() {
  const n = S.streak;
  const from = S.tier?.day ?? 0;
  const pct = S.next ? Math.round(((n - from) / (S.next.day - from)) * 100) : 100;
  const bonksForMe = S.pendingBonks.filter((b) => b.by !== S.me);
  const bonksByMe = S.pendingBonks.filter((b) => b.by === S.me);
  const proposalsForMe = S.proposals.filter((p) => p.by !== S.me);
  const proposalsByMe = S.proposals.filter((p) => p.by === S.me);
  // The number pops when it grows and drops with a thud when a bonk sends it back.
  const change = lastStreak === null ? '' : n > lastStreak ? 'up' : n < lastStreak ? 'down' : '';
  lastStreak = n;
  return `
    ${bonksForMe.map(bonkCard).join('')}
    ${bonksByMe.map(bonkWaitingCard).join('')}
    ${proposalsForMe.length ? `<section class="stack-sm"><h2 class="section-title">Waiting on your yes or no</h2>${proposalsForMe.map(proposalCard).join('')}</section>` : ''}

    <section class="hero">
      ${mascot(heroMood())}
      <div class="count ${change}">${n}</div>
      <p class="count-label">${n === 1 ? 'day' : 'days'} of holding the line, together</p>
      ${S.tier ? `<p class="tier-now">Unlocked so far: ${S.tier.emoji} ${esc(S.tier.reward)}</p>` : ''}
    </section>

    <section class="card next">
      ${S.next ? `
        <div class="next-row">
          <span class="next-emoji">${S.next.emoji}</span>
          <div>
            <small>Next up, on day ${S.next.day}</small>
            <b>${esc(S.next.reward)}</b>
          </div>
          <span class="to-go">${days(S.next.day - n)}<br>to go</span>
        </div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      ` : `<p class="all-done">Every reward on the ladder is unlocked. 🌈</p>`}
    </section>

    <section class="card today">
      <div class="card-head">
        <h2>Today</h2>
        <small>${prettyDate(S.today)}</small>
      </div>
      <div class="people">${S.users.map(personStatus).join('')}</div>
      ${checkinBox()}
    </section>

    ${proposalsByMe.length ? `<section class="stack-sm"><h2 class="section-title">Waiting on ${esc(partner().name)}</h2>${proposalsByMe.map(proposalCard).join('')}</section>` : ''}

    ${rulesCard()}`;
}

function heroMood() {
  if (S.pendingBonks.length) return 'bonked';
  if (justCheckedIn) return 'hop';
  return '';
}

// The bonk rule, in plain words, with today's real numbers.
function rulesCard() {
  const { owned } = S.ifBonk;
  const savesFrom = S.tiers[1]?.day;
  return `<section class="rules">
    <h2>If someone slips</h2>
    <div class="rule"><span class="rule-tag own">Owning it</span><span>back to <b>day ${owned}</b></span></div>
    <div class="rule"><span class="rule-tag caught">Being called out</span><span>back to <b>day 0</b></span></div>
    <p class="rule-note">${owned === 0 && savesFrom
      ? `Right now both land on day 0. From day ${savesFrom} on, owning a slip always costs less.`
      : 'Honesty is always the cheaper option.'}</p>
    <div class="rule-actions">
      <button class="btn soft small" data-action="openBonk">🔨 Log a bonk</button>
      <button class="link" data-action="openHowItWorks">How the streak works</button>
    </div>
  </section>`;
}

/* =========================================================== bonk cards */

function bonkCard(b) {
  const who = nameOf(b.by);
  return `<section class="card bonk-card" data-id="${b.id}">
    <div class="bonk-head">
      ${mascot('bonked')}
      <div>
        <h2>${b.selfReported ? `${esc(who)} owned up to a slip` : `${esc(who)} raised a worry about you`}</h2>
        <small>${esc(b.boundaryTitle)}</small>
      </div>
    </div>
    <blockquote>${esc(b.reflection)}</blockquote>
    <p class="bonk-effect">The streak went from ${b.streakBefore} to <b>${b.resetTo}</b>. Read it, then let ${esc(who)} know you have.</p>
    <form class="stack-sm" data-submit="ack" data-id="${b.id}">
      <input name="note" maxlength="300" placeholder="Say something back (optional)" autocomplete="off">
      <button class="btn tomato big">I've read it</button>
    </form>
  </section>`;
}

function bonkWaitingCard(b) {
  return `<section class="card bonk-card waiting">
    <div class="bonk-head">
      ${mascot('bonked')}
      <div>
        <h2>Waiting for ${esc(partner().name)} to read your bonk</h2>
        <small>${esc(b.boundaryTitle)}</small>
      </div>
    </div>
    <blockquote>${esc(b.reflection)}</blockquote>
    <p class="bonk-effect">The streak went from ${b.streakBefore} to <b>${b.resetTo}</b>. Check-ins pause until ${esc(partner().name)} has read it.</p>
  </section>`;
}

function openBonk() {
  if (!S.boundaries.length) {
    return openSheet(`<h2 class="title">Log a bonk</h2>
      <p class="lead">A bonk is tied to one of your boundaries, and you don't have any yet. Propose one on the Boundaries tab first.</p>`);
  }
  const p = partner();
  openSheet(`
    <h2 class="title">Log a bonk</h2>
    <p class="lead">Slips happen. Saying so is always the cheaper option.</p>
    <form class="stack" data-submit="bonk">
      <div class="choices" role="radiogroup" aria-label="Who is this about?">
        <label class="choice">
          <input type="radio" name="about" value="me" required>
          <span><b>I slipped</b><small>Owning it: the streak goes from ${S.streak} back to day ${S.ifBonk.owned}</small></span>
        </label>
        <label class="choice">
          <input type="radio" name="about" value="them">
          <span><b>I'm worried about something ${esc(p.name)} did</b><small>Called out: the streak goes from ${S.streak} back to day 0</small></span>
        </label>
      </div>
      <label>Which boundary?
        <select name="boundaryId" required>
          <option value="">Choose one</option>
          ${S.boundaries.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}
        </select>
      </label>
      <label>Your reflection
        <small>What happened, how you feel about it, and what would help next time.</small>
        <textarea name="reflection" rows="4" maxlength="1000" required></textarea>
      </label>
      <p class="fine">${esc(p.name)} has to read it before check-ins start again, and today won't count.</p>
      <button class="btn tomato big">Log the bonk</button>
    </form>`);
}

function openHowItWorks() {
  openSheet(`
    <h2 class="title">How the streak works</h2>
    <ul class="how">
      <li><b>A day counts when you both tap “I held the line.”</b> Days roll over at midnight in ${esc(S.timezone)}.</li>
      <li><b>Missed a check-in?</b> That day just doesn't count. Nothing resets.</li>
      <li><b>Owning a slip</b> costs the reward tier you're on: the streak drops to the start of the tier before it. Right now that's day ${S.ifBonk.owned}.</li>
      <li><b>Being called out on a slip</b> drops the streak to day 0.</li>
      <li><b>After any bonk,</b> the other person reads it before check-ins start again, and the day of the bonk doesn't count.</li>
      <li><b>Rewards</b> unlock when the streak reaches them, and lock again if a bonk drops it below them. Memories you saved stay forever.</li>
      <li><b>Boundaries and rewards</b> only change when one of you proposes it and the other says yes.</li>
    </ul>`);
}

/* ============================================================ proposals */

function proposalCard(p) {
  const mine = p.by === S.me;
  return `<div class="card proposal">
    <small>${mine ? 'You proposed' : `${esc(nameOf(p.by))} proposed`}</small>
    <b class="proposal-title">${esc(p.summary)}</b>
    ${proposalDetail(p)}
    ${p.reason ? `<p class="reason">“${esc(p.reason)}”</p>` : ''}
    ${mine
      ? `<div class="proposal-actions"><span class="fine">Waiting for ${esc(partner().name)}</span><button class="chip" data-action="decide" data-id="${p.id}" data-decision="withdraw">Withdraw</button></div>`
      : `<div class="proposal-actions two">
          <button class="btn mint" data-action="decide" data-id="${p.id}" data-decision="approve">Approve</button>
          <button class="btn soft" data-action="decide" data-id="${p.id}" data-decision="reject">Not now</button>
        </div>`}
  </div>`;
}

function proposalDetail(p) {
  const fmt = (x) => (p.target === 'tier'
    ? `${x.emoji} Day ${x.day}: ${esc(x.reward)}`
    : `<b>${esc(x.title)}</b>${x.description ? `<br>${esc(x.description)}` : ''}`);
  if (p.action === 'edit') {
    return `<div class="diff"><div><small>Now</small><p>${fmt(p.before)}</p></div><div><small>Proposed</small><p>${fmt(p.data)}</p></div></div>`;
  }
  if (p.action === 'add' && p.target === 'boundary' && p.data.description) return `<div class="diff"><div><p>${esc(p.data.description)}</p></div></div>`;
  return '';
}

function boundaryForm(b) {
  return `<form class="stack" data-submit="propose" data-target="boundary" data-op="${b ? 'edit' : 'add'}" data-id="${b?.id ?? ''}">
    <label>The boundary<input name="title" maxlength="80" required value="${esc(b?.title ?? '')}" placeholder="No contact after 10pm" autocomplete="off"></label>
    <label>Details <small>Optional. What counts and what doesn't.</small>
      <textarea name="description" rows="3" maxlength="400">${esc(b?.description ?? '')}</textarea></label>
    <label>Why this change? <small>Optional, but it helps ${esc(partner().name)} say yes.</small>
      <input name="reason" maxlength="300" autocomplete="off"></label>
    <button class="btn butter big">Send to ${esc(partner().name)}</button>
  </form>`;
}

function tierForm(t) {
  return `<form class="stack" data-submit="propose" data-target="tier" data-op="${t ? 'edit' : 'add'}" data-id="${t?.id ?? ''}">
    <div class="tier-fields">
      <label>Day<input name="day" type="number" inputmode="numeric" min="1" max="1000" required value="${t?.day ?? ''}"></label>
      <label>Emoji<input name="emoji" maxlength="16" value="${esc(t?.emoji ?? '🎁')}" autocomplete="off"></label>
    </div>
    <label>The reward<input name="reward" maxlength="60" required value="${esc(t?.reward ?? '')}" placeholder="a picnic" autocomplete="off"></label>
    <label>Why this change? <small>Optional.</small><input name="reason" maxlength="300" autocomplete="off"></label>
    <button class="btn butter big">Send to ${esc(partner().name)}</button>
  </form>`;
}

/* ============================================================ boundaries */

function boundariesScreen() {
  const pending = S.proposals.filter((p) => p.target === 'boundary');
  return `
    <section class="screen-head">
      <h1 class="title">Boundaries</h1>
      <p class="lead">What you've both agreed to. Any change takes a yes from both of you.</p>
    </section>
    ${pending.length ? `<section class="stack-sm"><h2 class="section-title">Proposed changes</h2>${pending.map(proposalCard).join('')}</section>` : ''}
    ${S.boundaries.length ? `<ol class="boundaries">${S.boundaries.map((b, i) => `
      <li>
        <button class="card boundary" data-action="openBoundary" data-id="${b.id}">
          <span class="num">${i + 1}</span>
          <span class="boundary-text"><b>${esc(b.title)}</b>${b.description ? `<small>${esc(b.description)}</small>` : ''}</span>
          <span class="more" aria-hidden="true">✎</span>
        </button>
      </li>`).join('')}</ol>`
    : `<p class="empty">No boundaries yet. Propose the first one and ${esc(partner().name)} can approve it.</p>`}
    <button class="btn butter big" data-action="newBoundary">Propose a new boundary</button>`;
}

function openBoundary(id) {
  const i = S.boundaries.findIndex((b) => b.id === id);
  const b = S.boundaries[i];
  const quick = (op, label, dir = '') => `<button class="btn soft small" data-action="proposeQuick" data-target="boundary" data-op="${op}" data-id="${b.id}" data-dir="${dir}">${label}</button>`;
  openSheet(`
    <h2 class="title">Propose a change</h2>
    <p class="lead">${esc(partner().name)} will see it on their home screen and can approve it or not.</p>
    ${boundaryForm(b)}
    <div class="quick-row">
      ${i > 0 ? quick('move', 'Move up', 'up') : ''}
      ${i < S.boundaries.length - 1 ? quick('move', 'Move down', 'down') : ''}
      ${quick('remove', 'Propose removing it')}
    </div>`);
}

/* ============================================================== timeline */

let timeline = null;       // events from the server, newest first
let timelineLoading = false;

async function loadTimeline() {
  if (timelineLoading) return;
  timelineLoading = true;
  try { timeline = (await call('/api/timeline')).events; } catch (err) { toast(err.message); timeline = []; }
  timelineLoading = false;
  if (currentTab() === 'timeline') render();
}

function timelineScreen() {
  if (!timeline) { loadTimeline(); return '<p class="lead center">Loading your story…</p>'; }
  const groups = [];
  for (const e of timeline) {
    if (groups.at(-1)?.date !== e.date) groups.push({ date: e.date, events: [] });
    groups.at(-1).events.push(e);
  }
  return `
    <section class="screen-head">
      <h1 class="title">Timeline</h1>
      <p class="lead">Everything you've done together, newest first.</p>
    </section>
    ${groups.map((g) => `
      <section class="day-group">
        <h2 class="day-head">${prettyDate(g.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <ol class="events">${foldCheckins(g.events).map(eventHtml).join('')}</ol>
      </section>`).join('')}`;
}

// On a day you both checked in, show one "Day N counted" row carrying both notes,
// instead of three separate rows.
function foldCheckins(events) {
  const day = events.find((e) => e.type === 'day');
  if (!day) return events;
  const checkins = events.filter((e) => e.type === 'checkin');
  return events
    .filter((e) => e.type !== 'checkin')
    .map((e) => (e === day ? { ...day, notes: checkins.filter((c) => c.note).reverse() } : e));
}

function eventHtml(e) {
  const who = e.by ? esc(nameOf(e.by)) : '';
  const quote = (s) => (s ? `<p class="quote">“${esc(s)}”</p>` : '');
  const item = (kind, icon, body) => `<li class="event ${kind}"><span class="event-ico">${icon}</span><div>${body}</div></li>`;
  switch (e.type) {
    case 'start': return item('start', '🌱', '<b>You started bonk together.</b>');
    case 'checkin': return item('checkin', `<span class="dot ${hue(e.by)}">✓</span>`, `<b>${who} held the line</b>${quote(e.note)}`);
    case 'day': return item('day', '💛', `<b>Day ${e.day} counted. You both held the line.</b>
      ${(e.notes || []).map((c) => `<p class="quote"><span class="who">${esc(nameOf(c.by))}:</span> “${esc(c.note)}”</p>`).join('')}`);
    case 'unlock': return item('unlock', '🎉', `<b>Unlocked: ${esc(e.reward)} ${e.emoji}</b><small>Reached day ${e.day}</small>`);
    case 'redeem': return item('redeem', '⭐', `<b>${who} redeemed ${esc(e.reward)} ${e.emoji}</b><small>${prettyDate(e.memoryDate, { month: 'long', day: 'numeric' })}</small>${quote(e.note)}`);
    case 'bonk': return item('bonk', '🔨', `<b>${e.selfReported ? `${who} owned up to a slip` : `${who} raised a worry about ${esc(nameOf(e.about))}`}</b>
      <small>${esc(e.boundaryTitle)}. Streak ${e.streakBefore} to ${e.resetTo}.</small>${quote(e.reflection)}`);
    case 'bonk_ack': return item('ack', '🤝', `<b>${who} read the bonk</b>${quote(e.note)}`);
    case 'rule': return item('rule', '📜', `<b>Agreed: ${esc(e.summary)}</b><small>Proposed by ${who}, approved by ${esc(nameOf(e.approvedBy))}</small>${quote(e.reason)}`);
    default: return '';
  }
}
let justCheckedIn = false;
let lastStreak = null;

function personStatus(u) {
  const c = S.checkins[u.id];
  const fresh = justCheckedIn && u.id === S.me ? 'fresh' : '';
  return `<div class="person ${c ? 'in' : ''} ${fresh}">
    <span class="avatar lg ${hue(u.id)}">${esc(u.name[0])}<i class="tick" aria-hidden="true">✓</i></span>
    <div>
      <b>${u.id === S.me ? 'You' : esc(u.name)}</b>
      <small>${c ? (c.note ? `“${esc(c.note)}”` : 'Held the line') : 'Not yet'}</small>
    </div>
  </div>`;
}

function checkinBox() {
  const mine = S.checkins[S.me];
  const theirs = S.checkins[partner().id];
  if (mine && theirs) return `<p class="today-msg good">You both held the line. Day ${S.streak} counts. 💛</p>`;
  if (mine) return `<p class="today-msg">Today counts once ${esc(partner().name)} checks in too.</p>`;
  if (S.checkinBlocked) return `<p class="today-msg">${esc(S.checkinBlocked)}</p>`;
  return `<form class="checkin" data-submit="checkin">
    ${theirs ? `<p class="today-msg">${esc(partner().name)} is in. Your turn.</p>` : ''}
    <input name="note" data-draft="note" maxlength="140" placeholder="A line about today (optional)" value="${esc(drafts.note ?? '')}" autocomplete="off">
    <button class="btn mint huge"><span class="check-ico">✓</span> I held the line today</button>
  </form>`;
}

/* =============================================================== rewards */

function rewardsScreen() {
  const ROW = 132;
  const TOP = 56;
  const stops = [{ start: true, day: 0 }, ...S.tiers];
  const pts = stops.map((s, i) => ({ x: i === 0 ? 50 : i % 2 ? 72 : 28, y: TOP + i * ROW }));
  const height = pts.at(-1).y + 110;

  // The trail is a chain of S-curves from stop to stop.
  const ctrl = (a, b) => [{ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }];
  const C = (c1, c2, p) => `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`;
  const trail = `M${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p, i) => C(...ctrl(pts[i], p), p)).join(' ');

  // How far along the trail are we? Find the segment, then split its curve at that fraction.
  const j = stops.reduce((last, s, i) => (s.day <= S.streak ? i : last), 0);
  let done = `M${pts[0].x} ${pts[0].y} ` + pts.slice(1, j + 1).map((p, i) => C(...ctrl(pts[i], p), p)).join(' ');
  let you = { ...pts[j] };
  const atStop = j === stops.length - 1 || S.streak === stops[j].day;
  if (!atStop) {
    const t = (S.streak - stops[j].day) / (stops[j + 1].day - stops[j].day);
    const [c1, c2] = ctrl(pts[j], pts[j + 1]);
    const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const a = lerp(pts[j], c1), b = lerp(c1, c2), c = lerp(c2, pts[j + 1]);
    const d = lerp(a, b), e = lerp(b, c), f = lerp(d, e);
    done += ' ' + C(a, d, f);
    you = f;
  }

  const pending = S.proposals.filter((p) => p.target === 'tier');
  return `
    <section class="screen-head">
      <h1 class="title">The ladder</h1>
      <p class="lead">Each stop is a step back toward normal time together. Tap one to see it.</p>
    </section>
    ${pending.length ? `<section class="stack-sm"><h2 class="section-title">Proposed changes</h2>${pending.map(proposalCard).join('')}</section>` : ''}
    <div class="map" style="height:${height}px">
      <svg class="trail" viewBox="0 0 100 ${height}" preserveAspectRatio="none" style="height:${height}px" aria-hidden="true">
        <path class="trail-todo" d="${trail}"/>
        <path class="trail-done" d="${done}"/>
      </svg>
      ${stops.map((s, i) => stopHtml(s, pts[i])).join('')}
      <div class="you ${atStop ? 'on-stop' : ''}" style="left:${you.x}%;top:${you.y}px">
        <span class="you-bubble">Day ${S.streak}</span>
        ${mascot(S.pendingBonks.length ? 'bonked' : '')}
      </div>
    </div>
    <button class="btn butter big" data-action="newTier">Propose a new reward</button>`;
}

function stopHtml(s, p) {
  const pos = `left:${p.x}%;top:${p.y}px`;
  if (s.start) return `<div class="stop start" style="${pos}"><span class="node">Start</span></div>`;
  const badge = { locked: '🔒', unlocked: '✨', redeemed: '⭐' }[s.status];
  const status = {
    locked: `${days(s.day - S.streak)} to go`,
    unlocked: 'Unlocked! Tap to redeem',
    redeemed: s.memories.at(-1)?.note ? `“${esc(s.memories.at(-1).note)}”` : 'Redeemed',
  }[s.status];
  return `<div class="stop ${s.status} ${p.x > 50 ? 'label-left' : 'label-right'}" style="${pos}">
    <button class="node" data-action="openTier" data-id="${s.id}" aria-label="Day ${s.day}: ${esc(s.reward)}, ${s.status}">
      <span class="emoji">${s.emoji}</span><span class="badge">${badge}</span>
    </button>
    <div class="stop-label">
      <b>Day ${s.day}</b>
      <span>${esc(s.reward)}</span>
      <small>${status}</small>
    </div>
  </div>`;
}

function openTier(id) {
  const t = S.tiers.find((x) => x.id === id);
  const memories = t.memories.map((m) => `
    <div class="memory">
      <small>${prettyDate(m.date, { month: 'long', day: 'numeric', year: 'numeric' })}</small>
      <p>${m.note ? esc(m.note) : 'No note, just the memory.'}</p>
    </div>`).join('');

  let body = '';
  if (t.status === 'locked') {
    body = `<p class="lead">Unlocks on day ${t.day}. That's ${days(t.day - S.streak)} from now.</p>`;
  } else if (t.status === 'unlocked') {
    body = `<p class="lead">Unlocked on ${prettyDate(t.unlockedOn)}. When you've done it, mark it redeemed and keep a memory of it.</p>
      <form class="stack" data-submit="redeem" data-id="${t.unlockId}">
        <label>When was it?<input type="date" name="date" value="${S.today}" max="${S.today}" required></label>
        <label>A memory to keep<textarea name="note" rows="3" maxlength="500" placeholder="What made it nice?"></textarea></label>
        <button class="btn butter big">Mark as redeemed</button>
      </form>`;
  } else {
    body = `<p class="lead">Redeemed. Here's what you kept from it:</p>`;
  }
  openSheet(`
    <div class="sheet-hero ${t.status}"><span>${t.emoji}</span></div>
    <h2 class="title center">Day ${t.day}: ${esc(t.reward)}</h2>
    ${body}
    ${memories ? `<div class="memories">${memories}</div>` : ''}
    <details class="propose">
      <summary>Propose a change to this reward</summary>
      ${tierForm(t)}
      <div class="quick-row">
        <button class="btn soft small" data-action="proposeQuick" data-target="tier" data-op="remove" data-id="${t.id}">Propose removing it</button>
      </div>
    </details>
  `);
}

/* ============================================================ celebrate */

function celebrate() {
  if (celebrating || !S.celebrate?.length) return;
  celebrating = true;
  const list = [...S.celebrate].sort((a, b) => a.day - b.day);
  const top = list.at(-1);
  const also = list.slice(0, -1);
  const el = document.createElement('div');
  el.className = 'party';
  el.dataset.ids = list.map((u) => u.id).join(',');
  el.innerHTML = `<div class="party-card" role="dialog" aria-modal="true" aria-label="Reward unlocked">
    ${mascot('happy')}
    <p class="party-day">Day ${top.day}!</p>
    <h2 class="party-reward">${top.emoji} ${esc(top.reward)}</h2>
    <p>You unlocked it, together.${also.length ? ` Also unlocked: ${also.map((u) => esc(u.reward)).join(', ')}.` : ''}
      Once you've done it, mark it redeemed on the Rewards map.</p>
    <button class="btn butter big" data-action="closeParty">Yay!</button>
  </div>`;
  document.body.append(el);
  confetti();
  buzz([20, 60, 20, 60, 40]);
}

// Canvas confetti. With no options it's the big unlock party; check-ins use a small burst.
function confetti({ x = innerWidth / 2, y = innerHeight * 0.42, count = 150, power = 1, duration = 2800,
  colors = ['#FFD25E', '#7ED6AE', '#FF6A5C', '#B7A3F0', '#8EC5F7', '#FFB08A'] } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const bits = Array.from({ length: count }, () => ({
    x: (x + (Math.random() - 0.5) * 40 * power) * dpr,
    y: y * dpr,
    vx: (Math.random() - 0.5) * 22 * power * dpr,
    vy: (-Math.random() * 22 - 8) * power * dpr,
    size: (6 + Math.random() * 7) * (power < 1 ? 0.8 : 1) * dpr,
    angle: Math.random() * 6,
    spin: (Math.random() - 0.5) * 0.4,
    color: colors[(Math.random() * colors.length) | 0],
    round: Math.random() < 0.35,
  }));
  const start = performance.now();
  (function frame(t) {
    const left = 1 - (t - start) / duration;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, left * 4);
    for (const b of bits) {
      b.vy += 0.6 * dpr;
      b.vx *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.angle += b.spin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.size * 0.45, 0, 7); ctx.fill(); }
      else ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
      ctx.restore();
    }
    if (left > 0) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}

/* ================================================================ sheets */

function openSheet(html) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <button class="sheet-close" data-action="closeSheet" aria-label="Close">✕</button>${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  return el.querySelector('.sheet');
}

function closeSheet() {
  document.querySelector('.sheet-backdrop')?.remove();
}

function openAccount() {
  const me = userById(S.me);
  openSheet(`
    <h2 class="title">Hi, ${esc(me.name)}</h2>
    <p class="lead">Days roll over at midnight in ${esc(S.timezone)}.</p>
    <button class="btn soft big" data-action="logout">Log out</button>
  `);
}

/* =============================================================== actions */

// Buttons say what they do with data-action="name". One listener routes them all.
const actions = {
  pickUser: (el) => { Object.assign(pin, { user: el.dataset.id, digits: '', first: null }); render(); },
  pinKey: (el) => pressPin(el.dataset.key),
  pinCancel: () => { Object.assign(pin, { user: null, digits: '', first: null }); render(); },
  openAccount,
  openTier: (el) => openTier(el.dataset.id),
  closeSheet,
  logout: async () => { closeSheet(); await act('/api/logout'); },
  devNextDay: () => act('/api/dev/next-day'),
  openBonk,
  openHowItWorks,
  openBoundary: (el) => openBoundary(el.dataset.id),
  newBoundary: () => openSheet(`<h2 class="title">Propose a boundary</h2>
    <p class="lead">It becomes real once ${esc(partner().name)} approves it.</p>${boundaryForm()}`),
  newTier: () => openSheet(`<h2 class="title">Propose a reward</h2>
    <p class="lead">It goes on the ladder once ${esc(partner().name)} approves it.</p>${tierForm()}`),
  proposeQuick: async (el) => {
    const { target, op, id, dir } = el.dataset;
    if (await act('/api/proposals', { target, action: op, targetId: id, data: { dir } })) {
      closeSheet();
      toast(`Sent to ${partner().name}.`);
    }
  },
  decide: async (el) => {
    const { id, decision } = el.dataset;
    el.disabled = true;
    const ok = await act(`/api/proposals/${id}/${decision}`);
    if (ok) toast({ approve: 'Approved. The change is in.', reject: 'Okay, it stays as it was.', withdraw: 'Withdrawn.' }[decision]);
    else el.disabled = false;
  },
  closeParty: async (el) => {
    const party = el.closest('.party');
    const ids = party.dataset.ids.split(',');
    party.remove();
    celebrating = false;
    await act('/api/unlocks/seen', { ids });
  },
};

// Forms say what they do with data-submit="name". They get their fields as an object.
const forms = {
  setup: (f) => act('/api/setup', {
    names: [f.a, f.b],
    timezone: f.tz,
    boundaries: f.boundaries.split('\n'),
  }),
  checkin: async (f) => {
    buzz([10, 30, 20]);
    const ok = await call('/api/checkin', { note: f.note }).then((s) => (S = s)).catch((err) => toast(err.message));
    if (!ok) return;
    drafts.note = '';
    timeline = null;
    justCheckedIn = true;
    render();
    justCheckedIn = false;
    // a small burst of mint and butter from your avatar
    const r = document.querySelector('.person.fresh .avatar')?.getBoundingClientRect();
    if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 40, power: 0.45, duration: 1400, colors: ['#7ED6AE', '#FFD25E', '#FFF8F4'] });
  },
  redeem: async (f, form) => {
    if (await act(`/api/unlocks/${form.dataset.id}/redeem`, f)) {
      closeSheet();
      toast('Redeemed. That memory is saved.');
    }
  },
  bonk: async (f) => {
    if (await act('/api/bonks', f)) {
      closeSheet();
      location.hash = 'home';
      setTimeout(bonkHit, 60); // after the hash change has redrawn home
      toast(`Bonk logged. ${partner().name} will see it next time they open bonk.`);
    }
  },
  ack: async (f, form) => {
    if (await act(`/api/bonks/${form.dataset.id}/ack`, f)) toast('Acknowledged. Check-ins start again tomorrow.');
  },
  propose: async (f, form) => {
    const { target, op, id } = form.dataset;
    const { reason, ...data } = f;
    if (await act('/api/proposals', { target, action: op, targetId: id || null, data, reason })) {
      closeSheet();
      toast(`Sent to ${partner().name}.`);
    }
  },
};

// The cartoon moment when a bonk lands: a mallet swings in, bonk gets
// squashed, a bump pops up on its head, and "bonk!" flashes up.
function bonkHit() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    buzz([70, 50, 30]);
    playMascot(hero.querySelector('.mascot'), 'bonk-hit');
    hero.insertAdjacentHTML('beforeend', '<span class="mallet" aria-hidden="true">🔨</span><span class="bonk-word" aria-hidden="true">bonk!</span>');
    setTimeout(() => hero.querySelectorAll('.mallet, .bonk-word').forEach((el) => el.remove()), 1700);
  }, 350);
}

// When someone opens the app to a bonk they haven't seen yet this session, bonk winces once.
const wincedAt = new Set();
function winceAtNewBonks() {
  document.querySelectorAll('.bonk-card[data-id]').forEach((card) => {
    if (wincedAt.has(card.dataset.id)) return;
    wincedAt.add(card.dataset.id);
    setTimeout(() => { buzz([70, 50, 30]); playMascot(card.querySelector('.mascot'), 'bonk-hit'); }, 300);
  });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  const button = form.querySelector('button:not([type=button])');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  Promise.resolve(forms[form.dataset.submit](Object.fromEntries(new FormData(form)), form))
    .finally(() => { if (button?.isConnected) button.disabled = false; });
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.draft) drafts[e.target.dataset.draft] = e.target.value;
});

document.addEventListener('keydown', (e) => {
  if (!pin.user || S?.me) return;
  if (/^\d$/.test(e.key)) pressPin(e.key);
  else if (e.key === 'Backspace') pressPin('back');
});

// Little "click" you can feel on Android when pressing any button.
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.btn, .key, .node, .tab')) buzz(6);
});

window.addEventListener('hashchange', () => { closeSheet(); timeline = null; render(); scrollTo(0, 0); });

/* ============================================================ keep fresh */

// Check for the other person's updates every so often, without stomping on typing.
async function refresh() {
  if (document.visibilityState !== 'visible' || celebrating) return;
  if (document.querySelector('.sheet-backdrop') || app.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  try {
    const next = await call('/api/state');
    if (JSON.stringify(next) !== JSON.stringify(S)) { S = next; timeline = null; render(); }
  } catch { /* offline for a moment; try again next tick */ }
}
setInterval(refresh, 15000);
document.addEventListener('visibilitychange', refresh);

(async function start() {
  try {
    S = await call('/api/state');
    render();
  } catch (err) {
    app.innerHTML = `<div class="solo"><p class="lead">Can't reach bonk right now. ${esc(err.message)}</p></div>`;
  }
})();
