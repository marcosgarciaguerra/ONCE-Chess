"use client";

/**
 * Cliente del modo vs CPU: controles accesibles de nivel/color + tablero.
 */

import { useCallback, useId, useState } from "react";

import AccessibleChessBoard from "@/components/AccessibleChessBoard";
import { FocusMainOnMount } from "@/components/a11y/FocusMainOnMount";
import { LiveRegion, useAnnouncer } from "@/components/a11y/LiveRegion";
import { SiteHeader } from "@/components/SiteHeader";
import { useSettings } from "@/context/SettingsProvider";
import { cpuLevelLabel, type CpuLevel } from "@/lib/cpuEngine";

const LEVELS: { value: CpuLevel; label: string; hint: string }[] = [
  { value: 0, label: "Fácil", hint: "Movimientos al azar con preferencia por capturas" },
  { value: 1, label: "Medio", hint: "Calcula una jugada de profundidad" },
  { value: 2, label: "Difícil", hint: "Calcula dos jugadas de profundidad" },
];

export function CpuGameClient() {
  const controlsId = useId();
  const { settings } = useSettings();
  const { message, announce } = useAnnouncer({
    voiceRate: settings.voiceRate,
    speechEnabled: settings.speechEnabled,
  });

  const [level, setLevel] = useState<CpuLevel>(1);
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [gameKey, setGameKey] = useState(0);

  const startNewGame = useCallback(
    (nextLevel = level, nextColor = playerColor) => {
      setLevel(nextLevel);
      setPlayerColor(nextColor);
      setGameKey((k) => k + 1);
      announce(
        `Nueva partida. Nivel ${cpuLevelLabel(nextLevel)}. Juegas con las ${nextColor === "w" ? "blancas" : "negras"}.`,
      );
    },
    [announce, level, playerColor],
  );

  return (
    <>
      <SiteHeader active="cpu" />
      <main
        id="contenido"
        tabIndex={-1}
        className="flex flex-1 flex-col outline-none"
        aria-label="Partida de ajedrez contra la máquina"
      >
        <FocusMainOnMount targetId="contenido" />
        <LiveRegion message={message} politeness="polite" />

        <div className="mx-auto w-full max-w-7xl px-4 pt-8">
          <section
            aria-labelledby={`${controlsId}-titulo`}
            className="once-surface mb-6 flex flex-col gap-4 p-4 sm:p-5"
          >
            <div className="space-y-1">
              <p className="once-kicker">Modo vs CPU</p>
              <h2
                id={`${controlsId}-titulo`}
                className="once-display text-2xl font-semibold text-[var(--once-ink)]"
              >
                Configurar partida contra la máquina
              </h2>
              <p className="max-w-2xl text-[var(--once-muted)]">
                Elige dificultad y color. Cada movimiento tuyo y de la máquina se
                anuncia por voz. Usa el tablero con flechas y Enter.
              </p>
            </div>

            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Nivel de dificultad de la máquina"
            >
              {LEVELS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`once-btn ${level === item.value ? "once-btn-active" : ""}`}
                  aria-pressed={level === item.value}
                  aria-describedby={`${controlsId}-lvl-${item.value}`}
                  onClick={() => {
                    setLevel(item.value);
                    announce(`Nivel ${item.label} seleccionado.`);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <ul className="sr-only">
              {LEVELS.map((item) => (
                <li key={item.value} id={`${controlsId}-lvl-${item.value}`}>
                  {item.hint}
                </li>
              ))}
            </ul>

            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Color con el que juegas"
            >
              <button
                type="button"
                className={`once-btn ${playerColor === "w" ? "once-btn-active" : ""}`}
                aria-pressed={playerColor === "w"}
                onClick={() => {
                  setPlayerColor("w");
                  announce("Jugarás con blancas. Pulsa nueva partida para aplicar.");
                }}
              >
                Blancas
              </button>
              <button
                type="button"
                className={`once-btn ${playerColor === "b" ? "once-btn-active" : ""}`}
                aria-pressed={playerColor === "b"}
                onClick={() => {
                  setPlayerColor("b");
                  announce("Jugarás con negras. Pulsa nueva partida para aplicar.");
                }}
              >
                Negras
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="once-btn once-btn-primary"
                onClick={() => startNewGame(level, playerColor)}
              >
                Nueva partida
              </button>
            </div>
          </section>
        </div>

        <AccessibleChessBoard
          key={`${gameKey}-${level}-${playerColor}`}
          opponent="cpu"
          cpuLevel={level}
          playerColor={playerColor}
        />
      </main>
    </>
  );
}
