import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/lib/preferences";

interface AuthErrorDialogProps {
  /** The raw auth_error code from the URL (e.g. "oauth_failed"). */
  error: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional retry handler (e.g. re-open the login dialog). */
  onRetry?: () => void;
}

const KNOWN_CODES = [
  "oauth_failed",
  "invalid_state",
  "missing_code",
  "access_denied",
  "discord_invalid_client",
  "discord_forbidden",
  "discord_bad_request",
  "discord_token_failed",
  "discord_user_failed",
];

export function AuthErrorDialog({ error, open, onOpenChange, onRetry }: AuthErrorDialogProps) {
  const t = useT();
  const code = error && KNOWN_CODES.includes(error) ? error : "fallback";
  const copy = {
    title: t(`authErr.${code}.title`),
    message: t(`authErr.${code}.message`),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-sm text-center">
        <DialogHeader className="items-center">
          <div className="mb-3 mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-900/40 bg-amber-950/30">
            <AlertTriangle className="h-7 w-7 text-amber-400" />
          </div>
          <DialogTitle className="text-xl tracking-tight">{copy.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground/80 leading-relaxed">
            {copy.message}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-col gap-2">
          {onRetry && (
            <Button
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                onRetry();
              }}
            >
              {t("authErr.retry")}
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
