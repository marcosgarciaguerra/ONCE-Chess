/**
 * Pruebas del núcleo autoritativo `GameServer` (tarea 13.1): registro,
 * creación de partida y unión. No cubre movimiento, ciclo de vida ni
 * seguridad (tareas 13.2/13.4/13.5).
 *
 * Requisitos cubiertos: 9.1, 9.5, 10.1, 10.2, 10.6, 10.7, 10.8.
 */

import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { GameServer, GRACE_MS, STARTING_FEN } from "./gameServer";
import type { Outbound } from "./gameServer";
import type { ServerMessage } from "@/lib/onlineProtocol";

/**
 * Crea un `GameServer` con dependencias deterministas para las pruebas:
 * códigos incrementales únicos y `playerId` incrementales.
 */
function servidorDeterminista() {
  let codigoSeq = 0;
  let pidSeq = 0;
  let reloj = 1_000;
  const server = new GameServer({
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
  return server;
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

describe("GameServer.crearPartida", () => {
  it("crea una partida en la posición inicial con creador en blancas (Req 9.1, 9.5)", () => {
    const server = servidorDeterminista();
    const game = server.crearPartida();

    expect(game.fen).toBe(STARTING_FEN);
    expect(game.historial).toEqual([]);
    expect(game.turno).toBe("w");
    expect(game.resultado).toBe("en-curso");
    expect(game.ganador).toBeNull();
    expect(game.participantes).toHaveLength(1);
    expect(game.participantes[0].color).toBe("w");
    expect(game.participantes[0].conectado).toBe(true);
  });

  it("asigna un playerId secreto no vacío al creador (Req 9.5)", () => {
    const server = servidorDeterminista();
    const game = server.crearPartida();
    expect(game.participantes[0].playerId).toBeTruthy();
  });

  it("registra la partida y genera códigos únicos", () => {
    const server = servidorDeterminista();
    const a = server.crearPartida();
    const b = server.crearPartida();

    expect(a.codigo).not.toBe(b.codigo);
    expect(server.numeroDePartidas).toBe(2);
    expect(server.obtenerPartida(a.codigo)?.codigo).toBe(a.codigo);
  });

  it("propaga el error si no se puede asignar un código único (Req 9.4)", () => {
    const server = new GameServer({
      generarCodigo: () => {
        throw new Error("sin código");
      },
    });
    expect(() => server.crearPartida()).toThrow();
    expect(server.numeroDePartidas).toBe(0);
  });
});

describe("GameServer.unirse", () => {
  it("asigna negras al segundo jugador y devuelve fen/historial (Req 10.1)", () => {
    const server = servidorDeterminista();
    const creada = server.crearPartida();

    const res = server.unirse(creada.codigo);
    expect(esError(res)).toBe(false);
    if (esError(res)) return;

    expect(res.game.participantes).toHaveLength(2);
    expect(res.game.participantes[1].color).toBe("b");
    expect(res.playerId).toBeTruthy();
    expect(res.game.fen).toBe(STARTING_FEN);
    expect(res.game.historial).toEqual([]);
  });

  it("no revela el playerId del creador al segundo jugador (Req 16.5)", () => {
    const server = servidorDeterminista();
    const creada = server.crearPartida();
    const creadorPid = creada.participantes[0].playerId;

    const res = server.unirse(creada.codigo);
    if (esError(res)) throw new Error("unión inesperadamente fallida");

    expect(res.playerId).not.toBe(creadorPid);
  });

  it("normaliza el código antes de buscar (Req 10.3/10.5)", () => {
    const server = servidorDeterminista();
    const creada = server.crearPartida();

    const res = server.unirse(`  ${creada.codigo.toLowerCase()}  `);
    expect(esError(res)).toBe(false);
  });

  it("responde codigo-invalido para un código desconocido (Req 10.6)", () => {
    const server = servidorDeterminista();
    const res = server.unirse("NADA-NADA-99");
    expect(esError(res) && res.code).toBe("codigo-invalido");
  });

  it("rechaza el tercer jugador con partida-llena sin alterar el estado (Req 10.8)", () => {
    const server = servidorDeterminista();
    const creada = server.crearPartida();
    server.unirse(creada.codigo);

    const antes = server.obtenerPartida(creada.codigo);
    const participantesAntes = antes?.participantes.length;

    const tercero = server.unirse(creada.codigo);
    expect(esError(tercero) && tercero.code).toBe("partida-llena");

    const despues = server.obtenerPartida(creada.codigo);
    expect(despues?.participantes.length).toBe(participantesAntes);
    expect(despues?.participantes.length).toBe(2);
  });

  it("responde codigo-expirado si la partida ya no está en curso (Req 10.7)", () => {
    const server = servidorDeterminista();
    const creada = server.crearPartida();

    // Simula una partida finalizada mutando el estado autoritativo directo.
    const game = server.obtenerPartida(creada.codigo);
    if (game) game.resultado = "jaque-mate";

    const res = server.unirse(creada.codigo);
    expect(esError(res) && res.code).toBe("codigo-expirado");
  });
});

describe("GameServer propiedades básicas de registro", () => {
  it("el fen de toda partida recién creada es una posición legal alcanzable", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n) => {
        const server = servidorDeterminista();
        for (let i = 0; i < n; i += 1) {
          const game = server.crearPartida();
          // El fen es cargable por chess.js (posición legal) y coincide con inicial.
          expect(() => new Chess(game.fen)).not.toThrow();
          expect(game.fen).toBe(STARTING_FEN);
        }
        expect(server.numeroDePartidas).toBe(n);
      }),
    );
  });

  it("unirse dos veces siempre produce exactamente dos participantes y la 3.ª falla", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const server = servidorDeterminista();
        const creada = server.crearPartida();
        const r1 = server.unirse(creada.codigo);
        const r2 = server.unirse(creada.codigo);
        expect(esError(r1)).toBe(false);
        expect(esError(r2) && r2.code).toBe("partida-llena");
        expect(server.obtenerPartida(creada.codigo)?.participantes.length).toBe(
          2,
        );
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// aplicarMovimiento (tarea 13.2): movimiento autoritativo y cumplimiento de turno
// Requisitos: 11.2, 11.4, 11.5, 12.1, 12.2, 12.3, 16.3, 16.4.
// ---------------------------------------------------------------------------

/** Crea una partida con dos jugadores unidos y devuelve los `playerId`. */
function partidaConDosJugadores(server: GameServer) {
  const creada = server.crearPartida();
  const blancoPid = creada.participantes[0].playerId;
  const res = server.unirse(creada.codigo);
  if (esError(res)) throw new Error("unión inesperadamente fallida");
  return { codigo: creada.codigo, blancoPid, negroPid: res.playerId };
}

describe("GameServer.aplicarMovimiento", () => {
  it("aplica un movimiento legal en turno y difunde state-sync (Req 11.2)", () => {
    const server = servidorDeterminista();
    const { codigo, blancoPid } = partidaConDosJugadores(server);

    const r = server.aplicarMovimiento(codigo, blancoPid, "e2", "e4");
    expect(r.type).toBe("state-sync");
    if (r.type !== "state-sync") return;

    expect(r.historial).toEqual(["e4"]);
    expect(r.turno).toBe("b");
    expect(r.lastMove).toEqual({ from: "e2", to: "e4", san: "e4" });
    expect(r.jaque).toBe(false);
    expect(r.resultado).toBe("en-curso");
    expect(r.ganador).toBeNull();

    // El fen autoritativo se actualizó y sigue siendo cargable por chess.js.
    const game = server.obtenerPartida(codigo);
    expect(game?.fen).toBe(r.fen);
    expect(() => new Chess(r.fen)).not.toThrow();
  });

  it("rechaza codigo-invalido para una partida inexistente", () => {
    const server = servidorDeterminista();
    const r = server.aplicarMovimiento("NADA-NADA-9", "pid-x", "e2", "e4");
    expect(r.type).toBe("error");
    if (r.type === "error") expect(r.code).toBe("codigo-invalido");
  });

  it("rechaza no-autorizado cuando el playerId no participa (Req 16.4)", () => {
    const server = servidorDeterminista();
    const { codigo } = partidaConDosJugadores(server);
    const antes = server.obtenerPartida(codigo)?.fen;

    const r = server.aplicarMovimiento(codigo, "pid-desconocido", "e2", "e4");
    expect(r.type).toBe("error");
    if (r.type === "error") expect(r.code).toBe("no-autorizado");
    // No altera el fen autoritativo.
    expect(server.obtenerPartida(codigo)?.fen).toBe(antes);
  });

  it("rechaza no-es-tu-turno sin alterar el fen (Req 12.1, Property 10)", () => {
    const server = servidorDeterminista();
    const { codigo, negroPid } = partidaConDosJugadores(server);
    const antes = server.obtenerPartida(codigo)?.fen;

    // Es turno de blancas; negras intenta mover.
    const r = server.aplicarMovimiento(codigo, negroPid, "e7", "e5");
    expect(r.type).toBe("move-rejected");
    if (r.type === "move-rejected") expect(r.reason).toBe("no-es-tu-turno");
    expect(server.obtenerPartida(codigo)?.fen).toBe(antes);
  });

  it("rechaza movimiento-ilegal sin alterar el fen (Req 12.2, 16.3)", () => {
    const server = servidorDeterminista();
    const { codigo, blancoPid } = partidaConDosJugadores(server);
    const antes = server.obtenerPartida(codigo)?.fen;

    const r = server.aplicarMovimiento(codigo, blancoPid, "e2", "e5");
    expect(r.type).toBe("move-rejected");
    if (r.type === "move-rejected") expect(r.reason).toBe("movimiento-ilegal");
    expect(server.obtenerPartida(codigo)?.fen).toBe(antes);
  });

  it("rechaza partida-finalizada sin alterar el fen (Req 12.3)", () => {
    const server = servidorDeterminista();
    const { codigo, blancoPid } = partidaConDosJugadores(server);
    const game = server.obtenerPartida(codigo);
    if (game) game.resultado = "rendicion";
    const antes = server.obtenerPartida(codigo)?.fen;

    const r = server.aplicarMovimiento(codigo, blancoPid, "e2", "e4");
    expect(r.type).toBe("move-rejected");
    if (r.type === "move-rejected") expect(r.reason).toBe("partida-finalizada");
    expect(server.obtenerPartida(codigo)?.fen).toBe(antes);
  });

  it("detecta jaque mate y fija ganador con el color que movió (Req 11.4)", () => {
    const server = servidorDeterminista();
    const { codigo, blancoPid, negroPid } = partidaConDosJugadores(server);

    // Mate del loco (Fool's mate): 1. f3 e5 2. g4 Qh4#
    expect(server.aplicarMovimiento(codigo, blancoPid, "f2", "f3").type).toBe(
      "state-sync",
    );
    expect(server.aplicarMovimiento(codigo, negroPid, "e7", "e5").type).toBe(
      "state-sync",
    );
    expect(server.aplicarMovimiento(codigo, blancoPid, "g2", "g4").type).toBe(
      "state-sync",
    );
    const r = server.aplicarMovimiento(codigo, negroPid, "d8", "h4");
    expect(r.type).toBe("state-sync");
    if (r.type !== "state-sync") return;

    expect(r.jaque).toBe(true);
    expect(r.resultado).toBe("jaque-mate");
    expect(r.ganador).toBe("b");
    expect(server.obtenerPartida(codigo)?.resultado).toBe("jaque-mate");
  });

  it("detecta tablas por ahogado (Req 11.5)", () => {
    // Posición clásica de ahogado: negras al mover no tiene jugadas legales y
    // no está en jaque. Rey negro en a8, dama blanca en b6, rey blanco en c6.
    // Al mover blancas Qb6 no; construimos una posición donde el próximo
    // movimiento blanco causa ahogado a negras.
    let codigoSeq = 0;
    let pidSeq = 0;
    const server = new GameServer({
      generarCodigo: () => {
        codigoSeq += 1;
        return `MESA-ROSA-${codigoSeq}`;
      },
      generarPlayerId: () => {
        pidSeq += 1;
        return `pid-${pidSeq}`;
      },
    });
    const { codigo, blancoPid } = partidaConDosJugadores(server);
    // Cargar directamente una posición donde blancas da ahogado en un movimiento.
    // FEN: rey negro a8, rey blanco c6, dama blanca c7 -> mueve Qb7? no.
    // Usamos: negras a mover no; blancas mueve para ahogar.
    // Posición: "k7/8/1QK5/8/8/8/8/8 w - - 0 1" -> 1.Qb6? no ahoga.
    // Ahogado directo: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1" ya es ahogado (negras).
    // Preparamos con blancas a mover: "7k/8/5QK1/8/8/8/8/8 w - - 0 1" -> Qf7 ahoga.
    const motor = server.obtenerMotor(codigo);
    if (!motor) throw new Error("sin motor");
    motor.load("7k/8/5QK1/8/8/8/8/8 w - - 0 1");
    const game = server.obtenerPartida(codigo);
    if (game) {
      game.fen = motor.fen();
      game.turno = "w";
    }

    const r = server.aplicarMovimiento(codigo, blancoPid, "f6", "f7");
    expect(r.type).toBe("state-sync");
    if (r.type !== "state-sync") return;
    expect(r.resultado).toBe("tablas");
    expect(r.ganador).toBeNull();
    expect(r.jaque).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rendición, tablas y ciclo de vida de conexión (tarea 13.4)
// Requisitos: 15.1, 15.2, 15.3, 15.4, 15.5, 14.3, 14.4, 14.5, 14.7, 14.9.
// ---------------------------------------------------------------------------

/**
 * Planificador determinista para las pruebas del periodo de gracia: registra
 * los `callback` programados y permite dispararlos manualmente sin esperar
 * tiempo real. `expirarTodos` ejecuta los temporizadores pendientes.
 */
function planificadorFalso() {
  const tareas = new Map<number, { cb: () => void; ms: number }>();
  let seq = 0;
  return {
    programar: (cb: () => void, ms: number) => {
      seq += 1;
      const id = seq;
      tareas.set(id, { cb, ms });
      return id;
    },
    cancelar: (handle: unknown) => {
      tareas.delete(handle as number);
    },
    /** Dispara todos los temporizadores pendientes (simula el fin de la gracia). */
    expirarTodos: () => {
      const pendientes = [...tareas.values()];
      tareas.clear();
      pendientes.forEach((t) => t.cb());
    },
    /** Número de temporizadores actualmente pendientes. */
    get pendientes() {
      return tareas.size;
    },
  };
}

/** `GameServer` determinista con un planificador falso inyectado. */
function servidorConPlanificador(plan: ReturnType<typeof planificadorFalso>) {
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
    programar: plan.programar,
    cancelar: plan.cancelar,
  });
}

function dosJugadores(server: GameServer) {
  const creada = server.crearPartida();
  const blancoPid = creada.participantes[0].playerId;
  const res = server.unirse(creada.codigo);
  if (esError(res)) throw new Error("unión inesperadamente fallida");
  return { codigo: creada.codigo, blancoPid, negroPid: res.playerId };
}

function tieneMensajes(
  r: unknown,
): r is { mensajes: Outbound[] } {
  return typeof r === "object" && r !== null && "mensajes" in r;
}

describe("GameServer.rendirse (Req 15.1)", () => {
  it("fija rendicion con el rival como ganador y difunde a ambos", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid } = dosJugadores(server);

    const r = server.rendirse(codigo, blancoPid);
    expect(tieneMensajes(r)).toBe(true);
    if (!tieneMensajes(r)) return;

    const game = server.obtenerPartida(codigo);
    expect(game?.resultado).toBe("rendicion");
    expect(game?.ganador).toBe("b");
    // Ambos colores reciben el state-sync.
    expect(r.mensajes.map((m) => m.para).sort()).toEqual(["b", "w"]);
    r.mensajes.forEach((m) => expect(m.mensaje.type).toBe("state-sync"));
  });

  it("rechaza no-autorizado si el playerId no participa", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo } = dosJugadores(server);
    const r = server.rendirse(codigo, "pid-desconocido");
    expect((r as ServerMessage).type === "error" && (r as { code: string }).code).toBe(
      "no-autorizado",
    );
  });

  it("rechaza partida-finalizada si ya no está en curso", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid } = dosJugadores(server);
    server.rendirse(codigo, blancoPid);
    const r = server.rendirse(codigo, blancoPid);
    expect((r as ServerMessage).type).toBe("move-rejected");
  });
});

