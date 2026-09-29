/**
 * Codificación Braille Unicode y audio descriptivo según Documento Técnico B8
 * de la Comisión Braille Española (ONCE).
 */

export const BRAILLE_RANK: Readonly<Record<string, string>> = {
  "1": "⠂",
  "2": "⠆",
  "3": "⠒",
  "4": "⠲",
  "5": "⠢",
  "6": "⠖",
  "7": "⠶",
  "8": "⠦",
} as const;

/** Unión de casillas para flechas didácticas (B8). */
export const BRAILLE_ARROW_JOIN = "¬⠒⠕¬";

export type HighlightColor = "amarillo" | "rojo";

export type HighlightedSquare = {
  square: string;
  color: HighlightColor;
};

export type BoardArrow = {
  from: string;
  to: string;
};

export type FenToOnceBrailleOptions = {
  /** Si true, peones usan prefijo 'P' (ej. Pe⠲). Si false, solo casilla (ej. e⠲). */
  showPawnLetter?: boolean;
  highlightedSquares?: HighlightedSquare[];
  arrows?: BoardArrow[];
};

export type ChessColor = "w" | "b";

export type PieceType = "k" | "q" | "r" | "n" | "b" | "p";

export type PlacedPiece = {
  type: PieceType;
  color: ChessColor;
  square: string; // e.g. "e4"
  file: string; // "a".."h"
  rank: string; // "1".."8"
};

/** Letras de pieza en español (mayúsculas) según B8. */
export const SPANISH_PIECE_LETTER: Readonly<Record<PieceType, string>> = {
  k: "R",
  q: "D",
  r: "T",
  n: "C",
  b: "A",
  p: "P",
} as const;

export const SPANISH_PIECE_NAME: Readonly<
  Record<PieceType, { singular: string; plural: string }>
> = {
  k: { singular: "Rey", plural: "Reyes" },
  q: { singular: "Dama", plural: "Damas" },
  r: { singular: "Torre", plural: "Torres" },
  n: { singular: "Caballo", plural: "Caballos" },
  b: { singular: "Alfil", plural: "Alfiles" },
  p: { singular: "Peón", plural: "Peones" },
} as const;

/** Orden de emisión B8: R, D, T, C, A, luego peones. */
const PIECE_ORDER: readonly PieceType[] = ["k", "q", "r", "n", "b", "p"];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

const SQUARE_RE = /^[a-h][1-8]$/i;

export function isValidSquare(square: string): boolean {
  return SQUARE_RE.test(square);
}

export function normalizeSquare(square: string): string {
  const s = square.trim().toLowerCase();
  if (!isValidSquare(s)) {
    throw new Error(`Casilla inválida: "${square}"`);
  }
  return s;
}

export function squareToBraille(square: string): string {
  const s = normalizeSquare(square);
  const file = s[0];
  const rank = s[1];
  const brailleRank = BRAILLE_RANK[rank];
  if (!brailleRank) {
    throw new Error(`Fila Braille no definida: "${rank}"`);
  }
  return `${file}${brailleRank}`;
}

export function pieceToken(
  type: PieceType,
  square: string,
  showPawnLetter = false,
): string {
  const brailleSq = squareToBraille(square);
  if (type === "p") {
    return showPawnLetter ? `P${brailleSq}` : brailleSq;
  }
  return `${SPANISH_PIECE_LETTER[type]}${brailleSq}`;
}

/**
 * Parsea la parte de posición de un FEN (o FEN completo) a piezas colocadas.
 */
