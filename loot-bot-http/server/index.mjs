// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';

// -------------------------------------------------------------
// Hilfsfunktion: Adapter robust laden (ESM / CJS, verschiedene Namen)
// -------------------------------------------------------------
const pickFn = (obj, names) => names.map(n => obj?.[n]).find(v => typeof v === 'function');

async function loadAdapter() {
  // ESM-Import
  const mod = await import('../adapter.mjs');

  // CJS-Default (Node setzt bei CJS den Export unter "default")
  const merged = { ...(mod.default || {}), ...mod };

  // Mögliche Namen im Adapter abklappern
  const makeCtx = pickFn(merged, ['makeCtx', 'createCtx', 'buildCtx', 'ctx']);
  const routeInteraction = pickFn(
    merged,
    ['routeInteraction', 'handleInteraction', 'handle', 'route', 'dispatchInteraction']
  );

  if (!makeCtx && !routeInteraction) {
    throw new Error(
      'adapter.mjs exportiert keine passende Funktion. Erwartet z.B. makeCtx/routeInteraction oder handle/route.'
    );
  }
  return { makeCtx, routeInteraction };
}

// -------------------------------------------------------------
// Discord-Request-Verifier (ed25519). Erwartet RAW-Body (Buffer).
// -------------------------------------------------------------
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

// kleiner Healthcheck
app.get('/health', (_req, res) => res.status(200).send('OK'));

// -------------------------------------------------------------
// Interactions-Route  (diesen Pfad im Dev-Portal eintragen!)
// https://<deine-domain>.up.railway.app/interactions
// -------------------------------------------------------------
app.post(
  '/interactions',
  // RAW-Body, damit die Signaturprüfung funktioniert
  express.raw({ type: 'application/json' }),
  verifyDiscordRequest(process.env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    // PING -> PONG (type 1)
    let msg;
    try {
      msg = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).send('invalid json');
    }
    if (msg?.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    // Adapter laden und aufrufen – robust für verschiedene Exporte
    try {
      const { makeCtx, routeInteraction } = await loadAdapter();

      if (makeCtx && routeInteraction) {
        // Klassischer Weg: Kontext bauen, dann routen
        const ctx = makeCtx(msg, res);
        await routeInteraction(ctx);
        return; // routeInteraction soll selbst antworten
      }

      // Fallback: nur eine Handler-Funktion vorhanden (z.B. "handle" oder "route")
      const singleHandler = routeInteraction || makeCtx;
      // Versuche unterschiedliche Signaturen: (msg, res) oder (ctx) oder (msg)
      const maybeCtx = { msg, res };
      if (singleHandler.length >= 2) {
        await singleHandler(msg, res);
      } else if (singleHandler.length === 1) {
        await singleHandler(msg);
      } else {
        await singleHandler(maybeCtx);
      }
      // Falls der Handler nicht geantwortet hat:
      if (!res.headersSent) {
        return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
      }
    } catch (e) {
      console.error('Route Interaction Error:', e);
      return res.json({
        type: 4,
        data: { content: '❌ Interner Fehler.', flags: 64 }
      });
    }
  }
);

// Hinweis: KEIN globales app.use(express.json()) VOR der /interactions-Route!

// Start (Railway setzt PORT, bei dir in den Logs 8080)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
