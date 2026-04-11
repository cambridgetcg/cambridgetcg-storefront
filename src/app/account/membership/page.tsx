const TIERS = [
  {
    name: "Bronze",
    color: "amber-700",
    requirement: "Free — all members",
    perks: [
      "Trade-in submissions",
      "Order history tracking",
      "Early access to restocks",
    ],
  },
  {
    name: "Silver",
    color: "neutral-400",
    requirement: "£50+ annual spend",
    perks: [
      "All Bronze perks",
      "5% store credit bonus on trade-ins",
      "Priority grading queue",
    ],
  },
  {
    name: "Gold",
    color: "amber-400",
    requirement: "£200+ annual spend",
    perks: [
      "All Silver perks",
      "10% store credit bonus on trade-ins",
      "Free shipping on orders over £20",
      "Exclusive Gold-only promotions",
    ],
  },
];

const COLOR_MAP: Record<string, { border: string; text: string; badge: string }> = {
  "amber-700": {
    border: "border-amber-700/40",
    text: "text-amber-700",
    badge: "bg-amber-700/20 text-amber-700",
  },
  "neutral-400": {
    border: "border-neutral-500/40",
    text: "text-neutral-300",
    badge: "bg-neutral-500/20 text-neutral-300",
  },
  "amber-400": {
    border: "border-amber-400/40",
    text: "text-amber-400",
    badge: "bg-amber-400/20 text-amber-400",
  },
};

export default function MembershipPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Membership</h1>
      <p className="text-neutral-400 mb-8">Coming Soon</p>

      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => {
          const colors = COLOR_MAP[tier.color];
          return (
            <div
              key={tier.name}
              className={`bg-neutral-900 rounded-xl p-5 border ${colors.border}`}
            >
              <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full mb-3 ${colors.badge}`}>
                {tier.name}
              </span>
              <p className="text-sm text-neutral-400 mb-4">{tier.requirement}</p>
              <ul className="space-y-2">
                {tier.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sm text-neutral-300">
                    <span className="text-emerald-400 mt-0.5">&#10003;</span>
                    {perk}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
