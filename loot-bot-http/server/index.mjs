// server/index.mjs
// Sicherer Discord-HTTP Entry mit Ed25519 Verify (tweetnacl).
// ESM: "type": "module"

import express from "express";
import nacl from "tweetnacl";

import { ensureSchema } from "../services/wins.mjs";
import { routeInteraction } from "./interactionRouter.mjs";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

const app = express();
app.disable("x-powered-by");

// Roh-Body für Signature Verify
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));

function verifyDiscordRequest(req) {
  try {
    const ts = req.header("X-Signature-Timestamp");
    const sigHex = req.header("X-Signature-Ed25519");
    if (!ts || !sigHex || !PUBLIC_KEY) {
      console.error("[verify] missing header/public key", { ts: !!ts, sig: !!sigHex, hasPk: !!PUBLIC_KEY });
      return false;
    }
    const body = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const msg = Buffer.concat([Buffer.from(ts), body]);
    const sig = Buffer.from(sigHex, "hex");
    const pub = Buffer.from(PUBLIC_KEY, "hex");
    const ok = nacl.sign.detached.verify(msg, sig, pub);
    if (!ok) console.error("[verify] signature invalid");
    return ok;
  } catch (e) {
    console.error("[verify] exception:", e);
    return false;
  }
}

app.get("/", (_req, res) => res.status(200).send("Loot-Bot-HTTP OK"));

app.post("/interactions", async (req, res) => {
  if (!verifyDiscordRequest(req)) return res.status(401).send("invalid request signature");
  try {
    await routeInteraction(req, res);
  } catch (err) {
    console.error("routeInteraction error:", err);
    return res.status(200).json({ type: 4, data: { content: "❌ Da ging was schief." } });
  }
});

try {
  await ensureSchema();
  console.log("[DB] wins-Schema geprüft/aktualisiert.");
} catch (err) {
  console.error("[DB] ensureSchema() failed:", err);
}

app.listen(PORT, () => console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`));
