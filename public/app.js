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
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000); // YYYY-MM-DD dates
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
// There are two of them, one per person: 'b' faces the other way and has a little tuft.
function mascot(mood = '', variant = 'a') {
  return `<svg class="mascot ${variant} ${mood}" viewBox="0 0 120 120" aria-hidden="true">
    <ellipse class="m-shadow" cx="60" cy="108" rx="36" ry="5"/>
    <g class="m-body">
      <circle class="m-bump" cx="77" cy="33" r="11"/>
      <path class="m-blob" d="M60 30C86 30 102 52 102 76C102 96 85 104 60 104C35 104 18 96 18 76C18 52 34 30 60 30Z"/>
      ${variant === 'b' ? '<path class="m-line" d="M57 31c-3-7 1-12 8-11"/>' : ''}
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

// Both mochi side by side on a little pink hill. Without a logged-in pair, just two mochi.
// On home the hill is the wavy top edge of the streak panel below it (`onPanel`).
const HILLS = {
  panel: 'M0 80V46C0 34 9 28 22 26C60 19 96 30 134 34S214 22 252 14C282 8 300 18 300 34V80Z',
  mound: 'M0 80C24 52 72 34 132 38S246 52 300 80Z',
};
function duo(moodOf = () => '', { onPanel = false } = {}) {
  const ids = S?.users?.length === 2 ? S.users.map((u) => u.id) : ['a', 'b'];
  return `<div class="duo">
    <svg class="hill" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true"><path d="${onPanel ? HILLS.panel : HILLS.mound}"/></svg>
    ${ids.map((id, i) => mascot(moodOf(id), i ? 'b' : 'a')).join('')}
  </div>`;
}

/* ================================================================ icons */

// Line icons, drawn on a 24px grid in the current text colour.
const ICON_PATHS = {
  home: '<path d="M4 10.2 12 4l8 6.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19Z"/>',
  shield: '<path d="M12 3.5 19 6v5.4c0 4.3-2.9 7.8-7 9.1-4.1-1.3-7-4.8-7-9.1V6Z"/><path d="m9 12 2.2 2.2L15.2 10"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5H17l-2.4 4 2.4 4H5.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="m5 12.5 4.2 4L19 7"/>',
  star: '<path d="m12 4.5 2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6Z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  talk: '<path d="M5 18.5v-12A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H9.2Z"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.8 13.8c1.7 2 4.7 2 6.4 0"/><circle cx="9.4" cy="9.8" r="1" fill="currentColor"/><circle cx="14.6" cy="9.8" r="1" fill="currentColor"/>',
  meh: '<circle cx="12" cy="12" r="8.5"/><path d="M8.8 14.8c1-.9 2.1-.9 3.2 0s2.2.9 3.2 0"/><circle cx="9.4" cy="9.8" r="1" fill="currentColor"/><circle cx="14.6" cy="9.8" r="1" fill="currentColor"/>',
  pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
  mail: '<rect x="3.5" y="6" width="17" height="12.5" rx="2"/><path d="m4.2 7.2 7.8 5.8 7.8-5.8"/>',
  retro: '<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4"/><path d="M19.5 4.5v4h-4"/>',
  heart: '<path d="M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.2c0 5.4-7.5 10-7.5 10Z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.7a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.3"/><circle cx="12" cy="16.4" r="1" fill="currentColor"/>',
  back: '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};
const icon = (name) => `<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

// One branch of the laurel around the streak number: leaves along a curved stem.
const LAUREL = (() => {
  const P0 = [44, 116], P1 = [2, 84], P2 = [20, 12];
  const at = (t) => [0, 1].map((k) => (1 - t) ** 2 * P0[k] + 2 * (1 - t) * t * P1[k] + t * t * P2[k]);
  const angle = (t) => {
    const [dx, dy] = [0, 1].map((k) => 2 * (1 - t) * (P1[k] - P0[k]) + 2 * t * (P2[k] - P1[k]));
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  const leaf = (t, turn, cls = '') => {
    const [x, y] = at(t);
    return `<path ${cls} d="M0 0Q7-6.5 16 0Q7 6.5 0 0Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(angle(t) + turn).toFixed(0)})"/>`;
  };
  const leaves = [0.12, 0.29, 0.46, 0.63, 0.8].map((t) => leaf(t, -44) + leaf(t, 44, 'class="in"')).join('');
  return `<svg class="laurel" viewBox="0 0 54 124" aria-hidden="true"><path class="stem" d="M${P0} Q${P1} ${P2}"/>${leaves}${leaf(1, 0)}</svg>`;
})();

// The little mountain with a flag at the top of the milestones screen.
const PEAK = `<svg class="peak" viewBox="0 0 210 96" aria-hidden="true">
  <path class="hill-fill" d="M2 96C28 76 66 68 108 70S182 80 208 96Z"/>
  <path class="line rock" d="M46 86 88 34l13 15 11-12 44 49Z"/>
  <path class="line" d="m79 45 6 4 6-5 7 6 5-4"/>
  <path class="line" d="M88 34V9"/>
  <path class="line flag" d="M88 10h20l-6 6 6 6H88"/>
  <g class="line tick-mark"><path d="m134 30 5-6"/><path d="m140 38 7-2"/><path d="m60 32-5-5"/></g>
</svg>`;

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
  ['home', 'home', 'Home'],
  ['boundaries', 'shield', 'Boundaries'],
  ['milestones', 'flag', 'Milestones'],
  ['talk', 'talk', 'Talk'],
  ['timeline', 'clock', 'Timeline'],
];
const SCREENS = { home: homeScreen, boundaries: boundariesScreen, milestones: milestonesScreen, talk: talkScreen, timeline: timelineScreen };

// "#talk/truth" is the talk tab showing its truth box page.
function route() {
  const [tab, sub = ''] = location.hash.slice(1).split('/');
  const name = tab === 'rewards' ? 'milestones' : tab; // old links
  return SCREENS[name] ? { tab: name, sub } : { tab: 'home', sub: '' };
}
const currentTab = () => route().tab;

function render() {
  if (!S) return;
  if (S.needsSetup) app.innerHTML = setupScreen();
  else if (!S.me) app.innerHTML = loginScreen();
  else {
    const { tab, sub } = route();
    app.innerHTML = `${header()}<main class="screen screen-${tab}">${SCREENS[tab](sub)}</main>${tabbar(tab)}`;
    winceAtNewBonks();
    celebrate();
  }
}

function header() {
  const me = userById(S.me);
  return `<header class="top">
    <a class="brand spark" href="#home">bonk.</a>
    <div class="top-right">
      ${S.dev ? `<button class="chip dev" data-action="devNextDay" title="Dev mode only">Skip to tomorrow</button>` : ''}
      <button class="avatar square ${hue(me.id)}" data-action="openAccount" aria-label="Account">${esc(me.name[0])}</button>
    </div>
  </header>`;
}

function tabbar(active) {
  return `<nav class="tabbar">${TABS.map(([id, glyph, label]) => `
    <a class="tab ${id === active ? 'on' : ''}" href="#${id}" ${id === active ? 'aria-current="page"' : ''}>
      ${icon(glyph)}${label}
    </a>`).join('')}</nav>`;
}

/* ================================================================= setup */

function setupScreen() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `<div class="solo">
    ${duo((id) => (id === 'a' ? 'hop' : ''))}
    <h1 class="wordmark spark">bonk.</h1>
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
      <button class="btn big">Start our streak</button>
    </form>
  </div>`;
}

/* ================================================================= login */

