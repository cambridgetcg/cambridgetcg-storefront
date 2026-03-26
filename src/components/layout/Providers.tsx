"use client";

import { CartProvider } from "@/context/CartContext";
import { SellCartProvider } from "@/context/SellCartContext";
import CartDrawer from "@/components/cart/CartDrawer";
import SellCartDrawer from "@/components/tradein/SellCartDrawer";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <SellCartProvider>
        {children}
        <CartDrawer />
        <SellCartDrawer />
      </SellCartProvider>
    </CartProvider>
  );
}
