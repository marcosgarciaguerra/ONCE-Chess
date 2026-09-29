/**
 * Pruebas de propiedad del código de partida en línea (tarea 11.1).
 *
 * Cubre las propiedades de corrección P14 y P15 del diseño frente a la
 * implementación real de `src/lib/gameCode.ts` (dígitos en el rango `[2-9]`).
 *
 * Requisitos cubiertos: 9.2, 9.3, 10.4, 10.5.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DICCIONARIO_CODIGO,
  generarCodigo,
  normalizarCodigo,
} from "./gameCode";

/** Conjunto de palabras del diccionario para comprobaciones de pertenencia. */
const PALABRAS = new Set(DICCIONARIO_CODIGO);

/**
 * Comprueba que un código tiene el formato `PALABRA-PALABRA-NN`, con ambas
 * palabras en el diccionario y dos dígitos en `[2-9]`.
 */
function codigoBienFormado(codigo: string): boolean {
  const partes = codigo.split("-");
  if (partes.length !== 3) return false;
  const [p1, p2, digitos] = partes;
  return PALABRAS.has(p1) && PALABRAS.has(p2) && /^[2-9]{2}$/.test(digitos);
}

describe("gameCode - Property 14: unicidad e inambigüedad del código", () => {
  // Validates: Requisitos 9.2, 9.3
  it("cada código generado sólo usa palabras del diccionario y dígitos [2-9]", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const existentes = new Set<string>();
        for (let i = 0; i < n; i += 1) {
          const codigo = generarCodigo(existentes);
          expect(codigoBienFormado(codigo)).toBe(true);
          existentes.add(codigo);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Validates: Requisitos 9.2, 9.3
  it("genera códigos distintos frente a un conjunto acumulado de existentes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (n) => {
        const existentes = new Set<string>();
        for (let i = 0; i < n; i += 1) {
          const codigo = generarCodigo(existentes);
          // El código no debe colisionar con ninguno ya emitido.
          expect(existentes.has(codigo)).toBe(false);
          existentes.add(codigo);
        }
        // Todos los códigos emitidos son distintos entre sí.
        expect(existentes.size).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});

describe("gameCode - Property 15: idempotencia de la normalización", () => {
  // Validates: Requisito 10.4
  it("normalizarCodigo es idempotente para cadenas arbitrarias", () => {
    fc.assert(
      fc.property(fc.string(), (entrada) => {
        const una = normalizarCodigo(entrada);
        const dos = normalizarCodigo(una);
        expect(dos).toBe(una);
      }),
      { numRuns: 500 },
    );
  });

  // Validates: Requisito 10.5
  it("entradas que sólo difieren en caja/espacios/guiones normalizan igual", () => {
    // Genera un código base a partir de tokens del diccionario y luego crea
    // dos "vistas" del mismo código con distintas variaciones cosméticas
    // (caja, espacios alrededor de los tokens y guiones repetidos) que no
    // deben alterar el resultado normalizado.
    const token = fc.constantFrom(...DICCIONARIO_CODIGO);
    const espacios = fc.string({ unit: fc.constantFrom(" ", "\t"), maxLength: 3 });
    const guiones = fc.string({
      unit: fc.constant("-"),
      minLength: 1,
      maxLength: 3,
    });

    const variacion = fc
      .tuple(token, token, fc.constantFrom(..."23456789".split("")), fc.constantFrom(..."23456789".split("")))
      .chain(([w1, w2, d1, d2]) =>
        fc
          .tuple(espacios, espacios, espacios, guiones, guiones, fc.boolean())
          .map(([s1, s2, s3, g1, g2, mayus]) => {
            const caja = (s: string) => (mayus ? s.toLowerCase() : s.toUpperCase());
            const decorado = `${s1}${caja(w1)}${g1}${caja(w2)}${g2}${caja(d1)}${caja(d2)}${s3}`;
            const canonico = `${w1}-${w2}-${d1}${d2}`;
            // Añade también espacios internos alrededor de los guiones.
            const conEspaciosInternos = `${s1}${caja(w1)} ${g1} ${caja(w2)} ${g2} ${caja(d1)}${caja(d2)}${s2}${s3}`;
            return { decorado, conEspaciosInternos, canonico };
          }),
      );

    fc.assert(
      fc.property(variacion, ({ decorado, conEspaciosInternos, canonico }) => {
        expect(normalizarCodigo(decorado)).toBe(canonico);
        expect(normalizarCodigo(conEspaciosInternos)).toBe(canonico);
        // Y ambas vistas normalizan al mismo valor entre sí.
        expect(normalizarCodigo(decorado)).toBe(
          normalizarCodigo(conEspaciosInternos),
        );
      }),
      { numRuns: 300 },
    );
  });
});
