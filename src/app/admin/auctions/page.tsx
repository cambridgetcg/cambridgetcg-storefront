"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

interface AuctionSummary {
  id: string;
  title: string;
  auction_type: "english" | "dutch" | "buy_now";
  status: string;
  current_price: string;
  starting_price: string;
  buy_now_price: string | null;
  bid_count: number;
  starts_at: string;
  ends_at: string;
  image_url: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-500/20 text-neutral-400",
  scheduled: "bg-blue-500/20 text-blue-400",
  live: "bg-emerald-500/20 text-emerald-400",
  ended: "bg-amber-500/20 text-amber-400",
  paid: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
};

const TYPE_LABELS: Record<string, string> = {
  english: "English",
  dutch: "Dutch",
  buy_now: "Buy Now",
};

const STATUSES = ["draft", "scheduled", "live", "ended", "paid", "cancelled"];

export default function AdminAuctionsPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [auctions, setAuctions] = useState<AuctionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchAuctions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auctions?limit=200");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      setAuctions(data.auctions || []);
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
          fetchAuctions();
        }
      });
  }, [fetchAuctions]);

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
      fetchAuctions();
    } catch {
      setLoginError("Network error.");
    }
  }

  async function handleStatusChange(id: string, newStatus: string) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/auctions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setAuctions((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
        );
      }
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this draft auction?")) return;
    try {
      const res = await fetch(`/api/auctions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAuctions((prev) => prev.filter((a) => a.id !== id));
        setExpanded(null);
      }
    } catch {
      // ignore
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

  // ── Stats ──
  const total = auctions.length;
  const live = auctions.filter((a) => a.status === "live").length;
  const ended = auctions.filter((a) => a.status === "ended" || a.status === "paid").length;

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Auctions</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchAuctions}
              disabled={loading}
              className="px-4 py-2 bg-neutral-800 text-white text-sm rounded-lg hover:bg-neutral-700 transition disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <Link
              href="/admin/auctions/new"
              className="px-4 py-2 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition"
            >
              New Auction
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold text-white mt-1">{total}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Live</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{live}</p>
          </div>
          <div className="bg-neutral-900 rounded-xl p-4">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Ended</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{ended}</p>
          </div>
        </div>

        {/* Auction list */}
        {auctions.length === 0 && !loading && (
          <p className="text-neutral-500 text-center py-12">No auctions yet.</p>
        )}

        <div className="space-y-3">
          {auctions.map((a) => (
            <div key={a.id} className="bg-neutral-900 rounded-xl overflow-hidden">
              {/* Row */}
              <button
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                className="w-full px-4 py-4 flex items-center gap-4 text-left hover:bg-neutral-800/50 transition"
              >
                {a.image_url && (
                  <img
                    src={a.image_url}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold text-white truncate">{a.title}</span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        STATUS_COLORS[a.status] || "bg-neutral-700 text-neutral-300"
                      }`}
                    >
                      {a.status}
                    </span>
                    <span className="text-xs text-neutral-500">{TYPE_LABELS[a.auction_type] || a.auction_type}</span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    {a.bid_count} bid{a.bid_count !== 1 ? "s" : ""} &middot; ends{" "}
                    {new Date(a.ends_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-white">
                    {formatPrice(parseFloat(a.current_price))}
                  </p>
                  {a.buy_now_price && (
                    <p className="text-xs text-neutral-500">
                      BIN {formatPrice(parseFloat(a.buy_now_price))}
                    </p>
                  )}
                </div>
                <span className="text-neutral-600 text-sm">{expanded === a.id ? "▲" : "▼"}</span>
              </button>

              {/* Expanded detail */}
              {expanded === a.id && (
                <div className="px-4 pb-4 border-t border-neutral-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 mb-4 text-sm">
                    <div>
                      <span className="text-neutral-500">Starting Price</span>
                      <p className="text-white">{formatPrice(parseFloat(a.starting_price))}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Current Price</span>
                      <p className="text-white">{formatPrice(parseFloat(a.current_price))}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Bids</span>
                      <p className="text-white">{a.bid_count}</p>
                    </div>
                    <div>
                      <span className="text-neutral-500">Starts</span>
                      <p className="text-white">
                        {new Date(a.starts_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Status update */}
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <span className="text-xs text-neutral-500">Update status:</span>
                    {STATUSES.map((st) => (
                      <button
                        key={st}
                        onClick={() => handleStatusChange(a.id, st)}
                        disabled={a.status === st || updating === a.id}
                        className={`text-xs px-2 py-1 rounded-full transition ${
                          a.status === st
                            ? STATUS_COLORS[st] + " font-bold"
                            : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                        } disabled:opacity-50`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  {a.status === "draft" && (
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="text-xs px-3 py-1 bg-red-500/20 text-red-400 rounded-full hover:bg-red-500/30 transition"
                    >
                      Delete Draft
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
