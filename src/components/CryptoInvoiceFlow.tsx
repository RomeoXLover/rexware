import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Bitcoin,
  Copy,
  QrCode,
  Loader2,
  ArrowLeft,
  ExternalLink,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { SiLitecoin } from "react-icons/si";
import { getPaymentStatus, cancelMyPayment } from "@/lib/api/dashboard.functions";
import { usePreferences } from "@/lib/preferences";

export type PaymentInfo = {
  paymentId: string;
  address: string;
  amountCrypto: string;
  coin: "ltc" | "btc";
  amountUsd: number;
  planName: string;
};

// Generic crypto invoice flow. Step 1: pick a coin (calls `initPayment`).
// Step 2: show the invoice, poll for confirmation, allow cancel. Identical
// behaviour to the subscription checkout — money is only ever marked paid by
// the server-side webhook driven by on-chain confirmations.
export function CryptoInvoiceFlow({
  title,
  priceUsd,
  initPayment,
  onClose,
  onPaid,
  initialPayment,
  pendingStatus,
}: {
  title: string;
  priceUsd: number;
  initPayment: (coin: "ltc" | "btc") => Promise<PaymentInfo>;
  onClose: () => void;
  onPaid?: () => void;
  initialPayment?: PaymentInfo | null;
  pendingStatus?: "waiting" | "confirming" | null;
}) {
  const { formatPrice, t } = usePreferences();
  const [step, setStep] = useState<1 | 2>(initialPayment ? 2 : 1);
  const [coin, setCoin] = useState<"ltc" | "btc" | null>(
    initialPayment ? initialPayment.coin : null,
  );
  const [loading, setLoading] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(
    initialPayment ?? null,
  );
  const [status, setStatus] = useState<
    "waiting" | "confirming" | "paid" | "expired" | "failed" | null
  >(pendingStatus ?? null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<"addr" | "amt" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const paidFired = useRef(false);

  const canCancel = status === "waiting" || (!initialPayment && step === 2);

  // Poll the payment status so the UI reacts when the webhook confirms it.
  useEffect(() => {
    if (!paymentInfo || status === "paid") return;
    const id = setInterval(async () => {
      try {
        const p = await getPaymentStatus({
          data: { paymentId: paymentInfo.paymentId },
        });
        setStatus(p.status);
        if (p.status === "paid" && !paidFired.current) {
          paidFired.current = true;
          onPaid?.();
          // Reload so the server-reflected plan/subscription state is fresh.
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch {
        // transient — keep polling
      }
    }, 5000);
    return () => clearInterval(id);
  }, [paymentInfo, status, onPaid]);

  async function handleCoinSelect(c: "ltc" | "btc") {
    setCoin(c);
    setLoading(true);
    setError(null);
    try {
      const info = await initPayment(c);
      setPaymentInfo(info);
      setStatus("waiting");
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

  async function handleCancel() {
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

  if (status === "paid") {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle2 className="h-7 w-7 text-green-400" />
        </div>
        <div>
          <p className="text-lg font-semibold">{t("pay.paymentConfirmed")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pay.nowUnlocked", { title })}
          </p>
        </div>
        <Button className="w-full" onClick={onClose}>
          {t("pay.continue")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {step === 1 && (
        <>
          <p className="text-sm text-muted-foreground">
            {t("pay.unlocking")}{" "}
            <span className="font-semibold text-foreground">{title}</span> —{" "}
            {formatPrice(priceUsd)} {t("pay.lifetime")}
          </p>

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
          {!initialPayment && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setStep(1);
                setPaymentInfo(null);
                setStatus(null);
                setShowQr(false);
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              {t("pay.changeMethod")}
            </button>
          )}

          <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-4 py-3">
            {paymentInfo.coin === "btc" ? (
              <Bitcoin className="h-5 w-5 text-orange-400" />
            ) : (
              <SiLitecoin className="h-5 w-5 text-gray-300" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {t("pay.coinPayment", { coin: paymentInfo.coin.toUpperCase() })}
              </p>
              <p className="text-xs text-muted-foreground">
                {title} — {formatPrice(paymentInfo.amountUsd)} {t("pay.lifetime")}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1 text-xs text-yellow-400">
              {status === "confirming" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("pay.confirming")}
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5" />
                  {t("pay.awaiting")}
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("pay.sendExactly")}
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="flex-1 font-mono text-sm font-semibold">
                  {paymentInfo.amountCrypto} {paymentInfo.coin.toUpperCase()}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() =>
                    copyToClipboard(
                      `${paymentInfo.amountCrypto} ${paymentInfo.coin.toUpperCase()}`,
                      "amt",
                    )
                  }
                  aria-label={t("pay.copyAmount")}
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
                {t("pay.toAddress")}
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {paymentInfo.address}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => copyToClipboard(paymentInfo.address, "addr")}
                  aria-label={t("pay.copyAddress")}
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

          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs leading-relaxed text-yellow-400/80">
            {t("pay.warnPlugin")}
          </div>

          <a
            href={`https://live.blockcypher.com/${paymentInfo.coin}/address/${paymentInfo.address}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            {t("pay.trackExplorer")}
          </a>

          {canCancel && (
            <div className="border-t border-border/40 pt-4">
              {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                disabled={cancelling}
                onClick={handleCancel}
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {t("pay.cancelInvoice")}
              </Button>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                {t("pay.cancelHint")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
