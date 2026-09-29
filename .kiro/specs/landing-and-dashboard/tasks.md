# Implementation Plan: Landing y Dashboard (ONCE Chess)

## Overview

Plan de implementación incremental y orientado a pruebas para las cuatro superficies cliente (landing en `/`, tablero en `/tablero`, dashboard en `/dashboard`) más el modo en línea multijugador (`/tablero/online/[codigo]`) con servidor autoritativo. El lenguaje de implementación es **TypeScript** (el proyecto ya es Next.js 16.3.7 + React 19 + TypeScript + Tailwind v4 + chess.js), tal como fija el diseño en sus interfaces concretas.

El plan avanza en orden de dependencias: primero se configura el framework de pruebas, luego las primitivas de accesibilidad reutilizables, después la capa de persistencia (`lib/storage.ts`) y el proveedor de ajustes, a continuación las superficies estáticas y el traslado del tablero, después el dashboard, la extensión del tablero para consumir ajustes y `pushRecentFen`, y por último todo el modo en línea (código de partida, protocolo, servidor autoritativo, hook cliente, componentes de lobby/estado/controles y ruta dinámica) más el tema CSS de alto contraste. Cada tarea integra su trabajo con las anteriores para que no queden piezas huérfanas.

Las pruebas basadas en propiedades (`fast-check`) cubren P1–P15 y las pruebas de integración/accesibilidad (`jest-axe`, simulación de dos clientes en línea) siguen la sección Testing Strategy del diseño. Las subtareas de prueba están marcadas con `*` (opcionales para un MVP más rápido) salvo cuando validan una propiedad de corrección crítica del núcleo.

## Tasks

- [x] 1. Configurar framework de pruebas y dependencias nuevas
  - Añadir y configurar Vitest + `@testing-library/react` + `jsdom` como entorno de pruebas (no existe framework aún); añadir script `test` con ejecución única (`vitest run`).
  - Instalar dependencias de test: `fast-check`, `jest-axe` (o `@axe-core/react`) y sus tipos.
  - Instalar dependencias de runtime del modo en línea: `socket.io` (servidor) y `socket.io-client` (cliente).
  - Crear archivo de setup de pruebas (matchers de Testing Library y de axe) y configurar alias de rutas coherente con `tsconfig.json`.
  - _Requirements: 5.1, 11.6, 14.6 (soporte de pruebas de P1–P15 y de integración)_

- [x] 2. Implementar primitivas de accesibilidad compartidas
  - [x] 2.1 Implementar `SkipLink` (`src/components/a11y/SkipLink.tsx`)
    - Enlace `href="#${targetId}"` oculto con `sr-only` salvo `:focus-visible`; `label` por defecto "Saltar al contenido principal".
    - _Requirements: 1.3, 1.4, 3.8_
  - [x] 2.2 Implementar `LiveRegion` y hook `useAnnouncer` (`src/components/a11y/LiveRegion.tsx`)
    - Renderizar `<p class="sr-only" aria-live="polite" aria-atomic="true">`; soportar `politeness` `assertive`.
    - `useAnnouncer` combina `setMessage` + `speak(text, { rate: voiceRate })` respetando `speechEnabled`; ignora mensajes vacíos/espacios; trunca a 500 caracteres; reemplaza el contenido anterior por completo.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_
  - [x] 2.3 Escribir pruebas unitarias de `LiveRegion`/`useAnnouncer`
    - Cubrir mensaje vacío conservado, truncado a 500, reemplazo total, `assertive`, y `speak` mockeado con y sin `speechEnabled`, y ausencia de `window.speechSynthesis`.
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9_

