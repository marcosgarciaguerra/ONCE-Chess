"use client";

/**
 * Proveedor global de ajustes de accesibilidad de ONCE Chess.
 *
 * `SettingsProvider` mantiene el estado `Settings` (velocidad de voz, letra en
 * peones, alto contraste y activación de la voz), lo hidrata desde
 * `localStorage` sólo en cliente (para no romper el SSR) y aplica los efectos
 * transversales de cada cambio siguiendo el pseudocódigo `applySetting` del
 * diseño:
 *
 *   normalizar → saveSettings → aplicar data-contrast en <html> →
 *   speak(describeSetting) si speechEnabled
 *
 * Reutiliza deliberadamente la capa de persistencia (`lib/storage.ts`): los
 * tipos `Settings`, `DEFAULT_SETTINGS`, la normalización (`normalizeSettings`,
 * expuesta indirectamente a través de `saveSettings`/`loadSettings`) y el
 * mensaje de error de guardado (`SETTINGS_SAVE_ERROR_MESSAGE`) NO se redefinen
 * aquí. La realimentación por voz se delega en `speak` de `utils/speech.ts`,
 * aplicando siempre el `voiceRate` vigente.
 *
 * Requisitos cubiertos: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12,
 * 4.13, 4.14.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_SAVE_ERROR_MESSAGE,
  type Settings,
} from "@/lib/storage";
import { speak } from "@/utils/speech";

// Reexportamos el tipo por conveniencia para los consumidores del contexto,
// evitando que tengan que importar simultáneamente de `lib/storage`.
export type { Settings };
export { DEFAULT_SETTINGS };

/**
 * Valor expuesto por el contexto de ajustes (design.md, Componente 1).
 * - `settings`: estado actual de ajustes (siempre normalizado).
 * - setters: mutadores que normalizan, persisten y aplican efectos.
 * - `saveError`: mensaje accesible cuando el último guardado falló (o `null`).
 */
export type SettingsContextValue = {
  settings: Settings;
  setVoiceRate: (rate: number) => void;
  toggleShowPawnLetter: () => void;
  toggleHighContrast: () => void;
  toggleSpeech: () => void;
  resetSettings: () => void;
  /**
   * Mensaje de error accesible cuando la persistencia falló (Requisito 4.4);
   * `null` mientras el último guardado tuvo éxito. Permite a los consumidores
   * (p. ej. el panel de ajustes del dashboard) anunciarlo por `aria-live`.
   */
  saveError: string | null;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Aplica (o retira) el atributo `data-contrast="high"` en `<html>` según el
 * valor de `highContrast` (Requisitos 4.7, 4.8, Propiedad 7). Se protege ante
 * entornos sin `document` (SSR) para no lanzar durante el renderizado servidor.
 */
function applyContrastAttribute(highContrast: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (highContrast) {
    root.setAttribute("data-contrast", "high");
  } else {
    root.removeAttribute("data-contrast");
  }
}

/** Nombre legible en español de cada ajuste, para los anuncios por voz. */
const SETTING_LABELS: Record<keyof Settings, string> = {
  voiceRate: "Velocidad de voz",
  showPawnLetter: "Letra en peones",
  highContrast: "Alto contraste",
  speechEnabled: "Voz",
};

/**
 * Construye el mensaje en español que nombra el ajuste modificado y su nuevo
 * valor (Requisito 4.9). Los booleanos se expresan como "activado"/"desactivado"
 * y la velocidad de voz con un decimal (p. ej. "Velocidad de voz: 1.2").
 */
function describeSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): string {
  const label = SETTING_LABELS[key];
  if (key === "voiceRate") {
    return `${label}: ${(value as number).toFixed(1)}`;
  }
  return `${label}: ${(value as boolean) ? "activado" : "desactivado"}`;
}