describe("GameServer tablas (Req 15.2, 15.3, 15.4, 15.5)", () => {
  it("registra una única oferta y notifica draw-offered al rival (15.2/15.3)", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid, negroPid } = dosJugadores(server);

    const r1 = server.ofrecerTablas(codigo, blancoPid);
    expect(tieneMensajes(r1)).toBe(true);
    if (!tieneMensajes(r1)) return;
    expect(r1.mensajes).toHaveLength(1);
    expect(r1.mensajes[0].para).toBe("b");
    expect(r1.mensajes[0].mensaje).toEqual({ type: "draw-offered", de: "w" });
    expect(server.obtenerPartida(codigo)?.ofertaTablasDe).toBe("w");

    // Segunda oferta (incluso del rival) no crea una nueva: se mantiene la vigente.
    const r2 = server.ofrecerTablas(codigo, negroPid);
    expect(tieneMensajes(r2) && r2.mensajes).toEqual([]);
    expect(server.obtenerPartida(codigo)?.ofertaTablasDe).toBe("w");
  });

  it("aceptar tablas fija resultado tablas y difunde a ambos (15.4)", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid, negroPid } = dosJugadores(server);
    server.ofrecerTablas(codigo, blancoPid);

    const r = server.resolverTablas(codigo, negroPid, true);
    expect(tieneMensajes(r)).toBe(true);
    if (!tieneMensajes(r)) return;
    const game = server.obtenerPartida(codigo);
    expect(game?.resultado).toBe("tablas");
    expect(game?.ganador).toBeNull();
    expect(game?.ofertaTablasDe).toBeNull();
    expect(r.mensajes.map((m) => m.para).sort()).toEqual(["b", "w"]);
  });

  it("rechazar tablas limpia la oferta, notifica draw-declined y no cambia turno (15.5)", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid, negroPid } = dosJugadores(server);
    const turnoAntes = server.obtenerPartida(codigo)?.turno;
    server.ofrecerTablas(codigo, blancoPid);

    const r = server.resolverTablas(codigo, negroPid, false);
    expect(tieneMensajes(r)).toBe(true);
    if (!tieneMensajes(r)) return;
    expect(r.mensajes).toEqual([
      { para: "w", mensaje: { type: "draw-declined" } },
    ]);
    const game = server.obtenerPartida(codigo);
    expect(game?.ofertaTablasDe).toBeNull();
    expect(game?.resultado).toBe("en-curso");
    expect(game?.turno).toBe(turnoAntes);
  });

  it("el propio oferente no puede resolver su oferta", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid } = dosJugadores(server);
    server.ofrecerTablas(codigo, blancoPid);
    const r = server.resolverTablas(codigo, blancoPid, true);
    expect(tieneMensajes(r) && r.mensajes).toEqual([]);
    expect(server.obtenerPartida(codigo)?.resultado).toBe("en-curso");
  });
});

