/**
 * Prueba de propiedad de **consistencia del estado autoritativo entre clientes**
 * (tarea 14.3).
 *
 * **Property 9: Consistencia del estado autoritativo entre clientes** — tras un
 * `state-sync`, ambos clientes muestran el mismo `fen`, `turno`, `historial` y
 * `resultado`.
 *
 * **Validates: Requisito 11.3**
 *
 * Enfoque: se cablean DOS instancias de `useOnlineGame` (vía `renderHook`), cada
 * una con su propio `FakeSocket`, sobre un ÚNICO núcleo `GameServer` en memoria
 * (la fuente de verdad). Un pequeño "transporte" en memoria enruta cada
 * `ClientMessage` emitido por un cliente hacia los métodos del `GameServer`
 * (`crearPartida`/`unirse`/`aplicarMovimiento`/...) y difunde de vuelta a AMBOS
 * clientes los `ServerMessage` resultantes, respetando que el `playerId` (en
 * `created`/`joined`) sólo viaja a su propio cliente (Req 16.5).
 *
 * Para secuencias arbitrarias de movimientos legales que alternan el turno, tras
 * cada difusión de `state-sync` se comprueba que el estado de AMBOS hooks tiene
 * `fen`, `turno`, `historial` y `resultado` idénticos (Property 9, Req 11.3).
 *
 * No se edita el hook, su prueba existente ni el servidor: sólo se compone el
 * arnés a partir de sus seams públicos (`socketFactory`) y de la API pública del
 * `GameServer`.
 */

import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { Chess } from "chess.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  useOnlineGame,
  type OnlineSocket,
  type UseOnlineGame,
} from "@/hooks/useOnlineGame";
import { GameServer } from "@/server/gameServer";
import type { ClientMessage, Color, ServerMessage } from "@/lib/onlineProtocol";

// ---------------------------------------------------------------------------
// Socket falso en memoria (mismo patrón que useOnlineGame.test.ts)
// ---------------------------------------------------------------------------

/**
 * Socket falso: registra emisiones y permite inyectar mensajes entrantes. Es un
 * subconjunto de la API de Socket.IO suficiente para el hook (seam
 * `OnlineSocket`).
 */
class FakeSocket implements OnlineSocket {
  connected = true;
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  /** Enrutador que recibe cada `ClientMessage` emitido por este socket. */
  onEmit?: (msg: ClientMessage) => void;

