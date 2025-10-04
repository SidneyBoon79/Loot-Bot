// server/index.mjs
import 'dotenv/config';
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

// Kleiner Healthcheck (optional)
app.get('/health', (_req, res) => res.status(200).send('OK'));

// ------------------------------------------------------------------
// Interactions-Route (GENAU dieser Pfad gehört ins Dev-Portal)
// -> https://<deine-domain>.up.railway.app/interactions
// ------------------------------------------------------------------
app.post(
  '/interactions',
  // WICHTIG: raw Body, damit die Signaturprüfung funktioniert
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
      // PING
      return res.status(200).json({ type: 1 });
    }

    // Deine bestehende Logik (unverändert)
    try {
      // makeCtx hat bisher den JSON-Body bekommen -> wir geben 'msg'
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
// (Falls du es brauchst, hänge es NACH der obigen Route an.)

// ------------------------------------------------------------------
// Start
// Railway setzt PORT (z.B. 8080). Lokal greift Fallback 3000.
// In Railway "Public Networking" bitte denselben Port eintragen,
// den die App hier ausgibt (laut Logs bei dir 8080).
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
