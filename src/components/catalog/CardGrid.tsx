import Link from "next/link";
import Image from "next/image";

export default function CardGrid({ cards }: { cards: any[] }) {
  if (!cards.length) return <p className="text-neutral-400 py-12 text-center">No cards found.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-8">
      {cards.map(card => (
        <Link key={card.sku} href={`/product/${card.sku}`}
          className="group bg-neutral-900 rounded-xl overflow-hidden hover:ring-2 ring-emerald-500 transition">
          <div className="relative aspect-[3/4]">
            {card.imageUrl ? (
              <Image src={card.imageUrl} alt={card.nameEn || card.name || ""} fill className="object-cover group-hover:scale-105 transition" />
            ) : <div className="w-full h-full bg-neutral-800" />}
          </div>
          <div className="p-2">
            <p className="text-xs text-neutral-400 truncate">{card.cardNumber}</p>
            <p className="text-sm font-bold text-emerald-400">£{card.price?.toFixed(2)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
