// server/interactionRouter.mjs
// Minimaler Router: verdrahtet /vote-info zuverlässig.
// (Andere Commands können wir danach schrittweise dazuhängen.)

import * as voteInfo from "../commands/vote-info.mjs";

/**
 * Baut eine schlanke Options-API wie ctx.opts.getString(...)
 */
function buildOptsAPI(interaction) {
  const list = interaction?.data?.options ?? [];
  const byName = new Map(list.map(o => [o.name, o]));

  return {
    getString:  (name) => byName.get(name)?.value ?? null,
    getInteger: (name) => byName.get(name)?.value ?? null,
    getUser:    (name) => byName.get(name)?.value ?? null
  };
}

/**
 * Führt die Interaction aus. Nur /vote-info ist aktiv verdrahtet.
 */
export async function routeInteraction(ctx) {
  const type = ctx.type?.();

  // 2 = APPLICATION_COMMAND
  if (type === 2) {
    const name = ctx.commandName?.();

    // ---- /vote-info -----------------------------------
    if (name === "vote-info") {
      try {
        // Minimales ctx, das vote-info benötigt
        const execCtx = {
          interaction: ctx.interaction,
          reply: ctx.reply,
          followUp: ctx.followUp,
          showModal: ctx.showModal,
          guildId: ctx.guildId?.(),
          userId: ctx.userId?.(),
          member: ctx.interaction?.member ?? null,
          opts: buildOptsAPI(ctx.interaction)
        };

        return await voteInfo.run(execCtx);
      } catch (err) {
        console.error("[router] vote-info error:", err);
        return ctx.reply("Upps. Da ging was schief.", { ephemeral: true });
      }
    }
    // ---------------------------------------------------

    // Noch nicht verdrahtete Commands -> nette Fehlermeldung
    return ctx.reply(
      `Befehl **/${name}** ist noch nicht verdrahtet.`,
      { ephemeral: true }
    );
  }

  // Unbekannter Interaktionstyp → still zurück
  return;
}
