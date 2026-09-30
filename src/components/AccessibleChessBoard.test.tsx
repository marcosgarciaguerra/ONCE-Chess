/**
 * Pruebas del tablero accesible extendido (Task 8.3).
 *
 * Verifican los comportamientos añadidos al integrar el tablero con el contexto
 * de ajustes (`useSettings`) y la capa de persistencia (`pushRecentFen`):
 *
 * - Req. 2.6: montar con un `initialFen` INVÁLIDO no registra la posición
 *   (`pushRecentFen` no se invoca), y cargar un FEN inválido vía `loadFen`
 *   anuncia "FEN inválido" en la región `aria-live` sin registrar nada.
 * - Req. 2.5: completar un movimiento legal (e2→e4) registra exactamente una
 *   vez la posición resultante mediante `pushRecentFen`.
 * - Req. 2.8: `showPawnLetter` proviene del contexto (la casilla "Mostrar P en
 *   peones" refleja el valor sembrado y su cambio invoca el toggle del
 *   contexto); `voiceRate` del contexto se pasa a `speak` al anunciar.
 *
 * Entorno: jsdom (Vitest, globals) + @testing-library/react. Se mockea
 * `@/utils/speech` para observar `speak` sin depender de la Web Speech API y se
 * espía `pushRecentFen` sobre el módulo real `@/lib/storage` (conservando
 * `isValidFen`/`STARTING_FEN` reales). El tablero se envuelve en un
 * `SettingsProvider` real, sembrando `localStorage` antes del render para
 * controlar `voiceRate`/`showPawnLetter`.
 *
 * _Requirements: 2.5, 2.6, 2.8_
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chess } from "chess.js";

// Mock de la voz: capturamos las invocaciones de `speak` para verificar el
// `voiceRate` aplicado sin depender de la Web Speech API.
vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  ensureVoicesLoaded: vi.fn(() => Promise.resolve([])),
}));

import { speak } from "@/utils/speech";
import * as storage from "@/lib/storage";
import { STORAGE_KEYS, type Settings } from "@/lib/storage";
import { STARTING_FEN } from "@/utils/onceChessBraille";
import { SettingsProvider } from "@/context/SettingsProvider";
import AccessibleChessBoard from "./AccessibleChessBoard";

const speakMock = vi.mocked(speak);

// FEN válido, distinto de la posición inicial estándar (para probar el registro
// al montar con posición cargada por URL, Req. 2.5/2.7).
const NON_STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

// FEN sintácticamente inválido (chess.js lanza al construirlo).
const INVALID_FEN = "esto-no-es-un-fen";

/** Semilla la clave de ajustes en `localStorage` para controlar el contexto. */
function seedSettings(partial: Partial<Settings>): void {
  const value: Settings = {
    voiceRate: 1.0,
    showPawnLetter: false,
    highContrast: false,
    speechEnabled: true,
    ...partial,
  };
  window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(value));
}

/** Renderiza el tablero envuelto en un SettingsProvider real. */
function renderBoard(initialFen?: string) {
  return render(
    <SettingsProvider>
      <AccessibleChessBoard initialFen={initialFen} />
    </SettingsProvider>,
  );
}

