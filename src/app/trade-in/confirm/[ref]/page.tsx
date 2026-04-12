"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { clearSellCart } from "@/lib/tradein/cart";

interface SubmissionItem {
  name: string;
  card_number: string;
  quantity: number;
  cash_price: number;
  credit_price: number;
  admin_price: number | null;
  admin_condition: string | null;
  admin_notes: string | null;
  rejected: boolean;
  payout_type: string | null;
}

interface Submission {
  reference: string;
  status: "submitted" | "quoted" | "accepted" | "declined" | "expired";
  paymentMethod: string;
  deliveryMethod: string;
  cashTotal: number;
  creditTotal: number;
  expiresAt: string;
  payout_type: string | null;
  cash_amount: number | null;
  credit_amount: number | null;
  final_total: number | null;
  admin_message: string | null;
  quoted_at: string | null;
  quote_expires_at: string | null;
  mint_bonus_applied: boolean;
  mint_bonus_amount: number | null;
  submitted_at: string | null;
}

interface ConfirmData {
  submission: Submission;
  items: SubmissionItem[];
}

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
        setExpired(true);
        setRemaining("Expired");
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (hours > 0) {
        setRemaining(`${hours}h ${mins}m ${secs}s`);
      } else {
        setRemaining(`${mins}m ${secs}s`);
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return { remaining, expired };
}

