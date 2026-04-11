"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  price_gbp: number;
}

interface Order {
  id: number;
  stripe_session_id: string;
  customer_name: string;
  status: string;
  total_gbp: string;
  shipping_name: string | null;
  shipping_address: string | null;
  items: OrderItem[];
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400",
  shipped: "bg-blue-500/20 text-blue-400",
  processing: "bg-amber-500/20 text-amber-400",
  refunded: "bg-red-500/20 text-red-400",
};

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (!data?.user?.email) { router.push("/login"); return; }
        return fetch("/api/account/orders").then((r) => r.json());
      })
      .then((data) => {
        if (data?.orders) setOrders(data.orders);
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/account" className="text-sm text-neutral-400 hover:text-white transition mb-6 inline-block">
          ← My Account
        </Link>
        <h1 className="text-2xl font-bold text-white mb-8">My Orders</h1>

        {orders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-neutral-500 mb-4">No orders yet.</p>
            <Link
              href="/catalog"
              className="px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition inline-block"
            >
              Browse Cards
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="bg-neutral-900 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                  className="w-full px-4 py-4 flex items-center gap-4 text-left hover:bg-neutral-800/50 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || "bg-neutral-700 text-neutral-300"}`}>
                        {order.status}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {new Date(order.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-300 mt-1">
                      {(order.items || []).length} item{(order.items || []).length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white">{formatPrice(parseFloat(order.total_gbp))}</p>
                  </div>
                  <span className="text-neutral-600 text-sm">{expanded === order.id ? "▲" : "▼"}</span>
                </button>

                {expanded === order.id && (
                  <div className="px-4 pb-4 border-t border-neutral-800">
                    {order.shipping_name && (
                      <div className="mt-3 mb-3">
                        <span className="text-xs text-neutral-500">Shipped to</span>
                        <p className="text-sm text-white">{order.shipping_name}</p>
                        {order.shipping_address && (
                          <p className="text-xs text-neutral-400 mt-1 whitespace-pre-line">{order.shipping_address}</p>
                        )}
                      </div>
                    )}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-neutral-500 text-xs uppercase tracking-wide">
                          <th className="text-left py-2">Item</th>
                          <th className="text-center py-2">Qty</th>
                          <th className="text-right py-2">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(order.items || []).map((item, idx) => (
                          <tr key={idx} className="border-t border-neutral-800">
                            <td className="py-2 text-white">{item.name}</td>
                            <td className="py-2 text-center text-neutral-300">{item.qty}</td>
                            <td className="py-2 text-right text-neutral-300">{formatPrice(item.price_gbp * item.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
