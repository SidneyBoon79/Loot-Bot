// commands/reducew.mjs
import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { db } from '../lib/db.mjs'; // Pfad ggf. an euer Projekt anpassen

export const data = new SlashCommandBuilder()
  .setName('reducew')
  .setDescription('Wins reduzieren – wähle einen Gewinner (jeder Klick -1, niemals unter 0).');

export async function execute(interaction) {
  const guildId = interaction.guildId;

  // Top-25 Gewinner (win_count > 0)
  const { rows } = await db.query(
    `SELECT member_id, win_count
       FROM wins
      WHERE guild_id = $1 AND win_count > 0
      ORDER BY updated_at DESC, win_count DESC
      LIMIT 25`,
    [guildId]
  );

  if (!rows.length) {
    return interaction.reply({
      content: 'Es sind keine User mit Wins > 0 vorhanden.',
      ephemeral: true,
    });
  }

  const options = rows.map(r => ({
    label: `@${r.member_id} — W${r.win_count}`, // wir zeigen unten zusätzlich die Mention im Content
    value: r.member_id,                         // value = User-ID
    description: `Wins: ${r.win_count}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('reducew-select')
    .setPlaceholder('Wähle einen User (reduziert um 1)')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);

  return interaction.reply({
    content: '🏷️ **Wins reduzieren**\nWähle einen User — jeder Klick reduziert um **1** (niemals unter **0**).',
    components: [row],
    ephemeral: true,
  });
}
