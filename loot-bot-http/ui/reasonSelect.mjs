// ui/reasonSelect.mjs
// Dropdown-Komponente für den Grund (⚔️/💠/📜)

export function reasonSelect(customId = "vote:grund") {
  return {
    type: 1,
    components: [
      {
        type: 3, // STRING_SELECT
        custom_id: customId,
        placeholder: "Grund wählen…",
        min_values: 1,
        max_values: 1,
        options: [
          {
            label: "Gear (⚔️)",
            value: "gear",
            description: "Nur zum selbst ausrüsten",
          },
          {
            label: "Trait (💠)",
            value: "trait",
            description: "Freischalten oder Upgraden",
          },
          {
            label: "Litho (📜)",
            value: "litho",
            description: "Sammlung",
          },
        ],
      },
    ],
  };
}
