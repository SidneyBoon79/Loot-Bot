// scripts/register-guild.mjs
// Registriert ALLE Commands für EINE Guild (sofort sichtbar), ohne discord.js.
// Env: BOT_TOKEN, CLIENT_ID (Application ID), GUILD_ID

import fetch from "node-fetch";

const TOKEN    = process.env.BOT_TOKEN;
const CLIENTID = process.env.CLIENT_ID;   // Application ID
const GUILDID  = process.env.GUILD_ID;    // Ziel-Guild (Server)

if (!TOKEN || !CLIENTID || !GUILDID) {
  console.error("❌ Fehlende ENV. Benötigt: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${CLIENTID}/guilds/${GUILDID}/commands`;

// ---- Alle Commands deines Bots (Guild-Variante) ----
const commands = [
  // /vote <item>
  {
    name: "vote",
    description: "Item voten (Grund-Auswahl folgt im UI).",
    type: 1,
    options: [
      { type: 3, name: "item", description: "Itemname", required: true, autocomplete: true }
    ]
  },

  { name: "vote-show",   description: "Aktuelle Votes (48h).", type: 1 },
  { name: "vote-remove", description: "Eigenen Vote entfernen.", type: 1 },
  { name: "vote-clear",  description: "Alle Votes zurücksetzen (Mod).", type: 1 },

  { name: "roll",        description: "Roll – wähle ein Item.", type: 1 },
  { name: "roll-all",    description: "Roll über alle Items.", type: 1 },
  { name: "reroll",      description: "Reroll.", type: 1 },
  { name: "winner",      description: "Aktuelle Gewinner je Item (48h).", type: 1 },

  // neue /reducew (ohne Options; Dropdown folgt im UI)
  { name: "reducew",     description: "Wins reduzieren (Dropdown, -1 pro Klick).", type: 1 },

  $1

  // /changew <user> <amount>
  {
    name: "changew",
    description: "Wins anpassen (händisch Wert angeben)",
    type: 1,
    options: [
      { type: 3, name: "user", description: "User ID oder @Mention", required: true },
      { type: 4, name: "amount", description: "Änderung der Wins (negativ oder positiv)", required: true }
    ]
  },
];

async function main() {
  console.log(`▶️  Registriere ${commands.length} Guild-Commands für ${GUILDID} …`);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json",
      "X-Audit-Log-Reason": "Loot-Bot guild command refresh"
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("❌ Fehler bei der Registrierung:", res.status, text);
    process.exit(1);
  }

  const data = await res.json();
  console.log("✅ Erfolgreich registriert. Commands:");
  for (const c of data) {
    console.log(` - /${c.name}${c.default_member_permissions ? " (perm)" : ""}`);
  }
}

main().catch((e) => {
  console.error("❌ Unerwarteter Fehler:", e);
  process.exit(1);
});
