import process from "node:process";
import type Docker from "dockerode";

// ---------------------------------------------------------------------------
// Docker orchestration layer (server-only).
//
// One container per plugin run, all tagged with the project label so the admin
// panel can list/manage exactly the containers that belong to this app. The
// layer degrades gracefully: when no Docker engine is reachable (e.g. the
// hosted preview), every call throws `DockerUnavailableError`, which callers
// catch to keep runs in the `pending` state instead of crashing.
//
// All Docker operations are wrapped in a 15-second timeout so a stalled
// Docker call (e.g. image pull, network lookup) never hangs the HTTP
// request/response cycle indefinitely.
// ---------------------------------------------------------------------------

const DOCKER_TIMEOUT_MS = 15_000;

function withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DockerUnavailableError(`${label} timed out after ${DOCKER_TIMEOUT_MS / 1000}s`));
    }, DOCKER_TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export const PROJECT_LABEL = "rexware.project";
export const PROJECT_NAME =
  process.env.DOCKER_PROJECT_LABEL?.trim() || "beam-bot-hub";

export const LABELS = {
  project: PROJECT_LABEL,
  kind: "rexware.kind",
  runId: "rexware.run_id",
  userId: "rexware.user_id",
  pluginId: "rexware.plugin_id",
  createdAt: "rexware.created_at",
} as const;

export class DockerUnavailableError extends Error {
  constructor(message = "Docker engine is not reachable") {
    super(message);
    this.name = "DockerUnavailableError";
  }
}

function botImage(): string {
  return process.env.BOT_IMAGE?.trim() || "rexware/bot:latest";
}

/**
 * Image for the Minecraft beam bot (the Rust `feather-bot` binary). This is a
 * DIFFERENT image from `botImage()` (which is the Python plugin runner). Built
 * from the `bot/` crate — see the `mcbot` build-only service in
 * docker-compose.yml.
 */
function mcBotImage(): string {
  return process.env.MC_BOT_IMAGE?.trim() || "rexware/mcbot:latest";
}

function stateVolume(): string {
  return process.env.BOT_STATE_VOLUME?.trim() || "rexware_bot_state";
}

/**
 * The docker network plugin-run containers should join so they can reach the
 * `web` service by name (e.g. http://web:3000) instead of routing through the
 * public domain. Empty = default bridge (legacy behaviour).
 *
 * Resolution order:
 *   1. Scan Docker networks for one whose Name matches the compose project
 *      (`<project>_default`).
 *   2. Scan Docker networks for one whose Labels["com.docker.compose.project"]
 *      matches PROJECT_NAME.
 *   3. Fall back to "" (default bridge).
 * The result is cached so we only query Docker once per process lifetime.
 */
let _resolvedNetwork: string | null = null;

async function resolveNetworkFromDocker(
  docker: Docker,
  projectName: string,
): Promise<string | null> {
  try {
    const nets = (await withTimeout("listNetworks", docker.listNetworks())) as Docker.NetworkInfo[];
    const projectDefault = `${projectName}_default`;

    // 1. Exact name match (what compose creates under the hood)
    const byName = nets.find((n) => n.Name === projectDefault);
    if (byName) return byName.Name;

    // 2. Match by compose project label
    const byLabel = nets.find((n) => {
      const labels = (n as { Labels?: Record<string, string> }).Labels ?? {};
      return labels["com.docker.compose.project"] === projectName;
    });
    if (byLabel) return byLabel.Name;
  } catch {
    // dockerode not available — fall through to ""
  }
  return null;
}

async function runnerNetwork(): Promise<string> {
  // Fast path: already cached
  if (_resolvedNetwork !== null) return _resolvedNetwork;

  // Probe Docker for the actual network name
  try {
    const docker = getDocker();
    const discovered = await resolveNetworkFromDocker(docker, PROJECT_NAME);
    _resolvedNetwork = discovered ?? "";
  } catch {
    _resolvedNetwork = "";
  }
  return _resolvedNetwork;
}

