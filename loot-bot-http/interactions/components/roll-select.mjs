// interactions/components/roll-select.mjs
// Einfache Persistenz: pro Gewinn immer INSERT (kein UPDATE/Tx).
// Schema-fit: setzt winner_user_id + user_id + updated_at.
// W-Zähler via COUNT(*) über 48h.

import { hasModPerm } from "../../services/permissions.mjs";

export const id = "roll-select";
export const idStartsWith = "roll-select";

const PRIO = { gear: 2, trait: 1, litho: 0 };
const norm  = (x) => String(x ?? "").trim().toLowerCase();
const emoji = (r) => ({ gear:"🗡️", trait:"💠", litho:"📜" }[String(r||"").toLowerCase()] || "❔");
const medal = (i) => (i===0?"🥇":i===1?"🥈":i===2?"🥉":"–");
const d20   = () => Math.floor(Math.random()*20)+1;

// Fairness: Gear > Trait > Litho → Wins (ASC) → Roll (DESC)
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
    if(!hasModPerm(ctx)) return ctx.reply("❌ Keine Berechtigung.", {ephemeral:true});
    const db = ctx.db;
    if(!db) return ctx.reply("❌ Datenbank nicht verfügbar.", {ephemeral:true});

    const guildId = (typeof ctx.guildId==="function"?ctx.guildId():ctx.guildId) ?? ctx.guild_id ?? ctx.guild?.id ?? null;
    if(!guildId) return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", {ephemeral:true});

    const values = ctx?.values ?? ctx?.interaction?.data?.values ?? [];
    const itemSlug = norm(values[0]);
    if(!itemSlug) return ctx.reply("⚠️ Ungültige Auswahl.", {ephemeral:true});

    // Itemname (48h)
    const { rows: nrows } = await db.query(`
      SELECT MIN(item_name_first) AS name
      FROM votes
      WHERE guild_id = $1
        AND item_slug = $2
        AND created_at > NOW() - INTERVAL '48 hours'
    `, [guildId, itemSlug]);
    const itemName = nrows?.[0]?.name || itemSlug;

    // Teilnehmer (neuester Grund je User, 48h) + aktuelle Wins (48h)
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
      wins48 AS (
        SELECT winner_user_id AS user_id, COUNT(*)::int AS wins
        FROM wins
        WHERE guild_id = $1
          AND item_slug = $2
          AND rolled_at > NOW() - INTERVAL '48 hours'
        GROUP BY winner_user_id
      )
      SELECT l.user_id, l.reason, COALESCE(w.wins,0) AS wins
      FROM latest l
      LEFT JOIN wins48 w USING (user_id)
    `, [guildId, itemSlug]);

    if(!participants?.length){
      return ctx.reply(`ℹ️ Keine qualifizierten Teilnehmer für **${itemName}** in den letzten 48h.`, {ephemeral:false});
    }

    // Würfeln & sortieren
    const rolled = participants.map(p => ({...p, roll: d20()})).sort(cmp);

    // Full tie an der Spitze → Sudden-Death
    const top = rolled.filter(e => cmp(e, rolled[0])===0);
    const equal = (a,b)=> (PRIO[a.reason]??0)===(PRIO[b.reason]??0) && (a.wins??0)===(b.wins??0) && (a.roll??0)===(b.roll??0);
    let winner = top[0];
    if(top.length>1 && top.every(x=>equal(x, top[0]))){
      let pool = [...top];
      for(let i=0;i<10;i++){
        pool = pool.map(x=>({...x, roll:d20()})).sort(cmp);
        const g = pool.filter(e=>cmp(e,pool[0])===0);
        if(g.length===1){ winner = pool[0]; winner._tieBreak=true; break; }
      }
    }

    // Persistenz: INSERT mit winner_user_id **und** user_id + updated_at
    let stored = false;
    try{
      await db.query(`
        INSERT INTO wins
          (guild_id, item_slug, item_name_first, winner_user_id, user_id, reason, roll_value, rolled_at, updated_at, win_count)
        VALUES
          ($1,       $2,        $3,               $4,            $4,     $5,      $6,        NOW(),    NOW(),     1)
      `, [guildId, itemSlug, itemName, winner.user_id, winner.reason, winner.roll]);
      stored = true;
    }catch(e){
      // Wenn das INSERT scheitert, bleibt stored=false und wir zeigen den Hinweis.
      console.error("[wins insert failed]", e?.message || e);
      stored = false;
    }

    // Anzeige: W-Zähler = bisherige COUNT(*) + 1
    const winnerWinCount = (winner.wins ?? 0) + 1;
    const display = rolled
      .map(e => ({...e, win_count_after: e.user_id===winner.user_id ? winnerWinCount : e.wins}))
      .sort(cmp);

    const header = `🎲 Roll-Ergebnis für **${itemName}**${winner._tieBreak ? " (Tie-Break)" : ""}:`;
    const lines  = display.map((e,i)=>line(e,i));
    const rTxt   = (winner.reason||"").toLowerCase();
    const footer = `\n\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(rTxt)} ${rTxt} · Wurf ${winner.roll} · (W${winnerWinCount})` + (stored ? "" : "  ⚠️ (nicht gespeichert)");
    const note   = winner._tieBreak ? `\n↪️ Tie-Break nur zwischen Gleichauf-Teilnehmern durchgeführt.` : "";

    return ctx.reply(`${header}\n${lines.join("\n")}${footer}${note}`, {ephemeral:false});
  }catch(e){
    console.error("[components/roll-select] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler beim Roll.", {ephemeral:true});
  }
}

export default { id, idStartsWith, run };
