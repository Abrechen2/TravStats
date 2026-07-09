import { describe, it, expect } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import { planRoles, permissionsFor } from "../src/roles.js";

describe("planRoles", () => {
  it("creates roles that don't exist and patches ones that do", () => {
    const actions = planRoles(["Moderator"]);
    expect(actions.find((a) => a.name === "Moderator")?.op).toBe("patch");
    expect(actions.find((a) => a.name === "Maintainer")?.op).toBe("create");
    expect(actions.find((a) => a.name === "Beta-Tester")?.op).toBe("create");
  });
});

describe("permissionsFor", () => {
  it("gives the Maintainer Administrator", () => {
    expect(permissionsFor({ name: "Maintainer", color: "#f0a947", admin: true }))
      .toBe(PermissionFlagsBits.Administrator);
  });

  it("gives the Beta-Tester no permissions", () => {
    expect(permissionsFor({ name: "Beta-Tester", color: "#7bc47f" })).toBe(0n);
  });

  it("gives the Moderator kick + ban + moderate", () => {
    const perms = permissionsFor({ name: "Moderator", color: "#4aa6b0", mod: true });
    expect((perms & PermissionFlagsBits.KickMembers) === PermissionFlagsBits.KickMembers).toBe(true);
    expect((perms & PermissionFlagsBits.BanMembers) === PermissionFlagsBits.BanMembers).toBe(true);
    expect((perms & PermissionFlagsBits.ModerateMembers) === PermissionFlagsBits.ModerateMembers).toBe(true);
    expect((perms & PermissionFlagsBits.ManageMessages) === PermissionFlagsBits.ManageMessages).toBe(true);
    expect((perms & PermissionFlagsBits.ManageThreads) === PermissionFlagsBits.ManageThreads).toBe(true);
    expect((perms & PermissionFlagsBits.ViewAuditLog) === PermissionFlagsBits.ViewAuditLog).toBe(true);
  });
});
