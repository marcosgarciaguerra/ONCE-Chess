/**
 * Prueba de propiedad de anuncio en vivo del dashboard (Task 9.3).
 *
 * **Property 8: Anuncio en vivo** — todo cambio de estado accionable del
 * dashboard produce un mensaje NO vacío (tras `trim()`) en la `LiveRegion`
 * (el párrafo `sr-only` con `aria-live="polite"`).
 *
 * Estrategia: `fast-check` genera una secuencia arbitraria de interacciones de
 * UI accionables sobre el dashboard renderizado y, tras EJECUTAR cada una con
 * `@testing-library/user-event`, se verifica que el texto de la región en vivo
 * es no vacío. Las acciones disponibles se toman del conjunto:
 *
 *  - Alternar un ajuste (letra en peones, alto contraste, voz).
 *  - Subir / bajar la velocidad de voz (+/−).
 *  - Restablecer ajustes.
 *  - Eliminar una posición reciente o una anotación.
 *  - "Abrir" una posición reciente (con FEN válido → navega y anuncia; con FEN
 *    intencionadamente inválido → cancela navegación y anuncia el fallo).
 *
 * Como algunas acciones agotan elementos borrables o desactivan botones +/− por
 * clamp, cada paso re-consulta los controles realmente disponibles en ese
 * momento y elige una acción entre los presentes; si el índice generado cae en
 * una acción no disponible, se salta ese paso (sin romper la propiedad).
 *
 * Entorno: jsdom (Vitest, globals) + Testing Library + user-event. Se envuelve
 * el dashboard en un `SettingsProvider` real; se mockea `useRouter` de
 * `next/navigation` y `speak` de `@/utils/speech`. Se siembra `localStorage`
 * con posiciones recientes (incluida una con FEN inválido) y anotaciones para
 * que esas secciones rendericen controles accionables.
 *
 * **Validates: Requisito 3.7**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";

// Mock del router de Next: el dashboard llama a `useRouter().push` al abrir una
// posición reciente válida. No debe tocar la navegación real en jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock de la voz: los cambios de ajuste pueden invocar `speak`; aquí sólo nos
// interesa el contenido textual de la región en vivo.
vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  ensureVoicesLoaded: vi.fn(() => Promise.resolve([])),
}));

import { STORAGE_KEYS, type Settings } from "@/lib/storage";
import { SettingsProvider } from "@/context/SettingsProvider";
import DashboardPage from "./page";

// FEN válido, posición inicial estándar (cargable por chess.js).
const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Otro FEN válido distinto (tras 1.e4).
const AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
// FEN intencionadamente inválido: la capa de almacenamiento lo persiste (su
// type guard sólo comprueba que `fen` sea string), pero `isValidFen` lo rechaza
// al intentar abrirlo, forzando la rama de anuncio de fallo (Req. 3.5).
const INVALID_FEN = "esto-no-es-un-fen";

/** Siembra ajustes por defecto (voz activada) para controlar el contexto. */
function seedSettings(partial: Partial<Settings> = {}): void {
  const value: Settings = {
    voiceRate: 1.0,
    showPawnLetter: false,
    highContrast: false,
    speechEnabled: true,
    ...partial,
  };
  window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(value));
}

/** Siembra posiciones recientes: dos válidas y una con FEN inválido. */
function seedRecents(): void {
  const recents = [
    { id: "r-valid-1", fen: STARTING_FEN, label: "Posición inicial", savedAt: 3 },
    { id: "r-valid-2", fen: AFTER_E4_FEN, label: "Tras 1.e4", savedAt: 2 },
    { id: "r-invalid", fen: INVALID_FEN, label: "Corrupta", savedAt: 1 },
  ];
  window.localStorage.setItem(
    STORAGE_KEYS.recentFens,
    JSON.stringify(recents),
  );
}

/** Siembra anotaciones válidas. */
function seedAnnotations(): void {
  const annotations = [
    {
      id: "a-1",
      fen: STARTING_FEN,
      title: "Apertura",
      note: "Nota didáctica",
      savedAt: 2,
    },
    {
      id: "a-2",
      fen: AFTER_E4_FEN,
      title: "Peón de rey",
      note: "",
      savedAt: 1,
    },
  ];
  window.localStorage.setItem(
    STORAGE_KEYS.annotations,
    JSON.stringify(annotations),
  );
}

