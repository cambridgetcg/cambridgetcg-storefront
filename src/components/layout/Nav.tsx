"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useEffect, useState } from "react";

export default function Nav() {
  const { totalItems, openDrawer } = useCart();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => setLoggedIn(!!data?.user?.email))
      .catch(() => {});
  }, []);

  return (
    <nav className="sticky top-0 z-40 bg-neutral-950/90 backdrop-blur border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-black text-white">
          Cambridge <span className="text-emerald-400">TCG</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/catalog?game=one-piece" className="text-sm text-neutral-300 hover:text-white transition">
            One Piece
          </Link>
          <Link href="/catalog" className="text-sm text-neutral-300 hover:text-white transition">
            Catalog
          </Link>
          <Link href="/trade-in" className="text-sm text-neutral-300 hover:text-white transition">
            Trade In
          </Link>
          <Link href="/about" className="text-sm text-neutral-300 hover:text-white transition">
            About
          </Link>
          <Link
            href={loggedIn ? "/account" : "/login"}
            className="text-sm text-neutral-300 hover:text-white transition"
          >
            {loggedIn ? "Account" : "Sign In"}
          </Link>
          <button
            onClick={openDrawer}
            className="relative px-4 py-2 bg-emerald-500 text-black text-sm font-bold rounded-lg hover:bg-emerald-400 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 inline-block mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            Cart
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                {totalItems > 99 ? "99+" : totalItems}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
