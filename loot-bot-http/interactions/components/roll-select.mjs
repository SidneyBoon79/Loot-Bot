// interactions/components/roll-select.mjs
// Handler für das String-Select aus /roll (ohne Argument).
// Liest die Auswahl, extrahiert itemSlug/itemNameFirst und ruft den Roll-Handler.

import { run as rollRun } from "../../commands/roll.mjs"; // Pfad ggf. anpassen

function parseSelection(ctx) {
  // Versuche values vom Router/Discord zu lesen:
  // - ctx.values (bereits geparst)
  // - ctx.interaction?.data?.values (rohe Strings)
  const raw = ctx.values?.[0] || ctx.value || ctx.interaction?.data?.values?.[0];
  if (!raw) return null;

  // Falls wir im Select JSON-Strings gesetzt haben, hier parsen:
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (obj && obj.itemSlug) return { itemSlug: obj.itemSlug, itemNameFirst: obj.itemNameFirst || obj.itemSlug };
  } catch (_) {
    // Fallback: roher Slug
  }
  // Fallback: treat as slug only
  return { itemSlug: String(raw), itemNameFirst: String(raw) };
}

export async function run(ctx) {
  const guildId = ctx.guildId || ctx.guild_id || ctx.guild?.id;
  if (!guildId) return ctx.reply?.({ content: "Kein Guild-Kontext.", ephemeral: true });

  const sel = parseSelection(ctx);
  if (!sel) return ctx.reply?.({ content: "Keine gültige Auswahl erhalten.", ephemeral: true });

  // Kontext für den Roll-Command anreichern
  const ctx2 = {
    ...ctx,
    options: {
      itemSlug: sel.itemSlug,
      itemNameFirst: sel.itemNameFirst,
    }
  };

  // Direkt den Roll-Handler ausführen
  return rollRun(ctx2);
}

// Exportobjekt, falls der Router `roll_select.run(ctx)` erwartet
export const roll_select = { run };
export default roll_select;
