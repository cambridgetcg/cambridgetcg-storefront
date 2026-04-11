"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Raffle, MysteryBox, RARITY_COLORS } from "@/lib/rewards/types";

function useCountdown(target: string) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    function update() {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Ended");
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (d > 0) setRemaining(`${d}d ${h}h ${m}m`);
      else if (h > 0) setRemaining(`${h}h ${m}m ${s}s`);
      else setRemaining(`${m}m ${s}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [target]);
  return remaining;
}

function RaffleCountdown({ drawAt }: { drawAt: string }) {
  const text = useCountdown(drawAt);
  return <span>{text}</span>;
}

const RARITY_COLORS_LOCAL: Record<string, string> = {
  common: "bg-neutral-500/20 text-neutral-400",
  uncommon: "bg-blue-500/20 text-blue-400",
  rare: "bg-purple-500/20 text-purple-400",
  legendary: "bg-amber-500/20 text-amber-400",
};

export default function RewardsPage() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [boxes, setBoxes] = useState<MysteryBox[]>([]);
  const [points, setPoints] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/rewards/raffles").then((r) => r.json()),
      fetch("/api/rewards/mystery-boxes").then((r) => r.json()),
      fetch("/api/membership").then((r) => r.json()).catch(() => null),
    ]).then(([raffleData, boxData, memberData]) => {
      setRaffles(raffleData?.raffles ?? []);
      setBoxes(boxData?.boxes ?? []);
      if (memberData?.profile?.points_balance != null) setPoints(memberData.profile.points_balance);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-black mb-2">Rewards</h1>
          <p className="text-neutral-400">
            Earn points by shopping, trading in cards, and completing your collection.
          </p>
          {points !== null && (
            <div className="mt-4 inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-3">
              <span className="text-2xl font-bold text-amber-400">
                Your Points: {points.toLocaleString()} ⭐
              </span>
            </div>
          )}
        </div>

        {/* Active Raffles */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <span className="text-amber-400">🎟️</span> Active Raffles
          </h2>
          {raffles.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
              <p className="text-neutral-500 text-lg">No active raffles right now.</p>
              <p className="text-neutral-600 text-sm mt-1">Check back soon for new prizes!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {raffles.map((raffle) => (
                <Link
                  key={raffle.id}
                  href={`/rewards/raffles/${raffle.id}`}
                  className="group rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden hover:border-amber-500/50 transition-all"
                >
                  <div className="aspect-[16/10] bg-neutral-800 relative overflow-hidden">
                    {raffle.image_url ? (
                      <img
                        src={raffle.image_url}
                        alt={raffle.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-600">
                        <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                        </svg>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-amber-500/90 text-black text-xs font-bold px-2 py-1 rounded-md">
                      {raffle.entry_cost_points.toLocaleString()} pts / entry
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-lg font-bold mb-1 group-hover:text-amber-400 transition-colors">
                      {raffle.title}
                    </h3>
                    <p className="text-amber-400/80 text-sm font-medium mb-3">
                      Prize: {raffle.prize_description}
                    </p>
                    <div className="flex items-center justify-between text-sm text-neutral-400">
                      <span>{raffle.total_entries.toLocaleString()} entries</span>
                      <span className="text-amber-400/70">
                        <RaffleCountdown drawAt={raffle.draw_at} />
                      </span>
                    </div>
                    {raffle.user_entries != null && raffle.user_entries > 0 && (
                      <div className="mt-2 text-xs text-amber-400/60">
                        You have {raffle.user_entries} {raffle.user_entries === 1 ? "entry" : "entries"}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Mystery Boxes */}
        <section>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <span className="text-purple-400">📦</span> Mystery Boxes
          </h2>
          {boxes.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-12 text-center">
              <p className="text-neutral-500 text-lg">No mystery boxes available.</p>
              <p className="text-neutral-600 text-sm mt-1">New boxes drop regularly — stay tuned!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {boxes.map((box) => (
                <Link
                  key={box.id}
                  href={`/rewards/mystery-boxes/${box.id}`}
                  className="group rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden hover:border-purple-500/50 transition-all"
                >
                  <div className="aspect-[16/10] bg-neutral-800 relative overflow-hidden">
                    {box.image_url ? (
                      <img
                        src={box.image_url}
                        alt={box.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/30 to-neutral-900">
                        <svg className="w-16 h-16 text-purple-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-purple-500/90 text-white text-xs font-bold px-2 py-1 rounded-md">
                      {box.cost_points.toLocaleString()} pts
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-lg font-bold mb-2 group-hover:text-purple-400 transition-colors">
                      {box.title}
                    </h3>
                    {/* Rarity distribution preview */}
                    {box.rewards && box.rewards.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {Array.from(
                          box.rewards.reduce((acc, r) => {
                            acc.set(r.rarity, (acc.get(r.rarity) || 0) + 1);
                            return acc;
                          }, new Map<string, number>())
                        ).map(([rarity, count]) => (
                          <span
                            key={rarity}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${RARITY_COLORS_LOCAL[rarity] ?? "bg-neutral-700 text-neutral-300"}`}
                          >
                            {count} {rarity}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm text-neutral-400">
                      <span>{box.total_opens.toLocaleString()} opened</span>
                      {box.user_opens != null && (
                        <span className="text-purple-400/70">
                          {box.user_opens} / {box.max_opens_per_user} used
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
