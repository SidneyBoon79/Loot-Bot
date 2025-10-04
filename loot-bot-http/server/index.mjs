// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';

// ---------- Helper: pick first function by name ----------
const pickFn = (obj, names) =>
  names.map(n => (typeof obj?.[n] === 'function' ? { name: n, fn: obj[n] } : null))
       .find(Boolean);

// ---------- Load adapter robustly (ESM/CJS, named/default, any names) ----------
async function loadAdapter() {
  const mod = await import('../adapter.mjs');          // ESM import
  const merged = { ...(mod.default || {}), ...mod };   // merge default + named

  // 2-stufige Variante (Kontext + Router)
  const ctxFn =
    pickFn(merged, ['makeCtx','createCtx','buildCtx','ctx']);

  const routerFn =
    pickFn(merged, [
      'routeInteraction','handleInteraction','handle','route',
      'dispatchInteraction','onInteraction','processInteraction'
    ]);

  // 1-stufige Variante (ein einziger Handler)
  const singleFn =
    routerFn ||
    pickFn(merged, [
      'interaction','interactions','main','run','process','execute','default'
    ]) ||
    // als allerletztes: irgendeine Funktion am Modul nehmen
    Object.entries(merged)
      .filter(([,v]) => typeof v === 'function')
      .map(([k,v]) => ({ name: k, fn: v }))[0] || null;

  if (!ctxFn && !singleFn) {
    throw new Error(
      'adapter.mjs exportiert keine passende Funktion. Erwartet z. B. makeCtx/routeInteraction oder handle/route.'
    );
  }

  return { ctxFn, routerFn, singleFn };
}

// ---------- Discord signature verification (ed25519, raw body) ----------
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

// Health
app.get('/health', (_req, res) => res.status(200).send('OK'));

// ---------- Interactions (diese URL im Dev-Portal hinterlegt) ----------
app.post(
  '/interactions',
  express.raw({ type: 'application/json' }),                 // RAW body!
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
    if (msg?.type === 1) return res.status(200).json({ type: 1 });

    try {
      const { ctxFn, routerFn, singleFn } = await loadAdapter();

      if (ctxFn && routerFn) {
        console.log(`[INT] Using adapter ctx="${ctxFn.name}" + router="${routerFn.name}"`);
        const ctx = ctxFn.fn(msg, res);
        await routerFn.fn(ctx);                // Router antwortet selbst
        if (!res.headersSent) {
          return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
        }
        return;
      }

      // Single-handler Pfad
      console.log(`[INT] Using adapter single handler="${singleFn.name}" (len=${singleFn.fn.length})`);
      // Versuche sinnvolle Signaturen
      if (singleFn.fn.length >= 2) {
        await singleFn.fn(msg, res);           // (msg, res)
      } else if (singleFn.fn.length === 1) {
        await singleFn.fn(msg);                // (msg)
      } else {
        await singleFn.fn({ msg, res });       // (ctxObj)
      }

      if (!res.headersSent) {
        return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
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

// Achtung: KEIN globales app.use(express.json()) vor /interactions!

// ---------- Start (Railway nutzt PORT; lokal Fallback 3000) ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
