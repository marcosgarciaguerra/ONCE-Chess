# Ajedrez accesible B8 (ONCE)

Aplicación Next.js (App Router) + TypeScript + Tailwind CSS para el hackathon de la ONCE.

Transforma tableros de ajedrez en:

1. **Notación Braille Unicode** según el Documento Técnico B8 de la Comisión Braille Española.
2. **Texto descriptivo Audio/TTS** para lectores de pantalla.
3. **Tablero interactivo** jugable por teclado y voz (`chess.js`).

## Arranque

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Comprobación B8

```bash
npx tsx src/utils/onceChessBraille.selftest.ts
```

## Estructura

| Ruta | Rol |
|------|-----|
| `src/utils/onceChessBraille.ts` | `fenToOnceBraille`, `fenToOnceAudio`, export Ebrai |
| `src/utils/speech.ts` | `speechSynthesis` es-ES |
| `src/components/AccessibleChessBoard.tsx` | Tablero + panel Braille/audio |
| `src/app/page.tsx` | Página principal |

## Teclado

- **Flechas**: navegar casillas
- **Enter / Espacio**: seleccionar / mover
- **D**: descripción completa del tablero
- **Escape**: cancelar selección

## Exportación Ebrai

El botón **Descargar para Ebrai** genera un `.txt` UTF-8 con BOM con la notación B8 y el audio descriptivo.
