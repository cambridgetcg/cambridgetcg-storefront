"use client";

import { useSellCart } from "@/context/SellCartContext";
import { formatPrice } from "@/lib/format";

export default function SellCartBar() {
  const { totalItems, cashTotal, creditTotal, openDrawer } = useSellCart();

  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-amber-500/30">
      <div className="bg-neutral-900/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-white">
              {totalItems} card{totalItems !== 1 ? "s" : ""}
            </span>
            <span className="text-sm text-neutral-400">
              Cash: <span className="text-amber-400 font-medium">{formatPrice(cashTotal)}</span>
            </span>
            <span className="text-sm text-neutral-400">
              Credit: <span className="text-amber-400 font-medium">{formatPrice(creditTotal)}</span>
            </span>
          </div>
          <button
            onClick={openDrawer}
            className="px-5 py-2 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Review →
          </button>
        </div>
      </div>
    </div>
  );
}
