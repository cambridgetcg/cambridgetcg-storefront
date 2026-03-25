"use client";
export default function AddToCart({ card }: { card: any }) {
  return (
    <button className="px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition text-lg">
      Add to Cart — £{card.price?.toFixed(2)}
    </button>
  );
}
