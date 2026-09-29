"use client";

/**
 * Hook cliente del modo en línea de ONCE Chess (`useOnlineGame`).
 *
 * Encapsula el ciclo de vida de la conexión con el servidor autoritativo, el
 * **estado autoritativo** recibido y el envío de acciones del jugador. Es la
 * única pieza cliente que habla con el servidor (Componente 7 del diseño).
 *
 * Principio rector — **el cliente NUNCA es autoridad**:
 * - `intentarMovimiento` envía un mensaje `move` y **no aplica** nada
 *   localmente. El `OnlineGameState` sólo cambia cuando llega un `state-sync`
 *   autoritativo (Req 11.1, 11.3).
 * - Si tras enviar un `move` no llega ningún `state-sync` que lo confirme en
 *   `MOVE_CONFIRM_TIMEOUT_MS` (5 s), se descarta el movimiento pendiente, se
 *   restaura el último estado autoritativo conocido y se emite un anuncio por
 *   el seam `onAnnounce` (Req 11.7).
 * - `OnlineGameState` se sincroniza **sólo** con `state-sync`; el resto de
 *   mensajes ajustan campos de conexión/oferta pero nunca el `fen`/`turno`
 *   autoritativos.
 *
 * Alcance de esta implementación (tarea 14.1):
 * - Abrir/mantener el socket (socket.io-client) y exponer `status`.
 * - Acciones: `crearPartida`, `unirse`, `intentarMovimiento`, `ofrecerTablas`,
 *   `aceptarTablas`, `rechazarTablas`, `rendirse`, `reconectar`.
 * - Mantener el estado autoritativo sincronizado con `state-sync`.
 * - Persistir `{ codigo, playerId }` en `once-chess.last-online-game.v1`.
 *
 * Fuera de alcance (tarea 14.2): el **backoff exponencial** de reconexión y la
 * traducción detallada de **cada** evento en anuncios accesibles. Esta tarea
 * deja los *seams* preparados: un callback `onAnnounce(mensaje, politeness)`
 * que 14.2 puede rellenar con la lógica completa, y `status` expuesto en el
 * estado para que la interfaz reaccione. Aquí sólo se emiten anuncios mínimos
 * (p. ej. el descarte del movimiento no confirmado, Req 11.7).
 *
 * Capa de transporte inyectable: el hook no importa `io` directamente en su
 * lógica, sino que acepta un `socketFactory` opcional (`UseOnlineGameOptions`).
 * Por defecto usa `socket.io-client`. Esto permite a las tareas 14.3
 * (consistencia entre dos clientes) y a las pruebas unitarias inyectar un
 * socket falso en memoria sin red real.
 *
 * Convención de canal (coherente con el protocolo de uniones discriminadas):
 * el cliente **emite** un evento `"message"` con un `ClientMessage` y
 * **escucha** el evento `"message"` con un `ServerMessage`. La capa servidor
 * (Socket.IO) reenvía cada `ServerMessage` por el mismo canal.
 *
 * Referencias de requisitos: 11.1, 11.3, 11.7, 12.5, 14.8.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { STORAGE_KEYS } from "@/lib/storage";
import type {
  ClientMessage,
  Color,
  ErrorCode,
  MoveRejectedReason,
  OnlineGameState,
  OnlineStatus,
  ServerMessage,
} from "@/lib/onlineProtocol";

// ---------------------------------------------------------------------------
// Seam de transporte inyectable (mockeable para 14.3 y pruebas)
// ---------------------------------------------------------------------------

/**
 * Superficie mínima de un socket que el hook necesita. Es un subconjunto de la
 * API de `socket.io-client` (`Socket`), definido aquí para que la capa de
 * transporte sea **inyectable/mockeable** sin depender del tipo real de la
 * librería. Un socket falso en memoria que implemente estos métodos basta para
 * las pruebas unitarias y la simulación de dos clientes (tarea 14.3).
 */
export type OnlineSocket = {
  /** Emite un evento con datos al servidor. */
  emit(event: string, ...args: unknown[]): unknown;
  /** Suscribe un manejador a un evento entrante. */
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  /** Cancela la suscripción de un manejador (o de todos si se omite). */
  off(event: string, handler?: (...args: unknown[]) => void): unknown;
  /** Cierra la conexión y libera recursos. */
  disconnect(): unknown;
  /** Fuerza (re)conexión; opcional en implementaciones mínimas. */
  connect?(): unknown;
  /** Estado de conexión, si la implementación lo expone. */
  connected?: boolean;
};

/**
 * Fábrica de sockets. Recibe la URL del servidor (o `undefined` para el origen
 * por defecto) y devuelve un `OnlineSocket`. Por defecto el hook usa una
 * fábrica basada en `socket.io-client`.
 */
export type SocketFactory = (url?: string) => OnlineSocket;

/**
 * Nivel de urgencia de un anuncio accesible, alineado con `aria-live`. La
 * lógica detallada de anuncios vive en la tarea 14.2; aquí sólo se define el
 * contrato del seam.
 */
export type AnnouncePoliteness = "polite" | "assertive";

