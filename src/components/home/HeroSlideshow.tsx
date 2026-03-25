"use client";
import Image from "next/image";

const slides = [
  { src: "https://cdn.shopify.com/s/files/1/0745/4903/5273/t/17/assets/cambridge-tcg-hero-1.jpg", headline: "Find Your ONE PIECE", sub: "Premium Japanese trading cards, sourced direct from Japan" },
  { src: "https://cdn.shopify.com/s/files/1/0745/4903/5273/t/17/assets/cambridge-tcg-hero-2.jpg", headline: "Every Card Has a Story", sub: "Near Mint condition. Authenticated. Yours." },
  { src: "https://cdn.shopify.com/s/files/1/0745/4903/5273/t/17/assets/cambridge-tcg-hero-3.jpg", headline: "The Treasure Is Real", sub: "Cambridge TCG — the collector's choice" },
];

export default function HeroSlideshow() {
  return (
    <section className="relative h-[580px] w-full overflow-hidden bg-neutral-950">
      {slides.map((slide, i) => (
        <div key={i} className={`absolute inset-0 transition-opacity duration-1000 ${i === 0 ? "opacity-100" : "opacity-0"}`}>
          <Image src={slide.src} alt={slide.headline} fill className="object-cover opacity-60" priority={i === 0} />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight drop-shadow-lg">{slide.headline}</h1>
            <p className="mt-4 text-lg text-white/80 max-w-xl">{slide.sub}</p>
            <a href="/catalog" className="mt-8 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition">Shop Now</a>
          </div>
        </div>
      ))}
    </section>
  );
}
