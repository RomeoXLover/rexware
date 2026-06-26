// src/components/TosDialog.tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { ScrollText, ShieldCheck, Check, AlertTriangle } from "lucide-react";

const TOS_STORAGE_KEY = "ante-tos-accepted";

/**
 * @param gate When true the hook enforces acceptance (blocks until accepted) —
 * used inside the dashboard. When false it only exposes a read-only viewer,
 * e.g. the "Terms" link in the landing footer.
 */
export function useTosDialog({ gate = false }: { gate?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [showBlockedPopup, setShowBlockedPopup] = useState(false);
  const [isBlocked, setIsBlocked] = useState(gate); // gate-only: blocked in SSR
  const [mounted, setMounted] = useState(false);

  // Client-only: read persisted acceptance after mount.
  useEffect(() => {
    setMounted(true);
    const accepted = localStorage.getItem(TOS_STORAGE_KEY);
    if (accepted === "true") {
      setIsBlocked(false);
    } else if (gate) {
      setOpen(true);
      setIsBlocked(true);
    }
  }, [gate]);

  const accept = () => {
    localStorage.setItem(TOS_STORAGE_KEY, "true");
    setOpen(false);
    setShowBlockedPopup(false);
    setIsBlocked(false);
  };

  const decline = () => {
    setOpen(false);
    // Only the gated flow hard-blocks; the read-only viewer just closes.
    if (gate) setShowBlockedPopup(true);
  };

  const openDialog = () => setOpen(true);

  const closeBlockedPopup = () => {
    setShowBlockedPopup(false);
    setOpen(true);
  };

  const leaveSite = () => {
    window.location.href = "https://www.google.com";
  };

  return {
    open: mounted ? open : false,
    accept,
    decline,
    openDialog,
    setOpen,
    isBlocked: mounted ? isBlocked : gate,
    showBlockedPopup: mounted ? showBlockedPopup : false,
    closeBlockedPopup,
    leaveSite,
    mounted,
  };
}

export function TosDialog({
  open,
  onAccept,
  onDecline,
  onOpenChange,
  /** When true the user must tick the confirmation box before accepting. */
  gate = false,
}: {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onOpenChange: (open: boolean) => void;
  gate?: boolean;
}) {
  const [agreed, setAgreed] = useState(false);

  // Reset the checkbox each time the dialog opens.
  useEffect(() => {
    if (open) setAgreed(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl overflow-hidden border-border/60 bg-card/95 p-0 backdrop-blur-xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Accent header */}
        <div className="relative overflow-hidden border-b border-border/60 px-6 pb-6 pt-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
            style={{ background: "var(--gradient-hero)" }}
          />
          <DialogHeader className="relative space-y-0">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur-sm">
                <ScrollText className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <DialogTitle className="text-2xl font-semibold tracking-tight">
                  Terms of Service
                </DialogTitle>
                <DialogDescription className="text-muted-foreground/80">
                  Please read carefully before using RexWare.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <div className="max-h-[52vh] space-y-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-muted-foreground [scrollbar-width:thin]">
          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs font-medium text-foreground/70">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Last updated: June 9, 2026
          </div>

          <Section title="1. Acceptance of Terms">
            <p>By accessing or using RexWare Services, you agree to be bound by these Terms. If you disagree, you may not access the Service.</p>
            <p>RexWare may update these Terms at any time. Continued use constitutes acceptance.</p>
          </Section>

          <Section title="2. Eligibility">
            <p>You must be at least 18 years old to use our tool as you cant manage cryptos if you are not.</p>
          </Section>

          <Section title="3. Service Description">
            <p>RexWare provides a platform to deploy and manage automated Minecraft bots. RexWare assumes no responsibility for any illegal activities committed in connection with the service.</p>
          </Section>

          <Section title="4. User Accounts">
            <p>Access is via Discord OAuth. You are responsible for your Discord account security and all activities under your account.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Provide accurate information.</li>
              <li>Notify us of security breaches.</li>
              <li>Do not share credentials.</li>
            </ul>
          </Section>

          <Section title="5. Payments & Subscriptions">
            <p>Fees are non-refundable. Subscriptions are monthly; you can cancel anytime from your dashboard.</p>
          </Section>

          <Section title="6. Acceptable Use">
            <p>You agree NOT to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Reverse engineer or bypass security.</li>
              <li>Resell access without permission.</li>
              <li>Distribute malware or harmful content.</li>
            </ul>
          </Section>

          <Section title="7. Termination">
            <p>We may suspend or terminate your account for any breach. Upon termination, your right to use the Service ends immediately.</p>
          </Section>

          <Section title="8. Disclaimer of Warranties">
            <p>The Service is provided "AS IS" without warranties. RexWare does not guarantee uninterrupted or error-free operation. You assume all risks of account bans.</p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>To the maximum extent permitted by law, RexWare shall not be liable for indirect, incidental, or consequential damages. Total liability does not exceed amounts paid by you in the last 12 months.</p>
          </Section>
        </div>

        {/* Sticky footer */}
        <div className="space-y-4 border-t border-border/60 bg-card/80 px-6 py-5">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
            <button
              type="button"
              role="checkbox"
              aria-checked={agreed}
              onClick={() => setAgreed((v) => !v)}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                agreed
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background"
              }`}
            >
              {agreed && <Check className="h-3.5 w-3.5" />}
            </button>
            <span onClick={() => setAgreed((v) => !v)}>
              I have read, understood, and agree to be bound by these Terms.
            </span>
          </label>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onDecline} className="rounded-full">
              Decline
            </Button>
            <Button
              onClick={onAccept}
              disabled={gate && !agreed}
              className="rounded-full px-6"
            >
              Accept
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BlockedPopup({
  open,
  onAccept,
  onLeave,
}: {
  open: boolean;
  onAccept: () => void;
  onLeave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="relative border-b border-border/60 px-6 pb-5 pt-6">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-50"
            style={{ background: "var(--gradient-hero)" }}
          />
          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 backdrop-blur-sm">
              <AlertTriangle className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              Terms Required
            </h2>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-muted-foreground">
            You must accept the Terms of Service to use RexWare. Without
            acceptance, you cannot access the dashboard.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="outline" onClick={onLeave} className="rounded-full">
              Leave Site
            </Button>
            <Button onClick={onAccept} className="rounded-full px-6">
              Review Terms
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-foreground/90">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
