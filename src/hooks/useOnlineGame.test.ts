/**
 * Pruebas unitarias de `useOnlineGame` (tarea 14.1).
 *
 * Se inyecta un socket falso en memoria mediante el seam `socketFactory`, de
 * modo que las pruebas dirigen los mensajes entrantes del servidor sin red
 * real. Verifican:
 * - El estado autoritativo se sincroniza SÓLO con `state-sync` (Req 11.1/11.3).
 * - `intentarMovimiento` envía `move` y NO aplica localmente hasta el
 *   `state-sync` (Req 11.1).
 * - Sin confirmación en 5 s, el movimiento se descarta, se restaura el estado
 *   y se emite un anuncio (Req 11.7).
 * - Se persiste `{ codigo, playerId }` en `once-chess.last-online-game.v1`
 *   (Req 14.8).
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEYS } from "@/lib/storage";
import type {
  ClientMessage,
  ServerMessage,
} from "@/lib/onlineProtocol";
import {
  calcularRetardoReconexion,
  describirMensaje,
  MOVE_CONFIRM_TIMEOUT_MS,
  RECONNECT_MAX_ATTEMPTS,
  readLastOnlineGame,
  useOnlineGame,
  WAIT_FIRST_THRESHOLD_MS,
  WAIT_INTERVAL_MS,
  type OnlineSocket,
} from "@/hooks/useOnlineGame";

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/** Socket falso: registra emisiones y permite inyectar mensajes entrantes. */
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
  /**
   * Si es `false`, `connect()` NO marca la conexión como establecida, lo que
   * permite simular reintentos de reconexión que fracasan (tarea 14.2).
   */
  connectSucceeds = true;

  disconnect(): unknown {
    this.connected = false;
    return this;
  }
  connect(): unknown {
    if (this.connectSucceeds) {
      this.connected = true;
    }
    return this;
  }

  /** Dispara un evento arbitrario hacia los manejadores registrados. */
  fire(event: string, ...args: unknown[]): void {
    (this.handlers.get(event) ?? []).forEach((h) => h(...args));
  }
  /** Atajo: entrega un `ServerMessage` por el canal `message`. */
  server(msg: ServerMessage): void {
    this.fire("message", msg);
  }
  /** Último `ClientMessage` emitido, o `undefined`. */
  lastClientMessage(): ClientMessage | undefined {
    const last = this.emitted.filter((e) => e.event === "message").at(-1);
    return last?.args[0] as ClientMessage | undefined;
  }
}

function setup(initialCodigo?: string) {
  const socket = new FakeSocket();
  const onAnnounce = vi.fn();
  const view = renderHook(() =>
    useOnlineGame(initialCodigo, {
      socketFactory: () => socket,
      onAnnounce,
    }),
  );
  return { socket, onAnnounce, ...view };
}

