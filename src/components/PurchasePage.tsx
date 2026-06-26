import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Check,
  Bitcoin,
  Copy,
  QrCode,
  Loader2,
  ArrowLeft,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Zap,
  Bot,
  Timer,
  Globe,
  Sparkles,
  CreditCard,
  Plus,
  Minus,
} from "lucide-react";
import { SiLitecoin } from "react-icons/si";
import type { PlanRow, SubscriptionRow, PaymentRow } from "@/lib/repos.server";
import {
  initPayment,
  getMyPendingPayment,
  getPaymentStatus,
  cancelMyPayment,
  redeemFreeTrial,
  getMyTrialStatus,
  getMySlotInfo,
  initSlotPayment,
  SLOT_PRICE_USD,
} from "@/lib/api/dashboard.functions";
import { BotHoursPurchaseSection } from "@/components/BotHoursPurchaseSection";
import { CryptoInvoiceFlow } from "@/components/CryptoInvoiceFlow";
import { usePreferences } from "@/lib/preferences";
import {
  translatePlanDescription,
  translatePlanFeature,
} from "@/lib/i18n/plan-text";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

function botHoursLabel(h: number, t: TFunc): string {
  if (h === -1) return t("pay.unlimited");
  return t("pay.hoursPerDay", { h });
}

function maxBotsLabel(n: number, t: TFunc): string {
  if (n === -1) return t("pay.unlimited");
  return String(n);
}

function maxProxiesLabel(n: number, t: TFunc): string {
  if (n === -1) return t("pay.unlimited");
  return String(n);
}

// ---------------------------------------------------------------------------
// Free Trial Banner Card (full-width, shown above the plan grid)
// ---------------------------------------------------------------------------

