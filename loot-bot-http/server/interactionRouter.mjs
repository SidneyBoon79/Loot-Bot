import * as vote from "../commands/vote.mjs";
import * as voteInfo from "../commands/vote-info.mjs";
import * as voteClear from "../commands/vote-clear.mjs";
import * as voteRemove from "../commands/vote-remove.mjs";
import * as voteShow from "../commands/vote-show.mjs";
import * as winner from "../commands/winner.mjs";
import * as roll from "../commands/roll.mjs";
import * as rollAll from "../commands/roll-all.mjs";
import * as reroll from "../commands/reroll.mjs";
import * as reducew from "../commands/reducew.mjs";

// Helper: Options API
function buildOptsAPI(interaction) {
  return {
    getString: (name) => interaction.data?.options?.find(o => o.name === name)?.value || null,
    getInteger: (name) => interaction.data?.options?.find(o => o.name === name)?.value || null,
    getBoolean: (name) => interaction.data?.options?.find(o => o.name === name)?.value || null
  };
}

export async function routeInteraction(ctx) {
  const type = ctx.type?.();

  // Application Command
  if (type === 2) {
    const name = ctx.commandName?.();

    // Gemeinsamen Context für alle Commands aufbauen
    const baseCtx = {
      interaction: ctx.interaction,
      reply: ctx.reply,
      followUp: ctx.followUp,
      showModal: ctx.showModal,
      guildId: ctx.guildId?.(),
      userId: ctx.userId?.(),
      member: ctx.member?.(),
      db: ctx.db,
      opts: buildOptsAPI(ctx.interaction)
    };

    try {
      switch (name) {
        case "vote":
          return await vote.run(baseCtx);
        case "vote-info":
          return await voteInfo.run(baseCtx);
        case "vote-clear":
          return await voteClear.run(baseCtx);
        case "vote-remove":
          return await voteRemove.run(baseCtx);
        case "vote-show":
          return await voteShow.run(baseCtx);
        case "winner":
          return await winner.run(baseCtx);
        case "roll":
          return await roll.run(baseCtx);
        case "roll-all":
          return await rollAll.run(baseCtx);
        case "reroll":
          return await reroll.run(baseCtx);
        case "reducew":
          return await reducew.run(baseCtx);
        default:
          return ctx.reply(`Befehl **/${name}** ist noch nicht verdrahtet.`, { ephemeral: true });
      }
    } catch (e) {
      console.error(`Fehler in Command ${name}:`, e);
      return ctx.reply("❌ Da ging was schief.", { ephemeral: true });
    }
  }

  // Interactions (Components, Modals, Autocomplete) später hier erweitern
  return ctx.reply("❌ Unbekannte Interaktion.", { ephemeral: true });
}
