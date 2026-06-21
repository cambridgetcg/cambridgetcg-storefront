"use client";

import { useCallback, useEffect, useState } from "react";

interface TierRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  isPaid: boolean;
  minSpend: number;
  perks: {
    cashbackPct: number;
    pointsMultiplier: number;
    tradeinBonusPct: number;
    p2pRate: number | null;
    auctionRate: number | null;
    priorityApproval: boolean;
    storeDiscountPct: number;
  };
  userCount: number;
  totalAnnualSpend: number;
  avgAnnualSpend: number;
  sourceBreakdown: {
    subscription: number;
    manual: number;
    spending: number;
  };
}

const fmt = (n: number) => `£${n.toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const rate = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

export default function AdminTiersPage() {
  const [authed, setAuthed] = useState(true);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/tiers");
    if (res.status === 401) { setAuthed(false); setLoading(false); return; }
    setAuthed(true);
    if (res.ok) setTiers((await res.json()).tiers || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { setLoginError("Wrong password."); return; }
    setPassword("");
    load();
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <form onSubmit={handleLogin} className="w-full max-w-sm px-4">
          <h1 className="text-2xl font-bold text-white text-center mb-8">Tier Admin</h1>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white" />
          {loginError && <p className="text-red-400 text-sm mt-2">{loginError}</p>}
          <button type="submit" className="w-full mt-4 px-4 py-3 bg-amber-500 text-black rounded-lg font-bold">
            Sign in
          </button>
        </form>
      </main>
    );
  }

  const totalUsers = tiers.reduce((s, t) => s + t.userCount, 0);
  const totalSpend = tiers.reduce((s, t) => s + t.totalAnnualSpend, 0);

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black text-white">Membership Tiers</h1>
            <p className="text-sm text-neutral-400 mt-1">
              {totalUsers.toLocaleString()} users &middot; {fmt(totalSpend)} total annual spend tracked
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 bg-neutral-800 text-sm text-neutral-300 rounded-lg hover:bg-neutral-700 disabled:opacity-50">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : (
          <div className="space-y-3">
            {tiers.map((t) => (
              <div key={t.id} className="bg-neutral-900 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{t.icon}</span>
                      <h2 className="text-lg font-bold text-white">{t.name}</h2>
                      {t.isPaid && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
                          PAID
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">
                      Threshold: {fmt(t.minSpend)} annual spend
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{t.userCount}</p>
                    <p className="text-[11px] text-neutral-500">users</p>
                  </div>
                </div>

                {/* Perks grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <Stat label="Cashback" value={pct(t.perks.cashbackPct)} />
                  <Stat label="Berries multiplier" value={`${t.perks.pointsMultiplier}×`} />
                  <Stat label="Trade-in bonus" value={pct(t.perks.tradeinBonusPct)} />
                  <Stat label="Store discount" value={pct(t.perks.storeDiscountPct)} />
                  <Stat label="P2P commission" value={rate(t.perks.p2pRate)} />
                  <Stat label="Auction commission" value={rate(t.perks.auctionRate)} />
                  <Stat label="Priority approval" value={t.perks.priorityApproval ? "Yes" : "No"}
                    accent={t.perks.priorityApproval ? "emerald" : undefined} />
                  <Stat label="Avg annual spend" value={fmt(t.avgAnnualSpend)} />
                </div>

                {/* Source breakdown */}
                <div className="flex items-center gap-3 text-xs text-neutral-500 pt-3 border-t border-neutral-800">
                  <span>Source:</span>
                  <span>spending {t.sourceBreakdown.spending}</span>
                  {t.isPaid && <span>subscription {t.sourceBreakdown.subscription}</span>}
                  <span>manual {t.sourceBreakdown.manual}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "emerald" }) {
  return (
    <div className="bg-neutral-950 rounded-lg p-2.5">
      <p className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${accent === "emerald" ? "text-emerald-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