function loginScreen() {
  if (pin.user) return pinScreen();
  return `<div class="solo login">
    ${duo()}
    <h1 class="wordmark spark">bonk.</h1>
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

// How each of you is feeling today. "I need space" can also ask for space.
const FEELS = {
  good: { label: 'Comfortable', icon: 'smile' },
  unsure: { label: 'A bit unsure', icon: 'meh' },
  space: { label: 'I need space', icon: 'pause' },
};

// Kinds of bonk. Only a crossing resets anything.
const KINDS = {
  crossed: { label: 'A boundary was crossed', phrase: 'a crossing', note: 'Resets the streak' },
  near_miss: { label: 'A near miss', phrase: 'a near miss', note: 'Logged, no reset' },
  setback: { label: 'An emotional setback', phrase: 'an emotional setback', note: 'Logged, no reset' },
  misunderstanding: { label: 'A misunderstanding', phrase: 'a misunderstanding', note: 'Logged, no reset' },
};

// A called-out crossing that the person it's about hasn't agreed to or disputed yet.
const awaitsAnswer = (b) => b.type === 'crossed' && !b.selfReported && !b.ack && b.resetTo == null;
const openCrossing = () => S.pendingBonks.find((b) => b.type === 'crossed');

function homeScreen() {
  const n = S.streak;
  const from = S.tier?.day ?? 0;
  const pct = S.next ? Math.round(((n - from) / (S.next.day - from)) * 100) : 100;
  const crossingsFirst = (a, b) => (b.type === 'crossed') - (a.type === 'crossed');
  const bonksForMe = S.pendingBonks.filter((b) => b.by !== S.me).sort(crossingsFirst);
  const bonksByMe = S.pendingBonks.filter((b) => b.by === S.me).sort(crossingsFirst);
  const proposalsForMe = S.proposals.filter((p) => p.by !== S.me);
  const proposalsByMe = S.proposals.filter((p) => p.by === S.me);
  const since = S.sinceCrossing;
  // The number pops when it grows and drops with a thud when a bonk sends it back.
  const change = lastStreak === null ? '' : n > lastStreak ? 'up' : n < lastStreak ? 'down' : '';
  lastStreak = n;
  return `
    ${bonksForMe.map(bonkCard).join('')}
    ${bonksByMe.map(bonkWaitingCard).join('')}
    ${pauseCard()}
    ${proposalsForMe.length ? `<section class="stack-sm"><h2 class="section-title">Waiting on your yes or no</h2>${proposalsForMe.map(proposalCard).join('')}</section>` : ''}

    <section class="hero">
      ${duo(heroMood, { onPanel: true })}
      <div class="streak ${n ? '' : 'cold'}">
        <span class="flame" aria-hidden="true">🔥</span>
        <div class="wreath">${LAUREL}<div class="count ${change}">${n}</div>${LAUREL.replace('class="laurel"', 'class="laurel r"')}</div>
        <div class="ribbon"><span>${n === 1 ? 'day' : 'days'} holding the line</span></div>
        ${S.tier ? `<p class="tier-now">Unlocked so far: ${S.tier.emoji} ${esc(S.tier.reward)}</p>` : ''}
        <p class="since">${!since.ever ? 'No crossings since you started'
          : since.days === 0 ? 'The last crossing was today' : `${days(since.days)} since the last crossing`}</p>
      </div>
    </section>

    <section class="card today">
      <div class="card-head">
        <h2>Today</h2>
        <small>${prettyDate(S.today)}</small>
      </div>
      <div class="people">${S.users.map(personStatus).join('')}</div>
      ${checkinBox()}
    </section>

    ${alsoToday()}

    <section class="card next">
      ${S.next ? `
        <div class="next-row">
          <span class="next-emoji">${S.next.emoji}</span>
          <div>
            <small>Next up, on day ${S.next.day}</small>
            <b>${esc(S.next.reward)}</b>
            ${S.next.description ? `<span class="fine">${esc(S.next.description)}</span>` : ''}
          </div>
          <span class="to-go">${days(S.next.day - n)}<br>to go</span>
        </div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      ` : `<p class="all-done">Every milestone is unlocked. 🌈</p>`}
    </section>

    ${proposalsByMe.length ? `<section class="stack-sm"><h2 class="section-title">Waiting on ${esc(partner().name)}</h2>${proposalsByMe.map(proposalCard).join('')}</section>` : ''}

    ${rulesCard()}`;
}

// Both mochi wince while a crossing is open. After a check-in, only yours hops.
function heroMood(userId) {
  if (openCrossing()) return 'bonked';
  if (justCheckedIn && userId === S.me) return 'hop';
  return '';
}

// A row in a list card: an icon, two lines of text, and a chevron.
function linkRow({ href, action, ico, title, sub, hot = false }) {
  const inner = `<span class="row-ico">${icon(ico)}</span>
    <span class="row-text"><b>${title}</b><small>${sub}</small></span>${icon('chevron')}`;
  return href
    ? `<a class="row ${hot ? 'hot' : ''}" href="${href}">${inner}</a>`
    : `<button class="row ${hot ? 'hot' : ''}" data-action="${action}">${inner}</button>`;
}

// The other things worth doing today, each one tap away.
function alsoToday() {
  const p = esc(partner().name);
  const q = S.question;
  const r = S.retro;
  const unread = S.truths.theirs.filter((t) => !t.read).length;
  const rows = [linkRow({
    href: '#talk',
    ico: 'talk',
    title: "Today's question",
    sub: !q.mine ? `${q.theyAnswered ? `${p} answered. ` : ''}${esc(q.text)}`
      : q.theirs ? 'You both answered. See what they said.' : `You've answered. ${p} hasn't yet.`,
    hot: !q.mine && q.theyAnswered,
  })];
  if (unread) {
    rows.push(linkRow({ href: '#talk/truth', ico: 'mail', hot: true, title: `${p} shared something in the truth box`, sub: 'Read it when you have a quiet moment.' }));
  }
  const daysLeft = diffDays(S.today, r.end);
  if (!r.mine && (r.theyDone || daysLeft <= 1)) {
    rows.push(linkRow({
      href: '#talk/retro', ico: 'retro', hot: r.theyDone,
      title: `${r.every === 14 ? 'This fortnight' : 'This week'}'s retro`,
      sub: r.theyDone ? `${p} has done theirs. Both open once you've done yours.` : `Due by ${prettyDate(r.end)}.`,
    }));
  }
  rows.push(linkRow({ action: 'openGood', ico: 'heart', title: 'Something good today?', sub: 'Add it to the good stuff wall.' }));
  return `<section class="card rows">${rows.join('')}</section>`;
}


// The bonk rules, in plain words, with today's real numbers.
function rulesCard() {
  const { owned } = S.ifBonk;
  const savesFrom = S.tiers[1]?.day;
  return `<section class="rules">
    <h2>If someone slips</h2>
    <div class="rule"><span class="rule-tag own">Owning a crossing</span><span>back to <b>day ${owned}</b></span></div>
    <div class="rule"><span class="rule-tag caught">Called out, and agreed</span><span>back to <b>day 0</b></span></div>
    <div class="rule"><span class="rule-tag">Anything else</span><span>logged, <b>no reset</b></span></div>
    <p class="rule-note">${owned === 0 && savesFrom
      ? `Right now both crossings land on day 0. From day ${savesFrom} on, owning one always costs less.`
      : 'Honesty is always the cheaper option.'}</p>
    <div class="rule-actions">
      <button class="btn soft small" data-action="openBonk">🔨 Log a bonk</button>
      ${S.pause ? '' : `<button class="btn soft small" data-action="openSpace">${icon('pause')} Ask for space</button>`}
    </div>
    <button class="link" data-action="openHowItWorks">How the streak works</button>
  </section>`;
}

