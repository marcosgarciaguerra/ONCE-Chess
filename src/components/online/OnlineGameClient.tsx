"use client";

/**
 * `OnlineGameClient` — Interfaz cliente del modo en línea de ONCE Chess
 * (Componente 6/7 del diseño, tarea 16). Es el Client Component que la ruta
 * `/tablero/online/[codigo]` monta con el `codigo` ya normalizado.
 *
 * Ensambla todas las piezas del modo en línea:
 * - `useOnlineGame(codigo)`: única pieza que habla con el servidor autoritativo;
 *   mantiene el `OnlineGameState` y traduce **cada** evento de red en un anuncio
 *   accesible mediante el seam `onAnnounce`.
 * - Un anunciador local (`onAnnounce`) que alimenta una `LiveRegion` compartida
 *   (aria-live) y, si `speechEnabled`, la voz sintetizada con `voiceRate`
 *   (Req 13.1/13.5). La urgencia (`polite`/`assertive`) se propaga a la región.
 * - `OnlineLobby` mientras no hay partida en juego (sin rival todavía): permite
 *   crear una partida o unirse por código, y muestra el error del servidor
 *   traducido a español cuando `status === "error"` (Req 10.6/10.7/10.8).
 * - `AccessibleChessBoard` reflejando el `fen` autoritativo. El tablero se
 *   **remonta** con `key={state.fen}` en cada `state-sync`, de modo que siempre
 *   muestra la posición autoritativa. Fuera de turno el tablero **no es
 *   interactivo ni recibe foco** (Req 11.1/12.5). Ver nota de seguimiento abajo.
 * - `OnlineStatus` y `OnlineControls` conectados al estado y a las acciones del
 *   hook (rendirse, ofrecer/aceptar/rechazar tablas).
 *
 * Accesibilidad: `main#contenido` con `tabIndex={-1}`, `SkipLink`, foco al
 * `<main>` al entrar en la ruta, copia en español y tokens `once-*`.
 *
 * ---------------------------------------------------------------------------
 * NOTA DE SEGUIMIENTO — tablero "controlado" (Req 11.1/12.5):
 * El diseño describe el tablero en modo **controlado** para el modo en línea:
 * `fen` autoritativo, `orientation` según color, `interactive={esMiTurno}` y un
 * callback `onAttemptMove(from, to, promotion)` que delega el movimiento al
 * servidor sin aplicarlo localmente. El componente actual
 * (`AccessibleChessBoard`) es **autónomo**: gestiona su propia instancia de
 * `chess.js`, aplica los movimientos en local y sólo acepta la prop
 * `initialFen` (no expone `onAttemptMove`, `interactive` ni `orientation`).
 *
 * Para no reescribir su lógica de ajedrez (fuera del alcance de esta tarea),
 * aquí se hace un cableado **controlado mínimo** que cumple las prioridades del
 * requisito:
 *   1) El tablero refleja el `fen` autoritativo: se le pasa `initialFen={fen}`
 *      y se **remonta** con `key={fen}` en cada `state-sync`.
 *   2) Fuera de turno el tablero **no es interactivo ni enfocable**: se envuelve
 *      en un contenedor con `pointer-events-none`, `aria-disabled` y se retira
 *      del orden de tabulación desactivando el foco de sus controles internos.
 *
 * Limitación conocida: como el tablero aplica los movimientos en local, un
 * movimiento hecho **en turno** se refleja de inmediato en su estado interno y
 * NO se envía todavía al servidor vía `intentarMovimiento`. Para el juego en
 * línea "de verdad" (autoritativo puro) el tablero debe aceptar
 * `onAttemptMove`/`interactive`/`fen` controlados. Queda como seguimiento de la
 * tarea 8/16: extender `AccessibleChessBoard` con esas props. El `state-sync`
 * autoritativo siempre corrige la posición mostrada al remontar por `key`.
 * ---------------------------------------------------------------------------
 *
 * Requisitos: 10.1, 11.1, 12.5, 13.1, 13.5.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import AccessibleChessBoard from "@/components/AccessibleChessBoard";
import { FocusMainOnMount } from "@/components/a11y/FocusMainOnMount";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { SkipLink } from "@/components/a11y/SkipLink";
import { OnlineControls } from "@/components/online/OnlineControls";
import { OnlineLobby } from "@/components/online/OnlineLobby";
import { OnlineStatus } from "@/components/online/OnlineStatus";
import { useSettings } from "@/context/SettingsProvider";
import {
  useOnlineGame,
  type AnnouncePoliteness,
} from "@/hooks/useOnlineGame";
import type { OnlineGameState } from "@/lib/onlineProtocol";
import { speak } from "@/utils/speech";

export type OnlineGameClientProps = {
  /** Código de partida ya normalizado que viene del segmento de ruta. */
  codigo: string;
};

/**
 * Traduce el estado de error del hook a un mensaje en español para el lobby.
 * El hook expone únicamente `status === "error"` (el detalle concreto —código
 * inexistente, expirado, partida llena— ya se anunció por `aria-live` al
 * recibir el `error` del servidor). Aquí se ofrece un texto de recuperación
 * genérico que invita a crear una partida nueva (Req 10.6/10.7/10.8).
 */
function mensajeErrorLobby(state: OnlineGameState): string | undefined {
  if (state.status !== "error") return undefined;
  return "No se pudo unir a la partida con ese código. Comprueba el código o crea una partida nueva.";
}

