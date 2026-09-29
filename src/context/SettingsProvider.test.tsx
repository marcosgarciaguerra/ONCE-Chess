/**
 * Pruebas unitarias del proveedor de ajustes (Task 4.3).
 *
 * Cubren los comportamientos del `SettingsProvider`/`useSettings` que no valida
 * la prueba de propiedad de contraste (`SettingsProvider.contrast.test.tsx`):
 *
 * - Hidratación desde `localStorage`: al montar, el provider lee la clave
 *   `STORAGE_KEYS.settings` y refleja los valores persistidos (Req. 4.1, 4.2).
 * - Respeto de `speechEnabled`: con la voz activada, cambiar un ajuste invoca
 *   `speak` con `{ rate: voiceRate }`; con la voz desactivada no se invoca
 *   `speak` en los cambios posteriores (Req. 4.9, 4.10).
 * - `resetSettings`: restablece `DEFAULT_SETTINGS` y lo persiste (Req. 4.13).
 * - `useSettings` fuera del provider lanza el error esperado (Req. 4.14).
 *
 * Entorno: jsdom (Vitest, globals) + @testing-library/react. Se mockea
 * `@/utils/speech` para observar las llamadas a `speak` sin depender de la
 * Web Speech API.
 *
 * _Requirements: 4.1, 4.2, 4.9, 4.10, 4.13, 4.14_
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

// Mock de la voz: capturamos las invocaciones de `speak` para verificar el
// respeto de `speechEnabled` y el `voiceRate` aplicado.
vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
}));

import { speak } from "@/utils/speech";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  loadSettings,
  type Settings,
} from "@/lib/storage";
import { SettingsProvider, useSettings } from "./SettingsProvider";

const speakMock = vi.mocked(speak);

/**
 * Referencia imperativa a los mutadores y estado del contexto, rellenada en
 * cada render por el consumidor de prueba. Permite conducir el provider desde
 * la prueba sin depender del árbol renderizado.
 */
type Driver = {
  settings: Settings;
  setVoiceRate: (rate: number) => void;
  toggleShowPawnLetter: () => void;
  toggleHighContrast: () => void;
  toggleSpeech: () => void;
  resetSettings: () => void;
  saveError: string | null;
};

/**
 * Consumidor mínimo que publica el valor del contexto en `driverRef`. No
 * renderiza nada visible; sólo expone la API para la prueba.
 */
function Consumer({
  driverRef,
}: {
  driverRef: { current: Driver | null };
}) {
  const ctx = useSettings();
  driverRef.current = ctx;
  return null;
}

/** Semilla la clave de ajustes en `localStorage` con un JSON arbitrario. */
function seedSettings(value: unknown): void {
  window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(value));
}

/** Renderiza el provider con el consumidor y devuelve la referencia y unmount. */
function renderProvider() {
  const driverRef: { current: Driver | null } = { current: null };
  const utils = render(
    <SettingsProvider>
      <Consumer driverRef={driverRef} />
    </SettingsProvider>,
  );
  return { driverRef, ...utils };
}

