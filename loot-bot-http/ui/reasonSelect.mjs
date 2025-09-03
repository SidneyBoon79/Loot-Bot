// ui/reasonSelect.mjs — FINAL
// Baut eine Action Row mit String-Select (3 Gründe).
// customId muss vom Aufrufer kommen und trägt das Item: "vote:grund:<base64url(item)>"

export function reasonSelect(customId) {
  return {
    type: 1, // ACTION_ROW
    components: [
      {
        type: 3,                // STRING_SELECT
        custom_id: customId,    // z.B. vote:grund:ZWluZS1sYW56ZQ
        placeholder: "Grund wählen …",
        min_values: 1,
        max_values: 1,
        options: [
          { label: "Gear",  value: "gear",  emoji: { name: "⚔️" } },
          { label: "Trait", value: "trait", emoji: { name: "💠" } },
          { label: "Litho", value: "litho", emoji: { name: "📜" } },
        ],
      },
    ],
  };
}

export default { reasonSelect };
