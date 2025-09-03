// commands/vote.mjs — Vote Command mit Autocomplete + Modal + Grund-Dropdown
import { saveVote, isValidReason, prettyReason } from "../db/votes.mjs";

// ------------------
// Hilfsfunktionen
// ------------------
function normalizeItem(raw) {
  return (raw ?? "").trim().slice(0, 120);
}
function b64uEncode(s) {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// ------------------
// Command-Definition
// ------------------
export const command = {
  name: "vote",
  description:
    "Vote abgeben: Item (Autocomplete) oder per Modal eingeben → Grund wählen",
  options: [
    {
      type: 3, // STRING
      name: "item",
      description:
        "Item-Name (Autocomplete). Leer lassen für manuelle Eingabe im Modal.",
      required: false,
      autocomplete: true,
    },
  ],
};

// ------------------
// Command-Handler
// ------------------
export async function run(ctx) {
  const hasItemOpt = typeof ctx?.opts?.getString === "function";
  const itemFromOpt = hasItemOpt ? ctx.opts.getString("item") : null;

  // Falls Item per Autocomplete ausgewählt → direkt Dropdown
  if (itemFromOpt && itemFromOpt.trim()) {
    const itemName = normalizeItem(itemFromOpt);
    const encoded = b64uEncode(itemName);

    return ctx.reply({
      content: `Item: **${itemName}**\nWähle jetzt den **Grund**:`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "vote:grund:" + encoded,
              placeholder: "Grund auswählen …",
              min_values: 1,
              max_values: 1,
              options: [
                {
                  label: "Gear (⚔️)",
                  value: "gear",
                  description: "Direktes Upgrade",
                },
                {
                  label: "Trait (💠)",
                  value: "trait",
                  description: "Build-Trait",
                },
                {
                  label: "Litho (📜)",
                  value: "litho",
                  description: "Rezept/Schrift",
                },
              ],
            },
          ],
        },
      ],
      ephemeral: true,
    });
  }

  // Sonst → klassisches Modal öffnen
  const modal = makeVoteModal();
  if (typeof ctx.showModal === "function") return ctx.showModal(modal);
  if (typeof ctx.replyModal === "function") return ctx.replyModal(modal);
  return ctx.reply(modal, { modal: true });
}

// ------------------
// Modal-Erstellung
// ------------------
export function makeVoteModal() {
  return {
    custom_id: "vote:modal",
    title: "Vote abgeben",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "vote:item",
            style: 1,
            label: "Item (z. B. Schwert, Ring, Bogen …)",
            placeholder: "Schwert der Abenddämmerung",
            required: true,
            max_length: 120,
          },
        ],
      },
    ],
  };
}

// -----------------------------
// Modal-Submit → Grund-Dropdown
// -----------------------------
export async function handleModalSubmit(ctx) {
  const comps = ctx.interaction?.data?.components ?? [];
  const firstRow = comps[0]?.components?.[0];
  const rawItem = firstRow?.value ?? "";
  const itemName = normalizeItem(rawItem);

  if (!itemName) {
    return ctx.reply("Bitte gib ein Item an.", { ephemeral: true });
  }

  const encoded = b64uEncode(itemName);

  return ctx.reply(
    {
      content: `Wähle den Grund für **${itemName}**:`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "vote:grund:" + encoded,
              placeholder: "Grund auswählen …",
              min_values: 1,
              max_values: 1,
              options: [
                {
                  label: "Gear (⚔️)",
                  value: "gear",
                  description: "Direktes Upgrade",
                },
                {
                  label: "Trait (💠)",
                  value: "trait",
                  description: "Build-Trait",
                },
                {
                  label: "Litho (📜)",
                  value: "litho",
                  description: "Rezept/Schrift",
                },
              ],
            },
          ],
        },
      ],
    },
    { ephemeral: true }
  );
}

// ----------------------------------------------------
// Dropdown-Auswahl (ctx.item + ctx.reason) → Save Vote
// ----------------------------------------------------
export async function handleReasonSelect(ctx) {
  const itemName = normalizeItem(ctx.item);
  const reason = (ctx.reason ?? "").trim();

  if (!itemName) {
    return ctx.followUp("Item fehlt.", { ephemeral: true });
  }
  if (!isValidReason(reason)) {
    return ctx.followUp("Ungültiger Grund.", { ephemeral: true });
  }

  const result = await saveVote(
    {
      guild_id: ctx.guildId,
      user_id: ctx.userId,
      item_name: itemName,
      reason,
    },
    ctx.db
  );

  if (!result.ok && result.alreadyVoted) {
    return ctx.followUp(
      `Du hast bereits für **${result.item_name_first}** gevotet.\n` +
        `Ändern: erst \`/vote-remove item:${result.item_name_first}\`, dann neu voten.`,
      { ephemeral: true }
    );
  }

  return ctx.followUp(
    `✅ Vote gespeichert:\n• **Item:** ${result.item_name_first}\n• **Grund:** ${prettyReason(
      reason
    )}`,
    { ephemeral: true }
  );
}