/**
 * Proveedor de ajustes. Antes de la hidratación en cliente usa
 * `DEFAULT_SETTINGS` para que el markup del servidor y el primer render del
 * cliente coincidan; tras montar, hidrata desde `loadSettings()` en un
 * `useEffect` (sólo cliente). Si la lectura fallara, `loadSettings()` ya
 * devuelve los valores por defecto sin lanzar (Requisitos 4.1, 4.2).
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Espejo del estado vigente para leer el valor más reciente dentro de los
  // setters sin depender del updater funcional de `setSettings` (React no
  // garantiza invocarlo de forma síncrona: StrictMode duplica invocaciones y el
  // batching puede diferirlas). Se sincroniza en un efecto —en lugar de en
  // render— para respetar la regla `react-hooks/refs` del repositorio.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Requisito 4.1/4.2: hidratación sólo en cliente. Antes de la hidratación se
  // renderiza `DEFAULT_SETTINGS` para que el markup del servidor y el primer
  // render del cliente coincidan; tras montar, leemos `localStorage`.
  // `loadSettings` es tolerante y nunca lanza; aun así lo envolvemos en
  // try/catch por robustez para no interrumpir el render.
  const hydrate = useCallback(() => {
    try {
      return loadSettings();
    } catch {
      return DEFAULT_SETTINGS;
    }
  }, []);

  useEffect(() => {
    // Hidratación client-only intencional: el servidor renderiza
    // `DEFAULT_SETTINGS` y el cliente lee `localStorage` tras montar para
    // evitar un desajuste de hidratación. Es el patrón correcto para datos que
    // sólo existen en el navegador, por lo que se exime la regla que
    // desaconseja `setState` en efectos.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(hydrate());
  }, [hydrate]);

  // Efecto derivado: el alto contraste es una función pura del estado, por lo
  // que se refleja en `<html>` cada vez que cambia `highContrast` (Requisitos
  // 4.7, 4.8, Propiedad 7), incluida la hidratación inicial.
  useEffect(() => {
    applyContrastAttribute(settings.highContrast);
  }, [settings.highContrast]);

  /**
   * Persiste un `Settings` ya normalizado y actualiza la señal de error. El
   * estado en memoria se conserva aunque la escritura falle, manteniendo la
   * interfaz operativa (Requisitos 4.4, 5.4).
   */
  const persist = useCallback((next: Settings) => {
    const result = saveSettings(next);
    setSaveError(result.ok ? null : result.error ?? SETTINGS_SAVE_ERROR_MESSAGE);
  }, []);

  /**
   * Realimentación por voz con el `voiceRate` vigente cuando la voz está
   * habilitada (Requisitos 4.9, 4.10, 4.11). No emite nada si `speechEnabled`
   * es falso.
   */
  const announce = useCallback((next: Settings, message: string) => {
    if (next.speechEnabled) {
      speak(message, { rate: next.voiceRate });
    }
  }, []);

  /**
   * Núcleo compartido por los setters: implementa `applySetting` del diseño.
   * Calcula el estado resultante FUERA del updater a partir del valor más
   * reciente (`settingsRef.current`), fusiona el cambio, normaliza el resultado
   * completo, actualiza el estado, persiste y emite realimentación por voz de
   * forma determinista y síncrona con la acción (espejando `resetSettings`).
   * El efecto de contraste se aplica por separado al cambiar
   * `settings.highContrast` (Requisitos 4.3, 4.4, 4.7–4.13).
   *
   * @param patch Función que produce el parche a fusionar a partir del estado
   *   actual (permite alternar booleanos con el valor vigente).
   * @param changedKey Ajuste que se anuncia por voz.
   */
  const applySettings = useCallback(
    (
      patch: (current: Settings) => Partial<Settings>,
      changedKey: keyof Settings,
    ) => {
      // Leemos el estado vigente del espejo síncrono para no depender de que el
      // updater funcional se ejecute de inmediato (StrictMode/batching).
      const current = settingsRef.current;
      // merge + normalización canónica (clamp de voiceRate, saneo booleanos).
      const next = normalizeSettings({ ...current, ...patch(current) });
      setSettings(next);
      persist(next);
      announce(next, describeSetting(changedKey, next[changedKey]));
    },
    [persist, announce],
  );

  // Requisito 4.5/4.6/4.11: fija la velocidad de voz (se normaliza con clamp).
  const setVoiceRate = useCallback(
    (rate: number) => {
      applySettings(() => ({ voiceRate: rate }), "voiceRate");
    },
    [applySettings],
  );

  // Requisito 4.12: alterna la letra en peones.
  const toggleShowPawnLetter = useCallback(() => {
    applySettings(
      (current) => ({ showPawnLetter: !current.showPawnLetter }),
      "showPawnLetter",
    );
  }, [applySettings]);

  // Requisitos 4.7/4.8: alterna el alto contraste.
  const toggleHighContrast = useCallback(() => {
    applySettings(
      (current) => ({ highContrast: !current.highContrast }),
      "highContrast",
    );
  }, [applySettings]);

  // Requisitos 4.9/4.10: alterna la activación de la voz. El anuncio por voz
  // sólo se emite cuando el resultado deja `speechEnabled` en verdadero, por lo
  // que al silenciar la voz no se emite sonido.
  const toggleSpeech = useCallback(() => {
    applySettings(
      (current) => ({ speechEnabled: !current.speechEnabled }),
      "speechEnabled",
    );
  }, [applySettings]);

  // Requisito 4.13: restablece los valores por defecto y los persiste. Se
  // anuncia el restablecimiento por voz para nombrar un cambio coherente.
  const resetSettings = useCallback(() => {
    const next = normalizeSettings(DEFAULT_SETTINGS);
    setSettings(next);
    persist(next);
    announce(next, "Ajustes restablecidos");
  }, [persist, announce]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setVoiceRate,
      toggleShowPawnLetter,
      toggleHighContrast,
      toggleSpeech,
      resetSettings,
      saveError,
    }),
    [
      settings,
      setVoiceRate,
      toggleShowPawnLetter,
      toggleHighContrast,
      toggleSpeech,
      resetSettings,
      saveError,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Accede al contexto de ajustes. Debe usarse dentro de un árbol envuelto por
 * `SettingsProvider`; en caso contrario lanza un error explícito indicando el
 * requisito de uso (Requisito 4.14).
 *
 * @returns El valor del contexto de ajustes.
 * @throws Error si se invoca fuera de `SettingsProvider`.
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (ctx === null) {
    throw new Error("useSettings debe usarse dentro de SettingsProvider");
  }
  return ctx;
}
