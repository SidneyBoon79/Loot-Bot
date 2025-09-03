// interactions/components/vote-reason.mjs — FINAL (robust ctx access)

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
const VALID = new Set(["gear","trait","litho"]);
const reasonLabel = (r) => (r==="gear"?"⚔️ Gear": r==="trait"?"💠 Trait": r==="litho"?"📜 Litho": r);

function getVal(maybeFn) {
  try { return typeof maybeFn === "function" ? maybeFn() : maybeFn; }
  catch { return undefined; }
}

export async function handleVoteReason(ctx) {
  try {
    const customId = getVal(ctx.customId) || ctx?.interaction?.data?.custom_id || "";
    const parts = String(customId).split(":");                // vote:grund:<b64u(item)>
    const encoded = parts[2] || "";
    const itemName = prettyName(b64uDecode(encoded));

    const values = ctx?.interaction?.data?.values || [];
    const reason = values[0];

    if (!itemName)  return ctx.update({ content: "❌ Kein Item erkannt.", components: [] });
    if (!VALID.has(reason)) return ctx.update({ content: "❌ Ungültiger Grund.", components: [] });

    const guild_id = getVal(ctx.guildId);
    const user_id  = getVal(ctx.userId);
    const item_slug = slugify(itemName);

    if (!ctx.db) return ctx.update({ content: "❌ DB nicht verfügbar.", components: [] });

    const q = `
      INSERT INTO votes (guild_id, user_id, item_slug, type, reason, item_name_first, created_at)
      VALUES ($1, $2, $3, $4, $4, $5, NOW())
      ON CONFLICT DO NOTHING
    `;
    try {
      await ctx.db.query(q, [guild_id, user_id, item_slug, reason, itemName]);
    } catch (e) {
      console.error("[vote-reason] insert error:", e);
      return ctx.update({ content: "❌ Konnte Vote nicht speichern.", components: [] });
    }

    return ctx.update({
      content: `✅ Vote gespeichert: **${itemName}** – ${reasonLabel(reason)}`,
      components: [],
    });
  } catch (err) {
    console.error("[components/vote-reason] error:", err);
    return ctx.update({ content: "❌ Unerwarteter Fehler.", components: [] });
  }
}

export default { handleVoteReason };
