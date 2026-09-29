/**
 * Servidor autoritativo del modo en línea de ONCE Chess.
 *
 * Este módulo mantiene el **registro en memoria** de las partidas en línea y
 * expone el núcleo de lógica pura como una clase `GameServer` con métodos
 * puros y deterministas (salvo la generación de código/`playerId`, que puede
 * inyectarse para las pruebas). El servidor es la **única fuente de verdad**:
 * la posición se deriva siempre de una instancia `Chess` de `chess.js`, nunca
 * del cliente.
 *
 * Alcance de esta implementación (tarea 13.1):
 * - Registro por `codigo` y ciclo de creación/unión de partidas.
 * - `crearPartida()`: crea `OnlineGame` con `Chess` inicial + código único; el
 *   creador es blancas (`w`) y recibe un `playerId` secreto.
 * - `unirse(codigo)`: asigna negras (`b`) al segundo jugador y devuelve
 *   `fen`/`historial`; rechaza el tercer jugador con `error("partida-llena")`
 *   sin alterar el estado; `error("codigo-invalido")` si el código no existe y
 *   `error("codigo-expirado")` si la partida está finalizada/purgada.
 *
 * Las tareas posteriores extienden esta clase:
 * - 13.2: `aplicarMovimiento` (movimiento autoritativo y turno).
 * - 13.4 (esta capa): `rendirse`/`ofrecerTablas`/`resolverTablas`/
 *   `reconectar`/`marcarDesconexion` (rendición, tablas y ciclo de vida de
 *   conexión). La lógica pura (mutación del estado autoritativo y cálculo de
 *   los mensajes salientes) vive aquí; la capa de transporte (Socket.IO) sólo
 *   difunde los `Outbound` devueltos.
 * - 13.5: validación de mensajes, autorización, rate-limiting y purga.
 *
 * Temporizadores del periodo de gracia (14.3/14.7): en lugar de acoplar la
 * lógica a `setTimeout`, se inyecta un **planificador** (`programar`/`cancelar`)
 * que por defecto usa temporizadores reales. Las pruebas pueden inyectar un
 * planificador falso (o usar temporizadores simulados de Vitest) para expirar
 * el periodo de gracia de forma determinista sin esperar 60 s reales.
 *
 * La instancia `Chess` no se serializa en `OnlineGame` (que es puro estado de
 * datos); el servidor mantiene un mapa paralelo `codigo -> Chess` para derivar
 * `fen`/`turno`/legalidad. `OnlineGame.fen` es la fuente de verdad
 * serializable y siempre coincide con la instancia `Chess` correspondiente.
 *
 * Referencias de requisitos: 9.1, 9.5, 10.1, 10.2, 10.6, 10.7, 10.8.
 */

import { Chess } from "chess.js";

import { generarCodigo, normalizarCodigo } from "@/lib/gameCode";
import { parseClientMessage } from "@/lib/onlineProtocol";
import type {
  ClientMessage,
  ClientMessageType,
  Color,
  ErrorCode,
  MoveRejectedReason,
  OnlineGame,
  Participant,
  ServerMessage,
} from "@/lib/onlineProtocol";

/** FEN de la posición inicial estándar de ajedrez. */
export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * Resultado exitoso de `unirse`: la partida actualizada más el `playerId`
 * secreto del segundo jugador. En caso de error se devuelve un `ServerMessage`
 * de tipo `error` (unión discriminada por `type`), nunca se lanza.
 */
export type UnirseResultado =
  | { game: OnlineGame; playerId: string }
  | Extract<ServerMessage, { type: "error" }>;

/**
 * Payload autoritativo que la capa de transporte difunde como `state-sync` a
 * ambos clientes tras un movimiento legal (Req 11.2). Coincide en forma con la
 * variante `state-sync` de `ServerMessage` (sin el discriminante `type`, que
 * añade la capa de transporte).
 */
export type StateSyncPayload = Omit<
  Extract<ServerMessage, { type: "state-sync" }>,
  "type"
>;

/**
 * Resultado discriminado de `aplicarMovimiento`. En caso de éxito devuelve un
 * `state-sync` listo para difundir; en caso de rechazo, un `move-rejected` con
 * el motivo (sin alterar el `fen` autoritativo); si el código no corresponde a
 * ninguna partida o el `playerId` no está autorizado, un `error`.
 *
 * La unión está discriminada por `type`, homogénea con `ServerMessage`.
 */
export type AplicarMovimientoResultado =
  | ({ type: "state-sync" } & StateSyncPayload)
  | Extract<ServerMessage, { type: "move-rejected" }>
  | Extract<ServerMessage, { type: "error" }>;

/**
 * Periodo de gracia (ms) que un participante desconectado tiene para
 * reconectarse antes de que la partida se dé por abandonada (Req 14.3/14.7).
 */
export const GRACE_MS = 60_000;

/**
 * Antigüedad (ms) tras la cual una partida **finalizada o inactiva** se purga
 * del registro para invalidar su código (Req 16.8). Una partida está inactiva
 * cuando su marca de actividad más reciente (`ultimaActividad` de cualquier
 * participante, o `creadaEn` si aún no hay actividad) es anterior a
 * `ahora - PURGE_INACTIVE_MS`.
 */
export const PURGE_INACTIVE_MS = 30 * 60_000;

/**
 * Ventana deslizante (ms) sobre la que se cuentan las acciones para el
 * rate-limiting (Req 16.6/16.7). Las acciones cuyo timestamp sea anterior a
 * `ahora - RATE_WINDOW_MS` ya no cuentan para el límite.
 */
export const RATE_WINDOW_MS = 10_000;

/**
 * Límite de acciones `join`/`reconnect` por clave (conexión o IP) dentro de la
 * ventana `RATE_WINDOW_MS`, para frenar el adivinado del código por fuerza
 * bruta (Req 16.6).
 */
export const RATE_LIMIT_JOIN_RECONNECT = 5;

/**
 * Límite de acciones `move`/`create`/`join` por conexión dentro de la ventana
 * `RATE_WINDOW_MS`, para mitigar abuso y denegación de servicio (Req 16.7).
 */
export const RATE_LIMIT_MOVE_CREATE_JOIN = 20;

