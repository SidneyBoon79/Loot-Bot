// server/index.mjs
// HTTP-Entry für Loot-Bot (ESM). Ohne cors/body-parser.
// Ruft beim Start ensureSchema() auf und verdrahtet den Interaction-Router.

import express from "express";
import { ensureSchema } from "../services/wins.mjs";           // Schema prüfen/erstellen
import { routeInteraction } from "./interactionRouter.mjs";    // (req, res) -> Promise<void>

const PORT = Number(process.env.PORT || 8080);

// --- Boot: DB-Schema sicherstellen ------------------------------------------
try {
  await ensureSchema();
  console.log("[DB] wins-Schema geprüft/aktualisiert.");
} catch (err) {
  console.error("[DB] ensureSchema() failed:", err);
}

// --- Express -----------------------------------------------------------------
const app = express();
app.disable("x-powered-by");

// Discord sendet JSON → native Parser von Express nutzen (keine extra deps)
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: false }));

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("Loot-Bot-HTTP OK"));

// Discord Interactions Endpoint
app.post("/interactions", async (req, res) => {
  try {
    await routeInteraction(req, res);
  } catch (err) {
    console.error("Fehler bei routeInteraction:", err);
    // Discord erwartet eine 200-Antwort; wir senden generisch zurück.
    return res.status(200).json({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: { content: "❌ Da ging was schief." }
    });
  }
});

// --- Start -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
