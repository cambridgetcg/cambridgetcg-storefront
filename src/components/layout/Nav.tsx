import Link from "next/link";

export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 bg-neutral-950/90 backdrop-blur border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-black text-white">Cambridge <span className="text-emerald-400">TCG</span></Link>
        <div className="flex items-center gap-6">
          <Link href="/catalog" className="text-sm text-neutral-300 hover:text-white transition">Catalog</Link>
          <Link href="/trade-in" className="text-sm text-neutral-300 hover:text-white transition">Trade In</Link>
          <Link href="/about" className="text-sm text-neutral-300 hover:text-white transition">About</Link>
          <Link href="/cart" className="px-4 py-2 bg-emerald-500 text-black text-sm font-bold rounded-lg hover:bg-emerald-400 transition">Cart</Link>
        </div>
      </div>
    </nav>
  );
}
