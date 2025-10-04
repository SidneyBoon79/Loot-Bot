// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';
// robust: funktioniert mit named-Exports ODER default-Export-Objekt
import * as Adapter from '../adapter.mjs';

// ---- Adapter-Funktionen robust ermitteln ----
const makeCtx =
  Adapter.makeCtx || (Adapter.default && Adapter.default.makeCtx);
const routeInteraction =
  Adapter.routeInteraction ||
  (Adapter.default && Adapter.default.routeInteraction);

if (typeof makeCtx !== 'function' || typeof routeInteraction !== 'function') {
  // Harte, klare Fehlermeldung, falls adapter.mjs wirklich andere Namen nutzt
  throw new Error(
    'adapter.mjs muss makeCtx und routeInteraction exportieren (named oder als default-Objekt).'
  );
}

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
      // unverändert deine Logik: makeCtx -> routeInteraction
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
