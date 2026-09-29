import AccessibleChessBoard from "@/components/AccessibleChessBoard";
import { FocusMainOnMount } from "@/components/a11y/FocusMainOnMount";
import { isValidFen } from "@/lib/storage";
import { STARTING_FEN } from "@/utils/onceChessBraille";

/**
 * Ruta `/tablero`: aloja la única instancia de `AccessibleChessBoard` (Req. 2.1).
 * El componente y su lógica de ajedrez no se duplican ni se alteran aquí; esta
 * página sólo resuelve el FEN inicial a partir del parámetro de consulta y
 * gestiona el foco al entrar en la ruta.
 *
 * En el App Router de Next 15+/16 `searchParams` es una promesa, por lo que la
 * página es un Server Component asíncrono.
 */
type TableroPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Extrae el primer valor del parámetro `fen` (una URL puede repetir la clave).
 */
function readFenParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function TableroPage({
  searchParams,
}: TableroPageProps) {
  const { fen } = await searchParams;
  const fenParam = readFenParam(fen);

  // Req. 2.7: sin parámetro `fen` o vacío → posición inicial estándar.
  // Req. 2.6: `fen` presente pero inválido → se conserva la posición inicial
  // válida como punto de partida; el anuncio "FEN inválido" y la omisión de
  // `pushRecentFen` los gestiona el propio tablero (tarea 8.2), al que se le
  // pasa la cadena inválida para que dispare su ruta de FEN inválido.
  const hasFen = typeof fenParam === "string" && fenParam.trim().length > 0;
  const initialFen = hasFen && isValidFen(fenParam) ? fenParam : STARTING_FEN;

  return (
    <main
      id="contenido"
      tabIndex={-1}
      className="flex flex-1 flex-col outline-none"
      aria-label="Tablero de ajedrez accesible"
    >
      <FocusMainOnMount targetId="contenido" />
      <AccessibleChessBoard initialFen={initialFen} />
    </main>
  );
}
