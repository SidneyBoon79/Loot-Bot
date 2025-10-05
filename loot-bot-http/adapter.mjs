// adapter.mjs — Zentrale Brücke zwischen Discord-Webhook (server/index.mjs) und deiner Bot-Logik.
// ÄNDERN NUR HIER. Keine anderen Repo-Dateien nötig.

import fs from "fs";
import path from "path";

// ---- Import: dein Autocomplete-Handler (bereits vorhanden) ----
import {
  handleVoteItemAutocomplete
} from "./interactions/autocomplete/vote-item.mjs";

// ---- Hilfen -----------------------------------------------------

function findOption(options, name) {
  if (!Array.isArray(options)) return undefined;
  for (const opt of options) {
    if (opt.name === name) return opt;
    if (Array.isArray(opt.options)) {
      const sub = findOption(opt.options, name);
      if (sub) return sub;
    }
  }
  return undefined;
}

function getFocusedOptionValue(body) {
  try {
    const opts = body?.data?.options ?? [];
    for (const o of opts) {
      if (o.focused) return String(o.value ?? "");
      if (Array.isArray(o.options)) {
        const inner = o.options.find(x => x.focused);
        if (inner) return String(inner.value ?? "");
      }
    }
  } catch {}
  return "";
}

function makeOptsApi(body) {
  return {
    getString(name) {
      const opt = findOption(body?.data?.options ?? [], name);
      return typeof opt?.value === "string" ? opt.value : (
        opt?.value != null ? String(opt.value) : null
      );
    }
  };
}

// ---- Context-Objekt --------------------------------------------

export function makeCtx(body, res) {
  return {
    // Rohdaten
    interaction: { data: body?.data, raw: body },

    guildId: body?.guild_id ?? null,
    userId:
      body?.member?.user?.id ??
      body?.user?.id ??
      null,

    // Options-API
    opts: makeOptsApi(body),

    // Für Autocomplete: aktuell fokussierter Input
    getFocusedOptionValue() {
      return getFocusedOptionValue(body);
    },

    // Discord Antworten (vereinheitlicht)
    async reply(payload) {
      // Strings normalisieren auf { content }
      const data =
        typeof payload === "string" ? { content: payload } : payload ?? {};

      // type 4 (CHANNEL_MESSAGE_WITH_SOURCE) = 4, aber hier übergeben wir nur "data"
      // server/index.mjs verpackt das bereits passend.
      return res.json({ type: 4, data: normalizeMessage(data) });
    },

    async followUp(payload) {
      const data =
        typeof payload === "string" ? { content: payload } : payload ?? {};
      // type 4 wie oben – in unserem Webhook-Kontext gibt es kein separates FollowUp,
      // wir antworten schlicht nochmal.
      return res.json({ type: 4, data: normalizeMessage(data) });
    },

    // Für Autocomplete (Choices)
    async respond(choices) {
      const arr = Array.isArray(choices) ? choices : [];
      return res.json({
        type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
        data: { choices: arr }
      });
    }
  };
}

function normalizeMessage(d) {
  // Minimal-Normalisierung
  const out = {
    content: d.content ?? "",
    flags: d.ephemeral ? 64 : d.flags ?? undefined,
    components: d.components ?? undefined,
    embeds: d.embeds ?? undefined
  };
  // undefined-Felder raus
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

// ---- Router -----------------------------------------------------

export async function routeInteraction(ctx) {
  const body = ctx?.interaction?.raw ?? {};
  const t = body?.type;

  // Ping (sollte in server/index.mjs bereits abgefangen sein)
  if (t === 1) {
    return ctx.reply({ content: "pong", ephemeral: true });
  }

  // ---- Autocomplete: NUR HIER fixen, ohne andere Dateien anzufassen ----
  if (t === 4) {
    // Wir greifen NUR den Fall /vote item ab – alles andere ignorieren/leer
    const commandName = body?.data?.name;
    if (commandName === "vote") {
      // direkt unseren vorhandenen Handler verwenden
      try {
        return await handleVoteItemAutocomplete(ctx);
      } catch (e) {
        console.error("[INT] Autocomplete handler error:", e);
        return ctx.respond([]); // leere Liste statt Fehler
      }
    }
    // Unbekanntes Autocomplete → leere Liste zurück
    return ctx.respond([]);
  }

  // ---- Application Command (Slash) bleibt wie gehabt ----
  if (t === 2) {
    // Wir laden dein Command dynamisch wie zuvor – KEINE Repo-Änderungen nötig.
    const name = body?.data?.name;
    try {
      const mod = await import(`./commands/${name}.mjs`);
      const fn = mod?.default?.run ?? mod?.run;
      if (typeof fn !== "function") {
        throw new Error(`Command "${name}" hat keine run()-Funktion.`);
      }
      return await fn(ctx);
    } catch (e) {
      console.error("[INT] Command load/exec error:", e);
      return ctx.reply("❌ Interner Fehler.", { ephemeral: true });
    }
  }

  // ---- Komponenten (Buttons / Selects) unverändert weiterleiten ----
  if (t === 3) {
    const cid = body?.data?.custom_id ?? "";
    try {
      // Beispiel: "vote:grund:<payload>" → wir mappen auf ./interactions/components/<prefix>.mjs
      const prefix = String(cid).split(":")[0]; // z.B. "vote"
      const mod = await import(`./interactions/components/${prefix}.mjs`);
      const fn =
        mod?.default?.handle ?? mod?.handle ??
        mod?.default?.run ?? mod?.run;
      if (typeof fn !== "function") {
        throw new Error(`Component "${prefix}" hat keinen Handler.`);
      }
      return await fn(ctx);
    } catch (e) {
      console.error("[INT] Component load/exec error:", e);
      return ctx.reply("❌ Interner Fehler.", { ephemeral: true });
    }
  }

  // Fallback
  return ctx.reply("❌ Unbekannte Interaktion.", { ephemeral: true });
}
