"use client";

/**
 * `OnlineLobby` — Vestíbulo del modo en línea de ONCE Chess.
 *
 * Permite **crear** una partida o **unirse** a una existente mediante su
 * código. El foco de accesibilidad está en que el código sea **comunicable en
 * voz**: cuando ya existe un código de partida se muestra en pantalla y se
 * ofrece una versión **deletreada** letra a letra (con palabras de apoyo tipo
 * "M de Madrid"), tanto de forma visible como para lector de pantalla. Un botón
 * "Copiar enlace" copia el enlace directo de la partida al portapapeles y
 * anuncia el resultado por `aria-live` + voz.
 *
 * El campo de unión aplica `normalizarCodigo` a lo que escribe la persona antes
 * de intentar unirse (tolerante a mayúsculas, espacios y guiones) y, si el
 * formato es claramente inválido, lo anuncia como error sin llamar al servidor.
 * Los errores de red del propio código (código inexistente, expirado, partida
 * llena) los decide el servidor a través del hook `useOnlineGame`; el
 * componente padre (ruta `/tablero/online/[codigo]`, tarea 16) los pasa aquí
 * mediante la prop opcional `errorMensaje`, que se renderiza en una región
 * `aria-live` y se acompaña de un acceso para crear una nueva partida.
 *
 * Requisitos cubiertos: 9.6, 9.7, 10.3, 10.6, 10.7, 10.8.
 */

import { useCallback, useId, useState } from "react";

import { LiveRegion, useAnnouncer } from "@/components/a11y/LiveRegion";
import { useSettings } from "@/context/SettingsProvider";
import { esCodigoValido, normalizarCodigo } from "@/lib/gameCode";

export type OnlineLobbyProps = {
  /** Crea una nueva partida (asigna blancas al creador). */
  onCrear: () => void;
  /** Se une a una partida existente con el código ya normalizado. */
  onUnirse: (codigo: string) => void;
  /** Si ya se creó/entró en una partida, su código para leerlo y copiarlo. */
  codigoActual?: string;
  /**
   * Mensaje de error accesible que el padre (hook/servidor) desea anunciar,
   * p. ej. "Ese código de partida no existe." (código-invalido),
   * "La partida ha caducado." (código-expirado) o "La partida ya tiene dos
   * jugadores." (partida-llena). Se renderiza en una región `aria-live` y va
   * acompañado de un acceso para crear una nueva partida (Req 10.6/10.7/10.8).
   */
  errorMensaje?: string;
};

/**
 * Nombre de apoyo para deletrear cada letra sin ambigüedad (alfabeto
 * fonético en español, estilo "M de Madrid"). Sólo se usan letras `A-Z` y `Ñ`,
 * que es cuanto puede aparecer en el diccionario curado de códigos.
 */
const LETRA_A_PALABRA: Record<string, string> = {
  A: "Antonio",
  B: "Burgos",
  C: "Carmen",
  D: "Dolores",
  E: "Enrique",
  F: "Francia",
  G: "Gerona",
  H: "Historia",
  I: "Inés",
  J: "José",
  K: "Kilo",
  L: "Lérida",
  M: "Madrid",
  N: "Navarra",
  Ñ: "Ñoño",
  O: "Oviedo",
  P: "París",
  Q: "Querido",
  R: "Ramón",
  S: "Sábado",
  T: "Toledo",
  U: "Ulises",
  V: "Valencia",
  W: "Washington",
  X: "Xilófono",
  Y: "Yegua",
  Z: "Zaragoza",
};

/** Nombre en español de cada dígito, para deletrearlo como palabra. */
const DIGITO_A_PALABRA: Record<string, string> = {
  "0": "cero",
  "1": "uno",
  "2": "dos",
  "3": "tres",
  "4": "cuatro",
  "5": "cinco",
  "6": "seis",
  "7": "siete",
  "8": "ocho",
  "9": "nueve",
};

/**
 * Construye una lectura deletreada del código para voz y lector de pantalla.
 *
 * Ejemplo: `MESA-ROSA-42` →
 * `M de Madrid, E de Enrique, S de Sábado, A de Antonio, guion, …`
 */
export function deletrearCodigo(codigo: string): string {
  const partes: string[] = [];
  for (const ch of codigo.toUpperCase()) {
    if (ch === "-") {
      partes.push("guion");
      continue;
    }
    if (DIGITO_A_PALABRA[ch]) {
      partes.push(DIGITO_A_PALABRA[ch]);
      continue;
    }
    const palabra = LETRA_A_PALABRA[ch];
    if (palabra) {
      partes.push(`${ch} de ${palabra}`);
    } else {
      partes.push(ch);
    }
  }
  return partes.join(", ");
}

