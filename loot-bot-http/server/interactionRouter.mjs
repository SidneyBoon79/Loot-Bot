// server/interactionRouter.mjs — FINAL (Autocomplete-Fix)

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

// ✅ Autocomplete & Components (richtige Symbolnamen!)
import { handleVoteItemAutocomplete } from "../interactions/autocomplete/vote-item.mjs";
import * as rerollSelect from "../interactions/components/reroll-select.mjs";
import * as rollSelect from "../interactions/components/roll-select.mjs";
import { handleVoteReason } from "../interactions/components/vote-reason.mjs";

// Helper: Options API
function buildOptsAPI(interaction) {
  const opts = interaction?.data?.options || [];
  return {
    getString: (name) => opts.find(o => o.name === name)?.value ?? null,
    getInteger: (name) => opts.find(o => o.name === name)?.value ?? null,
    getBoolean: (name) => opts.find(o => o.name === name)?.value ?? null,
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
      opts: buildOptsAPI(ctx.interaction),
    };

    try {
      switch (name) {
        case "vote":       return await vote.run(baseCtx);
        case "vote-info":  return await voteInfo.run(baseCtx);
        case "vote-clear": return await voteClear.run(baseCtx);
        case "vote-remove":return await voteRemove.run(baseCtx);
        case "vote-show":  return await voteShow.run(baseCtx);
        case "winner":     return await winner.run(baseCtx);
        case "roll":       return await roll.run(baseCtx);
        case "roll-all":   return await rollAll.run(baseCtx);
        case "reroll":     return await reroll.run(baseCtx);
        case "reducew":    return await reducew.run(baseCtx);
        default:
          return ctx.reply(`Befehl **/${name}** ist noch nicht verdrahtet.`, { ephemeral: true });
      }
    } catch (e) {
      console.error(`Fehler in Command ${name}:`, e);
      return ctx.reply("❌ Da ging was schief.", { ephemeral: true });
    }
  }

  // --- Autocomplete --- (APPLICATION_COMMAND_AUTOCOMPLETE = 4)
  if (type === 4) {
    try {
      // ✅ KORREKT: neuer Handler-Name
      return await handleVoteItemAutocomplete(ctx);
    } catch (e) {
      console.error("Autocomplete error:", e);
      return ctx.respond([]); // leere Choices statt Fehler
    }
  }

  // --- Component Interactions (MESSAGE_COMPONENT = 3) ---
  if (type === 3) {
    const customId = ctx.customId?.() || ctx.interaction?.data?.custom_id;
    const baseCtx = {
      interaction: ctx.interaction,
      reply: ctx.reply,
      followUp: ctx.followUp,
      update: ctx.update,
      guildId: ctx.guildId?.(),
      userId: ctx.userId?.(),
      member: ctx.member?.(),
      db: ctx.db,
      customId: () => customId,
    };

    try {
      if (customId?.startsWith("reroll-select")) return await (rerollSelect.run?.(baseCtx));
      if (customId?.startsWith("roll-select"))   return await (rollSelect.run?.(baseCtx));
      if (customId?.startsWith("vote:grund:"))   return await handleVoteReason(baseCtx);
      return ctx.reply("❌ Unbekanntes Component.", { ephemeral: true });
    } catch (e) {
      console.error("Component error:", e);
      return ctx.reply("❌ Fehler im Component.", { ephemeral: true });
    }
  }

  // --- Modal Submit (MODAL_SUBMIT = 5) ---
  if (type === 5) {
    return ctx.reply("❌ Unbekannte Modal-Aktion.", { ephemeral: true });
  }

  return ctx.reply("❌ Unbekannte Interaktion.", { ephemeral: true });
}
