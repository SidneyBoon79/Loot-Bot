// scripts/register-vote-remove.mjs
// Aktualisiert NUR den /vote-remove Slash-Command (oder legt ihn an, falls er fehlt).
// Nutzt GUILD-Scope, wenn GUILD_ID gesetzt ist; sonst GLOBAL.

import fs from "fs";
import path from "path";
import { REST, Routes } from "discord.js";

const TOKEN     = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID     || process.env.APPLICATION_ID;
const GUILD_ID  = process.env.GUILD_ID || ""; // leer => global registrieren

if (!TOKEN || !CLIENT_ID) {
  console.error("Bitte DISCORD_TOKEN/BOT_TOKEN und CLIENT_ID/APPLICATION_ID in der Umgebung setzen.");
  process.exit(1);
}

// Lade die neue Definition (ohne Optionen)
const defPath = path.resolve(process.cwd(), "vote-remove.json");
if (!fs.existsSync(defPath)) {
  console.error(`vote-remove.json nicht gefunden unter: ${defPath}`);
  process.exit(1);
}
const voteRemoveDef = JSON.parse(fs.readFileSync(defPath, "utf8"));

// REST-Client
const rest = new REST({ version: "10" }).setToken(TOKEN);

async function runGuild() {
  // Vorhandene Guild-Commands listen
  const existing = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
  const found = existing.find((c) => c.name === "vote-remove");

  if (found) {
    await rest.patch(
      Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, found.id),
      { body: voteRemoveDef }
    );
    console.log(`✅ /vote-remove (Guild ${GUILD_ID}) aktualisiert (Command-ID: ${found.id}).`);
  } else {
    const created = await rest.post(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: voteRemoveDef }
    );
    console.log(`✅ /vote-remove (Guild ${GUILD_ID}) erstellt (Command-ID: ${created.id}).`);
  }
}

async function runGlobal() {
  // Vorhandene Global-Commands listen
  const existing = await rest.get(Routes.applicationCommands(CLIENT_ID));
  const found = existing.find((c) => c.name === "vote-remove");

  if (found) {
    await rest.patch(
      Routes.applicationCommand(CLIENT_ID, found.id),
      { body: voteRemoveDef }
    );
    console.log(`✅ /vote-remove (GLOBAL) aktualisiert (Command-ID: ${found.id}).`);
  } else {
    const created = await rest.post(
      Routes.applicationCommands(CLIENT_ID),
      { body: voteRemoveDef }
    );
    console.log(`✅ /vote-remove (GLOBAL) erstellt (Command-ID: ${created.id}).`);
  }
}

try {
  if (GUILD_ID) {
    await runGuild();
  } else {
    await runGlobal();
  }
  console.log("✨ Fertig.");
} catch (err) {
  console.error("❌ Fehler bei der Registrierung:", err?.response?.data ?? err);
  process.exit(1);
}
