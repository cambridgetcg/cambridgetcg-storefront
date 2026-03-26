import { fetchPrices, fetchGames, fetchSets } from "@/lib/wholesale/client";
import type { PriceItem, SetItem } from "@/lib/wholesale/client";
import CardGrid from "@/components/catalog/CardGrid";
import CatalogFilters from "@/components/catalog/CatalogFilters";
import SetSidebar from "@/components/catalog/SetSidebar";
import Pagination from "@/components/catalog/Pagination";

interface CatalogParams {
  game?: string;
  set?: string;
  q?: string;
  page?: string;
  sort?: string;
  in_stock?: string;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1") || 1);
  const PER_PAGE = 48;

  // Fetch data in parallel
  const [prices, allGames, sets] = await Promise.all([
    fetchPrices({
      game: params.game,
      set: params.set,
      q: params.q,
      sort: params.sort,
      in_stock: params.in_stock === "true" ? true : undefined,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    }).catch((): { count: number; total: number; channel: string; items: PriceItem[] } => ({
      count: 0, total: 0, channel: '', items: [],
    })),
    fetchGames().catch(() => []),
    params.game ? fetchSets(params.game).catch(() => []) : Promise.resolve([] as SetItem[]),
  ]);

  // Find selected set info
  const selectedSet = params.set
    ? sets.find((s) => s.code === params.set) ?? null
    : null;

  // Extract unique rarities from current result set
  const rarities = [
    ...new Set(
      prices.items
        .map((c) => c.rarity)
        .filter((r): r is string => !!r)
    ),
  ].sort();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Level 1: Game tabs */}
      <CatalogFilters games={allGames} current={params} rarities={rarities} />

      {/* Search bar */}
      <CatalogSearch current={params} />

      {/* Level 2: Sidebar + card grid */}
      <div className="flex flex-col lg:flex-row gap-6 mt-6">
        {/* Set sidebar — only when a game is selected */}
        {params.game && sets.length > 0 && (
          <SetSidebar
            sets={sets}
            currentGame={params.game}
            currentSet={params.set}
          />
        )}

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          {/* Set header */}
          {selectedSet && (
            <div className="mb-4 pb-4 border-b border-neutral-800">
              <h1 className="text-2xl font-bold text-white">{selectedSet.name}</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-neutral-400">
                <span className="font-mono bg-neutral-800 px-2 py-0.5 rounded text-xs">
                  {selectedSet.code}
                </span>
                <span>{selectedSet.card_count} cards</span>
                {selectedSet.release_date && (
                  <span>Released {selectedSet.release_date}</span>
                )}
              </div>
            </div>
          )}

          {/* Results count */}
          <p className="text-sm text-neutral-500 mb-2">
            {prices.total} {prices.total === 1 ? "card" : "cards"} found
          </p>

          <CardGrid cards={prices.items} />
          <Pagination
            total={prices.total}
            page={page}
            perPage={PER_PAGE}
            searchParams={{ ...params }}
          />
        </div>
      </div>
    </div>
  );
}

function CatalogSearch({
  current,
}: {
  current: { q?: string; game?: string; set?: string };
}) {
  return (
    <form action="/catalog" className="mt-4">
      {current.game && <input type="hidden" name="game" value={current.game} />}
      {current.set && <input type="hidden" name="set" value={current.set} />}
      <div className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={current.q || ""}
          placeholder="Search cards..."
          className="flex-1 px-4 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="submit"
          className="px-6 py-2 bg-emerald-500 text-black font-medium rounded-lg hover:bg-emerald-400 transition"
        >
          Search
        </button>
      </div>
    </form>
  );
}
