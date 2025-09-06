// scripts/register-guild.mjs
import fetch from "node-fetch";

const TOKEN    = process.env.BOT_TOKEN;   // du nutzt BOT_TOKEN in Railway
const CLIENTID = process.env.CLIENT_ID;   // App-ID
const GUILDID  = process.env.GUILD_ID;    // Test-Guild für sofortige Sichtbarkeit

if (!TOKEN || !CLIENTID || !GUILDID) {
  console.error("Fehlende ENV: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${CLIENTID}/guilds/${GUILDID}/commands`;

// Nur das Nötigste – /reducew OHNE Optionen, /vote mit Autocomplete-Item
const commands = [
  {
    name: "vote",
    description: "Item voten (mit Grund-Auswahl danach)",
    type: 1,
    options: [
      { type: 3, name: "item", description: "Itemname", required: true, autocomplete: true }
    ]
  },
  { name: "vote-show",   description: "Aktuelle Votes (48h)", type: 1 },
  { name: "vote-remove", description: "Eigenen Vote entfernen", type: 1 },
  { name: "vote-clear",  description: "Alle Votes zurücksetzen (Mod)", type: 1 },
  { name: "roll",        description: "Roll – wähle ein Item", type: 1 },
  { name: "roll-all",    description: "Roll über alle Items", type: 1 },
  { name: "reroll",      description: "Reroll", type: 1 },
  { name: "winner",      description: "Aktuelle Gewinner je Item (48h)", type: 1 },
  { name: "reducew",     description: "Wins reduzieren (Dropdown, -1 pro Klick)", type: 1 },
  { name: "vote-info",   description: "Kurz-Anleitung", type: 1 }
];

async function main() {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Register failed:", res.status, text);
    process.exit(1);
  }
  console.log("✅ Guild-Commands überschrieben (inkl. neuem /reducew ohne Options).");
}
main().catch(e => { console.error(e); process.exit(1); });