/**
 * Un mensaje saliente dirigido a un color concreto. La capa de transporte
 * (Socket.IO) resuelve el/los socket(s) de ese color y le(s) difunde el
 * `mensaje`. Mantener la lógica pura desacoplada del transporte permite
 * probarla sin sockets: los métodos devuelven **qué** enviar y **a quién**,
 * no cómo enviarlo.
 */
export type Outbound = {
  /** Color destinatario del mensaje. */
  para: Color;
  /** Mensaje del protocolo a difundir a ese color. */
  mensaje: ServerMessage;
};

/**
 * Payload de reconexión listo para que la capa de transporte lo difunda: el
 * `state-sync` exacto que se envía al jugador que reconecta y la lista de
 * mensajes salientes para el rival (`opponent-reconnected`).
 */
export type ReconectarResultado =
  | {
      /** `state-sync` exacto para el jugador que reconecta (Req 14.4/14.6). */
      stateSync: { type: "state-sync" } & StateSyncPayload;
      /** Mensajes para el rival (p. ej. `opponent-reconnected`). */
      mensajes: Outbound[];
    }
  | Extract<ServerMessage, { type: "error" }>;

/**
 * Resultado de una acción de partida (rendición/tablas): el estado difundido a
 * ambos y la lista de mensajes salientes que la capa de transporte debe enviar.
 * En caso de rechazo se devuelve un `error`/`move-rejected` sin mutar estado.
 */
export type AccionResultado =
  | { mensajes: Outbound[] }
  | Extract<ServerMessage, { type: "error" }>
  | Extract<ServerMessage, { type: "move-rejected" }>;

/**
 * Identificador opaco de un temporizador programado. Es el valor devuelto por
 * `programar` y aceptado por `cancelar`; con temporizadores reales de Node es
 * un `NodeJS.Timeout`, pero la lógica no asume su forma.
 */
export type TimerHandle = unknown;

/**
 * Acciones sujetas a limitación de frecuencia (Req 16.6/16.7). Se derivan del
 * discriminante `type` de los mensajes entrantes que consumen cuota:
 * `join`/`reconnect` (adivinado de código) y `move`/`create`/`join` (abuso/DoS).
 */
export type RateLimitedAction = "create" | "join" | "reconnect" | "move";

/**
 * Resultado de `procesarMensaje`: un mensaje entrante malformado o que excede
 * el rate-limit se traduce a un `error` sin mutar el estado autoritativo
 * (Req 16.1/16.2/16.6/16.7). Si el mensaje es válido y está dentro de los
 * límites, devuelve el `ClientMessage` tipado y estrechado, listo para que la
 * capa de transporte lo despache al método puro correspondiente.
 *
 * La unión está discriminada por `type`: `{ type: "ok" }` para el caso válido y
 * `{ type: "error" }` (variante de `ServerMessage`) para el rechazo.
 */
export type ProcesarMensajeResultado =
  | { type: "ok"; mensaje: ClientMessage }
  | Extract<ServerMessage, { type: "error" }>;

/**
 * Contexto de una conexión entrante que la capa de transporte pasa a
 * `procesarMensaje`. `connectionId` identifica el socket concreto (para el
 * límite por conexión, Req 16.7) e `ip` la dirección de red (para el límite de
 * adivinado de código por IP, Req 16.6). Ambos son opcionales para permitir
 * usos/pruebas donde sólo interesa una de las dimensiones.
 */
export type ConexionCtx = {
  /** Identificador de la conexión/socket (límite por conexión). */
  connectionId?: string;
  /** Dirección IP de la conexión (límite por IP para `join`/`reconnect`). */
  ip?: string;
};

/**
 * Limitador de frecuencia por **ventana deslizante** basado en timestamps del
 * reloj inyectable (`ahora()`), lo que lo hace determinista en pruebas: no
 * depende de `setTimeout` ni del reloj real.
 *
 * Mantiene, por cada par `(clave, categoría)`, la lista de timestamps de las
 * acciones recientes. En cada comprobación descarta los timestamps anteriores a
 * `ahora - RATE_WINDOW_MS` y compara el número restante con el límite. Si
 * registrar la nueva acción no superara el límite, la registra y **permite**;
 * en caso contrario **rechaza** sin registrarla (para no penalizar de más).
 *
 * Se usan dos categorías independientes por las dos reglas del diseño:
 * - `"join-reconnect"`: acciones `join`/`reconnect`, límite
 *   `RATE_LIMIT_JOIN_RECONNECT`, clave por conexión **o** IP (Req 16.6).
 * - `"move-create-join"`: acciones `move`/`create`/`join`, límite
 *   `RATE_LIMIT_MOVE_CREATE_JOIN`, clave por conexión (Req 16.7).
 *
 * Una acción `join` cuenta en **ambas** categorías (por eso puede ser frenada
 * por cualquiera de los dos límites, tal como exigen 16.6 y 16.7).
 */
export class RateLimiter {
  /** Timestamps recientes por `categoria::clave`. */
  private readonly eventos = new Map<string, number[]>();

  constructor(
    private readonly ahora: () => number,
    private readonly ventanaMs: number = RATE_WINDOW_MS,
  ) {}

  /** Clave compuesta de categoría y clave (conexión/IP). */
  private clave(categoria: string, id: string): string {
    return `${categoria}::${id}`;
  }

  /**
   * Comprueba y (si procede) registra una acción para una `categoria` y una
   * `id` (conexión o IP), con `limite` acciones por ventana. Devuelve `true` si
   * la acción está permitida (y la registra) o `false` si excede el límite (sin
   * registrarla).
   */
  private permitirCategoria(
    categoria: string,
    id: string,
    limite: number,
  ): boolean {
    const clave = this.clave(categoria, id);
    const ahora = this.ahora();
    const desde = ahora - this.ventanaMs;
    const recientes = (this.eventos.get(clave) ?? []).filter((t) => t > desde);
    if (recientes.length >= limite) {
      // Persistir la lista podada aunque se rechace, para no crecer sin límite.
      this.eventos.set(clave, recientes);
      return false;
    }
    recientes.push(ahora);
    this.eventos.set(clave, recientes);
    return true;
  }

