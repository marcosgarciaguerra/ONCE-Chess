/**
 * Property 5: Tolerancia a corrupción (Validates: Requisito 5.1)
 *
 * `readJson(key, fallback, validate)` NUNCA lanza y devuelve `fallback` ante
 * cualquier contenido corrupto o ausente de `localStorage`:
 * - clave ausente,
 * - JSON sintácticamente inválido (cadenas basura arbitrarias),
 * - JSON válido cuyo valor parseado no supera el validador de esquema.
 *
 * El entorno de pruebas es jsdom (Vitest, globals activados), por lo que
 * `window.localStorage` existe y lo sembramos con cadenas crudas generadas por
 * fast-check mediante `window.localStorage.setItem`.
 *
 * design.md, Property 5: "Para cualquier contenido de `localStorage` (incluido
 * JSON corrupto), las funciones `load*` devuelven un valor válido y nunca lanzan."
 */

import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { readJson, STORAGE_KEYS, type StorageKey } from "./storage";

/** Todas las claves versionadas disponibles, para variar la clave leída. */
const ALL_KEYS: StorageKey[] = Object.values(STORAGE_KEYS);

/** Un generador de la clave a leer. */
const arbKey = fc.constantFrom(...ALL_KEYS);

/**
 * Valor centinela (`fallback`) que devolvemos y comprobamos por identidad
 * referencial: si `readJson` devuelve exactamente este objeto sabemos que tomó
 * la rama del fallback y no un valor parseado del almacenamiento.
 */
const FALLBACK = Object.freeze({ __fallback: true as const });
type Fallback = typeof FALLBACK;

/**
 * Envuelve la lectura para capturar cualquier excepción: si `readJson` lanzara,
 * marcamos `threw = true` (fallo de la propiedad). En condiciones normales
 * `threw` permanece `false` y devolvemos el valor obtenido.
 */
function safeRead<T>(
  key: StorageKey,
  fallback: T,
  validate: (v: unknown) => v is T,
): { threw: boolean; value: T | undefined } {
  try {
    return { threw: false, value: readJson(key, fallback, validate) };
  } catch {
    return { threw: true, value: undefined };
  }
}

describe("Property 5: Tolerancia a corrupción (readJson) — Validates: Requisito 5.1", () => {
  beforeEach(() => {
    // Cada iteración parte de un almacenamiento limpio para evitar arrastre.
    window.localStorage.clear();
  });

  it("con la clave ausente NUNCA lanza y devuelve el fallback", () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        // No sembramos nada: la clave está ausente por definición.
        const validateNever = (_v: unknown): _v is Fallback => true;
        const { threw, value } = safeRead(key, FALLBACK, validateNever);
        expect(threw).toBe(false);
        expect(value).toBe(FALLBACK);
      }),
    );
  });

  it("con JSON sintácticamente inválido NUNCA lanza y devuelve el fallback", () => {
    fc.assert(
      fc.property(arbKey, fc.string(), (key, raw) => {
        // Sólo nos interesan las cadenas que NO son JSON válido; el resto se
        // descartan con fc.pre para no confundir con el caso "esquema inválido".
        let isValidJson = true;
        try {
          JSON.parse(raw);
        } catch {
          isValidJson = false;
        }
        fc.pre(!isValidJson);

        window.localStorage.setItem(key, raw);

        const validateNever = (_v: unknown): _v is Fallback => true;
        const { threw, value } = safeRead(key, FALLBACK, validateNever);
        expect(threw).toBe(false);
        expect(value).toBe(FALLBACK);
      }),
    );
  });

  it("con JSON válido que NO supera el validador de esquema devuelve el fallback sin lanzar", () => {
    fc.assert(
      fc.property(arbKey, fc.jsonValue(), (key, jsonValue) => {
        // Sembramos JSON perfectamente parseable...
        window.localStorage.setItem(key, JSON.stringify(jsonValue));

        // ...pero con un validador que SIEMPRE rechaza el esquema.
        const validateReject = (_v: unknown): _v is Fallback => false;
        const { threw, value } = safeRead(key, FALLBACK, validateReject);
        expect(threw).toBe(false);
        expect(value).toBe(FALLBACK);
      }),
    );
  });

  it("un validador que lanza no propaga la excepción: devuelve el fallback", () => {
    fc.assert(
      fc.property(arbKey, fc.jsonValue(), (key, jsonValue) => {
        window.localStorage.setItem(key, JSON.stringify(jsonValue));

        // Un validador defensivo nunca debería lanzar, pero readJson lo blinda.
        const validateThrows = (_v: unknown): _v is Fallback => {
          throw new Error("validador defectuoso");
        };
        const { threw, value } = safeRead(key, FALLBACK, validateThrows);
        expect(threw).toBe(false);
        expect(value).toBe(FALLBACK);
      }),
    );
  });

  it("para contenido arbitrario (basura, JSON o ausencia) NUNCA lanza", () => {
    // Cobertura conjunta: mezclamos los tres orígenes de corrupción en una sola
    // propiedad para atacar el espacio de entradas de forma más amplia.
    const arbRaw = fc.oneof(
      fc.string(), // cadenas arbitrarias (posible basura / no-JSON)
      fc.json(), // cadenas JSON válidas arbitrarias
      fc.constant(null), // sentinela: representa "no sembrar" (clave ausente)
    );
    // Un validador que sólo acepta objetos con { ok: true }: la inmensa mayoría
    // de las entradas generadas fallarán el esquema, forzando el fallback.
    const validateShape = (v: unknown): v is Fallback =>
      typeof v === "object" &&
      v !== null &&
      (v as Record<string, unknown>).__fallback === true;

    fc.assert(
      fc.property(arbKey, arbRaw, (key, raw) => {
        if (raw !== null) {
          window.localStorage.setItem(key, raw);
        }
        const { threw, value } = safeRead(key, FALLBACK, validateShape);
        expect(threw).toBe(false);
        // Ninguna entrada generada tiene la forma esperada, así que siempre
        // debe caer en el fallback.
        expect(value).toBe(FALLBACK);
      }),
    );
  });
});
