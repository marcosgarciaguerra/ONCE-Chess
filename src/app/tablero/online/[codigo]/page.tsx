import { OnlineGameClient } from "@/components/online/OnlineGameClient";
import { normalizarCodigo } from "@/lib/gameCode";

/**
 * Ruta del modo en línea `/tablero/online/[codigo]` (Componente 6/7 del diseño,
 * tarea 16). El segmento dinámico `[codigo]` es el código de partida
 * compartible: un enlace directo (`/tablero/online/MESA-ROSA-42`) permite unirse
 * a una partida existente; sin código válido, se ofrece crear una nueva desde el
 * lobby.
 *
 * En el App Router de Next 16 los `params` de un segmento dinámico llegan como
 * una **promesa**, por lo que esta página es un Server Component asíncrono
 * mínimo: resuelve el `codigo` de la URL, lo normaliza (mayúsculas, guiones,
 * sin espacios; Req 10.4/10.5) y lo delega a un Client Component
 * (`OnlineGameClient`) que monta el hook `useOnlineGame` y toda la interfaz
 * accesible del modo en línea.
 *
 * Requisitos: 10.1 (unirse por código de la URL), 11.1, 12.5, 13.1, 13.5.
 */
type OnlineGamePageProps = {
  params: Promise<{ codigo: string }>;
};

export default async function OnlineGamePage({
  params,
}: OnlineGamePageProps) {
  const { codigo } = await params;

  // El segmento de ruta viene percent-encoded (p. ej. "MESA-ROSA-42"); se
  // decodifica y se normaliza para tolerar variaciones de caja/guiones. Si el
  // segmento está vacío, se pasa cadena vacía y el cliente mostrará el lobby de
  // creación sin intentar unirse a nada.
  let decodificado = "";
  try {
    decodificado = decodeURIComponent(codigo ?? "");
  } catch {
    decodificado = codigo ?? "";
  }
  const codigoNormalizado = normalizarCodigo(decodificado);

  return <OnlineGameClient codigo={codigoNormalizado} />;
}
