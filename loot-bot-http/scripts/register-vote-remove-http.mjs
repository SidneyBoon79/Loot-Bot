// scripts/register-vote-remove-http.mjs — Dependency-free Discord REST
// Liest data/commands/vote-remove.json und registriert NUR diesen Command.

import fs from "fs";
import path from "path";

const TOKEN     = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.APPLICATION_ID;
const GUILD_ID  = process.env.GUILD_ID || ""; // leer => global

if (!TOKEN || !CLIENT_ID) {
  console.error("Bitte BOT_TOKEN/DISCORD_TOKEN und CLIENT_ID/APPLICATION_ID setzen.");
  process.exit(1);
}

// ⚠️ Korrigierter Pfad: Datei liegt unter /app/data/commands/...
const defPath = path.resolve(process.cwd(), "data/commands/vote-remove.json");

if (!fs.existsSync(defPath)) {
  console.error(`vote-remove.json nicht gefunden: ${defPath}`);
  process.exit(1);
}
const bodyDef = JSON.parse(fs.readFileSync(defPath, "utf8"));

const API = "https://discord.com/api/v10";
const headers = {
  "Authorization": `Bot ${TOKEN}`,
  "Content-Type": "application/json",
};

async function fetchJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status} ${res.statusText}\n${JSON.stringify(json)}`);
  }
  return json;
}

async function runGuild() {
  const base = `${API}/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`;
  const list = await fetchJson("GET", base);
  const found = list.find(c => c.name === "vote-remove");
  if (found) {
    await fetchJson("PATCH", `${base}/${found.id}`, bodyDef);
    console.log(`✅ /vote-remove (Guild ${GUILD_ID}) aktualisiert (Command-ID: ${found.id}).`);
  } else {
    const created = await fetchJson("POST", base, bodyDef);
    console.log(`✅ /vote-remove (Guild ${GUILD_ID}) erstellt (Command-ID: ${created.id}).`);
  }
}

async function runGlobal() {
  const base = `${API}/applications/${CLIENT_ID}/commands`;
  const list = await fetchJson("GET", base);
  const found = list.find(c => c.name === "vote-remove");
  if (found) {
    await fetchJson("PATCH", `${API}/applications/${CLIENT_ID}/commands/${found.id}`, bodyDef);
    console.log(`✅ /vote-remove (GLOBAL) aktualisiert (Command-ID: ${found.id}).`);
  } else {
    const created = await fetchJson("POST", base, bodyDef);
    console.log(`✅ /vote-remove (GLOBAL) erstellt (Command-ID: ${created.id}).`);
  }
}

try {
  if (GUILD_ID) await runGuild(); else await runGlobal();
  console.log("✨ Fertig.");
} catch (err) {
  console.error("❌ Fehler bei der Registrierung:\n", err.message || err);
  process.exit(1);
}
