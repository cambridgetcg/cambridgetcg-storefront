import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spendPoints, earnPoints, addCredit } from "@/lib/membership/db";
import { query } from "@/lib/db";
import { postActivity } from "@/lib/social/db";

// POST — open a pack (spend points, get 5 cards)
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { id } = await params;

  // Get pack
  const packResult = await query(`SELECT * FROM reward_packs WHERE id=$1 AND status='active'`, [id]);
  if (packResult.rows.length === 0) return NextResponse.json({ error: "Pack not found." }, { status: 404 });
  const pack = packResult.rows[0];

  // Spend points
  const pointsResult = await spendPoints(session.user.id, pack.cost_points, "redeemed",
    `Opened pack: ${pack.title} (${pack.cost_points} Berries)`, id);
  if (!pointsResult.success) return NextResponse.json({ error: pointsResult.error }, { status: 400 });

  // Get pool
  const poolResult = await query(
    `SELECT * FROM reward_pack_pools WHERE pack_id=$1 ORDER BY sort_order`,
    [id]
  );
  const pool = poolResult.rows.filter(
    (r: { stock: number | null; awarded: number }) => r.stock === null || r.awarded < (r.stock ?? Infinity)
  );

  if (pool.length === 0) {
    // Refund if no cards available
    await earnPoints(session.user.id, pack.cost_points, "manual_credit", "Refund: pack pool empty", id);
    return NextResponse.json({ error: "Pack pool is empty." }, { status: 400 });
  }

  // Pull 5 cards using weighted probability
  const cards: {
    card_name: string;
    card_number: string | null;
    image_url: string | null;
    rarity: string;
    reward_type: string;
    reward_value: number;
  }[] = [];

  const totalProb = pool.reduce((s: number, r: { probability: string }) => s + parseFloat(r.probability), 0);

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

    // Update awarded count
    await query(`UPDATE reward_pack_pools SET awarded=awarded+1 WHERE id=$1`, [selected.id]);

    // Auto-fulfill points and credit rewards
    if (selected.reward_type === "points") {
      await earnPoints(session.user.id, parseFloat(selected.reward_value), "manual_credit",
        `Pack pull: ${selected.card_name}`, packResult.rows[0].id);
    } else if (selected.reward_type === "credit") {
      await addCredit(session.user.id, parseFloat(selected.reward_value), "manual_adjustment",
        `Pack pull: ${selected.card_name}`, packResult.rows[0].id);
    }
  }

  // Record the open
  await query(
    `INSERT INTO pack_opens (pack_id, user_id, cards, points_spent) VALUES ($1,$2,$3,$4)`,
    [id, session.user.id, JSON.stringify(cards), pack.cost_points]
  );
  await query(`UPDATE reward_packs SET total_opens=total_opens+1 WHERE id=$1`, [id]);

  // Activity
  const bestPull = cards.reduce((best, c) => {
    const rarityOrder: Record<string, number> = { SEC: 6, SR: 5, SP: 4, L: 4, R: 3, UC: 2, C: 1 };
    const bestScore = rarityOrder[best.rarity] || 0;
    const currScore = rarityOrder[c.rarity] || 0;
    return currScore > bestScore ? c : best;
  }, cards[0]);

  postActivity(session.user.id, "mystery_box_opened",
    `Opened ${pack.title} — pulled ${bestPull.card_name}!`,
    { imageUrl: bestPull.image_url || undefined }
  ).catch(() => {});

  return NextResponse.json({ cards, packTitle: pack.title });
}
