/**
 * Capa de persistencia local (`localStorage`) de ONCE Chess.
 *
 * Este módulo es la única puerta de acceso a `localStorage` desde el cliente.
 * Toda lectura pasa por un parser tolerante a fallos (`readJson`) que nunca
 * lanza, y las escrituras se centralizan en `writeJson`. Las claves están
 * versionadas para permitir migraciones futuras sin corromper datos antiguos.
 *
 * Responsabilidades cubiertas por esta base (Task 3.1):
 * - `STORAGE_KEYS`: claves versionadas de cada colección.
 * - `readJson`: parser tolerante que devuelve el `fallback` ante ausencia de
 *   clave, JSON inválido, esquema no válido, versión no coincidente o entorno
 *   servidor (`window === undefined`).
 * - `writeJson`: helper de escritura reutilizable (devuelve si tuvo éxito).
 * - `isValidFen`: validación de FEN mediante `chess.js`.
 *
 * Las funciones de más alto nivel (Settings, RecentPosition, Annotation) se
 * añaden sobre esta base en subtareas posteriores (3.3, 3.5, 3.7) reutilizando
 * estos primitivos.
 *
 * Referencias de requisitos: 5.1, 5.2, 5.3, 5.5, 6.5.
 */

import { Chess } from "chess.js";

/**
 * Claves versionadas de `localStorage`. El sufijo `.vN` permite migrar el
 * esquema en el futuro sin colisionar con datos previos: al subir de versión
 * se define una clave nueva y la anterior deja de leerse (equivale a devolver
 * el valor por defecto para la nueva versión).
 */
export const STORAGE_KEYS = {
  settings: "once-chess.settings.v1",
  recentFens: "once-chess.recent-fens.v1",
  annotations: "once-chess.annotations.v1",
  lastOnlineGame: "once-chess.last-online-game.v1",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Predicado de validación de esquema. Debe devolver `true` sólo si el valor
 * ya parseado cumple la forma esperada por el llamador. Actúa como type guard
 * para estrechar `unknown` a `T`.
 */
export type SchemaValidator<T> = (value: unknown) => value is T;

/**
 * Indica si el código se ejecuta en un entorno con `localStorage` disponible.
 * En servidor (SSR/SSG) `window` es `undefined`, por lo que debemos devolver
 * los valores por defecto sin tocar el almacenamiento (Requisito 5.2).
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Lee y parsea de forma tolerante el valor asociado a `key`.
 *
 * Nunca lanza. Devuelve `fallback` cuando:
 * - Se ejecuta en servidor (`window === undefined`).
 * - La clave no existe.
 * - El contenido no es JSON válido.
 * - El acceso a `localStorage` lanza (p. ej. modo privado restringido).
 * - El resultado parseado no supera `validate` (esquema o versión inválidos).
 *
 * @param key Clave versionada a leer.
 * @param fallback Valor por defecto devuelto ante cualquier fallo.
 * @param validate Type guard que confirma la forma del valor parseado.
 * @returns El valor validado, o `fallback`.
 */
export function readJson<T>(
  key: StorageKey,
  fallback: T,
  validate: SchemaValidator<T>,
): T {
  // Requisito 5.2: en servidor no se accede a localStorage.
  if (!isBrowser()) {
    return fallback;
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // El acceso a getItem puede lanzar en algunos entornos restringidos.
    return fallback;
  }

  // Requisito 5.1: ausencia de clave → valor por defecto.
  if (raw === null) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Requisito 5.1: JSON sintácticamente inválido → valor por defecto.
    return fallback;
  }

  // Requisitos 5.1 y 5.5: esquema no válido o versión no coincidente → default.
  try {
    if (!validate(parsed)) {
      return fallback;
    }
  } catch {
    // Un validador defensivo nunca debería lanzar, pero lo blindamos igual.
    return fallback;
  }

  return parsed;
}

/**
 * Escribe `value` serializado en `key`. Helper reutilizable por las funciones
 * de más alto nivel (Settings/RecentPosition/Annotation).
 *
 * Nunca lanza: captura `QuotaExceededError` y cualquier otra excepción de
 * escritura/serialización y devuelve `false` para que el llamador decida cómo
 * anunciar el fallo (el manejo de cuota y el mensaje de error corresponden a
 * subtareas posteriores). En servidor devuelve `false` sin intentar escribir.
 *
 * @returns `true` si la escritura tuvo éxito; `false` en caso contrario.
 */
