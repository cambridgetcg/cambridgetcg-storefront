"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

interface ItemRow {
  name: string | null;
  card_number: string | null;
  quantity: number;
  quoted_cash_price: string | null;
  quoted_credit_price: string | null;
}

interface Submission {
  reference: string;
  status: string;
  payment_method: string;
  delivery_method: string;
  quoted_cash_total: string | null;
  quoted_credit_total: string | null;
  quote_expires_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-amber-500/20 text-amber-400",
  received: "bg-blue-500/20 text-blue-400",
  grading: "bg-purple-500/20 text-purple-400",
  approved: "bg-emerald-500/20 text-emerald-400",
  paid: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
  cancelled: "bg-neutral-500/20 text-neutral-400",
};

export default function TradeInsPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<{ submission: Submission; items: ItemRow[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (!data?.user?.email) { router.push("/login"); return; }
        return fetch("/api/account/trade-ins").then((r) => r.json());
      })
      .then((data) => {
        if (data?.submissions) setSubmissions(data.submissions);
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/account" className="text-sm text-neutral-400 hover:text-white transition mb-6 inline-block">
          ← My Account
        </Link>
        <h1 className="text-2xl font-bold text-white mb-8">My Trade-Ins</h1>

        {submissions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-neutral-500 mb-4">No trade-ins yet.</p>
            <Link
              href="/trade-in"
              className="px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition inline-block"
            >
              Browse Buylist
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.map(({ submission: s, items }) => (
              <div key={s.reference} className="bg-neutral-900 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === s.reference ? null : s.reference)}
                  className="w-full px-4 py-4 flex items-center gap-4 text-left hover:bg-neutral-800/50 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-mono font-bold text-amber-400">{s.reference}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] || "bg-neutral-700 text-neutral-300"}`}>
                        {s.status}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">
                      {s.payment_method === "cash" ? "Cash" : "Credit"} · {s.delivery_method === "mail" ? "Mail-in" : "In-store"} ·{" "}
                      {new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white">
                      {formatPrice(parseFloat(s.payment_method === "cash" ? s.quoted_cash_total || "0" : s.quoted_credit_total || "0"))}
                    </p>
                  </div>
                  <span className="text-neutral-600 text-sm">{expanded === s.reference ? "▲" : "▼"}</span>
                </button>

                {expanded === s.reference && (
                  <div className="px-4 pb-4 border-t border-neutral-800">
                    {s.quote_expires_at && (
                      <p className="text-xs text-neutral-500 mt-3 mb-3">
                        Quote valid until {new Date(s.quote_expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    )}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-neutral-500 text-xs uppercase tracking-wide">
                          <th className="text-left py-2">Card</th>
                          <th className="text-center py-2">Qty</th>
                          <th className="text-right py-2">
                            {s.payment_method === "cash" ? "Cash" : "Credit"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => (
                          <tr key={idx} className="border-t border-neutral-800">
                            <td className="py-2 text-white">
                              {item.name}
                              <span className="text-neutral-500 ml-2 text-xs">{item.card_number}</span>
                            </td>
                            <td className="py-2 text-center text-neutral-300">{item.quantity}</td>
                            <td className="py-2 text-right text-neutral-300">
                              {formatPrice(
                                parseFloat(
                                  (s.payment_method === "cash" ? item.quoted_cash_price : item.quoted_credit_price) || "0"
                                ) * item.quantity
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
