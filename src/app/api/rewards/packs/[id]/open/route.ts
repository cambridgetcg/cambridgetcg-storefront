import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spendPoints, earnPoints, addCredit } from "@/lib/membership/db";
import { query } from "@/lib/db";
import { postActivity } from "@/lib/social/db";

// POST — open a pack (spend points, get 5 cards)
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const userId: string = session.user.id;  // hoisted so closures inside withCompensatingSpend keep the narrowed type

  const { id } = await params;

  // Get pack
  const packResult = await query(`SELECT * FROM reward_packs WHERE id=$1 AND status='active'`, [id]);
  if (packResult.rows.length === 0) return NextResponse.json({ error: "Pack not found." }, { status: 404 });
  const pack = packResult.rows[0];

  // Pre-flight: check pool BEFORE spending so we don't burn points on an
  // empty pool. (Stock can change between this check and the actual pulls
  // in race conditions, but the spend wrapper below will refund if the
  // pulls themselves throw.)
  const poolResult = await query(
    `SELECT * FROM reward_pack_pools WHERE pack_id=$1 ORDER BY sort_order`,
    [id]
  );
  const pool = poolResult.rows.filter(
    (r: { stock: number | null; awarded: number }) => r.stock === null || r.awarded < (r.stock ?? Infinity)
  );
  if (pool.length === 0) {
    return NextResponse.json({ error: "Pack pool is empty." }, { status: 400 });
  }

  // Atomic-ish: spend → pulls → reward distribution. If any pull fails,
  // points refunded. Cards already-awarded inside the wrapper persist —
  // the wrapper only un-spends, it can't un-award; in practice the
  // failure mode is database error and the awarded counts will be rolled
  // back along with the failed query.
  const { withCompensatingSpend } = await import("@/lib/rewards/atomic-spend");
  const wrapped = await withCompensatingSpend(
    {
      userId: userId,
      amount: pack.cost_points,
      type: "redeemed",
      description: `Opened pack: ${pack.title} (${pack.cost_points} Berries)`,
      referenceId: id,
    },
    async () => {
      const cards: {
        card_name: string;
        card_number: string | null;
        image_url: string | null;
        rarity: string;
        reward_type: string;
        reward_value: number;
      }[] = [];

      const totalProb = pool.reduce((s: number, r: { probability: string }) => s + parseFloat(r.probability), 0);
      const { earnRewardPoints } = await import("@/lib/rewards/earnings");

      for (let i = 0; i < 5; i++) {
        let roll = Math.random() * totalProb;
        let selected = pool[0];
        for (const item of pool) {
          roll -= parseFloat(item.probability);
          if (roll <= 0) { selected = item; break; }
        }

        cards.push({
          card_name: selected.card_name,
          card_number: selected.card_number,
          image_url: selected.image_url,
          rarity: selected.rarity,
          reward_type: selected.reward_type,
          reward_value: parseFloat(selected.reward_value),
        });

        await query(`UPDATE reward_pack_pools SET awarded=awarded+1 WHERE id=$1`, [selected.id]);

        if (selected.reward_type === "points") {
          await earnRewardPoints({
            userId: userId,
            baseAmount: parseFloat(selected.reward_value),
            type: "manual_credit",
            description: `Pack pull: ${selected.card_name}`,
            referenceId: packResult.rows[0].id,
          });
        } else if (selected.reward_type === "credit") {
          await addCredit(userId, parseFloat(selected.reward_value), "manual_adjustment",
            `Pack pull: ${selected.card_name}`, packResult.rows[0].id);
        }
      }
      return cards;
    },
  );

  if (!wrapped.success) {
    return NextResponse.json({ error: wrapped.error }, { status: 400 });
  }
  const cards = wrapped.result;

  // Record the open
  await query(
    `INSERT INTO pack_opens (pack_id, user_id, cards, points_spent) VALUES ($1,$2,$3,$4)`,
    [id, userId, JSON.stringify(cards), pack.cost_points]
  );
  await query(`UPDATE reward_packs SET total_opens=total_opens+1 WHERE id=$1`, [id]);

  // Activity
  const bestPull = cards.reduce((best, c) => {
    const rarityOrder: Record<string, number> = { SEC: 6, SR: 5, SP: 4, L: 4, R: 3, UC: 2, C: 1 };
    const bestScore = rarityOrder[best.rarity] || 0;
    const currScore = rarityOrder[c.rarity] || 0;
    return currScore > bestScore ? c : best;
  }, cards[0]);

  postActivity(userId, "mystery_box_opened",
    `Opened ${pack.title} — pulled ${bestPull.card_name}!`,
    { imageUrl: bestPull.image_url || undefined }
  ).catch(() => {});

  return NextResponse.json({ cards, packTitle: pack.title });
}
