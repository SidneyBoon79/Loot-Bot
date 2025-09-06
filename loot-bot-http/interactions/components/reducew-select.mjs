// interactions/components/reducew-select.mjs
import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { db } from '../../lib/db.mjs'; // Pfad ggf. anpassen

export const customId = 'reducew-select';

export async function handle(interaction) {
  const guildId = interaction.guildId;
  const memberId = interaction.values[0];

  // aktuelle wins laden
  const { rows: cur } = await db.query(
    `SELECT win_count FROM wins WHERE guild_id = $1 AND member_id = $2`,
    [guildId, memberId]
  );

  if (!cur.length || cur[0].win_count <= 0) {
    return interaction.update({
      content: 'Kein gültiger Gewinnerzustand mehr – Liste wird aktualisiert…',
      components: await buildList(guildId),
    });
  }

  const newWins = Math.max(0, cur[0].win_count - 1);

  await db.query(
    `UPDATE wins
        SET win_count = $3,
            updated_at = NOW()
      WHERE guild_id = $1 AND member_id = $2`,
    [guildId, memberId, newWins]
  );

  // Bestätigung + aktualisierte Liste
  const mention = `<@${memberId}>`;
  const header = `✅ Reduziert: ${mention} · neuer Stand **W${newWins}**.`;

  const components = await buildList(guildId);
  return interaction.update({
    content: components.length
      ? `${header}\nWähle weitere User — jeder Klick reduziert um **1**.`
      : `${header}\nEs sind keine User mit Wins > 0 mehr vorhanden.`,
    components,
  });
}

async function buildList(guildId) {
  const { rows } = await db.query(
    `SELECT member_id, win_count
       FROM wins
      WHERE guild_id = $1 AND win_count > 0
      ORDER BY updated_at DESC, win_count DESC
      LIMIT 25`,
    [guildId]
  );

  if (!rows.length) return [];

  const options = rows.map(r => ({
    label: `@${r.member_id} — W${r.win_count}`,
    value: r.member_id,
    description: `Wins: ${r.win_count}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('reducew-select')
    .setPlaceholder('Wähle einen User (reduziert um 1)')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);
  return [row];
}
