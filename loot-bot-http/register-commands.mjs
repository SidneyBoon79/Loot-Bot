// register-commands.mjs (SAFE VERSION)
// - Registriert alle Slash-Commands (Guild bevorzugt).
// - Nutzt BOT_TOKEN (konsistent mit server.mjs).
// - Handhabt 429 mit Backoff.
// - Vermeidet Railway-Restart-Loop: schläft nach Erfolg 5 Minuten statt sofort zu exitten.

const {
  BOT_TOKEN,     // konsistent zu server.mjs
  CLIENT_ID,
  GUILD_ID,      // empfohlen für sofortige Sichtbarkeit
} = process.env;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error("❌ ENV fehlt: BOT_TOKEN und/oder CLIENT_ID");
  process.exit(1);
}

const MOD_PERMS = "0x20"; // ManageGuild
const API_BASE = "https://discord.com/api/v10";

/** @type {import("discord-api-types/v10").RESTPostAPIChatInputApplicationCommandsJSONBody[]} */
const commands = [
  // --- Voting & Info ---
  {
    name: "vote-info",
    description: "Erklärt kurz das Voting (ephemer).",
    type: 1,
    dm_permission: false,
  },
  {
    name: "vote",
    description: "Stimme für ein Item mit Grund ab (kein Doppelvote).",
    type: 1,
    dm_permission: false,
    options: [
      {
        type: 3, // STRING
        name: "item",
        description: "Item-Name (z. B. Schwert, Ring, Bogen …)",
        required: true,
      },
      {
        type: 3, // STRING
        name: "grund",
        description: "Grund deiner Stimme",
        required: true,
        // WICHTIG: passt zu commands/*.mjs
        choices: [
          { name: "⚔️ Gear",  value: "gear"  },
          { name: "💠 Trait", value: "trait" },
          { name: "📜 Litho", value: "litho" },
        ],
      },
    ],
  },
  {
    name: "vote-remove",
    description: "Entfernt deine Stimme zu einem Item (kein Überschreiben per /vote).",
    type: 1,
    dm_permission: false,
    options: [
      {
        type: 3,
        name: "item",
        description: "Item-Name, von dem deine Stimme entfernt wird",
        required: true,
      },
    ],
  },
  {
    name: "vote-show",
    description: "Zeigt alle gültigen Votes der letzten 48h (öffentlich, mit ✅/🟡).",
    type: 1,
    dm_permission: false,
  },

  // --- Rollen & Gewinner (Mod-Only) ---
  {
    name: "roll",
    description: "Rollt ein einzelnes Item (Dropdown-Auswahl; Ergebnis öffentlich).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
  {
    name: "roll-all",
    description: "Rollt alle Items mit gültigen 48h-Votes (Ergebnisse öffentlich).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
  {
    name: "winner",
    description: "Listet kompakt alle Gewinne der letzten 48h (Mod-Only, ohne Emojis).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
  {
    name: "reducew",
    description: "Reduziert die Win-Zahl einer Person (nie unter 0; ephemer bestätigt).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
    options: [
      {
        type: 6, // USER
        name: "user",
        description: "Wessen Win-Zahl reduziert werden soll",
        required: true,
      },
      {
        type: 4, // INTEGER
        name: "anzahl",
        description: "Wie viele Wins abziehen (min. 1)",
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: "vote-clear",
    description: "Löscht Votes/Items/Wins (Cleanup) – nur wenn du’s wirklich willst.",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
];

// ---------- Helpers ----------
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function putJSON(url, body) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const rl = res.headers.get("Retry-After") || res.headers.get("retry-after");
      const retryAfterMs = rl ? Number(rl) * 1000 : Math.min(60000, 1000 * Math.pow(2, attempt));
      console.warn(`⚠️  429 Rate Limited – warte ${Math.round(retryAfterMs/1000)}s …`);
      await sleep(retryAfterMs);
      attempt++;
      continue;
    }

    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const msg = typeof data === "string"
        ? data
        : data?.message || `HTTP ${res.status} ${res.statusText}`;
      console.error("❌ Discord API Fehler:", msg, data?.errors || "");
      throw new Error(msg);
    }
    return data;
  }
}

async function registerGuild(appId, guildId, cmds) {
  const url = `${API_BASE}/applications/${appId}/guilds/${gu_
