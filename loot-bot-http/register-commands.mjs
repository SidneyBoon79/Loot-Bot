// register-commands.mjs — einmal ausführen, um alle Slash-Commands zu registrieren
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

const TOKEN    = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID || ""; // empfohlen für schnelle Tests

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ BOT_TOKEN und CLIENT_ID müssen gesetzt sein.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("vote-info")
    .setDescription("Kurz-Tutorial anzeigen (nur für dich)")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Vote abgeben: Item eingeben, Grund wählen")
    .addStringOption(o => o.setName("item").setDescription("Item").setRequired(true))
    .addStringOption(o => o.setName("grund").setDescription("⚔️ Gear / 💠 Trait / 📜 Litho").setRequired(true)
      .addChoices(
        { name: "⚔️ Gear",  value: "gear"  },
        { name: "💠 Trait", value: "trait" },
        { name: "📜 Litho", value: "litho" }
      ))
    .toJSON(),

  new SlashCommandBuilder()
    .setName("vote-show")
    .setDescription("Aktuelle Votes anzeigen (Fenster 48h)")
    .addStringOption(o => o.setName("item").setDescription("Optional: nur dieses Item").setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName("vote-remove")
    .setDescription("Eigenen Vote für ein Item löschen")
    .addStringOption(o => o.setName("item").setDescription("Item").setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName("vote-clear")
    .setDescription("Alle Votes sofort löschen (Mods)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Würfelt ein einzelnes Item (Mods)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("roll-all")
    .setDescription("Rollt alle noch nicht gerollten Items (Mods)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("winner")
    .setDescription("Gewinnerliste kompakt (Mods)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("reducew")
    .setDescription("Wins von einem User reduzieren (Mods)")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("anzahl").setDescription("Wie viele Wins abziehen?").setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

try {
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Guild-Commands registriert für Guild:", GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Global-Commands registriert.");
  }
} catch (e) {
  console.error("❌ Fehler beim Registrieren:", e);
  process.exit(1);
}