- [x] 3. Implementar capa de persistencia local `lib/storage.ts`
  - [x] 3.1 Implementar parser tolerante y validación de FEN
    - `readJson<T>(key, fallback, validate)` que nunca lanza: devuelve `fallback` ante ausencia de clave, JSON inválido, esquema no válido o versión no coincidente; en servidor (`window === undefined`) devuelve `fallback`.
    - `isValidFen(fen)` acepta si y solo si `new Chess(fen)` no lanza.
    - Definir claves versionadas `once-chess.settings.v1`, `once-chess.recent-fens.v1`, `once-chess.annotations.v1`, `once-chess.last-online-game.v1`.
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.5_
  - [x] 3.2 Escribir prueba de propiedad de tolerancia a corrupción
    - **Property 5: Tolerancia a corrupción**
    - **Validates: Requisito 5.1**
  - [x] 3.3 Implementar `Settings`: `loadSettings`, `saveSettings` con normalización y manejo de cuota
    - Normalizar `voiceRate` con clamp `[0.5, 2.0]`, no numérico → `1.0`; booleanos inválidos → valor por defecto; `DEFAULT_SETTINGS`.
    - `saveSettings` captura `QuotaExceededError`/cualquier excepción, conserva estado en memoria y expone señal de error para anunciar "No se pudieron guardar los cambios en este dispositivo."
    - _Requirements: 4.5, 4.6, 5.4, 5.6_
  - [x] 3.4 Escribir pruebas de propiedad de Settings
    - **Property 1: Persistencia idempotente** — `loadSettings(saveSettings(s)) === s` tras normalización.
    - **Property 6: Clamp de voz** — `voiceRate ∈ [0.5, 2.0]` para todo `x`.
    - **Validates: Requisitos 5.6, 4.5**
  - [x] 3.5 Implementar `RecentPosition`: `loadRecentFens`, `saveRecentFens`, `pushRecentFen`, `removeRecentFen`
    - `pushRecentFen`: descartar FEN inválido sin cambios; insertar en índice 0; deduplicar por `fen` exacto; recortar a 10 (LRU); `id` único no vacío + `savedAt`; recortar `label` a 80 caracteres.
    - `removeRecentFen(id)` retira la entrada indicada, conserva el resto y persiste.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7_
  - [x] 3.6 Escribir pruebas de propiedad de posiciones recientes
    - **Property 2: Capacidad de recientes** (`length <= 10`) — **Validates: Requisito 6.4**
    - **Property 3: Sin duplicados** — **Validates: Requisito 6.3**
    - **Property 4: Orden de recencia** (entrada válida en índice 0) — **Validates: Requisito 6.1**
  - [x] 3.7 Implementar `Annotation`: `loadAnnotations`, `saveAnnotation`, `removeAnnotation`
    - Validar `fen` con `new Chess(fen)`; rechazar si `title` vacío tras `trim()`; recortar `title` a 120 y `note` a 2000; `note` opcional; `id` único no vacío; `removeAnnotation(id)` retira y persiste.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x] 3.8 Escribir pruebas unitarias de anotaciones y manejo de cuota
    - Cubrir rechazo por FEN inválido, `title` vacío, recortes de longitud, `note` ausente, y captura de `QuotaExceededError` simulado sin romper.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 5.4_

- [x] 4. Implementar `SettingsProvider` y contexto de ajustes
  - [x] 4.1 Implementar `SettingsProvider` y `useSettings` (`src/context/SettingsProvider.tsx`)
    - Hidratar desde `loadSettings()` en cliente antes de renderizar controles; ante fallo, inicializar con defaults sin lanzar.
    - Setters `setVoiceRate`, `toggleShowPawnLetter`, `toggleHighContrast`, `toggleSpeech`, `resetSettings` que normalizan, persisten con `saveSettings` y aplican efectos: `data-contrast="high"` en `<html>` (o retirarlo), realimentación por voz con `voiceRate` vigente cuando `speechEnabled`.
    - `useSettings` lanza error explícito si se usa fuera del provider.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14_
  - [x] 4.2 Escribir prueba de propiedad de contraste reflejado
    - **Property 7: Contraste reflejado** — `settings.highContrast === true` ⟺ `<html data-contrast="high">`.
    - **Validates: Requisitos 4.7, 4.8**
  - [x] 4.3 Escribir pruebas unitarias del provider
    - Hidratación desde mock de `localStorage`, respeto de `speechEnabled` con `speak` mockeado, error al usar `useSettings` fuera del provider, `resetSettings`.
    - _Requirements: 4.1, 4.2, 4.9, 4.10, 4.13, 4.14_

- [x] 5. Integrar `RootLayout` con provider y skip link
  - Envolver la app en `SettingsProvider`, fijar `lang="es"`, montar `SkipLink` global y asegurar que el tema de contraste se pueda aplicar en `<html>`.
  - _Requirements: 4.1, 4.7, 4.8, 1.3, 3.8_