  /**
   * Comprueba y registra una acción sujeta a rate-limiting. Devuelve `true` si
   * se permite (dentro de todos los límites aplicables) y `false` si alguno de
   * los límites se excede. Aplica ambas reglas del diseño según la acción:
   * `join`/`reconnect` cuentan en el límite por IP/conexión de 5/10 s (16.6) y
   * `move`/`create`/`join` en el de 20/10 s por conexión (16.7).
   *
   * Se evalúan **todas** las categorías aplicables (sin cortocircuito) para que
   * cada acción quede contabilizada de forma coherente en su(s) ventana(s).
   */
  permitir(accion: RateLimitedAction, ctx: ConexionCtx): boolean {
    const conexion = ctx.connectionId ?? ctx.ip ?? "anon";
    let permitido = true;

    // Regla 16.6: join/reconnect ≤ 5 por conexión/IP cada 10 s. Se aplica sobre
    // la clave más específica disponible (IP si existe, si no la conexión).
    if (accion === "join" || accion === "reconnect") {
      const idJR = ctx.ip ?? ctx.connectionId ?? "anon";
      const ok = this.permitirCategoria(
        "join-reconnect",
        idJR,
        RATE_LIMIT_JOIN_RECONNECT,
      );
      permitido = permitido && ok;
    }

    // Regla 16.7: move/create/join ≤ 20 por conexión cada 10 s.
    if (accion === "move" || accion === "create" || accion === "join") {
      const ok = this.permitirCategoria(
        "move-create-join",
        conexion,
        RATE_LIMIT_MOVE_CREATE_JOIN,
      );
      permitido = permitido && ok;
    }

    return permitido;
  }

  /** Olvida todo el estado acumulado (útil para pruebas). */
  reset(): void {
    this.eventos.clear();
  }
}

/**
 * Dependencias inyectables del servidor. Permiten a las pruebas controlar la
 * aleatoriedad (código y `playerId`), el reloj y los temporizadores del
 * periodo de gracia sin tocar la lógica pura.
 */
export type GameServerDeps = {
  /** Genera un código único frente al conjunto de códigos ya existentes. */
  generarCodigo?: (existentes: Set<string>) => string;
  /** Genera un `playerId` opaco y secreto. */
  generarPlayerId?: () => string;
  /** Reloj (epoch ms). Por defecto `Date.now`. */
  ahora?: () => number;
  /**
   * Planificador de un `callback` tras `ms` milisegundos. Por defecto usa
   * `setTimeout`. Devuelve un manejador que `cancelar` puede anular. Inyectar
   * un planificador falso permite expirar el periodo de gracia de forma
   * determinista en las pruebas.
   */
  programar?: (callback: () => void, ms: number) => TimerHandle;
  /** Cancela un temporizador programado por `programar`. Por defecto `clearTimeout`. */
  cancelar?: (handle: TimerHandle) => void;
};

