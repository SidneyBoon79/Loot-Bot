// interactions/components/index.mjs
// Router für Component-Interactions (Dropdowns/Buttons)

import { handleVoteReason } from "./vote-reason.mjs";
import { handleRollSelect } from "./roll-select.mjs";
import {
  handleRerollSelect,
  handleRerollConfirm,
  handleRerollCancel
} from "./reroll-select.mjs";

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

    // ---- Roll: Item-Auswahl -------------------------
    if (id === "roll:select") {
      return handleRollSelect(ctx);
    }

    // ---- Re-Roll Flow -------------------------------
    if (id === "reroll:select") {
      return handleRerollSelect(ctx);
    }
    if (id.startsWith("reroll:confirm:")) {
      return handleRerollConfirm(ctx);
    }
    if (id.startsWith("reroll:cancel:")) {
      return handleRerollCancel(ctx);
    }
    // -------------------------------------------------

    // Fallback: keine bekannte Komponente
    return;
  } catch (err) {
    console.error("[components/index] error:", err);

    if (typeof ctx.update === "function") {
      return ctx.update({
        content: "Upps. Da ist was schiefgelaufen.",
        components: []
      });
    }
  }
}