/* ================================================================= space */

function pauseCard() {
  const p = S.pause;
  if (!p) return '';
  const mine = p.by === S.me;
  const back = !p.until ? ''
    : p.until === S.today ? ' The plan was to check back in today.'
    : ` Check back in on ${prettyDate(p.until, { weekday: 'long', month: 'short', day: 'numeric' })}.`;
  return `<section class="card pause-card">
    <span class="row-ico">${icon('pause')}</span>
    <div class="stack-sm">
      <h2>${mine ? "You've asked for some space" : `${esc(nameOf(p.by))} asked for some space`}</h2>
      <p>${mine ? `${esc(partner().name)} can see it. No explanation needed.` : 'No explanation needed. One-on-one plans are on hold for now.'}${back}</p>
      ${p.note ? `<blockquote>${esc(p.note)}</blockquote>` : ''}
      ${mine ? `<button class="btn soft small" data-action="endPause">I'm ready to talk again</button>` : ''}
    </div>
  </section>`;
}

const SPACE_OPTIONS = `
  <option value="1">Tomorrow</option>
  <option value="3">In 3 days</option>
  <option value="7">In a week</option>
  <option value="0">I'll say when</option>`;

function openSpace() {
  const p = esc(partner().name);
  openSheet(`
    <h2 class="title">Ask for some space</h2>
    <p class="lead">${p} will see it next time they open bonk. You don't have to explain, and the streak isn't affected.</p>
    <form class="stack" data-submit="space">
      <label>When will you check back in?
        <select name="days">${SPACE_OPTIONS}</select>
      </label>
      <label>Anything you want to add? <small>Optional.</small>
        <textarea name="note" rows="2" maxlength="300"></textarea>
      </label>
      <button class="btn big">Ask for space</button>
    </form>`);
}

/* =========================================================== bonk cards */

// What happened, plus whichever of the guided answers were filled in.
function reflectionHtml(b) {
  const extra = [['What led up to it', b.ledUpTo], ['How it felt afterwards', b.felt], ['Next time', b.nextTime]].filter(([, v]) => v);
  return `<blockquote>${esc(b.reflection)}</blockquote>
    ${extra.length ? `<dl class="reflect">${extra.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}`;
}

function bonkTitle(b, viewer) {
  const who = b.by === viewer ? 'You' : esc(nameOf(b.by));
  const aboutYou = b.about === viewer ? 'you' : esc(nameOf(b.about));
  if (b.type === 'crossed') {
    if (b.selfReported) return `${who} owned up to a crossing`;
    return awaitsAnswer(b) ? `${who} said ${aboutYou} crossed a boundary` : `${who} raised a worry about ${aboutYou}`;
  }
  return b.selfReported ? `${who} logged ${KINDS[b.type].phrase}` : `${who} logged ${KINDS[b.type].phrase} about ${aboutYou}`;
}

// A bonk the other person logged, waiting on you.
function bonkCard(b) {
  const who = esc(nameOf(b.by));
  const crossing = b.type === 'crossed';
  let effect;
  let form;
  if (awaitsAnswer(b)) {
    effect = `If you agree, the streak goes from ${S.streak} back to day 0. If you see it differently, it's logged as a near miss or a misunderstanding, with no reset. Check-ins pause until you answer.`;
    form = `<form class="stack-sm" data-submit="respond" data-id="${b.id}">
      <div class="choices" role="radiogroup" aria-label="Your answer">
        <label class="choice"><input type="radio" name="answer" value="agree" required><span><b>You're right, I crossed it</b><small>The streak goes back to day 0</small></span></label>
        <label class="choice"><input type="radio" name="answer" value="near_miss"><span><b>I see it as a near miss</b><small>Logged, no reset</small></span></label>
        <label class="choice"><input type="radio" name="answer" value="misunderstanding"><span><b>I see it as a misunderstanding</b><small>Logged, no reset</small></span></label>
      </div>
      <textarea name="note" rows="2" maxlength="500" placeholder="Your side of it. Needed if you see it differently."></textarea>
      <button class="btn deep big">Send my answer</button>
    </form>`;
  } else {
    effect = crossing
      ? `The streak went from ${b.streakBefore} to <b>${b.resetTo}</b>. Read it, then let ${who} know you have.`
      : "This doesn't reset anything. It's here so you can talk about it.";
    form = `<form class="stack-sm" data-submit="ack" data-id="${b.id}">
      <input name="note" maxlength="300" placeholder="Say something back (optional)" autocomplete="off">
      <button class="btn ${crossing ? 'deep' : ''} big">I've read it</button>
    </form>`;
  }
  return `<section class="card bonk-card ${crossing ? '' : 'soft'}" ${crossing ? `data-wince="${b.id}"` : ''}>
    <div class="bonk-head">
      ${mascot(crossing ? 'bonked' : '')}
      <div>
        <h2>${bonkTitle(b, S.me)}</h2>
        <small>${esc(b.boundaryTitle || KINDS[b.type].label)}</small>
      </div>
    </div>
    ${reflectionHtml(b)}
    <p class="bonk-effect">${effect}</p>
    ${form}
  </section>`;
}

// A bonk you logged, waiting on the other person.
function bonkWaitingCard(b) {
  const p = esc(partner().name);
  const crossing = b.type === 'crossed';
  const [head, effect] = awaitsAnswer(b)
    ? [`Waiting for ${p} to answer`, `Nothing resets unless ${p} agrees it was a crossing. Check-ins pause until they answer.`]
    : crossing
      ? [`Waiting for ${p} to read your bonk`, `The streak went from ${b.streakBefore} to <b>${b.resetTo}</b>. Check-ins pause until ${p} has read it.`]
      : [`${p} hasn't read this yet`, "It doesn't reset anything. It's here so you can talk about it."];
  return `<section class="card bonk-card waiting">
    <div class="bonk-head">
      ${mascot(crossing ? 'bonked' : '')}
      <div>
        <h2>${head}</h2>
        <small>${KINDS[b.type].label}${b.boundaryTitle ? `: ${esc(b.boundaryTitle)}` : ''}</small>
      </div>
    </div>
    ${reflectionHtml(b)}
    <p class="bonk-effect">${effect}</p>
  </section>`;
}

