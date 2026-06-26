import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Play,
  Square,
  RotateCw,
  Trash2,
  ScrollText,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ServerOff,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  adminGetDockerStatus,
  adminGetContainerLogs,
  adminStartContainer,
  adminStopContainer,
  adminRestartContainer,
  adminRemoveContainer,
  type AdminContainerRow,
} from "@/lib/api/docker.functions";

type DockerStatus = Awaited<ReturnType<typeof adminGetDockerStatus>>;

function stateBadge(state: string) {
  const s = state.toLowerCase();
  if (s === "running")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
        running
      </Badge>
    );
  if (s === "restarting" || s === "created")
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
        {s}
      </Badge>
    );
  if (s === "paused")
    return (
      <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/15">
        paused
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      {s || "exited"}
    </Badge>
  );
}

function fmtDate(ms: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function DockerTab() {
  const [data, setData] = useState<DockerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Logs dialog
  const [logsFor, setLogsFor] = useState<AdminContainerRow | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminGetDockerStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh while the tab is open.
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function act(
    id: string,
    fn: (args: { data: { id: string } }) => Promise<unknown>,
  ) {
    setBusy((m) => ({ ...m, [id]: true }));
    try {
      await fn({ data: { id } });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy((m) => ({ ...m, [id]: false }));
    }
  }

  async function openLogs(row: AdminContainerRow) {
    setLogsFor(row);
    setLogs("");
    setLogsLoading(true);
    try {
      const res = await adminGetContainerLogs({ data: { id: row.id, tail: 500 } });
      setLogs(res.logs || "(no output yet)");
    } catch (err) {
      setLogs(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }

  const info = data?.info;
  const containers = data?.containers ?? [];
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-semibold">
              Docker Orchestration
              {info?.available ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> engine online
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400">
                  <ServerOff className="h-3.5 w-3.5" /> engine offline
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              project <span className="font-mono">{info?.project}</span>
              {info?.version ? ` · engine v${info.version}` : ""} · image{" "}
              <span className="font-mono">{info?.image}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {counts && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                Total <span className="font-semibold text-foreground">{counts.total}</span>
              </span>
              <span className="text-muted-foreground">
                Running <span className="font-semibold text-emerald-400">{counts.running}</span>
              </span>
              <span className="text-muted-foreground">
                Stopped <span className="font-semibold text-foreground">{counts.stopped}</span>
              </span>
            </div>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Engine offline notice */}
      {info && !info.available && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium text-amber-300">No Docker engine reachable from the web server.</p>
            <p className="text-muted-foreground">
              Bot runs are still recorded and will appear here automatically once the server can
              reach a Docker socket. Mount <span className="font-mono">/var/run/docker.sock</span> into
              the web container (see <span className="font-mono">docker-compose.yml</span>) and build the
              bot image with <span className="font-mono">docker build -t {info.image} docker/bot</span>.
            </p>
          </div>
        </div>
      )}

      {/* Containers table */}
      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Container</TableHead>
              <TableHead>Plugin</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {containers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {info?.available
                    ? "No project containers yet. Launch a plugin from the dashboard to create one."
                    : "Containers will be listed here when the Docker engine is connected."}
                </TableCell>
              </TableRow>
            )}
            {containers.map((c) => {
              const isRunning = c.state.toLowerCase() === "running";
              const b = busy[c.id];
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.name || c.shortId}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c.shortId}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{c.pluginId ?? "—"}</span>
                  </TableCell>
                  <TableCell>
                    {c.userId ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={c.avatarUrl ?? undefined} crossOrigin="anonymous" />
                          <AvatarFallback className="text-[10px]">
                            {(c.username ?? c.userId).slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="leading-tight">
                          <div className="text-sm">{c.globalName ?? c.username ?? "Unknown"}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{c.userId}</div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">system</span>
                    )}
                  </TableCell>
                  <TableCell>{stateBadge(c.state)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Logs"
                        onClick={() => openLogs(c)}
                      >
                        <ScrollText className="h-4 w-4" />
                      </Button>
                      {isRunning ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-amber-400 hover:text-amber-300"
                          title="Stop"
                          disabled={b}
                          onClick={() => act(c.id, adminStopContainer)}
                        >
                          {b ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                          title="Start"
                          disabled={b}
                          onClick={() => act(c.id, adminStartContainer)}
                        >
                          {b ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Restart"
                        disabled={b}
                        onClick={() => act(c.id, adminRestartContainer)}
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Remove"
                        disabled={b}
                        onClick={() => {
                          if (confirm(`Remove container ${c.name || c.shortId}? This cannot be undone.`)) {
                            act(c.id, adminRemoveContainer);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Logs dialog */}
      <Dialog open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScrollText className="h-4 w-4" />
              Logs · <span className="font-mono text-sm">{logsFor?.name || logsFor?.shortId}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Last 500 lines</span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={logsLoading}
              onClick={() => logsFor && openLogs(logsFor)}
            >
              {logsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
          <pre className="max-h-[55vh] overflow-auto rounded-lg border border-border/60 bg-background/80 p-3 text-xs leading-relaxed">
            {logsLoading ? "Loading…" : logs}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