describe("useOnlineGame", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("crearPartida emite un mensaje create y aplica created", () => {
    const { socket, result } = setup();

    act(() => result.current.crearPartida());
    expect(socket.lastClientMessage()).toEqual({ type: "create" });

    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );

    expect(result.current.state.codigo).toBe("GATO-SOL-23");
    expect(result.current.state.color).toBe("w");
    expect(result.current.state.status).toBe("esperando-rival");
    expect(result.current.state.fen).toBe(STARTING_FEN);
  });

  it("persiste { codigo, playerId } tras created (Req 14.8)", () => {
    const { socket, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );

    const persisted = readLastOnlineGame();
    expect(persisted).toEqual({ codigo: "GATO-SOL-23", playerId: "pid-w" });
    expect(
      window.localStorage.getItem(STORAGE_KEYS.lastOnlineGame),
    ).not.toBeNull();
  });

  it("el estado autoritativo sólo cambia con state-sync (Req 11.1/11.3)", () => {
    const { socket, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() => socket.server({ type: "opponent-joined" }));

    // intentarMovimiento NO debe cambiar el fen hasta el state-sync.
    act(() => result.current.intentarMovimiento("e2", "e4"));
    expect(socket.lastClientMessage()).toEqual({
      type: "move",
      codigo: "GATO-SOL-23",
      from: "e2",
      to: "e4",
      promotion: undefined,
    });
    expect(result.current.state.fen).toBe(STARTING_FEN); // sin aplicar

    // Llega el state-sync autoritativo -> ahora sí se aplica.
    act(() =>
      socket.server({
        type: "state-sync",
        fen: AFTER_E4_FEN,
        historial: ["e4"],
        turno: "b",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      }),
    );
    expect(result.current.state.fen).toBe(AFTER_E4_FEN);
    expect(result.current.state.turno).toBe("b");
    expect(result.current.state.esMiTurno).toBe(false); // soy blancas, turno negras
    expect(result.current.state.status).toBe("en-juego");
  });

  it("descarta el movimiento y restaura el estado si no llega state-sync en 5 s (Req 11.7)", () => {
    const { socket, onAnnounce, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() =>
      socket.server({
        type: "state-sync",
        fen: STARTING_FEN,
        historial: [],
        turno: "w",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      }),
    );

    act(() => result.current.intentarMovimiento("e2", "e4"));
    expect(result.current.state.fen).toBe(STARTING_FEN);

    // Avanzar 5 s sin state-sync de confirmación.
    act(() => {
      vi.advanceTimersByTime(MOVE_CONFIRM_TIMEOUT_MS);
    });

    expect(result.current.state.fen).toBe(STARTING_FEN); // estado restaurado
    // El anuncio del descarte del movimiento no confirmado es el último y
    // es `assertive` (Req 11.7). Nota: desde la tarea 14.2 cada mensaje
    // entrante — `created`, `state-sync`, etc. — también produce su propio
    // anuncio, de modo que no se comprueba el total sino el último.
    const ultimaLlamada = onAnnounce.mock.calls.at(-1);
    expect(ultimaLlamada?.[0]).toContain("No se pudo confirmar el movimiento");
    expect(ultimaLlamada?.[1]).toBe("assertive");
  });

  it("move-rejected restaura el último estado autoritativo", () => {
    const { socket, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() =>
      socket.server({
        type: "state-sync",
        fen: STARTING_FEN,
        historial: [],
        turno: "w",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      }),
    );

    act(() => result.current.intentarMovimiento("e2", "e5")); // ilegal
    act(() => socket.server({ type: "move-rejected", reason: "movimiento-ilegal" }));

    expect(result.current.state.fen).toBe(STARTING_FEN);
  });

  it("draw-offered marca la oferta como del rival", () => {
    const { socket, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() => socket.server({ type: "draw-offered", de: "b" }));
    expect(result.current.state.ofertaTablasPendiente).toBe("rival");
  });

  it("rendirse/ofrecerTablas emiten los mensajes correctos", () => {
    const { socket, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );

    act(() => result.current.ofrecerTablas());
    expect(socket.lastClientMessage()).toEqual({
      type: "draw-offer",
      codigo: "GATO-SOL-23",
    });

    act(() => result.current.rendirse());
    expect(socket.lastClientMessage()).toEqual({
      type: "resign",
      codigo: "GATO-SOL-23",
    });
  });

  it("opponent-abandoned finaliza la partida con ganador propio", () => {
    const { socket, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() => socket.server({ type: "opponent-abandoned" }));

    expect(result.current.state.status).toBe("finalizada");
    expect(result.current.state.resultado).toBe("abandono");
    expect(result.current.state.ganador).toBe("w");
  });
});

// ---------------------------------------------------------------------------
// Tarea 14.2: anuncios por evento, umbrales de espera y backoff de reconexión
// ---------------------------------------------------------------------------

