"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DISPUTE_REASONS } from "@/lib/trust/types";
import type { TradeDispute, DisputeMessage } from "@/lib/trust/types";
import type { EscrowTier } from "@/lib/escrow/service-tiers";

// ── Escrow tier display ──

interface EscrowRoutingData {
  routing: {
    tier: EscrowTier;
    label: string;
    description: string;
    estimatedDays: string;
  };
  summary: string[];
}

const TIER_BADGE: Record<EscrowTier, { bg: string; text: string; border: string; label: string }> = {
  direct: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    label: "Seller ships to you directly",
  },
  verified: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
    label: "Photo-verified, seller ships to you",
  },
  full_escrow: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    label: "Ships through Cambridge TCG",
  },
};

const WORKFLOW_STEPS: Record<EscrowTier, string[]> = {
  direct: ["Paid", "Seller Ships", "Delivered", "Dispute Window", "Payout"],
  verified: ["Paid", "Photos Uploaded", "CTCG Reviews", "Seller Ships", "Delivered", "Payout"],
  full_escrow: ["Paid", "Seller Ships to CTCG", "CTCG Inspects", "CTCG Ships to Buyer", "Payout"],
};

// Map escrow_status values to the step index they correspond to
function getActiveStep(tier: EscrowTier, escrowStatus?: string): number {
  if (!escrowStatus) return 0;
  const s = escrowStatus.toLowerCase();

  if (tier === "direct") {
    if (s.includes("payout") || s === "complete") return 4;
    if (s.includes("dispute")) return 3;
    if (s.includes("deliver")) return 2;
    if (s.includes("ship") || s.includes("transit")) return 1;
    return 0;
  }
  if (tier === "verified") {
    if (s.includes("payout") || s === "complete") return 5;
    if (s.includes("deliver")) return 4;
    if (s.includes("ship") || s.includes("transit")) return 3;
    if (s.includes("review")) return 2;
    if (s.includes("photo")) return 1;
    return 0;
  }
  // full_escrow
  if (s.includes("payout") || s === "complete") return 4;
  if (s.includes("ctcg_ship") || s.includes("forwarded") || s.includes("shipped_to_buyer")) return 3;
  if (s.includes("inspect")) return 2;
  if (s.includes("ship") || s.includes("transit") || s.includes("received_ctcg")) return 1;
  return 0;
}

