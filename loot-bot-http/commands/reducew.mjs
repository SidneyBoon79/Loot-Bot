// commands/reducew.mjs
// Eigenständige Version: kein import aus ../lib/db.mjs, kein discord.js
import fetch from "node-fetch";
import { Pool } from "pg";

// ---------- DB ----------
const pool =
  globalThis.__lb_pool ||
  (globalThis.__lb_pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  }));

async function dbQuery(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ---------- Discord REST (Namen nur als Fallback; primär kommt Name aus members) ----------
async function fetchUserNameFallback(userId) {
  const token = process.env.BOT_TOKEN;
  if (!token) return String(userId);
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return String(userId);
    const u = await res.json();
    return u.global_name || u.username || String(userId);
  } catch {
    return String(userId);
  }
}

// ---------- Slash-Definition ----------
export const data = {
  name: "reducew",
  description:
    "Wins reduzieren – wähle einen Gewinner (jeder Klick -1, niemals unter 0).",
  type: 1, // CHAT_INPUT
};

// ---------- Hauptlogik ----------
async function execute(interaction) {
  const guildId = interaction.guildId;

  // Schema wie in winner.mjs: wins.user_id + Join auf members für username
  const { rows } = await dbQuery(
    `SELECT m.user_id, m.username, w.win_count
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

  if (!rows.length) {
    return interaction.reply({
      content: "Es sind keine User mit Wins > 0 vorhanden.",
      ephemeral: true,
    });
  }

  // Namen aus members; falls leer, per REST fallbacken
  const options = await Promise.all(
    rows.map(async (r) => {
      const name =
        (r.username && String(r.username).trim()) ||
        (await fetchUserNameFallback(r.user_id));
      return {
        label: `${name} — W${r.win_count}`,
        value: r.user_id,
        description: `Wins: ${r.win_count}`,
      };
    })
  );

  const components = [
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

  return interaction.reply({
    content:
      "🏷️ **Wins reduzieren**\nWähle einen User — jeder Klick reduziert um **1** (niemals unter **0**).",
    components,
    ephemeral: true,
  });
}

export const run = execute;
