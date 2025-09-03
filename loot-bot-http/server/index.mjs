// server/index.mjs
// Einstiegspunkt: Discord Interaction Endpoint (HTTP)

import express from "express";
import bodyParser from "body-parser";
import { routeInteraction } from "./interactionRouter.mjs";

const app = express();
app.use(bodyParser.json());

// POST /interactions – Discord schickt hier alle Interactions hin
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

  // Hilfsfunktionen, die wir überall nutzen können
  return {
    interaction,
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
      // Autocomplete (type 4) erwartet spezielle Antwort
      if (interaction.type === 4) {
        return res.json({ type: 8, data: { choices } });
      }
    },
    reply: (data, opts = {}) => {
      // Normale Antworten
      const payload = { type: 4, data: { ...data, flags: opts.ephemeral ? 64 : 0 } };
      return res.json(payload);
    },
    update: (data) => {
      // Update für Component/Modal
      return res.json({ type: 7, data });
    },
    followUp: (msg, opts = {}) => {
      // Für nachträgliche Messages (hier simple Fallback)
      const payload = { type: 4, data: { content: msg, flags: opts.ephemeral ? 64 : 0 } };
      return res.json(payload);
    },
    showModal: (modal) => {
      return res.json({ type: 9, data: modal });
    }
  };
}