export function parseFenPieces(fen: string): PlacedPiece[] {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) {
    throw new Error("FEN vacío o inválido");
  }

  const ranks = placement.split("/");
  if (ranks.length !== 8) {
    throw new Error(`FEN debe tener 8 filas; se encontraron ${ranks.length}`);
  }

  const pieces: PlacedPiece[] = [];

  for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
    const rankRow = ranks[rankIndex];
    const rank = String(8 - rankIndex);
    let fileIndex = 0;

    for (const ch of rankRow) {
      if (fileIndex > 8) {
        throw new Error(`Fila FEN demasiado larga: "${rankRow}"`);
      }
      if (ch >= "1" && ch <= "8") {
        fileIndex += Number(ch);
        continue;
      }

      const lower = ch.toLowerCase();
      if (!"kqrbnp".includes(lower)) {
        throw new Error(`Carácter FEN no reconocido: "${ch}"`);
      }
      if (fileIndex >= 8) {
        throw new Error(`Más de 8 columnas en fila FEN: "${rankRow}"`);
      }

      const type = lower as PieceType;
      const color: ChessColor = ch === lower ? "b" : "w";
      const file = FILES[fileIndex];
      pieces.push({
        type,
        color,
        square: `${file}${rank}`,
        file,
        rank,
      });
      fileIndex += 1;
    }

    if (fileIndex !== 8) {
      throw new Error(
        `Fila FEN incompleta (columnas=${fileIndex}): "${rankRow}"`,
      );
    }
  }

  return pieces;
}

function compareByFileThenRank(a: PlacedPiece, b: PlacedPiece): number {
  if (a.file !== b.file) return a.file.localeCompare(b.file);
  return Number(a.rank) - Number(b.rank);
}

function formatSideBraille(
  pieces: PlacedPiece[],
  showPawnLetter: boolean,
): string {
  const tokens: string[] = [];

  for (const type of PIECE_ORDER) {
    const ofType = pieces
      .filter((p) => p.type === type)
      .sort(compareByFileThenRank);
    for (const piece of ofType) {
      tokens.push(pieceToken(piece.type, piece.square, showPawnLetter));
    }
  }

  return tokens.join(" ");
}

function formatHighlightedBlock(
  highlighted: HighlightedSquare[],
): string[] {
  if (highlighted.length === 0) return [];

  const byColor: Record<HighlightColor, string[]> = {
    amarillo: [],
    rojo: [],
  };

  for (const h of highlighted) {
    byColor[h.color].push(squareToBraille(normalizeSquare(h.square)));
  }

  const blocks: string[] = [];

  for (const color of ["amarillo", "rojo"] as const) {
    const squares = byColor[color];
    if (squares.length === 0) continue;

    const list = joinSpanishList(squares);
    const noun = squares.length === 1 ? "la casilla" : "las casillas";
    blocks.push(`)Resaltadas en ${color} ${noun} ${list}(`);
  }

  return blocks;
}

function formatArrowBlock(arrows: BoardArrow[]): string[] {
  return arrows.map((arrow) => {
    const from = squareToBraille(normalizeSquare(arrow.from));
    const to = squareToBraille(normalizeSquare(arrow.to));
    return `${from}${BRAILLE_ARROW_JOIN}${to}`;
  });
}

/**
 * Convierte un FEN a notación Braille Unicode B8 (ONCE).
 */
export function fenToOnceBraille(
  fen: string,
  options: FenToOnceBrailleOptions = {},
): string {
  const showPawnLetter = options.showPawnLetter ?? false;
  const pieces = parseFenPieces(fen);

  const white = pieces.filter((p) => p.color === "w");
  const black = pieces.filter((p) => p.color === "b");

  const whiteText = formatSideBraille(white, showPawnLetter);
  const blackText = formatSideBraille(black, showPawnLetter);

  const parts: string[] = [
    `Blancas: ${whiteText || "(vacío)"}`,
    `Negras: ${blackText || "(vacío)"}`,
  ];

  const didactic: string[] = [
    ...formatHighlightedBlock(options.highlightedSquares ?? []),
    ...formatArrowBlock(options.arrows ?? []),
  ];

  if (didactic.length > 0) {
    parts.push(didactic.join(" "));
  }

  return parts.join(" ");
}

function squareAudioLabel(square: string): string {
  return normalizeSquare(square).toUpperCase();
}

