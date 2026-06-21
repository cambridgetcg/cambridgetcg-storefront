"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatPrice } from "@/lib/format";

interface ItemRow {
  id: number;
  sku: string;
  game?: string | null;
  card_number: string | null;
  name: string | null;
  set_code: string | null;
  quantity: number;
  quoted_cash_price: string | null;
  quoted_credit_price: string | null;
  admin_price?: string | null;
  admin_condition?: string | null;
  admin_notes?: string | null;
  rejected?: boolean;
  payout_type?: string | null;
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
  admin_message?: string | null;
  payout_type?: string | null;
  cash_amount?: string | null;
  credit_amount?: string | null;
  mint_bonus_applied?: boolean;
  mint_bonus_amount?: string | null;
  final_total?: string | null;
}

interface Submission {
  submission: SubmissionRow;
  items: ItemRow[];
}

// Per-item editing state
interface ItemEditState {
  adminPrice: string;
  adminCondition: string;
  rejected: boolean;
  adminNotes: string;
  payoutType: string; // "" means use submission-level
}

// Quote form state
interface QuoteFormState {
  items: Record<number, ItemEditState>;
  payoutType: "cash" | "credit" | "mixed";
  cashAmount: string;
  creditAmount: string;
  mintBonusApplied: boolean;
  mintBonusAmount: string;
  adminMessage: string;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-amber-500/20 text-amber-400",
  quoted: "bg-blue-500/20 text-blue-400",
  accepted: "bg-emerald-500/20 text-emerald-400",
  declined: "bg-red-500/20 text-red-400",
  expired: "bg-neutral-500/20 text-neutral-400",
  received: "bg-blue-500/20 text-blue-400",
  grading: "bg-purple-500/20 text-purple-400",
  approved: "bg-emerald-500/20 text-emerald-400",
  paid: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
  cancelled: "bg-neutral-500/20 text-neutral-400",
};

const STATUSES = ["submitted", "quoted", "accepted", "declined", "expired", "received", "grading", "approved", "paid", "rejected", "cancelled"];

const CONDITIONS = ["NM", "LP", "MP", "HP", "MINT"];

const INPUT_CLS =
  "w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-sm";

