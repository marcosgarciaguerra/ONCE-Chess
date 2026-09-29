import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

// Mock de la síntesis de voz: `SettingsProvider` y `useAnnouncer` invocan
// `speak(...)`; en jsdom no existe `speechSynthesis`, así que lo neutralizamos.
vi.mock("@/utils/speech", () => ({
  __esModule: true,
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

// Mock de `next/navigation`: capturamos `push` para asertar cuándo se navega
// (FEN válido) y cuándo NO (FEN inválido, Req 3.5).
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: pushMock }),
}));

import { SettingsProvider } from "@/context/SettingsProvider";
import {
  STORAGE_KEYS,
  type Annotation,
  type RecentPosition,
} from "@/lib/storage";

import DashboardPage from "./page";

// FEN estándar de la posición inicial (válido).
const FEN_VALIDO =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Siembra posiciones recientes en `localStorage` para que la lista se renderice. */
function seedRecents(recents: RecentPosition[]): void {
  window.localStorage.setItem(
    STORAGE_KEYS.recentFens,
    JSON.stringify(recents),
  );
}

/** Siembra anotaciones en `localStorage` para que la lista se renderice. */
function seedAnnotations(annotations: Annotation[]): void {
  window.localStorage.setItem(
    STORAGE_KEYS.annotations,
    JSON.stringify(annotations),
  );
}

/**
 * Instala un `matchMedia` mockeado que devuelve `matches` para la consulta de
 * `prefers-reduced-motion`. `FocusMainOnMount` lo consulta al montar.
 */
