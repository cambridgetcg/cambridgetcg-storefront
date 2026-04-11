import { fetchPrices, type PriceItem } from "@/lib/wholesale/client";
import { formatPrice } from "@/lib/format";
import BuylistTable from "@/components/tradein/BuylistTable";
import SellCartBar from "@/components/tradein/SellCartBar";
import Link from "next/link";

export const metadata = {
  title: "Trade In Your Cards — Cambridge TCG",
  description:
    "Sell your trading cards for cash or store credit. Competitive prices, fast payouts. Near Mint cards accepted.",
};

export interface BuylistItem {
  sku: string;
  card_number: string;
  name: string;
  set_code: string | null;
  set_name: string | null;
  rarity: string | null;
  image_url: string | null;
  cash_price: number;
  credit_price: number;
  stock: number;
  cash_want: number;
  credit_want: number;
}

export default async function TradeInPage() {
  const [creditRes, cashRes] = await Promise.all([
    fetchPrices({ game: "one-piece", channel: "tradein-credit", limit: 2000 }),
    fetchPrices({ game: "one-piece", channel: "tradein-cash", limit: 2000 }),
  ]);

  // Build lookup of cash prices by SKU
  const cashMap = new Map<string, PriceItem>();
  for (const item of cashRes.items) {
    cashMap.set(item.sku, item);
  }

  // Merge into buylist
  const buylist: BuylistItem[] = creditRes.items
    .map((credit) => {
      const cash = cashMap.get(credit.sku);
      const creditPrice = credit.channel_price ?? 0;
      const cashPrice = cash?.channel_price ?? 0;
      const stock = credit.stock ?? 0;

      // Cash want tiers based on stock
      let cashWant: number;
      if (stock === 0) cashWant = 4;
      else if (stock <= 2) cashWant = 2;
      else cashWant = 0;

      // Credit: always unlimited
      const creditWant = 999;

      return {
        sku: credit.sku,
        card_number: credit.card_number,
        name: credit.name_en || credit.name || credit.card_number,
        set_code: credit.set_code,
        set_name: credit.set_name,
        rarity: credit.rarity,
        image_url: credit.image_url,
        cash_price: cashPrice,
        credit_price: creditPrice,
        stock,
        cash_want: cashWant,
        credit_want: creditWant,
      };
    })
    .filter((item) => item.credit_price > 0 || item.cash_price > 0)
    .filter((item) => {
      // Exclude standard C / UC / R — we only want parallels, alt arts, and premium rarities
      // Keep anything with /P, /SP, SR, SEC, SP, L, or parallel markers
      const r = (item.rarity ?? "").toUpperCase().trim();
      const EXCLUDED = new Set(["C", "R", "UC", "-", ""]);
      return !EXCLUDED.has(r);
    });

  // Stats for hero
  const cardsWanted = buylist.filter((i) => i.credit_price > 0).length;
  const maxCredit = Math.max(...buylist.map((i) => i.credit_price), 0);

  return (
    <main className="min-h-screen bg-neutral-950">
      {/* Hero */}
      <section className="border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 py-12 md:py-16">
          <h1 className="text-3xl md:text-5xl font-black text-white">
            Sell Your <span className="text-amber-400">Cards</span>
          </h1>
          <p className="text-neutral-400 mt-3 max-w-xl">
            Get cash or store credit for your trading cards. Competitive prices updated daily.
            Near Mint condition only.
          </p>
          <div className="flex flex-wrap gap-6 mt-6">
            <div className="bg-neutral-900 rounded-xl px-5 py-3">
              <p className="text-2xl font-bold text-amber-400">{cardsWanted}</p>
              <p className="text-xs text-neutral-400">Cards wanted</p>
            </div>
            <div className="bg-neutral-900 rounded-xl px-5 py-3">
              <p className="text-2xl font-bold text-amber-400">
                Up to {formatPrice(maxCredit)}
              </p>
              <p className="text-xs text-neutral-400">Credit per card</p>
            </div>
            <div className="bg-neutral-900 rounded-xl px-5 py-3">
              <p className="text-2xl font-bold text-amber-400">7 days</p>
              <p className="text-xs text-neutral-400">Price lock guarantee</p>
            </div>
          </div>
          <div className="flex gap-3 mt-6 text-sm">
            <Link
              href="/trade-in/terms"
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition"
            >
              Trade-in terms
            </Link>
            <span className="text-neutral-700">|</span>
            <Link
              href="/trade-in/submit"
              className="text-neutral-400 hover:text-white transition"
            >
              Check submission status
            </Link>
          </div>
        </div>
      </section>

      {/* Custom quote banner */}
      <section className="max-w-7xl mx-auto px-4 pt-8">
        <div className="bg-gradient-to-r from-amber-500/10 to-emerald-500/10 border border-amber-500/20 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-white font-bold">Have cards not on the buylist?</h2>
            <p className="text-neutral-400 text-sm mt-1">
              Send us photos of any cards — graded, alt arts, other games, bulk collections. We&apos;ll send you a custom offer.
            </p>
          </div>
          <Link
            href="/trade-in/custom-quote"
            className="shrink-0 px-5 py-2.5 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition"
          >
            Request Quote
          </Link>
        </div>
      </section>

      {/* Buylist */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <BuylistTable buylist={buylist} />
      </section>

      {/* Floating sell cart bar */}
      <SellCartBar />
    </main>
  );
}
