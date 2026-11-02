// Pulls the extra study data out of the seven pages' own scripts:
// the verified reference tables, flashcards, 7-day plans and verb lists.
// They are plain literals, so they are evaluated here and saved as JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAGES = {
  nominative: 'nominative',
  genitive: 'genitive',
  dative: 'dative',
  accusative: 'accusative',
  instrumental: 'instrumental',
  locative: 'locative',
  vocative: 'vocative',
};

function scriptOf(file) {
  const html = fs.readFileSync(path.join(ROOT, 'content', file), 'utf8');
  const parts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!parts.length) throw new Error(`no inline script in ${file}`);
  return parts.join('\n');
}

function literal(script, name) {
  const re = new RegExp(`(?:const|var|let)\\s+${name}\\s*=\\s*`);
  const m = re.exec(script);
  if (!m) return null;
  // Walk from the opening bracket to its match, respecting strings.
  let i = m.index + m[0].length;
  while (i < script.length && /\s/.test(script[i])) i++;
  const open = script[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`${name} in ${file} is not a literal`);
  let depth = 0;
  let quote = null;
  let esc = false;
  for (let j = i; j < script.length; j++) {
    const ch = script[j];
    if (quote) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const src = script.slice(i, j + 1);
        // eslint-disable-next-line no-new-func
        return new Function(`return (${src});`)();
      }
    }
  }
  throw new Error(`unterminated ${name}`);
}

const out = {};

out.nominative = {
  ref: { mode: 'bold4', rows: literal(scriptOf('nominative.html'), 'REF') },
};
out.genitive = {
  ref: { mode: 'plain4', rows: literal(scriptOf('genitive.html'), 'REF') },
};
out.accusative = {
  ref: { mode: 'plain4', rows: literal(scriptOf('accusative.html'), 'REF') },
};
out.vocative = {
  ref: { mode: 'merge3', rows: literal(scriptOf('vocative.html'), 'REF') },
};
out.locative = {
  ref: { mode: 'objects', rows: literal(scriptOf('locative.html'), 'REF') },
};

for (const id of ['instrumental', 'locative']) {
  const s = scriptOf(`${id}.html`);
  out[id] = out[id] || {};
  out[id].cards = literal(s, 'CARDS');
  out[id].plan = literal(s, 'PLAN');
  out[id].verbs = literal(s, 'VERBS');
}

// The dative page lists its verbs as plain tables in the HTML, not in a script.
for (const [id, o] of Object.entries(out)) {
  if (o.ref) console.log(`${id}: ${o.ref.rows.length} reference rows (${o.ref.mode})`);
  if (o.cards) console.log(`${id}: ${o.cards.length} cards, ${o.plan.length} plan days, ${o.verbs.length} verbs`);
}

fs.mkdirSync(path.join(ROOT, 'src/data'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'src/data/extras.json'),
  JSON.stringify(out, null, 1)
);
console.log('wrote src/data/extras.json');
