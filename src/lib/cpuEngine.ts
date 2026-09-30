/**
 * Motor local vs CPU para ONCE Chess (sin Stockfish).
 *
 * Niveles:
 * - 0 Fácil: elige al azar entre legales, priorizando capturas y jaques.
 * - 1 Medio: minimax profundidad 1 (material + jaque).
 * - 2 Difícil: minimax profundidad 2.
 *
 * Todo es síncrono y determinista dado un PRNG inyectable (útil en tests).
 */

import { Chess, type Move, type Square } from "chess.js";

export type CpuLevel = 0 | 1 | 2;

export type CpuMoveChoice = {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
  san: string;
};

const PIECE_VALUE: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

export type Rng = () => number;

function defaultRng(): number {
  return Math.random();
}

function pickRandom<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

function materialScore(chess: Chess): number {
  let score = 0;
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      const v = PIECE_VALUE[cell.type] ?? 0;
      score += cell.color === "w" ? v : -v;
    }
  }
  return score;
}

/** Evaluación desde el punto de vista de `side` ("w" | "b"). */
function evaluateFor(chess: Chess, side: "w" | "b"): number {
  if (chess.isCheckmate()) {
    // Quien debe mover está mate → el otro gana.
    return chess.turn() === side ? -100_000 : 100_000;
  }
  if (chess.isDraw()) return 0;

  let score = materialScore(chess);
  if (chess.isCheck()) {
    // Penaliza estar en jaque cuando te toca mover.
    score += chess.turn() === "w" ? -35 : 35;
  }
  return side === "w" ? score : -score;
}

function depthForLevel(level: CpuLevel): number {
  if (level <= 0) return 0;
  if (level === 1) return 1;
  return 2;
}

function minimax(
  chess: Chess,
  depth: number,
  maximizing: boolean,
  side: "w" | "b",
  alpha: number,
  beta: number,
): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateFor(chess, side);
  }

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return evaluateFor(chess, side);
  }

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const value = minimax(chess, depth - 1, false, side, alpha, beta);
      chess.undo();
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    chess.move(move);
    const value = minimax(chess, depth - 1, true, side, alpha, beta);
    chess.undo();
    best = Math.min(best, value);
    beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return best;
}

function toChoice(move: Move): CpuMoveChoice {
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion as CpuMoveChoice["promotion"],
    san: move.san,
  };
}

/**
 * Elige un movimiento legal para el bando que tiene el turno en `fen`.
 * Si no hay legales, devuelve `null`.
 */
export function chooseCpuMove(
  fen: string,
  level: CpuLevel = 1,
  rng: Rng = defaultRng,
): CpuMoveChoice | null {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return null;

  const side = chess.turn();
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  const depth = depthForLevel(level);

  if (depth === 0) {
    const checks = moves.filter((m) => {
      chess.move(m);
      const inCheck = chess.isCheck();
      chess.undo();
      return inCheck;
    });
    const captures = moves.filter((m) => Boolean(m.captured));
    const pool =
      checks.length > 0 ? checks : captures.length > 0 ? captures : moves;
    return toChoice(pickRandom(pool, rng));
  }

  let bestScore = -Infinity;
  let bestMoves: Move[] = [];

  for (const move of moves) {
    chess.move(move);
    const score = minimax(
      chess,
      depth - 1,
      false,
      side,
      -Infinity,
      Infinity,
    );
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  return toChoice(pickRandom(bestMoves, rng));
}

/** Etiqueta hablada del nivel para anuncios accesibles. */
export function cpuLevelLabel(level: CpuLevel): string {
  switch (level) {
    case 0:
      return "fácil";
    case 1:
      return "medio";
    case 2:
      return "difícil";
    default:
      return "medio";
  }
}

/** Aplica el movimiento de la CPU sobre un `Chess` mutable; devuelve el SAN. */
export function applyCpuMove(
  chess: Chess,
  choice: CpuMoveChoice,
): Move | null {
  try {
    return chess.move({
      from: choice.from as Square,
      to: choice.to as Square,
      promotion: choice.promotion ?? "q",
    });
  } catch {
    return null;
  }
}