function openBonk() {
  const p = esc(partner().name);
  openSheet(`
    <h2 class="title">Log a bonk</h2>
    <p class="lead">Anything that crossed, or nearly crossed, a line. Only a real crossing resets the streak.</p>
    <form class="stack bonk-form" data-submit="bonk">
      <fieldset class="field">
        <legend>What kind?</legend>
        <div class="choices">
        ${Object.entries(KINDS).map(([key, k], i) => `
          <label class="choice">
            <input type="radio" name="type" value="${key}" ${i ? '' : 'required'}>
            <span><b>${k.label}</b><small>${k.note}</small></span>
          </label>`).join('')}
      </div></fieldset>
      <fieldset class="field">
        <legend>Who is it about?</legend>
        <div class="choices two">
        <label class="choice"><input type="radio" name="about" value="me" required><span><b>Me</b></span></label>
        <label class="choice"><input type="radio" name="about" value="them"><span><b>${p}</b></span></label>
      </div></fieldset>
      <p class="cost cost-own">Owning it: the streak goes from ${S.streak} back to day ${S.ifBonk.owned}, and today won't count. Check-ins pause until ${p} has read it.</p>
      <p class="cost cost-call">Nothing resets yet. ${p} answers first: if they agree it was a crossing, the streak goes back to day 0. Check-ins pause until they answer.</p>
      <p class="cost cost-soft">Nothing resets. ${p} will see it and can respond.</p>
      <label>Which boundary? <small>Needed for a crossing.</small>
        <select name="boundaryId">
          <option value="">None in particular</option>
          ${S.boundaries.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}
        </select>
      </label>
      <label>What happened?
        <textarea name="reflection" rows="3" maxlength="1000" required></textarea>
      </label>
      <label>What led up to it? <small>Optional.</small>
        <textarea name="ledUpTo" rows="2" maxlength="600"></textarea>
      </label>
      <label>How did you feel afterwards? <small>Optional.</small>
        <textarea name="felt" rows="2" maxlength="600"></textarea>
      </label>
      <label>What could we do differently next time? <small>Optional.</small>
        <textarea name="nextTime" rows="2" maxlength="600"></textarea>
      </label>
      <button class="btn deep big">Log the bonk</button>
    </form>`);
}

function openHowItWorks() {
  openSheet(`
    <h2 class="title">How the streak works</h2>
    <ul class="how">
      <li><b>A day counts when you both tap “I held the line.”</b> Days roll over at midnight in ${esc(S.timezone)}.</li>
      <li><b>Missed a check-in?</b> That day just doesn't count. Nothing resets.</li>
      <li><b>Owning a crossing</b> costs the milestone you're on: the streak drops to the start of the one before it. Right now that's day ${S.ifBonk.owned}.</li>
      <li><b>Called out on a crossing?</b> Nothing resets until you answer. Agree, and the streak goes back to day 0. See it differently, and it's logged as a near miss or a misunderstanding instead.</li>
      <li><b>Near misses, setbacks and misunderstandings</b> never reset anything. They're logged so you can talk about them.</li>
      <li><b>After a crossing,</b> check-ins pause until it's been read or answered, and that day doesn't count.</li>
      <li><b>Asking for space</b> never touches the streak. Keep checking in if you can.</li>
      <li><b>Milestones</b> unlock when the streak reaches them and lock again if a crossing drops it below them. They're options, never obligations. Memories you saved stay forever.</li>
      <li><b>Boundaries, milestones and the retro schedule</b> only change when one of you proposes it and the other says yes.</li>
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
          <button class="btn" data-action="decide" data-id="${p.id}" data-decision="approve">Approve</button>
          <button class="btn soft" data-action="decide" data-id="${p.id}" data-decision="reject">Not now</button>
        </div>`}
  </div>`;
}

function proposalDetail(p) {
  const fmt = (x) => (p.target === 'tier'
    ? `${x.emoji} Day ${x.day}: ${esc(x.reward)}${x.description ? `<br>${esc(x.description)}` : ''}`
    : `<b>${esc(x.title)}</b>${x.description ? `<br>${esc(x.description)}` : ''}`);
  if (p.target === 'retro') return '';
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
    <button class="btn big">Send to ${esc(partner().name)}</button>
  </form>`;
}

function tierForm(t) {
  return `<form class="stack" data-submit="propose" data-target="tier" data-op="${t ? 'edit' : 'add'}" data-id="${t?.id ?? ''}">
    <div class="tier-fields">
      <label>Day<input name="day" type="number" inputmode="numeric" min="1" max="1000" required value="${t?.day ?? ''}"></label>
      <label>Emoji<input name="emoji" maxlength="16" value="${esc(t?.emoji ?? '🎁')}" autocomplete="off"></label>
    </div>
    <label>The milestone<input name="reward" maxlength="60" required value="${esc(t?.reward ?? '')}" placeholder="Picnic Club" autocomplete="off"></label>
    <label>What it means <small>Optional.</small><input name="description" maxlength="120" value="${esc(t?.description ?? '')}" placeholder="A picnic in the park, in daylight" autocomplete="off"></label>
    <label>Why this change? <small>Optional.</small><input name="reason" maxlength="300" autocomplete="off"></label>
    <button class="btn big">Send to ${esc(partner().name)}</button>
  </form>`;
}

/* ============================================================ boundaries */

function boundariesScreen() {
  const pending = S.proposals.filter((p) => p.target === 'boundary');
  return `
    <section class="screen-head">
      <h1 class="title spark">Boundaries</h1>
    </section>
    ${pending.length ? `<section class="stack-sm"><h2 class="section-title">Proposed changes</h2>${pending.map(proposalCard).join('')}</section>` : ''}
    <section class="card agreements">
      <div class="agreements-head">
        <span class="badge-ico">${icon('shield')}</span>
        <div><h2>Our agreements</h2><small>Any change takes a yes from both of you.</small></div>
      </div>
      ${S.boundaries.length ? `<ol class="boundaries">${S.boundaries.map((b) => `
        <li>
          <button class="boundary" data-action="openBoundary" data-id="${b.id}" aria-label="${esc(b.title)}: propose a change">
            <span class="check">${icon('check')}</span>
            <span class="boundary-text"><b>${esc(b.title)}</b>${b.description ? `<small>${esc(b.description)}</small>` : ''}</span>
            <span class="more">${icon('more')}</span>
          </button>
        </li>`).join('')}</ol>`
      : `<p class="empty">No boundaries yet. Propose the first one and ${esc(partner().name)} can approve it.</p>`}
    </section>
    <button class="btn big" data-action="newBoundary">${icon('plus')} Propose a boundary</button>`;
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
      <h1 class="title spark">Timeline</h1>
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
    .map((e) => (e === day ? { ...day, notes: checkins.reverse() } : e));
}

// "Comfortable. “A note”" for one check-in, plus your own private note if there is one.
function checkinLine(c, withName) {
  const feel = c.feel ? `<span class="feel-tag ${c.feel}">${FEELS[c.feel].label}</span> ` : '';
  const note = c.note ? `“${esc(c.note)}”` : '';
  const line = feel || note ? `<p class="quote">${withName ? `<span class="who">${esc(nameOf(c.by))}:</span> ` : ''}${feel}${note}</p>` : '';
  const priv = c.privateNote ? `<p class="private-note">${icon('lock')}<span>${esc(c.privateNote)}</span></p>` : '';
  return line + priv;
}

