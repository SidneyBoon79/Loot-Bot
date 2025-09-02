// register-commands.mjs — CLEAN: löscht Global-Commands, setzt nur Guild-Commands (Modal-Flow für /vote)
// - BOT_TOKEN wie im server.mjs
// - default_member_permissions = "32" (ManageGuild) Dezimalstring
// - 429-Backoff + 5min Sleep, damit Railway nicht in Restart-Loop rennt

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID; // erforderlich für CLEAN-Run

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ ENV fehlt: BOT_TOKEN, CLIENT_ID oder GUILD_ID");
  process.exit(1);
}

const API_BASE  = "https://discord.com/api/v10";
const MOD_PERMS = "32"; // ManageGuild

// ---------- Commands (Guild-only) ----------
const commands = [
  // /vote OHNE Optionen → öffnet Modal (Item), danach Dropdown (Grund) via Komponenten
  { name: "vote", description: "Vote abgeben: Item eingeben, dann Typ(en) wählen.", type: 1, dm_permission: false },

  { name: "vote-info", description: "Erklärt kurz das Voting (ephemer).", type: 1, dm_permission: false },
  {
    name: "vote-remove",
    description: "Entfernt deine Stimme zu einem Item (kein Überschreiben per /vote).",
    type: 1, dm_permission: false,
    options: [{ type: 3, name: "item", description: "Item-Name, von dem deine Stimme entfernt wird", required: true }],
  },
  { name: "vote-show", description: "Zeigt alle gültigen Votes der letzten 48h (öffentlich, mit ✅/🟡).", type: 1, dm_permission: false },

  { name: "roll",     description: "Rollt ein einzelnes Item (Dropdown-Auswahl; Ergebnis öffentlich).",    type: 1, dm_permission: false, default_member_permissions: MOD_PERMS },
  { name: "roll-all", description: "Rollt alle Items mit gültigen 48h-Votes (Ergebnisse öffentlich).",     type: 1, dm_permission: false, default_member_permissions: MOD_PERMS },
  { name: "winner",   description: "Listet kompakt alle Gewinne der letzten 48h (Mod-Only, ohne Emojis).", type: 1, dm_permission: false, default_member_permissions: MOD_PERMS },

  {
    name: "reducew",
    description: "Reduziert die Win-Zahl einer Person (nie unter 0; ephemer bestätigt).",
    type: 1, dm_permission: false, default_member_permissions: MOD_PERMS,
    options: [
      { type: 6, name: "user",   description: "Wessen Win-Zahl reduziert werden soll", required: true },
      { type: 4, name: "anzahl", description: "Wie viele Wins abziehen (min. 1)",      required: true, min_value: 1 },
    ],
  },

  { name: "vote-clear", description: "Löscht Votes/Items/Wins (Cleanup) – nur wenn du’s wirklich willst.", type: 1, dm_permission: false, default_member_permissions: MOD_PERMS },
];

// ---------- Helpers ----------
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function putJSON(url, body) {
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bot " + BOT_TOKEN },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const ra = res.headers.get("retry-after") || res.headers.get("Retry-After");
      const backoffMs = ra ? Number(ra) * 1000 : Math.min(60000, 1000 * Math.pow(2, attempt));
      console.warn("⚠️  429 Rate Limited – warte " + Math.round(backoffMs/1000) + "s …");
      await sleep(backoffMs);
      attempt++;
      continue;
    }

    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const msg = (typeof data === "string") ? data : (data && data.message) || ("HTTP " + res.status + " " + res.statusText);
      console.error("❌ Discord API Fehler:", msg, (data && data.errors) || "");
      throw new Error(msg);
    }
    return data;
  }
}

async function registerGuild(appId, guildId, cmds) {
  const url = API_BASE + "/applications/" + appId + "/guilds/" + guildId + "/commands";
  return putJSON(url, cmds);
}
async function registerGlobal(appId, cmds) {
  const url = API_BASE + "/applications/" + appId + "/commands";
  return putJSON(url, cmds);
}

// ---------- Main ----------
(async () => {
  try {
    console.log("🧹 Lösche GLOBAL-Commands (PUT []) …");
    await registerGlobal(CLIENT_ID, []); // Doppelte Einträge killen

    console.log("⏫ Registriere GUILD-Commands für Guild " + GUILD_ID + " (sofort sichtbar) …");
    const out = await registerGuild(CLIENT_ID, GUILD_ID, commands);
    console.log("✅ Guild-Commands registriert: " + (Array.isArray(out) ? out.length : "?"));

    console.log("⏳ Fertig. Schlafe jetzt 5 Minuten, damit keine Restart-Schleife entsteht …");
    await sleep(5 * 60 * 1000);
    console.log("👋 Ende. (Jetzt Start Command zurück auf `node server.mjs` setzen.)");
    process.exit(0);

  } catch (err) {
    console.error("❌ Registrierung fehlgeschlagen:", (err && err.message) || err);
    await sleep(30 * 1000);
    process.exit(1);
  }
})();