/** Renderiza el dashboard envuelto en un SettingsProvider real. */
function renderDashboard() {
  return render(
    <SettingsProvider>
      <DashboardPage />
    </SettingsProvider>,
  );
}

/** Lee el texto (trim) de la región en vivo polite; "" si está ausente/vacía. */
function liveRegionText(container: HTMLElement): string {
  const region = container.querySelector('[aria-live="polite"]');
  return (region?.textContent ?? "").trim();
}

/**
 * Recolecta los "botones de acción" accionables presentes en este momento.
 * Cada entrada es un HTMLButton que, al pulsarse, provoca un cambio de estado
 * accionable con anuncio en vivo. Se filtran los deshabilitados (p. ej. +/− en
 * el límite de clamp) para no generar clics sin efecto.
 */
function collectActionButtons(container: HTMLElement): HTMLButtonElement[] {
  const all = Array.from(container.querySelectorAll("button"));
  return all.filter(
    (b): b is HTMLButtonElement =>
      b instanceof HTMLButtonElement && !b.disabled,
  );
}

describe("Property 8: Anuncio en vivo del dashboard — Validates: Requisito 3.7", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    // jsdom no implementa `scrollIntoView`; `FocusMainOnMount` lo invoca al
    // trasladar el foco al <main>. Se stubbea para no romper el efecto de
    // montaje (comportamiento no observado por esta propiedad).
    if (typeof Element.prototype.scrollIntoView !== "function") {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    vi.clearAllMocks();
  });

  it(
    "tras CADA interacción accionable, la LiveRegion contiene texto no vacío",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Secuencia de índices; cada índice selecciona (módulo) un botón
          // entre los disponibles en ese instante. Longitud acotada para
          // mantener el tiempo de ejecución razonable con render + user-event.
          fc.array(fc.nat({ max: 1000 }), { minLength: 1, maxLength: 10 }),
          async (indices) => {
            // Estado limpio y reproducible por iteración (fast-check no ejecuta
            // los hooks de `beforeEach` en cada corrida de la propiedad).
            cleanup();
            window.localStorage.clear();
            document.documentElement.removeAttribute("data-contrast");
            seedSettings();
            seedRecents();
            seedAnnotations();

            // `delay: null` elimina la espera artificial de user-event para
            // acelerar la propiedad (muchos clics por corrida).
            const user = userEvent.setup({ delay: null });
            const { container } = renderDashboard();

            // El efecto de montaje carga recientes/anotaciones en estado; se
            // espera a que la sección de recientes renderice sus controles.
            await waitFor(() => {
              expect(collectActionButtons(container).length).toBeGreaterThan(0);
            });

            for (const rawIndex of indices) {
              const buttons = collectActionButtons(container);
              // Si no hubiera botones accionables se salta el paso (los ajustes
              // siempre ofrecen controles, así que en la práctica no ocurre).
              if (buttons.length === 0) {
                continue;
              }
              const target = buttons[rawIndex % buttons.length];

              await user.click(target);

              // Propiedad central: la región en vivo tiene texto no vacío.
              await waitFor(() => {
                expect(liveRegionText(container).length).toBeGreaterThan(0);
              });
            }
          },
        ),
        { numRuns: 20 },
      );
    },
    30000,
  );

  it("abrir la posición reciente con FEN inválido anuncia el fallo (Req. 3.5)", async () => {
    seedSettings();
    seedRecents();
    seedAnnotations();

    const user = userEvent.setup({ delay: null });
    const { container } = renderDashboard();

    // El botón "Abrir" de la entrada corrupta se localiza por su aria-label,
    // una vez la sección de recientes ha renderizado.
    const findAbrirCorrupta = (): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll("button")).find(
        (b) =>
          b.getAttribute("aria-label")?.includes("Corrupta") &&
          b.textContent?.trim() === "Abrir",
      ) as HTMLButtonElement | undefined;

    await waitFor(() => {
      expect(findAbrirCorrupta()).toBeTruthy();
    });

    await user.click(findAbrirCorrupta()!);

    await waitFor(() => {
      expect(liveRegionText(container)).toMatch(/no se pudo abrir la posición/i);
    });
  });
});
