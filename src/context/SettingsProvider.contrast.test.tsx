/**
 * Prueba de propiedad de contraste reflejado (Task 4.2).
 *
 * **Property 7: Contraste reflejado** — el atributo `data-contrast="high"` en
 * `<html>` (`document.documentElement`) está presente si y sólo si el ajuste
 * `settings.highContrast` vale `true`; cuando es `false`, el atributo está
 * ausente (retirado). El bicondicional debe mantenerse tras cualquier
 * secuencia de cambios de estado (alternancias `toggleHighContrast` y fijados
 * explícitos del valor), incluida la hidratación inicial.
 *
 * Entorno: jsdom (Vitest, globals). Se mockea `@/utils/speech` para no
 * depender de la Web Speech API. Entre iteraciones se limpia `localStorage` y
 * se retira el atributo del `<html>` para evitar arrastre de estado.
 *
 * **Validates: Requisitos 4.7, 4.8**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";
import fc from "fast-check";

// Mockear la voz: los cambios de ajuste pueden invocar `speak`, pero aquí sólo
// nos interesa el reflejo del contraste en el DOM.
vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
}));

import { SettingsProvider, useSettings } from "./SettingsProvider";

/**
 * API imperativa que el consumidor expone hacia la prueba para poder conducir
 * los cambios de `highContrast` sin depender del render. Se rellena en cada
 * render con los mutadores y el estado vigentes del contexto.
 */
type ContrastDriver = {
  /** Alterna el alto contraste (llama a `toggleHighContrast`). */
  toggle: () => void;
  /** Fija `highContrast` a un valor concreto alternando sólo si difiere. */
  set: (value: boolean) => void;
  /** Valor actual de `settings.highContrast`. */
  current: boolean;
};

/**
 * Consumidor mínimo que publica los mutadores del contexto en la referencia
 * compartida `driver`. No renderiza nada visible: sólo sirve para conducir el
 * provider desde la prueba dentro de `act`.
 */
function ContrastConsumer({
  driverRef,
}: {
  driverRef: { current: ContrastDriver | null };
}) {
  const { settings, toggleHighContrast } = useSettings();
  driverRef.current = {
    toggle: toggleHighContrast,
    set: (value: boolean) => {
      if (settings.highContrast !== value) {
        toggleHighContrast();
      }
    },
    current: settings.highContrast,
  };
  return null;
}

/** Lee el atributo `data-contrast` del `<html>` (o `null` si está ausente). */
function readContrastAttribute(): string | null {
  return document.documentElement.getAttribute("data-contrast");
}

/**
 * Asevera el bicondicional de la Propiedad 7: el atributo vale exactamente
 * "high" cuando `highContrast` es `true`, y está ausente cuando es `false`.
 */
function assertBiconditional(highContrast: boolean): void {
  const attr = readContrastAttribute();
  if (highContrast) {
    expect(attr).toBe("high");
  } else {
    expect(attr).toBeNull();
  }
}

/** Comando fast-check: alternar el contraste. */
type ToggleCommand = { kind: "toggle" };
/** Comando fast-check: fijar el contraste a un valor concreto. */
type SetCommand = { kind: "set"; value: boolean };
type Command = ToggleCommand | SetCommand;

const arbCommand: fc.Arbitrary<Command> = fc.oneof(
  fc.constant<ToggleCommand>({ kind: "toggle" }),
  fc.boolean().map<SetCommand>((value) => ({ kind: "set", value })),
);

describe("Property 7: Contraste reflejado — Validates: Requisitos 4.7, 4.8", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    vi.clearAllMocks();
  });

  it("data-contrast=high en <html> ⟺ settings.highContrast === true tras cada cambio", () => {
    fc.assert(
      fc.property(fc.array(arbCommand, { minLength: 1, maxLength: 30 }), (commands) => {
        // Estado limpio por iteración (fast-check no invoca beforeEach por corrida).
        window.localStorage.clear();
        document.documentElement.removeAttribute("data-contrast");

        const driverRef: { current: ContrastDriver | null } = { current: null };

        const { unmount } = render(
          <SettingsProvider>
            <ContrastConsumer driverRef={driverRef} />
          </SettingsProvider>,
        );

        try {
          // Tras montar e hidratar (efecto client-only), el estado por defecto
          // es highContrast=false, por lo que el atributo debe estar ausente.
          expect(driverRef.current).not.toBeNull();
          assertBiconditional(driverRef.current!.current);

          for (const command of commands) {
            act(() => {
              const driver = driverRef.current!;
              if (command.kind === "toggle") {
                driver.toggle();
              } else {
                driver.set(command.value);
              }
            });

            // Tras aplicarse el cambio (y el efecto de contraste), el
            // bicondicional debe cumplirse con el nuevo valor vigente.
            assertBiconditional(driverRef.current!.current);
          }
        } finally {
          unmount();
        }
      }),
    );
  });

  it("fijar high y luego low deja el atributo presente y luego ausente", () => {
    const driverRef: { current: ContrastDriver | null } = { current: null };

    const { unmount } = render(
      <SettingsProvider>
        <ContrastConsumer driverRef={driverRef} />
      </SettingsProvider>,
    );

    try {
      assertBiconditional(false);
      expect(readContrastAttribute()).toBeNull();

      act(() => driverRef.current!.set(true));
      expect(readContrastAttribute()).toBe("high");
      assertBiconditional(true);

      act(() => driverRef.current!.set(false));
      expect(readContrastAttribute()).toBeNull();
      assertBiconditional(false);
    } finally {
      unmount();
    }
  });
});
