import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Check, X, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/preferences";
import { createDialogId } from "@/routes/api/ai/generate-actions";

// ---------------------------------------------------------------------------
// CustomActionsDialog
// Multi-turn AI chat that generates a list of ordered bot actions (/commands).
// Uses the Gemini proxy at POST /api/ai/generate-actions.
// ---------------------------------------------------------------------------

interface CustomActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (actions: string[]) => void;
}

interface Turn {
  id: string;
  from: "user" | "ai";
  text: string;
  actions?: string[];
  isDone?: boolean;
}

export function CustomActionsDialog({
  open,
  onOpenChange,
  onApply,
}: CustomActionsDialogProps) {
  const t = useT();
  const [dialogId] = useState(() => createDialogId());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sending = loading;

  useEffect(() => {
    if (!open) {
      // Reset on close so reopening starts fresh.
      setTurns([]);
      setInput("");
      setError(null);
      setReviewOpen(false);
      setPendingActions([]);
    } else {
      // First AI greeting.
      setTimeout(() => {
        setTurns([
          {
            id: crypto.randomUUID(),
            from: "ai",
            text: t("bots.ra.custom.nextHint"),
          },
        ]);
        inputRef.current?.focus();
      }, 100);
    }
  }, [open, t]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);

    const userTurn: Turn = { id: crypto.randomUUID(), from: "user", text };
    setTurns((prev) => [...prev, userTurn]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/generate-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialogId, userMessage: text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const data: {
        reply: string;
        actions: string[];
        isDone: boolean;
      } = await res.json();

      const aiTurn: Turn = {
        id: crypto.randomUUID(),
        from: "ai",
        text: data.reply,
        actions: data.actions.length > 0 ? data.actions : undefined,
        isDone: data.isDone,
      };

      setTurns((prev) => [...prev, aiTurn]);

      if (data.isDone) {
        setPendingActions(data.actions);
        setReviewOpen(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleApply = () => {
    onApply(pendingActions);
    onOpenChange(false);
  };

  const handleFix = () => {
    setReviewOpen(false);
    setTurns((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        from: "ai",
        text: t("bots.ra.custom.errorAsk"),
      },
    ]);
    inputRef.current?.focus();
  };

  const handleRevert = () => {
    // Let user correct via the normal chat.
    setReviewOpen(false);
    setPendingActions([]);
    setTurns((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        from: "ai",
        text: t("bots.ra.custom.errorAsk"),
      },
    ]);
    inputRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="space-y-1 border-b border-border/50 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("bots.ra.custom.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("bots.ra.custom.description")}
          </DialogDescription>
        </DialogHeader>

        {/* Chat transcript */}
        <div ref={scrollRef} className="h-72 space-y-3 overflow-y-auto px-5 py-4">
          {turns.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">
              {t("bots.ra.custom.nextHint")}
            </p>
          )}

          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`flex gap-2.5 ${turn.from === "user" ? "flex-row-reverse" : ""}`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                  turn.from === "ai"
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {turn.from === "ai" ? (
                  <Sparkles className="h-3.5 w-3.5" />
                ) : (
                  <User className="h-3.5 w-3.5" />
                )}
              </span>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  turn.from === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/70"
                }`}
              >
                {turn.text}
                {turn.actions && turn.actions.length > 0 && (
                  <ul className="mt-2 space-y-1 font-mono text-[11px]">
                    {turn.actions.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-md bg-background/50 px-2 py-1"
                      >
                        <span className="grid h-5 w-5 place-items-center rounded-sm bg-border/60 text-[10px] text-muted-foreground">
                          {i + 1}
                        </span>
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
              <span className="flex items-center rounded-2xl bg-muted/70 px-3.5 py-2.5 text-xs text-muted-foreground">
                {t("bots.ra.custom.thinking")}
              </span>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Review overlay (shown when AI has a draft) */}
        {reviewOpen && (
          <div className="border-t border-border/50 bg-primary/5 px-5 py-3">
            <p className="mb-2 text-xs font-medium">{t("bots.ra.custom.confirmTitle")}</p>
            <div className="flex flex-wrap gap-1.5">
              {pendingActions.map((a, i) => (
                <code
                  key={i}
                  className="rounded-md border border-border/50 bg-background px-2 py-1 font-mono text-[11px]"
                >
                  {i + 1}. {a}
                </code>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={handleApply}
                className="h-7 gap-1.5 text-[11px]"
              >
                <Check className="h-3 w-3" />
                {t("bots.ra.custom.confirmOk")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleFix}
                className="h-7 gap-1.5 text-[11px]"
              >
                <X className="h-3 w-3" />
                {t("bots.ra.custom.confirmWrong")}
              </Button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex items-end gap-2 border-t border-border/50 px-5 py-3">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              reviewOpen
                ? t("bots.ra.custom.errorAsk")
                : t("bots.ra.custom.nextHint")
            }
            disabled={sending}
            className="min-h-[36px] max-h-24 resize-none text-xs"
          />
          <Button
            size="sm"
            onClick={send}
            disabled={!input.trim() || sending}
            className="h-8 shrink-0 gap-1.5 text-xs"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t("bots.ra.custom.thinking")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