/** Localiza el botón de una casilla por el prefijo de su aria-label. */
function squareButton(square: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^Casilla ${square},`),
  });
}

describe("AccessibleChessBoard extendido (Task 8.3)", () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    speakMock.mockClear();
    // Espiar `pushRecentFen` en el módulo real; conserva isValidFen/STARTING_FEN.
    pushSpy = vi.spyOn(storage, "pushRecentFen").mockReturnValue([]);
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    vi.restoreAllMocks();
  });

  describe("Registro de posiciones (Req. 2.5, 2.6)", () => {
    // Nota de contrato (Req. 2.6): el componente asume que `initialFen` ya es una
    // posición válida — la ruta `/tablero` (Task 7) sanea el FEN de la URL y, si
    // es inválido, conserva la última posición válida y anuncia el error ANTES de
    // montar el tablero, por lo que el componente nunca recibe un FEN inválido en
    // `initialFen`. Verificamos ese contrato: un `initialFen` sintácticamente
    // inválido no llega a montar (falla en la construcción de `new Chess`), de modo
    // que la protección efectiva vive en la ruta. La rama inválida propia del
    // componente (`loadFen`) se cubre en la prueba siguiente.
    it("un initialFen sintácticamente inválido no es una entrada válida del componente (se sanea en la ruta)", () => {
      // Silenciar el ruido de error de React durante el render que lanza.
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        expect(() => renderBoard(INVALID_FEN)).toThrow(/Invalid FEN/);
        // Al no completarse el render, tampoco se registra ninguna posición.
        expect(pushSpy).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("montar con un initialFen válido distinto de la inicial registra una vez", async () => {
      renderBoard(NON_STARTING_FEN);

      await waitFor(() => {
        expect(pushSpy).toHaveBeenCalledTimes(1);
      });
      const loadedFen = new Chess(NON_STARTING_FEN).fen();
      expect(pushSpy).toHaveBeenCalledWith(loadedFen, expect.any(String));
    });

    it("montar con la posición inicial estándar NO registra (Req. 2.7)", async () => {
      renderBoard(STARTING_FEN);

      await waitFor(() => {
        expect(screen.getByRole("application")).toBeInTheDocument();
      });

      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("cargar un FEN inválido anuncia 'FEN inválido' y no registra", async () => {
      const user = userEvent.setup();
      renderBoard(STARTING_FEN);

      // Montaje con posición inicial: sin registros.
      expect(pushSpy).not.toHaveBeenCalled();

      // Escribir un FEN inválido en el textarea y aplicarlo.
      const textarea = screen.getByLabelText("Cadena FEN");
      await user.clear(textarea);
      await user.type(textarea, INVALID_FEN);
      await user.click(
        screen.getByRole("button", { name: "Aplicar FEN" }),
      );

      // Se anuncia el error en la región aria-live (sr-only) y en el estado.
      await waitFor(() => {
        expect(
          screen.getByText("FEN inválido.", { selector: "p" }),
        ).toBeInTheDocument();
      });

      // La rama inválida de loadFen no invoca pushRecentFen.
      expect(pushSpy).not.toHaveBeenCalled();
    });
  });

  describe("Movimiento legal (Req. 2.5)", () => {
    it("completar un movimiento legal (e2→e4) registra pushRecentFen exactamente una vez", async () => {
      const user = userEvent.setup();
      // Posición inicial: el montaje no registra, así aislamos el movimiento.
      renderBoard(STARTING_FEN);

      expect(pushSpy).not.toHaveBeenCalled();

      // Seleccionar el peón en e2 y moverlo a e4 haciendo clic en las casillas.
      await user.click(squareButton("e2"));
      await user.click(squareButton("e4"));

      await waitFor(() => {
        expect(pushSpy).toHaveBeenCalledTimes(1);
      });

      // El FEN registrado corresponde a la posición tras 1.e4.
      const expected = new Chess(STARTING_FEN);
      expected.move({ from: "e2", to: "e4", promotion: "q" });
      expect(pushSpy).toHaveBeenCalledWith(expected.fen(), expect.any(String));
    });
  });

  describe("Ajustes desde el contexto (Req. 2.8)", () => {
    it("showPawnLetter proviene del contexto: la casilla refleja el valor sembrado", async () => {
      seedSettings({ showPawnLetter: true });
      renderBoard(STARTING_FEN);

      const checkbox = await screen.findByRole("checkbox", {
        name: /Mostrar P en peones/,
      });

      await waitFor(() => {
        expect(checkbox).toBeChecked();
      });
    });

    it("alternar la casilla invoca el toggle del contexto (se refleja tras el cambio)", async () => {
      const user = userEvent.setup();
      seedSettings({ showPawnLetter: false });
      renderBoard(STARTING_FEN);

      const checkbox = await screen.findByRole("checkbox", {
        name: /Mostrar P en peones/,
      });
      await waitFor(() => expect(checkbox).not.toBeChecked());

      await user.click(checkbox);

      // El contexto normaliza/persiste y el nuevo valor se refleja en la UI.
      await waitFor(() => expect(checkbox).toBeChecked());
      // Persistido en el contexto (localStorage vía SettingsProvider).
      await waitFor(() => {
        expect(storage.loadSettings().showPawnLetter).toBe(true);
      });
    });

    it("voiceRate del contexto se pasa a speak al anunciar (mover el cursor)", async () => {
      seedSettings({ voiceRate: 1.7, speechEnabled: true });
      renderBoard(STARTING_FEN);

      // Esperar a que el contexto hidrate el voiceRate sembrado.
      await waitFor(() => {
        expect(storage.loadSettings().voiceRate).toBe(1.7);
      });

      const board = screen.getByRole("application");
      board.focus();
      speakMock.mockClear();

      // Mover el cursor con una flecha dispara announce() → speak con voiceRate.
      await act(async () => {
        board.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowUp",
            bubbles: true,
          }),
        );
      });

      await waitFor(() => {
        expect(speakMock).toHaveBeenCalled();
      });
      expect(speakMock).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ rate: 1.7 }),
      );
    });
  });

  describe("Exploración por hover (accesibilidad)", () => {
    it("al pasar el puntero por una casilla anuncia ubicación y pieza", async () => {
      const user = userEvent.setup();
      seedSettings({ speechEnabled: true });
      renderBoard(STARTING_FEN);

      await waitFor(() => {
        expect(screen.getByRole("application")).toBeInTheDocument();
      });
      speakMock.mockClear();

      await user.hover(squareButton("e4"));

      await waitFor(() => {
        expect(speakMock).toHaveBeenCalled();
      });
      expect(speakMock).toHaveBeenLastCalledWith(
        expect.stringMatching(/Casilla e4/i),
        expect.objectContaining({ interrupt: true }),
      );
      expect(
        screen.getByText(/Casilla e4/i, { selector: "p" }),
      ).toBeInTheDocument();
    });

    it("las casillas exponen aria-label descriptivo con casilla y pieza", () => {
      renderBoard(STARTING_FEN);
      const e2 = squareButton("e2");
      expect(e2.getAttribute("aria-label")).toMatch(/Casilla e2.*Pe[oó]n/i);
      expect(e2).toHaveAttribute("title", e2.getAttribute("aria-label"));
    });
  });
});
