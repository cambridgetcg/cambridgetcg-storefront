"use client";
import { useRouter } from "next/navigation";

export default function CatalogFilters({ games, current }: { games: any[]; current: any }) {
  const router = useRouter();
  return (
    <div className="flex gap-3 flex-wrap">
      <button onClick={() => router.push("/catalog")} className={`px-4 py-2 rounded-full text-sm font-medium transition ${!current.game ? "bg-emerald-500 text-black" : "bg-neutral-800 text-white hover:bg-neutral-700"}`}>All</button>
      {games.map(g => (
        <button key={g.id} onClick={() => router.push(`/catalog?game=${g.slug}`)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${current.game === g.slug ? "bg-emerald-500 text-black" : "bg-neutral-800 text-white hover:bg-neutral-700"}`}>
          {g.name}
        </button>
      ))}
    </div>
  );
}
