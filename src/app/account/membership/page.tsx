"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TierBadge from "@/components/membership/TierBadge";
import type { Tier, MemberProfile, PointsEntry, CreditEntry } from "@/lib/membership/types";

// ── Tailwind color maps keyed by the tier `color` field ──────────────────────
const TIER_COLORS: Record<string, {
  border: string; text: string; bg: string; glow: string; progressBg: string; progressBar: string;
}> = {
  "amber-700": {
    border: "border-amber-700/50", text: "text-amber-600", bg: "bg-amber-700/10",
    glow: "ring-amber-700/30", progressBg: "bg-amber-700/20", progressBar: "bg-amber-700",
  },
  "neutral-400": {
    border: "border-neutral-400/50", text: "text-neutral-300", bg: "bg-neutral-400/10",
    glow: "ring-neutral-400/30", progressBg: "bg-neutral-400/20", progressBar: "bg-neutral-400",
  },
  "amber-400": {
    border: "border-amber-400/50", text: "text-amber-400", bg: "bg-amber-400/10",
    glow: "ring-amber-400/30", progressBg: "bg-amber-400/20", progressBar: "bg-amber-400",
  },
};

const DEFAULT_TC = {
  border: "border-neutral-600/50", text: "text-neutral-400", bg: "bg-neutral-700/10",
  glow: "ring-neutral-600/30", progressBg: "bg-neutral-600/20", progressBar: "bg-neutral-500",
};

function tc(color: string | undefined) {
  return TIER_COLORS[color ?? ""] ?? DEFAULT_TC;
}

