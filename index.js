// index.js
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits
} from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

/* ===== ENV ===== */
const TOKEN = process.env.TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const CLIENT_ID = process.env.CLIENT_ID || "";
const GUILD_ID = process.env.GUILD_ID || "";
if (!TOKEN || !DATABASE_URL) {
  console.error("Fehlende ENV: TOKEN und/oder DATABASE_URL");
  process.exit(1);
}

/* ===== KONSTANTEN ===== */
const WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const guildTimers = new Map(); // guildId -> Timeout

/* ===== DB ===== */
const pool = new Pool({ connectionString: DATABASE_URL });

async function initDB() {
  // Stimmen
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_slug  TEXT NOT NULL,
      item_name  TEXT NOT NULL,       -- gespeicherter KANONISCHER Name
      type       TEXT NOT NULL CHECK (type IN ('gear','trait','litho')),
      user_id    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_slug, type, user_id)
    );
  `);

  // Kanonischer, erste Schreibweise je (guild,item_slug)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      item_name_first TEXT NOT NULL,
      PRIMARY KEY (guild_id, item_slug)
    );
  `);

  // Fenster-Ende
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

/* ===== Fenster / Auto-Wipe (einmalig) ===== */
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
  if (!end) return; // kein aktives Fenster

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

/* ===== Items / Kanonischer Name ===== */
// Sicherstellt, dass der erste Name festgeschrieben wird.
// Gibt { slug, displayName } zurück (displayName = erste Schreibweise).
async function ensureCanonicalItem(guildId, inputName) {
  const slug = slugify(inputName);

  // Ersten Namen nur anlegen, falls noch nicht vorhanden
  await pool.query(
    `INSERT INTO items (guild_id, item_slug, item_name_first)
     VALUES ($1,$2,$3)
     ON CONFLICT (guild_id, item_slug) DO NOTHING`,
    [guildId, slug, inputName]
  );

  // Kanonischen Namen lesen
  const { rows } = await pool.query(
    `SELECT item_name_first FROM items WHERE guild_id=$1 AND item_slug=$2`,
    [guildId, slug]
  );
  const displayName = rows[0]?.item_name_first || inputName;
  return { slug, displayName };
}

