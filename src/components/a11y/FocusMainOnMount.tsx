"use client";

import { useEffect } from "react";

export type FocusMainOnMountProps = {
  /** `id` del elemento `<main tabIndex={-1}>` al que trasladar el foco. */
  targetId?: string;
};

/**
 * Traslada el foco al `<main id={targetId}>` al entrar en la ruta, para que el
 * lector de pantalla comience desde el contenido principal en lugar de heredar
 * el foco de la página anterior (Req. 2.7 / 3.9 del diseño).
 *
 * Respeta `prefers-reduced-motion`: usa `preventScroll` al enfocar y sólo
 * realiza un desplazamiento animado cuando el usuario no ha pedido reducir el
 * movimiento (`focusMainOnRouteChange` en el pseudocódigo del diseño).
 *
 * No renderiza nada visible; es un ayudante de foco montado dentro del `<main>`.
 */
export function FocusMainOnMount({
  targetId = "contenido",
}: FocusMainOnMountProps) {
  useEffect(() => {
    const main = document.getElementById(targetId);
    if (!main) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    main.focus({ preventScroll: prefersReducedMotion });

    if (!prefersReducedMotion) {
      main.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [targetId]);

  return null;
}
