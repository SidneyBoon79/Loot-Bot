// index.js — Votes + Roll + Fairness + /vote-info (clean schema; Sort: Grund > Wins(48h) > Roll)

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
if (!TOKEN || !DATABASE_URL) {
  console.error("Fehlende ENV: TOKEN und/oder DATABASE_URL");
  process.exit(1);
}

/* ===== CONSTANTS ===== */
const WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 }; // Sort-Priorität
const guildTimers = new Map();

/* ===== DB ===== */
const pool = new Pool({ connectionString: DATABASE_URL });

async function initDB() {
  // Votes (nutzt item_name_first)
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

  // Items (kanonischer Erstname)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      item_name_first TEXT,
      PRIMARY KEY (guild_id, item_slug)
    );
  `);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS item_name_first TEXT;`);
  await pool.query(`UPDATE items SET item_name_first = item_slug WHERE item_name_first IS NULL;`);

  // Settings (Fensterende)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      window_end_at TIMESTAMPTZ
    );
  `);

  // Winners (für Fairness-Sortierung nach Wins im aktuellen Fenster)
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
  const { rows } = await pool.query(
    `SELECT window_end_at FROM settings WHERE guild_id=$1`, [guildId]
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
function clearWipeTimer(guildId) {
  const t = guildTimers.get(guildId);
  if (t) { clearTimeout(t); guildTimers.delete(guildId); }
}
async function wipeGuildVotes(guildId) {
  await pool.query(`DELETE FROM votes   WHERE guild_id=$1`, [guildId]);
  await pool.query(`DELETE FROM items   WHERE guild_id=$1`, [guildId]);
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
              COALESCE(SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END),0)::int AS gear,
              COALESCE(SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END),0)::int AS trait,
              COALESCE(SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END),0)::int AS litho
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
    const { rows } = await pool.query(
      `SELECT i.item_name_first AS item_name,
              COALESCE(SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END),0)::int AS gear,
              COALESCE(SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END),0)::int AS trait,
              COALESCE(SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END),0)::int AS litho
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
 * /roll-Logik:
 * - pro User bester Grund (Gear > Trait > Litho)
 * - 1 Roll (1..100)
 * - Sort: Grund (desc) > Wins im Fenster (asc) > Roll (desc)
 * - Sieger wird in winners gespeichert (mit aktuellem window_end_at)
 */
async function rollForItem(guild, guildId, itemInput) {
  const { slug, displayName } = await ensureCanonicalItem(guildId, itemInput);

  // alle Voter holen + besten Grund je User bestimmen (per Aggregation)
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
    [guildId, slug]
  );
  if (rows.length === 0) return { displayItemName: displayName, winner: null, lines: null };

  // resolve: reason, displayName, roll, wins
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

  // Sort: Grund > Wins(asc) > Roll(desc)
  resolved.sort((a, b) => {
    const byReason = (REASON_WEIGHT[b.type] ?? 0) - (REASON_WEIGHT[a.type] ?? 0);
    if (byReason !== 0) return byReason;
    const byWins = a.wins - b.wins;
    if (byWins !== 0) return byWins;
    return b.roll - a.roll;
  });

  const lines = buildRankingLines(resolved);
  const winner = resolved[0];

  // Sieger speichern mit aktuellem Fensterende
  const windowEnd = await getWindowEnd(guildId);
  if (windowEnd) {
    await pool.query(
      `INSERT INTO winners (guild_id, item_slug, user_id, window_end_at)
       VALUES ($1,$2,$3,$4)`,
      [guildId, slug, winner.userId, windowEnd.toISOString()]
    );
    // Für die Anzeige direkt auf den neuen Wert erhöhen
    winner.wins = (winner.wins || 0) + 1;
  }

  return { displayItemName: displayName, winner, lines };
}