export function writeJson<T>(key: StorageKey, value: T): boolean {
  if (!isBrowser()) {
    return false;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Elimina la clave indicada del almacenamiento. Nunca lanza.
 */
export function removeKey(key: StorageKey): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Silencioso por diseño: la limpieza no debe romper la interfaz.
  }
}

/**
 * Valida un FEN según la regla del diseño: se acepta si y sólo si
 * `new Chess(fen)` no lanza (Requisito 6.5).
 *
 * @param fen Cadena candidata a FEN.
 * @returns `true` si `fen` es una cadena que produce una posición válida.
 */
export function isValidFen(fen: unknown): fen is string {
  if (typeof fen !== "string") {
    return false;
  }
  try {
    // chess.js lanza si el FEN no es válido; no necesitamos la instancia.
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- *
 * Settings (Task 3.3)
 *
 * Ajustes de accesibilidad persistidos en `once-chess.settings.v1`.
 * Toda lectura pasa por `normalizeSettings`, de modo que la persistencia es
 * idempotente: `loadSettings(saveSettings(s))` devuelve el mismo objeto tras
 * normalización (Propiedad 1). `voiceRate` siempre queda en `[0.5, 2.0]`
 * (Propiedad 6). `saveSettings` nunca lanza y expone una señal de fallo para
 * que el proveedor anuncie el mensaje de cuota (Requisitos 4.5, 4.6, 5.4, 5.6).
 * ------------------------------------------------------------------------- */

/**
 * Ajustes de accesibilidad de ONCE Chess (design.md, Modelo 1).
 * - `voiceRate`: velocidad de la voz sintetizada, rango `[0.5, 2.0]`.
 * - `showPawnLetter`: muestra la letra "P" en los peones (Braille B8).
 * - `highContrast`: activa el tema de alto contraste (`data-contrast="high"`).
 * - `speechEnabled`: permite silenciar por completo la realimentación por voz.
 */
export type Settings = {
  voiceRate: number;
  showPawnLetter: boolean;
  highContrast: boolean;
  speechEnabled: boolean;
};

/**
 * Valores por defecto de los ajustes. `voiceRate` neutro (1.0), letra de peón
 * y alto contraste desactivados, voz habilitada para que el usuario reciba
 * realimentación desde el primer momento (Requisito 4.6, 8.6).
 */
export const DEFAULT_SETTINGS: Settings = {
  voiceRate: 1.0,
  showPawnLetter: false,
  highContrast: false,
  speechEnabled: true,
};

/** Límites del rango de velocidad de voz (Requisito 4.5, Propiedad 6). */
const VOICE_RATE_MIN = 0.5;
const VOICE_RATE_MAX = 2.0;

/**
 * Recorta (clamp) `voiceRate` al rango `[0.5, 2.0]`. Cualquier valor no
 * numérico (incluido `NaN`, `Infinity`, `null`, cadenas o `undefined`) se
 * sustituye por el valor por defecto `1.0` (Requisitos 4.5, 4.6).
 *
 * La función es determinista e idempotente: un valor ya normalizado se
 * devuelve sin cambios, condición necesaria para la persistencia idempotente
 * (Propiedad 1).
 */
function normalizeVoiceRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.voiceRate;
  }
  if (value < VOICE_RATE_MIN) {
    return VOICE_RATE_MIN;
  }
  if (value > VOICE_RATE_MAX) {
    return VOICE_RATE_MAX;
  }
  return value;
}

/**
 * Normaliza un booleano de ajustes. Los valores que no son booleanos válidos
 * se reemplazan por el valor por defecto correspondiente (Requisito 4 / Modelo
 * 1: "los booleanos no válidos → valor por defecto").
 */
function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Normaliza un objeto de ajustes potencialmente parcial o corrupto a un
 * `Settings` completo y válido. Nunca lanza. Se aplica tanto al leer como al
 * escribir, de modo que la representación persistida es siempre la forma
 * canónica y la persistencia resulta idempotente (Propiedad 1).
 *
 * @param value Valor de origen desconocido (parseado de `localStorage` o
 *   provisto por el llamador).
 * @returns Un `Settings` normalizado campo a campo.
 */
