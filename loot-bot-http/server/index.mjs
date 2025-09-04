// server/index.mjs
// Sicherer Discord-HTTP Entry mit Ed25519 Signature Verify.
// ESM: "type": "module"

import express from "express";
import nacl from "tweetnacl";

import { ensureSchema } from "../services/wins.mjs";
import { routeInteraction } from "./interactionRouter.mjs";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

// --- Raw Body Capture für die Signaturprüfung --------------------------------
const app = express();
app.disable("x-powered-by");

// Wir brauchen den *ungeparsten* Body-Buffer für die Signatur:
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: false }));

// --- Discord Signaturprüfung --------------------------------------------------
function verifyDiscordRequest(req) {
  try {
    const timestamp = req.header("X-Signature-Timestamp");
    const signature = req.header("X-Signature-Ed25519");
    if (!timestamp || !signature || !PUBLIC_KEY) return false;

    const body = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const msg = Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]);
    const sig = Buffer.from(signature, "hex");
    const pub = Buffer.from(PUBLIC_KEY, "hex");

    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

// Health
app.get("/", (_req, res) => res.status(200).send("Loot-Bot-HTTP OK"));

// Interactions Endpoint (mit Verify-Gate)
app.post("/interactions", async (req, res) => {
  if (!verifyDiscordRequest(req)) {
    return res.status(401).send("invalid request signature");
  }
  try {
    await routeInteraction(req, res);
  } catch (err) {
    console.error("Fehler bei routeInteraction:", err);
    return res.status(200).json({
      type: 4,
      data: { content: "❌ Da ging was schief." }
    });
  }
});

// --- Boot: Schema sicherstellen ----------------------------------------------
try {
  await ensureSchema();
  console.log("[DB] wins-Schema geprüft/aktualisiert.");
} catch (err) {
  console.error("[DB] ensureSchema() failed:", err);
}

app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