describe("describirMensaje (traducción de eventos a anuncios en español)", () => {
  /**
   * Property 12 (parcial, tarea 14.4 la formaliza): TODO `ServerMessage`
   * produce un anuncio no vacío en español (Req 13.1). Aquí se comprueba de
   * forma exhaustiva por variante con el color del cliente conocido.
   */
  const casos: ServerMessage[] = [
    { type: "created", codigo: "GATO-SOL-23", playerId: "x", color: "w", fen: STARTING_FEN },
    { type: "joined", playerId: "x", color: "b", fen: STARTING_FEN, historial: [] },
    { type: "opponent-joined" },
    {
      type: "state-sync",
      fen: AFTER_E4_FEN,
      historial: ["e4"],
      turno: "b",
      lastMove: { from: "e2", to: "e4", san: "e4" },
      jaque: false,
      resultado: "en-curso",
      ganador: null,
    },
    { type: "move-rejected", reason: "no-es-tu-turno" },
    { type: "move-rejected", reason: "movimiento-ilegal" },
    { type: "move-rejected", reason: "partida-finalizada" },
    { type: "draw-offered", de: "b" },
    { type: "draw-declined" },
    { type: "opponent-disconnected", graceMs: 60_000 },
    { type: "opponent-reconnected" },
    { type: "opponent-abandoned" },
    { type: "error", code: "codigo-invalido" },
    { type: "error", code: "codigo-expirado" },
    { type: "error", code: "partida-llena" },
    { type: "chat", de: "b", texto: "hola" },
  ];

  it("cada evento entrante produce un anuncio no vacío (Req 13.1)", () => {
    for (const msg of casos) {
      const { mensaje } = describirMensaje(msg, { color: "w" });
      expect(mensaje.trim().length).toBeGreaterThan(0);
    }
  });

  it("state-sync describe el turno en palabras, no sólo por color (Req 13.4)", () => {
    // Soy blancas y el turno es de negras -> "Turno del rival".
    const anuncioRival = describirMensaje(
      {
        type: "state-sync",
        fen: AFTER_E4_FEN,
        historial: ["e4"],
        turno: "b",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      },
      { color: "w" },
    );
    expect(anuncioRival.mensaje).toContain("Turno del rival");

    // Soy blancas y el turno es mío -> "Es tu turno".
    const anuncioMio = describirMensaje(
      {
        type: "state-sync",
        fen: STARTING_FEN,
        historial: [],
        turno: "w",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      },
      { color: "w" },
    );
    expect(anuncioMio.mensaje).toContain("Es tu turno");
  });

  it("anuncia el jaque de forma assertive (Req 13.2)", () => {
    const anuncio = describirMensaje(
      {
        type: "state-sync",
        fen: STARTING_FEN,
        historial: ["Qh5"],
        turno: "b",
        jaque: true,
        resultado: "en-curso",
        ganador: null,
      },
      { color: "w" },
    );
    expect(anuncio.mensaje).toContain("Jaque");
    expect(anuncio.politeness).toBe("assertive");
  });

  it("anuncia jaque mate con el resultado (Req 13.3)", () => {
    const anuncio = describirMensaje(
      {
        type: "state-sync",
        fen: STARTING_FEN,
        historial: ["Qxf7#"],
        turno: "b",
        jaque: true,
        resultado: "jaque-mate",
        ganador: "w",
      },
      { color: "w" },
    );
    expect(anuncio.mensaje).toContain("Jaque mate");
    expect(anuncio.mensaje).toContain("Has ganado");
    expect(anuncio.politeness).toBe("assertive");
  });

  it("traduce el motivo de move-rejected al español (Req 12.4)", () => {
    expect(
      describirMensaje({ type: "move-rejected", reason: "no-es-tu-turno" }, {
        color: "w",
      }).mensaje,
    ).toContain("no es tu turno");
    expect(
      describirMensaje(
        { type: "move-rejected", reason: "movimiento-ilegal" },
        { color: "w" },
      ).mensaje,
    ).toContain("ilegal");
  });

  it("la oferta de tablas del rival es assertive (Req 13.5)", () => {
    const anuncio = describirMensaje({ type: "draw-offered", de: "b" }, {
      color: "w",
    });
    expect(anuncio.politeness).toBe("assertive");
    expect(anuncio.mensaje).toContain("tablas");
  });

  it("los errores de código dan texto de ayuda en español (Req 10.6/10.7/10.8)", () => {
    expect(
      describirMensaje({ type: "error", code: "codigo-invalido" }, {
        color: "w",
      }).mensaje,
    ).toContain("no existe");
    expect(
      describirMensaje({ type: "error", code: "codigo-expirado" }, {
        color: "w",
      }).mensaje,
    ).toContain("caducado");
    expect(
      describirMensaje({ type: "error", code: "partida-llena" }, {
        color: "w",
      }).mensaje,
    ).toContain("dos jugadores");
  });
});

