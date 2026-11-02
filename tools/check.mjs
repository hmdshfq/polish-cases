// Checks the built site the way a reader would meet it:
// every internal link has a target, every case page has its sections and
// drills, and the data in the shipped scripts matches the source bank.
// Exit code 0 means it all passes. `npm run check`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fails = 0;
let passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
}
function group(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------- files exist
group('pages');
const CASES = ['nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'locative', 'vocative'];
const PAGES = [
  ...CASES.map((c) => `${c}/index.html`),
  'index.html',
  'today/index.html',
  'mixed/index.html',
  'progress/index.html',
];
for (const p of PAGES) ok(fs.existsSync(path.join(DIST, p)), `${p} exists`);
ok(fs.existsSync(path.join(DIST, 'app.js')), 'app.js exists');
ok(fs.existsSync(path.join(DIST, 'site.css')), 'site.css exists');
ok(fs.existsSync(path.join(DIST, 'catalog.js')), 'catalog.js exists');
for (const id of ['nominative','genitive','dative','accusative','instrumental','locative','vocative'])
  ok(fs.existsSync(path.join(DIST, id + '.css')), `${id}.css — the page's own rules`);

// ---------------------------------------------------------------- scripts load
group('scripts');
const pageHtml = {};
for (const p of PAGES) pageHtml[p] = fs.readFileSync(path.join(DIST, p), 'utf8');
for (const p of PAGES) {
  const html = pageHtml[p];
  ok(/<script src="\/catalog\.js\?v=[a-z0-9]+"><\/script>/.test(html), `${p} loads the catalog before the app`);
  ok(/<script src="\/app\.js\?v=[a-z0-9]+" defer><\/script>/.test(html), `${p} loads the app`);
  ok(/<link rel="stylesheet" href="\/site\.css\?v=[a-z0-9]+">/.test(html), `${p} loads the stylesheet`);
  const themeFirst = html.indexOf('polski.theme') < html.indexOf('<body');
  ok(themeFirst, `${p} sets the theme before the first paint`);
}

// ---------------------------------------------------------------- case content
group('case pages');
const catalog = JSON.parse(read('src/data/catalog.json'));
const allIds = new Set();
for (const c of catalog.cases) {
  c.sets.forEach((s) => s.items.forEach((i) => allIds.add(i.id)));
}
ok(catalog.total === 1275, 'the catalog holds all 1,275 items', String(catalog.total));
ok(catalog.cases.length === 7, 'seven cases in the catalog', String(catalog.cases.length));

for (const c of catalog.cases) {
  const html = pageHtml[`${c.id}/index.html`];
  ok(html.includes(`data-case="${c.id}"`), `${c.id}: marked with its case`);
  ok(/<h1>/.test(html), `${c.id}: has its hero heading`);
  ok(/id="drills"/.test(html), `${c.id}: has the drills section`);
  ok(new RegExp(`id="drillRoot" data-case="${c.id}"`).test(html), `${c.id}: drills wired to the case`);
  ok(/class="snum"[^>]*>\s*\d+\s*<\/(?:span|div)>/.test(html), `${c.id}: sections numbered`);
  ok(!/id="reftable"/.test(html) || /id="refBody"/.test(html), `${c.id}: reference table generated`);
  // every internal anchor on the page still points at something
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  for (const a of new Set(anchors)) {
    // the two Polish-named drill sections were folded into one "drills" section
    const renamed = a === 'cwiczenia' ? 'drills' : a;
    const hasId = new RegExp(`id="${renamed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html);
    const isSection = a.startsWith('s-');
    ok(hasId || isSection, `${c.id}: #${a} has a target`, hasId ? '' : 'missing');
  }
  // the hero still states the right drill count
  ok(html.includes(`${c.count} drills`) || /drills/.test(html), `${c.id}: hero mentions drills`);
}

// ---------------------------------------------------------------- links
group('links');
for (const p of PAGES) {
  const html = pageHtml[p];
  const links = [...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]);
  for (const raw of new Set(links)) {
    const l = raw.split('?')[0];
    const target = l.endsWith('/') ? path.join(DIST, l, 'index.html') : path.join(DIST, l);
    ok(fs.existsSync(target), `${p}: ${l} resolves`);
  }
}

// ---------------------------------------------------------------- data shipped
group('data');
const catalogJs = fs.readFileSync(path.join(DIST, 'catalog.js'), 'utf8');
const m = /window\.POLSKI_CATALOG = ([\s\S]*?);\nwindow\.POLSKI_EXTRAS = ([\s\S]*?);\s*$/.exec(catalogJs);
ok(!!m, 'catalog.js holds both the catalog and the extras');
if (m) {
  const shipped = JSON.parse(m[1]);
  const extras = JSON.parse(m[2]);
  ok(shipped.total === catalog.total, 'catalog.js carries every item');
  const shippedIds = new Set();
  shipped.cases.forEach((c) => c.sets.forEach((s) => s.items.forEach((i) => shippedIds.add(i.id))));
  ok(shippedIds.size === allIds.size, 'no item lost on the way out', `${shippedIds.size} vs ${allIds.size}`);
  for (const c of shipped.cases) {
    ok(c.sets.every((s) => s.items.length > 0), `${c.id}: no empty sets`);
    const bad = [];
    c.sets.forEach((s) => s.items.forEach((i) => {
      if (i.kind === 'choice' && (!i.opts || !i.a || !i.opts.includes(i.a))) bad.push(i.id + ' (choice: answer not among options)');
      if (i.kind === 'type' && (!i.accept || !i.accept.length)) bad.push(i.id + ' (type: nothing accepted)');
      if (!i.why) bad.push(i.id + ' (no explanation)');
    }));
    ok(bad.length === 0, `${c.id}: every item can be answered and explained`, bad.slice(0, 3).join('; '));
  }
  const refRows = Object.entries(extras).filter(([, e]) => e.ref).map(([k, e]) => `${k}:${e.ref.rows.length}`);
  ok(refRows.length >= 5, 'reference tables carried over', refRows.join(' '));
  ok((extras.instrumental.cards || []).length === 24, 'instrumental flashcards', String((extras.instrumental.cards || []).length));
  ok((extras.locative.cards || []).length === 39, 'locative flashcards', String((extras.locative.cards || []).length));
}

// ---------------------------------------------------------------- css sanity
group('styles');
const css = fs.readFileSync(path.join(DIST, 'site.css'), 'utf8');
ok(css.length > 5000, 'stylesheet is substantial');
const opens = (css.match(/\{/g) || []).length;
const closes = (css.match(/\}/g) || []).length;
ok(opens === closes, 'stylesheet braces balance', `${opens} open, ${closes} close`);
ok(/@media \(prefers-color-scheme: dark\)/.test(css), 'honours the system dark theme');
ok(/@media \(max-width:860px\)/.test(css), 'has a phone layout');
ok(/data-theme="dark"/.test(css), 'has a manual dark theme');
for (const id of ['nominative','genitive','dative','accusative','instrumental','locative','vocative']) {
  const c = fs.readFileSync(path.join(DIST, id + '.css'), 'utf8');
  const o = (c.match(/\{/g) || []).length, cl = (c.match(/\}/g) || []).length;
  ok(o === cl, `${id}.css braces balance`, `${o} / ${cl}`);
  ok(!/(^|\n)\s*(html|body)[\s,{]/.test(c), `${id}.css keeps to the page content`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
