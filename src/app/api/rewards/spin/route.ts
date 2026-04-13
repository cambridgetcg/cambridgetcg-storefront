import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { spendPoints, earnPoints, addCredit } from "@/lib/membership/db";
import { query } from "@/lib/db";

interface Segment {
  label: string;
  reward_type: string;
  reward_value: number;
  color: string;
  probability: number;
}

// GET — spin wheel config + user's spins today
export async function GET() {
  const session = await auth();

  const configResult = await query(`SELECT * FROM spin_config LIMIT 1`);
  const config = configResult.rows[0];
  const segments: Segment[] = config?.segments || [];

  let spinsToday = 0;
  let streak = 0;
  if (session?.user?.id) {
    const todaySpins = await query(
      `SELECT COUNT(*) FROM spin_results WHERE user_id=$1 AND NOT is_premium AND created_at::date=CURRENT_DATE`,
      [session.user.id]
    );
    spinsToday = parseInt(todaySpins.rows[0].count, 10);

    // Update streak
    const streakResult = await query(
      `INSERT INTO user_streaks (user_id, current_streak, last_visit_date, total_visits)
       VALUES ($1, 1, CURRENT_DATE, 1)
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = CASE
           WHEN user_streaks.last_visit_date = CURRENT_DATE THEN user_streaks.current_streak
           WHEN user_streaks.last_visit_date = CURRENT_DATE - 1 THEN user_streaks.current_streak + 1
           ELSE 1
         END,
         longest_streak = GREATEST(user_streaks.longest_streak,
           CASE
             WHEN user_streaks.last_visit_date = CURRENT_DATE THEN user_streaks.current_streak
             WHEN user_streaks.last_visit_date = CURRENT_DATE - 1 THEN user_streaks.current_streak + 1
             ELSE 1
           END
         ),
         last_visit_date = CURRENT_DATE,
         total_visits = user_streaks.total_visits + CASE WHEN user_streaks.last_visit_date = CURRENT_DATE THEN 0 ELSE 1 END,
         streak_multiplier = LEAST(1.50, 1.00 + (
           CASE
             WHEN user_streaks.last_visit_date = CURRENT_DATE THEN user_streaks.current_streak
             WHEN user_streaks.last_visit_date = CURRENT_DATE - 1 THEN user_streaks.current_streak + 1
             ELSE 1
           END - 1) * 0.02),
         updated_at = NOW()
       RETURNING *`,
      [session.user.id]
    );
    streak = streakResult.rows[0]?.current_streak || 0;
  }

  return NextResponse.json({
    segments: segments.map(s => ({ label: s.label, color: s.color })), // hide probabilities
    freeSpinsPerDay: config?.free_spins_per_day || 1,
    premiumCost: config?.premium_cost_points || 500,
    spinsUsedToday: spinsToday,
    streak,
    canFreeSpin: spinsToday < (config?.free_spins_per_day || 1),
  });
}

// POST — spin the wheel
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await request.json();
  const isPremium = body.premium === true;

  const configResult = await query(`SELECT * FROM spin_config LIMIT 1`);
  const config = configResult.rows[0];
  if (!config) return NextResponse.json({ error: "Spin wheel not configured." }, { status: 500 });

  const segments: Segment[] = config.segments;

  // Check free spin availability
  if (!isPremium) {
    const todaySpins = await query(
      `SELECT COUNT(*) FROM spin_results WHERE user_id=$1 AND NOT is_premium AND created_at::date=CURRENT_DATE`,
      [session.user.id]
    );
    if (parseInt(todaySpins.rows[0].count, 10) >= config.free_spins_per_day) {
      return NextResponse.json({ error: "No free spins left today. Use premium spin (500 pts)." }, { status: 400 });
    }
  }

  // Spend points for premium spin
  if (isPremium) {
    const result = await spendPoints(session.user.id, config.premium_cost_points, "redeemed",
      `Premium spin (${config.premium_cost_points} pts)`);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Weighted random selection
  const totalProb = segments.reduce((s: number, seg: Segment) => s + seg.probability, 0);
  let roll = Math.random() * totalProb;
  let selectedIndex = 0;
  let selected = segments[0];

  for (let i = 0; i < segments.length; i++) {
    roll -= segments[i].probability;
    if (roll <= 0) { selectedIndex = i; selected = segments[i]; break; }
  }

  // Award reward
  if (selected.reward_type === "points" && selected.reward_value > 0) {
    await earnPoints(session.user.id, selected.reward_value, "manual_credit",
      `Spin wheel: ${selected.label}`);
  } else if (selected.reward_type === "credit" && selected.reward_value > 0) {
    await addCredit(session.user.id, selected.reward_value, "manual_adjustment",
      `Spin wheel: ${selected.label}`);
  }

  // Record result
  await query(
    `INSERT INTO spin_results (user_id, segment_index, reward_type, reward_value, reward_label, is_premium)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [session.user.id, selectedIndex, selected.reward_type, selected.reward_value, selected.label, isPremium]
  );

  return NextResponse.json({
    segmentIndex: selectedIndex,
    reward: { type: selected.reward_type, value: selected.reward_value, label: selected.label },
  });
}
