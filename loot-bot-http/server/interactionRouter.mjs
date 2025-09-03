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

// Interactions
import * as voteItem from "../interactions/autocomplete/vote-item.mjs";
import * as rerollSelect from "../interactions/components/reroll-select.mjs";
import * as rollSelect from "../interactions/components/roll-select.mjs";
import * as voteReason from "../interactions/components/vote-reason.mjs";
import * as reasonSelect from "../ui/reasonSelect.mjs";

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

  // --- Application Commands ---
  if (type === 2) {
    const name = ctx.commandName?.();
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
        case "vote": return await vote.run(baseCtx);
        case "vote-info": return await voteInfo.run(baseCtx);
        case "vote-clear": return await voteClear.run(baseCtx);
        case "vote-remove": return await voteRemove.run(baseCtx);
        case "vote-show": return await voteShow.run(baseCtx);
        case "winner": return await winner.run(baseCtx);
        case "roll": return await roll.run(baseCtx);
        case "roll-all": return await rollAll.run(baseCtx);
        case "reroll": return await reroll.run(baseCtx);
        case "reducew": return await reducew.run(baseCtx);
        default:
          return ctx.reply(`Befehl **/${name}** ist noch nicht verdrahtet.`, { ephemeral: true });
      }
    } catch (e) {
      console.error(`Fehler in Command ${name}:`, e);
      return ctx.reply("❌ Da ging was schief.", { ephemeral: true });
    }
  }

  // --- Autocomplete ---
  if (type === 4) {
    try {
      return await voteItem.run(ctx);
    } catch (e) {
      console.error("Autocomplete error:", e);
      return ctx.reply("❌ Autocomplete Fehler.", { ephemeral: true });
    }
  }

  // --- Component Interactions (Selects, Buttons) ---
  if (type === 3) {
    const customId = ctx.interaction.data?.custom_id;
    const baseCtx = {
      interaction: ctx.interaction,
      reply: ctx.reply,
      followUp: ctx.followUp,
      showModal: ctx.showModal,
      guildId: ctx.guildId?.(),
      userId: ctx.userId?.(),
      member: ctx.member?.(),
      db: ctx.db,
    };

    try {
      if (customId?.startsWith("reroll-select")) {
        return await rerollSelect.run(baseCtx);
      }
      if (customId?.startsWith("roll-select")) {
        return await rollSelect.run(baseCtx);
      }
      if (customId?.startsWith("vote-reason")) {
        return await voteReason.run(baseCtx);
      }
      if (customId?.startsWith("reason-select")) {
        return await reasonSelect.run(baseCtx);
      }
      return ctx.reply("❌ Unbekanntes Component.", { ephemeral: true });
    } catch (e) {
      console.error("Component error:", e);
      return ctx.reply("❌ Fehler im Component.", { ephemeral: true });
    }
  }

  // --- Modal Submit ---
  if (type === 5) {
    try {
      // Aktuell nur Vote-Reason Modal vorgesehen
      return await voteReason.submit(ctx);
    } catch (e) {
      console.error("Modal error:", e);
      return ctx.reply("❌ Fehler im Modal.", { ephemeral: true });
    }
  }

  return ctx.reply("❌ Unbekannte Interaktion.", { ephemeral: true });
}