function FreeTrialBanner({
  plan,
  isCurrentPlan,
  onRedeem,
  trialStatus,
  loading,
}: {
  plan: PlanRow;
  isCurrentPlan: boolean;
  onRedeem: () => void;
  trialStatus: { redeemedByAccount: boolean; redeemedByIp: boolean } | null;
  loading: boolean;
}) {
  const { t, language } = usePreferences();
  const features: string[] = JSON.parse(plan.features);
  const alreadyUsed = trialStatus
    ? trialStatus.redeemedByAccount || trialStatus.redeemedByIp
    : false;

  return (
    <div className="ac-sheen relative overflow-hidden rounded-3xl border border-foreground/20 bg-gradient-to-r from-card/80 via-card/60 to-card/80 p-6">
      {/* drifting grid texture */}
      <div
        aria-hidden
        className="ac-grid-card ac-grid-card-lg ac-grid-pan pointer-events-none absolute inset-0 -z-10 opacity-80"
      />
      {/* Subtle shimmer line on top */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent" />

      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        {/* Left — badge + title + desc */}
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 border-foreground/25 text-foreground/80 text-[11px] py-0.5"
            >
              <Sparkles className="h-3 w-3" />
              {t("pay.freeTrial")}
            </Badge>
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
              {t("pay.trialMeta")}
            </span>
          </div>
          <h3 className="text-xl font-semibold tracking-tight">{plan.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-md">
            {translatePlanDescription(plan.description, language)}
          </p>

          {/* Feature pills */}
          <div className="mt-3 flex flex-wrap gap-2">
            {features.slice(0, 5).map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-xs text-muted-foreground"
              >
                <Check className="h-3 w-3 shrink-0 text-green-400" />
                {translatePlanFeature(f, language)}
              </span>
            ))}
          </div>

          {/* Restrictions note */}
          <p className="mt-3 text-[11px] text-muted-foreground/50">
            {t("pay.trialRestrictions")}
          </p>
        </div>

        {/* Right — price + CTA */}
        <div className="shrink-0 flex flex-col items-start md:items-end gap-3">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold tracking-tight">
              {t("pay.free")}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("pay.per24h")}
            </span>
          </div>

          {isCurrentPlan ? (
            <Button variant="outline" disabled className="gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              {t("pay.trialActive")}
            </Button>
          ) : alreadyUsed ? (
            <Button variant="outline" disabled className="gap-2 opacity-60">
              <XCircle className="h-4 w-4" />
              {t("pay.alreadyRedeemed")}
            </Button>
          ) : (
            <Button
              className="gap-2 min-w-[140px]"
              onClick={onRedeem}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {loading ? t("pay.activating") : t("pay.startTrial")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan Card
// ---------------------------------------------------------------------------

function PlanCard({
  plan,
  isCurrentPlan,
  onSelect,
  index = 0,
}: {
  plan: PlanRow;
  isCurrentPlan: boolean;
  onSelect: (plan: PlanRow) => void;
  index?: number;
}) {
  const { formatPrice, t, language } = usePreferences();
  const features: string[] = JSON.parse(plan.features);
  const isPro = plan.id === "pro";
  const isEnterprise = plan.id === "enterprise";

  return (
    <div
      className={[
        "relative transition-transform duration-300 will-change-transform",
        isPro
          ? "z-10 md:-translate-y-2 md:hover:-translate-y-3"
          : "hover:-translate-y-1",
      ].join(" ")}
      style={{
        animation: `acRise 0.6s cubic-bezier(0.22,1,0.36,1) ${index * 90 + 60}ms both`,
      }}
    >
      {/* Most Popular badge lives on the wrapper so the clipped card can't cut it off */}
      {isPro && (
        <div className="absolute -top-3 left-1/2 z-20 -translate-x-1/2">
          <Badge className="gap-1 px-2.5 py-0.5 text-[11px] font-semibold shadow-[0_4px_16px_oklch(0_0_0/0.5)]">
            <Zap className="h-3 w-3" />
            {t("pay.mostPopular")}
          </Badge>
        </div>
      )}

      <div
        className={[
          "ac-sheen relative flex h-full flex-col overflow-hidden rounded-3xl border p-6",
          isPro
            ? "border-foreground/30 bg-card shadow-[0_0_0_1px_oklch(1_0_0/0.06),0_16px_48px_oklch(0_0_0/0.5)] hover:border-foreground/50"
            : "border-border/60 bg-card/60 hover:border-border/90 hover:bg-card hover:shadow-[0_12px_36px_oklch(0_0_0/0.45)]",
        ].join(" ")}
      >
        {/* faint grid texture */}
        <div
          aria-hidden
          className={[
            "ac-grid-card ac-grid-card-lg pointer-events-none absolute inset-0 -z-10",
            isPro ? "opacity-90" : "opacity-50",
          ].join(" ")}
        />
        {/* Top gradient for Pro */}
        {isPro && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, oklch(1 0 0 / 0.45), transparent)",
            }}
          />
        )}

        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              {plan.name}
            </span>
            {isEnterprise && (
              <span className="rounded-full border border-foreground/15 bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("pay.bestValue")}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {translatePlanDescription(plan.description, language)}
          </p>
        </div>

        {/* Price */}
        <div className="mb-5">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold tracking-tight">
              {formatPrice(plan.price_usd, { decimals: 0 })}
            </span>
            <span className="text-sm text-muted-foreground">
              /{plan.interval}
            </span>
          </div>
        </div>

        {/* Key metrics row */}
        <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl border border-border/50 bg-muted/20 p-3">
          <div className="flex flex-col items-center gap-0.5 text-center">
            <Bot className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="text-sm font-semibold tabular-nums">
              {maxBotsLabel(plan.max_bots, t)}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {t("pay.bots")}
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 border-x border-border/40 text-center">
            <Timer className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="text-sm font-semibold tabular-nums">
              {botHoursLabel(plan.bot_hours, t)}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {t("pay.botHours")}
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 text-center">
            <Globe className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="text-sm font-semibold tabular-nums">
              {maxProxiesLabel(plan.max_proxies, t)}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {t("pay.proxies")}
            </span>
          </div>
        </div>

        {/* Features */}
        <ul className="mb-6 flex-1 space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-400" />
              <span className="text-foreground/80">
                {translatePlanFeature(f, language)}
              </span>
            </li>
          ))}
        </ul>

        <Button
          className="w-full"
          variant={isPro ? "default" : "outline"}
          disabled={isCurrentPlan}
          onClick={() => onSelect(plan)}
        >
          {isCurrentPlan ? t("pay.currentPlan") : t("pay.getStarted")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

type ComparisonKey = "max_bots" | "bot_hours" | "max_proxies";

type ComparisonRow =
  | { label: string; key: ComparisonKey }
  | { label: string; values: Record<string, string | boolean> };

function getComparisonFeatures(t: TFunc): ComparisonRow[] {
  return [
    { label: t("pay.cmp.concurrentBots"), key: "max_bots" },
    { label: t("pay.cmp.botHoursDay"), key: "bot_hours" },
    { label: t("pay.cmp.proxies"), key: "max_proxies" },
    {
      label: t("pay.cmp.beamingSpeed"),
      values: {
        starter: t("pay.cmp.standard"),
        pro: t("pay.cmp.fast"),
        enterprise: t("pay.cmp.maximum"),
      },
    },
    {
      label: t("pay.cmp.liveConsole"),
      values: { starter: true, pro: true, enterprise: true },
    },
    {
      label: t("pay.cmp.advancedAnalytics"),
      values: { starter: false, pro: true, enterprise: true },
    },
    {
      label: t("pay.cmp.customBehaviors"),
      values: { starter: false, pro: false, enterprise: true },
    },
    {
      label: t("pay.cmp.apiAccess"),
      values: { starter: false, pro: false, enterprise: true },
    },
    {
      label: t("pay.cmp.earlyAccess"),
      values: { starter: false, pro: false, enterprise: true },
    },
    {
      label: t("pay.cmp.support"),
      values: {
        starter: t("pay.cmp.community"),
        pro: t("pay.cmp.priority"),
        enterprise: t("pay.cmp.dedicated"),
      },
    },
  ];
}

function planCellValue(plan: PlanRow, key: ComparisonKey): string {
  const v = plan[key] as number;
  if (v === -1) return "∞";
  return String(v);
}

function ComparisonTable({ plans }: { plans: PlanRow[] }) {
  const { t } = usePreferences();
  const comparisonFeatures = getComparisonFeatures(t);
  // Only show the 3 purchasable plans (not free_trial, not admin)
  const visible = plans.filter((p) => !p.is_trial && !p.is_hidden);

  return (
    <div className="mt-10 overflow-x-auto rounded-2xl border border-border/60">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/20">
            <th className="px-5 py-4 text-left font-medium text-muted-foreground/70">
              {t("pay.cmp.feature")}
            </th>
            {visible.map((p) => (
              <th
                key={p.id}
                className={[
                  "px-5 py-4 text-center font-semibold",
                  p.id === "pro" ? "text-foreground" : "text-foreground/80",
                ].join(" ")}
              >
                {p.id === "pro" ? (
                  <span className="inline-flex items-center gap-1.5">
                    {p.name}
                    <Zap className="h-3.5 w-3.5 text-primary" />
                  </span>
                ) : (
                  p.name
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {comparisonFeatures.map((row) => (
            <tr
              key={row.label}
              className="hover:bg-muted/10 transition-colors duration-150"
            >
              <td className="px-5 py-3 text-muted-foreground/70">
                {row.label}
              </td>
              {visible.map((p) => {
                let cell: React.ReactNode;
                if ("key" in row) {
                  cell = (
                    <span className="font-medium tabular-nums">
                      {planCellValue(p, row.key)}
                    </span>
                  );
                } else {
                  const val = row.values[p.id];
                  if (typeof val === "boolean") {
                    cell = val ? (
                      <Check className="mx-auto h-4 w-4 text-green-400" />
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    );
                  } else {
                    cell = <span className="font-medium">{val}</span>;
                  }
                }
                return (
                  <td key={p.id} className="px-5 py-3 text-center">
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment modal — Step 1: choose coin. Step 2: payment details + QR.
// ---------------------------------------------------------------------------

type PaymentInfo = {
  paymentId: string;
  address: string;
  amountCrypto: string;
  coin: "ltc" | "btc";
  amountUsd: number;
  planName: string;
  // Account credit (e.g. referral rewards) spent on this invoice.
  creditApplied?: number;
  // True when credit fully covered the price and the invoice is already paid.
  fullyCovered?: boolean;
};

function PaymentModal({
  plan,
  onClose,
  initialPayment,
  pendingStatus,
}: {
  plan: PlanRow;
  onClose: () => void;
  initialPayment?: PaymentInfo | null;
  pendingStatus?: "waiting" | "confirming" | null;
}) {
  const { formatPrice, t } = usePreferences();
  const [step, setStep] = useState<1 | 2>(initialPayment ? 2 : 1);
  const [coin, setCoin] = useState<"ltc" | "btc" | null>(
    initialPayment ? (initialPayment.coin as "ltc" | "btc") : null,
  );
  const [loading, setLoading] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(
    initialPayment ?? null,
  );
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<"addr" | "amt" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState<"waiting" | "confirming" | "paid" | null>(
    pendingStatus ?? null,
  );
  const paidFired = useRef(false);

  // Poll for payment confirmation so the UI reflects the new plan/subscription immediately.
  useEffect(() => {
    if (!paymentInfo || status === "paid") return;
    const id = setInterval(async () => {
      try {
        const p = await getPaymentStatus({ data: { paymentId: paymentInfo.paymentId } });
        setStatus(p.status as "waiting" | "confirming" | "paid");
        if (p.status === "paid" && !paidFired.current) {
          paidFired.current = true;
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch {
        // transient — keep polling
      }
    }, 5000);
    return () => clearInterval(id);
  }, [paymentInfo, status]);

  async function handleCoinSelect(c: "ltc" | "btc") {
    setCoin(c);
    setLoading(true);
    setError(null);
    try {
      const info = (await initPayment({
        data: { planId: plan.id, coin: c },
      })) as PaymentInfo;
      setPaymentInfo(info);
      if (info.fullyCovered) {
        onClose();
        if (typeof window !== "undefined") window.location.reload();
        return;
      }
      setStep(2);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("pay.errCreate");
      setError(
        msg.startsWith("PENDING_INVOICE:") ? t("pay.pendingInvoice") : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelModal() {
    if (!paymentInfo) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelMyPayment({ data: { paymentId: paymentInfo.paymentId } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pay.errCancel"));
    } finally {
      setCancelling(false);
    }
  }

  async function copyToClipboard(text: string, which: "addr" | "amt") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  const qrUrl = paymentInfo
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentInfo.address)}&bgcolor=18181b&color=fafafa&format=png`
    : null;

  return (
    <div className="space-y-6">
      {step === 1 && (
        <>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t("pay.purchasing")}{" "}
              <span className="font-semibold text-foreground">{plan.name}</span>{" "}
              — {formatPrice(plan.price_usd, { decimals: 0 })}/{plan.interval}
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-6 py-6 transition-all hover:border-foreground/30 hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => handleCoinSelect("btc")}
              disabled={loading}
            >
              <Bitcoin className="h-8 w-8 text-orange-400" />
              <div className="text-center">
                <p className="font-semibold">Bitcoin</p>
                <p className="text-xs text-muted-foreground">BTC</p>
              </div>
            </button>

            <button
              type="button"
              className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-6 py-6 transition-all hover:border-foreground/30 hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => handleCoinSelect("ltc")}
              disabled={loading}
            >
              <SiLitecoin className="h-8 w-8 text-gray-300" />
              <div className="text-center">
                <p className="font-semibold">Litecoin</p>
                <p className="text-xs text-muted-foreground">LTC</p>
              </div>
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("pay.generatingAddress")}
            </div>
          )}
        </>
      )}

      {step === 2 && paymentInfo && (
        <>
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              setStep(1);
              setPaymentInfo(null);
              setShowQr(false);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Change method
          </button>

          <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-4 py-3">
            {paymentInfo.coin === "btc" ? (
              <Bitcoin className="h-5 w-5 text-orange-400" />
            ) : (
              <SiLitecoin className="h-5 w-5 text-gray-300" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {paymentInfo.coin.toUpperCase()} Payment
              </p>
              <p className="text-xs text-muted-foreground">
                {plan.name} —{" "}
                {formatPrice(paymentInfo.amountUsd, { decimals: 0 })}/month
              </p>
              {!!paymentInfo.creditApplied && paymentInfo.creditApplied > 0 && (
                <p className="text-xs text-green-400">
                  -{formatPrice(paymentInfo.creditApplied)}{" "}
                  {t("referral.creditApplied")}
                </p>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1 text-xs text-yellow-400">
              <Clock className="h-3.5 w-3.5" />
              {status === "confirming" ? "Confirming…" : status === "paid" ? "Paid!" : "Awaiting"}
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Send exactly
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="flex-1 font-mono text-sm font-semibold">
                  {paymentInfo.amountCrypto} {paymentInfo.coin.toUpperCase()}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() =>
                    copyToClipboard(
                      `${paymentInfo.amountCrypto} ${paymentInfo.coin.toUpperCase()}`,
                      "amt",
                    )
                  }
                  aria-label="Copy amount"
                >
                  {copied === "amt" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                To address
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {paymentInfo.address}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => copyToClipboard(paymentInfo.address, "addr")}
                  aria-label="Copy address"
                >
                  {copied === "addr" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setShowQr((v) => !v)}
          >
            <QrCode className="h-4 w-4" />
            {showQr ? t("pay.hideQr") : t("pay.showQr")}
          </Button>

          {showQr && qrUrl && (
            <div className="flex justify-center">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <img
                  src={qrUrl}
                  alt={t("pay.qrAlt")}
                  className="h-48 w-48 rounded-lg"
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-400/80 leading-relaxed">
            Send the exact amount shown. Do not close this page until the
            payment is confirmed. Funds will be forwarded directly to the
            SkyUtils wallet — your subscription activates automatically.
          </div>

          <a
            href={`https://live.blockcypher.com/${paymentInfo.coin}/address/${paymentInfo.address}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Track on blockchain explorer
          </a>

          {status === "paid" && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Payment confirmed — activating your plan…
            </div>
          )}

          {status === "waiting" && (
            <div className="border-t border-border/40 pt-4">
              {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                disabled={cancelling}
                onClick={handleCancelModal}
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Cancel invoice
              </Button>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                Only possible while payment has not been sent yet.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PurchasePage
// ---------------------------------------------------------------------------

interface PurchasePageProps {
  plans: PlanRow[];
  currentSubscription: {
    subscription: SubscriptionRow;
    plan: PlanRow | null;
  } | null;
}

export function PurchasePage({
  plans,
  currentSubscription,
}: PurchasePageProps) {
  const { formatPrice, t } = usePreferences();
  const [selectedPlan, setSelectedPlan] = useState<PlanRow | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PaymentRow | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pendingModalInfo, setPendingModalInfo] = useState<PaymentInfo | null>(
    null,
  );

  // Trial state
  const [trialStatus, setTrialStatus] = useState<{
    redeemedByAccount: boolean;
    redeemedByIp: boolean;
  } | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [trialSuccess, setTrialSuccess] = useState(false);

  // Extra bot slots state ($5 lifetime each)
  const [slotInfo, setSlotInfo] = useState<{
    eligible: boolean;
    extraSlots: number;
    pricePerSlot: number;
  } | null>(null);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotQty, setSlotQty] = useState(1);

  function refreshSlots() {
    getMySlotInfo()
      .then((s) => setSlotInfo(s))
      .catch(() => setSlotInfo(null));
  }

  // Separate plan lists
  const trialPlan = plans.find((p) => p.is_trial);
  const paidPlans = plans.filter((p) => !p.is_trial && !p.is_hidden);

  useEffect(() => {
    getMyPendingPayment()
      .then((p) => setPendingPayment(p))
      .catch(() => setPendingPayment(null))
      .finally(() => setPendingLoading(false));

    getMyTrialStatus()
      .then((s) => setTrialStatus(s))
      .catch(() => setTrialStatus(null));

    getMySlotInfo()
      .then((s) => setSlotInfo(s))
      .catch(() => setSlotInfo(null));
  }, []);

  async function handleRedeemTrial() {
    setTrialLoading(true);
    setTrialError(null);
    try {
      await redeemFreeTrial();
      setTrialSuccess(true);
      setTrialStatus({ redeemedByAccount: true, redeemedByIp: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("pay.errActivate");
      if (msg.includes("TRIAL_ALREADY_REDEEMED_ACCOUNT")) {
        setTrialError(t("pay.trialUsedAccount"));
      } else if (msg.includes("TRIAL_ALREADY_REDEEMED_IP")) {
        setTrialError(t("pay.trialUsedIp"));
      } else {
        setTrialError(msg);
      }
    } finally {
      setTrialLoading(false);
    }
  }

  async function handleCancelInvoice(paymentId: string) {
    setCancellingId(paymentId);
    setCancelError(null);
    try {
      await cancelMyPayment({ data: { paymentId } });
      setPendingPayment(null);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : t("pay.errCancel"));
    } finally {
      setCancellingId(null);
    }
  }

  function handlePlanSelect(plan: PlanRow) {
    if (pendingPayment) {
      const existing: PaymentInfo = {
        paymentId: pendingPayment.id,
        address: pendingPayment.pay_address ?? "",
        amountCrypto: pendingPayment.amount_crypto ?? "",
        coin: pendingPayment.coin as "ltc" | "btc",
        amountUsd: pendingPayment.amount_usd,
        planName: pendingPayment.plan_id ?? "",
        creditApplied: pendingPayment.credit_applied,
      };
      const matchPlan =
        plans.find((p) => p.id === pendingPayment.plan_id) ?? plan;
      setPendingModalInfo(existing);
      setSelectedPlan(matchPlan);
      return;
    }
    setSelectedPlan(plan);
    setPendingModalInfo(null);
  }

  function handleModalClose() {
    setSelectedPlan(null);
    setPendingModalInfo(null);
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Trial success banner */}
      {trialSuccess && (
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
          <p className="font-medium text-green-300">
            {t("pay.trialActivated")}
          </p>
        </div>
      )}

      {/* Trial error */}
      {trialError && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <XCircle className="h-5 w-5 shrink-0 text-destructive" />
          <p className="text-destructive/90">{trialError}</p>
        </div>
      )}

      {/* Pending invoice banner */}
      {!pendingLoading && pendingPayment && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-yellow-400" />
              <div>
                <p className="font-medium text-yellow-300">
                  {t("pay.openInvoice")}
                  <span className="ml-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                    {pendingPayment.status}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("pay.unpaidInvoicePre")}{" "}
                  <span className="capitalize font-medium">
                    {pendingPayment.plan_id}
                  </span>{" "}
                  ({formatPrice(pendingPayment.amount_usd, { decimals: 0 })}).{" "}
                  {pendingPayment.status === "confirming"
                    ? t("pay.confirmingNoCancel")
                    : t("pay.payOrCancel")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {pendingPayment.status === "waiting" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10"
                  disabled={cancellingId === pendingPayment.id}
                  onClick={() => handleCancelInvoice(pendingPayment.id)}
                >
                  {cancellingId === pendingPayment.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {t("pay.cancel")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
                onClick={() => {
                  const matchPlan =
                    plans.find((p) => p.id === pendingPayment.plan_id) ??
                    plans[0];
                  if (!matchPlan) return;
                  const info: PaymentInfo = {
                    paymentId: pendingPayment.id,
                    address: pendingPayment.pay_address ?? "",
                    amountCrypto: pendingPayment.amount_crypto ?? "",
                    coin: pendingPayment.coin as "ltc" | "btc",
                    amountUsd: pendingPayment.amount_usd,
                    planName: pendingPayment.plan_id ?? "",
                    creditApplied: pendingPayment.credit_applied,
                  };
                  setPendingModalInfo(info);
                  setSelectedPlan(matchPlan);
                }}
              >
                {t("pay.viewInvoice")}
              </Button>
            </div>
          </div>
          {cancelError && (
            <p className="text-xs text-red-400 px-1">{cancelError}</p>
          )}
        </div>
      )}

      {/* Active subscription banner */}
      {currentSubscription?.plan && (
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
          <div>
            <p className="font-medium">
              {t("pay.activeSubscription")}{" "}
              <span className="text-green-300">
                {currentSubscription.plan.name}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {currentSubscription.plan.id === "admin"
                ? t("pay.unlimitedAdmin")
                : t("pay.renewsMonthly")}
            </p>
          </div>
        </div>
      )}

      {/* Paid plans grid */}
      <section className="space-y-4 pt-2">
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("pay.choosePlan")}
            </h3>
          </div>
          <span className="hidden text-xs text-muted-foreground/60 sm:block">
            {t("pay.cryptoSub")}
          </span>
        </div>
        <div className="grid items-start gap-5 md:grid-cols-3 md:pt-4">
          {paidPlans.map((plan, i) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              index={i}
              isCurrentPlan={currentSubscription?.plan?.id === plan.id}
              onSelect={handlePlanSelect}
            />
          ))}
        </div>
      </section>

      {/* Extra bot slots — paying subscribers can buy +1 bot per slot, lifetime */}
      {slotInfo?.eligible && (
        <section className="space-y-4 pt-2">
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("bots.slots.title")}
            </h3>
          </div>
          <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-border/60 bg-muted/30 text-foreground/75">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t("bots.slots.title")}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t("bots.slots.desc", { price: SLOT_PRICE_USD })}
                </p>
                {slotInfo.extraSlots > 0 && (
                  <p className="mt-1 text-xs font-medium text-green-400">
                    {t("bots.includingSlots", { n: slotInfo.extraSlots })}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5 rounded-full text-xs"
              onClick={() => {
                setSlotQty(1);
                setSlotDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("bots.slots.buy")}
            </Button>
          </div>
        </section>
      )}

      {/* Comparison table */}
      <section className="space-y-4 pt-2">
        <div className="flex items-center gap-2 px-1">
          <Check className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t("pay.compareFeatures")}
          </h3>
        </div>
        <ComparisonTable plans={paidPlans} />
      </section>

      {/* Bot Hours purchase section */}
      <section className="rounded-3xl border border-border/60 bg-card/40 p-6 backdrop-blur-sm">
        <BotHoursPurchaseSection />
      </section>

      {/* Free trial — moved out of the main flow, offered at the bottom */}
      {trialPlan && (
        <section className="space-y-4 pt-2">
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("pay.notReady")}
            </h3>
          </div>
          <FreeTrialBanner
            plan={trialPlan}
            isCurrentPlan={currentSubscription?.plan?.id === "free_trial"}
            onRedeem={handleRedeemTrial}
            trialStatus={trialStatus}
            loading={trialLoading}
          />
        </section>
      )}

      {/* Payment dialog */}
      <Dialog
        open={!!selectedPlan}
        onOpenChange={(open) => !open && handleModalClose()}
      >
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-tight">
              {t("pay.completePurchase")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/80">
              {pendingModalInfo
                ? t("pay.existingInvoiceShown")
                : t("pay.selectCrypto")}
            </DialogDescription>
          </DialogHeader>
          <Separator />
          {selectedPlan && (
            <PaymentModal
              plan={selectedPlan}
              onClose={handleModalClose}
              initialPayment={pendingModalInfo}
              pendingStatus={
                pendingModalInfo
                  ? (pendingPayment?.status as "waiting" | "confirming" | null)
                  : null
              }
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Buy extra bot slots ($5 each, lifetime) — crypto checkout */}
      <Dialog
        open={slotDialogOpen}
        onOpenChange={(o) => {
          setSlotDialogOpen(o);
          if (!o) refreshSlots();
        }}
      >
        <DialogContent className="sm:max-w-md border-border/60 bg-card/95 backdrop-blur-sm">
          <DialogHeader>
            <div className="mb-2 grid h-11 w-11 place-items-center rounded-2xl border border-border/60 bg-muted/30 text-foreground/75">
              <Sparkles className="h-5 w-5" />
            </div>
            <DialogTitle>{t("bots.slots.title")}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {t("bots.slots.dialogDesc", { price: SLOT_PRICE_USD })}
            </DialogDescription>
          </DialogHeader>

          {/* Quantity stepper */}
          <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/20 px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t("bots.slots.quantity")}</p>
              <p className="text-xs text-muted-foreground">
                {t("bots.slots.total", { total: SLOT_PRICE_USD * slotQty })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-full"
                onClick={() => setSlotQty((q) => Math.max(1, q - 1))}
                disabled={slotQty <= 1}
                aria-label={t("bots.slots.decrease")}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums">
                {slotQty}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-full"
                onClick={() => setSlotQty((q) => Math.min(25, q + 1))}
                disabled={slotQty >= 25}
                aria-label={t("bots.slots.increase")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <CryptoInvoiceFlow
            title={t("bots.slots.invoiceTitle", { n: slotQty })}
            priceUsd={SLOT_PRICE_USD * slotQty}
            initPayment={(coin) =>
              initSlotPayment({ data: { coin, quantity: slotQty } })
            }
            onClose={() => {
              setSlotDialogOpen(false);
              refreshSlots();
            }}
            onPaid={() => {
              refreshSlots();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
