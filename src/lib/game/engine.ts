// OPTCG Game Engine — manages game state, turns, and actions

import { query } from "@/lib/db";
import type { GameState, PlayerState, GameCard, GameAction, GamePhase } from "./types";
import crypto from "crypto";

// ── Room Management ──

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createRoom(userId: string, userName: string, isPublic: boolean = false) {
  const code = generateCode();
  const result = await query(
    `INSERT INTO game_rooms (code, player1_id, player1_name, is_public)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [code, userId, userName, isPublic]
  );
  return result.rows[0];
}

export async function joinRoom(code: string, userId: string, userName: string) {
  const room = await query(`SELECT * FROM game_rooms WHERE code=$1 AND status='waiting'`, [code]);
  if (room.rows.length === 0) return { error: "Room not found or already started." };
  if (room.rows[0].player1_id === userId) return { error: "You can't join your own room." };

  const result = await query(
    `UPDATE game_rooms SET player2_id=$2, player2_name=$3, status='playing', last_action_at=NOW()
     WHERE code=$1 AND status='waiting' RETURNING *`,
    [code, userId, userName]
  );
  return result.rows[0] || { error: "Room no longer available." };
}

export async function getRoom(code: string) {
  const result = await query(`SELECT * FROM game_rooms WHERE code=$1`, [code]);
  return result.rows[0] || null;
}

export async function listPublicRooms() {
  const result = await query(
    `SELECT code, player1_name, status, created_at FROM game_rooms
     WHERE is_public=true AND status IN ('waiting','playing')
     ORDER BY created_at DESC LIMIT 20`
  );
  return result.rows;
}

// ── Game Setup ──

function makeCard(sku: string, name: string, cardNumber: string, imageUrl: string | null, rarity: string | null, zone: string): GameCard {
  return {
    id: crypto.randomUUID(),
    sku, name, cardNumber, imageUrl, rarity,
    isRested: false, attachedDon: 0,
    zone: zone as GameCard["zone"],
    position: 0, faceDown: zone === "life" || zone === "deck",
  };
}

export function initializeGame(
  player1Id: string, player1Name: string, player1Deck: { sku: string; name: string; cardNumber: string; imageUrl: string | null; rarity: string | null; isLeader?: boolean }[],
  player2Id: string, player2Name: string, player2Deck: { sku: string; name: string; cardNumber: string; imageUrl: string | null; rarity: string | null; isLeader?: boolean }[]
): GameState {
  function setupPlayer(userId: string, name: string, deck: typeof player1Deck): PlayerState {
    const leader = deck.find(c => c.isLeader);
    const mainDeck = deck.filter(c => !c.isLeader);

    // Shuffle
    for (let i = mainDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mainDeck[i], mainDeck[j]] = [mainDeck[j], mainDeck[i]];
    }

    const leaderCard = leader
      ? makeCard(leader.sku, leader.name, leader.cardNumber, leader.imageUrl, leader.rarity, "leader")
      : null;

    // Life cards = top N cards (based on leader's life, default 5)
    const lifeCount = 5;
    const lifeCards = mainDeck.splice(0, lifeCount).map((c, i) => {
      const card = makeCard(c.sku, c.name, c.cardNumber, c.imageUrl, c.rarity, "life");
      card.faceDown = true;
      card.position = i;
      return card;
    });

    // Hand = next 5 cards
    const handCards = mainDeck.splice(0, 5).map((c, i) => {
      const card = makeCard(c.sku, c.name, c.cardNumber, c.imageUrl, c.rarity, "hand");
      card.faceDown = false;
      card.position = i;
      return card;
    });

    // Remaining = deck
    const deckCards = mainDeck.map((c, i) => {
      const card = makeCard(c.sku, c.name, c.cardNumber, c.imageUrl, c.rarity, "deck");
      card.faceDown = true;
      card.position = i;
      return card;
    });

    return {
      userId, name,
      leader: leaderCard,
      field: [],
      stage: null,
      hand: handCards,
      life: lifeCards,
      trash: [],
      deck: deckCards,
      donActive: 0,
      donRested: 0,
      donDeck: 10,
      lifeCount,
    };
  }

  const p1 = setupPlayer(player1Id, player1Name, player1Deck);
  const p2 = setupPlayer(player2Id, player2Name, player2Deck);

  // Random first player
  const firstPlayer = Math.random() < 0.5 ? player1Id : player2Id;

  return {
    player1: p1,
    player2: p2,
    currentTurn: firstPlayer,
    turnNumber: 1,
    phase: "main",
    firstPlayer,
  };
}

// ── Game Actions ──

export async function performAction(roomCode: string, userId: string, action: GameAction) {
  const room = await getRoom(roomCode);
  if (!room || room.status !== "playing") return { error: "Game not active." };

  const state: GameState = room.game_state;
  if (!state.player1 || !state.player2) return { error: "Game not initialized." };

  const isP1 = state.player1.userId === userId;
  const isP2 = state.player2.userId === userId;
  if (!isP1 && !isP2) return { error: "You're not in this game." };

  const player = isP1 ? state.player1 : state.player2;
  const opponent = isP1 ? state.player2 : state.player1;

  // Process action
  switch (action.type) {
    case "move_card": {
      const { cardId, toZone, faceDown } = action.data as { cardId: string; toZone: string; faceDown?: boolean };
      // Find card in any zone
      const allCards = [...player.hand, ...player.field, player.leader, player.stage, ...player.life, ...player.trash, ...player.deck].filter(Boolean) as GameCard[];
      const card = allCards.find(c => c.id === cardId);
      if (!card) break;

      // Remove from current zone
      const removeFrom = (zone: GameCard[]) => zone.filter(c => c.id !== cardId);
      player.hand = removeFrom(player.hand);
      player.field = removeFrom(player.field);
      player.life = removeFrom(player.life);
      player.trash = removeFrom(player.trash);
      player.deck = removeFrom(player.deck);
      if (player.leader?.id === cardId) player.leader = null;
      if (player.stage?.id === cardId) player.stage = null;

      // Add to target zone
      card.zone = toZone as GameCard["zone"];
      card.faceDown = faceDown ?? false;
      if (toZone === "field") player.field.push(card);
      else if (toZone === "hand") { card.faceDown = false; player.hand.push(card); }
      else if (toZone === "trash") { card.faceDown = false; player.trash.push(card); }
      else if (toZone === "life") { card.faceDown = true; player.life.push(card); }
      else if (toZone === "stage") player.stage = card;
      else if (toZone === "leader") player.leader = card;
      break;
    }

    case "toggle_rest": {
      const { cardId } = action.data as { cardId: string };
      const allCards = [player.leader, ...player.field, player.stage].filter(Boolean) as GameCard[];
      const card = allCards.find(c => c.id === cardId);
      if (card) card.isRested = !card.isRested;
      break;
    }

    case "attach_don": {
      const { cardId } = action.data as { cardId: string };
      if (player.donActive <= 0) break;
      const allCards = [player.leader, ...player.field].filter(Boolean) as GameCard[];
      const card = allCards.find(c => c.id === cardId);
      if (card) { card.attachedDon++; player.donActive--; }
      break;
    }

    case "detach_don": {
      const { cardId } = action.data as { cardId: string };
      const allCards = [player.leader, ...player.field].filter(Boolean) as GameCard[];
      const card = allCards.find(c => c.id === cardId);
      if (card && card.attachedDon > 0) { card.attachedDon--; player.donActive++; }
      break;
    }

    case "rest_don": {
      const { count } = action.data as { count: number };
      const toRest = Math.min(count, player.donActive);
      player.donActive -= toRest;
      player.donRested += toRest;
      break;
    }

    case "refresh_all": {
      // Untap all cards
      if (player.leader) player.leader.isRested = false;
      player.field.forEach(c => c.isRested = false);
      if (player.stage) player.stage.isRested = false;
      // Unrest all DON!!
      player.donActive += player.donRested;
      player.donRested = 0;
      break;
    }

    case "draw_card": {
      if (player.deck.length === 0) break;
      const card = player.deck.shift()!;
      card.zone = "hand";
      card.faceDown = false;
      player.hand.push(card);
      break;
    }

    case "add_don": {
      const count = (state.turnNumber === 1 && state.firstPlayer === userId) ? 1 : 2;
      const toAdd = Math.min(count, player.donDeck);
      player.donDeck -= toAdd;
      player.donActive += toAdd;
      break;
    }

    case "take_damage": {
      // Top life card goes to hand
      if (player.life.length === 0) break;
      const lifeCard = player.life.shift()!;
      lifeCard.zone = "hand";
      lifeCard.faceDown = false;
      player.hand.push(lifeCard);
      player.lifeCount = player.life.length;
      break;
    }

    case "next_phase": {
      const phases: GamePhase[] = ["refresh", "draw", "don", "main", "end"];
      const idx = phases.indexOf(state.phase as GamePhase);
      if (idx >= 0 && idx < phases.length - 1) {
        state.phase = phases[idx + 1];
      }
      break;
    }

    case "end_turn": {
      state.currentTurn = state.currentTurn === state.player1.userId ? state.player2.userId : state.player1.userId;
      state.turnNumber++;
      state.phase = "refresh";
      break;
    }

    case "concede": {
      await query(
        `UPDATE game_rooms SET status='finished', game_state=$2, ended_at=NOW(), last_action_at=NOW() WHERE code=$1`,
        [roomCode, JSON.stringify(state)]
      );
      return { state, conceded: userId };
    }

    case "chat": {
      // Chat is handled via game_log only
      break;
    }
  }

  // Update player state back
  if (isP1) state.player1 = player;
  else state.player2 = player;

  // Save action to log
  const log = room.game_log || [];
  log.push({ ...action, timestamp: new Date().toISOString() });

  // Save state
  await query(
    `UPDATE game_rooms SET game_state=$2, game_log=$3, turn_number=$4, phase=$5, last_action_at=NOW() WHERE code=$1`,
    [roomCode, JSON.stringify(state), JSON.stringify(log), state.turnNumber, state.phase]
  );

  return { state };
}
