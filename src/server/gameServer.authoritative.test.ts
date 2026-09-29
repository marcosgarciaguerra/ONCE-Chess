/**
 * Pruebas de PROPIEDAD del estado autoritativo del `GameServer` (tarea 13.3).
 *
 * Estas propiedades comprueban invariantes universales del núcleo autoritativo
 * frente a secuencias arbitrarias de intentos de movimiento, complementando las
 * pruebas por ejemplo de `gameServer.test.ts`. Se usa `fast-check` con un
 * servidor determinista (códigos y `playerId` incrementales) para que cada
 * contraejemplo sea reproducible.
 *
 * - Property 10 (Aplicación de la regla de turno, Req 12.1): un `move` enviado
 *   por el jugador cuyo color NO es el turno actual devuelve
 *   `move-rejected("no-es-tu-turno")` y NO altera el `fen` autoritativo.
 * - Property 11 (Ningún movimiento ilegal en el estado autoritativo,
 *   Req 11.6/16.2): para cualquier secuencia de `move` (legales, ilegales,
 *   fuera de turno o malformados), el `fen` autoritativo es siempre una
 *   posición legal alcanzable por ajedrez legal. Se comprueba de dos formas:
 *   (1) `new Chess(fen)` nunca lanza, y (2) —más fuerte— el `fen` coincide con
 *   el de una instancia `Chess` «sombra» en la que sólo se reproducen los
 *   movimientos aceptados (los que devolvieron `state-sync`).
 *
 * Validates: Requisitos 12.1, 11.6, 16.2.
 */

import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { GameServer, STARTING_FEN } from "./gameServer";
import type { ServerMessage } from "@/lib/onlineProtocol";

/**
 * Crea un `GameServer` con dependencias deterministas: códigos y `playerId`
 * incrementales y un reloj monótono. Cada propiedad crea su propio servidor
 * para no compartir estado entre ejecuciones.
 */
function servidorDeterminista() {
  let codigoSeq = 0;
  let pidSeq = 0;
  let reloj = 1_000;
  return new GameServer({
    generarCodigo: () => {
      codigoSeq += 1;
      return `MESA-ROSA-${codigoSeq}`;
    },
    generarPlayerId: () => {
      pidSeq += 1;
      return `pid-${pidSeq}`;
    },
    ahora: () => {
      reloj += 1;
      return reloj;
    },
  });
}

function esError(
  r: unknown,
): r is Extract<ServerMessage, { type: "error" }> {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as { type?: string }).type === "error"
  );
}

/** Crea una partida con dos jugadores unidos y devuelve sus `playerId`. */
function partidaConDosJugadores(server: GameServer) {
  const creada = server.crearPartida();
  const blancoPid = creada.participantes[0].playerId;
  const res = server.unirse(creada.codigo);
  if (esError(res)) throw new Error("unión inesperadamente fallida");
  return { codigo: creada.codigo, blancoPid, negroPid: res.playerId };
}

// ---------------------------------------------------------------------------
// Generadores
// ---------------------------------------------------------------------------

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

/** Genera una casilla algebraica bien formada (p. ej. "e4"). */
const arbCasilla = fc
  .tuple(fc.constantFrom(...FILES), fc.constantFrom(...RANKS))
  .map(([f, r]) => `${f}${r}`);

/**
 * Genera una cadena de casilla que puede ser válida o malformada (números,
 * casillas fuera de rango, cadenas arbitrarias). Sirve para ejercitar la rama
 * de movimiento ilegal/malformado del servidor sin que ninguna lance.
 */
const arbCasillaODisparate = fc.oneof(
  arbCasilla,
  fc.constantFrom("z9", "a0", "", "e", "e44", "xx", "11", "--", " e2"),
  fc.string({ maxLength: 4 }),
);

// ---------------------------------------------------------------------------
// Property 10: Aplicación de la regla de turno (Req 12.1)
// ---------------------------------------------------------------------------