/**
 * Opciones del hook. Todas opcionales para no romper la firma pública
 * (`useOnlineGame(initialCodigo?)`).
 */
export type UseOnlineGameOptions = {
  /** URL del servidor de sockets (por defecto, el origen actual). */
  url?: string;
  /**
   * Fábrica de sockets inyectable. Por defecto usa `socket.io-client`. Las
   * pruebas y la tarea 14.3 inyectan un socket falso aquí.
   */
  socketFactory?: SocketFactory;
  /**
   * Seam de anuncios accesibles. La tarea 14.2 conectará aquí `useAnnouncer`
   * (aria-live + voz). En 14.1 sólo se invoca para anuncios mínimos como el
   * descarte de un movimiento no confirmado (Req 11.7).
   */
  onAnnounce?: (mensaje: string, politeness?: AnnouncePoliteness) => void;
  /**
   * Si el hook debe conectar automáticamente al montar. Por defecto `true`.
   * Las pruebas pueden desactivarlo para controlar el ciclo de vida.
   */
  autoConnect?: boolean;
};

// ---------------------------------------------------------------------------
// Persistencia de la última partida en línea (Req 14.8)
// ---------------------------------------------------------------------------

/**
 * Forma persistida en `once-chess.last-online-game.v1`. Guarda lo mínimo para
 * reanudar una partida: el `codigo` y el `playerId` secreto de este cliente.
 */
export type LastOnlineGame = {
  codigo: string;
  playerId: string;
};

/** Indica si hay `localStorage` disponible (evita accesos en SSR). */
function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  );
}

/**
 * Persiste `{ codigo, playerId }` de la partida actual. Nunca lanza: en
 * servidor o ante cualquier error de escritura no hace nada (Req 14.8).
 *
 * Se usa `window.localStorage` directamente con la clave versionada importada
 * de `storage.ts` para no acoplar esta persistencia efímera al esquema de
 * `readJson`/`writeJson` (y no editar `storage.ts` de forma concurrente).
 */
function persistLastOnlineGame(data: LastOnlineGame): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEYS.lastOnlineGame,
      JSON.stringify(data),
    );
  } catch {
    // Silencioso por diseño: la persistencia no debe romper la interfaz.
  }
}

/**
 * Lee `{ codigo, playerId }` persistidos, o `null` si no hay, el JSON es
 * inválido o la forma no encaja. Nunca lanza.
 */
