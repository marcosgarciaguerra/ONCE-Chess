/**
 * Pruebas unitarias de la capa de anotaciones y del manejo de cuota (Task 3.8).
 *
 * Cubren las reglas de validación de `saveAnnotation` y la retirada por `id`
 * de `removeAnnotation`, más el comportamiento tolerante ante
 * `QuotaExceededError`:
 * - FEN inválido → `saveAnnotation` devuelve la lista sin cambios y no persiste
 *   nada (Requisito 7.1).
 * - `title` vacío tras `trim()` → lista sin cambios (Requisito 7.2).
 * - `title` > 120 caracteres se recorta a 120; `note` > 2000 se recorta a 2000
 *   (Requisito 7.3).
 * - `note` ausente → se persiste como cadena vacía `""` (Requisito 7.4).
 * - `QuotaExceededError` simulado: `saveSettings` devuelve
 *   `{ ok: false, error: SETTINGS_SAVE_ERROR_MESSAGE }` sin lanzar, y
 *   `saveAnnotation`/`saveAnnotations` tampoco lanzan bajo cuota (Requisito 5.4).
 * - `removeAnnotation(id)` retira la entrada coincidente y conserva el resto.
 *
 * Entorno jsdom (Vitest, globals): `window.localStorage` existe. Se limpia
 * entre pruebas para evitar arrastre de estado.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadAnnotations,
  saveAnnotation,
  saveAnnotations,
  removeAnnotation,
  saveSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SAVE_ERROR_MESSAGE,
  STORAGE_KEYS,
  type Annotation,
} from "./storage";

/** FEN de la posición inicial estándar: válido para `new Chess(fen)`. */
const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Un segundo FEN válido (tras 1. e4) para variar posiciones. */
const AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

/** Lee directamente el contenido crudo persistido en la clave de anotaciones. */
function readRawAnnotations(): string | null {
  return window.localStorage.getItem(STORAGE_KEYS.annotations);
}

describe("saveAnnotation — validación de entrada (Requisitos 7.1–7.4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("rechaza un FEN inválido: lista sin cambios y nada persistido (Req. 7.1)", () => {
    const result = saveAnnotation({
      fen: "esto-no-es-un-fen",
      title: "Título válido",
      note: "Una nota",
    });

    // La lista devuelta es la actual (vacía) sin la nueva entrada.
    expect(result).toEqual([]);
    // No se ha escrito nada en localStorage.
    expect(readRawAnnotations()).toBeNull();
    // Y una recarga confirma que sigue vacío.
    expect(loadAnnotations()).toEqual([]);
  });

  it("no altera anotaciones previas si el FEN es inválido (Req. 7.1)", () => {
    // Sembramos una anotación válida primero.
    const seeded = saveAnnotation({ fen: STARTING_FEN, title: "Inicial" });
    expect(seeded).toHaveLength(1);

    const afterInvalid = saveAnnotation({
      fen: "no-fen",
      title: "Otra",
    });

    // La lista queda idéntica a la sembrada.
    expect(afterInvalid).toEqual(seeded);
    expect(loadAnnotations()).toEqual(seeded);
  });

  it("rechaza un title vacío tras trim: lista sin cambios (Req. 7.2)", () => {
    const result = saveAnnotation({
      fen: STARTING_FEN,
      title: "   ",
      note: "Nota",
    });

    expect(result).toEqual([]);
    expect(readRawAnnotations()).toBeNull();
    expect(loadAnnotations()).toEqual([]);
  });

  it("rechaza un title de cadena vacía: lista sin cambios (Req. 7.2)", () => {
    const result = saveAnnotation({ fen: STARTING_FEN, title: "" });
    expect(result).toEqual([]);
    expect(loadAnnotations()).toEqual([]);
  });

  it("recorta title a 120 caracteres y note a 2000 (Req. 7.3)", () => {
    const longTitle = "T".repeat(200);
    const longNote = "N".repeat(3000);

    const result = saveAnnotation({
      fen: STARTING_FEN,
      title: longTitle,
      note: longNote,
    });

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry.title).toHaveLength(120);
    expect(entry.title).toBe("T".repeat(120));
    expect(entry.note).toHaveLength(2000);
    expect(entry.note).toBe("N".repeat(2000));

    // Persistido con los mismos recortes.
    const [persisted] = loadAnnotations();
    expect(persisted.title).toHaveLength(120);
    expect(persisted.note).toHaveLength(2000);
  });

  it("recorta el title tras aplicar trim antes de limitar a 120 (Req. 7.2, 7.3)", () => {
    // El trim se aplica primero; luego el recorte a 120 sobre el resultado.
    const padded = `   ${"A".repeat(150)}   `;
    const [entry] = saveAnnotation({ fen: STARTING_FEN, title: padded });
    expect(entry.title).toBe("A".repeat(120));
  });

  it("persiste note como cadena vacía cuando se omite (Req. 7.4)", () => {
    const result = saveAnnotation({ fen: STARTING_FEN, title: "Sin nota" });

    expect(result).toHaveLength(1);
    expect(result[0].note).toBe("");

    const [persisted] = loadAnnotations();
    expect(persisted.note).toBe("");
  });

  it("asigna id no vacío y savedAt numérico a la nueva entrada (Req. 7.5)", () => {
    const [entry] = saveAnnotation({ fen: STARTING_FEN, title: "Con id" });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.savedAt).toBe("number");
    expect(Number.isFinite(entry.savedAt)).toBe(true);
    expect(entry.fen).toBe(STARTING_FEN);
  });

  it("inserta la anotación más reciente al frente (índice 0)", () => {
    saveAnnotation({ fen: STARTING_FEN, title: "Primera" });
    const list = saveAnnotation({ fen: AFTER_E4_FEN, title: "Segunda" });

    expect(list).toHaveLength(2);
    expect(list[0].title).toBe("Segunda");
    expect(list[1].title).toBe("Primera");
  });
});