/* ===== Votes ===== */
async function addVoteIfNew(guildId, itemNameInput, type, userId) {
  const t = type.toLowerCase();
  if (!["gear","trait","litho"].includes(t)) throw new Error("Ungültiger Grund");

  const { slug, displayName } = await ensureCanonicalItem(guildId, itemNameInput);

  const res = await pool.query(
    `INSERT INTO votes (guild_id, item_slug, item_name, type, user_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, item_slug, type, user_id) DO NOTHING`,
    [guildId, slug, displayName, t, userId]
  );
  const isNew = res.rowCount === 1;

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM votes WHERE guild_id=$1 AND item_slug=$2 AND type=$3`,
    [guildId, slug, t]
  );
  return { isNew, value: rows[0].total, displayName };
}

async function removeUserVotes(guildId, itemNameInput, userId) {
  const { slug } = await ensureCanonicalItem(guildId, itemNameInput);
  const res = await pool.query(
    `DELETE FROM votes WHERE guild_id=$1 AND item_slug=$2 AND user_id=$3`,
    [guildId, slug, userId]
  );
  return res.rowCount;
}

async function showVotes(guildId, itemNameInput) {
  if (itemNameInput) {
    const { slug } = await ensureCanonicalItem(guildId, itemNameInput);
    // Kanonischen Namen aus items holen + aggregieren
    const { rows } = await pool.query(
      `SELECT i.item_name_first AS item_name,
              SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END)::int  AS gear,
              SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END)::int  AS trait,
              SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END)::int  AS litho
       FROM items i
       LEFT JOIN votes v
         ON v.guild_id=i.guild_id AND v.item_slug=i.item_slug
       WHERE i.guild_id=$1 AND i.item_slug=$2
       GROUP BY i.item_name_first`,
      [guildId, slug]
    );
    if (rows.length === 0) return `**${itemNameInput}** hat aktuell keine Votes.`;
    const r = rows[0];
    return `**${r.item_name}**\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`;
  } else {
    // Gesamtliste: immer über items joinen, damit es keine Doppel-Anzeige durch Cases gibt
    const { rows } = await pool.query(
      `SELECT i.item_name_first AS item_name,
              COALESCE(SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END),0)::int  AS gear,
              COALESCE(SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END),0)::int  AS trait,
              COALESCE(SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END),0)::int  AS litho
       FROM items i
       LEFT JOIN votes v
         ON v.guild_id=i.guild_id AND v.item_slug=i.item_slug
       WHERE i.guild_id=$1
       GROUP BY i.item_name_first
       ORDER BY i.item_name_first`,
      [guildId]
    );
    if (rows.length === 0) return "Aktuell gibt’s keine Votes.";
    return rows.map(r =>
      `**${r.item_name}**\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`
    ).join("\n\n");
  }
}

/* ===== Discord Client ===== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

/* ===== Slash-Commands registrieren ===== */
async function registerSlash() {
  if (!CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder().setName("vote")
      .setDescription("Vote abgeben: Item eingeben, dann Grund wählen.")
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

  // Beim Start: evtl. laufendes Fenster reaktivieren
  const { rows } = await pool.query(`SELECT guild_id, window_end_at FROM settings WHERE window_end_at IS NOT NULL`);
  for (const r of rows) {
    const end = new Date(r.window_end_at);
    if (end.getTime() <= Date.now()) {
      await wipeGuildVotes(r.guild_id);
    } else {
      const msLeft = end.getTime() - Date.now();
      const timer = setTimeout(async () => {
        try { await wipeGuildVotes(r.guild_id); }
        finally { guildTimers.delete(r.guild_id); }
      }, msLeft);
      guildTimers.set(r.guild_id, timer);
    }
  }
});

/* ===== Interactions ===== */
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const guildId = interaction.guildId;

      // /vote -> Modal öffnen (startet ggf. das 48h-Fenster)
      if (interaction.commandName === "vote") {
        await ensureWindowActive(guildId);

        const modal = new ModalBuilder()
          .setCustomId("voteItemModal")
          .setTitle("Vote abgeben");
        const itemInput = new TextInputBuilder()
          .setCustomId("itemName")
          .setLabel("Item-Name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("z. B. Schwert");
        modal.addComponents(new ActionRowBuilder().addComponents(itemInput));
        return interaction.showModal(modal);
      }

      // /vote-show -> Übersicht
      if (interaction.commandName === "vote-show") {
        const item = interaction.options.getString("item") || null;
        const out = await showVotes(guildId, item);
        return interaction.reply({ content: out, ephemeral: false });
      }

      // /vote-clear -> alle Votes löschen (Mods)
      if (interaction.commandName === "vote-clear") {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "Nur Moderation darf das.", ephemeral: true });
        }
        clearWipeTimer(guildId);
        await wipeGuildVotes(guildId);
        return interaction.reply({ content: "🧹 Alle Votes wurden gelöscht. Das nächste `/vote` startet ein neues 48h-Fenster.", ephemeral: false });
      }

      // /vote-remove -> eigene Votes für ein Item löschen
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

    // Modal: Item eingegeben -> Auswahlmenü (GENAU EIN Grund)
    if (interaction.isModalSubmit() && interaction.customId === "voteItemModal") {
      const item = interaction.fields.getTextInputValue("itemName");
      const guildId = interaction.guildId;

      await ensureWindowActive(guildId);

      const select = new StringSelectMenuBuilder()
        .setCustomId(`voteType:${item}`)
        .setPlaceholder("Wähle GENAU EINEN Grund")
        .addOptions(
          { label: "Gear",  value: "gear"  },
          { label: "Trait", value: "trait" },
          { label: "Litho", value: "litho" }
        )
        .setMinValues(1).setMaxValues(1);

      const row = new ActionRowBuilder().addComponents(select);
      return interaction.reply({
        content: `Item: **${item}** – wähle deinen Grund:`,
        components: [row],
        ephemeral: true
      });
    }

    // Auswahl geklickt -> Vote speichern
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("voteType:")) {
      const itemInput = interaction.customId.split(":")[1];
      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      // Falls das Fenster abgelaufen ist → wipen & abbrechen
      if (!(await windowStillActive(guildId))) {
        clearWipeTimer(guildId);
        await wipeGuildVotes(guildId);
        return interaction.update({ content: "⏱️ Das 48h-Fenster ist vorbei. Starte mit einem neuen `/vote` neu.", components: [] });
      }

      const chosen = interaction.values[0]; // max 1
      const { isNew, value, displayName } = await addVoteIfNew(guildId, itemInput, chosen, userId);
      const line = isNew
        ? `✔️ **${chosen.toUpperCase()}** gezählt → **${value}**`
        : `⚠️ **${chosen.toUpperCase()}** bereits von dir gevotet. Aktuell: **${value}**`;

      const summary = await showVotes(guildId, displayName);
      return interaction.update({ content: `${line}\n\n${summary}`, components: [] });
    }
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) {
      try { return interaction.reply({ content: "Da ist was schiefgelaufen.", ephemeral: true }); } catch (_) {}
    }
  }
});

client.login(TOKEN);
