import "vitest";
// Matchers de Testing Library para Vitest (toBeInTheDocument, toHaveFocus, ...)
import "@testing-library/jest-dom/vitest";
import type { AxeResults } from "axe-core";

// Extiende los aserciones de Vitest con el matcher de accesibilidad de jest-axe.
declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}

// Sugerencia de tipo para el uso habitual `expect(await axe(container)).toHaveNoViolations()`.
export type { AxeResults };
