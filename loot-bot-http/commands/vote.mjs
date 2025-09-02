// commands/vote.mjs — Modal + Dropdown (angepasst an dein Schema, mit reason=type Insert)
const VALID_REASONS = new Map([
  ["gear",  "⚔️ Gear"],
  ["trait", "💠 Trait"],
  ["litho", "📜 Litho"],
]);

function normalizeItem(raw) { return (raw ?? "").trim().slice(0, 120); }

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function prettyName(name) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function asStringSelect(placeholder, customId, optionsArr) {
  return {
    type: 1,
    components: [
      { type: 3, custom_id: customId, placeholder, min_values: 1, max_values: 1, options: optionsArr }
    ]
  };
}
function b64uEncode(s) { return Buffer.from(s, "utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }

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
            max_length: 120
          }
        ]
      }
    ]
  };
}

export async function handleModalSubmit(ctx) {
  const comps = ctx.interaction?.data?.components ?? [];
  const firstRow = comps[0]?.components?.[0];
  const rawItem = firstRow?.value ?? "";
  const itemName = normalizeItem(rawItem);

  if (!itemName) {
    return ctx.reply("Bitte gib ein Item an.", { ephemeral: true });
  }

  const encoded = b64uEncode(itemName);
  const optionsArr = [
    { label: "Gear (⚔️)",  value: "gear",  description: "Direktes Upgrade" },
    { label: "Trait (💠)", value: "trait", description: "Build-Trait" },
    { label: "Litho (📜)", value: "litho", description: "Rezept/Schrift" },
  ];

  return ctx.reply(
    {
      content: `Wähle den Grund für **${itemName}**:`,
      components: [asStringSelect("Grund auswählen …", "vote:grund:" + encoded, optionsArr)]
    },
    { ephemeral: true }
  );
}

// Wird vom Server bei Dropdown-Auswahl (deferred) aufgerufen
export async function handleReasonSelect(ctx) {
  const itemName = normalizeItem(ctx.item);
  const reason   = (ctx.reason ?? "").trim(); // gear|trait|litho

  if (!itemName)  return ctx.followUp("Item fehlt.", { ephemeral: true });
  if (!VALID_REASONS.has(reason)) {
    return ctx.followUp("Ungültiger Grund.", { ephemeral: true });
  }

  const slug = slugify(itemName);
  const nameFirst = prettyName(itemName);

  // Doppelvote verhindern (pro guild/user/slug)
  const check = await ctx.db.query(
    `SELECT 1
       FROM votes
      WHERE guild_id=$1 AND user_id=$2 AND item_slug=$3
      LIMIT 1`,
    [ctx.guildId, ctx.userId, slug]
  );
  if (check.rowCount > 0) {
    return ctx.followUp(
      `Du hast bereits für **${nameFirst}** gevotet.\n` +
      `Ändern: erst \`/vote-remove item:${nameFirst}\`, dann neu voten.`,
      { ephemeral: true }
    );
  }

  // ✅ Insert: type = Grund, und reason = type (wegen NOT NULL in deiner DB)
  await ctx.db.query(
    `INSERT INTO votes (guild_id, user_id, item_slug, type, reason, item_name_first, created_at)
     VALUES ($1, $2, $3, $4, $4, $5, NOW())`,
    [ctx.guildId, ctx.userId, slug, reason, nameFirst]
  );

  // Item registrieren, falls unbekannt
  await ctx.db.query(
    `INSERT INTO items (guild_id, item_slug, item_name_first, rolled_at)
     SELECT $1, $2, $3, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM items WHERE guild_id=$1 AND item_slug=$2
      )`,
    [ctx.guildId, slug, nameFirst]
  );

  const pretty = VALID_REASONS.get(reason);
  return ctx.followUp(`✅ Vote gespeichert:\n• **Item:** ${nameFirst}\n• **Grund:** ${pretty}`, { ephemeral: true });
}
