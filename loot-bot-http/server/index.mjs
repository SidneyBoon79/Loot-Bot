// server/index.mjs
import express from "express";
import bodyParser from "body-parser";
import { makeCtx, reduceW, requireMod } from "../adapter.mjs";

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

// --- helper: wohin routen? ---
function resolveSpec(ctx) {
  const t = ctx.type;                 // Discord interaction type
  const d = ctx.data || {};

  // 2 = Application Command (Slash)
  if (t === 2 && d.name) {
    return `commands/${d.name}`;
  }

  // 3 = Message Component (Button/Select)  -> custom_id
  if (t === 3 && d.custom_id) {
    const id = String(d.custom_id).split(":")[0]; // vor ':' alles als key
    return `interactions/components/${id}`;
  }

  // 4 = Autocomplete  -> command name
  if (t === 4 && d.name) {
    return `interactions/autocomplete/${d.name}`;
  }

  // 5 = Modal Submit  -> custom_id
  if (t === 5 && d.custom_id) {
    const id = String(d.custom_id).split(":")[0];
    return `interactions/modals/${id}`;
  }

  return undefined;
}

// --- Route ---
app.post("/interactions", async (req, res) => {
  const ctx = makeCtx(req.body, res);

  // make sure reduceW hat alles was es braucht
  ctx.spec = resolveSpec(ctx);
  ctx.requireMod = (spec) => requireMod(spec);

  try {
    // single-dispatch über reduceW
    await reduceW(ctx, async (c) => {
      // Modul laden und ausführen (default oder named export)
      const mod = await c.requireMod(c.spec);
      const fn = (mod && (mod.default || mod)) || null;

      if (typeof fn !== "function") {
        throw new Error(`Handler fehlt oder ist keine Funktion für "${c.spec}"`);
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