describe("Property 10: aplicación de la regla de turno", () => {
  it("un move fuera de turno devuelve no-es-tu-turno y no altera el fen (Req 12.1)", () => {
    fc.assert(
      fc.property(arbCasilla, arbCasilla, (from, to) => {
        const server = servidorDeterminista();
        const { codigo, negroPid } = partidaConDosJugadores(server);

        // El turno inicial es de blancas; negras (fuera de turno) intenta mover.
        const antes = server.obtenerPartida(codigo)?.fen;
        expect(antes).toBe(STARTING_FEN);

        const r = server.aplicarMovimiento(codigo, negroPid, from, to);

        expect(r.type).toBe("move-rejected");
        if (r.type === "move-rejected") {
          expect(r.reason).toBe("no-es-tu-turno");
        }
        // El fen autoritativo permanece intacto (la comprobación de turno
        // precede a la de legalidad, así que da igual si el move sería legal).
        expect(server.obtenerPartida(codigo)?.fen).toBe(antes);
      }),
    );
  });

  it("tras un medio movimiento legal, el turno pasa a negras y blancas queda fuera de turno", () => {
    fc.assert(
      fc.property(arbCasilla, arbCasilla, (from, to) => {
        const server = servidorDeterminista();
        const { codigo, blancoPid } = partidaConDosJugadores(server);

        // Blancas hace una jugada legal fija para ceder el turno a negras.
        const legal = server.aplicarMovimiento(codigo, blancoPid, "e2", "e4");
        expect(legal.type).toBe("state-sync");

        // Ahora es turno de negras; blancas (fuera de turno) intenta mover.
        const antes = server.obtenerPartida(codigo)?.fen;
        const r = server.aplicarMovimiento(codigo, blancoPid, from, to);

        expect(r.type).toBe("move-rejected");
        if (r.type === "move-rejected") {
          expect(r.reason).toBe("no-es-tu-turno");
        }
        expect(server.obtenerPartida(codigo)?.fen).toBe(antes);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: ningún movimiento ilegal en el estado autoritativo (Req 11.6/16.2)
// ---------------------------------------------------------------------------

/**
 * Genera un «intento» de movimiento. Con cierta probabilidad se marca como
 * `preferLegal`: en ese caso el ejecutor elegirá una jugada legal real de la
 * posición actual (para el jugador en turno), de modo que la secuencia mezcle
 * jugadas legales con ilegales, malformadas y fuera de turno.
 */
type Intento = {
  /** Quién envía: `w` (blancas) o `b` (negras). */
  jugador: "w" | "b";
  /** Si se debe intentar elegir una jugada legal de la posición actual. */
  preferLegal: boolean;
  /** Casilla de origen candidata (usada si no se elige una legal). */
  from: string;
  /** Casilla de destino candidata (usada si no se elige una legal). */
  to: string;
};

const arbIntento: fc.Arbitrary<Intento> = fc.record({
  jugador: fc.constantFrom("w", "b"),
  preferLegal: fc.boolean(),
  from: arbCasillaODisparate,
  to: arbCasillaODisparate,
});

describe("Property 11: ningún movimiento ilegal en el estado autoritativo", () => {
  it("el fen autoritativo siempre es legal y coincide con el replay de las jugadas aceptadas (Req 11.6, 16.2)", () => {
    fc.assert(
      fc.property(
        fc.array(arbIntento, { minLength: 1, maxLength: 40 }),
        (intentos) => {
          const server = servidorDeterminista();
          const { codigo, blancoPid, negroPid } =
            partidaConDosJugadores(server);
          const pid = { w: blancoPid, b: negroPid };

          // Instancia «sombra»: reproduce SÓLO las jugadas aceptadas por el
          // servidor. Su fen debe coincidir siempre con el autoritativo.
          const sombra = new Chess();

          for (const intento of intentos) {
            let from = intento.from;
            let to = intento.to;
            let promotion: string | undefined;

            // Para enriquecer la mezcla con jugadas realmente legales, si el
            // intento lo pide y el emisor es el bando en turno, se elige una
            // jugada legal real de la posición actual del servidor.
            if (intento.preferLegal) {
              const motor = server.obtenerMotor(codigo);
              const enTurno = motor?.turn();
              if (motor && enTurno === intento.jugador) {
                const legales = motor.moves({ verbose: true });
                if (legales.length > 0) {
                  const mv = legales[0];
                  from = mv.from;
                  to = mv.to;
                  promotion = mv.promotion;
                }
              }
            }

            const r = server.aplicarMovimiento(
              codigo,
              pid[intento.jugador],
              from,
              to,
              promotion,
            );

            // Si el servidor aceptó el movimiento, reproducirlo en la sombra
            // con el SAN autoritativo (garantiza el mismo camino legal).
            if (r.type === "state-sync" && r.lastMove) {
              const aplicado = sombra.move(r.lastMove.san);
              expect(aplicado).not.toBeNull();
            } else {
              // Cualquier otro resultado (move-rejected/error) no debe alterar
              // el estado autoritativo.
              expect(["move-rejected", "error"]).toContain(r.type);
            }

            const fenAutoritativo = server.obtenerPartida(codigo)?.fen as string;

            // (1) El fen autoritativo es una posición legal cargable.
            expect(() => new Chess(fenAutoritativo)).not.toThrow();
            // (2) Coincide exactamente con el replay de las jugadas aceptadas.
            expect(fenAutoritativo).toBe(sombra.fen());
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("una secuencia sólo de movimientos ilegales/malformados mantiene la posición inicial", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            jugador: fc.constantFrom("w", "b"),
            from: arbCasillaODisparate,
            to: arbCasillaODisparate,
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (intentos) => {
          const server = servidorDeterminista();
          const { codigo, blancoPid, negroPid } =
            partidaConDosJugadores(server);
          const pid = { w: blancoPid, b: negroPid };

          for (const intento of intentos) {
            // Descartamos que el disparate sea, por casualidad, una jugada legal
            // en turno: si el motor la acepta, la excluimos de esta prueba.
            const motor = server.obtenerMotor(codigo);
            const enTurno = motor?.turn();
            let seriaLegal = false;
            if (motor && enTurno === intento.jugador) {
              seriaLegal = motor
                .moves({ verbose: true })
                .some((m) => m.from === intento.from && m.to === intento.to);
            }
            if (seriaLegal) continue;

            const r = server.aplicarMovimiento(
              codigo,
              pid[intento.jugador],
              intento.from,
              intento.to,
            );
            expect(r.type).not.toBe("state-sync");
          }

          // Sin ninguna jugada legal aplicada, el fen sigue siendo el inicial.
          expect(server.obtenerPartida(codigo)?.fen).toBe(STARTING_FEN);
        },
      ),
    );
  });
});
