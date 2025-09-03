// interactions/autocomplete/index.mjs
// Router für Autocomplete-Events

import { handleVoteItemAutocomplete } from "./vote-item.mjs";

export async function onAutocomplete(ctx) {
  try {
    const name =
      (typeof ctx.commandName === "function" && ctx.commandName()) ||
      ctx.interaction?.data?.name ||
      "";

    const focused =
      (typeof ctx.focusedOptionName === "function" && ctx.focusedOptionName()) ||
      ctx.interaction?.data?.options?.find?.(o => o.focused)?.name ||
      "";

    if (name === "vote" && focused === "item") {
      return handleVoteItemAutocomplete(ctx);
    }

    // Kein Match → leere Antwort
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
