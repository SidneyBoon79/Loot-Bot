// adapter.mjs – Router + kompatibles ctx-API (inkl. opts.getString)
// Keine Änderungen an anderen Dateien nötig.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/* ---------- helpers ---------- */

const ROOT = process.cwd();
const toURL = (p) => pathToFileURL(path.resolve(ROOT, p)).href;
const requireMod = async (rel) => import(toURL(rel));

function pickHandler(mod, name) {
  let h = (name && mod?.[name]) || mod?.default;
  if (typeof h === "object" && h && name && typeof h[name] === "function") h = h[name];
  if (typeof h !== "function") {
    const fns = Object.values(mod || {}).filter((v) => typeof v === "function");
    if (fns.length === 1) h = fns[0];
  }
  return h;
}

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

/* ---------- options parser (macht ctx.opts.* kompatibel) ---------- */

function flattenOptions(options) {
  const map = new Map();
  const walk = (arr) => {
    for (const o of arr || []) {
      // Wenn Subcommand/-Group, descend
      if ((o?.type === 1 || o?.type === 2) && Array.isArray(o.options)) {
        walk(o.options);
      } else if (o?.name) {
        map.set(o.name, o);
      }
    }
  };
  walk(Array.isArray(options) ? options : []);
  return map;
}

function makeOptsAccessor(interaction) {
  const map = flattenOptions(interaction?.data?.options || []);
  const coerce = (name) => map.get(name)?.value;

  return {
    getString: (name) => {
      const v = coerce(name);
      return typeof v === "string" ? v : null;
    },
    getInteger: (name) => {
      const v = coerce(name);
      return Number.isInteger(v) ? v : (typeof v === "number" ? Math.trunc(v) : null);
    },
    getNumber: (name) => {
      const v = coerce(name);
      return typeof v === "number" ? v : null;
    },
    getBoolean: (name) => {
      const v = coerce(name);
      return typeof v === "boolean" ? v : null;
    },
  };
}

/* ---------- context ---------- */

export function makeCtx(interaction, res) {
  return {
    interaction,
    res,
    opts: makeOptsAccessor(interaction),

    async reply(payload, opts) {
      return res.json(wrapMessage(payload, opts));
    },
    async respond(choices) {
      const safe = Array.isArray(choices) ? choices.slice(0, 25) : [];
      return res.json({ type: 8, data: { choices: safe } });
    },
    async followUp(payload, opts) {
      return res.json(wrapMessage(payload, opts));
    },
    getFocusedOptionValue() {
      const opts = interaction?.data?.options || [];
      const focused = Array.isArray(opts) ? opts.find((o) => o?.focused) : null;
      return focused?.value ?? null;
    },
  };
}

/* ---------- routing ---------- */

async function handleCommand(ctx) {
  const name = ctx.interaction?.data?.name;
  if (!name) throw new Error("command name missing");
  const mod = await requireMod(`./commands/${name}.mjs`);
  const run = pickHandler(mod, "run");
  if (typeof run !== "function") throw new Error(`command '${name}': run() not found`);
  return run(ctx);
}

async function handleAutocomplete(ctx) {
  const cmd = ctx.interaction?.data?.name;
  const focusedOpt =
    (ctx.interaction?.data?.options || []).find((o) => o?.focused)?.name || null;

  if (cmd === "vote" && focusedOpt === "item") {
    const mod = await requireMod("./interactions/autocomplete/vote-item.mjs");
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") throw new Error("Autocomplete-Handler nicht gefunden.");
    return handler(ctx);
  }

  return ctx.respond([]);
}

async function loadComponentModule(base) {
  try {
    return await requireMod(`./interactions/components/${base}.mjs`);
  } catch (e) {
    if (String(e?.code) !== "ERR_MODULE_NOT_FOUND") throw e;
  }
  return await requireMod(`./interactions/components/index.mjs`);
}

async function handleComponent(ctx) {
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "component";
  const mod = await loadComponentModule(base);

  const candidates = ["handle", "run", "onSelect", "select", "handleSelect", "execute"];
  let handler = null;
  for (const n of candidates) {
    handler = pickHandler(mod, n);
    if (typeof handler === "function") break;
  }
  if (typeof handler !== "function") {
    throw new Error(`Component-Handler nicht gefunden (${base}).`);
  }
  ctx.customIdParts = cid.split(":");
  return handler(ctx);
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
  return handler(ctx);
}

export async function routeInteraction(ctx) {
  const t = ctx.interaction?.type;
  if (t === 2) return handleCommand(ctx);     // Slash Command
  if (t === 4) return handleAutocomplete(ctx); // Autocomplete
  if (t === 3) return handleComponent(ctx);    // Components
  if (t === 5) return handleModal(ctx);        // Modal Submit
  return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
}
