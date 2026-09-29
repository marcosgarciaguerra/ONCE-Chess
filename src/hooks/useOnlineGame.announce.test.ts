/**
 * Prueba de propiedad de anuncio de todo evento de red (tarea 14.4).
 *
 * **Property 12: Anuncio de todo evento de red** — cada evento que cambia el
 * estado produce un anuncio no vacío por `aria-live` y, si `speechEnabled`,
 * por voz.
 *
 * **Validates: Requisito 13.1**
 *
 * Se comprueba en dos capas complementarias:
 *
 * 1. **Pura** sobre `describirMensaje`: para un `ServerMessage` arbitrario
 *    (todas las variantes de la unión discriminada, incluyendo `state-sync`
 *    con/sin `lastMove` y variando jaque/resultado/ganador, `move-rejected`
 *    con cada motivo, `error` con cada código, `chat`, etc.) y cualquier
 *    `ctx.color` (`w`/`b`/`null`), el `mensaje` traducido es una cadena en
 *    español NO vacía (longitud > 0 tras `trim()`).
 *
 * 2. **Nivel de hook**: con un `FakeSocket` inyectado y un espía `onAnnounce`,
 *    entregar una secuencia arbitraria de `ServerMessage` produce una llamada
 *    a `onAnnounce` con mensaje no vacío por cada evento que cambia el estado.
 *    Se afirma que TODA llamada a `onAnnounce` lleva un mensaje no vacío.
 *
 * La generación de mensajes usa un arbitrario `fast-check` construido con
 * `fc.oneof` sobre registros por variante, de modo que sólo se producen
 * `ServerMessage` válidos.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type {
  Color,
  ErrorCode,
  MoveRejectedReason,
  OnlineResult,
  ServerMessage,
} from "@/lib/onlineProtocol";
import {
  describirMensaje,
  useOnlineGame,
  type OnlineSocket,
} from "@/hooks/useOnlineGame";

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

// ---------------------------------------------------------------------------
// Arbitrarios: generan cada variante válida de la unión ServerMessage
// ---------------------------------------------------------------------------

const colorArb: fc.Arbitrary<Color> = fc.constantFrom("w", "b");

/** Color del contexto del cliente: `w`, `b` o `null` (aún sin asignar). */
const ctxColorArb: fc.Arbitrary<Color | null> = fc.constantFrom("w", "b", null);

const fenArb: fc.Arbitrary<string> = fc.constantFrom(STARTING_FEN, AFTER_E4_FEN);

const sanArb: fc.Arbitrary<string> = fc.constantFrom(
  "e4",
  "Nf3",
  "Qxf7#",
  "O-O",
  "exd5",
  "Qh5+",
);

const squareArb: fc.Arbitrary<string> = fc.constantFrom(
  "e2",
  "e4",
  "d7",
  "g1",
  "f3",
  "a1",
);

const historialArb: fc.Arbitrary<string[]> = fc.array(sanArb, {
  maxLength: 8,
});

const resultadoArb: fc.Arbitrary<OnlineResult> = fc.constantFrom(
  "en-curso",
  "jaque-mate",
  "tablas",
  "rendicion",
  "abandono",
);

const rejectReasonArb: fc.Arbitrary<MoveRejectedReason> = fc.constantFrom(
  "no-es-tu-turno",
  "movimiento-ilegal",
  "partida-finalizada",
);

const errorCodeArb: fc.Arbitrary<ErrorCode> = fc.constantFrom(
  "codigo-invalido",
  "codigo-expirado",
  "partida-llena",
  "no-autorizado",
);

const codigoArb: fc.Arbitrary<string> = fc.constantFrom(
  "GATO-SOL-23",
  "LUNA-RIO-47",
  "MAR-NUBE-91",
);

/** `lastMove` opcional para `state-sync`. */
const lastMoveArb: fc.Arbitrary<
  { from: string; to: string; san: string } | undefined
> = fc.option(
  fc.record({ from: squareArb, to: squareArb, san: sanArb }),
  { nil: undefined },
);

/** Reloj opcional por jugador. */
const relojArb: fc.Arbitrary<{ w: number; b: number } | undefined> = fc.option(
  fc.record({
    w: fc.integer({ min: 0, max: 600_000 }),
    b: fc.integer({ min: 0, max: 600_000 }),
  }),
  { nil: undefined },
);

/** `ganador` coherente: color o `null`. */
const ganadorArb: fc.Arbitrary<Color | null> = fc.constantFrom("w", "b", null);

const createdArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("created" as const),
  codigo: codigoArb,
  playerId: fc.constant("pid-w"),
  color: fc.constant("w" as const),
  fen: fenArb,
});

const joinedArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("joined" as const),
  playerId: fc.constant("pid-b"),
  color: fc.constant("b" as const),
  fen: fenArb,
  historial: historialArb,
});

const opponentJoinedArb: fc.Arbitrary<ServerMessage> = fc.constant({
  type: "opponent-joined" as const,
});

const stateSyncArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("state-sync" as const),
  fen: fenArb,
  historial: historialArb,
  turno: colorArb,
  lastMove: lastMoveArb,
  jaque: fc.boolean(),
  resultado: resultadoArb,
  ganador: ganadorArb,
  relojMs: relojArb,
});

const moveRejectedArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("move-rejected" as const),
  reason: rejectReasonArb,
});

const drawOfferedArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("draw-offered" as const),
  de: colorArb,
});

const drawDeclinedArb: fc.Arbitrary<ServerMessage> = fc.constant({
  type: "draw-declined" as const,
});

const opponentDisconnectedArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("opponent-disconnected" as const),
  graceMs: fc.constantFrom(30_000, 60_000),
});

const opponentReconnectedArb: fc.Arbitrary<ServerMessage> = fc.constant({
  type: "opponent-reconnected" as const,
});

const opponentAbandonedArb: fc.Arbitrary<ServerMessage> = fc.constant({
  type: "opponent-abandoned" as const,
});

const errorArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("error" as const),
  code: errorCodeArb,
});

const chatArb: fc.Arbitrary<ServerMessage> = fc.record({
  type: fc.constant("chat" as const),
  de: colorArb,
  texto: fc.string({ minLength: 1, maxLength: 40 }),
});

/** Cualquier variante válida de `ServerMessage`. */
const serverMessageArb: fc.Arbitrary<ServerMessage> = fc.oneof(
  createdArb,
  joinedArb,
  opponentJoinedArb,
  stateSyncArb,
  moveRejectedArb,
  drawOfferedArb,
  drawDeclinedArb,
  opponentDisconnectedArb,
  opponentReconnectedArb,
  opponentAbandonedArb,
  errorArb,
  chatArb,
);

// ---------------------------------------------------------------------------
// Socket falso: registra emisiones y permite inyectar mensajes entrantes.
// ---------------------------------------------------------------------------

class FakeSocket implements OnlineSocket {
  connected = true;
  emitted: Array<{ event: string; args: unknown[] }> = [];
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  emit(event: string, ...args: unknown[]): unknown {
    this.emitted.push({ event, args });
    return this;
  }
  on(event: string, handler: (...args: unknown[]) => void): unknown {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }
  off(event: string, handler?: (...args: unknown[]) => void): unknown {
    if (!handler) {
      this.handlers.delete(event);
      return this;
    }
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      list.filter((h) => h !== handler),
    );
    return this;
  }
  disconnect(): unknown {
    this.connected = false;
    return this;
  }
  connect(): unknown {
    this.connected = true;
    return this;
  }
  fire(event: string, ...args: unknown[]): void {
    (this.handlers.get(event) ?? []).forEach((h) => h(...args));
  }
  server(msg: ServerMessage): void {
    this.fire("message", msg);
  }
}

// ---------------------------------------------------------------------------
// Capa 1: propiedad pura sobre `describirMensaje`
// ---------------------------------------------------------------------------

describe("Property 12 — describirMensaje (Req 13.1)", () => {
  it("todo ServerMessage produce un mensaje NO vacío para cualquier color de contexto", () => {
    fc.assert(
      fc.property(serverMessageArb, ctxColorArb, (msg, color) => {
        const { mensaje, politeness } = describirMensaje(msg, { color });
        // El anuncio siempre es una cadena no vacía tras `trim()` (Req 13.1).
        expect(typeof mensaje).toBe("string");
        expect(mensaje.trim().length).toBeGreaterThan(0);
        // La urgencia `aria-live` está bien formada.
        expect(["polite", "assertive"]).toContain(politeness);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Capa 2: propiedad a nivel de hook con FakeSocket + onAnnounce espía
// ---------------------------------------------------------------------------

describe("Property 12 — useOnlineGame anuncia cada evento de red (Req 13.1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("una secuencia arbitraria de ServerMessages produce un anuncio no vacío por cada evento", () => {
    fc.assert(
      fc.property(
        fc.array(serverMessageArb, { minLength: 1, maxLength: 12 }),
        (mensajes) => {
          const socket = new FakeSocket();
          const onAnnounce = vi.fn();
          const view = renderHook(() =>
            useOnlineGame(undefined, {
              socketFactory: () => socket,
              onAnnounce,
            }),
          );

          try {
            for (const msg of mensajes) {
              act(() => socket.server(msg));
            }

            // Cada evento entrante debe producir al menos un anuncio: hay al
            // menos tantas llamadas como mensajes entregados (Req 13.1).
            expect(onAnnounce.mock.calls.length).toBeGreaterThanOrEqual(
              mensajes.length,
            );

            // Y TODA llamada a onAnnounce lleva un mensaje no vacío.
            for (const [mensaje] of onAnnounce.mock.calls) {
              expect(String(mensaje).trim().length).toBeGreaterThan(0);
            }
          } finally {
            view.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