function eventHtml(e) {
  const who = e.by ? esc(nameOf(e.by)) : '';
  const quote = (s) => (s ? `<p class="quote">“${esc(s)}”</p>` : '');
  const item = (kind, icon, body) => `<li class="event ${kind}"><span class="event-ico">${icon}</span><div>${body}</div></li>`;
  switch (e.type) {
    case 'start': return item('start', '🌱', '<b>You started bonk together.</b>');
    case 'checkin': return item('checkin', `<span class="dot ${hue(e.by)}">✓</span>`, `<b>${who} held the line</b>${checkinLine(e, false)}`);
    case 'day': return item('day', '💛', `<b>Day ${e.day} counted. You both held the line.</b>
      ${(e.notes || []).map((c) => checkinLine(c, true)).join('')}`);
    case 'unlock': return item('unlock', '🎉', `<b>Unlocked: ${esc(e.reward)} ${e.emoji}</b><small>Reached day ${e.day}</small>`);
    case 'redeem': return item('redeem', '⭐', `<b>${who} redeemed ${esc(e.reward)} ${e.emoji}</b><small>${prettyDate(e.memoryDate, { month: 'long', day: 'numeric' })}</small>${quote(e.note)}`);
    case 'bonk': {
      const kind = e.kind || 'crossed';
      const title = kind !== 'crossed' ? `${who} logged ${KINDS[kind].phrase}${e.selfReported ? '' : ` about ${esc(nameOf(e.about))}`}`
        : e.selfReported ? `${who} owned up to a crossing` : `${who} said ${esc(nameOf(e.about))} crossed a boundary`;
      const cost = kind === 'crossed' && e.resetTo != null ? ` Streak ${e.streakBefore} to ${e.resetTo}.` : '';
      return item(kind === 'crossed' ? 'bonk' : 'bonk soft', kind === 'crossed' ? '🔨' : '🫧', `<b>${title}</b>
        <small>${esc(e.boundaryTitle || KINDS[kind].label)}.${cost}</small>${quote(e.reflection)}
        ${[e.ledUpTo, e.felt, e.nextTime].filter(Boolean).map((x) => `<p class="quote">${esc(x)}</p>`).join('')}`);
    }
    case 'bonk_ack': {
      const title = e.response === 'agreed' ? `${who} agreed it was a crossing`
        : e.response ? `${who} saw it as ${KINDS[e.response].phrase}` : `${who} read the bonk`;
      return item('ack', '🤝', `<b>${title}</b>${e.response === 'agreed' ? `<small>Streak ${e.streakBefore} to ${e.resetTo}.</small>` : ''}${quote(e.note)}`);
    }
    case 'pause_start': return item('pause', '🕊️', `<b>${who} asked for some space</b>${e.until ? `<small>Check back in on ${prettyDate(e.until)}</small>` : ''}${quote(e.note)}`);
    case 'pause_end': return item('pause', '🌤️', `<b>${who} is ready to talk again</b>`);
    case 'good': return item('good', '💗', `<b>${who} added to the good stuff wall</b><small>${esc(e.prompt)}</small>${quote(e.text)}`);
    case 'question': return item('question', '💬', `<b>You both answered: ${esc(e.question)}</b>
      ${Object.entries(e.answers || {}).map(([id, a]) => `<p class="quote"><span class="who">${esc(nameOf(id))}:</span> “${esc(a)}”</p>`).join('')}`);
    case 'truth_shared': return item('truth', '✉️', `<b>${who} shared something in the truth box</b><small>${esc(e.prompt)}</small>`);
    case 'truth_read': return item('truth', '📖', `<b>${who} read a truth box entry</b><small>${esc(e.prompt)}</small>`);
    case 'retro': return item('retro', '🔁', `<b>You both finished the retro</b><small>${prettyDate(e.start)} to ${prettyDate(e.end)}</small>`);
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
      <small>${!c ? 'Not yet' : `${c.feel ? `<span class="feel-tag ${c.feel}">${FEELS[c.feel].label}</span> ` : ''}${c.note ? `“${esc(c.note)}”` : c.feel ? '' : 'Held the line'}`}</small>
    </div>
  </div>`;
}

function checkinBox() {
  const mine = S.checkins[S.me];
  const theirs = S.checkins[partner().id];
  if (mine && theirs) return `<p class="today-msg good">You both held the line. Day ${S.streak} counts. 💛</p>`;
  if (mine) return `<p class="today-msg">Today counts once ${esc(partner().name)} checks in too.</p>`;
  if (S.checkinBlocked) return `<p class="today-msg">${esc(S.checkinBlocked)}</p>`;
  const p = esc(partner().name);
  return `<form class="checkin" data-submit="checkin">
    ${theirs ? `<p class="today-msg">${p} is in. Your turn.</p>` : ''}
    <fieldset class="field">
      <legend>How are you feeling about things today?</legend>
      <div class="feels">
      ${Object.entries(FEELS).map(([key, f]) => `
        <label class="feel ${key}">
          <input type="radio" name="feel" value="${key}" data-draft="feel" required ${drafts.feel === key ? 'checked' : ''}>
          <span>${icon(f.icon)}${f.label}</span>
        </label>`).join('')}
    </div></fieldset>
    ${S.pause ? '' : `<label class="space-opts">Ask ${p} for some space?
      <select name="spaceDays" data-draft="spaceDays">
        <option value="">Not right now</option>
        ${SPACE_OPTIONS.replace(/>(Tomorrow|In 3 days|In a week|I'll say when)</g, (m, t) => `>Yes, ${t === "I'll say when" ? "and I'll say when to check back in" : `check back in ${t.toLowerCase()}`}<`)}
      </select>
    </label>`}
    <input name="note" data-draft="note" maxlength="140" placeholder="A note for ${p} (optional)" value="${esc(drafts.note ?? '')}" autocomplete="off">
    <details class="private" ${drafts.privateNote ? 'open' : ''}>
      <summary>${icon('lock')} Add a private note</summary>
      <textarea name="privateNote" data-draft="privateNote" rows="3" maxlength="1000" placeholder="Struggling with a boundary? How do you feel about where things are going?">${esc(drafts.privateNote ?? '')}</textarea>
      <small>Only you can see this. It shows up on your own timeline.</small>
    </details>
    <button class="btn huge">${icon('check')} I held the line today</button>
  </form>`;
}

/* ============================================================ milestones */

// The milestones as one vertical line. Your mochi sits on the line
// between the last one you've reached and the next.
function milestonesScreen() {
  const reached = S.tiers.filter((t) => t.day <= S.streak).length; // tiers come sorted by day
  const rows = S.tiers.map((t, i) => milestoneHtml(t, { next: i === reached, lit: i < reached }));
  rows.splice(reached, 0, `<li class="ms here">
    ${mascot(openCrossing() ? 'bonked' : '')}
    <span class="here-pill">You're on day ${S.streak}</span>
  </li>`);

  const pending = S.proposals.filter((p) => p.target === 'tier');
  return `
    <section class="screen-head journey">
      ${PEAK}
      <h1 class="title spark">Milestones</h1>
      <p class="lead">Each one is an option you can take together, never an obligation. Tap one to see it.</p>
    </section>
    ${S.pause ? `<p class="on-hold">${icon('pause')}<span>One-on-one plans are on hold while ${S.pause.by === S.me ? 'you have' : `${esc(nameOf(S.pause.by))} has`} some space.</span></p>` : ''}
    ${pending.length ? `<section class="stack-sm"><h2 class="section-title">Proposed changes</h2>${pending.map(proposalCard).join('')}</section>` : ''}
    <ol class="milestones">${rows.join('')}</ol>
    <button class="btn big" data-action="newTier">${icon('plus')} Propose a milestone</button>`;
}

function milestoneHtml(t, { next, lit }) {
  const status = {
    locked: t.day > S.streak ? `${days(t.day - S.streak)} to go` : 'Locked',
    unlocked: 'Unlocked. Tap to redeem',
    redeemed: t.memories.at(-1)?.note ? `“${esc(t.memories.at(-1).note)}”` : 'Redeemed',
  }[t.status];
  const dot = { locked: '', unlocked: icon('star'), redeemed: icon('check') }[t.status];
  return `<li class="ms ${t.status} ${next ? 'next' : ''} ${lit ? 'lit' : ''}">
    <button class="ms-row" data-action="openTier" data-id="${t.id}" aria-label="Day ${t.day}: ${esc(t.reward)}, ${t.status}">
      <span class="ms-dot">${dot}</span>
      <span class="ms-text"><b>Day ${t.day}: ${esc(t.reward)} ${t.emoji}</b>${t.description ? `<small class="desc">${esc(t.description)}</small>` : ''}<small>${status}</small></span>
      ${icon('chevron')}
    </button>
  </li>`;
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
    body = `<p class="lead">Unlocked on ${prettyDate(t.unlockedOn)}. It's an option, not a plan: do it when you both want to, then mark it redeemed and keep a memory of it.</p>
      <form class="stack" data-submit="redeem" data-id="${t.unlockId}">
        <label>When was it?<input type="date" name="date" value="${S.today}" max="${S.today}" required></label>
        <label>A memory to keep<textarea name="note" rows="3" maxlength="500" placeholder="What made it nice?"></textarea></label>
        <button class="btn big">Mark as redeemed</button>
      </form>`;
  } else {
    body = `<p class="lead">Redeemed. Here's what you kept from it:</p>`;
  }
  openSheet(`
    <div class="sheet-hero ${t.status}"><span>${t.emoji}</span></div>
    <h2 class="title center">Day ${t.day}: ${esc(t.reward)}</h2>
    ${t.description ? `<p class="center">${esc(t.description)}</p>` : ''}
    ${body}
    ${memories ? `<div class="memories">${memories}</div>` : ''}
    <details class="propose">
      <summary>Propose a change to this milestone</summary>
      ${tierForm(t)}
      <div class="quick-row">
        <button class="btn soft small" data-action="proposeQuick" data-target="tier" data-op="remove" data-id="${t.id}">Propose removing it</button>
      </div>
    </details>
  `);
}

