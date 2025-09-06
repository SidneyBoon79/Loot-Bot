// scripts/register-commands.mjs
// Registriert alle Slash Commands bei Discord

import fetch from "node-fetch";
import fs from "fs";

const appId = process.env.APPLICATION_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.BOT_TOKEN;

async function registerCommands() {
  const commands = [];

  // Lade alle Command-Dateien aus /commands
  const files = fs.readdirSync("./commands").filter((f) => f.endsWith(".mjs"));

  for (const file of files) {
    const { default: cmd } = await import(`../commands/${file}`);
    if (cmd && cmd.name && cmd.description) {
      commands.push({
        name: cmd.name,
        description: cmd.description,
        type: 1, // Slash Command
        // Wichtig: keine options mehr bei reducew
        options: cmd.name === "reducew" ? [] : cmd.options || [],
      });
    }
  }

  console.log("Registriere Commands:", commands.map((c) => c.name).join(", "));

  const url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    console.error("Fehler beim Registrieren:", await res.text());
  } else {
    console.log("✅ Commands registriert!");
  }
}

registerCommands().catch(console.error);