- [x] 6. Implementar la landing en `/`
  - Sustituir `src/app/page.tsx` por la landing (Server Component estático): landmarks `header > nav`, `main#contenido` con `tabIndex={-1}`, `section[aria-labelledby]` (hero, características, CTA) refiriendo `id` de encabezados visibles, exactamente un `h1`, `footer`.
  - CTAs con `next/link` a `/dashboard` y `/tablero` con texto accesible no vacío; orden de foco: SkipLink → contenido → CTAs.
  - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.3_
  - [x] 6.1 Escribir pruebas de integración/accesibilidad de la landing
    - `jest-axe` sin violaciones críticas; `Tab` alcanza SkipLink → `main` → CTAs en orden; `h1` único; enlaces a `/dashboard` y `/tablero` presentes y activables por teclado.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.9_

- [x] 7. Trasladar el tablero a `/tablero`
  - Crear `src/app/tablero/page.tsx` que renderiza una única instancia de `AccessibleChessBoard` sin duplicar el componente ni alterar su lógica de ajedrez.
  - Leer el parámetro `fen` de la URL: si falta o está vacío usar `STARTING_FEN`; si es inválido conservar la última posición válida y anunciar "FEN inválido" sin invocar `pushRecentFen`.
  - Trasladar el foco al `<main id="contenido">` al entrar en la ruta.
  - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 3.9_

- [x] 8. Extender `AccessibleChessBoard` para consumir ajustes y registrar posiciones
  - [x] 8.1 Consumir `voiceRate` y `showPawnLetter` desde `useSettings`
    - Sustituir el estado local de "letra en peón" por el valor de contexto; aplicar `voiceRate` a `speak(...)`; conservar región `aria-live="polite"` con `aria-atomic`, `sr-only`, anillos `focus-visible`, `role`/`aria-label` en español.
    - _Requirements: 2.2, 2.8, 4.11, 4.12_
  - [x] 8.2 Invocar `pushRecentFen` al cargar un FEN válido o completar un movimiento legal
    - Registrar exactamente una vez la posición resultante; no registrar si el FEN es inválido.
    - _Requirements: 2.5, 2.6_
  - [x] 8.3 Escribir pruebas del tablero extendido
    - Verificar que un FEN inválido en la URL no llama a `pushRecentFen` y anuncia el error; que un movimiento legal registra una sola vez; que `showPawnLetter`/`voiceRate` provienen del contexto.
    - _Requirements: 2.5, 2.6, 2.8_

- [x] 9. Implementar el dashboard en `/dashboard`
  - [x] 9.1 Estructura y carga de datos del dashboard (`src/app/dashboard/page.tsx`)
    - Client Component con `<main id="contenido" tabIndex={-1}>` y exactamente cuatro secciones etiquetadas (Acceso rápido, Posiciones recientes, Anotaciones guardadas, Ajustes), cada una con encabezado accesible y landmark.
    - Cargar `loadSettings()`, `loadRecentFens()`, `loadAnnotations()` con defaults ante ausencia; mostrar máx. 10 recientes y 50 anotaciones, de más reciente a más antigua; ante fallo de una carga, renderizar esa sección con defaults, anunciar en `LiveRegion` y conservar los datos persistidos.
    - Montar `LiveRegion` (`aria-live="polite"`, `aria-atomic`), SkipLink y orden de foco consistente con la landing; trasladar el foco a `<main>` al navegar (con `preventScroll` y sin scroll animado si `prefers-reduced-motion`).
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.8, 3.9, 3.10_
  - [x] 9.2 Acciones del dashboard: abrir posición reciente, ajustes y anotaciones
    - Abrir posición reciente navegando a `/tablero?fen=...`; si el FEN es inválido/ausente, cancelar navegación, anunciar en `LiveRegion` y mantener el foco en el control.
    - Panel de Ajustes conectado a `useSettings` (voz, letra de peón, alto contraste, activar voz, restablecer); cada cambio accionable emite mensaje no vacío en `LiveRegion` en ≤500 ms.
    - Renderizar anotaciones como texto plano (sin `dangerouslySetInnerHTML`); permitir eliminar recientes/anotaciones por `id`.
    - _Requirements: 3.4, 3.5, 3.7, 4.3, 4.9, 6.7, 7.6, 7.7_
  - [x] 9.3 Escribir prueba de propiedad de anuncio en vivo del dashboard
    - **Property 8: Anuncio en vivo** — todo cambio de estado accionable produce un mensaje no vacío en la `LiveRegion`.
    - **Validates: Requisito 3.7**
  - [x] 9.4 Escribir pruebas de integración/accesibilidad del dashboard
    - `jest-axe` sin violaciones críticas; navegación por teclado SkipLink → `main` → controles; posición reciente inválida cancela navegación y anuncia; `prefers-reduced-motion` desactiva scroll animado.
    - _Requirements: 3.1, 3.5, 3.9, 3.10, 3.8_

