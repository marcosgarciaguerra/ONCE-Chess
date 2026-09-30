import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";

import { chooseCpuMove, cpuLevelLabel } from "./cpuEngine";

describe("cpuEngine", () => {
  it("elige un movimiento legal desde la posición inicial", () => {
    const fen = new Chess().fen();
    const move = chooseCpuMove(fen, 0, () => 0);
    expect(move).not.toBeNull();
    const board = new Chess(fen);
    expect(() =>
      board.move({
        from: move!.from,
        to: move!.to,
        promotion: move!.promotion,
      }),
    ).not.toThrow();
  });

  it("en nivel fácil prioriza capturas cuando no hay jaques inmediatos", () => {
    // Solo captura disponible clara: exd5 (sin jaques inmediatos obvios de pieza menor).
    const fen =
      "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
    const move = chooseCpuMove(fen, 0, () => 0);
    expect(move).not.toBeNull();
    expect(move!.from).toBe("e4");
    expect(move!.to).toBe("d5");
  });

  it("devuelve null si la partida ha terminado", () => {
    const mate =
      "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(chooseCpuMove(mate, 1)).toBeNull();
  });

  it("cpuLevelLabel habla en español", () => {
    expect(cpuLevelLabel(0)).toBe("fácil");
    expect(cpuLevelLabel(1)).toBe("medio");
    expect(cpuLevelLabel(2)).toBe("difícil");
  });

  it("nivel medio produce un movimiento legal", () => {
    const fen = new Chess().fen();
    const move = chooseCpuMove(fen, 1, () => 0.5);
    expect(move).not.toBeNull();
    expect(move!.from).toMatch(/^[a-h][1-8]$/);
    expect(move!.to).toMatch(/^[a-h][1-8]$/);
  });
});
