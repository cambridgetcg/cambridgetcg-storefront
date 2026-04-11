"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { formatPrice } from "@/lib/format";
import type { OrderBookEntry, MarketTrade } from "@/lib/market/types";
import type { UnifiedMarketView } from "@/lib/market/unified";

const CONDITIONS = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
];

type UnifiedAsk = OrderBookEntry & { is_house?: boolean };
type UnifiedBid = OrderBookEntry & { is_house?: boolean; is_credit?: boolean; label?: string };

function OrderBookViz({ bids, asks }: { bids: UnifiedBid[]; asks: UnifiedAsk[] }) {
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
  bid?: UnifiedBid;
  ask?: UnifiedAsk;
  maxBidQty: number;
  maxAskQty: number;
  isFirst: boolean;
}) {
  const isHouse = ask?.is_house;
  const askBgColor = isHouse ? "bg-amber-500/10" : "bg-red-500/20";
  const askTextColor = isHouse ? "text-amber-400" : "text-red-400";
  const askBorderColor = isFirst
    ? isHouse ? "border-l-2 border-amber-500/40" : "border-l-2 border-red-500/40"
    : "border-l border-neutral-800";

  const isBidHouse = bid?.is_house && bid?.is_credit;
  const bidBgColor = isBidHouse ? "bg-purple-500/20" : "bg-emerald-500/20";
  const bidTextColor = isBidHouse ? "text-purple-400" : "text-emerald-400";
  const bidBorderColor = isFirst
    ? isBidHouse ? "border-r-2 border-purple-500/40" : "border-r-2 border-emerald-500/40"
    : "border-r border-neutral-800";

  return (
    <>
      {/* Bid cell */}
      <div className={`relative h-8 flex items-center ${bidBorderColor}`}>
        {bid ? (
          <>
            <div
              className={`absolute inset-y-0 right-0 ${bidBgColor} rounded-l`}
              style={{ width: `${(Math.min(bid.total_quantity, maxBidQty) / maxBidQty) * 100}%` }}
            />
            <span className="relative z-10 w-full flex justify-between px-2 text-xs font-mono">
              <span className="text-neutral-400">{isBidHouse ? "\u221E" : bid.total_quantity}</span>
              <span className={`${bidTextColor} font-medium flex items-center gap-1`}>
                {isBidHouse && <span title="CTCG Store Credit">&#127978;</span>}
                {formatPrice(Number(bid.price))}
                {isBidHouse && <span className="text-[10px] text-purple-400/80 font-sans font-semibold">CTCG</span>}
                {isBidHouse && <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1 py-px rounded font-sans">credit</span>}
              </span>
            </span>
          </>
        ) : (
          <span className="w-full text-center text-neutral-700 text-xs">—</span>
        )}
      </div>
      {/* Ask cell */}
      <div className={`relative h-8 flex items-center ${askBorderColor}`}>
        {ask ? (
          <>
            <div
              className={`absolute inset-y-0 left-0 ${askBgColor} rounded-r`}
              style={{ width: `${(ask.total_quantity / maxAskQty) * 100}%` }}
            />
            <span className="relative z-10 w-full flex justify-between px-2 text-xs font-mono">
              <span className={`${askTextColor} font-medium flex items-center gap-1`}>
                {isHouse && <span title="CTCG stock">&#127978;</span>}
                {formatPrice(Number(ask.price))}
                {isHouse && <span className="text-[10px] text-amber-500/80 font-sans font-semibold">CTCG</span>}
              </span>
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

/** Spot price + market price info panel */
function SpotPricePanel({ view }: { view: UnifiedMarketView }) {
  const { spot_price, spot_stock, market_price, p2p_discount, tradein_credit, tradein_cash } = view;

  return (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-lg p-3 mb-4 space-y-2">
      {/* CTCG Spot */}
      {spot_price != null ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">CTCG Spot</span>
          <span className="text-sm font-mono text-amber-400 font-bold">
            {formatPrice(spot_price)}
            <span className="text-xs text-neutral-500 font-normal ml-1.5">
              ({spot_stock} in stock)
            </span>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">CTCG Spot</span>
          <span className="text-xs text-neutral-600">Not available</span>
        </div>
      )}

      {/* Market Price */}
      {market_price != null && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">Market Price</span>
          <span className="text-sm font-mono text-white font-bold">
            {formatPrice(market_price)}
            {p2p_discount != null && p2p_discount > 0 && (
              <span className="ml-1.5 text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {p2p_discount}% below spot
              </span>
            )}
          </span>
        </div>
      )}

      {/* CTCG two-sided spread */}
      {spot_price != null && tradein_credit != null && (
        <div className="border-t border-neutral-800 pt-2 mt-2 space-y-1.5">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide">CTCG Spread</span>
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">CTCG Sells at</span>
            <span className="text-xs font-mono text-amber-400 font-semibold">{formatPrice(spot_price)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">CTCG Buys at</span>
            <span className="text-xs font-mono text-purple-400 font-semibold">
              {formatPrice(tradein_credit)}
              <span className="ml-1 text-[9px] bg-purple-500/20 text-purple-400 px-1 py-px rounded">credit</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Spread</span>
            <span className="text-xs font-mono text-neutral-500">{formatPrice(spot_price - tradein_credit)}</span>
          </div>
        </div>
      )}

      {/* Trade-in reference (when no full spread available) */}
      {spot_price == null && (tradein_credit != null || tradein_cash != null) && (
        <div className="border-t border-neutral-800 pt-2 mt-2 space-y-1">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide">Trade-in reference</span>
          {tradein_credit != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">Trade-in credit</span>
              <span className="text-xs font-mono text-purple-400">~{formatPrice(tradein_credit)}</span>
            </div>
          )}
          {tradein_cash != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">Trade-in cash</span>
              <span className="text-xs font-mono text-neutral-300">~{formatPrice(tradein_cash)}</span>
            </div>
          )}
        </div>
      )}

      {/* Cash trade-in (shown alongside spread if available) */}
      {spot_price != null && tradein_cash != null && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">Cash trade-in</span>
          <span className="text-xs font-mono text-neutral-300">~{formatPrice(tradein_cash)}</span>
        </div>
      )}
    </div>
  );
}

/** Buy routing info — tells user where they're buying from */
function BuyRoutingInfo({ view }: { view: UnifiedMarketView }) {
  const { asks, spot_price } = view;
  if (asks.length === 0) return null;

  const bestAsk = asks[0];
  const bestPrice = Number(bestAsk.price);
  const isHouse = bestAsk.is_house;

  if (isHouse) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300">
        &#127978; Buy from CTCG at {formatPrice(bestPrice)} (guaranteed stock)
      </div>
    );
  }

  // P2P seller — show savings vs CTCG if spot exists
  if (spot_price != null && bestPrice < spot_price) {
    const savings = spot_price - bestPrice;
    return (
      <div className="text-xs px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
        Buy from seller at {formatPrice(bestPrice)} (save {formatPrice(savings)} vs CTCG spot)
      </div>
    );
  }

  return (
    <div className="text-xs px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300">
      Buy from seller at {formatPrice(bestPrice)}
    </div>
  );
}

export default function CardMarketPage() {
  const params = useParams();
  const sku = params.sku as string;

  const [book, setBook] = useState<UnifiedMarketView | null>(null);
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
      const res = await fetch(`/api/market/${sku}/unified`);
      if (!res.ok) throw new Error("Not found");
      const data: UnifiedMarketView = await res.json();
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
      if (!res.ok) {
        if (res.status === 403 && data.code === "VERIFICATION_REQUIRED") {
          setResult({
            success: false,
            message: "__VERIFICATION_REQUIRED__",
          });
          return;
        }
        throw new Error(data.error || "Failed to place order");
      }
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
          {/* Left: Card image + spot info */}
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

            {/* Spot price panel below card image */}
            <div className="mt-4">
              <SpotPricePanel view={book} />
            </div>
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

            {/* Buy routing info */}
            <div className="mb-4">
              <BuyRoutingInfo view={book} />
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
              {tab === "buy" && book.spot_price != null && (
                <span className="ml-2 text-amber-400/70">
                  (CTCG Spot: {formatPrice(book.spot_price)})
                </span>
              )}
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
                    {result.message === "__VERIFICATION_REQUIRED__" ? (
                      <span>
                        UK verification required to trade.{" "}
                        <Link href="/account/verify" className="underline font-medium hover:text-amber-400">
                          Verify your identity
                        </Link>
                      </span>
                    ) : (
                      result.message
                    )}
                  </div>
                )}
              </form>
            )}

            {/* Sell to CTCG section */}
            {book.tradein_credit != null && book.tradein_credit > 0 && (
              <div className="mt-4 bg-purple-500/5 border border-purple-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">&#127978;</span>
                  <h3 className="text-sm font-bold text-white">Sell to Cambridge TCG</h3>
                </div>
                <p className="text-xs text-neutral-400 mb-2">We&apos;ll buy this card for:</p>
                <p className="text-xl font-bold text-purple-400 mb-1">
                  {formatPrice(book.tradein_credit)}{" "}
                  <span className="text-sm bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-semibold">
                    Store Credit
                  </span>
                </p>
                <p className="text-[11px] text-neutral-500 mt-2 mb-4 leading-relaxed">
                  Store credit can only be used to buy from our store. Instant credit to your account.
                </p>
                <Link
                  href="/trade-in"
                  className="block w-full text-center py-2.5 rounded-lg font-bold text-sm bg-purple-600 text-white hover:bg-purple-500 transition"
                >
                  Sell for Store Credit
                </Link>
              </div>
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
