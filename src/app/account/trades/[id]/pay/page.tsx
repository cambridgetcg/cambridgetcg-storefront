"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ── Types ──

interface EscrowPayment {
  status: string;
  reference: string;
  expectedAmount: string;
  expiresAt: string;
  sortCode: string;
  accountNumber: string;
  accountName: string;
  receivedAmount: string | null;
  receivedAt: string | null;
  payoutSentAt: string | null;
}

interface EscrowPayResponse {
  escrow: EscrowPayment;
  isBuyer: boolean;
  escrowTier?: string;
  sellerShipsTo?: string;
}

// ── Helpers ──

function formatSortCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 6) return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  return raw;
}

function formatCurrency(amount: string | number): string {
  return `\u00a3${Number(amount).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Countdown hook ──

function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;

    function tick() {
      const now = Date.now();
      const end = new Date(expiresAt!).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setRemaining("00:00:00");
        setExpired(true);
        return;
      }

      setExpired(false);
      const hours = Math.floor(diff / 3_600_000);
      const mins = Math.floor((diff % 3_600_000) / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setRemaining(
        `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      );
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return { remaining, expired };
}

// ── Copy button ──

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1.5 text-xs font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 rounded-lg hover:bg-neutral-700 hover:text-white transition"
    >
      {copied ? "Copied!" : `Copy ${label}`}
    </button>
  );
}

// ── Status display ──

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  awaiting_payment: {
    label: "Waiting for your bank transfer...",
    color: "text-amber-400",
    icon: "pulse",
  },
  payment_received: {
    label: "Payment received!",
    color: "text-emerald-400",
    icon: "check",
  },
  paid: {
    label: "Payment received!",
    color: "text-emerald-400",
    icon: "check",
  },
  payout_sent: {
    label: "Trade complete, seller paid",
    color: "text-emerald-400",
    icon: "check",
  },
  completed: {
    label: "Trade complete, seller paid",
    color: "text-emerald-400",
    icon: "check",
  },
  expired: {
    label: "Payment window expired",
    color: "text-red-400",
    icon: "expired",
  },
  refunded: {
    label: "Refund sent to your account",
    color: "text-blue-400",
    icon: "refund",
  },
};

