"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { formatPrice } from "@/lib/format";
import type { OrderBookSummary } from "@/lib/market/types";

function SkeletonCard() {
  return (
    <div className="bg-neutral-900 rounded-xl p-4 animate-pulse">
      <div className="aspect-[2.5/3.5] bg-neutral-800 rounded-lg mb-3" />
      <div className="h-4 bg-neutral-800 rounded w-3/4 mb-2" />
      <div className="h-3 bg-neutral-800 rounded w-1/2 mb-4" />
      <div className="flex justify-between">
        <div className="h-4 bg-neutral-800 rounded w-16" />
        <div className="h-4 bg-neutral-800 rounded w-16" />
      </div>
    </div>
  );
}

export default function MarketPage() {
  const [cards, setCards] = useState<OrderBookSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 24;

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set("q", search);
      const res = await fetch(`/api/market?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setCards(data.cards);
      setTotal(data.total);
    } catch {
      setCards([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, offset]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSearch(query);
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-white mb-2">P2P Market</h1>
          <p className="text-neutral-400">Buy and sell cards directly with other collectors.</p>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cards by name, set, or SKU..."
              className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-white placeholder:text-neutral-500 focus:outline-none focus:border-amber-500/50 transition"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-amber-500 text-black font-bold rounded-xl hover:bg-amber-400 transition"
            >
              Search
            </button>
          </div>
        </form>

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && cards.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 opacity-30">📦</div>
            <h2 className="text-xl font-bold text-white mb-2">No active orders yet.</h2>
            <p className="text-neutral-400">Be the first to post!</p>
          </div>
        )}

        {/* Card grid */}
        {!loading && cards.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {cards.map((card) => (
                <Link
                  key={card.sku}
                  href={`/market/${card.sku}`}
                  className="bg-neutral-900 rounded-xl p-3 hover:bg-neutral-800/80 transition group"
                >
                  {/* Image */}
                  {card.image_url ? (
                    <img
                      src={card.image_url}
                      alt={card.card_name || card.sku}
                      className="aspect-[2.5/3.5] w-full object-cover rounded-lg mb-3 group-hover:scale-[1.02] transition"
                    />
                  ) : (
                    <div className="aspect-[2.5/3.5] w-full bg-neutral-800 rounded-lg mb-3 flex items-center justify-center">
                      <span className="text-neutral-600 text-xs">No Image</span>
                    </div>
                  )}

                  {/* Card info */}
                  <h3 className="text-sm font-semibold text-white truncate">
                    {card.card_name || card.sku}
                  </h3>
                  <p className="text-xs text-neutral-500 mb-3 truncate">
                    {card.set_name || card.set_code || "—"}
                  </p>

                  {/* Bid / Ask */}
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-emerald-400 font-medium">
                      Bid: {card.best_bid ? formatPrice(Number(card.best_bid)) : "—"}
                    </span>
                    <span className="text-red-400 font-medium">
                      Ask: {card.best_ask ? formatPrice(Number(card.best_ask)) : "—"}
                    </span>
                  </div>

                  {/* Spread & depth */}
                  <div className="flex justify-between text-[10px] text-neutral-500">
                    <span>
                      Spread: {card.spread != null ? `${card.spread.toFixed(1)}%` : "—"}
                    </span>
                    <span>{card.bid_depth}b / {card.ask_depth}a</span>
                  </div>

                  {/* Last trade */}
                  {card.last_trade_price && (
                    <p className="text-[10px] text-neutral-500 mt-1">
                      Last: {formatPrice(Number(card.last_trade_price))}
                    </p>
                  )}
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-4 py-2 bg-neutral-900 text-neutral-300 rounded-lg hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"
                >
                  Previous
                </button>
                <span className="text-sm text-neutral-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={currentPage >= totalPages}
                  className="px-4 py-2 bg-neutral-900 text-neutral-300 rounded-lg hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
