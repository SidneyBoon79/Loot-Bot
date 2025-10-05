// interactions/autocomplete/vote-item.mjs
// Lädt /app/data/items.json (relativ zu process.cwd()) und liefert bis zu 25 Vorschläge.

import fs from "fs";
import path from "path";

// einmaliger Lazy-Cache
let CATALOG = null;

function loadCatalog() {
  if (CATALOG) return CATALOG;
  try {
    const p = path.resolve(process.cwd(), "data", "items.json");
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    CATALOG = (Array.isArray(json) ? json : [])
      .map(x => (typeof x === "string" ? x : (x && typeof x.name === "string" ? x.name : null)))
      .filter(Boolean);
  } catch (e) {
    console.error("[autocomplete/vote-item] items.json laden fehlgeschlagen:", e);
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
    if (starts.length + contains.length >= 200) break; // einfache Deckelung
  }

  return [...starts, ...contains].slice(0, 25);
}

// Fallback: direkt die fokussierte Option aus dem Roh-Payload lesen,
// falls der Adapter keine getFocusedOptionValue()-Hilfe bereitstellt
function getFocused(ctx) {
  try {
    if (typeof ctx.getFocusedOptionValue === "function") {
      return ctx.getFocusedOptionValue();
    }
    const opts = ctx?.interaction?.data?.options || [];
    const f = Array.isArray(opts) ? opts.find(o => o?.focused) : null;
    return f?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * NAMED EXPORT – genau so erwartet es interactions/autocomplete/index.mjs
 */
export async function handleVoteItemAutocomplete(ctx) {
  try {
    const q = getFocused(ctx);
    const results = search(q);
    const choices = results.map(name => ({ name, value: name })).slice(0, 25);
    return ctx.respond(choices);
  } catch (e) {
    console.error("[autocomplete/vote-item] handler error:", e);
    return ctx.respond([]); // still und freundlich scheitern
  }
}

// optionaler default export schadet nicht, wird aber nicht benötigt
export default { handleVoteItemAutocomplete };