describe("GameServer ciclo de vida de conexión (Req 14.3, 14.4, 14.5, 14.7)", () => {
  it("marcarDesconexion notifica opponent-disconnected con graceMs (14.3)", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid } = dosJugadores(server);

    const r = server.marcarDesconexion(codigo, blancoPid);
    expect(tieneMensajes(r)).toBe(true);
    if (!tieneMensajes(r)) return;
    expect(r.mensajes).toEqual([
      { para: "b", mensaje: { type: "opponent-disconnected", graceMs: GRACE_MS } },
    ]);
    expect(
      server.obtenerPartida(codigo)?.participantes.find((p) => p.color === "w")
        ?.conectado,
    ).toBe(false);
    expect(plan.pendientes).toBe(1);
  });

  it("reconectar cancela el temporizador y devuelve state-sync exacto + opponent-reconnected (14.4/14.5/14.6)", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid, negroPid } = dosJugadores(server);
    // Un medio movimiento para que el state-sync no sea trivial.
    server.aplicarMovimiento(codigo, blancoPid, "e2", "e4");
    const fenAntes = server.obtenerPartida(codigo)?.fen;

    server.marcarDesconexion(codigo, negroPid);
    expect(plan.pendientes).toBe(1);

    const r = server.reconectar(codigo, negroPid);
    expect("stateSync" in r).toBe(true);
    if (!("stateSync" in r)) return;
    expect(r.stateSync.fen).toBe(fenAntes);
    expect(r.stateSync.historial).toEqual(["e4"]);
    expect(r.stateSync.turno).toBe("b");
    expect(r.mensajes).toEqual([
      { para: "w", mensaje: { type: "opponent-reconnected" } },
    ]);
    expect(plan.pendientes).toBe(0); // temporizador cancelado
    expect(
      server.obtenerPartida(codigo)?.participantes.find((p) => p.color === "b")
        ?.conectado,
    ).toBe(true);
  });

  it("superar la gracia sin reconectar produce abandono + opponent-abandoned (14.7)", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid } = dosJugadores(server);

    let abandono: Outbound[] | null = null;
    server.marcarDesconexion(codigo, blancoPid, (m) => {
      abandono = m;
    });
    plan.expirarTodos();

    expect(server.obtenerPartida(codigo)?.resultado).toBe("abandono");
    expect(server.obtenerPartida(codigo)?.ganador).toBe("b");
    expect(abandono).toEqual([
      { para: "b", mensaje: { type: "opponent-abandoned" } },
    ]);
  });

  it("no declara abandono si el jugador reconectó antes de expirar la gracia", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const { codigo, blancoPid } = dosJugadores(server);

    let abandono: Outbound[] | null = null;
    server.marcarDesconexion(codigo, blancoPid, (m) => {
      abandono = m;
    });
    server.reconectar(codigo, blancoPid);
    plan.expirarTodos(); // ya no hay temporizador pendiente

    expect(abandono).toBeNull();
    expect(server.obtenerPartida(codigo)?.resultado).toBe("en-curso");
  });

  it("reconectar con código inexistente responde codigo-expirado", () => {
    const plan = planificadorFalso();
    const server = servidorConPlanificador(plan);
    const r = server.reconectar("NADA-NADA-9", "pid-x");
    expect((r as ServerMessage).type === "error" && (r as { code: string }).code).toBe(
      "codigo-expirado",
    );
  });
});

