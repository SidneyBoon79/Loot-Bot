// server.mjs – Minimaler Interactions-Endpoint für Discord
import express from "express";
import {
  verifyKeyMiddleware,
  InteractionType,
  InteractionResponseType,
} from "discord-interactions";

const app = express();

// Healthcheck (für dich und Railway)
app.get("/", (_req, res) => res.status(200).send("ok"));

// Discord Interactions Endpoint
app.post(
  "/interactions",
  verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    const interaction = req.body;

    // 1) PING -> PONG (Discord testet damit, ob dein Endpoint korrekt antwortet)
    if (interaction.type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    // 2) Platzhalter für alle anderen Interaktionen
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Loot-Bot HTTP ist online ✅ (Migration läuft …)",
        flags: 64, // 64 = nur der Aufrufer sieht's (ephemeral)
      },
    });
  }
);

// Railway gibt den Port über ENV vor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot HTTP listening on port ${PORT}`);
});
