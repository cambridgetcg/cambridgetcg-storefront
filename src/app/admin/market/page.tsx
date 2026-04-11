"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPrice } from "@/lib/format";
import type { MarketTrade, EscrowStatus } from "@/lib/market/types";

// ── Escrow status config ──

const ESCROW_COLORS: Record<EscrowStatus, string> = {
  awaiting_payment: "bg-amber-500/20 text-amber-400",
  paid: "bg-blue-500/20 text-blue-400",
  awaiting_shipment: "bg-amber-500/20 text-amber-400",
  shipped_to_ctcg: "bg-blue-500/20 text-blue-400",
  received_by_ctcg: "bg-purple-500/20 text-purple-400",
  verified: "bg-emerald-500/20 text-emerald-400",
  shipped_to_buyer: "bg-emerald-500/20 text-emerald-400",
  completed: "bg-green-500/20 text-green-400",
  disputed: "bg-red-500/20 text-red-400",
  refunded: "bg-red-500/20 text-red-400",
  cancelled: "bg-neutral-500/20 text-neutral-400",
};

const ESCROW_LABELS: Record<EscrowStatus, string> = {
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  awaiting_shipment: "Awaiting Shipment",
  shipped_to_ctcg: "Shipped to CTCG",
  received_by_ctcg: "Received by CTCG",
  verified: "Verified",
  shipped_to_buyer: "Shipped to Buyer",
  completed: "Completed",
  disputed: "Disputed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

type FilterTab = "all" | "awaiting_shipment" | "at_ctcg" | "disputed" | "completed";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "awaiting_shipment", label: "Awaiting Shipment" },
  { key: "at_ctcg", label: "At CTCG" },
  { key: "disputed", label: "Disputed" },
  { key: "completed", label: "Completed" },
];

// Map filter tab to the escrow statuses it includes
function matchesFilter(status: EscrowStatus, filter: FilterTab): boolean {
  switch (filter) {
    case "all":
      return true;
    case "awaiting_shipment":
      return status === "awaiting_shipment" || status === "shipped_to_ctcg";
    case "at_ctcg":
      return status === "received_by_ctcg" || status === "verified";
    case "disputed":
      return status === "disputed";
    case "completed":
      return status === "completed" || status === "refunded";
  }
}

// Transitions: current status → next status (with optional input requirement)
type Transition = {
  next: EscrowStatus;
  label: string;
  input?: "trackingToCtcg" | "trackingToBuyer" | "disputeReason";
};

