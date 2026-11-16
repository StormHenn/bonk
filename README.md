# bonk

A tiny private app for two people keeping their boundaries. Every day you both
check in, the streak grows, and milestones unlock along the way. There's also a
daily question, a truth box, a weekly retro and a wall for the good stuff.

No build step and no database. All state is one JSON document: `data.json` when
you run it yourself, or a single Netlify Blobs entry when it's on Netlify.

## Run it

Needs Node 20 or newer. Nothing to install for running locally.

```sh
npm start        # http://localhost:3000, data in data.json
npm run dev      # dev mode: uses data.dev.json, restarts on file changes,
                 # and shows a "Skip to tomorrow" button for testing streaks
```

To play both people on one computer, open one normal window and one private window.

On first visit you set up both names, the timezone and your starting boundaries.
Each person picks their own 4-digit PIN the first time they log in.

## Files

| File | What's in it |
| --- | --- |
| `bonk.js` | The app: streak and bonk rules, PIN login, every API route |
| `server.js` | Runs bonk locally, saving to `data.json` with atomic writes |
| `netlify/functions/api.mjs` | Runs bonk on Netlify, saving to Netlify Blobs |
| `netlify.toml` | Tells Netlify to serve `public/` and where the function is |
| `public/app.js` | Every screen and interaction |
| `public/style.css` | All the styling and animations |
| `public/index.html` | App shell |
| `public/manifest.webmanifest`, `icon*` | Home-screen install (PWA) |

## The rules (all in `bonk.js`)

- A day counts when **both** people check in. A missed day doesn't count, but nothing resets.
- The streak is never stored. `streak()` rebuilds it from check-ins and crossings every time.
- A bonk is one of four kinds: a crossing, a near miss, an emotional setback or a misunderstanding.
  **Only a crossing resets the streak.** The others are logged so you can talk about them.
- **Owning a crossing** drops the streak to the start of the milestone *before* the one you're on
  (at day 25 with milestones 10 and 20 reached, that's day 10). See `selfReportResetTo()`.
- **Calling out a crossing** resets nothing until the other person answers. If they agree, the streak
  drops to 0. If they see it differently, it's logged as a near miss or a misunderstanding instead.
- After a crossing, check-ins pause until it's been read or answered, and that day doesn't count.
- **Asking for space** never touches the streak. Only the person who asked can end it, and it ends
  by itself the day after their check-back day.
- Milestones unlock when the streak reaches them and lock again if a crossing drops the streak below them. Saved memories stay.
- Truth box prompts open at days 10, 30, 60 and 90 of your *best* streak, so a crossing never closes them again.
- Boundaries, milestones and the retro schedule only change through proposals the other person approves.

## What stays private

- Private check-in notes and truth box drafts are never sent to the other person's phone, and never go in the shared timeline.
- Daily question and retro answers stay hidden until you've both answered.
- "Private" means bonk won't show it to the other person. It isn't encrypted: anyone who can read
  `data.json` or the Netlify Blobs store can read everything in it.

## Hosting on Netlify (free)

1. Push this folder to a private GitHub repo.
2. In Netlify: **Add new project → Import an existing project**, and pick the repo.
   `netlify.toml` already sets everything, so leave the build settings empty and deploy.
3. Open `https://<your-site>.netlify.app` and do the setup together.

Use Git (or `netlify deploy --prod` from the CLI). Drag-and-drop deploys skip the
function, so the app can't save anything.

**Where the data lives:** the live site keeps everything in the Blobs store `bonk`.
Deploy previews and branch deploys use a separate store, `bonk-testing`, and show the
"Skip to tomorrow" button, so trying out changes never touches your real streak.

**Staying on the free plan:** on Netlify's current free plan you get 300 credits a month.
Two people's daily use takes a small share of that. Each production deploy costs 15
credits, though, and every push to your main branch deploys. Try changes locally
with `npm run dev` and push when they're done.

**If two phones save at the same instant,** one save waits for the other and is
re-applied on top, so nothing is lost.

## Config, fixes by hand, and backups

The data is one JSON document either way. These are the fields to edit:

- **Timezone:** `config.timezone`, e.g. `"America/Chicago"`.
- **Rename someone:** `users[].name`.
- **Forgotten PIN:** set that user's `pinHash` and `salt` to `null`. They choose a new PIN on next login.
- **Locked out after 5 wrong PINs:** wait 5 minutes, or delete that user's entry in `failedLogins`.
- **Start over:** delete the whole document.

**Locally:** stop the server, edit `data.json`, start it again. Copy `data.json`
somewhere now and then as a backup.

**On Netlify:** use the [Netlify CLI](https://cli.netlify.com/commands/blobs/) from
this folder, after `netlify login` and `netlify link`:

```sh
netlify blobs:get bonk state --output backup.json   # download (that's your backup)
netlify blobs:set bonk state --input backup.json    # upload your edited copy
netlify blobs:delete bonk state                     # start over
```

Download a backup now and then. It's your whole history. To move a local
`data.json` to Netlify, upload it with `blobs:set` instead of doing the setup screen.

## Other hosts

Anywhere that runs Node **and keeps files across restarts** works with `npm start`:
- An always-on computer at home plus [Tailscale](https://tailscale.com). It's free.
  `tailscale serve` shares it with just your tailnet, and `tailscale funnel` makes it public.
  Either way you get an HTTPS URL.
- Railway or Fly.io with a volume mounted at `/data` and `DATA_FILE=/data/data.json`.
  Each costs a few dollars a month. On Fly, keep exactly one machine.

Hosts that wipe their files (Vercel, Render's free tier, Heroku, Cloud Run) would
lose `data.json`, so `npm start` doesn't work there.

## Installing on your phones

Open the HTTPS URL, then:
- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app (or Add to Home screen).

Button-press haptics work on Android. iPhones don't let websites vibrate, so you get the visual press only.
