// server.mjs — HTTP Interactions (Legacy-DB, Modal-/Dropdown-Flow, Defer-Safe)
import express from "express";
import di from "discord-interactions";
import { REST, Routes } from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

const {
  verifyKeyMiddleware,
  InteractionType,
  InteractionResponseType,
} = di;

const EPHEMERAL = 64;

// ===== ENV =====
const PUBLIC_KEY   = process.env.DISCORD_PUBLIC_KEY;
const CLIENT_ID    = process.env.CLIENT_ID;
const BOT_TOKEN    = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
if (!PUBLIC_KEY || !CLIENT_ID || !BOT_TOKEN || !DATABASE_URL) {
  console.error("❌ ENV fehlt: DISCORD_PUBLIC_KEY, CLIENT_ID, BOT_TOKEN, DATABASE_URL");
}

const pool = new Pool({ connectionString: DATABASE_URL });

// ===== Commands =====
import * as cmdVote       from "./commands/vote.mjs";
import * as cmdVoteShow   from "./commands/vote-show.mjs";
import * as cmdVoteRemove from "./commands/vote-remove.mjs";
import * as cmdVoteClear  from "./commands/vote-clear.mjs";
import * as cmdVoteInfo   from "./commands/vote-info.mjs";
import * as cmdRoll       from "./commands/roll.mjs";
import * as cmdRollAll    from "./commands/roll-all.mjs";
import * as cmdWinner     from "./commands/winner.mjs";
import * as cmdReduceW    from "./commands/reducew.mjs";

const implemented = new Set([
  "vote", "vote-show", "vote-remove", "vote-clear", "vote-info",
  "roll", "roll-all", "winner", "reducew"
]);

// ===== Helpers =====
function makeCtx({ interaction, res }) {
  const guildId = interaction.guild_id || null;
  const userId  = interaction.member?.user?.id || interaction.user?.id || null;
  const token   = interaction.token;

  const restWebhook = new REST({ version: "10" }).setToken(BOT_TOKEN);

  const reply = async (content, { ephemeral = true } = {}) => {
    const data = typeof content === "string" ? { content } : content;
    const flags = ephemeral ? EPHEMERAL : undefined;
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { ...data, flags }
    });
  };

  const followUp = async (content, { ephemeral = false } = {}) => {
    const data = typeof content === "string" ? { content } : content;
    const flags = ephemeral ? EPHEMERAL : undefined;
    await restWebhook.post(Routes.webhook(CLIENT_ID, token), { body: { ...data, flags } });
  };

  const defer = async ({ ephemeral = false } = {}) => {
    return res.send({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: ephemeral ? EPHEMERAL : undefined }
    });
  };

  const requireMod = () => {
    const permsStr = interaction.member?.permissions ?? "0";
    const has = (BigInt(permsStr) & 32n) === 32n; // ManageGuild
    if (!has) { const err = new Error("Nur für Mods (Manage Guild)."); err.status = 200; throw err; }
  };

  return {
    guildId, userId, token,
    options: interaction.data?.options ?? [],
    reply, followUp, defer,
    db: pool,
    interaction,
    requireMod
  };
}

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}
function asStringSelect(placeholder, customId, optionsArr) {
  return { type: 1, components: [ { type: 3, custom_id: customId, placeholder, min_values: 1, max_values: 1, options: optionsArr } ] };
}

// ===== Express =====
const app = express();
app.get("/", (_req, res) => res.status(200).send("ok"));

app.post("/interactions", verifyKeyMiddleware(PUBLIC_KEY), async (req, res) => {
  try {
    const i = req.body;

    if (i.type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    if (i.type === InteractionType.APPLICATION_COMMAND) {
      const name = i.data?.name;
      const ctx  = makeCtx({ interaction: i, res });

      switch (name) {
        case "vote": {
          const modal = cmdVote.makeVoteModal();
          return res.send({ type: InteractionResponseType.MODAL, data: modal });
        }
        case "vote-show":   return cmdVoteShow.run(ctx); // macht selbst defer()
        case "vote-remove": return cmdVoteRemove.run(ctx); // zeigt Dropdown
        case "vote-clear":  return cmdVoteClear.run(ctx);
        case "vote-info":   return cmdVoteInfo.run(ctx);

        case "roll":       return cmdRoll.run(ctx);
        case "roll-all":   return cmdRollAll.run(ctx);
        case "winner":     return cmdWinner.run(ctx);
        case "reducew":    return cmdReduceW.run(ctx); // Dropdown + Modal

        default:
          if (!implemented.has(name)) return ctx.reply(`\`/${name}\` ist noch nicht migriert – kommt gleich.`, { ephemeral: true });
          return ctx.reply("Unbekannter Command.", { ephemeral: true });
      }
    }

    if (i.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = i.data?.custom_id || "";
      const ctx = makeCtx({ interaction: i, res });

      // /roll Dropdown (Item wählen)
      if (customId === "roll:select") {
        ctx.requireMod?.();
        const selectedSlug = i.data?.values?.[0];
        if (!selectedSlug) return ctx.reply("Kein Item gewählt.", { ephemeral: true });
        await ctx.defer({ ephemeral: false });
        try { await cmdRoll.run({ ...ctx, itemSlug: selectedSlug, useFollowUp: true }); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Roll"}`, { ephemeral: true }); }
        return;
      }

      // /vote – Grund wählen
      if (customId.startsWith("vote:grund:")) {
        const enc = customId.slice("vote:grund:".length);
        const item = Buffer.from(enc.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8").trim();
        const reason = i.data?.values?.[0];
        res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } });
        try { await cmdVote.handleReasonSelect({ ...ctx, item, reason, useFollowUp: true }); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Speichern"}`, { ephemeral: true }); }
        return;
      }

      // /vote-remove – Item wählen und entfernen
      if (customId === "vote-remove:select") {
        await ctx.defer({ ephemeral: true });
        const selectedSlug = i.data?.values?.[0];
        try { await cmdVoteRemove.handleSelect({ ...ctx, itemSlug: selectedSlug }); }
        catch (e) { await ctx.followUp(`❌ ${e.message || "Fehler beim Entfernen"}`, { ephemeral: true }); }
        return;
      }

      // /reducew – User wählen -> Modal anzeigen
      if (customId === "reducew:select") {
        ctx.requireMod?.();
        const selectedUser = i.data?.values?.[0];
        const modal = cmdReduceW.makeModal(selectedUser);
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