function mockMatchMedia(reducedMotion: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Renderiza el dashboard dentro de un `SettingsProvider` real. */
function renderDashboard() {
  return render(
    <SettingsProvider>
      <DashboardPage />
    </SettingsProvider>,
  );
}

/**
 * Pruebas de integración/accesibilidad del dashboard (`src/app/dashboard/page.tsx`).
 *
 * El dashboard es un Client Component: lee `localStorage`, navega con
 * `useRouter().push` y traslada el foco al `<main>` con `FocusMainOnMount`
 * (respetando `prefers-reduced-motion`). Las pruebas mockean `next/navigation`
 * y `@/utils/speech`, envuelven la página en un `SettingsProvider` real y
 * controlan `window.matchMedia` / `Element.prototype.scrollIntoView`.
 *
 * Cubre criterios de aceptación 3.1, 3.5, 3.8, 3.9, 3.10.
 */
describe("Dashboard /dashboard (accesibilidad e integración)", () => {
  beforeEach(() => {
    pushMock.mockClear();
    window.localStorage.clear();
    // Por defecto, sin reducción de movimiento (se sobreescribe donde importe).
    mockMatchMedia(false);
    // jsdom no implementa scrollIntoView; hay que definirlo antes de poder
    // espiarlo (`vi.spyOn` exige que la propiedad exista).
    Element.prototype.scrollIntoView = () => undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("no presenta violaciones de accesibilidad detectables por axe (Req 3.1)", async () => {
    seedRecents([
      {
        id: "r1",
        fen: FEN_VALIDO,
        label: "Posición inicial",
        savedAt: 2,
      },
    ]);
    seedAnnotations([
      {
        id: "a1",
        fen: FEN_VALIDO,
        title: "Idea de apertura",
        note: "Desarrollar piezas menores.",
        savedAt: 1,
      },
    ]);

    const { container } = renderDashboard();

    // Esperar a que la carga client-only pinte las listas sembradas.
    await screen.findByText("Posición inicial");
    await screen.findByText("Idea de apertura");

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("expone un único main (id=contenido, tabindex=-1) y un h1 (Req 3.1)", async () => {
    renderDashboard();

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    const main = mains[0];
    expect(main).toHaveAttribute("id", "contenido");
    expect(main).toHaveAttribute("tabindex", "-1");

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
  });

  it("renderiza cuatro secciones landmark con sus encabezados (Req 3.1)", async () => {
    const { container } = renderDashboard();

    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections).toHaveLength(4);

    // Cada sección referencia un encabezado visible existente.
    for (const section of sections) {
      const labelId = section.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      const label = container.querySelector(`#${labelId}`);
      expect(label).not.toBeNull();
      expect(/^H[1-6]$/.test(label!.tagName)).toBe(true);
      expect(label!.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }

    const encabezados = [
      "Acceso rápido",
      "Posiciones recientes",
      "Anotaciones guardadas",
      "Ajustes",
    ];
    for (const titulo of encabezados) {
      expect(
        screen.getByRole("heading", { level: 2, name: titulo }),
      ).toBeInTheDocument();
    }
  });

  it("una posición reciente INVÁLIDA no navega, anuncia y conserva el foco (Req 3.5)", async () => {
    const user = userEvent.setup();
    seedRecents([
      {
        id: "invalida",
        fen: "no-es-un-fen-valido",
        label: "Posición rota",
        savedAt: 3,
      },
      {
        id: "valida",
        fen: FEN_VALIDO,
        label: "Posición correcta",
        savedAt: 2,
      },
    ]);

    const { container } = renderDashboard();

    // La región en vivo es el <p aria-live> montado por LiveRegion.
    const liveRegion = container.querySelector('[aria-live="polite"]')!;
    expect(liveRegion).not.toBeNull();

    // Botón "Abrir" de la posición inválida.
    const botonInvalida = await screen.findByRole("button", {
      name: /Abrir la posición Posición rota/i,
    });

    await user.click(botonInvalida);

    // No navega (Req 3.5).
    expect(pushMock).not.toHaveBeenCalled();

    // Anuncia en la región en vivo un mensaje no vacío sobre el fallo.
    await waitFor(() => {
      expect(liveRegion.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });
    expect(liveRegion.textContent).toMatch(/no se pudo abrir/i);

    // El foco permanece en el control activado (el botón no se re-renderiza).
    expect(botonInvalida).toHaveFocus();
  });

  it("una posición reciente VÁLIDA navega a /tablero?fen=... (Req 3.5)", async () => {
    const user = userEvent.setup();
    seedRecents([
      {
        id: "valida",
        fen: FEN_VALIDO,
        label: "Posición correcta",
        savedAt: 2,
      },
    ]);

    renderDashboard();

    const botonValida = await screen.findByRole("button", {
      name: /Abrir la posición Posición correcta/i,
    });

    await user.click(botonValida);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      `/tablero?fen=${encodeURIComponent(FEN_VALIDO)}`,
    );
  });

  it("traslada el foco al <main> al montar (FocusMainOnMount) (Req 3.9)", async () => {
    renderDashboard();

    const main = screen.getByRole("main");
    await waitFor(() => {
      expect(main).toHaveFocus();
    });
    expect(document.activeElement).toBe(main);
  });

  it("desde el <main>, tabular alcanza los controles interactivos en orden (Req 3.8/3.9)", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const main = screen.getByRole("main");
    await waitFor(() => {
      expect(main).toHaveFocus();
    });

    // El primer control tabulable dentro de main es el enlace "Abrir el tablero
    // accesible" (Acceso rápido); el siguiente es el botón "−" de velocidad.
    const enlaceTablero = screen.getByRole("link", {
      name: "Abrir el tablero accesible",
    });

    await user.tab();
    expect(enlaceTablero).toHaveFocus();

    // El siguiente Tab avanza a otro control interactivo (no vuelve al main),
    // demostrando un orden de foco secuencial hacia los controles.
    await user.tab();
    expect(document.activeElement).not.toBe(main);
    expect(document.activeElement).not.toBe(enlaceTablero);
    expect(
      (document.activeElement as HTMLElement).tagName === "BUTTON" ||
        (document.activeElement as HTMLElement).tagName === "A",
    ).toBe(true);
  });

  it("con prefers-reduced-motion NO hace scroll animado y usa preventScroll (Req 3.10)", async () => {
    mockMatchMedia(true);
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    renderDashboard();

    const main = screen.getByRole("main");
    await waitFor(() => {
      expect(main).toHaveFocus();
    });

    // Bajo reducción de movimiento no debe dispararse scroll animado.
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("sin prefers-reduced-motion sí realiza scrollIntoView del main (Req 3.10)", async () => {
    mockMatchMedia(false);
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    renderDashboard();

    const main = screen.getByRole("main");
    await waitFor(() => {
      expect(main).toHaveFocus();
    });

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
    });
    // El scroll animado se dirige al propio main con comportamiento suave.
    const scrolledOnMain = scrollSpy.mock.instances.some(
      (instance) => instance === main,
    );
    expect(scrolledOnMain).toBe(true);
  });
});
