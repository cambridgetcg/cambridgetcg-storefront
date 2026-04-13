"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type {
  GameCard,
  PlayerState,
  GameState,
  GamePhase,
  GameAction,
} from "@/lib/game/types";
import { PHASE_LABELS } from "@/lib/game/types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "ctcg-deck-builder-decks";
const AI_ACTION_DELAY_MS = 600;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SavedDeckCard {
  sku: string;
  card_number: string;
  name: string;
  set_code: string;
  set_name: string;
  rarity: string | null;
  image_url: string | null;
  spot_price: number;
  tradein_credit: number | null;
}

interface SavedDeck {
  name: string;
  leader: SavedDeckCard | null;
  entries: { sku: string; quantity: number; card: SavedDeckCard }[];
  savedAt: string;
}

interface OpponentInfo {
  name: string;
  icon: string;
  difficulty: "easy" | "medium" | "hard" | "extreme";
  level_number: number;
  title: string;
}

interface VictoryResult {
  victory: boolean;
  firstClear: boolean;
  pointsEarned: number;
  creditEarned: number;
  nextLevel: string | null;
}

interface DefeatResult {
  defeat: boolean;
  message: string;
}

interface AITurnResult {
  actions: GameAction[];
  thinking: string;
}

/* ------------------------------------------------------------------ */
/*  Difficulty styling                                                 */
/* ------------------------------------------------------------------ */

const DIFFICULTY_BADGE: Record<string, { bg: string; text: string }> = {
  easy:    { bg: "bg-green-900/40",  text: "text-green-400" },
  medium:  { bg: "bg-amber-900/40",  text: "text-amber-400" },
  hard:    { bg: "bg-red-900/40",    text: "text-red-400" },
  extreme: { bg: "bg-purple-900/40", text: "text-purple-400" },
};

/* ================================================================== */
/*  PVE Game Board                                                     */
/* ================================================================== */

