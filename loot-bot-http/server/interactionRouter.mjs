// server/interactionRouter.mjs
// Robuster Discord-Router mit Root-First Module-Resolution.
// ESM: "type": "module"

function buildReply(res) {
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
    if (opt?.options?.length) Object.assign(obj, extractOptionsMap(opt.options));
  }
  return obj;
}

async function tryImport(paths) {
  for (const p of paths) {
    try {
      const mod = await import(p);
      return { mod, path: p };
    } catch { /* try next */ }
  }
  return { mod: null, path: null };
}

// ---------------- Commands ---------------------------------------------------
async function handleCommand(interaction, req, res) {
  const name = interaction?.data?.name;
  if (!name) {
    return res.status(200).json({ type: 4, data: { content: "❌ Unbekannter Command." } });
  }

  // Wichtig: zuerst im Projektroot suchen (../vote-show.mjs etc.)
  const cand = [
    `../${name}.mjs`,
    `../commands/${name}.mjs`,
  ];
  const { mod, path } = await tryImport(cand);

  if (!mod) {
    console.error("[router] Command-Modul nicht gefunden:", name, "candidates:", cand);
    return res.status(200).json({ type: 4, data: { content: `❌ Command '${name}' nicht installiert.` } });
  }

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

// ---------------- Components -------------------------------------------------
async function handleComponent(interaction, req, res) {
  const cid = interaction?.data?.custom_id;
  if (!cid) return res.status(200).json({ type: 4, data: { content: "❌ Unbekannte Komponente." } });

  // Root-first: ../roll-select.mjs, ../reroll-select.mjs, ../reasonSelect.mjs
  const cand = [
    `../${cid}.mjs`,
    `../interactions/components/${cid}.mjs`,
    `../components/${cid}.mjs`,
  ];
  const { mod, path } = await tryImport(cand);

  if (!mod) {
    console.error("[router] Component-Modul nicht gefunden:", cid, "candidates:", cand);
    return res.status(200).json({ type: 4, data: { content: "❌ Fehler im Component." } });
  }

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
    values: interaction?.data?.values || [],
    customId: cid,
  };

  try {
    return await handler(ctx);
  } catch (err) {
    console.error("Component error:", cid, err);
    return res.status(200).json({ type: 4, data: { content: "❌ Fehler im Component." } });
  }
}

// ---------------- Entry ------------------------------------------------------
export async function routeInteraction(req, res) {
  const i = req?.body;
  const t = i?.type;

  // PING
  if (t === 1) return res.status(200).json({ type: 1 });

  // Slash-Command
  if (t === 2) return handleCommand(i, req, res);

  // Component (Button / Select)
  if (t === 3) return handleComponent(i, req, res);

  // Unsupported
  return res.status(200).json({ type: 4, data: { content: "❌ Unsupported interaction type." } });
}

export default { routeInteraction };
