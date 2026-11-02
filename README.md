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
  database with a 32-character code you can type on your phone.

## Running it locally

Node lives under `~/.local/bin` on this machine.

```sh
export PATH="$HOME/.local/bin:$PATH"
npm install          # wrangler, the only dependency
npm run build        # data + all 11 pages into dist/
npm run check        # 302 checks: links, sections, data, styles
npm run serve        # http://127.0.0.1:4321 — static only, no sync
```

For the sync API locally you need the Pages runtime with a local D1:

```sh
npx wrangler d1 execute polski-progress --local --file=migrations/0001_progress.sql
npx wrangler pages dev dist --port=8788 --persist-to=.wrangler/state
```

Without the API the site still works: progress saves in the browser and the
sync panel says syncing needs the Cloudflare build.

## Deploying to Cloudflare Pages

Once, in this order:

```sh
export PATH="$HOME/.local/bin:$PATH"

# 1. Sign in (opens the browser; the token from before has expired).
npx wrangler login

# 2. Create the database and copy the database_id it prints.
npx wrangler d1 create polski-progress

# 3. Paste that id into wrangler.toml, replacing REPLACE_WITH_YOUR_D1_ID.
#    database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 4. Create the table in the live database.
npx wrangler d1 execute polski-progress --remote --file=migrations/0001_progress.sql

# 5. Build and upload pages + functions.
npm run deploy
```

Then, every time after that:

```sh
npm run deploy
```

`wrangler pages deploy` prints the address (`https://polski-cases.pages.dev`
unless that name is taken). Open `/progress/` on the live site, press
**Create a sync code**, and type that code on the phone.

### What the deploy contains

- `dist/` — 11 HTML pages, `site.css`, one `<case>.css` per case, `app.js`,
  `catalog.js`, `_headers` (caching and security headers). 948 KB in total.
- `functions/api/progress/[[code]].js` — the sync API: `GET /api/progress`
  mints a code, `GET /api/progress/:code` reads, `PUT /api/progress/:code`
  writes only if the revision is newer.
- `migrations/0001_progress.sql` — one table, `progress`.
- `wrangler.toml` — the D1 binding `DB` and the Pages output folder.

Both are on the free plan: Pages allows unlimited static requests, and D1's
free tier (5 million rows read and 100,000 rows written a day) is far beyond
one learner's progress.

### If something goes wrong

- **The site works but sync says it is not available** — the `DB` binding is
  missing or `database_id` was not replaced. Re-check step 3 and redeploy.
- **`no such table: progress`** — step 4 was skipped or run against the
  wrong database name.
- **A deploy says the project already exists** — that is fine, it just means
  the project was created before; the upload still replaces the files.

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

## Notes on the content

The prose, tables and the explanations for individual drills come from the
seven pages as they were written; the sources cited there are Polish
Wiktionary (SGJP-based inflection tables) and the PWN language clinic.
