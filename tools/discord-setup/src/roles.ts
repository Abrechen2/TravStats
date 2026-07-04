import { Guild, PermissionFlagsBits } from "discord.js";
import { ROLES, RoleDef } from "./config.js";
import { log, dryRunLog } from "./log.js";

export interface RoleAction {
  readonly name: string;
  readonly op: "create" | "patch" | "skip";
}

const MOD_PERMS: bigint =
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ViewAuditLog;

export function permissionsFor(role: RoleDef): bigint {
  if (role.admin) return PermissionFlagsBits.Administrator;
  if (role.mod) return MOD_PERMS;
  return 0n;
}

export function planRoles(existingNames: readonly string[]): RoleAction[] {
  const existing = new Set(existingNames);
  return ROLES.map((r) => ({
    name: r.name,
    op: existing.has(r.name) ? "patch" : "create",
  }));
}

export async function ensureRoles(guild: Guild, dryRun: boolean): Promise<void> {
  const roles = await guild.roles.fetch();
  const plan = planRoles(roles.map((r) => r.name));
  for (const def of ROLES) {
    const action = plan.find((a) => a.name === def.name);
    const perms = permissionsFor(def);
    if (action?.op === "create") {
      if (dryRun) {
        dryRunLog(`create role ${def.name} (${def.color})`);
        continue;
      }
      await guild.roles.create({ name: def.name, color: def.color, permissions: perms, reason: "TravStats setup" });
      log(`created role ${def.name}`);
    } else {
      const existing = roles.find((r) => r.name === def.name);
      if (!existing) continue;
      if (dryRun) {
        dryRunLog(`patch role ${def.name}`);
        continue;
      }
      await existing.setColors({ primaryColor: def.color });
      await existing.setPermissions(perms, "TravStats setup");
      log(`patched role ${def.name}`);
    }
  }
}
