// ui/reasonSelect.mjs
export function reasonSelect(customId = "vote:reason") {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId,
        placeholder: "Grund wählen…",
        options: [
          { name: "⚔️ Gear",  value: "gear"  },
          { name: "💠 Trait", value: "trait" },
          { name: "📜 Litho", value: "litho" }
        ]
      }
    ]
  };
}
