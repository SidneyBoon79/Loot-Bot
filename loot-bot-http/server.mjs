// server.mjs — HTTP Interactions (Dropdowns, Modals, Bestätigungs-Buttons)
import express from "express";
import di from "discord-interactions";
import { REST, Routes } from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

const { verifyKeyMiddleware, InteractionType, InteractionResponseType } = di;
const EPHEMERAL = 64;

const PUBLIC_KEY   = process.env.DISCORD_PUBLIC_KEY;
const CLIENT_ID    = process.env.CLIENT_ID;
const BOT_TOKEN    = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
if (!PUBLIC_KEY || !CLIENT_ID || !BOT_TOKEN || !DATABASE_URL) {
  console.error("❌ ENV fehlt: DISCORD_PUBLIC_KEY, CLIENT_ID, BOT_TOKEN, DATABASE_URL");
}

const pool = new Pool({ connectionString: DATABASE_URL });

import * as cmdVote       from "./commands/vote.mjs";
import * as cmdVoteShow   from "./commands/vote-show.mjs";
import * as cmdVoteRemove from "./commands/vote-remove.mjs";
import * as cmdVoteClear  from "./commands/vote-clear.mjs";
import * as cmdVoteInfo   from "./commands/vote-info.mjs";
import * as cmdRoll       from "./commands/roll.mjs";
import * as cmdReroll     from "./commands/reroll.mjs";
import * as cmdRollAll    from "./commands/roll-all.mjs";
import * as cmdWinner     from "./commands/winner.mjs";
import * as cmdReduceW    from "./commands/reducew.mjs";

const implemented = new Set([
  "vote","vote-show","vote-remove","vote-clear","vote-info",
  "roll","reroll","roll-all","winner","reducew"
]);

function makeCtx({ interaction, res }) {
  const guildId = interaction.guild_id || null;
  const userId  = interaction.member?.user?.id || interaction.user?.id || null;
  const token   = interaction.token;

  const restWebhook = new REST({ version: "10" }).setToken(BOT_TOKEN);

  const reply = async (content, { ephemeral = true } = {}) => {
    const data = typeof content === "string" ? { content } : content;
    const flags = ephemeral ? EPHEMERAL : undefined;
    return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { ...data, flags } });
  };
  const followUp = async (content, { ephemeral = false } = {}) => {
    const data = typeof content === "string" ? { content } : content;
    const flags = ephemeral ? EPHEMERAL : undefined;
    await restWebhook.post(Routes.webhook(CLIENT_ID, token), { body: { ...data, flags } });
  };
  const defer = async ({ ephemeral = false } = {}) =>
    res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: ephemeral ? EPHEMERAL : undefined } });

  const requireMod = () => {
    const permsStr = interaction.member?.permissions ?? "0";
    const has = (BigInt(permsStr) & 32n) === 32n; // ManageGuild
    if (!has) { const err = new Error("Nur für Mods (Manage Guild)."); err.status = 200; throw err; }
  };

  return { guildId, userId, token, options: interaction.data?.options ?? [], reply, followUp, defer, db: pool, interaction, requireMod };
}

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}
function asStringSelect(placeholder, customId, optionsArr) {
  return { type: 1, components: [ { type: 3, custom_id: customId, placeholder, min_values: 1, max_values: 1, options: optionsArr } ] };
}
function b64url(s){ return Buffer.from(s, "utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function ub64url(s){ return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"); }

const app = express();
app.get("/", (_req, res) => res.status(200).send("ok"));

