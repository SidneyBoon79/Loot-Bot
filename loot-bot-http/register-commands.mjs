// register-commands.mjs
// Registriert die Slash-Commands per Discord REST (ohne discord.js).
// ENV: BOT_TOKEN (Pflicht), CLIENT_ID (Pflicht), optional GUILD_ID für schnelle Guild-Registration.

const API = "https://discord.com/api/v10";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID || ""; // leer => global registrieren

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error("[REG] BOT_TOKEN oder CLIENT_ID fehlt in den Env Vars.");
  process.exit(1);
}

// ---------------------------- Command-Definitionen ----------------------------
// Hinweis: Falls einzelne Optionen anders heißen sollen, hier anpassen.
// Ziel: deckt euren aktuellen Funktionsumfang ab, keine weiteren Repos/Dateien nötig.

const commands = [
  {
    name: "vote",
    description: "Run vote",
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
          { name: "Gear",  value: "Gear"  },
          { name: "Trait", value: "Trait" },
          { name: "Litho", value: "Litho" },
        ],
      },
    ],
  },
  {
    name: "vote-show",
    description: "Zeigt aktuelle Votes",
  },
  {
    name: "vote-remove",
    description: "Eigenen Vote für ein Item löschen",
    options: [
      {
        type: 3, // STRING
        name: "item",
        description: "Welches Item?",
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "roll",
    description: "Rollt ein (manuell gewähltes) Item",
  },
  {
    name: "roll-all",
    description: "Rollt alle noch nicht gerollten Items",
  },
  {
    name: "reroll",
    description: "Erlaubt einen erneuten Roll für bereits gerollte Items",
  },
  {
    name: "winner",
    description: "Listet Gewinner kompakt",
  },
  {
    name: "vote-clear",
    description: "Reset (Votes, Items, Wins)",
  },
  {
    name: "changew",
    description: "Wins eines Users ändern",
    options: [
      {
        type: 6, // USER
        name: "user",
        description: "Betroffener User",
        required: true,
      },
      {
        type: 4, // INTEGER
        name: "amount",
        description: "Anzahl (+/-)",
        required: true,
      },
    ],
  },
  {
    name: "vote-info",
    description: "Zeigt das Kurz-Tutorial",
  },
];

// ---------------------------- REST Helper ------------------------------------
async function put(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[REG] ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function main() {
  try {
    const route = GUILD_ID
      ? `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`
      : `/applications/${CLIENT_ID}/commands`;

    console.log(
      `[REG] Registriere ${commands.length} Commands ` +
        (GUILD_ID ? `guild-weit (Guild ${GUILD_ID})…` : "global …"),
    );

    const result = await put(route, commands);

    // Ausgabe verkürzt, damit Railway-Logs sauber bleiben
    console.log(
      `[REG] OK – ${Array.isArray(result) ? result.length : "?"} Commands registriert` +
        (GUILD_ID ? " (sofort aktiv)." : " (global, kann bis zu 1h dauern)."),
    );
  } catch (err) {
    console.error("[REG] Fehler beim Registrieren:", err);
    process.exit(1);
  }
}

main();