/* ================================================================== talk */

// The talk tab: today's question up top, then the truth box, retro, good stuff
// and past questions, each on its own page (#talk/truth and so on).
function talkScreen(sub) {
  const pages = { truth: truthScreen, retro: retroScreen, good: goodScreen, questions: pastQuestionsScreen };
  if (pages[sub]) return pages[sub]();
  const p = esc(partner().name);
  const unread = S.truths.theirs.filter((t) => !t.read).length;
  const r = S.retro;
  const retroSub = r.theirs ? 'Both done. See the answers.'
    : r.mine ? `Waiting for ${p}` : r.theyDone ? `${p} has done theirs` : `Due by ${prettyDate(r.end)}`;
  return `
    <section class="screen-head">
      <h1 class="title spark">Talk</h1>
      <p class="lead">Getting to know each other again, a little at a time.</p>
    </section>
    ${questionCard()}
    <nav class="tiles">
      ${tile('#talk/truth', 'mail', 'Truth box', unread ? `${unread} new from ${p}` : 'Shared when you choose', unread > 0)}
      ${tile('#talk/retro', 'retro', 'Retro', retroSub, r.theyDone && !r.mine)}
      ${tile('#talk/good', 'heart', 'Good stuff', S.goods.length ? `${S.goods.length} ${S.goods.length === 1 ? 'moment' : 'moments'} kept` : 'Nothing yet')}
      ${tile('#talk/questions', 'question', 'Past questions', S.pastQuestions.length ? `${S.pastQuestions.length} answered` : 'Nothing yet')}
    </nav>`;
}

const tile = (href, ico, title, sub, hot = false) => `<a class="tile ${hot ? 'hot' : ''}" href="${href}">
  <span class="row-ico">${icon(ico)}</span><b>${title}</b><small>${sub}</small></a>`;

// The top of a talk page, with a way back.
const subHead = (title, lead) => `<section class="screen-head sub">
  <a class="back" href="#talk" aria-label="Back to Talk">${icon('back')}</a>
  <h1 class="title spark">${title}</h1>
  ${lead ? `<p class="lead">${lead}</p>` : ''}
</section>`;

// One person's answer, marked with their initial.
const answer = (userId, text) => `<div class="answer">
  <span class="avatar ${hue(userId)}">${esc(nameOf(userId)[0])}</span>
  <p>${text ? esc(text) : '<span class="fine">Skipped this one.</span>'}</p>
</div>`;

function questionCard() {
  const q = S.question;
  const p = esc(partner().name);
  const body = !q.mine
    ? `<p class="fine">${q.theyAnswered ? `${p} has answered. Theirs opens once you answer.` : `Your answer stays hidden until ${p} answers too.`}</p>
      <form class="stack-sm" data-submit="question">
        <textarea name="text" data-draft="question" rows="3" maxlength="1000" required placeholder="Your answer">${esc(drafts.question ?? '')}</textarea>
        <button class="btn big">Answer</button>
      </form>`
    : `<div class="answers">
        ${answer(S.me, q.mine)}
        ${q.theirs ? answer(partner().id, q.theirs) : `<p class="fine">${p} hasn't answered yet. You'll see theirs once they do.</p>`}
      </div>`;
  return `<section class="card question-card">
    <small>Today's question</small>
    <h2>${esc(q.text)}</h2>
    ${body}
  </section>`;
}

function pastQuestionsScreen() {
  return `
    ${subHead('Past questions', 'Every question you answered. Theirs shows where you both did.')}
    ${S.pastQuestions.length ? S.pastQuestions.map((q) => `
      <section class="card question-card">
        <small>${prettyDate(q.date, { weekday: 'long', month: 'long', day: 'numeric' })}</small>
        <h2>${esc(q.question)}</h2>
        <div class="answers">
          ${answer(S.me, q.mine)}
          ${q.theirs ? answer(partner().id, q.theirs) : `<p class="fine">Only you answered this one.</p>`}
        </div>
      </section>`).join('')
    : '<p class="empty">Questions you answer show up here from tomorrow.</p>'}`;
}

/* ------------------------------------------------------------ truth box */

