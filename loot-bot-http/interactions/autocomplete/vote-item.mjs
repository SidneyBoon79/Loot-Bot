// interactions/autocomplete/vote-item.mjs
// Liefert Vorschläge für das /vote item-Feld (Autocomplete, nur Itemnamen)

import { searchItems } from "../../services/itemsCatalog.mjs";

export async function handleVoteItemAutocomplete(ctx) {
  try {
    // Optional: nur reagieren, wenn es wirklich der /vote-Command ist
    if (typeof ctx.commandName === "function" && ctx.commandName() !== "vote") {
      return;
    }

    // Fokussierter Eingabewert (vom User getippt)
    const focused =
      (typeof ctx.getFocusedOptionValue === "function"
        ? ctx.getFocusedOptionValue()
        : typeof ctx.focusedValue === "function"
        ? ctx.focusedValue()
        : "") || "";

    // Suche im in-memory Katalog (max. 25 Ergebnisse)
    const results = await searchItems(focused);
    const choices = results.slice(0, 25).map((name) => ({ name, value: name }));

    // Antwort an Discord senden
    return ctx.respond(choices);
  } catch (err) {
    console.error("[autocomplete] vote-item error:", err);
    // UX: still & freundlich bleiben – bei Fehler einfach keine Vorschläge senden
    return ctx.respond([]);
  }
}
