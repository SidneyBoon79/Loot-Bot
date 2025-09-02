// server.mjs — Discord Interactions (HTTP only)
// - Verifiziert Signatur
// - Slash: /vote öffnet Modal (Item)
// - Modal-Submit → ephemere Message mit Dropdown (Gear/Trait/Litho)
// - Component (vote:grund:*) → Vote speichern
// - /roll Dropdown bleibt; /winner, /reducew etc. unverändert

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

// ===== DB =====
const pool = new Pool({ connectionString: DATABASE_URL });

// ===== Commands (Logik) =====
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

  const requireMod = () => {
    const permsStr = interaction.member?.permissions ?? "0";
    const has = (BigInt(permsStr) & 32n) === 32n; // ManageGuild
    if (!has) {
      const err = new Error("Nur für Mods (Manage Guild).");
      err.status = 200;
      throw err;
    }
  };

  return {
    guildId, userId, token,
    options: interaction.data?.options ?? [],
    reply, followUp,
    db: pool,
    interaction,
    requireMod
  };
}

// Kleine Utils
function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}
function b64uEncode(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64uDecode(s) {
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}
function asStringSelect(placeholder, customId, optionsArr) {
  return {
    type: 1, // Action Row
    components: [
      { type: 3, custom_id: customId, placeholder, min_values: 1, max_values: 1, options: optionsArr }
    ]
  };
}

// ===== Express =====
const app = express();
app.use(express.json({ type: "*/*" })); // falls nötig

app.get("/", (_req, res) => res.status(200).send("ok"));

app.post(
  "/interactions",
  verifyKeyMiddleware(PUBLIC_KEY),
  async (req, res) => {
    try {
      const i = req.body;

      // 1) Discord PING → PONG
      if (i.type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
      }

      // 2) Slash-Commands
      if (i.type === InteractionType.APPLICATION_COMMAND) {
        const name = i.data?.name;
        const ctx  = makeCtx({ interaction: i, res });

        switch (name) {
          case "vote": {
            // Variante B: Modal öffnen (Item-Eingabe)
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
              // (bestehende Dropdown-Logik aus deiner Datei bleibt unverändert)
              const { rows: items } = await pool.query(
                `SELECT i.item_name, COUNT(v.*) AS c_votes
                   FROM items i
                   JOIN votes v
                     ON v.guild_id = i.guild_id
                    AND v.item_name = i.item_name
                    AND v.created_at >= NOW() - INTERVAL '48 hours'
                  WHERE i.guild_id = $1 AND i.rolled = FALSE
                  GROUP BY 1 HAVING COUNT(v.*) > 0
                  ORDER BY 1 ASC LIMIT 25`,
                [ctx.guildId]
              );
              if (!items.length) {
                return ctx.reply("Keine **offenen Items mit Votes** im 48h-Fenster gefunden. ✅", { ephemeral: true });
              }
              const optionsArr = items.map(r => ({ label: `${r.item_name}`, value: r.item_name, description: `${r.c_votes} Votes` }));
              return ctx.reply(
                { content: "Wähle ein Item für den manuellen Roll:",
                  components: [asStringSelect("Item auswählen …", "roll:select", optionsArr)] },
                { ephemeral: true }
              );
            }
            return cmdRoll.run(ctx);
          }

          case "roll-all": return cmdRollAll.run(ctx);
          case "winner":   return cmdWinner.run(ctx);
          case "reducew":  return cmdReduceW.run(ctx);

          default:
            if (!implemented.has(name)) {
              return ctx.reply(`\`/${name}\` ist noch nicht migriert – kommt gleich.`, { ephemeral: true });
            }
            return ctx.reply("Unbekannter Command.", { ephemeral: true });
        }
      }

      // 3) Component Interactions (Dropdowns/Buttons)
      if (i.type === InteractionType.MESSAGE_COMPONENT) {
        const customId = i.data?.custom_id || "";
        const ctx = makeCtx({ interaction: i, res });

        // /roll Dropdown
        if (customId === "roll:select") {
          ctx.requireMod?.();
          const selected = i.data?.values?.[0];
          if (!selected) return ctx.reply("Kein Item gewählt.", { ephemeral: true });
          const forgedCtx = { ...ctx, options: [{ name: "item", value: selected }] };
          return cmdRoll.run(forgedCtx);
        }

        // /vote Grund-Dropdown (custom_id: vote:grund:<b64u(item)>)
        if (customId.startsWith("vote:grund:")) {
          const encoded = customId.slice("vote:grund:".length);
          const item = b64uDecode(encoded).trim();
          const reason = i.data?.values?.[0];
          return cmdVote.handleReasonSelect({ ...ctx, item, reason });
        }

        return ctx.reply("Unbekannte UI-Interaktion.", { ephemeral: true });
      }

      // 4) Modal Submit
      if (i.type === InteractionType.MODAL_SUBMIT) {
        const ctx = makeCtx({ interaction: i, res });
        if (i.data?.custom_id === "vote:modal") {
          // Liest Item aus dem Modal und liefert Dropdown zurück
          return cmdVote.handleModalSubmit(ctx);
        }
        return ctx.reply("Unbekanntes Modal.", { ephemeral: true });
      }

      // 5) Fallback
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Interaktionstyp (noch) nicht unterstützt.", flags: EPHEMERAL }
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

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP Interactions listening on :${PORT}`));
