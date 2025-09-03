// interactions/components/index.mjs
// Router für Component-Interactions (Selects/Buttons)

import { handleVoteReason } from "./vote-reason.mjs";

export async function onComponent(ctx) {
  try {
    // custom_id der Interaktion
    const id =
      (typeof ctx.customId === "function" && ctx.customId()) ||
      (ctx.interaction?.data?.custom_id ?? "") ||
      "";

    if (!id) {
      // Nichts zu routen
      return;
    }

    // ---- Vote: Grund-Auswahl -----------------------------------
    if (id.startsWith("vote:grund:")) {
      return handleVoteReason(ctx);
    }
    // ------------------------------------------------------------

    // Fallback: keine bekannte Komponente
    return;
  } catch (err) {
    console.error("[components/index] error:", err);
    // Wenn möglich, höflich die UI bereinigen
    if (typeof ctx.update === "function") {
      return ctx.update({
        content: "Upps. Da ist was schiefgelaufen.",
        components: []
      });
    }
  }
}
