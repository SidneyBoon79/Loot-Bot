// commands/vote-info.mjs
// /vote-info – zeigt ein simples, anfängerfreundliches Tutorial (ephemer)

export async function run(ctx) {
  const tutorial = `# Loot-Bot – Schnellstart

## 👣 In 30 Sekunden starten
1) **/vote** – Schreib dein **Item** rein und wähl den **Grund**:
   ⚔️ Gear • 💠 Trait • 📜 Litho
2) **/vote-show** – Schau, was aktuell zur Auswahl steht (Fenster: ~48h ab dem ersten Vote).
3) **/vote-remove** – Upps? Zieh deinen Vote wieder zurück.

## 🎯 Wie wird entschieden? (fair & simpel)
Bei Auslosungen zählt: **Grund** > **Wins (letzte 48h)** > **Würfelzahl**.
Heißt: Gear hat Vorrang vor Trait vor Litho; wer schon oft gewonnen hat, rutscht etwas nach hinten.

## 🎲 Auslosung (für Mods)
- **/roll** – Ein **Item** aus der Liste auswählen und **jetzt** auswürfeln.
- **/roll-all** – Alle **offenen** Items nacheinander auswürfeln (Reihenfolge zufällig).
- **/reroll** – Ein **bereits gerolltes** Item nochmal würfeln:
  • Alter Gewinner: **–1 Win** (min. 0)
  • Neuer Gewinner: **+1 Win**
  • \`rolled_by\`/\`rolled_at\` werden aktualisiert
  • Gewinner bleibt gleich → **keine** Win-Änderung

## 🏆 Gewinner & Übersicht (für Mods)
- **/winner** – Kompakte Gewinnerliste der letzten ~48h.
- **/reducew** – Wins eines Users **senken** (User wählen + Anzahl).
- **/vote-clear** – **Reset**: löscht Votes, Items, Wins (nur wenn ihr wirklich neu starten wollt).
`;

  await ctx.reply(tutorial, { ephemeral: true });
}
