// interactions/autocomplete/index.mjs
// Router für Autocomplete-Events. Leitet /vote -> item zum passenden Handler.

import { handleVoteItemAutocomplete } from "./vote-item.mjs";

export async function onAutocomplete(ctx) {
  try {
    const name =
      typeof ctx.commandName === "function" ? ctx.commandName() : "";
    const focused =
      typeof ctx.focusedOptionName === "function"
        ? ctx.focusedOptionName()
        : "";

    if (name === "vote" && focused === "item") {
      return handleVoteItemAutocomplete(ctx);
    }

    // Kein Match? Leere Antwort zurückgeben.
    if (typeof ctx.respond === "function") {
      return ctx.respond([]);
    }
  } catch (err) {
    console.error("[autocomplete/index] error:", err);
    if (typeof ctx.respond === "function") {
      return ctx.respond([]);
    }
  }
}
