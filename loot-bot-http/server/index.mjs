// server/index.mjs
// HTTP-Entry für Loot-Bot (ESM).
// Ruft beim Start ensureSchema() auf und verdrahtet den Interaction-Router.

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

import { ensureSchema } from "../services/wins.mjs";           // <— wichtig
import { routeInteraction } from "./interactionRouter.mjs";    // erwartet: (req, res) -> Promise<void>

const PORT = Number(process.env.PORT || 8080);

// --- Boot: Schema sicherstellen ---------------------------------------------
try {
  await ensureSchema();
  console.log("[DB] wins-Schema geprüft/aktualisiert.");
} catch (err) {
  console.error("[DB] ensureSchema() failed:", err);
  // Wir loggen hart, starten aber dennoch den Server, damit Healthchecks antworten.
}

// --- Express ----------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.use(cors());

// Discord schickt JSON; wir brauchen body parser
app.use(bodyParser.json({ limit: "512kb" }));
app.use(bodyParser.urlencoded({ extended: false }));

// Health
app.get("/", (_req, res) => res.status(200).send("Loot-Bot-HTTP OK"));

// Interactions Endpoint (Discord)
app.post("/interactions", async (req, res) => {
  try {
    await routeInteraction(req, res);
  } catch (err) {
    console.error("Fehler bei routeInteraction:", err);
    // Discord verlangt 200/204 mit Fehlertext in JSON – wir schicken einen generischen Fehler zurück.
    try {
      return res.status(200).json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: { content: "❌ Da ging was schief." }
      });
    } catch {}
  }
});

// --- Start -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
