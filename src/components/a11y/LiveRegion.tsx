"use client";

import { useCallback, useState } from "react";
import { speak } from "@/utils/speech";

/**
 * Límite máximo de caracteres para el contenido de la región en vivo.
 * Los mensajes más largos se truncan antes de fijarse (Requisito 8.4).
 */
const MAX_MESSAGE_LENGTH = 500;

export type LiveRegionProps = {
  message: string;
  /** Nivel de urgencia ARIA. Por defecto "polite". */
  politeness?: "polite" | "assertive";
  id?: string;
};

/**
 * Región compartida `aria-live` reutilizable para anunciar cambios de estado
 * a lectores de pantalla sin duplicar markup.
 *
 * Renderiza `<p class="sr-only" aria-live aria-atomic="true">` (Requisito 8.1),
 * con `aria-live="assertive"` cuando el mensaje es urgente (Requisito 8.8).
 */
export function LiveRegion({
  message,
  politeness = "polite",
  id,
}: LiveRegionProps) {
  return (
    <p
      id={id}
      className="sr-only"
      aria-live={politeness}
      aria-atomic="true"
    >
      {message}
    </p>
  );
}

/**
 * Opciones de configuración de voz para `useAnnouncer`.
 *
 * Estos valores provienen normalmente del contexto de ajustes
 * (`useSettings`). Como el `SettingsProvider` puede no estar montado todavía
 * (se implementa en una tarea posterior), se pasan como parámetros opcionales
 * con valores por defecto seguros para que el hook nunca dependa de un
 * proveedor inexistente ni lance errores.
 */
export type UseAnnouncerOptions = {
  /** Velocidad de voz aplicada a `speak(...)`. Por defecto 1. */
  voiceRate?: number;
  /** Si es falso, se entrega solo `aria-live` sin voz (Requisito 8.7). */
  speechEnabled?: boolean;
};

export type UseAnnouncerResult = {
  message: string;
  announce: (
    text: string,
    opts?: { speak?: boolean; assertive?: boolean },
  ) => void;
};

/**
 * Orquesta el anuncio visual (contenido de la `LiveRegion`) y la voz
 * sintetizada respetando las preferencias de accesibilidad.
 *
 * - Ignora mensajes vacíos o compuestos solo por espacios (Requisito 8.3).
 * - Trunca a 500 caracteres (Requisito 8.4).
 * - Reemplaza por completo el contenido anterior (Requisito 8.5).
 * - Emite voz con `speak(text, { rate: voiceRate })` cuando `speechEnabled`
 *   (Requisito 8.6) y solo `aria-live` cuando está desactivado (Requisito 8.7).
 * - Nunca lanza si la Web Speech API no está disponible: `speak` ya lo maneja
 *   internamente (Requisito 8.9).
 *
 * El `voiceRate` y `speechEnabled` se reciben como opciones para evitar un
 * acoplamiento rígido con `useSettings`, que aún no existe. Cuando el
 * proveedor de ajustes esté disponible, el llamante puede pasar
 * `settings.voiceRate` y `settings.speechEnabled`.
 */
export function useAnnouncer(
  options: UseAnnouncerOptions = {},
): UseAnnouncerResult {
  const { voiceRate = 1, speechEnabled = true } = options;
  const [message, setMessage] = useState("");

  const announce = useCallback(
    (text: string, opts?: { speak?: boolean; assertive?: boolean }) => {
      // Requisito 8.3: ignorar mensajes vacíos o de solo espacios,
      // conservando el contenido previo.
      if (text.trim().length === 0) {
        return;
      }

      // Requisito 8.4: truncar a 500 caracteres.
      const truncated =
        text.length > MAX_MESSAGE_LENGTH
          ? text.slice(0, MAX_MESSAGE_LENGTH)
          : text;

      // Requisito 8.5: reemplazar por completo el contenido anterior.
      setMessage(truncated);

      // Requisitos 8.6/8.7/8.9: voz opcional respetando speechEnabled.
      // `speak` no hace nada si `window.speechSynthesis` no existe.
      const shouldSpeak = opts?.speak ?? true;
      if (shouldSpeak && speechEnabled) {
        speak(truncated, { rate: voiceRate });
      }
    },
    [speechEnabled, voiceRate],
  );

  return { message, announce };
}
