// server/index.mjs — FINAL (mit ctx.respond für Autocomplete)

import express from "express";
import bodyParser from "body-parser";
import { routeInteraction } from "./interactionRouter.mjs";
import { Pool } from "pg";

// --- DB ---
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

// --- Express ---
const app = express();
app.use(bodyParser.json());

// --- Context Builder ---
function makeCtx(interaction, res) {
  // Low-level sender
  const send = (payload) => res.json(payload);

  // Normalisiert Message-Daten (string oder object)
  const normalizeData = (data, opts = {}) => {
    if (data && typeof data === "object" && (data.content || data.embeds || data.components)) {
      const { ephemeral, ...rest } = data;              // 👈 ephemeral aus data ziehen
      const isEphemeral = opts.ephemeral ?? ephemeral;  // 👈 data.ephemeral oder opts.ephemeral
      const flags = isEphemeral ? 64 : rest.flags;      // 👈 ephemeral → flags:64
      return { ...rest, flags };                        // 👈 ephemeral nicht weitergeben
    }
    return { content: String(data ?? ""), flags: opts.ephemeral ? 64 : undefined };
  };

  return {
    interaction,

    // getters
    type: () => interaction.type,
    commandName: () => interaction.data?.name,
    guildId: () => interaction.guild_id,
    userId: () => interaction.member?.user?.id,
    member: () => interaction.member,
    customId: () => interaction.data?.custom_id,
    getFocusedOptionValue: () =>
      interaction?.data?.options?.find?.((o) => o?.focused)?.value,

    // responders
    reply: (data, opts = {}) => send({ type: 4, data: normalizeData(data, opts) }), // CHANNEL_MESSAGE_WITH_SOURCE
    followUp: (data, opts = {}) => send({ type: 4, data: normalizeData(data, opts) }),
    update: (data, opts = {}) => send({ type: 7, data: normalizeData(data, opts) }), // UPDATE_MESSAGE
    respond: (choices = []) => send({ type: 8, data: { choices } }), // ✅ AUTOCOMPLETE RESULT
    showModal: (modal) => send({ type: 9, data: modal }), // SHOW_MODAL

    // db
    db: pool,
  };
}

// --- Route ---
app.post("/interactions", async (req, res) => {
  const ctx = makeCtx(req.body, res);
  try {
    await routeInteraction(ctx);
  } catch (e) {
    console.error("Route Interaction Error:", e);
    return res.json({ type: 4, data: { content: "❌ Interner Fehler.", flags: 64 } });
  }
});

// --- Start ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${port}`);
});