describe("removeAnnotation — retirada por id (Requisito 7.7)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("elimina la entrada indicada y conserva el resto", () => {
    saveAnnotation({ fen: STARTING_FEN, title: "A" });
    const twoItems = saveAnnotation({ fen: AFTER_E4_FEN, title: "B" });
    expect(twoItems).toHaveLength(2);

    const targetId = twoItems[1].id; // la anotación "A"
    const remaining = removeAnnotation(targetId);

    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("B");
    expect(remaining.some((a) => a.id === targetId)).toBe(false);

    // Persistido: una recarga confirma el estado.
    expect(loadAnnotations()).toEqual(remaining);
  });

  it("no cambia la lista si el id no existe", () => {
    const list = saveAnnotation({ fen: STARTING_FEN, title: "Única" });
    const result = removeAnnotation("id-inexistente");
    expect(result).toEqual(list);
    expect(loadAnnotations()).toEqual(list);
  });

  it("devuelve lista vacía al eliminar la última anotación", () => {
    const [only] = saveAnnotation({ fen: STARTING_FEN, title: "Sola" });
    const result = removeAnnotation(only.id);
    expect(result).toEqual([]);
    expect(loadAnnotations()).toEqual([]);
  });
});

describe("Manejo de QuotaExceededError (Requisito 5.4)", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    // Simulamos cuota agotada: setItem lanza QuotaExceededError en cada escritura.
    setItemSpy = vi
      .spyOn(window.localStorage.__proto__, "setItem")
      .mockImplementation(() => {
        // DOMException con el nombre estándar de cuota agotada.
        throw new DOMException("cuota agotada", "QuotaExceededError");
      });
  });

  afterEach(() => {
    // Restauramos el mock para no afectar a otras pruebas.
    setItemSpy.mockRestore();
    window.localStorage.clear();
  });

  it("saveSettings devuelve { ok: false, error } y no lanza bajo cuota", () => {
    let result: ReturnType<typeof saveSettings> | undefined;
    expect(() => {
      result = saveSettings(DEFAULT_SETTINGS);
    }).not.toThrow();

    expect(result).toEqual({
      ok: false,
      error: SETTINGS_SAVE_ERROR_MESSAGE,
    });
  });

  it("saveAnnotation no lanza bajo cuota y devuelve la lista en memoria", () => {
    let result: Annotation[] | undefined;
    expect(() => {
      result = saveAnnotation({ fen: STARTING_FEN, title: "Bajo cuota" });
    }).not.toThrow();

    // La entrada se crea en memoria y se devuelve aunque no se pueda persistir.
    expect(result).toHaveLength(1);
    expect(result?.[0].title).toBe("Bajo cuota");
  });

  it("saveAnnotations no lanza bajo cuota", () => {
    const items: Annotation[] = [
      {
        id: "x1",
        fen: STARTING_FEN,
        title: "T",
        note: "",
        savedAt: 1,
      },
    ];
    expect(() => saveAnnotations(items)).not.toThrow();
  });
});