function truthScreen() {
  const p = esc(partner().name);
  const { mine, theirs } = S.truths;
  const draftList = mine.filter((t) => !t.sharedAt);
  const sharedList = mine.filter((t) => t.sharedAt);
  const locked = S.prompts.truth.filter((x) => x.day > S.best);
  return `
    ${subHead('Truth box', `Write what's hard to say. Nothing reaches ${p} until you choose to share it.`)}
    <button class="btn big" data-action="openTruth">${icon('plus')} Write something</button>
    ${theirs.length ? `<section class="stack-sm"><h2 class="section-title">From ${p}</h2>${theirs.map(truthFromThem).join('')}</section>` : ''}
    ${draftList.length ? `<section class="stack-sm"><h2 class="section-title">Your drafts</h2>
      <p class="fine">Only you can see these.</p>${draftList.map(truthDraft).join('')}</section>` : ''}
    ${sharedList.length ? `<section class="stack-sm"><h2 class="section-title">You shared</h2>${sharedList.map(truthShared).join('')}</section>` : ''}
    ${!mine.length && !theirs.length ? `<p class="empty">Nothing here yet. Write when you're ready. A draft can wait as long as you like.</p>` : ''}
    ${locked.length ? `<section class="locked-prompts">
      <h2>${icon('lock')} More prompts open as you go</h2>
      <ul>${locked.map((x) => `<li><span>Day ${x.day}</span>${esc(x.text)}</li>`).join('')}</ul>
      <p class="fine">They open at your best streak, so a bonk never closes them again.</p>
    </section>` : ''}`;
}

const truthBody = (t) => `<small>${esc(t.prompt)}</small><p class="truth-text">${esc(t.text)}</p>`;

function truthFromThem(t) {
  const p = esc(partner().name);
  return `<article class="card entry ${t.read ? '' : 'unread'}">
    ${truthBody(t)}
    <small>Shared ${prettyDate(t.sharedOn ?? t.sharedAt.slice(0, 10))}</small>
    ${t.read
      ? `<p class="fine">You've read it.${t.read.reply ? ` You said: “${esc(t.read.reply)}”` : ''}</p>`
      : `<form class="stack-sm" data-submit="readTruth" data-id="${t.id}">
          <textarea name="reply" rows="2" maxlength="1000" placeholder="Say something back (optional)"></textarea>
          <button class="btn big">I've read it</button>
        </form>`}
    ${t.read ? '' : `<p class="fine">${p} will see that you've read it.</p>`}
  </article>`;
}

function truthDraft(t) {
  return `<article class="card entry draft">
    ${truthBody(t)}
    <div class="entry-actions">
      <button class="btn small" data-action="shareTruth" data-id="${t.id}">Share with ${esc(partner().name)}</button>
      <button class="btn soft small" data-action="editTruth" data-id="${t.id}">Edit</button>
      <button class="link" data-action="deleteTruth" data-id="${t.id}">Delete</button>
    </div>
  </article>`;
}

function truthShared(t) {
  const p = esc(partner().name);
  return `<article class="card entry">
    ${truthBody(t)}
    <small>Shared ${prettyDate(t.sharedOn ?? t.sharedAt.slice(0, 10))}. ${t.read ? `${p} has read it.` : `${p} hasn't read it yet.`}</small>
    ${t.read?.reply ? `<blockquote>${esc(t.read.reply)}</blockquote>` : ''}
  </article>`;
}

function openTruth() {
  const p = esc(partner().name);
  const open = S.prompts.truth.filter((x) => x.day <= S.best);
  openSheet(`
    <h2 class="title">Write something</h2>
    <p class="lead">Take your time. You decide if and when ${p} sees it.</p>
    <form class="stack" data-submit="truth">
      <label>Prompt
        <select name="prompt" required>${open.map((x) => `<option>${esc(x.text)}</option>`).join('')}</select>
      </label>
      <label>What you want to say
        <textarea name="text" rows="6" maxlength="2000" required></textarea>
      </label>
      <fieldset class="field">
        <legend>When should ${p} see it?</legend>
        <div class="choices">
        <label class="choice"><input type="radio" name="share" value="draft" checked><span><b>Keep it as a draft</b><small>Share it later, or never. Only you can see it.</small></span></label>
        <label class="choice"><input type="radio" name="share" value="now"><span><b>Share it now</b><small>Once it's shared, it stays shared.</small></span></label>
      </div></fieldset>
      <button class="btn big">Save</button>
    </form>`);
}

function editTruth(id) {
  const t = S.truths.mine.find((x) => x.id === id);
  if (!t) return;
  openSheet(`
    <h2 class="title">Edit your draft</h2>
    <p class="lead">${esc(t.prompt)}</p>
    <form class="stack" data-submit="truthEdit" data-id="${t.id}">
      <textarea name="text" rows="7" maxlength="2000" required>${esc(t.text)}</textarea>
      <button class="btn big">Save draft</button>
    </form>`);
}

/* ---------------------------------------------------------------- retro */

// "this week" / "these two weeks", depending on how often you do it.
function retroWords(every) {
  return every === 14
    ? { period: 'these two weeks', next: 'over the next two weeks', every: 'every two weeks' }
    : { period: 'this week', next: 'next week', every: 'every week' };
}

function retroPrompts(every) {
  const w = retroWords(every);
  return S.prompts.retro.map((q) => ({ ...q, text: q.text.replace('{period}', w.period).replace('{next}', w.next) }));
}

// Each prompt with both people's answers under it.
function retroCompare(prompts, mine, theirs) {
  return prompts.filter((q) => mine?.[q.key] || theirs?.[q.key]).map((q) => `
    <div class="pair">
      <h3>${esc(q.text)}</h3>
      ${answer(S.me, mine?.[q.key])}
      ${theirs ? answer(partner().id, theirs[q.key]) : ''}
    </div>`).join('');
}

function retroScreen() {
  const r = S.retro;
  const p = esc(partner().name);
  const prompts = retroPrompts(r.every);
  const w = retroWords(r.every);
  const range = `${prettyDate(r.start, { month: 'short', day: 'numeric' })} to ${prettyDate(r.end, { month: 'short', day: 'numeric' })}`;
  const pendingChange = S.proposals.find((x) => x.target === 'retro');
  let body;
  if (!r.mine) {
    body = `<p class="fine">${r.theyDone ? `${p} has done theirs. Both sets of answers open once you've done yours.` : `Answer on your own. ${p} won't see your answers until they've done theirs too.`}</p>
      <form class="stack" data-submit="retro">
        ${prompts.map((q) => `<label>${esc(q.text)}
          <textarea name="${q.key}" data-draft="retro_${q.key}" rows="2" maxlength="1000">${esc(drafts[`retro_${q.key}`] ?? '')}</textarea>
        </label>`).join('')}
        <button class="btn big">Finish my retro</button>
      </form>`;
  } else if (!r.theirs) {
    body = `<p class="today-msg good">Done. Waiting for ${p}. You'll both see each other's answers once they've finished.</p>
      ${retroCompare(prompts, r.mine, null)}`;
  } else {
    body = retroCompare(prompts, r.mine, r.theirs);
  }
  return `
    ${subHead('Retro', `A few questions, ${w.every}. You each answer alone, then read each other's.`)}
    <section class="card retro-card">
      <small>${range}</small>
      ${body}
    </section>
    <p class="fine center">${pendingChange ? `Proposed: ${esc(pendingChange.summary.toLowerCase())}. Waiting on a yes.`
      : `You do this ${w.every}. <button class="link" data-action="proposeRetro" data-every="${r.every === 7 ? 14 : 7}">Propose ${r.every === 7 ? 'every two weeks' : 'every week'}</button>`}</p>
    ${r.past.length ? `<section class="stack-sm"><h2 class="section-title">Earlier retros</h2>
      ${r.past.map((x) => `<details class="card past-retro">
        <summary>${prettyDate(x.start, { month: 'short', day: 'numeric' })} to ${prettyDate(x.end, { month: 'short', day: 'numeric' })}${x.theirs ? '' : '<small>Only you finished this one</small>'}</summary>
        ${retroCompare(retroPrompts(diffDays(x.start, x.end) + 1), x.mine, x.theirs)}
      </details>`).join('')}
    </section>` : ''}`;
}

/* ----------------------------------------------------------- good stuff */

function goodScreen() {
  return `
    ${subHead('Good stuff', 'The small good moments, kept for both of you. Something to look back on at day 90.')}
    <button class="btn big" data-action="openGood">${icon('plus')} Add something good</button>
    ${S.goods.length ? `<div class="wall">${S.goods.map((g) => `
      <article class="note ${hue(g.by)}">
        <small>${esc(g.prompt)}</small>
        <p>${esc(g.text)}</p>
        <small class="by">${esc(nameOf(g.by))}, ${prettyDate(g.date, { month: 'short', day: 'numeric' })}</small>
      </article>`).join('')}</div>`
    : '<p class="empty">Nothing here yet. Small things count.</p>'}`;
}

function openGood() {
  openSheet(`
    <h2 class="title">Add something good</h2>
    <p class="lead">${esc(partner().name)} will see it on the wall.</p>
    <form class="stack" data-submit="good">
      <fieldset class="field">
        <legend>What kind of good?</legend>
        <div class="pills">
        ${S.prompts.good.map((x, i) => `<label class="pill"><input type="radio" name="prompt" value="${esc(x)}" ${i ? '' : 'checked'}><span>${esc(x)}</span></label>`).join('')}
      </div></fieldset>
      <label>What happened?
        <textarea name="text" rows="3" maxlength="500" required></textarea>
      </label>
      <button class="btn big">Add to the wall</button>
    </form>`);
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
      It's an option, never an obligation. When you both want to, do it and mark it redeemed on the Milestones tab.</p>
    <button class="btn big" data-action="closeParty">Yay!</button>
  </div>`;
  document.body.append(el);
  confetti();
  buzz([20, 60, 20, 60, 40]);
}