function formatPrice(n: number) {
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relativeDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Type badge colors ────────────────────────────────────────────────────────
const POINTS_TYPE_STYLE: Record<string, string> = {
  order_earned:  "bg-emerald-500/20 text-emerald-400",
  tradein_earned: "bg-teal-500/20 text-teal-400",
  manual_credit: "bg-blue-500/20 text-blue-400",
  manual_debit:  "bg-red-500/20 text-red-400",
  redeemed:      "bg-orange-500/20 text-orange-400",
  expired:       "bg-neutral-500/20 text-neutral-500",
  migration:     "bg-purple-500/20 text-purple-400",
};

const CREDIT_TYPE_STYLE: Record<string, string> = {
  cashback:          "bg-emerald-500/20 text-emerald-400",
  tradein_credit:    "bg-teal-500/20 text-teal-400",
  manual_adjustment: "bg-blue-500/20 text-blue-400",
  redeemed_checkout: "bg-orange-500/20 text-orange-400",
  migration:         "bg-purple-500/20 text-purple-400",
};

function typeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function MembershipPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [pointsHistory, setPointsHistory] = useState<PointsEntry[]>([]);
  const [creditHistory, setCreditHistory] = useState<CreditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllPoints, setShowAllPoints] = useState(false);
  const [showAllCredits, setShowAllCredits] = useState(false);

  useEffect(() => {
    // Check auth then fetch membership data
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(data => {
        if (!data?.user?.email) {
          router.push("/login");
          return;
        }
        // Fetch all membership data in parallel
        Promise.all([
          fetch("/api/membership").then(r => r.json()),
          fetch("/api/membership?tiers=true").then(r => r.json()),
          fetch("/api/membership/points").then(r => r.json()),
          fetch("/api/membership/credit").then(r => r.json()),
        ]).then(([profileData, tiersData, pointsData, creditData]) => {
          setProfile(profileData.profile);
          setTiers(tiersData.tiers || []);
          setPointsHistory(pointsData.history || []);
          setCreditHistory(creditData.history || []);
          setLoading(false);
        });
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-neutral-500 animate-pulse">Loading membership...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-20">
        <p className="text-neutral-400">Unable to load membership data.</p>
      </div>
    );
  }

  const tier = profile.tier;
  const tierColor = tc(tier?.color);
  const nextTierColor = tc(profile.next_tier?.color);
  const isMaxTier = !profile.next_tier;
  const visiblePoints = showAllPoints ? pointsHistory : pointsHistory.slice(0, 5);
  const visibleCredits = showAllCredits ? creditHistory : creditHistory.slice(0, 5);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Membership</h1>

      {/* ── 1. MEMBERSHIP CARD ─────────────────────────────────────────────── */}
      <div className={`relative rounded-2xl border ${tierColor.border} ${tierColor.bg} p-6 sm:p-8 overflow-hidden`}>
        {/* Decorative glow */}
        <div className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-20 ${tierColor.progressBar}`} />

        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div className="space-y-3">
            {tier ? (
              <TierBadge name={tier.name} icon={tier.icon} color={tier.color} size="md" />
            ) : (
              <TierBadge name="Bronze" icon="🥉" color="amber-700" size="md" />
            )}

            {!tier && (
              <p className="text-sm text-amber-600 font-medium">Start earning to unlock perks!</p>
            )}

            <div className="text-sm text-neutral-400">
              Annual spend: <span className="text-white font-semibold">{formatPrice(profile.annual_spend)}</span>
            </div>
          </div>

          {/* Progress to next tier */}
          <div className="flex-1 max-w-sm w-full">
            {isMaxTier ? (
              <div className={`text-sm font-medium ${tierColor.text}`}>
                You&apos;re at the highest tier!
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-400">Progress to {profile.next_tier!.icon} {profile.next_tier!.name}</span>
                  <span className="text-neutral-300 font-medium">{profile.progress_to_next}%</span>
                </div>
                <div className={`h-3 rounded-full ${nextTierColor.progressBg} overflow-hidden`}>
                  <div
                    className={`h-full rounded-full ${nextTierColor.progressBar} transition-all duration-500`}
                    style={{ width: `${profile.progress_to_next}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  {formatPrice(profile.amount_to_next)} more to reach {profile.next_tier!.name}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. PERKS GRID ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Your Perks</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PerkCard
            label="Cashback"
            value={`${profile.perks.cashback_percent}%`}
            description="cashback on purchases"
            highlight={profile.perks.cashback_percent > 0}
          />
          <PerkCard
            label="Points"
            value={`${profile.perks.points_multiplier}x`}
            description="points multiplier"
            highlight={profile.perks.points_multiplier > 1}
          />
          <PerkCard
            label="Trade-in"
            value={`${profile.perks.tradein_bonus_percent}%`}
            description="trade-in bonus"
            highlight={profile.perks.tradein_bonus_percent > 0}
          />
          <PerkCard
            label="P2P Commission"
            value={`${(profile.perks.p2p_commission_rate * 100).toFixed(0)}%`}
            description={profile.perks.p2p_commission_rate < 0.08 ? `commission (standard 8%)` : "commission"}
            highlight={profile.perks.p2p_commission_rate < 0.08}
          />
          <PerkCard
            label="Auction Commission"
            value={`${(profile.perks.auction_commission_rate * 100).toFixed(0)}%`}
            description={profile.perks.auction_commission_rate < 0.12 ? `commission (standard 12%)` : "commission"}
            highlight={profile.perks.auction_commission_rate < 0.12}
          />
          {profile.perks.auction_priority_approval && (
            <PerkCard
              label="Priority"
              value="Enabled"
              description="priority auction approval"
              highlight
            />
          )}
        </div>

        {/* Extra benefits from tier data */}
        {tier && tier.benefits.length > 0 && (
          <div className="mt-4 bg-neutral-900/50 rounded-xl p-4 border border-neutral-800">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Additional Benefits</p>
            <ul className="space-y-1.5">
              {tier.benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                  <span className="text-emerald-400 mt-0.5 shrink-0">&#10003;</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── 3. POINTS & CREDIT ─────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Points */}
        <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-base font-semibold text-white">Points</h3>
            <span className="text-2xl font-bold text-amber-400">{profile.points_balance.toLocaleString()}</span>
          </div>
          <p className="text-xs text-neutral-500 mb-4">
            Lifetime earned: <span className="text-neutral-400">{profile.lifetime_points.toLocaleString()}</span>
          </p>

          {visiblePoints.length > 0 ? (
            <div className="space-y-2">
              {visiblePoints.map(entry => (
                <div key={entry.id} className="flex items-center justify-between py-1.5 border-b border-neutral-800/50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${POINTS_TYPE_STYLE[entry.type] ?? "bg-neutral-700 text-neutral-400"}`}>
                      {typeLabel(entry.type)}
                    </span>
                    <span className="text-xs text-neutral-500 truncate">{entry.description}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className={`text-sm font-medium ${entry.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {entry.amount > 0 ? "+" : ""}{entry.amount}
                    </span>
                    <span className="text-[10px] text-neutral-600 w-14 text-right">{relativeDate(entry.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-600">No points activity yet.</p>
          )}

          {pointsHistory.length > 5 && (
            <button
              onClick={() => setShowAllPoints(v => !v)}
              className="mt-3 text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              {showAllPoints ? "Show less" : `View all (${pointsHistory.length})`}
            </button>
          )}
        </div>

        {/* Store Credit */}
        <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-base font-semibold text-white">Store Credit</h3>
            <span className="text-2xl font-bold text-emerald-400">{formatPrice(profile.store_credit_balance)}</span>
          </div>

          {visibleCredits.length > 0 ? (
            <div className="space-y-2">
              {visibleCredits.map(entry => {
                const amt = parseFloat(entry.amount);
                return (
                  <div key={entry.id} className="flex items-center justify-between py-1.5 border-b border-neutral-800/50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CREDIT_TYPE_STYLE[entry.type] ?? "bg-neutral-700 text-neutral-400"}`}>
                        {typeLabel(entry.type)}
                      </span>
                      <span className="text-xs text-neutral-500 truncate">{entry.description}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className={`text-sm font-medium ${amt > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {amt > 0 ? "+" : ""}{formatPrice(Math.abs(amt))}
                      </span>
                      <span className="text-[10px] text-neutral-600 w-14 text-right">{relativeDate(entry.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-neutral-600">No credit activity yet.</p>
          )}

          {creditHistory.length > 5 && (
            <button
              onClick={() => setShowAllCredits(v => !v)}
              className="mt-3 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {showAllCredits ? "Show less" : `View all (${creditHistory.length})`}
            </button>
          )}
        </div>
      </div>

      {/* ── 4. ALL TIERS COMPARISON ────────────────────────────────────────── */}
      {tiers.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">All Tiers</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {tiers.map(t => {
              const isCurrent = tier?.id === t.id;
              const c = tc(t.color);
              return (
                <div
                  key={t.id}
                  className={`bg-neutral-900 rounded-xl p-5 border transition-all ${
                    isCurrent
                      ? `${c.border} ring-2 ${c.glow}`
                      : "border-neutral-800"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <TierBadge name={t.name} icon={t.icon} color={t.color} />
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Current</span>
                    )}
                  </div>

                  <p className="text-xs text-neutral-500 mb-3">
                    {parseFloat(t.min_annual_spend) === 0
                      ? "Free — all members"
                      : `${formatPrice(parseFloat(t.min_annual_spend))}+ annual spend`}
                  </p>

                  <div className="space-y-2 mb-4">
                    <TierStat label="Cashback" value={`${parseFloat(t.cashback_percent)}%`} />
                    <TierStat label="Points" value={`${parseFloat(t.points_multiplier)}x`} />
                    <TierStat label="Trade-in bonus" value={`${parseFloat(t.tradein_bonus_percent)}%`} />
                    <TierStat label="P2P commission" value={`${(parseFloat(t.p2p_commission_rate) * 100).toFixed(0)}%`} />
                    <TierStat label="Auction commission" value={`${(parseFloat(t.auction_commission_rate) * 100).toFixed(0)}%`} />
                    {t.auction_priority_approval && (
                      <TierStat label="Priority approval" value="Yes" />
                    )}
                  </div>

                  {t.benefits.length > 0 && (
                    <ul className="space-y-1.5 border-t border-neutral-800 pt-3">
                      {t.benefits.map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
                          <span className="text-emerald-400 mt-0.5 shrink-0">&#10003;</span>
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function PerkCard({ label, value, description, highlight }: {
  label: string; value: string; description: string; highlight: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${
      highlight
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-neutral-800 bg-neutral-900/50"
    }`}>
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-white">
        <span className={`text-xl font-bold ${highlight ? "text-emerald-400" : "text-neutral-300"}`}>{value}</span>
        {" "}
        <span className="text-sm text-neutral-400">{description}</span>
      </p>
    </div>
  );
}

function TierStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-300 font-medium">{value}</span>
    </div>
  );
}
