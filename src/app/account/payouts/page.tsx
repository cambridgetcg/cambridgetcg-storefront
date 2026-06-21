"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface PayoutStatus {
  accountId: string | null;
  status: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  updatedAt: string | null;
}

interface PendingPayout {
  id: string;
  label: string;
  amountFormatted: string;
  when: string;
}

const STATUS_COPY: Record<string, { badge: string; className: string; detail: string }> = {
  pending: {
    badge: "Not started",
    className: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
    detail: "Complete Stripe onboarding to start receiving payouts.",
  },
  incomplete: {
    badge: "Onboarding incomplete",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    detail: "Stripe still needs some information from you. Click Continue to finish.",
  },
  verified: {
    badge: "Verified",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    detail: "Your Stripe account is set up and ready to receive payouts.",
  },
  restricted: {
    badge: "Restricted",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
    detail: "Stripe has restricted your account. Open the portal to see what's needed.",
  },
  rejected: {
    badge: "Rejected",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
    detail: "Stripe rejected your account. Contact support.",
  },
};

export default function PayoutsPage() {
  // useSearchParams() requires a Suspense boundary at static-generation time
  return (
    <Suspense fallback={null}>
      <PayoutsContent />
    </Suspense>
  );
}

function PayoutsContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [pending, setPending] = useState<{ trades: PendingPayout[]; auctions: PendingPayout[]; totalOwedFormatted: string } | null>(null);
  const [liquidity, setLiquidity] = useState<{ awardCount: number; totalFormatted: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState("GB");
  const [countries, setCountries] = useState<string[]>([]);

  // Country list is only needed pre-onboarding; fetched lazily.
  useEffect(() => {
    fetch("/api/account/payouts/countries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.countries) setCountries(d.countries); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account/payouts/status");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load payout status");
        return;
      }
      const data = await res.json();
      setStatus(data.status);
      setPending(data.pending);
      setLiquidity(data.liquidity ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // If we just returned from the hosted onboarding flow, Stripe's webhook
  // may lag. Trigger an explicit refresh so the UI reflects the new state.
  useEffect(() => {
    if (searchParams.get("onboarding") === "return") {
      refresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function startOnboarding() {
    setOnboarding(true);
    setError(null);
    try {
      const res = await fetch("/api/account/payouts/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // country is only consulted on first-time account creation; ignored
        // for returning sellers since Express accounts have fixed country
        body: JSON.stringify({ country }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start onboarding");
        return;
      }
      window.location.href = data.url;
    } finally {
      setOnboarding(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/account/payouts/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to refresh");
        return;
      }
      setStatus(data.status);
      // Re-fetch pending amounts too since status affects messaging
      const p = await fetch("/api/account/payouts/status").then((r) => r.json());
      if (p?.pending) setPending(p.pending);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return <p className="text-neutral-500 text-sm">Loading...</p>;
  }

  const copy = status?.status ? STATUS_COPY[status.status] : null;

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-2">Payouts</h1>
      <p className="text-sm text-neutral-400 mb-6">
        Connect your bank account via Stripe to receive payouts for trades and auctions you sell.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Status card */}
      <div className="bg-neutral-900 rounded-xl p-5 mb-6">
        {!status?.accountId ? (
          <>
            <h2 className="text-white font-bold mb-1">Get paid via Stripe</h2>
            <p className="text-sm text-neutral-400 mb-4">
              Stripe handles identity verification, bank details, and payouts. Takes a few minutes.
              You only need to do this once.
            </p>
            <div className="mb-4">
              <label className="block text-xs text-neutral-500 mb-1">Country</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full max-w-xs px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm"
              >
                {(countries.length ? countries : ["GB"]).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <p className="text-[11px] text-neutral-500 mt-1">
                Country is fixed once your Stripe account is created. Choose carefully.
              </p>
            </div>
            <button
              onClick={startOnboarding}
              disabled={onboarding}
              className="px-4 py-2.5 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition disabled:opacity-50"
            >
              {onboarding ? "Opening Stripe..." : "Connect with Stripe"}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 className="text-white font-bold">Stripe Connect</h2>
                {copy && (
                  <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full border ${copy.className}`}>
                    {copy.badge}
                  </span>
                )}
              </div>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="text-xs text-neutral-400 hover:text-white transition"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <p className="text-sm text-neutral-400 mb-4">{copy?.detail}</p>
            <div className="flex gap-3 flex-wrap">
              {status.status !== "verified" && (
                <button
                  onClick={startOnboarding}
                  disabled={onboarding}
                  className="px-4 py-2 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition disabled:opacity-50"
                >
                  {onboarding ? "Opening..." : status.status === "incomplete" ? "Continue onboarding" : "Open Stripe portal"}
                </button>
              )}
              <div className="text-xs text-neutral-500 flex items-center gap-3">
                <span>Charges: {status.chargesEnabled ? "on" : "off"}</span>
                <span>Payouts: {status.payoutsEnabled ? "on" : "off"}</span>
                {status.updatedAt && (
                  <span>Last synced {new Date(status.updatedAt).toLocaleDateString("en-GB")}</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Pending payouts */}
      {pending && (pending.trades.length > 0 || pending.auctions.length > 0) && (
        <div className="bg-neutral-900 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-white font-bold text-sm uppercase tracking-wide">Pending Payouts</h2>
            <span className="text-amber-400 font-bold">{pending.totalOwedFormatted}</span>
          </div>
          <p className="text-xs text-neutral-500 mb-4">
            These amounts are owed to you. Payouts are processed by Cambridge TCG once a trade or
            auction reaches the payout-eligible state.
          </p>
          {pending.trades.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-neutral-500 mb-2">Trades</p>
              <div className="space-y-1.5">
                {pending.trades.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-300 truncate">{t.label}</span>
                    <span className="text-white font-mono shrink-0 ml-3">{t.amountFormatted}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {pending.auctions.length > 0 && (
            <div>
              <p className="text-xs text-neutral-500 mb-2">Auctions</p>
              <div className="space-y-1.5">
                {pending.auctions.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-300 truncate">{a.label}</span>
                    <span className="text-white font-mono shrink-0 ml-3">{a.amountFormatted}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {pending && pending.trades.length === 0 && pending.auctions.length === 0 && (
        <p className="text-sm text-neutral-500">No pending payouts.</p>
      )}

      {liquidity && liquidity.awardCount > 0 && (
        <div className="mt-6 bg-neutral-900 rounded-xl p-5 border border-purple-500/20">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-sm font-bold text-purple-400 uppercase tracking-wide">
              Liquidity rewards
            </h2>
            <span className="text-purple-400 font-mono font-bold">{liquidity.totalFormatted}</span>
          </div>
          <p className="text-xs text-neutral-500">
            {liquidity.awardCount} rewards earned for keeping tight, resting asks. Paid as store credit &middot;
            appears in your account credit balance.
          </p>
        </div>
      )}
    </div>
  );
}
