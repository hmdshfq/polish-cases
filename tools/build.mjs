// Builds the static site into dist/.
//
// Each case page keeps its own prose, tables and hero exactly as written. The
// build cuts that material out of content/*.html and puts it inside one shared
// shell. The interactive parts — drills, flashcards, the 7-day plan, the verb
// tables and the reference tables — are rebuilt on top of one engine, so the
// seven pages behave the same way and all of them save progress the same way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, s);
};

const catalog = JSON.parse(read('src/data/catalog.json'));
const extras = JSON.parse(read('src/data/extras.json'));
const css = read('src/styles/site.css');
const appJs = read('src/app.js');

// A short hash per asset, so a new build is never served from an old cache.
const crypto = await import('node:crypto');
function stamp(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
}

const cssV = stamp(css);
const appV = stamp(appJs);
const catV = stamp(JSON.stringify(catalog) + JSON.stringify(extras));

const SITE = [
  { id: 'nominative' },
  { id: 'genitive' },
  { id: 'dative' },
  { id: 'accusative' },
  { id: 'instrumental' },
  { id: 'locative' },
  { id: 'vocative' },
];

const SHORT = {
  nominative: 'The naming case — the dictionary form, and the one that agrees with everything else.',
  genitive: 'Possession, quantity, negation and the object of dozens of verbs.',
  dative: 'The receiver: to whom, for whom — and the case of “I am cold”.',
  accusative: 'The direct object, and the one case where animacy changes the ending.',
  instrumental: 'The tool, the means, the company — and the case after “jestem”.',
  locative: 'Always with a preposition: where, about what, at what time.',
  vocative: 'The case you speak in — addressing someone directly.',
};

const caseOf = (id) => {
  const c = catalog.cases.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- html slicing

function sectionMatch(html) {
  // [start, end, id, openTag] for every top-level <section>
  const out = [];
  const re = /<section\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const open = m.index;
    const close = matchingSectionEnd(html, open);
    const id = /\bid="([^"]+)"/.exec(m[0]);
    out.push({ start: open, end: close, id: id ? id[1] : null, tag: m[0] });
  }
  return out;
}

function matchingSectionEnd(html, openAt) {
  const re = /<section\b|<\/section>/g;
  re.lastIndex = openAt;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '</section>') {
      depth--;
      if (depth === 0) return m.index + '</section>'.length;
    } else depth++;
  }
  throw new Error('unclosed section');
}

function snumIn(sectionHtml) {
  const m = /<div class="snum">([^<]*)<\/div>/.exec(sectionHtml);
  return m ? m[1] : '';
}

// ------------------------------------------------------------ built sections

function drillsSection(id, num) {
  const c = caseOf(id);
  return `<section id="drills">
  <div class="shead"><div class="snum">${num}</div><h2>Drills</h2></div>
  <p>${c.sets.length} sets, ${c.count} items. Every answer comes with the reason: <b>1–9</b> to pick an option,
  <b>Enter</b> to check or continue. Your misses are collected, and “Review the mistakes” runs only those.
  Progress is saved on this device.</p>
  <div class="chips" id="drillProgress" data-case="${id}"></div>
  <div id="drillRoot" data-case="${id}" style="margin-top:14px"></div>
</section>`;
}

function cardsSection(id, num, title, intro, knownLabel) {
  const ex = extras[id] || {};
  const cards = ex.cards || [];
  const levels = [...new Set(cards.map((c) => c.lv))];
  const chips = ['all', ...levels]
    .map((lv, i) => {
      const label = lv === 'all' ? 'All' : lv === 'basic' ? 'Basic' : 'Advanced';
      return `<button class="chip${i === 0 ? ' on' : ''}" data-fclv="${lv}">${label}</button>`;
    })
    .join('\n    ');
  return `<section id="fiszki">
  <div class="shead"><div class="snum">${num}</div><h2>${esc(title)}</h2></div>
  <p>${intro}</p>
  <div class="chips" id="fcFilters">
    ${chips}
    <span class="chip">${knownLabel}: <b id="fcKnown">0</b> / <span id="fcTotal">0</span></span>
  </div>
  <div class="fcgrid" id="fcGrid" data-case="${id}"></div>
</section>`;
}

function planSection(id, num) {
  return `<section id="plan">
  <div class="shead"><div class="snum">${num}</div><h2>A 7-day plan</h2></div>
  <p>Fifteen focused minutes a day beats three hours on Sunday. Tick the boxes as you go — the ticks are saved too.</p>
  <div class="plan" id="planRoot" data-case="${id}"></div>
</section>`;
}

