// server.mjs — Discord Interactions (Serverless, HTTP only) — FIXED CJS imports + EPHEMERAL flag
import express from "express";
import di from "discord-interactions"; // CJS → default import
import { REST, Routes, PermissionFlagsBits } from "discord.js";
import pkg from "pg";
const { Pool } = pkg;

const {
  verifyKeyMiddleware,
  InteractionType,
  InteractionResponseType,
} = di;

// === ENV ===
const PUBLIC_KEY   = process.env.DISCORD_PUBLIC_KEY;
const CLIENT_ID    = process.env.CLIENT_ID;
const BOT_TOKEN    = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
if (!PUBLIC_KEY || !CLIENT_ID || !BOT_TOKEN || !DATABASE_URL) {
  console.error("❌ ENV fehlt: DISCORD_PUBLIC_KEY, CLIENT_ID, BOT_TOKEN, DATABASE_URL");
}

// === DB ===
const pool = new Pool({ connectionString: DATABASE_URL });

// === Adapter (deine Bot-Logik) ===
import * as logic from "./adapter.mjs";

// === Helper ===
const EPHEMERAL = 64; // Discord message flag for ephemeral

function makeCtx({ interaction, res }) {
  const guildId = interaction.guild_id || null;
  const userId  = interaction.member?.user?.id || interaction.user?.id || null;
  const token   = interaction.token;

  const restWebhook = new REST({ version: "10" }).setToken(BOT_TOKEN);

  const reply = async (content, { ephemeral = false } = {}) => {
    const data = typeof content === "string" ? { content } : content;
    const flags = ephemeral ? EPHEMERAL : undefined;
    res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { ...data, flags }
    });
  };

  const followUp = async (content, { ephemeral = false } = {}) => {
    const data = typeof content === "string" ? { content } : content;
    const flags = ephemeral ? EPHEMERAL : undefined;
    await restWebhook.post(
      Routes.webhook(CLIENT_ID, token),
      { body: { ...data, flags } }
    );
  };

  const requireMod = () => {
    const perms = interaction.member?.permissions ?? "0";
    const has = (BigInt(perms) & BigInt(PermissionFlagsBits.ManageGuild)) !== 0n;
    if (!has) {
      const err = new Error("Mod-Rechte erforderlich (Manage Server).");
      err.status = 403;
      throw err;
    }
  };

  return {
    guildId, userId, options: interaction.data?.options ?? [],
    reply, followUp, db: pool, interaction, requireMod
  };
}

// === Express ===
const app = express();

app.get("/", (_req, res) => res.status(200).send("ok"));

app.post(
  "/interactions",
  verifyKeyMiddleware(PUBLIC_KEY),
  async (req, res) => {
    try {
      const i = req.body;

      // 1) Discord PING -> PONG
      if (i.type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
      }

      // 2) Slash-Commands
      if (i.type === InteractionType.APPLICATION_COMMAND) {
        const name = i.data?.name;
        const ctx = makeCtx({ interaction: i, res });

        switch (name) {
          case "vote-info":   return await logic.voteInfo(ctx);
          case "vote":        return await logic.vote(ctx);
          case "vote-show":   return await logic.voteShow(ctx);
          case "vote-remove": return await logic.voteRemove(ctx);
          case "vote-clear":  return await logic.voteClear(ctx);
          case "roll":        return await logic.roll(ctx);
          case "roll-all":    return await logic.rollAll(ctx);
          case "winner":      return await logic.winner(ctx);
          case "reducew":     return await logic.reduceW(ctx);
          default:
            return ctx.reply("Unbekannter Command.", { ephemeral: true });
        }
      }

      // 3) (Components später)
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "UI-Interaktion erkannt (Dropdown/Button) – wird verdrahtet.", flags: EPHEMERAL }
      });
    } catch (err) {
      console.error("Interaction error:", err);
      const status = err.status ?? 200;
      return res.status(status).send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `❌ ${err.message || "Fehler"}`, flags: EPHEMERAL }
      });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP Interactions listening on :${PORT}`));
