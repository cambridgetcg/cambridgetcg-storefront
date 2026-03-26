import { fetchCard, fetchPrices } from "@/lib/wholesale/client";
import { formatRetailPrice, retailPrice } from "@/lib/pricing";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import AddToCart from "@/components/cart/AddToCart";
import NotifyMe from "@/components/product/NotifyMe";
import CardGrid from "@/components/catalog/CardGrid";

function rarityBadgeClasses(rarity: string | null): string | null {
  if (!rarity) return null;
  const r = rarity.toUpperCase();
  if (r === "SR" || r === "SEC" || r === "SP" || r === "SCR" || r === "L")
    return "bg-yellow-500/20 text-yellow-400";
  if (r === "R" || r === "RR" || r === "SSR")
    return "bg-purple-500/20 text-purple-400";
  if (r === "UC")
    return "bg-blue-500/20 text-blue-400";
  if (r === "C")
    return "bg-neutral-700 text-neutral-400";
  return null;
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const card = await fetchCard(sku);
  if (!card) notFound();

  // Fetch related cards from the same set
  const related = card.set_code
    ? await fetchPrices({ set: card.set_code, limit: 7, in_stock: true }).catch(() => ({ items: [] }))
    : { items: [] };
  const relatedCards = related.items.filter((c) => c.sku !== card.sku).slice(0, 6);

  const rarityClasses = rarityBadgeClasses(card.rarity);

  // Determine game slug from set_code pattern
  const gameSlug = "onepiece";

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-neutral-500 mb-8">
        <Link href="/" className="hover:text-white transition">Home</Link>
        <span>/</span>
        <Link href={`/catalog?game=${gameSlug}`} className="hover:text-white transition">One Piece</Link>
        {card.set_name && (
          <>
            <span>/</span>
            <Link
              href={`/catalog?game=${gameSlug}&set=${card.set_code}`}
              className="hover:text-white transition"
            >
              {card.set_name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-neutral-400">{card.card_number}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        {/* Card image */}
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-neutral-900">
          {card.image_url && (
            <Image
              src={card.image_url}
              alt={card.name_en || card.name || card.card_number}
              fill
              className="object-contain"
              priority
            />
          )}
        </div>

        {/* Card details */}
        <div className="flex flex-col gap-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-neutral-400 uppercase tracking-wider">
              <span>{card.set_name}</span>
              {card.rarity && rarityClasses && (
                <span className={`px-2 py-0.5 text-xs font-bold rounded-full normal-case ${rarityClasses}`}>
                  {card.rarity}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold mt-1">{card.name_en || card.name}</h1>
            <p className="text-neutral-400 mt-1">{card.card_number}</p>
          </div>

          <div className="text-4xl font-bold text-emerald-400">{formatRetailPrice(card.price_gbp)}</div>

          {/* Stock indicator */}
          <div className="text-sm">
            {card.stock > 5 ? (
              <span className="text-neutral-400">In Stock · Near Mint · Japanese</span>
            ) : card.stock > 0 ? (
              <span className="text-amber-400">
                ⚠️ Only {card.stock} left · Near Mint · Japanese
              </span>
            ) : (
              <span className="text-red-400">Out of Stock</span>
            )}
          </div>

          {/* Add to cart / Out of stock actions */}
          {card.stock > 0 ? (
            <AddToCart
              card={{
                sku: card.sku,
                name: card.name_en || card.name || card.card_number,
                price: retailPrice(card.price_gbp),
                image_url: card.image_url,
                set_code: card.set_code,
                card_number: card.card_number,
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <button
                disabled
                className="opacity-50 cursor-not-allowed px-8 py-4 rounded-xl bg-neutral-800 font-bold"
              >
                Out of Stock
              </button>
              <NotifyMe />
            </div>
          )}
        </div>
      </div>

      {/* Related cards */}
      {relatedCards.length > 0 && (
        <div className="mt-16">
          <h2 className="text-xl font-bold text-white mb-2">You may also like</h2>
          <p className="text-sm text-neutral-500 mb-4">More cards from {card.set_name}</p>
          <CardGrid cards={relatedCards} />
        </div>
      )}
    </div>
  );
}