function verbsSection(id, num, heading) {
  const verbs = (extras[id] && extras[id].verbs) || [];
  const filters = ['all', ...new Set(verbs.map((v) => v.f).filter(Boolean))];
  const chips = filters
    .map((f, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-vf="${f}">${f === 'all' ? 'All' : f + ' + Ms.'}</button>`)
    .join('\n    ');
  const cols = verbs.some((v) => v.c)
    ? '<tr><th>Verb</th><th>Case</th><th>Meaning</th><th>Example</th></tr>'
    : '<tr><th>Verb</th><th>Meaning</th><th>Pattern</th><th>Example</th></tr>';
  return `<section id="czasowniki">
  <div class="shead"><div class="snum">${num}</div><h2>${esc(heading)}</h2></div>
  <p>A verb’s fixed case is called <b>rekcja</b>. Search the list, filter it, and read the example aloud — the sentence
  teaches the case better than the rule.</p>
  <div class="filter">
    <input id="verbSearch" type="search" placeholder="Filter: interesować, look, się…" aria-label="Filter the verb list">
    <span class="n" id="verbCount"></span>
  </div>
  <div class="chips" id="verbChips">
    ${chips}
  </div>
  <div class="tw tall">
    <table class="verb-table">
      <thead>${cols}</thead>
      <tbody id="verbBody" data-case="${id}"></tbody>
    </table>
  </div>
</section>`;
}

// The reference table keeps the page's own header row, so the columns say
// what that case calls them; only the body is generated.
function patchReference(html, id) {
  return html.replace(
    /(<table id="reftable">[\s\S]*?<tbody)([^>]*)>([\s\S]*?)(<\/tbody>)/,
    (m, open, attrs, body, close) =>
      `${open} id="refBody" data-case="${id}">${close}`
  );
}

// ------------------------------------------------------------ page assembly

function pageContent(id) {
  const html = read(`content/${id}.html`);
  const mainOpen = html.indexOf('<main class="wrap">');
  const mainClose = html.lastIndexOf('</main>');
  if (mainOpen < 0 || mainClose < 0) throw new Error(`no main in ${id}`);
  let inner = html.slice(mainOpen + '<main class="wrap">'.length, mainClose);

  const footAt = inner.lastIndexOf('<footer');
  if (footAt >= 0) inner = inner.slice(0, footAt);

  const sections = sectionMatch(inner);
  const bySid = new Map();
  for (const s of sections) if (s.id) bySid.set(s.id, s);

  const replacements = [];
  const drillIds = ['drills', 'cwiczenia'];
  const drillSid = drillIds.find((x) => bySid.has(x));
  if (drillSid) {
    const s = bySid.get(drillSid);
    replacements.push([s, drillsSection(id, snumIn(inner.slice(s.start, s.end)))]);
  }

  const cardsSid = ['fiszki', 'flashcards'].find((x) => bySid.has(x));
  if (cardsSid) {
    const s = bySid.get(cardsSid);
    const title = id === 'instrumental' ? 'Flashcards: the verb list' : 'Flashcards';
    const intro =
      id === 'instrumental'
        ? 'Click a card to turn it over. „Umiem” counts it as known, „Powtórzę” keeps it in the loop. Come back daily — the cards remember what you marked.'
        : 'One card, one decision. Click to turn a card over; mark it known or mark it for another pass. The cards remember what you marked.';
    replacements.push([
      s,
      cardsSection(id, snumIn(inner.slice(s.start, s.end)), title, intro, id === 'instrumental' ? 'Umiem' : 'Known'),
    ]);
  }

  if (bySid.has('plan')) {
    const s = bySid.get('plan');
    replacements.push([s, planSection(id, snumIn(inner.slice(s.start, s.end)))]);
  }

  if (bySid.has('czasowniki')) {
    const s = bySid.get('czasowniki');
    const heading = /<h2>([\s\S]*?)<\/h2>/.exec(inner.slice(s.start, s.end));
    replacements.push([
      s,
      verbsSection(id, snumIn(inner.slice(s.start, s.end)), heading ? heading[1] : 'Verbs'),
    ]);
  }

  // A progress strip under the hero, so the page opens with where you stand.
  replacements.sort((a, b) => b[0].start - a[0].start);
  for (const [s, newHtml] of replacements) {
    inner = inner.slice(0, s.start) + newHtml + inner.slice(s.end);
  }

  inner = patchReference(inner, id);

  return inner.trim();
}

// ---------------------------------------------------------------- shell

function caseMenu(activeId) {
  return SITE.map(({ id }) => {
    const c = caseOf(id);
    const on = id === activeId ? ' class="on"' : '';
    return `<a href="/${id}/"${on}><span>${esc(c.pl)}</span><span class="num">${c.n}</span></a>`;
  }).join('\n        ');
}

function header(activeId) {
  const label = activeId ? esc(caseOf(activeId).pl) : 'All cases';
  return `<header class="top">
  <div class="top-in">
    <div class="brand"><a href="/">polski <b>·</b></a></div>
    <div class="caseswitch" data-caseswitch>
      <button type="button" aria-haspopup="true" aria-expanded="false">${label} ▾</button>
      <div class="menu" role="menu">
        <a href="/"${activeId ? '' : ' class="on"'}><span>All seven cases</span><span class="num">⌂</span></a>
        ${caseMenu(activeId)}
      </div>
    </div>
    <nav class="sections" id="nav"></nav>
    <button class="theme" id="themeBtn" aria-label="Switch light or dark theme" title="Light / dark">◐</button>
  </div>
</header>`;
}

function pager(activeId) {
  const i = SITE.findIndex((s) => s.id === activeId);
  const prev = i > 0 ? caseOf(SITE[i - 1].id) : null;
  const next = i < SITE.length - 1 ? caseOf(SITE[i + 1].id) : null;
  const bits = [];
  bits.push(
    prev
      ? `<a href="/${prev.id}/"><span class="lab">← previous</span><span class="nm">${esc(prev.pl)}</span></a>`
      : `<a href="/"><span class="lab">← start</span><span class="nm">All seven cases</span></a>`
  );
  if (next)
    bits.push(
      `<a class="right" href="/${next.id}/"><span class="lab">next →</span><span class="nm">${esc(next.pl)}</span></a>`
    );
  return `<div class="pager">${bits.join('')}</div>`;
}

function shell({ title, description, activeId, body, canonical, caseCss, v = {} }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${canonical ? `<link rel="canonical" href="${canonical}">\n` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css?v=${v.css || 0}">
${caseCss ? `<link rel="stylesheet" href="/${caseCss}?v=${v.case || 0}">\n` : ''}<script>
  try {
    var t = localStorage.getItem("polski.theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
</script>
</head>
<body>
<div id="scrollbar"></div>
${header(activeId)}
${body}
<footer>
  <div class="sitefoot">
    <span>Polski · seven cases, one site · <a href="/">all cases</a></span>
    <span><a href="/progress/">My progress</a></span>
  </div>
</footer>
<script src="/catalog.js?v=${v.cat || 0}"></script>
<script src="/app.js?v=${v.app || 0}" defer></script>
</body>
</html>`;
}

// Each page's own stylesheet, carried over untouched but scoped to that page's
// main content, so it cannot fight the shared shell. Rules that reach outside
// the content (html, body, :root, header, footer, .wrap, bare section/table)
// are dropped; everything else gets `[data-case]` in front.
const SHELL_OWNED =
  /(^|[\s,>+~])(html|body|:root|\*|header|footer|main|#scrollbar|#top|#nav|nav\.sections|\.wrap|\.top-in|\.brand|\.sitefoot|\.pager|\.caseswitch)([\s.,:#\[>+~]|$)/;

function parseCss(css) {
  // Returns a list of { sel, body, media } at top level, where media is null or
  // the @media condition string. Handles one level of @media nesting.
  const out = [];
  let i = 0;
  let media = null;
  let depth = 0;
  let selStart = 0;

  while (i < css.length) {
    const ch = css[i];

    if (ch === '{') {
      const sel = css.slice(selStart, i).trim();
      if (sel.startsWith('@media')) {
        media = sel;
        i++;
        selStart = i;
        continue;
      }
      if (sel.startsWith('@')) {
        // @keyframes and friends: skip the whole block untouched
        let d = 1;
        let j = i + 1;
        while (j < css.length && d > 0) {
          if (css[j] === '{') d++;
          else if (css[j] === '}') d--;
          j++;
        }
        i = j;
        selStart = i;
        continue;
      }
      let d = 1;
      let j = i + 1;
      while (j < css.length && d > 0) {
        if (css[j] === '{') d++;
        else if (css[j] === '}') d--;
        j++;
      }
      out.push({ sel, body: css.slice(i + 1, j - 1).trim(), media });
      i = j;
      selStart = i;
      continue;
    }

    if (ch === '}') {
      // end of a media block
      media = null;
      i++;
      selStart = i;
      continue;
    }

    i++;
  }
  return out;
}

function scopedCaseCss(html, scope) {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!m) return '';

  const rules = parseCss(m[1]);
  const kept = [];
  for (const rule of rules) {
    if (rule.media && /print/.test(rule.media)) continue;
    if (rule.media && /prefers-reduced-motion/.test(rule.media)) continue;
    if (rule.media && /prefers-color-scheme/.test(rule.media)) continue;

    const parts = rule.sel.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) continue;

    const keep = parts.every((s) => {
      if (SHELL_OWNED.test(s)) return false;
      // bare element rules at the top level would reach the shell
      if (/^(section|table|th|td|thead|tbody|tr|footer|header)(\b|\[|\.|:|,|$)/.test(s)) return false;
      return true;
    });
    if (!keep) continue;

    const sel = parts.map((s) => `${scope} ${s}`).join(', ');
    const body = rule.body.replace(/\n\s*/g, '\n  ');
    const text = `${sel} {\n  ${body}\n}`;
    if (rule.media) {
      const item = { sel, text };
      const last = kept[kept.length - 1];
      if (last && last.media === rule.media) last.items.push(item);
      else kept.push({ media: rule.media, items: [item] });
    } else {
      kept.push({ media: null, text });
    }
  }

  const lines = [`/* ${scope} — the page's own rules, kept inside its content */`];
  for (const k of kept) {
    if (k.items) {
      lines.push(`${k.media} {`);
      for (const it of k.items) lines.push(it.text.replace(/^/gm, '  '));
      lines.push('}');
    } else {
      lines.push(k.text);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- case pages

for (const { id } of SITE) {
  const c = caseOf(id);
  const content = pageContent(id);
  const body = `<main class="wrap" data-case="${id}">
${content}

${pager(id)}
</main>`;

  const caseCss = `${id}.css`;
  const caseStyles = scopedCaseCss(read(`content/${id}.html`), '[data-case]');
  write(`dist/${caseCss}`, caseStyles);
  const caseV = stamp(caseStyles);

  write(
    `dist/${id}/index.html`,
    shell({
      title: `${c.pl} — the Polish ${c.en}, from zero to confident`,
      description: `${c.pl}, the Polish ${c.en} case (${c.q}) — the full reference, the traps, and ${c.count} drills that explain every answer.`,
      activeId: id,
      body,
      caseCss,
      v: { css: cssV, case: caseV, cat: catV, app: appV },
    })
  );
  console.log(`built ${id}`);
}

// ---------------------------------------------------------------- home

function home() {
  const cards = SITE.map(({ id }) => {
    const c = caseOf(id);
    return `  <a class="ccard" href="/${id}/" data-case-card="${id}">
    <div class="top"><span class="num">${c.n} of 7</span><span class="num">${c.count} drills</span></div>
    <div class="nm">${esc(c.pl)}</div>
    <div class="en">${esc(c.en)} · ${esc(c.q)}</div>
    <p class="q">${esc(SHORT[id])}</p>
    <div class="meter">
      <div class="bar"><i data-case-bar="${id}"></i></div>
      <span class="lbl" data-case-lbl="${id}">not started</span>
    </div>
  </a>`;
  }).join('\n');

  const body = `<main class="wrap">
<div class="home-hero">
  <p class="kicker">Polish cases · seven pages, one site</p>
  <h1>Polski<br><em>the seven cases</em></h1>
  <p class="lede">
    Nominative, genitive, dative, accusative, instrumental, locative, vocative — each with its full
    reference, the traps that catch learners, and drills that explain every answer.
    <b>${catalog.total}</b> drills in all, and your progress is kept as you go.
  </p>
  <div class="cta">
    <a class="btn primary" href="/today/">Today's lesson</a>
    <a class="btn ghost" href="/nominative/">Start with the nominative</a>
    <a class="btn ghost" href="/progress/">My progress</a>
  </div>
</div>

<section>
  <div class="shead"><div class="snum">01</div><h2>The seven cases</h2></div>
  <p>Work them in this order: each case builds on the ones before it. Every card opens the full page for that case,
  with its reference tables and its own drills.</p>
  <div class="hub">
${cards}
  </div>
</section>

<section>
  <div class="shead"><div class="snum">02</div><h2>Where you stand</h2></div>
  <div class="stats">
    <div class="stat"><div class="v" data-stat="drills">0</div><div class="l">drills answered</div></div>
    <div class="stat"><div class="v" data-stat="acc">—</div><div class="l">correct</div></div>
    <div class="stat"><div class="v" data-stat="due">—</div><div class="l">due for review</div></div>
    <div class="stat"><div class="v" data-stat="day">—</div><div class="l">day streak</div></div>
  </div>
  <div class="cta">
    <a class="btn primary" href="/today/">Start today's lesson</a>
    <a class="btn ghost" href="/mixed/">Mixed drill — all seven</a>
  </div>
</section>
</main>`;

  write(
    'dist/index.html',
    shell({
      title: 'Polski — the seven Polish cases, with drills',
      description:
        'All seven Polish cases — nominative, genitive, dative, accusative, instrumental, locative, vocative — in one site, with 1,275 drills that explain every answer.',
      activeId: null,
      body,
      v: { css: cssV, cat: catV, app: appV },
    })
  );
  console.log('built home');
}

home();

// ---------------------------------------------------------------- extra pages

function simplePage({ id, title, description, inner }) {
  const body = `<main class="wrap" data-page="${id}">
${inner}
</main>`;
  write(
    `dist/${id}/index.html`,
    shell({ title, description, activeId: null, body, v: { css: cssV, cat: catV, app: appV } })
  );
  console.log(`built ${id}`);
}

simplePage({
  id: 'mixed',
  title: 'Mixed drill — all seven Polish cases',
  description: 'One run across all seven Polish cases, starting with what you have missed before.',
  inner: `<div class="hero">
  <p class="kicker">All seven cases</p>
  <h1>Mixed drill<br><em>everything at once</em></h1>
  <p class="lede">One run across all seven cases. It starts with what the schedule says is due, then fills up
  with random items from every case — the only way to find out which case you actually know.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>The run</h2></div>
  <div class="drills">
    <div id="mixedRoot">
      <div class="cta">
        <button class="btn primary" id="mixedStart">Start a run of 20</button>
      </div>
    </div>
  </div>
</section>`,
});

simplePage({
  id: 'today',
  title: "Today's lesson — Polski",
  description: 'Twelve items drawn from all seven cases, review first, with spaced repetition.',
  inner: `<div class="hero">
  <p class="kicker">Short daily revision</p>
  <h1>Today<br><em>twelve items</em></h1>
  <p class="lede">Twelve items, about six minutes: what the schedule says is due comes first, then new material from
  the case you are on. Right answers wait longer each time; misses come straight back.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>Your lesson</h2></div>
  <div class="drills">
    <div id="todayRoot"><p class="small">Building today's lesson…</p></div>
  </div>
</section>`,
});

simplePage({
  id: 'progress',
  title: 'My progress — Polski',
  description: 'What you know per case, what is due for review, and every answer recorded.',
  inner: `<div class="hero">
  <p class="kicker">Progress</p>
  <h1>Progress<br><em>what you know</em></h1>
  <p class="lede">Every answer is recorded: which item, whether it was right, and when it comes back.
  “Known” counts items you have answered correctly at least twice in a row.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>By case</h2></div>
  <div id="progressRoot"><p class="small">Reading your progress…</p></div>
</section>
<section>
  <div class="shead"><div class="snum">02</div><h2>What is due</h2></div>
  <div id="dueRoot"></div>
  <div class="cta" style="margin-top:20px">
    <a class="btn primary" href="/today/">Start today's lesson</a>
    <button class="btn ghost" id="resetProgress">Clear all progress</button>
  </div>
</section>

<section>
  <div class="shead"><div class="snum">03</div><h2>Sync between devices</h2></div>
  <div id="syncRoot"><p class="small">Reading the sync state…</p></div>
</section>`,
});

// ---------------------------------------------------------------- assets

write('dist/site.css', css);
write('dist/app.js', appJs);
write(
  'dist/catalog.js',
  `window.POLSKI_CATALOG = ${JSON.stringify(catalog)};\nwindow.POLSKI_EXTRAS = ${JSON.stringify(extras)};\n`
);
write('dist/_headers', read('src/_headers'));
write(
  'dist/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#a4361f"/>
  <text x="32" y="46" font-family="Georgia, 'Times New Roman', serif" font-size="40" fill="#f7f3ea"
        text-anchor="middle">ł</text>
</svg>
`
);

console.log('\nsite built into dist/');
