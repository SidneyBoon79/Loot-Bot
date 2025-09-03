// interactions/autocomplete/vote-item.mjs
// Liefert Vorschläge für das /vote item-Feld (Autocomplete, nur Itemnamen)

import { searchItems } from "../../services/itemsCatalog.mjs";

export async function handleVoteItemAutocomplete(ctx) {
  try {
    // Aktuell vom User getippter Wert
    const focused =
      (typeof ctx.getFocusedOptionValue === "function"
        ? ctx.getFocusedOptionValue()
        : ctx.interaction?.data?.options?.find?.(o => o.focused)?.value
      ) || "";

    // Suche im Katalog
    const results = await searchItems(focused);

    // In Discord-Format umwandeln
    const choices = results.slice(0, 25).map(name => ({
      name,
      value: name
    }));

    // Antwort senden
    return ctx.respond(choices);
  } catch (err) {
    console.error("[autocomplete/vote-item] error:", err);
    if (typeof ctx.respond === "function") {
      return ctx.respond([]); // Leere Antwort, falls Fehler
    }
  }
}