export function normalizeSettings(value: unknown): Settings {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    voiceRate: normalizeVoiceRate(source.voiceRate),
    showPawnLetter: normalizeBoolean(
      source.showPawnLetter,
      DEFAULT_SETTINGS.showPawnLetter,
    ),
    highContrast: normalizeBoolean(
      source.highContrast,
      DEFAULT_SETTINGS.highContrast,
    ),
    speechEnabled: normalizeBoolean(
      source.speechEnabled,
      DEFAULT_SETTINGS.speechEnabled,
    ),
  };
}

/**
 * Type guard de esquema para `readJson`. Se acepta cualquier objeto no nulo:
 * la normalización posterior (`normalizeSettings`) se encarga de completar o
 * corregir campos individuales, por lo que basta con descartar valores que ni
 * siquiera son objetos (Requisitos 5.1, 5.5). Los datos corruptos parciales
 * quedan saneados por la normalización en lugar de descartarse por completo.
 */
function isSettingsShape(value: unknown): value is Partial<Settings> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Carga los ajustes desde `localStorage`, aplicando el parser tolerante y la
 * normalización canónica. Nunca lanza: ante ausencia de clave, JSON inválido,
 * esquema no válido o entorno servidor, devuelve `DEFAULT_SETTINGS`
 * normalizados (Requisitos 5.1, 5.2, 5.5).
 *
 * @returns Un `Settings` siempre válido y normalizado.
 */
export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(
    STORAGE_KEYS.settings,
    DEFAULT_SETTINGS,
    isSettingsShape,
  );
  return normalizeSettings(raw);
}

/**
 * Resultado de una operación de guardado. `ok` indica si la escritura en
 * `localStorage` tuvo éxito. Cuando falla, `error` describe el motivo para que
 * el proveedor de ajustes anuncie el mensaje accesible sin volver a
 * inspeccionar el almacenamiento (Requisitos 4.4, 5.4).
 */
export type SaveResult = {
  ok: boolean;
  /** Mensaje accesible listo para anunciar cuando `ok === false`. */
  error?: string;
};

/**
 * Mensaje accesible que debe anunciarse cuando el guardado de ajustes falla
 * (Requisito 5.4). Exportado para que el proveedor lo reutilice sin duplicar
 * la cadena.
 */
export const SETTINGS_SAVE_ERROR_MESSAGE =
  "No se pudieron guardar los cambios en este dispositivo.";

/**
 * Persiste los ajustes tras normalizarlos. Nunca lanza: `writeJson` captura
 * `QuotaExceededError` y cualquier otra excepción y devuelve `false`; en ese
 * caso `saveSettings` conserva el estado en memoria del llamador (no muta nada)
 * y expone la señal de error para anunciar el mensaje de cuota (Requisitos 5.4,
 * 5.6, 4.4).
 *
 * Se normaliza antes de escribir para garantizar que lo persistido es la forma
 * canónica: así `loadSettings()` posterior devuelve un objeto igual campo a
 * campo (persistencia idempotente, Propiedad 1).
 *
 * @param settings Ajustes a persistir (se normalizan internamente).
 * @returns `{ ok: true }` si la escritura tuvo éxito; en caso contrario
 *   `{ ok: false, error }` con el mensaje accesible.
 */
export function saveSettings(settings: Settings): SaveResult {
  const normalized = normalizeSettings(settings);
  const ok = writeJson(STORAGE_KEYS.settings, normalized);
  if (ok) {
    return { ok: true };
  }
  return { ok: false, error: SETTINGS_SAVE_ERROR_MESSAGE };
}

/* ------------------------------------------------------------------------- *
 * RecentPosition (Task 3.5)
 *
 * Historial de posiciones FEN abiertas recientemente, persistido en
 * `once-chess.recent-fens.v1`. Se comporta como una caché LRU acotada a 10
 * entradas: la más reciente ocupa el índice 0 y, al superar la capacidad, se
 * descarta la más antigua (Requisito 6.4). Cada FEO se valida con `isValidFen`
 * antes de persistir (Requisitos 6.2, 6.5) y se deduplica por `fen` exacto,
 * "moviendo al frente" la posición ya conocida (Requisito 6.3). El `label` se
 * recorta a 80 caracteres (Requisito 6.6) y cada entrada recibe un `id` único
 * no vacío y una marca de tiempo `savedAt` (Requisito 6.1).
 *
 * Referencias de requisitos: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7 (Propiedades 2/3/4
 * verificadas por la subtarea 3.6).
 * ------------------------------------------------------------------------- */

