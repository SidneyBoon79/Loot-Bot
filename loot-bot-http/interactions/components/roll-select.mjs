// interactions/components/roll-select.mjs
// Handler für Auswahl im Dropdown von /roll (ohne Argument)

import { run as rollRun } from "../../commands/roll.mjs"; // Pfad ggf. anpassen

function parseSelection(ctx) {
  // Werte aus dem Interaction-CTX ziehen
  const raw = ctx.values?.[0] || ctx.interaction?.data?.values?.[0];
  if (!raw) return null;

  // Versuchen, JSON zu parsen (weil wir es so gesetzt haben)
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.itemSlug) {
      return { itemSlug: obj.itemSlug, itemNameFirst: obj.itemNameFirst || obj.itemSlug };
    }
  } catch (e) {
    // kein JSON → Fallback
  }

  // Fallback: Slug pur
  return { itemSlug: String(raw), itemNameFirst: String(raw) };
}

export async function run(ctx) {
  const guildId = ctx.guildId || ctx.guild_id || ctx.guild?.id;
  if (!guildId) {
    return ctx.reply?.({ content: "Kein Guild-Kontext.", ephemeral: true });
  }

  const sel = parseSelection(ctx);
  if (!sel) {
    return ctx.reply?.({ content: "Ungültige Auswahl erhalten.", ephemeral: true });
  }

  // Neuen Kontext bauen für den Roll-Handler
  const ctx2 = {
    ...ctx,
    options: {
      itemSlug: sel.itemSlug,
      itemNameFirst: sel.itemNameFirst,
    },
  };

  return rollRun(ctx2);
}

export const roll_select = { run };
export default roll_select;
