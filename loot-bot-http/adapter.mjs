// adapter.mjs — Hier hängen wir deine bestehende Bot-Logik dran.
// Du kannst diese Platzhalter schrittweise durch deine echten Funktionen ersetzen.
// Context-Objekt (ctx) enthält: guildId, userId, options, reply(), followUp(), db (pg Pool), usw.

export async function voteInfo(ctx) {
  const content =
`# Loot-Bot – Kurz-Tutorial

## 🔰 Für alle User
- **/vote** – Item + Grund abgeben (Gründe: ⚔️ Gear > 💠 Trait > 📜 Litho)
- **/vote-show** – Aktuelle Votes (Fenster 48h ab dem **ersten** Vote)
- **/vote-remove** – Eigenen Vote für ein Item löschen

## 🧮 Fairness
Sortierung bei Rolls: **Grund** > **Wins (letzte 48h)** > **Wurfzahl**.

## 🎲 Auslosung
- **/roll** – Mods wählen *manuell* ein Item (Dropdown), rollt nur dieses
- **/roll-all** – rollt alle **nicht** gerollten Items in zufälliger Reihenfolge

## 🏆 Gewinnerliste
- **/winner** – Listet Gewinner kompakt (nur für Mods gedacht)

## 🧰 Admin/Mods
- **/vote-clear** – Reset (Votes, Items, Wins)
- **/reducew** – Wins reduzieren (User auswählen + Anzahl)

*Diese Antwort ist ephemer (nur du siehst sie).*`;

  await ctx.reply(content, { ephemeral: true });
}

export async function vote(ctx) {
  // TODO: hier deine echte Vote-Logik einhängen (DB insert, Fenster-Start, etc.)
  await ctx.reply("`/vote` ist auf HTTP migriert – Logik wird jetzt angeschlossen. 💡", { ephemeral: true });
}

export async function voteShow(ctx) {
  // TODO: db-Abfrage deiner Votes; wir antworten placeholder-style
  await ctx.reply("`/vote-show` (HTTP): Anzeige kommt gleich mit deiner echten DB-Logik. ✅", { ephemeral: true });
}

export async function voteRemove(ctx) {
  await ctx.reply("`/vote-remove` (HTTP): Entfernen wird als Nächstes angeschlossen. 🧹", { ephemeral: true });
}

export async function voteClear(ctx) {
  // Tipp: ctx.requireMod() erzwingt Mod-Rechte (ManageGuild), sonst throwt es 403
  await ctx.requireMod();
  await ctx.reply("`/vote-clear` (HTTP): Reset-Hook ist bereit, DB-Wipe wird gleich verdrahtet. ⚠️", { ephemeral: true });
}

export async function roll(ctx) {
  await ctx.requireMod();
  // TODO: Dropdown mit Items, dann Roll + Winner posten
  await ctx.reply("`/roll` (HTTP): Dropdown-Auswahl & Roll werden jetzt angeschlossen. 🎲", { ephemeral: true });
}

export async function rollAll(ctx) {
  await ctx.requireMod();
  await ctx.reply("`/roll-all` (HTTP): Random Reihenfolge & Flagging der Items folgt. 🚀", { ephemeral: true });
}

export async function winner(ctx) {
  await ctx.requireMod();
  await ctx.reply("`/winner` (HTTP): Kompakte Gewinnerliste wird angeschlossen. 🏆", { ephemeral: true });
}

export async function reduceW(ctx) {
  await ctx.requireMod();
  await ctx.reply("`/reducew` (HTTP): Wins reduzieren (User + Anzahl) wird jetzt verdrahtet. ➖", { ephemeral: true });
}