/**
 * Posición FEN reciente (design.md, Modelo 2).
 * - `id`: identificador único no vacío (`${Date.now()}-${rand}` o `uuid`).
 * - `fen`: cadena FEN válida (`new Chess(fen)` no lanza).
 * - `label`: etiqueta legible, recortada a 80 caracteres.
 * - `savedAt`: marca de tiempo de creación en epoch ms.
 */
export type RecentPosition = {
  id: string;
  fen: string;
  label: string;
  savedAt: number;
};

/** Capacidad máxima de la lista LRU de posiciones recientes (Requisito 6.4). */
const RECENT_FENS_MAX = 10;

/** Longitud máxima de `label` antes de persistir (Requisito 6.6). */
const RECENT_LABEL_MAX = 80;

/**
 * Type guard de una entrada `RecentPosition` cruda. Sólo se aceptan objetos
 * con los cuatro campos en su tipo primitivo esperado; cualquier entrada que
 * no cumpla se descarta al leer (tolerancia a corrupción, Requisito 5.1).
 */
function isRecentPosition(value: unknown): value is RecentPosition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.fen === "string" &&
    typeof entry.label === "string" &&
    typeof entry.savedAt === "number" &&
    Number.isFinite(entry.savedAt)
  );
}

/**
 * Type guard de esquema para `readJson`: el valor persistido debe ser un array
 * cuyas entradas sean todas `RecentPosition` válidas. Un valor que no sea array
 * o que contenga entradas corruptas se rechaza por completo y `loadRecentFens`
 * devuelve la lista vacía (Requisitos 5.1, 5.5, Propiedad 5).
 */
function isRecentFensShape(value: unknown): value is RecentPosition[] {
  return Array.isArray(value) && value.every(isRecentPosition);
}

/**
 * Carga la lista de posiciones recientes desde `localStorage` a través del
 * parser tolerante. Nunca lanza: ante ausencia de clave, JSON inválido,
 * esquema no válido o entorno servidor, devuelve una lista vacía (Requisitos
 * 5.1, 5.2, 5.5).
 *
 * @returns Un array de `RecentPosition` (posiblemente vacío).
 */
export function loadRecentFens(): RecentPosition[] {
  return readJson<RecentPosition[]>(
    STORAGE_KEYS.recentFens,
    [],
    isRecentFensShape,
  );
}

/**
 * Persiste la lista de posiciones recientes. Nunca lanza: delega en `writeJson`
 * que captura `QuotaExceededError` y cualquier otra excepción y devuelve
 * `false`. Se recorta defensivamente a la capacidad máxima antes de escribir
 * para blindar el invariante de longitud aunque el llamador pase una lista más
 * larga (Requisito 6.4).
 *
 * @param items Lista a persistir (se recorta a las 10 primeras entradas).
 */
export function saveRecentFens(items: RecentPosition[]): void {
  const bounded =
    items.length > RECENT_FENS_MAX ? items.slice(0, RECENT_FENS_MAX) : items;
  writeJson(STORAGE_KEYS.recentFens, bounded);
}

/**
 * Genera un identificador único no vacío para una entrada reciente. Usa
 * `crypto.randomUUID()` cuando está disponible y, si no, recurre a la
 * combinación `${Date.now()}-${random}` descrita en el diseño (Modelo 2).
 */
function newRecentId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Inserta un FEN en la lista de posiciones recientes siguiendo la política LRU
 * con deduplicación (design.md, "Insertar FEN reciente"). Implementa el
 * pseudocódigo al pie de la letra:
 *
 * - Si `fen` es inválido, la lista no cambia y se devuelve tal cual, sin crear
 *   ninguna entrada (Requisito 6.2).
 * - Se elimina cualquier entrada con el mismo `fen` exacto (deduplicación,
 *   Requisito 6.3, Propiedad 3).
 * - La nueva entrada se inserta en el índice 0, con `id` único no vacío,
 *   `savedAt` actual y `label` recortado a 80 caracteres (Requisitos 6.1, 6.6,
 *   Propiedad 4).
 * - La lista resultante se recorta a 10 entradas conservando las más recientes
 *   (Requisito 6.4, Propiedad 2).
 *
 * Nunca lanza. Persiste el resultado mediante `saveRecentFens`.
 *
 * @param fen Cadena candidata a FEN (puede ser válida o no).
 * @param label Etiqueta legible de la posición.
 * @returns La lista actualizada de posiciones recientes (máx. 10 entradas).
 */
