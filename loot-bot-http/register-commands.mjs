// register-commands.mjs
// Löscht alte Commands und registriert neue nur für die GUILD.
// Nutzt Railway ENV: BOT_TOKEN, CLIENT_ID, GUILD_ID

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing ENV: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const API = "https://discord.com/api/v10";

async function call(path, method = "GET", body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Deine Commands (GUILD) ----
const commands = [
  {
    name: "vote",
    description: "Vote abgeben: Item (Autocomplete) oder Modal → Grund wählen",
    options: [
      {
        type: 3, // STRING
        name: "item",
        description: "Item-Name (Autocomplete). Leer lassen für Modal.",
        required: false,
        autocomplete: true
      }
    ]
  },
  { name: "vote-info",   description: "Zeigt das Kurz-Tutorial (ephemer)." },
  { name: "vote-show",   description: "Aktuelle Votes der letzten 48h anzeigen." },
  {
    name: "vote-remove",
    description: "Entfernt deine Stimme zu einem Item.",
    options: [{ type: 3, name: "item", description: "Name des Items", required: true }]
  },
  { name: "vote-clear",  description: "Reset: löscht Votes/Items/Wins (Mods)." },
  {
    name: "reducew",
    description: "Wins eines Users reduzieren (Dropdown + Modal).",
    options: [
      { type: 6, name: "user", description: "User", required: true },
      { type: 4, name: "anzahl", description: "Anzahl", required: true, min_value: 1 }
    ]
  },
  { name: "winner",   description: "Gewinner der letzten 48h (User — Item)." },
  { name: "roll",     description: "Roll für nicht gerolltes Item (Mods)." },
  { name: "roll-all", description: "Rollt alle offenen Items (Mods)." },
  { name: "reroll",   description: "Re-Roll für bereits gerolltes Item (Mods)." }
];

async function wipeGlobal() {
  const existing = await call(`/applications/${CLIENT_ID}/commands`, "GET");
  if (Array.isArray(existing) && existing.length) {
    console.log(`🧹 Deleting ${existing.length} GLOBAL commands...`);
    for (const cmd of existing) {
      await call(`/applications/${CLIENT_ID}/commands/${cmd.id}`, "DELETE");
    }
  }
}

async function wipeGuild() {
  const existing = await call(`/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`, "GET");
  if (Array.isArray(existing) && existing.length) {
    console.log(`🧹 Deleting ${existing.length} GUILD commands in ${GUILD_ID}...`);
    for (const cmd of existing) {
      await call(`/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands/${cmd.id}`, "DELETE");
    }
  }
}

async function registerGuild() {
  console.log(`📝 Registering ${commands.length} GUILD commands in ${GUILD_ID}...`);
  const result = await call(
    `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`,
    "PUT",
    commands
  );
  console.log(`✅ ${Array.isArray(result) ? result.length : 0} commands registered for guild ${GUILD_ID}.`);
}

(async () => {
  try {
    await wipeGlobal();
    await wipeGuild();
    await registerGuild();
    console.log("🏁 Done.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Register error:", err.message || err);
    process.exit(1);
  }
})();
