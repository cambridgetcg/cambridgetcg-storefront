import { db } from "@/lib/db";
import { cards, games } from "@/lib/db/schema";
import { eq, gt, desc } from "drizzle-orm";
import HeroSlideshow from "@/components/home/HeroSlideshow";
import GameGrid from "@/components/home/GameGrid";
import FeaturedCards from "@/components/home/FeaturedCards";
import StorySection from "@/components/home/StorySection";

export default async function Home() {
  const [allGames, featuredCards] = await Promise.all([
    db.select().from(games).where(eq(games.active, true)),
    db.select().from(cards)
      .where(gt(cards.stock, 0))
      .orderBy(desc(cards.price))
      .limit(12),
  ]);

  return (
    <main>
      <HeroSlideshow />
      <GameGrid games={allGames} />
      <StorySection />
      <FeaturedCards cards={featuredCards} />
    </main>
  );
}
