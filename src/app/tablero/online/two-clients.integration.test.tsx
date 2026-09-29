/**
 * Prueba de **integración de dos clientes simulados** del modo en línea
 * (tarea 16.1).
 *
 * Arranca un único núcleo `GameServer` en memoria (la fuente de verdad) y dos
 * instancias de `useOnlineGame`, cada una con su propio `FakeSocket`. Un
 * pequeño transporte en memoria enruta cada `ClientMessage` de un cliente a los
 * métodos del servidor y difunde los `ServerMessage` resultantes a AMBOS
 * clientes, respetando que el `playerId` (en `created`/`joined`) sólo viaja a su
 * propio dueño (Req 16.5).
 *
 * A diferencia de la prueba de propiedad de consistencia (14.3), este arnés
 * ejercita **el protocolo completo** con ejemplos concretos: crear → unir →
 * mover, jaque mate, rendición, tablas por acuerdo, y el ciclo de vida de
 * conexión (desconexión → reconexión → abandono). Para los temporizadores del
 * periodo de gracia se inyecta un **planificador falso** en el servidor que
 * captura las devoluciones de llamada, de modo que la expiración del periodo de
 * gracia se dispara de forma determinista sin esperar 60 s reales.
 *
 * Cubre, mediante ejemplos:
 * - **P9 / Req 11.3**: tras crear/unir y varios movimientos legales, ambos
 *   clientes convergen a `fen`/`turno`/`historial`/`resultado` idénticos y
 *   coinciden con la autoridad del servidor.
 * - **P12 / Req 13.1**: cada evento de red produce un anuncio no vacío en cada
 *   cliente (se captura `onAnnounce`).
 * - **Req 15.1 / 15.4**: jaque mate, rendición y tablas por acuerdo se aplican
 *   y se anuncian.
 * - **Req 14.3 / 14.5 / 14.6 (P13) / 14.7**: desconexión →
 *   `opponent-disconnected`; reconexión → `opponent-reconnected` + re-sync
 *   exacta (`fen`/`historial` idénticos); superar la gracia →
 *   `opponent-abandoned` con resultado de abandono.
 *
 * No se edita ninguna fuente: sólo se compone el arnés a partir de los seams
 * públicos (`socketFactory`, `onAnnounce`) del hook y de la API pública del
 * `GameServer` (incluyendo su planificador inyectable).
 */

import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useOnlineGame,
  type OnlineSocket,
  type UseOnlineGame,
} from "@/hooks/useOnlineGame";
import {
  GameServer,
  type Outbound,
  type TimerHandle,
} from "@/server/gameServer";
import type {
  ClientMessage,
  Color,
  ServerMessage,
} from "@/lib/onlineProtocol";

// ---------------------------------------------------------------------------
// Socket falso en memoria (mismo patrón que useOnlineGame.consistency.test.ts)
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
// Planificador falso para el periodo de gracia (temporizadores del servidor)
// ---------------------------------------------------------------------------

/**
 * Planificador determinista para los temporizadores de gracia del servidor.
 * En vez de usar `setTimeout`, guarda los callbacks pendientes y expone
 * `expirarTodos()` para dispararlos manualmente, simulando que el periodo de
 * gracia (60 s) transcurrió sin reconexión.
 */
class PlanificadorFalso {
  private seq = 0;
  private readonly pendientes = new Map<number, () => void>();

  programar = (callback: () => void): TimerHandle => {
    this.seq += 1;
    const id = this.seq;
    this.pendientes.set(id, callback);
    return id;
  };

  cancelar = (handle: TimerHandle): void => {
    this.pendientes.delete(handle as number);
  };

  /** Nº de temporizadores pendientes (para aserciones). */
  get pendientesCount(): number {
    return this.pendientes.size;
  }

  /** Dispara y elimina todos los temporizadores pendientes (expira la gracia). */
  expirarTodos(): void {
    const callbacks = [...this.pendientes.values()];
    this.pendientes.clear();
    callbacks.forEach((cb) => cb());
  }
}

// ---------------------------------------------------------------------------
// Núcleo servidor determinista (códigos y playerId incrementales + gracia)
// ---------------------------------------------------------------------------