export function readLastOnlineGame(): LastOnlineGame | null {
  if (!isBrowser()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEYS.lastOnlineGame);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).codigo === "string" &&
      typeof (parsed as Record<string, unknown>).playerId === "string"
    ) {
      const p = parsed as Record<string, string>;
      return { codigo: p.codigo, playerId: p.playerId };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Estado inicial y utilidades puras
// ---------------------------------------------------------------------------

/** Tiempo (ms) que se espera un `state-sync` que confirme un `move` (Req 11.7). */
export const MOVE_CONFIRM_TIMEOUT_MS = 5_000;

/** Nombre del evento del canal Socket.IO por el que viajan los mensajes. */
export const MESSAGE_EVENT = "message";

// ---------------------------------------------------------------------------
// Constantes de reconexión con backoff exponencial (Req 14.1, 14.2)
// ---------------------------------------------------------------------------

/** Retardo base del primer reintento de reconexión (Req 14.1). */
export const RECONNECT_BASE_DELAY_MS = 1_000;

/** Retardo máximo entre reintentos de reconexión (Req 14.1). */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** Número máximo de intentos de reconexión antes de rendirse (Req 14.1, 14.2). */
export const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * Calcula el retardo (ms) del intento de reconexión `attempt` (1-indexado) con
 * backoff exponencial: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s (tope), ... El primer
 * intento (`attempt === 1`) usa `RECONNECT_BASE_DELAY_MS`; los siguientes
 * duplican el retardo hasta el tope `RECONNECT_MAX_DELAY_MS` (Req 14.1).
 */
export function calcularRetardoReconexion(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  const delay = RECONNECT_BASE_DELAY_MS * 2 ** exp;
  return Math.min(delay, RECONNECT_MAX_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Umbrales de espera de rival (Req 9.8)
// ---------------------------------------------------------------------------

/** Primer umbral de anuncio de espera de rival, en ms (Req 9.8). */
export const WAIT_FIRST_THRESHOLD_MS = 30_000;

/** Cadencia de los umbrales de espera tras el primero, en ms (Req 9.8). */
export const WAIT_INTERVAL_MS = 60_000;

/** Umbrales del reloj opcional en los que se anuncia la cuenta atrás (Req 13.6), en ms. */
export const CLOCK_THRESHOLDS_MS = [60_000, 30_000, 10_000] as const;

// ---------------------------------------------------------------------------
// Traducción de eventos de red a anuncios en español (Req 13.1–13.5, 13.7)
// ---------------------------------------------------------------------------

/** Anuncio accesible: texto no vacío en español + nivel de urgencia `aria-live`. */
export type Anuncio = {
  mensaje: string;
  politeness: AnnouncePoliteness;
};

/** Contexto que la traducción necesita para redactar el anuncio. */
type ContextoAnuncio = {
  /** Color de este cliente (para nombrar el turno como "tú"/"rival"). */
  color: Color | null;
};

/** Nombre legible del color en español. */
function nombreColor(color: Color): string {
  return color === "w" ? "blancas" : "negras";
}

/**
 * Redacta, en palabras, de quién es el turno tras un `state-sync`, sin depender
 * únicamente del color (Req 13.4). Si conocemos nuestro color, lo expresa como
 * "Es tu turno" / "Turno del rival"; si no, lo expresa por color.
 */
function describirTurno(turno: Color, color: Color | null): string {
  if (color === null) {
    return `Turno de las ${nombreColor(turno)}.`;
  }
  return turno === color ? "Es tu turno." : "Turno del rival.";
}

/** Traduce el motivo de un `move-rejected` a español (Req 12.4). */
function describirRechazo(reason: MoveRejectedReason): string {
  switch (reason) {
    case "no-es-tu-turno":
      return "Movimiento rechazado: no es tu turno.";
    case "movimiento-ilegal":
      return "Movimiento rechazado: movimiento ilegal.";
    case "partida-finalizada":
      return "Movimiento rechazado: la partida ha finalizado.";
    default:
      return "Movimiento rechazado.";
  }
}

/** Traduce un código de error del servidor a español útil (Req 10.6/10.7/10.8). */
function describirError(code: ErrorCode): string {
  switch (code) {
    case "codigo-invalido":
      return "Ese código de partida no existe. Puedes crear una nueva partida.";
    case "codigo-expirado":
      return "La partida ha caducado. Puedes crear una nueva partida.";
    case "partida-llena":
      return "La partida ya tiene dos jugadores.";
    case "no-autorizado":
      return "No estás autorizado para esta acción.";
    default:
      return "Se ha producido un error de conexión.";
  }
}

/**
 * Describe el resultado autoritativo de una partida en español (Req 13.3).
 * Devuelve `null` mientras la partida sigue en curso.
 */
function describirResultado(
  resultado: OnlineGameState["resultado"],
  ganador: Color | null,
  color: Color | null,
): string | null {
  switch (resultado) {
    case "en-curso":
      return null;
    case "jaque-mate": {
      if (ganador === null) return "Jaque mate. Fin de la partida.";
      const quien =
        color === null
          ? `Ganan las ${nombreColor(ganador)}`
          : ganador === color
            ? "Has ganado"
            : "Ha ganado el rival";
      return `Jaque mate. ${quien}.`;
    }
    case "tablas":
      return "Tablas. La partida termina en empate.";
    case "rendicion": {
      const quien =
        color === null
          ? ganador
            ? `Ganan las ${nombreColor(ganador)}`
            : "Fin de la partida"
          : ganador === color
            ? "Tu rival se ha rendido, has ganado"
            : "Te has rendido";
      return `Rendición. ${quien}.`;
    }
    case "abandono":
      return "Abandono. La partida termina por abandono del rival.";
    default:
      return "La partida ha finalizado.";
  }
}

/**
 * Traduce un `state-sync` autoritativo en un anuncio completo en español que
 * cubre: movimiento del rival (por SAN si viene `lastMove`), jaque, jaque
 * mate/resultado y cambio de turno en palabras (Req 13.2, 13.3, 13.4).
 */
function describirStateSync(
  msg: Extract<ServerMessage, { type: "state-sync" }>,
  ctx: ContextoAnuncio,
): Anuncio {
  const partes: string[] = [];

  // Movimiento del rival (o el último aplicado) por SAN, si está disponible.
  if (msg.lastMove?.san) {
    partes.push(`Movimiento: ${msg.lastMove.san}.`);
  }

  const resultadoTexto = describirResultado(
    msg.resultado,
    msg.ganador,
    ctx.color,
  );

  if (resultadoTexto !== null) {
    // Partida finalizada: jaque mate/tablas/rendición/abandono (Req 13.3).
    partes.push(resultadoTexto);
    return {
      mensaje: partes.join(" ").trim(),
      politeness: "assertive",
    };
  }

  // Partida en curso: jaque (Req 13.2) + de quién es el turno (Req 13.4).
  if (msg.jaque) {
    partes.push("Jaque.");
  }
  partes.push(describirTurno(msg.turno, ctx.color));

  return {
    mensaje: partes.join(" ").trim(),
    politeness: msg.jaque ? "assertive" : "polite",
  };
}

/**
 * Traduce **cualquier** `ServerMessage` en un anuncio no vacío en español
 * (Req 13.1). Es una función pura: no toca el estado. La urgencia `aria-live`
 * se eleva a `assertive` para eventos que requieren atención inmediata (oferta
 * de tablas, jaque, fin de partida, errores) (Req 13.5).
 */
export function describirMensaje(
  msg: ServerMessage,
  ctx: ContextoAnuncio,
): Anuncio {
  switch (msg.type) {
    case "created":
      return {
        mensaje: `Partida creada. Tu código es ${msg.codigo}. Juegas con blancas. Esperando al rival.`,
        politeness: "polite",
      };
    case "joined":
      return {
        mensaje: `Te has unido a la partida. Juegas con ${nombreColor(msg.color)}.`,
        politeness: "polite",
      };
    case "opponent-joined":
      return {
        mensaje: "El rival se ha unido a la partida.",
        politeness: "polite",
      };
    case "state-sync":
      return describirStateSync(msg, ctx);
    case "move-rejected":
      return { mensaje: describirRechazo(msg.reason), politeness: "assertive" };
    case "draw-offered": {
      const soyYo = ctx.color === msg.de;
      return soyYo
        ? {
            mensaje: "Has ofrecido tablas. Esperando la respuesta del rival.",
            politeness: "polite",
          }
        : {
            mensaje:
              "El rival ofrece tablas. Puedes aceptar o rechazar la oferta.",
            politeness: "assertive",
          };
    }
    case "draw-declined":
      return {
        mensaje: "La oferta de tablas ha sido rechazada. La partida continúa.",
        politeness: "polite",
      };
    case "opponent-disconnected":
      return {
        mensaje:
          "El rival se ha desconectado. Esperando su reconexión.",
        politeness: "assertive",
      };
    case "opponent-reconnected":
      return {
        mensaje: "El rival se ha reconectado. La partida continúa.",
        politeness: "polite",
      };
    case "opponent-abandoned":
      return {
        mensaje:
          "El rival ha abandonado la partida. Has ganado por abandono.",
        politeness: "assertive",
      };
    case "error":
      return { mensaje: describirError(msg.code), politeness: "assertive" };
    case "chat":
      return {
        mensaje: `Mensaje del rival: ${msg.texto}`,
        politeness: "polite",
      };
    default: {
      // Mensaje desconocido: aún así se garantiza un anuncio no vacío (Req 13.1).
      return { mensaje: "Evento de partida recibido.", politeness: "polite" };
    }
  }
}

/** Construye el estado inicial del hook para un `codigo` dado (o vacío). */
function estadoInicial(codigo: string): OnlineGameState {
  return {
    codigo,
    status: "conectando",
    color: null,
    fen: "",
    historial: [],
    turno: "w",
    esMiTurno: false,
    jaque: false,
    resultado: "en-curso",
    ganador: null,
    ofertaTablasPendiente: null,
  };
}

/**
 * Deriva `esMiTurno` a partir del color propio y el turno autoritativo. Es
 * `false` mientras no se conozca el color o la partida no esté en curso.
 */
function calcularEsMiTurno(
  color: Color | null,
  turno: Color,
  resultado: OnlineGameState["resultado"],
): boolean {
  return color !== null && resultado === "en-curso" && color === turno;
}

// ---------------------------------------------------------------------------
// Fábrica de socket por defecto (socket.io-client)
// ---------------------------------------------------------------------------

/**
 * Fábrica por defecto basada en `socket.io-client`. Se importa de forma
 * perezosa (dinámica) para que el módulo del hook siga siendo utilizable en
 * pruebas que inyectan su propia fábrica sin cargar la librería real.
 *
 * Nota: se usa `require` diferido dentro de la función para evitar acoplar la
 * carga de `socket.io-client` al import del hook; la inyección de
 * `socketFactory` en pruebas/14.3 lo sustituye por completo.
 */
function crearSocketPorDefecto(url?: string): OnlineSocket {
  // Import diferido: sólo se resuelve cuando de verdad se conecta con la
  // fábrica por defecto (no en pruebas que inyectan `socketFactory`).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { io } = require("socket.io-client") as typeof import("socket.io-client");
  const socket = url ? io(url) : io();
  return socket as unknown as OnlineSocket;
}

// ---------------------------------------------------------------------------
// Interfaz pública del hook
// ---------------------------------------------------------------------------

/** API que `useOnlineGame` expone a la interfaz (Componente 7 del diseño). */
export type UseOnlineGame = {
  state: OnlineGameState;
  crearPartida: () => void;
  unirse: (codigo: string) => void;
  intentarMovimiento: (from: string, to: string, promotion?: string) => void;
  ofrecerTablas: () => void;
  aceptarTablas: () => void;
  rechazarTablas: () => void;
  rendirse: () => void;
  reconectar: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook del modo en línea. Mantiene el estado autoritativo sincronizado con el
 * servidor y expone las acciones del jugador. Debe usarse en un Client
 * Component bajo `SettingsProvider` (la tarea 14.2 leerá `voiceRate`/
 * `speechEnabled` para los anuncios por voz).
 *
 * @param initialCodigo Código de partida inicial (p. ej. desde la URL) o las
 *   opciones del hook. Se admite pasar directamente el objeto de opciones para
 *   comodidad de las pruebas.
 * @param options Opciones del hook (URL, fábrica de socket, seam de anuncios).
 */
export function useOnlineGame(
  initialCodigo?: string,
  options: UseOnlineGameOptions = {},
): UseOnlineGame {
  const {
    url,
    socketFactory,
    onAnnounce,
    autoConnect = true,
  } = options;

  const codigoInicial = initialCodigo ?? "";

  const [state, setState] = useState<OnlineGameState>(() =>
    estadoInicial(codigoInicial),
  );

  // ---- Referencias mutables que no deben provocar re-render ----------------

  /** Socket activo (o `null` si no hay conexión). */
  const socketRef = useRef<OnlineSocket | null>(null);
  /** `playerId` secreto de este cliente (asignado por `created`/`joined`). */
  const playerIdRef = useRef<string | null>(null);
  /** Código de partida vigente (se conoce al crear/unir). */
  const codigoRef = useRef<string>(codigoInicial);
  /** Color asignado a este cliente. */
  const colorRef = useRef<Color | null>(null);
  /**
   * Último estado autoritativo conocido, para restaurarlo si un `move` no se
   * confirma con `state-sync` en el tiempo límite (Req 11.7).
   */
  const ultimoAutoritativoRef = useRef<OnlineGameState>(state);
  /** Temporizador del `move` pendiente de confirmación. */
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Indica si hay un movimiento enviado pendiente de `state-sync`. */
  const movePendienteRef = useRef<boolean>(false);

  // ---- Reconexión con backoff exponencial (Req 14.1, 14.2) -----------------

  /** Temporizador del próximo intento de reconexión. */
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Número de intentos de reconexión ya realizados en la racha actual. */
  const reconnectAttemptsRef = useRef<number>(0);
  /** Indica si hay una racha de reconexión activa (evita solaparlas). */
  const reconnectActivoRef = useRef<boolean>(false);

  // ---- Umbrales de espera de rival (Req 9.8) -------------------------------

  /** Temporizador del próximo umbral de espera de rival. */
  const waitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Marca (epoch ms) de inicio de la espera de rival. */
  const waitInicioRef = useRef<number | null>(null);
  /** Último umbral de espera ya anunciado (ms) para no repetirlo (Req 9.8). */
  const waitUltimoUmbralRef = useRef<number>(0);

  // ---- Reloj opcional (Req 13.6) -------------------------------------------

  /**
   * Umbrales de cuenta atrás ya anunciados por color, para no repetir el mismo
   * umbral (Req 13.6). Se reinicia por color cuando el tiempo vuelve a subir.
   */
  const clockAnunciadosRef = useRef<{ w: Set<number>; b: Set<number> }>({
    w: new Set(),
    b: new Set(),
  });

  // El seam de anuncios y la fábrica se guardan en refs para que los efectos
  // no se re-suscriban al cambiar identidades de callbacks entre renders. Las
  // refs se sincronizan en un efecto (no durante el render), tal como exige la
  // regla de React 19.
  const onAnnounceRef = useRef<UseOnlineGameOptions["onAnnounce"]>(onAnnounce);
  const socketFactoryRef = useRef<SocketFactory>(
    socketFactory ?? crearSocketPorDefecto,
  );
  useEffect(() => {
    onAnnounceRef.current = onAnnounce;
    socketFactoryRef.current = socketFactory ?? crearSocketPorDefecto;
  }, [onAnnounce, socketFactory]);

  /** Emite un anuncio por el seam si está conectado (no falla si no lo está). */
  const anunciar = useCallback(
    (mensaje: string, politeness: AnnouncePoliteness = "polite") => {
      onAnnounceRef.current?.(mensaje, politeness);
    },
    [],
  );

  /** Envía un `ClientMessage` por el canal, si hay socket. */
  const enviar = useCallback((mensaje: ClientMessage) => {
    socketRef.current?.emit(MESSAGE_EVENT, mensaje);
  }, []);

  /** Cancela el temporizador del movimiento pendiente, si existe. */
  const cancelarTimeoutMovimiento = useCallback(() => {
    if (moveTimeoutRef.current !== null) {
      clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = null;
    }
    movePendienteRef.current = false;
  }, []);

  /**
   * Anuncia la cuenta atrás del reloj opcional cuando el tiempo restante de un
   * jugador cruza a la baja los umbrales de 60/30/10 s (Req 13.6). Sólo actúa
   * si el `state-sync` trae `relojMs`; no anuncia un mismo umbral dos veces
   * mientras el tiempo siga cayendo, y reinicia el seguimiento de un jugador si
   * su tiempo vuelve a subir (p. ej. tras un incremento).
   */
  const anunciarReloj = useCallback(
    (relojMs: { w: number; b: number } | undefined) => {
      if (!relojMs) return;
      (["w", "b"] as const).forEach((c) => {
        const restante = relojMs[c];
        const anunciados = clockAnunciadosRef.current[c];
        // Si el tiempo vuelve a subir por encima del mayor umbral, reinicia.
        if (restante > CLOCK_THRESHOLDS_MS[0]) {
          anunciados.clear();
        }
        for (const umbral of CLOCK_THRESHOLDS_MS) {
          if (restante <= umbral && !anunciados.has(umbral)) {
            anunciados.add(umbral);
            const quien =
              colorRef.current === null
                ? `las ${nombreColor(c)}`
                : c === colorRef.current
                  ? "tú"
                  : "tu rival";
            const segundos = Math.round(umbral / 1000);
            anunciar(
              `Quedan ${segundos} segundos para ${quien}.`,
              "polite",
            );
            break; // un único anuncio por state-sync y jugador
          }
        }
      });
    },
    [anunciar],
  );

  // -------------------------------------------------------------------------
  // Aplicación del estado autoritativo (SÓLO desde `state-sync`)
  // -------------------------------------------------------------------------

  const aplicarStateSync = useCallback(
    (msg: Extract<ServerMessage, { type: "state-sync" }>) => {
      // La llegada de un state-sync confirma cualquier movimiento pendiente.
      cancelarTimeoutMovimiento();

      // Reloj opcional: anuncia umbrales de cuenta atrás si procede (Req 13.6).
      anunciarReloj(msg.relojMs);

      setState((prev) => {
        const color = colorRef.current;
        const status: OnlineStatus =
          msg.resultado === "en-curso" ? "en-juego" : "finalizada";
        const next: OnlineGameState = {
          ...prev,
          codigo: codigoRef.current || prev.codigo,
          status,
          color,
          fen: msg.fen,
          historial: msg.historial,
          turno: msg.turno,
          esMiTurno: calcularEsMiTurno(color, msg.turno, msg.resultado),
          jaque: msg.jaque,
          resultado: msg.resultado,
          ganador: msg.ganador,
          // Un state-sync que refleja el estado tras aceptar/rechazar/expirar
          // una oferta limpia cualquier oferta pendiente por defecto; las
          // ofertas vivas se re-marcan con `draw-offered`.
          ofertaTablasPendiente: null,
          relojMs: msg.relojMs ?? prev.relojMs,
        };
        ultimoAutoritativoRef.current = next;
        return next;
      });
    },
    [cancelarTimeoutMovimiento, anunciarReloj],
  );

  // -------------------------------------------------------------------------
  // Enrutado de los mensajes entrantes del servidor
  // -------------------------------------------------------------------------

  const manejarMensaje = useCallback(
    (msg: ServerMessage) => {
      // Req 13.1 / Property 12: TODO mensaje entrante produce un anuncio no
      // vacío en español por `aria-live` (+ voz si `speechEnabled`, decisión
      // que toma el llamante vía el seam `onAnnounce`). La traducción es pura y
      // usa el color conocido de este cliente para redactar el turno en
      // palabras (Req 13.4).
      const anuncio = describirMensaje(msg, { color: colorRef.current });
      anunciar(anuncio.mensaje, anuncio.politeness);

      switch (msg.type) {
        case "created": {
          playerIdRef.current = msg.playerId;
          colorRef.current = msg.color;
          codigoRef.current = msg.codigo;
          persistLastOnlineGame({
            codigo: msg.codigo,
            playerId: msg.playerId,
          });
          setState((prev) => ({
            ...prev,
            codigo: msg.codigo,
            color: msg.color,
            fen: msg.fen,
            status: "esperando-rival",
            esMiTurno: false,
          }));
          break;
        }
        case "joined": {
          playerIdRef.current = msg.playerId;
          colorRef.current = msg.color;
          persistLastOnlineGame({
            codigo: codigoRef.current,
            playerId: msg.playerId,
          });
          setState((prev) => ({
            ...prev,
            color: msg.color,
            fen: msg.fen,
            historial: msg.historial,
            status: "en-juego",
            esMiTurno: calcularEsMiTurno(msg.color, prev.turno, "en-curso"),
          }));
          break;
        }
        case "opponent-joined": {
          setState((prev) => ({
            ...prev,
            status: prev.resultado === "en-curso" ? "en-juego" : prev.status,
          }));
          break;
        }
        case "state-sync": {
          aplicarStateSync(msg);
          break;
        }
        case "move-rejected": {
          // El servidor rechazó el movimiento: descartar el pendiente y
          // restaurar el último estado autoritativo (el `fen` no cambió).
          cancelarTimeoutMovimiento();
          setState(() => ({ ...ultimoAutoritativoRef.current }));
          break;
        }
        case "draw-offered": {
          const soyYo = colorRef.current === msg.de;
          setState((prev) => ({
            ...prev,
            ofertaTablasPendiente: soyYo ? "yo" : "rival",
          }));
          break;
        }
        case "draw-declined": {
          setState((prev) => ({ ...prev, ofertaTablasPendiente: null }));
          break;
        }
        case "opponent-disconnected": {
          setState((prev) => ({ ...prev, status: "rival-desconectado" }));
          break;
        }
        case "opponent-reconnected": {
          setState((prev) => ({
            ...prev,
            status: prev.resultado === "en-curso" ? "en-juego" : prev.status,
          }));
          break;
        }
        case "opponent-abandoned": {
          setState((prev) => ({
            ...prev,
            status: "finalizada",
            resultado: "abandono",
            ganador: colorRef.current,
            esMiTurno: false,
          }));
          break;
        }
        case "error": {
          setState((prev) => ({ ...prev, status: "error" }));
          break;
        }
        case "chat": {
          // El chat (opcional, tarea 19) no altera el estado autoritativo.
          break;
        }
        default: {
          // Mensaje desconocido: ignorar sin mutar el estado autoritativo.
          break;
        }
      }
    },
    [aplicarStateSync, cancelarTimeoutMovimiento, anunciar],
  );

  // Se guarda el manejador en una ref para que el efecto de conexión no dependa
  // de su identidad (que cambia con `state`), evitando re-suscripciones. La ref
  // se sincroniza en un efecto (no durante el render, regla de React 19).
  const manejarMensajeRef = useRef(manejarMensaje);
  useEffect(() => {
    manejarMensajeRef.current = manejarMensaje;
  }, [manejarMensaje]);

  // -------------------------------------------------------------------------
  // Reconexión con backoff exponencial (Req 14.1, 14.2)
  // -------------------------------------------------------------------------

  /** Cancela cualquier reintento de reconexión programado y limpia la racha. */
  const cancelarReconexion = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectActivoRef.current = false;
    reconnectAttemptsRef.current = 0;
  }, []);

  /**
   * Ref al planificador de reconexión, para que el reintento encadenado se
   * refiera a la última versión estable sin auto-referenciar la constante del
   * `useCallback` durante su propia declaración.
   */
  const programarReconexionRef = useRef<() => void>(() => {});

  /**
   * Programa el siguiente intento de reconexión con backoff exponencial. Cada
   * intento (re)conecta el socket y reenvía `reconnect` con `codigo`+`playerId`.
   * Agotados los `RECONNECT_MAX_ATTEMPTS`, pasa al estado `error` (equivalente a
   * "desconectado"; el tipo `OnlineStatus` no expone ese literal) y anuncia el
   * fallo (Req 14.2).
   */
  const programarReconexion = useCallback(() => {
    const intento = reconnectAttemptsRef.current + 1;

    if (intento > RECONNECT_MAX_ATTEMPTS) {
      // Agotados los reintentos: rendirse y anunciar (Req 14.2).
      reconnectActivoRef.current = false;
      setState((prev) => ({ ...prev, status: "error" }));
      anunciar(
        "No se pudo restablecer la conexión con la partida.",
        "assertive",
      );
      return;
    }

    reconnectActivoRef.current = true;
    reconnectAttemptsRef.current = intento;
    const retardo = calcularRetardoReconexion(intento);

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      // (Re)conectar el socket y reenviar `reconnect` si tenemos credenciales.
      socketRef.current?.connect?.();
      const codigo = codigoRef.current;
      const playerId = playerIdRef.current;
      if (codigo && playerId) {
        enviar({ type: "reconnect", codigo, playerId });
      }
      // Si el socket sigue sin conectar, el evento `disconnect` (o la ausencia
      // de `connect`) programará el siguiente intento; encadenamos aquí el
      // próximo backoff para que la racha avance de forma determinista bajo
      // temporizadores falsos aunque no llegue un `disconnect` explícito.
      if (reconnectActivoRef.current && !socketRef.current?.connected) {
        programarReconexionRef.current();
      }
    }, retardo);
  }, [anunciar, enviar]);

  useEffect(() => {
    programarReconexionRef.current = programarReconexion;
  }, [programarReconexion]);

  // -------------------------------------------------------------------------
  // Ciclo de vida de la conexión
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!autoConnect) return;

    const socket = socketFactoryRef.current(url);
    socketRef.current = socket;

    const onMessage = (payload: unknown) => {
      manejarMensajeRef.current(payload as ServerMessage);
    };
    const onConnect = () => {
      // Reconexión exitosa: cerrar la racha de backoff y reasociar la partida.
      cancelarReconexion();
      // Si ya teníamos playerId+codigo, intentamos reconectar; si no, quedamos
      // a la espera de una acción explícita (crear/unirse).
      const codigo = codigoRef.current;
      const playerId = playerIdRef.current;
      if (codigo && playerId) {
        enviar({ type: "reconnect", codigo, playerId });
      }
    };
    const onDisconnect = () => {
      // Sólo entra en reconexión si la partida está en curso; en otro estado la
      // caída no debe iniciar una racha de reintentos.
      setState((prev) => {
        if (prev.resultado !== "en-curso") return prev;
        // Anunciar una sola vez al inicio de la racha (Req 14.1).
        if (!reconnectActivoRef.current) {
          anunciar("Conexión perdida, reintentando.", "assertive");
          programarReconexion();
        }
        return prev.status === "reconectando"
          ? prev
          : { ...prev, status: "reconectando" };
      });
    };

    socket.on(MESSAGE_EVENT, onMessage);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off(MESSAGE_EVENT, onMessage);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      cancelarTimeoutMovimiento();
      cancelarReconexion();
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
    // Sólo depende de la URL/autoConnect; los callbacks se leen vía refs.
  }, [
    url,
    autoConnect,
    enviar,
    cancelarTimeoutMovimiento,
    cancelarReconexion,
    programarReconexion,
    anunciar,
  ]);

  // -------------------------------------------------------------------------
  // Umbrales de espera de rival (Req 9.8)
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Sólo mientras se espera al rival; en cualquier otro estado se limpia.
    if (state.status !== "esperando-rival") {
      if (waitTimeoutRef.current !== null) {
        clearTimeout(waitTimeoutRef.current);
        waitTimeoutRef.current = null;
      }
      waitInicioRef.current = null;
      waitUltimoUmbralRef.current = 0;
      return;
    }

    // Inicio de la espera: fija el origen temporal y reinicia el seguimiento.
    waitInicioRef.current = Date.now();
    waitUltimoUmbralRef.current = 0;

    // Programa el siguiente umbral: 30 s, 60 s, luego cada 60 s (Req 9.8).
    const siguienteUmbral = (previo: number): number =>
      previo === 0 ? WAIT_FIRST_THRESHOLD_MS : previo + WAIT_INTERVAL_MS;

    const programar = () => {
      const objetivo = siguienteUmbral(waitUltimoUmbralRef.current);
      const inicio = waitInicioRef.current ?? Date.now();
      const transcurrido = Date.now() - inicio;
      const espera = Math.max(0, objetivo - transcurrido);
      waitTimeoutRef.current = setTimeout(() => {
        waitUltimoUmbralRef.current = objetivo;
        const segundos = Math.round(objetivo / 1000);
        anunciar(
          `Seguimos esperando al rival. Llevas ${segundos} segundos de espera.`,
          "polite",
        );
        programar();
      }, espera);
    };

    programar();

    return () => {
      if (waitTimeoutRef.current !== null) {
        clearTimeout(waitTimeoutRef.current);
        waitTimeoutRef.current = null;
      }
    };
  }, [state.status, anunciar]);

  // -------------------------------------------------------------------------
  // Acciones expuestas
  // -------------------------------------------------------------------------

  const crearPartida = useCallback(() => {
    enviar({ type: "create" });
  }, [enviar]);

  const unirse = useCallback(
    (codigo: string) => {
      codigoRef.current = codigo;
      setState((prev) => ({ ...prev, codigo, status: "conectando" }));
      enviar({ type: "join", codigo });
    },
    [enviar],
  );

  const intentarMovimiento = useCallback(
    (from: string, to: string, promotion?: string) => {
      const codigo = codigoRef.current;
      if (!codigo) return;

      // Snapshot del último estado autoritativo antes de enviar, para poder
      // restaurarlo si el servidor no confirma en el tiempo límite (Req 11.7).
      ultimoAutoritativoRef.current = { ...state };

      // El cliente NO aplica el movimiento; sólo lo envía (Req 11.1).
      enviar({ type: "move", codigo, from, to, promotion });

      // Arranca (o reinicia) el temporizador de confirmación.
      cancelarTimeoutMovimiento();
      movePendienteRef.current = true;
      moveTimeoutRef.current = setTimeout(() => {
        // Sin `state-sync` en 5 s: descartar el pendiente, restaurar el último
        // estado autoritativo y anunciar (Req 11.7). El seam de anuncios lo
        // completa la tarea 14.2.
        movePendienteRef.current = false;
        moveTimeoutRef.current = null;
        setState(() => ({ ...ultimoAutoritativoRef.current }));
        anunciar(
          "No se pudo confirmar el movimiento. Inténtalo de nuevo.",
          "assertive",
        );
      }, MOVE_CONFIRM_TIMEOUT_MS);
    },
    [state, enviar, cancelarTimeoutMovimiento, anunciar],
  );

  const ofrecerTablas = useCallback(() => {
    const codigo = codigoRef.current;
    if (!codigo) return;
    enviar({ type: "draw-offer", codigo });
  }, [enviar]);

  const aceptarTablas = useCallback(() => {
    const codigo = codigoRef.current;
    if (!codigo) return;
    enviar({ type: "draw-accept", codigo });
  }, [enviar]);

  const rechazarTablas = useCallback(() => {
    const codigo = codigoRef.current;
    if (!codigo) return;
    setState((prev) => ({ ...prev, ofertaTablasPendiente: null }));
    enviar({ type: "draw-decline", codigo });
  }, [enviar]);

  const rendirse = useCallback(() => {
    const codigo = codigoRef.current;
    if (!codigo) return;
    enviar({ type: "resign", codigo });
  }, [enviar]);

  const reconectar = useCallback(() => {
    const codigo = codigoRef.current;
    const playerId = playerIdRef.current;
    if (!codigo || !playerId) return;
    // Un reintento manual reinicia la racha de backoff (Req 14.1).
    cancelarReconexion();
    setState((prev) => ({ ...prev, status: "reconectando" }));
    // Asegura que el socket esté conectado antes de reenviar `reconnect`.
    socketRef.current?.connect?.();
    enviar({ type: "reconnect", codigo, playerId });
  }, [enviar, cancelarReconexion]);

  return useMemo(
    () => ({
      state,
      crearPartida,
      unirse,
      intentarMovimiento,
      ofrecerTablas,
      aceptarTablas,
      rechazarTablas,
      rendirse,
      reconectar,
    }),
    [
      state,
      crearPartida,
      unirse,
      intentarMovimiento,
      ofrecerTablas,
      aceptarTablas,
      rechazarTablas,
      rendirse,
      reconectar,
    ],
  );
}
