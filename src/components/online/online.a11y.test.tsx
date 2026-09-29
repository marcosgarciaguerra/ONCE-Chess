import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import type { ReactElement } from "react";

import { SettingsProvider } from "@/context/SettingsProvider";
import type { OnlineGameState } from "@/lib/onlineProtocol";

import { OnlineLobby, deletrearCodigo } from "./OnlineLobby";
import { OnlineStatus } from "./OnlineStatus";
import { OnlineControls } from "./OnlineControls";

/**
 * Pruebas de accesibilidad de los componentes del modo en línea
 * (`OnlineLobby`, `OnlineStatus`, `OnlineControls`).
 *
 * Cubre:
 * - `jest-axe` sin violaciones de accesibilidad detectables (Req 9.7, 13.7, 15.6).
 * - Controles activables por teclado (Req 15.6).
 * - Código deletreado presente en el lobby (Req 9.7).
 * - Estado de la partida expresado por texto legible además de por color
 *   (Req 13.7).
 *
 * `OnlineLobby` consume `useSettings()` y `useAnnouncer`, por lo que se
 * renderiza dentro de un `SettingsProvider` real. La síntesis de voz
 * (`@/utils/speech`) se mockea para no depender del navegador.
 */

// Mock de la síntesis de voz: `SettingsProvider` y `useAnnouncer` invocan
// `speak(...)`; en jsdom no existe `speechSynthesis`, así que lo neutralizamos.
vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  ensureVoicesLoaded: vi.fn(async () => []),
}));

/** Renderiza un elemento envuelto en el proveedor de ajustes real. */
function renderConAjustes(ui: ReactElement) {
  return render(<SettingsProvider>{ui}</SettingsProvider>);
}

/**
 * Construye un `OnlineGameState` mínimo con valores por defecto sensatos,
 * permitiendo sobrescribir campos concretos por caso de prueba.
 */
