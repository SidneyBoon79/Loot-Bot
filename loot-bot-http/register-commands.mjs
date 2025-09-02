// register-commands.mjs — einmal ausführen zum Registrieren/Updaten der Slash-Commands
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || ""; // optional: wenn du erst auf einem Server testen willst

if (!TOKEN || !CLIENT_ID) {
  console.error("BOT_TOKEN und CLIENT_ID müssen als ENV gesetzt sein.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("vote-info")
    .setDescription("Kurz-Tutorial anzeigen (nur für dich)")
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

try {
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Guild-Commands registriert für Guild:", GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Global-Commands registriert.");
  }
} catch (e) {
  console.error("Fehler beim Registrieren:", e);
  process.exit(1);
}
