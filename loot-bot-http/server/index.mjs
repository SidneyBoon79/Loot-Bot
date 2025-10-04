// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';

// ---------- kleine Utilitys ----------
const pickFn = (obj, names) =>
  names.map(n => (typeof obj?.[n] === 'function' ? { name: n, fn: obj[n] } : null))
       .find(Boolean);

const findAnyCtxFactory = (mod) => {
  // erst bekannte Namen
  const known = pickFn(mod, ['makeCtx','createCtx','buildCtx','ctx']);
  if (known) return known;
  // ansonsten: irgendeine Function mit "ctx" im Namen
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function' && /ctx/i.test(k)) return { name: k, fn: v };
  }
  // auch im default-Objekt suchen
  if (mod.default && typeof mod.default === 'object') {
    for (const [k, v] of Object.entries(mod.default)) {
      if (typeof v === 'function' && /ctx/i.test(k)) return { name: k, fn: v };
    }
  }
  return null;
};

// ---------- Adapter robust laden ----------
async function loadAdapter() {
  const mod = await import('../adapter.mjs');
  const merged = { ...(mod.default || {}), ...mod };

  // 2-stufig: Ctx + Router
  const ctxFn = pickFn(merged, ['makeCtx','createCtx','buildCtx','ctx']) || findAnyCtxFactory(merged);
  const routerFn =
    pickFn(merged, [
      'routeInteraction','handleInteraction','handle','route',
      'dispatchInteraction','onInteraction','processInteraction'
    ]);

  // 1-stufig (ein Handler)
  const singleFn =
    routerFn ||
    pickFn(merged, ['interaction','interactions','main','run','process','execute','default']) ||
    Object.entries(merged)
      .filter(([,v]) => typeof v === 'function')
      .map(([k,v]) => ({ name: k, fn: v }))[0] || null;

  if (!ctxFn && !singleFn) {
    throw new Error('adapter.mjs exportiert keine passende Funktion (Ctx/Router/Single-Handler fehlt).');
  }
  return { ctxFn, routerFn, singleFn, merged };
}

// ---------- Discord Signature Verify (RAW-Body) ----------
function verifyDiscordRequest(publicKey) {
  const pk = Buffer.from(publicKey || '', 'hex');
  return (req, res, next) => {
    try {
      const signature = req.get('X-Signature-Ed25519');
      const timestamp = req.get('X-Signature-Timestamp');
      if (!publicKey) return res.status(401).send('missing public key');
      if (!signature || !timestamp) return res.status(401).send('missing signature');

      const ok = nacl.sign.detached.verify(
        Buffer.from(timestamp + req.body),
        Buffer.from(signature, 'hex'),
        pk
      );
      if (!ok) return res.status(401).send('bad signature');
      next();
    } catch (e) {
      console.error('[VERIFY] error:', e);
      return res.status(401).send('bad request');
    }
  };
}

const app = express();
app.get('/health', (_req, res) => res.status(200).send('OK'));

// ---------- Minimal-ctx, falls Adapter keine Ctx-Factory exportiert ----------
function buildShimCtx(msg, res) {
  return {
    msg,
    res,
    // häufig genutzt: dynamische Modul-Lader
    async requireMod(relPath) {
      // erlaubt sowohl "commands/vote.mjs" als auch "./commands/vote.mjs"
      const path = relPath.startsWith('.') ? relPath : `../${relPath}`;
      const mod = await import(path);
      return mod.default ?? mod;
    },
    log: (...a) => console.log('[CTX]', ...a),
    now: () => new Date(),
    // einfache Antwort-Helpers (falls Adapter sie nutzt)
    respond(data) {
      if (!res.headersSent) res.json({ type: 4, data });
    },
    ack() {
      if (!res.headersSent) res.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    },
  };
}

// ---------- /interactions ----------
app.post(
  '/interactions',
  express.raw({ type: 'application/json' }),
  verifyDiscordRequest(process.env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    let msg;
    try { msg = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).send('invalid json'); }

    if (msg?.type === 1) return res.status(200).json({ type: 1 }); // PING->PONG

    try {
      const { ctxFn, routerFn, singleFn, merged } = await loadAdapter();

      if (ctxFn && routerFn) {
        console.log(`[INT] Using adapter ctx="${ctxFn.name}" + router="${routerFn.name}"`);
        const ctx = ctxFn.fn(msg, res);
        await routerFn.fn(ctx);
        if (!res.headersSent) return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
        return;
      }

      // Single-Handler Pfad
      console.log(`[INT] Using adapter single handler="${singleFn.name}" (len=${singleFn.fn.length})`);
      try {
        // Versuch A: (msg, res)
        if (singleFn.fn.length >= 2) {
          await singleFn.fn(msg, res);
        } else if (singleFn.fn.length === 1) {
          // Versuch B: (msg)
          await singleFn.fn(msg);
        } else {
          // Versuch C: ({ msg, res })
          await singleFn.fn({ msg, res });
        }
      } catch (e) {
        // fallback: Handler erwartet vermutlich einen ctx → echte/ersatzweise Ctx bauen
        console.warn('[INT] single handler direct call failed, retry with ctx.', String(e?.message || e));
        const factory = ctxFn || findAnyCtxFactory(merged);
        const ctx = factory ? factory.fn(msg, res) : buildShimCtx(msg, res);
        await singleFn.fn(ctx);
      }

      if (!res.headersSent) {
        return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
      }
    } catch (e) {
      console.error('[INT] Route Interaction Error:', e);
      return res.json({ type: 4, data: { content: '❌ Interner Fehler.', flags: 64 } });
    }
  }
);

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`));
