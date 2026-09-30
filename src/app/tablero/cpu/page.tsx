import { CpuGameClient } from "@/components/CpuGameClient";

/**
 * Ruta `/tablero/cpu`: partida accesible contra la máquina (motor local).
 */
export default function TableroCpuPage() {
  return <CpuGameClient />;
}
