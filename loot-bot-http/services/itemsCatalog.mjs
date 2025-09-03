import fs from "node:fs/promises";
import path from "node:path";

// Hilfsfunktion: Itemnamen vereinheitlichen
function normalizeName(s) {
  return s
    .normalize("NFKD")                // Sonderzeichen zerlegen
    .replace(/[\u0300-\u036f]/g, "")  // Akzente entfernen
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")      // Sonderzeichen -> Leerzeichen
    .trim();
}

let CACHE = null; // { list: [{display, norm}], set: Set<string> }

export async function getItemsCatalog() {
  if (CACHE) return CACHE;
  const filePath = path.resolve(process.cwd(), "data/items.json");
  const raw = await fs.readFile(filePath, "utf8");
  const names = JSON.parse(raw);

  const list = names.map(d => ({ display: d, norm: normalizeName(d) }));
  CACHE = { list, set: new Set(list.map(x => x.norm)) };
  return CACHE;
}

export async function searchItems(query) {
  const { list } = await getItemsCatalog();
  const q = normalizeName(query || "");
  if (!q) return []; // leere Eingaben -> keine Vorschläge

  const exact    = list.filter(x => x.norm === q).map(x => x.display);
  const prefix   = list.filter(x => x.norm.startsWith(q)).map(x => x.display);
  const contains = list.filter(x => x.norm.includes(q)).map(x => x.display);

  return [...new Set([...exact, ...prefix, ...contains])].slice(0, 25);
}
