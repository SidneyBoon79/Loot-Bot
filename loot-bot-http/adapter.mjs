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

/* --------------------------- options helper (NEU) ----------------------- */

function buildOptsHelper(interaction) {
  const options = Array.isArray(interaction?.data?.options)
    ? interaction.data.options
    : [];

  // Option-Werte in Map für schnellen Zugriff
  const map = new Map();
  for (const o of options) {
    if (o && typeof o.name === "string") {
      // bei Subcommands liegen die echten Optionen in o.options
      if (o.type === 1 && Array.isArray(o.options)) {
        for (const so of o.options) {
          if (so?.name) map.set(so.name, so.value);
        }
      } else {
        map.set(o.name, o.value);
      }
    }
  }

  return {
    getString(name) {
      const v = map.get(name);
      return typeof v === "string" ? v : undefined;
    },
    getInteger(name) {
      const v = map.get(name);
      return Number.isInteger(v) ? v : undefined;
    },
    getNumber(name) {
      const v = map.get(name);
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
    getBoolean(name) {
      const v = map.get(name);
      return typeof v === "boolean" ? v : undefined;
    },
    // Minimal helpers – erweitern falls ihr weitere Typen nutzt
  };
}

/* -------------------------------- context ------------------------------- */

export function makeCtx(interaction, res) {
  return {
    interaction,
    res,

    // Slash-Command Optionen im Discord.js-Stil
    opts: buildOptsHelper(interaction),

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

    // optionales FollowUp (nutzt denselben Callback 4)
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

  // Mapping ohne andere Dateien anzufassen:
  // /vote item -> ./interactions/autocomplete/vote-item.mjs :: handleVoteItemAutocomplete
  if (cmd === "vote" && focusedOpt === "item") {
    const mod = await requireMod("./interactions/autocomplete/vote-item.mjs");
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return await handler(ctx);
  }

  // Fallback
  return ctx.respond([]);
}

async function handleComponent(ctx) {
  // custom_id z.B. "vote:grund:<…>" -> Modul ./interactions/components/vote.mjs
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
    throw new Error(`Modal-Handler nicht gefunden (${base}).`);
  }
  ctx.customIdParts = cid.split(":");
  return await handler(ctx);
}

export async function routeInteraction(ctx) {
  const t = ctx.interaction?.type;

  // 1 = PING wird in server/index.mjs bereits beantwortet.
  if (t === 2) {
    // Slash-Command
    return await handleCommand(ctx);
  }
  if (t === 4) {
    // Autocomplete
    return await handleAutocomplete(ctx);
  }
  if (t === 3) {
    // Message Component (Buttons / String Select)
    return await handleComponent(ctx);
  }
  if (t === 5) {
    // Modal Submit
    return await handleModal(ctx);
  }

  // Unbekannt -> Notfallantwort, verhindert Discord-Timeout
  return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
}
