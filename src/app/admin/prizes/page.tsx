"use client";

import { useCallback, useEffect, useState } from "react";

interface Prize {
  kind: "raffle" | "mystery_box" | "pack";
  id: string;
  label: string;
  prize_description: string | null;
  user_email: string;
  user_name: string | null;
  shipping_address: string | null;
  shipping_collected_at: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  fulfilled: boolean;
  won_at: string;
}

export default function AdminPrizesPage() {
  const [authed, setAuthed] = useState(true);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/admin/prizes");
    if (r.status === 401) { setAuthed(false); setLoading(false); return; }
    setAuthed(true);
    if (r.ok) setPrizes((await r.json()).prizes || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { setLoginError("Wrong password."); return; }
    setPassword(""); load();
  }

  async function ship(p: Prize) {
    const tracking = window.prompt("Tracking number (optional):", "");
    setActing(`${p.kind}:${p.id}`);
    try {
      await fetch("/api/admin/prizes", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: p.kind, id: p.id, action: "ship", trackingNumber: tracking || undefined }),
      });
      load();
    } finally { setActing(null); }
  }

  async function fulfill(p: Prize) {
    if (!confirm("Mark this prize as fully fulfilled? This is the final step.")) return;
    setActing(`${p.kind}:${p.id}`);
    try {
      await fetch("/api/admin/prizes", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: p.kind, id: p.id, action: "fulfill" }),
      });
      load();
    } finally { setActing(null); }
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <form onSubmit={handleLogin} className="w-full max-w-sm px-4">
          <h1 className="text-2xl font-bold text-white text-center mb-8">Prize Fulfillment</h1>
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

  // Split into ready-to-ship vs awaiting address
  const readyToShip = prizes.filter((p) => p.shipping_collected_at && !p.shipped_at);
  const shipped = prizes.filter((p) => p.shipped_at && !p.fulfilled);
  const waitingAddress = prizes.filter((p) => !p.shipping_collected_at);

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-black text-white mb-1">Prize Fulfillment</h1>
        <p className="text-sm text-neutral-400 mb-6">
          {prizes.length} unfulfilled across raffles + mystery boxes + packs
        </p>

        {loading ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : (
          <>
            <Section title={`Ready to ship (${readyToShip.length})`} prizes={readyToShip}
              renderActions={(p) => (
                <button onClick={() => ship(p)} disabled={acting === `${p.kind}:${p.id}`}
                  className="px-3 py-1.5 text-xs font-bold bg-amber-500 text-black rounded-md hover:bg-amber-400 disabled:opacity-50">
                  Mark shipped
                </button>
              )} />
            <Section title={`Shipped — awaiting confirmation (${shipped.length})`} prizes={shipped}
              renderActions={(p) => (
                <button onClick={() => fulfill(p)} disabled={acting === `${p.kind}:${p.id}`}
                  className="px-3 py-1.5 text-xs font-bold bg-emerald-500 text-black rounded-md hover:bg-emerald-400 disabled:opacity-50">
                  Mark fulfilled
                </button>
              )} />
            <Section title={`Awaiting customer address (${waitingAddress.length})`} prizes={waitingAddress}
              renderActions={() => (
                <span className="text-xs text-neutral-500">Customer hasn&rsquo;t entered shipping yet</span>
              )} />
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, prizes, renderActions }: {
  title: string; prizes: Prize[]; renderActions: (p: Prize) => React.ReactNode;
}) {
  if (prizes.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm font-bold text-neutral-300 uppercase tracking-wide mb-3">{title}</h2>
      <div className="bg-neutral-900 rounded-xl divide-y divide-neutral-800">
        {prizes.map((p) => (
          <div key={`${p.kind}:${p.id}`} className="p-4">
            <div className="flex items-baseline justify-between mb-1 gap-3">
              <div className="min-w-0">
                <p className="text-xs text-neutral-500 capitalize">{p.kind.replace("_", " ")}</p>
                <p className="text-sm font-bold text-white truncate">{p.label}</p>
                {p.prize_description && <p className="text-xs text-neutral-400 truncate">{p.prize_description}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-neutral-300">{p.user_name || p.user_email}</p>
                <p className="text-[10px] text-neutral-500">{new Date(p.won_at).toLocaleDateString("en-GB")}</p>
              </div>
            </div>
            {p.shipping_address && (
              <p className="text-xs text-neutral-400 mt-2 whitespace-pre-wrap">{p.shipping_address}</p>
            )}
            {p.tracking_number && (
              <p className="text-xs text-emerald-400 mt-1 font-mono">{p.tracking_number}</p>
            )}
            <div className="mt-3">{renderActions(p)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
