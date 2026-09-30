import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

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
 * Orden de foco: SkipLink (global) → contenido principal → CTAs del hero.
 */
export default function Home() {
  return (
    <>
      <SiteHeader active="inicio" />

      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-20 px-4 pb-16 outline-none"
      >
        <section aria-labelledby="hero-titulo" className="once-hero">
          <div className="once-hero__board" aria-hidden="true" />
          <div className="once-hero__content">
            <p className="once-brand-hero">ONCE Chess</p>
            <h1
              id="hero-titulo"
              className="once-display max-w-xl text-2xl font-semibold leading-snug text-[color:var(--once-ink)] sm:text-3xl"
            >
              Ajedrez accesible para personas ciegas y con baja visión
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-[color:var(--once-muted)]">
              Diseñado para jugar solo con teclado y voz: cada casilla, pieza y
              movimiento se anuncia en español. Panel, ajustes, tablero libre,
              contra la máquina y en línea: no hace falta ver la pantalla.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/dashboard"
                className="once-btn once-btn-primary once-btn-lg"
              >
                Entrar al panel de ONCE Chess
              </Link>
              <Link href="/tablero" className="once-btn once-btn-lg">
                Abrir el tablero accesible
              </Link>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="caracteristicas-titulo"
          className="flex flex-col gap-6"
        >
          <div className="max-w-2xl space-y-2">
            <p className="once-kicker">Pensado para no ver</p>
            <h2
              id="caracteristicas-titulo"
              className="once-display text-3xl font-semibold text-[color:var(--once-ink)]"
            >
              Características de accesibilidad
            </h2>
            <p className="text-[color:var(--once-muted)]">
              Todo el flujo —inicio, panel, tablero y partida en línea— se
              orienta por landmarks, anuncios en vivo y controles con nombre
              claro.
            </p>
          </div>
          <ul className="once-feature-list">
            <li>
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Anuncios por voz y lector de pantalla
              </h3>
              <p className="text-[color:var(--once-muted)]">
                Regiones <code>aria-live</code> y voz sintetizada anuncian cada
                casilla, movimiento y cambio de estado en español.
              </p>
            </li>
            <li>
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Navegación completa por teclado
              </h3>
              <p className="text-[color:var(--once-muted)]">
                Enlace de salto, flechas en el tablero, Enter o Espacio para
                mover, y orden de tabulación lógico en todas las páginas.
              </p>
            </li>
            <li>
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Alto contraste y movimiento reducido
              </h3>
              <p className="text-[color:var(--once-muted)]">
                Tema de alto contraste activable y respeto de la preferencia
                <code> prefers-reduced-motion</code>.
              </p>
            </li>
            <li>
              <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                Notación Braille B8 y ajustes personales
              </h3>
              <p className="text-[color:var(--once-muted)]">
                Exportación Braille Unicode B8, velocidad de voz configurable y
                posiciones recientes en tu dispositivo.
              </p>
            </li>
          </ul>
        </section>

        <section aria-labelledby="cta-titulo" className="once-cta-band">
          <div className="relative z-[1] flex max-w-2xl flex-col gap-4">
            <h2
              id="cta-titulo"
              className="once-display text-3xl font-semibold text-[color:var(--once-ink)]"
            >
              Empieza a jugar
            </h2>
            <p className="text-[color:var(--once-muted)]">
              Activa la voz en el panel si hace falta. Puedes estudiar en el
              tablero libre, retar a la máquina o crear una partida en línea con
              código deletreado.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/tablero/cpu" className="once-btn once-btn-primary">
                Jugar contra la máquina
              </Link>
              <Link href="/tablero/online/lobby" className="once-btn">
                Crear partida en línea
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
