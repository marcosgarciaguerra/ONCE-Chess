/**
 * Protocolo de mensajes del modo en línea de ONCE Chess.
 *
 * Este módulo define, en un único lugar reutilizable por servidor y cliente,
 * los tipos del estado autoritativo (`OnlineGame`, `Participant`), las uniones
 * discriminadas por `type` del canal WebSocket (`ClientMessage`,
 * `ServerMessage`) y los tipos del estado que el hook cliente expone
 * (`OnlineStatus`, `OnlineGameState`).
 *
 * Además implementa **validadores de forma/campos** (type guards) para cada
 * variante de `ClientMessage`. El servidor autoritativo los usa para validar
 * cada mensaje entrante contra la unión discriminada **antes** de procesarlo,
 * descartando los mensajes malformados sin mutar el estado autoritativo. El
 * servidor nunca confía en la legalidad ni en el estado reportado por el
 * cliente: la legalidad de un movimiento se decide siempre con `chess.js` en
 * el servidor (fuera del alcance de este módulo).
 *
 * Referencias de requisitos:
 * - 16.1: validar forma y campos contra la unión discriminada antes de procesar.
 * - 16.2: descartar los mensajes malformados sin mutar el estado autoritativo.
 * - 11.1: el cliente envía `move` y no aplica nada hasta el `state-sync`.
 * - 11.2: el servidor aplica el movimiento legal y difunde `state-sync`.
 */

// ---------------------------------------------------------------------------
// Modelo 4: estado autoritativo del servidor (`OnlineGame`, `Participant`)
// ---------------------------------------------------------------------------

/** Color de una pieza/jugador en la notación de `chess.js`. */
export type Color = "w" | "b";

/** Resultado autoritativo de una partida en línea. */
export type OnlineResult =
  | "en-curso"
  | "jaque-mate"
  | "tablas"
  | "rendicion"
  | "abandono";

/**
 * Participante de una partida en línea.
 *
 * `playerId` es un token opaco y secreto por jugador que habilita la
 * reconexión; el servidor nunca lo envía al rival (Req 16.5).
 */
export type Participant = {
  /** Token opaco secreto por jugador (para reconexión). */
  playerId: string;
  /** Color asignado al participante. */
  color: Color;
  /** Si el socket del participante está actualmente conectado. */
  conectado: boolean;
  /** Marca de última actividad (epoch ms) para temporizadores/timeouts. */
  ultimaActividad: number;
};

/**
 * Estado autoritativo completo de una partida, mantenido en memoria por el
 * servidor. El `fen`, el `turno`, el jaque y el jaque mate se derivan siempre
 * de la instancia `Chess` autoritativa, nunca del cliente.
 */
export type OnlineGame = {
  /** Código de partida legible y comunicable en voz (ver `gameCode`). */
  codigo: string;
  /** FEN autoritativo actual (fuente de verdad). */
  fen: string;
  /** SAN de todos los movimientos aplicados, en orden. */
  historial: string[];
  /** Turno actual, derivado del `Chess` autoritativo. */
  turno: Color;
  /** Participantes de la partida (1 o 2 como máximo). */
  participantes: Participant[];
  /** Resultado autoritativo de la partida. */
  resultado: OnlineResult;
  /** Ganador cuando aplica; `null` mientras la partida está en curso o en tablas. */
  ganador: Color | null;
  /** Color que ofreció tablas, si hay una oferta pendiente. */
  ofertaTablasDe: Color | null;
  /** Marca de creación (epoch ms). */
  creadaEn: number;
  /** Reloj opcional por jugador, en milisegundos. */
  relojMs?: { w: number; b: number };
};

// ---------------------------------------------------------------------------
// Modelo 5: protocolo de mensajes (uniones discriminadas por `type`)
// ---------------------------------------------------------------------------

/** Motivo por el que el servidor rechaza un movimiento. */
export type MoveRejectedReason =
  | "no-es-tu-turno"
  | "movimiento-ilegal"
  | "partida-finalizada";

/** Código de error genérico del servidor. */
export type ErrorCode =
  | "codigo-invalido"
  | "codigo-expirado"
  | "partida-llena"
  | "no-autorizado";

/**
 * Mensajes que el cliente envía al servidor. Unión discriminada por `type`:
 * cada variante representa una acción del jugador. El servidor valida la forma
 * y los campos de cada mensaje entrante contra esta unión antes de procesarlo.
 */
export type ClientMessage =
  | { type: "create" }
  | { type: "join"; codigo: string }
  | { type: "reconnect"; codigo: string; playerId: string }
  | {
      type: "move";
      codigo: string;
      from: string;
      to: string;
      promotion?: string;
    }
  | { type: "resign"; codigo: string }
  | { type: "draw-offer"; codigo: string }
  | { type: "draw-accept"; codigo: string }
  | { type: "draw-decline"; codigo: string }
  | { type: "chat"; codigo: string; texto: string }; // opcional

