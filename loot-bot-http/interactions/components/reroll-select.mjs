// interactions/components/reroll-select.mjs
// Re-Roll Flow (Components):
// 1) "reroll:select"  -> zeigt Bestätigung (Ja/Nein)
// 2) "reroll:confirm:<slug>" -> führt Re-Roll aus (Ranking + Win-Umbuchung)
// 3) "reroll:cancel:<slug>"  -> bricht ab

const REASON_PRIORITY = { gear: 3, trait: 2, litho: 1 };
const d100 = () => (Math.random() * 100 | 0) + 1;

function confirmButtons(slug) {
  return {
    type: 1,
    components: [
      { type: 2, style: 3, custom_id: `reroll:confirm:${slug}`, label: "Ja, neu auslosen" },
      { type: 2, style: 4, custom_id: `reroll:cancel:${slug}`,  label: "Nein, abbrechen" }
    ]
  };
}

export async function handleRerollSelect(ctx) {
  const id = (typeof ctx.customId === "function" && ctx.customId()) || ctx.interaction?.data?.custom_id || "";
  if (id !== "reroll:select") return;

  const values = (typeof ctx.values === "function" && ctx.values()) || ctx.interaction?.data?.values || [];
  const slug = Array.isArray(values) && values.length ? values[0] : null;
  if (!slug) return ctx.update({ content: "Kein Item gewählt.", components: [] });

  const ires = await ctx.db.query(
    `SELECT item_name_first FROM items WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, slug]
  );
  const itemName = ires.rowCount ? ires.rows[0].item_name_first : slug;

  return ctx.update({
    content: `⚠️ **Re-Roll bestätigen**\nSoll **${itemName}** neu ausgelost werden? (Wins werden ggf. umgebucht)`,
    components: [confirmButtons(slug)]
  });
}

async function computeNewWinner(ctx, slug) {
  const vres = await ctx.db.query(
    `SELECT v.user_id, v.type
       FROM votes v
      WHERE v.guild_id=$1 AND v.item_slug=$2
        AND v.created_at > NOW() - INTERVAL '48 hours'`,
    [ctx.guildId, slug]
  );
  if (vres.rowCount === 0) return { candidates: [], winner: null };

  const candidates = [];
  for (const row of vres.rows) {
    const wres = await ctx.db.query(
      `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
      [ctx.guildId, row.user_id]
    );
    const wins = wres.rowCount ? wres.rows[0].win_count : 0;
    candidates.push({
      user_id: row.user_id,
      reason: row.type,
      priority: REASON_PRIORITY[row.type] || 0,
      wins,
      roll: d100()
    });
  }

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.wins !== b.wins) return a.wins - b.wins;
    return b.roll - a.roll;
  });

  return { candidates, winner: candidates[0] || null };
}

export async function handleRerollConfirm(ctx) {
  const id = (typeof ctx.customId === "function" && ctx.customId()) || ctx.interaction?.data?.custom_id || "";
  if (!id.startsWith("reroll:confirm:")) return;
  const slug = id.split(":").slice(2).join(":");

  const ires = await ctx.db.query(
    `SELECT item_name_first, rolled_by
       FROM items
      WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, slug]
  );
  if (ires.rowCount === 0) {
    return ctx.update({ content: "Item nicht gefunden.", components: [] });
  }
  const { item_name_first: itemName, rolled_by: oldWinnerId } = ires.rows[0];

  const { candidates, winner } = await computeNewWinner(ctx, slug);
  if (!winner) {
    return ctx.update({
      content: `Keine gültigen Votes für **${itemName}** vorhanden.`,
      components: []
    });
  }

  const newWinnerId = winner.user_id;
  const sameWinner = oldWinnerId && String(oldWinnerId) === String(newWinnerId);

  if (!sameWinner && oldWinnerId) {
    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET win_count = GREATEST(wins.win_count - 1, 0),
                     updated_at = NOW()`,
      [ctx.guildId, oldWinnerId]
    );
  }

  if (!sameWinner) {
    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET win_count = wins.win_count + 1,
                     updated_at = NOW()`,
      [ctx.guildId, newWinnerId]
    );
  }

  await ctx.db.query(
    `UPDATE items
        SET rolled_at = NOW(),
            rolled_by = $3
      WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, slug, newWinnerId]
  );

  const lines = candidates.map((c, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "➖";
    const reasonEmoji = c.reason === "gear" ? "⚔️" : c.reason === "trait" ? "💠" : "📜";
    return `${medal} <@${c.user_id}> — ${c.roll} (${reasonEmoji}, Wins: ${c.wins})`;
  });

  const sameNote = sameWinner
    ? "\nℹ️ Gewinner bleibt unverändert; Wins wurden nicht angepasst."
    : "";

  return ctx.update({
    content:
      `🔁 **Re-Roll** für **${itemName}**\n\n` +
      `${lines.join("\n")}\n\n` +
      `🏆 Neuer Gewinner: <@${newWinnerId}>` +
      sameNote,
    components: []
  });
}

export async function handleRerollCancel(ctx) {
  const id = (typeof ctx.customId === "function" && ctx.customId()) || ctx.interaction?.data?.custom_id || "";
  if (!id.startsWith("reroll:cancel:")) return;

  return ctx.update({ content: "Re-Roll abgebrochen.", components: [] });
}
