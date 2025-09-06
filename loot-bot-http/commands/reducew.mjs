// commands/reducew.mjs
import { db } from '../lib/db.mjs';

export const data = {
  name: 'reducew',
  description: 'Wins reduzieren – wähle einen Gewinner (jeder Klick -1, niemals unter 0).',
  type: 1,
};

export async function run(interaction) {
  const guildId = interaction.guildId;

  const { rows } = await db.query(
    `SELECT m.user_id, m.username, w.win_count
       FROM wins w
       JOIN members m
         ON w.user_id = m.user_id AND w.guild_id = m.guild_id
      WHERE w.guild_id = $1
        AND w.win_count > 0
      ORDER BY w.updated_at DESC, w.win_count DESC
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
    label: `${r.username} — W${r.win_count}`,
    value: r.user_id,
    description: `Wins: ${r.win_count}`,
  }));

  const components = [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 3, // String Select
          custom_id: 'reducew-select',
          placeholder: 'Wähle einen User (reduziert um 1)',
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
  ];

  return interaction.reply({
    content: '🏷️ **Wins reduzieren**\nWähle einen User — jeder Klick reduziert um **1** (niemals unter **0**).',
    components,
    ephemeral: true,
  });
}
