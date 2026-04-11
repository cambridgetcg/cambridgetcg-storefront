"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

export default function SellForCreditButton({
  sku,
  creditAmount,
}: {
  sku: string;
  creditAmount: number;
}) {
  const [selling, setSelling] = useState(false);
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  async function handleSell() {
    setSelling(true);
    try {
      const res = await fetch("/api/market/sell-for-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        throw new Error(data.error || "Failed to sell");
      }
      setDone(true);
      toast(`${formatPrice(data.totalCredit)} credit added! Ship your card within 7 days.`, "success");
    } catch (err: any) {
      toast(err.message || "Failed to sell for credit", "error");
    } finally {
      setSelling(false);
    }
  }

  if (done) {
    return (
      <span className="text-xs text-emerald-400 font-semibold">Credit added!</span>
    );
  }

  return (
    <button
      onClick={handleSell}
      disabled={selling}
      className="px-3 py-1.5 text-xs font-bold bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition disabled:opacity-50"
    >
      {selling ? "Selling..." : "Sell Now"}
    </button>
  );
}