export default function ConfirmPage() {
  const params = useParams();
  const ref = params.ref as string;
  const [data, setData] = useState<ConfirmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);

  useEffect(() => {
    clearSellCart();
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/tradein/status?reference=${encodeURIComponent(ref)}`);
      if (!res.ok) {
        setError("Submission not found. Check your reference number.");
        setLoading(false);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError("Failed to load confirmation details.");
    }
    setLoading(false);
  }, [ref]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleQuoteAction = async (action: "accept" | "decline") => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/tradein/quote", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: ref, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || `Failed to ${action} quotation.`);
        setActionLoading(false);
        return;
      }
      setShowDeclineModal(false);
      await loadData();
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setActionLoading(false);
  };

  const submission = data?.submission;
  const items = data?.items ?? [];

  const { remaining: countdownText, expired: countdownExpired } = useCountdown(
    submission?.quote_expires_at ?? null
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-neutral-400">Loading...</div>
      </main>
    );
  }

  if (error || !data || !submission) {
    return (
      <main className="min-h-screen bg-neutral-950">
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Not Found</h1>
          <p className="text-neutral-400 mb-6">{error}</p>
          <Link href="/trade-in" className="px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition">
            Back to Trade-In
          </Link>
        </div>
      </main>
    );
  }

  const submittedDate = submission.submitted_at
    ? new Date(submission.submitted_at).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const expiryDate = submission.quote_expires_at
    ? new Date(submission.quote_expires_at).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const shippingBlock = (
    <div className="bg-neutral-900 rounded-xl p-4 mb-6">
      {submission.deliveryMethod === "mail" ? (
        <>
          <h3 className="text-sm font-bold text-white mb-3">Shipping Instructions</h3>
          <p className="text-sm text-neutral-400 mb-2">Please send your cards to:</p>
          <div className="bg-neutral-800 rounded-lg p-3 text-sm text-white">
            <p>Cambridge TCG</p>
            <p>PO Box 1637</p>
            <p>CAMBRIDGE</p>
            <p>CB1 0PD</p>
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            Include your reference number <strong className="text-amber-400">{submission.reference}</strong> on the package.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-sm font-bold text-white mb-3">In-Store Drop-Off</h3>
          <p className="text-sm text-neutral-400">
            Bring your cards to our shop and quote your reference:
          </p>
          <p className="text-lg font-bold text-amber-400 mt-2">{submission.reference}</p>
        </>
      )}
    </div>
  );

  // ── SUBMITTED ──────────────────────────────────────────────────────
  if (submission.status === "submitted") {
    return (
      <main className="min-h-screen bg-neutral-950">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Your Trade-In Has Been Received</h1>
            <p className="text-neutral-400 mt-2">We&apos;re reviewing your submission.</p>
          </div>

          <div className="bg-neutral-900 rounded-xl p-6 text-center mb-6">
            <p className="text-sm text-neutral-400 mb-1">Your Reference</p>
            <p className="text-3xl font-black text-amber-400 tracking-wider">{submission.reference}</p>
            {submittedDate && (
              <p className="text-sm text-neutral-500 mt-2">Submitted on {submittedDate}</p>
            )}
          </div>

          <div className="bg-neutral-900 rounded-xl p-4 mb-6">
            <h3 className="text-sm font-bold text-white mb-3">
              Items ({items.reduce((s, i) => s + i.quantity, 0)} cards)
            </h3>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-sm">
                  <span className="text-neutral-300">
                    {item.quantity}x {item.name}{" "}
                    <span className="text-neutral-500">({item.card_number})</span>
                  </span>
                  <span className="text-neutral-400">
                    {formatPrice(
                      (submission.paymentMethod === "cash" ? item.cash_price : item.credit_price) * item.quantity
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
            <p className="text-sm text-blue-300">
              We&apos;ll send you a formal quotation within 1-2 business days. You can return to this page at any time using your reference number.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/trade-in"
              className="flex-1 text-center px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
            >
              Trade More Cards
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── QUOTED ─────────────────────────────────────────────────────────
  if (submission.status === "quoted") {
    const acceptedItems = items.filter((i) => !i.rejected);
    const rejectedItems = items.filter((i) => i.rejected);

    const itemsTotal =
      submission.final_total != null && submission.mint_bonus_amount
        ? submission.final_total - submission.mint_bonus_amount
        : submission.final_total ?? 0;

    return (
      <main className="min-h-screen bg-neutral-950">
        <div className="max-w-2xl mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Your Quotation is Ready</h1>
            <p className="text-neutral-400 mt-2">Reference: <span className="text-amber-400 font-bold">{submission.reference}</span></p>
          </div>

          {/* Per-item breakdown */}
          <div className="bg-neutral-900 rounded-xl p-4 mb-6">
            <h3 className="text-sm font-bold text-white mb-3">Item Breakdown</h3>
            <div className="space-y-3">
              {acceptedItems.map((item, idx) => {
                const originalPrice =
                  submission.paymentMethod === "cash" ? item.cash_price : item.credit_price;
                const finalPrice = item.admin_price ?? originalPrice;
                const priceChanged = item.admin_price != null && item.admin_price !== originalPrice;

                return (
                  <div key={idx} className="border-b border-neutral-800 pb-2 last:border-0 last:pb-0">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-300">
                        {item.quantity}x {item.name}{" "}
                        <span className="text-neutral-500">({item.card_number})</span>
                      </span>
                      <span className="text-right">
                        {priceChanged ? (
                          <>
                            <span className="text-neutral-500 line-through mr-2">
                              {formatPrice(originalPrice * item.quantity)}
                            </span>
                            <span className="text-amber-400 font-medium">
                              {formatPrice(finalPrice * item.quantity)}
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-400 font-medium">
                            {formatPrice(finalPrice * item.quantity)}
                          </span>
                        )}
                      </span>
                    </div>
                    {(item.admin_condition || item.admin_notes) && (
                      <div className="mt-1 text-xs">
                        {item.admin_condition && (
                          <span className="text-yellow-400 mr-3">Condition: {item.admin_condition}</span>
                        )}
                        {item.admin_notes && (
                          <span className="text-neutral-500">{item.admin_notes}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {rejectedItems.map((item, idx) => (
                <div key={`rej-${idx}`} className="border-b border-neutral-800 pb-2 last:border-0 last:pb-0 opacity-50">
                  <div className="flex justify-between text-sm line-through">
                    <span className="text-neutral-500">
                      {item.quantity}x {item.name}{" "}
                      <span>({item.card_number})</span>
                    </span>
                    <span className="text-neutral-500">Rejected</span>
                  </div>
                  {item.admin_notes && (
                    <p className="text-xs text-red-400/70 mt-1">{item.admin_notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Quotation summary box */}
          <div className="bg-neutral-900 border border-amber-500/30 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-4">Your Quotation</h3>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-400">Items total</span>
                <span className="text-white">{formatPrice(itemsTotal)}</span>
              </div>

              {submission.mint_bonus_applied && submission.mint_bonus_amount != null && submission.mint_bonus_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-emerald-400">MINT bonus</span>
                  <span className="text-emerald-400">+ {formatPrice(submission.mint_bonus_amount)}</span>
                </div>
              )}

              <div className="border-t border-neutral-700 my-2" />

              {submission.cash_amount != null && submission.cash_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Cash payout</span>
                  <span className="text-white">{formatPrice(submission.cash_amount)}</span>
                </div>
              )}

              {submission.credit_amount != null && submission.credit_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Credit payout</span>
                  <span className="text-white">{formatPrice(submission.credit_amount)}</span>
                </div>
              )}

              {submission.final_total != null && (
                <div className="flex justify-between pt-2 border-t border-neutral-700">
                  <span className="text-white font-bold">Total</span>
                  <span className="text-amber-400 font-bold text-lg">{formatPrice(submission.final_total)}</span>
                </div>
              )}
            </div>

            {/* Admin message */}
            {submission.admin_message && (
              <div className="mt-4 bg-neutral-800 rounded-lg p-3">
                <p className="text-sm text-neutral-300 italic">&ldquo;{submission.admin_message}&rdquo;</p>
              </div>
            )}

            {/* Expiry countdown */}
            {submission.quote_expires_at && (
              <div className="mt-4 flex items-center gap-2 text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {countdownExpired ? (
                  <span className="text-red-400">This quotation has expired.</span>
                ) : (
                  <span className="text-neutral-400">
                    Valid for <span className="text-white font-medium">{countdownText}</span>
                    {expiryDate && <span className="text-neutral-500"> (expires {expiryDate})</span>}
                  </span>
                )}
              </div>
            )}

            {/* Accept / Decline buttons */}
            {!countdownExpired && (
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => handleQuoteAction("accept")}
                  disabled={actionLoading}
                  className="flex-1 px-6 py-3 bg-emerald-500 text-black font-bold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading ? "Processing..." : "Accept Quotation"}
                </button>
                <button
                  onClick={() => setShowDeclineModal(true)}
                  disabled={actionLoading}
                  className="flex-1 px-6 py-3 bg-neutral-800 text-neutral-300 font-medium rounded-lg hover:bg-neutral-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Decline
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/trade-in"
              className="flex-1 text-center px-6 py-3 bg-neutral-800 text-white font-medium rounded-lg hover:bg-neutral-700 transition"
            >
              Back to Trade-In
            </Link>
          </div>
        </div>

        {/* Decline confirmation modal */}
        {showDeclineModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="bg-neutral-900 rounded-xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-white mb-2">Decline Quotation?</h3>
              <p className="text-sm text-neutral-400 mb-6">
                Are you sure you want to decline this quotation? This action cannot be undone. You can submit a new trade-in at any time.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleQuoteAction("decline")}
                  disabled={actionLoading}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500 transition disabled:opacity-50"
                >
                  {actionLoading ? "Processing..." : "Yes, Decline"}
                </button>
                <button
                  onClick={() => setShowDeclineModal(false)}
                  disabled={actionLoading}
                  className="flex-1 px-4 py-2 bg-neutral-800 text-neutral-300 font-medium rounded-lg hover:bg-neutral-700 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ── ACCEPTED ───────────────────────────────────────────────────────
  if (submission.status === "accepted") {
    return (
      <main className="min-h-screen bg-neutral-950">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Quotation Accepted</h1>
            <p className="text-neutral-400 mt-2">Reference: <span className="text-amber-400 font-bold">{submission.reference}</span></p>
          </div>

          {/* Payout summary */}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-4">Confirmed Payout</h3>
            <div className="space-y-2 text-sm">
              {submission.cash_amount != null && submission.cash_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Cash payout</span>
                  <span className="text-white">{formatPrice(submission.cash_amount)}</span>
                </div>
              )}
              {submission.credit_amount != null && submission.credit_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Credit payout</span>
                  <span className="text-white">{formatPrice(submission.credit_amount)}</span>
                </div>
              )}
              {submission.final_total != null && (
                <div className="flex justify-between pt-2 border-t border-emerald-500/20">
                  <span className="text-white font-bold">Total</span>
                  <span className="text-emerald-400 font-bold text-lg">{formatPrice(submission.final_total)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Shipping instructions */}
          {shippingBlock}

          <div className="bg-neutral-900 rounded-xl p-4 mb-6">
            <p className="text-sm text-neutral-400">
              Once we receive and verify your cards, payment will be processed within 1-2 business days.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/trade-in"
              className="flex-1 text-center px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
            >
              Trade More Cards
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── DECLINED ───────────────────────────────────────────────────────
  if (submission.status === "declined") {
    return (
      <main className="min-h-screen bg-neutral-950">
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Quotation Declined</h1>
          <p className="text-neutral-400 mb-2">
            You declined the quotation for <span className="text-amber-400 font-bold">{submission.reference}</span>.
          </p>
          <p className="text-neutral-500 mb-8">You can submit a new trade-in anytime.</p>
          <Link
            href="/trade-in"
            className="px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Start New Trade-In
          </Link>
        </div>
      </main>
    );
  }

  // ── EXPIRED ────────────────────────────────────────────────────────
  if (submission.status === "expired") {
    return (
      <main className="min-h-screen bg-neutral-950">
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Quotation Expired</h1>
          <p className="text-neutral-400 mb-2">
            The quotation for <span className="text-amber-400 font-bold">{submission.reference}</span> has expired.
          </p>
          <p className="text-neutral-500 mb-8">Prices may have changed since your original submission. Please submit a new trade-in.</p>
          <Link
            href="/trade-in"
            className="px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Submit New Trade-In
          </Link>
        </div>
      </main>
    );
  }

  // ── FALLBACK (unknown status) ──────────────────────────────────────
  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Trade-In Status</h1>
        <p className="text-neutral-400 mb-2">Reference: <span className="text-amber-400 font-bold">{submission.reference}</span></p>
        <p className="text-neutral-500 mb-8">Status: {submission.status}</p>
        <Link
          href="/trade-in"
          className="px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
        >
          Back to Trade-In
        </Link>
      </div>
    </main>
  );
}