function StatusIndicator({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || {
    label: status.replace(/_/g, " "),
    color: "text-neutral-400",
    icon: "none",
  };

  return (
    <div className="flex items-center gap-3">
      {config.icon === "pulse" && (
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
        </span>
      )}
      {config.icon === "check" && (
        <span className="text-emerald-400 text-lg">&#10003;</span>
      )}
      {config.icon === "expired" && (
        <span className="text-red-400 text-lg">&#10007;</span>
      )}
      {config.icon === "refund" && (
        <span className="text-blue-400 text-lg">&#8634;</span>
      )}
      <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
    </div>
  );
}

// ── Seller status display ──

const SELLER_STATUS: Record<string, { label: string; color: string }> = {
  awaiting_payment: { label: "Buyer is making payment...", color: "text-amber-400" },
  payment_received: { label: "Buyer has paid", color: "text-emerald-400" },
  paid: { label: "Buyer has paid", color: "text-emerald-400" },
  payout_sent: { label: "Trade complete, payout sent to you", color: "text-emerald-400" },
  completed: { label: "Trade complete, payout sent to you", color: "text-emerald-400" },
  expired: { label: "Payment window expired", color: "text-red-400" },
  refunded: { label: "Trade refunded", color: "text-red-400" },
};

// ── Main page ──

export default function EscrowPayPage() {
  const params = useParams();
  const tradeId = params.id as string;

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<EscrowPayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const { remaining, expired } = useCountdown(data?.escrow?.expiresAt ?? null);

  // Auth check
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setLoggedIn(!!d?.user?.email))
      .catch(() => setLoggedIn(false));
  }, []);

  // Fetch escrow data
  const fetchEscrow = useCallback(async () => {
    try {
      const res = await fetch(`/api/escrow/pay/${tradeId}`);
      if (res.status === 404) {
        // No escrow yet, that's fine
        setData(null);
        return;
      }
      if (!res.ok) throw new Error("Failed to load escrow details");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    if (loggedIn === true) fetchEscrow();
    if (loggedIn === false) setLoading(false);
  }, [loggedIn, fetchEscrow]);

  // Auto-poll every 10 seconds when awaiting payment
  useEffect(() => {
    if (!data?.escrow) return;
    const status = data.escrow.status;
    if (status !== "awaiting_payment") return;

    const interval = setInterval(fetchEscrow, 10_000);
    return () => clearInterval(interval);
  }, [data?.escrow?.status, fetchEscrow]);

  // Create escrow
  async function handleCreateEscrow() {
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/escrow/pay/${tradeId}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Failed to create escrow");
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // ── Loading / auth states ──

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-neutral-800 rounded w-48 animate-pulse" />
        <div className="h-64 bg-neutral-900 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (loggedIn === false) {
    return (
      <div className="bg-neutral-900 rounded-xl p-8 text-center">
        <p className="text-neutral-400 mb-3">You need to be signed in to view payment details.</p>
        <a href="/login" className="text-amber-400 hover:underline text-sm font-medium">
          Sign in
        </a>
      </div>
    );
  }

  // ── No escrow yet — show create button ──

  if (!data?.escrow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/account/trades/${tradeId}`}
            className="text-neutral-500 hover:text-white transition text-sm"
          >
            &larr; Back to Trade
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-white">
          Escrow Payment — Trade #{tradeId.slice(0, 8)}
        </h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="bg-neutral-900 rounded-xl p-8 text-center space-y-4">
          <p className="text-neutral-400 text-sm">
            No escrow account has been created for this trade yet. Create one to get bank transfer
            details.
          </p>
          <button
            onClick={handleCreateEscrow}
            disabled={creating}
            className="px-6 py-3 rounded-lg font-bold text-sm bg-amber-500 text-black hover:bg-amber-400 transition disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Escrow Account"}
          </button>
        </div>
      </div>
    );
  }

  const escrow = data.escrow;
  const isBuyer = data.isBuyer;

  // ── Seller view ──

  if (!isBuyer) {
    const sellerStatus = SELLER_STATUS[escrow.status] || {
      label: escrow.status.replace(/_/g, " "),
      color: "text-neutral-400",
    };

    const isPaid = ["payment_received", "paid", "payout_sent", "completed"].includes(escrow.status);

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/account/trades/${tradeId}`}
            className="text-neutral-500 hover:text-white transition text-sm"
          >
            &larr; Back to Trade
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-white">
          Payment Status — Trade #{tradeId.slice(0, 8)}
        </h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="bg-neutral-900 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            {escrow.status === "awaiting_payment" && (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
              </span>
            )}
            {isPaid && <span className="text-emerald-400 text-lg">&#10003;</span>}
            <span className={`text-base font-semibold ${sellerStatus.color}`}>
              {sellerStatus.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <span className="text-neutral-500">Amount</span>
            <span className="text-white font-mono">{formatCurrency(escrow.expectedAmount)}</span>
            <span className="text-neutral-500">Reference</span>
            <span className="text-white font-mono">{escrow.reference}</span>
            {escrow.receivedAt && (
              <>
                <span className="text-neutral-500">Payment Received</span>
                <span className="text-white">{formatDate(escrow.receivedAt)}</span>
              </>
            )}
            {escrow.payoutSentAt && (
              <>
                <span className="text-neutral-500">Payout Sent</span>
                <span className="text-white">{formatDate(escrow.payoutSentAt)}</span>
              </>
            )}
          </div>

          {/* Next steps after payment received */}
          {isPaid && !escrow.payoutSentAt && (
            <div className="border-t border-neutral-800 pt-4 space-y-2">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Next Steps</h3>
              {data.sellerShipsTo === "ctcg" ? (
                <div className="space-y-2">
                  <p className="text-sm text-neutral-300">
                    Ship the card to Cambridge TCG for inspection and forwarding.
                  </p>
                  <div className="bg-neutral-800 rounded-lg p-3 text-sm text-neutral-400">
                    <p className="font-medium text-white mb-1">Ship to:</p>
                    <p>Cambridge TCG</p>
                    <p>Ref: {escrow.reference}</p>
                    <p className="mt-2 text-xs text-amber-400">
                      Include the reference on the parcel. Use tracked + insured delivery.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-neutral-300">
                    Ship the card directly to the buyer using tracked delivery.
                  </p>
                  <p className="text-xs text-neutral-500">
                    Upload tracking details from your trade page once shipped.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Buyer view ──

  const isTerminal = ["payout_sent", "completed", "expired", "refunded"].includes(escrow.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/account/trades/${tradeId}`}
          className="text-neutral-500 hover:text-white transition text-sm"
        >
          &larr; Back to Trade
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white">
        Pay for Trade #{tradeId.slice(0, 8)}
      </h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Bank details card */}
      {!isTerminal && (
        <div className="bg-neutral-900 border-2 border-amber-500/40 rounded-xl p-6 space-y-5">
          <h2 className="text-lg font-bold text-white">Pay for your trade</h2>

          {/* Amount */}
          <div className="bg-neutral-800 rounded-lg p-4 text-center">
            <span className="text-xs text-neutral-500 uppercase tracking-wide">Send exactly</span>
            <p className="text-3xl font-bold text-white font-mono mt-1">
              {formatCurrency(escrow.expectedAmount)}
            </p>
          </div>

          {/* Bank details grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-neutral-800">
              <div>
                <span className="text-xs text-neutral-500 block">Sort code</span>
                <span className="text-white font-mono text-lg">{formatSortCode(escrow.sortCode)}</span>
              </div>
              <CopyButton label="Sort Code" value={formatSortCode(escrow.sortCode)} />
            </div>

            <div className="flex items-center justify-between py-2 border-b border-neutral-800">
              <div>
                <span className="text-xs text-neutral-500 block">Account number</span>
                <span className="text-white font-mono text-lg">{escrow.accountNumber}</span>
              </div>
              <CopyButton label="Account" value={escrow.accountNumber} />
            </div>

            <div className="flex items-center justify-between py-2 border-b border-neutral-800">
              <div>
                <span className="text-xs text-neutral-500 block">Account name</span>
                <span className="text-white font-mono">{escrow.accountName}</span>
              </div>
              <CopyButton label="Name" value={escrow.accountName} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-xs text-neutral-500 block">Payment reference</span>
                <span className="text-white font-mono text-lg font-bold">{escrow.reference}</span>
              </div>
              <CopyButton label="Reference" value={escrow.reference} />
            </div>
          </div>

          {/* Warnings */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-1">
            <p className="text-sm text-amber-400 font-medium">
              &#9888; Send from YOUR bank account only.
            </p>
            <p className="text-sm text-amber-400/80">
              Payment must arrive within 24 hours.
            </p>
          </div>

          {/* Countdown */}
          {escrow.expiresAt && !expired && (
            <div className="flex items-center justify-between bg-neutral-800 rounded-lg px-4 py-3">
              <span className="text-xs text-neutral-500 uppercase tracking-wide">Time remaining</span>
              <span className="text-white font-mono text-lg font-bold">{remaining}</span>
            </div>
          )}

          {/* Instructions */}
          <p className="text-xs text-neutral-500">
            Send via Faster Payments from your UK bank. Usually arrives in seconds.
          </p>
        </div>
      )}

      {/* Payment status tracker */}
      <div className="bg-neutral-900 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wide">Payment Status</h2>

        <StatusIndicator status={escrow.status} />

        {/* Status timeline */}
        <div className="space-y-0 pl-1.5">
          {[
            {
              key: "awaiting_payment",
              label: "Bank transfer initiated",
              active:
                escrow.status === "awaiting_payment" ||
                escrow.status === "payment_received" ||
                escrow.status === "paid" ||
                escrow.status === "payout_sent" ||
                escrow.status === "completed",
            },
            {
              key: "payment_received",
              label: "Payment received",
              active:
                escrow.status === "payment_received" ||
                escrow.status === "paid" ||
                escrow.status === "payout_sent" ||
                escrow.status === "completed",
            },
            {
              key: "payout_sent",
              label: "Seller paid, trade complete",
              active: escrow.status === "payout_sent" || escrow.status === "completed",
            },
          ].map((step, i) => (
            <div key={step.key} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full mt-1 ${
                    step.active ? "bg-emerald-400" : "bg-neutral-700"
                  }`}
                />
                {i < 2 && (
                  <div
                    className={`w-0.5 h-6 ${step.active ? "bg-emerald-400/40" : "bg-neutral-800"}`}
                  />
                )}
              </div>
              <span
                className={`text-sm ${step.active ? "text-white" : "text-neutral-600"}`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Received details */}
        {escrow.receivedAmount && escrow.receivedAt && (
          <div className="grid grid-cols-2 gap-3 text-sm border-t border-neutral-800 pt-3">
            <span className="text-neutral-500">Amount received</span>
            <span className="text-emerald-400 font-mono">
              {formatCurrency(escrow.receivedAmount)}
            </span>
            <span className="text-neutral-500">Received at</span>
            <span className="text-white">{formatDate(escrow.receivedAt)}</span>
          </div>
        )}

        {escrow.payoutSentAt && (
          <div className="grid grid-cols-2 gap-3 text-sm border-t border-neutral-800 pt-3">
            <span className="text-neutral-500">Seller paid at</span>
            <span className="text-white">{formatDate(escrow.payoutSentAt)}</span>
          </div>
        )}
      </div>

      {/* Expired state */}
      {(escrow.status === "expired" || expired) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400 text-sm font-medium">
            The payment window for this trade has expired. Please contact support if you believe
            this is an error.
          </p>
        </div>
      )}

      {/* Refunded state */}
      {escrow.status === "refunded" && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <p className="text-blue-400 text-sm font-medium">
            A refund has been sent to your bank account. It may take 1-2 business days to appear.
          </p>
        </div>
      )}
    </div>
  );
}
