// interactions/components/roll-select.mjs
// Production: Log in `winners` (immer INSERT) + Upsert in `wins` (PK: guild_id, user_id).
// Fairness (48h) wird aus `winners` gezählt. Anzeige mit 🥇/🥈/🥉 und 🏆.

// ⚠️ hasModPerm entfernt – Permissions steuerst du jetzt nur über Discord-Settings

export const id = "roll-select";
export const idStartsWith = "roll-select";

const PRIO = { gear: 2, trait: 1, litho: 0 };

const norm  = (x) => String(x ?? "").trim().toLowerCase();
const emoji = (r) => ({ gear:"🗡️", trait:"💠", litho:"📜" }[String(r||"").toLowerCase()] || "❔");
const medal = (i) => (i===0?"🥇":i===1?"🥈":i===2?"🥉":"–");
const d20   = () => Math.floor(Math.random()*20)+1;

// Comparator: Gear > Trait > Litho → Wins (ASC) → Roll (DESC)
function cmp(a,b){
  const g=(PRIO[b.reason]??0)-(PRIO[a.reason]??0); if(g) return g;
  const w=(a.wins??0)-(b.wins??0); if(w) return w;
  return (b.roll??0)-(a.roll??0);
}
function line(e,i){
  const rTxt=(e.reason||"").toLowerCase();
  const wTxt = typeof e.win_count_after==="number" ? ` (W${e.win_count_after})`
             : typeof e.wins==="number" ? ` (W${e.wins})` : "";
  const rRoll = typeof e.roll==="number" ? ` · ${e.roll}` : "";
  return `${medal(i)} <@${e.user_id}> — ${emoji(rTxt)} ${rTxt}${rRoll}${wTxt}`;
}

export async function run(ctx){
  try{
    const db = ctx.db;
    if(!db) return ctx.reply("❌ Datenbank nicht verfügbar.", {ephemeral:true});

    const guildId =
      (typeof ctx.guildId==="function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;
    if(!guildId) return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", {ephemeral:true});

    const values = ctx?.values ?? ctx?.interaction?.data?.values ?? [];
    const itemSlug = norm(values[0]);
    const itemName = ctx?.customData?.item_name ?? values?.[1] ?? itemSlug;

    // Teilnehmer: letzter Vote pro User für dieses Item (48h) + GLOBALER Win-Count (48h)
    const { rows: participants } = await db.query(`
      WITH latest AS (
        SELECT DISTINCT ON (user_id)
          user_id, LOWER(reason) AS reason, created_at
        FROM votes
        WHERE guild_id = $1
          AND item_slug = $2
          AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY user_id, created_at DESC
      ),
      wins48 AS (                         -- ✨ global über alle Items
        SELECT user_id, COUNT(*)::int AS wins
        FROM winners
        WHERE guild_id = $1
          AND won_at > NOW() - INTERVAL '48 hours'
        GROUP BY user_id
      )
      SELECT l.user_id, l.reason, COALESCE(w.wins,0) AS wins
      FROM latest l
      LEFT JOIN wins48 w USING (user_id)
    `, [guildId, itemSlug]);

    if(!participants?.length){
      return ctx.reply(`ℹ️ Keine qualifizierten Teilnehmer für **${itemName}** in den letzten 48h.`, {ephemeral:false});
    }

    // Würfeln & sortieren
    let rolled = participants.map(p => ({...p, roll: d20()})).sort(cmp);

    // Sudden Death bei komplettem Gleichstand
    const top = rolled.filter(e => cmp(e, rolled[0]) === 0);
    const equal = (a,b) =>
      (PRIO[a.reason]??0)===(PRIO[b.reason]??0) &&
      (a.wins??0)===(b.wins??0) &&
      (a.roll??0)===(b.roll??0);
    let winner = top[0];
    if(top.length>1 && top.every(x=>equal(x,top[0]))){
      // Tie-Break nur zwischen Gleichauf-Teilnehmern
      const reRoll = top.map(p=>({...p, roll:d20()})).sort((a,b)=>(b.roll??0)-(a.roll??0));
      winner = reRoll[0];
      winner._tieBreak = true;
      rolled = rolled.map(p => p.user_id===winner.user_id ? winner : p).sort(cmp);
    }

    // Persistenz
    let stored = true;
    try{
      // 1) Log in `winners` (immer INSERT)
      await db.query(`
        INSERT INTO winners (guild_id, item_slug, user_id, won_at, window_end_at)
        VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '48 hours')
      `, [guildId, itemSlug, winner.user_id]);

      // 2) Aggregat in `wins` (PK: guild_id, user_id)
      await db.query(`
        INSERT INTO wins
          (guild_id, user_id, win_count, updated_at, item_slug, item_name_first, winner_user_id, reason, rolled_at, roll_value)
        VALUES
          ($1,      $2,     1,         NOW(),      $3,      $4,              $2,            $5,     NOW(),    $6)
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET
          win_count       = wins.win_count + 1,
          updated_at      = NOW(),
          rolled_at       = NOW(),
          item_slug       = EXCLUDED.item_slug,
          item_name_first = EXCLUDED.item_name_first,
          winner_user_id  = EXCLUDED.winner_user_id,
          reason          = EXCLUDED.reason,
          roll_value      = EXCLUDED.roll_value
      `, [guildId, winner.user_id, itemSlug, itemName, winner.reason, winner.roll]);

      await db.query("COMMIT").catch(()=>{});
    }catch(e){
      await db.query("ROLLBACK").catch(()=>{});
      console.error("[roll-select persist]", e?.message || e);
      stored = false;
    }

    // Gewinner-Wins neu berechnen (GLOBAL, 48h)  ✨
    let winnerWinCount = 1;
    try{
      const { rows: wcount } = await db.query(`
        SELECT COUNT(*)::int AS c
        FROM winners
        WHERE guild_id = $1
          AND user_id   = $2
          AND won_at > NOW() - INTERVAL '48 hours'
      `, [guildId, winner.user_id]);
      winnerWinCount = wcount?.[0]?.c ?? 1;
    }catch{}

    // Anzeige: W-Zähler beim Gewinner aktualisieren
    const display = rolled
      .map(e => ({
        ...e,
        win_count_after: e.user_id === winner.user_id ? winnerWinCount : e.wins
      }))
      .sort(cmp);

    const header = `🎲 Roll-Ergebnis für **${itemName}**${winner._tieBreak ? " (Tie-Break)" : ""}:`;
    const lines  = display.map((e,i)=>line(e,i));
    const rTxt   = (winner.reason||"").toLowerCase();
    const footer = `\n\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(rTxt)} ${rTxt} · Wurf ${winner.roll} (W${winnerWinCount})` + (stored ? "" : "  ⚠️ (nicht gespeichert)");
    const note   = winner._tieBreak ? `\n↪️ Tie-Break nur zwischen Gleichauf-Teilnehmern durchgeführt.` : "";

    return ctx.reply(`${header}\n${lines.join("\n")}${footer}${note}`, {ephemeral:false});
  }catch(e){
    console.error("[components/roll-select] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler beim Roll.", {ephemeral:true});
  }
}

export default { id, idStartsWith, run };
