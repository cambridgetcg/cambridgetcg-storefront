"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type {
  PublicProfile,
  ShowcaseCard,
  WishlistItem,
  ActivityEvent,
  Achievement,
} from "@/lib/social/types";

const EVENT_ICONS: Record<string, string> = {
  trade_completed: "\u{1F91D}",
  auction_listed: "\u{1F528}",
  auction_won: "\u{1F389}",
  raffle_won: "\u{1F3B0}",
  mystery_box_opened: "\u{1F4E6}",
  tier_upgraded: "\u2B06\uFE0F",
  achievement_earned: "\u{1F3C6}",
  card_added: "\u{1F0CF}",
  wishlist_fulfilled: "\u2705",
  review_received: "\u2B50",
  set_completed: "\u2705",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function UserProfilePage() {
  const params = useParams();
  const username = params.username as string;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [showcase, setShowcase] = useState<ShowcaseCard[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [commerce, setCommerce] = useState<{
    tradesSold: number;
    tradesBought: number;
    auctionsSold: number;
    totalVolumeGbp: number;
    disputeRate: number;
    disputes: number;
    trustScore: number;
    trustTier: { name: string; color: string; minScore: number };
    commissionRate: number;
    memberSince: string;
  } | null>(null);

  useEffect(() => {
    // Commerce stats are public and username-keyed; fetched in parallel with
    // the social profile. Failure is silent — card just won't render.
    fetch(`/api/u/${encodeURIComponent(username)}/commerce`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setCommerce(d); })
      .catch(() => {});

    fetch(`/api/social/profile?user=${encodeURIComponent(username)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.private) {
          setIsPrivate(true);
        } else {
          setProfile(data.profile);
          setShowcase(data.showcase ?? []);
          setWishlist(data.wishlist ?? []);
          setActivity(data.activity ?? []);
          setAchievements(data.achievements ?? []);
          setIsFollowing(data.following ?? false);
          setIsOwnProfile(data.isOwn ?? false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);

  async function toggleFollow() {
    if (!profile) return;
    setFollowLoading(true);
    try {
      const res = await fetch("/api/social/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.user_id }),
      });
      if (res.ok) setIsFollowing((p) => !p);
    } catch {}
    setFollowLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isPrivate) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-white mb-2">This profile is private</h1>
          <p className="text-neutral-400 text-sm">This collector has chosen to keep their profile private.</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-400">Profile not found.</p>
      </div>
    );
  }

  const tierColor = profile.tier_color ?? "#f59e0b";
  const initial = (profile.name ?? profile.username ?? "?")[0].toUpperCase();

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start gap-6 mb-8">
          {/* Avatar + trust ring */}
          <div className="relative shrink-0">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black"
              style={{
                background: profile.avatar_url
                  ? `url(${profile.avatar_url}) center/cover`
                  : "rgb(38,38,38)",
                boxShadow: `0 0 0 3px ${tierColor}`,
              }}
            >
              {!profile.avatar_url && <span style={{ color: tierColor }}>{initial}</span>}
            </div>
            {/* Trust score ring */}
            <div
              className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-neutral-950 flex items-center justify-center text-xs font-bold"
              style={{ color: tierColor, border: `2px solid ${tierColor}` }}
            >
              {profile.trust_score}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-white truncate">
                {profile.name ?? profile.username}
              </h1>
              {profile.tier_name && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                  style={{ background: `${tierColor}20`, color: tierColor }}
                >
                  {profile.tier_icon && <span>{profile.tier_icon}</span>}
                  {profile.tier_name}
                </span>
              )}
            </div>
            <p className="text-neutral-500 text-sm mt-0.5">@{profile.username}</p>
            {profile.bio && (
              <p className="text-neutral-300 text-sm mt-2 max-w-lg">{profile.bio}</p>
            )}

            {/* Follow button */}
            {!isOwnProfile && (
              <button
                onClick={toggleFollow}
                disabled={followLoading}
                className={`mt-3 px-5 py-1.5 rounded-lg text-sm font-bold transition ${
                  isFollowing
                    ? "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                    : "bg-amber-500 text-black hover:bg-amber-400"
                }`}
              >
                {followLoading ? "..." : isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-4 mb-8">
          {[
            { label: "Followers", val: profile.follower_count },
            { label: "Following", val: profile.following_count },
            { label: "Collection", val: profile.portfolio_count },
            { label: "Trades", val: profile.trade_count },
            { label: "Avg Rating", val: profile.avg_rating?.toFixed(1) ?? "N/A" },
          ].map((s) => (
            <div key={s.label} className="bg-neutral-900 rounded-xl p-3 text-center">
              <div className="text-lg font-black text-white">{s.val}</div>
              <div className="text-xs text-neutral-500">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Seller reputation — only rendered when there's commerce activity */}
        {commerce && (commerce.tradesSold > 0 || commerce.auctionsSold > 0 || commerce.tradesBought > 0) && (
          <section className="bg-neutral-900 rounded-xl p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-wide">Seller Reputation</h2>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                  {
                    purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
                    amber:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
                    emerald:"bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                    blue:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
                    neutral:"bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
                  }[commerce.trustTier.color] ?? "bg-neutral-500/15 text-neutral-300 border-neutral-500/30"
                }`}
              >
                {commerce.trustTier.name}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-lg font-bold text-white">{commerce.tradesSold}</div>
                <div className="text-[11px] text-neutral-500">sold (trades)</div>
              </div>
              <div>
                <div className="text-lg font-bold text-white">{commerce.auctionsSold}</div>
                <div className="text-[11px] text-neutral-500">sold (auctions)</div>
              </div>
              <div>
                <div className="text-lg font-bold text-white">£{commerce.totalVolumeGbp.toFixed(2)}</div>
                <div className="text-[11px] text-neutral-500">total paid out</div>
              </div>
              <div>
                <div className={`text-lg font-bold ${commerce.disputeRate > 5 ? "text-amber-400" : commerce.disputeRate > 0 ? "text-neutral-300" : "text-emerald-400"}`}>
                  {commerce.disputeRate.toFixed(1)}%
                </div>
                <div className="text-[11px] text-neutral-500">
                  dispute rate {commerce.disputes > 0 ? `(${commerce.disputes})` : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2 mt-3 pt-3 border-t border-neutral-800">
              <p className="text-[11px] text-neutral-500">
                Member since {new Date(commerce.memberSince).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
              </p>
              <p className="text-[11px] text-neutral-500">
                Current commission rate: <span className="font-mono text-emerald-400">{(commerce.commissionRate * 100).toFixed(0)}%</span>
                {commerce.commissionRate < 0.08 && (
                  <span className="text-amber-400 ml-1">&middot; earned by reputation</span>
                )}
              </p>
            </div>
          </section>
        )}

        {/* Showcase */}
        {showcase.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4">Showcase</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
              {showcase.map((card) => (
                <div
                  key={card.id}
                  className="shrink-0 w-44 bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800"
                >
                  <div className="aspect-[3/4] bg-neutral-800 relative">
                    {card.image_url ? (
                      <img
                        src={card.image_url}
                        alt={card.card_name ?? "Card"}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm">
                        No Image
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-white text-sm font-semibold truncate">
                      {card.card_name}
                    </p>
                    {card.set_name && (
                      <p className="text-neutral-500 text-xs truncate">{card.set_name}</p>
                    )}
                    {card.caption && (
                      <p className="text-neutral-400 text-xs mt-1 italic line-clamp-2">
                        {card.caption}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Want List */}
        {wishlist.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4">Want List</h2>
            <div className="space-y-2">
              {wishlist.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 bg-neutral-900 rounded-xl p-3 border border-neutral-800"
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.card_name}
                      className="w-10 h-14 object-cover rounded"
                    />
                  ) : (
                    <div className="w-10 h-14 bg-neutral-800 rounded flex items-center justify-center text-neutral-600 text-xs">
                      ?
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{item.card_name}</p>
                    <p className="text-neutral-500 text-xs">
                      {item.set_name && <span>{item.set_name}</span>}
                      {item.condition_min && (
                        <span className="ml-2">Min: {item.condition_min}</span>
                      )}
                      {item.max_price && (
                        <span className="ml-2">Max: ${item.max_price}</span>
                      )}
                    </p>
                  </div>
                  {item.sku && (
                    <Link
                      href={`/market/${item.sku}`}
                      className="shrink-0 px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-lg hover:bg-amber-500/20 transition"
                    >
                      Offer to trade
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4">Achievements</h2>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
              {achievements.map((a) => {
                const earned = !!a.earned_at;
                return (
                  <div
                    key={a.id}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl text-center transition ${
                      earned
                        ? "bg-neutral-900 border border-neutral-700"
                        : "bg-neutral-800 opacity-40"
                    }`}
                    title={a.description}
                  >
                    <span className="text-2xl">{a.icon}</span>
                    <span
                      className={`text-[10px] font-medium leading-tight ${
                        earned ? "text-neutral-300" : "text-neutral-600"
                      }`}
                    >
                      {a.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Activity */}
        {activity.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-white mb-4">Recent Activity</h2>
            <div className="space-y-2">
              {activity.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 bg-neutral-900 rounded-xl p-3 border border-neutral-800"
                >
                  <span className="text-xl shrink-0">
                    {EVENT_ICONS[ev.event_type] ?? "\u{1F4AC}"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{ev.title}</p>
                    {ev.description && (
                      <p className="text-neutral-500 text-xs truncate">{ev.description}</p>
                    )}
                  </div>
                  <span className="text-neutral-600 text-xs shrink-0">
                    {timeAgo(ev.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
