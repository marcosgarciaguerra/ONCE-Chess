/**
 * Prueba de propiedad de reconexión exacta del núcleo autoritativo
 * `GameServer` (tarea 13.6).
 *
 * **Property 13: La reconexión restaura el estado exacto** — tras `N` medios
 * movimientos legales, la caída de un jugador (`marcarDesconexion`) y su
 * posterior `reconectar`, el `state-sync` devuelto reproduce el `fen` idéntico
 * carácter a carácter y un `historial` de longitud `N` (idéntico al histórico
 * autoritativo capturado antes de la caída). Además, la reconexión cancela el
 * temporizador de gracia pendiente (el planificador falso queda sin tareas).
 *
 * **Validates: Requisito 14.6**
 *
 * Se usa un `GameServer` **determinista** con un **planificador falso**
 * inyectado (los mismos ayudantes conceptuales que la suite principal:
 * `planificadorFalso`, `servidorConPlanificador`, `dosJugadores`), de modo que
 * ningún temporizador real se dispara y la prueba es reproducible. Los
 * movimientos se generan legales alternando por turno mediante `chess.js`
 * (`.moves()`), reflejando el mismo motor autoritativo del servidor.
 */

import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { GameServer } from "./gameServer";
import type { ServerMessage } from "@/lib/onlineProtocol";

/** Discrimina un `ServerMessage` de error de cualquier otro resultado. */
function esError(r: unknown): r is Extract<ServerMessage, { type: "error" }> {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as { type?: string }).type === "error"
  );
}

/**
 * Planificador determinista: registra los `callback` programados y permite
 * inspeccionar cuántos siguen pendientes sin esperar tiempo real. No es
 * necesario dispararlos en esta prueba (la reconexión debe cancelarlos antes).
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
    /** Número de temporizadores actualmente pendientes. */
    get pendientes() {
      return tareas.size;
    },
  };
}

/** `GameServer` determinista con el planificador falso inyectado. */
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

/** Crea una partida con dos jugadores unidos y devuelve código y `playerId`. */
function dosJugadores(server: GameServer) {
  const creada = server.crearPartida();
  const blancoPid = creada.participantes[0].playerId;
  const res = server.unirse(creada.codigo);
  if (esError(res)) throw new Error("unión inesperadamente fallida");
  return { codigo: creada.codigo, blancoPid, negroPid: res.playerId };
}

/**
 * Reproduce en el servidor una secuencia de `N` medios movimientos legales,
 * eligiendo en cada turno un movimiento legal según el motor autoritativo. El
 * `selector` (0..) elige de forma determinista qué movimiento legal aplicar a
 * partir del generador de fast-check. Se detiene antes de `N` si la posición
 * queda sin movimientos legales (jaque mate o tablas), devolviendo el número
 * de medios movimientos realmente aplicados.
 */
function jugarMovimientos(
  server: GameServer,
  codigo: string,
  blancoPid: string,
  negroPid: string,
  selectores: number[],
): number {
  const motor = server.obtenerMotor(codigo);
  if (!motor) throw new Error("sin motor");

  let aplicados = 0;
  for (const selector of selectores) {
    const legales = motor.moves({ verbose: true });
    if (legales.length === 0) break; // fin de la partida: no hay más jugadas

    const elegido = legales[selector % legales.length];
    // El turno autoritativo determina qué jugador tiene permiso de mover.
    const pidTurno = (motor.turn() as string) === "w" ? blancoPid : negroPid;

    const r = server.aplicarMovimiento(
      codigo,
      pidTurno,
      elegido.from,
      elegido.to,
      elegido.promotion,
    );
    // Un movimiento legal en turno debe devolver siempre `state-sync`.
    expect(r.type).toBe("state-sync");
    aplicados += 1;

    // Si el movimiento finalizó la partida, dejamos de mover.
    if (r.type === "state-sync" && r.resultado !== "en-curso") break;
  }
  return aplicados;
}

describe("GameServer.reconectar — Property 13 (Req 14.6)", () => {
  it("la reconexión restaura el fen idéntico y el historial de longitud N tras la caída", () => {
    fc.assert(
      fc.property(
        // N medios movimientos (0..20) y un selector de jugada legal por medio movimiento.
        fc.array(fc.nat({ max: 1_000 }), { minLength: 0, maxLength: 20 }),
        // Qué jugador (blancas/negras) sufre la caída y reconecta.
        fc.boolean(),
        (selectores, caeBlancas) => {
          const plan = planificadorFalso();
          const server = servidorConPlanificador(plan);
          const { codigo, blancoPid, negroPid } = dosJugadores(server);

          // Reproducir N medios movimientos legales (puede terminar antes si la
          // partida se resuelve). N efectivo = número realmente aplicado.
          const n = jugarMovimientos(
            server,
            codigo,
            blancoPid,
            negroPid,
            selectores,
          );

          // Estado autoritativo capturado ANTES de la caída (copia defensiva
          // del historial, que el servidor comparte por referencia).
          const game = server.obtenerPartida(codigo);
          expect(game).toBeDefined();
          if (!game) return;
          const fenCapturado = game.fen;
          const historialCapturado = [...game.historial];
          expect(historialCapturado.length).toBe(n);
          // El fen capturado es una posición legal alcanzable.
          expect(() => new Chess(fenCapturado)).not.toThrow();

          const pidCaido = caeBlancas ? blancoPid : negroPid;

          // El jugador cae: se inicia el periodo de gracia (un temporizador).
          const desc = server.marcarDesconexion(codigo, pidCaido);
          expect(esError(desc)).toBe(false);
          expect(plan.pendientes).toBe(1);

          // El mismo jugador reconecta: state-sync exacto + cancelación de la
          // gracia (temporizador cancelado, sin abandono).
          const rec = server.reconectar(codigo, pidCaido);
          expect("stateSync" in rec).toBe(true);
          if (!("stateSync" in rec)) return;

          // fen idéntico carácter a carácter (Req 14.6).
          expect(rec.stateSync.fen).toBe(fenCapturado);
          // historial de longitud N e idéntico al capturado.
          expect(rec.stateSync.historial.length).toBe(n);
          expect(rec.stateSync.historial).toEqual(historialCapturado);

          // El temporizador de gracia fue cancelado por la reconexión.
          expect(plan.pendientes).toBe(0);
          // La partida no se declaró abandonada.
          expect(server.obtenerPartida(codigo)?.resultado).not.toBe(
            "abandono",
          );
        },
      ),
    );
  });
});
