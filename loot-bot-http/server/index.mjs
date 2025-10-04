// server/index.mjs
import express from "express";
import { verifyKeyMiddleware } from "discord-interactions";
import { makeCtx, routeInteraction } from "../adapter.mjs";

const {
  DISCORD_PUBLIC_KEY,
  PORT = "8080",
  NODE_ENV = "production",
} = process.env;

const app = express();

// Wichtig: Discord verifiziert die Signatur – Middleware VOR der Route!
app.post(
  "/interactions",
  verifyKeyMiddleware(DISCORD_PUBLIC_KEY),
  async (req, res) => {
    const ctx = makeCtx(req.body, res);

    try {
      await routeInteraction(ctx);
    } catch (e) {
      console.error("[INT] Route Interaction Error:", e);
      // Fallback: Saubere Fehlermeldung (ephemeral)
      return res.status(200).json({
        type: 4,
        data: { content: "❌ Interner Fehler.", flags: 64 },
      });
    }
  }
);

app.get("/", (_req, res) => {
  res.type("text/plain").send("Loot-Bot-HTTP OK");
});

app.listen(Number(PORT), () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
  if (NODE_ENV !== "production") {
    console.log("[DEV] Public key gesetzt:", !!DISCORD_PUBLIC_KEY);
  }
});
