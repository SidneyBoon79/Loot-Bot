// interactions/autocomplete/vote-item.mjs – FINAL v3
// Lädt /app/data/items.json (relativ zu process.cwd()) und liefert bis zu 25 Choices.

import fs from 'fs';
import path from 'path';

// Einmaliger Lazy-Cache
let CATALOG = null;

function loadCatalog() {
  if (CATALOG) return CATALOG;
  try {
    const p = path.resolve(process.cwd(), 'data', 'items.json');
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    CATALOG = (Array.isArray(json) ? json : [])
      .map(x => (typeof x === 'string' ? x : (x && typeof x.name === 'string') ? x.name : null))
      .filter(Boolean);
  } catch (e) {
    console.error('[autocomplete/vote-item] items.json laden fehlgeschlagen:', e);
    CATALOG = [];
  }
  return CATALOG;
}

function search(q) {
  const items = loadCatalog();
  if (!q) return items.slice(0, 25);
  const s = String(q).toLowerCase();

  const starts = [];
  const contains = [];
  for (const name of items) {
    const ln = name.toLowerCase();
    if (ln.startsWith(s)) starts.push(name);
    else if (ln.includes(s)) contains.push(name);
    if (starts.length + contains.length >= 200) break;
  }
  return [...starts, ...contains].slice(0, 25);
}

// Fallback: direkt aus der Interaction lesen, falls ctx.getFocusedOptionValue fehlt
function getFocused(ctx) {
  try {
    if (typeof ctx.getFocusedOptionValue === 'function') return ctx.getFocusedOptionValue();
    const opts = ctx?.interaction?.data?.options || [];
    const f = Array.isArray(opts) ? opts.find(o => o?.focused) : null;
    return f?.value ?? null;
  } catch {
    return null;
  }
}

export async function handleVoteItemAutocomplete(ctx) {
  try {
    const q = getFocused(ctx);
    const results = search(q);
    const choices = results.map(name => ({ name, value: name })).slice(0, 25);
    return ctx.respond(choices);
  } catch (e) {
    console.error('[autocomplete/vote-item] handler error:', e);
    return ctx.respond([]);
  }
}

// WICHTIG: named export (kein default-Objekt!)
export { handleVoteItemAutocomplete as default } // optional, falls irgendwo default erwartet wird
