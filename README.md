# Polski — the seven cases

One site for learning the seven Polish cases, built from the seven pages that
were written separately. Every case keeps its own wording, tables and design;
what they now share is the shell (header, case switcher, section nav, theme),
one drill engine, and progress that saves itself and follows you between
devices.

- **1,275 drills in 54 sets**, every one with an explanation for the answer.
- Reference tables per case (98 nominative rows, 49 genitive, 53 accusative,
  132 vocative, 202 locative, …), searchable.
- Flashcards, a 7-day plan and verb tables with case filters on the two pages
  that had them (instrumental, locative).
- **Today's lesson** — twelve items, about six minutes, due first.
- **Mixed drill** — twenty items from all seven cases at once.
- Progress on the device, and optionally synced through a Cloudflare D1
  database with a 12-character code (shown as `XXXX XXXX XXXX`) you can type
  on your phone.

## Running it locally

Needs Node 20 or newer. On this machine Node is on `PATH` (nvm); the copy
under `~/.local/bin` also works if you prefer `export PATH="$HOME/.local/bin:$PATH"`.

```sh
npm install          # wrangler, the only dependency
npm run build        # data + all 11 pages into dist/
npm run check        # 302 checks: links, sections, data, styles
npm run serve        # http://127.0.0.1:4321 — static only, no sync
```

`PORT=5000 npm run serve` moves it. `dist/` is generated — never edit it.

For the sync API locally you need the Workers runtime with a local D1:

```sh
npx wrangler d1 execute polski-cases-progress --local --file=migrations/0001_progress.sql
npx wrangler dev --port=8788
```

`wrangler dev` serves the static assets and the API together, same as the
deployed Worker.

Without the API the site still works: progress saves in the browser and the
sync panel says syncing needs the Cloudflare build.

## Deploying to Cloudflare Workers

This project is deployed as a Cloudflare Worker at https://cases.hammad.lol
(custom domain on the `hammad.lol` zone) and at
`https://polish-cases.hmdshfq.workers.dev`. Both serve the same deployment.
Static files come from `dist/` through the assets binding; `worker.js` routes
`/api/progress/*` to the sync handler and everything else to the assets. The
D1 database exists and its id is in `wrangler.jsonc`, the `progress` table has
been created remotely, and sync works on both hosts.

Note: the custom domain sits behind the `hammad.lol` zone, which appends a
Cloudflare challenge-platform script to HTML (`/cdn-cgi/challenge-platform/
scripts/jsd/main.js`). That is zone-level bot detection, not part of the build;
the JS and CSS bytes are identical on both hosts.

To ship a change:

```sh
npm run deploy       # build, then wrangler deploy
```

Pushes to `main` also build and deploy automatically through Workers Builds
(GitHub integration), with the same commands: `npm run build`, then
`npx wrangler deploy`.

### First-time setup on a fresh account

Done once for this project. Needed again only if you recreate the account or
the database.

```sh
# 1. Sign in (opens the browser).
npx wrangler login

# 2. Create the database; it prints a database_id.
npx wrangler d1 create polski-cases-progress

# 3. Put that id in wrangler.jsonc (no ${VAR} substitution is supported there).
#    database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 4. Create the table in the live database.
npx wrangler d1 execute polski-cases-progress --remote --file=migrations/0001_progress.sql

# 5. Upload.
npm run deploy
```

The custom domain is declared in `wrangler.jsonc` (`routes` with
`custom_domain = true`) and claimed by the deploy.

### What the deploy contains

- `dist/` — 11 HTML pages, `site.css`, one `<case>.css` per case, `app.js`,
  `catalog.js`. 948 KB in total.
- `worker.js` — the Worker entry: `/api/progress/*` to the sync handler,
  everything else to the assets binding.
- `functions/api/progress/[[code]].js` — the sync API itself:
  `GET /api/progress` mints a code, `GET /api/progress/:code` reads,
  `PUT /api/progress/:code` writes only if the revision is newer.
- `migrations/0001_progress.sql` — one table, `progress`.
- `wrangler.jsonc` — the D1 binding `DB`, the assets directory, and the
  custom domain.

Both are on the free plan: static asset requests are free and unlimited, and
D1's
free tier gives 5 million rows read and 100,000 rows written a day, 5 GB of
storage, and 7 days of Time Travel. Since September 2026 those daily limits
are **enforced, not billed**: once an account passes them, queries error until
midnight UTC. The site keeps working — only sync stops until the reset.

Each visitor who presses **Create a sync code** gets their own row, keyed by a
random code (60 bits, from an alphabet without lookalike characters), so other
people using the site can neither read nor change your progress. It does mean a busy day of strangers counts against the account's
write quota.

### If something goes wrong

- **The site works but sync says it is not available** — the `DB` binding is
  missing or `database_id` is wrong. Re-check step 3 and redeploy.
- **`no such table: progress`** — step 4 was skipped or run against the
  wrong database name.
- **Sync fails for everyone until midnight UTC** — the free-tier daily row
  limit was hit; the site itself is unaffected.
- **Progress looks empty on `cases.hammad.lol`** — `localStorage` is per
  origin, so progress earned on a different host (the old
  `polski-cases.pages.dev`, now retired) does not follow you here. Open the
  old host's `/progress/`, copy the sync code, then enter it on the custom
  domain under “I have a code”. Afterwards, stay on one host:
  pick `cases.hammad.lol`.
- **A deploy says the custom domain is taken** — another Worker or a Pages
  project still holds the hostname. Remove it there first, then deploy again.

## How it is built

```
content/            the seven original pages, untouched
src/data/bank.json  1,275 drill items, extracted from those pages
src/data/…          catalog.json and extras.json, generated
src/app.js          one drill engine, progress store, sync client, hub pages
src/styles/site.css the shared stylesheet
tools/build*.mjs    data extraction and the page builder
tools/check.mjs     the checks
tools/serve.mjs     a local static server
dist/               the built site (generated — do not edit)
```

`npm run build` copies each page's own content and its own stylesheet (scoped
to that page, so it cannot fight the shared shell), then replaces the drill,
flashcard, plan, verb and reference sections with ones driven by the shared
engine. Editing a page's prose means editing `content/` and rebuilding.

## Version control

One git repo, branch `main`. Ignored: `node_modules/`, `dist/` (built),
`.wrangler/` (local D1 files and any auth state), `.dev.vars`, `.DS_Store`.

`src/data/bank.json` is committed because it is content. `catalog.json` and
`extras.json` are generated but also committed, so `npm run check` works on a
fresh clone without building first.

`wrangler.jsonc` is committed with the D1 `database_id`. That id is an
identifier, not a credential: every D1 call needs an account token on top of
it, so it gives nothing away. Never commit `~/.wrangler/` state, a
`CLOUDFLARE_API_TOKEN`, or a `.dev.vars` file — those are credentials.

## Notes on the content

The prose, tables and the explanations for individual drills come from the
seven pages as they were written; the sources cited there are Polish
Wiktionary (SGJP-based inflection tables) and the PWN language clinic.