/* ===== Tutorial (/vote-info) ===== */
function getVoteInfoEmbeds() {
  const e1 = new EmbedBuilder()
    .setTitle("🔰 Was macht der Bot?")
    .setDescription(
      [
        "Ihr könnt für **Items** abstimmen (mit **einem Grund**) und später lost der Bot das Item fair aus.",
        "",
        "**Gründe (Wertigkeit):** ⚔️ Gear > 💠 Trait > 📜 Litho",
        "_Diese Reihenfolge ist immer wichtiger als die Würfelzahl._",
        "",
        "### 48-Stunden-Fenster",
        "Sobald jemand das erste Mal `/vote` nutzt, startet ein **48h-Fenster**.",
        "• Alle Votes zählen nur **innerhalb** dieses Fensters.",
        "• Nach Ablauf wird alles automatisch zurückgesetzt."
      ].join("\n")
    );

  const e2 = new EmbedBuilder()
    .setTitle("🧑‍🤝‍🧑 Befehle für User")
    .setDescription(
      [
        "• **`/vote`** – Item eingeben → **einen Grund** wählen.",
        "• **`/vote-show`** – Zeigt die aktuellen Votes (optional `item`).",
        "• **`/vote-remove`** – Löscht **deine** Votes für ein Item.",
        "",
        "### Auslosung",
        "Ein Mod startet `/roll <Item>`. Der Bot würfelt 1–100 und sortiert so:",
        "1) **Grund** (⚔️ > 💠 > 📜)",
        "2) **Gewinne im aktuellen 48h-Fenster** (weniger Wins = besser)",
        "3) **Würfelzahl** (höher ist besser)",
        "",
        "**Beispiel**:",
        "🎲 Würfelrunde für Schwert",
        "🥇 Max — 40 (⚔️ Gear | 0W)",
        "🥈 Lisa — 88 (💠 Trait | 1W)",
        "🏆 Gewinner: Max (⚔️ Gear | 1W)"
      ].join("\n")
    );

  const e3 = new EmbedBuilder()
    .setTitle("❓ FAQ (User)")
    .setDescription(
      [
        "**Ich habe mich verklickt.**  → `/vote-remove` und neu voten.",
        "**Warum gewinnt jemand mit kleinerer Zahl?**  → Grund & weniger Wins sind wichtiger.",
        "**Ich sehe keine Votes mehr.**  → Das 48h-Fenster ist abgelaufen."
      ].join("\n")
    );

  const e4 = new EmbedBuilder()
    .setTitle("🛡️ Für Mods")
    .setDescription(
      [
        "• **`/roll <Item>`** – lost aus (zeigt Gewinner **mit neuer Win-Zahl** `| XW`).",
        "• **`/vote-clear`** – Hard Reset: löscht **Votes, Items und Winners**. Nächstes `/vote` startet neues 48h-Fenster.",
        "• **`/vote-show [item]`** – Übersicht.",
        "",
        "**Best Practices**",
        "• Genau **ein Grund** pro Vote.",
        "• Transparenz: vor dem Roll eine `/vote-show` posten.",
        "",

      ].join("\n")
    );

  return [e1, e2, e3, e4];
}

/* ===== Discord Client ===== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

/* ===== Slash Commands ===== */
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
      .toJSON(),
    new SlashCommandBuilder().setName("roll")
      .setDescription("Würfelt das Item unter allen Votern aus (Mods)")
      .addStringOption(o => o.setName("item").setDescription("Item-Name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),
    new SlashCommandBuilder().setName("vote-info")
      .setDescription("Zeigt das Kurz-Tutorial für User & Mods an.")
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

/* ===== Ready ===== */
client.once("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await initDB();
  try { await registerSlash(); } catch (e) { console.warn("Slash-Register:", e?.message || e); }

  // laufendes Fenster (Timer) reaktivieren
  const { rows } = await pool.query(
    `SELECT guild_id, window_end_at FROM settings WHERE window_end_at IS NOT NULL`
  );
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
    if (interaction.isChatInputCommand()) {
      const guild = interaction.guild;
      const guildId = interaction.guildId;

      // /vote -> Modal öffnen
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

      // /vote-show
      if (interaction.commandName === "vote-show") {
        const item = interaction.options.getString("item") || null;
        const out = await showVotes(guildId, item);
        return interaction.reply({ content: out, ephemeral: true });
      }

      // /vote-clear (Mods)
      if (interaction.commandName === "vote-clear") {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "Nur Moderation darf das.", ephemeral: true });
        }
        await wipeGuildVotes(guildId);
        return interaction.reply({
          content: "🧹 Alle Votes und Gewinner/Wins wurden gelöscht. Das nächste `/vote` startet ein neues 48h-Fenster.",
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

      // /roll
      if (interaction.commandName === "roll") {
        const item = interaction.options.getString("item", true);
        const { displayItemName, winner, lines } = await rollForItem(guild, guildId, item);

        if (!lines) {
          return interaction.reply({ content: `Für **${displayItemName}** gibt es keine gültigen Teilnehmer.`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle(`🎲 Würfelrunde für **${displayItemName}**`)
          .setDescription(`${lines}\n\n🏆 Gewinner: ${winner.displayName} (${reasonEmojiLabel(winner.type)} | ${winner.wins}W)`);

        return interaction.reply({ embeds: [embed] });
      }

      // /vote-info
      if (interaction.commandName === "vote-info") {
        const embeds = getVoteInfoEmbeds();
        return interaction.reply({ embeds, ephemeral: false });
      }
    }

    // Modal -> Auswahlmenü (genau ein Grund)
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

    // Auswahl -> Vote speichern
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

client.login(TOKEN);
