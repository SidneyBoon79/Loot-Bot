// register-commands.mjs
// Registriert alle Slash-Commands beim Discord-API Endpoint.
// ENV unterstützt beide Varianten: CLIENT_ID | DISCORD_APP_ID, BOT_TOKEN | DISCORD_BOT_TOKEN, GUILD_ID

const APP_ID =
  process.env.CLIENT_ID ||
  process.env.DISCORD_APP_ID ||
  "";
const BOT_TOKEN =
  process.env.BOT_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  "";
const GUILD_ID = process.env.GUILD_ID || "";

function die(msg) {
  console.error("✖", msg);
  process.exit(1);
}

console.log("▶ Registriere Slash Commands (ohne reason-Option) …");
console.log("  • APP_ID :", APP_ID ? `${APP_ID.slice(0, 6)}…` : "(fehlt)");
console.log("  • GUILD_ID:", GUILD_ID ? `${GUILD_ID.slice(0, 6)}…` : "(fehlt)");
console.log("  • BOT_TOKEN:", BOT_TOKEN ? "vorhanden" : "(fehlt)");

if (!APP_ID || !BOT_TOKEN || !GUILD_ID) {
  die("Bitte ENV setzen: CLIENT_ID/DISCORD_APP_ID, BOT_TOKEN/DISCORD_BOT_TOKEN und GUILD_ID.");
}

/* -------------------- Command-Definitionen -------------------- */
// /vote hat NUR noch "item" (mit Autocomplete). KEINE reason-Option mehr.
const commands = [
  {
    name: "vote",
    description: "Run vote",
    type: 1,
    options: [
      {
        name: "item",
        description: "Welches Item?",
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },

  // weitere Commands
  { name: "vote-info",   description: "Zeigt aktuelle Vote-Infos",   type: 1 },
  { name: "vote-show",   description: "Zeigt die aktuellen Stimmen", type: 1 },
  { name: "vote-clear",  description: "Löscht Votes/Items/Wins",     type: 1 },
  { name: "vote-remove", description: "Entfernt eine Stimme",        type: 1 },

  { name: "roll",        description: "Würfeln",                     type: 1 },
  { name: "roll-all",    description: "Alle würfeln",                type: 1 },
  { name: "reroll",      description: "Reroll",                      type: 1 },
  { name: "changew",     description: "Gewichte ändern",             type: 1 },

  { name: "winner",      description: "Gewinner anzeigen",           type: 1 },
];

/* -------------------- PUT zum Discord-API -------------------- */

const apiBase = "https://discord.com/api/v10";
const url = `${apiBase}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

const headers = {
  "Authorization": `Bot ${BOT_TOKEN}`,
  "Content-Type": "application/json",
};

try {
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(commands),
  });

  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }

  if (!res.ok) {
    console.error("✖ Discord-API Fehler:", res.status, res.statusText);
    console.error(payload);
    process.exit(1);
  }

  console.log("✅ Commands registriert:", Array.isArray(payload) ? payload.length : "?");
  for (const c of payload) {
    console.log(`  • /${c?.name} (${c?.id})`);
  }
  process.exit(0);
} catch (err) {
  console.error("✖ Netzwerk-/Laufzeitfehler beim Registrieren:", err);
  process.exit(1);
}
