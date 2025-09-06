// commands/changew.mjs
// Slash-Befehl zum Anpassen von Wins (+3/+2/+1/-1/-2/-3) für jeden Channel-User
// Eigenständig: nutzt pg + node-fetch
import fetch from "node-fetch";
import { Pool } from "pg";

/* ---------- DB ---------- */
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

/* ---------- Discord REST (Fallback-Name) ---------- */
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

/* ---------- Slash-Definition ---------- */
export const data = {
  name: "changew",
  description: "Wins anpassen – füge einem User Wins hinzu oder ziehe sie ab.",
  type: 1, // CHAT_INPUT
};

/* ---------- Hauptlogik ---------- */
async function execute(interaction) {
  const guildId = interaction.guildId;

  // Alle bekannten Member aus members-Tabelle holen (auch ohne Wins)
  const { rows } = await dbQuery(
    `SELECT m.user_id, m.display_name, COALESCE(w.win_count,0) AS win_count
       FROM members m
       LEFT JOIN wins w ON w.user_id = m.user_id AND w.guild_id = m.guild_id
      WHERE m.guild_id = $1
      ORDER BY win_count DESC, m.display_name ASC
      LIMIT 25`,
    [guildId]
  );

  if (!rows.length) {
    return interaction.reply({
      content: "Es sind keine User in der Datenbank vorhanden.",
      ephemeral: true,
    });
  }

  // Anzeige: Name + aktuelle Wins
  const options = await Promise.all(
    rows.map(async (r) => {
      const name =
        (r.display_name && String(r.display_name).trim()) ||
        (await fetchUserNameFallback(r.user_id));
      return {
        label: `${name} — W${r.win_count}`,
        value: r.user_id,
        description: `Wins: ${r.win_count}`,
      };
    })
  );

  // Dropdown für User
  const userSelect = {
    type: 3,
    custom_id: "changew-user",
    placeholder: "Wähle einen User",
    min_values: 1,
    max_values: 1,
    options,
  };

  // Dropdown für Änderung (+3 ... -3)
  const changeSelect = {
    type: 3,
    custom_id: "changew-amount",
    placeholder: "Wähle Änderung",
    min_values: 1,
    max_values: 1,
    options: [
      { label: "+3 Wins", value: "+3" },
      { label: "+2 Wins", value: "+2" },
      { label: "+1 Win",  value: "+1" },
      { label: "-1 Win",  value: "-1" },
      { label: "-2 Wins", value: "-2" },
      { label: "-3 Wins", value: "-3" },
    ],
  };

  const components = [
    { type: 1, components: [userSelect] },
    { type: 1, components: [changeSelect] },
  ];

  return interaction.reply({
    content: "⚖️ **Wins ändern**\nWähle einen User und die gewünschte Änderung.",
    components,
    ephemeral: true,
  });
}

export const run = execute;