/** Discriminante `type` de cada variante de `ClientMessage`. */
export type ClientMessageType = ClientMessage["type"];

/**
 * Mensajes que el servidor envía al cliente. Unión discriminada por `type`.
 * El `playerId` sólo se envía al propio jugador (`created`/`joined`), nunca al
 * rival (Req 16.5).
 */
export type ServerMessage =
  | { type: "created"; codigo: string; playerId: string; color: "w"; fen: string }
  | {
      type: "joined";
      playerId: string;
      color: "b";
      fen: string;
      historial: string[];
    }
  | { type: "opponent-joined" }
  | {
      type: "state-sync";
      fen: string;
      historial: string[];
      turno: Color;
      lastMove?: { from: string; to: string; san: string };
      jaque: boolean;
      resultado: OnlineGame["resultado"];
      ganador: Color | null;
      relojMs?: { w: number; b: number };
    }
  | { type: "move-rejected"; reason: MoveRejectedReason }
  | { type: "draw-offered"; de: Color }
  | { type: "draw-declined" }
  | { type: "opponent-disconnected"; graceMs: number }
  | { type: "opponent-reconnected" }
  | { type: "opponent-abandoned" }
  | { type: "error"; code: ErrorCode }
  | { type: "chat"; de: Color; texto: string }; // opcional

/** Discriminante `type` de cada variante de `ServerMessage`. */
export type ServerMessageType = ServerMessage["type"];

// ---------------------------------------------------------------------------
// Componente 7: estado del hook cliente (`OnlineStatus`, `OnlineGameState`)
// ---------------------------------------------------------------------------

/** Estados posibles de la conexión/partida desde el punto de vista del cliente. */
export type OnlineStatus =
  | "conectando"
  | "esperando-rival"
  | "en-juego"
  | "rival-desconectado"
  | "reconectando"
  | "finalizada"
  | "error";

/** Estado que el hook `useOnlineGame` expone a la interfaz. */
export type OnlineGameState = {
  codigo: string;
  status: OnlineStatus;
  /** Color asignado a este cliente; `null` hasta que el servidor lo asigna. */
  color: Color | null;
  /** FEN autoritativo actual. */
  fen: string;
  /** SAN de la partida (autoritativo). */
  historial: string[];
  turno: Color;
  esMiTurno: boolean;
  jaque: boolean;
  resultado: "en-curso" | "jaque-mate" | "tablas" | "rendicion" | "abandono";
  ganador: Color | null;
  ofertaTablasPendiente: "yo" | "rival" | null;
  /** Reloj opcional por jugador, en milisegundos. */
  relojMs?: { w: number; b: number };
};

// ---------------------------------------------------------------------------
// Validadores de forma/campos de los mensajes entrantes (Req 16.1, 16.2)
// ---------------------------------------------------------------------------

/** Comprueba que `value` es un objeto plano no nulo (candidato a mensaje). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Comprueba que `value` es una cadena no vacía tras `trim()`. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Devuelve el conjunto de claves «propias» de `type` esperadas para cada
 * variante. Se usa para rechazar mensajes con campos desconocidos y evitar que
 * datos extraños viajen sin control al procesamiento del servidor.
 */
const ALLOWED_KEYS: Record<ClientMessageType, readonly string[]> = {
  create: ["type"],
  join: ["type", "codigo"],
  reconnect: ["type", "codigo", "playerId"],
  move: ["type", "codigo", "from", "to", "promotion"],
  resign: ["type", "codigo"],
  "draw-offer": ["type", "codigo"],
  "draw-accept": ["type", "codigo"],
  "draw-decline": ["type", "codigo"],
  chat: ["type", "codigo", "texto"],
};

/**
 * Comprueba que el objeto no contiene claves ajenas a las permitidas para la
 * variante indicada. Rechazar campos desconocidos endurece la validación
 * (Req 16.1) sin depender del contenido reportado por el cliente.
 */
function hasOnlyAllowedKeys(
  msg: Record<string, unknown>,
  variant: ClientMessageType,
): boolean {
  const allowed = ALLOWED_KEYS[variant];
  return Object.keys(msg).every((key) => allowed.includes(key));
}

/** Longitud máxima de un mensaje de chat (Req 16.9). */
export const MAX_CHAT_LENGTH = 500;

/**
 * Type guard para `{ type: "create" }`.
 */
export function isCreateMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "create" }> {
  return (
    isRecord(msg) && msg.type === "create" && hasOnlyAllowedKeys(msg, "create")
  );
}

/**
 * Type guard para `{ type: "join"; codigo: string }`.
 */
export function isJoinMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "join" }> {
  return (
    isRecord(msg) &&
    msg.type === "join" &&
    isNonEmptyString(msg.codigo) &&
    hasOnlyAllowedKeys(msg, "join")
  );
}