export function OnlineLobby({
  onCrear,
  onUnirse,
  codigoActual,
  errorMensaje,
}: OnlineLobbyProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const spellId = `${inputId}-spell`;
  const { settings } = useSettings();
  const { message, announce } = useAnnouncer({
    voiceRate: settings.voiceRate,
    speechEnabled: settings.speechEnabled,
  });

  const [entrada, setEntrada] = useState("");
  const tieneCodigo = Boolean(codigoActual && codigoActual.length > 0);
  const deletreo = tieneCodigo ? deletrearCodigo(codigoActual!) : "";

  const handleCrear = useCallback(() => {
    announce("Creando partida. Se te asignarán las blancas.");
    onCrear();
  }, [announce, onCrear]);

  const handleUnirse = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const normalizado = normalizarCodigo(entrada);
      if (!esCodigoValido(normalizado)) {
        announce(
          "Ese código no tiene un formato válido. Debe ser dos palabras y dos dígitos, por ejemplo mesa rosa 42.",
          { assertive: true },
        );
        return;
      }
      announce(`Uniendo a la partida ${normalizado}.`);
      onUnirse(normalizado);
    },
    [announce, entrada, onUnirse],
  );

  const handleCopiar = useCallback(async () => {
    if (!tieneCodigo || !codigoActual) return;
    const enlace =
      typeof window !== "undefined"
        ? `${window.location.origin}/tablero/online/${encodeURIComponent(codigoActual)}`
        : `/tablero/online/${encodeURIComponent(codigoActual)}`;
    const clipboard =
      typeof navigator !== "undefined" ? navigator.clipboard : undefined;

    if (!clipboard || typeof clipboard.writeText !== "function") {
      announce(
        `No se pudo copiar automáticamente. El enlace es ${enlace}`,
        { assertive: true },
      );
      return;
    }
    try {
      await clipboard.writeText(enlace);
      announce("Enlace de la partida copiado al portapapeles.");
    } catch {
      announce(
        `No se pudo copiar el enlace. El enlace es ${enlace}`,
        { assertive: true },
      );
    }
  }, [tieneCodigo, codigoActual, announce]);

  return (
    <section
      aria-labelledby={`${inputId}-titulo`}
      className="once-surface flex max-w-xl flex-col gap-6 p-5 sm:p-6"
    >
      <div className="space-y-2">
        <h2
          id={`${inputId}-titulo`}
          className="once-display text-2xl font-semibold text-[var(--once-ink)]"
        >
          Partida en línea
        </h2>
        <p className="text-[var(--once-muted)]">
          Crea una partida y comparte el código deletreado, o únete con el
          código que te hayan dictado. Todo se anuncia por voz.
        </p>
      </div>

      <LiveRegion message={message} />

      {errorMensaje ? (
        <div
          id={errorId}
          role="alert"
          aria-live="assertive"
          className="rounded-[var(--once-radius)] bg-[var(--once-panel)] p-4 text-[var(--once-ink)] shadow-[inset_0_0_0_2px_var(--once-focus)]"
        >
          <p className="font-semibold">{errorMensaje}</p>
          <button
            type="button"
            className="once-btn once-btn-primary mt-3"
            onClick={handleCrear}
          >
            Crear una nueva partida
          </button>
        </div>
      ) : null}

      {tieneCodigo ? (
        <div className="once-surface-quiet flex flex-col gap-3 p-4">
          <p className="flex flex-col gap-1">
            <span className="once-kicker">Código de la partida</span>
            <span
              className="once-display text-3xl font-bold tracking-[0.12em] text-[var(--once-ink)]"
              aria-describedby={spellId}
            >
              {codigoActual}
            </span>
          </p>

          <p id={spellId} className="text-sm leading-relaxed text-[var(--once-muted)]">
            <span className="sr-only">Deletreado: </span>
            {deletreo}
          </p>

          <button
            type="button"
            className="once-btn once-btn-primary self-start"
            onClick={handleCopiar}
          >
            Copiar enlace
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="once-btn once-btn-primary once-btn-lg self-start"
            onClick={handleCrear}
          >
            Crear partida
          </button>
        </div>
      )}

      <form className="flex flex-col gap-2" onSubmit={handleUnirse} noValidate>
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-[var(--once-ink)]"
        >
          Unirse con un código
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-[var(--once-radius)] bg-[var(--once-bg)] px-3 py-2.5 text-[var(--once-ink)] shadow-[inset_0_0_0_1px_var(--once-ring)]"
            placeholder="Ej.: MESA-ROSA-42"
            value={entrada}
            onChange={(event) => setEntrada(event.target.value)}
            aria-describedby={errorMensaje ? errorId : `${inputId}-hint`}
          />
          <button type="submit" className="once-btn once-btn-primary">
            Unirse
          </button>
        </div>
        <p id={`${inputId}-hint`} className="text-xs text-[var(--once-muted)]">
          No importan mayúsculas, espacios ni guiones: se ajustan
          automáticamente.
        </p>
      </form>
    </section>
  );
}
