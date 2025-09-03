// interactions/components/index.mjs
import { handleVoteReason } from "./vote-reason.mjs";

export async function onComponent(ctx) {
  const id = typeof ctx.customId === "function" ? ctx.customId() : "";
  if (!id) return;

  if (id.startsWith("vote:reason:")) {
    return handleVoteReason(ctx);
  }

  // weitere Komponenten später hier routen …
}
