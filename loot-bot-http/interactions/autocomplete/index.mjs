// interactions/autocomplete/index.mjs
import { handleVoteItemAutocomplete } from "./vote-item.mjs";

export async function onAutocomplete(ctx) {
  try {
    const name = typeof ctx.commandName === "function" ? ctx.commandName() : "";
    const focusedName = typeof ctx.focusedOptionName === "function" ? ctx.focusedOptionName() : "";

    if (name === "vote" && focusedName === "item") {
      return handleVoteItemAutocomplete(ctx);
    }

    // Fallback: nichts zu tun
    return ctx.respond ? ctx.respond([]) : undefined;
  } catch (err) {
    console.error("[autocomplete:index] error:", err);
    if (ctx.respond) return ctx.respond([]);
  }
}