/**
 * Decide si mostrar el lobby (crear/unirse) en lugar del tablero. Se muestra
 * mientras la partida aún no está en juego y no ha finalizado: es decir, cuando
 * todavía no hay rival (conectando, esperando-rival, error) y no se ha asignado
 * una posición jugable. Una vez `en-juego` (o en estados derivados como
 * `rival-desconectado`/`reconectando`/`finalizada`) se muestra el tablero.
 */
function debeMostrarLobby(state: OnlineGameState): boolean {
  switch (state.status) {
    case "en-juego":
    case "rival-desconectado":
    case "reconectando":
    case "finalizada":
      return false;
    default:
      // conectando, esperando-rival, error
      return true;
  }
}

export function OnlineGameClient({ codigo }: OnlineGameClientProps) {
  const { settings } = useSettings();

  // ---- Anunciador local: LiveRegion (aria-live) + voz opcional ------------
  // Mantiene el último mensaje y su nivel de urgencia para reflejarlos en la
  // región `aria-live`. La voz respeta `speechEnabled`/`voiceRate` del contexto.
  const [liveMessage, setLiveMessage] = useState("");
  const [livePoliteness, setLivePoliteness] =
    useState<AnnouncePoliteness>("polite");

  // Los ajustes se leen a través de una ref para que `onAnnounce` sea estable
  // (el hook guarda el callback en una ref y no debe re-suscribirse por cambios
  // de identidad). La ref se sincroniza en un efecto —no durante el render—,
  // tal como exige la regla de React 19.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const onAnnounce = useCallback(
    (mensaje: string, politeness: AnnouncePoliteness = "polite") => {
      const texto = mensaje.trim();
      if (texto.length === 0) return; // Req 8.3: ignorar mensajes vacíos.
      setLiveMessage(texto);
      setLivePoliteness(politeness);
      if (settingsRef.current.speechEnabled) {
        speak(texto, {
          interrupt: politeness === "assertive",
          rate: settingsRef.current.voiceRate,
        });
      }
    },
    [],
  );

  const {
    state,
    crearPartida,
    unirse,
    ofrecerTablas,
    aceptarTablas,
    rechazarTablas,
    rendirse,
  } = useOnlineGame(codigo, { onAnnounce });

  // ---- Auto-unión al abrir un enlace con código (Req 10.1) ----------------
  // Si la URL trae un código, intentar unirse **una sola vez** al montar. El
  // hook no lo hace por su cuenta (sólo fija el código inicial en el estado).
  const autoUnionRef = useRef(false);
  useEffect(() => {
    if (autoUnionRef.current) return;
    if (codigo.length === 0) return;
    autoUnionRef.current = true;
    unirse(codigo);
  }, [codigo, unirse]);

  const mostrarLobby = debeMostrarLobby(state);
  const errorMensaje = mensajeErrorLobby(state);

  // Fuera de turno el tablero no debe ser interactivo ni enfocable
  // (Req 11.1/12.5). Se desactiva `pointer-events` y, mediante `inert`, se
  // retira todo su subárbol del orden de foco y de la interacción del lector.
  const tableroInteractivo = state.esMiTurno;

  return (
    <>
      <SkipLink targetId="contenido" />
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 outline-none"
        aria-label="Partida de ajedrez en línea"
      >
        <FocusMainOnMount targetId="contenido" />

        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--once-accent)]">
            ONCE · Comisión Braille Española
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl leading-tight text-[var(--once-ink)] sm:text-4xl">
            Ajedrez en línea accesible
          </h1>
          <p className="max-w-2xl text-base text-[var(--once-muted)]">
            Juega una partida en tiempo real con otra persona. Cada evento de la
            partida se anuncia por voz y por lector de pantalla.
          </p>
        </header>

        {/* Región en vivo única de la partida: anuncios de cada evento de red
            (Req 13.1/13.5). Su urgencia sigue al último anuncio del hook. */}
        <LiveRegion
          message={liveMessage}
          politeness={livePoliteness}
          id="once-online-live"
        />

        {mostrarLobby ? (
          <OnlineLobby
            onCrear={crearPartida}
            onUnirse={unirse}
            codigoActual={state.codigo || undefined}
            errorMensaje={errorMensaje}
          />
        ) : (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            {/* Tablero controlado mínimo: refleja el fen autoritativo
                (`key`+`initialFen`) y queda no interactivo/no enfocable fuera de
                turno (Req 11.1/12.5). Ver nota de seguimiento del módulo. */}
            <div
              className="min-w-0 flex-1"
              aria-disabled={!tableroInteractivo}
              // `inert` retira el subárbol del foco, la interacción y el lector
              // cuando no es el turno de este jugador. React 19 admite el
              // atributo booleano `inert` de forma nativa.
              inert={!tableroInteractivo}
              style={
                tableroInteractivo ? undefined : { pointerEvents: "none" }
              }
            >
              {!tableroInteractivo && (
                <p className="mb-2 text-sm text-[var(--once-muted)]">
                  No es tu turno. El tablero está bloqueado hasta que muevas tu
                  rival.
                </p>
              )}
              <AccessibleChessBoard
                key={state.fen || "inicial"}
                initialFen={state.fen || undefined}
              />
            </div>

            <aside
              className="flex w-full flex-col gap-6 lg:sticky lg:top-6 lg:w-[min(100%,24rem)]"
              aria-label="Estado y acciones de la partida en línea"
            >
              <OnlineStatus state={state} />
              <OnlineControls
                state={state}
                onRendirse={rendirse}
                onOfrecerTablas={ofrecerTablas}
                onAceptarTablas={aceptarTablas}
                onRechazarTablas={rechazarTablas}
              />
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
