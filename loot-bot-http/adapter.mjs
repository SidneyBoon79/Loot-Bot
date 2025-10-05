// adapter.mjs – resilient router for commands, autocomplete & components
// Exports: makeCtx, routeInteraction
// Keine Änderungen an anderen Dateien notwendig.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/* -------------------------------- helpers ------------------------------- */

const ROOT = process.cwd();
const toURL = (p) => pathToFileURL(path.resolve(ROOT, p)).href;
const requireMod = async (rel) => import(toURL(rel));

const cap = (s = "") => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

function pickHandler(mod, name) {
  // bevorzugt benannten Export
  let h = (name && mod?.[name]) || mod?.default;

  // default kann ein Objekt mit Funktionen sein
  if (typeof h === "object" && h && name && typeof h[name] === "function") {
    h = h[name];
  }

  // Fallback: wenn exakt 1 Funktion exportiert wird, nimm sie
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
  return payload;
}

/* -------------------------------- context ------------------------------- */

export function makeCtx(interaction, res) {
  return {
    interaction,
    res,
    async reply(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },
    async respond(choices) {
      const safe = Array.isArray(choices) ? choices.slice(0, 25) : [];
      return res.json({ type: 8, data: { choices: safe } });
    },
    async followUp(payload, opts) {
      const body = wrapMessage(payload, opts);
      return res.json(body);
    },
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
    (ctx.interaction?.data?.options || []).find((o) => o?.focused)?.name ||
    null;

  // /vote item -> ./interactions/autocomplete/vote-item.mjs
  if (cmd === "vote" && focusedOpt === "item") {
    const mod = await requireMod("./interactions/autocomplete/vote-item.mjs");
    const handler = pickHandler(mod, "handleVoteItemAutocomplete");
    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return await handler(ctx);
  }

  return ctx.respond([]);
}

async function handleComponent(ctx) {
  // custom_id Beispiel: "vote:grund:<b64>"
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const [baseRaw, actionRaw] = cid.split(":");
  const base = (baseRaw || "component").trim();
  const action = (actionRaw || "select").trim();

  // Kandidaten-Dateien in dieser Reihenfolge probieren
  const modulePaths = [
    `./interactions/components/${base}.mjs`,
    `./interactions/components/${base}-select.mjs`,
    `./interactions/components/${base}-component.mjs`,
    `./interactions/components/index.mjs`, // als letzter Versuch
  ];

  // Kandidaten-Funktionsnamen, abgeleitet aus base & action
  const fnCandidates = [
    `handle${cap(base)}${cap(action)}`, // z.B. handleVoteGrund
    `on${cap(base)}${cap(action)}`,
    `handle${cap(action)}`, // z.B. handleGrund
    "handle",
    "run",
    "onSelect",
    "select",
    "execute",
  ];

  let lastError = null;

  for (const rel of modulePaths) {
    try {
      const mod = await requireMod(rel);

      // probiere die Kandidatennamen der Reihe nach
      for (const fnName of fnCandidates) {
        const fn = pickHandler(mod, fnName);
        if (typeof fn === "function") {
          ctx.customIdParts = cid.split(":");
          return await fn(ctx);
        }
      }
    } catch (e) {
      // nur merken, weiterprobieren
      lastError = e;
    }
  }

  // nichts gefunden -> aussagekräftiger Fehler
  throw new Error(
    `Component-Handler nicht gefunden (cid="${cid}", versucht: ${modulePaths.join(
      ", "
    )}; functions: ${fnCandidates.join(", ")})${lastError ? " – last error: " + lastError : ""
    }`
  );
}

async function handleModal(ctx) {
  const cid = String(ctx.interaction?.data?.custom_id || "");
  const [baseRaw, actionRaw] = cid.split(":");
  const base = (baseRaw || "modal").trim();
  const action = (actionRaw || "submit").trim();

  const modulePaths = [
    `./interactions/modals/${base}.mjs`,
    `./interactions/modals/${base}-modal.mjs`,
    `./interactions/modals/index.mjs`,
  ];

  const fnCandidates = [
    `handle${cap(base)}${cap(action)}`,
    `on${cap(base)}${cap(action)}`,
    `handle${cap(action)}`,
    "handle",
    "run",
    "submit",
    "onSubmit",
    "execute",
  ];

  for (const rel of modulePaths) {
    try {
      const mod = await requireMod(rel);
      for (const fnName of fnCandidates) {
        const fn = pickHandler(mod, fnName);
        if (typeof fn === "function") {
          ctx.customIdParts = cid.split(":");
          return await fn(ctx);
        }
      }
    } catch {
      /* try next */
    }
  }

  throw new Error(`Modal-Handler nicht gefunden (${cid}).`);
}

export async function routeInteraction(ctx) {
  const t = ctx.interaction?.type;

  if (t === 2) return handleCommand(ctx);     // Slash-Command
  if (t === 4) return handleAutocomplete(ctx); // Autocomplete
  if (t === 3) return handleComponent(ctx);    // Components (Select/Button)
  if (t === 5) return handleModal(ctx);        // Modal Submit

  return ctx.reply("❔ Nicht unterstützte Interaktion.", { ephemeral: true });
}
