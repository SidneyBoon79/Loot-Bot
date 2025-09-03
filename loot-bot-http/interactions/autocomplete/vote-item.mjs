// interactions/autocomplete/vote-item.mjs — FINAL
// Liest Itemnamen aus data/items.json und liefert bis zu 25 Choices.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// items.json liegt unter ../../data/items.json relativ zu diesem File
const ITEMS_PATH = path.resolve(__dirname, '../../data/items.json');

// Lazy-Cache für Items
let CATALOG = null;

function loadCatalog() {
  if (CATALOG) return CATALOG;
  try {
    const raw = fs.readFileSync(ITEMS_PATH, 'utf8');
    const data = JSON.parse(raw);
    // items.json darf Strings oder Objekte {name:""} enthalten
    CATALOG = (Array.isArray(data) ? data : []).map(x => {
      if (typeof x === 'string') return x;
      if (x && typeof x.name === 'string') return x.name;
      return null;
    }).filter(Boolean);
  } catch (e) {
    console.error('[autocomplete/vote-item] Katalog konnte nicht geladen werden:', e);
    CATALOG = [];
  }
  return CATALOG;
}

function searchItems(q) {
  const items = loadCatalog();
  if (!q) return items.slice(0, 25);

  const s = String(q).toLowerCase();
  // Priorität: startsWith > includes
  const starts = [];
  const contains = [];
  for (const name of items) {
    const ln = name.toLowerCase();
    if (ln.startsWith(s)) starts.push(name);
    else if (ln.includes(s)) contains.push(name);
    if (starts.length + contains.length >= 100) break; // vorfilter
  }
  const merged = [...starts, ...contains];
  // Discord-Limit 25
  return merged.slice(0, 25);
}

// ===== PUBLIC API für den Router =====
export async function handleVoteItemAutocomplete(ctx) {
  try {
    // In server/index.mjs bereitgestellt:
    const q = ctx.getFocusedOptionValue ? ctx.getFocusedOptionValue() : null;
    const results = searchItems(q);

    const choices = results.map(name => ({
      name,
      value: name,
    })).slice(0, 25);

    return ctx.respond(choices);
  } catch (e) {
    console.error('[autocomplete/vote-item] error:', e);
    // Leere Antwort, damit Discord nicht „Optionen können nicht geladen werden“ zeigt
    return ctx.respond([]);
  }
}

// Default-Export optional, falls woanders default import genutzt wurde
export default { handleVoteItemAutocomplete };
