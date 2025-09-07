// commands/vote-info.mjs
// /vote-info – zeigt das Kurz-Tutorial (ephemer nur für den Anfragenden)

export async function run(ctx) {
  const tutorial = `# Loot-Bot – Kurz-Tutorial

## 🌱 Für alle User 
- **/vote** – Item + Grund über Dropdown abgeben (Gründe: ⚔️ Gear > 💠 Trait > 📜 Litho)
- **/vote-show** – Aktuelle Votes (Fenster 48h ab dem **ersten** Vote)
- **/vote-remove** – Eigenen Vote für ein Item löschen
- **/winner** – Listet Gewinner kompakt

## ⚖️ Fairness
Sortierung bei Rolls: **Grund** > **Wins (letzte 48h)** > **Wurfzahl**.

## 🎲 Auslosung (Admin/Mods)
- **/roll** – Mods wählen *manuell* ein Item (Dropdown), rollt nur dieses
- **/roll-all** – rollt alle **nicht** gerollten Items in zufälliger Reihenfolge
- **/reroll** – erlaubt einen erneuten Roll für bereits gerollte Items (Wins werden umgebucht)

## 🛡️ Admin/Mods
- **/vote-clear** – Reset (Votes, Items, Wins)
- **/changew** – Wins reduzieren oder erhöhen (User auswählen (@User) + Anzahl)
`;

  await ctx.reply(tutorial, { ephemeral: true });
}
