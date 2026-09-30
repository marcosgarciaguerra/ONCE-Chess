/**
 * `OnlineStatus`: superficie textual y accesible del estado de red de una
 * partida en línea.
 *
 * Refleja de forma **legible por lector de pantalla** (texto, no sólo color):
 * - de quién es el turno (por palabras: "Es tu turno" / "Turno del rival"),
 * - el estado de la conexión/partida (conectando, esperando rival, en juego,
 *   rival desconectado, reconectando, finalizada, error) en español,
 * - y, si está activo, el reloj de cada jugador en minutos y segundos.
 *
 * Es un componente **presentacional** (sin interactividad), por lo que no
 * necesita ejecutarse en el cliente de forma exclusiva; sin embargo se marca
 * como Server/Client-agnóstico y no usa hooks del navegador.
 *
 * Requisitos: 13.4 (turno por palabras), 13.7 (estado por texto, no color),
 * 15.6 (estado de conexión legible).
 */

import type { OnlineGameState } from "@/lib/onlineProtocol";

export type OnlineStatusProps = { state: OnlineGameState };

/**
 * Traduce el `status` de conexión a una frase en español legible por lector,
 * sin depender del color.
 */
function describirConexion(state: OnlineGameState): string {
  switch (state.status) {
    case "conectando":
      return "Conectando con el servidor…";
    case "esperando-rival":
      return "Esperando a que se una el rival.";
    case "en-juego":
      return "Partida en juego.";
    case "rival-desconectado":
      return "El rival se ha desconectado.";
    case "reconectando":
      return "Reconectando con el servidor…";
    case "finalizada":
      return "La partida ha finalizado.";
    case "error":
      return "Se ha producido un error de conexión.";
    default:
      return "Estado de conexión desconocido.";
  }
}

/**
 * Describe de quién es el turno por palabras (no sólo por color).
 * Si la partida ha terminado, no hay turno activo.
 */
function describirTurno(state: OnlineGameState): string {
  if (state.resultado !== "en-curso") {
    return "La partida no está en curso.";
  }
  const colorTurno = state.turno === "w" ? "blancas" : "negras";
  if (state.color === null) {
    return `Turno de las ${colorTurno}.`;
  }
  return state.esMiTurno
    ? `Es tu turno (${colorTurno}).`
    : `Turno del rival (${colorTurno}).`;
}

/** Describe el resultado de la partida en español legible. */
function describirResultado(state: OnlineGameState): string | null {
  switch (state.resultado) {
    case "en-curso":
      return state.jaque ? "Estás en jaque." : null;
    case "jaque-mate": {
      const ganador = state.ganador === "w" ? "blancas" : "negras";
      return `Jaque mate. Ganan las ${ganador}.`;
    }
    case "tablas":
      return "La partida ha terminado en tablas.";
    case "rendicion": {
      const ganador = state.ganador === "w" ? "blancas" : "negras";
      return `Rendición. Ganan las ${ganador}.`;
    }
    case "abandono": {
      const ganador = state.ganador === "w" ? "blancas" : "negras";
      return `Abandono. Ganan las ${ganador}.`;
    }
    default:
      return null;
  }
}

/**
 * Formatea milisegundos como "MM:SS" para lectura de reloj. Nunca negativo.
 */
function formatearReloj(ms: number): string {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  const mm = String(minutos).padStart(2, "0");
  const ss = String(segundos).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function OnlineStatus(props: OnlineStatusProps): React.JSX.Element {
  const { state } = props;

  const conexion = describirConexion(state);
  const turno = describirTurno(state);
  const resultado = describirResultado(state);

  const miColor = state.color;
  const etiquetaBlancas =
    miColor === "w" ? "Blancas (tú)" : "Blancas (rival)";
  const etiquetaNegras =
    miColor === "b" ? "Negras (tú)" : "Negras (rival)";

  return (
    <section
      className="once-status flex flex-col gap-2"
      aria-labelledby="once-status-titulo"
    >
      <h2 id="once-status-titulo" className="once-display text-lg font-semibold text-[var(--once-ink)]">
        Estado de la partida
      </h2>

      {/* Código de partida legible */}
      <p>
        <span className="font-medium">Código:</span>{" "}
        <span>{state.codigo}</span>
      </p>

      {/* Estado de conexión en texto (no sólo color) */}
      <p>
        <span className="font-medium">Conexión:</span> <span>{conexion}</span>
      </p>

      {/* Turno por palabras */}
      <p>
        <span className="font-medium">Turno:</span> <span>{turno}</span>
      </p>

      {/* Resultado / jaque cuando aplica */}
      {resultado !== null && (
        <p>
          <span className="font-medium">Situación:</span>{" "}
          <span>{resultado}</span>
        </p>
      )}

      {/* Reloj opcional por jugador, en texto legible */}
      {state.relojMs !== undefined && (
        <dl className="once-reloj flex flex-col gap-1">
          <div className="flex gap-2">
            <dt className="font-medium">{etiquetaBlancas}:</dt>
            <dd>
              <span className="sr-only">Tiempo restante </span>
              {formatearReloj(state.relojMs.w)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">{etiquetaNegras}:</dt>
            <dd>
              <span className="sr-only">Tiempo restante </span>
              {formatearReloj(state.relojMs.b)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
