import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "../auth.server";
import { usersRepo, pluginsRepo, auditRepo } from "../repos.server";
import {
  getDockerInfo,
  listProjectContainers,
  getContainerLogs,
  startExistingContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  isDockerAvailable,
  type ContainerSummary,
} from "../docker.server";

// ---------------------------------------------------------------------------
// Admin-only Docker management. Surfaces every container that belongs to this
// project (label skyutils.project), enriched with the owning user + run, and
// lets an admin fully control each one.
// ---------------------------------------------------------------------------

export interface AdminContainerRow extends ContainerSummary {
  username: string | null;
  globalName: string | null;
  avatarUrl: string | null;
  runStatus: string | null;
}

async function enrich(containers: ContainerSummary[]): Promise<AdminContainerRow[]> {
  return Promise.all(
    containers.map(async (c) => {
      const user = c.userId ? await usersRepo.byId(c.userId) : undefined;
      const run = c.runId ? await pluginsRepo.runById(c.runId) : undefined;
      return {
        ...c,
        username: user?.username ?? null,
        globalName: user?.global_name ?? null,
        avatarUrl: user?.avatar_url ?? null,
        runStatus: run?.status ?? null,
      };
    }),
  );
}

export const adminGetDockerStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdmin();
    const info = await getDockerInfo();
    let containers: AdminContainerRow[] = [];
    if (info.available) {
      try {
        containers = await enrich(await listProjectContainers());
      } catch {
        containers = [];
      }
    }
    const running = containers.filter((c) => c.state === "running").length;
    return {
      info,
      containers,
      counts: {
        total: containers.length,
        running,
        stopped: containers.length - running,
      },
    };
  },
);

export const adminGetContainerLogs = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: z.string().min(1), tail: z.number().min(10).max(2000).optional() }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    if (!(await isDockerAvailable())) {
      return { logs: "", available: false };
    }
    const logs = await getContainerLogs(data.id, data.tail ?? 400);
    return { logs, available: true };
  });

const idInput = z.object({ id: z.string().min(1) });

export const adminStartContainer = createServerFn({ method: "POST" })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    await startExistingContainer(data.id);
    await syncRunFromContainer(data.id, "running");
    await auditRepo.log({ actorId: actor.id, action: "docker_start", targetId: data.id });
    return { ok: true };
  });

export const adminStopContainer = createServerFn({ method: "POST" })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    await stopContainer(data.id);
    await syncRunFromContainer(data.id, "stopped");
    await auditRepo.log({ actorId: actor.id, action: "docker_stop", targetId: data.id });
    return { ok: true };
  });

export const adminRestartContainer = createServerFn({ method: "POST" })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    await restartContainer(data.id);
    await syncRunFromContainer(data.id, "running");
    await auditRepo.log({ actorId: actor.id, action: "docker_restart", targetId: data.id });
    return { ok: true };
  });

export const adminRemoveContainer = createServerFn({ method: "POST" })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    await removeContainer(data.id, true);
    await syncRunFromContainer(data.id, "stopped");
    await auditRepo.log({ actorId: actor.id, action: "docker_remove", targetId: data.id });
    return { ok: true };
  });

/** Keep the plugin_runs row in sync when an admin acts on its container. */
async function syncRunFromContainer(
  containerId: string,
  status: "running" | "stopped",
): Promise<void> {
  const run = await pluginsRepo.runByContainerId(containerId);
  if (run) await pluginsRepo.setRunStatus(run.id, status);
}
