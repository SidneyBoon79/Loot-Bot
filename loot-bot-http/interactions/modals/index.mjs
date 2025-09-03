// interactions/modals/index.mjs
// Router für Modal-Submits (z. B. aus /vote -> makeVoteModal)

import { handleModalSubmit as handleVoteModalSubmit } from "../../commands/vote.mjs";

export async function onModalSubmit(ctx) {
  try {
    const id =
      (typeof ctx.customId === "function" && ctx.customId()) ||
      ctx.interaction?.data?.custom_id ||
      "";

    if (!id) return;

    // ---- Vote: Modal -------------------------------
    if (id === "vote:modal") {
      return handleVoteModalSubmit(ctx);
    }
    // ------------------------------------------------

    // Unbekanntes Modal → einfach ignorieren
    return;
  } catch (err) {
    console.error("[modals/index] error:", err);

    // Höfliche Fehlermeldung zurückgeben
    if (typeof ctx.reply === "function") {
      return ctx.reply("Upps. Da ist was schiefgelaufen.", { ephemeral: true });
    }
    if (typeof ctx.update === "function") {
      return ctx.update({
        content: "Upps. Da ist was schiefgelaufen.",
        components: [],
      });
    }
  }
}