app.post("/interactions", verifyKeyMiddleware(PUBLIC_KEY), async (req, res) => {
  try {
    const i = req.body;

    if (i.type === InteractionType.PING) return res.send({ type: InteractionResponseType.PONG });

    if (i.type === InteractionType.APPLICATION_COMMAND) {
      const name = i.data?.name;
      const ctx  = makeCtx({ interaction: i, res });

      switch (name) {
        case "vote": {
          const modal = cmdVote.makeVoteModal();
          return res.send({ type: InteractionResponseType.MODAL, data: modal });
        }
        case "vote-show":   return cmdVoteShow.run(ctx);
        case "vote-remove": return cmdVoteRemove.run(ctx);
        case "vote-clear":  return cmdVoteClear.run(ctx);
        case "vote-info":   return cmdVoteInfo.run(ctx);

        case "roll": {
          const opt = indexByName(ctx.options);
          const passedItem = opt.item?.value?.trim();
          if (!passedItem) {
            ctx.requireMod?.();
            const { rows: items } = await ctx.db.query(
              `SELECT i.item_slug,
                      MAX(i.item_name_first) AS item_name_first,
                      COUNT(v.*) FILTER (WHERE v.created_at >= NOW() - INTERVAL '48 hours') AS c_votes
                 FROM items i
                 LEFT JOIN votes v ON v.guild_id = i.guild_id AND v.item_slug = i.item_slug
                WHERE i.guild_id = $1
                  AND (i.rolled_at IS NULL AND NOT COALESCE(i.rolled_manual,false))
                GROUP BY i.item_slug
                HAVING COUNT(v.*) FILTER (WHERE v.created_at >= NOW() - INTERVAL '48 hours') > 0
                ORDER BY item_name_first ASC
                LIMIT 25`,
              [ctx.guildId]
            );
            if (!items.length) return ctx.reply("Keine **offenen Items mit Votes** (48h). ✅", { ephemeral: true });

            const optionsArr = items.map(r => ({ label: `${r.item_name_first}`, value: r.item_slug, description: `🟢 nicht gerollt · ${r.c_votes} Votes` }));
            return ctx.reply({ content: "Wähle ein Item für den manuellen Roll:", components: [asStringSelect("Item auswählen …", "roll:select", optionsArr)] }, { ephemeral: true });
          }
          return cmdRoll.run(ctx);
        }

        case "reroll": {
          return cmdReroll.run(ctx);
        }

        case "roll-all":   return cmdRollAll.run(ctx);
        case "winner":     return cmdWinner.run(ctx);
        case "reducew":    return cmdReduceW.run(ctx);

        default:
          if (!implemented.has(name)) return ctx.reply(`\`/${name}\` ist noch nicht migriert – kommt gleich.`, { ephemeral: true });
          return ctx.reply("Unbekannter Command.", { ephemeral: true });
      }
    }

    if (i.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = i.data?.custom_id || "";
      const ctx = makeCtx({ interaction: i, res });

      // /roll Auswahl
      if (customId === "roll:select") {
        ctx.requireMod?.();
        const selectedSlug = i.data?.values?.[0];
        if (!selectedSlug) return ctx.reply("Kein Item gewählt.", { ephemeral: true });
        await ctx.defer({ ephemeral: false });
        try { await cmdRoll.run({ ...ctx, itemSlug: selectedSlug, useFollowUp: true }); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Roll"}`, { ephemeral: true }); }
        return;
      }

      // /reroll Auswahl → Bestätigung
      if (customId === "reroll:select") {
        ctx.requireMod?.();
        const selectedSlug = i.data?.values?.[0];
        return cmdReroll.confirm(ctx, selectedSlug);
      }

      // /reroll Buttons (Ja/Nein)
      if (customId.startsWith("reroll:confirm_")) {
        ctx.requireMod?.();
        const [, kind, enc] = customId.split(":"); // confirm_yes / confirm_no
        const slug = ub64url(enc);
        await ctx.defer({ ephemeral: true });
        if (kind === "confirm_yes") {
          try { await cmdReroll.execute(ctx, slug); }
          catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Re-Roll"}`, { ephemeral: true }); }
        } else {
          await ctx.followUp("Re-Roll abgebrochen.", { ephemeral: true });
        }
        return;
      }

      // vote reason select
      if (customId.startsWith("vote:grund:")) {
        const enc = customId.slice("vote:grund:".length);
        const item = Buffer.from(enc.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8").trim();
        const reason = i.data?.values?.[0];
        res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } });
        try { await cmdVote.handleReasonSelect({ ...ctx, item, reason, useFollowUp: true }); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Speichern"}`, { ephemeral: true }); }
        return;
      }

      // vote-remove
      if (customId === "vote-remove:select") {
        await ctx.defer({ ephemeral: true });
        const selectedSlug = i.data?.values?.[0];
        try { await cmdVoteRemove.handleSelect({ ...ctx, itemSlug: selectedSlug }); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Entfernen"}`, { ephemeral: true }); }
        return;
      }

      // reducew -> Modal
      if (customId === "reducew:userpick") {
        ctx.requireMod?.();
        const selectedUser = i.data?.values?.[0];
        const cur = await ctx.db.query(`SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`, [ctx.guildId, selectedUser]);
        const currentWins = cur.rows[0]?.win_count ?? 0;
        const modal = (await import("./commands/reducew.mjs")).makeModal(selectedUser, currentWins);
        return res.send({ type: InteractionResponseType.MODAL, data: modal });
      }

      return ctx.reply("Unbekannte UI-Interaktion.", { ephemeral: true });
    }

    if (i.type === InteractionType.MODAL_SUBMIT) {
      const ctx = makeCtx({ interaction: i, res });

      if (i.data?.custom_id === "vote:modal") {
        return cmdVote.handleModalSubmit(ctx);
      }
      if (i.data?.custom_id === "reducew:modal") {
        await ctx.defer({ ephemeral: true });
        try { await cmdReduceW.handleModalSubmit(ctx); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Anpassen"}`, { ephemeral: true }); }
        return;
      }

      return ctx.reply("Unbekanntes Modal.", { ephemeral: true });
    }

    return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "Interaktionstyp (noch) nicht unterstützt.", flags: EPHEMERAL } });
  } catch (err) {
    console.error("Interaction error:", err);
    const status = err.status ?? 200;
    return res.status(status).send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: `❌ ${err.message || "Fehler"}`, flags: EPHEMERAL } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP Interactions listening on :${PORT}`));
