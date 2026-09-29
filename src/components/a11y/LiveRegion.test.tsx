import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, act } from "@testing-library/react";

// Mockear el módulo de voz para observar las llamadas a `speak`
// sin depender de la Web Speech API real.
vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
}));

import { speak } from "@/utils/speech";
import { LiveRegion, useAnnouncer } from "./LiveRegion";

const speakMock = vi.mocked(speak);

afterEach(() => {
  vi.clearAllMocks();
});

describe("LiveRegion (componente)", () => {
  it("renderiza <p class=sr-only aria-live=polite aria-atomic=true> por defecto (Req 8.1)", () => {
    const { container } = render(<LiveRegion message="Hola" />);
    const p = container.querySelector("p");

    expect(p).not.toBeNull();
    expect(p).toHaveClass("sr-only");
    expect(p).toHaveAttribute("aria-live", "polite");
    expect(p).toHaveAttribute("aria-atomic", "true");
    expect(p).toHaveTextContent("Hola");
  });

  it("usa aria-live=assertive cuando politeness es assertive (Req 8.8)", () => {
    const { container } = render(
      <LiveRegion message="Urgente" politeness="assertive" />,
    );
    const p = container.querySelector("p");

    expect(p).toHaveAttribute("aria-live", "assertive");
  });

  it("aplica el id proporcionado", () => {
    const { container } = render(
      <LiveRegion message="Con id" id="anuncios" />,
    );
    expect(container.querySelector("p")).toHaveAttribute("id", "anuncios");
  });
});

describe("useAnnouncer (hook)", () => {
  it("fija el mensaje cuando el texto no está vacío (Req 8.2)", () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => {
      result.current.announce("Movimiento realizado");
    });

    expect(result.current.message).toBe("Movimiento realizado");
  });

  it("ignora un mensaje vacío conservando el contenido previo (Req 8.3)", () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => {
      result.current.announce("Primer mensaje");
    });
    act(() => {
      result.current.announce("");
    });

    expect(result.current.message).toBe("Primer mensaje");
  });

  it("ignora un mensaje compuesto solo por espacios conservando el previo (Req 8.3)", () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => {
      result.current.announce("Contenido válido");
    });
    act(() => {
      result.current.announce("    \t \n ");
    });

    expect(result.current.message).toBe("Contenido válido");
  });

  it("no emite voz cuando se ignora un mensaje vacío (Req 8.3)", () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => {
      result.current.announce("   ");
    });

    expect(speakMock).not.toHaveBeenCalled();
    expect(result.current.message).toBe("");
  });

  it("trunca el mensaje a 500 caracteres antes de fijarlo (Req 8.4)", () => {
    const { result } = renderHook(() => useAnnouncer());
    const largo = "a".repeat(600);

    act(() => {
      result.current.announce(largo);
    });

    expect(result.current.message).toHaveLength(500);
    expect(result.current.message).toBe("a".repeat(500));
  });

  it("no trunca un mensaje de exactamente 500 caracteres (Req 8.4)", () => {
    const { result } = renderHook(() => useAnnouncer());
    const exacto = "b".repeat(500);

    act(() => {
      result.current.announce(exacto);
    });

    expect(result.current.message).toBe(exacto);
    expect(result.current.message).toHaveLength(500);
  });

  it("reemplaza por completo el contenido anterior por el nuevo mensaje (Req 8.5)", () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => {
      result.current.announce("Mensaje anterior más largo");
    });
    act(() => {
      result.current.announce("Nuevo");
    });

    expect(result.current.message).toBe("Nuevo");
  });

  it("emite voz con speak(text, { rate: voiceRate }) cuando speechEnabled es true (Req 8.6)", () => {
    const { result } = renderHook(() =>
      useAnnouncer({ speechEnabled: true, voiceRate: 1.5 }),
    );

    act(() => {
      result.current.announce("Jaque");
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledWith("Jaque", { rate: 1.5 });
  });

  it("emite voz con el rate por defecto (1) cuando no se pasa voiceRate (Req 8.6)", () => {
    const { result } = renderHook(() => useAnnouncer({ speechEnabled: true }));

    act(() => {
      result.current.announce("Tu turno");
    });

    expect(speakMock).toHaveBeenCalledWith("Tu turno", { rate: 1 });
  });

  it("emite la voz con el mensaje ya truncado a 500 caracteres (Req 8.4 + 8.6)", () => {
    const { result } = renderHook(() =>
      useAnnouncer({ speechEnabled: true, voiceRate: 1 }),
    );
    const largo = "c".repeat(600);

    act(() => {
      result.current.announce(largo);
    });

    expect(speakMock).toHaveBeenCalledWith("c".repeat(500), { rate: 1 });
  });

  it("no emite voz cuando speechEnabled es false, pero sí fija el mensaje (Req 8.7)", () => {
    const { result } = renderHook(() =>
      useAnnouncer({ speechEnabled: false, voiceRate: 1 }),
    );

    act(() => {
      result.current.announce("Solo aria-live");
    });

    expect(speakMock).not.toHaveBeenCalled();
    expect(result.current.message).toBe("Solo aria-live");
  });

  it("no emite voz cuando la llamada pide opts.speak=false, pero fija el mensaje (Req 8.7)", () => {
    const { result } = renderHook(() => useAnnouncer({ speechEnabled: true }));

    act(() => {
      result.current.announce("Sin voz explícita", { speak: false });
    });

    expect(speakMock).not.toHaveBeenCalled();
    expect(result.current.message).toBe("Sin voz explícita");
  });

  it("no lanza y sigue anunciando por aria-live si window.speechSynthesis está ausente (Req 8.9)", () => {
    // `speak` real gestiona internamente la ausencia de la API; aquí simulamos
    // que la Web Speech API no existe y que `speak` no lanza en ese caso.
    const original = Object.getOwnPropertyDescriptor(
      window,
      "speechSynthesis",
    );
    delete (window as unknown as { speechSynthesis?: unknown })
      .speechSynthesis;
    speakMock.mockImplementation(() => {
      // Comportamiento del `speak` real: no-op si no hay speechSynthesis.
    });

    const { result } = renderHook(() => useAnnouncer({ speechEnabled: true }));

    expect(() => {
      act(() => {
        result.current.announce("Anuncio sin API de voz");
      });
    }).not.toThrow();

    expect(result.current.message).toBe("Anuncio sin API de voz");

    // Restaurar el descriptor original para no filtrar estado entre pruebas.
    if (original) {
      Object.defineProperty(window, "speechSynthesis", original);
    }
  });
});
