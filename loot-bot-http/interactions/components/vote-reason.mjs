// interactions/components/vote-reason.mjs (FINAL)
// Erwartetes custom_id-Format: "vote:grund:<base64url(item_name)>"

function b64uDecode(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}

function prettyName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidReason(x) {
  return x === "gear" || x === "trait" || x === "litho";
}

function prettyReason(reason) {
  if (reason === "gear") return "⚔️ Gear";
  if (reason === "trait") return "💠 Trait";
  if (reason === "litho") return "📜 Litho";
  return reason;
}

export async function handleVoteReason(ctx) {
  try {
    const customId = ctx.customId?.() || ctx.interaction?.data?.custom_id || "";
    // custom_id: vote:grund:<b64u(item_name)>
    const parts = String(customId).split(":");
    const encoded = parts[2] || "";
    const itemName = prettyName(b64uDecode(encoded));

    const values = ctx.interaction?.data?.values || [];
    const reason = values[0];

    if (!itemName) {
      return ctx.update({ content: "❌ Kein Item erkannt.", components: [] });
    }
    if (!isValidReason(reason)) {
      return ctx.update({ content: "❌ Ungültiger Grund.", components: [] });
    }

    // NUR in votes speichern – KEIN Eintrag in items!
    const guild_id = ctx.guildId?.();
    const user_id = ctx.userId?.();
    const item_name_first = itemName;
    const item_slug = slugify(itemName);

    if (!ctx.db) {
      return ctx.update({ content: "❌ DB nicht verfügbar.", components: [] });
    }

    const q = `
      INSERT INTO votes (guild_id, user_id, item_slug, type, reason, item_name_first, created_at)
      VALUES ($1, $2, $3, $4, $4, $5, NOW())
      ON CONFLICT DO NOTHING
    `;
    try {
      await ctx.db.query(q, [guild_id, user_id, item_slug, reason, item_name_first]);
    } catch (e) {
      console.error("[vote-reason] insert error:", e);
      // Fallback ohne Details für User
      return ctx.update({ content: "❌ Konnte Vote nicht speichern.", components: [] });
    }

    return ctx.update({
      content: `✅ Vote gespeichert: **${item_name_first}** – ${prettyReason(reason)}`,
      components: [],
    });
  } catch (err) {
    console.error("[components/vote-reason] error:", err);
    return ctx.update({ content: "❌ Unerwarteter Fehler.", components: [] });
  }
}

export default { handleVoteReason };
