"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

interface Redemption {
  id: string;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  sku: string;
  card_name: string;
  card_number: string | null;
  set_code: string | null;
  rarity: string | null;
  image_url: string | null;
  spot_price_gbp: string;
  status: "reserved" | "redeemed";
  acquired_at: string;
  redemption_order_id: number;
  fulfilled_at: string | null;
  shipping_name: string;
  shipping_address: string;
  customer_email: string;
  order_status: string;
  order_created_at: string;
}

export default function AdminBountyRedemptions() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(false);
  const [fulfilling, setFulfilling] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bounty/redemptions");
      if (res.ok) {
        const d = await res.json();
        setRedemptions(d.redemptions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/bounty/redemptions").then((res) => {
      if (res.ok) {
        setAuthed(true);
        return res.json();
      }
      return null;
    }).then((d) => { if (d?.redemptions) setRedemptions(d.redemptions); });
  }, []);

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
      fetchList();
    } catch {
      setLoginError("Network error.");
    }
  }

  async function handleFulfill(id: string) {
    setFulfilling(id);
    try {
      const res = await fetch(`/api/admin/bounty/redemptions/${id}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking: trackingInputs[id] || "" }),
      });
      if (res.ok) await fetchList();
    } finally {
      setFulfilling(null);
    }
  }

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
          {loginError && <p className="text-sm text-red-400 mb-4">{loginError}</p>}
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

  const pending = redemptions.filter((r) => r.status === "reserved");
  const recent = redemptions.filter((r) => r.status === "redeemed");

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Bounty Redemptions</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Pick, pack, and ship vault-item orders. Add tracking on fulfill to drop it into the user&apos;s notes.
            </p>
          </div>
          <button
            onClick={fetchList}
            disabled={loading}
            className="px-4 py-2 bg-neutral-800 text-sm rounded-lg hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <Stat label="Pending" value={pending.length} tone="amber" />
          <Stat label="Fulfilled (recent)" value={recent.length} />
          <Stat label="Total in queue" value={redemptions.length} />
        </div>

        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3">
            Pending <span className="text-amber-400">({pending.length})</span>
          </h2>
          {pending.length === 0 ? (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 text-center text-neutral-500 text-sm">
              Nothing to ship right now.
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <RedemptionRow
                  key={r.id}
                  r={r}
                  tracking={trackingInputs[r.id] ?? ""}
                  onTracking={(v) => setTrackingInputs((p) => ({ ...p, [r.id]: v }))}
                  onFulfill={() => handleFulfill(r.id)}
                  fulfilling={fulfilling === r.id}
                />
              ))}
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section>
            <h2 className="text-lg font-bold mb-3">Recently fulfilled</h2>
            <div className="space-y-2">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 bg-neutral-900 border border-neutral-800/60 rounded-lg px-4 py-2.5 text-sm"
                >
                  <span className="text-emerald-400">✓</span>
                  <span className="font-mono text-xs text-neutral-500">#{r.redemption_order_id}</span>
                  <span className="flex-1 truncate">{r.card_name}</span>
                  <span className="text-neutral-500 text-xs">{r.shipping_name}</span>
                  <span className="text-neutral-600 text-xs">
                    {r.fulfilled_at ? new Date(r.fulfilled_at).toLocaleDateString() : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "amber" }) {
  return (
    <div className="bg-neutral-900 rounded-xl p-4">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === "amber" ? "text-amber-400" : "text-white"}`}>{value}</p>
    </div>
  );
}

function RedemptionRow({
  r, tracking, onTracking, onFulfill, fulfilling,
}: {
  r: Redemption;
  tracking: string;
  onTracking: (v: string) => void;
  onFulfill: () => void;
  fulfilling: boolean;
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
      <div className="relative w-14 h-20 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {r.image_url && (
          <Image src={r.image_url} alt={r.card_name} fill sizes="56px" className="object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{r.card_name}</p>
        <p className="text-xs text-neutral-500">
          {r.sku} · {r.rarity} · £{parseFloat(r.spot_price_gbp).toFixed(2)}
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          Order #{r.redemption_order_id} · {r.user_email ?? r.customer_email}
        </p>
      </div>
      <div className="flex-1 min-w-[220px] text-xs text-neutral-400">
        <p className="font-semibold text-neutral-300">{r.shipping_name}</p>
        <p className="whitespace-pre-wrap leading-snug">{r.shipping_address}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={tracking}
          onChange={(e) => onTracking(e.target.value)}
          placeholder="Tracking # (optional)"
          className="bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs w-44 focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={onFulfill}
          disabled={fulfilling}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold rounded px-4 py-1.5 transition-colors"
        >
          {fulfilling ? "..." : "Fulfill"}
        </button>
      </div>
    </div>
  );
}
