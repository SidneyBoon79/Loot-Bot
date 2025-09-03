// interactions/components/vote-reason.mjs
// Erwartetes custom_id-Format: "vote:grund:<base64url itemname>"

import { saveVote, isValidReason, prettyReason } from "../../db/votes.mjs";

function b64uDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}

export async function handleVoteReason(ctx) {
  try {
    const id =
      (typeof ctx.customId === "function" && ctx.customId()) ||
      ctx.interaction?.data?.custom_id ||
      "";

    if (!id.startsWith("vote:grund:")) return;

    // Item aus custom_id extrahieren
    const encItem = id.slice("vote:grund:".length);
    const itemName = b64uDecode(encItem).trim();

    // Auswahlwert(e) auslesen
    const values =
      (typeof ctx.values === "function" && ctx.values()) ||
      ctx.interaction?.data?.values ||
      [];
    const reason = Array.isArray(values) && values.length ? values[0] : "";

    if (!itemName) {
      return ctx.update({
        content: "Item fehlt.",
        components: [],
      });
    }
    if (!isValidReason(reason)) {
      return ctx.update({
        content: "Ungültiger Grund.",
        components: [],
      });
    }

    // Vote speichern
    const result = await saveVote(
      {
        guild_id: ctx.guildId?.(),
        user_id: ctx.userId?.(),
        item_name: itemName,
        reason,
      },
      ctx.db
    );

    if (!result.ok && result.alreadyVoted) {
      return ctx.update({
        content:
          `Du hast bereits für **${result.item_name_first}** gevotet.\n` +
          `Ändern: erst \`/vote-remove item:${result.item_name_first}\`, dann neu voten.`,
        components: [],
      });
    }

    return ctx.update({
      content: `✅ Vote gespeichert:\n• **Item:** ${result.item_name_first}\n• **Grund:** ${prettyReason(
        reason
      )}`,
      components: [],
    });
  } catch (err) {
    console.error("[components/vote-reason] error:", err);
    if (typeof ctx.update === "function") {
      return ctx.update({
        content: "Upps. Da ist was schiefgelaufen.",
        components: [],
      });
    }
  }
}
