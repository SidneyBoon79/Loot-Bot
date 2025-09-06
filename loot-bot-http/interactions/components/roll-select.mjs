import { db } from "../../db.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export async function handleRollSelect(interaction) {
  const guildId = interaction.guild.id;
  const itemSlug = interaction.customId.split(":")[1];
  const selectedUserIds = interaction.values;

  // Teilnehmer abfragen mit globalem Win-Count (48h)
  const participants = await db.manyOrNone(
    `
    WITH wins48 AS (
      SELECT user_id, COUNT(*)::int AS wins
      FROM winners
      WHERE guild_id = $1
        AND won_at > NOW() - INTERVAL '48 hours'
      GROUP BY user_id
    )
    SELECT m.user_id, m.username, m.item_type, COALESCE(w.wins, 0) AS wins
    FROM members m
    LEFT JOIN wins48 w
      ON m.user_id = w.user_id
    WHERE m.guild_id = $1
      AND m.user_id = ANY($2::text[])
    `,
    [guildId, selectedUserIds]
  );

  if (participants.length === 0) {
    await interaction.reply({
      content: "Keine gültigen Teilnehmer ausgewählt.",
      ephemeral: true,
    });
    return;
  }

  // Sortierung: Gear > Trait > Litho -> Wins (aufsteigend) -> Roll (absteigend)
  const rolls = participants.map((p) => ({
    ...p,
    roll: Math.floor(Math.random() * 20) + 1,
  }));

  rolls.sort((a, b) => {
    const typeOrder = { gear: 1, trait: 2, litho: 3 };
    if (typeOrder[a.item_type] !== typeOrder[b.item_type]) {
      return typeOrder[a.item_type] - typeOrder[b.item_type];
    }
    if (a.wins !== b.wins) return a.wins - b.wins;
    return b.roll - a.roll;
  });

  const winner = rolls[0];

  // Gewinner in winners-Log eintragen
  await db.none(
    `
    INSERT INTO winners (guild_id, item_slug, user_id, won_at, window_end_at)
    VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '48 hours')
    `,
    [guildId, itemSlug, winner.user_id]
  );

  // Gewinner-Wins neu abfragen (global, 48 h)
  const winnerWinCount = await db.one(
    `
    SELECT COUNT(*)::int AS c
    FROM winners
    WHERE guild_id = $1
      AND user_id = $2
      AND won_at > NOW() - INTERVAL '48 hours'
    `,
    [guildId, winner.user_id]
  );

  const embed = new EmbedBuilder()
    .setTitle(`🎲 Roll-Ergebnis für ${itemSlug}:`)
    .setColor(0xff0000);

  rolls.forEach((p, i) => {
    embed.addFields({
      name: `${i + 1}. ${p.username}`,
      value: `${p.item_type} · ${p.roll} (W${p.wins})`,
    });
  });

  embed.addFields({
    name: "🏆 Gewinner",
    value: `${winner.username} · ${winner.item_type} · Wurf ${winner.roll} · (W${winnerWinCount.c})`,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reroll:${itemSlug}`)
      .setLabel("Neu würfeln")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}
