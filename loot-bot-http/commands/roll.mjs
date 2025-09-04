// commands/roll.mjs
// Zeigt IMMER ein Dropdown mit allen Items (48h) und triggert roll-select via custom_id.
// Nutzt ctx.db.query und robuste Fallback-Queries, damit wir exakt dieselben Items sehen wie /vote-show.

import { hasModPerm } from "../services/permissions.mjs";
import crypto from "node:crypto";

function toLabel(s) {
  return String(s || "").slice(0, 100);
}

function getGuildId(ctx) {
  return (
    ctx?.guildId ??
    ctx?.guild_id ??
    ctx?.interaction?.guild_id ??
    ctx?.guild?.id ??
    null
  );
}

async function queryItems48h(ctx, guildId) {
  const params = [String(guildId)];

  // Q1: bevorzugt mit item_name_first
  const q1 = `
    SELECT
      v.item_slug,
      MIN(v.item_name_first) AS item_name,
      COUNT(*)::int AS votes
    FROM votes v
    WHERE v.guild_id = $1
      AND v.created_at > NOW() - INTERVAL '48 hours'
    GROUP BY v.item_slug
    HAVING COUNT(*) > 0
    ORDER BY votes DESC, item_slug ASC
    LIMIT 25
  `;

  // Q2: fallback mit item_name
  const q2 = `
    SELECT
      v.item_slug,
      MIN(v.item_name) AS item_name,
      COUNT(*)::int AS votes
    FROM votes v
    WHERE v.guild_id = $1
      AND v.created_at > NOW() - INTERVAL '48 hours'
    GROUP BY v.item_slug
    HAVING COUNT(*) > 0
    ORDER BY votes DESC, item_slug ASC
    LIMIT 25
  `;

  // Q3: minimal (nur slug), falls name-Spalte nicht existiert
  const q3 = `
    SELECT
      v.item_slug,
      NULL::text AS item_name,
      COUNT(*)::int AS votes
    FROM votes v
    WHERE v.guild_id = $1
      AND v.created_at > NOW() - INTERVAL '48 hours'
    GROUP BY v.item_slug
    HAVING COUNT(*) > 0
    ORDER BY votes DESC, item_slug ASC
    LIMIT 25
  `;

  // Ausführen mit gestaffelten Fallbacks (Spalte könnte fehlen)
  try {
    const rows = await ctx.db.query(q1, params);
    if (rows?.length) return rows;
  } catch (_) {}

  try {
    const rows = await ctx.db.query(q2, params);
    if (rows?.length) return rows;
  } catch (_) {}

  try {
    const rows = await ctx.db.query(q3, params);
    if (rows?.length) return rows;
  } catch (_) {}

  return [];
}

export async function run(ctx) {
  try {
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const guildId = getGuildId(ctx);
    if (!guildId) {
      return ctx.reply("⚠️ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    const items = await queryItems48h(ctx, guildId);

    if (!items?.length) {
      // Wenn /vote-show noch Items listet, war bisher meist ein Spaltenname der Grund.
      // Mit den Fallbacks oben sollten wir jetzt alignen; andernfalls sind wirklich keine Items (48h) vorhanden.
      return ctx.reply("ℹ️ Keine qualifizierten Items in den letzten 48h.", { ephemeral: true });
    }

    const options = items.map((it) => ({
      label: toLabel(it.item_name || it.item_slug),
      value: it.item_slug,
      description: `${it.votes} Vote(s) · letzte 48h`,
    }));

    const customId = `roll:select:${crypto.randomUUID()}`;
    const row = {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: customId,
          placeholder: "Item wählen…",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    };

    return ctx.reply(
      {
        content: "Wähle ein Item für den Roll:",
        components: [row],
      },
      { ephemeral: false }
    );
  } catch (e) {
    console.error("[commands/roll] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /roll.", { ephemeral: true });
  }
}

export default { run };
