// adapter.mjs – resilient router for commands, autocomplete & components
// Exports: makeCtx, routeInteraction

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

  // Fallback: genau eine Funktion im Modul? Dann nimm die.
  if (typeof h !== "function") {
    const fns = Object.values(mod || {}).filter((v) => typeof v === "function");
    if (fns.length === 1) h = fns[0];
  }

  return h;
}

// Discord response builder
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

  return payload; // schon fertig strukturiert
}

/* -------------------------------- context ------------------------------- */

function buildOpts(interaction) {
  const list = Array.isArray(interaction?.data?.options)
    ? interaction.data.options
    : [];

  const map = new Map(list.map((o) => [o?.name, o?.value]));

  return {
    getString(name) {
      const v = map.get(name);
      return v == null ? null : String(v);
    },
    getInteger(name) {
      const v = map.get(name);
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    },
    getNumber(name) {
      const v = map.get(name);
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },
    getBoolean(name) {
      const v = map.get(name);
      if (v == null) return null;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true";
      return Boolean(v);
    },
  };
}

export function makeCtx(interaction, res) {
  return {
    interaction,
    res,
    opts: buildOpts(interaction),

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

    // optionales FollowUp (wir beantworten hier direkt; kein Webhook nötig)
    async followUp(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },

    // Focused value (falls gebraucht)
    getFocusedOptionValue() {
      const opts = interaction?.data?.options || [];
      const focused = Array.isArray(opts) ? opts.find((o) => o?.focused) : null;
      return focused?.value ?? null;
    },
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
  const cmd = ctx.interaction?.data?.name;
  const focusedOpt =
    (ctx.interaction?.data?.options || []).find((o) => o?.focused)?.name || null;

  // Mapping (ohne andere Dateien anzufassen)
  if (cmd === "vote" && focusedOpt === "item") {
    const mod = await requireMod("./interactions/autocomplete/vote-item.mjs");
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return await handler(ctx);
  }

  return ctx.respond([]); // Fallback
}

async function handleComponent(ctx) {
  // custom_id wie "vote:grund:..."
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "component";
  const mod = await requireMod(`./interactions/components/${base}.mjs`);

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
  return await handler(ctx);
}

async function handleModal(ctx) {
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "modal";
  const mod = await requireMod(`./interactions/modals/${base}.mjs`);

  const candidates = ["handle", "run", "submit", "onSubmit", "execute"];
  let handler = null;
  for (const n of candidates) {
    handler = pickHandler(mod, n);
    if (typeof handler === "function") break;
  }
  if (typeof handler !== "function") {
    throw new Error(`Modal-Handler nicht gefunden (${base})..`);
  }

  ctx.customIdParts = cid.split(":");
  return await handler(ctx);
}

export async function routeInteraction(ctx) {
  const t = ctx.interaction?.type;

  if (t === 2) return await handleCommand(ctx);      // Slash-Command
  if (t === 4) return await handleAutocomplete(ctx); // Autocomplete
  if (t === 3) return await handleComponent(ctx);    // Component
  if (t === 5) return await handleModal(ctx);        // Modal

  return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
}