/** Genera un `playerId` opaco por defecto (secreto, no adivinable). */
function playerIdPorDefecto(): string {
  // `crypto.randomUUID` está disponible en Node moderno y navegadores; se
  // recurre a un fallback aleatorio si no existe (entornos de prueba antiguos).
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `pid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Construye el `ServerMessage` de error para un `ErrorCode` dado. */
function errorMsg(code: ErrorCode): Extract<ServerMessage, { type: "error" }> {
  return { type: "error", code };
}

/** Construye el `move-rejected` para un motivo dado (no muta estado alguno). */
function moveRejected(
  reason: MoveRejectedReason,
): Extract<ServerMessage, { type: "move-rejected" }> {
  return { type: "move-rejected", reason };
}

/**
 * Núcleo autoritativo en memoria. Cada instancia mantiene su propio registro,
 * lo que permite crear servidores aislados en las pruebas (dos clientes
 * simulados, propiedades, etc.) sin estado global compartido.
 */
export class GameServer {
  /** Registro de partidas indexado por `codigo` (ya normalizado). */
  private readonly partidas = new Map<string, OnlineGame>();

  /**
   * Instancias `Chess` autoritativas indexadas por `codigo`. Se mantienen en
   * paralelo a `partidas` porque `OnlineGame` es un tipo de datos puro y no
   * incluye la instancia mutable de `chess.js`.
   */
  private readonly motores = new Map<string, Chess>();

  /**
   * Temporizadores del periodo de gracia por desconexión, indexados por
   * `codigo::color`. Permiten cancelar el abandono cuando el jugador reconecta
   * (Req 14.4) antes de que expire el periodo de gracia (Req 14.7).
   */
  private readonly temporizadores = new Map<string, TimerHandle>();

  private readonly _generarCodigo: (existentes: Set<string>) => string;
  private readonly _generarPlayerId: () => string;
  private readonly _ahora: () => number;
  private readonly _programar: (callback: () => void, ms: number) => TimerHandle;
  private readonly _cancelar: (handle: TimerHandle) => void;

  /**
   * Limitador de frecuencia (Req 16.6/16.7). Comparte el reloj inyectable del
   * servidor, por lo que las pruebas pueden avanzar el tiempo de forma
   * determinista sin temporizadores reales.
   */
  private readonly limitador: RateLimiter;

  constructor(deps: GameServerDeps = {}) {
    this._generarCodigo = deps.generarCodigo ?? generarCodigo;
    this._generarPlayerId = deps.generarPlayerId ?? playerIdPorDefecto;
    this._ahora = deps.ahora ?? Date.now;
    this.limitador = new RateLimiter(() => this._ahora());
    this._programar =
      deps.programar ??
      ((callback, ms) => setTimeout(callback, ms) as unknown as TimerHandle);
    this._cancelar =
      deps.cancelar ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  // -------------------------------------------------------------------------
  // Consultas de sólo lectura (útiles para pruebas y tareas posteriores)
  // -------------------------------------------------------------------------

  /** Número de partidas registradas actualmente. */
  get numeroDePartidas(): number {
    return this.partidas.size;
  }

  /**
   * Devuelve la partida asociada a un código (normalizándolo antes), o
   * `undefined` si no existe. No muta el estado.
   */
  obtenerPartida(codigo: string): OnlineGame | undefined {
    return this.partidas.get(normalizarCodigo(codigo));
  }

  /**
   * Devuelve la instancia `Chess` autoritativa de una partida, o `undefined`.
   * Expuesto para las tareas 13.2+ que aplican movimientos; el resto del
   * código sólo debe leer `OnlineGame.fen`.
   */
  obtenerMotor(codigo: string): Chess | undefined {
    return this.motores.get(normalizarCodigo(codigo));
  }

  /** Conjunto de códigos activos (para la generación de códigos únicos). */
  private codigosExistentes(): Set<string> {
    return new Set(this.partidas.keys());
  }

  // -------------------------------------------------------------------------
  // Creación de partida (Req 9.1, 9.5)
  // -------------------------------------------------------------------------

  /**
   * Crea una nueva partida en la posición inicial con un código único. El
   * creador se registra como blancas (`w`) y recibe un `playerId` secreto.
   *
   * Devuelve la `OnlineGame` recién creada (incluye el `participante` blanco
   * con su `playerId`). La capa de transporte (Socket.IO, tarea posterior) es
   * responsable de enviar al creador únicamente su propio `playerId` mediante
   * el mensaje `created` y de no revelarlo jamás al rival (Req 16.5).
   *
   * Propaga el error de `generarCodigo` si no logra un código único en 100
   * intentos (Req 9.4); no crea la partida en ese caso.
   */
  crearPartida(): OnlineGame {
    const codigo = this._generarCodigo(this.codigosExistentes());
    const motor = new Chess(); // posición inicial estándar
    const creadaEn = this._ahora();

    const creador: Participant = {
      playerId: this._generarPlayerId(),
      color: "w",
      conectado: true,
      ultimaActividad: creadaEn,
    };

    const game: OnlineGame = {
      codigo,
      fen: motor.fen(),
      historial: [],
      turno: motor.turn() as Color,
      participantes: [creador],
      resultado: "en-curso",
      ganador: null,
      ofertaTablasDe: null,
      creadaEn,
    };

    this.partidas.set(codigo, game);
    this.motores.set(codigo, motor);
    return game;
  }

  // -------------------------------------------------------------------------
  // Unión a partida (Req 10.1, 10.2, 10.6, 10.7, 10.8)
  // -------------------------------------------------------------------------

  /**
   * Une a un segundo jugador a una partida existente por su `codigo`.
   *
   * - Normaliza el código antes de buscar (Req 10.3 lo hace el lobby, pero se
   *   normaliza también aquí para robustez).
   * - `error("codigo-invalido")` si el código no corresponde a ninguna partida
   *   registrada (Req 10.6).
   * - `error("codigo-expirado")` si la partida existe pero ya está finalizada
   *   o purgada (Req 10.7).
   * - `error("partida-llena")` si ya hay dos participantes; **no altera** el
   *   estado de la partida existente (Req 10.8).
   * - En el caso válido: asigna negras (`b`) al segundo jugador con un
   *   `playerId` secreto y devuelve la partida actualizada más ese `playerId`
   *   (Req 10.1). El `fen` e `historial` para el mensaje `joined` se leen de la
   *   `OnlineGame` devuelta.
   *
   * Nunca lanza ante entradas inválidas; devuelve un `ServerMessage` de error.
   */
  unirse(codigo: string): UnirseResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);

    if (!game) {
      return errorMsg("codigo-invalido");
    }

    // Partida finalizada o purgada por expiración: código expirado.
    if (game.resultado !== "en-curso") {
      return errorMsg("codigo-expirado");
    }

    // Ya hay dos participantes: rechazar sin alterar el estado.
    if (game.participantes.length >= 2) {
      return errorMsg("partida-llena");
    }

    const ahora = this._ahora();
    const segundo: Participant = {
      playerId: this._generarPlayerId(),
      color: "b",
      conectado: true,
      ultimaActividad: ahora,
    };

    game.participantes.push(segundo);
    // El `fen`/`historial`/`turno` no cambian al unirse; se mantienen
    // sincronizados con la instancia `Chess` autoritativa.

    return { game, playerId: segundo.playerId };
  }

  // -------------------------------------------------------------------------
  // Movimiento autoritativo y cumplimiento de turno
  // (Req 11.2, 11.4, 11.5, 12.1, 12.2, 12.3, 16.3, 16.4)
  // -------------------------------------------------------------------------

  /**
   * Aplica un movimiento autoritativo a una partida y devuelve un resultado
   * discriminado por `type`, listo para que la capa de transporte lo difunda.
   *
   * El servidor es la **única fuente de verdad**: la legalidad se decide con la
   * instancia `Chess` autoritativa, nunca con datos del cliente. Ninguna rama
   * de rechazo o error muta el `fen` autoritativo (invariante Req 11.6/16.4).
   *
   * Reglas (en orden de comprobación):
   * - Partida inexistente → `error("codigo-invalido")`.
   * - `playerId` desconocido / no participa → `error("no-autorizado")`
   *   (Req 16.4). El color del que mueve se deriva del participante cuyo
   *   `playerId` coincide; nunca se confía en un color reportado por el cliente.
   * - Partida ya finalizada → `move-rejected("partida-finalizada")` sin alterar
   *   el `fen` (Req 12.3).
   * - No es el turno de ese color → `move-rejected("no-es-tu-turno")` sin
   *   alterar el `fen` (Req 12.1, Property 10).
   * - Movimiento ilegal según `chess.js` → `move-rejected("movimiento-ilegal")`
   *   sin alterar el `fen` (Req 12.2, 16.3). `chess.js` v1.x lanza ante un
   *   movimiento ilegal; se captura y se trata como ilegal.
   * - Movimiento legal y en turno → se aplica a la instancia `Chess`, se
   *   actualizan `fen`/`historial`(SAN)/`turno`/`resultado`/`ganador` y se
   *   devuelve el `state-sync` (Req 11.2). Jaque mate → `resultado =
   *   "jaque-mate"` y `ganador` = color que movió (Req 11.4). Tablas
   *   (ahogado, material insuficiente, triple repetición, regla de 50
   *   movimientos) → `resultado = "tablas"` (Req 11.5). El flag `jaque` refleja
   *   si el bando en juego queda en jaque.
   *
   * @param codigo Código de la partida (se normaliza internamente).
   * @param playerId Token secreto del jugador que intenta mover.
   * @param from Casilla de origen (p. ej. `"e2"`).
   * @param to Casilla de destino (p. ej. `"e4"`).
   * @param promotion Pieza de promoción opcional (`"q" | "r" | "b" | "n"`).
   */
  aplicarMovimiento(
    codigo: string,
    playerId: string,
    from: string,
    to: string,
    promotion?: string,
  ): AplicarMovimientoResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);
    const motor = this.motores.get(clave);

    // Partida inexistente (o sin motor asociado, que no debería ocurrir).
    if (!game || !motor) {
      return errorMsg("codigo-invalido");
    }

    // Autorización: el `playerId` debe corresponder a un participante. El color
    // del que mueve se deriva del participante, nunca del cliente (Req 16.4).
    const participante = game.participantes.find(
      (p) => p.playerId === playerId,
    );
    if (!participante) {
      return errorMsg("no-autorizado");
    }

    // Partida ya finalizada: rechazar sin alterar el `fen` (Req 12.3).
    if (game.resultado !== "en-curso") {
      return moveRejected("partida-finalizada");
    }

    // Cumplimiento de turno: comparar el color del participante con el turno
    // autoritativo derivado del motor (Req 12.1, Property 10).
    if (participante.color !== (motor.turn() as Color)) {
      return moveRejected("no-es-tu-turno");
    }

    // Legalidad: `chess.js` v1.x lanza ante un movimiento ilegal; se captura y
    // se trata como ilegal, sin alterar el `fen` autoritativo (Req 12.2, 16.3).
    let resultadoMove: ReturnType<Chess["move"]>;
    try {
      resultadoMove = motor.move({ from, to, promotion });
    } catch {
      return moveRejected("movimiento-ilegal");
    }
    // Defensa adicional: si por cualquier motivo `move` devolviera algo falsy
    // sin lanzar, tratarlo también como ilegal sin haber mutado el estado.
    if (!resultadoMove) {
      return moveRejected("movimiento-ilegal");
    }

    // Movimiento legal y en turno: actualizar el estado autoritativo derivado
    // de la instancia `Chess` (Req 11.2).
    const colorQueMovio = participante.color;
    game.fen = motor.fen();
    game.historial.push(resultadoMove.san);
    game.turno = motor.turn() as Color;
    game.participantes.forEach((p) => {
      if (p.color === colorQueMovio) p.ultimaActividad = this._ahora();
    });

    // Resultado autoritativo: jaque mate (Req 11.4) o tablas (Req 11.5).
    if (motor.isCheckmate()) {
      game.resultado = "jaque-mate";
      game.ganador = colorQueMovio;
    } else if (motor.isDraw()) {
      // `isDraw()` cubre ahogado, material insuficiente, triple repetición y
      // regla de 50 movimientos en `chess.js`.
      game.resultado = "tablas";
      game.ganador = null;
    }

    return {
      type: "state-sync",
      fen: game.fen,
      historial: game.historial,
      turno: game.turno,
      lastMove: {
        from: resultadoMove.from,
        to: resultadoMove.to,
        san: resultadoMove.san,
      },
      jaque: motor.inCheck(),
      resultado: game.resultado,
      ganador: game.ganador,
    };
  }

  // -------------------------------------------------------------------------
  // Rendición, tablas y ciclo de vida de conexión (tarea 13.4)
  // (Req 15.1, 15.2, 15.3, 15.4, 15.5, 14.3, 14.4, 14.5, 14.7, 14.9)
  // -------------------------------------------------------------------------

  /** Color rival del dado (blancas ↔ negras). */
  private rival(color: Color): Color {
    return color === "w" ? "b" : "w";
  }

  /** Clave del temporizador de gracia de un participante concreto. */
  private claveTemporizador(codigo: string, color: Color): string {
    return `${codigo}::${color}`;
  }

  /**
   * Construye el `state-sync` autoritativo exacto de una partida a partir de su
   * estado y su motor. Reutilizado por `reconectar` (14.4/14.6) y por las
   * acciones que difunden el estado completo (rendición/tablas). No incluye
   * `lastMove` porque no procede de un movimiento.
   */
  private construirStateSync(
    game: OnlineGame,
    motor: Chess,
  ): { type: "state-sync" } & StateSyncPayload {
    return {
      type: "state-sync",
      fen: game.fen,
      historial: game.historial,
      turno: game.turno,
      jaque: motor.inCheck(),
      resultado: game.resultado,
      ganador: game.ganador,
    };
  }

  /**
   * Cancela y olvida el temporizador de gracia de un participante, si existe.
   * Idempotente: no hace nada si no hay temporizador pendiente.
   */
  private cancelarTemporizador(codigo: string, color: Color): void {
    const clave = this.claveTemporizador(codigo, color);
    const handle = this.temporizadores.get(clave);
    if (handle !== undefined) {
      this._cancelar(handle);
      this.temporizadores.delete(clave);
    }
  }

  /**
   * Rendición de un jugador (Req 15.1).
   *
   * - `error("codigo-invalido")` si la partida no existe.
   * - `error("no-autorizado")` si el `playerId` no participa (Req 16.4).
   * - `move-rejected("partida-finalizada")` si la partida ya no está en curso
   *   (no se puede rendir dos veces ni tras el final), sin mutar el estado.
   * - En el caso válido: fija `resultado = "rendicion"` y `ganador` = color del
   *   rival, y devuelve un `state-sync` para **ambos** colores (Req 15.1).
   */
  rendirse(codigo: string, playerId: string): AccionResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);
    const motor = this.motores.get(clave);
    if (!game || !motor) {
      return errorMsg("codigo-invalido");
    }

    const participante = game.participantes.find(
      (p) => p.playerId === playerId,
    );
    if (!participante) {
      return errorMsg("no-autorizado");
    }

    if (game.resultado !== "en-curso") {
      return moveRejected("partida-finalizada");
    }

    game.resultado = "rendicion";
    game.ganador = this.rival(participante.color);
    game.ofertaTablasDe = null; // cualquier oferta pendiente queda sin efecto
    participante.ultimaActividad = this._ahora();

    const stateSync = this.construirStateSync(game, motor);
    return {
      mensajes: [
        { para: "w", mensaje: stateSync },
        { para: "b", mensaje: stateSync },
      ],
    };
  }

  /**
   * Oferta de tablas de un jugador (Req 15.2, 15.3).
   *
   * - `error("codigo-invalido")` si la partida no existe.
   * - `error("no-autorizado")` si el `playerId` no participa (Req 16.4).
   * - `move-rejected("partida-finalizada")` si la partida ya no está en curso.
   * - Si ya hay una oferta pendiente, **no** registra una segunda y mantiene la
   *   vigente sin reenviar nada (Req 15.3): devuelve una lista vacía.
   * - En el caso válido: registra `ofertaTablasDe` = color del oferente y
   *   devuelve un `draw-offered` para el **rival** indicando ese color
   *   (Req 15.2).
   */
  ofrecerTablas(codigo: string, playerId: string): AccionResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);
    const motor = this.motores.get(clave);
    if (!game || !motor) {
      return errorMsg("codigo-invalido");
    }

    const participante = game.participantes.find(
      (p) => p.playerId === playerId,
    );
    if (!participante) {
      return errorMsg("no-autorizado");
    }

    if (game.resultado !== "en-curso") {
      return moveRejected("partida-finalizada");
    }

    // Ya hay una oferta pendiente: mantenerla, no registrar una segunda.
    if (game.ofertaTablasDe !== null) {
      return { mensajes: [] };
    }

    game.ofertaTablasDe = participante.color;
    participante.ultimaActividad = this._ahora();

    return {
      mensajes: [
        {
          para: this.rival(participante.color),
          mensaje: { type: "draw-offered", de: participante.color },
        },
      ],
    };
  }

  /**
   * Resolución de una oferta de tablas pendiente (Req 15.4, 15.5).
   *
   * Sólo el jugador que **no** ofreció puede resolverla. `aceptar = true` fija
   * `resultado = "tablas"` y difunde el estado a ambos (Req 15.4); `aceptar =
   * false` elimina la oferta, notifica `draw-declined` al oferente y mantiene la
   * partida en curso sin cambiar el turno (Req 15.5).
   *
   * - `error("codigo-invalido")` si la partida no existe.
   * - `error("no-autorizado")` si el `playerId` no participa (Req 16.4).
   * - `move-rejected("partida-finalizada")` si la partida ya no está en curso.
   * - Si no hay oferta pendiente, o el que resuelve es el propio oferente, no
   *   muta el estado y devuelve una lista vacía (nada que difundir).
   */
  resolverTablas(
    codigo: string,
    playerId: string,
    aceptar: boolean,
  ): AccionResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);
    const motor = this.motores.get(clave);
    if (!game || !motor) {
      return errorMsg("codigo-invalido");
    }

    const participante = game.participantes.find(
      (p) => p.playerId === playerId,
    );
    if (!participante) {
      return errorMsg("no-autorizado");
    }

    if (game.resultado !== "en-curso") {
      return moveRejected("partida-finalizada");
    }

    // Sin oferta pendiente, o el propio oferente intenta resolver: no procede.
    if (
      game.ofertaTablasDe === null ||
      game.ofertaTablasDe === participante.color
    ) {
      return { mensajes: [] };
    }

    const oferente = game.ofertaTablasDe;
    participante.ultimaActividad = this._ahora();

    if (aceptar) {
      // Aceptar: tablas acordadas, se difunde el estado a ambos (Req 15.4).
      game.resultado = "tablas";
      game.ganador = null;
      game.ofertaTablasDe = null;
      const stateSync = this.construirStateSync(game, motor);
      return {
        mensajes: [
          { para: "w", mensaje: stateSync },
          { para: "b", mensaje: stateSync },
        ],
      };
    }

    // Rechazar: eliminar la oferta y notificar al oferente (Req 15.5). El turno
    // y el `fen` autoritativos no cambian.
    game.ofertaTablasDe = null;
    return {
      mensajes: [{ para: oferente, mensaje: { type: "draw-declined" } }],
    };
  }

  /**
   * Reconexión de un participante (Req 14.4, 14.5, 14.6, 14.9).
   *
   * - `error("codigo-expirado")` si la partida no existe (el código ya no es
   *   válido; coherente con el algoritmo del diseño).
   * - `error("no-autorizado")` si el `playerId` no participa (Req 16.4).
   * - En el caso válido: reasocia el socket (marca `conectado = true`), cancela
   *   el temporizador de abandono (Req 14.4), y devuelve el `state-sync` exacto
   *   (mismo `fen` carácter a carácter, `historial` y `turno`; Req 14.6) para el
   *   jugador que reconecta, más un `opponent-reconnected` para el rival
   *   (Req 14.5). Mantener una sola sesión por `playerId` (Req 14.9) es
   *   responsabilidad de la capa de transporte, que cierra el socket anterior;
   *   aquí el estado del participante es único, por lo que reconectar es
   *   idempotente sobre el modelo autoritativo.
   */
  reconectar(codigo: string, playerId: string): ReconectarResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);
    const motor = this.motores.get(clave);
    if (!game || !motor) {
      return errorMsg("codigo-expirado");
    }

    const participante = game.participantes.find(
      (p) => p.playerId === playerId,
    );
    if (!participante) {
      return errorMsg("no-autorizado");
    }

    participante.conectado = true;
    participante.ultimaActividad = this._ahora();
    this.cancelarTemporizador(clave, participante.color);

    return {
      stateSync: this.construirStateSync(game, motor),
      mensajes: [
        {
          para: this.rival(participante.color),
          mensaje: { type: "opponent-reconnected" },
        },
      ],
    };
  }

  /**
   * Marca a un participante como desconectado e inicia el periodo de gracia
   * (Req 14.3, 14.7).
   *
   * De inmediato produce un `opponent-disconnected` con `graceMs` para el rival
   * (Req 14.3) y arranca un temporizador (vía el planificador inyectable) que,
   * si expira sin reconexión, fija `resultado = "abandono"` y produce un
   * `opponent-abandoned` para el rival (Req 14.7). El disparo del temporizador
   * se comunica a la capa de transporte mediante `onAbandono`.
   *
   * Devuelve los mensajes salientes inmediatos (`opponent-disconnected`) o un
   * `error`/`move-rejected` si no procede (partida inexistente, `playerId` no
   * autorizado, o partida ya finalizada). No arranca temporizador cuando la
   * partida ya no está en curso.
   *
   * @param onAbandono Callback que la capa de transporte usa para difundir los
   *   mensajes de abandono cuando el temporizador expira. Recibe la lista de
   *   `Outbound` (típicamente un `opponent-abandoned` para el rival). Opcional
   *   para usos donde el disparo se inspecciona por otros medios en pruebas.
   */
  marcarDesconexion(
    codigo: string,
    playerId: string,
    onAbandono?: (mensajes: Outbound[]) => void,
  ): AccionResultado {
    const clave = normalizarCodigo(codigo);
    const game = this.partidas.get(clave);
    const motor = this.motores.get(clave);
    if (!game || !motor) {
      return errorMsg("codigo-invalido");
    }

    const participante = game.participantes.find(
      (p) => p.playerId === playerId,
    );
    if (!participante) {
      return errorMsg("no-autorizado");
    }

    // Si la partida ya terminó, no hay ciclo de vida de conexión que gestionar.
    if (game.resultado !== "en-curso") {
      return moveRejected("partida-finalizada");
    }

    participante.conectado = false;
    participante.ultimaActividad = this._ahora();

    const color = participante.color;
    const rival = this.rival(color);

    // Reemplazar cualquier temporizador previo de este color (idempotencia).
    this.cancelarTemporizador(clave, color);
    const handle = this._programar(() => {
      // Al expirar el periodo de gracia: si el jugador no reconectó y la
      // partida sigue en curso, se da por abandonada (Req 14.7).
      this.temporizadores.delete(this.claveTemporizador(clave, color));
      const actual = this.partidas.get(clave);
      const motorActual = this.motores.get(clave);
      if (!actual || !motorActual) return;
      const p = actual.participantes.find((x) => x.color === color);
      if (!p || p.conectado || actual.resultado !== "en-curso") return;

      actual.resultado = "abandono";
      actual.ganador = rival;
      actual.ofertaTablasDe = null;
      const mensajes: Outbound[] = [
        { para: rival, mensaje: { type: "opponent-abandoned" } },
      ];
      onAbandono?.(mensajes);
    }, GRACE_MS);
    this.temporizadores.set(this.claveTemporizador(clave, color), handle);

    return {
      mensajes: [
        {
          para: rival,
          mensaje: { type: "opponent-disconnected", graceMs: GRACE_MS },
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Seguridad del servidor: validación, rate-limiting, secreto del `playerId`
  // y purga (tarea 13.5). (Req 16.1, 16.2, 16.5, 16.6, 16.7, 16.8)
  // -------------------------------------------------------------------------

  /**
   * Punto de entrada de validación de un mensaje entrante **antes** de
   * procesarlo (Req 16.1). Realiza, en orden:
   *
   * 1. **Validación de forma/campos** con `parseClientMessage` (unión
   *    discriminada por `type`). Un mensaje malformado (falta `type`, `type`
   *    desconocido, campos ausentes/incorrectos o claves ajenas) se descarta y
   *    devuelve `error("codigo-invalido")` **sin mutar el estado**
   *    (Req 16.2). No se reutiliza ni se duplica ningún validador: se delega en
   *    los type guards de `onlineProtocol.ts`.
   * 2. **Rate-limiting** con el `RateLimiter` compartido (Req 16.6/16.7). Las
   *    acciones que consumen cuota (`create`/`join`/`reconnect`/`move`) se
   *    contabilizan por la `ctx` (conexión/IP). Si se excede algún límite, se
   *    devuelve `error("no-autorizado")` sin procesar el mensaje ni mutar el
   *    estado. Las acciones sin cuota (rendición, tablas, chat) no se limitan
   *    aquí.
   *
   * En el caso válido devuelve `{ type: "ok", mensaje }` con el `ClientMessage`
   * ya tipado; la capa de transporte lo despacha al método puro correspondiente
   * (`crearPartida`/`unirse`/`aplicarMovimiento`/...). Este método **no** ejecuta
   * la acción: separa la validación/limitación (transversal) de la lógica de
   * juego (pura), manteniendo ambas comprobables por separado.
   *
   * @param mensaje Valor desconocido recibido por el canal (aún sin validar).
   * @param ctx Contexto de conexión (id de socket e IP) para el rate-limiting.
   */
  procesarMensaje(
    mensaje: unknown,
    ctx: ConexionCtx = {},
  ): ProcesarMensajeResultado {
    // 1) Forma/campos: descartar malformados sin mutar estado (Req 16.1/16.2).
    const parsed = parseClientMessage(mensaje);
    if (parsed === null) {
      return errorMsg("codigo-invalido");
    }

    // 2) Rate-limiting de las acciones que consumen cuota (Req 16.6/16.7).
    if (this.esAccionLimitada(parsed.type)) {
      const permitido = this.limitador.permitir(
        parsed.type as RateLimitedAction,
        ctx,
      );
      if (!permitido) {
        return errorMsg("no-autorizado");
      }
    }

    return { type: "ok", mensaje: parsed };
  }

  /** Indica si un `type` de mensaje entrante está sujeto a rate-limiting. */
  private esAccionLimitada(
    tipo: ClientMessageType,
  ): tipo is RateLimitedAction {
    return (
      tipo === "create" ||
      tipo === "join" ||
      tipo === "reconnect" ||
      tipo === "move"
    );
  }

  /**
   * Comprueba/registra una acción en el rate-limiter directamente (Req
   * 16.6/16.7), sin pasar por `procesarMensaje`. Útil para la capa de
   * transporte que ya tiene el mensaje tipado, y para las pruebas. Devuelve
   * `true` si la acción está permitida (y queda registrada) o `false` si
   * excede el límite.
   */
  permitirAccion(accion: RateLimitedAction, ctx: ConexionCtx = {}): boolean {
    return this.limitador.permitir(accion, ctx);
  }

  /**
   * Devuelve una vista del participante **segura para difundir al rival**: la
   * misma información de estado (`color`, `conectado`, `ultimaActividad`) pero
   * **sin** el `playerId` secreto (Req 16.5). La capa de transporte debe usar
   * esta proyección para cualquier dato de un participante que envíe al rival;
   * el `playerId` sólo se incluye en los mensajes `created`/`joined` dirigidos
   * al **propio** jugador. Nunca exponer directamente `Participant.playerId` en
   * un mensaje destinado a otro jugador.
   */
  vistaPublicaParticipante(p: Participant): Omit<Participant, "playerId"> {
    // Se desestructura explícitamente para descartar `playerId` (el resto son
    // datos públicos del participante). No muta el participante original.
    const { playerId: _secreto, ...publico } = p;
    void _secreto; // el descarte del secreto es intencional (Req 16.5).
    return publico;
  }

  /**
   * Asegura que un `ServerMessage` saliente hacia el **rival** no contiene el
   * `playerId` de ningún jugador (Req 16.5). Los únicos mensajes del protocolo
   * que llevan `playerId` son `created`/`joined`, que van dirigidos al propio
   * jugador; ningún mensaje difundido al rival debe llevarlo. Este helper actúa
   * como aserción de invariante para la capa de transporte: lanza si detecta un
   * `playerId` en un mensaje marcado para el rival, evitando fugas por error.
   */
  assertSinPlayerIdParaRival(mensaje: ServerMessage): ServerMessage {
    if (
      typeof (mensaje as { playerId?: unknown }).playerId !== "undefined"
    ) {
      throw new Error(
        `Fuga de playerId: el mensaje "${mensaje.type}" no debe enviarse al rival (Req 16.5).`,
      );
    }
    return mensaje;
  }

  /**
   * Purga del registro las partidas **finalizadas** o **inactivas** durante al
   * menos `PURGE_INACTIVE_MS` (30 min), invalidando su código (Req 16.8), y
   * cancela cualquier temporizador de gracia pendiente de esas partidas.
   *
   * Una partida es purgable si:
   * - su `resultado` ya no es `"en-curso"` (finalizada por mate/tablas/
   *   rendición/abandono), **o**
   * - su actividad más reciente es anterior a `ahora - PURGE_INACTIVE_MS`. La
   *   actividad se toma como el máximo de `ultimaActividad` entre participantes
   *   (o `creadaEn` si aún no hay actividad registrada).
   *
   * Nota: las partidas **finalizadas** se purgan de inmediato (su código deja
   * de servir), coherente con "cuando una partida finaliza ... la purga". Si en
   * el futuro se desea conservar las finalizadas durante una ventana de
   * cortesía, bastaría con exigir también la condición de inactividad para
   * ellas.
   *
   * @param ahora Marca temporal (epoch ms) a usar como "ahora"; por defecto el
   *   reloj inyectable del servidor. Parámetro explícito para pruebas
   *   deterministas.
   * @returns El número de partidas purgadas.
   */
  purgar(ahora: number = this._ahora()): number {
    const limite = ahora - PURGE_INACTIVE_MS;
    let purgadas = 0;

    for (const [clave, game] of this.partidas) {
      const finalizada = game.resultado !== "en-curso";
      const ultima = this.ultimaActividadDe(game);
      const inactiva = ultima < limite;

      if (finalizada || inactiva) {
        // Cancelar los temporizadores de gracia de ambos colores, si existen.
        this.cancelarTemporizador(clave, "w");
        this.cancelarTemporizador(clave, "b");
        this.partidas.delete(clave);
        this.motores.delete(clave);
        purgadas += 1;
      }
    }

    return purgadas;
  }

  /**
   * Actividad más reciente de una partida (epoch ms): el máximo de
   * `ultimaActividad` entre sus participantes, o `creadaEn` si no hay ninguna
   * marca más reciente. Base para decidir la inactividad en `purgar` (16.8).
   */
  private ultimaActividadDe(game: OnlineGame): number {
    return game.participantes.reduce(
      (max, p) => Math.max(max, p.ultimaActividad),
      game.creadaEn,
    );
  }

  /**
   * Elimina todas las partidas del registro y cancela cualquier temporizador
   * pendiente. Utilidad para pruebas y para el ciclo de vida del proceso.
   * También reinicia el estado del rate-limiter.
   */
  reset(): void {
    for (const handle of this.temporizadores.values()) {
      this._cancelar(handle);
    }
    this.temporizadores.clear();
    this.partidas.clear();
    this.motores.clear();
    this.limitador.reset();
  }
}

// ---------------------------------------------------------------------------
// Instancia por defecto + envoltorios a nivel de módulo (firmas del diseño)
// ---------------------------------------------------------------------------

/**
 * Instancia por defecto usada por la capa de transporte del proceso servidor.
 * Las pruebas deben crear su propia instancia de `GameServer` para aislar el
 * estado en memoria.
 */
export const defaultGameServer = new GameServer();

/** Crea una partida en el servidor por defecto (ver `GameServer.crearPartida`). */
export function crearPartida(): OnlineGame {
  return defaultGameServer.crearPartida();
}

/** Une a un jugador en el servidor por defecto (ver `GameServer.unirse`). */
export function unirse(codigo: string): UnirseResultado {
  return defaultGameServer.unirse(codigo);
}

/**
 * Aplica un movimiento en el servidor por defecto
 * (ver `GameServer.aplicarMovimiento`).
 */
export function aplicarMovimiento(
  codigo: string,
  playerId: string,
  from: string,
  to: string,
  promotion?: string,
): AplicarMovimientoResultado {
  return defaultGameServer.aplicarMovimiento(
    codigo,
    playerId,
    from,
    to,
    promotion,
  );
}

/** Rinde una partida en el servidor por defecto (ver `GameServer.rendirse`). */
export function rendirse(codigo: string, playerId: string): AccionResultado {
  return defaultGameServer.rendirse(codigo, playerId);
}

/** Ofrece tablas en el servidor por defecto (ver `GameServer.ofrecerTablas`). */
export function ofrecerTablas(
  codigo: string,
  playerId: string,
): AccionResultado {
  return defaultGameServer.ofrecerTablas(codigo, playerId);
}

/**
 * Resuelve una oferta de tablas en el servidor por defecto
 * (ver `GameServer.resolverTablas`).
 */
export function resolverTablas(
  codigo: string,
  playerId: string,
  aceptar: boolean,
): AccionResultado {
  return defaultGameServer.resolverTablas(codigo, playerId, aceptar);
}

/** Reconecta a un jugador en el servidor por defecto (ver `GameServer.reconectar`). */
export function reconectar(
  codigo: string,
  playerId: string,
): ReconectarResultado {
  return defaultGameServer.reconectar(codigo, playerId);
}

/**
 * Marca una desconexión en el servidor por defecto
 * (ver `GameServer.marcarDesconexion`).
 */
export function marcarDesconexion(
  codigo: string,
  playerId: string,
  onAbandono?: (mensajes: Outbound[]) => void,
): AccionResultado {
  return defaultGameServer.marcarDesconexion(codigo, playerId, onAbandono);
}

/**
 * Valida y limita un mensaje entrante en el servidor por defecto
 * (ver `GameServer.procesarMensaje`).
 */
export function procesarMensaje(
  mensaje: unknown,
  ctx: ConexionCtx = {},
): ProcesarMensajeResultado {
  return defaultGameServer.procesarMensaje(mensaje, ctx);
}

/**
 * Purga partidas finalizadas/inactivas del servidor por defecto
 * (ver `GameServer.purgar`).
 */
export function purgar(ahora?: number): number {
  return defaultGameServer.purgar(ahora);
}
