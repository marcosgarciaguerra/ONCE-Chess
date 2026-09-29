/**
 * Código de partida en línea de ONCE Chess.
 *
 * Genera y normaliza códigos legibles y **deletreables en voz** con el formato
 * `PALABRA-PALABRA-NN`, donde cada `PALABRA` proviene de un diccionario curado
 * en español (≥64 entradas, cortas y sin homófonos confusos) y `NN` son dos
 * dígitos en el rango `[2-9]` (se evitan los caracteres confundibles `0`, `O`,
 * `1`, `I`, `L`).
 *
 * Referencias de requisitos:
 * - 9.2: formato `PALABRA-PALABRA-NN`, diccionario ≥64, dígitos sin confundibles.
 * - 9.3: regenerar ante colisión, hasta 100 intentos.
 * - 9.4: agotados los intentos, no se puede asignar código (`CodigoNoDisponibleError`).
 * - 10.3/10.4/10.5: normalización idempotente y robusta a caja/espacios/guiones.
 *
 * NOTA: este archivo pertenece a la tarea 11 (código de partida). La tarea 13.1
 * (servidor autoritativo) sólo consume `generarCodigo` y `normalizarCodigo`. Se
 * mantiene aquí una implementación completa y coherente con la interfaz
 * esperada (`DICCIONARIO_CODIGO`, `generarCodigo`, `normalizarCodigo`,
 * `esCodigoValido`, `CodigoNoDisponibleError`) para que el conjunto compile; si
 * la tarea 11 aporta su propia versión, prevalece esa mientras respete la misma
 * interfaz.
 */

/**
 * Diccionario curado en español: 72 palabras cortas, deletreables y sin
 * homófonos confusos. Todas en mayúsculas y sólo con letras `A-Z`.
 */
export const DICCIONARIO_CODIGO: readonly string[] = [
  "MESA",
  "ROSA",
  "GATO",
  "PERRO",
  "SILLA",
  "LIBRO",
  "PLUMA",
  "NUBE",
  "RIO",
  "MAR",
  "SOL",
  "LUNA",
  "ARBOL",
  "FLOR",
  "CASA",
  "PUERTA",
  "VENTANA",
  "CAMPO",
  "MONTE",
  "VALLE",
  "PLAYA",
  "BARCO",
  "TREN",
  "AVION",
  "COCHE",
  "RUEDA",
  "MOTOR",
  "PIEDRA",
  "ARENA",
  "AGUA",
  "FUEGO",
  "VIENTO",
  "TIERRA",
  "METAL",
  "MADERA",
  "VIDRIO",
  "PAPEL",
  "TINTA",
  "REGLA",
  "COMPAS",
  "MAPA",
  "RELOJ",
  "LLAVE",
  "CANDADO",
  "PUENTE",
  "TORRE",
  "MURO",
  "TEJADO",
  "JARDIN",
  "HUERTO",
  "PRADO",
  "BOSQUE",
  "SENDA",
  "CAMINO",
  "PLAZA",
  "CALLE",
  "FAROL",
  "BANCO",
  "FUENTE",
  "ESTATUA",
  "CUADRO",
  "MARCO",
  "LIENZO",
  "PINCEL",
  "COLOR",
  "MUSICA",
  "PIANO",
  "GUITARRA",
  "TAMBOR",
  "FLAUTA",
  "TROMPETA",
  "CAMPANA",
];

/** Dígitos permitidos: `[2-9]` (se excluyen `0` y `1`, confundibles con `O`/`I`/`L`). */
const DIGITOS = "23456789";

/** Número máximo de intentos para obtener un código único (Req 9.3). */
const MAX_INTENTOS = 100;

/**
 * Error lanzado cuando no es posible asignar un código único tras agotar los
 * intentos (Req 9.4). Quien llama debe rechazar la creación sin crear la
 * partida.
 */
export class CodigoNoDisponibleError extends Error {
  constructor(
    message = "No se pudo asignar un código único para la partida.",
  ) {
    super(message);
    this.name = "CodigoNoDisponibleError";
  }
}

/** Elige un elemento aleatorio de un array no vacío. */
function elegirAleatorio<T>(items: readonly T[]): T {
  const indice = Math.floor(Math.random() * items.length);
  return items[indice];
}

/** Construye un código candidato con el formato `PALABRA-PALABRA-NN`. */
function construirCodigo(): string {
  const palabra1 = elegirAleatorio(DICCIONARIO_CODIGO);
  const palabra2 = elegirAleatorio(DICCIONARIO_CODIGO);
  const d1 = elegirAleatorio(DIGITOS.split(""));
  const d2 = elegirAleatorio(DIGITOS.split(""));
  return `${palabra1}-${palabra2}-${d1}${d2}`;
}

/**
 * Genera un código único con el formato `PALABRA-PALABRA-NN`, distinto de los
 * códigos ya presentes en `existentes`. Reintenta ante colisión hasta
 * `MAX_INTENTOS` veces (Req 9.3). Si agota los intentos, lanza
 * `CodigoNoDisponibleError` (Req 9.4) para que quien llama rechace la creación
 * sin crear la partida.
 */
export function generarCodigo(existentes: Set<string>): string {
  for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
    const codigo = construirCodigo();
    if (!existentes.has(codigo)) {
      return codigo;
    }
  }
  throw new CodigoNoDisponibleError();
}

/**
 * Normaliza una entrada de código: pasa a mayúsculas, recorta espacios,
 * elimina espacios internos y unifica guiones (incluidos guiones múltiples o
 * variantes tipográficas) a un único `-`.
 *
 * Es idempotente: `normalizarCodigo(normalizarCodigo(x)) === normalizarCodigo(x)`
 * (Req 10.4). Dos entradas que sólo difieran en caja, espacios o guiones se
 * resuelven al mismo código (Req 10.5).
 */
export function normalizarCodigo(entrada: string): string {
  return entrada
    .toUpperCase()
    // Unifica cualquier guion tipográfico (– —) a `-`.
    .replace(/[\u2010-\u2015]/g, "-")
    // Elimina todos los espacios (iniciales, finales e internos).
    .replace(/\s+/g, "")
    // Colapsa guiones consecutivos en uno solo.
    .replace(/-+/g, "-")
    // Elimina guiones sobrantes al inicio/fin.
    .replace(/^-|-$/g, "");
}

/**
 * Comprueba que un código (ya normalizado o no) cumple el formato
 * `PALABRA-PALABRA-NN` con palabras del diccionario y dígitos `[2-9]`.
 */
export function esCodigoValido(codigo: string): boolean {
  const normalizado = normalizarCodigo(codigo);
  const partes = normalizado.split("-");
  if (partes.length !== 3) {
    return false;
  }
  const [palabra1, palabra2, digitos] = partes;
  const enDiccionario = (p: string) => DICCIONARIO_CODIGO.includes(p);
  return (
    enDiccionario(palabra1) &&
    enDiccionario(palabra2) &&
    /^[2-9]{2}$/.test(digitos)
  );
}
