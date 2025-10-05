// register-commands.mjs
// Registriert Slash-Commands direkt über die Discord REST API (ohne discord.js)
// Erwartete ENV-Variablen:
//   BOT_TOKEN   = Bot Token (Beginnend mit "mfa." NICHT verwenden – nimm das Bot-Token)
//   CLIENT_ID   = Application (Bot) ID
// Optional:
//   GUILD_ID    = Wenn gesetzt -> nur Gildenscope, sonst global
//
// Aufruf auf Railway (Start Command oder einmalig in der Shell):
//   node register-commands.mjs

const API_BASE = "https://discord.com/api/v10";

function env(name, required = true) {
  const v = process.env[name];
  if (!v && required) {
    console.error(`[REG] Umgebungsvariable ${name} fehlt.`);
    process.exit(1);
  }
  return v;
}

const BOT_TOKEN = env("BOT_TOKEN");
const CLIENT_ID = env("CLIENT_ID");
const GUILD_ID = process.env.GUILD_ID || null;

async function discordFetch(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[REG] HTTP ${res.status} ${res.statusText} for ${path}\n${text}`);
  }
  return res.json().catch(() => ({}));
}

// ---------- Commands-Definitionen (JSON) ----------

// /vote  (item Autocomplete, reason Auswahl)
const vote = {
  name: "vote",
  description: "Run vote",
  type: 1,
  options: [
    {
      type: 3, // STRING
      name: "item",
      description: "Welches Item?",
      required: true,
      autocomplete: true,
    },
    {
      type: 3, // STRING
      name: "reason",
      description: "Grund der Stimme",
      required: false,
      choices: [
        { name: "⚔️ Gear",  value: "Gear"  },
        { name: "🔷 Trait", value: "Trait" },
        { name: "📜 Litho", value: "Litho" },
      ],
    },
  ],
};

// die restlichen Commands so minimal wie zuvor – Beschreibungen anpassen, falls gewünscht
const voteShow   = { name: "vote-show",   description: "Aktuelle Votes anzeigen", type: 1 };
const voteRemove = { name: "vote-remove", description: "Eigenen Vote entfernen",  type: 1 };
const voteClear  = { name: "vote-clear",  description: "Reset (Votes, Items, Wins)", type: 1 };

const roll    = { name: "roll",     description: "Mods rollen ein Item",            type: 1 };
const rollAll = { name: "roll-all", description: "Rollen alle nicht gerollten Items", type: 1 };
const reroll  = { name: "reroll",   description: "Erlaubt erneuten Roll für Items", type: 1 };

const winner  = { name: "winner",   description: "Listet Gewinner kompakt",        type: 1 };

// „reducew“ wird NICHT registriert (bewusst weggelassen)

// Alle zu registrierenden Commands:
const COMMANDS = [
  vote,
  voteShow,
  voteRemove,
  roll,
  rollAll,
  reroll,
  winner,
  voteClear,
];

// ---------- Registrierung ausführen ----------

async function main() {
  try {
    const scopePath = GUILD_ID
      ? `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`
      : `/applications/${CLIENT_ID}/commands`;

    console.log(`[REG] Registriere ${COMMANDS.length} Commands ${GUILD_ID ? `(Guild ${GUILD_ID})` : "(global)"} …`);
    const result = await discordFetch("PUT", scopePath, COMMANDS);
    console.log(`[REG] Erfolgreich. ${Array.isArray(result) ? result.length : 0} Commands aktiv.`);
  } catch (err) {
    console.error("[REG] Fehler bei der Registrierung:", err?.message || err);
    process.exit(1);
  }
}

main();
