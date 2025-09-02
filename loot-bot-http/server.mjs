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

    // 1) PING -> PONG (für Discord-Verification)
    if (interaction.type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    // 2) Slash-Commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const name = interaction.data?.name;

      if (name === "vote-info") {
        const content =
          "🔰 **Loot-Bot HTTP ist live**\n" +
          "Dies ist die Serverless/Interactions-only Variante. " +
          "Dein richtiges Tutorial hängen wir gleich aus der Bot-Logik dran.\n\n" +
          "_Antwort ist ephemer (nur du siehst das)._";

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content,
            flags: 64, // 64 = ephemer (nur der Aufrufer sieht’s)
          },
        });
      }

      // Fallback für unbekannte Commands
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "Unbekannter Command.",
          flags: 64,
        },
      });
    }

    // 3) Alles andere (Buttons etc. kommt später)
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Interaction-Typ noch nicht verdrahtet.",
        flags: 64,
      },
    });
  }
);

// Railway gibt den Port über ENV vor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot HTTP listening on port ${PORT}`);
});
