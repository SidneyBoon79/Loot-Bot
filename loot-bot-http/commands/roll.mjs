// commands/roll.mjs
// Zweck: Öffnet ein Dropdown mit allen Items, auf die in den letzten 48h Stimmen eingegangen sind.
// Auswahl triggert die Component "roll-select" (custom_id exakt "roll-select").
// Berechtigungen: nur Mods/Admins (hasModPerm).
// Datenquelle: DB-Tabelle votes (wie vote-show), gefiltert auf ctx.guildId und 48h-Fenster.

import { hasModPerm } from "../services/permissions.mjs";

/** Kürzt Labels auf Discord-Grenzen einheitlich ein. */
function toLabel(s) {
  return String(s ?? "").slice(0, 100);
}

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) {
      return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });
    }

    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const guildId = ctx.guildId ?? ctx.guild_id ?? ctx.guild?.id ?? null;
    if (!guildId) {
      return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    // Alle Items mit Votes der letzten 48 Stunden aggregieren (analog vote-show).
    // Wichtig: exakt dieselbe Normalisierung/Quelle wie vote-show verwenden.
    const { rows } = await db.query(
      `
      SELECT
        item_slug,
        item_name_first,
        COUNT(*) AS votes
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
      GROUP BY item_slug, item_name_first
      HAVING COUNT(*) > 0
      ORDER BY COUNT(*) DESC, item_name_first ASC
      LIMIT 25
      `,
      [guildId]
    );

    if (!rows || rows.length === 0) {
      return ctx.reply("ℹ️ Keine offenen Items mit Stimmen in den letzten 48 Stunden.", {
        ephemeral: true,
      });
    }

    // Discord Select-Menu vorbereiten
    const options = rows.map((r) => {
      const name = r.item_name_first ?? r.item_slug;
      const votes = Number(r.votes ?? 0);
      return {
        label: toLabel(`${name} · ${votes} Stimme${votes === 1 ? "" : "n"}`),
        // WICHTIG: value exakt wie bei vote-remove verwenden (Item-Slug),
        // keine UUIDs, keine zusammengesetzten JSONs.
        value: String(r.item_slug),
        description: toLabel(r.item_slug),
      };
    });

    const select = {
      type: 3, // STRING_SELECT (Discord)
      custom_id: "roll-select", // EXAKT so, damit der Component-Handler greift
      placeholder: "Wähle ein Item für den Roll …",
      min_values: 1,
      max_values: 1,
      options,
    };

    const row = {
      type: 1, // Action Row
      components: [select],
    };

    return ctx.reply(
      { content: "🎲 **Roll** – wähle ein Item:", components: [row] },
      { ephemeral: false }
    );
  } catch (e) {
    console.error("[commands/roll] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /roll.", { ephemeral: true });
  }
}

export default { run };