// ---------------------------------------------------------------------------
// Seguridad del servidor (tarea 13.5): validación, rate-limiting, secreto del
// `playerId` y purga.
// Requisitos: 16.1, 16.2, 16.4, 16.5, 16.6, 16.7, 16.8.
// ---------------------------------------------------------------------------

import {
  PURGE_INACTIVE_MS,
  RATE_LIMIT_JOIN_RECONNECT,
  RATE_LIMIT_MOVE_CREATE_JOIN,
  RATE_WINDOW_MS,
  RateLimiter,
} from "./gameServer";

/**
 * `GameServer` con un reloj **controlable** por la prueba (no incremental):
 * `avanzar(ms)` mueve el tiempo y `set(t)` lo fija. Necesario para probar las
 * ventanas deslizantes del rate-limiter y la purga de forma determinista.
 */
function servidorConReloj() {
  let codigoSeq = 0;
  let pidSeq = 0;
  let reloj = 0;
  const server = new GameServer({
    generarCodigo: () => {
      codigoSeq += 1;
      return `MESA-ROSA-${codigoSeq}`;
    },
    generarPlayerId: () => {
      pidSeq += 1;
      return `pid-${pidSeq}`;
    },
    ahora: () => reloj,
  });
  return {
    server,
    avanzar: (ms: number) => {
      reloj += ms;
    },
    set: (t: number) => {
      reloj = t;
    },
    get ahora() {
      return reloj;
    },
  };
}