function estadoBase(overrides: Partial<OnlineGameState> = {}): OnlineGameState {
  return {
    codigo: "MESA-ROSA-42",
    status: "en-juego",
    color: "w",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    historial: [],
    turno: "w",
    esMiTurno: true,
    jaque: false,
    resultado: "en-curso",
    ganador: null,
    ofertaTablasPendiente: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OnlineLobby (accesibilidad)", () => {
  it("no presenta violaciones de accesibilidad sin código actual (Req 9.7)", async () => {
    const { container } = renderConAjustes(
      <OnlineLobby onCrear={() => {}} onUnirse={() => {}} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("no presenta violaciones de accesibilidad con código actual (Req 9.7)", async () => {
    const { container } = renderConAjustes(
      <OnlineLobby
        onCrear={() => {}}
        onUnirse={() => {}}
        codigoActual="MESA-ROSA-42"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("no presenta violaciones de accesibilidad con mensaje de error (Req 9.7)", async () => {
    const { container } = renderConAjustes(
      <OnlineLobby
        onCrear={() => {}}
        onUnirse={() => {}}
        errorMensaje="Ese código de partida no existe."
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("muestra la versión deletreada del código cuando hay codigoActual (Req 9.7)", () => {
    renderConAjustes(
      <OnlineLobby
        onCrear={() => {}}
        onUnirse={() => {}}
        codigoActual="MESA-ROSA-42"
      />,
    );

    // El deletreo esperado según `deletrearCodigo`.
    const deletreo = deletrearCodigo("MESA-ROSA-42");
    expect(deletreo).toContain("de Madrid");
    expect(deletreo).toContain("guion");
    expect(deletreo).toContain("cuatro");

    // Y ese mismo texto aparece renderizado en el documento.
    const deletreoNodo = screen.getByText(deletreo);
    expect(deletreoNodo).toBeInTheDocument();
    // Verificamos fragmentos representativos dentro del propio nodo del deletreo
    // (la palabra "guion" también aparece en el texto de ayuda del formulario).
    const contenido = deletreoNodo.textContent ?? "";
    expect(contenido).toContain("de Madrid");
    expect(contenido).toContain("guion");
    expect(contenido).toContain("cuatro");
  });

  it("el botón Crear partida es activable por teclado e invoca onCrear (Req 15.6)", async () => {
    const user = userEvent.setup();
    const onCrear = vi.fn();
    renderConAjustes(<OnlineLobby onCrear={onCrear} onUnirse={() => {}} />);

    const boton = screen.getByRole("button", { name: /crear partida/i });
    boton.focus();
    expect(boton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onCrear).toHaveBeenCalledTimes(1);
  });

  it("el botón Copiar enlace es alcanzable por teclado cuando hay código (Req 15.6)", async () => {
    const user = userEvent.setup();
    renderConAjustes(
      <OnlineLobby
        onCrear={() => {}}
        onUnirse={() => {}}
        codigoActual="MESA-ROSA-42"
      />,
    );

    const copiar = screen.getByRole("button", { name: /copiar enlace/i });
    copiar.focus();
    expect(copiar).toHaveFocus();
    // Activarlo por teclado no debe lanzar; el manejo de portapapeles es
    // tolerante a la ausencia de la API en jsdom.
    await user.keyboard("{Enter}");
    expect(copiar).toBeInTheDocument();
  });

  it("Unirse por teclado normaliza el código y lo pasa a onUnirse (Req 15.6)", async () => {
    const user = userEvent.setup();
    const onUnirse = vi.fn();
    renderConAjustes(<OnlineLobby onCrear={() => {}} onUnirse={onUnirse} />);

    const campo = screen.getByLabelText(/unirse con un código/i);
    // Entrada en minúsculas con guiones: debe normalizarse a MESA-ROSA-42
    // (mayúsculas + colapso de guiones), un código válido del diccionario.
    await user.type(campo, "mesa--rosa-42");

    const unirse = screen.getByRole("button", { name: /^unirse$/i });
    unirse.focus();
    expect(unirse).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onUnirse).toHaveBeenCalledTimes(1);
    expect(onUnirse).toHaveBeenCalledWith("MESA-ROSA-42");
  });
});

describe("OnlineStatus (accesibilidad y estado por texto)", () => {
  it("no presenta violaciones de accesibilidad (Req 13.7)", async () => {
    const { container } = render(<OnlineStatus state={estadoBase()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("muestra 'Es tu turno' en texto cuando es el turno propio (Req 13.7)", () => {
    render(
      <OnlineStatus
        state={estadoBase({ color: "w", turno: "w", esMiTurno: true })}
      />,
    );
    expect(screen.getByText(/Es tu turno/i)).toBeInTheDocument();
    // El estado de conexión también se expresa por texto.
    expect(screen.getByText(/Partida en juego/i)).toBeInTheDocument();
  });

  it("muestra 'Turno del rival' en texto cuando no es el turno propio (Req 13.7)", () => {
    render(
      <OnlineStatus
        state={estadoBase({ color: "w", turno: "b", esMiTurno: false })}
      />,
    );
    expect(screen.getByText(/Turno del rival/i)).toBeInTheDocument();
  });

  it("describe por texto los distintos estados de conexión (Req 13.7)", () => {
    const { rerender } = render(
      <OnlineStatus state={estadoBase({ status: "conectando" })} />,
    );
    expect(screen.getByText(/Conectando con el servidor/i)).toBeInTheDocument();

    rerender(
      <OnlineStatus state={estadoBase({ status: "esperando-rival" })} />,
    );
    expect(
      screen.getByText(/Esperando a que se una el rival/i),
    ).toBeInTheDocument();

    rerender(
      <OnlineStatus state={estadoBase({ status: "reconectando" })} />,
    );
    expect(screen.getByText(/Reconectando con el servidor/i)).toBeInTheDocument();

    rerender(
      <OnlineStatus
        state={estadoBase({ status: "rival-desconectado" })}
      />,
    );
    expect(screen.getByText(/El rival se ha desconectado/i)).toBeInTheDocument();
  });

  it("anuncia por texto el resultado de jaque mate (Req 13.7)", () => {
    render(
      <OnlineStatus
        state={estadoBase({
          status: "finalizada",
          resultado: "jaque-mate",
          ganador: "w",
          esMiTurno: false,
        })}
      />,
    );
    expect(screen.getByText(/Jaque mate\. Ganan las blancas/i)).toBeInTheDocument();
  });
});

describe("OnlineControls (accesibilidad y teclado)", () => {
  it("no presenta violaciones de accesibilidad en curso (Req 15.6)", async () => {
    const { container } = render(
      <OnlineControls
        state={estadoBase()}
        onRendirse={() => {}}
        onOfrecerTablas={() => {}}
        onAceptarTablas={() => {}}
        onRechazarTablas={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("no presenta violaciones de accesibilidad con oferta de tablas del rival (Req 15.6)", async () => {
    const { container } = render(
      <OnlineControls
        state={estadoBase({ ofertaTablasPendiente: "rival" })}
        onRendirse={() => {}}
        onOfrecerTablas={() => {}}
        onAceptarTablas={() => {}}
        onRechazarTablas={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Rendirse es alcanzable por Tab y activable por teclado (Req 15.6)", async () => {
    const user = userEvent.setup();
    const onRendirse = vi.fn();
    render(
      <OnlineControls
        state={estadoBase()}
        onRendirse={onRendirse}
        onOfrecerTablas={() => {}}
        onAceptarTablas={() => {}}
        onRechazarTablas={() => {}}
      />,
    );

    const rendirse = screen.getByRole("button", {
      name: /rendirse y conceder la partida al rival/i,
    });
    await user.tab();
    expect(rendirse).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRendirse).toHaveBeenCalledTimes(1);
  });

  it("Ofrecer tablas es activable con la barra espaciadora (Req 15.6)", async () => {
    const user = userEvent.setup();
    const onOfrecerTablas = vi.fn();
    render(
      <OnlineControls
        state={estadoBase()}
        onRendirse={() => {}}
        onOfrecerTablas={onOfrecerTablas}
        onAceptarTablas={() => {}}
        onRechazarTablas={() => {}}
      />,
    );

    const ofrecer = screen.getByRole("button", {
      name: /ofrecer tablas al rival/i,
    });
    ofrecer.focus();
    expect(ofrecer).toHaveFocus();
    await user.keyboard("{ }");
    expect(onOfrecerTablas).toHaveBeenCalledTimes(1);
  });

  it("Aceptar/Rechazar tablas del rival son activables por teclado (Req 15.6, 12.5)", async () => {
    const user = userEvent.setup();
    const onAceptarTablas = vi.fn();
    const onRechazarTablas = vi.fn();
    render(
      <OnlineControls
        state={estadoBase({ ofertaTablasPendiente: "rival" })}
        onRendirse={() => {}}
        onOfrecerTablas={() => {}}
        onAceptarTablas={onAceptarTablas}
        onRechazarTablas={onRechazarTablas}
      />,
    );

    const aceptar = screen.getByRole("button", {
      name: /aceptar la oferta de tablas del rival/i,
    });
    const rechazar = screen.getByRole("button", {
      name: /rechazar la oferta de tablas del rival/i,
    });

    aceptar.focus();
    expect(aceptar).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAceptarTablas).toHaveBeenCalledTimes(1);

    rechazar.focus();
    expect(rechazar).toHaveFocus();
    await user.keyboard("{ }");
    expect(onRechazarTablas).toHaveBeenCalledTimes(1);
  });

  it("comunica por región assertive la oferta de tablas del rival (Req 13.5)", () => {
    const { container } = render(
      <OnlineControls
        state={estadoBase({ ofertaTablasPendiente: "rival" })}
        onRendirse={() => {}}
        onOfrecerTablas={() => {}}
        onAceptarTablas={() => {}}
        onRechazarTablas={() => {}}
      />,
    );

    const assertive = container.querySelector('[aria-live="assertive"]');
    expect(assertive).not.toBeNull();
    expect(within(assertive as HTMLElement).getByText(/El rival ofrece tablas/i)).toBeInTheDocument();
  });
});
