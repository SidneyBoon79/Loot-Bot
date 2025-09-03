// interactions/autocomplete/vote-item.mjs — FINAL v2 (robust)
// Liest Itemnamen aus data/items.json und liefert bis zu 25 Choices.
// Robust gegen Pfad-/Parse-Fehler, immer eine gültige Antwort.

import fs from 'fs';
import { fileURLToPath } from 'url';

function loadItems() {
  try {
    const url = new URL('../../data/items.json', import.meta.url);
    const raw = fs.readFileSync(fileURLToPath(url), 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : [];
    return list
      .map((x) => (typeof x === 'string' ? x : x && typeof x.name === 'string' ? x.name : null))
      .filter(Boolean);
  } catch (e) {
    console.error('[autocomplete/vote-item] Katalog-Fehler:', e);
    return [];
  }
}

function search(items, q) {
  if (!q) return items.slice(0, 25);
  const s = String(q).toLowerCase();
  const starts = [];
  const contains = [];
  for (const name of items) {
    const ln = name.toLowerCase();
    if (ln.startsWith(s)) starts.push(name);
    else if (ln.includes(s)) contains.push(name);
    if (starts.length + contains.length >= 200) break; // Vorfilter
  }
  return [...starts, ...contains].slice(0, 25);
}

export async function handleVoteItemAutocomplete(ctx) {
  try {
    const focused = typeof ctx.getFocusedOptionValue === 'function' ? ctx.getFocusedOptionValue() : null;
    const items = loadItems();
    const results = search(items, focused);
    const choices = results.map((name) => ({ name, value: name })).slice(0, 25);
    return ctx.respond(choices);
  } catch (e) {
    console.error('[autocomplete/vote-item] error:', e);
    return ctx.respond([]);
  }
}

export default { handleVoteItemAutocomplete };
