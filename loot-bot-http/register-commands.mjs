// register-commands.mjs
// Registriert/aktualisiert Slash-Commands bei Discord (Guild-Scoped)

import "node:fs/promises";
import fetch from "node-fetch"; // Node 18+ hat global fetch; Railway meist auch. Falls Fehler: npm i node-fetch@3

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Environment Variablen fehlen: DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID");
  process.exit(1);
}

// ---- Commands-Definitionen (müssen zu deinen Files passen) ----
const commands = [
  {
    name: "vote",
    description: "Vote abgeben: Item (Autocomplete) oder per Modal eingeben → Grund wählen",
    options: [
      {
        type: 3,
        name: "item",
        description: "Item-Name (Autocomplete). Leer lassen für manuelle Eingabe im Modal.",
        required: false,
        autocomplete: true
      }
    ]
  },
  { name: "vote-info",   description: "Zeigt das Kurz-Tutorial" },
  { name: "vote-show",   description: "Zeigt alle Votes der letzten 48h" },
  {
    name: "vote-remove",
    description: "Entferne deinen Vote für ein Item",
    options: [{ type: 3, name: "item", description: "Name des Items", required: true }]
  },
  { name: "vote-clear",  description: "Löscht alle Votes, Items und Wins (Reset)" },
  {
    name: "reducew",
    description: "Reduziert die Win-Zahl eines Users",
    options: [
      { type: 6, name: "user", description: "Wähle den User aus", required: true },
      { type: 4, name: "anzahl", description: "Um wie viele Wins reduzieren?", required: true, min_value: 1 }
    ]
  },
  { name: "winner",   description: "Zeigt eine kompakte Übersicht der Gewinner (letzte 48h)" },
  { name: "roll",     description: "Rollt ein einzelnes Item aus (nur für Mods/Admins)" },
  { name: "roll-all", description: "Rollt alle offenen Items (nur für Mods/Admins)" },
  { name: "reroll",   description: "Re-Roll eines bereits gerollten Items (nur für Mods/Admins)" }
];

// ---- Discord REST Call ----
const url = `https://discord.com/api/v10/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`;

async function main() {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bot ${TOKEN}`
    },
    body: JSON.stringify(commands)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("❌ Fehler beim Registrieren:", res.status, text);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`✅ ${data.length} Commands registriert/aktualisiert für Guild ${GUILD_ID}.`);
}

main().catch(err => {
  console.error("❌ Unexpected:", err);
  process.exit(1);
});
// register-commands.mjs — registriert Guild-Commands inkl. neuem /reroll
import { REST, Routes } from "discord.js";

const TOKEN    = process.env.BOT_TOKEN;
const APP_ID   = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !APP_ID || !GUILD_ID) {
  console.error("❌ ENV fehlt: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(TOKEN);
const MANAGE_GUILD = "32";

const commands = [
  { name: "vote",        description: "Vote abgeben: Item eingeben, dann Typ(en) wählen.", type: 1, dm_permission: false },
  { name: "vote-show",   description: "Aktuelle Votes anzeigen (48h-Fenster).",            type: 1, dm_permission: false },
  { name: "vote-remove", description: "Entfernt deine Stimme zu einem Item (kein Doppelvote).", type: 1, dm_permission: false },
  { name: "vote-clear",  description: "Löscht Votes/Items/Wins (Cleanup).",                type: 1, dm_permission: false, default_member_permissions: MANAGE_GUILD },
  { name: "vote-info",   description: "Kurze Erklärung (ephemer).",                         type: 1, dm_permission: false },
  { name: "roll",        description: "Manueller Roll für ein **nicht gerolltes** Item (Dropdown).", type: 1, dm_permission: false, default_member_permissions: MANAGE_GUILD },
  { name: "reroll",      description: "Re-Roll für ein **bereits gerolltes** Item (Dropdown + Bestätigung).", type: 1, dm_permission: false, default_member_permissions: MANAGE_GUILD },
  { name: "roll-all",    description: "Rollt alle offenen Items (48h, nicht gerollt).",     type: 1, dm_permission: false, default_member_permissions: MANAGE_GUILD },
  { name: "winner",      description: "Gewinner der letzten 48h (User — Item).",            type: 1, dm_permission: false, default_member_permissions: MANAGE_GUILD },
  { name: "reducew",     description: "Wins eines Users reduzieren (Dropdown + Modal).",    type: 1, dm_permission: false, default_member_permissions: MANAGE_GUILD }
];

async function main() {
  try {
    console.log(`🚀 Registriere GUILD-Commands für Guild ${GUILD_ID} …`);
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
    console.log(`✅ Guild-Commands registriert: ${commands.length}`);
  } catch (err) {
    console.error("❌ Registrierung fehlgeschlagen:", err?.message || err);
    if (err?.rawError) console.error("Discord API Fehler:", err.rawError);
    process.exit(1);
  }
}
main();
