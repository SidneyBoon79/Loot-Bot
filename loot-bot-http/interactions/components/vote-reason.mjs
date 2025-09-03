// interactions/components/vote-reason.mjs
// Erwartetes custom_id-Format: "vote:grund:<base64url itemname>"

function b64uDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}

export async function handleVoteReason(ctx) {
  // customId & Auswahl auslesen
  const customId = typeof ctx.customId === "function" ? ctx.customId() : "";
  if (!customId?.startsWith("vote:grund:")) return;

  const enc = customId.slice("vote:grund:".length);
  const itemName = b64uDecode(enc).trim();

  const values = typeof ctx.values === "function" ? ctx.values() : [];
  const reason = Array.isArray(values) && values.length ? values[0] : "";

  if (!itemName) {
    return ctx.update?.({ content: "Item fehlt.", components: [] });
  }
  if (!["gear", "trait", "litho"].includes(reason)) {
    return ctx.update?.({ content: "Ungültiger Grund.", components: [] });
  }

  // Helper
  const slug = itemName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const nameFirst = itemName.charAt(0).toUpperCase() + itemName.slice(1);

  // Doppelvote verhindern
  const check = await ctx.db.query(
    `SELECT 1
       FROM votes
      WHERE guild_id=$1 AND user_id=$2 AND item_slug=$3
      LIMIT 1`,
    [ctx.guildId, ctx.userId, slug]
  );
  if (check.rowCount > 0) {
    return ctx.update({
      content:
        `Du hast bereits für **${nameFirst}** gevotet.\n` +
        `Ändern: erst \`/vote-remove item:${nameFirst}\`, dann neu voten.`,
      components: []
    });
  }

  // Vote speichern (reason = type)
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

  const pretty =
    reason === "gear"  ? "⚔️ Gear"  :
    reason === "trait" ? "💠 Trait" : "📜 Litho";

  return ctx.update({
    content: `✅ Vote gespeichert:\n• **Item:** ${nameFirst}\n• **Grund:** ${pretty}`,
    components: []
  });
}
