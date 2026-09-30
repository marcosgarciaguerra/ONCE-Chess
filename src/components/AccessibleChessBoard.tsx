"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Chess, type Square as ChessSquare } from "chess.js";
import {
  announceSquare,
  fenToEbraiExport,
  fenToOnceAudio,
  fenToOnceBraille,
  neighborSquare,
  normalizeSquare,
  SPANISH_PIECE_NAME,
  STARTING_FEN,
  type BoardArrow,
  type HighlightColor,
  type HighlightedSquare,
  type PieceType,
  type PlacedPiece,
} from "@/utils/onceChessBraille";
import { ensureVoicesLoaded, speak, stopSpeaking } from "@/utils/speech";
import { useSettings } from "@/context/SettingsProvider";
import { pushRecentFen } from "@/lib/storage";
import {
  applyCpuMove,
  chooseCpuMove,
  cpuLevelLabel,
  type CpuLevel,
} from "@/lib/cpuEngine";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS_DISPLAY = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

const UNICODE_PIECES: Record<"w" | "b", Record<PieceType, string>> = {
  w: { k: "♔", q: "♕", r: "♖", n: "♘", b: "♗", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", n: "♞", b: "♝", p: "♟" },
};

type AnnotationMode = "play" | "highlight-amarillo" | "highlight-rojo" | "arrow";

export type AccessibleChessBoardProps = {
  initialFen?: string;
  /** Rival: libre (estudio) o máquina. Por defecto libre. */
  opponent?: "none" | "cpu";
  /** Dificultad de la CPU (0 fácil, 1 medio, 2 difícil). */
  cpuLevel?: CpuLevel;
  /** Color del jugador humano en modo CPU. Por defecto blancas. */
  playerColor?: "w" | "b";
};

function pieceFromChess(
  square: string,
  game: Chess,
): PlacedPiece | null {
  const p = game.get(square as ChessSquare);
  if (!p) return null;
  const s = normalizeSquare(square);
  return {
    type: p.type as PieceType,
    color: p.color,
    square: s,
    file: s[0],
    rank: s[1],
  };
}

/**
 * Deriva una etiqueta descriptiva en español para una posición, a partir de su
 * estado (fin de partida o turno vigente). `pushRecentFen` la recorta a 80
 * caracteres, así que estas cadenas quedan dentro del límite.
 */
function positionLabel(chess: Chess): string {
  if (chess.isCheckmate()) {
    return `Jaque mate, ganan las ${chess.turn() === "w" ? "negras" : "blancas"}`;
  }
  if (chess.isDraw()) {
    return "Posición de tablas";
  }
  const turn = chess.turn() === "w" ? "blancas" : "negras";
  return chess.isCheck()
    ? `Jaque, turno de las ${turn}`
    : `Turno de las ${turn}`;
}

export default function AccessibleChessBoard({
  initialFen = STARTING_FEN,
  opponent = "none",
  cpuLevel = 1,
  playerColor = "w",
}: AccessibleChessBoardProps) {
  const boardId = useId();
  const liveId = `${boardId}-live`;
  const brailleId = `${boardId}-braille`;
  const audioId = `${boardId}-audio`;

  const { settings, toggleShowPawnLetter } = useSettings();
  const showPawnLetter = settings.showPawnLetter;
  const vsCpu = opponent === "cpu";

  const [game, setGame] = useState(() => new Chess(initialFen));
  const [fenInput, setFenInput] = useState(initialFen);
  const [cursor, setCursor] = useState(playerColor === "w" ? "e2" : "e7");
  const [selected, setSelected] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [annotationMode, setAnnotationMode] =
    useState<AnnotationMode>("play");
  const [highlighted, setHighlighted] = useState<HighlightedSquare[]>([]);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    vsCpu
      ? `Contra la máquina (${cpuLevelLabel(cpuLevel)}). Tú juegas con ${playerColor === "w" ? "blancas" : "negras"}.`
      : "",
  );
  const [cpuBusy, setCpuBusy] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const skipAnnounceRef = useRef(true);
  const initialRegisteredRef = useRef(false);
  const welcomedRef = useRef(false);
  const cpuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cpuBusyRef = useRef(false);
  const gameRef = useRef(game);
  gameRef.current = game;
  const announceRef = useRef<(message: string, withSpeech?: boolean) => void>(
    () => {},
  );

  const fen = game.fen();

  const brailleText = useMemo(
    () =>
      fenToOnceBraille(fen, {
        showPawnLetter,
        highlightedSquares: highlighted,
        arrows,
      }),
    [fen, showPawnLetter, highlighted, arrows],
  );

  const audioText = useMemo(() => fenToOnceAudio(fen), [fen]);

  const announce = useCallback(
    (message: string, withSpeech = true) => {
      setLiveMessage(message);
      if (withSpeech && settings.speechEnabled) {
        speak(message, { interrupt: true, rate: settings.voiceRate });
      }
    },
    [settings.speechEnabled, settings.voiceRate],
  );
  announceRef.current = announce;

  useEffect(() => {
    void ensureVoicesLoaded();
    return () => {
      stopSpeaking();
      if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current);
    };
  }, []);

  // Orientación inicial para personas ciegas: una sola vez al montar.
  useEffect(() => {
    if (welcomedRef.current) return;
    welcomedRef.current = true;
    const piece = pieceFromChess(cursor, gameRef.current);
    const here = announceSquare(cursor, piece);
    if (vsCpu) {
      announce(
        `Partida contra la máquina, nivel ${cpuLevelLabel(cpuLevel)}. Tú juegas con las ${playerColor === "w" ? "blancas" : "negras"}. Flechas para explorar, Enter o Espacio para mover, tecla D para descripción. ${here}.`,
      );
    } else {
      announce(
        `Tablero accesible listo. Flechas para explorar, Enter o Espacio para seleccionar o mover, tecla D para descripción completa. ${here}.`,
      );
    }
  }, [announce, cpuLevel, cursor, playerColor, vsCpu]);

  // Requisito 2.5: al montar con una posición cargada vía URL (`?fen=...`),
  // registrarla exactamente una vez. Se omite la posición inicial estándar
  // para no contaminar los recientes en cada visita al tablero (Requisito 2.7).
  // El guard por ref evita una doble inserción por el doble montaje de efectos
  // de React StrictMode.
  useEffect(() => {
    if (initialRegisteredRef.current) return;
    initialRegisteredRef.current = true;

    const raw = initialFen.trim();
    if (raw === STARTING_FEN) return;

    let loaded: Chess;
    try {
      loaded = new Chess(raw);
    } catch {
      // FEN inválido: no registrar (Requisito 2.6). La ruta ya conserva la
      // última posición válida y anuncia el error por su cuenta.
      return;
    }
    if (loaded.fen() === STARTING_FEN) return;
    pushRecentFen(loaded.fen(), positionLabel(loaded));
  }, [initialFen]);

  // Anunciar casilla solo al mover el cursor (no al cambiar la posición)
  useEffect(() => {
    if (skipAnnounceRef.current) {
      skipAnnounceRef.current = false;
      return;
    }
    const piece = pieceFromChess(cursor, gameRef.current);
    announce(announceSquare(cursor, piece));
  }, [cursor, announce]);

  const refreshLegal = useCallback(
    (from: string | null, current: Chess) => {
      if (!from) {
        setLegalTargets([]);
        return;
      }
      const moves = current.moves({
        square: from as ChessSquare,
        verbose: true,
      });
      setLegalTargets(moves.map((m) => m.to));
    },
    [],
  );

  const loadFen = useCallback(
    (raw: string) => {
      try {
        const next = new Chess(raw.trim());
        setGame(next);
        setFenInput(next.fen());
        setSelected(null);
        setLegalTargets([]);
        setStatusMessage("Posición FEN cargada correctamente.");
        announce("Posición FEN cargada correctamente.");
        // Requisito 2.5: registrar exactamente una vez la posición resultante
        // al cargar un FEN válido.
        pushRecentFen(next.fen(), positionLabel(next));
      } catch {
        setStatusMessage("FEN inválido. Revise la cadena e inténtelo de nuevo.");
        announce("FEN inválido.");
      }
    },
    [announce],
  );

  const resetBoard = useCallback(() => {
    if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current);
    cpuBusyRef.current = false;
    setCpuBusy(false);
    const next = new Chess();
    setGame(next);
    setFenInput(next.fen());
    setSelected(null);
    setLegalTargets([]);
    setHighlighted([]);
    setArrows([]);
    setArrowFrom(null);
    setCursor(playerColor === "w" ? "e2" : "e7");
    const msg = vsCpu
      ? `Nueva partida contra la máquina (${cpuLevelLabel(cpuLevel)}). Tú juegas con ${playerColor === "w" ? "blancas" : "negras"}.`
      : "Tablero reiniciado a la posición inicial.";
    setStatusMessage(msg);
    announce(msg);
  }, [announce, cpuLevel, playerColor, vsCpu]);

  const toggleHighlight = useCallback(
    (square: string, color: HighlightColor) => {
      const s = normalizeSquare(square);
      setHighlighted((prev) => {
        const existing = prev.find((h) => h.square === s);
        if (existing && existing.color === color) {
          announce(`Resaltado ${color} quitado de ${s}`);
          return prev.filter((h) => h.square !== s);
        }
        announce(`Casilla ${s} resaltada en ${color}`);
        return [
          ...prev.filter((h) => h.square !== s),
          { square: s, color },
        ];
      });
    },
    [announce],
  );

  const handleArrowClick = useCallback(
    (square: string) => {
      const s = normalizeSquare(square);
      if (!arrowFrom) {
        setArrowFrom(s);
        announce(`Origen de flecha: ${s}. Elija el destino.`);
        return;
      }
      if (arrowFrom === s) {
        setArrowFrom(null);
        announce("Selección de flecha cancelada.");
        return;
      }
      setArrows((prev) => {
        const exists = prev.some(
          (a) => a.from === arrowFrom && a.to === s,
        );
        if (exists) {
          announce(`Flecha ${arrowFrom} a ${s} eliminada.`);
          return prev.filter(
            (a) => !(a.from === arrowFrom && a.to === s),
          );
        }
        announce(`Flecha de ${arrowFrom} a ${s} añadida.`);
        return [...prev, { from: arrowFrom, to: s }];
      });
      setArrowFrom(null);
    },
    [announce, arrowFrom],
  );

  const applyPlayedMove = useCallback(
    (
      draft: Chess,
      result: {
        from: string;
        to: string;
        piece: string;
        captured?: string;
      },
      speaker: "human" | "cpu",
    ) => {
      setGame(draft);
      setFenInput(draft.fen());
      setSelected(null);
      setLegalTargets([]);
      pushRecentFen(draft.fen(), positionLabel(draft));

      const capture = result.captured
        ? `, captura ${SPANISH_PIECE_NAME[result.captured as PieceType].singular}`
        : "";
      const check = draft.isCheckmate()
        ? ". Jaque mate"
        : draft.isCheck()
          ? ". Jaque"
          : "";
      const who =
        speaker === "cpu"
          ? `La máquina mueve ${SPANISH_PIECE_NAME[result.piece as PieceType].singular}`
          : `Movido ${SPANISH_PIECE_NAME[result.piece as PieceType].singular}`;
      announce(`${who} de ${result.from} a ${result.to}${capture}${check}.`);

      if (draft.isGameOver()) {
        if (draft.isCheckmate()) {
          const winner =
            draft.turn() === "w" ? "negras" : "blancas";
          const humanWon =
            (playerColor === "w" && winner === "blancas") ||
            (playerColor === "b" && winner === "negras");
          const msg = vsCpu
            ? humanWon
              ? `Jaque mate. Has ganado.`
              : `Jaque mate. Gana la máquina.`
            : `Jaque mate. Ganan las ${winner}.`;
          setStatusMessage(msg);
          if (vsCpu) announce(msg);
        } else if (draft.isDraw()) {
          setStatusMessage("Partida empatada.");
          if (vsCpu) announce("Partida empatada.");
        }
      } else if (vsCpu && draft.turn() !== playerColor) {
        setStatusMessage("Turno de la máquina.");
      } else {
        setStatusMessage(
          `Turno de las ${draft.turn() === "w" ? "blancas" : "negras"}.`,
        );
      }
    },
    [announce, playerColor, vsCpu],
  );

  const tryMove = useCallback(
    (from: string, to: string) => {
      if (vsCpu && (cpuBusy || game.turn() !== playerColor)) {
        announce(
          cpuBusy
            ? "Espere: la máquina está pensando."
            : "No es tu turno. Espera a la máquina.",
        );
        return false;
      }
      const draft = new Chess(game.fen());
      try {
        const result = draft.move({
          from: from as ChessSquare,
          to: to as ChessSquare,
          promotion: "q",
        });
        if (!result) {
          announce("Movimiento ilegal.");
          return false;
        }
        applyPlayedMove(
          draft,
          {
            from,
            to,
            piece: result.piece,
            captured: result.captured,
          },
          "human",
        );
        return true;
      } catch {
        announce("Movimiento ilegal.");
        return false;
      }
    },
    [announce, applyPlayedMove, cpuBusy, game, playerColor, vsCpu],
  );

  // Tras el movimiento humano (o si el humano es negras al inicio), la CPU responde.
  useEffect(() => {
    if (!vsCpu) return;
    const current = gameRef.current;
    if (current.isGameOver()) return;
    if (current.turn() === playerColor) return;
    if (cpuBusyRef.current) return;

    cpuBusyRef.current = true;
    setCpuBusy(true);
    announceRef.current(
      `La máquina piensa. Nivel ${cpuLevelLabel(cpuLevel)}.`,
    );
    setStatusMessage("La máquina piensa…");

    const level = cpuLevel;
    const human = playerColor;
    const timer = setTimeout(() => {
      const live = gameRef.current;
      if (live.isGameOver() || live.turn() === human) {
        cpuBusyRef.current = false;
        setCpuBusy(false);
        return;
      }
      const choice = chooseCpuMove(live.fen(), level);
      if (!choice) {
        cpuBusyRef.current = false;
        setCpuBusy(false);
        announceRef.current("La máquina no tiene movimientos legales.");
        return;
      }
      const draft = new Chess(live.fen());
      const result = applyCpuMove(draft, choice);
      if (!result) {
        cpuBusyRef.current = false;
        setCpuBusy(false);
        announceRef.current("Error al aplicar el movimiento de la máquina.");
        return;
      }
      applyPlayedMove(
        draft,
        {
          from: choice.from,
          to: choice.to,
          piece: result.piece,
          captured: result.captured,
        },
        "cpu",
      );
      setCursor(choice.to);
      cpuBusyRef.current = false;
      setCpuBusy(false);
    }, 550);
    cpuTimerRef.current = timer;

    return () => {
      clearTimeout(timer);
      // Permite reprogramar si el efecto se limpia antes de ejecutar (StrictMode).
      cpuBusyRef.current = false;
    };
  }, [applyPlayedMove, cpuLevel, fen, playerColor, vsCpu]);

  const activateSquare = useCallback(
    (square: string) => {
      const s = normalizeSquare(square);
      setCursor(s);

      if (vsCpu && (cpuBusy || game.turn() !== playerColor)) {
        announce(
          cpuBusy
            ? "Espere: la máquina está pensando."
            : "Ahora mueve la máquina. Espere su turno.",
        );
        return;
      }

      if (!vsCpu && annotationMode === "highlight-amarillo") {
        toggleHighlight(s, "amarillo");
        return;
      }
      if (!vsCpu && annotationMode === "highlight-rojo") {
        toggleHighlight(s, "rojo");
        return;
      }
      if (!vsCpu && annotationMode === "arrow") {
        handleArrowClick(s);
        return;
      }

      // Modo juego
      if (selected) {
        if (selected === s) {
          setSelected(null);
          setLegalTargets([]);
          announce(`Pieza en ${s} deseleccionada.`);
          return;
        }
        if (legalTargets.includes(s)) {
          tryMove(selected, s);
          return;
        }
        const piece = pieceFromChess(s, game);
        if (piece && piece.color === game.turn()) {
          setSelected(s);
          refreshLegal(s, game);
          announce(
            `Seleccionada ${SPANISH_PIECE_NAME[piece.type].singular} en ${s}. Use flechas y Enter para destino.`,
          );
          return;
        }
        announce("Destino ilegal. Selección cancelada.");
        setSelected(null);
        setLegalTargets([]);
        return;
      }

      const piece = pieceFromChess(s, game);
      if (!piece) {
        announce(`Casilla ${s} vacía.`);
        return;
      }
      if (piece.color !== game.turn()) {
        announce(
          vsCpu
            ? `Esa pieza es de la máquina. Tú juegas con las ${playerColor === "w" ? "blancas" : "negras"}.`
            : `Es el turno de las ${game.turn() === "w" ? "blancas" : "negras"}.`,
        );
        return;
      }
      setSelected(s);
      refreshLegal(s, game);
      announce(
        `Seleccionada ${SPANISH_PIECE_NAME[piece.type].singular} en ${s}. Use flechas y Enter o Espacio para mover.`,
      );
    },
    [
      annotationMode,
      announce,
      cpuBusy,
      game,
      handleArrowClick,
      legalTargets,
      playerColor,
      refreshLegal,
      selected,
      toggleHighlight,
      tryMove,
      vsCpu,
    ],
  );

  const onBoardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const key = event.key;

      if (
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "ArrowLeft" ||
        key === "ArrowRight"
      ) {
        event.preventDefault();
        const map = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
        } as const;
        const next = neighborSquare(cursor, map[key]);
        if (next) {
          setCursor(next);
        } else {
          announce("Borde del tablero.");
        }
        return;
      }

      if (key === "Enter" || key === " ") {
        event.preventDefault();
        activateSquare(cursor);
        return;
      }

      if (key === "d" || key === "D") {
        event.preventDefault();
        announce(audioText);
        return;
      }

      if (key === "Escape") {
        event.preventDefault();
        setSelected(null);
        setLegalTargets([]);
        setArrowFrom(null);
        announce("Selección cancelada.");
      }
    },
    [activateSquare, announce, audioText, cursor],
  );

  const copyBraille = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(brailleText);
      setCopyFeedback("Braille B8 copiado al portapapeles.");
      announce("Braille ONCE B8 copiado al portapapeles.");
    } catch {
      setCopyFeedback("No se pudo copiar. Seleccione el texto manualmente.");
      announce("No se pudo copiar al portapapeles.");
    }
  }, [announce, brailleText]);

  const downloadEbrai = useCallback(() => {
    const file = fenToEbraiExport(fen, {
      showPawnLetter,
      highlightedSquares: highlighted,
      arrows,
    });
    const blob = new Blob(file.blobParts, { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    announce("Archivo para Ebrai descargado.");
  }, [announce, arrows, fen, highlighted, showPawnLetter]);

  const singBoard = useCallback(() => {
    announce(audioText);
  }, [announce, audioText]);

  const onSquareClick = useCallback(
    (square: string, event: ReactMouseEvent) => {
      event.preventDefault();
      activateSquare(square);
    },
    [activateSquare],
  );

  /**
   * Exploración táctil/ratón: al pasar por una casilla se mueve el cursor y el
   * efecto de `cursor` anuncia ubicación + pieza por aria-live y voz (útil
   * para baja visión y para acompañantes que guían con el puntero).
   */
  const onSquarePointerEnter = useCallback((square: string) => {
    setCursor(normalizeSquare(square));
  }, []);

  const turnLabel =
    game.turn() === "w" ? "Turno: blancas" : "Turno: negras";

  return (
    <div className="once-app mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 lg:flex-row lg:items-start">
      <section
        className="flex min-w-0 flex-1 flex-col gap-4"
        aria-labelledby={`${boardId}-title`}
      >
        <header className="space-y-3">
          <p className="once-kicker">
            ONCE · Comisión Braille Española
          </p>
          <h1
            id={`${boardId}-title`}
            className="once-display text-3xl leading-tight text-[var(--once-ink)] sm:text-4xl"
          >
            {vsCpu ? "Partida contra la máquina" : "Ajedrez accesible B8"}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-[var(--once-muted)]">
            {vsCpu
              ? `Juegas con las ${playerColor === "w" ? "blancas" : "negras"} contra la CPU (nivel ${cpuLevelLabel(cpuLevel)}). Todo se anuncia por voz y lector de pantalla.`
              : "Tablero jugable solo con teclado y voz. Cada casilla se anuncia al explorar. Exporta Braille Unicode B8 y descripción audio ONCE."}
          </p>
        </header>

        <div
          className="flex flex-wrap items-center gap-3 text-sm"
          role="status"
          aria-live="polite"
        >
          <span className="once-status-chip">
            {vsCpu
              ? cpuBusy
                ? "La máquina piensa"
                : game.turn() === playerColor
                  ? "Tu turno"
                  : "Turno de la máquina"
              : turnLabel}
          </span>
          {statusMessage ? (
            <span className="text-[var(--once-muted)]">{statusMessage}</span>
          ) : null}
        </div>

        {!vsCpu ? (
          <div
            className="flex flex-wrap gap-2"
            role="toolbar"
            aria-label="Modo de anotación didáctica"
          >
            {(
              [
                ["play", "Jugar"],
                ["highlight-amarillo", "Resaltar amarillo"],
                ["highlight-rojo", "Resaltar rojo"],
                ["arrow", "Flecha"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`once-btn ${annotationMode === mode ? "once-btn-active" : ""}`}
                aria-pressed={annotationMode === mode}
                onClick={() => {
                  setAnnotationMode(mode);
                  setArrowFrom(null);
                  announce(`Modo ${label} activado.`);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div
          ref={boardRef}
          role="application"
          aria-label={
            vsCpu
              ? `Tablero contra la máquina. ${cpuBusy ? "La máquina está pensando." : "Tu turno."} Flechas para explorar, Enter o Espacio para mover, tecla D para descripción, Escape para cancelar.`
              : "Tablero de ajedrez accesible. Flechas o pasar el puntero sobre una casilla para oír su ubicación y pieza. Enter o Espacio para seleccionar o mover. Tecla D para descripción completa. Escape para cancelar."
          }
          aria-busy={cpuBusy || undefined}
          aria-describedby={liveId}
          tabIndex={0}
          onKeyDown={onBoardKeyDown}
          className="once-board-focus relative w-full max-w-[min(100%,560px)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--once-focus)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--once-bg)]"
        >
          <div
            className="once-board-shell grid grid-cols-[auto_repeat(8,minmax(0,1fr))] grid-rows-[repeat(8,minmax(0,1fr))_auto] gap-0"
            style={{ aspectRatio: "1 / 1.05" }}
          >
            {RANKS_DISPLAY.map((rank) => (
              <div key={`rank-row-${rank}`} className="contents">
                <div
                  className="flex items-center justify-center bg-[var(--once-panel)] px-2 text-xs font-semibold text-[var(--once-muted)]"
                  aria-hidden="true"
                >
                  {rank}
                </div>
                {FILES.map((file) => {
                  const square = `${file}${rank}`;
                  const isLight =
                    (FILES.indexOf(file) + Number(rank)) % 2 === 1;
                  const piece = pieceFromChess(square, game);
                  const isCursor = cursor === square;
                  const isSelected = selected === square;
                  const isTarget = legalTargets.includes(square);
                  const hl = highlighted.find((h) => h.square === square);
                  const isArrowEnd =
                    arrowFrom === square ||
                    arrows.some(
                      (a) => a.from === square || a.to === square,
                    );

                  const squareDescription = announceSquare(square, piece);
                  const stateHints: string[] = [];
                  if (isSelected) stateHints.push("pieza seleccionada");
                  if (isTarget) stateHints.push("destino legal");
                  if (hl) stateHints.push(`resaltada en ${hl.color}`);
                  if (isCursor) stateHints.push("cursor actual");
                  const accessibleName =
                    stateHints.length > 0
                      ? `${squareDescription}, ${stateHints.join(", ")}`
                      : squareDescription;

                  return (
                    <button
                      key={square}
                      type="button"
                      tabIndex={-1}
                      title={accessibleName}
                      aria-label={accessibleName}
                      aria-roledescription="casilla de ajedrez"
                      aria-current={isCursor ? "true" : undefined}
                      aria-pressed={isSelected}
                      onClick={(e) => onSquareClick(square, e)}
                      onMouseEnter={() => onSquarePointerEnter(square)}
                      onFocus={() => onSquarePointerEnter(square)}
                      className={[
                        "relative flex aspect-square items-center justify-center text-[clamp(1.4rem,4.5vw,2.4rem)] transition-colors",
                        isLight ? "bg-[var(--square-light)]" : "bg-[var(--square-dark)]",
                        isCursor ? "z-10 ring-4 ring-inset ring-[var(--once-focus)]" : "",
                        isSelected ? "bg-[var(--square-selected)]" : "",
                        hl?.color === "amarillo" ? "bg-[var(--hl-yellow)]" : "",
                        hl?.color === "rojo" ? "bg-[var(--hl-red)]" : "",
                        isTarget ? "after:absolute after:h-3 after:w-3 after:rounded-full after:bg-[var(--once-accent)] after:opacity-80 after:content-['']" : "",
                        isArrowEnd ? "outline outline-2 outline-offset-[-2px] outline-[var(--once-arrow)]" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {piece ? (
                        <span
                          aria-hidden="true"
                          className={
                            piece.color === "w"
                              ? "text-[#f7f3ea] drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]"
                              : "text-[#121814]"
                          }
                        >
                          {UNICODE_PIECES[piece.color][piece.type]}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
            <div aria-hidden="true" className="bg-[var(--once-panel)]" />
            {FILES.map((file) => (
              <div
                key={`file-${file}`}
                className="flex items-center justify-center bg-[var(--once-panel)] py-1 text-xs font-semibold uppercase text-[var(--once-muted)]"
                aria-hidden="true"
              >
                {file}
              </div>
            ))}
          </div>
        </div>

        <p id={liveId} className="sr-only" aria-live="polite" aria-atomic="true">
          {liveMessage}
        </p>

        <div
          className="once-surface-quiet space-y-2 p-4"
          aria-labelledby={`${boardId}-ayuda`}
        >
          <h2
            id={`${boardId}-ayuda`}
            className="font-semibold text-[var(--once-ink)]"
          >
            Cómo jugar sin ver la pantalla
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--once-muted)]">
            <li>
              Tabule hasta el tablero. Flechas: moverse entre casillas a1–h8;
              cada casilla se anuncia por voz.
            </li>
            <li>Enter o Espacio: seleccionar pieza o confirmar el destino.</li>
            <li>Tecla D: descripción completa del tablero (Audio ONCE).</li>
            <li>Escape: cancelar la selección.</li>
            {vsCpu ? (
              <li>
                Tras tu jugada, la máquina responde sola y se anuncia el
                movimiento. Espere si oye «la máquina piensa».
              </li>
            ) : (
              <li>
                Pasar el puntero por una casilla también anuncia su ubicación.
              </li>
            )}
          </ul>
        </div>
      </section>

      <aside
        className="flex w-full flex-col gap-5 lg:sticky lg:top-6 lg:w-[min(100%,24rem)]"
        aria-label="Panel Braille y audio ONCE"
      >
        <div className="once-surface space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="once-display text-lg font-semibold text-[var(--once-ink)]">
              Braille Unicode B8
            </h2>
            <label className="flex items-center gap-2 text-sm text-[var(--once-muted)]">
              <input
                type="checkbox"
                checked={showPawnLetter}
                onChange={() => {
                  const next = !showPawnLetter;
                  toggleShowPawnLetter();
                  announce(
                    next
                      ? "Peones con letra P activados"
                      : "Peones solo con casilla activados",
                  );
                }}
              />
              Mostrar P en peones
            </label>
          </div>
          <pre
            id={brailleId}
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--once-radius)] bg-[var(--once-bg)] p-3 font-mono text-sm leading-relaxed text-[var(--once-ink)] shadow-[inset_0_0_0_1px_var(--once-ring)]"
            tabIndex={0}
            aria-label="Texto Braille ONCE B8 generado"
          >
            {brailleText}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="once-btn once-btn-primary" onClick={copyBraille}>
              Copiar Braille ONCE (B8)
            </button>
            <button type="button" className="once-btn" onClick={downloadEbrai}>
              Descargar para Ebrai
            </button>
          </div>
          {copyFeedback ? (
            <p className="text-sm text-[var(--once-accent)]" role="status">
              {copyFeedback}
            </p>
          ) : null}
        </div>

        <div className="once-surface space-y-3 p-4">
          <h2 className="once-display text-lg font-semibold text-[var(--once-ink)]">
            Audio descriptivo ONCE
          </h2>
          <p
            id={audioId}
            className="max-h-40 overflow-auto text-sm leading-relaxed text-[var(--once-muted)]"
          >
            {audioText}
          </p>
          <button type="button" className="once-btn once-btn-primary" onClick={singBoard}>
            Cantar Tablero (Audio ONCE)
          </button>
        </div>

        <div className="once-surface space-y-3 p-4">
          <h2 className="once-display text-lg font-semibold text-[var(--once-ink)]">
            Cargar FEN
          </h2>
          <label className="sr-only" htmlFor={`${boardId}-fen`}>
            Cadena FEN
          </label>
          <textarea
            id={`${boardId}-fen`}
            value={fenInput}
            onChange={(e) => setFenInput(e.target.value)}
            rows={3}
            className="w-full rounded-[var(--once-radius)] bg-[var(--once-bg)] p-3 font-mono text-xs text-[var(--once-ink)] shadow-[inset_0_0_0_1px_var(--once-ring)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--once-focus)]"
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="once-btn once-btn-primary"
              onClick={() => loadFen(fenInput)}
            >
              Aplicar FEN
            </button>
            <button type="button" className="once-btn" onClick={resetBoard}>
              Posición inicial
            </button>
            <button
              type="button"
              className="once-btn"
              onClick={() => {
                setHighlighted([]);
                setArrows([]);
                setArrowFrom(null);
                announce("Anotaciones didácticas borradas.");
              }}
            >
              Limpiar anotaciones
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
