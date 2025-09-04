// services/permissions.mjs

// ADMINISTRATOR = 0x00000008, MANAGE_GUILD = 0x00000020
const ADMINISTRATOR = 0x00000008;
const MANAGE_GUILD  = 0x00000020;

function hasBit(value, bit) {
  try {
    // value kann string (discord), number (libs) oder bigint sein
    if (typeof value === "bigint") return (value & BigInt(bit)) !== 0n;
    if (typeof value === "string") return (BigInt(value) & BigInt(bit)) !== 0n;
    if (typeof value === "number") return (value & bit) !== 0;
  } catch {}
  return false;
}

function getMember(ctx) {
  // ctx.member (Slash), ctx.interaction?.member (Fallback)
  return ctx?.member ?? ctx?.interaction?.member ?? null;
}

function getGuildId(ctx) {
  return ctx?.guildId ?? ctx?.interaction?.guild_id ?? null;
}

function rolesOf(member) {
  // discord liefert array von role IDs
  const roles = member?.roles ?? [];
  return Array.isArray(roles) ? new Set(roles) : new Set();
}

function hasAnyRole(member, roleIds) {
  if (!roleIds?.length) return false;
  const rset = rolesOf(member);
  for (const id of roleIds) if (rset.has(id)) return true;
  return false;
}

export function hasModPerm(ctx) {
  const member = getMember(ctx);
  if (!member) return false;

  // 1) Admin/Manage Guild
  const perms = member.permissions;
  if (hasBit(perms, ADMINISTRATOR) || hasBit(perms, MANAGE_GUILD)) return true;

  // 2) Owner (wenn verfügbar)
  const ownerFlag =
    member.user?.id && ctx?.guild?.ownerId
      ? member.user.id === ctx.guild.ownerId
      : false;
  if (ownerFlag) return true;

  // 3) MOD_ROLE_IDS aus ENV (kommagetrennt)
  const env = process.env.MOD_ROLE_IDS || "";
  const modIds = env
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (hasAnyRole(member, modIds)) return true;

  return false;
}
