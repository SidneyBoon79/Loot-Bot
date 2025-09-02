// register-commands.mjs
// Registriert alle Slash-Commands.
// Nutzt Guild-Register (sofort sichtbar), fallback auf global wenn GUILD_ID fehlt.
// Node >=18 (fetch vorhanden). ESM-Datei.

const {
  DISCORD_TOKEN: BOT_TOKEN,
  CLIENT_ID,
  GUILD_ID, // empfohlen für schnelle Sichtbarkeit
} = process.env;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error("❌ ENV fehlt: DISCORD_TOKEN und/oder CLIENT_ID");
  process.exit(1);
}

/**
 * Commands-Definitionen
 * Mod-Only: /roll, /roll-all, /vote-clear, /winner, /reducew
 * Hinweise:
 * - default_member_permissions: "0x20" = ManageGuild
 * - dm_permission: false (keine DMs)
 */
const MOD_PERMS = "0x20"; // ManageGuild

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
        choices: [
          { name: "⚔️ Bedarf", value: "need" },
          { name: "💠 Gear", value: "gear" },
          { name: "📜 Orga", value: "org" },
        ],
      },
    ],
  },
  {
    name: "vote-remove",
    description:
      "Entfernt deine Stimme zu einem Item (kein Überschreiben per /vote).",
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
    description:
      "Zeigt alle gültigen Votes der letzten 48h (öffentlich, mit ✅/🟡).",
    type: 1,
    dm_permission: false,
  },

  // --- Rollen & Gewinner (Mod-Only) ---
  {
    name: "roll",
    description:
      "Rollt ein einzelnes Item (Dropdown-Auswahl; Ergebnis öffentlich).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
  {
    name: "roll-all",
    description:
      "Rollt alle Items mit gültigen 48h-Votes (Ergebnisse öffentlich).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
  {
    name: "winner",
    description:
      "Listet kompakt alle Gewinne der letzten 48h (Mod-Only, ohne Emojis).",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
  {
    name: "reducew",
    description:
      "Reduziert die Win-Zahl einer Person (nie unter 0; ephemer bestätigt).",
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
    description:
      "Löscht Votes/Items/Wins (Cleanup) – nur wenn du’s wirklich willst.",
    type: 1,
    dm_permission: false,
    default_member_permissions: MOD_PERMS,
  },
];

/**
 * Hilfsfunktionen
 */
const API_BASE = "https://discord.com/api/v10";

async function putJSON(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : data?.message || `HTTP ${res.status} ${res.statusText}`;
    console.error("❌ Discord API Fehler:", msg, data?.errors || "");
    throw new Error(msg);
  }
  return data;
}

async function registerGuild(appId, guildId, cmds) {
  const url = `${API_BASE}/applications/${appId}/guilds/${guildId}/commands`;
  return putJSON(url, cmds);
}

async function registerGlobal(appId, cmds) {
  const url = `${API_BASE}/applications/${appId}/commands`;
  return putJSON(url, cmds);
}

/**
 * Main
 */
(async () => {
  try {
    if (GUILD_ID) {
      console.log(
        `⏫ Registriere GUILD-Commands für Guild ${GUILD_ID} (sofort sichtbar)…`
      );
      const out = await registerGuild(CLIENT_ID, GUILD_ID, commands);
      console.log(
        `✅ Guild-Commands registriert: ${Array.isArray(out) ? out.length : "?"}`
      );
    } else {
      console.log(
        "⚠️  GUILD_ID fehlt – registriere GLOBAL (kann bis zu 1h dauern)…"
      );
      const out = await registerGlobal(CLIENT_ID, commands);
      console.log(
        `✅ Global-Commands registriert: ${Array.isArray(out) ? out.length : "?"}`
      );
    }
  } catch (err) {
    console.error("❌ Registrierung fehlgeschlagen:", err?.message || err);
    process.exit(1);
  }
})();
