"use client";

/**
 * `OnlineControls`: acciones accesibles de la partida en línea.
 *
 * Ofrece botones con `aria-label` claros en español, activables por teclado
 * (son elementos `<button>` nativos, por lo que responden a Enter/Espacio y
 * reciben foco de forma natural):
 * - Rendirse.
 * - Ofrecer tablas.
 * - Cuando el rival ofrece tablas (`ofertaTablasPendiente === "rival"`),
 *   aparecen Aceptar tablas y Rechazar tablas, y la oferta entrante se anuncia
 *   por una región `aria-live="assertive"` para que el lector la comunique de
 *   inmediato.
 *
 * Las acciones se deshabilitan cuando la partida ya no está en curso
 * (`resultado !== "en-curso"`).
 *
 * Requisitos: 13.5 (oferta del rival por aria-live assertive), 12.5 (aceptar/
 * rechazar tablas por teclado), 15.6 (controles legibles y accesibles).
 */

import type { OnlineGameState } from "@/lib/onlineProtocol";

export type OnlineControlsProps = {
  state: OnlineGameState;
  onRendirse: () => void;
  onOfrecerTablas: () => void;
  onAceptarTablas: () => void;
  onRechazarTablas: () => void;
};

export function OnlineControls(props: OnlineControlsProps): React.JSX.Element {
  const { state, onRendirse, onOfrecerTablas, onAceptarTablas, onRechazarTablas } =
    props;

  // La partida sólo admite acciones mientras está en curso.
  const enCurso = state.resultado === "en-curso";
  // ¿Hay una oferta de tablas del rival esperando respuesta?
  const ofertaDelRival = state.ofertaTablasPendiente === "rival";
  // ¿Ya ofrecimos nosotros tablas y esperamos respuesta?
  const ofertaPropiaPendiente = state.ofertaTablasPendiente === "yo";

  return (
    <section
      className="once-controls flex flex-col gap-3"
      aria-labelledby="once-controls-titulo"
    >
      <h2 id="once-controls-titulo" className="text-lg font-semibold">
        Acciones de la partida
      </h2>

      {/*
        Región assertive: cuando el rival ofrece tablas, el lector de pantalla
        lo comunica de inmediato interrumpiendo la lectura en curso (Req 13.5).
      */}
      <p className="sr-only" aria-live="assertive" aria-atomic="true">
        {ofertaDelRival
          ? "El rival ofrece tablas. Puedes aceptar o rechazar."
          : ""}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="once-btn"
          aria-label="Rendirse y conceder la partida al rival"
          disabled={!enCurso}
          onClick={onRendirse}
        >
          Rendirse
        </button>

        <button
          type="button"
          className="once-btn"
          aria-label="Ofrecer tablas al rival"
          disabled={!enCurso || ofertaPropiaPendiente || ofertaDelRival}
          onClick={onOfrecerTablas}
        >
          Ofrecer tablas
        </button>
      </div>

      {ofertaPropiaPendiente && (
        <p>Has ofrecido tablas. Esperando la respuesta del rival.</p>
      )}

      {ofertaDelRival && (
        <div
          className="once-oferta-tablas flex flex-col gap-2"
          role="group"
          aria-label="El rival ofrece tablas"
        >
          <p aria-hidden="true">El rival ofrece tablas.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="once-btn once-btn-primary"
              aria-label="Aceptar la oferta de tablas del rival"
              disabled={!enCurso}
              onClick={onAceptarTablas}
            >
              Aceptar tablas
            </button>
            <button
              type="button"
              className="once-btn"
              aria-label="Rechazar la oferta de tablas del rival"
              disabled={!enCurso}
              onClick={onRechazarTablas}
            >
              Rechazar tablas
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