/**
 * Type guard para `{ type: "reconnect"; codigo: string; playerId: string }`.
 */
export function isReconnectMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "reconnect" }> {
  return (
    isRecord(msg) &&
    msg.type === "reconnect" &&
    isNonEmptyString(msg.codigo) &&
    isNonEmptyString(msg.playerId) &&
    hasOnlyAllowedKeys(msg, "reconnect")
  );
}

/**
 * Type guard para `{ type: "move"; codigo; from; to; promotion? }`.
 *
 * Valida sólo la **forma** (campos y tipos); la legalidad ajedrecística del
 * movimiento la decide el servidor con `chess.js` (Req 16.3), no este guard.
 */
export function isMoveMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "move" }> {
  return (
    isRecord(msg) &&
    msg.type === "move" &&
    isNonEmptyString(msg.codigo) &&
    isNonEmptyString(msg.from) &&
    isNonEmptyString(msg.to) &&
    (msg.promotion === undefined || isNonEmptyString(msg.promotion)) &&
    hasOnlyAllowedKeys(msg, "move")
  );
}

/**
 * Type guard para `{ type: "resign"; codigo: string }`.
 */
export function isResignMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "resign" }> {
  return (
    isRecord(msg) &&
    msg.type === "resign" &&
    isNonEmptyString(msg.codigo) &&
    hasOnlyAllowedKeys(msg, "resign")
  );
}

/**
 * Type guard para `{ type: "draw-offer"; codigo: string }`.
 */
export function isDrawOfferMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "draw-offer" }> {
  return (
    isRecord(msg) &&
    msg.type === "draw-offer" &&
    isNonEmptyString(msg.codigo) &&
    hasOnlyAllowedKeys(msg, "draw-offer")
  );
}

/**
 * Type guard para `{ type: "draw-accept"; codigo: string }`.
 */
export function isDrawAcceptMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "draw-accept" }> {
  return (
    isRecord(msg) &&
    msg.type === "draw-accept" &&
    isNonEmptyString(msg.codigo) &&
    hasOnlyAllowedKeys(msg, "draw-accept")
  );
}

/**
 * Type guard para `{ type: "draw-decline"; codigo: string }`.
 */
export function isDrawDeclineMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "draw-decline" }> {
  return (
    isRecord(msg) &&
    msg.type === "draw-decline" &&
    isNonEmptyString(msg.codigo) &&
    hasOnlyAllowedKeys(msg, "draw-decline")
  );
}

/**
 * Type guard para `{ type: "chat"; codigo: string; texto: string }`.
 *
 * El texto se trata como texto plano y se limita a `MAX_CHAT_LENGTH`
 * caracteres (Req 16.9). Un texto vacío o que exceda el límite es inválido.
 */
export function isChatMessage(
  msg: unknown,
): msg is Extract<ClientMessage, { type: "chat" }> {
  return (
    isRecord(msg) &&
    msg.type === "chat" &&
    isNonEmptyString(msg.codigo) &&
    typeof msg.texto === "string" &&
    msg.texto.length > 0 &&
    msg.texto.length <= MAX_CHAT_LENGTH &&
    hasOnlyAllowedKeys(msg, "chat")
  );
}

/**
 * Valida y estrecha un valor desconocido a `ClientMessage` parseando la unión
 * discriminada por `type`. Devuelve el mensaje tipado si es válido, o `null`
 * si está malformado (falta `type`, `type` desconocido, campos ausentes,
 * tipos incorrectos o campos ajenos).
 *
 * El servidor debe llamar a esta función sobre cada mensaje entrante antes de
 * procesarlo; ante `null` debe descartar el mensaje y responder `error` sin
 * mutar el estado autoritativo (Req 16.1, 16.2).
 */
export function parseClientMessage(msg: unknown): ClientMessage | null {
  if (!isRecord(msg) || typeof msg.type !== "string") {
    return null;
  }

  switch (msg.type as ClientMessageType) {
    case "create":
      return isCreateMessage(msg) ? msg : null;
    case "join":
      return isJoinMessage(msg) ? msg : null;
    case "reconnect":
      return isReconnectMessage(msg) ? msg : null;
    case "move":
      return isMoveMessage(msg) ? msg : null;
    case "resign":
      return isResignMessage(msg) ? msg : null;
    case "draw-offer":
      return isDrawOfferMessage(msg) ? msg : null;
    case "draw-accept":
      return isDrawAcceptMessage(msg) ? msg : null;
    case "draw-decline":
      return isDrawDeclineMessage(msg) ? msg : null;
    case "chat":
      return isChatMessage(msg) ? msg : null;
    default:
      // `type` desconocido: mensaje malformado.
      return null;
  }
}

/**
 * Comprueba si un valor desconocido es un `ClientMessage` válido, sin
 * estrecharlo. Útil como guard booleano cuando no se necesita el valor tipado.
 */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  return parseClientMessage(msg) !== null;
}
