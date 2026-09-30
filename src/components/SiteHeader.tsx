import Link from "next/link";

export type SiteHeaderProps = {
  /** Resalta el destino activo de la navegación (solo visual / aria-current). */
  active?: "inicio" | "panel" | "tablero" | "online" | "cpu";
};

/**
 * Cabecera compartida de ONCE Chess: marca + navegación principal.
 * Conserva el landmark `banner` / `nav` y el nombre accesible
 * «Navegación principal» que esperan las pruebas de la landing.
 */
export function SiteHeader({ active }: SiteHeaderProps) {
  return (
    <header className="once-site-header">
      <nav
        aria-label="Navegación principal"
        className="once-site-header__inner"
      >
        <Link
          href="/"
          className="once-brand-mark"
          aria-label="ONCE Chess, ir al inicio"
          aria-current={active === "inicio" ? "page" : undefined}
        >
          ONCE Chess
        </Link>
        <ul className="once-site-header__links">
          <li>
            <Link
              href="/dashboard"
              className={`once-btn ${active === "panel" ? "once-btn-active" : ""}`}
              aria-current={active === "panel" ? "page" : undefined}
            >
              Ir al panel
            </Link>
          </li>
          <li>
            <Link
              href="/tablero"
              className={`once-btn ${active === "tablero" ? "once-btn-active" : ""}`}
              aria-current={active === "tablero" ? "page" : undefined}
            >
              Jugar al tablero
            </Link>
          </li>
          <li>
            <Link
              href="/tablero/cpu"
              className={`once-btn ${active === "cpu" ? "once-btn-active" : ""}`}
              aria-current={active === "cpu" ? "page" : undefined}
            >
              Contra la máquina
            </Link>
          </li>
          <li>
            <Link
              href="/tablero/online/lobby"
              className={`once-btn once-btn-primary ${active === "online" ? "once-btn-active" : ""}`}
              aria-current={active === "online" ? "page" : undefined}
            >
              Partida en línea
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
