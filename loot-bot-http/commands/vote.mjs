
// commands/vote.mjs
// /vote – Item + Grund speichern (ohne Überschreiben!)
// Wenn bereits ein Vote für (guild,user,item) existiert, wird abgelehnt und ein Hinweis auf /vote-remove gegeben.

const VALID_REASONS = new Map([
  ["gear",  "⚔️ Gear"],
  ["trait", "💠 Trait"],
  ["litho", "📜 Litho"],
]);

function normalizeItem(raw) {
  return (raw ?? "").trim().slice(0, 120);
}

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}

export async function run(ctx) {
  const opt = indexByName(ctx.options);
  const itemRaw = opt.item?.value;
  const reason  = (opt.grund?.value || "").toLowerCase();

  // Validierung
  if (!itemRaw) {
    return ctx.reply("Bitte gib ein **Item** an, z. B. `/vote item:<Schwert> grund:Gear`.", { ephemeral: true });
  }
  if (!VALID_REASONS.has(reason)) {
    const choices = Array.from(VALID_REASONS.values()).join(" / ");
    return ctx.reply(`Ungültiger Grund. Erlaubt: ${choices}.`, { ephemeral: true });
  }

  const item = normalizeItem(itemRaw);
  if (!item) {
    return ctx.reply("Das Item darf nicht leer sein.", { ephemeral: true });
  }

  // DB-Schema sicherstellen (idempotent)
  await ensureSchema(ctx.db);

  // Prüfen, ob der User für dieses Item bereits einen Vote hat
  const check = await ctx.db.query(
    `SELECT reason, created_at
       FROM votes
      WHERE guild_id = $1 AND user_id = $2 AND item_name = $3
      LIMIT 1`,
    [ctx.guildId, ctx.userId, item]
  );

  if (check.rowCount > 0) {
    const existing = check.rows[0];
    const pretty = VALID_REASONS.get(existing.reason) || existing.reason;
    return ctx.reply(
      `Du hast bereits für **${item}** gevotet: ${pretty}.\n` +
      `Wenn du ändern willst: bitte zuerst \`/vote-remove item:${item}\` ausführen und dann neu voten.`,
      { ephemeral: true }
    );
  }

  // Insert (ein neuer Vote)
  try {
    await ctx.db.query(
      `INSERT INTO votes (guild_id, user_id, item_name, reason, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [ctx.guildId, ctx.userId, item, reason]
    );

    // Item im Register anlegen (für Dropdowns/roll)
    await ctx.db.query(
      `INSERT INTO items (guild_id, item_name, rolled, created_at)
       VALUES ($1, $2, FALSE, NOW())
       ON CONFLICT (guild_id, item_name) DO NOTHING`,
      [ctx.guildId, item]
    );

    const prettyReason = VALID_REASONS.get(reason);
    return ctx.reply(
      `✅ Vote gespeichert:\n` +
      `• **Item:** ${item}\n` +
      `• **Grund:** ${prettyReason}`,
      { ephemeral: true }
    );
  } catch (err) {
    // Falls race condition → Unique-Fehler (23505)
    if (err?.code === "23505") {
      return ctx.reply(
        `Du hast bereits für **${item}** gevotet. Nutze \`/vote-remove item:${item}\`, um zu ändern.`,
        { ephemeral: true }
      );
    }
    console.error("vote error:", err);
    return ctx.reply("❌ Konnte den Vote nicht speichern. Versuch’s später nochmal.", { ephemeral: true });
  }
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      reason     TEXT NOT NULL CHECK (reason IN ('gear','trait','litho')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, user_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      rolled     BOOLEAN NOT NULL DEFAULT FALSE,
      winner_id  TEXT,
      rolled_by  TEXT,
      rolled_at  TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_name)
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
