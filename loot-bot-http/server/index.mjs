import express from "express";
import { routeInteraction } from "./interactionRouter.mjs";
import bodyParser from "body-parser";
import { Pool } from "pg";

// --- DB Setup ---
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

// --- Express Setup ---
const app = express();
app.use(bodyParser.json());

// --- Context Builder ---
function makeCtx(interaction, res) {
  return {
    interaction,
    type: () => interaction.type,
    commandName: () => interaction.data?.name,
    guildId: () => interaction.guild_id,
    userId: () => interaction.member?.user?.id,
    member: () => interaction.member,
    reply: (content, opts = {}) => {
      return res.json({
        type: 4, // Channel message with source
        data: {
          content: content,
          flags: opts.ephemeral ? 64 : undefined,
        },
      });
    },
    followUp: (content, opts = {}) => {
      return res.json({
        type: 4,
        data: {
          content: content,
          flags: opts.ephemeral ? 64 : undefined,
        },
      });
    },
    showModal: (modal) => {
      return res.json({
        type: 9,
        data: modal,
      });
    },
    db: pool,
  };
}

// --- Routes ---
app.post("/interactions", async (req, res) => {
  const ctx = makeCtx(req.body, res);
  try {
    await routeInteraction(ctx);
  } catch (e) {
    console.error("Route Interaction Error:", e);
    return res.json({
      type: 4,
      data: { content: "❌ Interner Fehler.", flags: 64 },
    });
  }
});

// --- Start ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${port}`);
});
