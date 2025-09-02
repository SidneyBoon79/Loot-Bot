// index.js — Votes + 48h-Fenster + Fairness + /roll (Dropdown) + /roll-all + /winner + /reducew + /vote-info
// Sortierung beim Roll: Grund (⚔️>💠>📜) > Wins(48h, asc) > Roll(desc)

import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, EmbedBuilder
} from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

/* ===== ENV ===== */
const TOKEN = process.env.TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const CLIENT_ID = process.env.CLIENT_ID || "";
const GUILD_ID = process.env.GUILD_ID || "";
if (!TOKEN || !DATABASE_URL || !CLIENT_ID) {
  console.error("Fehlende ENV: TOKEN, DATABASE_URL oder CLIENT_ID");
  process.exit(1);
}

/* ===== CONSTANTS ===== */
const WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 };
const guildTimers = new Map();

/* ===== DB ===== */
const pool = new Pool({ connectionString: DATABASE_URL });

async function initDB() {
  // Votes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_slug  TEXT NOT NULL,
      item_name_first TEXT NOT NULL,
      type       TEXT NOT NULL CHECK (type IN ('gear','trait','litho')),
      user_id    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_slug, type, user_id)
    );
  `);

  // Items (+ Roll-Flags)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      item_name_first TEXT,
      rolled_at TIMESTAMPTZ,
      rolled_by TEXT,
      rolled_manual BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (guild_id, item_slug)
    );
  `);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS item_name_first TEXT;`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS rolled_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS rolled_by TEXT;`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS rolled_manual BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`UPDATE items SET item_name_first = item_slug WHERE item_name_first IS NULL;`);

  // Settings (48h-Fenster)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      window_end_at TIMESTAMPTZ
    );
  `);

  // Winners
  await pool.query(`
    CREATE TABLE IF NOT EXISTS winners (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      user_id TEXT NOT NULL,
      won_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_end_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS winners_guild_user_window_idx
      ON winners (guild_id, user_id, window_end_at);
  `);
}

/* ===== Utils ===== */
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

async function ensureCanonicalItem(guildId, inputName) {
  const name = String(inputName || "").trim();
  if (!name) throw new Error("Leerer Item-Name.");
  const slug = slugify(name);

  await pool.query(
    `INSERT INTO items (guild_id, item_slug, item_name_first)
     VALUES ($1,$2,$3)
     ON CONFLICT (guild_id, item_slug) DO NOTHING`,
    [guildId, slug, name]
  );

  await pool.query(
    `UPDATE items
        SET item_name_first = COALESCE(item_name_first, $3)
      WHERE guild_id=$1 AND item_slug=$2 AND item_name_first IS NULL`,
    [guildId, slug, name]
  );

  const { rows } = await pool.query(
    `SELECT item_name_first FROM items WHERE guild_id=$1 AND item_slug=$2`,
    [guildId, slug]
  );
  const displayName = rows[0]?.item_name_first || name;
  return { slug, displayName };
}

async function getWindowEnd(guildId) {
  const { rows } = await pool.query(`SELECT window_end_at FROM settings WHERE guild_id=$1`, [guildId]);
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
function clearWipeTimer(guildId) {
  const t = guildTimers.get(guildId);
  if (t) { clearTimeout(t); guildTimers.delete(guildId); }
}
async function wipeGuildVotes(guildId) {
  await pool.query(`DELETE FROM votes   WHERE guild_id=$1`, [guildId]);
  await pool.query(`DELETE FROM items   WHERE guild_id=$1`, [guildId]); // Flags & Items weg
  await pool.query(`DELETE FROM winners WHERE guild_id=$1`, [guildId]); // Wins resetten
  await clearWindow(guildId);
  clearWipeTimer(guildId);
  console.log(`[Auto-Wipe] ${guildId}: Votes + Items + Winners geleert.`);
}
async function scheduleWipeIfNeeded(guildId) {
  clearWipeTimer(guildId);
  const end = await getWindowEnd(guildId);
  if (!end) return;
  const msLeft = end.getTime() - Date.now();
  if (msLeft <= 0) { await wipeGuildVotes(guildId); return; }
  const timer = setTimeout(async () => {
    try { await wipeGuildVotes(guildId); } finally { guildTimers.delete(guildId); }
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

/* ===== Votes ===== */
async function pruneEmptyItems(guildId) {
  await pool.query(`
    DELETE FROM items i
    WHERE i.guild_id = $1
      AND NOT EXISTS (
        SELECT 1 FROM votes v
        WHERE v.guild_id = i.guild_id
          AND v.item_slug = i.item_slug
      )
  `, [guildId]);
}
async function addVoteIfNew(guildId, itemNameInput, type, userId) {
  const t = String(type || "").toLowerCase();
  if (!["gear","trait","litho"].includes(t)) throw new Error("Ungültiger Grund");
  const { slug, displayName } = await ensureCanonicalItem(guildId, itemNameInput);

  const res = await pool.query(
    `INSERT INTO votes (guild_id, item_slug, item_name_first, type, user_id)
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
  await pruneEmptyItems(guildId);
  return res.rowCount;
}
async function showVotes(guildId, itemNameInput) {
  if (itemNameInput) {
    const { slug } = await ensureCanonicalItem(guildId, itemNameInput);
    const { rows } = await pool.query(
      `SELECT i.item_name_first AS item_name,
              i.rolled_at IS NOT NULL AS rolled,
              COALESCE(SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END),0)::int AS gear,
              COALESCE(SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END),0)::int AS trait,
              COALESCE(SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END),0)::int AS litho
         FROM items i
    LEFT JOIN votes v
           ON v.guild_id=i.guild_id AND v.item_slug=i.item_slug
        WHERE i.guild_id=$1 AND i.item_slug=$2
     GROUP BY i.item_name_first, i.rolled_at`,
      [guildId, slug]
    );
    if (rows.length === 0) return `**${itemNameInput}** hat aktuell keine Votes.`;
    const r = rows[0];
    const flag = r.rolled ? "✅ (gerollt)" : "🟡 (offen)";
    return `**${r.item_name}** ${flag}\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`;
  } else {
    const { rows } = await pool.query(
      `SELECT i.item_name_first AS item_name,
              i.rolled_at IS NOT NULL AS rolled,
              COALESCE(SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END),0)::int AS gear,
              COALESCE(SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END),0)::int AS trait,
              COALESCE(SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END),0)::int AS litho
         FROM items i
    LEFT JOIN votes v
           ON v.guild_id=i.guild_id AND v.item_slug=i.item_slug
        WHERE i.guild_id=$1
     GROUP BY i.item_name_first, i.rolled_at
     ORDER BY i.item_name_first`,
      [guildId]
    );
    if (rows.length === 0) return "Aktuell gibt’s keine Votes.";
    return rows.map(r =>
      `**${r.item_name}** ${r.rolled ? "✅" : "🟡"}\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`
    ).join("\n\n");
  }
}

