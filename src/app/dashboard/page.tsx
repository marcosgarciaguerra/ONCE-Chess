"use client";

/**
 * Dashboard de ONCE Chess (`/dashboard`).
 *
 * Hub operativo accesible tras entrar. Client Component (necesita leer
 * `localStorage`, montar `useAnnouncer` y navegar con `useRouter`) que reúne
 * cuatro secciones etiquetadas —Acceso rápido, Posiciones recientes,
 * Anotaciones guardadas y Ajustes— cada una con encabezado accesible y landmark
 * propio (Req. 3.1).
 *
 * Alcance de la tarea 9.1 (estructura + carga de datos + foco + LiveRegion):
 * - Carga `loadSettings()`, `loadRecentFens()` y `loadAnnotations()` en un
 *   efecto de montaje (client-only; en SSR las lecturas devuelven defaults/[]).
 *   Cada carga va en su propio try/catch: si una falla, esa sección se
 *   renderiza con sus valores por defecto, se anuncia en la `LiveRegion` que no
 *   se pudieron cargar sus datos y NO se muta el almacenamiento (Req. 3.2, 3.3).
 * - Muestra como máximo 10 posiciones recientes y 50 anotaciones, ordenadas de
 *   más reciente a más antigua (Req. 3.2).
 * - Monta una única `LiveRegion` (`aria-live="polite"`, `aria-atomic`) (Req.
 *   3.6), reutiliza el SkipLink global de RootLayout apuntando a `#contenido`
 *   (Req. 3.8) y traslada el foco al `<main>` con `FocusMainOnMount`,
 *   respetando `prefers-reduced-motion` (Req. 3.9, 3.10).
 *
 * Alcance de la tarea 9.2 (acciones, panel de ajustes conectado, borrado):
 * - Abrir posición reciente: cada entrada expone un botón "Abrir" que valida su
 *   FEN con `isValidFen`. Si es válido, navega a `/tablero?fen=<encodeURIComponent>`
 *   con `useRouter().push` (navegación cliente, Req. 3.4). Si es inválido o
 *   ausente, NO navega, anuncia en la `LiveRegion` que la posición no se pudo
 *   abrir y conserva el foco en el control activado (Req. 3.5).
 * - Eliminar recientes/anotaciones por `id`: cada entrada expone un botón
 *   "Eliminar" que invoca `removeRecentFen(id)` / `removeAnnotation(id)`,
 *   actualiza el estado local y anuncia el borrado en la `LiveRegion`
 *   (Req. 6.7, 7.7).
 * - Panel de Ajustes conectado a `useSettings`: controles interactivos para
 *   `voiceRate` (setVoiceRate), `showPawnLetter` (toggleShowPawnLetter),
 *   `highContrast` (toggleHighContrast), `speechEnabled` (toggleSpeech) y un
 *   botón para restablecer (resetSettings). Cada cambio accionable emite un
 *   mensaje no vacío en la `LiveRegion` de forma síncrona (≤500 ms, Req. 3.7,
 *   4.3, 4.9). El proveedor, además, emite la voz. Se expone `saveError` si la
 *   persistencia falla (Req. 4.4).
 *
 * No se usa `dangerouslySetInnerHTML`: título y nota de cada anotación se
 * renderizan como texto plano (Req. 7.6).
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FocusMainOnMount } from "@/components/a11y/FocusMainOnMount";
import { LiveRegion, useAnnouncer } from "@/components/a11y/LiveRegion";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { useSettings } from "@/context/SettingsProvider";
import {
  isValidFen,
  loadAnnotations,
  loadRecentFens,
  removeAnnotation,
  removeRecentFen,
  type Annotation,
  type RecentPosition,
} from "@/lib/storage";

/** Máximo de posiciones recientes mostradas en el dashboard (Req. 3.2). */
const MAX_RECENTS_SHOWN = 10;

/** Máximo de anotaciones mostradas en el dashboard (Req. 3.2). */
const MAX_ANNOTATIONS_SHOWN = 50;

