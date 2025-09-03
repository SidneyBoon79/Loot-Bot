// server/interactionRouter.mjs
// Zentraler Router für alle Discord-Interaction-Typen

// Commands
import * as vote from "../commands/vote.mjs";

// Component-, Autocomplete- und Modal-Router
import { onComponent } from "../interactions/components/index.mjs";
import { onAutocomplete } from "../interactions/autocomplete/index.mjs";
import { onModalSubmit } from "../interactions/modals/index.mjs";

// Optional: Command-Registry, falls du später weitere Commands addest
const COMMANDS = {
  [vote.command?.name || "vote"]: vote
};

// Hilfsfunktionen, um Adapter-Unterschiede abzufangen
function getType(ctx) {
  if (typeof ctx.type === "function") return ctx.type();
  return ctx.interaction?.type ?? null;
}
function getCommandName(ctx) {
  if (typeof ctx.commandName === "function") return ctx.commandName();
  return ctx.interaction?.data?.name ?? "";
}

/**
 * Haupteinstieg: Route eine Interaction basierend auf ihrem Typ.
 * @param {object} ctx - dein Context/Adapter-Objekt
 */
export async function routeInteraction(ctx) {
  try {
    const type = getType(ctx);

    switch (type) {
      // 2 = APPLICATION_COMMAND
      case 2: {
        const name = getCommandName(ctx);
        const cmd = COMMANDS[name];
        if (!cmd?.run) {
          // Unbekannter Command
          if (typeof ctx.reply === "function") {
            await ctx.reply("Befehl nicht gefunden.", { ephemeral: true });
          }
          return;
        }
        return cmd.run(ctx);
      }

      // 3 = MESSAGE_COMPONENT (Selects/Buttons)
      case 3: {
        return onComponent(ctx);
      }

      // 4 = APPLICATION_COMMAND_AUTOCOMPLETE
      case 4: {
        return onAutocomplete(ctx);
      }

      // 5 = MODAL_SUBMIT
      case 5: {
        return onModalSubmit(ctx);
      }

      // andere / unbekannte Typen
      default: {
        // höflich no-op
        if (typeof ctx.respond === "function") {
          return ctx.respond([]); // z. B. bei verirrten Autocomplete-Events
        }
        return;
      }
    }
  } catch (err) {
    console.error("[interactionRouter] fatal:", err);

    // Versuche, höflich eine Antwort zu geben / UI aufzuräumen
    if (typeof ctx.update === "function") {
      return ctx.update({ content: "Upps. Da ist was schiefgelaufen.", components: [] });
    }
    if (typeof ctx.reply === "function") {
      return ctx.reply("Upps. Da ist was schiefgelaufen.", { ephemeral: true });
    }
  }
}
