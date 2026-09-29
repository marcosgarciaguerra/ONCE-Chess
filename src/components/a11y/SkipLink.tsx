export type SkipLinkProps = {
  /** `id` del elemento `<main tabIndex={-1}>` de destino al que saltar. */
  targetId: string;
  /** Texto accesible del enlace. Por defecto "Saltar al contenido principal". */
  label?: string;
};

/**
 * Enlace "Saltar al contenido principal": oculto con `sr-only` salvo cuando
 * recibe el foco por teclado (`:focus-visible`), momento en el que se muestra
 * de forma visible al principio de la página. Es el primer elemento enfocable
 * del orden de tabulación y traslada el foco al `<main id={targetId} tabIndex={-1}>`.
 */
export function SkipLink({
  targetId,
  label = "Saltar al contenido principal",
}: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="once-btn once-btn-primary sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:w-auto focus-visible:h-auto focus-visible:m-0 focus-visible:overflow-visible focus-visible:whitespace-normal focus-visible:[clip:auto]"
    >
      {label}
    </a>
  );
}
