// register-commands.mjs
// Registriert globale Slash-Commands via Discord REST (ohne discord.js)

import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const BOT_TOKEN  = process.env.BOT_TOKEN  || process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID  = process.env.CLIENT_ID  || process.env.DISCORD_CLIENT_ID;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error("[REG] BOT_TOKEN und CLIENT_ID (oder DISCORD_*) müssen gesetzt sein.");
  process.exit(1);
}

const ROOT = process.cwd();
const API = "https://discord.com/api/v10";
const URL_COMMANDS = `${API}/applications/${CLIENT_ID}/commands`;

// ---------- helpers ----------
function toURL(rel) {
  return pathToFileURL(path.resolve(ROOT, rel)).href;
}

async function tryImport(relPath) {
  try {
    const full = path.resolve(ROOT, relPath);
    if (!fs.existsSync(full)) return null;
    return await import(toURL(relPath));
  } catch {
    return null;
  }
}

function pickDefinition(mod, fallback) {
  if (!mod) return fallback;
  const def =
    mod.data ||
    mod.command ||
    (mod.default && (mod.default.data || mod.default.command));
  return def ?? fallback;
}

// ---------- fallbacks (nur wenn Modul nichts exportiert) ----------
const FALLBACKS = {
  vote: {
    name: "vote",
    description: "Run vote",
    type: 1,
    options: [
      { name: "item", description: "Welches Item?", type: 3, required: true, autocomplete: true },
      { name: "reason", description: "Grund der Stimme", type: 3, required: false,
        choices: [{ name: "Gear", value: "Gear" }, { name: "Trait", value: "Trait" }, { name: "Litho", value: "Litho" }] }
    ]
  },
  "vote-show":   { name: "vote-show",   description: "Aktuelle Votes anzeigen", type: 1 },
  "vote-remove": { name: "vote-remove", description: "Eigenen Vote löschen",    type: 1 },
  roll:          { name: "roll",        description: "Roll durch Mods für ein Item", type: 1 },
  "roll-all":    { name: "roll-all",    description: "Rollt alle nicht-gerollten Items", type: 1 },
  reroll:        { name: "reroll",      description: "Erneuter Roll für bereits gerollte Items", type: 1 },
  winner:        { name: "winner",      description: "Listet Gewinner kompakt", type: 1 },
  "vote-clear":  { name: "vote-clear",  description: "Reset (Votes, Items, Wins)", type: 1 },
  changew:       { name: "changew",     description: "Wins reduzieren/erhöhen", type: 1 },
  "vote-info":   { name: "vote-info",   description: "Kurz-Tutorial anzeigen (ephemeral)", type: 1 },
};

// ---------- Dateien, die registriert werden (ohne reducew.mjs) ----------
const FILES = [
  "./commands/vote.mjs",
  "./commands/vote-show.mjs",
  "./commands/vote-remove.mjs",
  "./commands/roll.mjs",
  "./commands/roll-all.mjs",
  "./commands/reroll.mjs",
  "./commands/winner.mjs",
  "./commands/vote-clear.mjs",
  "./commands/changew.mjs",
  "./commands/vote-info.mjs",   // <- jetzt dabei
];

async function buildCommands() {
  const out = [];
  for (const rel of FILES) {
    const base = path.basename(rel, ".mjs");
    const mod = await tryImport(rel);
    const def = pickDefinition(mod, FALLBACKS[base]);

    if (!def) {
      console.warn(`[REG] ⚠ Keine Definition für ${base}. Übersprungen.`);
      continue;
    }
    if (!def.name) def.name = base;
    if (!def.description) def.description = base;
    out.push(def);
  }
  return out;
}

async function registerGlobal(cmds) {
  const res = await fetch(URL_COMMANDS, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[REG] HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}

(async () => {
  try {
    console.log("[REG] Sammle Commands …");
    const commands = await buildCommands();
    console.log(`[REG] Registriere ${commands.length} Commands: ${commands.map(c => c.name).join(", ")}`);
    const result = await registerGlobal(commands);
    console.log("[REG] ✅ Fertig. Anzahl:", Array.isArray(result) ? result.length : result);
  } catch (e) {
    console.error("[REG] ❌ Fehler:", e?.message || e);
    process.exit(1);
  }
})();
