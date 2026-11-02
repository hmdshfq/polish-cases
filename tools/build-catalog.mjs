// Turns the extracted question bank into the drill sets the site ships.
// Input: src/data/bank.json (1,275 items from the seven case pages)
// Output: src/data/catalog.json (seven cases, ordered, with their sets)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/bank.json'), 'utf8'));

// The order Polish grammars use, and the order the lessons follow.
export const CASES = [
  { id: 'nominative',   pl: 'Mianownik',   en: 'nominative',   q: 'kto? co?',            n: 1 },
  { id: 'genitive',     pl: 'Dopełniacz',  en: 'genitive',     q: 'kogo? czego?',        n: 2 },
  { id: 'dative',       pl: 'Celownik',    en: 'dative',       q: 'komu? czemu?',        n: 3 },
  { id: 'accusative',   pl: 'Biernik',     en: 'accusative',   q: 'kogo? co?',           n: 4 },
  { id: 'instrumental', pl: 'Narzędnik',   en: 'instrumental', q: 'kim? czym?',          n: 5 },
  { id: 'locative',     pl: 'Miejscownik', en: 'locative',     q: 'o kim? o czym?',      n: 6 },
  { id: 'vocative',     pl: 'Wołacz',      en: 'vocative',     q: 'no question word',    n: 7 },
];

// Typed answers may arrive nested ([[a, b]]); flatten to one list of accepted strings.
function flatten(x) {
  const out = [];
  (function walk(v) {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'string') out.push(v);
  })(x);
  return [...new Set(out)];
}

function normalize(item) {
  const base = {
    q: item.q,
    hint: item.hint || '',
    why: item.why || '',
  };
  if (item.kind === 'choice') {
    return { ...base, kind: 'choice', opts: item.opts, a: item.a };
  }
  const accept = flatten(item.accept);
  const display = flatten(item.display)[0] || accept[0] || '';
  return { ...base, kind: 'type', accept, display };
}

const cases = [];
const usedIds = new Set();

for (const meta of CASES) {
  const items = bank.filter((i) => i.caseId === meta.id);
  if (!items.length) throw new Error(`no items for case ${meta.id}`);

  // Group into sets by setId, keeping the order the pages use. A setId that
  // appears twice with different titles becomes setId-2, so ids stay unique.
  const groups = new Map();
  for (const item of items) {
    const key = item.setId + '\u0000' + item.setTitle;
    if (!groups.has(key)) {
      groups.set(key, {
        id: item.setId,
        title: item.setTitle,
        ask: item.setAsk,
        items: [],
      });
    }
    groups.get(key).items.push(normalize(item));
  }

  const sets = [];
  for (const set of groups.values()) {
    let id = set.id;
    let k = 2;
    while (usedIds.has(`${meta.id}/${id}`)) id = `${set.id}-${k++}`;
    usedIds.add(`${meta.id}/${id}`);
    sets.push({
      id,
      title: set.title,
      ask: set.ask,
      items: set.items,
      // Stable item ids for progress: case/set/index within the set.
    });
    sets[sets.length - 1].items = set.items.map((it, i) => ({
      id: `${meta.id}/${id}#${i}`,
      ...it,
    }));
  }

  const count = items.length;
  const typed = items.filter((i) => i.kind === 'type').length;
  cases.push({ ...meta, count, typed, sets });
}

const out = {
  builtAt: new Date().toISOString(),
  total: bank.length,
  cases,
};

fs.writeFileSync(
  path.join(ROOT, 'src/data/catalog.json'),
  JSON.stringify(out, null, 1)
);

for (const c of cases) {
  console.log(
    `${c.pl.padEnd(12)} ${String(c.count).padStart(4)} items  ${String(c.sets.length).padStart(2)} sets  ${String(c.typed).padStart(3)} typed`
  );
}
console.log(`total ${out.total} items in ${cases.reduce((n, c) => n + c.sets.length, 0)} sets`);