describe("GameServer.procesarMensaje validación (Req 16.1, 16.2)", () => {
  it("descarta un mensaje malformado con error sin mutar estado", () => {
    const { server } = servidorConReloj();
    const antes = server.numeroDePartidas;

    const r = server.procesarMensaje({ type: "no-existe" }, { connectionId: "c1" });
    expect(r.type).toBe("error");
    if (r.type === "error") expect(r.code).toBe("codigo-invalido");
    expect(server.numeroDePartidas).toBe(antes);
  });

  it("descarta un objeto sin type y valores no-objeto", () => {
    const { server } = servidorConReloj();
    expect(server.procesarMensaje({ codigo: "X" }).type).toBe("error");
    expect(server.procesarMensaje(null).type).toBe("error");
    expect(server.procesarMensaje(42).type).toBe("error");
    expect(server.procesarMensaje("create").type).toBe("error");
  });

  it("acepta un mensaje válido y lo devuelve tipado", () => {
    const { server } = servidorConReloj();
    const r = server.procesarMensaje({ type: "create" }, { connectionId: "c1" });
    expect(r.type).toBe("ok");
    if (r.type === "ok") expect(r.mensaje.type).toBe("create");
  });

  it("rechaza un move con campos faltantes sin procesarlo", () => {
    const { server } = servidorConReloj();
    const r = server.procesarMensaje(
      { type: "move", codigo: "MESA-ROSA-1", from: "e2" },
      { connectionId: "c1" },
    );
    expect(r.type).toBe("error");
  });
});

