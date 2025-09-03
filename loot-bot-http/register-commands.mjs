// register-commands.mjs
// Bulk-Overwrite der Guild-Commands (löscht alte & setzt neue in 1-2 Calls)
// ENV auf Railway: BOT_TOKEN, CLIENT_ID, GUILD_ID

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing ENV: BOT_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const API = "https://discord.com/api/v10";

const commands = [
  {
    name: "vote",
    description: "Vote abgeben: Item (Autocomplete) oder Modal → Grund wählen",
    options: [
      {
        type: 3,
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function call(path, method, body) {
  while (true) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "Authorization": `Bot ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 429) {
      // Rate limited: respektiere retry_after
      let retry = 2;
      try {
        const data = await res.json();
        retry = (data.retry_after ?? 2) + 0.25;
      } catch {}
      console.warn(`⏳ Rate limited, retry in ${retry}s`);
      await sleep(retry * 1000);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }
}

(async () => {
  try {
    const base = `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`;

    // 1) Wipe all (PUT empty array)
    console.log(`🧹 Clearing all guild commands in ${GUILD_ID}...`);
    await call(base, "PUT", []); // ersetzt alles durch nichts

    // kurze Verschnaufpause
    await sleep(500);

    // 2) Set new commands (Bulk overwrite)
    console.log(`📝 Registering ${commands.length} guild commands...`);
    const result = await call(base, "PUT", commands);
    console.log(`✅ ${Array.isArray(result) ? result.length : 0} commands active in guild ${GUILD_ID}.`);

    console.log("🏁 Done.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Register error:", err.message || err);
    process.exit(1);
  }
})();
