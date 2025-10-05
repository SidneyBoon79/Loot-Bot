// adapter.mjs – minimaler Adapter mit robuster Options-Übernahme

// ---- Hilfen ---------------------------------------------------------------

// Discord schickt options ggf. geschachtelt (Subcommands). Flach machen:
function flattenOptions(opts) {
  const out = {};
  if (!Array.isArray(opts)) return out;
  for (const o of opts) {
    // Subcommand / SubcommandGroup
    if (o?.options && (o.type === 1 || o.type === 2)) {
      Object.assign(out, flattenOptions(o.options));
      continue;
    }
    if (o && typeof o.name === "string" && "value" in o) {
      out[o.name] = o.value;
    }
  }
  return out;
}

// modul dynamisch laden (relativ zur App-Struktur)
async function requireMod(spec) {
  // spec z.B. "commands/vote.mjs" oder "interactions/autocomplete/index.mjs"
  const url = new URL(`./${spec}`, import.meta.url);
  const mod = await import(url.href);
  return mod && mod.default ? mod.default : mod;
}

// ---- Context-Erstellung ---------------------------------------------------

export function makeCtx(raw, res) {
  const type = raw?.type;                      // 1 = PING, 2 = APP_CMD, 4 = AUTOCOMPLETE, ...
  const data = raw?.data ?? {};
  const optionsMap = flattenOptions(data.options);

  const ctx = {
    type,
    data,
    guildId: raw?.guild_id ?? null,
    userId:
      raw?.member?.user?.id ??
      raw?.user?.id ??
      null,

    // hier sind die wichtigen Slash-Options:
    options: optionsMap,

    // Autocomplete: aktuell fokussierter Wert, falls vorhanden
    getFocusedOptionValue() {
      try {
        const focused = Array.isArray(data.options)
          ? data.options.find(o => o?.focused)
          : null;
        return focused?.value ?? null;
      } catch {
        return null;
      }
    },

    // Antworten
    async reply(payload) {
      return res.json(
        typeof payload === "string"
          ? { type: 4, data: { content: payload } }
          : { type: 4, data: payload }
      );
    },

    async respond(choices) {
      // nur für Autocomplete (type 8 payload)
      return res.json({
        type: 8,
        data: { choices: Array.isArray(choices) ? choices : [] },
      });
    },

    // Debug-Helfer: im Zweifel einmal sehen, was tatsächlich ankommt
    debug() {
      try {
        console.log("[DBG] command:", data?.name, "options:", optionsMap);
      } catch {}
    },
  };

  return ctx;
}

// ---- Routing --------------------------------------------------------------

export async function routeInteraction(ctx) {
  // PING antworten wir im Server, hier nur Commands / Autocomplete
  if (ctx.type === 2) {
    // Application Command
    const name = ctx.data?.name;
    if (!name) throw new Error("missing command name");

    // optional: einmal debuggen (kannst du gerne entfernen)
    ctx.debug();

    // commands/<name>.mjs laden und ausführen
    const mod = await requireMod(`commands/${name}.mjs`);
    const run = mod?.run ?? mod?.default ?? mod;
    if (typeof run !== "function") {
      throw new Error(`commands/${name}.mjs exportiert keine Funktion.`);
    }
    return run(ctx);
  }

  if (ctx.type === 4) {
    // Autocomplete – wir leiten an euren zentralen Index weiter
    const auto = await requireMod("interactions/autocomplete/index.mjs");

    // Erwartet entweder default(ctx) oder ein Mapping pro Command
    if (typeof auto === "function") {
      return auto(ctx);
    }
    const cmd = ctx.data?.name;
    const handler =
      auto?.[cmd] ||
      auto?.default ||
      auto?.handleVoteItemAutocomplete; // fallback, falls ihr es so genannt habt

    if (typeof handler !== "function") {
      throw new Error("Autocomplete-Handler nicht gefunden.");
    }
    return handler(ctx);
  }

  // Fallback – nichts zu tun
  return ctx.reply({ content: "❌ Unsupported interaction type.", flags: 64 });
}
