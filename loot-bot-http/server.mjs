// server.mjs — Discord Interactions (Serverless, HTTP only)
// - Verifiziert Signaturen (Public Key)
// - Routet Slash-Commands zu /commands/*
// - Bietet Dropdown-UI für /roll (offene Items mit Votes, 48h)
// - Handhabt Component-Interaktionen (roll:select)

import express from "express";
import di from "discord-interactions"; // CJS: default import
import { REST, Routes, PermissionFlagsBits } from "discord.js";
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

// ===== Commands laden =====
import * as cmdVote       from "./commands/vote.mjs";
import * as cmdVoteShow   from "./commands/vote-show.mjs";
import * as cmdVoteRemove from "./commands/vote-remove.mjs";
import * as cmdVoteClear  from "./commands/vote-clear.mjs";
import * as cmdRoll       from "./commands/roll.mjs";
import * as cmdVoteInfo   from "./commands/vote-info.mjs"; // dein Tutorial

// Noch nicht migrierte Commands werden über Fallback beantwortet
const implemented = new Set([
  "vote", "vote-show", "vote-remove", "vote-clear", "roll", "vote-info"
]);

// ===== Helpers =====
function makeCtx({ interaction, res }) {
  const guildId = interaction.guild_id || null;
  const userId  = interaction.member?.user?.id || interaction.user?.id || null;
  const token   = interaction.token;

  const restWebhook = new REST({ version: "10" }).setToken(BOT_TOKEN);

  const reply = async (content, { ephemeral = true } = {}) => {
    // Default ephemer (bei Bedarf {ephemeral:false})
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
    await restWebhook.post(
      Routes.webhook(CLIENT_ID, token),
      { body: { ...data, flags } }
    );
  };

  const requireMod = () => {
    const permsStr = interaction.member?.permissions ?? "0";
    const has = (BigInt(permsStr) & BigInt(PermissionFlagsBits.ManageGuild)) !== 0n;
    if (!has) {
      const err = new Error("Nur Moderation (Manage Server) erlaubt.");
      err.status = 403;
      throw err;
    }
  };

  return {
    guildId, userId,
    options: interaction.data?.options ?? [],
    reply, followUp,
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

// Dropdown-Datenquelle für /roll
async function openItemsWithVotes(db, guildId) {
  const { rows } = await db.query(
    `
    WITH windowed AS (
      SELECT * FROM votes
       WHERE guild_id=$1 AND created_at > NOW() - INTERVAL '48 hours'
    )
    SELECT i.item_name,
           COALESCE(SUM(CASE WHEN w.item_name IS NOT NULL THEN 1 ELSE 0 END),0)::int AS c_votes
      FROM items i
 LEFT JOIN windowed w
        ON w.guild_id=i.guild_id AND w.item_name=i.item_name
     WHERE i.guild_id=$1 AND i.rolled=FALSE
  GROUP BY i.item_name
    HAVING COALESCE(SUM(CASE WHEN w.item_name IS NOT NULL THEN 1 ELSE 0 END),0) > 0
  ORDER BY i.item_name ASC
    `,
    [guildId]
  );
  return rows;
}

function asStringSelect(placeholder, customId, optionsArr) {
  return {
    type: 1, // Action Row
    components: [
      {
        type: 3, // StringSelect
        custom_id: customId,
        placeholder,
        min_values: 1,
        max_values: 1,
        options: optionsArr
      }
    ]
  };
}

// ===== Express =====
const app = express();

app.get("/", (_req, res) => res.status(200).send("ok"));

// Haupt-Endpoint (Discord Signaturprüfung)
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
          case "vote":
            return cmdVote.run(ctx);

          case "vote-show":
            // öffentliche Übersicht (wie in Datei konfiguriert)
            return cmdVoteShow.run(ctx);

          case "vote-remove":
            return cmdVoteRemove.run(ctx);

          case "vote-clear":
            return cmdVoteClear.run(ctx);

          case "vote-info":
            return cmdVoteInfo.run(ctx);

          case "roll": {
            // Wenn dein Registrar noch keine "item"-Option hat:
            // → Dropdown mit offenen Items anbieten
            const opt = indexByName(ctx.options);
            const passedItem = opt.item?.value?.trim();

            if (!passedItem) {
              ctx.requireMod?.();
              const items = await openItemsWithVotes(ctx.db, ctx.guildId);
              if (items.length === 0) {
                return ctx.reply("Keine **offenen Items mit Votes** im 48h-Fenster gefunden. ✅", { ephemeral: true });
              }
              const optionsArr = items.slice(0, 25).map(r => ({
                label: `${r.item_name}`,
                value: r.item_name,
                description: `${r.c_votes} Votes`
              }));

              return ctx.reply(
                {
                  content: "Wähle ein Item für den manuellen Roll:",
                  components: [asStringSelect("Item auswählen …", "roll:select", optionsArr)]
                },
                { ephemeral: true }
              );
            }

            // Wenn Option vorhanden: direkt rollen
            return cmdRoll.run(ctx);
          }

          // Noch nicht migrierte Commands
          default:
            if (!implemented.has(name)) {
              return ctx.reply(`\`/${name}\` ist noch nicht migriert – kommt gleich.`, { ephemeral: true });
            }
            return ctx.reply("Unbekannter Command.", { ephemeral: true });
        }
      }

      // 3) Component Interactions (Dropdowns/Buttons)
      if (i.type === InteractionType.MESSAGE_COMPONENT) {
        const customId = i.data?.custom_id;
        const ctx = makeCtx({ interaction: i, res });

        // Dropdown aus /roll
        if (customId === "roll:select") {
          ctx.requireMod?.();
          const selected = i.data?.values?.[0];
          if (!selected) {
            return ctx.reply("Kein Item gewählt.", { ephemeral: true });
          }

          // Fake-Options für cmdRoll: so als käme /roll item:<selected>
          const forgedCtx = {
            ...ctx,
            options: [{ name: "item", value: selected }]
          };

          // cmdRoll wird:
          // - öffentlich das Ranking per followUp posten
          // - ephemer bestätigen
          return cmdRoll.run(forgedCtx);
        }

        // Fallback für unbekannte Components
        return ctx.reply("Unbekannte UI-Interaktion.", { ephemeral: true });
      }

      // 4) Andere Typen (Autocomplete etc.) – ignorieren
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
