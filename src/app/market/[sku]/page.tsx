"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { formatPrice } from "@/lib/format";
import type { CardOrderBook, OrderBookEntry, MarketTrade } from "@/lib/market/types";

const CONDITIONS = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
];

function DepthBar({ quantity, maxQuantity, side }: { quantity: number; maxQuantity: number; side: "bid" | "ask" }) {
  const pct = maxQuantity > 0 ? (quantity / maxQuantity) * 100 : 0;
  const color = side === "bid" ? "bg-emerald-500/25" : "bg-red-500/25";
  return (
    <div className="relative h-8 flex items-center">
      <div
        className={`absolute inset-y-0 ${side === "bid" ? "right-0" : "left-0"} ${color} rounded`}
        style={{ width: `${pct}%` }}
      />
      <span className="relative z-10 w-full flex justify-between px-2 text-xs font-mono">
        {side === "bid" ? (
          <>
            <span className="text-neutral-400">{quantity}</span>
            <span className="text-emerald-400 font-medium">{formatPrice(Number(quantity))}</span>
          </>
        ) : (
          <>
            <span className="text-red-400 font-medium">{formatPrice(Number(quantity))}</span>
            <span className="text-neutral-400">{quantity}</span>
          </>
        )}
      </span>
    </div>
  );
}

function OrderBookViz({ bids, asks }: { bids: OrderBookEntry[]; asks: OrderBookEntry[] }) {
  const maxBidQty = Math.max(1, ...bids.map((b) => b.total_quantity));
  const maxAskQty = Math.max(1, ...asks.map((a) => a.total_quantity));
  const maxRows = Math.max(bids.length, asks.length, 1);

  return (
    <div className="grid grid-cols-2 gap-1">
      {/* Bids header */}
      <div className="flex justify-between px-2 text-[10px] text-neutral-500 uppercase tracking-wide mb-1">
        <span>Qty</span>
        <span>Bid</span>
      </div>
      {/* Asks header */}
      <div className="flex justify-between px-2 text-[10px] text-neutral-500 uppercase tracking-wide mb-1">
        <span>Ask</span>
        <span>Qty</span>
      </div>

      {/* Rows */}
      {Array.from({ length: maxRows }).map((_, i) => (
        <BidAskRow key={i} bid={bids[i]} ask={asks[i]} maxBidQty={maxBidQty} maxAskQty={maxAskQty} isFirst={i === 0} />
      ))}
    </div>
  );
}