function runnerCallbackUrl(): string {
  const explicit = process.env.RUNNER_CALLBACK_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.APP_BASE_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/api/runner/callback` : "";
}

function runnerLogsUrl(): string {
  const explicit = process.env.RUNNER_LOGS_URL?.trim();
  if (explicit) return explicit;
  const cb = runnerCallbackUrl();
  // Derive .../api/runner/logs from the callback URL when not set explicitly.
  return cb ? cb.replace(/\/callback$/, "/logs") : "";
}

function runnerToken(): string {
  return process.env.RUNNER_TOKEN?.trim() || "";
}

let _docker: Docker | null = null;
let _checked = false;
let _available = false;

async function getDocker(): Promise<Docker> {
  if (_docker) return _docker;
  const { default: Docker } = await import("dockerode");
  const host = process.env.DOCKER_HOST?.trim();
  if (host) {
    _docker = new Docker();
  } else {
    const socketPath = process.env.DOCKER_SOCKET?.trim() || "/var/run/docker.sock";
    _docker = new Docker({ socketPath });
  }
  return _docker;
}

/** Cheap, cached reachability probe. Never throws. */
export async function isDockerAvailable(force = false): Promise<boolean> {
  if (_checked && !force) return _available;
  try {
    await withTimeout("ping", getDocker().ping());
    _available = true;
  } catch {
    _available = false;
  }
  _checked = true;
  return _available;
}

async function requireDocker(): Promise<Docker> {
  if (!(await isDockerAvailable(true))) {
    throw new DockerUnavailableError();
  }
  return getDocker();
}

async function dockerListContainers(): Promise<Docker.ContainerInfo[]> {
  const docker = await requireDocker();
  return withTimeout("listContainers", docker.listContainers({ all: true })) as Promise<Docker.ContainerInfo[]>;
}

async function dockerCreateContainer(opts: Docker.ContainerCreateOptions & { name: string; Image: string; Env?: string[]; Labels?: Record<string, string>; HostConfig?: Docker.HostConfig }): Promise<Docker.Container> {
  const docker = await requireDocker();
  const container = await withTimeout("createContainer", docker.createContainer(opts)) as Docker.Container;
  return container;
}

async function dockerStartContainer(container: Docker.Container): Promise<void> {
  await withTimeout("startContainer", container.start());
}

async function dockerInspectContainer(container: Docker.Container): Promise<Docker.ContainerInspectInfo> {
  return withTimeout("inspectContainer", container.inspect()) as Promise<Docker.ContainerInspectInfo>;
}

async function dockerStopContainer(container: Docker.Container): Promise<void> {
  await withTimeout("stopContainer", container.stop({ t: 5 }));
}

async function dockerRemoveContainer(container: Docker.Container): Promise<void> {
  await withTimeout("removeContainer", container.remove({ v: true, force: true }));
}

async function dockerContainerLogs(container: Docker.Container, options?: Docker.ContainerLogsOptions): Promise<NodeJS.ReadableStream> {
  return withTimeout("containerLogs", container.logs({ stdout: true, stderr: true, follow: false, ...options })) as unknown as NodeJS.ReadableStream;
}

// --- Public types -----------------------------------------------------------

export interface ContainerSummary {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string; // running | exited | created | paused | restarting | dead
  status: string; // human string e.g. "Up 3 minutes"
  createdAt: number; // epoch ms
  runId: string | null;
  userId: string | null;
  pluginId: string | null;
  kind: string | null;
}

// --- Run lifecycle ----------------------------------------------------------

export interface StartPluginContainerInput {
  runId: string;
  userId: string;
  pluginId: string;
  configJson: string;
}

/** Create + start a container for a plugin run. Returns the new container id. */
export async function startPluginContainer(
  input: StartPluginContainerInput,
): Promise<string> {
  const name = `rexware_run_${input.runId}`.slice(0, 60);
  const network = await runnerNetwork();

  const env = [
    `RUN_ID=${input.runId}`,
    `USER_ID=${input.userId}`,
    `PLUGIN_ID=${input.pluginId}`,
    `BOT_CONFIG_JSON=${input.configJson}`,
    `RUNNER_CALLBACK_URL=${runnerCallbackUrl()}`,
    `RUNNER_LOGS_URL=${runnerLogsUrl()}`,
    `RUNNER_TOKEN=${runnerToken()}`,
  ];

  const hostConfig: Docker.HostConfig = {
    // Join the app's docker network so the container can POST status back to
    // the `web` service by name (http://web:3000) without public DNS.
    ...(network ? { NetworkMode: network } : {}),
    // Resource caps — a single run never needs much, and capping protects the
    // host from a runaway/abusive container.
    Memory: 256 * 1024 * 1024,
    MemorySwap: 256 * 1024 * 1024,
    NanoCpus: 5 * 10 ** 8, // 0.5 vCPU
    PidsLimit: 256,
    // Restart only on failure, bounded — the site is the source of truth.
    RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
    // Persisted no-fly-zone state shared across runs.
    Binds: [`${stateVolume()}:/app/state`],
    // Defence in depth.
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    LogConfig: {
      Type: "json-file",
      Config: { "max-size": "5m", "max-file": "3" },
    },
  };

  const container = await dockerCreateContainer({
    name,
    Image: botImage(),
    Env: env,
    Labels: {
      [LABELS.project]: PROJECT_NAME,
      [LABELS.kind]: "plugin-run",
      [LABELS.runId]: input.runId,
      [LABELS.userId]: input.userId,
      [LABELS.pluginId]: input.pluginId,
      [LABELS.createdAt]: String(Date.now()),
    },
    HostConfig: hostConfig,
  });

  await dockerStartContainer(container);
  return container.id;
}

// --- Bot run lifecycle ------------------------------------------------------

export interface StartBotContainerInput {
  runId: string;
  userId: string;
  botId: string;
  /** Full Rust `Config` JSON (see bot/src/config.rs) injected via env. */
  configJson: string;
}

/**
 * Create + start a container running the Minecraft beam bot for a single
 * deployed account. Same hardened settings as plugin runs; the config is
 * injected through `BOT_CONFIG_JSON`, which the bot writes to its config file
 * on boot (see bot/src/main.rs).
 */
export async function startBotContainer(
  input: StartBotContainerInput,
): Promise<string> {
  const name = `rexware_bot_${input.runId}`.slice(0, 60);
  const network = await runnerNetwork();

  const env = [
    `RUN_ID=${input.runId}`,
    `USER_ID=${input.userId}`,
    `BOT_ID=${input.botId}`,
    `BOT_CONFIG_JSON=${input.configJson}`,
    `RUNNER_CALLBACK_URL=${runnerCallbackUrl()}`,
    `RUNNER_TOKEN=${runnerToken()}`,
  ];

  const hostConfig: Docker.HostConfig = {
    ...(network ? { NetworkMode: network } : {}),
    Memory: 320 * 1024 * 1024,
    MemorySwap: 320 * 1024 * 1024,
    NanoCpus: 5 * 10 ** 8, // 0.5 vCPU
    PidsLimit: 256,
    RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
    Binds: [`${stateVolume()}:/app/state`],
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    LogConfig: {
      Type: "json-file",
      Config: { "max-size": "5m", "max-file": "3" },
    },
  };

  const container = await dockerCreateContainer({
    name,
    Image: mcBotImage(),
    Env: env,
    Labels: {
      [LABELS.project]: PROJECT_NAME,
      [LABELS.kind]: "bot-run",
      [LABELS.runId]: input.runId,
      [LABELS.userId]: input.userId,
      [LABELS.pluginId]: input.botId,
      [LABELS.createdAt]: String(Date.now()),
    },
    HostConfig: hostConfig,
  });

  await dockerStartContainer(container);
  return container.id;
}

/**
 * Open a live, following log stream for a container. The caller is responsible
 * for consuming + closing the stream (e.g. an SSE route). Returns the raw
 * Docker stream (8-byte framed when the container has no TTY — use
 * `stripDockerFrame` per chunk). Throws DockerUnavailableError when the engine
 * is unreachable. This is how the website shows a TRULY live console without
 * persisting any log line to the database.
 */
export async function streamContainerLogs(
  id: string,
  tail = 200,
): Promise<NodeJS.ReadableStream> {
  const c = await getContainerById(id);
  const stream = (await c.logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
    follow: true,
  })) as unknown as NodeJS.ReadableStream;
  return stream;
}

/**
 * Strip Docker's 8-byte stream multiplexing header from a single chunk of a
 * non-TTY log stream. Falls back to returning the chunk decoded as-is when it
 * isn't framed.
 */
export function stripDockerFrame(chunk: Buffer): string {
  if (!chunk || chunk.length === 0) return "";
  const out: string[] = [];
  let offset = 0;
  try {
    while (offset + 8 <= chunk.length) {
      const type = chunk[offset];
      if (type > 2) return chunk.toString("utf8");
      const len = chunk.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + len > chunk.length) {
        out.push(chunk.toString("utf8", offset));
        break;
      }
      out.push(chunk.toString("utf8", offset, offset + len));
      offset += len;
    }
    return out.join("");
  } catch {
    return chunk.toString("utf8");
  }
}

async function getContainerById(id: string): Promise<Docker.Container> {
  const docker = await requireDocker();
  return docker.getContainer(id);
}

/**
 * Live state of a container by id, used to reconcile crashed/vanished runs.
 * Returns:
 *   - "running"  — the container exists and is up
 *   - "stopped"  — the container exists but exited/dead/created/paused
 *   - "missing"  — no such container (removed, or never started)
 *   - "unknown"  — docker unreachable; caller should not destroy DB state
 */
export async function getContainerState(
  id: string,
): Promise<"running" | "stopped" | "missing" | "unknown"> {
  try {
    const c = await getContainerById(id);
    const info = await dockerInspectContainer(c);
    return info.State?.Running ? "running" : "stopped";
  } catch (err) {
    if (isNotFound(err)) return "missing";
    return "unknown";
  }
}

export async function stopContainer(id: string): Promise<void> {
  const c = await getContainerById(id);
  try {
    await dockerStopContainer(c);
  } catch (err) {
    // 304 = already stopped; ignore.
    if (!isNotModified(err)) throw err;
  }
}

export async function restartContainer(id: string): Promise<void> {
  const c = await getContainerById(id);
  await withTimeout("restartContainer", c.restart({ t: 10 }));
}

export async function startExistingContainer(id: string): Promise<void> {
  const c = await getContainerById(id);
  try {
    await dockerStartContainer(c);
  } catch (err) {
    if (!isNotModified(err)) throw err;
  }
}

export async function removeContainer(id: string, force = true): Promise<void> {
  const c = await getContainerById(id);
  await dockerRemoveContainer(c);
}

/** Stop (best-effort) then remove a run's container. */
export async function stopAndRemoveContainer(id: string): Promise<void> {
  try {
    await stopContainer(id);
  } catch {
    // fall through to remove
  }
  await removeContainer(id, true);
}

// --- Listing + logs ---------------------------------------------------------

export async function listProjectContainers(): Promise<ContainerSummary[]> {
  const docker = await requireDocker();
  const raw = (await withTimeout("listContainers", docker.listContainers({
    all: true,
    filters: { label: [`${LABELS.project}=${PROJECT_NAME}`] },
  }))) as Docker.ContainerInfo[];
  return raw
    .map(toSummary)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function toSummary(c: Docker.ContainerInfo): ContainerSummary {
  const labels = c.Labels ?? {};
  const name = (c.Names?.[0] ?? "").replace(/^\//, "");
  return {
    id: c.Id,
    shortId: c.Id.slice(0, 12),
    name,
    image: c.Image,
    state: c.State,
    status: c.Status,
    createdAt: (c.Created ?? 0) * 1000,
    runId: labels[LABELS.runId] ?? null,
    userId: labels[LABELS.userId] ?? null,
    pluginId: labels[LABELS.pluginId] ?? null,
    kind: labels[LABELS.kind] ?? null,
  };
}

/** Returns recent log output for a container as plain text (demuxed). */
export async function getContainerLogs(
  id: string,
  tail = 300,
): Promise<string> {
  const c = await getContainerById(id);
  const buf = (await dockerContainerLogs(c, {
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
    follow: false,
  })) as unknown as Buffer;
  return demuxDockerLogs(buf);
}

/**
 * Docker multiplexes stdout/stderr with an 8-byte header per frame when the
 * container has no TTY. Strip those headers to recover clean text. Falls back
 * to a raw decode when the stream isn't framed.
 */
function demuxDockerLogs(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) return "";
  const out: string[] = [];
  let offset = 0;
  try {
    while (offset + 8 <= buffer.length) {
      const type = buffer[offset];
      const len = buffer.readUInt32BE(offset + 4);
      // Valid stream types are 0,1,2. Anything else means it's not framed.
      if (type > 2) return buffer.toString("utf8");
      offset += 8;
      if (offset + len > buffer.length) break;
      out.push(buffer.toString("utf8", offset, offset + len));
      offset += len;
    }
    return out.join("");
  } catch {
    return buffer.toString("utf8");
  }
}

function isNotModified(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number })?.statusCode;
  return statusCode === 304;
}

function isNotFound(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number })?.statusCode;
  return statusCode === 404;
}

/** Engine version/info for the admin status banner. Never throws. */
export async function getDockerInfo(): Promise<{
  available: boolean;
  image: string;
  project: string;
  version?: string;
  containers?: number;
}> {
  const available = await isDockerAvailable(true);
  if (!available) {
    return { available: false, image: botImage(), project: PROJECT_NAME };
  }
  try {
    const info = (await getDocker().info()) as {
      ServerVersion?: string;
      Containers?: number;
    };
    return {
      available: true,
      image: botImage(),
      project: PROJECT_NAME,
      version: info.ServerVersion,
      containers: info.Containers,
    };
  } catch {
    return { available: true, image: botImage(), project: PROJECT_NAME };
  }
}