export function pushRecentFen(fen: string, label: string): RecentPosition[] {
  // Requisito 6.2: FEN inválido → lista sin cambios.
  if (!isValidFen(fen)) {
    return loadRecentFens();
  }

  const current = loadRecentFens();

  // Deduplicar: quitar cualquier entrada con el mismo FEN (Requisito 6.3).
  const filtered = current.filter((p) => p.fen !== fen);

  const newEntry: RecentPosition = {
    id: newRecentId(),
    fen,
    // Requisito 6.6: recortar label a 80 caracteres.
    label: label.slice(0, RECENT_LABEL_MAX),
    savedAt: Date.now(),
  };

  // Insertar al frente (más reciente primero, índice 0 — Requisito 6.1).
  const merged = [newEntry, ...filtered];

  // Recortar a capacidad máxima conservando las 10 más recientes (Req. 6.4).
  const bounded =
    merged.length > RECENT_FENS_MAX
      ? merged.slice(0, RECENT_FENS_MAX)
      : merged;

  saveRecentFens(bounded);
  return bounded;
}

/**
 * Elimina la posición reciente identificada por `id`, conserva el resto de
 * entradas sin cambios y persiste el resultado (Requisito 6.7). Nunca lanza. Si
 * ningún elemento coincide, la lista se devuelve intacta (y se reescribe sin
 * cambios, lo que resulta idempotente).
 *
 * @param id Identificador de la entrada a eliminar.
 * @returns La lista actualizada de posiciones recientes.
 */
export function removeRecentFen(id: string): RecentPosition[] {
  const current = loadRecentFens();
  const next = current.filter((p) => p.id !== id);
  saveRecentFens(next);
  return next;
}

/* ------------------------------------------------------------------------- *
 * Annotation (Task 3.7)
 *
 * Anotaciones didácticas guardadas por el usuario, persistidas en
 * `once-chess.annotations.v1`. Cada anotación asocia un `title` y una `note`
 * libre a una posición FEN concreta. Toda escritura valida el `fen` con
 * `isValidFen` (rechaza si no es válido, lista sin cambios — Requisito 7.1),
 * exige un `title` no vacío tras `trim()` (Requisito 7.2), recorta `title` a
 * 120 caracteres y `note` a 2000 (Requisito 7.3), admite `note` opcional
 * (`""` por defecto, Requisito 7.4) y asigna un `id` único no vacío más una
 * marca de tiempo `savedAt` (Requisito 7.5). `removeAnnotation(id)` retira la
 * entrada coincidente, conserva el resto y persiste (Requisito 7.7).
 *
 * Sigue los mismos patrones que la capa RecentPosition: type guards estrictos,
 * carga tolerante que devuelve `[]` ante cualquier fallo y persistencia vía
 * `writeJson` (que nunca lanza).
 *
 * Referencias de requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7.
 * ------------------------------------------------------------------------- */

/**
 * Anotación didáctica de una posición (design.md, Modelo 3).
 * - `id`: identificador único no vacío (`crypto.randomUUID()` o fallback).
 * - `fen`: cadena FEN válida (`new Chess(fen)` no lanza).
 * - `title`: título dado por el usuario, no vacío, recortado a 120 caracteres.
 * - `note`: texto libre opcional, recortado a 2000 caracteres (`""` si se omite).
 * - `savedAt`: marca de tiempo de creación en epoch ms.
 */
export type Annotation = {
  id: string;
  fen: string;
  title: string;
  note: string;
  savedAt: number;
};

/**
 * Datos de entrada para crear una anotación. El llamador aporta la posición y
 * el título; `note` es opcional (Requisito 7.4). Los campos `id` y `savedAt`
 * los genera `saveAnnotation`, por lo que no forman parte de la entrada.
 */
export type AnnotationInput = {
  fen: string;
  title: string;
  note?: string;
};

/** Longitud máxima de `title` antes de persistir (Requisito 7.3). */
const ANNOTATION_TITLE_MAX = 120;

/** Longitud máxima de `note` antes de persistir (Requisito 7.3). */
const ANNOTATION_NOTE_MAX = 2000;

/**
 * Type guard de una entrada `Annotation` cruda. Sólo se aceptan objetos con
 * los cinco campos en su tipo primitivo esperado y un `id` no vacío; cualquier
 * entrada que no cumpla se descarta al leer (tolerancia a corrupción,
 * Requisito 5.1).
 */
