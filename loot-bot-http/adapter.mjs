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

async function tryImport(relPath) {
  try {
    const url = toURL(relPath);
    return await import(url);
  } catch (e) {
    // nur "not found" stillschweigend tolerieren
    if (e?.code === "ERR_MODULE_NOT_FOUND") return null;
    throw e;
  }
}

async function requireMod(relPath) {
  const mod = await tryImport(relPath);
  if (!mod) {
    const err = new Error(`Module not found: ${relPath}`);
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return mod;
}

// robuste Handler-Wahl – akzeptiert benannte Exporte oder default-Objekt
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

// Discord response builder (string/obj -> Interaction Callback)
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

/* -------------------------------- context ------------------------------- */

function makeOptsAccessor(interaction) {
  // Discord schickt options in data.options (array, ggf. verschachtelt)
  const options = Array.isArray(interaction?.data?.options)
    ? interaction.data.options
    : [];

  function find(name) {
    if (!name) return null;
    const opt = options.find((o) => o?.name === name);
    return opt ?? null;
  }

  return {
    get(name) {
      return find(name)?.value ?? null;
    },
    getString(name) {
      const v = find(name)?.value;
      return typeof v === "string" ? v : v == null ? null : String(v);
    },
    getInteger(name) {
      const v = find(name)?.value;
      return Number.isInteger(v) ? v : v == null ? null : parseInt(v, 10) || null;
    },
    getNumber(name) {
      const v = find(name)?.value;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },
    getBoolean(name) {
      const v = find(name)?.value;
      return typeof v === "boolean" ? v : null;
    },
    getFocusedOptionValue() {
      const f = options.find((o) => o?.focused);
      return f?.value ?? null;
    },
  };
}

export function makeCtx(interaction, res) {
  const opts = makeOptsAccessor(interaction);

  return {
    interaction,
    res,
    opts, // <<<<< wichtig für /commands/vote.mjs

    // Slash-Command Antwort
    async reply(payload, opt) {
      const body = wrapMessage(payload, opt);
      return res.json(body);
    },

    // Autocomplete: Array<{name,value}>
    async respond(choices) {
      const safe = Array.isArray(choices) ? choices.slice(0, 25) : [];
      return res.json({ type: 8, data: { choices: safe } });
    },

    // optionaler FollowUp (wir antworten weiterhin mit type 4)
    async followUp(payload, opt) {
      const body = wrapMessage(payload, opt);
      return res.json(body);
    },

    // Kompatibles Helper-API für alte Aufrufe
    getFocusedOptionValue() {
      return opts.getFocusedOptionValue();
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
  // Command + fokussierte Option bestimmen
  const cmd = ctx.interaction?.data?.name;
  const focused =
    (ctx.interaction?.data?.options || []).find((o) => o?.focused)?.name ||
    null;

  // explizites Mapping, ohne andere Dateien zu ändern:
  if (cmd === "vote" && focused === "item") {
    // prefer vote-item.mjs
    const mod =
      (await tryImport("./interactions/autocomplete/vote-item.mjs")) ||
      (await requireMod("./interactions/autocomplete/vote.mjs")); // Fallback auf historischen Namen
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return await handler(ctx);
  }

  // nichts Bekanntes -> leere Liste
  return ctx.respond([]);
}

async function handleComponent(ctx) {
  // custom_id z.B. "vote:grund:<payload>"
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const base = cid.split(":")[0] || "component";

  // 1) spezifisches Modul versuchen
  let mod = await tryImport(`./interactions/components/${base}.mjs`);

  // 2) Fallback auf zentrales components/index.mjs, wenn vorhanden
  if (!mod) {
    mod = await tryImport("./interactions/components/index.mjs");
  }
  if (!mod) {
    throw new Error(
      `Component-Handler Modul nicht gefunden (versucht: interactions/components/${base}.mjs und components/index.mjs).`
    );
  }

  // mögliche Handler-Namen
  const candidates = [
    "handle",
    "run",
    "onSelect",
    "select",
    "handleSelect",
    "execute",
    "component", // falls index ein Objekt mit .component hat
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

  let mod = await tryImport(`./interactions/modals/${base}.mjs`);
  if (!mod) mod = await tryImport("./interactions/modals/index.mjs");
  if (!mod) {
    throw new Error(
      `Modal-Handler Modul nicht gefunden (versucht: interactions/modals/${base}.mjs und modals/index.mjs).`
    );
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

  // 1 = PING wird in server/index.mjs beantwortet
  if (t === 2) return await handleCommand(ctx);      // Slash-Command
  if (t === 4) return await handleAutocomplete(ctx); // Autocomplete
  if (t === 3) return await handleComponent(ctx);    // Message Component
  if (t === 5) return await handleModal(ctx);        // Modal Submit

  // Notfallantwort, verhindert Timeout
  return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
}