// Canvas confetti. With no options it's the big unlock party; check-ins use a small burst.
function confetti({ x = innerWidth / 2, y = innerHeight * 0.42, count = 150, power = 1, duration = 2800,
  colors = ['#B06A6C', '#D8AA5E', '#F2A9A6', '#E3D7E6', '#93524F', '#F6DEDC'] } = {}) {
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
    <button class="sheet-close" data-action="closeSheet" aria-label="Close">${icon('close')}</button>${html}</div>`;
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
  newTier: () => openSheet(`<h2 class="title">Propose a milestone</h2>
    <p class="lead">It goes on the list once ${esc(partner().name)} approves it.</p>${tierForm()}`),
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
  openSpace,
  endPause: async () => {
    if (await act('/api/pause/end')) toast(`${partner().name} can see you're ready to talk again.`);
  },
  openGood,
  openTruth,
  editTruth: (el) => editTruth(el.dataset.id),
  shareTruth: async (el) => {
    if (!confirm(`Share this with ${partner().name}? Once it's shared, it stays shared.`)) return;
    if (await act(`/api/truths/${el.dataset.id}/share`)) toast(`Shared with ${partner().name}.`);
  },
  deleteTruth: async (el) => {
    if (!confirm('Delete this draft? It was only ever yours, and it will be gone.')) return;
    if (await act(`/api/truths/${el.dataset.id}/delete`)) toast('Draft deleted.');
  },
  proposeRetro: async (el) => {
    if (await act('/api/proposals', { target: 'retro', action: 'edit', data: { every: Number(el.dataset.every) } })) {
      toast(`Sent to ${partner().name}.`);
    }
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
    // A space request only goes with "I need space", and only if they picked a day.
    const askedForSpace = f.feel === 'space' && f.spaceDays !== undefined && f.spaceDays !== '';
    if (!askedForSpace) delete f.spaceDays;
    buzz([10, 30, 20]);
    const ok = await call('/api/checkin', f).then((s) => (S = s)).catch((err) => toast(err.message));
    if (!ok) return false;
    if (askedForSpace) toast(`${partner().name} will see that you asked for some space.`);
    timeline = null;
    justCheckedIn = true;
    render();
    justCheckedIn = false;
    // a small burst of rose and gold from your avatar
    const r = document.querySelector('.person.fresh .avatar')?.getBoundingClientRect();
    if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 40, power: 0.45, duration: 1400, colors: ['#B06A6C', '#D8AA5E', '#F6DEDC'] });
    return true;
  },
  redeem: async (f, form) => {
    if (await act(`/api/unlocks/${form.dataset.id}/redeem`, f)) {
      closeSheet();
      toast('Redeemed. That memory is saved.');
    }
  },
  bonk: async (f) => {
    const p = partner().name;
    if (!(await act('/api/bonks', f))) return false;
    closeSheet();
    location.hash = 'home';
    const resetNow = f.type === 'crossed' && f.about === 'me';
    if (resetNow) setTimeout(bonkHit, 60); // after the hash change has redrawn home
    toast(resetNow ? `Bonk logged. ${p} will see it next time they open bonk.`
      : f.type === 'crossed' ? `Sent. Nothing resets unless ${p} agrees it was a crossing.`
      : `Logged. ${p} will see it. Nothing resets.`);
    return true;
  },
  ack: async (f, form) => {
    const b = S.pendingBonks.find((x) => x.id === form.dataset.id);
    if (!(await act(`/api/bonks/${form.dataset.id}/ack`, f))) return false;
    toast(b?.type === 'crossed' ? 'Acknowledged. Check-ins start again tomorrow.' : `Done. ${nameOf(b?.by)} will see you've read it.`);
    return true;
  },
  respond: async (f, form) => {
    const agree = f.answer === 'agree';
    const ok = await act(`/api/bonks/${form.dataset.id}/respond`, { agree, seenAs: f.answer, note: f.note });
    if (!ok) return false;
    if (agree) setTimeout(bonkHit, 60);
    toast(agree ? 'Thanks for owning it. Check-ins start again tomorrow.' : `Sent. It's logged as ${KINDS[f.answer].phrase}, with no reset.`);
    return true;
  },
  space: async (f) => {
    if (!(await act('/api/pause', f))) return false;
    closeSheet();
    toast(`${partner().name} will see that you asked for some space.`);
    return true;
  },
  question: (f) => act('/api/question', { text: f.text }),
  truth: async (f) => {
    if (!(await act('/api/truths', f))) return false;
    closeSheet();
    toast(f.share === 'now' ? `Shared with ${partner().name}.` : 'Saved as a draft. Only you can see it.');
    return true;
  },
  truthEdit: async (f, form) => {
    if (!(await act(`/api/truths/${form.dataset.id}/edit`, f))) return false;
    closeSheet();
    toast('Draft saved.');
    return true;
  },
  readTruth: async (f, form) => {
    if (!(await act(`/api/truths/${form.dataset.id}/read`, f))) return false;
    toast(`${partner().name} will see that you've read it.`);
    return true;
  },
  retro: (f) => act('/api/retro', f),
  good: async (f) => {
    if (!(await act('/api/good', f))) return false;
    closeSheet();
    toast('Added to the wall.');
    return true;
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
    hero.querySelectorAll('.mascot').forEach((m) => playMascot(m, 'bonk-hit'));
    hero.insertAdjacentHTML('beforeend', '<span class="mallet" aria-hidden="true">🔨</span><span class="bonk-word" aria-hidden="true">bonk!</span>');
    setTimeout(() => hero.querySelectorAll('.mallet, .bonk-word').forEach((el) => el.remove()), 1700);
  }, 350);
}

// When someone opens the app to a bonk they haven't seen yet this session, bonk winces once.
const wincedAt = new Set();
function winceAtNewBonks() {
  document.querySelectorAll('.bonk-card[data-wince]').forEach((card) => {
    if (wincedAt.has(card.dataset.wince)) return;
    wincedAt.add(card.dataset.wince);
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
    .then((ok) => { if (ok) form.querySelectorAll('[data-draft]').forEach((el) => delete drafts[el.dataset.draft]); })
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
  if (e.target.closest('.btn, .key, .ms-row, .tab, .row, .tile, .feel')) buzz(6);
});

window.addEventListener('hashchange', () => { closeSheet(); timeline = null; render(); scrollTo(0, 0); });

/* ========================================================= netlify badge */

// Netlify's free plan adds a "Powered by Netlify" badge to the bottom-right corner.
// While it's on the page, html.has-badge gives the tab bar and sheets a strip of
// room underneath for it, so it never sits on top of a button.
function makeRoomForBadge() {
  document.documentElement.classList.toggle('has-badge', !!document.getElementById('nl-badge-frame'));
}
new MutationObserver(makeRoomForBadge).observe(document.body, { childList: true });
makeRoomForBadge();

/* ============================================================ keep fresh */

// Check for the other person's updates every so often, without stomping on typing.
async function refresh() {
  if (document.visibilityState !== 'visible' || celebrating) return;
  if (document.querySelector('.sheet-backdrop') || app.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
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
