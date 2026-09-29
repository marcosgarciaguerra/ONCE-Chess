/**
 * Pruebas de propiedad de posiciones recientes (Task 3.6).
 *
 * Cubren tres propiedades de corrección de la capa RecentPosition de
 * `lib/storage.ts` (bajo prueba, NO se modifica):
 *
 * - **Property 2: Capacidad de recientes** (`length <= 10`)
 *   **Validates: Requisito 6.4**
 * - **Property 3: Sin duplicados** (no hay dos entradas con el mismo `fen`)
 *   **Validates: Requisito 6.3**
 * - **Property 4: Orden de recencia** (tras `pushRecentFen(fen, label)` con un
 *   FEN válido, la entrada en el índice 0 tiene ese `fen`)
 *   **Validates: Requisito 6.1**
 *
 * Entorno: jsdom (Vitest, globals activados), por lo que `window.localStorage`
 * existe y se limpia entre iteraciones para evitar arrastre de estado.
 *
 * FEN válidos: se generan posiciones legales reales jugando movimientos legales
 * aleatorios con `chess.js` y llamando a `.fen()`, más el FEN inicial. Los FEN
 * inválidos deben dejar la lista sin cambios (Requisito 6.2), lo que se combina
 * con las propiedades de capacidad y no-duplicación.
 */

import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { Chess } from "chess.js";

import {
  loadRecentFens,
  pushRecentFen,
  type RecentPosition,
} from "./storage";

/** Capacidad máxima de la lista LRU (design.md, Modelo 2 / Requisito 6.4). */
const RECENT_FENS_MAX = 10;

/**
 * Genera un conjunto de FEN válidos reales jugando `depth` movimientos legales
 * aleatorios desde la posición inicial. Se recogen las posiciones intermedias
 * para tener variedad (todas alcanzables por movimientos legales, por lo que
 * `new Chess(fen)` no lanza y `isValidFen` las acepta).
 *
 * Devuelve un array de FEN únicos que incluye siempre el FEN inicial.
 */
function buildValidFenPool(depth: number, seed: number): string[] {
  const chess = new Chess();
  const fens = new Set<string>([chess.fen()]);

  // PRNG determinista simple (mulberry32) para reproducibilidad por semilla.
  let state = seed >>> 0;
  const rand = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < depth; i++) {
    const moves = chess.moves();
    if (moves.length === 0) {
      break; // jaque mate o tablas: no hay más movimientos legales.
    }
    const move = moves[Math.floor(rand() * moves.length)];
    chess.move(move);
    fens.add(chess.fen());
  }

  return [...fens];
}

/**
 * Pool amplio de FEN válidos reales, calculado una sola vez, para que los
 * generadores puedan elegir FEN legales sin recalcular partidas en cada
 * iteración. Combina varias partidas aleatorias con distintas semillas.
 */
const VALID_FEN_POOL: string[] = (() => {
  const all = new Set<string>();
  for (let seed = 1; seed <= 8; seed++) {
    for (const fen of buildValidFenPool(30, seed * 7919)) {
      all.add(fen);
    }
  }
  return [...all];
})();

/** Generador de un FEN válido tomado del pool de posiciones legales reales. */
const arbValidFen = fc.constantFrom(...VALID_FEN_POOL);

/**
 * Generador de FEN inválidos: cadenas que `new Chess(fen)` rechaza. Se combinan
 * cadenas arbitrarias y algunos casos límite conocidos. Se filtra con `fc.pre`
 * para descartar cualquier cadena que resultara ser un FEN válido.
 */
