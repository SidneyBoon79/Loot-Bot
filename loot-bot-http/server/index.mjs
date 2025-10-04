// server/index.mjs
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import nacl from 'tweetnacl';

import { makeCtx, routeInteraction } from '../adapter.mjs';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
if (!PUBLIC_KEY) {
  console.error('[BOOT] DISCORD_PUBLIC_KEY fehlt.');
  process.exit(1);
}

const app = express();

// Den rohen Body puffern, damit die Signatur geprüft werden kann
app.use(
  bodyParser.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf; // Buffer merken
    },
  })
);

// --- Healthcheck
app.get('/health', (_req, res) => res.status(200).send('ok'));

// --- Signaturprüfung
function isValidRequest(req) {
  try {
    const sig = req.get('X-Signature-Ed25519');
    const ts = req.get('X-Signature-Timestamp');
    if (!sig || !ts || !req.rawBody) return false;

    const message = Buffer.concat([Buffer.from(ts), Buffer.from(req.rawBody)]);
    const ok = nacl.sign.detached.verify(
      new Uint8Array(message),
      Buffer.from(sig, 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex')
    );
    return ok;
  } catch (e) {
    console.error('[SIG] Verify error:', e);
    return false;
  }
}

// --- Discord Interactions
app.post('/interactions', async (req, res) => {
  // 1) Signatur prüfen
  if (!isValidRequest(req)) {
    return res.status(401).send('invalid request signature');
  }

  // 2) PING beantworten
  if (req.body?.type === 1) {
    return res.json({ type: 1 });
  }

  // 3) In deinen Bot-Router geben
  const ctx = makeCtx(req.body, res);
  try {
    await routeInteraction(ctx);
  } catch (e) {
    console.error('[INT] Route Interaction Error:', e);
    // Fehlermeldung ephemeral zurück
    return res.json({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: { content: '❌ Interner Fehler.', flags: 64 }, // 64 = ephemeral
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
