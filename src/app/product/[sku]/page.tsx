import { fetchCard } from "@/lib/wholesale/client";
import { notFound } from "next/navigation";
import Image from "next/image";
import AddToCart from "@/components/cart/AddToCart";

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const card = await fetchCard(sku);
  if (!card) notFound();

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-neutral-900">
          {card.image_url && (
            <Image
              src={card.image_url}
              alt={card.name_en || card.name || card.card_number}
              fill className="object-contain" priority
            />
          )}
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm text-neutral-400 uppercase tracking-wider">{card.set_name} · {card.rarity}</p>
            <h1 className="text-3xl font-bold mt-1">{card.name_en || card.name}</h1>
            <p className="text-neutral-400 mt-1">{card.card_number}</p>
          </div>
          <div className="text-4xl font-bold text-emerald-400">£{card.price_gbp.toFixed(2)}</div>
          <div className="text-sm text-neutral-400">
            {card.stock > 0 ? `${card.stock} in stock · Near Mint · Japanese` : "Out of stock"}
          </div>
          {card.stock > 0 ? (
            <AddToCart card={{
              sku: card.sku,
              name: card.name_en || card.name || card.card_number,
              price: card.price_gbp,
              image_url: card.image_url,
              set_code: card.set_code,
              card_number: card.card_number,
            }} />
          ) : (
            <button disabled className="opacity-50 cursor-not-allowed px-8 py-4 rounded-xl bg-neutral-800">Out of Stock</button>
          )}
        </div>
      </div>
    </div>
  );
}