- [x] 10. Checkpoint - Asegurar que pasan las pruebas del núcleo cliente
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implementar el código de partida en línea (`src/lib/gameCode.ts`)
  - Definir diccionario curado en español de ≥64 palabras cortas, deletreables y sin homófonos confusos; sin caracteres confundibles.
  - `generarCodigo(existentes)` con formato `PALABRA-PALABRA-NN`, dígitos `[1-9]` (sin `0/O/1/I/L`), único frente a `existentes`, hasta 100 intentos.
  - `normalizarCodigo(entrada)` (mayúsculas, sin espacios, guiones unificados) y `esCodigoValido(codigo)`.
  - _Requirements: 9.2, 9.3, 9.4, 10.3, 10.4, 10.5_
  - [x] 11.1 Escribir pruebas de propiedad del código de partida
    - **Property 14: Unicidad e inambigüedad del código** — códigos distintos entre partidas y sólo diccionario + dígitos `[1-9]`.
    - **Property 15: Idempotencia de la normalización** — `normalizarCodigo(normalizarCodigo(x)) === normalizarCodigo(x)` y equivalencia por caja/espacios/guiones.
    - **Validates: Requisitos 9.2, 9.3, 10.4, 10.5**

- [x] 12. Definir tipos del protocolo de mensajes en línea (`src/lib/onlineProtocol.ts`)
  - Definir uniones discriminadas por `type`: `ClientMessage` y `ServerMessage`, y los tipos `OnlineGame`, `Participant`, `OnlineStatus`, `OnlineGameState` del diseño.
  - Implementar validadores de forma/campos para cada mensaje entrante (parseo de la unión discriminada) reutilizables por el servidor.
  - _Requirements: 16.1, 16.2, 11.1, 11.2_

- [x] 13. Implementar el servidor autoritativo (`src/server/gameServer.ts`)
  - [x] 13.1 Registro de partidas y creación/unión
    - Registro en memoria por `codigo`; `crearPartida()` con `Chess` inicial + código único (creador = blancas, `playerId` secreto); `unirse(codigo)` asigna negras, envía `fen`/`historial`; rechazar tercer jugador con `error("partida-llena")`; `error("codigo-invalido")`/`error("codigo-expirado")` según corresponda.
    - _Requirements: 9.1, 9.5, 10.1, 10.2, 10.6, 10.7, 10.8_
  - [x] 13.2 Movimiento autoritativo y cumplimiento de turno
    - `aplicarMovimiento(codigo, playerId, from, to, promotion)`: validar existencia, partida en curso, autorización por `playerId`, turno y legalidad con `chess.js`; actualizar `fen`/`historial`/`turno`/`resultado`/`ganador` (jaque mate, tablas) y difundir `state-sync`; devolver `move-rejected` con motivo sin alterar el `fen` autoritativo.
    - _Requirements: 11.2, 11.4, 11.5, 12.1, 12.2, 12.3, 16.3, 16.4_
  - [x] 13.3 Escribir pruebas de propiedad del estado autoritativo
    - **Property 10: Aplicación de la regla de turno** — `move` fuera de turno → `move-rejected("no-es-tu-turno")` sin cambiar `fen`.
    - **Property 11: Ningún movimiento ilegal en el estado autoritativo** — para toda secuencia de `move` (legales, ilegales, fuera de turno, malformados) el `fen` autoritativo es alcanzable por movimientos legales.
    - **Validates: Requisitos 12.1, 11.6, 16.2**
  - [x] 13.4 Rendición, tablas y ciclo de vida de conexión (servidor)
    - `rendirse` (resultado `rendicion`, rival ganador), `ofrecerTablas`/`resolverTablas` (una sola oferta pendiente; `draw-offered`/`draw-declined`/tablas), `reconectar` (reasociar socket, cancelar temporizador, `state-sync` exacto), `marcarDesconexion` (periodo de gracia 60 s → `opponent-disconnected`, superado → `abandono` + `opponent-abandoned`), una sesión por `playerId`.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 14.3, 14.4, 14.5, 14.7, 14.9_
  - [x] 13.5 Seguridad del servidor: validación, autorización, rate-limiting y purga
    - Validar cada mensaje contra la unión discriminada antes de procesar y descartar malformados con `error` sin mutar estado; nunca enviar `playerId` al rival; limitar `join`/`reconnect` a 5 por conexión/IP cada 10 s y `move`/`create`/`join` a 20 por conexión cada 10 s; purgar partidas finalizadas o inactivas 30 min.
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6, 16.7, 16.8_
  - [x] 13.6 Escribir prueba de propiedad de reconexión exacta
    - **Property 13: La reconexión restaura el estado exacto** — tras `N` medios movimientos, caída y `reconnect`, el `state-sync` reproduce el `fen` idéntico y `historial` de longitud `N`.
    - **Validates: Requisito 14.6**

