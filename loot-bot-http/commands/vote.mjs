// commands/vote.mjs — Modal + Dropdown-Flow (deferred-safe)
const VALID_REASONS = new Map([
  ["gear",  "⚔️ Gear"],
  ["trait", "💠 Trait"],
  ["litho", "📜 Litho"],
]);

function normalizeItem(raw) {
  return (raw ?? "").trim().slice(0, 120);
}

function asStringSelect(placeholder, customId, optionsArr) {
  return {
    type: 1,
    components: [
      { type: 3, custom_id: customId, placeholder, min_values: 1, max_values: 1, options: optionsArr }
    ]
  };
}

function b64uEncode(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64uDecode(s) {
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}

// ===== Public API =====
export function makeVoteModal() {
  return {
    custom_id: "vote:modal",
    title: "Vote abgeben",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4, // Text Input
            custom_id: "vote:item",
            style: 1, // Short
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
  // Item aus dem Modal lesen
  const comps = ctx.interaction?.data?.components ?? [];
  const firstRow = comps[0]?.components?.[0];
  const rawItem = firstRow?.value ?? "";
  const item = normalizeItem(rawItem);

  if (!item) {
    return ctx.reply("Bitte gib ein Item an.", { ephemeral: true });
  }

  const encoded = b64uEncode(item);
  const optionsArr = [
    { label: "Gear (⚔️)",  value: "gear",  description: "Direktes Upgrade" },
    { label: "Trait (💠)", value: "trait", description: "Build-Trait" },
    { label: "Litho (📜)", value: "litho", description: "Rezept/Schrift" },
  ];

  return ctx.reply(
    {
      content: `Wähle den Grund für **${item}**:`,
      components: [asStringSelect("Grund auswählen …", "vote:grund:" + encoded, optionsArr)]
    },
    { ephemeral: true }
  );
}

export async function handleReasonSelect(ctx) {
  const item = normalizeItem(ctx.item);
  const reason = (ctx.reason ?? "").trim();

  if (!item) {
    const msg = "Item fehlt.";
    return ctx.useFollowUp ? ctx.followUp(msg, { ephemeral: true }) : ctx.reply(msg, { ephemeral: true });
  }
  if (!VALID_REASONS.has(reason)) {
    const msg = "Ungültiger Grund.";
    return ctx.useFollowUp ? ctx.followUp(msg, { ephemeral: true }) : ctx.reply(msg, { ephemeral: true });
  }

  await ensureSchema(ctx.db);

  // Doppelvote verhindern
  const check = await ctx.db.query(
    `SELECT reason
       FROM votes
      WHERE guild_id=$1 AND user_id=$2 AND item_name=$3
      LIMIT 1`,
    [ctx.guildId, ctx.userId, item]
  );
  if (check.rowCount > 0) {
    const existing = check.rows[0];
    const pretty = VALID_REASONS.get(existing.reason) || existing.reason;
    const msg = `Du hast bereits für **${item}** gevotet: ${pretty}.\n` +
                `Wenn du ändern willst: bitte zuerst \`/vote-remove item:${item}\` ausführen und dann neu voten.`;
    return ctx.useFollowUp ? ctx.followUp(msg, { ephemeral: true }) : ctx.reply(msg, { ephemeral: true });
  }

  // Insert Vote
  await ctx.db.query(
    `INSERT INTO votes (guild_id, user_id, item_name, reason, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [ctx.guildId, ctx.userId, item, reason]
  );

  // Item registrieren
  await ctx.db.query(
    `INSERT INTO items (guild_id, item_name, rolled, created_at)
     VALUES ($1, $2, FALSE, NOW())
     ON CONFLICT (guild_id, item_name) DO NOTHING`,
    [ctx.guildId, item]
  );

  const prettyReason = VALID_REASONS.get(reason);
  const msg = `✅ Vote gespeichert:\n• **Item:** ${item}\n• **Grund:** ${prettyReason}`;
  return ctx.useFollowUp ? ctx.followUp(msg, { ephemeral: true }) : ctx.reply(msg, { ephemeral: true });
}

// ===== Schema =====
async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS votes (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      reason     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      guild_id   TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      rolled     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS wins (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      win_count  INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS votes_guild_created_idx ON votes (guild_id, created_at);`);
}
