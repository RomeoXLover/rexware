import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Globe, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listGlobalPresets,
  createGlobalPreset,
  deleteGlobalPreset,
  type PublicPreset,
} from "@/lib/api/presets.functions";

// Admin management of GLOBAL reply-action presets. These are visible to every
// user in the bot reply-actions editor. Each preset is an ordered list of
// command templates supporting {user} and {reply} placeholders.
export function PresetsTab() {
  const [presets, setPresets] = useState<PublicPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [actions, setActions] = useState<string[]>([""]);
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("25565");
  const [mcVersion, setMcVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    listGlobalPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => setPresets([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const cleaned = actions.map((a) => a.trim()).filter(Boolean);

  const handleCreate = async () => {
    if (!name.trim() || cleaned.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const host = serverHost.trim();
      await createGlobalPreset({
        data: {
          name: name.trim(),
          actions: cleaned,
          ...(host
            ? {
                serverHost: host,
                serverPort: Number(serverPort) || 25565,
                ...(mcVersion.trim() ? { mcVersion: mcVersion.trim() } : {}),
              }
            : {}),
        },
      });
      setName("");
      setActions([""]);
      setServerHost("");
      setServerPort("25565");
      setMcVersion("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create preset.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGlobalPreset({ data: { id } });
      load();
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Create */}
      <section className="space-y-4 rounded-3xl border border-border/60 bg-card/50 p-6">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-border/50 bg-muted/40">
            <Globe className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">New global preset</h3>
            <p className="text-xs text-muted-foreground/70">
              Available to every user. Use {"{user}"} and {"{reply}"}.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Preset name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Party recruiter"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Actions</Label>
          {actions.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border/50 bg-background/60 font-mono text-[11px] text-muted-foreground">
                {i + 1}
              </span>
              <Input
                value={a}
                onChange={(e) =>
                  setActions(actions.map((x, idx) => (idx === i ? e.target.value : x)))
                }
                placeholder="/party invite {user}"
                className="font-mono text-xs"
              />
              <button
                type="button"
                onClick={() =>
                  setActions(
                    actions.length === 1
                      ? [""]
                      : actions.filter((_, idx) => idx !== i),
                  )
                }
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                aria-label={`Remove action ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActions([...actions, ""])}
            className="h-8 gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add action
          </Button>
        </div>

        <div className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
          <Label className="text-xs text-muted-foreground">
            Server (optional — preset will also set the bot&apos;s server)
          </Label>
          <Input
            value={serverHost}
            onChange={(e) => setServerHost(e.target.value)}
            placeholder="play.example.net"
            className="font-mono text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={serverPort}
              inputMode="numeric"
              onChange={(e) => setServerPort(e.target.value)}
              placeholder="25565"
              className="font-mono text-xs"
              aria-label="Server port"
            />
            <Input
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
              placeholder="1.21.1"
              className="font-mono text-xs"
              aria-label="Minecraft version"
            />
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          onClick={handleCreate}
          disabled={!name.trim() || cleaned.length === 0 || saving}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Create global preset"}
        </Button>
      </section>

      {/* List */}
      <section className="space-y-4 rounded-3xl border border-border/60 bg-card/50 p-6">
        <h3 className="text-sm font-semibold">Existing global presets</h3>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : presets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-sm text-muted-foreground/70">
            No global presets yet.
          </p>
        ) : (
          <div className="space-y-3">
            {presets.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-border/50 bg-background/40 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id)}
                    className="grid h-7 w-7 place-items-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {p.serverHost && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                    {p.serverHost}:{p.serverPort ?? 25565}
                    {p.mcVersion ? ` · ${p.mcVersion}` : ""}
                  </p>
                )}
                <ul className="mt-2 space-y-1">
                  {p.actions.map((a, i) => (
                    <li
                      key={i}
                      className="font-mono text-[11px] text-muted-foreground"
                    >
                      {i + 1}. {a}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
