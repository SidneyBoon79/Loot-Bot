// register-commands.mjs — Registriert /vote ohne "reason"-Option

import { REST, Routes } from "discord.js";

// ---- Command-Definitionen ----

// /vote mit EINER Option: item (String, autocomplete)
const vote = {
  name: "vote",
  description: "Run vote",
  options: [
    {
      type: 3,               // STRING
      name: "item",
      description: "Welches Item?",
      required: true,
      autocomplete: true,
    },
    // KEIN "reason" hier!
  ],
};

// Falls deine übrigen Commands rein über JSON registriert werden sollen,
// trage sie hier analog ein oder importiere sie – aber UNVERÄNDERT lassen:
import voteShow from "./commands/vote-show.mjs";
import voteRemove from "./commands/vote-remove.mjs";
import roll from "./commands/roll.mjs";
import rollAll from "./commands/roll-all.mjs";
import reroll from "./commands/reroll.mjs";
import winner from "./commands/winner.mjs";
import voteClear from "./commands/vote-clear.mjs";

// Wichtig: Wenn die oben importierten Module ein JSON/Builder exportieren,
// musst du hier nichts anfassen. Wir ersetzen NUR das /vote Schema.

const commands = [
  vote,        // <- unser überschriebenes /vote ohne "reason"
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
    console.log("Registering slash commands (global) …");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✓ Commands registriert.");
  } catch (error) {
    console.error(error);
  }
}

main();