export default function PVEGameBoard() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const levelId = params.levelId as string;
  const initialGameId = searchParams.get("gameId");

  /* ---- Core game state ---- */
  const [gameId, setGameId] = useState<string | null>(initialGameId);
  const [state, setState] = useState<GameState | null>(null);
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null);
  const [gameLog, setGameLog] = useState<{ text: string; isAI: boolean; time: string }[]>([]);

  /* ---- UI state ---- */
  const [selectedCard, setSelectedCard] = useState<GameCard | null>(null);
  const [hoverCard, setHoverCard] = useState<GameCard | null>(null);
  const [donRestCount, setDonRestCount] = useState(1);
  const [showLog, setShowLog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  /* ---- AI turn state ---- */
  const [aiThinking, setAiThinking] = useState(false);
  const [aiThinkingText, setAiThinkingText] = useState("");
  const replayingRef = useRef(false);

  /* ---- End-game state ---- */
  const [victoryResult, setVictoryResult] = useState<VictoryResult | null>(null);
  const [defeatResult, setDefeatResult] = useState<DefeatResult | null>(null);

  /* ---- Setup state (if no gameId in URL) ---- */
  const [needsSetup, setNeedsSetup] = useState(!initialGameId);
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckIdx, setSelectedDeckIdx] = useState<number | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  /* ---- Error state ---- */
  const [error, setError] = useState<string | null>(null);

  /* ---- Derived ---- */
  const myState: PlayerState | null = state?.player1 ?? null;
  const oppState: PlayerState | null = state?.player2 ?? null;
  const isMyTurn = state ? state.currentTurn === state.player1?.userId : false;
  const gameActive = state?.phase !== "finished" && state?.phase !== "setup" && !victoryResult && !defeatResult;

  /* ================================================================ */
  /*  Load saved decks                                                */
  /* ================================================================ */

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSavedDecks(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  /* ================================================================ */
  /*  Start Game (if arrived without gameId)                          */
  /* ================================================================ */

  async function handleStart() {
    if (selectedDeckIdx === null) return;
    const deck = savedDecks[selectedDeckIdx];
    if (!deck) return;

    setSetupError(null);
    setSetupLoading(true);

    const cards: { sku: string; name: string; cardNumber: string; imageUrl: string | null; rarity: string | null; isLeader?: boolean }[] = [];

    if (deck.leader) {
      cards.push({
        sku: deck.leader.sku,
        name: deck.leader.name,
        cardNumber: deck.leader.card_number,
        imageUrl: deck.leader.image_url,
        rarity: deck.leader.rarity,
        isLeader: true,
      });
    }

    for (const entry of deck.entries) {
      for (let i = 0; i < entry.quantity; i++) {
        cards.push({
          sku: entry.card.sku,
          name: entry.card.name,
          cardNumber: entry.card.card_number,
          imageUrl: entry.card.image_url,
          rarity: entry.card.rarity,
        });
      }
    }

    if (cards.length < 10) {
      setSetupError("Deck must have at least 10 cards.");
      setSetupLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/game/pve/${levelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", deck: cards }),
      });
      const result = await res.json();
      if (!res.ok) {
        setSetupError(result.error || "Failed to start.");
        setSetupLoading(false);
        return;
      }
      setGameId(result.gameId);
      setState(result.state);
      setOpponent(result.opponent);
      setNeedsSetup(false);
      addLog("Game started!", false);
    } catch {
      setSetupError("Network error.");
    } finally {
      setSetupLoading(false);
    }
  }

  /* ================================================================ */
  /*  Fetch initial state if gameId provided via URL                   */
  /* ================================================================ */

  const initialFetched = useRef(false);

  useEffect(() => {
    if (!gameId || initialFetched.current || state) return;
    initialFetched.current = true;

    async function fetchInitial() {
      try {
        // The start action already returned state; if we refresh the page,
        // re-start is needed. For now, we signal setup is needed.
        setNeedsSetup(true);
      } catch {
        setError("Failed to load game state.");
      }
    }
    fetchInitial();
  }, [gameId, state]);

  /* ================================================================ */
  /*  Game Log                                                        */
  /* ================================================================ */

  function addLog(text: string, isAI: boolean) {
    setGameLog(prev => [...prev, {
      text,
      isAI,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
  }

  /* ================================================================ */
  /*  Send Action (player actions)                                    */
  /* ================================================================ */

  const sendAction = useCallback(async (type: string, data: Record<string, unknown> = {}) => {
    if (actionLoading || !state || !myState) return;
    setActionLoading(true);
    setError(null);

    try {
      // Apply action locally on the state (client-side for responsiveness)
      const newState = applyLocalAction(state, "player1", type, data);
      setState(newState);
      addLog(formatActionText(type, data), false);

      // Also send to server for persistence
      if (gameId) {
        await fetch(`/api/game/pve/${levelId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "game_action", gameId, type, data }),
        }).catch(() => { /* fire and forget, local state is truth during PVE */ });
      }
    } catch {
      setError("Action failed.");
    } finally {
      setActionLoading(false);
      setSelectedCard(null);
    }
  }, [actionLoading, state, myState, gameId, levelId]);

  /* ================================================================ */
  /*  End Turn → Trigger AI                                           */
  /* ================================================================ */

  async function handleEndTurn() {
    if (!state || !gameId) return;

    // End player turn
    const newState = applyLocalAction(state, "player1", "end_turn", {});
    setState(newState);
    addLog("You ended your turn.", false);

    // Trigger AI turn
    setAiThinking(true);
    setAiThinkingText(`${opponent?.name ?? "AI"} is thinking`);

    try {
      const res = await fetch(`/api/game/pve/${levelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_turn", gameId }),
      });
      const result: AITurnResult = await res.json();

      if (result.thinking) {
        addLog(result.thinking, true);
      }

      // Replay AI actions one at a time with delay
      if (result.actions && result.actions.length > 0) {
        replayingRef.current = true;
        let currentState = newState;

        for (let i = 0; i < result.actions.length; i++) {
          const action = result.actions[i];
          await new Promise(resolve => setTimeout(resolve, AI_ACTION_DELAY_MS));
          currentState = applyLocalAction(currentState, "player2", action.type, action.data);
          setState({ ...currentState });
          addLog(`${opponent?.name ?? "AI"}: ${formatActionText(action.type, action.data)}`, true);
        }

        replayingRef.current = false;
      }
    } catch {
      addLog("AI turn failed. Your turn again.", true);
    } finally {
      setAiThinking(false);
      setAiThinkingText("");
    }
  }

  /* ================================================================ */
  /*  Claim Victory                                                   */
  /* ================================================================ */

  async function handleClaimVictory() {
    if (!gameId || !state) return;
    setActionLoading(true);

    try {
      const res = await fetch(`/api/game/pve/${levelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "victory",
          gameId,
          turnsPlayed: state.turnNumber,
          lifeRemaining: myState?.lifeCount ?? 0,
        }),
      });
      const result: VictoryResult = await res.json();
      setVictoryResult(result);
    } catch {
      setError("Failed to claim victory.");
    } finally {
      setActionLoading(false);
    }
  }

  /* ================================================================ */
  /*  Concede / Defeat                                                */
  /* ================================================================ */

  async function handleConcede() {
    if (!gameId) return;
    setActionLoading(true);

    try {
      const res = await fetch(`/api/game/pve/${levelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "defeat", gameId }),
      });
      const result: DefeatResult = await res.json();
      setDefeatResult(result);
    } catch {
      setError("Failed to concede.");
    } finally {
      setActionLoading(false);
    }
  }

  /* ================================================================ */
  /*  Local State Engine (mirrors server logic for responsiveness)     */
  /* ================================================================ */

  function applyLocalAction(
    currentState: GameState,
    playerKey: "player1" | "player2",
    type: string,
    data: Record<string, unknown>
  ): GameState {
    const s = JSON.parse(JSON.stringify(currentState)) as GameState;
    const player = s[playerKey];
    const opponentPlayer = playerKey === "player1" ? s.player2 : s.player1;

    switch (type) {
      case "move_card": {
        const { cardId, toZone, faceDown } = data as { cardId: string; toZone: string; faceDown?: boolean };
        const allCards = [...player.hand, ...player.field, player.leader, player.stage, ...player.life, ...player.trash, ...player.deck].filter(Boolean) as GameCard[];
        const card = allCards.find(c => c.id === cardId);
        if (!card) break;

        const removeFrom = (zone: GameCard[]) => zone.filter(c => c.id !== cardId);
        player.hand = removeFrom(player.hand);
        player.field = removeFrom(player.field);
        player.life = removeFrom(player.life);
        player.trash = removeFrom(player.trash);
        player.deck = removeFrom(player.deck);
        if (player.leader?.id === cardId) player.leader = null;
        if (player.stage?.id === cardId) player.stage = null;

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
        const { cardId } = data as { cardId: string };
        const cards = [player.leader, ...player.field, player.stage].filter(Boolean) as GameCard[];
        const card = cards.find(c => c.id === cardId);
        if (card) card.isRested = !card.isRested;
        break;
      }
      case "attach_don": {
        const { cardId } = data as { cardId: string };
        if (player.donActive <= 0) break;
        const cards = [player.leader, ...player.field].filter(Boolean) as GameCard[];
        const card = cards.find(c => c.id === cardId);
        if (card) { card.attachedDon++; player.donActive--; }
        break;
      }
      case "detach_don": {
        const { cardId } = data as { cardId: string };
        const cards = [player.leader, ...player.field].filter(Boolean) as GameCard[];
        const card = cards.find(c => c.id === cardId);
        if (card && card.attachedDon > 0) { card.attachedDon--; player.donActive++; }
        break;
      }
      case "rest_don": {
        const { count } = data as { count: number };
        const toRest = Math.min(count, player.donActive);
        player.donActive -= toRest;
        player.donRested += toRest;
        break;
      }
      case "refresh_all": {
        if (player.leader) player.leader.isRested = false;
        player.field.forEach(c => c.isRested = false);
        if (player.stage) player.stage.isRested = false;
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
        const count = (s.turnNumber === 1 && s.firstPlayer === player.userId) ? 1 : 2;
        const toAdd = Math.min(count, player.donDeck);
        player.donDeck -= toAdd;
        player.donActive += toAdd;
        break;
      }
      case "take_damage": {
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
        const idx = phases.indexOf(s.phase as GamePhase);
        if (idx >= 0 && idx < phases.length - 1) {
          s.phase = phases[idx + 1];
        }
        break;
      }
      case "end_turn": {
        s.currentTurn = s.currentTurn === s.player1.userId ? s.player2.userId : s.player1.userId;
        s.turnNumber++;
        s.phase = "refresh";
        break;
      }
    }

    s[playerKey] = player;
    return s;
  }

  /* ================================================================ */
  /*  Format action text                                              */
  /* ================================================================ */

  function formatActionText(type: string, data: Record<string, unknown>): string {
    switch (type) {
      case "move_card": return `moved a card to ${data.toZone}`;
      case "toggle_rest": return "toggled rest on a card";
      case "attach_don": return "attached DON!! to a card";
      case "detach_don": return "detached DON!! from a card";
      case "rest_don": return `rested ${data.count} DON!!`;
      case "refresh_all": return "refreshed all cards";
      case "draw_card": return "drew a card";
      case "add_don": return "added DON!! from deck";
      case "take_damage": return "took damage (life to hand)";
      case "next_phase": return "advanced to next phase";
      case "end_turn": return "ended turn";
      default: return type;
    }
  }

  /* ================================================================ */
  /*  Renderers                                                       */
  /* ================================================================ */

  /* ---- Single card ---- */
  function CardSlot({
    card,
    faceUp = true,
    small = false,
    onClick,
    className = "",
  }: {
    card: GameCard | null;
    faceUp?: boolean;
    small?: boolean;
    onClick?: () => void;
    className?: string;
  }) {
    if (!card) {
      return (
        <div
          className={`${
            small ? "w-12 h-[66px]" : "w-16 h-[88px]"
          } rounded-lg border border-neutral-800 bg-neutral-900/50 flex-shrink-0 ${className}`}
        />
      );
    }

    const isRested = card.isRested;
    const isSelected = selectedCard?.id === card.id;
    const showFace = faceUp && !card.faceDown && card.imageUrl;

    return (
      <div className="relative flex-shrink-0">
        <button
          onClick={onClick}
          onMouseEnter={() => faceUp && !card.faceDown ? setHoverCard(card) : null}
          onMouseLeave={() => setHoverCard(null)}
          className={`${
            small ? "w-12 h-[66px]" : "w-16 h-[88px]"
          } rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
            isSelected
              ? "border-amber-400 ring-2 ring-amber-400/40 scale-105"
              : "border-neutral-700 hover:border-neutral-500"
          } ${isRested ? "rotate-90 origin-center" : ""} ${className}`}
          style={isRested ? { margin: "0 12px" } : undefined}
        >
          {showFace ? (
            <Image
              src={card.imageUrl!}
              alt={card.name}
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-700 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-neutral-600 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-neutral-600" />
              </div>
            </div>
          )}
        </button>
        {card.attachedDon > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-black text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow z-10">
            +{card.attachedDon}
          </span>
        )}
      </div>
    );
  }

  /* ---- Deck stack ---- */
  function DeckStack({ count, label, onClick }: { count: number; label: string; onClick?: () => void }) {
    return (
      <button
        onClick={onClick}
        className="relative w-16 h-[88px] rounded-lg bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-700 border-2 border-neutral-600 hover:border-neutral-500 flex-shrink-0 transition-colors"
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-neutral-400 text-[10px] font-medium">{label}</span>
          <span className="text-white font-bold text-lg">{count}</span>
        </div>
      </button>
    );
  }

  /* ---- Life dots ---- */
  function LifeDots({ count, max = 5 }: { count: number; max?: number }) {
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full transition-colors ${
              i < count ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" : "bg-neutral-700"
            }`}
          />
        ))}
      </div>
    );
  }

  /* ---- DON!! display ---- */
  function DonDisplay({
    active,
    rested,
    total,
    isOwn,
  }: {
    active: number;
    rested: number;
    total: number;
    isOwn: boolean;
  }) {
    const used = active + rested;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-amber-400 font-bold text-xs">DON!!</span>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: used }).map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-5 rounded-sm text-[8px] font-bold flex items-center justify-center ${
                i < active
                  ? "bg-amber-500 text-black"
                  : "bg-neutral-700 text-neutral-500"
              }`}
            >
              {i < active ? "D" : "R"}
            </div>
          ))}
        </div>
        <span className="text-neutral-500 text-xs">
          {active}/{used}{total > 0 ? ` (+${total} deck)` : ""}
        </span>
        {isOwn && gameActive && isMyTurn && !aiThinking && (
          <div className="flex items-center gap-1 ml-2">
            <input
              type="number"
              min={1}
              max={active}
              value={donRestCount}
              onChange={(e) => setDonRestCount(Math.max(1, Math.min(active, parseInt(e.target.value) || 1)))}
              className="w-10 bg-neutral-800 border border-neutral-700 rounded text-center text-xs py-0.5"
            />
            <button
              onClick={() => sendAction("rest_don", { count: donRestCount })}
              className="text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 px-2 py-0.5 rounded transition-colors"
            >
              Rest
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ---- Card action menu ---- */
  function CardActionMenu() {
    if (!selectedCard || !gameActive) return null;
    const card = selectedCard;
    const zone = card.zone;

    const actions: { label: string; action: () => void; variant?: "danger" }[] = [];

    if (zone === "hand") {
      actions.push({ label: "Play to Field", action: () => sendAction("move_card", { cardId: card.id, toZone: "field", faceDown: false }) });
      actions.push({ label: "Play as Stage", action: () => sendAction("move_card", { cardId: card.id, toZone: "stage", faceDown: false }) });
    }
    if (zone === "field") {
      actions.push({ label: card.isRested ? "Set Active" : "Rest", action: () => sendAction("toggle_rest", { cardId: card.id }) });
      actions.push({ label: "Attach DON!!", action: () => sendAction("attach_don", { cardId: card.id }) });
      if (card.attachedDon > 0) {
        actions.push({ label: "Detach DON!!", action: () => sendAction("detach_don", { cardId: card.id }) });
      }
      actions.push({ label: "Send to Trash", action: () => sendAction("move_card", { cardId: card.id, toZone: "trash", faceDown: false }), variant: "danger" });
    }
    if (zone === "leader") {
      actions.push({ label: card.isRested ? "Set Active" : "Rest", action: () => sendAction("toggle_rest", { cardId: card.id }) });
      actions.push({ label: "Attach DON!!", action: () => sendAction("attach_don", { cardId: card.id }) });
      if (card.attachedDon > 0) {
        actions.push({ label: "Detach DON!!", action: () => sendAction("detach_don", { cardId: card.id }) });
      }
    }
    if (zone === "life") {
      actions.push({ label: "Reveal to Hand", action: () => sendAction("take_damage") });
    }
    if (zone === "stage") {
      actions.push({ label: card.isRested ? "Set Active" : "Rest", action: () => sendAction("toggle_rest", { cardId: card.id }) });
      actions.push({ label: "Send to Trash", action: () => sendAction("move_card", { cardId: card.id, toZone: "trash", faceDown: false }), variant: "danger" });
    }

    if (actions.length === 0) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedCard(null)}>
        <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 min-w-[220px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-3 pb-3 border-b border-neutral-800">
            {!card.faceDown && card.imageUrl ? (
              <div className="w-10 h-14 rounded overflow-hidden relative flex-shrink-0">
                <Image src={card.imageUrl} alt={card.name} fill sizes="40px" className="object-cover" />
              </div>
            ) : (
              <div className="w-10 h-14 rounded bg-neutral-800 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{card.faceDown ? "Face-down card" : card.name}</p>
              <p className="text-neutral-500 text-xs">{card.zone} {card.isRested ? "(rested)" : ""}</p>
              {card.attachedDon > 0 && <p className="text-amber-400 text-xs">+{card.attachedDon} DON!!</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            {actions.map((a, i) => (
              <button
                key={i}
                onClick={() => { a.action(); setSelectedCard(null); }}
                disabled={actionLoading || !isMyTurn || aiThinking}
                className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-40 ${
                  a.variant === "danger"
                    ? "hover:bg-red-900/40 text-red-400"
                    : "hover:bg-neutral-800 text-white"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelectedCard(null)}
            className="w-full mt-3 pt-3 border-t border-neutral-800 text-neutral-500 text-xs hover:text-neutral-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  /* ---- Hover preview ---- */
  function HoverPreview() {
    if (!hoverCard || hoverCard.faceDown || !hoverCard.imageUrl) return null;
    return (
      <div className="fixed top-4 right-4 z-40 pointer-events-none">
        <div className="w-48 h-[264px] rounded-xl overflow-hidden border-2 border-neutral-600 shadow-2xl relative">
          <Image src={hoverCard.imageUrl} alt={hoverCard.name} fill sizes="192px" className="object-cover" />
        </div>
        <p className="text-white text-sm font-semibold mt-2 text-center max-w-[192px] truncate">{hoverCard.name}</p>
        {hoverCard.cardNumber && (
          <p className="text-neutral-400 text-xs text-center">{hoverCard.cardNumber}</p>
        )}
      </div>
    );
  }

  /* ---- Player area ---- */
  function PlayerArea({
    player,
    isOwn,
    label,
    isAI = false,
  }: {
    player: PlayerState;
    isOwn: boolean;
    label: string;
    isAI?: boolean;
  }) {
    const fieldCards = player.field || [];
    const handCards = player.hand || [];

    return (
      <div className={`rounded-xl p-3 sm:p-4 ${
        isAI
          ? "bg-red-950/20 border border-red-900/20"
          : isOwn
            ? "bg-neutral-900/80"
            : "bg-neutral-900/40"
      }`}>
        {/* Label row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isAI && opponent && (
              <span className="text-lg">{opponent.icon}</span>
            )}
            <span className={`font-bold text-sm ${isOwn ? "text-amber-400" : isAI ? "text-red-400" : "text-neutral-300"}`}>
              {label}
            </span>
            {isAI && opponent && (
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                DIFFICULTY_BADGE[opponent.difficulty]?.bg ?? ""
              } ${DIFFICULTY_BADGE[opponent.difficulty]?.text ?? ""}`}>
                {opponent.difficulty}
              </span>
            )}
            {isOwn && isMyTurn && !aiThinking && (
              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                Your Turn
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <LifeDots count={player.lifeCount} />
            <span className="text-neutral-500 text-xs">
              Deck: {player.deck?.length ?? 0}
            </span>
          </div>
        </div>

        {/* DON!! display */}
        <div className="mb-3">
          <DonDisplay
            active={player.donActive}
            rested={player.donRested}
            total={player.donDeck}
            isOwn={isOwn}
          />
        </div>

        {/* Board: Deck | Leader | Field (x5) | Stage */}
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2">
          <DeckStack
            count={player.deck?.length ?? 0}
            label="Deck"
            onClick={isOwn && isMyTurn && !aiThinking ? () => sendAction("draw_card") : undefined}
          />

          <div className="flex-shrink-0">
            <div className="text-[10px] text-neutral-500 text-center mb-0.5">Leader</div>
            <CardSlot
              card={player.leader}
              faceUp={true}
              onClick={isOwn && player.leader ? () => setSelectedCard(player.leader!) : undefined}
            />
          </div>

          <div className="w-px h-16 bg-neutral-700 flex-shrink-0 mx-1" />

          <div className="flex items-end gap-1.5 sm:gap-2">
            {Array.from({ length: 5 }).map((_, i) => {
              const card = fieldCards[i] ?? null;
              return (
                <div key={i} className="flex-shrink-0">
                  {i === 0 && <div className="text-[10px] text-neutral-500 text-center mb-0.5">Field</div>}
                  {i !== 0 && <div className="h-[14px]" />}
                  <CardSlot
                    card={card}
                    faceUp={true}
                    onClick={isOwn && card ? () => setSelectedCard(card) : undefined}
                  />
                </div>
              );
            })}
          </div>

          <div className="w-px h-16 bg-neutral-700 flex-shrink-0 mx-1" />

          <div className="flex-shrink-0">
            <div className="text-[10px] text-neutral-500 text-center mb-0.5">Stage</div>
            <CardSlot
              card={player.stage}
              faceUp={true}
              onClick={isOwn && player.stage ? () => setSelectedCard(player.stage!) : undefined}
            />
          </div>
        </div>

        {/* Hand */}
        <div className="mt-3 pt-3 border-t border-neutral-800">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-neutral-500 font-medium">
              Hand ({handCards.length})
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {handCards.length === 0 ? (
              <span className="text-neutral-600 text-xs italic">Empty</span>
            ) : (
              handCards.map((card) => (
                <CardSlot
                  key={card.id}
                  card={card}
                  faceUp={isOwn}
                  small={!isOwn}
                  onClick={isOwn ? () => setSelectedCard(card) : undefined}
                />
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---- AI thinking indicator ---- */
  function AIThinkingBanner() {
    if (!aiThinking) return null;
    return (
      <div className="bg-red-950/30 border border-red-900/30 rounded-lg px-4 py-2.5 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-red-400 text-sm font-medium">
          {aiThinkingText || "AI is thinking"}...
        </span>
      </div>
    );
  }

  /* ---- Game log panel ---- */
  function GameLogPanel() {
    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [gameLog.length]);

    return (
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-neutral-950 border-l border-neutral-800 z-30 transform transition-transform ${
          showLog ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h3 className="font-bold text-sm">Game Log</h3>
          <button onClick={() => setShowLog(false)} className="text-neutral-500 hover:text-white text-lg">
            &times;
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-56px)] p-3 space-y-1.5">
          {gameLog.length === 0 ? (
            <p className="text-neutral-600 text-xs italic">No actions yet.</p>
          ) : (
            gameLog.map((entry, i) => (
              <div key={i} className={`text-xs py-1 border-b border-neutral-900 ${entry.isAI ? "text-red-400/80" : "text-neutral-400"}`}>
                <span className="text-neutral-600 mr-1">{entry.time}</span>
                {entry.text}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Screens                                                         */
  /* ================================================================ */

  /* ---- Setup / Deck selection screen ---- */
  if (needsSetup) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 sm:p-8 max-w-xl w-full space-y-5">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-1">Adventure Mode</h2>
            <p className="text-neutral-400 text-sm">
              Select a deck to begin your battle.
            </p>
          </div>

          {setupError && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">
              {setupError}
            </div>
          )}

          {savedDecks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-neutral-500 mb-4">No saved decks found.</p>
              <Link
                href="/deck-builder"
                className="inline-block bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-3 transition-colors"
              >
                Open Deck Builder
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {savedDecks.map((deck, i) => {
                  const totalCards = deck.entries.reduce((s, e) => s + e.quantity, 0);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDeckIdx(i)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        selectedDeckIdx === i
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-neutral-800 bg-neutral-800/50 hover:border-neutral-600"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold">{deck.name}</span>
                          {deck.leader && (
                            <span className="text-amber-400 text-xs ml-2">
                              Leader: {deck.leader.name}
                            </span>
                          )}
                        </div>
                        <span className="text-neutral-500 text-sm">{totalCards} cards</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleStart}
                disabled={selectedDeckIdx === null || setupLoading}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-lg py-3 transition-colors text-lg"
              >
                {setupLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                    Starting...
                  </span>
                ) : (
                  "Start Battle"
                )}
              </button>
            </>
          )}

          <div className="text-center">
            <Link href="/play/adventure" className="text-neutral-500 hover:text-neutral-300 text-sm transition-colors">
              &larr; Back to Adventure
            </Link>
          </div>
        </div>
      </main>
    );
  }

  /* ---- Loading (no state yet) ---- */
  if (!state || !myState || !oppState) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-400">Loading game...</p>
        </div>
      </main>
    );
  }

  /* ---- Victory screen ---- */
  if (victoryResult) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="relative">
          {/* Confetti-style decorative elements */}
          <div className="absolute -top-10 -left-10 w-20 h-20 bg-amber-500/10 rounded-full blur-xl animate-pulse" />
          <div className="absolute -top-6 -right-8 w-16 h-16 bg-green-500/10 rounded-full blur-xl animate-pulse" style={{ animationDelay: "500ms" }} />
          <div className="absolute -bottom-8 left-1/2 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl animate-pulse" style={{ animationDelay: "1000ms" }} />

          <div className="bg-neutral-900 border border-amber-700/40 rounded-2xl p-8 max-w-md text-center space-y-6 shadow-2xl shadow-amber-500/10 relative">
            {/* Victory header */}
            <div>
              <div className="text-5xl mb-3">&#127881;</div>
              <h2 className="text-3xl font-extrabold text-amber-400">VICTORY!</h2>
              <p className="text-neutral-300 mt-2">
                You defeated {opponent?.icon} {opponent?.name}!
              </p>
            </div>

            {/* Rewards */}
            <div className="bg-neutral-800/60 rounded-xl p-4 space-y-3">
              {victoryResult.firstClear && (
                <div className="text-xs text-amber-400 font-bold uppercase tracking-wider mb-2">
                  First Clear Bonus
                </div>
              )}
              <div className="flex items-center justify-center gap-2 text-lg">
                <span>&#11088;</span>
                <span className="text-amber-400 font-bold">+{victoryResult.pointsEarned} points</span>
              </div>
              {victoryResult.creditEarned > 0 && (
                <div className="flex items-center justify-center gap-2 text-lg">
                  <span>&#128176;</span>
                  <span className="text-green-400 font-bold">+&pound;{(victoryResult.creditEarned / 100).toFixed(2)} store credit</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              {victoryResult.nextLevel && (
                <button
                  onClick={() => router.push(`/play/adventure/${victoryResult.nextLevel}`)}
                  className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-3 transition-colors"
                >
                  Next Level &rarr;
                </button>
              )}
              <button
                onClick={() => {
                  setVictoryResult(null);
                  setNeedsSetup(true);
                  setGameId(null);
                  setState(null);
                  setGameLog([]);
                }}
                className="w-full sm:w-auto bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white font-semibold rounded-lg px-6 py-3 transition-colors"
              >
                Play Again
              </button>
              <Link
                href="/play/adventure"
                className="w-full sm:w-auto text-center bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 font-semibold rounded-lg px-6 py-3 transition-colors"
              >
                Back to Adventure
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ---- Defeat screen ---- */
  if (defeatResult) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="bg-neutral-900 border border-red-900/40 rounded-2xl p-8 max-w-md text-center space-y-6 shadow-2xl shadow-red-500/10">
          <div>
            <div className="text-5xl mb-3">&#128128;</div>
            <h2 className="text-3xl font-extrabold text-red-400">DEFEATED</h2>
            <p className="text-neutral-300 mt-2">
              {opponent?.icon} {opponent?.name} wins this round.
            </p>
          </div>

          <div className="bg-neutral-800/60 rounded-xl p-4">
            <p className="text-neutral-400 text-sm">
              {defeatResult.message || "Your deck is still ready. Try a different strategy!"}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => {
                setDefeatResult(null);
                setNeedsSetup(true);
                setGameId(null);
                setState(null);
                setGameLog([]);
              }}
              className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-3 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                setDefeatResult(null);
                setNeedsSetup(true);
                setGameId(null);
                setState(null);
                setGameLog([]);
                setSelectedDeckIdx(null);
              }}
              className="w-full sm:w-auto bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white font-semibold rounded-lg px-6 py-3 transition-colors"
            >
              Change Deck
            </button>
            <Link
              href="/play/adventure"
              className="w-full sm:w-auto text-center bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 font-semibold rounded-lg px-6 py-3 transition-colors"
            >
              Back to Adventure
            </Link>
          </div>
        </div>
      </main>
    );
  }

  /* ================================================================ */
  /*  Main Game Board                                                 */
  /* ================================================================ */

  const canClaimVictory = oppState.lifeCount <= 0;

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col">
      <HoverPreview />
      <CardActionMenu />
      <GameLogPanel />

      {/* ---- Level info bar ---- */}
      <div className="bg-neutral-900/60 border-b border-neutral-800 px-3 py-1.5 text-center">
        <span className="text-sm">
          <span className="text-neutral-500">Level {opponent?.level_number ?? "?"}:</span>{" "}
          <span className="text-white font-medium">{opponent?.title ?? "Unknown"}</span>
          <span className="text-neutral-500 mx-2">&#8212;</span>
          <span className="text-neutral-400">vs</span>{" "}
          <span>{opponent?.icon ?? ""}</span>{" "}
          <span className="text-red-400 font-medium">{opponent?.name ?? "AI"}</span>
          {opponent?.difficulty && (
            <span className={`ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
              DIFFICULTY_BADGE[opponent.difficulty]?.bg ?? ""
            } ${DIFFICULTY_BADGE[opponent.difficulty]?.text ?? ""}`}>
              {opponent.difficulty}
            </span>
          )}
        </span>
      </div>

      {/* ---- Top bar ---- */}
      <header className="bg-neutral-900/80 border-b border-neutral-800 px-3 sm:px-4 py-2 flex items-center justify-between text-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/play/adventure" className="text-neutral-500 hover:text-neutral-300 transition-colors">
            &larr;
          </Link>
          <span className="text-neutral-400 font-medium">Adventure Mode</span>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-red-400 text-xs">{error}</span>}
          <button
            onClick={() => setShowLog(!showLog)}
            className="text-neutral-500 hover:text-white text-xs bg-neutral-800 px-3 py-1.5 rounded transition-colors"
          >
            Log
          </button>
          {gameActive && (
            <button
              onClick={() => { if (confirm("Concede this battle?")) handleConcede(); }}
              className="text-red-500 hover:text-red-400 text-xs bg-neutral-800 px-3 py-1.5 rounded transition-colors"
            >
              Concede
            </button>
          )}
        </div>
      </header>

      {/* ---- Board ---- */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden p-2 sm:p-3 gap-2 sm:gap-3">
        {/* Opponent area (AI) */}
        <PlayerArea
          player={oppState}
          isOwn={false}
          label={opponent?.name ?? "AI Opponent"}
          isAI={true}
        />

        {/* ---- AI thinking / Phase divider ---- */}
        {aiThinking ? (
          <AIThinkingBanner />
        ) : (
          <div className="bg-neutral-800/60 rounded-lg px-4 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="text-amber-400 font-bold text-sm">
                {PHASE_LABELS[state.phase as GamePhase] || state.phase}
              </span>
              <span className="text-neutral-500 text-xs">
                Turn {state.turnNumber}
              </span>
              {!isMyTurn && (
                <span className="text-red-400/70 text-xs italic">
                  {opponent?.name ?? "AI"}&apos;s turn
                </span>
              )}
            </div>
            {isMyTurn && gameActive && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => sendAction("add_don")}
                  className="text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  +DON!!
                </button>
                <button
                  onClick={() => sendAction("refresh_all")}
                  className="text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Refresh All
                </button>
                <button
                  onClick={() => sendAction("next_phase")}
                  className="text-xs bg-neutral-700 hover:bg-neutral-600 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Next Phase &#9193;
                </button>
                {canClaimVictory && (
                  <button
                    onClick={handleClaimVictory}
                    disabled={actionLoading}
                    className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg transition-colors font-bold animate-pulse"
                  >
                    &#127942; Claim Victory
                  </button>
                )}
                <button
                  onClick={handleEndTurn}
                  disabled={actionLoading}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  End Turn &#127937;
                </button>
              </div>
            )}
          </div>
        )}

        {/* Your area */}
        <PlayerArea
          player={myState}
          isOwn={true}
          label={myState.name || "You"}
        />
      </div>

      {/* ---- Quick actions (mobile) ---- */}
      {isMyTurn && gameActive && !aiThinking && (
        <div className="sm:hidden bg-neutral-900 border-t border-neutral-800 px-3 py-2 flex items-center gap-2 overflow-x-auto flex-shrink-0">
          <button
            onClick={() => sendAction("draw_card")}
            className="text-xs bg-neutral-800 text-white px-3 py-2 rounded-lg whitespace-nowrap"
          >
            Draw
          </button>
          <button
            onClick={() => sendAction("add_don")}
            className="text-xs bg-amber-500/20 text-amber-400 px-3 py-2 rounded-lg whitespace-nowrap"
          >
            +DON!!
          </button>
          <button
            onClick={() => sendAction("refresh_all")}
            className="text-xs bg-neutral-800 text-neutral-300 px-3 py-2 rounded-lg whitespace-nowrap"
          >
            Refresh
          </button>
          <button
            onClick={() => sendAction("next_phase")}
            className="text-xs bg-neutral-800 text-white px-3 py-2 rounded-lg whitespace-nowrap"
          >
            Next Phase
          </button>
          {canClaimVictory && (
            <button
              onClick={handleClaimVictory}
              disabled={actionLoading}
              className="text-xs bg-green-600 text-white px-3 py-2 rounded-lg whitespace-nowrap font-bold"
            >
              Victory
            </button>
          )}
          <button
            onClick={handleEndTurn}
            disabled={actionLoading}
            className="text-xs bg-white/10 text-white px-3 py-2 rounded-lg whitespace-nowrap"
          >
            End Turn
          </button>
          <button
            onClick={() => { if (confirm("Concede?")) handleConcede(); }}
            className="text-xs bg-red-900/40 text-red-400 px-3 py-2 rounded-lg whitespace-nowrap"
          >
            Concede
          </button>
        </div>
      )}
    </main>
  );
}
