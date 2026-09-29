import Link from "next/link";

/**
 * Landing pública de ONCE Chess (`/`).
 *
 * Server Component estático (sin "use client"): contenido en español que
 * presenta la misión de ajedrez accesible para personas ciegas y ofrece los
 * puntos de entrada al panel (`/dashboard`) y al tablero (`/tablero`).
 *
 * Estructura semántica (landmarks): `header > nav`, `main#contenido`
 * (`tabIndex={-1}`, destino del SkipLink global montado en RootLayout), tres
 * `section[aria-labelledby]` (hero, características, barra de CTA) que refieren
 * el `id` de un encabezado visible propio, y `footer`. Hay exactamente un `h1`.
 *
 * Orden de foco: SkipLink (global) → contenido principal → CTAs.
 */
export default function Home() {
  return (
    <>
      <header className="w-full border-b border-[color:var(--once-ring)] bg-[color:var(--once-panel)]">
        <nav
          aria-label="Navegación principal"
          className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4"
        >
          <span className="text-lg font-bold text-[color:var(--once-ink)]">
            ONCE Chess
          </span>
          <ul className="flex flex-wrap items-center gap-3">
            <li>
              <Link href="/dashboard" className="once-btn">
                Ir al panel
              </Link>
            </li>
            <li>
              <Link href="/tablero" className="once-btn once-btn-primary">
                Jugar al tablero
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-12 outline-none"
      >
        <section
          aria-labelledby="hero-titulo"
          className="flex flex-col gap-6"
        >
          <h1
            id="hero-titulo"
            className="text-3xl font-bold leading-tight text-[color:var(--once-ink)] sm:text-4xl"
          >
            Ajedrez accesible para personas ciegas y con baja visión
          </h1>
          <p className="max-w-2xl text-lg text-[color:var(--once-muted)]">
            ONCE Chess es un tablero de ajedrez pensado desde el primer momento
            para lectores de pantalla, teclado, voz sintetizada y alto
            contraste. Cada movimiento y cada cambio de estado se anuncia en
            español, para que puedas jugar y estudiar sin ayuda vidente.
          </p>
          <p className="max-w-2xl text-base text-[color:var(--once-muted)]">
            Proyecto afiliado a la ONCE y a la Comisión Braille Española, con
            notación Braille Unicode B8.
          </p>
        </section>

        <section
          aria-labelledby="caracteristicas-titulo"
          className="flex flex-col gap-6"
        >
          <h2
            id="caracteristicas-titulo"
            className="text-2xl font-bold text-[color:var(--once-ink)]"
          >
            Características de accesibilidad
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            <li className="rounded-md bg-[color:var(--once-panel)] p-5 shadow-[inset_0_0_0_1px_var(--once-ring)]">
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Anuncios por voz y lector de pantalla
              </h3>
              <p className="mt-2 text-[color:var(--once-muted)]">
                Regiones <code>aria-live</code> y voz sintetizada anuncian cada
                movimiento y cambio de estado en español.
              </p>
            </li>
            <li className="rounded-md bg-[color:var(--once-panel)] p-5 shadow-[inset_0_0_0_1px_var(--once-ring)]">
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Navegación completa por teclado
              </h3>
              <p className="mt-2 text-[color:var(--once-muted)]">
                Enlace de salto, foco visible y orden de tabulación lógico en
                todas las superficies.
              </p>
            </li>
            <li className="rounded-md bg-[color:var(--once-panel)] p-5 shadow-[inset_0_0_0_1px_var(--once-ring)]">
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Alto contraste y movimiento reducido
              </h3>
              <p className="mt-2 text-[color:var(--once-muted)]">
                Tema de alto contraste activable y respeto de la preferencia
                <code> prefers-reduced-motion</code>.
              </p>
            </li>
            <li className="rounded-md bg-[color:var(--once-panel)] p-5 shadow-[inset_0_0_0_1px_var(--once-ring)]">
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Notación Braille B8 y ajustes personales
              </h3>
              <p className="mt-2 text-[color:var(--once-muted)]">
                Piezas en Braille Unicode B8, velocidad de voz configurable y
                posiciones recientes guardadas en tu dispositivo.
              </p>
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="cta-titulo"
          className="flex flex-col gap-6 rounded-md bg-[color:var(--once-panel)] p-6 shadow-[inset_0_0_0_1px_var(--once-ring)]"
        >
          <h2
            id="cta-titulo"
            className="text-2xl font-bold text-[color:var(--once-ink)]"
          >
            Empieza a jugar
          </h2>
          <p className="max-w-2xl text-[color:var(--once-muted)]">
            Entra al panel para gestionar tus ajustes, posiciones recientes y
            anotaciones, o abre directamente el tablero accesible.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/dashboard" className="once-btn once-btn-primary">
              Entrar al panel de ONCE Chess
            </Link>
            <Link href="/tablero" className="once-btn">
              Abrir el tablero accesible
            </Link>
          </div>
        </section>
      </main>

      <footer className="w-full border-t border-[color:var(--once-ring)] bg-[color:var(--once-panel)]">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-[color:var(--once-muted)]">
          <p>
            ONCE Chess · Ajedrez accesible afiliado a la ONCE y a la Comisión
            Braille Española.
          </p>
        </div>
      </footer>
    </>
  );
}
