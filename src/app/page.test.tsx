import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import Home from "./page";

/**
 * Pruebas de integración/accesibilidad de la landing (`src/app/page.tsx`).
 *
 * `page.tsx` es un Server Component estático (JSX puro, sin async ni APIs
 * server-only), por lo que puede importarse y renderizarse directamente en
 * jsdom. `next/link` renderiza un `<a>` sin necesidad de mock en este entorno.
 *
 * El SkipLink global vive en `RootLayout` (no en `page.tsx`), por lo que estas
 * pruebas se centran en lo que la propia landing controla: sus landmarks, su
 * `h1` único, sus enlaces CTA y su orden de foco (main → CTAs).
 *
 * Cubre criterios de aceptación 1.1, 1.2, 1.3, 1.5, 1.6, 1.9.
 */
describe("Landing / (accesibilidad e integración)", () => {
  it("no presenta violaciones de accesibilidad detectables por axe (Req 1.9)", async () => {
    const { container } = render(<Home />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("renderiza exactamente un h1 y es único en la página (Req 1.1)", () => {
    render(<Home />);

    const headingsNivel1 = screen.getAllByRole("heading", { level: 1 });
    expect(headingsNivel1).toHaveLength(1);
    expect(headingsNivel1[0]).toHaveTextContent(/personas ciegas/i);
  });

  it("expone exactamente un landmark banner, main, contentinfo y una navegación (Req 1.2)", () => {
    render(<Home />);

    // header -> banner, footer -> contentinfo, main -> main, nav -> navigation
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    expect(
      screen.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeInTheDocument();
  });

  it("el <main> tiene id=contenido y tabIndex=-1 para recibir el foco del skip link (Req 1.3)", () => {
    render(<Home />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "contenido");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("etiqueta cada section mediante aria-labelledby referido a un encabezado visible existente (Req 1.2)", () => {
    const { container } = render(<Home />);

    const sections = container.querySelectorAll("section[aria-labelledby]");
    // hero, características y barra de CTA
    expect(sections.length).toBe(3);

    for (const section of sections) {
      const labelId = section.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      const label = container.querySelector(`#${labelId}`);
      // El id referido existe y corresponde a un encabezado con texto visible.
      expect(label).not.toBeNull();
      expect(/^H[1-6]$/.test(label!.tagName)).toBe(true);
      expect(label!.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("ofrece enlaces a /dashboard y /tablero con nombre accesible no vacío (Req 1.5)", () => {
    render(<Home />);

    const enlacesDashboard = screen.getAllByRole("link", {
      name: /panel/i,
    });
    const enlacesTablero = screen.getAllByRole("link", {
      name: /tablero/i,
    });

    expect(enlacesDashboard.length).toBeGreaterThan(0);
    expect(enlacesTablero.length).toBeGreaterThan(0);

    for (const enlace of enlacesDashboard) {
      expect(enlace).toHaveAttribute("href", "/dashboard");
      expect(enlace.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    for (const enlace of enlacesTablero) {
      expect(enlace).toHaveAttribute("href", "/tablero");
      expect(enlace.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("los enlaces CTA son enfocables y activables por teclado (Req 1.5, 1.6)", async () => {
    const user = userEvent.setup();
    render(<Home />);

    // Un enlace <a href> es enfocable programáticamente y por Tab.
    const ctaDashboard = screen.getByRole("link", {
      name: "Entrar al panel de ONCE Chess",
    });
    ctaDashboard.focus();
    expect(ctaDashboard).toHaveFocus();

    // Es activable por teclado (Enter no lanza; el <a> participa del orden de tabulación).
    await user.keyboard("{Enter}");
    expect(ctaDashboard).toBeInTheDocument();
  });

  it("todos los enlaces del documento son alcanzables por Tab en orden, sin exclusiones (Req 1.6)", async () => {
    const user = userEvent.setup();
    render(<Home />);

    // Enlaces en orden del documento: nav (dashboard, tablero) y luego los CTA
    // de main. Tabulando desde el inicio del documento cada uno debe recibir el
    // foco en secuencia, sin que ninguno quede excluido del orden de tabulación.
    const enlaces = screen.getAllByRole("link");
    expect(enlaces.length).toBeGreaterThan(0);

    for (const enlace of enlaces) {
      await user.tab();
      expect(enlace).toHaveFocus();
    }
  });

  it("el orden de foco tras el <main> llega a los CTA en su secuencia (main → CTAs) (Req 1.6)", async () => {
    const user = userEvent.setup();
    render(<Home />);

    // El SkipLink global (en RootLayout) traslada el foco a <main>; desde ahí,
    // el orden de foco propio de la landing continúa por sus CTA en main.
    const main = screen.getByRole("main");
    main.focus();
    expect(main).toHaveFocus();

    const ctaDashboard = screen.getByRole("link", {
      name: "Entrar al panel de ONCE Chess",
    });
    const ctaTablero = screen.getByRole("link", {
      name: "Abrir el tablero accesible",
    });

    await user.tab();
    expect(ctaDashboard).toHaveFocus();

    await user.tab();
    expect(ctaTablero).toHaveFocus();
  });
});