describe("GameServer rate-limiting (Req 16.6, 16.7)", () => {
  it("limita join/reconnect a 5 por IP cada 10 s (16.6)", () => {
    const clock = servidorConReloj();
    const ctx = { connectionId: "c1", ip: "1.2.3.4" };

    for (let i = 0; i < RATE_LIMIT_JOIN_RECONNECT; i += 1) {
      expect(clock.server.permitirAccion("reconnect", ctx)).toBe(true);
    }
    // La 6.ª dentro de la ventana se rechaza.
    expect(clock.server.permitirAccion("reconnect", ctx)).toBe(false);

    // Tras la ventana deslizante, se vuelve a permitir.
    clock.avanzar(RATE_WINDOW_MS + 1);
    expect(clock.server.permitirAccion("reconnect", ctx)).toBe(true);
  });

  it("limita move a 20 por conexión cada 10 s (16.7)", () => {
    const clock = servidorConReloj();
    const ctx = { connectionId: "c1" };

    for (let i = 0; i < RATE_LIMIT_MOVE_CREATE_JOIN; i += 1) {
      expect(clock.server.permitirAccion("move", ctx)).toBe(true);
    }
    expect(clock.server.permitirAccion("move", ctx)).toBe(false);
  });

  it("un join cuenta en ambas reglas y se frena por la más estricta (16.6)", () => {
    const clock = servidorConReloj();
    const ctx = { connectionId: "c1", ip: "9.9.9.9" };

    // Los 5 primeros join están dentro de ambos límites.
    for (let i = 0; i < RATE_LIMIT_JOIN_RECONNECT; i += 1) {
      expect(clock.server.permitirAccion("join", ctx)).toBe(true);
    }
    // El 6.º join se frena por el límite de join/reconnect (5), aun sin llegar
    // al de move/create/join (20).
    expect(clock.server.permitirAccion("join", ctx)).toBe(false);
  });

  it("procesarMensaje rechaza con no-autorizado al exceder el límite", () => {
    const clock = servidorConReloj();
    const ctx = { connectionId: "c1" };
    for (let i = 0; i < RATE_LIMIT_MOVE_CREATE_JOIN; i += 1) {
      expect(
        clock.server.procesarMensaje(
          { type: "move", codigo: "MESA-ROSA-1", from: "e2", to: "e4" },
          ctx,
        ).type,
      ).toBe("ok");
    }
    const r = clock.server.procesarMensaje(
      { type: "move", codigo: "MESA-ROSA-1", from: "e2", to: "e4" },
      ctx,
    );
    expect(r.type).toBe("error");
    if (r.type === "error") expect(r.code).toBe("no-autorizado");
  });

  it("RateLimiter es determinista con reloj inyectado", () => {
    let t = 0;
    const rl = new RateLimiter(() => t, 10_000);
    const ctx = { connectionId: "x" };
    for (let i = 0; i < RATE_LIMIT_MOVE_CREATE_JOIN; i += 1) {
      expect(rl.permitir("move", ctx)).toBe(true);
    }
    expect(rl.permitir("move", ctx)).toBe(false);
    t += 10_001;
    expect(rl.permitir("move", ctx)).toBe(true);
  });
});

