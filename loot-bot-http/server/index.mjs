// server/index.mjs
import express from "express";
import bodyParser from "body-parser";

// --- kleine Helper ----------------------------------------------------------
const toFileUrl = (rel) => new URL(rel, import.meta.url).href;

/**
 * Dynamischer Modul-Loader für den Adapter.
 * Erwartet kurze Specs wie "components/xyz", "modals/abc", "autocomplete/foo"
 * oder bereits relative Pfade. Liefert default/handle oder das Modul.
 */
async function requireMod(spec) {
  if (!spec || typeof spec !== "string") {
    throw new Error(`requireMod expected string, got ${typeof spec}`);
  }

  // Bereits relativer Pfad? -> übernehmen
  let rel = spec;
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    // Kurzschreibweise auflösen
    if (
      spec.startsWith("components/") ||
      spec.startsWith("modals/") ||
      spec.startsWith("autocomplete/")
    ) {
      rel = `../interactions/${spec}`;
    } else {
      // Fallback: alles unter /interactions
      rel = `../interactions/${spec}`;
    }
  }

  // .mjs anhängen falls nicht vorhanden
  if (!rel.endsWith(".mjs")) rel += ".mjs";

  const url = toFileUrl(rel);
  const mod = await import(url);
  return mod.default ?? mod.handle ?? mod;
}

/**
 * Erstellt den Context, den der Adapter erwartet.
 * Wichtig: `requireMod` wird hier bereitgestellt.
 */
function makeCtx(body, res) {
  return {
    body,
    res,
    requireMod,
    // kleine Helpers, falls der Adapter debuggt:
    json: (data) => res.json(data),
    send: (data) => res.send(data),
  };
}

// --- Express ---------------------------------------------------------------
const app = express();

// Discord/Interactions schicken raw JSON
app.use(bodyParser.json({ type: "*/*" }));

// Health
app.get("/", (_req, res) => res.status(200).send("OK"));

// --------------------------------------------------------------------------
// Adapter laden (NICHT anfassen – wir passen uns nur an)
import * as Adapter from "../adapter.mjs";

// Kleiner Logger
const log = (...a) => console.log("[INT]", ...a);

// Haupt-Route: Discord Interactions
app.post("/interactions", async (req, res) => {
  const ctx = makeCtx(req.body, res);

  try {
    // Wir nehmen den vom Adapter exportierten Handler.
    // In deinem Setup ist das "reduceW".
    const handler =
      Adapter.reduceW ??
      Adapter.routeInteraction ??
      Adapter.handle ??
      Adapter.default;

    if (typeof handler !== "function") {
      throw new Error(
        "adapter.mjs exportiert keine passende Funktion. Erwartet z.B. reduceW/routeInteraction/handle/default."
      );
    }

    // Direkt mit ctx aufrufen – dein reduceW nutzt ctx.requireMod.
    await handler(ctx);
  } catch (e) {
    console.error("[INT] Route Interaction Error:", e);
    // Discord-Fehlerantwort (ephemeral)
    return res.json({
      type: 4,
      data: { content: "❌ Interner Fehler.", flags: 64 },
    });
  }
});

// Railway/Render/… geben den Port per ENV vor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Loot-Bot-HTTP läuft auf Port ${PORT}`);
});
