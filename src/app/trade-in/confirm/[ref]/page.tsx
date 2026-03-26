"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { clearSellCart } from "@/lib/tradein/cart";

interface ConfirmData {
  reference: string;
  status: string;
  paymentMethod: string;
  deliveryMethod: string;
  cashTotal: number;
  creditTotal: number;
  expiresAt: string;
  items: {
    name: string;
    card_number: string;
    quantity: number;
    cash_price: number;
    credit_price: number;
  }[];
}

export default function ConfirmPage() {
  const params = useParams();
  const ref = params.ref as string;
  const [data, setData] = useState<ConfirmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Clear the sell cart on mount
    clearSellCart();
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/tradein/status?ref=${encodeURIComponent(ref)}`);
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
    }
    load();
  }, [ref]);

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-neutral-400">Loading...</div>
      </main>
    );
  }

  if (error || !data) {
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

  const total = data.paymentMethod === "cash" ? data.cashTotal : data.creditTotal;
  const totalLabel = data.paymentMethod === "cash" ? "Cash" : "Store Credit";
  const expiryDate = new Date(data.expiresAt).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const shippingContribution = total >= 100;

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Success banner */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Trade-In Submitted!</h1>
          <p className="text-neutral-400 mt-2">We&apos;ve sent a confirmation email with these details.</p>
        </div>

        {/* Reference */}
        <div className="bg-neutral-900 rounded-xl p-6 text-center mb-6">
          <p className="text-sm text-neutral-400 mb-1">Your Reference</p>
          <p className="text-3xl font-black text-amber-400 tracking-wider">{data.reference}</p>
          <p className="text-sm text-neutral-500 mt-2">Quote valid until {expiryDate}</p>
        </div>

        {/* Payment summary */}
        <div className="bg-neutral-900 rounded-xl p-4 mb-6">
          <div className="flex justify-between">
            <span className="text-neutral-400">Payment Method</span>
            <span className="text-white font-medium">{totalLabel}</span>
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-neutral-400">Total Payout</span>
            <span className="text-amber-400 font-bold text-lg">{formatPrice(total)}</span>
          </div>
          {shippingContribution && (
            <p className="text-sm text-emerald-400 mt-3">
              We will contribute £2.70 towards your shipping costs.
            </p>
          )}
        </div>

        {/* Items */}
        <div className="bg-neutral-900 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-bold text-white mb-3">Items ({data.items.reduce((s, i) => s + i.quantity, 0)} cards)</h3>
          <div className="space-y-2">
            {data.items.map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-neutral-300">
                  {item.quantity}x {item.name} <span className="text-neutral-500">({item.card_number})</span>
                </span>
                <span className="text-amber-400">
                  {formatPrice(
                    (data.paymentMethod === "cash" ? item.cash_price : item.credit_price) * item.quantity
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Shipping/drop-off instructions */}
        <div className="bg-neutral-900 rounded-xl p-4 mb-6">
          {data.deliveryMethod === "mail" ? (
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
                Include your reference number <strong className="text-amber-400">{data.reference}</strong> on the package.
              </p>
              {shippingContribution && (
                <p className="text-sm text-emerald-400 mt-2">
                  £2.70 shipping contribution will be added to your payout.
                </p>
              )}
            </>
          ) : (
            <>
              <h3 className="text-sm font-bold text-white mb-3">In-Store Drop-Off</h3>
              <p className="text-sm text-neutral-400">
                Bring your cards to our shop and quote your reference:
              </p>
              <p className="text-lg font-bold text-amber-400 mt-2">{data.reference}</p>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/trade-in"
            className="flex-1 text-center px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Trade More Cards
          </Link>
          <Link
            href="/trade-in/terms"
            className="flex-1 text-center px-6 py-3 bg-neutral-800 text-white font-medium rounded-lg hover:bg-neutral-700 transition"
          >
            View Terms
          </Link>
        </div>
      </div>
    </main>
  );
}
