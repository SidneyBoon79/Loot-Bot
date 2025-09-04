// scripts/register-vote-remove-http.mjs — Force-Replace (DELETE+POST)

import fs from "fs";
import path from "path";

const TOKEN     = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.APPLICATION_ID;
const GUILD_ID  = process.env.GUILD_ID || "";

if (!TOKEN || !CLIENT_ID) { console.error("BOT_TOKEN/DISCORD_TOKEN und CLIENT_ID/APPLICATION_ID setzen."); process.exit(1); }

const defPath = path.resolve(process.cwd(), "data/commands/vote-remove.json");
if (!fs.existsSync(defPath)) { console.error(`vote-remove.json nicht gefunden: ${defPath}`); process.exit(1); }
const bodyDef = JSON.parse(fs.readFileSync(defPath, "utf8"));

const API = "https://discord.com/api/v10";
const headers = { "Authorization": `Bot ${TOKEN}`, "Content-Type": "application/json" };

async function req(method, url, body){
  const r = await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined});
  const txt = await r.text(); let j; try{ j = txt?JSON.parse(txt):{} } catch { j = { raw: txt } }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${r.statusText}\n${JSON.stringify(j)}`);
  return j;
}

async function replaceGuild() {
  const base = `${API}/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`;
  const list = await req("GET", base);
  const found = list.find(c => c.name === "vote-remove");
  if (found) {
    await req("DELETE", `${base}/${found.id}`);
    console.log(`🗑️  /vote-remove (Guild ${GUILD_ID}) gelöscht (${found.id}).`);
  }
  const created = await req("POST", base, bodyDef);
  console.log(`✅ /vote-remove (Guild ${GUILD_ID}) neu erstellt (${created.id}).`);
}

async function replaceGlobal() {
  const base = `${API}/applications/${CLIENT_ID}/commands`;
  const list = await req("GET", base);
  const found = list.find(c => c.name === "vote-remove");
  if (found) {
    await req("DELETE", `${base}/${found.id}`);
    console.log(`🗑️  /vote-remove (GLOBAL) gelöscht (${found.id}).`);
  }
  const created = await req("POST", base, bodyDef);
  console.log(`✅ /vote-remove (GLOBAL) neu erstellt (${created.id}).`);
}

(async () => {
  try {
    if (GUILD_ID) await replaceGuild(); else await replaceGlobal();
    console.log("✨ Fertig.");
  } catch (e) {
    console.error("❌ Fehler bei der Registrierung:\n", e.message || e);
    process.exit(1);
  }
})();
