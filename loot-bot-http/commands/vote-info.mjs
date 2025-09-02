// commands/vote-info.mjs
// /vote-info – zeigt das Kurz-Tutorial (ephemer nur für den Anfragenden)

export async function run(ctx) {
  const tutorial = `# Loot-Bot – Kurz-Tutorial

## 🌱 Für alle User
- **/vote** – Item + Grund abgeben (Gründe: ⚔️ Gear > 💠 Trait > 📜 Litho)
- **/vote-show** – Aktuelle Votes (Fenster 48h ab dem **ersten** Vote)
- **/vote-remove** – Eigenen Vote für ein Item löschen

## ⚖️ Fairness
Sortierung bei Rolls: **Grund** > **Wins (letzte 48h)** > **Wurfzahl**.

## 🎲 Auslosung
- **/roll** – Mods wählen *manuell* ein Item (Dropdown), rollt nur dieses
- **/roll-all** – rollt alle **nicht** gerollten Items in zufälliger Reihenfolge

## 🏆 Gewinnerliste
- **/winner** – Listet Gewinner kompakt (nur für Mods gedacht)

## 🛡️ Admin/Mods
- **/vote-clear** – Reset (Votes, Items, Wins)
- **/reducew** – Wins reduzieren (User auswählen + Anzahl)
`;

  await ctx.reply(tutorial, { ephemeral: true });
}

