// interactions/components/reducew-select.mjs
// Minimal & robust: eigener pg-Pool, Primärzugriff via interaction.values[0]
import { Pool } from "pg";

/* ---------- DB ---------- */
const pool =
  globalThis.__lb_pool ||
  (globalThis.__lb_pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  }));

async function dbQuery(text, params) {
  const c = await pool.connect();
  try { return await c.query(text, params); }
  finally { c.release(); }
}

/* ---------- Dropdown neu aufbauen ---------- */
async function buildComponents(guildId) {
  const { rows } = await dbQuery(
    `SELECT m.user_id, m.display_name, w.win_count
       FROM wins w
       JOIN members m
         ON w.user_id = m.user_id
        AND w.guild_id = m.guild_id
      WHERE w.guild_id = $1
        AND w.win_count > 0
      ORDER BY w.updated_at DESC, w.win_count DESC
      LIMIT 25`,
    [guildId]
  );

  if (!rows.length) return [];

  const options = rows.map(r => ({
    label: `${(r.display_name && String(r.display_name).trim()) || r.user_id} — W${r.win_count}`,
    value: r.user_id,
    description: `Wins: ${r.win_count}`,
  }));

  return [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 3, // String Select
          custom_id: "reducew-select",
          placeholder: "Wähle einen User (reduziert um 1)",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
  ];
}

/* ---------- Export-API ---------- */
export const customId = "reducew-select";

export async function run(interaction) {
  const guildId = interaction.guildId;

  // Primär wie in deiner funktionierenden Version:
  const userId =
    (interaction.values && interaction.values[0]) ??
    (interaction.data && interaction.data.values && interaction.data.values[0]) ??
    null;

  if (!userId) {
    return interaction.update({
      content: "Kein User ausgewählt – bitte erneut versuchen.",
      components: await buildComponents(guildId),
    });
  }

  // Aktuelle Wins lesen
  const cur = await dbQuery(
    `SELECT win_count
       FROM wins
      WHERE guild_id = $1
        AND user_id  = $2`,
    [guildId, userId]
  );

  if (!cur.rowCount) {
    // Eintrag existiert nicht mehr -> Liste refreshen
    return interaction.update({
      content: "Kein gültiger Eintrag mehr – Liste wurde aktualisiert.",
      components: await buildComponents(guildId),
    });
  }

  const current = Number(cur.rows[0].win_count || 0);
  const nextWins = Math.max(0, current - 1);

  // Update durchführen
  await dbQuery(
    `UPDATE wins
        SET win_count = $3,
            updated_at = NOW()
      WHERE guild_id = $1
        AND user_id  = $2`,
    [guildId, userId, nextWins]
  );

  const mention = `<@${userId}>`;
  const components = await buildComponents(guildId);

  return interaction.update({
    content:
      components.length > 0
        ? `✅ Reduziert: ${mention} · neuer Stand **W${nextWins}**.\nWähle weitere User — jeder Klick reduziert um **1**.`
        : `✅ Reduziert: ${mention} · neuer Stand **W${nextWins}**.\nEs sind keine User mit Wins > 0 mehr vorhanden.`,
    components,
  });
}
// interactions/components/reducew-select.mjs
// Minimal & robust: eigener pg-Pool, Primärzugriff via interaction.values[0]
import { Pool } from "pg";

/* ---------- DB ---------- */
const pool =
  globalThis.__lb_pool ||
  (globalThis.__lb_pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  }));

async function dbQuery(text, params) {
  const c = await pool.connect();
  try { return await c.query(text, params); }
  finally { c.release(); }
}

/* ---------- Dropdown neu aufbauen ---------- */
async function buildComponents(guildId) {
  const { rows } = await dbQuery(
    `SELECT m.user_id, m.display_name, w.win_count
       FROM wins w
       JOIN members m
         ON w.user_id = m.user_id
        AND w.guild_id = m.guild_id
      WHERE w.guild_id = $1
        AND w.win_count > 0
      ORDER BY w.updated_at DESC, w.win_count DESC
      LIMIT 25`,
    [guildId]
  );

  if (!rows.length) return [];

  const options = rows.map(r => ({
    label: `${(r.display_name && String(r.display_name).trim()) || r.user_id} — W${r.win_count}`,
    value: r.user_id,
    description: `Wins: ${r.win_count}`,
  }));

  return [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 3, // String Select
          custom_id: "reducew-select",
          placeholder: "Wähle einen User (reduziert um 1)",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
  ];
}

/* ---------- Export-API ---------- */
export const customId = "reducew-select";

export async function run(interaction) {
  const guildId = interaction.guildId;

  // Primär wie in deiner funktionierenden Version:
  const userId =
    (interaction.values && interaction.values[0]) ??
    (interaction.data && interaction.data.values && interaction.data.values[0]) ??
    null;

  if (!userId) {
    return interaction.update({
      content: "Kein User ausgewählt – bitte erneut versuchen.",
      components: await buildComponents(guildId),
    });
  }

  // Aktuelle Wins lesen
  const cur = await dbQuery(
    `SELECT win_count
       FROM wins
      WHERE guild_id = $1
        AND user_id  = $2`,
    [guildId, userId]
  );

  if (!cur.rowCount) {
    // Eintrag existiert nicht mehr -> Liste refreshen
    return interaction.update({
      content: "Kein gültiger Eintrag mehr – Liste wurde aktualisiert.",
      components: await buildComponents(guildId),
    });
  }

  const current = Number(cur.rows[0].win_count || 0);
  const nextWins = Math.max(0, current - 1);

  // Update durchführen
  await dbQuery(
    `UPDATE wins
        SET win_count = $3,
            updated_at = NOW()
      WHERE guild_id = $1
        AND user_id  = $2`,
    [guildId, userId, nextWins]
  );

  const mention = `<@${userId}>`;
  const components = await buildComponents(guildId);

  return interaction.update({
    content:
      components.length > 0
        ? `✅ Reduziert: ${mention} · neuer Stand **W${nextWins}**.\nWähle weitere User — jeder Klick reduziert um **1**.`
        : `✅ Reduziert: ${mention} · neuer Stand **W${nextWins}**.\nEs sind keine User mit Wins > 0 mehr vorhanden.`,
    components,
  });
}