function EscrowTimeline({ tier, escrowStatus }: { tier: EscrowTier; escrowStatus?: string }) {
  const steps = WORKFLOW_STEPS[tier];
  const activeIdx = getActiveStep(tier, escrowStatus);
  const style = TIER_BADGE[tier];

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2">
      {steps.map((step, i) => {
        const isDone = i < activeIdx;
        const isCurrent = i === activeIdx;
        const dotColor = isDone
          ? "bg-emerald-400"
          : isCurrent
          ? style.bg.replace("/15", "") + " ring-2 ring-offset-1 ring-offset-neutral-900 " + style.border.replace("border-", "ring-")
          : "bg-neutral-700";
        const lineColor = isDone ? "bg-emerald-400/50" : "bg-neutral-700";
        const textColor = isDone ? "text-emerald-400" : isCurrent ? style.text : "text-neutral-600";

        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center min-w-[80px]">
              <div
                className={`w-3 h-3 rounded-full ${
                  isDone
                    ? "bg-emerald-400"
                    : isCurrent
                    ? `${style.text.replace("text-", "bg-").replace("400", "400")} ring-2 ring-offset-1 ring-offset-neutral-900 ${style.border.replace("border", "ring")}`
                    : "bg-neutral-700"
                }`}
              />
              <span className={`text-[10px] mt-1.5 text-center leading-tight ${textColor}`}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-6 shrink-0 ${lineColor} -mt-4`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function EscrowBadgeSection({ tradeId, escrowStatus }: { tradeId: string; escrowStatus?: string }) {
  const [data, setData] = useState<EscrowRoutingData | null>(null);

  useEffect(() => {
    fetch(`/api/escrow/routing?tradeId=${tradeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); })
      .catch(() => {});
  }, [tradeId]);

  if (!data) return null;

  const badge = TIER_BADGE[data.routing.tier];

  return (
    <div className={`rounded-xl border ${badge.border} ${badge.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-3">
        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${badge.border} ${badge.text}`}>
          {data.routing.label}
        </span>
        <span className="text-sm text-neutral-300">{badge.label}</span>
        <span className="ml-auto text-xs text-neutral-500">{data.routing.estimatedDays}</span>
      </div>

      <EscrowTimeline tier={data.routing.tier} escrowStatus={escrowStatus} />

      <ul className="space-y-1 pt-1 border-t border-neutral-800">
        {data.summary.map((point, i) => (
          <li key={i} className="text-xs text-neutral-400 flex items-start gap-1.5">
            <span className={`mt-0.5 ${badge.text}`}>&bull;</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TradeDetailPage() {
  const params = useParams();
  const tradeId = params.id as string;

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [trade, setTrade] = useState<any>(null);
  const [dispute, setDispute] = useState<TradeDispute | null>(null);
  const [messages, setMessages] = useState<DisputeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Dispute form
  const [reason, setReason] = useState<string>(DISPUTE_REASONS[0].value);
  const [description, setDescription] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeError, setDisputeError] = useState("");

  // Message form
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        setLoggedIn(!!data?.user?.email);
        if (data?.user?.id) setSessionUserId(data.user.id);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    if (loggedIn === null) return;
    if (loggedIn === false) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        // Try to fetch trade data
        const tradeRes = await fetch(`/api/market/trades/${tradeId}`);
        if (tradeRes.ok) {
          const tradeData = await tradeRes.json();
          setTrade(tradeData.trade || tradeData);
        }

        // Fetch dispute for this trade
        const disputeRes = await fetch(`/api/trust/disputes?trade_id=${tradeId}`);
        if (disputeRes.ok) {
          const disputeData = await disputeRes.json();
          const d = disputeData.dispute || disputeData.disputes?.[0] || null;
          setDispute(d);

          // If dispute exists, fetch messages
          if (d) {
            const msgRes = await fetch(`/api/trust/disputes/${d.id}/messages`);
            if (msgRes.ok) {
              const msgData = await msgRes.json();
              setMessages(msgData.messages || []);
            }
          }
        }
      } catch {
        setError("Failed to load trade details.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [loggedIn, tradeId]);

  async function handleRaiseDispute(e: React.FormEvent) {
    e.preventDefault();
    setDisputeError("");
    setSubmittingDispute(true);

    try {
      const res = await fetch("/api/trust/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeId,
          reason,
          description,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to raise dispute.");
      }

      const data = await res.json();
      setDispute(data.dispute);
      setDescription("");
    } catch (err: any) {
      setDisputeError(err.message);
    } finally {
      setSubmittingDispute(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!dispute || !newMessage.trim()) return;

    setSendingMessage(true);
    try {
      const res = await fetch(`/api/trust/disputes/${dispute.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to send message.");
      }

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      } else {
        // Refresh messages
        const msgRes = await fetch(`/api/trust/disputes/${dispute.id}/messages`);
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          setMessages(msgData.messages || []);
        }
      }
      setNewMessage("");
    } catch {
      // silently fail, message stays in input
    } finally {
      setSendingMessage(false);
    }
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

  const statusColors: Record<string, string> = {
    open: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    under_review: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    awaiting_evidence: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    resolved_buyer: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    resolved_seller: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    resolved_split: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    closed: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  };

  const statusLabels: Record<string, string> = {
    open: "Open",
    under_review: "Under Review",
    awaiting_evidence: "Awaiting Evidence",
    resolved_buyer: "Resolved (Buyer)",
    resolved_seller: "Resolved (Seller)",
    resolved_split: "Resolved (Split)",
    closed: "Closed",
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-neutral-800 rounded w-48 animate-pulse" />
        <div className="h-64 bg-neutral-900 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (loggedIn === false) {
    return (
      <div className="bg-neutral-900 rounded-xl p-8 text-center">
        <p className="text-neutral-400 mb-3">You need to be signed in to view trade details.</p>
        <a href="/login" className="text-amber-400 hover:underline text-sm font-medium">
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/account/trades" className="text-neutral-500 hover:text-white transition text-sm">
          &larr; Back to Trades
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white">Trade #{tradeId.slice(0, 8)}</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Escrow routing & workflow */}
      <EscrowBadgeSection tradeId={tradeId} escrowStatus={trade?.escrow_status || trade?.status} />

      {/* Trade info */}
      {trade && (
        <div className="bg-neutral-900 rounded-xl p-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-3">Trade Details</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {trade.card_name && (
              <>
                <span className="text-neutral-500">Card</span>
                <span className="text-white">{trade.card_name}</span>
              </>
            )}
            {trade.price && (
              <>
                <span className="text-neutral-500">Price</span>
                <span className="text-white font-mono">
                  &pound;{Number(trade.price).toFixed(2)}
                </span>
              </>
            )}
            {trade.quantity && (
              <>
                <span className="text-neutral-500">Quantity</span>
                <span className="text-white">{trade.quantity}</span>
              </>
            )}
            {trade.status && (
              <>
                <span className="text-neutral-500">Status</span>
                <span className="text-white capitalize">{trade.status}</span>
              </>
            )}
            {trade.created_at && (
              <>
                <span className="text-neutral-500">Date</span>
                <span className="text-white">{formatDate(trade.created_at)}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Escrow payment prompt */}
      {trade?.escrow_status === "awaiting_payment" && (
        (() => {
          const isBuyer = sessionUserId && trade.buyer_id === sessionUserId;
          const isSeller = sessionUserId && trade.seller_id === sessionUserId;
          if (isBuyer) {
            return (
              <Link
                href={`/account/trades/${tradeId}/pay`}
                className="flex items-center justify-between bg-amber-500/15 border-2 border-amber-500/40 rounded-xl p-5 hover:bg-amber-500/20 transition group"
              >
                <div>
                  <p className="text-amber-400 font-bold text-base">Payment required</p>
                  <p className="text-neutral-400 text-sm mt-0.5">
                    Complete your bank transfer to proceed with this trade.
                  </p>
                </div>
                <span className="text-amber-400 font-bold text-sm group-hover:translate-x-1 transition-transform">
                  Pay Now &rarr;
                </span>
              </Link>
            );
          }
          if (isSeller) {
            return (
              <div className="bg-neutral-900 border border-amber-500/30 rounded-xl p-5 flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
                </span>
                <p className="text-amber-400 text-sm font-medium">
                  Waiting for buyer payment...
                </p>
              </div>
            );
          }
          return null;
        })()
      )}

      {/* Dispute section */}
      {dispute ? (
        <div className="space-y-4">
          {/* Dispute status */}
          <div className="bg-neutral-900 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-wide">Dispute</h2>
              <span
                className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${
                  statusColors[dispute.status] || statusColors.open
                }`}
              >
                {statusLabels[dispute.status] || dispute.status}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-neutral-500 shrink-0">Reason:</span>
                <span className="text-white">
                  {DISPUTE_REASONS.find((r) => r.value === dispute.reason)?.label || dispute.reason}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-neutral-500 shrink-0">Description:</span>
                <span className="text-neutral-300">{dispute.description}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-neutral-500 shrink-0">Opened:</span>
                <span className="text-neutral-300">{formatDate(dispute.created_at)}</span>
              </div>
              {dispute.resolution_notes && (
                <div className="flex gap-2">
                  <span className="text-neutral-500 shrink-0">Resolution:</span>
                  <span className="text-neutral-300">{dispute.resolution_notes}</span>
                </div>
              )}
            </div>
          </div>

          {/* Messages thread */}
          <div className="bg-neutral-900 rounded-xl p-6">
            <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Messages</h2>

            {messages.length === 0 ? (
              <p className="text-neutral-500 text-sm py-4 text-center">No messages yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto mb-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-lg text-sm ${
                      msg.is_admin
                        ? "bg-amber-500/10 border border-amber-500/20"
                        : "bg-neutral-800 border border-neutral-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-medium text-xs">
                        {msg.sender_name || "User"}
                      </span>
                      {msg.is_admin && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Admin
                        </span>
                      )}
                      <span className="text-neutral-600 text-xs ml-auto">
                        {formatDate(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-neutral-300">{msg.message}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Message input — only if dispute is not resolved/closed */}
            {!["resolved_buyer", "resolved_seller", "resolved_split", "closed"].includes(dispute.status) && (
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
                />
                <button
                  type="submit"
                  disabled={sendingMessage || !newMessage.trim()}
                  className="px-4 py-2.5 rounded-lg font-bold text-sm bg-amber-500 text-black hover:bg-amber-400 transition disabled:opacity-50"
                >
                  {sendingMessage ? "..." : "Send"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        /* Raise dispute form */
        <div className="bg-neutral-900 rounded-xl p-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Raise Dispute</h2>
          <p className="text-neutral-400 text-sm mb-4">
            If there is an issue with this trade, you can raise a dispute and our team will review it.
          </p>

          <form onSubmit={handleRaiseDispute} className="space-y-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Reason *</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition"
              >
                {DISPUTE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={4}
                className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition resize-none"
                placeholder="Describe the issue in detail..."
              />
            </div>

            {disputeError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <p className="text-red-400 text-sm">{disputeError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submittingDispute || !description.trim()}
              className="w-full py-3 rounded-lg font-bold text-sm bg-red-500 text-white hover:bg-red-400 transition disabled:opacity-50"
            >
              {submittingDispute ? "Submitting..." : "Raise Dispute"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
