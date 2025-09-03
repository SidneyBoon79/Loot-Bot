// server/index.mjs
// Discord Interaction Endpoint (Express) mit Signature-Verify + PING-Handshake

import express from "express";
import { routeInteraction } from "./interactionRouter.mjs";
import nacl from "tweetnacl";

// ---- Helpers: Discord Signature Verify ----
function verifySignature(publicKey, signature, timestamp, bodyRaw) {
  try {
    const sig = Buffer.from(signature, "hex");
    const ts = Buffer.from(timestamp, "utf8");
    const msg = Buffer.concat([ts, bodyRaw]);
    const key = Buffer.from(publicKey, "hex");
    return nacl.sign.detached.verify(msg, sig, key);
  } catch {
    return false;
  }
}

const app = express();

// Wir brauchen den *rohen* Body für die Signaturprüfung.
// Kein bodyParser.json() hier, sondern raw:
app.use(
  "/interactions",
  express.raw({ type: "*/*" }) // roher Buffer in req.body
);

// POST /interactions – Discord schickt hier alles hin
app.post("/interactions", async (req, res) => {
  const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
  if (!PUBLIC_KEY) {
    return res.status(500).send("Missing DISCORD_PUBLIC_KEY");
  }

  // 1) Signatur prüfen
  const sig = req.header("X-Signature-Ed25519");
  const ts  = req.header("X-Signature-Timestamp");
  const bodyRaw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");

  if (!sig || !ts || !verifySignature(PUBLIC_KEY, sig, ts, bodyRaw)) {
    return res.status(401).send("Bad signature");
  }

  // 2) JSON parsen (erst NACH der Signaturprüfung!)
  let interaction;
  try {
    interaction = JSON.parse(bodyRaw.toString("utf8"));
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }

  // 3) PING-Handshake (type 1)
  if (interaction?.type === 1) {
    return res.json({ type: 1 }); // PONG
  }

  // 4) Context bauen (wie zuvor) – aber jetzt aus dem schon geparsten Body
  const ctx = makeCtx(interaction, res);

  try {
    await routeInteraction(ctx);
  } catch (err) {
    console.error("[server] fatal:", err);
    if (!res.headersSent) res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});

// ------------------------------------------------------
// Context-Builder
// ------------------------------------------------------
function makeCtx(interaction, res) {
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
      if (interaction.type === 4) {
        return res.json({ type: 8, data: { choices } });
      }
    },
    reply: (data, opts = {}) => {
      const payload = {
        type: 4,
        data: {
          ...data,
          flags: opts.ephemeral ? 64 : 0
        }
      };
      return res.json(payload);
    },
    update: (data) => {
      return res.json({ type: 7, data });
    },
    followUp: (msg, opts = {}) => {
      const payload = {
        type: 4,
        data: {
          content: msg,
          flags: opts.ephemeral ? 64 : 0
        }
      };
      return res.json(payload);
    },
    showModal: (modal) => {
      return res.json({ type: 9, data: modal });
    }
  };
}
