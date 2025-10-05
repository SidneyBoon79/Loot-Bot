// Minimaler Registrar direkt gegen die Discord REST API (ohne discord.js).
// Erwartet ENV: DISCORD_APP_ID, DISCORD_BOT_TOKEN, optional DISCORD_GUILD_ID

const {
  DISCORD_APP_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
} = process.env;

if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error("❌ Setze DISCORD_APP_ID und DISCORD_BOT_TOKEN in den Env-Variablen.");
  process.exit(1);
}

const API = "https://discord.com/api/v10";
const headers = {
  "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
  "Content-Type": "application/json",
};

// --- Command-Definitionen ---
// WICHTIG: /vote hat KEINE reason-Option mehr!
const commands = [
  // /vote
  {
    name: "vote",
    description: "Stimme für ein Item ab",
    type: 1, // CHAT_INPUT
    options: [
      {
        type: 3, // STRING
        name: "item",
        description: "Welches Item?",
        required: true,
        autocomplete: true,
      },
      // KEIN reason hier! Die Grund-Auswahl kommt aus deinem Dropdown-Component.
    ],
  },

  // /vote-info
  {
    name: "vote-info",
    description: "Zeigt aktuelle Stimmen (ephemeral)",
    type: 1,
  },

  // /vote-clear
  {
    name: "vote-clear",
    description: "Setzt Votes/Items zurück",
    type: 1,
  },

  // /vote-remove
  {
    name: "vote-remove",
    description: "Entfernt deine Stimme",
    type: 1,
  },

  // /vote-show
  {
    name: "vote-show",
    description: "Zeigt aktuelle Votes öffentlich",
    type: 1,
  },

  // /winner
  {
    name: "winner",
    description: "Ermittelt den Gewinner",
    type: 1,
  },

  // /roll
  {
    name: "roll",
    description: "Würfelt (ein Item / Zufallszahl)",
    type: 1,
  },

  // /roll-all
  {
    name: "roll-all",
    description: "Würfelt für alle",
    type: 1,
  },

  // /reroll
  {
    name: "reroll",
    description: "Erneut würfeln",
    type: 1,
  },

  // /changew
  {
    name: "changew",
    description: "Gewichtungsänderung",
    type: 1,
  },

  // /winner.mjs ist bereits oben als 'winner'
];

// Hilfsfunktionen
async function putJSON(url, body) {
  const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    console.error(`❌ ${res.status} ${res.statusText} @ ${url}`);
    console.error(text);
    throw new Error("Discord API error");
  }
  return json ?? text;
}

async function main() {
  // 1) Optional: GUILD-Commands (schnell)
  if (DISCORD_GUILD_ID) {
    const url = `${API}/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`;
    console.log("↻ Upserting GUILD commands…");
    const out = await putJSON(url, commands);
    console.log(`✅ Guild-Commands aktualisiert (${Array.isArray(out) ? out.length : "?"}).`);
  }

  // 2) Optional (empfohlen, um alte globale 'vote' mit reason loszuwerden):
  //    Entweder globale komplett ersetzen – ODER fürs Testing ganz weglassen.
  //    Hier ersetzen wir sie absichtlich identisch, damit global später auch korrekt ist.
  const urlGlobal = `${API}/applications/${DISCORD_APP_ID}/commands`;
  console.log("↻ Upserting GLOBAL commands…");
  const outG = await putJSON(urlGlobal, commands);
  console.log(`✅ Global-Commands aktualisiert (${Array.isArray(outG) ? outG.length : "?"}).`);

  console.log("🎉 Fertig. Slash-UI ggf. neu öffnen – bei Guild sofort, global kann dauern.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
