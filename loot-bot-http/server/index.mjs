// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';
import { makeCtx, routeInteraction } from '../adapter.mjs';

// ------------------------------------------------------------------
// Discord-Request-Verifier (ed25519). Erwartet raw-Body (Buffer).
// ------------------------------------------------------------------
function verifyDiscordRequest(publicKey) {
  const pk = Buffer.from(publicKey, 'hex');
  return (req, res, next) => {
    try {
      const signature = req.get('X-Signature-Ed25519');
      const timestamp = req.get('X-Signature-Timestamp');
      if (!signature || !timestamp) {
        return res.status(401).send('missing signature');
      }
      const ok = nacl.sign.detached.verify(
        Buffer.from(timestamp + req.body),
        Buffer.from(signature, 'hex'),
        pk
      );
      if (!ok) return res.status(401).send('bad signature');
      next();
    } catch {
      return res.status(401).send('bad request');
    }
  };
}

const app = express();

// Optionaler Healthcheck
app.get('/health', (_req, res) => res.status(200).send('OK'));

// ------------------------------------------------------------------
// Interactions-Route (diese URL ins Dev-Portal eintragen):
// https://<deine-domain>.up.railway.app/interactions
// ------------------------------------------------------------------
app.post(
  '/interactions',
  // RAW-Body, damit die Signaturprüfung funktioniert
  express.raw({ type: 'application/json' }),
  verifyDiscordRequest(process.env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    // PING -> PONG
    let msg;
    try {
      msg = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).send('invalid json');
    }

    if (msg?.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    try {
      // Deine bestehende Logik unverändert
      const ctx = makeCtx(msg, res);
      await routeInteraction(ctx);
    } catch (e) {
      console.error('Route Interaction Error:', e);
      return res.json({
        type: 4,
        data: { content: '❌ Interner Fehler.', flags: 64 }
      });
    }
  }
);

// Hinweis: KEIN globales app.use(express.json()) vor der /interactions-Route!

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
