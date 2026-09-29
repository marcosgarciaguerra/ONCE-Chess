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
 * Cada carácter se anuncia de forma inequívoca:
 * - Letras: "M de Madrid".
 * - Dígitos: la palabra del número ("cuatro", "dos").
 * - Guiones: "guion".
 *
 * Ejemplo: `MESA-ROSA-42` →
 * "M de Madrid, E de Enrique, S de Sábado, A de Antonio, guion,
 *  R de Ramón, O de Oviedo, S de Sábado, A de Antonio, guion, cuatro, dos".
 */
export function deletrearCodigo(codigo: string): string {
  const partes: string[] = [];
  for (const char of codigo.toUpperCase()) {
    if (char === "-") {
      partes.push("guion");
    } else if (char in DIGITO_A_PALABRA) {
      partes.push(DIGITO_A_PALABRA[char]);
    } else if (char in LETRA_A_PALABRA) {
      partes.push(`${char} de ${LETRA_A_PALABRA[char]}`);
    } else if (char.trim().length > 0) {
      // Cualquier otro carácter visible se anuncia tal cual como respaldo.
      partes.push(char);
    }
  }
  return partes.join(", ");
}

/**
 * Construye el enlace directo para unirse a una partida a partir de su código.
 * Usa el `origin` de la ventana actual; en un entorno sin `window` (SSR)
 * devuelve una ruta relativa, suficiente para copiar/mostrar sin fallar.
 */
function construirEnlace(codigo: string): string {
  const ruta = `/tablero/online/${encodeURIComponent(codigo)}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${ruta}`;
  }
  return ruta;
}

export function OnlineLobby({
  onCrear,
  onUnirse,
  codigoActual,
  errorMensaje,
}: OnlineLobbyProps) {
  const { settings } = useSettings();
  const { message, announce } = useAnnouncer({
    voiceRate: settings.voiceRate,
    speechEnabled: settings.speechEnabled,
  });

  const [entrada, setEntrada] = useState("");
  const inputId = useId();
  const spellId = useId();
  const errorId = useId();

  const tieneCodigo = typeof codigoActual === "string" && codigoActual.length > 0;
  const deletreo = tieneCodigo ? deletrearCodigo(codigoActual!) : "";

  const handleCrear = useCallback(() => {
    onCrear();
    announce("Creando partida.");
  }, [onCrear, announce]);

  const handleUnirse = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const normalizado = normalizarCodigo(entrada);
      if (normalizado.length === 0) {
        announce("Escribe un código de partida para unirte.", {
          assertive: true,
        });
        return;
      }
      if (!esCodigoValido(normalizado)) {
        announce(
          "El código no tiene un formato válido. Debe ser dos palabras y dos números, por ejemplo MESA-ROSA-42.",
          { assertive: true },
        );
        return;
      }
      // Req 10.3: se une con el código ya normalizado; el servidor decide si
      // existe/está disponible y el padre nos devolverá el error si procede.
      onUnirse(normalizado);
      announce(`Uniéndose a la partida ${normalizado}.`);
    },
    [entrada, onUnirse, announce],
  );

  const handleCopiar = useCallback(async () => {
    if (!tieneCodigo) {
      return;
    }
    const enlace = construirEnlace(codigoActual!);
    const clipboard =
      typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    // Guarda ante ausencia de la API de portapapeles (navegadores sin soporte
    // o contextos no seguros): se anuncia el enlace para copiarlo a mano.
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
    <section aria-labelledby={`${inputId}-titulo`} className="flex flex-col gap-6">
      <h2 id={`${inputId}-titulo`} className="text-lg font-semibold">
        Partida en línea
      </h2>

      {/* Región en vivo del lobby: creación, copia y errores de código. */}
      <LiveRegion message={message} />

      {/* Error de código proporcionado por el padre (servidor/hook). */}
      {errorMensaje ? (
        <div
          id={errorId}
          role="alert"
          aria-live="assertive"
          className="rounded border-2 border-[var(--once-focus)] bg-[var(--once-panel)] p-3 text-[var(--once-ink)]"
        >
          <p className="font-semibold">{errorMensaje}</p>
          <button
            type="button"
            className="once-btn once-btn-primary mt-2"
            onClick={handleCrear}
          >
            Crear una nueva partida
          </button>
        </div>
      ) : null}

      {tieneCodigo ? (
        <div className="flex flex-col gap-3 rounded border border-[var(--once-ring)] bg-[var(--once-panel)] p-4">
          <p className="flex flex-col gap-1">
            <span className="text-sm text-[var(--once-muted)]">
              Código de la partida
            </span>
            <span
              className="text-2xl font-bold tracking-widest"
              aria-describedby={spellId}
            >
              {codigoActual}
            </span>
          </p>

          {/* Deletreo visible + accesible del código (Req 9.7). */}
          <p id={spellId} className="text-sm text-[var(--once-muted)]">
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
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--once-muted)]">
            Crea una partida nueva y comparte el código, o únete con el código
            que te hayan facilitado.
          </p>
          <button
            type="button"
            className="once-btn once-btn-primary self-start"
            onClick={handleCrear}
          >
            Crear partida
          </button>
        </div>
      )}

      {/* Campo de unión: normaliza la entrada antes de unirse (Req 10.3). */}
      <form className="flex flex-col gap-2" onSubmit={handleUnirse} noValidate>
        <label htmlFor={inputId} className="text-sm font-medium">
          Unirse con un código
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            className="min-w-0 flex-1 rounded border border-[var(--once-ring)] bg-white px-3 py-2 text-[var(--once-ink)]"
            placeholder="Ej.: MESA-ROSA-42"
            value={entrada}
            onChange={(event) => setEntrada(event.target.value)}
            aria-describedby={errorMensaje ? errorId : undefined}
          />
          <button type="submit" className="once-btn once-btn-primary">
            Unirse
          </button>
        </div>
        <p className="text-xs text-[var(--once-muted)]">
          No importan mayúsculas, espacios ni guiones: se ajustan
          automáticamente.
        </p>
      </form>
    </section>
  );
}
