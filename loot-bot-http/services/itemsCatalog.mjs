// services/itemsCatalog.mjs
// Lädt data/items.json, cached sie in-memory und stellt eine schnelle Suche bereit.
// Regeln:
// - Autocomplete liefert max. 25 Treffer
// - Leere Eingabe -> KEINE Vorschläge ([])
//
// Nutzung:
//   import { searchItems, getItemsCatalog } from "../services/itemsCatalog.mjs";
//   const names = await searchItems(userInput);

import fs from "node:fs/promises";
import path from "node:path";

/** Normalisiert Itemnamen für robuste Suche (case/diakritik-insensitiv). */
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Akzente/Diakritika entfernen
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")     // Sonderzeichen -> Space
    .trim();
}

/** Interner Cache: einmal laden, dann aus dem RAM bedienen. */
let CACHE = null; // { list: Array<{display:string, norm:string}>, set: Set<string> }

/** Lädt den Katalog (falls nötig) und gibt Cache zurück. */
export async function getItemsCatalog() {
  if (CACHE) return CACHE;

  const filePath = path.resolve(process.cwd(), "data/items.json");
  let raw;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    console.error(`[itemsCatalog] Konnte ${filePath} nicht lesen:`, err);
    throw new Error("items.json fehlt oder ist nicht lesbar.");
  }

  let names;
  try {
    names = JSON.parse(raw);
    if (!Array.isArray(names)) throw new Error("items.json muss ein Array sein.");
  } catch (err) {
    console.error("[itemsCatalog] JSON-Fehler:", err);
    throw new Error("items.json enthält ungültiges JSON.");
  }

  // Deduplizieren + normalisieren
  const seen = new Set();
  const list = [];
  for (const d of names) {
    const display = String(d || "").trim();
    if (!display) continue;
    const norm = normalizeName(display);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    list.push({ display, norm });
  }

  CACHE = { list, set: new Set(list.map(x => x.norm)) };
  return CACHE;
}

/**
 * Sucht im Katalog nach einem Query.
 * Ranking: exact > prefix > contains. Rückgabe ist Array von Display-Namen.
 * Leerer Query -> [] (keine Top-Listen).
 */
export async function searchItems(query) {
  const q = normalizeName(query || "");
  if (!q) return []; // keine Vorschläge bei leerer Eingabe

  const { list } = await getItemsCatalog();

  // Schnelle lineare Suche – performant genug für einige 10k Items in-memory.
  const exact = [];
  const prefix = [];
  const contains = [];

  for (const x of list) {
    if (x.norm === q) {
      exact.push(x.display);
    } else if (x.norm.startsWith(q)) {
      prefix.push(x.display);
    } else if (x.norm.includes(q)) {
      contains.push(x.display);
    }
    // Early-exit optional: wenn genug Treffer – aber wir mergen später ohnehin
  }

  // Zusammenführen & auf 25 begrenzen
  const merged = [...new Set([...exact, ...prefix, ...contains])];
  return merged.slice(0, 25);
}

/** Optional: prüft, ob ein Item im Katalog existiert (nach Normalisierung). */
export async function isInCatalog(displayName) {
  const { set } = await getItemsCatalog();
  return set.has(normalizeName(displayName));
}

/** Hilfsfunktion, um den Cache manuell zu leeren (z. B. bei Hot-Reload). */
export function resetItemsCatalogCache() {
  CACHE = null;
}
