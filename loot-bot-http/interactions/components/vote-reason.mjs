// interactions/components/vote-reason.mjs
// Erwartet custom_id-Format: "vote:reason:<url-encodeter Itemname>"

import { saveVote } from "../../db/votes.mjs"; // passe den Pfad an deine DB-Helper an

export async function handleVoteReason(ctx) {
  try {
    const id = ctx.customId?.() || "";
    if (!id.startsWith("vote:reason:")) return;

    const enc = id.split(":").slice(2).join(":");
    const itemName = decodeURIComponent(enc);
    const grund = Array.isArray(ctx.values?.()) ? ctx.values()[0] : "gear";

    await saveVote({
      guild_id: ctx.guildId?.(),
      user_id: ctx.userId?.(),
      item_name: itemName,
      reason: grund
    });

    return ctx.update({
      content: `✅ Vote gespeichert für **${itemName}** — Grund: **${grund.toUpperCase()}**.`,
      components: []
    });
  } catch (err) {
    console.error("[components:vote-reason] error:", err);
    return ctx.update?.({
      content: "Upps. Konnte den Vote gerade nicht speichern.",
      components: []
    });
  }
}