function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m ${secs}s remaining`;
}

function QuotationForm({
  submission,
  items,
  onQuoteSent,
}: {
  submission: SubmissionRow;
  items: ItemRow[];
  onQuoteSent: () => void;
}) {
  const [form, setForm] = useState<QuoteFormState>(() => {
    const itemStates: Record<number, ItemEditState> = {};
    for (const item of items) {
      const defaultPrice =
        submission.payment_method === "cash"
          ? item.quoted_cash_price || "0"
          : item.quoted_credit_price || "0";
      itemStates[item.id] = {
        adminPrice: defaultPrice,
        adminCondition: "NM",
        rejected: false,
        adminNotes: "",
        payoutType: "",
      };
    }
    return {
      items: itemStates,
      payoutType: submission.payment_method === "cash" ? "cash" : "credit",
      cashAmount: "",
      creditAmount: "",
      mintBonusApplied: false,
      mintBonusAmount: "0",
      adminMessage: "",
    };
  });

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const updateItem = (id: number, patch: Partial<ItemEditState>) => {
    setForm((prev) => ({
      ...prev,
      items: { ...prev.items, [id]: { ...prev.items[id], ...patch } },
    }));
  };

  // Calculate totals from non-rejected items
  const itemsTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const state = form.items[item.id];
      if (!state || state.rejected) return sum;
      return sum + parseFloat(state.adminPrice || "0") * item.quantity;
    }, 0);
  }, [items, form.items]);

  const mintBonus = form.mintBonusApplied ? parseFloat(form.mintBonusAmount || "0") : 0;
  const finalTotal = itemsTotal + mintBonus;

  const hasMintItems = useMemo(() => {
    return items.some((item) => {
      const state = form.items[item.id];
      return state && !state.rejected && state.adminCondition === "MINT";
    });
  }, [items, form.items]);

  // Auto-calculate cash/credit when not mixed
  const effectiveCash = form.payoutType === "cash" ? finalTotal : form.payoutType === "mixed" ? parseFloat(form.cashAmount || "0") : 0;
  const effectiveCredit = form.payoutType === "credit" ? finalTotal : form.payoutType === "mixed" ? parseFloat(form.creditAmount || "0") : 0;

  async function handleSendQuote() {
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/tradein/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: submission.reference,
          items: items.map((item) => {
            const state = form.items[item.id];
            return {
              id: item.id,
              adminPrice: parseFloat(state.adminPrice || "0"),
              adminCondition: state.adminCondition,
              adminNotes: state.adminNotes || undefined,
              rejected: state.rejected,
              payoutType: state.payoutType || undefined,
            };
          }),
          payoutType: form.payoutType,
          cashAmount: effectiveCash,
          creditAmount: effectiveCredit,
          adminMessage: form.adminMessage || undefined,
          mintBonusApplied: form.mintBonusApplied,
          mintBonusAmount: mintBonus,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to send quotation.");
        setSending(false);
        return;
      }
      onQuoteSent();
    } catch {
      setError("Network error. Please try again.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-5 mt-4">
      {/* Per-item pricing */}
      <div>
        <h4 className="text-sm font-bold text-amber-400 mb-3">Item Pricing</h4>
        <div className="space-y-3">
          {items.map((item) => {
            const state = form.items[item.id];
            if (!state) return null;
            const origCash = parseFloat(item.quoted_cash_price || "0");
            const origCredit = parseFloat(item.quoted_credit_price || "0");
            return (
              <div
                key={item.id}
                className={`rounded-lg border p-3 transition ${
                  state.rejected
                    ? "border-red-500/30 bg-red-500/5 opacity-60"
                    : "border-neutral-700 bg-neutral-800/50"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.name}</p>
                    <p className="text-xs text-neutral-500">
                      {item.card_number}{item.game ? ` (${item.game})` : ""} &middot; Qty: {item.quantity} &middot; Original: {formatPrice(origCash)} cash / {formatPrice(origCredit)} credit
                    </p>
                  </div>
                  <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={state.rejected}
                      onChange={(e) => updateItem(item.id, { rejected: e.target.checked })}
                      className="w-4 h-4 accent-red-500"
                    />
                    <span className="text-xs text-red-400 font-medium">Reject</span>
                  </label>
                </div>

                {!state.rejected && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[11px] text-neutral-500 block mb-1">Admin Price</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={state.adminPrice}
                        onChange={(e) => updateItem(item.id, { adminPrice: e.target.value })}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-neutral-500 block mb-1">Condition</label>
                      <select
                        value={state.adminCondition}
                        onChange={(e) => updateItem(item.id, { adminCondition: e.target.value })}
                        className={INPUT_CLS}
                      >
                        {CONDITIONS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-neutral-500 block mb-1">Payout Override</label>
                      <select
                        value={state.payoutType}
                        onChange={(e) => updateItem(item.id, { payoutType: e.target.value })}
                        className={INPUT_CLS}
                      >
                        <option value="">Default</option>
                        <option value="cash">Cash</option>
                        <option value="credit">Credit</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-neutral-500 block mb-1">Notes</label>
                      <input
                        type="text"
                        placeholder="Optional..."
                        value={state.adminNotes}
                        onChange={(e) => updateItem(item.id, { adminNotes: e.target.value })}
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quotation summary */}
      <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 space-y-4">
        <h4 className="text-sm font-bold text-amber-400">Quotation Summary</h4>

        {/* Payout type selector */}
        <div>
          <label className="text-[11px] text-neutral-500 block mb-2">Payout Type</label>
          <div className="flex flex-col sm:flex-row gap-3">
            {(["cash", "credit", "mixed"] as const).map((pt) => (
              <label
                key={pt}
                className={`flex-1 cursor-pointer rounded-lg border-2 p-3 text-center transition ${
                  form.payoutType === pt
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-neutral-700 hover:border-neutral-600"
                }`}
              >
                <input
                  type="radio"
                  name={`payout-${submission.reference}`}
                  value={pt}
                  checked={form.payoutType === pt}
                  onChange={() => setForm((prev) => ({ ...prev, payoutType: pt }))}
                  className="sr-only"
                />
                <p className="text-sm font-bold text-white capitalize">{pt}</p>
                {pt === "cash" && <p className="text-lg font-bold text-amber-400 mt-1">{formatPrice(finalTotal)}</p>}
                {pt === "credit" && <p className="text-lg font-bold text-amber-400 mt-1">{formatPrice(finalTotal)}</p>}
                {pt === "mixed" && <p className="text-xs text-neutral-400 mt-1">Split cash + credit</p>}
              </label>
            ))}
          </div>
        </div>

        {/* Mixed amounts */}
        {form.payoutType === "mixed" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-neutral-500 block mb-1">Cash Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cashAmount}
                onChange={(e) => setForm((prev) => ({ ...prev, cashAmount: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-[11px] text-neutral-500 block mb-1">Credit Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.creditAmount}
                onChange={(e) => setForm((prev) => ({ ...prev, creditAmount: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        {/* MINT bonus */}
        {hasMintItems && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.mintBonusApplied}
                onChange={(e) => setForm((prev) => ({ ...prev, mintBonusApplied: e.target.checked }))}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-sm text-neutral-300">MINT Bonus</span>
            </label>
            {form.mintBonusApplied && (
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.mintBonusAmount}
                onChange={(e) => setForm((prev) => ({ ...prev, mintBonusAmount: e.target.value }))}
                className={INPUT_CLS + " !w-28"}
              />
            )}
          </div>
        )}

        {/* Admin message */}
        <div>
          <label className="text-[11px] text-neutral-500 block mb-1">Message to Customer</label>
          <textarea
            placeholder="Great condition cards! / One card was LP so we adjusted..."
            value={form.adminMessage}
            onChange={(e) => setForm((prev) => ({ ...prev, adminMessage: e.target.value }))}
            rows={2}
            className={INPUT_CLS + " resize-none"}
          />
        </div>

        {/* Total breakdown */}
        <div className="border-t border-neutral-700 pt-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Items total ({items.filter((i) => !form.items[i.id]?.rejected).length} cards)</span>
            <span className="text-white">{formatPrice(itemsTotal)}</span>
          </div>
          {form.mintBonusApplied && mintBonus > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">MINT bonus</span>
              <span className="text-emerald-400">+{formatPrice(mintBonus)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-1">
            <span className="text-white">Final Total</span>
            <span className="text-amber-400">{formatPrice(finalTotal)}</span>
          </div>
          {form.payoutType === "mixed" && (
            <p className="text-xs text-neutral-500">
              Cash: {formatPrice(parseFloat(form.cashAmount || "0"))} + Credit: {formatPrice(parseFloat(form.creditAmount || "0"))}
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          onClick={handleSendQuote}
          disabled={sending || finalTotal <= 0}
          className="w-full py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "Sending..." : "Send Quotation"}
        </button>
      </div>
    </div>
  );
}

function QuotedView({ submission, items }: { submission: SubmissionRow; items: ItemRow[] }) {
  const countdown = useCountdown(submission.quote_expires_at);
  return (
    <div className="mt-4 space-y-4">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-blue-400">Quotation Sent</h4>
          {countdown && (
            <span className="text-xs text-blue-300 font-mono">{countdown}</span>
          )}
        </div>
        <p className="text-sm text-neutral-300">Waiting for customer response.</p>
        {submission.admin_message && (
          <p className="text-xs text-neutral-400 mt-2 italic">&quot;{submission.admin_message}&quot;</p>
        )}
      </div>

      {/* Quoted prices alongside originals */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="text-neutral-500 text-xs uppercase tracking-wide">
              <th className="text-left py-2">Card</th>
              <th className="text-center py-2 w-12">Qty</th>
              <th className="text-right py-2 w-24">Original</th>
              <th className="text-right py-2 w-24">Quoted</th>
              <th className="text-center py-2 w-16">Cond.</th>
              <th className="text-center py-2 w-16">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const orig =
                submission.payment_method === "cash"
                  ? parseFloat(item.quoted_cash_price || "0")
                  : parseFloat(item.quoted_credit_price || "0");
              const quoted = item.admin_price != null ? parseFloat(item.admin_price) : orig;
              const changed = quoted !== orig;
              return (
                <tr key={item.id} className={`border-t border-neutral-800 ${item.rejected ? "opacity-40 line-through" : ""}`}>
                  <td className="py-2 text-white">
                    {item.name}
                    <span className="text-neutral-500 ml-2 text-xs hidden sm:inline">{item.card_number}{item.game ? ` (${item.game})` : ""}</span>
                  </td>
                  <td className="py-2 text-center text-neutral-300">{item.quantity}</td>
                  <td className="py-2 text-right text-neutral-500 whitespace-nowrap">
                    {formatPrice(orig * item.quantity)}
                  </td>
                  <td className={`py-2 text-right whitespace-nowrap font-medium ${changed ? "text-amber-400" : "text-neutral-300"}`}>
                    {item.rejected ? "—" : formatPrice(quoted * item.quantity)}
                  </td>
                  <td className="py-2 text-center text-xs text-neutral-400">
                    {item.admin_condition || "NM"}
                  </td>
                  <td className="py-2 text-center">
                    {item.rejected ? (
                      <span className="text-xs text-red-400">Rejected</span>
                    ) : (
                      <span className="text-xs text-emerald-400">Included</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-400">Payout type</span>
          <span className="text-white capitalize">{submission.payout_type || submission.payment_method}</span>
        </div>
        {submission.cash_amount && parseFloat(submission.cash_amount) > 0 && (
          <div className="flex justify-between">
            <span className="text-neutral-400">Cash</span>
            <span className="text-white">{formatPrice(parseFloat(submission.cash_amount))}</span>
          </div>
        )}
        {submission.credit_amount && parseFloat(submission.credit_amount) > 0 && (
          <div className="flex justify-between">
            <span className="text-neutral-400">Credit</span>
            <span className="text-white">{formatPrice(parseFloat(submission.credit_amount))}</span>
          </div>
        )}
        {submission.mint_bonus_applied && submission.mint_bonus_amount && (
          <div className="flex justify-between">
            <span className="text-neutral-400">MINT bonus</span>
            <span className="text-emerald-400">+{formatPrice(parseFloat(submission.mint_bonus_amount))}</span>
          </div>
        )}
        <div className="flex justify-between font-bold pt-1 border-t border-neutral-700">
          <span className="text-white">Final Total</span>
          <span className="text-amber-400">{formatPrice(parseFloat(submission.final_total || submission.quoted_cash_total || submission.quoted_credit_total || "0"))}</span>
        </div>
      </div>
    </div>
  );
}

function AcceptedView({ submission }: { submission: SubmissionRow }) {
  return (
    <div className="mt-4">
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
        <h4 className="text-sm font-bold text-emerald-400 mb-1">Customer Accepted</h4>
        <p className="text-sm text-neutral-300">
          The customer has accepted the quotation.
          {submission.delivery_method === "mail"
            ? " Waiting for cards to arrive by post."
            : " Customer will drop off cards in-store."}
        </p>
        <div className="mt-3 text-xs text-neutral-400 space-y-0.5">
          <p>Payout: <span className="text-white capitalize">{submission.payout_type || submission.payment_method}</span></p>
          <p>Total: <span className="text-amber-400 font-bold">{formatPrice(parseFloat(submission.final_total || submission.quoted_cash_total || submission.quoted_credit_total || "0"))}</span></p>
        </div>
      </div>
    </div>
  );
}

function DeclinedView() {
  return (
    <div className="mt-4">
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
        <h4 className="text-sm font-bold text-red-400 mb-1">Customer Declined</h4>
        <p className="text-sm text-neutral-300">The customer has declined this quotation.</p>
      </div>
    </div>
  );
}

function ExpiredView() {
  return (
    <div className="mt-4">
      <div className="bg-neutral-500/10 border border-neutral-600 rounded-xl p-4">
        <h4 className="text-sm font-bold text-neutral-400 mb-1">Quote Expired</h4>
        <p className="text-sm text-neutral-400">This quotation has expired without a response.</p>
      </div>
    </div>
  );
}

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
                      <span className="text-xs text-neutral-500">Customer Notes</span>
                      <p className="text-sm text-neutral-300 mt-1">{s.notes}</p>
                    </div>
                  )}

                  {/* Status-aware content */}
                  {s.status === "submitted" && (
                    <>
                      {/* Original items table */}
                      <div className="overflow-x-auto mb-2">
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
                                  <span className="text-neutral-500 ml-2 text-xs hidden sm:inline">{item.card_number}{item.game ? ` (${item.game})` : ""}</span>
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

                      {/* Quotation form */}
                      <QuotationForm
                        submission={s}
                        items={items}
                        onQuoteSent={fetchSubmissions}
                      />
                    </>
                  )}

                  {s.status === "quoted" && (
                    <QuotedView submission={s} items={items} />
                  )}

                  {s.status === "accepted" && (
                    <>
                      <QuotedView submission={s} items={items} />
                      <AcceptedView submission={s} />
                    </>
                  )}

                  {s.status === "declined" && (
                    <>
                      <QuotedView submission={s} items={items} />
                      <DeclinedView />
                    </>
                  )}

                  {s.status === "expired" && (
                    <>
                      <QuotedView submission={s} items={items} />
                      <ExpiredView />
                    </>
                  )}

                  {/* For other statuses (received, grading, approved, paid, etc.) show original items table */}
                  {!["submitted", "quoted", "accepted", "declined", "expired"].includes(s.status) && (
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
                                <span className="text-neutral-500 ml-2 text-xs hidden sm:inline">{item.card_number}{item.game ? ` (${item.game})` : ""}</span>
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
                  )}

                  {/* Status update */}
                  <div className="flex items-center gap-2 flex-wrap mt-4">
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