describe("GameServer secreto del playerId (Req 16.5)", () => {
  it("vistaPublicaParticipante elimina el playerId", () => {
    const { server } = servidorConReloj();
    const game = server.crearPartida();
    const publico = server.vistaPublicaParticipante(game.participantes[0]);
    expect("playerId" in publico).toBe(false);
    expect(publico.color).toBe("w");
    expect(publico.conectado).toBe(true);
  });

  it("assertSinPlayerIdParaRival lanza si el mensaje lleva playerId", () => {
    const { server } = servidorConReloj();
    // Mensaje seguro para el rival: no lleva playerId.
    expect(() =>
      server.assertSinPlayerIdParaRival({ type: "opponent-joined" }),
    ).not.toThrow();
    // Mensaje que lleva playerId (created/joined): no debe difundirse al rival.
    expect(() =>
      server.assertSinPlayerIdParaRival({
        type: "joined",
        playerId: "pid-1",
        color: "b",
        fen: STARTING_FEN,
        historial: [],
      }),
    ).toThrow();
  });
});

describe("GameServer.purgar (Req 16.8)", () => {
  it("purga una partida finalizada de inmediato e invalida su código", () => {
    const clock = servidorConReloj();
    const creada = clock.server.crearPartida();
    const game = clock.server.obtenerPartida(creada.codigo);
    if (game) game.resultado = "jaque-mate";

    const n = clock.server.purgar();
    expect(n).toBe(1);
    expect(clock.server.obtenerPartida(creada.codigo)).toBeUndefined();
    expect(clock.server.numeroDePartidas).toBe(0);
  });

  it("purga una partida inactiva 30+ min y conserva las activas recientes", () => {
    const clock = servidorConReloj();
    const vieja = clock.server.crearPartida(); // creada en t=0
    clock.avanzar(PURGE_INACTIVE_MS + 1);
    const nueva = clock.server.crearPartida(); // creada justo ahora

    const n = clock.server.purgar();
    expect(n).toBe(1);
    expect(clock.server.obtenerPartida(vieja.codigo)).toBeUndefined();
    expect(clock.server.obtenerPartida(nueva.codigo)?.codigo).toBe(nueva.codigo);
  });

  it("no purga una partida en curso con actividad reciente", () => {
    const clock = servidorConReloj();
    const creada = clock.server.crearPartida();
    clock.avanzar(PURGE_INACTIVE_MS - 1);
    expect(clock.server.purgar()).toBe(0);
    expect(clock.server.obtenerPartida(creada.codigo)?.codigo).toBe(
      creada.codigo,
    );
  });

  it("acepta un `ahora` explícito para pruebas deterministas", () => {
    const clock = servidorConReloj();
    const creada = clock.server.crearPartida(); // t=0
    // Con un `ahora` explícito muy posterior, la partida es inactiva.
    expect(clock.server.purgar(PURGE_INACTIVE_MS + 100)).toBe(1);
    expect(clock.server.obtenerPartida(creada.codigo)).toBeUndefined();
  });
});