- [x] 14. Implementar el hook cliente `useOnlineGame` (`src/hooks/useOnlineGame.ts`)
  - [x] 14.1 Conexión, estado autoritativo y envío de acciones
    - Abrir/mantener el socket (socket.io-client); `crearPartida`, `unirse`, `intentarMovimiento` (no aplicar hasta `state-sync`; descartar y restaurar si no llega en 5 s), `ofrecerTablas`/`aceptarTablas`/`rechazarTablas`/`rendirse`, `reconectar`.
    - Mantener `OnlineGameState` sincronizado sólo con `state-sync`; persistir `codigo`/`playerId` en `once-chess.last-online-game.v1`.
    - _Requirements: 11.1, 11.3, 11.7, 12.5, 14.8_
  - [x] 14.2 Reconexión con backoff y anuncios de cada evento de red
    - Estado `reconectando` con backoff exponencial desde 1 s hasta 30 s, máx. 10 intentos; agotados → `desconectado` con anuncio; traducir **cada** mensaje entrante en un anuncio no vacío en español por `aria-live` (+ voz si `speechEnabled`): rival unido, movimiento del rival, cambio de turno (por palabras, no sólo color), jaque, jaque mate/resultado, `move-rejected`, oferta de tablas (`assertive`), desconexión/reconexión/abandono, umbrales de espera (30 s, 60 s y luego cada 60 s), y reloj opcional (60/30/10 s).
    - _Requirements: 9.6, 9.8, 10.2, 10.6, 10.7, 10.8, 11.7, 12.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 14.1, 14.2, 14.3, 14.5, 14.7_
  - [x] 14.3 Escribir prueba de propiedad de consistencia entre clientes
    - **Property 9: Consistencia del estado autoritativo entre clientes** — tras un `state-sync`, ambos clientes muestran el mismo `fen`, `turno`, `historial` y `resultado`.
    - **Validates: Requisito 11.3**
  - [x] 14.4 Escribir prueba de propiedad de anuncio de todo evento de red
    - **Property 12: Anuncio de todo evento de red** — cada evento que cambia el estado produce un anuncio no vacío por `aria-live` y, si `speechEnabled`, por voz.
    - **Validates: Requisito 13.1**

- [x] 15. Implementar los componentes del modo en línea
  - [x] 15.1 Implementar `OnlineLobby` (`src/components/online/OnlineLobby.tsx`)
    - Crear/unir partida; mostrar y **deletrear** el código creado; botón accesible "Copiar enlace"; campo de unión que aplica `normalizarCodigo` y anuncia errores de código.
    - _Requirements: 9.6, 9.7, 10.3, 10.6, 10.7, 10.8_
  - [x] 15.2 Implementar `OnlineStatus` y `OnlineControls` (`src/components/online/`)
    - `OnlineStatus`: turno, conexión y reloj opcional en texto legible por lector (no sólo color).
    - `OnlineControls`: botones con `aria-label` claros y activables por teclado (rendirse, ofrecer/aceptar/rechazar tablas); la oferta del rival por `aria-live="assertive"`.
    - _Requirements: 13.4, 13.5, 13.7, 15.6, 12.5_
  - [x] 15.3 Escribir pruebas de accesibilidad de los componentes en línea
    - `jest-axe` sin violaciones críticas; controles activables por teclado; código deletreado presente; estado por texto además de color.
    - _Requirements: 9.7, 13.7, 15.6_

