export default function StorySection() {
  return (
    <section className="bg-neutral-950 py-24 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-emerald-400 text-sm uppercase tracking-widest mb-4">Our Story</p>
        <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">
          Everyone doubted the path.<br />Only you knew what was ahead.
        </h2>
        <p className="mt-6 text-neutral-400 text-lg leading-relaxed">
          Cambridge TCG was built by collectors, for collectors. We source direct from Japan — every card
          authenticated, every price fair, every order packed with care. The treasure isn&apos;t just the card.
          It&apos;s knowing you found it.
        </p>
        <a href="/about" className="mt-8 inline-block text-emerald-400 hover:text-white transition">
          Read the full story →
        </a>
      </div>
    </section>
  );
}
