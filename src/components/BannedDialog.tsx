import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { useT } from "@/lib/preferences";

interface BannedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BannedDialog({ open, onOpenChange }: BannedDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-sm text-center">
        <DialogHeader className="items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-red-900/40 bg-red-950/30 mx-auto">
            <Ban className="h-7 w-7 text-red-400" />
          </div>
          <DialogTitle className="text-xl tracking-tight">{t("banned.title")}</DialogTitle>
          <DialogDescription className="text-muted-foreground/80 leading-relaxed">
            {t("banned.body")}
          </DialogDescription>
        </DialogHeader>
        <Button
          variant="outline"
          className="mt-2 w-full"
          onClick={() => onOpenChange(false)}
        >
          {t("common.close")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