function BidAskRow({
  bid,
  ask,
  maxBidQty,
  maxAskQty,
  isFirst,
}: {
  bid?: OrderBookEntry;
  ask?: OrderBookEntry;
  maxBidQty: number;
  maxAskQty: number;
  isFirst: boolean;
}) {
  return (
    <>
      {/* Bid cell */}
      <div className={`relative h-8 flex items-center ${isFirst ? "border-r-2 border-emerald-500/40" : "border-r border-neutral-800"}`}>
        {bid ? (
          <>
            <div
              className="absolute inset-y-0 right-0 bg-emerald-500/20 rounded-l"
              style={{ width: `${(bid.total_quantity / maxBidQty) * 100}%` }}
            />
            <span className="relative z-10 w-full flex justify-between px-2 text-xs font-mono">
              <span className="text-neutral-400">{bid.total_quantity}</span>
              <span className="text-emerald-400 font-medium">{formatPrice(Number(bid.price))}</span>
            </span>
          </>
        ) : (
          <span className="w-full text-center text-neutral-700 text-xs">—</span>
        )}
      </div>
      {/* Ask cell */}
      <div className={`relative h-8 flex items-center ${isFirst ? "border-l-2 border-red-500/40" : "border-l border-neutral-800"}`}>
        {ask ? (
          <>
            <div
              className="absolute inset-y-0 left-0 bg-red-500/20 rounded-r"
              style={{ width: `${(ask.total_quantity / maxAskQty) * 100}%` }}
            />
            <span className="relative z-10 w-full flex justify-between px-2 text-xs font-mono">
              <span className="text-red-400 font-medium">{formatPrice(Number(ask.price))}</span>
              <span className="text-neutral-400">{ask.total_quantity}</span>
            </span>
          </>
        ) : (
          <span className="w-full text-center text-neutral-700 text-xs">—</span>
        )}
      </div>
    </>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function CardMarketPage() {
  const params = useParams();
  const sku = params.sku as string;

  const [book, setBook] = useState<CardOrderBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Order form state
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState("Near Mint");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchBook = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/${sku}`);
      if (!res.ok) throw new Error("Not found");
      const data: CardOrderBook = await res.json();
      setBook(data);
      setError("");
    } catch {
      setError("Could not load order book.");
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    fetchBook();
    pollRef.current = setInterval(fetchBook, 10000);
    return () => clearInterval(pollRef.current);
  }, [fetchBook]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => setLoggedIn(!!data?.user?.email))
      .catch(() => setLoggedIn(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/market/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side: tab === "buy" ? "bid" : "ask",
          sku,
          price: parseFloat(price),
          quantity: parseInt(quantity, 10),
          condition,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to place order");
      const matchMsg = data.matched
        ? ` Matched ${data.trades?.length || 0} trade(s) immediately!`
        : "";
      setResult({ success: true, message: `Order placed.${matchMsg}` });
      setPrice("");
      setQuantity("1");
      fetchBook();
    } catch (err: any) {
      setResult({ success: false, message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  // Spread calculation
  const spread =
    book?.best_bid && book?.best_ask
      ? (Number(book.best_ask) - Number(book.best_bid)).toFixed(2)
      : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-neutral-800 rounded w-64" />
            <div className="grid md:grid-cols-3 gap-6">
              <div className="aspect-[2.5/3.5] bg-neutral-800 rounded-xl" />
              <div className="bg-neutral-900 rounded-xl h-96" />
              <div className="bg-neutral-900 rounded-xl h-96" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">Order book not found</h2>
          <p className="text-neutral-400 mb-4">{error || "This card has no market activity."}</p>
          <Link href="/market" className="text-amber-400 hover:underline text-sm">
            Back to Market
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="mb-6 text-sm">
          <Link href="/market" className="text-amber-400 hover:underline">Market</Link>
          <span className="text-neutral-600 mx-2">/</span>
          <span className="text-neutral-400">{book.card_name || sku}</span>
        </div>

        {/* Main layout */}
        <div className="grid md:grid-cols-[240px_1fr_320px] gap-6">
          {/* Left: Card image */}
          <div>
            {book.image_url ? (
              <img
                src={book.image_url}
                alt={book.card_name || sku}
                className="w-full rounded-xl border border-neutral-800"
              />
            ) : (
              <div className="aspect-[2.5/3.5] w-full bg-neutral-900 rounded-xl border border-neutral-800 flex items-center justify-center">
                <span className="text-neutral-600">No Image</span>
              </div>
            )}
            <h1 className="text-lg font-bold text-white mt-4">{book.card_name || sku}</h1>
            <p className="text-xs text-neutral-500 font-mono">{sku}</p>
          </div>

          {/* Center: Order book */}
          <div className="bg-neutral-900 rounded-xl p-4">
            <h2 className="text-sm font-bold text-white mb-1">Order Book</h2>

            {/* Spread indicator */}
            <div className="flex items-center gap-3 mb-4 text-xs">
              <span className="text-emerald-400">
                Best Bid: {book.best_bid ? formatPrice(Number(book.best_bid)) : "—"}
              </span>
              {spread && (
                <span className="px-2 py-0.5 bg-neutral-800 rounded text-neutral-400">
                  Spread: {formatPrice(Number(spread))}
                </span>
              )}
              <span className="text-red-400">
                Best Ask: {book.best_ask ? formatPrice(Number(book.best_ask)) : "—"}
              </span>
            </div>

            {book.bids.length === 0 && book.asks.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 text-sm">
                No orders yet. Be the first to post!
              </div>
            ) : (
              <OrderBookViz bids={book.bids} asks={book.asks} />
            )}
          </div>

          {/* Right: Order form */}
          <div className="bg-neutral-900 rounded-xl p-4">
            <div className="flex mb-4 bg-neutral-800 rounded-lg p-1">
              <button
                onClick={() => { setTab("buy"); setResult(null); }}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition ${
                  tab === "buy"
                    ? "bg-emerald-500 text-black"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => { setTab("sell"); setResult(null); }}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition ${
                  tab === "sell"
                    ? "bg-red-500 text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Sell
              </button>
            </div>

            {/* Reference price */}
            <div className="mb-4 text-xs text-neutral-400">
              {tab === "buy"
                ? `Best ask: ${book.best_ask ? formatPrice(Number(book.best_ask)) : "—"}`
                : `Best bid: ${book.best_bid ? formatPrice(Number(book.best_bid)) : "—"}`}
            </div>

            {loggedIn === false ? (
              <div className="text-center py-8">
                <p className="text-neutral-400 text-sm mb-3">You need to be signed in to trade.</p>
                <Link
                  href="/login"
                  className="text-amber-400 hover:underline text-sm font-medium"
                >
                  Sign in to trade
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Price (GBP)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">£</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      required
                      className="w-full pl-7 pr-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs text-neutral-500 mb-1">Condition</label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Total preview */}
                {price && quantity && (
                  <div className="text-xs text-neutral-400 text-right">
                    Total: {formatPrice(parseFloat(price) * parseInt(quantity, 10) || 0)}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || loggedIn === null}
                  className={`w-full py-3 rounded-lg font-bold text-sm transition disabled:opacity-50 ${
                    tab === "buy"
                      ? "bg-emerald-500 text-black hover:bg-emerald-400"
                      : "bg-red-500 text-white hover:bg-red-400"
                  }`}
                >
                  {submitting
                    ? "Submitting..."
                    : tab === "buy"
                    ? "Place Bid"
                    : "Place Ask"}
                </button>

                {result && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      result.success
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-red-500/15 text-red-400 border border-red-500/30"
                    }`}
                  >
                    {result.message}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Recent trades */}
        <div className="mt-8 bg-neutral-900 rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-4">Recent Trades</h2>
          {book.recent_trades.length === 0 ? (
            <p className="text-neutral-500 text-sm py-4 text-center">No trades yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-800">
                    <th className="text-left py-2 font-medium">Price</th>
                    <th className="text-left py-2 font-medium">Quantity</th>
                    <th className="text-right py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {book.recent_trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-neutral-800/50">
                      <td className="py-2 text-white font-mono">
                        {formatPrice(Number(trade.price))}
                      </td>
                      <td className="py-2 text-neutral-300">{trade.quantity}</td>
                      <td className="py-2 text-neutral-500 text-right text-xs">
                        {formatTime(trade.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
