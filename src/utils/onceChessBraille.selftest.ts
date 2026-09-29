/**
 * Comprobaciones ligeras de codificación B8 / audio ONCE.
 * Ejecutar: npx tsx src/utils/onceChessBraille.selftest.ts
 */
import {
  fenToOnceAudio,
  fenToOnceBraille,
  STARTING_FEN,
} from "./onceChessBraille";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const startBraille = fenToOnceBraille(STARTING_FEN);
assert(
  startBraille.includes("Blancas: Re⠂ Dd⠂ Ta⠂ Th⠂ Cb⠂ Cg⠂ Ac⠂ Af⠂ a⠆ b⠆ c⠆ d⠆ e⠆ f⠆ g⠆ h⠆"),
  `Braille inicial blancas incorrecto:\n${startBraille}`,
);
assert(
  startBraille.includes("Negras: Re⠦ Dd⠦ Ta⠦ Th⠦ Cb⠦ Cg⠦ Ac⠦ Af⠦ a⠶ b⠶ c⠶ d⠶ e⠶ f⠶ g⠶ h⠶"),
  `Braille inicial negras incorrecto:\n${startBraille}`,
);

const startAudio = fenToOnceAudio(STARTING_FEN);
assert(startAudio.startsWith("Blancas: Rey en E1, Dama en D1"), startAudio);
assert(startAudio.includes("Peones en A2, B2, C2, D2, E2, F2, G2 y H2"), startAudio);
assert(startAudio.includes("Negras: Rey en E8, Dama en D8"), startAudio);

const withDidactics = fenToOnceBraille(STARTING_FEN, {
  showPawnLetter: true,
  highlightedSquares: [
    { square: "g3", color: "amarillo" },
    { square: "h4", color: "amarillo" },
    { square: "c1", color: "rojo" },
  ],
  arrows: [{ from: "d4", to: "d1" }],
});

assert(withDidactics.includes("Pa⠆"), "Peón con letra P esperado");
assert(
  withDidactics.includes(")Resaltadas en amarillo las casillas g⠒ y h⠲("),
  `Resaltado amarillo: ${withDidactics}`,
);
assert(
  withDidactics.includes(")Resaltadas en rojo la casilla c⠂("),
  `Resaltado rojo: ${withDidactics}`,
);
assert(withDidactics.includes("d⠲¬⠒⠕¬d⠂"), `Flecha: ${withDidactics}`);

// Ejemplo del enunciado (posición custom aproximada del documento)
const sampleFen =
  "4k3/pp2pppp/2n5/2p5/1bB3b1/2N2N2/PP1PPPPP/R2QK2R w KQ - 0 1";
const sample = fenToOnceBraille(sampleFen);
console.log("Sample B8:\n", sample);
console.log("\nSelf-test OK");