function joinSpanishList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function formatSideAudio(pieces: PlacedPiece[]): string {
  const segments: string[] = [];

  for (const type of PIECE_ORDER) {
    const ofType = pieces
      .filter((p) => p.type === type)
      .sort(compareByFileThenRank);
    if (ofType.length === 0) continue;

    const names = SPANISH_PIECE_NAME[type];
    const squares = ofType.map((p) => squareAudioLabel(p.square));
    const list = joinSpanishList(squares);

    if (ofType.length === 1) {
      segments.push(`${names.singular} en ${list}`);
    } else {
      segments.push(`${names.plural} en ${list}`);
    }
  }

  return segments.join(", ");
}

/**
 * Texto descriptivo natural para TTS / lectores de pantalla (ONCE).
 */
export function fenToOnceAudio(fen: string): string {
  const pieces = parseFenPieces(fen);
  const white = pieces.filter((p) => p.color === "w");
  const black = pieces.filter((p) => p.color === "b");

  const whiteText = formatSideAudio(white);
  const blackText = formatSideAudio(black);

  return `Blancas: ${whiteText || "sin piezas"}. Negras: ${blackText || "sin piezas"}.`;
}

/**
 * Anuncio corto de una casilla (navegación por teclado).
 * Ejemplo: "Casilla e4, Peón blanco, e braille 4"
 */
export function announceSquare(
  square: string,
  piece: PlacedPiece | null | undefined,
): string {
  const s = normalizeSquare(square);
  const file = s[0];
  const rank = s[1];
  const braillePart = `${file} braille ${rank}`;

  if (!piece) {
    return `Casilla ${s}, vacía, ${braillePart}`;
  }

  const name = SPANISH_PIECE_NAME[piece.type].singular;
  const colorLabel = piece.color === "w" ? "blanco" : "negro";
  // Concordancia de género básica
  const adj =
    piece.type === "q" || piece.type === "r"
      ? piece.color === "w"
        ? "blanca"
        : "negra"
      : colorLabel;

  return `Casilla ${s}, ${name} ${adj}, ${braillePart}`;
}

/**
 * Genera el contenido de un fichero .txt compatible con Ebrai
 * (UTF-8 con BOM + notación B8).
 */
export function fenToEbraiExport(
  fen: string,
  options: FenToOnceBrailleOptions = {},
): {
  filename: string;
  mimeType: string;
  content: string;
  /** Bytes UTF-8 con BOM para descarga. */
  blobParts: BlobPart[];
} {
  const braille = fenToOnceBraille(fen, options);
  const audio = fenToOnceAudio(fen);
  const content = [
    "Tablero de ajedrez — Notación Braille Unicode B8 (ONCE)",
    "Comisión Braille Española",
    "",
    "=== BRAILLE B8 ===",
    braille,
    "",
    "=== AUDIO DESCRIPTIVO ===",
    audio,
    "",
    `FEN: ${fen.trim()}`,
  ].join("\r\n");

  // BOM UTF-8 facilita la apertura correcta en Ebrai / Windows
  const bom = "\uFEFF";
  return {
    filename: "tablero-once-b8.txt",
    mimeType: "text/plain;charset=utf-8",
    content,
    blobParts: [bom, content],
  };
}

/** FEN de posición inicial estándar. */
export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function allSquares(): string[] {
  const squares: string[] = [];
  for (const rank of RANKS) {
    for (const file of FILES) {
      squares.push(`${file}${rank}`);
    }
  }
  return squares;
}

export function neighborSquare(
  square: string,
  direction: "up" | "down" | "left" | "right",
): string | null {
  const s = normalizeSquare(square);
  const fileIndex = FILES.indexOf(s[0] as (typeof FILES)[number]);
  const rankIndex = RANKS.indexOf(s[1] as (typeof RANKS)[number]);
  if (fileIndex < 0 || rankIndex < 0) return null;

  let f = fileIndex;
  let r = rankIndex;

  switch (direction) {
    case "up":
      r += 1;
      break;
    case "down":
      r -= 1;
      break;
    case "left":
      f -= 1;
      break;
    case "right":
      f += 1;
      break;
  }

  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return `${FILES[f]}${RANKS[r]}`;
}
