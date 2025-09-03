// commands/vote.mjs
// Flow: /vote -> Item (Autocomplete) -> Dropdown mit Gründen -> Component speichert Vote

import { reasonSelect } from "../ui/reasonSelect.mjs";

function b64u(s) {
  return Buffer.from(String(s), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function run(ctx) {
  try {
    const item = ctx?.opts?.getString("item");

    if (!item) {
      return ctx.reply("❌ Bitte gib ein Item an.", { ephemeral: true });
    }

    // Baue Dropdown mit custom_id, die das Item trägt
    const customId = `vote:grund:${b64u(item)}`;
    const dropdown = reasonSelect(customId);

    return ctx.reply(
      {
        content: `📦 Item **${item}** gewählt. Bitte wähle einen Grund:`,
        components: [dropdown],
      },
      { ephemeral: true }
    );
  } catch (e) {
    console.error("[commands/vote] error:", e);
    return ctx.reply("❌ Fehler beim Ausführen von /vote.", { ephemeral: true });
  }
}
