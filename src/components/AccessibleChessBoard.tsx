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
  pieceToken,
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

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS_DISPLAY = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

const UNICODE_PIECES: Record<"w" | "b", Record<PieceType, string>> = {
  w: { k: "♔", q: "♕", r: "♖", n: "♘", b: "♗", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", n: "♞", b: "♝", p: "♟" },
};

type AnnotationMode = "play" | "highlight-amarillo" | "highlight-rojo" | "arrow";

type AccessibleChessBoardProps = {
  initialFen?: string;
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
}: AccessibleChessBoardProps) {
  const boardId = useId();
  const liveId = `${boardId}-live`;
  const brailleId = `${boardId}-braille`;
  const audioId = `${boardId}-audio`;

  const { settings, toggleShowPawnLetter } = useSettings();
  const showPawnLetter = settings.showPawnLetter;

  const [game, setGame] = useState(() => new Chess(initialFen));
  const [fenInput, setFenInput] = useState(initialFen);
  const [cursor, setCursor] = useState("e2");
  const [selected, setSelected] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [annotationMode, setAnnotationMode] =
    useState<AnnotationMode>("play");
  const [highlighted, setHighlighted] = useState<HighlightedSquare[]>([]);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const boardRef = useRef<HTMLDivElement>(null);
  const skipAnnounceRef = useRef(true);
  const initialRegisteredRef = useRef(false);
  const gameRef = useRef(game);
  gameRef.current = game;

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

  useEffect(() => {
    void ensureVoicesLoaded();
    return () => stopSpeaking();
  }, []);

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
    const next = new Chess();
    setGame(next);
    setFenInput(next.fen());
    setSelected(null);
    setLegalTargets([]);
    setHighlighted([]);
    setArrows([]);
    setArrowFrom(null);
    setCursor("e2");
    setStatusMessage("Tablero reiniciado a la posición inicial.");
    announce("Tablero reiniciado a la posición inicial.");
  }, [announce]);

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

  const tryMove = useCallback(
    (from: string, to: string) => {
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
        setGame(draft);
        setFenInput(draft.fen());
        setSelected(null);
        setLegalTargets([]);
        // Requisito 2.5: registrar exactamente una vez la posición resultante
        // tras completar un movimiento legal.
        pushRecentFen(draft.fen(), positionLabel(draft));

        const capture = result.captured
          ? `, captura ${SPANISH_PIECE_NAME[result.captured as PieceType].singular}`
          : "";
        const check = draft.isCheckmate()
          ? ". Jaque mate"
          : draft.isCheck()
            ? ". Jaque"
            : "";
        announce(
          `Movido ${SPANISH_PIECE_NAME[result.piece as PieceType].singular} de ${from} a ${to}${capture}${check}.`,
        );

        if (draft.isGameOver()) {
          if (draft.isCheckmate()) {
            setStatusMessage(
              `Jaque mate. Ganan las ${draft.turn() === "w" ? "negras" : "blancas"}.`,
            );
          } else if (draft.isDraw()) {
            setStatusMessage("Partida empatada.");
          }
        } else {
          setStatusMessage(
            `Turno de las ${draft.turn() === "w" ? "blancas" : "negras"}.`,
          );
        }
        return true;
      } catch {
        announce("Movimiento ilegal.");
        return false;
      }
    },
    [announce, game],
  );

  const activateSquare = useCallback(
    (square: string) => {
      const s = normalizeSquare(square);
      setCursor(s);

      if (annotationMode === "highlight-amarillo") {
        toggleHighlight(s, "amarillo");
        return;
      }
      if (annotationMode === "highlight-rojo") {
        toggleHighlight(s, "rojo");
        return;
      }
      if (annotationMode === "arrow") {
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
          `Es el turno de las ${game.turn() === "w" ? "blancas" : "negras"}.`,
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
      game,
      handleArrowClick,
      legalTargets,
      refreshLegal,
      selected,
      toggleHighlight,
      tryMove,
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

  const turnLabel =
    game.turn() === "w" ? "Turno: blancas" : "Turno: negras";

  return (
    <div className="once-app mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 lg:flex-row lg:items-start">
      <section
        className="flex min-w-0 flex-1 flex-col gap-4"
        aria-labelledby={`${boardId}-title`}
      >
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--once-accent)]">
            ONCE · Comisión Braille Española
          </p>
          <h1
            id={`${boardId}-title`}
            className="font-[family-name:var(--font-display)] text-3xl leading-tight text-[var(--once-ink)] sm:text-4xl"
          >
            Ajedrez accesible B8
          </h1>
          <p className="max-w-2xl text-base text-[var(--once-muted)]">
            Tablero jugable por teclado y voz. Exporta notación Braille Unicode
            (Documento Técnico B8) y descripción audio para lectores de
            pantalla.
          </p>
        </header>

        <div
          className="flex flex-wrap items-center gap-3 text-sm"
          role="status"
          aria-live="polite"
        >
          <span className="rounded-sm bg-[var(--once-panel)] px-3 py-1.5 font-medium text-[var(--once-ink)] ring-1 ring-[var(--once-ring)]">
            {turnLabel}
          </span>
          {statusMessage ? (
            <span className="text-[var(--once-muted)]">{statusMessage}</span>
          ) : null}
        </div>

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

        <div
          ref={boardRef}
          role="application"
          aria-label="Tablero de ajedrez accesible. Flechas para navegar, Enter o Espacio para seleccionar o mover, tecla D para descripción completa, Escape para cancelar."
          aria-describedby={liveId}
          tabIndex={0}
          onKeyDown={onBoardKeyDown}
          className="once-board-focus relative w-full max-w-[min(100%,560px)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--once-focus)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--once-bg)]"
        >
          <div
            className="grid grid-cols-[auto_repeat(8,minmax(0,1fr))] grid-rows-[repeat(8,minmax(0,1fr))_auto] gap-0 overflow-hidden rounded-sm shadow-[0_12px_40px_rgba(20,40,30,0.18)] ring-1 ring-[var(--once-ring)]"
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

                  let pieceLabel = "vacía";
                  if (piece) {
                    const adj =
                      piece.type === "q" || piece.type === "r"
                        ? piece.color === "w"
                          ? "blanca"
                          : "negra"
                        : piece.color === "w"
                          ? "blanco"
                          : "negro";
                    pieceLabel = `${SPANISH_PIECE_NAME[piece.type].singular} ${adj}`;
                  }

                  const brailleCode = piece
                    ? pieceToken(piece.type, square, showPawnLetter)
                    : square;

                  return (
                    <button
                      key={square}
                      type="button"
                      tabIndex={-1}
                      aria-label={`${square}, ${pieceLabel}, Braille ${brailleCode}`}
                      aria-current={isCursor ? "true" : undefined}
                      aria-pressed={isSelected}
                      onClick={(e) => onSquareClick(square, e)}
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

        <details className="rounded-sm bg-[var(--once-panel)] p-4 ring-1 ring-[var(--once-ring)]">
          <summary className="cursor-pointer font-medium text-[var(--once-ink)]">
            Ayuda de teclado y voz
          </summary>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--once-muted)]">
            <li>Flechas: navegar casillas a1–h8</li>
            <li>Enter / Espacio: seleccionar pieza o confirmar destino</li>
            <li>D: cantar descripción completa del tablero (Audio ONCE)</li>
            <li>Escape: cancelar selección o flecha en curso</li>
            <li>
              En modo anotación, Enter/clic marca resaltados o flechas
              didácticas B8
            </li>
          </ul>
        </details>
      </section>

      <aside
        className="flex w-full flex-col gap-5 lg:sticky lg:top-6 lg:w-[min(100%,24rem)]"
        aria-label="Panel Braille y audio ONCE"
      >
        <div className="space-y-3 rounded-sm bg-[var(--once-panel)] p-4 ring-1 ring-[var(--once-ring)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--once-ink)]">
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
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[var(--once-bg)] p-3 font-mono text-sm leading-relaxed text-[var(--once-ink)] ring-1 ring-[var(--once-ring)]"
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

        <div className="space-y-3 rounded-sm bg-[var(--once-panel)] p-4 ring-1 ring-[var(--once-ring)]">
          <h2 className="text-lg font-semibold text-[var(--once-ink)]">
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

        <div className="space-y-3 rounded-sm bg-[var(--once-panel)] p-4 ring-1 ring-[var(--once-ring)]">
          <h2 className="text-lg font-semibold text-[var(--once-ink)]">
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
            className="w-full rounded-sm bg-[var(--once-bg)] p-3 font-mono text-xs text-[var(--once-ink)] ring-1 ring-[var(--once-ring)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--once-focus)]"
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
