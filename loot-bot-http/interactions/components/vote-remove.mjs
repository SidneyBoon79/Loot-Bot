// interactions/components/vote-remove.mjs — FINAL
// custom_id: "vote:remove"; values[0] = base64url(JSON.stringify({slug,name}))

function b64uDecode(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}

function getVal(maybeFn) { return typeof maybeFn === "function" ? maybeFn() : maybeFn; }

export async function handleVoteRemove(ctx) {
  try {
    const values = ctx?.interaction?.data?.values || [];
    const raw = values[0];
    let payload;
    try { payload = JSON.parse(b64uDecode(raw || "")); } catch { payload = null; }

    const slug = payload?.slug;
    const name = payload?.name || "das Item";

    if (!slug) {
      return ctx.update({ content: "❌ Ungültige Auswahl.", components: [] });
    }

    const guildId = getVal(ctx.guildId);
    const userId  = getVal(ctx.userId);

    if (!ctx.db) return ctx.update({ content: "❌ DB nicht verfügbar.", components: [] });

    // Lösche alle Stimmen des Users zu diesem Item innerhalb 48h
    const delQ = `
      DELETE FROM votes
      WHERE guild_id = $1 AND user_id = $2 AND item_slug = $3
        AND created_at > NOW() - INTERVAL '48 hours'
      RETURNING reason
    `;

    let removed = { gear: 0, trait: 0, litho: 0, total: 0 };
    try {
      const { rows } = await ctx.db.query(delQ, [guildId, userId, slug]);
      for (const r of rows) {
        if (r.reason === 'gear' || r.reason === 'trait' || r.reason === 'litho') removed[r.reason]++;
        removed.total++;
      }
    } catch (e) {
      console.error("[vote-remove] delete error:", e);
      return ctx.update({ content: "❌ Konnte Vote nicht entfernen.", components: [] });
    }

    if (!removed.total) {
      return ctx.update({ content: `ℹ️ Keine deiner Stimmen zu **${name}** gefunden (48h).`, components: [] });
    }

    const parts = [];
    if (removed.gear)  parts.push(`⚔️ ${removed.gear}`);
    if (removed.trait) parts.push(`💠 ${removed.trait}`);
    if (removed.litho) parts.push(`📜 ${removed.litho}`);

    return ctx.update({
      content: `✅ Entfernt: **${name}** — ${removed.total}${parts.length ? ` (${parts.join(', ')})` : ''}`,
      components: [],
    });
  } catch (err) {
    console.error("[components/vote-remove] error:", err);
    return ctx.update({ content: "❌ Unerwarteter Fehler.", components: [] });
  }
}

export default { handleVoteRemove };
