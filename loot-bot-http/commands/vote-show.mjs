// commands/vote-show.mjs – FINAL (Emoji ok, ohne Template-Strings)

const ICONS = { gear: '⚔️', trait: '💠', litho: '📜' };

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply('❌ Datenbank nicht verfügbar.', { ephemeral: true });

    const guildId = typeof ctx.guildId === 'function' ? ctx.guildId() : ctx.guildId;

    const q = [
      'SELECT item_name_first AS name, item_slug, reason, COUNT(*)::int AS c',
      'FROM votes',
      "WHERE guild_id = $1 AND created_at > NOW() - INTERVAL \'48 hours\'",
      'GROUP BY item_name_first, item_slug, reason',
      'ORDER BY item_name_first'
    ].join(' ');
    const { rows } = await db.query(q, [guildId]);

    if (!rows || rows.length === 0) {
      return ctx.reply('📭 Keine Votes in den letzten 48h.', { ephemeral: true });
    }

    const byItem = new Map();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let entry = byItem.get(r.item_slug);
      if (!entry) {
        entry = { name: r.name, totals: { gear: 0, trait: 0, litho: 0 }, total: 0 };
        byItem.set(r.item_slug, entry);
      }
      if (r.reason === 'gear' || r.reason === 'trait' || r.reason === 'litho') {
        entry.totals[r.reason] += r.c;
        entry.total += r.c;
      }
    }

    const list = Array.from(byItem.values()).sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name)
    );

    const linesArr = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const parts = [];
      if (row.totals.gear)  parts.push(ICONS.gear + ' ' + row.totals.gear);
      if (row.totals.trait) parts.push(ICONS.trait + ' ' + row.totals.trait);
      if (row.totals.litho) parts.push(ICONS.litho + ' ' + row.totals.litho);
      const suffix = parts.length ? ' (' + parts.join(', ') + ')' : '';
      linesArr.push('• ' + row.name + ' — ' + row.total + suffix);
    }

    const header = '🗳️ Votes (letzte 48h)\n';
    const body = linesArr.join('\n');
    return ctx.reply(header + body, { ephemeral: true });
  } catch (e) {
    console.error('[commands/vote-show] error:', e);
    return ctx.reply('❌ Konnte Votes nicht anzeigen.', { ephemeral: true });
  }
}

export default { run };
