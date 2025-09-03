// interactions/components/index.mjs
// Router für Component-Interactions (Dropdowns/Buttons)

import { handleVoteReason } from "./vote-reason.mjs";

export async function onComponent(ctx) {
  try {
    const id =
      (typeof ctx.customId === "function" && ctx.customId()) ||
      ctx.interaction?.data?.custom_id ||
      "";

    if (!id) return;

    // ---- Vote: Grund-Auswahl ------------------------
    if (id.startsWith("vote:grund:")) {
      return handleVoteReason(ctx);
    }
    // -------------------------------------------------

    // Fallback: keine bekannte Komponente
    return;
  } catch (err) {
    console.error("[components/index] error:", err);

    if (typeof ctx.update === "function") {
      return ctx.update({
        content: "Upps. Da ist was schiefgelaufen.",
        components: [],
      });
    }
  }
}