/* ===== Fairness: Wins im aktuellen 48h-Fenster ===== */
async function countWinsInCurrentWindow(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS wins
       FROM winners
      WHERE guild_id = $1
        AND user_id = $2
        AND NOW() < window_end_at`,
    [guildId, userId]
  );
  return rows[0]?.wins ?? 0;
}

/* ===== Item-Listen für Roll ===== */
async function getUnrolledItemsWithVotes(guildId) {
  const { rows } = await pool.query(
    `
    SELECT i.item_slug, i.item_name_first AS name,
           COALESCE(SUM(CASE WHEN v.type IN ('gear','trait','litho') THEN 1 ELSE 0 END),0)::int AS total_votes
      FROM items i
 LEFT JOIN votes v
        ON v.guild_id=i.guild_id AND v.item_slug=i.item_slug
     WHERE i.guild_id=$1
       AND i.rolled_at IS NULL
  GROUP BY i.item_slug, i.item_name_first
    HAVING COALESCE(SUM(CASE WHEN v.type IN ('gear','trait','litho') THEN 1 ELSE 0 END),0) > 0
  ORDER BY i.item_name_first
    `,
    [guildId]
  );
  return rows; // [{item_slug,name,total_votes}, ...]
}

/* ===== Roll ===== */
function reasonEmojiLabel(t) {
  if (t === "gear") return "⚔️ Gear";
  if (t === "trait") return "💠 Trait";
  if (t === "litho") return "📜 Litho";
  return t;
}
function medalForIndex(idx) {
  if (idx === 0) return "🥇";
  if (idx === 1) return "🥈";
  if (idx === 2) return "🥉";
  const map = { 3: "4️⃣", 4: "5️⃣", 5: "6️⃣", 6: "7️⃣", 7: "8️⃣", 8: "9️⃣", 9: "🔟" };
  return map[idx] || `${idx + 1}.`;
}
function buildRankingLines(sorted) {
  return sorted.map((row, i) =>
    `${medalForIndex(i)} ${row.displayName} — ${row.roll} (${reasonEmojiLabel(row.type)} | ${row.wins}W)`
  ).join("\n");
}

/**
 * Roll-Logik je Item:
 * - pro User bester Grund (Gear > Trait > Litho)
 * - 1 Roll (1..100)
 * - Sort: Grund (desc) > Wins (asc) > Roll (desc)
 * - Sieger wird in winners gespeichert (mit window_end_at)
 * - Item wird als gerollt geflaggt (manual=true bei /roll Dropdown, false bei /roll-all)
 */
async function rollForItem(guild, guildId, itemSlug, displayItemName, rolledByUserId, manualFlag) {
  // Aggregation: bester Grund je User
  const { rows } = await pool.query(
    `
      SELECT user_id,
             MAX(CASE type WHEN 'gear' THEN 3 WHEN 'trait' THEN 2 WHEN 'litho' THEN 1 ELSE 0 END) AS w,
             BOOL_OR(type='gear')  AS has_gear,
             BOOL_OR(type='trait') AS has_trait,
             BOOL_OR(type='litho') AS has_litho
        FROM votes
       WHERE guild_id=$1 AND item_slug=$2
    GROUP BY user_id
    `,
    [guildId, itemSlug]
  );
  if (rows.length === 0) return null;

  // Resolve Teilnehmer
  const resolved = [];
  for (const r of rows) {
    let type = "litho";
    const w = Number(r.w) || 0;
    if (w === 3 && r.has_gear) type = "gear";
    else if (w === 2 && r.has_trait) type = "trait";
    else if (r.has_litho) type = "litho";

    let displayNameU = `<@${r.user_id}>`;
    try {
      const m = await guild.members.fetch(r.user_id);
      displayNameU = m?.displayName || m?.user?.username || displayNameU;
    } catch {}

    const roll = Math.floor(Math.random() * 100) + 1;
    const wins = await countWinsInCurrentWindow(guildId, r.user_id);

    resolved.push({ userId: r.user_id, type, displayName: displayNameU, roll, wins });
  }

  // Sortieren: Grund > Wins(asc) > Roll(desc)
  resolved.sort((a, b) => {
    const byReason = (REASON_WEIGHT[b.type] ?? 0) - (REASON_WEIGHT[a.type] ?? 0);
    if (byReason !== 0) return byReason;
    const byWins = a.wins - b.wins;
    if (byWins !== 0) return byWins;
    return b.roll - a.roll;
  });

  const lines = buildRankingLines(resolved);
  const winner = resolved[0];

  // Sieger speichern + Item flaggen
  const windowEnd = await getWindowEnd(guildId);
  if (windowEnd) {
    await pool.query(
      `INSERT INTO winners (guild_id, item_slug, user_id, window_end_at)
       VALUES ($1,$2,$3,$4)`,
      [guildId, itemSlug, winner.userId, windowEnd.toISOString()]
    );
    // Anzeige sofort mit neuem Wert
    winner.wins = (winner.wins || 0) + 1;
  }
  await pool.query(
    `UPDATE items
        SET rolled_at=NOW(), rolled_by=$3, rolled_manual = COALESCE(rolled_manual,FALSE) OR $4
      WHERE guild_id=$1 AND item_slug=$2`,
    [guildId, itemSlug, rolledByUserId || null, !!manualFlag]
  );

  return { displayItemName, winner, lines };
}

/* ===== Tutorial (/vote-info) ===== */
function getVoteInfoEmbeds() {
  const e1 = new EmbedBuilder()
    .setTitle("🔰 Für alle User")
    .setDescription(
      "Ihr könnt für **Items** abstimmen (mit **einem Grund**).\n\n" +
      "**Gründe (Wertigkeit):** ⚔️ Gear > 💠 Trait > 📜 Litho\n" +
      "_Diese Reihenfolge ist wichtiger als die Würfelzahl._\n\n" +
      "Sobald jemand das erste Mal `/vote` nutzt, startet ein **48h-Fenster**.\n" +
      "Nach Ablauf wird alles automatisch zurückgesetzt."
    );

  const e2 = new EmbedBuilder()
    .setTitle("🧑‍🤝‍🧑 Befehle für User")
    .setDescription(
      "• `/vote` – Item + **genau einen** Grund wählen\n" +
      "• `/vote-show` – Aktuelle Votes ansehen (optional mit Item)\n" +
      "• `/vote-remove` – Eigene Votes fürs Item löschen"
    );

  const e3 = new EmbedBuilder()
    .setTitle("🛡️ Für Mods – Rollen & Ausgabe")
    .setDescription(
      [
        "• **Rares manuell:** `/roll` → du bekommst ein **Dropdown** aller **offenen** Items mit Votes und wählst eins.",
        "• **Alles andere:** `/roll-all` → rollt **alle offenen** Items automatisch in **zufälliger Reihenfolge**.",
        "• Sortierung: **Grund** (⚔️>💠>📜) > **Wins (48h, weniger besser)** > **Zahl (1–100)**.",
        "• **`/winner`** → schlichte Liste **Item — User** (ephemeral) für die Preisausgabe.",
        "• **`/reducew`** → Wins eines Users im aktuellen Fenster reduzieren (Dropdown + Anzahl).",
        "• **`/vote-clear`** → Hard Reset: **Votes, Items (Flags) & Winners**."
      ].join("\n")
    );

  return [e1, e2, e3];
}

/* ===== Reduce Wins Helpers ===== */
async function getCurrentWinnerUsers(guild, guildId) {
  const { rows } = await pool.query(
    `SELECT user_id, COUNT(*)::int AS wins
       FROM winners
      WHERE guild_id=$1 AND NOW() < window_end_at
   GROUP BY user_id
   ORDER BY wins DESC, user_id`,
    [guildId]
  );
  const list = [];
  for (const r of rows) {
    let name = `<@${r.user_id}>`;
    try {
      const m = await guild.members.fetch(r.user_id);
      name = m?.displayName || m?.user?.username || name;
    } catch {}
    list.push({ userId: r.user_id, name, wins: r.wins });
  }
  return list;
}
async function reduceWins(guildId, userId, amount) {
  const { rows } = await pool.query(
    `WITH del AS (
       SELECT id FROM winners
        WHERE guild_id=$1 AND user_id=$2 AND NOW() < window_end_at
     ORDER BY won_at DESC
        LIMIT $3
     )
     DELETE FROM winners WHERE id IN (SELECT id FROM del)
     RETURNING id`,
    [guildId, userId, amount]
  );
  return rows.length;
}

/* ===== Discord Client ===== */
const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

/* ===== Slash Commands ===== */
async function registerSlash() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder().setName("vote")
      .setDescription("Vote abgeben: Item eingeben, dann Grund wählen.")
      .toJSON(),
    new SlashCommandBuilder().setName("vote-show")
      .setDescription("Aktuelle Votes anzeigen (Fenster läuft 48h ab erstem Vote)")
      .addStringOption(o => o.setName("item").setDescription("Optional: nur dieses Item").setRequired(false))
      .toJSON(),
    new SlashCommandBuilder().setName("vote-clear")
      .setDescription("Alle Votes & Gewinner zurücksetzen (Mods)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
    new SlashCommandBuilder().setName("vote-remove")
      .setDescription("Eigene Votes für ein Item löschen")
      .addStringOption(o => o.setName("item").setDescription("Item-Name").setRequired(true))
      .toJSON(),
    new SlashCommandBuilder().setName("roll")
      .setDescription("Rares manuell: Dropdown der offenen Items mit Votes")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
    new SlashCommandBuilder().setName("roll-all")
      .setDescription("Rollt alle offenen Items (random Reihenfolge)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
    new SlashCommandBuilder().setName("winner")
      .setDescription("Schlichte Gewinnerliste (Item — User) im aktuellen 48h-Fenster (nur Mods, ephemeral).")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
    new SlashCommandBuilder().setName("reducew")
      .setDescription("Wins eines Users im aktuellen Fenster reduzieren (Mods)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
    new SlashCommandBuilder().setName("vote-info")
      .setDescription("Kurz-Tutorial anzeigen (nur für dich sichtbar).")
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

/* ===== Ready: Timer reaktivieren ===== */
client.once("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await initDB();
  try { await registerSlash(); } catch (e) { console.warn("Slash-Register:", e?.message || e); }

  const { rows } = await pool.query(`SELECT guild_id, window_end_at FROM settings WHERE window_end_at IS NOT NULL`);
  for (const r of rows) {
    const end = new Date(r.window_end_at);
    if (end.getTime() <= Date.now()) {
      await wipeGuildVotes(r.guild_id);
    } else {
      const msLeft = end.getTime() - Date.now();
      const timer = setTimeout(async () => {
        try { await wipeGuildVotes(r.guild_id); } finally { guildTimers.delete(r.guild_id); }
      }, msLeft);
      guildTimers.set(r.guild_id, timer);
    }
  }
});

/* ===== Interactions ===== */
client.on("interactionCreate", async (interaction) => {
  try {
    // Slash-Commands
    if (interaction.isChatInputCommand()) {
      const guild = interaction.guild;
      const guildId = interaction.guildId;

      // /vote -> Modal (Item-Namen eingeben)
      if (interaction.commandName === "vote") {
        await ensureWindowActive(guildId);

        const modal = new ModalBuilder().setCustomId("voteItemModal").setTitle("Vote abgeben");
        const itemInput = new TextInputBuilder()
          .setCustomId("itemName").setLabel("Item-Name")
          .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("z. B. Schwert der Pein");
        modal.addComponents(new ActionRowBuilder().addComponents(itemInput));
        return interaction.showModal(modal);
      }

      // /vote-show
      if (interaction.commandName === "vote-show") {
        const item = interaction.options.getString("item") || null;
        const out = await showVotes(guildId, item);
        return interaction.reply({ content: out, ephemeral: false });
      }

      // /vote-clear
      if (interaction.commandName === "vote-clear") {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "Nur Moderation darf das.", ephemeral: true });
        }
        await wipeGuildVotes(guildId);
        return interaction.reply({
          content: "🧹 Alles gelöscht: Votes, Items (Flags) und Winners. Das nächste `/vote` startet ein neues 48h-Fenster.",
          ephemeral: false
        });
      }

      // /vote-remove
      if (interaction.commandName === "vote-remove") {
        const item = interaction.options.getString("item", true);
        const removed = await removeUserVotes(guildId, item, interaction.user.id);
        return interaction.reply({
          content: removed > 0
            ? `✅ Deine Votes für **${item}** wurden entfernt.`
            : `⚠️ Du hattest keine Votes für **${item}**.`,
          ephemeral: true
        });
      }

      // /roll → Dropdown der offenen Items mit Votes (ephemeral), Ergebnis public im Channel
      if (interaction.commandName === "roll") {
        const items = await getUnrolledItemsWithVotes(guildId);
        if (items.length === 0) {
          return interaction.reply({ content: "Keine **offenen Items mit Votes** gefunden.", ephemeral: true });
        }
        const options = items.slice(0, 25).map(i => ({ label: i.name, value: i.item_slug })); // max 25
        const select = new StringSelectMenuBuilder()
          .setCustomId("roll:select")
          .setPlaceholder("Wähle ein Item für den manuellen Roll")
          .addOptions(...options)
          .setMinValues(1).setMaxValues(1);
        const row = new ActionRowBuilder().addComponents(select);
        return interaction.reply({ content: "Wähle ein Item:", components: [row], ephemeral: true });
      }

      // /roll-all → alles offene random
      if (interaction.commandName === "roll-all") {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "Nur Moderation darf das.", ephemeral: true });
        }

        const items = await getUnrolledItemsWithVotes(guildId);
        if (items.length === 0) {
          return interaction.reply({ content: "Keine **offenen Items mit Votes** gefunden. Alles gerollt. ✅", ephemeral: true });
        }

        await interaction.reply({ content: `Starte Roll-All für **${items.length}** Items…`, ephemeral: false });

        for (const it of items.sort(() => Math.random() - 0.5)) { // random Reihenfolge
          try {
            const res = await rollForItem(guild, guildId, it.item_slug, it.name, interaction.user.id, false);
            if (!res) continue; // safety
            const embed = new EmbedBuilder()
              .setTitle(`🎲 Würfelrunde für **${res.displayItemName}**`)
              .setDescription(`${res.lines}\n\n🏆 Gewinner: ${res.winner.displayName} (${reasonEmojiLabel(res.winner.type)} | ${res.winner.wins}W)`);
            await interaction.followUp({ embeds: [embed] });
          } catch (e) {
            await interaction.followUp({ content: `Fehler bei **${it.name}**: ${e?.message || e}` });
          }
        }
        return;
      }

      // /winner — schlichte Liste (Item — User), Mods only, ephemeral
      if (interaction.commandName === "winner") {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "Nur Moderation darf das.", ephemeral: true });
        }

        const { rows } = await pool.query(
          `
          SELECT w.item_slug,
                 i.item_name_first AS item_name,
                 w.user_id,
                 w.won_at
            FROM winners w
       LEFT JOIN items i
              ON i.guild_id=w.guild_id AND i.item_slug=w.item_slug
           WHERE w.guild_id=$1 AND NOW() < w.window_end_at
        ORDER BY w.won_at ASC
          `,
          [guildId]
        );
        if (rows.length === 0) {
          return interaction.reply({ content: "Noch keine Gewinner im aktuellen 48h-Fenster.", ephemeral: true });
        }

        const lines = [];
        for (const r of rows) {
          let userLabel = `<@${r.user_id}>`;
          try {
            const m = await guild.members.fetch(r.user_id);
            userLabel = m?.displayName || m?.user?.username || userLabel;
          } catch {}
          const itemName = r.item_name || r.item_slug;
          lines.push(`${itemName} — ${userLabel}`);
        }

        return interaction.reply({ content: lines.join("\n"), ephemeral: true });
      }

      // /reducew — Dropdown + Modal, Antwort nur für Mod
      if (interaction.commandName === "reducew") {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "Nur Moderation darf das.", ephemeral: true });
        }

        const winners = await getCurrentWinnerUsers(guild, guildId);
        if (winners.length === 0) {
          return interaction.reply({ content: "Keine Gewinner im aktuellen 48h-Fenster gefunden.", ephemeral: true });
        }

        const options = winners.slice(0, 25).map(w => ({ label: `${w.name} | ${w.wins}W`, value: w.userId }));
        const select = new StringSelectMenuBuilder()
          .setCustomId("reduceW:select")
          .setPlaceholder("Wähle den User")
          .addOptions(...options)
          .setMinValues(1).setMaxValues(1);
        const row = new ActionRowBuilder().addComponents(select);
        return interaction.reply({ content: "User auswählen:", components: [row], ephemeral: true });
      }

      // /vote-info (nur für den Anfragenden)
      if (interaction.commandName === "vote-info") {
        const embeds = getVoteInfoEmbeds();
        return interaction.reply({ embeds, ephemeral: true });
      }
    }

    // StringSelect: /roll Dropdown-Auswahl → public Ergebnis
    if (interaction.isStringSelectMenu() && interaction.customId === "roll:select") {
      const guild = interaction.guild;
      const guildId = interaction.guildId;
      const itemSlug = interaction.values?.[0];
      if (!itemSlug) return interaction.update({ content: "Kein Item gewählt.", components: [] });

      const { rows } = await pool.query(
        `SELECT item_name_first FROM items WHERE guild_id=$1 AND item_slug=$2`,
        [guildId, itemSlug]
      );
      const displayName = rows[0]?.item_name_first || itemSlug;

      const res = await rollForItem(guild, guildId, itemSlug, displayName, interaction.user.id, true);
      if (!res) return interaction.update({ content: `Keine Teilnehmer für **${displayName}**.`, components: [] });

      const embed = new EmbedBuilder()
        .setTitle(`🎲 Würfelrunde für **${res.displayItemName}**`)
        .setDescription(`${res.lines}\n\n🏆 Gewinner: ${res.winner.displayName} (${reasonEmojiLabel(res.winner.type)} | ${res.winner.wins}W)`);

      // Öffentlich in den Channel posten:
      try { await interaction.channel?.send({ embeds: [embed] }); } catch {}

      // Ephemeral UI schließen:
      return interaction.update({ content: `Roll für **${res.displayItemName}** veröffentlicht.`, components: [] });
    }

    // StringSelect: reducew → Modal öffnen
    if (interaction.isStringSelectMenu() && interaction.customId === "reduceW:select") {
      const userId = interaction.values?.[0];
      if (!userId) return interaction.update({ content: "Kein User gewählt.", components: [] });

      const modal = new ModalBuilder().setCustomId(`reduceW:modal:${userId}`).setTitle("Wins reduzieren");
      const countInput = new TextInputBuilder()
        .setCustomId("reduceCount").setLabel("Anzahl Wins abziehen").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("1");
      modal.addComponents(new ActionRowBuilder().addComponents(countInput));
      return interaction.showModal(modal);
    }

    // Modal: /vote → Grund-Auswahl anzeigen
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
      return interaction.reply({ content: `Item: **${item}** – wähle deinen Grund:`, components: [row], ephemeral: true });
    }

    // StringSelect: Grund gewählt → Vote speichern
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("voteType:")) {
      const itemInput = interaction.customId.slice("voteType:".length);
      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      if (!(await windowStillActive(guildId))) {
        await wipeGuildVotes(guildId);
        return interaction.update({ content: "⏱️ Das 48h-Fenster ist vorbei. Starte mit einem neuen `/vote` neu.", components: [] });
      }

      const chosen = interaction.values?.[0];
      if (!chosen) return interaction.update({ content: "Kein Grund gewählt.", components: [] });

      const { isNew, value, displayName } = await addVoteIfNew(guildId, itemInput, chosen, userId);
      const line = isNew
        ? `✔️ **${chosen.toUpperCase()}** gezählt → **${value}**`
        : `⚠️ **${chosen.toUpperCase()}** bereits von dir gevotet. Aktuell: **${value}**`;

      const summary = await showVotes(guildId, displayName);
      return interaction.update({ content: `${line}\n\n${summary}`, components: [] });
    }

    // Modal submit: reducew
    if (interaction.isModalSubmit() && interaction.customId.startsWith("reduceW:modal:")) {
      const userId = interaction.customId.split(":")[2];
      const guild = interaction.guild;
      const guildId = interaction.guildId;

      const raw = interaction.fields.getTextInputValue("reduceCount")?.trim();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return interaction.reply({ content: "Bitte eine **positive ganze Zahl** eingeben.", ephemeral: true });
      }

      const removed = await reduceWins(guildId, userId, parsed);
      const newWins = await countWinsInCurrentWindow(guildId, userId);

      let name = `<@${userId}>`;
      try {
        const m = await guild.members.fetch(userId);
        name = m?.displayName || m?.user?.username || name;
      } catch {}

      return interaction.reply({
        content: `✅ Reduziert: **${name}** – abgezogen: **${removed}** (angefordert: ${parsed}).\nNeuer Stand: **${newWins}W** im aktuellen 48h-Fenster.`,
        ephemeral: true
      });
    }
  } catch (e) {
    console.error("Interaction error:", e);
    try {
      const msg = typeof e?.message === "string" ? e.message : "Unbekannter Fehler";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `Fehler: ${msg}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Fehler: ${msg}`, ephemeral: true });
      }
    } catch {}
  }
});

/* ===== Start ===== */
client.login(TOKEN);
