// commands/vote.mjs — FINAL (Autocomplete + Dropdown, ohne Modal)
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
    const item = ctx?.opts?.getString?.("item");
    if (!item) {
      return ctx.reply("❌ Bitte gib ein Item an.", { ephemeral: true });
    }

    // Dropdown bauen (custom_id trägt das Item)
    const customId = `vote:grund:${b64u(item)}`;
    const row = reasonSelect(customId); // <- Action Row mit String-Select

    // Sofort ephemer antworten (string/obj wird in server/index.mjs normalisiert)
    return ctx.reply(
      {
        content: `📦 Item **${item}** gewählt. Bitte wähle einen Grund:`,
        components: [row],
      },
      { ephemeral: true }
    );
  } catch (e) {
    console.error("[commands/vote] error:", e);
    return ctx.reply("❌ Fehler beim Ausführen von /vote.", { ephemeral: true });
  }
}

export default { run };
