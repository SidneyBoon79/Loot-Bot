// register-commands.mjs  — Schritt A: reducew NICHT registrieren
import { REST, Routes } from "discord.js";

import vote from "./commands/vote.mjs";
import voteShow from "./commands/vote-show.mjs";
import voteRemove from "./commands/vote-remove.mjs";
import roll from "./commands/roll.mjs";
import rollAll from "./commands/roll-all.mjs";
import reroll from "./commands/reroll.mjs";
import winner from "./commands/winner.mjs";
import voteClear from "./commands/vote-clear.mjs";
// KEIN reducew hier!

const commands = [
  vote,
  voteShow,
  voteRemove,
  roll,
  rollAll,
  reroll,
  winner,
  voteClear,
];

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

async function main() {
  try {
    console.log("Registering slash commands (ohne reducew) …");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log("✅ Commands registriert (reducew deregistriert).");
  } catch (error) {
    console.error(error);
  }
}
main();
