// adapter.mjs – resilient router für Commands, Autocomplete & Components
// Exports: makeCtx, routeInteraction
// Keine Änderungen an anderen Dateien notwendig.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/* ------------------------------ helpers -------------------------------- */

const ROOT = process.cwd();

function toURL(p) {
  return pathToFileURL(path.resolve(ROOT, p)).href;
}

async function requireMod(relPath) {
  const url = toURL(relPath);
  return await import(url);
}

// Handler-Finder: akzeptiert benannte Exporte ODER default (auch Objekt)
function pickHandler(mod, name) {
  let h = (name && mod?.[name]) || mod?.default;

  // default kann ein Objekt sein -> benannte Funktion daraus wählen
  if (typeof h === "object" && h && name && typeof h[name] === "function") {
    h = h[name];
  }

  // Fallback: gibt es GENAU eine Funktion im Modul? -> nimm die
  if (typeof h !== "function") {
    const fns = Object.values(mod || {}).filter((v) => typeof v === "function");
    if (fns.length === 1) h = fns[0];
  }

  return h;
}

// Discord-Response normalisieren
function wrapMessage(payload, opts = {}) {
  if (typeof payload === "string") {
    const data = { content: payload };
    if (opts.ephemeral) data.flags = 64;
    return { type: 4, data };
  }
  if (payload && typeof payload === "object" && !("type" in payload)) {
    const { ephemeral, ...rest } = payload;
    const data = { ...rest };
    if (ephemeral) data.flags = 64;
    return { type: 4, data };
  }
  return payload;
}

/* -------------------------------- ctx ---------------------------------- */

export function makeCtx(interaction, res) {
  return {
    interaction,
    res,

    // Slash-Command Antwort
    async reply(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },

    // Autocomplete-Choices
    async respond(choices) {
      const safe = Array.isArray(choices) ? choices.slice(0, 25) : [];
      return res.json({ type: 8, data: { choices: safe } });
    },

    // optionales FollowUp (wir nutzen hier ebenfalls Callback 4)
    async followUp(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },

    // kleine Hilfe
    getFocusedOptionValue() {
      const opts = interaction?.data?.options || [];
      const focused = Array.isArray(opts) ? opts.find((o) => o?.focused) : null;
      return focused?.value ?? null;
    },
  };
}

/* ------------------------------- routing ------------------------------- */

async function handleCommand(ctx) {
  const name = ctx.interaction?.data?.name;
  if (!name) throw new Error("command name missing");

  const mod = await requireMod(`./commands/${name}.mjs`);
  const run = pickHandler(mod, "run");
  if (typeof run !== "function") {
    throw new Error(`command '${name}': run() not found`);
  }
  return await run(ctx);
}

async function handleAutocomplete(ctx) {
  const cmd = ctx.interaction?.data?.name;
  const focused =
    (ctx.interaction?.data?.options || []).find((o) => o?.focused)?.name ||
    null;

  // explizites Mapping ohne andere Dateien zu ändern
  if (cmd === "vote" && focused === "item") {
    const mod = await requireMod("./interactions/autocomplete/vote-item.mjs");
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return await handler(ctx);
  }

  // Fallback: leer
  return ctx.respond([]);
}

async function handleComponent(ctx) {
  // custom_id z.B. "vote:grund:...."
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "component";

  // 1) ZUERST zentralen Dispatcher probieren: interactions/components/index.mjs
  try {
    const central = await requireMod("./interactions/components/index.mjs");
    const centralHandler =
      pickHandler(central, "route") ||
      pickHandler(central, "handle") ||
      pickHandler(central, "run") ||
      pickHandler(central, "onComponent");

    if (typeof centralHandler === "function") {
      ctx.customIdParts = cid.split(":");
      return await centralHandler(ctx);
    }
  } catch {
    // kein zentrales index.mjs vorhanden -> weiter zum Fallback
  }

  // 2) Fallback: spezifisches Modul anhand des ersten Segments
  const mod = await requireMod(`./interactions/components/${base}.mjs`);
  const candidates = [
    "handle",
    "run",
    "onSelect",
    "select",
    "handleSelect",
    "execute",
  ];
  let handler = null;
  for (const n of candidates) {
    handler = pickHandler(mod, n);
    if (typeof handler === "function") break;
  }
  if (typeof handler !== "function") {
    throw new Error(`Component-Handler nicht gefunden (${base}).`);
  }

  ctx.customIdParts = cid.split(":");
  return await handler(ctx);
}

async function handleModal(ctx) {
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "modal";

  // analog zu Components
  try {
    const central = await requireMod("./interactions/modals/index.mjs");
    const centralHandler =
      pickHandler(central, "route") ||
      pickHandler(central, "handle") ||
      pickHandler(central, "run") ||
      pickHandler(central, "onSubmit") ||
      pickHandler(central, "submit");

    if (typeof centralHandler === "function") {
      ctx.customIdParts = cid.split(":");
      return await centralHandler(ctx);
    }
  } catch {}

  const mod = await requireMod(`./interactions/modals/${base}.mjs`);
  const candidates = ["handle", "run", "submit", "onSubmit", "execute"];
  let handler = null;
  for (const n of candidates) {
    handler = pickHandler(mod, n);
    if (typeof handler === "function") break;
  }
  if (typeof handler !== "function") {
    throw new Error(`Modal-Handler nicht gefunden (${base}).`);
  }
  ctx.customIdParts = cid.split(":");
  return await handler(ctx);
}

export async function routeInteraction(ctx) {
  try {
    const t = ctx.interaction?.type;

    // 1 = PING wird in server/index.mjs schon behandelt
    if (t === 2) return await handleCommand(ctx);      // Slash-Command
    if (t === 4) return await handleAutocomplete(ctx); // Autocomplete
    if (t === 3) return await handleComponent(ctx);    // Component
    if (t === 5) return await handleModal(ctx);        // Modal

    return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
  } catch (e) {
    console.error("[INT] Route Interaction Error:", e);
    // sichere Fehlermeldung an den User
    return ctx.reply("❌ Interner Fehler.", { ephemeral: true });
  }
}