/** Crea un `GameServer` con dependencias deterministas y planificador falso. */
function servidorDeterminista(planificador: PlanificadorFalso): GameServer {
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
    programar: planificador.programar,
    cancelar: planificador.cancelar,
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
// Captura de anuncios por cliente (P12, Req 13.1)
// ---------------------------------------------------------------------------

type Anuncio = { mensaje: string; politeness: string };

// ---------------------------------------------------------------------------
// Arnés de dos clientes sobre un servidor autoritativo compartido
// ---------------------------------------------------------------------------

type Cliente = {
  socket: FakeSocket;
  view: RenderHookResult<UseOnlineGame, unknown>;
  /** `playerId` secreto aprendido de `created`/`joined`. */
  playerId: string | null;
  color: Color | null;
  /** Todos los anuncios que este cliente ha recibido, en orden. */
  anuncios: Anuncio[];
};

/**
 * Compone dos hooks `useOnlineGame`, cada uno con su `FakeSocket`, sobre un
 * `GameServer` compartido con planificador falso. Enruta el protocolo completo
 * de cada cliente al servidor y difunde los `ServerMessage` resultantes,
 * respetando que `playerId` sólo va a su dueño (Req 16.5). Captura los anuncios
 * de cada cliente para verificar P12 (Req 13.1).
 */
function crearArnes() {
  const planificador = new PlanificadorFalso();
  const server = servidorDeterminista(planificador);

  const clienteW: Cliente = {
    socket: new FakeSocket(),
    view: null as unknown as Cliente["view"],
    playerId: null,
    color: null,
    anuncios: [],
  };
  const clienteB: Cliente = {
    socket: new FakeSocket(),
    view: null as unknown as Cliente["view"],
    playerId: null,
    color: null,
    anuncios: [],
  };

  let codigo: string | null = null;

  /** Cliente por color (una vez asignados). */
  function porColor(color: Color): Cliente {
    if (clienteW.color === color) return clienteW;
    if (clienteB.color === color) return clienteB;
    // Antes de asignar colores, W es blancas y B negras por convención.
    return color === "w" ? clienteW : clienteB;
  }

  /** Difunde un `ServerMessage` común (p. ej. `state-sync`) a ambos clientes. */
  function broadcast(msg: ServerMessage): void {
    clienteW.socket.server(msg);
    clienteB.socket.server(msg);
  }

  /** Reparte una lista de `Outbound` (rendición/tablas/conexión) por color. */
  function repartir(mensajes: Outbound[]): void {
    for (const out of mensajes) {
      porColor(out.para).socket.server(out.mensaje);
    }
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
          broadcast(res);
        } else {
          // `move-rejected`/`error`: sólo al emisor.
          origen.socket.server(res);
        }
        break;
      }
      case "resign": {
        if (origen.playerId === null) break;
        const res = server.rendirse(msg.codigo, origen.playerId);
        if ("mensajes" in res) {
          repartir(res.mensajes);
        } else {
          origen.socket.server(res);
        }
        break;
      }
      case "draw-offer": {
        if (origen.playerId === null) break;
        const res = server.ofrecerTablas(msg.codigo, origen.playerId);
        if ("mensajes" in res) {
          repartir(res.mensajes);
        } else {
          origen.socket.server(res);
        }
        break;
      }
      case "draw-accept": {
        if (origen.playerId === null) break;
        const res = server.resolverTablas(msg.codigo, origen.playerId, true);
        if ("mensajes" in res) {
          repartir(res.mensajes);
        } else {
          origen.socket.server(res);
        }
        break;
      }
      case "draw-decline": {
        if (origen.playerId === null) break;
        const res = server.resolverTablas(msg.codigo, origen.playerId, false);
        if ("mensajes" in res) {
          repartir(res.mensajes);
        } else {
          origen.socket.server(res);
        }
        break;
      }
      default:
        break;
    }
  }

  clienteW.socket.onEmit = (msg) => enrutar(clienteW, msg);
  clienteB.socket.onEmit = (msg) => enrutar(clienteB, msg);

  clienteW.view = renderHook(() =>
    useOnlineGame(undefined, {
      socketFactory: () => clienteW.socket,
      onAnnounce: (mensaje, politeness = "polite") =>
        clienteW.anuncios.push({ mensaje, politeness }),
    }),
  );
  clienteB.view = renderHook(() =>
    useOnlineGame(undefined, {
      socketFactory: () => clienteB.socket,
      onAnnounce: (mensaje, politeness = "polite") =>
        clienteB.anuncios.push({ mensaje, politeness }),
    }),
  );

  return {
    server,
    planificador,
    clienteW,
    clienteB,
    getCodigo: () => codigo,
    /**
     * Invoca `marcarDesconexion` del jugador indicado y difunde el
     * `opponent-disconnected` al rival, cableando el `onAbandono` para difundir
     * el `opponent-abandoned` cuando expire la gracia.
     */
    desconectar: (jugador: Cliente) => {
      const res = server.marcarDesconexion(
        codigo!,
        jugador.playerId!,
        (mensajes) => repartir(mensajes),
      );
      if ("mensajes" in res) repartir(res.mensajes);
      return res;
    },
    /**
     * Invoca `reconectar` del jugador indicado, entrega el `state-sync` exacto
     * a ese jugador y difunde `opponent-reconnected` al rival.
     */
    reconectar: (jugador: Cliente) => {
      const res = server.reconectar(codigo!, jugador.playerId!);
      if ("stateSync" in res) {
        jugador.socket.server(res.stateSync);
        repartir(res.mensajes);
      } else {
        jugador.socket.server(res);
      }
      return res;
    },
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

/** Comprueba que un cliente recibió al menos un anuncio no vacío (P12). */
function ultimoAnuncio(cliente: Cliente): Anuncio {
  expect(cliente.anuncios.length).toBeGreaterThan(0);
  return cliente.anuncios[cliente.anuncios.length - 1];
}

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

describe("Integración de dos clientes simulados (tarea 16.1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("crear → unir → mover: ambos clientes convergen al estado autoritativo (P9, Req 11.3)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB, getCodigo } = arnes;
    const codigo = getCodigo()!;

    const jugadas: Array<[Color, string, string]> = [
      ["w", "e2", "e4"],
      ["b", "e7", "e5"],
      ["w", "g1", "f3"],
      ["b", "b8", "c6"],
      ["w", "f1", "b5"],
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

    // El servidor es la autoridad: ambos clientes coinciden con su estado.
    const game = arnes.server.obtenerPartida(codigo)!;
    expect(clienteW.view.result.current.state.fen).toBe(game.fen);
    expect(clienteB.view.result.current.state.fen).toBe(game.fen);
    expect(clienteW.view.result.current.state.historial).toEqual(
      game.historial,
    );
    expect(clienteW.view.result.current.state.historial).toEqual([
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Bb5",
    ]);

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it("cada evento de red produce un anuncio no vacío en cada cliente (P12, Req 13.1)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB } = arnes;

    // Tras crear+unir, ambos ya tienen anuncios (created/joined/opponent-joined).
    expect(clienteW.anuncios.length).toBeGreaterThan(0);
    expect(clienteB.anuncios.length).toBeGreaterThan(0);

    // Cada anuncio capturado es una cadena no vacía tras trim (Req 13.1).
    const todosNoVacios = (c: Cliente) =>
      c.anuncios.every((a) => a.mensaje.trim().length > 0);
    expect(todosNoVacios(clienteW)).toBe(true);
    expect(todosNoVacios(clienteB)).toBe(true);

    // Un movimiento produce un nuevo anuncio no vacío en AMBOS clientes.
    const antesW = clienteW.anuncios.length;
    const antesB = clienteB.anuncios.length;
    act(() => clienteW.view.result.current.intentarMovimiento("e2", "e4"));
    expect(clienteW.anuncios.length).toBeGreaterThan(antesW);
    expect(clienteB.anuncios.length).toBeGreaterThan(antesB);
    expect(ultimoAnuncio(clienteW).mensaje.trim().length).toBeGreaterThan(0);
    expect(ultimoAnuncio(clienteB).mensaje.trim().length).toBeGreaterThan(0);

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it("jaque mate (mate del loco) se aplica y se anuncia en ambos clientes (Req 13.1)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB } = arnes;

    // Mate del loco: 1.f3 e5 2.g4 Qh4#
    const jugadas: Array<[Color, string, string]> = [
      ["w", "f2", "f3"],
      ["b", "e7", "e5"],
      ["w", "g2", "g4"],
      ["b", "d8", "h4"],
    ];
    for (const [color, from, to] of jugadas) {
      const emisor = color === "w" ? clienteW : clienteB;
      act(() => emisor.view.result.current.intentarMovimiento(from, to));
    }

    // Resultado autoritativo de jaque mate, ganador negras, en ambos clientes.
    expect(clienteW.view.result.current.state.resultado).toBe("jaque-mate");
    expect(clienteB.view.result.current.state.resultado).toBe("jaque-mate");
    expect(clienteW.view.result.current.state.ganador).toBe("b");
    expect(clienteB.view.result.current.state.ganador).toBe("b");

    // El anuncio final transmite "jaque mate".
    const anuncioW = ultimoAnuncio(clienteW).mensaje.toLowerCase();
    const anuncioB = ultimoAnuncio(clienteB).mensaje.toLowerCase();
    expect(anuncioW).toContain("jaque mate");
    expect(anuncioB).toContain("jaque mate");

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it("rendición: resultado 'rendicion' difundido y anunciado a ambos (Req 15.1)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB, getCodigo } = arnes;
    const codigo = getCodigo()!;

    // Blancas se rinden; ganan las negras.
    act(() => clienteW.view.result.current.rendirse());

    expect(clienteW.view.result.current.state.resultado).toBe("rendicion");
    expect(clienteB.view.result.current.state.resultado).toBe("rendicion");
    expect(clienteW.view.result.current.state.ganador).toBe("b");
    expect(clienteB.view.result.current.state.ganador).toBe("b");
    expect(arnes.server.obtenerPartida(codigo)!.resultado).toBe("rendicion");

    expect(ultimoAnuncio(clienteW).mensaje.toLowerCase()).toContain(
      "rendici",
    );
    expect(ultimoAnuncio(clienteB).mensaje.toLowerCase()).toContain(
      "rendici",
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it("tablas por acuerdo: oferta + aceptación → 'tablas' anunciado a ambos (Req 15.4)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB, getCodigo } = arnes;
    const codigo = getCodigo()!;

    // Blancas ofrecen tablas; negras aceptan.
    act(() => clienteW.view.result.current.ofrecerTablas());
    // El rival (negras) ve la oferta pendiente.
    expect(clienteB.view.result.current.state.ofertaTablasPendiente).toBe(
      "rival",
    );

    act(() => clienteB.view.result.current.aceptarTablas());

    expect(clienteW.view.result.current.state.resultado).toBe("tablas");
    expect(clienteB.view.result.current.state.resultado).toBe("tablas");
    expect(arnes.server.obtenerPartida(codigo)!.resultado).toBe("tablas");

    expect(ultimoAnuncio(clienteW).mensaje.toLowerCase()).toContain("tablas");
    expect(ultimoAnuncio(clienteB).mensaje.toLowerCase()).toContain("tablas");

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it("desconexión → opponent-disconnected; reconexión → opponent-reconnected + re-sync exacta (P13, Req 14.3/14.5/14.6)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB } = arnes;

    // Juega unos movimientos para tener historial no trivial (N medios movs).
    const jugadas: Array<[Color, string, string]> = [
      ["w", "e2", "e4"],
      ["b", "c7", "c5"],
      ["w", "g1", "f3"],
    ];
    for (const [color, from, to] of jugadas) {
      const emisor = color === "w" ? clienteW : clienteB;
      act(() => emisor.view.result.current.intentarMovimiento(from, to));
    }

    const fenAntes = clienteW.view.result.current.state.fen;
    const historialAntes = [...clienteW.view.result.current.state.historial];
    expect(historialAntes).toHaveLength(3);

    // Negras se desconectan: blancas reciben opponent-disconnected.
    const antesW = clienteW.anuncios.length;
    act(() => {
      arnes.desconectar(clienteB);
    });
    expect(clienteW.anuncios.length).toBeGreaterThan(antesW);
    expect(ultimoAnuncio(clienteW).mensaje.toLowerCase()).toContain(
      "desconect",
    );
    // Hay un temporizador de gracia pendiente.
    expect(arnes.planificador.pendientesCount).toBe(1);

    // Negras reconectan (dentro de la gracia): blancas reciben
    // opponent-reconnected y negras reciben un state-sync exacto (P13).
    const antesReconW = clienteW.anuncios.length;
    act(() => {
      arnes.reconectar(clienteB);
    });
    expect(clienteW.anuncios.length).toBeGreaterThan(antesReconW);
    expect(ultimoAnuncio(clienteW).mensaje.toLowerCase()).toContain(
      "reconect",
    );

    // Re-sync EXACTA: el estado de negras reproduce fen e historial idénticos.
    expect(clienteB.view.result.current.state.fen).toBe(fenAntes);
    expect(clienteB.view.result.current.state.historial).toEqual(
      historialAntes,
    );
    expect(clienteB.view.result.current.state.historial).toHaveLength(3);
    // Y ambos clientes siguen coincidiendo.
    expect(clienteW.view.result.current.state.fen).toBe(
      clienteB.view.result.current.state.fen,
    );

    // Reconectar canceló el temporizador de gracia.
    expect(arnes.planificador.pendientesCount).toBe(0);

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });

  it("superar el periodo de gracia → opponent-abandoned y resultado de abandono (Req 14.7)", () => {
    const arnes = arnesConPartida();
    const { clienteW, clienteB, getCodigo } = arnes;
    const codigo = getCodigo()!;

    act(() => clienteW.view.result.current.intentarMovimiento("e2", "e4"));

    // Negras se desconectan.
    act(() => {
      arnes.desconectar(clienteB);
    });
    expect(arnes.planificador.pendientesCount).toBe(1);

    // Expira la gracia sin reconexión: blancas reciben opponent-abandoned.
    const antesW = clienteW.anuncios.length;
    act(() => {
      arnes.planificador.expirarTodos();
    });

    expect(clienteW.anuncios.length).toBeGreaterThan(antesW);
    expect(ultimoAnuncio(clienteW).mensaje.toLowerCase()).toContain(
      "abandon",
    );

    // El resultado autoritativo del servidor es "abandono", gana el rival (w).
    const game = arnes.server.obtenerPartida(codigo)!;
    expect(game.resultado).toBe("abandono");
    expect(game.ganador).toBe("w");

    act(() => {
      vi.runOnlyPendingTimers();
    });
  });
});
