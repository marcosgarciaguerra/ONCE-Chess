import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { toHaveNoViolations } from "jest-axe";

// Matchers de Testing Library (toBeInTheDocument, toHaveFocus, etc.)
expect.extend(matchers);

// Matcher de accesibilidad de axe (toHaveNoViolations)
expect.extend(toHaveNoViolations);

// Limpiar el DOM renderizado tras cada prueba para evitar fugas de estado.
afterEach(() => {
  cleanup();
});
