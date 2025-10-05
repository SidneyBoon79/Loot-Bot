// adapter.mjs
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- Utility / Context -----------------
function getOptions(body) {
  const opts = body?.data?.options;
  return Array.isArray(opts) ? opts : [];
}

function findOptionValue(body, name) {
  const opts = getOptions(body);
  const opt = opts.find((o) => o?.name === name);
  return opt?.value ?? null;
}

function getFocusedOptionValue(body) {
  try {
    const opts = getOptions(body);
    const f = Array.isArray(opts) ? opts.find((o) => o?.focused) : null;
    return f?.value ?? null;
  } catch {
    return null;
  }
}

export function makeCtx(body, res) {
  const ctx = {
    body,
    res,
    now: Date.now(),
    // IDs & Meta
    guildId: body?.guild_id ?? null,
    userId: body?.member?.user?.id || body?.user?.id || null,
    // option helpers (compat for commands like vote.mjs)
    option: (name) => findOptionValue(body, name),
    getOption: (name) => findOptionValue(body, name),
    getString: (name) => {
      const v = findOptionValue(body, name);
      return typeof v === 'string' ? v : v == null ? null : String(v);
    },
    getFocusedOptionValue: () => getFocusedOptionValue(body),
    // einfache Antwort (optional ephemeral)
    reply: (content, { ephemeral = false } = {}) =>
      res.status(200).json({ type: 4, data: { content, flags: ephemeral ? 64 : 0 } }),
    // volle JSON-Antwort
    respond: (payload) => res.status(200).json(payload),
    // dynamisches Laden (siehe unten)
    requireMod: (spec) => requireMod(spec),
  };
  return ctx;
}

// ----------------- Routing -----------------
export async function routeInteraction(ctx) {
  const t = ctx.body?.type;

  // PING
  if (t === 1) return ctx.respond({ type: 1 });

  // SLASH COMMAND
  if (t === 2) {
    const name = ctx.body?.data?.name;
    if (!name) throw new Error("Slash command name missing.");
    const mod = await loadCommand(name);
    const fn = mod?.run ?? mod?.default;
    if (typeof fn !== "function") throw new Error(`commands/${name}.mjs exportiert keine run()-Funktion.`);
    return fn(ctx);
  }

  // AUTOCOMPLETE
  if (t === 4) {
    const name = ctx.body?.data?.name;
    if (!name) throw new Error("Autocomplete command name missing.");
    const mod = await loadAutocomplete(name);
    const fn = mod?.run ?? mod?.default ?? mod?.autocomplete;
    if (typeof fn !== "function") throw new Error(`interactions/autocomplete/${name}.mjs exportiert keine Funktion.`);
    return fn(ctx);
  }

  // MESSAGE COMPONENT (Buttons / Selects)
  if (t === 3) {
    const cid = ctx.body?.data?.custom_id;
    if (!cid) throw new Error("Component custom_id missing.");
    const [compName] = String(cid).split(":"); // Präfix vor ':' als Modulname
    const mod = await loadComponent(compName);
    const fn = mod?.run ?? mod?.default ?? mod?.handle;
    if (typeof fn !== "function") throw new Error(`interactions/components/${compName}.mjs exportiert keine Funktion.`);
    return fn(ctx);
  }

  // MODAL SUBMIT
  if (t === 5) {
    const cid = ctx.body?.data?.custom_id;
    if (!cid) throw new Error("Modal custom_id missing.");
    const [modalName] = String(cid).split(":");
    const mod = await loadModal(modalName);
    const fn = mod?.run ?? mod?.default ?? mod?.handle;
    if (typeof fn !== "function") throw new Error(`interactions/modals/${modalName}.mjs exportiert keine Funktion.`);
    return fn(ctx);
  }

  console.warn("[INT] Unbekannter Interaction-Typ:", t);
  return ctx.reply("❌ Nicht unterstützte Interaktion.", { ephemeral: true });
}

// ----------------- Loader-Helfer -----------------
function fileUrl(rel) {
  const abs = path.join(__dirname, rel); // relativ zu adapter.mjs auflösen
  return pathToFileURL(abs).href;
}

async function requireMod(rel) {
  if (typeof rel !== "string" || !rel.trim()) throw new Error(`requireMod expected string, got ${typeof rel}`);
  const href = fileUrl(rel);
  return import(href);
}

function loadCommand(name) {
  return requireMod(`./commands/${name}.mjs`);
}

function loadAutocomplete(name) {
  // Mappe Slash-Name → Dateiname (Fix: vote → vote-item)
  const file = name === "vote" ? "vote-item" : name;
  return requireMod(`./interactions/autocomplete/${file}.mjs`);
}

function loadComponent(name) {
  return requireMod(`./interactions/components/${name}.mjs`);
}

function loadModal(name) {
  return requireMod(`./interactions/modals/${name}.mjs`);
}

// ----------------- Middleware-Combinator -----------------
export function reduceW(...handlers) {
  return async function composed(ctx) {
    let i = -1;
    async function run(idx) {
      if (idx <= i) throw new Error("reduceW: next() mehrfach aufgerufen.");
      i = idx;
      const h = handlers[idx];
      if (!h) return;
      return h(ctx, () => run(idx + 1));
    }
    return run(0);
  };
}
