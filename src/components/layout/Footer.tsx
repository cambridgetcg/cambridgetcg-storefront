import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-neutral-950 border-t border-neutral-800 py-12 px-4 mt-24">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between gap-8">
        <div>
          <p className="text-xl font-black text-white">Cambridge <span className="text-emerald-400">TCG</span></p>
          <p className="text-sm text-neutral-400 mt-2 max-w-xs">Japanese trading card specialists. Authentic cards, sourced direct from Japan.</p>
        </div>
        <div className="flex gap-12 text-sm text-neutral-400">
          <div className="flex flex-col gap-2">
            <p className="text-white font-medium mb-1">Shop</p>
            <Link href="/catalog?game=one-piece" className="hover:text-white transition">One Piece</Link>
            <Link href="/catalog?game=pokemon" className="hover:text-white transition">Pokémon</Link>
            <Link href="/catalog?game=dragon-ball" className="hover:text-white transition">Dragon Ball</Link>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-white font-medium mb-1">Services</p>
            <Link href="/trade-in" className="hover:text-white transition">Trade In</Link>
            <Link href="/about" className="hover:text-white transition">About</Link>
            <a href="https://wholesaletcgdirect.com" className="hover:text-white transition">Wholesale</a>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-neutral-800 text-xs text-neutral-600">
        © {new Date().getFullYear()} Cambridge TCG Ltd. All rights reserved.
      </div>
    </footer>
  );
}