function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.fen === "string" &&
    typeof entry.title === "string" &&
    typeof entry.note === "string" &&
    typeof entry.savedAt === "number" &&
    Number.isFinite(entry.savedAt)
  );
}

/**
 * Type guard de esquema para `readJson`: el valor persistido debe ser un array
 * cuyas entradas sean todas `Annotation` válidas. Un valor que no sea array o
 * que contenga entradas corruptas se rechaza por completo y `loadAnnotations`
 * devuelve la lista vacía (Requisitos 5.1, 5.5).
 */
function isAnnotationsShape(value: unknown): value is Annotation[] {
  return Array.isArray(value) && value.every(isAnnotation);
}

/**
 * Genera un identificador único no vacío para una anotación. Usa
 * `crypto.randomUUID()` cuando está disponible y, si no, recurre a la
 * combinación `${Date.now()}-${random}` (Requisito 7.5).
 */
function newAnnotationId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Carga la lista de anotaciones desde `localStorage` a través del parser
 * tolerante. Nunca lanza: ante ausencia de clave, JSON inválido, esquema no
 * válido o entorno servidor, devuelve una lista vacía (Requisitos 5.1, 5.2,
 * 5.5).
 *
 * @returns Un array de `Annotation` (posiblemente vacío).
 */
export function loadAnnotations(): Annotation[] {
  return readJson<Annotation[]>(
    STORAGE_KEYS.annotations,
    [],
    isAnnotationsShape,
  );
}

/**
 * Persiste la lista de anotaciones. Nunca lanza: delega en `writeJson`, que
 * captura `QuotaExceededError` y cualquier otra excepción y devuelve `false`.
 * En servidor no escribe.
 *
 * @param items Lista de anotaciones a persistir.
 */
export function saveAnnotations(items: Annotation[]): void {
  writeJson(STORAGE_KEYS.annotations, items);
}

/**
 * Crea y persiste una nueva anotación siguiendo las reglas de validación del
 * diseño (design.md, Modelo 3):
 *
 * - Si `fen` es inválido (`isValidFen` falso), la lista no cambia y se devuelve
 *   tal cual, sin crear ninguna entrada (Requisito 7.1).
 * - Si `title` queda vacío tras `trim()`, la lista no cambia y se devuelve tal
 *   cual (Requisito 7.2).
 * - `title` se recorta a 120 caracteres y `note` a 2000 (Requisito 7.3).
 * - `note` es opcional: si se omite, se persiste como cadena vacía (Req. 7.4).
 * - La entrada recibe un `id` único no vacío y `savedAt` actual (Requisito 7.5)
 *   y se inserta al frente (más reciente primero).
 *
 * Nunca lanza. Persiste el resultado mediante `saveAnnotations`.
 *
 * @param input Posición, título y nota opcional de la anotación.
 * @returns La lista actualizada de anotaciones.
 */
export function saveAnnotation(input: AnnotationInput): Annotation[] {
  const current = loadAnnotations();

  // Requisito 7.1: FEN inválido → lista sin cambios.
  if (!isValidFen(input.fen)) {
    return current;
  }

  // Requisito 7.2: título vacío tras trim → lista sin cambios.
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    return current;
  }

  const newEntry: Annotation = {
    id: newAnnotationId(),
    fen: input.fen,
    // Requisito 7.3: recortar título a 120 caracteres (sobre el ya recortado).
    title: trimmedTitle.slice(0, ANNOTATION_TITLE_MAX),
    // Requisitos 7.3 y 7.4: nota opcional ("" por defecto) recortada a 2000.
    note: (input.note ?? "").slice(0, ANNOTATION_NOTE_MAX),
    savedAt: Date.now(),
  };

  // Insertar al frente (más reciente primero).
  const next = [newEntry, ...current];

  saveAnnotations(next);
  return next;
}

/**
 * Elimina la anotación identificada por `id`, conserva el resto de entradas sin
 * cambios y persiste el resultado (Requisito 7.7). Nunca lanza. Si ningún
 * elemento coincide, la lista se devuelve intacta (y se reescribe sin cambios,
 * lo que resulta idempotente).
 *
 * @param id Identificador de la anotación a eliminar.
 * @returns La lista actualizada de anotaciones.
 */
export function removeAnnotation(id: string): Annotation[] {
  const current = loadAnnotations();
  const next = current.filter((a) => a.id !== id);
  saveAnnotations(next);
  return next;
}
