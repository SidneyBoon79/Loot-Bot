// commands/reducew.mjs
import fetch from "node-fetch";
import { Pool } from "pg";

// --- DB Pool (keine Abhängigkeit auf eure lib/db.mjs)
const pool =
  globalThis.__lb_pool ||
  (globalThis.__lb_pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  }));

async function dbQuery(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// --- Discord REST: Name holen
async function fetchUserName(userId) {
  const token = process.env.BOT_TOKEN;
  if (!token) return userId;
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return userId;
    const u = await res.json();
    return u.global_name || u.username || userId;
  } catch {
    return userId;
  }
}

// --- Command-Definition (ohne Options)
export const data = {
  name: "reducew",
  description:
    "Wins reduzieren – wähle einen Gewinner (jeder Klick -1, niemals unter 0).",
  type: 1, // CHAT_INPUT
};

// --- Hauptlogik: Dropdown mit lesbaren Namen
export async function execute(interaction) {
  const guildId = interaction.guildId;

  const { rows } = await dbQuery(
    `SELECT member_id, win_count
       FROM wins
      WHERE guild_id = $1
        AND win_count > 0
      ORDER BY updated_at DESC, win_count DESC
      LIMIT 25`,
    [guildId]
  );

  if (!rows.length) {
    return interaction.reply({
      content: "Es sind keine User mit Wins > 0 vorhanden.",
      ephemeral: true,
    });
  }

  const namePairs = await Promise.all(
    rows.map(async (r) => [r.member_id, await fetchUserName(r.member_id)])
  );
  const nameById = Object.fromEntries(namePairs);

  const options = rows.map((r) => ({
    label: `${nameById[r.member_id]} — W${r.win_count}`,
    value: r.member_id,
    description: `Wins: ${r.win_count}`,
  }));

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

// --- Kompatibilität zu eurem Router
export const run = execute;
