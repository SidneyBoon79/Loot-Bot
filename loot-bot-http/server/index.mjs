// server/index.mjs
import express from 'express';
import nacl from 'tweetnacl';

const pickFn = (obj, names) =>
  names.map(n => (typeof obj?.[n] === 'function' ? { name: n, fn: obj[n] } : null))
       .find(Boolean);

const findAnyCtxFactory = (mod) => {
  const known = pickFn(mod, ['makeCtx','createCtx','buildCtx','ctx']);
  if (known) return known;
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function' && /ctx/i.test(k)) return { name: k, fn: v };
  }
  if (mod.default && typeof mod.default === 'object') {
    for (const [k, v] of Object.entries(mod.default)) {
      if (typeof v === 'function' && /ctx/i.test(k)) return { name: k, fn: v };
    }
  }
  return null;
};

async function loadAdapter() {
  const mod = await import('../adapter.mjs');
  const merged = { ...(mod.default || {}), ...mod };

  const ctxFn = pickFn(merged, ['makeCtx','createCtx','buildCtx','ctx']) || findAnyCtxFactory(merged);
  const routerFn =
    pickFn(merged, [
      'routeInteraction','handleInteraction','handle','route',
      'dispatchInteraction','onInteraction','processInteraction'
    ]);

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

function verifyDiscordRequest(publicKey) {
  const pk = Buffer.from(publicKey || '', 'hex');
  return (req, res, next) => {
    try {
      const sig = req.get('X-Signature-Ed25519');
      const ts  = req.get('X-Signature-Timestamp');
      if (!publicKey) return res.status(401).send('missing public key');
      if (!sig || !ts) return res.status(401).send('missing signature');

      const ok = nacl.sign.detached.verify(
        Buffer.from(ts + req.body),
        Buffer.from(sig, 'hex'),
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

// -------- robuster Shim-Ctx (inkl. safem requireMod) --------
function buildShimCtx(msg, res) {
  return {
    msg,
    res,
    async requireMod(relPath) {
      // Defensive: Input check + Logging
      if (!relPath || typeof relPath !== 'string') {
        const t = typeof relPath;
        console.error(`[CTX] requireMod(): invalid spec (${t}) ->`, relPath);
        throw new Error(`requireMod expected string, got ${t}`);
      }

      // Absolute URLs/Node-Builtins einfach durchlassen
      if (/^(https?:|node:)/i.test(relPath)) {
        const m = await import(relPath);
        return m.default ?? m;
      }

      // „../…“, „./…“ oder Package/Projektpfad robust auflösen
      let spec = relPath;
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        // Projekt-relative Shortcuts als "../<path>" interpretieren
        spec = `../${spec}`;
      }

      // URL relativ zu dieser Datei bilden
      const trySpecs = [];
      const base = new URL(import.meta.url);

      const pushSpec = (s) => trySpecs.push(new URL(s, base).href);
      pushSpec(spec);
      if (!/\.(mjs|js)$/i.test(spec)) {
        pushSpec(spec + '.mjs');
        pushSpec(spec + '.js');
      }

      for (const href of trySpecs) {
        try {
          const m = await import(href);
          console.log('[CTX] requireMod OK ->', href);
          return m.default ?? m;
        } catch (e) {
          // still trying next variant
        }
      }

      console.error('[CTX] requireMod FAILED for', relPath, 'tried:', trySpecs);
      throw new Error(`Module not found: ${relPath}`);
    },
    log: (...a) => console.log('[CTX]', ...a),
    now: () => new Date(),
    respond(data) {
      if (!res.headersSent) res.json({ type: 4, data });
    },
    ack() {
      if (!res.headersSent) res.json({ type: 5 });
    },
  };
}

app.post(
  '/interactions',
  express.raw({ type: 'application/json' }),
  verifyDiscordRequest(process.env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    let msg;
    try { msg = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).send('invalid json'); }

    if (msg?.type === 1) return res.status(200).json({ type: 1 });

    try {
      const { ctxFn, routerFn, singleFn, merged } = await loadAdapter();

      if (ctxFn && routerFn) {
        console.log(`[INT] Using adapter ctx="${ctxFn.name}" + router="${routerFn.name}"`);
        const ctx = ctxFn.fn(msg, res);
        await routerFn.fn(ctx);
        if (!res.headersSent) return res.json({ type: 4, data: { content: '✅ OK', flags: 64 } });
        return;
      }

      console.log(`[INT] Using adapter single handler="${singleFn.name}" (len=${singleFn.fn.length})`);
      try {
        if (singleFn.fn.length >= 2)      await singleFn.fn(msg, res);
        else if (singleFn.fn.length === 1) await singleFn.fn(msg);
        else                                await singleFn.fn({ msg, res });
      } catch (e) {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`));
