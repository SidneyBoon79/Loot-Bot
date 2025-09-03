// interactions/modals/index.mjs
// Router für Modal-Submits (z. B. aus /vote -> makeVoteModal)

import { handleModalSubmit as handleVoteModalSubmit } from "../../commands/vote.mjs";

export async function onModalSubmit(ctx) {
  try {
    // custom_id des Modals holen (verschiedene Adapter möglich)
    const id =
      (typeof ctx.customId === "function" && ctx.customId()) ||
      (ctx.interaction?.data?.custom_id ?? "") ||
      "";

    if (!id) return;

    // ---- Vote: Modal -------------------------------------------
    if (id === "vote:modal") {
      return handleVoteModalSubmit(ctx);
    }
    // ------------------------------------------------------------

    // Fallback: keine bekannte Modal-ID
    return;
  } catch (err) {
    console.error("[modals/index] error:", err);
    // UI höflich bereinigen, wenn möglich
    if (typeof ctx.reply === "function") {
      return ctx.reply("Upps. Da ist was schiefgelaufen.", { ephemeral: true });
    }
  }
}
