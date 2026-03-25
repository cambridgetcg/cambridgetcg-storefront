import Link from "next/link";

type Game = { id: number; name: string; slug: string };

export default function GameGrid({ games }: { games: Game[] }) {
  return (
    <section className="max-w-7xl mx-auto px-4 py-16">
      <h2 className="text-2xl font-bold mb-8">Shop by Game</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {games.map(g => (
          <Link key={g.id} href={`/catalog?game=${g.slug}`}
            className="group relative aspect-square rounded-2xl overflow-hidden bg-neutral-900 hover:ring-2 ring-emerald-500 transition">
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white font-bold text-lg group-hover:scale-110 transition">{g.name}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
