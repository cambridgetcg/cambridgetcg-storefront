import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { initializeGame } from "@/lib/game/engine";
import { aiTurn, generateAIDeck } from "@/lib/game/ai";
import { earnPoints, addCredit } from "@/lib/membership/db";
import { postActivity, awardAchievement } from "@/lib/social/db";

// POST — start a PVE game or perform AI turn
export async function POST(request: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { levelId } = await params;
  const body = await request.json();

  // Get level
  const levelResult = await query(`SELECT * FROM pve_levels WHERE id=$1 AND is_active=true`, [levelId]);
  if (levelResult.rows.length === 0) return NextResponse.json({ error: "Level not found." }, { status: 404 });
  const level = levelResult.rows[0];

  // Check unlock
  const highestCleared = await query(
    `SELECT MAX(l.level_number) as max_level FROM pve_progress p JOIN pve_levels l ON p.level_id=l.id WHERE p.user_id=$1 AND p.cleared=true`,
    [session.user.id]
  );
  const maxLevel = highestCleared.rows[0]?.max_level || 0;
  if (level.required_level > maxLevel) {
    return NextResponse.json({ error: `Complete level ${level.required_level} first.` }, { status: 403 });
  }

  // Action: start new game
  if (body.action === "start") {
    const playerDeck = body.deck;
    if (!playerDeck || playerDeck.length < 10) {
      return NextResponse.json({ error: "Load a deck first." }, { status: 400 });
    }

    // Generate AI deck from the level's set or use stored deck
    let aiDeck = level.ai_deck;
    if (!aiDeck || aiDeck.length === 0) {
      // Generate from catalog
      const catalogRes = await fetch(`https://cambridgetcg.com/api/market/catalog?game=one-piece&set=${level.set_code || 'OP01'}&limit=200`);
      const catalogData = await catalogRes.json().catch(() => ({ cards: [] }));
      aiDeck = generateAIDeck(level.set_code || "OP01", catalogData.cards || []);
    }

    // Initialize game
    const gameState = initializeGame(
      session.user.id, session.user.name || "Player", playerDeck,
      `ai_${level.id}`, level.opponent_name, aiDeck
    );

    // Create PVE game record
    const gameResult = await query(
      `INSERT INTO pve_games (user_id, level_id, game_state, status) VALUES ($1,$2,$3,'playing') RETURNING id`,
      [session.user.id, level.id, JSON.stringify(gameState)]
    );

    return NextResponse.json({
      gameId: gameResult.rows[0].id,
      state: gameState,
      opponent: { name: level.opponent_name, icon: level.opponent_icon, difficulty: level.difficulty },
    });
  }

  // Action: AI takes a turn
  if (body.action === "ai_turn") {
    const { gameId } = body;
    if (!gameId) return NextResponse.json({ error: "Game ID required." }, { status: 400 });

    const game = await query(`SELECT * FROM pve_games WHERE id=$1 AND user_id=$2 AND status='playing'`, [gameId, session.user.id]);
    if (game.rows.length === 0) return NextResponse.json({ error: "Game not found." }, { status: 404 });

    const state = game.rows[0].game_state;
    const aggression = parseFloat(level.ai_aggression);

    // Determine which player is the AI
    const aiPlayer = state.player1.userId.startsWith("ai_") ? "player1" : "player2";

    const decision = aiTurn(state, aiPlayer, aggression);

    // Apply all AI actions to the state
    // (In the simplified version, we just store the actions and let the client replay them)

    await query(
      `UPDATE pve_games SET game_state=$2, turn_number=turn_number+1, last_action_at=NOW() WHERE id=$1`,
      [gameId, JSON.stringify(state)]
    );

    return NextResponse.json({ actions: decision.actions, thinking: decision.thinking });
  }

  // Action: claim victory
  if (body.action === "victory") {
    const { gameId, turnsPlayed, lifeRemaining } = body;
    if (!gameId) return NextResponse.json({ error: "Game ID required." }, { status: 400 });

    const game = await query(`SELECT * FROM pve_games WHERE id=$1 AND user_id=$2 AND status='playing'`, [gameId, session.user.id]);
    if (game.rows.length === 0) return NextResponse.json({ error: "Game not found." }, { status: 404 });

    // Mark game complete
    await query(
      `UPDATE pve_games SET status='won', result='win', turn_number=$2, ended_at=NOW() WHERE id=$1`,
      [gameId, turnsPlayed || 0]
    );

    // Check if first clear
    const progressResult = await query(
      `SELECT * FROM pve_progress WHERE user_id=$1 AND level_id=$2`,
      [session.user.id, level.id]
    );

    const isFirstClear = progressResult.rows.length === 0 || !progressResult.rows[0].cleared;
    const points = isFirstClear ? level.first_clear_points : level.repeat_points;
    const credit = isFirstClear ? parseFloat(level.first_clear_credit || "0") : 0;

    // Update progress
    await query(
      `INSERT INTO pve_progress (user_id, level_id, cleared, clear_count, best_turns, best_life_remaining, total_points_earned, first_cleared_at)
       VALUES ($1, $2, true, 1, $3, $4, $5, NOW())
       ON CONFLICT (user_id, level_id) DO UPDATE SET
         cleared=true, clear_count=pve_progress.clear_count+1,
         best_turns=LEAST(pve_progress.best_turns, $3),
         best_life_remaining=GREATEST(pve_progress.best_life_remaining, $4),
         total_points_earned=pve_progress.total_points_earned+$5,
         last_played_at=NOW()`,
      [session.user.id, level.id, turnsPlayed || null, lifeRemaining || null, points]
    );

    // Award points
    if (points > 0) {
      await earnPoints(session.user.id, points, "manual_credit",
        `PVE Victory: ${level.title} (${isFirstClear ? "first clear" : "repeat"})`, gameId);
    }

    // Award credit
    if (credit > 0) {
      await addCredit(session.user.id, credit, "manual_adjustment",
        `PVE First Clear Bonus: ${level.title}`, gameId);
    }

    // Social
    postActivity(session.user.id, "achievement_earned",
      `Defeated ${level.opponent_name} in ${level.title}!`
    ).catch(() => {});

    return NextResponse.json({
      victory: true,
      firstClear: isFirstClear,
      pointsEarned: points,
      creditEarned: credit,
      level: level.level_number,
      nextLevel: level.level_number + 1,
    });
  }

  // Action: defeat
  if (body.action === "defeat") {
    const { gameId } = body;
    await query(
      `UPDATE pve_games SET status='lost', result='loss', ended_at=NOW() WHERE id=$1 AND user_id=$2`,
      [gameId, session.user.id]
    );
    return NextResponse.json({ defeat: true, message: "Try again! Your deck is ready." });
  }

  return NextResponse.json({ error: "Invalid action." }, { status: 400 });
}
