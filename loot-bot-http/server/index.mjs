// server/index.mjs
// Einstiegspunkt: Discord Interaction Endpoint (HTTP-Server)

import express from "express";
import bodyParser from "body-parser";
import { routeInteraction } from "./interactionRouter.mjs";

const app = express();
app.use(bodyParser.json());

// POST /interactions – Discord sendet hier alle Interactions hin
app.post("/interactions", async (req, res) => {
  try {
    const ctx = makeCtx(req, res);
    await routeInteraction(ctx);
  } catch (err) {
    console.error("[server] fatal:", err);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});

// ------------------------------------------------------
// Hilfsfunktion: baut ein Context-Objekt für unsere Router
// ------------------------------------------------------
function makeCtx(req, res) {
  const interaction = req.body;

  return {
    interaction,
    // Typ & Infos
    type: () => interaction.type,
    commandName: () => interaction.data?.name,
    focusedOptionName: () =>
      interaction.data?.options?.find?.(o => o.focused)?.name,
    getFocusedOptionValue: () =>
      interaction.data?.options?.find?.(o => o.focused)?.value,
    customId: () => interaction.data?.custom_id,
    values: () => interaction.data?.values,
    userId: () => interaction.member?.user?.id ?? interaction.user?.id,
    guildId: () => interaction.guild_id,

    // Antworten an Discord
    respond: (choices) => {
      if (interaction.type === 4) {
        // Autocomplete (type 4)
        return res.json({ type: 8, data: { choices } });
      }
    },
    reply: (data, opts = {}) => {
      const payload = {
        type: 4,
        data: {
          ...data,
          flags: opts.ephemeral ? 64 : 0,
        },
      };
      return res.json(payload);
    },
    update: (data) => {
      return res.json({ type: 7, data });
    },
    followUp: (msg, opts = {}) => {
      const payload = {
        type: 4,
        data: {
          content: msg,
          flags: opts.ephemeral ? 64 : 0,
        },
      };
      return res.json(payload);
    },
    showModal: (modal) => {
      return res.json({ type: 9, data: modal });
    },
  };
}
