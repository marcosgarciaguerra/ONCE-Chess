/**
 * Pruebas de accesibilidad del modo vs CPU.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

vi.mock("@/utils/speech", () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  ensureVoicesLoaded: vi.fn(() => Promise.resolve([])),
}));

import { SettingsProvider } from "@/context/SettingsProvider";
import { CpuGameClient } from "./CpuGameClient";

function mockMatchMedia(): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? false : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("CpuGameClient (accesibilidad)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockMatchMedia();
    Element.prototype.scrollIntoView = () => undefined;
  });

  it("no presenta violaciones detectables por axe", async () => {
    const { container } = render(
      <SettingsProvider>
        <CpuGameClient />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Partida contra la máquina",
        }),
      ).toBeInTheDocument();
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("expone controles de nivel y nueva partida activables por teclado", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <CpuGameClient />
      </SettingsProvider>,
    );

    const facil = await screen.findByRole("button", { name: "Fácil" });
    facil.focus();
    expect(facil).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(facil).toHaveAttribute("aria-pressed", "true");

    const nueva = screen.getByRole("button", { name: "Nueva partida" });
    nueva.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Partida contra la máquina",
      }),
    ).toBeInTheDocument();
  });

  it("el tablero se monta en modo CPU con landmark main", async () => {
    render(
      <SettingsProvider>
        <CpuGameClient />
      </SettingsProvider>,
    );
    expect(
      screen.getByRole("main", {
        name: /partida de ajedrez contra la máquina/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("application")).toBeInTheDocument();
    });
  });
});