describe("useOnlineGame — anuncios por evento (Req 13.1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("emite un anuncio no vacío por cada mensaje entrante", () => {
    const { socket, onAnnounce, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() => socket.server({ type: "opponent-joined" }));
    act(() =>
      socket.server({
        type: "state-sync",
        fen: AFTER_E4_FEN,
        historial: ["e4"],
        turno: "b",
        lastMove: { from: "e2", to: "e4", san: "e4" },
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      }),
    );

    // Al menos un anuncio por cada uno de los tres mensajes entrantes.
    expect(onAnnounce.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [mensaje] of onAnnounce.mock.calls) {
      expect(String(mensaje).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("useOnlineGame — umbrales de espera de rival (Req 9.8)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("anuncia a los 30 s, 60 s y luego cada 60 s, sin repetir umbral", () => {
    const { socket, onAnnounce, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    // Ahora status === "esperando-rival": arranca el temporizador de espera.
    onAnnounce.mockClear();

    const anunciosEspera = () =>
      onAnnounce.mock.calls.filter(([m]) =>
        String(m).includes("esperando al rival"),
      );

    // Antes de 30 s: ningún anuncio de espera.
    act(() => vi.advanceTimersByTime(WAIT_FIRST_THRESHOLD_MS - 1));
    expect(anunciosEspera().length).toBe(0);

    // A los 30 s: primer anuncio.
    act(() => vi.advanceTimersByTime(1));
    expect(anunciosEspera().length).toBe(1);

    // A los 60 s: segundo anuncio.
    act(() => vi.advanceTimersByTime(WAIT_INTERVAL_MS));
    expect(anunciosEspera().length).toBe(2);

    // A los 120 s: tercer anuncio (cada 60 s).
    act(() => vi.advanceTimersByTime(WAIT_INTERVAL_MS));
    expect(anunciosEspera().length).toBe(3);
  });

  it("deja de anunciar espera cuando el rival se une", () => {
    const { socket, onAnnounce, result } = setup();
    act(() => result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() => vi.advanceTimersByTime(WAIT_FIRST_THRESHOLD_MS));
    // Rival se une -> state-sync en juego -> status deja de ser esperando.
    act(() =>
      socket.server({
        type: "state-sync",
        fen: STARTING_FEN,
        historial: [],
        turno: "w",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      }),
    );
    onAnnounce.mockClear();
    act(() => vi.advanceTimersByTime(WAIT_INTERVAL_MS * 3));
    const anunciosEspera = onAnnounce.mock.calls.filter(([m]) =>
      String(m).includes("esperando al rival"),
    );
    expect(anunciosEspera.length).toBe(0);
  });
});

describe("useOnlineGame — reconexión con backoff (Req 14.1/14.2)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("calcularRetardoReconexion crece exponencialmente y se topa en 30 s", () => {
    expect(calcularRetardoReconexion(1)).toBe(1_000);
    expect(calcularRetardoReconexion(2)).toBe(2_000);
    expect(calcularRetardoReconexion(3)).toBe(4_000);
    expect(calcularRetardoReconexion(4)).toBe(8_000);
    expect(calcularRetardoReconexion(5)).toBe(16_000);
    expect(calcularRetardoReconexion(6)).toBe(30_000); // 32 s -> topado
    expect(calcularRetardoReconexion(10)).toBe(30_000);
  });

  /** Prepara una partida en curso (created + state-sync en-curso). */
  function partidaEnCurso() {
    const socket = new FakeSocket();
    const onAnnounce = vi.fn();
    const view = renderHook(() =>
      useOnlineGame(undefined, {
        socketFactory: () => socket,
        onAnnounce,
      }),
    );
    act(() => view.result.current.crearPartida());
    act(() =>
      socket.server({
        type: "created",
        codigo: "GATO-SOL-23",
        playerId: "pid-w",
        color: "w",
        fen: STARTING_FEN,
      }),
    );
    act(() =>
      socket.server({
        type: "state-sync",
        fen: STARTING_FEN,
        historial: [],
        turno: "w",
        jaque: false,
        resultado: "en-curso",
        ganador: null,
      }),
    );
    return { socket, onAnnounce, ...view };
  }

  it("al caer la conexión pasa a reconectando y anuncia el reintento", () => {
    const { socket, onAnnounce, result } = partidaEnCurso();
    onAnnounce.mockClear();

    act(() => {
      socket.disconnect();
      socket.fire("disconnect");
    });

    expect(result.current.state.status).toBe("reconectando");
    const anuncioReintento = onAnnounce.mock.calls.find(([m]) =>
      String(m).includes("Conexión perdida"),
    );
    expect(anuncioReintento).toBeDefined();
    expect(anuncioReintento?.[1]).toBe("assertive");
  });

  it("reintenta y, al reconectar, reenvía reconnect", () => {
    const { socket, result } = partidaEnCurso();

    act(() => {
      socket.disconnect();
      socket.fire("disconnect");
    });
    expect(result.current.state.status).toBe("reconectando");

    // Primer reintento a 1 s: el socket vuelve a conectar con éxito.
    socket.connectSucceeds = true;
    act(() => vi.advanceTimersByTime(1_000));
    act(() => socket.fire("connect"));

    // Tras connect, se reenvía reconnect con codigo+playerId.
    const reconnectMsgs = socket.emitted.filter(
      (e) =>
        e.event === "message" &&
        (e.args[0] as ClientMessage)?.type === "reconnect",
    );
    expect(reconnectMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it("agotados los 10 intentos pasa a error y anuncia el fallo (Req 14.2)", () => {
    const { socket, onAnnounce, result } = partidaEnCurso();
    // Los reintentos nunca conectan.
    socket.connectSucceeds = false;
    onAnnounce.mockClear();

    act(() => {
      socket.disconnect();
      socket.fire("disconnect");
    });

    // Avanza el tiempo suficiente para agotar los 10 intentos de backoff
    // (1+2+4+8+16+30*5 = ~181 s). Se avanza con holgura.
    act(() => vi.advanceTimersByTime(10 * 60 * 1000));

    expect(result.current.state.status).toBe("error");
    const anuncioFallo = onAnnounce.mock.calls.find(([m]) =>
      String(m).includes("No se pudo restablecer la conexión"),
    );
    expect(anuncioFallo).toBeDefined();
    expect(anuncioFallo?.[1]).toBe("assertive");
    // No debe exceder el número máximo de intentos configurado.
    expect(RECONNECT_MAX_ATTEMPTS).toBe(10);
  });
});
