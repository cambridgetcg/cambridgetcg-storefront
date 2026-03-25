import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Image from "next/image";
import AddToCart from "@/components/cart/AddToCart";

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const [card] = await db.select().from(cards).where(eq(cards.sku, sku)).limit(1);
  if (!card) notFound();

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-neutral-900">
          {card.imageUrl && (
            <Image
              src={card.imageUrl}
              alt={card.nameEn || card.name || card.cardNumber}
              fill className="object-contain" priority
            />
          )}
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm text-neutral-400 uppercase tracking-wider">{card.setName} · {card.rarity}</p>
            <h1 className="text-3xl font-bold mt-1">{card.nameEn || card.name}</h1>
            <p className="text-neutral-400 mt-1">{card.cardNumber}</p>
          </div>
          <div className="text-4xl font-bold text-emerald-400">£{card.price?.toFixed(2)}</div>
          <div className="text-sm text-neutral-400">
            {card.stock && card.stock > 0 ? `${card.stock} in stock · Near Mint · Japanese` : "Out of stock"}
          </div>
          {card.stock && card.stock > 0 ? <AddToCart card={card} /> : <button disabled className="opacity-50 cursor-not-allowed px-8 py-4 rounded-xl bg-neutral-800">Out of Stock</button>}
        </div>
      </div>
    </div>
  );
}
