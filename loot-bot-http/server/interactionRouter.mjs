// server/interactionRouter.mjs
// Discord Interaction Router (ESM) – minimal, stabil, mit ctx.reply shim.
// Keine Public-Key-Verify hier, das lief bei euch bereits extern/Proxy.
// ESM: "type": "module"

function buildReply(res) {
  // ctx.reply({ content, embeds?, components?, ephemeral? })
  return (data = {}) => {
    const { ephemeral, ...rest } = data || {};
    const flags = ephemeral ? 1 << 6 : 0; // 64
    return res.status(200).json({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: { flags, ...rest },
    });
  };
}

function extractOptionsMap(optionsArray) {
  const obj = {};
  if (!Array.isArray(optionsArray)) return obj;
  for (const opt of optionsArray) {
    if (opt?.name && Object.prototype.hasOwnProperty.call(opt, "value")) {
      obj[opt.name] = opt.value;
    }
    // Subcommands / nested
    if (opt?.options?.length) {
      Object.assign(obj, extractOptionsMap(opt.options));
    }
  }
  return obj;
}

async function handleCommand(interaction, req, res) {
  const name = interaction?.data?.name;
  if (!name) return res.status(200).json({ type: 4, data: { content: "❌ Unbekannter Command." } });

  // Modul nach konventionellem Dateinamen laden: commands/<name>.mjs
  // Beispiel: vote-show -> commands/vote-show.mjs
  const path = `../commands/${name}.mjs`;

  let mod;
  try {
    mod = await import(path);
  } catch (e) {
    console.error("[router] Import-Fehler Command:", name, e);
    return res.status(200).json({ type: 4, data: { content: `❌ Command '${name}' nicht gefunden.` } });
  }

  // Verschiedene Export-Stile tolerieren
  const handler =
    mod?.[name]?.run ||
    mod?.run ||
    (typeof mod?.default === "object" && mod.default.run) ||
    (typeof mod?.default === "function" ? mod.default : null);

  if (typeof handler !== "function") {
    console.error("[router] Kein ausführbarer Handler für", name, "in", path);
    return res.status(200).json({ type: 4, data: { content: `❌ Handler für '${name}' fehlt.` } });
  }

  const options = extractOptionsMap(interaction?.data?.options);
  const ctx = {
    req,
    res,
    interaction,
    reply: buildReply(res),
    guildId: interaction?.guild_id,
    channelId: interaction?.channel_id,
    userId: interaction?.member?.user?.id || interaction?.user?.id,
    options,
  };

  try {
    return await handler(ctx);
  } catch (err) {
    console.error("Fehler in Command", name + ":", err);
    return res.status(200).json({ type: 4, data: { content: "❌ Da ging was schief." } });
  }
}

async function handleComponent(interaction, req, res) {
  // Buttons / Selects
  const cid = interaction?.data?.custom_id;
  if (!cid) return res.status(200).json({ type: 4, data: { content: "❌ Unbekannte Komponente." } });

  // Mapping der bekannten Components → Datei
  const map = {
    "roll-select": "../interactions/components/roll-select.mjs",
    "reroll-select": "../interactions/components/reroll-select.mjs",
    "reasonSelect": "../interactions/components/reasonSelect.mjs",
  };

  const path = map[cid];
  if (!path) {
    console.warn("[router] Unbekannter custom_id:", cid);
    return res.status(200).json({ type: 4, data: { content: "❌ Fehler im Component." } });
  }

  let mod;
  try {
    mod = await import(path);
  } catch (e) {
    console.error("[router] Import-Fehler Component:", cid, e);
    return res.status(200).json({ type: 4, data: { content: "❌ Fehler im Component." } });
  }

  // Export-Toleranz
  const handler =
    mod?.[cid]?.run ||
    mod?.run ||
    (typeof mod?.default === "object" && mod.default.run) ||
    (typeof mod?.default === "function" ? mod.default : null);

  if (typeof handler !== "function") {
    console.error("[router] Kein ausführbarer Component-Handler für", cid, "in", path);
    return res.status(200).json({ type: 4, data: { content: "❌ Fehler im Component." } });
  }

  const ctx = {
    req,
    res,
    interaction,
    reply: buildReply(res),
    guildId: interaction?.guild_id,
    channelId: interaction?.channel_id,
    userId: interaction?.member?.user?.id || interaction?.user?.id,
    // Für Selects/Buttons: values und custom_id zugänglich machen
    values: interaction?.data?.values || [],
    customId: cid,
  };

  try {
    return await handler(ctx);
  } catch (err) {
    console.error("Component error:", err);
    return res.status(200).json({ type: 4, data: { content: "❌ Fehler im Component." } });
  }
}

// Öffentliche Router-Funktion
export async function routeInteraction(req, res) {
  const interaction = req?.body;
  const type = interaction?.type;

  // 1 = PING, 2 = APPLICATION_COMMAND, 3 = MESSAGE_COMPONENT, 5 = MODAL_SUBMIT, 4 = AUTOCOMPLETE
  if (type === 1) {
    return res.status(200).json({ type: 1 }); // PONG
  }

  if (type === 2) { // Slash-Command
    return handleCommand(interaction, req, res);
  }

  if (type === 3) { // Component (Buttons / Selects)
    return handleComponent(interaction, req, res);
  }

  // Fallback
  return res.status(200).json({ type: 4, data: { content: "❌ Unsupported interaction type." } });
}

export default { routeInteraction };