const arbInvalidFen = fc
  .oneof(
    fc.string(),
    fc.constantFrom(
      "",
      "no-es-un-fen",
      "8/8/8/8/8/8/8/8 w - - 0 1", // sin reyes: chess.js lo rechaza
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", // faltan campos
      "xxxx/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    ),
  )
  .filter((s) => {
    try {
      new Chess(s);
      return false; // es válido → descartar
    } catch {
      return true; // inválido → conservar
    }
  });

/** Generador de una etiqueta arbitraria para la entrada reciente. */
const arbLabel = fc.string();

/**
 * Una "acción" de inserción: un FEN (válido o inválido) más su etiqueta. Se usa
 * para construir secuencias arbitrarias de llamadas a `pushRecentFen`.
 */
const arbPushAction = fc.record({
  fen: fc.oneof(
    { weight: 3, arbitrary: arbValidFen },
    { weight: 1, arbitrary: arbInvalidFen },
  ),
  label: arbLabel,
});

/** Comprueba que no hay dos entradas con el mismo `fen`. */
function hasNoDuplicateFens(list: RecentPosition[]): boolean {
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry.fen)) {
      return false;
    }
    seen.add(entry.fen);
  }
  return true;
}

describe("Posiciones recientes (RecentPosition) — pruebas de propiedad", () => {
  beforeEach(() => {
    // Cada iteración parte de un almacenamiento limpio (sin arrastre).
    window.localStorage.clear();
  });

  it("Property 2: Capacidad de recientes — length <= 10 tras cualquier secuencia de pushRecentFen (Validates: Requisito 6.4)", () => {
    fc.assert(
      fc.property(fc.array(arbPushAction, { maxLength: 40 }), (actions) => {
        window.localStorage.clear();

        for (const { fen, label } of actions) {
          pushRecentFen(fen, label);
          // El invariante se mantiene después de CADA inserción.
          expect(loadRecentFens().length).toBeLessThanOrEqual(RECENT_FENS_MAX);
        }

        expect(loadRecentFens().length).toBeLessThanOrEqual(RECENT_FENS_MAX);
      }),
    );
  });

  it("Property 3: Sin duplicados — ninguna secuencia produce dos entradas con el mismo fen (Validates: Requisito 6.3)", () => {
    fc.assert(
      fc.property(fc.array(arbPushAction, { maxLength: 40 }), (actions) => {
        window.localStorage.clear();

        for (const { fen, label } of actions) {
          pushRecentFen(fen, label);
          // Sin duplicados después de CADA inserción (incluye reinserción del
          // mismo FEN, que debe "mover al frente" sin duplicar — Requisito 6.3).
          expect(hasNoDuplicateFens(loadRecentFens())).toBe(true);
        }

        expect(hasNoDuplicateFens(loadRecentFens())).toBe(true);
      }),
    );
  });

  it("Property 3 (refuerzo): reinsertar el mismo FEN válido no crea duplicados y mantiene una sola entrada (Validates: Requisito 6.3)", () => {
    fc.assert(
      fc.property(
        arbValidFen,
        arbLabel,
        fc.integer({ min: 1, max: 6 }),
        (fen, label, repeticiones) => {
          window.localStorage.clear();

          for (let i = 0; i < repeticiones; i++) {
            pushRecentFen(fen, label);
          }

          const list = loadRecentFens();
          expect(list.filter((p) => p.fen === fen)).toHaveLength(1);
          expect(hasNoDuplicateFens(list)).toBe(true);
        },
      ),
    );
  });

  it("Property 4: Orden de recencia — tras pushRecentFen(validFen, label) la entrada en índice 0 tiene ese fen (Validates: Requisito 6.1)", () => {
    fc.assert(
      fc.property(
        fc.array(arbPushAction, { maxLength: 25 }),
        arbValidFen,
        arbLabel,
        (previas, fen, label) => {
          window.localStorage.clear();

          // Estado previo arbitrario (puede incluir inserciones válidas e
          // inválidas), que no debe afectar al invariante de recencia.
          for (const accion of previas) {
            pushRecentFen(accion.fen, accion.label);
          }

          const result = pushRecentFen(fen, label);

          // El FEN recién insertado ocupa el índice 0, tanto en el valor
          // devuelto como al recargar desde localStorage.
          expect(result[0]?.fen).toBe(fen);
          expect(loadRecentFens()[0]?.fen).toBe(fen);
        },
      ),
    );
  });
});