function getTransitions(status: EscrowStatus): Transition[] {
  const transitions: Transition[] = [];

  switch (status) {
    case "awaiting_payment":
      transitions.push({ next: "paid", label: "Mark Paid" });
      break;
    case "paid":
      transitions.push({ next: "awaiting_shipment", label: "Awaiting Shipment" });
      break;
    case "awaiting_shipment":
      transitions.push({ next: "shipped_to_ctcg", label: "Shipped to CTCG", input: "trackingToCtcg" });
      break;
    case "shipped_to_ctcg":
      transitions.push({ next: "received_by_ctcg", label: "Mark Received" });
      break;
    case "received_by_ctcg":
      transitions.push({ next: "verified", label: "Mark Verified" });
      break;
    case "verified":
      transitions.push({ next: "shipped_to_buyer", label: "Ship to Buyer", input: "trackingToBuyer" });
      break;
    case "shipped_to_buyer":
      transitions.push({ next: "completed", label: "Mark Completed" });
      break;
    case "disputed":
      transitions.push({ next: "refunded", label: "Refund" });
      break;
  }

  // Any non-terminal status can be disputed
  if (!["completed", "refunded", "cancelled", "disputed"].includes(status)) {
    transitions.push({ next: "disputed", label: "Dispute", input: "disputeReason" });
  }

  return transitions;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminMarketPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  // Per-trade edit state
  const [editNotes, setEditNotes] = useState<Record<string, string>>({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/market/trades?admin=true");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      setTrades(data.trades || []);
      setAuthed(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

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
      fetchTrades();
    } catch {
      setLoginError("Network error.");
    }
  }

  async function handleAdvance(trade: MarketTrade, transition: Transition) {
    // Validate required inputs
    const inputKey = `${trade.id}_${transition.input}`;
    if (transition.input && !inputValues[inputKey]?.trim()) {
      return; // input required but empty
    }

    setUpdating(trade.id);
    try {
      const body: Record<string, string> = { status: transition.next };

      if (transition.input === "trackingToCtcg") {
        body.trackingToCtcg = inputValues[inputKey]?.trim() || "";
      } else if (transition.input === "trackingToBuyer") {
        body.trackingToBuyer = inputValues[inputKey]?.trim() || "";
      }

      const res = await fetch(`/api/market/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setTrades((prev) =>
          prev.map((t) => (t.id === trade.id ? { ...t, ...data.trade } : t))
        );
        // Clear input
        setInputValues((prev) => {
          const next = { ...prev };
          delete next[inputKey];
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  }

  async function handleSaveNotes(trade: MarketTrade) {
    setUpdating(trade.id);
    try {
      const res = await fetch(`/api/market/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: trade.escrow_status, adminNotes: editNotes[trade.id] ?? trade.admin_notes ?? "" }),
      });
      if (res.ok) {
        const data = await res.json();
        setTrades((prev) =>
          prev.map((t) => (t.id === trade.id ? { ...t, ...data.trade } : t))
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
          <h1 className="text-2xl font-bold text-white text-center mb-8">Market Admin</h1>
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

  // ── Stats ──
  const totalTrades = trades.length;
  const awaitingShipment = trades.filter((t) => t.escrow_status === "awaiting_shipment").length;
  const atCtcg = trades.filter((t) => t.escrow_status === "received_by_ctcg" || t.escrow_status === "verified").length;
  const completedCount = trades.filter((t) => t.escrow_status === "completed").length;

  const filtered = trades.filter((t) => matchesFilter(t.escrow_status, filter));

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">P2P Market Trades</h1>
          <button
            onClick={fetchTrades}
            disabled={loading}
            className="px-4 py-2 bg-neutral-800 text-white text-sm rounded-lg hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Trades</p>
            <p className="text-2xl font-bold text-white mt-1">{totalTrades}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Awaiting Shipment</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{awaitingShipment}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">At CTCG</p>
            <p className="text-2xl font-bold text-purple-400 mt-1">{atCtcg}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Completed</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{completedCount}</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`text-sm px-4 py-2 rounded-lg transition whitespace-nowrap ${
                filter === tab.key
                  ? "bg-amber-500 text-black font-bold"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Trade List */}
        {filtered.length === 0 && !loading && (
          <p className="text-neutral-500 text-center py-12">No trades found.</p>
        )}

        <div className="space-y-3">
          {filtered.map((trade) => {
            const isExpanded = expanded === trade.id;
            const transitions = getTransitions(trade.escrow_status);
            const notesValue = editNotes[trade.id] ?? trade.admin_notes ?? "";

            return (
              <div key={trade.id} className="bg-neutral-900 rounded-xl overflow-hidden">
                {/* Collapsed Row */}
                <button
                  onClick={() => setExpanded(isExpanded ? null : trade.id)}
                  className="w-full px-4 py-4 flex items-center gap-4 text-left hover:bg-neutral-800/50 transition"
                >
                  {/* Card Thumbnail */}
                  {trade.image_url ? (
                    <img
                      src={trade.image_url}
                      alt={trade.card_name || "Card"}
                      className="w-10 h-14 object-cover rounded shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-14 bg-neutral-800 rounded shrink-0 flex items-center justify-center">
                      <span className="text-neutral-600 text-xs">?</span>
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-bold text-white truncate">
                        {trade.card_name || trade.sku}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          ESCROW_COLORS[trade.escrow_status]
                        }`}
                      >
                        {ESCROW_LABELS[trade.escrow_status]}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-400 mt-1 truncate">
                      <span className="text-neutral-500">Seller:</span> {trade.seller_name || "Unknown"}{" "}
                      <span className="text-neutral-600 mx-1">-&gt;</span>{" "}
                      <span className="text-neutral-500">Buyer:</span> {trade.buyer_name || "Unknown"}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white">
                      {formatPrice(parseFloat(trade.price))}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatPrice(parseFloat(trade.commission_amount))} fee
                    </p>
                  </div>

                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-neutral-500">
                      {formatDate(trade.created_at)}
                    </p>
                  </div>

                  <span className="text-neutral-600 text-sm">{isExpanded ? "\u25B2" : "\u25BC"}</span>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-neutral-800">
                    {/* Buyer / Seller Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 mb-4">
                      <div className="bg-neutral-800/50 rounded-lg p-3">
                        <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Seller</p>
                        <p className="text-sm text-white">{trade.seller_name || "Unknown"}</p>
                        <p className="text-sm text-neutral-400">{trade.seller_email || "—"}</p>
                        <p className="text-xs text-neutral-500 mt-1">Payout: {formatPrice(parseFloat(trade.seller_payout))}</p>
                      </div>
                      <div className="bg-neutral-800/50 rounded-lg p-3">
                        <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Buyer</p>
                        <p className="text-sm text-white">{trade.buyer_name || "Unknown"}</p>
                        <p className="text-sm text-neutral-400">{trade.buyer_email || "—"}</p>
                        <p className="text-xs text-neutral-500 mt-1">Paid: {formatPrice(parseFloat(trade.price))}</p>
                      </div>
                    </div>

                    {/* Trade Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
                      <div>
                        <span className="text-neutral-500">Quantity</span>
                        <p className="text-white">{trade.quantity}</p>
                      </div>
                      <div>
                        <span className="text-neutral-500">Commission Rate</span>
                        <p className="text-white">{(parseFloat(trade.commission_rate) * 100).toFixed(1)}%</p>
                      </div>
                      <div>
                        <span className="text-neutral-500">SKU</span>
                        <p className="text-white font-mono text-xs">{trade.sku}</p>
                      </div>
                      <div>
                        <span className="text-neutral-500">Stripe PI</span>
                        <p className="text-white font-mono text-xs truncate">{trade.stripe_payment_intent || "—"}</p>
                      </div>
                    </div>

                    {/* Tracking Numbers */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm">
                      <div>
                        <span className="text-neutral-500">Tracking to CTCG</span>
                        <p className="text-white font-mono text-xs">{trade.tracking_to_ctcg || "—"}</p>
                      </div>
                      <div>
                        <span className="text-neutral-500">Tracking to Buyer</span>
                        <p className="text-white font-mono text-xs">{trade.tracking_to_buyer || "—"}</p>
                      </div>
                    </div>

                    {/* Escrow Timeline */}
                    <div className="mb-4">
                      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Escrow Timeline</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">Created</span>
                          <p className="text-neutral-300">{formatDate(trade.created_at)}</p>
                        </div>
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">Buyer Paid</span>
                          <p className="text-neutral-300">{formatDate(trade.buyer_paid_at)}</p>
                        </div>
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">Seller Shipped</span>
                          <p className="text-neutral-300">{formatDate(trade.seller_shipped_at)}</p>
                        </div>
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">CTCG Received</span>
                          <p className="text-neutral-300">{formatDate(trade.ctcg_received_at)}</p>
                        </div>
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">Verified</span>
                          <p className="text-neutral-300">{formatDate(trade.ctcg_verified_at)}</p>
                        </div>
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">Shipped to Buyer</span>
                          <p className="text-neutral-300">{formatDate(trade.shipped_to_buyer_at)}</p>
                        </div>
                        <div className="bg-neutral-800/30 rounded p-2">
                          <span className="text-neutral-500">Completed</span>
                          <p className="text-neutral-300">{formatDate(trade.completed_at)}</p>
                        </div>
                        {trade.dispute_reason && (
                          <div className="bg-red-500/10 rounded p-2">
                            <span className="text-red-400">Dispute Reason</span>
                            <p className="text-red-300">{trade.dispute_reason}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Escrow Actions */}
                    {transitions.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Actions</p>
                        <div className="flex flex-col gap-2">
                          {transitions.map((transition) => {
                            const inputKey = `${trade.id}_${transition.input}`;
                            return (
                              <div key={transition.next} className="flex items-center gap-2 flex-wrap">
                                {transition.input === "trackingToCtcg" && (
                                  <input
                                    type="text"
                                    placeholder="Tracking number to CTCG"
                                    value={inputValues[inputKey] || ""}
                                    onChange={(e) =>
                                      setInputValues((prev) => ({ ...prev, [inputKey]: e.target.value }))
                                    }
                                    className="px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 w-64"
                                  />
                                )}
                                {transition.input === "trackingToBuyer" && (
                                  <input
                                    type="text"
                                    placeholder="Tracking number to buyer"
                                    value={inputValues[inputKey] || ""}
                                    onChange={(e) =>
                                      setInputValues((prev) => ({ ...prev, [inputKey]: e.target.value }))
                                    }
                                    className="px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 w-64"
                                  />
                                )}
                                {transition.input === "disputeReason" && (
                                  <input
                                    type="text"
                                    placeholder="Dispute reason"
                                    value={inputValues[inputKey] || ""}
                                    onChange={(e) =>
                                      setInputValues((prev) => ({ ...prev, [inputKey]: e.target.value }))
                                    }
                                    className="px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 w-64"
                                  />
                                )}
                                <button
                                  onClick={() => handleAdvance(trade, transition)}
                                  disabled={
                                    updating === trade.id ||
                                    (!!transition.input && !inputValues[inputKey]?.trim())
                                  }
                                  className={`text-sm px-4 py-1.5 rounded-lg font-medium transition disabled:opacity-50 ${
                                    transition.next === "disputed" || transition.next === "refunded"
                                      ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                                      : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                                  }`}
                                >
                                  {transition.label}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Admin Notes */}
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Admin Notes</p>
                      <textarea
                        value={notesValue}
                        onChange={(e) =>
                          setEditNotes((prev) => ({ ...prev, [trade.id]: e.target.value }))
                        }
                        rows={3}
                        placeholder="Internal notes about this trade..."
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-y"
                      />
                      <button
                        onClick={() => handleSaveNotes(trade)}
                        disabled={updating === trade.id}
                        className="mt-2 px-4 py-2 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition disabled:opacity-50"
                      >
                        {updating === trade.id ? "Saving..." : "Save Notes"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