  emit(event: string, ...args: unknown[]): unknown {
    if (event === "message") {
      this.onEmit?.(args[0] as ClientMessage);
    }
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

  /** Entrega un `ServerMessage` por el canal `message` a los manejadores. */
  server(msg: ServerMessage): void {
    (this.handlers.get("message") ?? []).forEach((h) => h(msg));
  }
}

// ---------------------------------------------------------------------------
// Núcleo servidor determinista (códigos y playerId incrementales)
// ---------------------------------------------------------------------------

/** Crea un `GameServer` con dependencias deterministas para el arnés. */
function servidorDeterminista(): GameServer {
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

// ---------------------------------------------------------------------------
// Arnés de dos clientes sobre un servidor autoritativo compartido
// ---------------------------------------------------------------------------

type Cliente = {
  socket: FakeSocket;
  view: RenderHookResult<UseOnlineGame, unknown>;
  /** `playerId` secreto que este cliente aprendió de `created`/`joined`. */
  playerId: string | null;
  color: Color | null;
};

/**
 * Compone dos hooks `useOnlineGame`, cada uno con su `FakeSocket`, sobre un
 * `GameServer` compartido. Enruta los `ClientMessage` de cada cliente al
 * servidor y difunde los `ServerMessage` resultantes a AMBOS clientes,
 * respetando que `playerId` sólo va a su propio dueño.
 */
function crearArnes() {
  const server = servidorDeterminista();

  const clienteW: Cliente = {
    socket: new FakeSocket(),
    view: null as unknown as Cliente["view"],
    playerId: null,
    color: null,
  };
  const clienteB: Cliente = {
    socket: new FakeSocket(),
    view: null as unknown as Cliente["view"],
    playerId: null,
    color: null,
  };

  /** Código de la partida en juego (se conoce al crear). */
  let codigo: string | null = null;

  /** Difunde un `state-sync` (u otro mensaje común) a ambos clientes. */
  function broadcast(msg: ServerMessage): void {
    clienteW.socket.server(msg);
    clienteB.socket.server(msg);
  }

  /** Procesa un `ClientMessage` proveniente de un cliente dado. */
  function enrutar(origen: Cliente, msg: ClientMessage): void {
    switch (msg.type) {
      case "create": {
        const game = server.crearPartida();
        codigo = game.codigo;
        const creador = game.participantes[0];
        origen.playerId = creador.playerId;
        origen.color = "w";
        // `created` (con playerId) SÓLO al creador (Req 16.5).
        origen.socket.server({
          type: "created",
          codigo: game.codigo,
          playerId: creador.playerId,
          color: "w",
          fen: game.fen,
        });
        break;
      }
      case "join": {
        const res = server.unirse(msg.codigo);
        if (esError(res)) {
          origen.socket.server(res);
          break;
        }
        origen.playerId = res.playerId;
        origen.color = "b";
        // `joined` (con playerId) SÓLO al que se une (Req 16.5).
        origen.socket.server({
          type: "joined",
          playerId: res.playerId,
          color: "b",
          fen: res.game.fen,
          historial: res.game.historial,
        });
        // El creador (rival) recibe `opponent-joined`, sin playerId ajeno.
        const rival = origen === clienteW ? clienteB : clienteW;
        rival.socket.server({ type: "opponent-joined" });
        break;
      }
      case "move": {
        if (origen.playerId === null) break;
        const res = server.aplicarMovimiento(
          msg.codigo,
          origen.playerId,
          msg.from,
          msg.to,
          msg.promotion,
        );
        if (res.type === "state-sync") {
          // El estado autoritativo se difunde a AMBOS clientes (Req 11.3).
          broadcast(res);
        } else {
          // `move-rejected`/`error`: sólo al emisor (no cambia el estado común).
          origen.socket.server(res);
        }
        break;
      }
      default:
        // Otros mensajes (tablas/rendición/reconnect) no se ejercitan en esta
        // propiedad de consistencia por movimientos legales.
        break;
    }
  }

  clienteW.socket.onEmit = (msg) => enrutar(clienteW, msg);
  clienteB.socket.onEmit = (msg) => enrutar(clienteB, msg);

  clienteW.view = renderHook(() =>
    useOnlineGame(undefined, {
      socketFactory: () => clienteW.socket,
      onAnnounce: () => {},
    }),
  );
  clienteB.view = renderHook(() =>
    useOnlineGame(undefined, {
      socketFactory: () => clienteB.socket,
      onAnnounce: () => {},
    }),
  );

  return {
    server,
    clienteW,
    clienteB,
    getCodigo: () => codigo,
  };
}

/** Instala una partida: crea (blancas) + une (negras) y devuelve el arnés. */
function arnesConPartida() {
  const arnes = crearArnes();
  const { clienteW, clienteB } = arnes;

  act(() => clienteW.view.result.current.crearPartida());
  const codigo = arnes.getCodigo();
  expect(codigo).not.toBeNull();

  act(() => clienteB.view.result.current.unirse(codigo!));

  return arnes;
}

// ---------------------------------------------------------------------------
// Generación de secuencias de movimientos legales alternando el turno
// ---------------------------------------------------------------------------

/**
 * Reproduce, con una instancia `Chess` local (sólo para el generador), la
 * secuencia de índices de movimiento y devuelve la lista de `{ from, to,
 * promotion }` legales. En cada posición se elige el movimiento cuyo índice es
 * `indice mod nºmovimientos`. Si la partida termina antes, se detiene. La
 * instancia local NO es autoridad: sólo sirve para escoger movimientos legales
 * que el servidor validará por su cuenta.
 */
function movimientosLegales(
  indices: number[],
): Array<{ from: string; to: string; promotion?: string }> {
  const chess = new Chess();
  const jugadas: Array<{ from: string; to: string; promotion?: string }> = [];
  for (const idx of indices) {
    const verboses = chess.moves({ verbose: true });
    if (verboses.length === 0) break; // fin de la partida
    const elegido = verboses[((idx % verboses.length) + verboses.length) % verboses.length];
    const jugada = {
      from: elegido.from,
      to: elegido.to,
      promotion: elegido.promotion,
    };
    jugadas.push(jugada);
    chess.move({ from: jugada.from, to: jugada.to, promotion: jugada.promotion });
  }
  return jugadas;
}

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

describe("Property 9 — consistencia del estado autoritativo entre clientes (Req 11.3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("tras cada state-sync, ambos clientes comparten fen, turno, historial y resultado", () => {
    fc.assert(
      fc.property(
        // Secuencia arbitraria de "índices de movimiento" (hasta 20 medios
        // movimientos). El generador los mapea a movimientos legales para el
        // bando en turno, alternando el turno de forma natural.
        fc.array(fc.nat({ max: 4096 }), { minLength: 0, maxLength: 20 }),
        (indices) => {
          window.localStorage.clear();
          const arnes = arnesConPartida();
          const { clienteW, clienteB, getCodigo } = arnes;
          const codigo = getCodigo()!;

          const jugadas = movimientosLegales(indices);

          for (const jugada of jugadas) {
            // El servidor es la autoridad del turno: el cliente que mueve es
            // el del color en turno según el estado autoritativo compartido.
            const turno = clienteW.view.result.current.state.turno;
            const emisor = turno === "w" ? clienteW : clienteB;

            act(() =>
              emisor.view.result.current.intentarMovimiento(
                jugada.from,
                jugada.to,
                jugada.promotion,
              ),
            );

            // Property 9: tras el state-sync difundido, ambos coinciden.
            const a = clienteW.view.result.current.state;
            const b = clienteB.view.result.current.state;
            expect(a.fen).toBe(b.fen);
            expect(a.turno).toBe(b.turno);
            expect(a.historial).toEqual(b.historial);
            expect(a.resultado).toBe(b.resultado);
          }

          // Coherencia final adicional con la fuente de verdad del servidor.
          const game = arnes.server.obtenerPartida(codigo)!;
          expect(clienteW.view.result.current.state.fen).toBe(game.fen);
          expect(clienteB.view.result.current.state.fen).toBe(game.fen);
          expect(clienteW.view.result.current.state.historial).toEqual(
            game.historial,
          );

          clienteW.view.unmount();
          clienteB.view.unmount();
        },
      ),
      { numRuns: 40 },
    );
  });

  it("ejemplo concreto: e4 e5 Nf3 converge en ambos clientes", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB } = arnes;

    const jugadas: Array<[Color, string, string]> = [
      ["w", "e2", "e4"],
      ["b", "e7", "e5"],
      ["w", "g1", "f3"],
    ];

    for (const [color, from, to] of jugadas) {
      const emisor = color === "w" ? clienteW : clienteB;
      act(() => emisor.view.result.current.intentarMovimiento(from, to));

      const a = clienteW.view.result.current.state;
      const b = clienteB.view.result.current.state;
      expect(a.fen).toBe(b.fen);
      expect(a.turno).toBe(b.turno);
      expect(a.historial).toEqual(b.historial);
      expect(a.resultado).toBe(b.resultado);
    }

    expect(clienteW.view.result.current.state.historial).toEqual([
      "e4",
      "e5",
      "Nf3",
    ]);
    expect(clienteW.view.result.current.state.turno).toBe("b");

    // Drena cualquier temporizador pendiente (p. ej. confirmación de
    // movimiento) dentro de act() para evitar avisos de estado fuera de act.
    act(() => {
      vi.runOnlyPendingTimers();
    });
  });
});