- [x] 16. Implementar la ruta del modo en línea `/tablero/online/[codigo]`
  - Crear `src/app/tablero/online/[codigo]/page.tsx` que monta `useOnlineGame(codigo)`, `OnlineLobby` (sin rival), `AccessibleChessBoard` en modo controlado (`fen` autoritativo, `orientation` según color, `interactive={esMiTurno}`, `onAttemptMove`), `OnlineControls`, `OnlineStatus` y `LiveRegion`; el tablero no es interactivo ni recibe foco fuera de turno.
  - _Requirements: 10.1, 11.1, 12.5, 13.1, 13.5_
  - [x] 16.1 Escribir prueba de integración de dos clientes simulados
    - Arrancar el servidor en memoria y dos sockets; verificar crear → unir → mover y convergencia al mismo estado (P9); cada evento produce anuncio no vacío (P12); jaque/jaque mate/tablas/rendición anunciados; desconexión → `opponent-disconnected`, reconexión → `opponent-reconnected` + re-sync exacta (P13); superar gracia → `opponent-abandoned`.
    - _Requirements: 11.3, 13.1, 14.3, 14.5, 14.6, 14.7, 15.1, 15.4_

- [x] 17. Implementar el tema CSS de alto contraste y foco visible
  - Añadir en `globals.css` el bloque de tema bajo `[data-contrast="high"]` aplicado a todos los elementos visibles, y estilos `:focus-visible` (incluido el `SkipLink`) con contraste ≥3:1; suprimir animaciones y scroll animado bajo `prefers-reduced-motion: reduce`.
  - _Requirements: 1.7, 1.8, 1.9, 3.10, 4.7, 4.8_

- [ ] 18. (Opcional) Implementar el reloj de partida en línea
  - [~] 18.1 Añadir soporte de `relojMs` en servidor y hook con anuncios de cuenta atrás
    - Reloj por jugador en el estado autoritativo y anuncios de umbrales 60/30/10 s en `OnlineStatus`/`useOnlineGame`.
    - _Requirements: 13.6_

- [ ] 19. (Opcional) Implementar el chat de texto en línea
  - [~] 19.1 Añadir mensajes `chat` como texto plano con límite de longitud
    - Tratar el texto como texto plano sin HTML y limitar a 500 caracteres en cliente y servidor.
    - _Requirements: 16.9_

- [x] 20. Checkpoint final - Asegurar que pasan todas las pruebas
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido (incluye todas las subtareas de prueba, el reloj y el chat).
- Cada tarea referencia requisitos concretos (por número de criterio) y, cuando procede, la propiedad de corrección `Pn` que valida.
- Los checkpoints aseguran validación incremental; el modo en línea se apoya en el núcleo cliente ya probado.
- Las pruebas de propiedad (`fast-check`) validan P1–P15; las unitarias y de integración (incluida la simulación de dos clientes y `jest-axe`) validan ejemplos, casos límite y accesibilidad, según la Testing Strategy del diseño.
- El servidor es la única fuente de verdad del modo en línea; el cliente nunca aplica un movimiento hasta el `state-sync` autoritativo.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "11", "12"] },
    { "id": 2, "tasks": ["2.3", "3.2", "3.3", "3.5", "3.7", "11.1", "13.1"] },
    { "id": 3, "tasks": ["3.4", "3.6", "3.8", "4.1", "13.2", "13.4", "13.5"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5", "13.3", "13.6", "14.1"] },
    { "id": 5, "tasks": ["6", "7", "8.1", "14.2"] },
    { "id": 6, "tasks": ["6.1", "8.2", "9.1", "14.3", "14.4", "15.1", "15.2"] },
    { "id": 7, "tasks": ["8.3", "9.2", "15.3", "16"] },
    { "id": 8, "tasks": ["9.3", "9.4", "16.1", "17"] },
    { "id": 9, "tasks": ["18.1", "19.1"] }
  ]
}
```
