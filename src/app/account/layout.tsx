"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/account/profile", label: "Profile" },
  { href: "/account/portfolio", label: "Portfolio" },
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/trade-ins", label: "Trade-Ins" },
  { href: "/account/trades", label: "Trades" },
  { href: "/account/auctions", label: "My Auctions" },
  { href: "/account/payouts", label: "Payouts" },
  { href: "/account/verify", label: "Verification" },
  { href: "/account/trust", label: "Trust Score" },
  { href: "/account/membership", label: "Membership" },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/account") return pathname === "/account";
    return pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Mobile: horizontal tabs */}
        <nav className="flex gap-2 overflow-x-auto pb-4 mb-6 md:hidden">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition ${
                isActive(item.href)
                  ? "bg-amber-500 text-black"
                  : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex gap-8">
          {/* Desktop: left sidebar */}
          <aside className="hidden md:block w-48 shrink-0">
            <nav className="flex flex-col gap-1 sticky top-8">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                    isActive(item.href)
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-900"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          {/* Page content */}
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