describe("SettingsProvider — pruebas unitarias (Task 4.3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    speakMock.mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    vi.clearAllMocks();
  });

  describe("Hidratación desde localStorage (Req. 4.1, 4.2)", () => {
    it("refleja los valores persistidos (no por defecto) tras montar", async () => {
      // Valores distintos de DEFAULT_SETTINGS para detectar la hidratación.
      const persisted: Settings = {
        voiceRate: 1.5,
        showPawnLetter: true,
        highContrast: true,
        speechEnabled: false,
      };
      seedSettings(persisted);

      const { driverRef, unmount } = renderProvider();

      try {
        await waitFor(() => {
          expect(driverRef.current).not.toBeNull();
          expect(driverRef.current!.settings).toEqual(persisted);
        });
      } finally {
        unmount();
      }
    });

    it("normaliza los valores corruptos al hidratar (clamp de voiceRate, booleanos)", async () => {
      // voiceRate fuera de rango se recorta a 2.0; booleanos inválidos → default.
      seedSettings({
        voiceRate: 99,
        showPawnLetter: "sí",
        highContrast: true,
        speechEnabled: 0,
      });

      const { driverRef, unmount } = renderProvider();

      try {
        await waitFor(() => {
          expect(driverRef.current).not.toBeNull();
          expect(driverRef.current!.settings).toEqual({
            voiceRate: 2.0,
            showPawnLetter: DEFAULT_SETTINGS.showPawnLetter,
            highContrast: true,
            speechEnabled: DEFAULT_SETTINGS.speechEnabled,
          });
        });
      } finally {
        unmount();
      }
    });
  });

  describe("Respeto de speechEnabled (Req. 4.9, 4.10)", () => {
    // Requisitos 4.9/4.11: con la voz activada, cambiar un ajuste debe
    // anunciarse por voz con el `voiceRate` vigente. `applySettings` calcula el
    // estado resultante fuera del updater (a partir de `settingsRef.current`) y
    // ejecuta `persist`/`announce` de forma determinista y síncrona con la
    // acción, por lo que `speak` se invoca de manera fiable.
    it("con la voz activada, cambiar un ajuste invoca speak con { rate: voiceRate }", async () => {
      seedSettings({
        voiceRate: 1.4,
        showPawnLetter: false,
        highContrast: false,
        speechEnabled: true,
      });

      const { driverRef, unmount } = renderProvider();

      try {
        await waitFor(() => {
          expect(driverRef.current?.settings.speechEnabled).toBe(true);
          expect(driverRef.current?.settings.voiceRate).toBe(1.4);
        });

        speakMock.mockClear();
        await act(async () => {
          driverRef.current!.toggleShowPawnLetter();
        });

        await waitFor(() => {
          expect(speakMock).toHaveBeenCalled();
        });
        expect(speakMock).toHaveBeenLastCalledWith(
          expect.any(String),
          expect.objectContaining({ rate: 1.4 }),
        );
      } finally {
        unmount();
      }
    });

    it("con la voz desactivada, cambiar un ajuste NO invoca speak", async () => {
      // Estado por defecto (speechEnabled true), luego lo desactivamos y
      // comprobamos que un cambio posterior no emite voz.
      const { driverRef, unmount } = renderProvider();

      try {
        await waitFor(() => {
          expect(driverRef.current?.settings.speechEnabled).toBe(true);
        });

        // Desactivar la voz: al silenciar no debe emitirse sonido (el resultado
        // deja speechEnabled=false, por lo que este propio cambio no habla).
        act(() => driverRef.current!.toggleSpeech());
        expect(driverRef.current!.settings.speechEnabled).toBe(false);

        // A partir de aquí ningún cambio debe invocar speak.
        speakMock.mockClear();
        await act(async () => {
          driverRef.current!.toggleHighContrast();
        });
        await act(async () => {
          driverRef.current!.setVoiceRate(1.8);
        });

        expect(speakMock).not.toHaveBeenCalled();
      } finally {
        unmount();
      }
    });
  });

  describe("resetSettings (Req. 4.13)", () => {
    it("restablece DEFAULT_SETTINGS y lo persiste en localStorage", async () => {
      seedSettings({
        voiceRate: 2.0,
        showPawnLetter: true,
        highContrast: true,
        speechEnabled: true,
      });

      const { driverRef, unmount } = renderProvider();

      try {
        await waitFor(() => {
          expect(driverRef.current?.settings.highContrast).toBe(true);
          expect(driverRef.current?.settings.showPawnLetter).toBe(true);
        });

        act(() => driverRef.current!.resetSettings());

        // Estado en memoria restablecido.
        expect(driverRef.current!.settings).toEqual(DEFAULT_SETTINGS);
        // Persistido: una nueva lectura devuelve los valores por defecto.
        expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
      } finally {
        unmount();
      }
    });
  });

  describe("useSettings fuera del provider (Req. 4.14)", () => {
    it("lanza un error explícito indicando que debe usarse dentro de SettingsProvider", () => {
      // Silenciamos el error de React que acompaña al throw durante el render.
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const driverRef: { current: Driver | null } = { current: null };

      try {
        expect(() =>
          render(<Consumer driverRef={driverRef} />),
        ).toThrow(/useSettings debe usarse dentro de SettingsProvider/);
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});
