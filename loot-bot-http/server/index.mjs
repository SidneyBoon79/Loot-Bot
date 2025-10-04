// server/index.mjs

import express from "express";
import bodyParser from "body-parser";

// Adapter robust importieren (funktioniert mit named ODER default exports)
import * as AD from "../adapter.mjs";
const makeCtx =
  AD.makeCtx || AD.default?.makeCtx ||
  ((body, res) => ({ ...body, res })); // ultra-fallback

const reduceW =
  AD.reduceW || AD.default?.reduceW ||
  (async (ctx, fn) => fn(ctx)); // no-op fallback

const _requireMod =
  AD.requireMod || AD.default?.requireMod ||
  (async (spec) => {
    // Dynamischer Import relativ zu diesem File
    const url = new URL(`../${spec}.mjs`, import.meta.url);
    return await import(url.href);
  });

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

// ---- interaction -> Modulpfad ermitteln ----
function resolveSpec(ctx) {
  const t = ctx.type;
  const d = ctx.data || {};

  // 2 = Slash Command
  if (t === 2 && d.name) return `commands/${d.name}`;

  // 3 = Komponenten (Buttons/Selects) -> custom_id
  if (t === 3 && d.custom_id) {
    const id = String(d.custom_id).split(":")[0];
    return `interactions/components/${id}`;
  }

  // 4 = Autocomplete -> command name
  if (t === 4 && d.name) return `interactions/autocomplete/${d.name}`;

  // 5 = Modal Submit -> custom_id
  if (t === 5 && d.custom_id) {
    const id = String(d.custom_id).split(":")[0];
    return `interactions/modals/${id}`;
  }

  return undefined;
}

// ---- Route ----
app.post("/interactions", async (req, res) => {
  const ctx = makeCtx(req.body, res);
  ctx.spec = resolveSpec(ctx);
  ctx.requireMod = (spec) => _requireMod(spec);

  try {
    await reduceW(ctx, async (c) => {
      if (!c.spec) {
        throw new Error("Keine spec ermittelbar (unknown interaction).");
      }
      const mod = await c.requireMod(c.spec);
      const fn = (mod && (mod.default || mod)) || null;
      if (typeof fn !== "function") {
        throw new Error(`Handler fehlt/ist keine Funktion für "${c.spec}"`);
      }
      return fn(c);
    });
  } catch (e) {
    console.error("[INT] Route Interaction Error:", e);
    return res.json({
      type: 4,
      data: { content: "❌ Interner Fehler.", flags: 64 },
    });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
