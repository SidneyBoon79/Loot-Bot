import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

/** ====== ENV ====== */
const TOKEN = process.env.TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const CLIENT_ID = process.env.CLIENT_ID || "";
const GUILD_ID  = process.env.GUILD_ID  || "";
if (!TOKEN || !DATABASE_URL) {
  console.error("Fehlende ENV: TOKEN und/oder DATABASE_URL");
  process.exit(1);
}

/** ====== KONSTANTEN ====== */
const WINDOW_MS = 48 * 60 * 60 * 1000;
const guildTimers = new Map();

/** ====== DB ====== */
const pool = new Pool({ connectionString: DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_slug  TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      type       TEXT NOT NULL CHECK (type IN ('gear','trait','litho')),
      user_id    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_slug, type, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      window_end_at TIMESTAMPTZ
    );
  `);
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** ====== Fenster / Auto-Wipe ====== */
async function getWindowEnd(guildId) {
  const { rows } = await pool.query(
    `SELECT window_end_at FROM settings WHERE guild_id=$1`,
    [guildId]
  );
  return rows[0]?.window_end_at ? new Date(rows[0].window_end_at) : null;
}

async function setWindowEnd(guildId, date) {
  await pool.query(
    `INSERT INTO settings (guild_id, window_end_at)
     VALUES ($1,$2)
     ON CONFLICT (guild_id) DO UPDATE SET window_end_at = EXCLUDED.window_end_at`,
    [guildId, date.toISOString()]
  );
}

async function clearWindow(guildId) {
  await pool.query(`UPDATE settings SET window_end_at=NULL WHERE guild_id=$1`, [guildId]);
}

async function wipeGuildVotes(guildId) {
  await pool.query(`DELETE FROM votes WHERE guild_id=$1`, [guildId]);
  await clearWindow(guildId);
  console.log(`[Auto-Wipe] ${guildId}: Liste geleert.`);
}

function clearWipeTimer(guildId) {
  const t = guildTimers.get(guildId);
  if (t) { clearTimeout(t); guildTimers.delete(guildId); }
}

async function scheduleWipeIfNeeded(guildId) {
  clearWipeTimer(guildId);
  const end = await getWindowEnd(guildId);
  if (!end) return;

  const msLeft = end.getTime() - Date.now();
  if (msLeft <= 0) {
    await wipeGuildVotes(guildId);
    return;
  }
  const timer = setTimeout(async () => {
    try { await wipeGuildVotes(guildId); }
    finally { guildTimers.delete(guildId); }
  }, msLeft);
  guildTimers.set(guildId, timer);
}

async function ensureWindowActive(guildId) {
  const end = await getWindowEnd(guildId);
  if (!end || end.getTime() <= Date.now()) {
    const newEnd = new Date(Date.now() + WINDOW_MS);
    await setWindowEnd(guildId, newEnd);
    await scheduleWipeIfNeeded(guildId);
  }
}

async function windowStillActive(guildId) {
  const end = await getWindowEnd(guildId);
  return !!end && end.getTime() > Date.now();
}

/** ====== Votes ====== */
async function addVoteIfNew(guildId, itemName, type, userId) {
  const t = type.toLowerCase();
  if (!["gear","trait","litho"].includes(t)) throw new Error("Ungültiger Grund");
  const slug = slugify(itemName);

  const res = await pool.query(
    `INSERT INTO votes (guild_id, item_slug, item_name, type, user_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, item_slug, type, user_id) DO NOTHING`,
    [guildId, slug, itemName, t, userId]
  );
  const isNew = res.rowCount === 1;

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM votes WHERE guild_id=$1 AND item_slug=$2 AND type=$3`,
    [guildId, slug, t]
  );
  return { isNew, value: rows[0].total };
}

async function removeUserVotes(guildId, itemName, userId) {
  const slug = slugify(itemName);
  const res = await pool.query(
    `DELETE FROM votes WHERE guild_id=$1 AND item_slug=$2 AND user_id=$3`,
    [guildId, slug, userId]
  );
  return res.rowCount;
}

async function showVotes(guildId, itemName) {
  if (itemName) {
    const slug = slugify(itemName);
    const { rows } = await pool.query(
      `SELECT item_name,
              SUM(CASE WHEN type='gear'  THEN 1 ELSE 0 END)::int  AS gear,
              SUM(CASE WHEN type='trait' THEN 1 ELSE 0 END)::int  AS trait,
              SUM(CASE WHEN type='litho' THEN 1 ELSE 0 END)::int  AS litho
       FROM votes
       WHERE guild_id=$1 AND item_slug=$2
       GROUP BY item_name`,
      [guildId, slug]
    );
    if (rows.length === 0) return `**${itemName}** hat aktuell keine Votes.`;
    const r = rows[0];
    return `**${r.item_name}**\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`;
  } else {
    const { rows } = await pool.query(
      `SELECT item_name,
              SUM(CASE WHEN type='gear'  THEN 1 ELSE 0 END)::int  AS gear,
              SUM(CASE WHEN type='trait' THEN 1 ELSE 0 END)::int  AS trait,
              SUM(CASE WHEN type='litho' THEN 1 ELSE 0 END)::int  AS litho
       FROM votes
       WHERE guild_id=$1
       GROUP BY item_name
       ORDER BY item_name`,
      [guildId]
    );
    if (rows.length === 0) return "Aktuell gibt’s keine Votes.";
    return rows.map(r =>
      `**${r.item_name}**\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`
    ).join("\n\n");
  }
}

/** ====== Discord Client ====== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

// Slash-Commands registrieren
async function registerSlash() {
  if (!CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder().setName("vote")
      .setDescription("Vote abgeben: Item eingeben, dann Typ(en) wählen.")
      .toJSON(),
    new SlashCommandBuilder().setName("vote-show")
      .setDescription("Aktuelle Votes anzeigen (Fenster läuft 48h ab dem ersten Vote)")
      .addStringOption(o => o.setName("item").setDescription("Optional: nur dieses Item").setRequired(false))
      .toJSON(),
    new SlashCommandBuilder().setName("vote-clear")
      .setDescription("Alle Votes sofort löschen (Mods)")
      .toJSON(),
    new SlashCommandBuilder().setName("vote-remove")
      .setDescription("Eigene Votes für ein Item löschen")
      .addStringOption(o => o.setName("item").setDescription("Item-Name").setRequired(true))
      .toJSON()
  ];

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Slash-Commands auf Guild registriert:", GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash-Commands global registriert.");
  }
}

client.once("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await initDB();
  try { await registerSlash(); } catch (e) { console.warn("Slash-Register:", e.message); }
});

// Interactions
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const guildId = interaction.guildId;

      if (interaction.commandName === "vote-remove") {
        const item = interaction.options.getString("item");
        const removed = await removeUserVotes(guildId, item, interaction.user.id);
        if (removed > 0) {
          return interaction.reply({ content: `✅ Deine Votes für **${item}** wurden entfernt.`, ephemeral: true });
        } else {
          return interaction.reply({ content: `⚠️ Du hattest keine Votes für **${item}**.`, ephemeral: true });
        }
      }
    }
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) {
      return interaction.reply({ content: "Da ist was schiefgelaufen.", ephemeral: true });
    }
  }
});

client.login(TOKEN);
