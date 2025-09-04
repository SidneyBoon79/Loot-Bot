// scripts/list-commands-http.mjs — zeigt Global & Guild Commands inkl. Optionen
const TOKEN     = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.APPLICATION_ID;
const GUILD_ID  = process.env.GUILD_ID || "";

if (!TOKEN || !CLIENT_ID) { console.error("BOT_TOKEN/DISCORD_TOKEN und CLIENT_ID/APPLICATION_ID setzen."); process.exit(1); }

const API = "https://discord.com/api/v10";
const headers = { "Authorization": `Bot ${TOKEN}` };

async function get(url){ const r=await fetch(url,{headers}); const t=await r.text(); try{return JSON.parse(t);}catch{return t;} }

(async () => {
  console.log("=== GLOBAL COMMANDS ===");
  const global = await get(`${API}/applications/${CLIENT_ID}/commands`);
  (global||[]).forEach(c => console.log(`• ${c.name}  options=${(c.options||[]).length}`));

  if (GUILD_ID) {
    console.log(`\n=== GUILD COMMANDS (${GUILD_ID}) ===`);
    const guild = await get(`${API}/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`);
    (guild||[]).forEach(c => console.log(`• ${c.name}  options=${(c.options||[]).length}`));
  }
})();
