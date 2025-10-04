// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';

// -------------------------------------------------------------
// Adapter robust laden (ESM/CJS, verschiedene Export-Namen)
// -------------------------------------------------------------
const pickFn = (obj, names) => names.map(n => obj?.[n]).find(v => typeof v === 'function');

async function loadAdapter() {
  const mod = await import('../adapter.mjs');          // ESM-Import
  const merged = { ...(mod.default || {}), ...mod };   // default + named zusammenführen

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
// Mit klaren Logs, falls die Verifikation fehlschlägt.
// -------------------------------------------------------------
function verifyDiscordRequest(publicKey) {
  const pk = Buffer.from(publicKey || '', 'hex');

  return (req, res, next) => {
    try {
      const signature = req.get('X-Signature-Ed25519');
      const timestamp = req.get('X-Signature-Timestamp');

      if (!publicKey) {
        console.error('[VERIFY] DISCORD_PUBLIC_KEY fehlt in ENV.');
        return res.status(401).send('missing public key');
      }
      if (!signature || !timestamp) {
        console.warn('[VERIFY] Missing signature/timestamp headers.');
        return res.status(401).send('missing signature');
      }

      // req.body ist Buffer dank express.raw
      const ok = nacl.sign.detached.verify(
        Buffer.from(timestamp + req.body),
        Buffer.from(signature, 'hex'),
        pk
      );

      if (!ok) {
        console.warn('[VERIFY] Bad signature (ed25519 verification failed).');
        return res.status(401).send('bad signature');
      }

      next();
    } catch (err) {
      console.error('[VERIFY] Error while verifying request:', err);
      return res.status(401).send('bad request');
    }
  };
}

const app = express();

// Healthcheck
app.get('/health', (_req, res) => res.status(200).send('OK'));

// -------------------------------------------------------------
// /interactions  (diese URL im Discord-Dev-Portal hinterlegen)
// -------------------------------------------------------------
app.post(
  '/interactions',
  // RAW-Body, sonst bricht die Signaturprüfung
  express.raw({ type: 'application/json' }),
  verifyDiscordRequest(process.env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    // PING -> PONG
    let msg;
    try {
      msg = JSON.parse(req.body.toString('utf8'));
    } catch {
      console.warn('[INT] invalid json body');
      return res.status(400).send('invalid json');
    }

    if (msg?.type === 1) {
      // Discord PING
      return res.status(200).json({ type: 1 });
    }

    // Deine vorhandene Logik per Adapter
    try {
      const { makeCtx, routeInteraction } = await loadAdapter();

      if (makeCtx && routeInteraction) {
        const ctx = makeCtx(msg, res);
        await routeInteraction(ctx); // sollte selbst antworten
      } else {
        // Fallback: nur ein Handler vorhanden
        const single = routeInteraction || makeCtx;
        if (single.length >= 2) {
          await single(msg, res);
        } else {
          await single(msg);
          if (!res.headersSent) {
            return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
          }
        }
      }
    } catch (e) {
      console.error('[INT] Route Interaction Error:', e);
      return res.json({
        type: 4,
        data: { content: '❌ Interner Fehler.', flags: 64 }
      });
    }
  }
);

// Hinweis: KEIN globales app.use(express.json()) *vor* der /interactions-Route!

// -------------------------------------------------------------
// Start (Railway setzt PORT; lokal Fallback 3000)
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
