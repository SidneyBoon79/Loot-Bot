// db/votes.mjs
// Helfer-Funktionen für Votes & Items.
// Erwartetes Schema (aus deinem Projekt):
//   votes(guild_id, user_id, item_slug, type, reason, item_name_first, created_at)
//   items(guild_id, item_slug, item_name_first, rolled_at, rolled_by, rolled_manual)
//
// Nutzung:
//   import { saveVote, hasUserVoted, registerItemIfMissing } from "../db/votes.mjs";
//   await saveVote({ guild_id, user_id, item_name, reason }, ctx.db);

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prettyName(name) {
  const s = String(name || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Prüft, ob der User für dieses Item (Slug) bereits einen Vote hat.
 * @returns {Promise<boolean>}
 */
export async function hasUserVoted({ guild_id, user_id, item_slug }, db) {
  const q = `
    SELECT 1
      FROM votes
     WHERE guild_id = $1
       AND user_id  = $2
       AND item_slug = $3
     LIMIT 1
  `;
  const res = await db.query(q, [guild_id, user_id, item_slug]);
  return res.rowCount > 0;
}

/**
 * Legt das Item in items an, falls es dort noch nicht existiert.
 */
export async function registerItemIfMissing({ guild_id, item_slug, item_name_first }, db) {
  const q = `
    INSERT INTO items (guild_id, item_slug, item_name_first, rolled_at)
    SELECT $1, $2, $3, NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM items WHERE guild_id = $1 AND item_slug = $2
     )
  `;
  await db.query(q, [guild_id, item_slug, item_name_first]);
}

/**
 * Speichert einen Vote (inkl. Item-Registrierung), wenn noch kein Doppelvote existiert.
 * Gibt ein Objekt zurück, das du für die UI nutzen kannst.
 *
 * @param {object} params
 * @param {string} params.guild_id
 * @param {string} params.user_id
 * @param {string} params.item_name         - Display-Name wie eingegeben/ausgewählt
 * @param {"gear"|"trait"|"litho"} params.reason
 * @param {object} db - dein DB-Client (ctx.db)
 *
 * @returns {Promise<{ok:boolean, alreadyVoted?:boolean, item_name_first?:string, item_slug?:string}>}
 */
export async function saveVote({ guild_id, user_id, item_name, reason }, db) {
  const item_name_first = prettyName(item_name);
  const item_slug = slugify(item_name_first);

  // Doppelvote?
  const already = await hasUserVoted({ guild_id, user_id, item_slug }, db);
  if (already) {
    return { ok: false, alreadyVoted: true, item_name_first, item_slug };
  }

  // Vote eintragen (reason = type, wegen NOT NULL)
  const insertVote = `
    INSERT INTO votes (guild_id, user_id, item_slug, type, reason, item_name_first, created_at)
    VALUES ($1,       $2,      $3,        $4,   $4,     $5,             NOW())
  `;
  await db.query(insertVote, [guild_id, user_id, item_slug, reason, item_name_first]);

  // Item registrieren, falls unbekannt
  await registerItemIfMissing({ guild_id, item_slug, item_name_first }, db);

  return { ok: true, item_name_first, item_slug };
}

/**
 * Hilfsfunktion: formatiert den Grund für die Anzeige.
 */
export function prettyReason(reason) {
  if (reason === "gear")  return "⚔️ Gear";
  if (reason === "trait") return "💠 Trait";
  if (reason === "litho") return "📜 Litho";
  return reason;
}

/**
 * Optional: Validierung des Grundes.
 */
export function isValidReason(x) {
  return x === "gear" || x === "trait" || x === "litho";
}
