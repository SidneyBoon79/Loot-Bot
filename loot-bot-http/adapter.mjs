// adapter.mjs – resilient router for commands, autocomplete & components
// Exports: makeCtx, routeInteraction
// Keine Änderungen an anderen Dateien notwendig.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/* -------------------------------- helpers ------------------------------- */

const ROOT = process.cwd();

function toURL(p) {
  return pathToFileURL(path.resolve(ROOT, p)).href;
}

async function requireMod(relPath) {
  const url = toURL(relPath);
  return await import(url);
}

// robust handler picker – akzeptiert benannte Exporte oder default-Objekt
function pickHandler(mod, name) {
  let h = (name && mod?.[name]) || mod?.default;

  // default kann ein Objekt sein -> benannte Funktion daraus wählen
  if (typeof h === "object" && h && name && typeof h[name] === "function") {
    h = h[name];
  }

  // Fallback: Es gibt genau eine Funktion im Modul? Dann nimm die.
  if (typeof h !== "function") {
    const fns = Object.values(mod || {}).filter((v) => typeof v === "function");
    if (fns.length === 1) h = fns[0];
  }

  return h;
}

// Discord response builder
function wrapMessage(payload, opts = {}) {
  // string -> { type: 4, data:{ content }}
  if (typeof payload === "string") {
    const data = { content: payload };
    if (opts.ephemeral) data.flags = 64;
    return { type: 4, data };
  }

  // { content, components, embeds, ephemeral }
  if (payload && typeof payload === "object" && !("type" in payload)) {
    const { ephemeral, ...rest } = payload;
    const data = { ...rest };
    if (ephemeral) data.flags = 64;
    return { type: 4, data };
  }

  // schon fertig strukturiert
  return payload;
}

/* -------------------------- option helpers (ctx.opts) ------------------- */

function makeOpts(interaction) {
  const options = Array.isArray(interaction?.data?.options)
    ? interaction.data.options
    : [];

  const find = (name) => options.find((o) => o?.name === name) || null;

  return {
    get(name) {
      return find(name)?.value ?? null;
    },
    getString(name) {
      const v = find(name)?.value;
      return v == null ? null : String(v);
    },
    getNumber(name) {
      const v = find(name)?.value;
      return typeof v === "number" ? v : v == null ? null : Number(v);
    },
    getBoolean(name) {
      const v = find(name)?.value;
      return typeof v === "boolean" ? v : null;
    },
    raw: options,
  };
}

/* -------------------------------- context ------------------------------- */

export function makeCtx(interaction, res) {
  return {
    interaction,
    res,

    // Slash-Command Antwort
    async reply(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },

    // für Autocomplete: Array<{name,value}>
    async respond(choices) {
      const safe = Array.isArray(choices) ? choices.slice(0, 25) : [];
      return res.json({ type: 8, data: { choices: safe } });
    },

    // optionales FollowUp (nicht zwingend gebraucht)
    async followUp(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },

    // Hilfen
    getFocusedOptionValue() {
      const opts = interaction?.data?.options || [];
      const focused = Array.isArray(opts) ? opts.find((o) => o?.focused) : null;
      return focused?.value ?? null;
    },

    // <<< WICHTIG: damit /vote wieder funktioniert >>>
    opts: makeOpts(interaction),
  };
}

/* ------------------------------- routing -------------------------------- */

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
  // Wir bestimmen Handler per Command + fokussiertem Option-Name.
  const cmd = ctx.interaction?.data?.name;
  const focusedOpt =
    (ctx.interaction?.data?.options || []).find((o) => o?.focused)?.name ||
    null;

  // /vote item -> ./interactions/autocomplete/vote-item.mjs :: handleVoteItemAutocomplete
  if (cmd === "vote" && focusedOpt === "item") {
    const mod = await requireMod("./interactions/autocomplete/vote-item.mjs");
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return await handler(ctx);
  }

  // Fallback: Nichts zu tun
  return ctx.respond([]);
}

async function loadComponentModule(base) {
  // 1) Versuche ./interactions/components/<base>.mjs
  try {
    return await requireMod(`./interactions/components/${base}.mjs`);
  } catch (e) {
    if (String(e?.code) !== "ERR_MODULE_NOT_FOUND") throw e;
  }
  // 2) Fallback: ./interactions/components/index.mjs
  return await requireMod(`./interactions/components/index.mjs`);
}

async function handleComponent(ctx) {
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "component";

  const mod = await loadComponentModule(base);

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

  let mod;
  try {
    mod = await requireMod(`./interactions/modals/${base}.mjs`);
  } catch (e) {
    if (String(e?.code) !== "ERR_MODULE_NOT_FOUND") throw e;
    mod = await requireMod(`./interactions/modals/index.mjs`);
  }

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
  const t = ctx.interaction?.type;

  if (t === 2) return await handleCommand(ctx);      // Slash-Command
  if (t === 4) return await handleAutocomplete(ctx); // Autocomplete
  if (t === 3) return await handleComponent(ctx);    // Components
  if (t === 5) return await handleModal(ctx);        // Modals

  return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
}
