/**
 * Pruebas de propiedad de Settings (Task 3.4).
 *
 * Cubre dos propiedades de corrección del diseño sobre la capa de persistencia
 * de ajustes (`src/lib/storage.ts`):
 *
 * - **Property 1: Persistencia idempotente** (Validates: Requisito 5.6)
 *   Para cualquier objeto de ajustes `s`, tras `saveSettings(s)` la posterior
 *   `loadSettings()` devuelve un objeto igual campo a campo a `normalizeSettings(s)`.
 *   Es decir, la forma persistida es la forma canónica y volver a cargarla no
 *   introduce cambios: `loadSettings(saveSettings(s)) === s` tras normalización.
 *
 * - **Property 6: Clamp de voz** (Validates: Requisito 4.5)
 *   Para todo valor `x` de `voiceRate` (incluidos `NaN`, `Infinity`, fuera de
 *   rango o no numéricos), tras normalizar y persistir el `voiceRate` cargado
 *   queda en `[0.5, 2.0]`; los valores no numéricos se sustituyen por `1.0`.
 *
 * Entorno: jsdom (Vitest, globals). `window.localStorage` existe; se limpia
 * antes de cada iteración para evitar arrastre entre ejecuciones.
 *
 * **Validates: Requisitos 5.6, 4.5**
 */

import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type Settings,
} from "./storage";

const VOICE_RATE_MIN = 0.5;
const VOICE_RATE_MAX = 2.0;

/**
 * Generador de un `voiceRate` "arbitrario" que ataca de forma deliberada todo
 * el espacio de entradas relevantes: valores dentro de rango, fuera de rango
 * por ambos extremos, los límites exactos, y los casos degenerados no finitos
 * (`NaN`, `±Infinity`).
 */
const arbVoiceRate = fc.oneof(
  fc.double({ min: -1000, max: 1000, noNaN: false }),
  fc.double(), // incluye NaN, ±Infinity y subnormales por defecto
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    VOICE_RATE_MIN,
    VOICE_RATE_MAX,
    VOICE_RATE_MIN - 0.0001,
    VOICE_RATE_MAX + 0.0001,
    0,
    1.0,
  ),
);

/**
 * Generador de un objeto "parecido a Settings" completo y bien tipado. Sirve a
 * la propiedad de persistencia idempotente: dado que `saveSettings` recibe un
 * `Settings`, generamos los cuatro campos con sus tipos correctos, dejando la
 * variación interesante de `voiceRate` al clamp de la normalización.
 */
const arbSettings: fc.Arbitrary<Settings> = fc.record({
  voiceRate: arbVoiceRate,
  showPawnLetter: fc.boolean(),
  highContrast: fc.boolean(),
  speechEnabled: fc.boolean(),
});

/**
 * Generador de un valor arbitrario y potencialmente corrupto/parcial para el
 * campo de ajustes, con el fin de ejercitar `normalizeSettings` sobre formas
 * inesperadas (campos ausentes, tipos equivocados, valores extra, etc.).
 */
const arbSettingsLike = fc.oneof(
  arbSettings,
  fc.record(
    {
      voiceRate: fc.oneof(arbVoiceRate, fc.string(), fc.constant(null)),
      showPawnLetter: fc.oneof(fc.boolean(), fc.string(), fc.integer()),
      highContrast: fc.oneof(fc.boolean(), fc.string(), fc.integer()),
      speechEnabled: fc.oneof(fc.boolean(), fc.string(), fc.integer()),
    },
    { requiredKeys: [] },
  ),
);

describe("Property 1: Persistencia idempotente de Settings — Validates: Requisito 5.6", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loadSettings() tras saveSettings(s) es igual campo a campo a normalizeSettings(s)", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        const expected = normalizeSettings(s);

        const result = saveSettings(s);
        expect(result.ok).toBe(true);

        const loaded = loadSettings();
        // Igualdad estructural campo a campo (la forma canónica es estable).
        expect(loaded).toStrictEqual(expected);
      }),
    );
  });

  it("es idempotente al re-guardar lo cargado: loadSettings(save(load(save(s)))) es estable", () => {
    fc.assert(
      fc.property(arbSettings, (s) => {
        window.localStorage.clear();

        saveSettings(s);
        const first = loadSettings();

        // Re-guardar el valor ya normalizado no debe cambiar nada.
        saveSettings(first);
        const second = loadSettings();

        expect(second).toStrictEqual(first);
        expect(second).toStrictEqual(normalizeSettings(s));
      }),
    );
  });

  it("normaliza formas parciales o corruptas y las persiste en forma canónica", () => {
    fc.assert(
      fc.property(arbSettingsLike, (raw) => {
        const expected = normalizeSettings(raw);

        // saveSettings acepta un Settings; la normalización interna sanea la
        // forma. Pasamos el valor crudo mediante un cast controlado para
        // ejercitar la ruta de saneamiento (el módulo no debe lanzar).
        saveSettings(raw as Settings);
        const loaded = loadSettings();

        expect(loaded).toStrictEqual(expected);
        // Todos los campos quedan en su tipo canónico.
        expect(typeof loaded.voiceRate).toBe("number");
        expect(typeof loaded.showPawnLetter).toBe("boolean");
        expect(typeof loaded.highContrast).toBe("boolean");
        expect(typeof loaded.speechEnabled).toBe("boolean");
      }),
    );
  });
});

describe("Property 6: Clamp de voz — Validates: Requisito 4.5", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizeSettings deja voiceRate en [0.5, 2.0] para todo x numérico o no", () => {
    fc.assert(
      fc.property(arbVoiceRate, (x) => {
        const normalized = normalizeSettings({ voiceRate: x });
        expect(normalized.voiceRate).toBeGreaterThanOrEqual(VOICE_RATE_MIN);
        expect(normalized.voiceRate).toBeLessThanOrEqual(VOICE_RATE_MAX);
        expect(Number.isFinite(normalized.voiceRate)).toBe(true);
      }),
    );
  });

  it("un voiceRate no numérico (NaN/Infinity/string/null/undefined) se sustituye por 1.0", () => {
    const arbNonNumeric = fc.oneof(
      fc.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ),
      fc.string(),
      fc.constant(null),
      fc.constant(undefined),
      fc.boolean(),
      fc.object(),
    );

    fc.assert(
      fc.property(arbNonNumeric, (x) => {
        const normalized = normalizeSettings({ voiceRate: x as unknown as number });
        expect(normalized.voiceRate).toBe(DEFAULT_SETTINGS.voiceRate);
        expect(normalized.voiceRate).toBe(1.0);
      }),
    );
  });

  it("el clamp sobrevive al ciclo de persistencia: el voiceRate cargado sigue en rango", () => {
    fc.assert(
      fc.property(arbVoiceRate, (x) => {
        window.localStorage.clear();

        saveSettings({
          voiceRate: x,
          showPawnLetter: false,
          highContrast: false,
          speechEnabled: true,
        });

        const loaded = loadSettings();
        expect(loaded.voiceRate).toBeGreaterThanOrEqual(VOICE_RATE_MIN);
        expect(loaded.voiceRate).toBeLessThanOrEqual(VOICE_RATE_MAX);
        expect(loaded.voiceRate).toStrictEqual(
          normalizeSettings({ voiceRate: x }).voiceRate,
        );
      }),
    );
  });
});
