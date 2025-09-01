import { Client, GatewayIntentBits, Partials } from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

// --- ENV ---
const TOKEN = process.env.TOKEN;               // Discord Bot Token
const PREFIX = process.env.PREFIX || "!";      // z. B. !
const DATABASE_URL = process.env.DATABASE_URL; // von Railway Postgres
if (!TOKEN || !DATABASE_URL) {
  console.error("Fehlende ENV: TOKEN und/oder DATABASE_URL");
  process.exit(1);
}

// --- DB ---
const pool = new Pool({ connectionString: DATABASE_URL });

// Tabellen anlegen, falls nicht vorhanden
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      item_name TEXT NOT NULL,
      UNIQUE (guild_id, item_slug)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counts (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('gear','trait','litho')),
      value INTEGER NOT NULL DEFAULT 0,
      UNIQUE (guild_id, item_slug, type)
    );
  `);
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

async function ensureItem(guildId, itemName) {
  const slug = slugify(itemName);
  await pool.query(
    `INSERT INTO items (guild_id, item_slug, item_name)
     VALUES ($1,$2,$3)
     ON CONFLICT (guild_id, item_slug) DO UPDATE SET item_name = EXCLUDED.item_name`,
    [guildId, slug, itemName]
  );
  // 3 Count-Reihen sicherstellen
  for (const t of ["gear","trait","litho"]) {
    await pool.query(
      `INSERT INTO counts (guild_id, item_slug, type, value)
       VALUES ($1,$2,$3,0)
       ON CONFLICT (guild_id, item_slug, type) DO NOTHING`,
      [guildId, slug, t]
    );
  }
  return slug;
}

async function changeCount(guildId, itemName, type, delta) {
  const t = type.toLowerCase();
  if (!["gear","trait","litho"].includes(t)) throw new Error("Ungültiger Grund");
  const slug = await ensureItem(guildId, itemName);
  await pool.query(
    `UPDATE counts SET value = GREATEST(value + $1, 0)
     WHERE guild_id=$2 AND item_slug=$3 AND type=$4`,
    [delta, guildId, slug, t]
  );
  const { rows } = await pool.query(
    `SELECT value FROM counts WHERE guild_id=$1 AND item_slug=$2 AND type=$3`,
    [guildId, slug, t]
  );
  return rows[0]?.value ?? 0;
}

async function setCount(guildId, itemName, type, value) {
  const t = type.toLowerCase();
  if (!["gear","trait","litho"].includes(t)) throw new Error("Ungültiger Grund");
  const v = Math.max(0, Math.floor(Number(value)));
  const slug = await ensureItem(guildId, itemName);
  await pool.query(
    `UPDATE counts SET value = $1 WHERE guild_id=$2 AND item_slug=$3 AND type=$4`,
    [v, guildId, slug, t]
  );
  return v;
}

async function showCounts(guildId, itemName) {
  if (itemName) {
    const slug = slugify(itemName);
    const { rows } = await pool.query(
      `SELECT i.item_name, c.type, c.value
       FROM items i
       JOIN counts c USING (guild_id, item_slug)
       WHERE i.guild_id=$1 AND i.item_slug=$2
       ORDER BY c.type`,
      [guildId, slug]
    );
    if (rows.length === 0) return `**${itemName}** ist nicht erfasst.`;
    let out = `**${rows[0].item_name}**\n`;
    for (const r of rows) out += `• ${r.type[0].toUpperCase()+r.type.slice(1)}: **${r.value}**\n`;
    return out;
  } else {
    const { rows } = await pool.query(
      `SELECT i.item_name,
              MAX(CASE WHEN c.type='gear'  THEN c.value END) AS gear,
              MAX(CASE WHEN c.type='trait' THEN c.value END) AS trait,
              MAX(CASE WHEN c.type='litho' THEN c.value END) AS litho
       FROM items i
       LEFT JOIN counts c USING (guild_id, item_slug)
       WHERE i.guild_id=$1
       GROUP BY i.item_name
       ORDER BY i.item_name`,
      [guildId]
    );
    if (rows.length === 0) return "Noch keine Items registriert.";
    return rows.map(r =>
      `**${r.item_name}**\n• Gear: **${r.gear ?? 0}**\n• Trait: **${r.trait ?? 0}**\n• Litho: **${r.litho ?? 0}**`
    ).join("\n\n");
  }
}

async function clearItem(guildId, itemName) {
  const slug = slugify(itemName);
  await pool.query(`DELETE FROM counts WHERE guild_id=$1 AND item_slug=$2`, [guildId, slug]);
  await pool.query(`DELETE FROM items  WHERE guild_id=$1 AND item_slug=$2`, [guildId, slug]);
}

async function clearAll(guildId) {
  await pool.query(`DELETE FROM counts WHERE guild_id=$1`, [guildId]);
  await pool.query(`DELETE FROM items  WHERE guild_id=$1`, [guildId]);
}

// --- Discord Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await initDB();
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const guildId = msg.guild.id;

  try {
    switch (cmd.toLowerCase()) {
      case "bedarf": {
        if (args.length < 2) return msg.reply(`Nutze: \`${PREFIX}bedarf <item> <Grund>\` (Gear|Trait|Litho)`);
        const item = args[0];
        const type = args[1];
        const newVal = await changeCount(guildId, item, type, +1);
        return msg.channel.send(`**${msg.author.username}** hat Bedarf für **${item}** (**${type.toUpperCase()}**) angemeldet.\nGesamtbedarf: **${newVal}**`);
      }

      case "bedarf-remove": {
        if (args.length < 2) return msg.reply(`Nutze: \`${PREFIX}bedarf-remove <item> <Grund>\``);
        const item = args[0], type = args[1];
        const newVal = await changeCount(guildId, item, type, -1);
        return msg.channel.send(`**${msg.author.username}** hat **${item}** (**${type.toUpperCase()}**) um 1 reduziert.\nNeuer Gesamtbedarf: **${newVal}**`);
      }

      case "bedarf-show": {
        const item = args[0];
        const out = await showCounts(guildId, item);
        return msg.channel.send(out);
      }

      case "bedarf-set": {
        if (args.length < 3) return msg.reply(`Nutze: \`${PREFIX}bedarf-set <item> <Grund> <Zahl>\``);
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply("Nur Moderation darf das setzen.");
        const item = args[0], type = args[1], val = args[2];
        const newVal = await setCount(guildId, item, type, val);
        return msg.channel.send(`**${item}** (**${type.toUpperCase()}**) gesetzt auf **${newVal}**.`);
      }

      case "bedarf-clear": {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply("Nur Moderation darf löschen.");
        if (!args[0]) {
          await clearAll(guildId);
          return msg.channel.send("Bedarf-Index für diesen Server geleert.");
        } else {
          await clearItem(guildId, args[0]);
          return msg.channel.send(`**${args[0]}** aus dem Bedarf entfernt (alle Typen).`);
        }
      }

      case "help": {
        return msg.channel.send(
          "**Verfügbare Befehle:**\n" +
          "`!bedarf <item> <grund>` – Bedarf anmelden (Gear/Trait/Litho)\n" +
          "`!bedarf-remove <item> <grund>` – Bedarf reduzieren\n" +
          "`!bedarf-show [item]` – Bedarf anzeigen\n" +
          "`!bedarf-set <item> <grund> <zahl>` – Bedarf manuell setzen (Mods)\n" +
          "`!bedarf-clear [item]` – Bedarf löschen (Mods)\n" +
          "`!help` – Zeigt diese Übersicht"
        );
      }

        
      default:
        break;
    }
  } catch (err) {
    console.error(err);
    return msg.reply("Uff, da ist was schiefgelaufen. Check die Eingabe (Gear/Trait/Litho) oder versuch’s erneut.");
  }
});

client.login(TOKEN);
