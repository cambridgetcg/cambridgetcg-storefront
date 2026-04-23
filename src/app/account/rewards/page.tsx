"use client";

import { useCallback, useEffect, useState } from "react";

interface Prize {
  kind: "raffle" | "mystery_box" | "pack";
  id: string;
  label: string;
  prize_description: string | null;
  image_url: string | null;
  shipping_address: string | null;
  shipping_collected_at: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  fulfilled: boolean;
  won_at: string;
}

export default function CustomerPrizesPage() {
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftAddress, setDraftAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/rewards/prizes");
    if (r.ok) setPrizes((await r.json()).prizes || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submitAddress(prize: Prize) {
    if (!draftAddress.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/rewards/prizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: prize.kind, id: prize.id, address: draftAddress.trim() }),
      });
      if (r.ok) {
        setEditingId(null);
        setDraftAddress("");
        load();
      } else {
        const d = await r.json().catch(() => ({}));
        alert(d.error || "Failed to save");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-6">Prizes won</h1>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading...</p>
      ) : prizes.length === 0 ? (
        <div className="bg-neutral-900 rounded-xl p-8 text-center">
          <p className="text-neutral-400 text-sm">No physical prizes yet.</p>
          <p className="text-xs text-neutral-500 mt-2">
            Win raffles, open mystery boxes, or pull rare cards from packs to see them here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {prizes.map((p) => {
            const status = p.shipped_at
              ? { label: "Shipped", color: "text-emerald-400" }
              : p.shipping_collected_at
                ? { label: "Awaiting dispatch", color: "text-blue-400" }
                : { label: "Awaiting your address", color: "text-amber-400" };
            return (
              <div key={`${p.kind}:${p.id}`} className="bg-neutral-900 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-16 h-22 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-22 bg-neutral-800 rounded-lg shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-500 capitalize">{p.kind.replace("_", " ")}</p>
                    <p className="text-base font-bold text-white truncate">{p.label}</p>
                    {p.prize_description && (
                      <p className="text-xs text-neutral-400 mt-1 truncate">{p.prize_description}</p>
                    )}
                    <p className={`text-xs mt-1 font-medium ${status.color}`}>{status.label}</p>
                  </div>
                </div>

                {!p.shipping_collected_at ? (
                  editingId === `${p.kind}:${p.id}` ? (
                    <div className="space-y-2">
                      <textarea
                        value={draftAddress}
                        onChange={(e) => setDraftAddress(e.target.value)}
                        placeholder="Full shipping address (line 1, city, postcode, country)"
                        rows={3}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm resize-none"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => submitAddress(p)} disabled={submitting}
                          className="px-3 py-1.5 text-xs font-bold bg-amber-500 text-black rounded-md hover:bg-amber-400 transition disabled:opacity-50">
                          {submitting ? "Saving..." : "Save address"}
                        </button>
                        <button onClick={() => { setEditingId(null); setDraftAddress(""); }}
                          className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(`${p.kind}:${p.id}`); setDraftAddress(""); }}
                      className="px-3 py-1.5 text-xs font-bold bg-amber-500 text-black rounded-md hover:bg-amber-400 transition"
                    >
                      Add shipping address
                    </button>
                  )
                ) : (
                  <div className="text-xs text-neutral-400">
                    <p className="mb-1">Address: {p.shipping_address}</p>
                    {p.tracking_number && <p>Tracking: <span className="font-mono text-neutral-300">{p.tracking_number}</span></p>}
                    {p.shipped_at && <p>Shipped: {new Date(p.shipped_at).toLocaleDateString("en-GB")}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
