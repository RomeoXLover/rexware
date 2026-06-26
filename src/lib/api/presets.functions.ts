import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser, requireAdmin } from "../auth.server";
import { presetsRepo, type BotPresetRow } from "../repos.server";

// ---------------------------------------------------------------------------
// Reply-action presets — reusable, ordered sets of command templates.
//   • Global presets (owner_id NULL, is_global = 1) are managed by admins and
//     visible to everyone.
//   • Custom presets are owned by a user and only visible to them.
// ---------------------------------------------------------------------------

function parseActions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function publicPreset(p: BotPresetRow) {
  return {
    id: p.id,
    name: p.name,
    actions: parseActions(p.actions),
    isGlobal: p.is_global === 1,
    serverHost: p.server_host ?? null,
    serverPort: p.server_port ?? null,
    mcVersion: p.mc_version ?? null,
    createdAt: p.created_at,
  };
}

export type PublicPreset = ReturnType<typeof publicPreset>;

const actionsSchema = z
  .array(z.string().min(1).max(256))
  .min(1)
  .max(20);

// Optional server connection a preset can carry. Empty/omitted = actions-only.
const serverSchema = {
  serverHost: z.string().max(255).optional(),
  serverPort: z.number().int().min(1).max(65535).optional(),
  mcVersion: z.string().max(32).optional(),
};

function normalizeServer(data: {
  serverHost?: string;
  serverPort?: number;
  mcVersion?: string;
}) {
  const host = data.serverHost?.trim();
  return {
    serverHost: host ? host : null,
    serverPort: host ? (data.serverPort ?? 25565) : null,
    mcVersion: host ? (data.mcVersion?.trim() || null) : null,
  };
}

// --- Queries ----------------------------------------------------------------

export const listPresets = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    const rows = await presetsRepo.forUser(user.id);
    return { presets: rows.map(publicPreset) };
  },
);

// --- Mutations --------------------------------------------------------------

export const createPreset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(60),
      actions: actionsSchema,
      ...serverSchema,
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const preset = await presetsRepo.create({
      ownerId: user.id,
      name: data.name.trim(),
      actions: data.actions.map((a) => a.trim()).filter(Boolean),
      isGlobal: false,
      ...normalizeServer(data),
    });
    return { ok: true, preset: publicPreset(preset) };
  });

export const deletePreset = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const ok = await presetsRepo.deleteOwned(data.id, user.id);
    if (!ok) throw new Error("Preset not found or not yours to delete.");
    return { ok: true };
  });

// --- Admin (global presets) -------------------------------------------------

export const listGlobalPresets = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdmin();
    const rows = await presetsRepo.globals();
    return { presets: rows.map(publicPreset) };
  },
);

export const createGlobalPreset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(60),
      actions: actionsSchema,
      ...serverSchema,
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const preset = await presetsRepo.create({
      ownerId: null,
      name: data.name.trim(),
      actions: data.actions.map((a) => a.trim()).filter(Boolean),
      isGlobal: true,
      ...normalizeServer(data),
    });
    return { ok: true, preset: publicPreset(preset) };
  });

export const deleteGlobalPreset = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const ok = await presetsRepo.deleteAny(data.id);
    if (!ok) throw new Error("Preset not found.");
    return { ok: true };
  });
