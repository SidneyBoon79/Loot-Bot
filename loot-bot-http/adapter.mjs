// adapter.mjs — zentraler Router & Context-Helfer

function normalizeData(payload, opts = {}) {
  // Strings in Discord-Datenobjekt verwandeln
  const data = typeof payload === 'string' ? { content: payload } : { ...payload };
  if (opts.ephemeral) {
    data.flags = (data.flags ?? 0) | 64; // EPHEMERAL
  }
  return data;
}

export function makeCtx(body, res) {
  const ctx = {
    interaction: body,
    res,

    // Optionen bequem lesen (Slash-Command)
    opts: {
      getString(name) {
        const opt = body?.data?.options?.find(o => o?.name === name);
        return opt?.value ?? null;
      },
    },

    // Focused Option Value (Autocomplete)
    getFocusedOptionValue() {
      const focused = body?.data?.options?.find(o => o?.focused);
      return focused?.value ?? null;
    },

    // Antwort (normal)
    async reply(payload, opts) {
      const data = normalizeData(payload, opts);
      return res.json({ type: 4, data });
    },

    // Antwort (Autocomplete)
    async respond(choices = []) {
      // choices: [{ name, value }, ...]
      return res.json({
        type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
        data: { choices },
      });
    },

    // Für Komponenten nützlich
    get customId() {
      return body?.data?.custom_id ?? '';
    },
  };

  return ctx;
}

// ---- dynamisches Laden eines Moduls mit tolerantem Export-Namen
async function requireMod(spec) {
  const mod = await import(spec);
  // Versuche übliche Exportnamen, fallback auf default
  return (
    mod.run ||
    mod.handle ||
    mod.execute ||
    mod.onSelect ||
    mod.default
  );
}

// ---- Router
export async function routeInteraction(ctx) {
  const t = ctx.interaction?.type;

  // 2 = APPLICATION_COMMAND (Slash)
  if (t === 2) {
    const name = ctx.interaction?.data?.name;
    // Generisch: ./commands/<name>.mjs
    const handler = await requireMod(`./commands/${name}.mjs`);
    if (!handler) throw new Error(`Command-Handler fehlt: commands/${name}.mjs`);
    return handler(ctx);
  }

  // 4 = APPLICATION_COMMAND_AUTOCOMPLETE
  if (t === 4) {
    const cmd = ctx.interaction?.data?.name;
    // Bei /vote Autocomplete für "item"
    if (cmd === 'vote') {
      const handler = await requireMod(`./interactions/autocomplete/vote-item.mjs`);
      if (!handler) throw new Error(`Autocomplete-Handler fehlt: interactions/autocomplete/vote-item.mjs`);
      return handler(ctx);
    }
    // Fallback: leere Liste
    return ctx.respond([]);
  }

  // 3 = MESSAGE_COMPONENT (Buttons / String-Select)
  if (t === 3) {
    const id = ctx.customId || '';
    // Grundauswahl unseres Vote-Flows: "vote:grund:<...>"
    if (id.startsWith('vote:grund')) {
      const handler = await requireMod(`./interactions/components/reason-select.mjs`);
      if (!handler) throw new Error(`Component-Handler fehlt: interactions/components/reason-select.mjs`);
      return handler(ctx);
    }
    // unbekannte Komponente -> höflich ignorieren
    return ctx.reply('⚠️ Unbekannte Komponente.', { ephemeral: true });
  }

  // Ping oder anderes: freundlich nicken
  return ctx.reply('✅', { ephemeral: true });
}
