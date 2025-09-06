// commands/reducew.mjs
// Keine Abhängigkeit auf eure lib/db.mjs – eigene, schlanke DB-Connection
import fetch from "node-fetch";
import { Pool } from "pg";

// --- DB Pool (Railway/Standard) --------------------------------------------
const pool =
  globalThis.__lb_pool ||
  (globalThis.__lb_pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      undefined, // nutzt ggf. PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT
    ssl:
      process.env.PGSSL === "disable"
        ? false
        : { rejectUnauthorized: false }, // Railway-kompatibel
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

// --- Discord REST Helper: Namen holen --------------------------------------
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

// --- Slash Command Definition (ohne Options) --------------------------------
export const data = {
  name: "reducew",
  description:
    "Wins reduzieren – wähle einen Gewinner (jeder Klick -1, niemals unter 0).",
  type: 1, // CHAT_INPUT
};

// --- Execute: Dropdown mit lesbaren Namen -----------------------------------
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

  // Namen parallel auflösen
  const namePairs = await Promise.all(
    rows.map(async (r) => [r.member_id, await fetchUserName(r.member_id)])
  );
  const nameById = Object.fromEntries(namePairs);

  // Komponenten als rohes Discord-JSON (kein discord.js nötig)
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
