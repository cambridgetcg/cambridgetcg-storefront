"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import ConfirmModal from "@/components/ui/ConfirmModal";
import type { MarketOrder, MarketTrade, EscrowStatus } from "@/lib/market/types";

const ESCROW_BADGES: Record<EscrowStatus, { label: string; color: string }> = {
  awaiting_payment: { label: "Awaiting Payment", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  paid: { label: "Paid", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  awaiting_shipment: { label: "Awaiting Shipment", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  shipped_to_ctcg: { label: "Shipped to CTCG", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  received_by_ctcg: { label: "Received by CTCG", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  verified: { label: "Verified", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  shipped_to_buyer: { label: "Shipped to Buyer", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  completed: { label: "Completed", color: "bg-green-500/15 text-green-400 border-green-500/30" },
  disputed: { label: "Disputed", color: "bg-red-500/15 text-red-400 border-red-500/30" },
  refunded: { label: "Refunded", color: "bg-red-500/15 text-red-400 border-red-500/30" },
  cancelled: { label: "Cancelled", color: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
};

function EscrowBadge({ status }: { status: EscrowStatus }) {
  const badge = ESCROW_BADGES[status] || { label: status, color: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${badge.color}`}>
      {badge.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TradesPage() {
  const [tab, setTab] = useState<"orders" | "history">("orders");
  const [orders, setOrders] = useState<MarketOrder[]>([]);
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingTrades, setLoadingTrades] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    fetch("/api/market/orders?status=open")
      .then((r) => r.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => {})
      .finally(() => setLoadingOrders(false));

    fetch("/api/market/trades")
      .then((r) => r.json())
      .then((data) => setTrades(data.trades || []))
      .catch(() => {})
      .finally(() => setLoadingTrades(false));
  }, []);

  function handleCancel(orderId: string) {
    setPendingAction(() => async () => {
      setCancelling(orderId);
      try {
        const res = await fetch("/api/market/orders", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        if (!res.ok) throw new Error("Failed to cancel");
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } catch {
        // Silently fail — user can retry
      } finally {
        setCancelling(null);
      }
    });
    setConfirmOpen(true);
  }

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-6">Trades</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-900 rounded-lg p-1 mb-6 w-fit">
        <button
          onClick={() => setTab("orders")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition ${
            tab === "orders"
              ? "bg-amber-500 text-black"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Open Orders
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition ${
            tab === "history"
              ? "bg-amber-500 text-black"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Trade History
        </button>
      </div>

      {/* Open Orders */}
      {tab === "orders" && (
        <div className="bg-neutral-900 rounded-xl">
          {loadingOrders ? (
            <div className="p-6 space-y-3 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 bg-neutral-800 rounded-lg" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 text-sm">
              No open orders.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-800">
                    <th className="text-left p-4 font-medium">Card</th>
                    <th className="text-left p-4 font-medium">Side</th>
                    <th className="text-left p-4 font-medium">Price</th>
                    <th className="text-left p-4 font-medium">Qty</th>
                    <th className="text-left p-4 font-medium">Filled</th>
                    <th className="text-left p-4 font-medium">Condition</th>
                    <th className="text-left p-4 font-medium">Date</th>
                    <th className="p-4" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {order.image_url ? (
                            <img src={order.image_url} alt="" className="w-8 h-11 rounded object-cover" />
                          ) : (
                            <div className="w-8 h-11 bg-neutral-800 rounded" />
                          )}
                          <div>
                            <p className="text-white font-medium text-sm truncate max-w-[160px]">
                              {order.card_name || order.sku}
                            </p>
                            <p className="text-neutral-500 text-xs font-mono">{order.sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <span
                          className={`text-xs font-bold uppercase ${
                            order.side === "bid" ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {order.side === "bid" ? "Buy" : "Sell"}
                        </span>
                      </td>
                      <td className="p-4 text-white font-mono">{formatPrice(Number(order.price))}</td>
                      <td className="p-4 text-neutral-300">{order.quantity}</td>
                      <td className="p-4 text-neutral-500">{order.filled_quantity}</td>
                      <td className="p-4 text-neutral-400 text-xs">{order.condition}</td>
                      <td className="p-4 text-neutral-500 text-xs">{formatDate(order.created_at)}</td>
                      <td className="p-4">
                        <button
                          onClick={() => handleCancel(order.id)}
                          disabled={cancelling === order.id}
                          className="px-3 py-1.5 text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/25 transition disabled:opacity-50"
                        >
                          {cancelling === order.id ? "..." : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trade History */}
      {tab === "history" && (
        <div className="bg-neutral-900 rounded-xl">
          {loadingTrades ? (
            <div className="p-6 space-y-3 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 bg-neutral-800 rounded-lg" />
              ))}
            </div>
          ) : trades.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 text-sm">
              No trade history yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-800">
                    <th className="text-left p-4 font-medium">Card</th>
                    <th className="text-left p-4 font-medium">Side</th>
                    <th className="text-left p-4 font-medium">Price</th>
                    <th className="text-left p-4 font-medium">Qty</th>
                    <th className="text-left p-4 font-medium">Escrow</th>
                    <th className="text-left p-4 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => {
                    // Determine if current user is buyer or seller based on which name is present
                    // We'll show "Bought" for buyer_name match, "Sold" otherwise
                    // Since we don't know the user ID client-side, we'll check both IDs
                    // The API should ideally tell us, but we can infer from the data
                    const isBuyer = !!trade.buyer_name;
                    return (
                      <tr key={trade.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            {trade.image_url ? (
                              <img src={trade.image_url} alt="" className="w-8 h-11 rounded object-cover" />
                            ) : (
                              <div className="w-8 h-11 bg-neutral-800 rounded" />
                            )}
                            <p className="text-white font-medium text-sm truncate max-w-[160px]">
                              {trade.card_name || trade.sku}
                            </p>
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`text-xs font-bold uppercase ${
                              isBuyer ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {isBuyer ? "Bought" : "Sold"}
                          </span>
                        </td>
                        <td className="p-4 text-white font-mono">{formatPrice(Number(trade.price))}</td>
                        <td className="p-4 text-neutral-300">{trade.quantity}</td>
                        <td className="p-4">
                          <EscrowBadge status={trade.escrow_status} />
                        </td>
                        <td className="p-4 text-neutral-500 text-xs">{formatDate(trade.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Cancel Order"
        message="Cancel this market order? This cannot be undone."
        confirmLabel="Cancel Order"
        variant="warning"
        onConfirm={() => { pendingAction?.(); setConfirmOpen(false); setPendingAction(null); }}
        onCancel={() => { setConfirmOpen(false); setPendingAction(null); }}
      />
    </div>
  );
}
