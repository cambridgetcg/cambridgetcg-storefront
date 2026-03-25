import { db } from "@/lib/db";
import { cards, games, sets } from "@/lib/db/schema";
import { eq, gt, asc, and, ilike, SQL } from "drizzle-orm";
import CardGrid from "@/components/catalog/CardGrid";
import CatalogFilters from "@/components/catalog/CatalogFilters";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; set?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1") || 1);
  const PER_PAGE = 48;

  const conditions: SQL[] = [gt(cards.stock, 0)];
  if (params.game) {
    const game = await db.select().from(games).where(eq(games.slug, params.game)).limit(1);
    if (game[0]) conditions.push(eq(cards.gameId, game[0].id));
  }
  if (params.set) conditions.push(eq(cards.setCode, params.set));
  if (params.q) conditions.push(ilike(cards.name, `%${params.q}%`));

  const [allCards, allGames] = await Promise.all([
    db.select().from(cards)
      .where(and(...conditions))
      .orderBy(asc(cards.setCode), asc(cards.cardNumber))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    db.select().from(games).where(eq(games.active, true)),
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <CatalogFilters games={allGames} current={params} />
      <CardGrid cards={allCards} />
    </div>
  );
}
