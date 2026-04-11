"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPrice } from "@/lib/format";

interface ItemRow {
  id: number;
  sku: string;
  card_number: string | null;
  name: string | null;
  set_code: string | null;
  quantity: number;
  quoted_cash_price: string | null;
  quoted_credit_price: string | null;
}

interface SubmissionRow {
  reference: string;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_method: string;
  delivery_method: string;
  quoted_cash_total: string | null;
  quoted_credit_total: string | null;
  notes: string | null;
  quote_expires_at: string | null;
  created_at: string;
}

interface Submission {
  submission: SubmissionRow;
  items: ItemRow[];
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

const STATUSES = ["submitted", "received", "grading", "approved", "paid", "rejected", "cancelled"];

export default function AdminTradeInsPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/submissions");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      setSubmissions(data.submissions || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check if already authed via cookie
    fetch("/api/admin/submissions")
      .then((res) => {
        if (res.ok) {
          setAuthed(true);
          return res.json();
        }
        return null;
      })
      .then((data) => {
        if (data?.submissions) setSubmissions(data.submissions);
      });
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setLoginError("Wrong password.");
        return;
      }
      setAuthed(true);
      setPassword("");
      fetchSubmissions();
    } catch {
      setLoginError("Network error.");
    }
  }

  async function handleStatusChange(reference: string, newStatus: string) {
    setUpdating(reference);
    try {
      const res = await fetch("/api/admin/submissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, status: newStatus }),
      });
      if (res.ok) {
        setSubmissions((prev) =>
          prev.map((s) =>
            s.submission.reference === reference
              ? { ...s, submission: { ...s.submission, status: newStatus } }
              : s
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  }

  // ── Login Screen ──
  if (!authed) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <form onSubmit={handleLogin} className="w-full max-w-sm px-4">
          <h1 className="text-2xl font-bold text-white text-center mb-8">Admin</h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 mb-4"
          />
          {loginError && (
            <p className="text-sm text-red-400 mb-4">{loginError}</p>
          )}
          <button
            type="submit"
            className="w-full py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Log In
          </button>
        </form>
      </main>
    );
  }

  // ── Dashboard ──
  const totalCash = submissions.reduce(
    (sum, s) => sum + parseFloat(s.submission.quoted_cash_total || "0"),
    0
  );
  const totalCredit = submissions.reduce(
    (sum, s) => sum + parseFloat(s.submission.quoted_credit_total || "0"),
    0
  );
  const pending = submissions.filter((s) => s.submission.status === "submitted").length;

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Trade-In Submissions</h1>
          <button
            onClick={fetchSubmissions}
            disabled={loading}
            className="px-4 py-2 bg-neutral-800 text-white text-sm rounded-lg hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold text-white mt-1">{submissions.length}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{pending}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Cash Quoted</p>
            <p className="text-2xl font-bold text-white mt-1">{formatPrice(totalCash)}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Credit Quoted</p>
            <p className="text-2xl font-bold text-white mt-1">{formatPrice(totalCredit)}</p>
          </div>
        </div>

        {/* Submissions */}
        {submissions.length === 0 && !loading && (
          <p className="text-neutral-500 text-center py-12">No submissions yet.</p>
        )}

        <div className="space-y-3">
          {submissions.map(({ submission: s, items }) => (
            <div key={s.reference} className="bg-neutral-900 rounded-xl overflow-hidden">
              {/* Row */}
              <button
                onClick={() => setExpanded(expanded === s.reference ? null : s.reference)}
                className="w-full px-4 py-4 flex items-center gap-4 text-left hover:bg-neutral-800/50 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-mono font-bold text-amber-400">{s.reference}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] || "bg-neutral-700 text-neutral-300"}`}>
                      {s.status}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {s.payment_method === "cash" ? "Cash" : "Credit"} · {s.delivery_method === "mail" ? "Mail" : "In-store"}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-300 mt-1">{s.customer_name} — {s.customer_email}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-white">
                    {formatPrice(parseFloat(s.payment_method === "cash" ? s.quoted_cash_total || "0" : s.quoted_credit_total || "0"))}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <span className="text-neutral-600 text-sm">{expanded === s.reference ? "▲" : "▼"}</span>
              </button>

              {/* Expanded detail */}
              {expanded === s.reference && (
                <div className="px-4 pb-4 border-t border-neutral-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 mb-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Phone</span>
                      <p className="text-white">{s.customer_phone || "—"}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Cash Total</span>
                      <p className="text-white">{formatPrice(parseFloat(s.quoted_cash_total || "0"))}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Credit Total</span>
                      <p className="text-white">{formatPrice(parseFloat(s.quoted_credit_total || "0"))}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Expires</span>
                      <p className="text-white">
                        {s.quote_expires_at
                          ? new Date(s.quote_expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {s.notes && (
                    <div className="mb-4">
                      <span className="text-xs text-neutral-500">Notes</span>
                      <p className="text-sm text-neutral-300 mt-1">{s.notes}</p>
                    </div>
                  )}

                  {/* Items table */}
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-sm min-w-[400px]">
                      <thead>
                        <tr className="text-neutral-500 text-xs uppercase tracking-wide">
                          <th className="text-left py-2">Card</th>
                          <th className="text-center py-2 w-12">Qty</th>
                          <th className="text-right py-2 w-20">Cash</th>
                          <th className="text-right py-2 w-20">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-t border-neutral-800">
                            <td className="py-2 text-white">
                              {item.name}
                              <span className="text-neutral-500 ml-2 text-xs hidden sm:inline">{item.card_number}</span>
                            </td>
                            <td className="py-2 text-center text-neutral-300">{item.quantity}</td>
                            <td className="py-2 text-right text-neutral-300 whitespace-nowrap">
                              {formatPrice(parseFloat(item.quoted_cash_price || "0") * item.quantity)}
                            </td>
                            <td className="py-2 text-right text-neutral-300 whitespace-nowrap">
                              {formatPrice(parseFloat(item.quoted_credit_price || "0") * item.quantity)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Status update */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-neutral-500">Update status:</span>
                    {STATUSES.map((st) => (
                      <button
                        key={st}
                        onClick={() => handleStatusChange(s.reference, st)}
                        disabled={s.status === st || updating === s.reference}
                        className={`text-xs px-2 py-1 rounded-full transition ${
                          s.status === st
                            ? STATUS_COLORS[st] + " font-bold"
                            : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                        } disabled:opacity-50`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