/** Paso de ajuste de la velocidad de voz al usar los botones +/− (Req. 4.5). */
const VOICE_RATE_STEP = 0.1;

/** Límites del rango de velocidad de voz, coherentes con `normalizeSettings`. */
const VOICE_RATE_MIN = 0.5;
const VOICE_RATE_MAX = 2.0;

/**
 * Ordena por `savedAt` de más reciente a más antigua y recorta a `limit`
 * (Req. 3.2). Copia el array antes de ordenar para no mutar la referencia
 * devuelta por la capa de almacenamiento.
 */
function mostRecentFirst<T extends { savedAt: number }>(
  items: T[],
  limit: number,
): T[] {
  return [...items].sort((a, b) => b.savedAt - a.savedAt).slice(0, limit);
}

/** Redondea `voiceRate` a un decimal para evitar arrastre de coma flotante. */
function roundRate(rate: number): number {
  return Math.round(rate * 10) / 10;
}

export default function DashboardPage() {
  const router = useRouter();
  const {
    settings,
    setVoiceRate,
    toggleShowPawnLetter,
    toggleHighContrast,
    toggleSpeech,
    resetSettings,
    saveError,
  } = useSettings();

  // La voz de los anuncios respeta las preferencias vigentes (Req. 8.6/8.7).
  const { message, announce } = useAnnouncer({
    voiceRate: settings.voiceRate,
    speechEnabled: settings.speechEnabled,
  });

  const [recents, setRecents] = useState<RecentPosition[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Req. 3.2/3.3: carga client-only al montar. Cada fuente se carga por
  // separado para que el fallo de una no impida cargar las demás; ante fallo,
  // la sección queda con sus valores por defecto ([]) y se anuncia en vivo sin
  // tocar el almacenamiento. `loadSettings` se consume vía `useSettings`, ya
  // hidratado por `SettingsProvider`.
  useEffect(() => {
    // Cada fuente se resuelve antes de tocar el estado, de modo que el fallo de
    // una no impide cargar la otra (Req. 3.3). El estado por defecto ante fallo
    // es la lista vacía; el almacenamiento no se muta en ningún caso.
    let nextRecents: RecentPosition[];
    let recentsError = false;
    try {
      nextRecents = mostRecentFirst(loadRecentFens(), MAX_RECENTS_SHOWN);
    } catch {
      nextRecents = [];
      recentsError = true;
    }

    let nextAnnotations: Annotation[];
    let annotationsError = false;
    try {
      nextAnnotations = mostRecentFirst(
        loadAnnotations(),
        MAX_ANNOTATIONS_SHOWN,
      );
    } catch {
      nextAnnotations = [];
      annotationsError = true;
    }

    // Hidratación client-only intencional (los datos sólo existen en el
    // navegador), por lo que se establece el estado dentro del efecto tras
    // resolver ambas fuentes.
    /* eslint-disable react-hooks/set-state-in-effect */
    setRecents(nextRecents);
    setAnnotations(nextAnnotations);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Req. 3.3: anunciar en vivo el fallo de carga de cada sección afectada.
    if (recentsError) {
      announce(
        "No se pudieron cargar las posiciones recientes. Se muestran valores por defecto.",
        { speak: false },
      );
    }
    if (annotationsError) {
      announce(
        "No se pudieron cargar las anotaciones guardadas. Se muestran valores por defecto.",
        { speak: false },
      );
    }
  }, [announce]);

  /**
   * Req. 3.4/3.5: abre una posición reciente. Valida el FEN con `isValidFen`
   * antes de navegar. Si es válido, navega a `/tablero?fen=<encodeURIComponent>`
   * con navegación cliente. Si es inválido o ausente, cancela la navegación,
   * anuncia el fallo y deja el foco donde estaba (el botón activado no se
   * re-renderiza, por lo que conserva el foco).
   */
  function handleOpenRecent(recent: RecentPosition): void {
    if (!isValidFen(recent.fen)) {
      // Req. 3.5: no navegar; anunciar y mantener el foco en el control.
      announce(
        "No se pudo abrir la posición: el FEN guardado no es válido.",
      );
      return;
    }
    announce(`Abriendo la posición ${recent.label}.`);
    router.push(`/tablero?fen=${encodeURIComponent(recent.fen)}`);
  }

  /**
   * Req. 6.7: elimina una posición reciente por `id`. Persiste vía
   * `removeRecentFen`, refleja el borrado en el estado local y anuncia en vivo.
   */
  function handleRemoveRecent(recent: RecentPosition): void {
    removeRecentFen(recent.id);
    setRecents((prev) => prev.filter((r) => r.id !== recent.id));
    announce(`Posición reciente eliminada: ${recent.label}.`);
  }

  /**
   * Req. 7.7: elimina una anotación por `id`. Persiste vía `removeAnnotation`,
   * refleja el borrado en el estado local y anuncia en vivo.
   */
  function handleRemoveAnnotation(annotation: Annotation): void {
    removeAnnotation(annotation.id);
    setAnnotations((prev) => prev.filter((a) => a.id !== annotation.id));
    announce(`Anotación eliminada: ${annotation.title}.`);
  }

  // --- Handlers de Ajustes (Req. 3.7/4.3/4.9) --------------------------------
  // Cada handler delega el cambio y la persistencia en `useSettings` (que
  // además emite la realimentación por voz) y, adicionalmente, emite un mensaje
  // no vacío en la `LiveRegion` del dashboard de forma síncrona (≤500 ms). Se
  // pasa `{ speak: false }` para no duplicar la voz que ya emite el proveedor.

  function handleDecreaseVoiceRate(): void {
    const next = roundRate(
      Math.max(VOICE_RATE_MIN, settings.voiceRate - VOICE_RATE_STEP),
    );
    setVoiceRate(next);
    announce(`Velocidad de voz: ${next.toFixed(1)}.`, { speak: false });
  }

  function handleIncreaseVoiceRate(): void {
    const next = roundRate(
      Math.min(VOICE_RATE_MAX, settings.voiceRate + VOICE_RATE_STEP),
    );
    setVoiceRate(next);
    announce(`Velocidad de voz: ${next.toFixed(1)}.`, { speak: false });
  }

  function handleToggleShowPawnLetter(): void {
    const next = !settings.showPawnLetter;
    toggleShowPawnLetter();
    announce(
      `Letra en peones: ${next ? "activada" : "desactivada"}.`,
      { speak: false },
    );
  }

  function handleToggleHighContrast(): void {
    const next = !settings.highContrast;
    toggleHighContrast();
    announce(
      `Alto contraste: ${next ? "activado" : "desactivado"}.`,
      { speak: false },
    );
  }

  function handleToggleSpeech(): void {
    const next = !settings.speechEnabled;
    toggleSpeech();
    announce(
      `Voz: ${next ? "activada" : "desactivada"}.`,
      { speak: false },
    );
  }

  function handleResetSettings(): void {
    resetSettings();
    announce("Ajustes restablecidos a los valores por defecto.", {
      speak: false,
    });
  }

  return (
    <>
      <SiteHeader active="panel" />
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 py-10 outline-none sm:py-14"
        aria-label="Panel de ONCE Chess"
      >
      <FocusMainOnMount targetId="contenido" />

      {/* Req. 3.6: una única región en vivo, polite y atómica. */}
      <LiveRegion message={message} politeness="polite" />

      <header className="flex flex-col gap-3">
        <p className="once-kicker">Panel</p>
        <h1 className="once-display text-4xl font-semibold leading-tight text-[color:var(--once-ink)] sm:text-5xl">
          Panel de ONCE Chess
        </h1>
        <p className="max-w-2xl text-lg text-[color:var(--once-muted)]">
          Accede al tablero, juega contra la máquina o en línea, revisa
          posiciones recientes y ajusta voz, contraste y Braille. Todo el panel
          se usa con teclado y se anuncia por lector de pantalla.
        </p>
      </header>

      {/* Sección 1: Acceso rápido (Req. 3.1) */}
      <section
        aria-labelledby="acceso-rapido-titulo"
        className="flex flex-col gap-4"
      >
        <h2
          id="acceso-rapido-titulo"
          className="once-display text-2xl font-semibold text-[color:var(--once-ink)]"
        >
          Acceso rápido
        </h2>
        <p className="max-w-2xl text-[color:var(--once-muted)]">
          Elige cómo jugar: tablero libre para estudiar, contra la máquina o
          partida en línea. La voz y el lector de pantalla anuncian cada cambio.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="/tablero" className="once-btn once-btn-primary once-btn-lg">
            Abrir el tablero accesible
          </a>
          <a href="/tablero/cpu" className="once-btn once-btn-lg">
            Contra la máquina
          </a>
          <a href="/tablero/online/lobby" className="once-btn once-btn-lg">
            Partida en línea
          </a>
        </div>
      </section>

      {/* Sección 2: Posiciones recientes (Req. 3.1, 3.2, 3.4, 3.5, 6.7) */}
      <section
        aria-labelledby="posiciones-recientes-titulo"
        className="flex flex-col gap-4"
      >
        <h2
          id="posiciones-recientes-titulo"
          className="once-display text-2xl font-semibold text-[color:var(--once-ink)]"
        >
          Posiciones recientes
        </h2>
        {recents.length === 0 ? (
          <p className="once-surface-quiet max-w-2xl p-4 text-[color:var(--once-muted)]">
            Todavía no tienes posiciones recientes. Se guardarán aquí a medida
            que juegues o cargues posiciones en el tablero.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {recents.map((recent) => (
              // `data-fen` deja disponible el FEN para la acción "abrir".
              <li
                key={recent.id}
                data-recent-id={recent.id}
                data-fen={recent.fen}
                className="once-list-item"
              >
                <div>
                  <p className="font-semibold text-[color:var(--once-ink)]">
                    {recent.label}
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-[color:var(--once-muted)]">
                    {recent.fen}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="once-btn once-btn-primary"
                    onClick={() => handleOpenRecent(recent)}
                    aria-label={`Abrir la posición ${recent.label} en el tablero`}
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    className="once-btn"
                    onClick={() => handleRemoveRecent(recent)}
                    aria-label={`Eliminar la posición reciente ${recent.label}`}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sección 3: Anotaciones guardadas (Req. 3.1, 3.2, 7.6, 7.7) */}
      <section
        aria-labelledby="anotaciones-guardadas-titulo"
        className="flex flex-col gap-4"
      >
        <h2
          id="anotaciones-guardadas-titulo"
          className="once-display text-2xl font-semibold text-[color:var(--once-ink)]"
        >
          Anotaciones guardadas
        </h2>
        {annotations.length === 0 ? (
          <p className="once-surface-quiet max-w-2xl p-4 text-[color:var(--once-muted)]">
            Todavía no tienes anotaciones guardadas. Podrás guardar notas
            didácticas asociadas a una posición.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {annotations.map((annotation) => (
              <li
                key={annotation.id}
                data-annotation-id={annotation.id}
                data-fen={annotation.fen}
                className="once-list-item"
              >
                <div>
                  {/* Texto plano, sin dangerouslySetInnerHTML (Req. 7.6). */}
                  <h3 className="text-lg font-semibold text-[color:var(--once-ink)]">
                    {annotation.title}
                  </h3>
                  {annotation.note.trim().length > 0 ? (
                    <p className="mt-1 whitespace-pre-wrap text-[color:var(--once-muted)]">
                      {annotation.note}
                    </p>
                  ) : null}
                  <p className="mt-1 break-all font-mono text-sm text-[color:var(--once-muted)]">
                    {annotation.fen}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="once-btn"
                    onClick={() => handleRemoveAnnotation(annotation)}
                    aria-label={`Eliminar la anotación ${annotation.title}`}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sección 4: Ajustes (Req. 3.1, 3.7, 4.3, 4.9). Controles interactivos
          conectados a `useSettings`; cada cambio anuncia en la LiveRegion. */}
      <section aria-labelledby="ajustes-titulo" className="flex flex-col gap-4">
        <h2
          id="ajustes-titulo"
          className="once-display text-2xl font-semibold text-[color:var(--once-ink)]"
        >
          Ajustes
        </h2>
        <p className="max-w-2xl text-[color:var(--once-muted)]">
          Estos ajustes afectan a todo el sitio: voz sintetizada, contraste y
          notación Braille de peones. Cada cambio se anuncia al instante.
        </p>

        {/* Req. 4.4: superficie el error de guardado si la persistencia falló. */}
        {saveError !== null ? (
          <p
            role="alert"
            className="rounded-[var(--once-radius)] bg-[color:var(--once-panel)] p-4 text-[color:var(--once-ink)] shadow-[inset_0_0_0_2px_var(--once-focus)]"
          >
            {saveError}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Velocidad de voz (Req. 4.5/4.11): botones +/− con clamp [0.5, 2.0]. */}
          <div className="once-setting-tile">
            <p
              id="voice-rate-label"
              className="font-semibold text-[color:var(--once-ink)]"
            >
              Velocidad de voz
            </p>
            <div
              className="flex items-center gap-3"
              role="group"
              aria-labelledby="voice-rate-label"
            >
              <button
                type="button"
                className="once-btn"
                onClick={handleDecreaseVoiceRate}
                disabled={settings.voiceRate <= VOICE_RATE_MIN}
                aria-label="Reducir la velocidad de voz"
              >
                −
              </button>
              <span
                aria-live="off"
                className="min-w-[3ch] text-center font-mono text-[color:var(--once-ink)]"
              >
                {settings.voiceRate.toFixed(1)}
              </span>
              <button
                type="button"
                className="once-btn"
                onClick={handleIncreaseVoiceRate}
                disabled={settings.voiceRate >= VOICE_RATE_MAX}
                aria-label="Aumentar la velocidad de voz"
              >
                +
              </button>
            </div>
          </div>

          {/* Letra en peones (Req. 4.12): botón de alternar con aria-pressed. */}
          <div className="once-setting-tile">
            <p
              id="pawn-letter-label"
              className="font-semibold text-[color:var(--once-ink)]"
            >
              Letra en peones
            </p>
            <button
              type="button"
              className="once-btn self-start"
              aria-pressed={settings.showPawnLetter}
              aria-labelledby="pawn-letter-label"
              onClick={handleToggleShowPawnLetter}
            >
              {settings.showPawnLetter ? "Activada" : "Desactivada"}
            </button>
          </div>

          {/* Alto contraste (Req. 4.7/4.8): botón de alternar con aria-pressed. */}
          <div className="once-setting-tile">
            <p
              id="high-contrast-label"
              className="font-semibold text-[color:var(--once-ink)]"
            >
              Alto contraste
            </p>
            <button
              type="button"
              className="once-btn self-start"
              aria-pressed={settings.highContrast}
              aria-labelledby="high-contrast-label"
              onClick={handleToggleHighContrast}
            >
              {settings.highContrast ? "Activado" : "Desactivado"}
            </button>
          </div>

          {/* Voz (Req. 4.9/4.10): botón de alternar con aria-pressed. */}
          <div className="once-setting-tile">
            <p
              id="speech-enabled-label"
              className="font-semibold text-[color:var(--once-ink)]"
            >
              Voz
            </p>
            <button
              type="button"
              className="once-btn self-start"
              aria-pressed={settings.speechEnabled}
              aria-labelledby="speech-enabled-label"
              onClick={handleToggleSpeech}
            >
              {settings.speechEnabled ? "Activada" : "Desactivada"}
            </button>
          </div>
        </div>

        {/* Restablecer ajustes (Req. 4.13). */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="once-btn"
            onClick={handleResetSettings}
          >
            Restablecer ajustes
          </button>
        </div>
      </section>
    </main>
      <SiteFooter />
    </>
  );
}
