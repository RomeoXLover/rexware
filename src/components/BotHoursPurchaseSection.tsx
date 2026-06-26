import { useState, useEffect } from "react";
import {
  Clock,
  KeyRound,
  Loader2,
  Plus,
  Minus,
  Zap,
  Gift,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { CryptoInvoiceFlow } from "@/components/CryptoInvoiceFlow";
import {
  getMyBotHourBalance,
  initBotHoursPayment,
  redeemBotHourKey,
  BOT_HOURS_PRICE_PER_HOUR,
  botHoursPrice,
  BOT_HOURS_DISCOUNT_THRESHOLD,
  BOT_HOURS_DISCOUNT_RATE,
} from "@/lib/api/dashboard.functions";
import type { BotHourBalanceRow } from "@/lib/api/dashboard.functions";

type PaymentInfo = {
  paymentId: string;
  address: string;
  amountCrypto: string;
  coin: "ltc" | "btc";
  amountUsd: number;
  planName: string;
  creditApplied?: number;
  fullyCovered?: boolean;
};
import { usePreferences } from "@/lib/preferences";

// ---------------------------------------------------------------------------
// Format remaining time as human-readable
// ---------------------------------------------------------------------------

function timeUntilExpiry(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Balance card
// ---------------------------------------------------------------------------

function BalanceCard({
  balances,
  totalAvailable,
  refreshing,
}: {
  balances: BotHourBalanceRow[];
  totalAvailable: number;
  refreshing: boolean;
}) {
  const { t } = usePreferences();
  const now = Date.now();

  const activeBalances = balances.filter((b) => b.hours - b.hours_used > 0 && b.expires_at > now);
  const expiredBalances = balances.filter((b) => b.expires_at <= now);

  return (
    <div className="space-y-3">
      {/* Big total */}
      <div
        className="relative flex flex-col items-center justify-center rounded-3xl p-8 overflow-hidden"
        style={{ background: "linear-gradient(135deg, oklch(0.14 0.025 265), oklch(0.11 0.02 280))", border: "1px solid oklch(1 0 0 / 0.08)" }}
      >
        {/* Glow */}
        <div
          aria-hidden
          className="absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
          style={{ background: "oklch(0.60 0.16 280)" }}
        />

        {refreshing ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
        ) : (
          <div className="relative text-center">
            <div
              className="text-6xl font-black tracking-tighter"
              style={{
                background: "linear-gradient(135deg, oklch(0.97 0.01 265), oklch(0.70 0.12 280))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {totalAvailable.toFixed(1)}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              hours available
            </div>
            <div className="mt-3 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-[11px] text-yellow-400/80">
              Expires at midnight UTC
            </div>
          </div>
        )}
      </div>

      {/* Individual balance chips */}
      {activeBalances.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Active balances
          </p>
          {activeBalances.map((b) => {
            const available = b.hours - b.hours_used;
            const remaining = b.expires_at - Date.now();
            const pct = available > 0 ? ((available / b.hours) * 100).toFixed(0) : "0";
            const isExpiringSoon = remaining < 2 * 60 * 60 * 1000;

            return (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/15 px-3 py-2"
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: b.source === "key"
                      ? "linear-gradient(135deg, oklch(0.70 0.16 60), oklch(0.60 0.14 50))"
                      : "linear-gradient(135deg, oklch(0.60 0.14 280), oklch(0.50 0.12 200))",
                  }}
                >
                  {b.source === "key" ? (
                    <Gift className="h-4 w-4" style={{ color: "oklch(0.97 0 0)" }} />
                  ) : (
                    <Zap className="h-4 w-4" style={{ color: "oklch(0.97 0 0)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{available.toFixed(1)}h</span>
                    <span className={`text-[10px] font-medium ${isExpiringSoon ? "text-yellow-400" : "text-muted-foreground/50"}`}>
                      {timeUntilExpiry(b.expires_at)} left
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full" style={{ background: "oklch(1 0 0 / 0.08)" }}>
                    <div
                      className="h-1 rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: b.source === "key"
                          ? "oklch(0.70 0.16 60)"
                          : "oklch(0.60 0.14 280)",
                      }}
                    />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/40">
                    <span>{b.source === "key" ? "Redeemed key" : "Purchased"}</span>
                    <span>·</span>
                    <span>{available.toFixed(1)} / {b.hours}h total</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeBalances.length === 0 && !refreshing && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/40 py-8 text-center">
          <Clock className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60">No active bot hours</p>
          <p className="text-xs text-muted-foreground/40">Purchase hours or redeem a key below</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buy hours stepper
// ---------------------------------------------------------------------------

function BuyHoursStepper({
  pricePerHour,
  discountThreshold,
  discountRate,
  selectedHours,
  onChange,
}: {
  pricePerHour: number;
  discountThreshold: number;
  discountRate: number;
  selectedHours: number;
  onChange: (h: number) => void;
}) {
  const rate = selectedHours >= discountThreshold
    ? pricePerHour * (1 - discountRate)
    : pricePerHour;
  const total = Math.round(rate * selectedHours * 100) / 100;
  const isDiscounted = selectedHours >= discountThreshold;
  const presets = [1, 2, 5, 10];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/20 p-4">
        <div>
          <p className="text-sm font-bold">Hours to purchase</p>
          <p className="text-xs text-muted-foreground">
            {isDiscounted
              ? <span className="text-green-400">${(pricePerHour * (1 - discountRate)).toFixed(2)}/hr</span>
              : <span>${pricePerHour.toFixed(2)}/hr</span>}
            {isDiscounted && <span className="ml-1 text-green-400/80">20% off!</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 rounded-full"
            onClick={() => onChange(Math.max(0.5, selectedHours - 1))}
            disabled={selectedHours <= 0.5}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div className="w-20 text-center">
            <span className="text-2xl font-black tabular-nums">{selectedHours}</span>
            <span className="text-sm text-muted-foreground ml-1">h</span>
          </div>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 rounded-full"
            onClick={() => onChange(Math.min(24, selectedHours + 1))}
            disabled={selectedHours >= 24}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-2">
        {presets.map((h) => {
          const pRate = h >= discountThreshold ? pricePerHour * (1 - discountRate) : pricePerHour;
          const pTotal = Math.round(pRate * h * 100) / 100;
          return (
            <button
              key={h}
              type="button"
              onClick={() => onChange(h)}
              className={[
                "rounded-full border px-4 py-1.5 text-sm font-semibold transition-all duration-200",
                selectedHours === h
                  ? "border-foreground/40 bg-foreground/10 text-foreground"
                  : "border-border/60 bg-muted/15 text-muted-foreground hover:border-foreground/20 hover:text-foreground/80",
              ].join(" ")}
            >
              {h}h — ${pTotal.toFixed(2)}{h >= discountThreshold && <span className="ml-1 text-green-400/80">-20%</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange(24)}
          className={[
            "rounded-full border px-4 py-1.5 text-sm font-semibold transition-all duration-200",
            selectedHours === 24
              ? "border-foreground/40 bg-foreground/10 text-foreground"
              : "border-border/60 bg-muted/15 text-muted-foreground hover:border-foreground/20 hover:text-foreground/80",
          ].join(" ")}
        >
          Max 24h — ${(24 * pricePerHour * (1 - discountRate)).toFixed(2)} <span className="text-green-400/80">-20%</span>
        </button>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/20 p-4">
        <div>
          <p className="text-sm font-semibold">Total</p>
          <p className="text-xs text-muted-foreground/60">Expires at midnight UTC tomorrow</p>
        </div>
        <div
          className="text-2xl font-black tabular-nums"
          style={{
            background: "linear-gradient(135deg, oklch(0.97 0.01 265), oklch(0.70 0.12 280))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          ${total.toFixed(2)}
        </div>
      </div>

      <Button
        className="w-full gap-2 bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600 shadow-[0_4px_20px_oklch(0.50_0.14_265/0.35)] transition-all duration-300 hover:shadow-[0_4px_28px_oklch(0.55_0.15_265/0.5)] hover:-translate-y-0.5"
        disabled={selectedHours < 0.5}
        onClick={() => {
          // Trigger parent to open the payment flow
          const event = new CustomEvent("openBotHoursCheckout", { detail: { hours: selectedHours, total } });
          window.dispatchEvent(event);
        }}
      >
        <Zap className="h-4 w-4" />
        Buy {selectedHours} Hour{selectedHours !== 1 ? "s" : ""} — ${total.toFixed(2)}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redeem key form
// ---------------------------------------------------------------------------

function RedeemKeyForm({
  onSuccess,
}: {
  onSuccess: (hours: number) => void;
}) {
  const { t } = usePreferences();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleRedeem() {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await redeemBotHourKey({ data: { code: code.trim() } });
      setSuccess(true);
      setCode("");
      onSuccess(result.hours);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to redeem key");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/8 p-6 text-center" style={{ animation: "fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both" }}>
        <CheckCircle2 className="h-8 w-8 text-green-400" />
        <div>
          <p className="font-bold text-green-300">Key redeemed!</p>
          <p className="text-sm text-muted-foreground mt-1">Bot hours have been added to your balance.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-green-500/30 text-green-400 hover:bg-green-500/10"
          onClick={() => setSuccess(false)}
        >
          Redeem another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-semibold">Redeem a Bot Hours Key</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Got a bot hours key from support or a promo? Enter it here to instantly add hours to your balance.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
          className="font-mono text-sm tracking-wider"
          maxLength={30}
        />
        <Button
          onClick={handleRedeem}
          disabled={loading || !code.trim()}
          className="shrink-0 gap-1.5 bg-gradient-to-r from-amber-700 to-orange-700 hover:from-amber-600 hover:to-orange-600 shadow-[0_4px_16px_oklch(0.60_0.15_60/0.3)] transition-all duration-300 hover:-translate-y-0.5"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
          Redeem
        </Button>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Bot Hours Purchase Section
// ---------------------------------------------------------------------------

interface BotHoursPurchaseSectionProps {
  onRefresh?: () => void;
}

export function BotHoursPurchaseSection({ onRefresh }: BotHoursPurchaseSectionProps) {
  const { t } = usePreferences();
  const [balances, setBalances] = useState<BotHourBalanceRow[]>([]);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [pricePerHour, setPricePerHour] = useState(BOT_HOURS_PRICE_PER_HOUR);
  const [discountThreshold, setDiscountThreshold] = useState(BOT_HOURS_DISCOUNT_THRESHOLD);
  const [discountRate, setDiscountRate] = useState(BOT_HOURS_DISCOUNT_RATE);
  const [refreshing, setRefreshing] = useState(true);
  const [selectedHours, setSelectedHours] = useState(1);

  // Checkout modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutHours, setCheckoutHours] = useState(1);

  // Listeners for the stepper's "Buy" button
  useEffect(() => {
    function onOpenCheckout(e: Event) {
      const detail = (e as CustomEvent).detail as { hours: number; total: number };
      setCheckoutHours(detail.hours);
      setCheckoutOpen(true);
    }
    window.addEventListener("openBotHoursCheckout", onOpenCheckout);
    return () => window.removeEventListener("openBotHoursCheckout", onOpenCheckout);
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const data = await getMyBotHourBalance();
      setBalances(data.balances);
      setTotalAvailable(data.totalAvailable);
      setPricePerHour(data.pricePerHour);
      setDiscountThreshold(data.discountThreshold);
      setDiscountRate(data.discountRate);
    } catch {
      // non-critical
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function handlePaid() {
    refresh();
    onRefresh?.();
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
          Bot Hours
        </h3>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: balance */}
        <div>
          <BalanceCard
            balances={balances}
            totalAvailable={totalAvailable}
            refreshing={refreshing}
          />
        </div>

        {/* Right: buy + redeem */}
        <div className="space-y-4">
          {/* Price info */}
          <div
            className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/50 p-4 backdrop-blur-sm"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "linear-gradient(135deg, oklch(0.60 0.14 280), oklch(0.50 0.12 200))", boxShadow: "0 4px 16px oklch(0.50 0.14 280 / 0.3)" }}
            >
              <Zap className="h-5 w-5" style={{ color: "oklch(0.97 0 0)" }} />
            </div>
            <div>
              <p className="text-sm font-bold">Purchase Bot Hours</p>
              <p className="text-xs text-muted-foreground">
                ${pricePerHour.toFixed(2)}/hr base price{discountRate > 0 && <span className="ml-1 text-green-400">· 20% off at {discountThreshold}h+</span>}
              </p>
            </div>
          </div>

          <BuyHoursStepper
            pricePerHour={pricePerHour}
            discountThreshold={discountThreshold}
            discountRate={discountRate}
            selectedHours={selectedHours}
            onChange={setSelectedHours}
          />

          <Separator className="border-border/40" />

          <RedeemKeyForm onSuccess={handlePaid} />
        </div>
      </div>

      {/* Crypto checkout modal */}
      <Dialog open={checkoutOpen} onOpenChange={(o) => { setCheckoutOpen(o); if (!o) refresh(); }}>
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <div
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: "linear-gradient(135deg, oklch(0.60 0.14 280), oklch(0.50 0.12 200))", boxShadow: "0 4px 16px oklch(0.50 0.14 280 / 0.3)" }}
            >
              <Zap className="h-6 w-6" style={{ color: "oklch(0.97 0 0)" }} />
            </div>
            <DialogTitle>Buy {checkoutHours} Bot Hour{checkoutHours !== 1 ? "s" : ""}</DialogTitle>
            <DialogDescription>
              ${pricePerHour.toFixed(2)}/hr · {checkoutHours >= discountThreshold ? <span className="text-green-400">{Math.round((1 - discountRate) * 100)}% off</span> : <span>{discountThreshold}h+ for 20% off</span>} · Expires at midnight UTC tomorrow if unused
            </DialogDescription>
          </DialogHeader>
          <Separator />

          <CryptoInvoiceFlow
            title={`${checkoutHours} Bot Hour${checkoutHours !== 1 ? "s" : ""}`}
            priceUsd={botHoursPrice(checkoutHours)}
            initPayment={async (coin) => {
              const info = await initBotHoursPayment({ data: { coin, hours: checkoutHours } });
              return {
                paymentId: info.paymentId,
                address: info.address,
                amountCrypto: info.amountCrypto,
                coin: info.coin,
                amountUsd: info.amountUsd,
                planName: info.planName,
              } as PaymentInfo;
            }}
            onClose={() => setCheckoutOpen(false)}
            onPaid={handlePaid}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
