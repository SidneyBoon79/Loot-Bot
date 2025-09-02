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
