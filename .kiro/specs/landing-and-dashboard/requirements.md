# Requirements Document

## Introduction

Esta funcionalidad amplía el producto **ONCE Chess** (ajedrez accesible afiliado a la ONCE y a la Comisión Braille Española) con tres superficies conectadas y un modo multijugador en línea, construidos con Next.js 16.3.7 (App Router), React 19, TypeScript, Tailwind v4 y `chess.js`. El producto es **accesibilidad primero para personas ciegas y con baja visión**: cada superficie y cada evento deben ser operables y comprensibles mediante lector de pantalla, teclado, voz sintetizada (Web Speech API) y alto contraste, respetando `prefers-reduced-motion`. Toda la copia de interfaz y todos los anuncios están en **español**.

Las capacidades cubiertas son: (1) una **landing** en `/` que explica la misión con un hero accesible, enlace de salto, landmarks semánticos, orden de foco por teclado, alto contraste y respeto de movimiento reducido; (2) un **dashboard** en `/dashboard` como centro accesible de acceso al tablero, posiciones recientes (FEN), anotaciones guardadas y ajustes, navegable por teclado y lector de pantalla con anuncios `aria-live`; (3) el **tablero accesible** en `/tablero`, reutilizando los patrones existentes de `AccessibleChessBoard`; (4) **persistencia ligera en `localStorage`** para ajustes, posiciones recientes (LRU máx. 10 con deduplicación y validación de FEN) y anotaciones, con parseo tolerante y manejo de cuota/errores; y (5) un **modo en línea** en el que dos personas ciegas juegan en tiempo real por WebSocket contra un servidor autoritativo que valida cada movimiento con `chess.js`, con código de partida deletreable, sincronización de estado, cumplimiento de turno, anuncios accesibles de cada evento de red, ciclo de vida de conexión con recuperación, y seguridad del lado del servidor.

Este documento deriva de `design.md` (fuente de verdad) y traza cada requisito, cuando procede, a las propiedades de corrección **P1–P15** definidas en el diseño.

## Glossary

- **THE_SISTEMA**: El producto ONCE Chess en su conjunto (superficies cliente y servidor autoritativo), salvo cuando se nombra un subsistema más específico.
- **THE_LANDING**: La página pública en `/` (`app/page.tsx`) que presenta la misión y los puntos de entrada.
- **THE_DASHBOARD**: El hub operativo en `/dashboard` (`app/dashboard/page.tsx`).
- **THE_TABLERO**: El componente `AccessibleChessBoard` alojado en `/tablero` (`app/tablero/page.tsx`).
- **THE_ALMACENAMIENTO**: El módulo de persistencia local `lib/storage.ts` sobre `localStorage`.
- **THE_AJUSTES**: El proveedor de ajustes de accesibilidad `SettingsProvider` y su estado `Settings`.
- **THE_SERVIDOR**: El servidor WebSocket autoritativo del modo en línea (`server/gameServer.ts`, Socket.IO) que valida con `chess.js`.
- **THE_CLIENTE_EN_LINEA**: El hook cliente `useOnlineGame` que gestiona la conexión WebSocket y los anuncios de red.
- **THE_LOBBY**: El componente `OnlineLobby` para crear una partida o unirse mediante código.
- **FEN** (Forsyth–Edwards Notation): Cadena estándar que describe por completo una posición de ajedrez; se valida instanciando `new Chess(fen)`.
- **SAN** (Standard Algebraic Notation): Notación algebraica estándar de un movimiento de ajedrez (p. ej. "Cf3").
- **aria-live**: Región ARIA que el lector de pantalla anuncia automáticamente al cambiar su contenido; puede ser `polite` o `assertive`.
- **lector de pantalla**: Tecnología de asistencia que convierte el contenido de la interfaz en voz o Braille.
- **Web Speech API**: API del navegador (`window.speechSynthesis`) usada por `utils/speech.ts` para la realimentación por voz sintetizada.
- **realimentación por voz**: Anuncio hablado emitido mediante la Web Speech API, sujeto a `speechEnabled` y `voiceRate`.
- **prefers-reduced-motion**: Preferencia del sistema que solicita reducir o eliminar animaciones y desplazamientos animados.
- **enlace de salto (skip link)**: Enlace "Saltar al contenido principal" visible al recibir foco que traslada el foco al `<main>`.
- **landmark**: Región semántica de la página (`header`, `nav`, `main`, `footer`, `section` etiquetada) reconocida por el lector de pantalla.
- **alto contraste**: Tema visual activado por `data-contrast="high"` en `<html>` para mejorar la legibilidad.
- **Braille B8**: Convención de representación de piezas usada por el tablero (incluye la opción de mostrar la letra en peones).
- **posición reciente (RecentPosition)**: Entrada persistida con un FEN válido, etiqueta legible y marca temporal.
- **anotación (Annotation)**: Nota didáctica persistida asociada a un FEN, con título y texto.
- **LRU**: Política "menos usado recientemente"; la lista de posiciones recientes conserva las más recientes al frente y descarta las más antiguas al superar la capacidad.
- **código de partida (GameCode)**: Identificador legible y deletreable de una partida en línea con formato `PALABRA-PALABRA-NN`, usando un diccionario curado y dígitos `[1-9]`.
- **estado autoritativo**: El `fen`, `historial`, `turno` y `resultado` oficiales mantenidos por THE_SERVIDOR mediante una instancia `Chess`; única fuente de verdad de la partida en línea.
- **playerId**: Token opaco y secreto por jugador, usado para autorización y reconexión; no se envía al rival.
- **state-sync**: Mensaje del servidor que difunde el estado autoritativo actual a ambos clientes.
- **periodo de gracia**: Ventana temporal tras una desconexión durante la cual el rival puede reconectarse antes de declararse abandono.
- **partida abandonada**: Resultado cuando un jugador no se reconecta dentro del periodo de gracia.

## Requirements

### Requisito 1: Landing accesible que explica la misión

**Historia de usuario:** Como persona ciega que llega por primera vez, quiero una página de inicio que explique el proyecto y ofrezca un punto de entrada accesible, para entender la misión y empezar a usar la herramienta sin ayuda vidente.

#### Criterios de aceptación

1. WHEN una persona usuaria carga la ruta `/`, THE_LANDING SHALL renderizar exactamente un encabezado principal `h1`, único en la página, cuyo texto identifica el producto como ajedrez accesible para personas ciegas.
2. THE_LANDING SHALL exponer exactamente un landmark de cada tipo `header`, `nav`, `main` y `footer`, y SHALL etiquetar mediante `aria-labelledby` las secciones `section` correspondientes al hero, a las características y a la barra de llamada a la acción, refiriendo cada `aria-labelledby` al `id` de un encabezado visible existente dentro de la misma sección.
3. WHEN una persona usuaria pulsa la tecla Tab una vez tras cargar `/` sin haber movido el foco previamente, THE_LANDING SHALL colocar el foco, como primer elemento enfocable del orden de tabulación, en el enlace de salto cuyo texto accesible es "Saltar al contenido principal".
4. WHEN una persona usuaria activa el enlace de salto mediante Enter, barra espaciadora o clic, THE_LANDING SHALL trasladar el foco al elemento `<main id="contenido" tabIndex={-1}>` de forma que dicho elemento quede como elemento con foco activo.
5. THE_LANDING SHALL ofrecer un enlace hacia `/dashboard` y un enlace hacia `/tablero`, ambos con texto accesible no vacío que describe su destino, ambos alcanzables y activables mediante teclado (Tab para enfocar y Enter para activar).
6. WHEN una persona usuaria recorre la página pulsando Tab de forma repetida, THE_LANDING SHALL presentar el orden de foco en la secuencia: primero el enlace de salto, después el contenido principal y finalmente las llamadas a la acción, sin que ningún elemento enfocable quede excluido de dicho orden.
7. WHILE el atributo `data-contrast="high"` está presente en el documento, THE_LANDING SHALL aplicar los estilos de alto contraste asociados al selector `[data-contrast="high"]` a todos los elementos visibles de la página.
8. WHILE la preferencia del sistema `prefers-reduced-motion: reduce` está activa, THE_LANDING SHALL suprimir la totalidad de las animaciones y del desplazamiento animado, de modo que las transiciones de posición y desplazamiento se produzcan de forma instantánea.
9. WHEN un elemento enfocable de THE_LANDING recibe el foco mediante teclado, THE_LANDING SHALL mostrar un indicador de foco visible mediante `:focus-visible` con una relación de contraste de al menos 3:1 respecto al color adyacente.
10. IF una persona usuaria activa el enlace hacia `/dashboard` o hacia `/tablero` y la navegación al destino no puede completarse, THEN THE_LANDING SHALL mantener el foco en el enlace activado y SHALL presentar un mensaje de error accesible que indique que la navegación no pudo completarse.

### Requisito 2: Traslado del tablero a `/tablero`

**Historia de usuario:** Como persona usuaria, quiero acceder al tablero accesible en una ruta propia enlazada desde la landing y el dashboard, para jugar sin que el componente se duplique ni pierda sus características de accesibilidad.

#### Criterios de aceptación

1. WHEN una persona usuaria navega a la ruta `/tablero`, THE_TABLERO SHALL renderizar exactamente una instancia del componente `AccessibleChessBoard` dentro de los 2 segundos posteriores a la solicitud de la ruta.
2. THE_TABLERO SHALL conservar los patrones de accesibilidad existentes: una región `aria-live="polite"` con `aria-atomic="true"`, texto `sr-only`, anillos `focus-visible`, y `role` y `aria-label` en español en el contenedor del tablero, y realimentación por voz mediante `speak(...)`.
3. WHEN una persona usuaria activa el enlace hacia el tablero desde THE_LANDING o THE_DASHBOARD, THE_SISTEMA SHALL navegar a `/tablero` sin recargar la página completa y dentro de 1 segundo tras la activación.
4. IF una persona usuaria activa el enlace hacia el tablero y la navegación no puede completarse, THEN THE_SISTEMA SHALL permanecer en la ruta actual y SHALL mostrar un mensaje indicando que el tablero no está disponible.
5. WHEN THE_TABLERO carga una posición desde un FEN válido o completa un movimiento legal, THE_TABLERO SHALL invocar `pushRecentFen` exactamente una vez con la posición resultante para registrarla.
6. IF el parámetro `fen` de la URL representa una posición inválida, THEN THE_TABLERO SHALL no invocar `pushRecentFen`, SHALL conservar la última posición válida y SHALL anunciar por voz un mensaje indicando que el FEN es inválido.
7. IF la ruta `/tablero` no incluye el parámetro `fen` o su valor está vacío, THEN THE_TABLERO SHALL renderizar la posición inicial estándar (STARTING_FEN).
8. THE_TABLERO SHALL obtener los valores `voiceRate` y `showPawnLetter` desde THE_AJUSTES en lugar de mantener un estado local para la letra de peón.

### Requisito 3: Dashboard como hub accesible

**Historia de usuario:** Como persona ciega, quiero un panel que reúna acceso rápido al tablero, mis posiciones recientes, mis anotaciones y mis ajustes, para operar toda la herramienta por teclado y lector de pantalla desde un solo lugar.

#### Criterios de aceptación

1. WHEN una persona usuaria carga la ruta `/dashboard`, THE_DASHBOARD SHALL renderizar en menos de 2 segundos un `<main id="contenido" tabIndex={-1}>` que contenga exactamente cuatro secciones, cada una con un encabezado accesible y un landmark asociado, etiquetadas como Acceso rápido, Posiciones recientes, Anotaciones guardadas y Ajustes.
2. WHEN THE_DASHBOARD se monta, THE_DASHBOARD SHALL cargar los datos persistidos mediante `loadSettings()`, `loadRecentFens()` y `loadAnnotations()`, y SHALL aplicar valores por defecto cuando no existan datos, mostrando como máximo las 10 posiciones recientes y las 50 anotaciones más recientes ordenadas de más reciente a más antigua.
3. IF una o más de las operaciones `loadSettings()`, `loadRecentFens()` o `loadAnnotations()` falla, THEN THE_DASHBOARD SHALL renderizar la sección afectada con sus valores por defecto, SHALL emitir en la `LiveRegion` un mensaje que indique que no se pudieron cargar los datos de esa sección, y SHALL conservar los datos persistidos sin modificarlos.
4. WHEN una persona usuaria activa una posición reciente, THE_DASHBOARD SHALL navegar a la ruta `/tablero` con el FEN correspondiente en el parámetro de consulta.
5. IF una persona usuaria activa una posición reciente cuyo FEN es inválido o está ausente, THEN THE_DASHBOARD SHALL cancelar la navegación, SHALL emitir en la `LiveRegion` un mensaje que indique que la posición no se pudo abrir, y SHALL mantener el foco en el control activado.
6. THE_DASHBOARD SHALL renderizar una `LiveRegion` con `aria-live="polite"` y `aria-atomic="true"` para anunciar los cambios de estado.
7. WHEN una persona usuaria realiza un cambio de estado accionable en THE_DASHBOARD, THE_DASHBOARD SHALL emitir en la `LiveRegion`, en un plazo máximo de 500 milisegundos, un mensaje de texto no vacío que describa el resultado del cambio. (Valida: Requisito P8)
8. THE_DASHBOARD SHALL exponer el enlace de salto, los landmarks y el orden de foco lógico de forma consistente con THE_LANDING, presentando el enlace de salto como primer elemento enfocable de la página.
9. WHEN una persona usuaria navega entre rutas hacia THE_DASHBOARD, THE_SISTEMA SHALL trasladar el foco al elemento `<main id="contenido">` de destino en un plazo máximo de 500 milisegundos tras completarse la navegación.
10. WHILE la preferencia `prefers-reduced-motion: reduce` está activa, THE_SISTEMA SHALL usar `preventScroll` al enfocar el `<main>` y SHALL omitir el desplazamiento animado.

### Requisito 4: Ajustes de accesibilidad persistentes

**Historia de usuario:** Como persona con baja visión, quiero ajustar la velocidad de la voz, la letra en peones, el alto contraste y la activación de la voz, para adaptar la herramienta a mis necesidades y que mis preferencias se conserven.

#### Criterios de aceptación

1. WHEN THE_AJUSTES se monta en cliente, THE_AJUSTES SHALL hidratar el estado desde `localStorage` mediante `loadSettings()` antes de renderizar cualquier control de ajuste interactivo.
2. IF al montarse THE_AJUSTES el `localStorage` no está disponible o su contenido no puede interpretarse, THEN THE_AJUSTES SHALL inicializar el estado con los valores por defecto sin lanzar un error que interrumpa el renderizado.
3. WHEN una persona usuaria cambia un ajuste, THE_AJUSTES SHALL persistir el estado resultante mediante `saveSettings(...)`.
4. IF la persistencia mediante `saveSettings(...)` falla, THEN THE_AJUSTES SHALL conservar el estado en memoria vigente y presentar una indicación de error señalando que las preferencias no pudieron guardarse.
5. WHEN una persona usuaria fija `voiceRate` con un valor numérico `x`, THE_AJUSTES SHALL recortar el valor al rango cerrado `[0.5, 2.0]`. (Valida: Requisito P6)
6. IF una persona usuaria fija `voiceRate` con un valor no numérico, THEN THE_AJUSTES SHALL usar el valor por defecto `1.0`.
7. WHILE `highContrast` es verdadero, THE_AJUSTES SHALL fijar el atributo `data-contrast="high"` en el elemento `<html>`. (Valida: Requisito P7)
8. WHILE `highContrast` es falso, THE_AJUSTES SHALL retirar el atributo `data-contrast` del elemento `<html>`. (Valida: Requisito P7)
9. WHILE `speechEnabled` es verdadero, WHEN una persona usuaria cambia un ajuste, THE_AJUSTES SHALL emitir una realimentación por voz que nombre el ajuste modificado y su nuevo valor, aplicando el `voiceRate` vigente.
10. WHILE `speechEnabled` es falso, THE_AJUSTES SHALL suprimir toda realimentación por voz sintetizada.
11. THE_AJUSTES SHALL exponer `voiceRate` a todos los anuncios por voz de THE_SISTEMA.
12. WHEN una persona usuaria cambia el ajuste de letra en peones, THE_AJUSTES SHALL persistir el valor seleccionado mediante `saveSettings(...)` y aplicarlo a la representación de los peones.
13. WHEN una persona usuaria solicita restablecer los ajustes, THE_AJUSTES SHALL restaurar los valores por defecto y persistirlos mediante `saveSettings(...)`.
14. IF `useSettings` se invoca fuera de un árbol envuelto por `SettingsProvider`, THEN THE_AJUSTES SHALL lanzar un error cuyo mensaje indique que `useSettings` requiere estar dentro de `SettingsProvider`.

### Requisito 5: Persistencia local tolerante a fallos

**Historia de usuario:** Como persona usuaria, quiero que mis datos locales se guarden y se lean de forma segura aunque el almacenamiento falle o contenga datos corruptos, para no perder el uso de la herramienta ni encontrar bloqueos.

#### Criterios de aceptación

1. WHEN THE_ALMACENAMIENTO lee una clave, THE_ALMACENAMIENTO SHALL pasar los datos por un parser tolerante que devuelve el valor por defecto definido para esa colección ante ausencia de la clave, JSON sintácticamente inválido o resultado que no supera la validación de esquema, sin lanzar excepciones al llamador. (Valida: Requisito P5)
2. WHEN THE_ALMACENAMIENTO se ejecuta en un entorno de servidor donde `window` es `undefined`, THE_ALMACENAMIENTO SHALL devolver los valores por defecto definidos para cada colección sin intentar acceder a `localStorage`.
3. THE_ALMACENAMIENTO SHALL persistir cada colección en su clave versionada correspondiente: `once-chess.settings.v1`, `once-chess.recent-fens.v1` y `once-chess.annotations.v1`.
4. IF una escritura en `localStorage` lanza `QuotaExceededError` o cualquier otra excepción, THEN THE_ALMACENAMIENTO SHALL capturar la excepción, conservar en memoria el estado previo de la aplicación sin cambios, mantener la interfaz operativa y anunciar el mensaje "No se pudieron guardar los cambios en este dispositivo."
5. WHEN THE_ALMACENAMIENTO lee datos cuya versión de esquema no coincide con la versión esperada por la clave, THE_ALMACENAMIENTO SHALL rechazarlos por validación y devolver los valores por defecto definidos para esa colección.
6. WHEN THE_ALMACENAMIENTO guarda un valor `settings` que supera la validación y a continuación lo carga desde la misma clave, THE_ALMACENAMIENTO SHALL devolver un objeto cuyos campos normalizados son iguales, campo a campo, a los del valor persistido tras aplicar la misma normalización. (Valida: Requisito P1)

### Requisito 6: Gestión de posiciones recientes (FEN)

**Historia de usuario:** Como persona que estudia ajedrez, quiero que mis últimas posiciones se guarden automáticamente sin duplicados y limitadas a las más recientes, para reabrirlas rápidamente desde el dashboard.

#### Criterios de aceptación

1. WHEN se invoca `pushRecentFen(fen, label)` con un `fen` válido, THE_ALMACENAMIENTO SHALL crear una entrada con un `id` único no vacío y una marca de tiempo de creación, e insertarla en el índice 0 de la lista de posiciones recientes. (Valida: Requisito P4)
2. IF `pushRecentFen` recibe un `fen` inválido, THEN THE_ALMACENAMIENTO SHALL dejar la lista de posiciones recientes sin cambios y devolverla tal cual, sin crear ninguna entrada nueva.
3. WHEN se inserta una posición cuyo `fen` coincide exactamente con el `fen` de una entrada existente, THE_ALMACENAMIENTO SHALL eliminar la entrada previa y colocar la nueva en el índice 0, de modo que no exista más de una entrada con el mismo `fen`. (Valida: Requisito P3)
4. WHEN una inserción deja la lista de posiciones recientes con más de 10 entradas, THE_ALMACENAMIENTO SHALL recortarla a un máximo de 10 entradas conservando las 10 más recientes y descartando las restantes. (Valida: Requisito P2)
5. WHEN THE_ALMACENAMIENTO valida un FEN, THE_ALMACENAMIENTO SHALL aceptarlo si y solo si la construcción `new Chess(fen)` no lanza una excepción.
6. WHEN `pushRecentFen` recibe un `label`, THE_ALMACENAMIENTO SHALL recortar su longitud a un máximo de 80 caracteres antes de persistir la entrada.
7. WHEN una persona usuaria solicita eliminar una posición reciente identificada por su `id`, THE_ALMACENAMIENTO SHALL retirar de la lista la entrada con ese `id`, dejar el resto de entradas sin cambios y persistir el resultado.

### Requisito 7: Anotaciones guardadas

**Historia de usuario:** Como persona que aprende ajedrez, quiero guardar notas didácticas asociadas a una posición, para repasarlas después desde el dashboard.

#### Criterios de aceptación

1. WHEN una persona usuaria guarda una anotación, THE_ALMACENAMIENTO SHALL validar el `fen` asociado mediante `new Chess(fen)` y descartar el guardado, sin modificar la lista de anotaciones, si esa construcción lanza una excepción.
2. IF el `title` está vacío tras aplicar `trim()`, THEN THE_ALMACENAMIENTO SHALL rechazar el guardado de la anotación y dejar la lista de anotaciones sin cambios.
3. WHEN THE_ALMACENAMIENTO guarda una anotación que ha superado la validación, THE_ALMACENAMIENTO SHALL recortar `title` a un máximo de 120 caracteres y `note` a un máximo de 2000 caracteres antes de persistirla.
4. THE_ALMACENAMIENTO SHALL tratar `note` como campo opcional y aceptar su ausencia sin rechazar el guardado.
5. WHEN THE_ALMACENAMIENTO guarda una anotación que ha superado la validación, THE_ALMACENAMIENTO SHALL asignarle un `id` único no vacío antes de persistirla.
6. WHEN THE_DASHBOARD renderiza una anotación, THE_DASHBOARD SHALL mostrar `title` y `note` como texto plano, sin emplear `dangerouslySetInnerHTML`.
7. WHEN una persona usuaria solicita eliminar una anotación identificada por su `id`, THE_ALMACENAMIENTO SHALL retirar de la lista la anotación con ese `id`, dejar el resto sin cambios y persistir el resultado.

### Requisito 8: Anuncios accesibles compartidos

**Historia de usuario:** Como persona ciega, quiero que los cambios de estado relevantes se anuncien por lector de pantalla y, opcionalmente, por voz, para conocer siempre el estado sin ayuda vidente.

#### Criterios de aceptación

1. THE_SISTEMA SHALL renderizar la `LiveRegion` como `<p class="sr-only" aria-live="polite" aria-atomic="true">`.
2. WHEN `useAnnouncer` recibe una instrucción de anunciar con un mensaje no vacío, THE_SISTEMA SHALL fijar dicho mensaje como contenido textual de la `LiveRegion` en un plazo máximo de 100 ms.
3. IF `useAnnouncer` recibe una instrucción de anunciar con un mensaje vacío o compuesto solo por espacios, THEN THE_SISTEMA SHALL conservar el contenido previo de la `LiveRegion` sin modificarlo.
4. WHEN `useAnnouncer` recibe un mensaje que supera los 500 caracteres, THE_SISTEMA SHALL truncar el contenido de la `LiveRegion` a 500 caracteres antes de fijarlo.
5. WHEN `useAnnouncer` recibe una nueva instrucción de anunciar mientras la `LiveRegion` contiene un mensaje anterior, THE_SISTEMA SHALL reemplazar por completo el contenido anterior por el nuevo mensaje.
6. WHEN `useAnnouncer` anuncia y `speechEnabled` es verdadero, THE_SISTEMA SHALL emitir la voz con `speak(text, { rate: voiceRate })`.
7. WHILE `speechEnabled` es falso, THE_SISTEMA SHALL entregar el anuncio solo por `aria-live` sin emitir voz sintetizada.
8. WHERE el mensaje se marca como urgente, THE_SISTEMA SHALL usar `aria-live="assertive"`.
9. IF la Web Speech API no está disponible (`window.speechSynthesis` ausente), THEN THE_SISTEMA SHALL entregar el anuncio por `aria-live` sin lanzar ningún error y sin interrumpir el resto de anuncios.

### Requisito 9: Creación de partida en línea con código deletreable

**Historia de usuario:** Como persona ciega, quiero crear una partida en línea y obtener un código que pueda deletrear por teléfono sin ambigüedad, para invitar a otra persona a jugar conmigo.

#### Criterios de aceptación

1. WHEN una persona usuaria solicita crear una partida, THE_SERVIDOR SHALL generar una `OnlineGame` con una instancia `Chess` en la posición inicial y un código único.
2. WHEN THE_SERVIDOR genera un código, THE_SERVIDOR SHALL construirlo con el formato `PALABRA-PALABRA-NN`, donde cada `PALABRA` proviene de un diccionario curado en español de al menos 64 entradas y `NN` son dos dígitos en el rango `[1-9]`, sin incluir los caracteres confundibles `0`, `O`, `1`, `I` ni `L`. (Valida: Requisito P14)
3. IF un código generado colisiona con una partida activa, THEN THE_SERVIDOR SHALL regenerarlo hasta obtener uno único, con un máximo de 100 intentos por solicitud de creación. (Valida: Requisito P14)
4. IF THE_SERVIDOR agota los 100 intentos sin obtener un código único, THEN THE_SERVIDOR SHALL rechazar la creación devolviendo un error que indique que no se pudo asignar un código y SHALL no crear la `OnlineGame`. (Valida: Requisito P14)
5. WHEN se crea la partida, THE_SERVIDOR SHALL asignar al creador el color blancas (`w`) y enviarle un `playerId` secreto.
6. WHEN se crea la partida, THE_CLIENTE_EN_LINEA SHALL anunciar por `aria-live` y por voz, en español, la creación de la partida, el código y el estado de espera del rival.
7. THE_LOBBY SHALL mostrar y deletrear el código creado y SHALL ofrecer un control accesible por teclado y por lector de pantalla para copiar el enlace de la partida.
8. WHILE la partida está en estado `esperando-rival` y el rival no se une, THE_CLIENTE_EN_LINEA SHALL emitir un anuncio de espera al alcanzar 30 s, 60 s y luego cada 60 s de espera acumulada, y SHALL no emitir más de un anuncio de espera por cada uno de esos umbrales.

### Requisito 10: Unión a una partida por código o enlace

**Historia de usuario:** Como persona invitada, quiero unirme a una partida escribiendo el código o abriendo un enlace, para empezar a jugar aunque el código llegue con distinto formato.

#### Criterios de aceptación

1. WHEN una persona usuaria abre `/tablero/online/[codigo]` con un código válido de partida existente y con un solo participante, THE_SERVIDOR SHALL unir al segundo jugador, asignarle el color negras (`b`) y enviarle `playerId`, `fen` e `historial`.
2. WHEN el segundo jugador se une, THE_SERVIDOR SHALL notificar `opponent-joined` al creador, y ambos clientes SHALL anunciar su color y de quién es el turno.
3. WHEN THE_LOBBY recibe un código con mayúsculas, minúsculas, espacios iniciales o finales, o guiones intermedios variables, THE_LOBBY SHALL aplicarle `normalizarCodigo` antes de intentar unirse.
4. WHEN se aplica `normalizarCodigo` dos veces consecutivas a una misma entrada, THE_SERVIDOR SHALL producir un resultado idéntico al de aplicarla una sola vez. (Valida: Requisito P15)
5. WHEN dos entradas difieren únicamente en caja, en espacios iniciales o finales, o en la presencia de guiones, THE_SERVIDOR SHALL resolver ambas al mismo código normalizado y localizar la misma partida. (Valida: Requisito P15)
6. IF el código normalizado no corresponde a ninguna partida registrada, THEN THE_SERVIDOR SHALL responder `error("codigo-invalido")`, y THE_CLIENTE_EN_LINEA SHALL anunciar por voz y por `aria-live` un mensaje indicando que ese código de partida no existe y SHALL ofrecer un control accesible para crear una nueva partida.
7. IF el código normalizado corresponde a una partida ya finalizada o purgada por expiración, THEN THE_SERVIDOR SHALL responder `error("codigo-expirado")`, y THE_CLIENTE_EN_LINEA SHALL anunciar por voz y por `aria-live` un mensaje indicando que la partida ha caducado y SHALL ofrecer un control accesible para crear una nueva partida.
8. IF una tercera persona intenta unirse a una partida que ya tiene dos participantes, THEN THE_SERVIDOR SHALL responder `error("partida-llena")`, SHALL no alterar el estado de la partida existente, y THE_CLIENTE_EN_LINEA SHALL anunciar por voz y por `aria-live` que la partida ya tiene dos jugadores.

### Requisito 11: Sincronización de movimientos con estado autoritativo

**Historia de usuario:** Como jugador en línea, quiero que cada movimiento sea validado por el servidor y reflejado igual en ambos dispositivos, para que la partida sea coherente y sin trampas.

#### Criterios de aceptación

1. WHEN THE_CLIENTE_EN_LINEA intenta un movimiento, THE_CLIENTE_EN_LINEA SHALL enviarlo al servidor mediante un mensaje `move` y SHALL no aplicarlo al estado mostrado hasta recibir un `state-sync` autoritativo que confirme ese movimiento.
2. WHEN THE_SERVIDOR recibe un movimiento legal y en turno, THE_SERVIDOR SHALL aplicarlo a la instancia `Chess`, actualizar `fen`, `historial`, `turno` y `resultado`, y difundir `state-sync` a ambos clientes en un plazo máximo de 2 segundos desde la recepción del `move`.
3. WHEN ambos clientes procesan el mismo `state-sync`, THE_SISTEMA SHALL mostrar en ambos el mismo `fen`, `turno`, `historial` y `resultado` que el estado autoritativo. (Valida: Requisito P9)
4. WHEN THE_SERVIDOR determina jaque mate tras un movimiento, THE_SERVIDOR SHALL fijar `resultado = "jaque-mate"` y `ganador` con el color que movió.
5. WHEN THE_SERVIDOR determina tablas tras un movimiento, THE_SERVIDOR SHALL fijar `resultado = "tablas"`.
6. FOR ALL secuencias de mensajes `move` (legales, ilegales, fuera de turno o malformados), THE_SERVIDOR SHALL mantener el `fen` autoritativo como una posición alcanzable por movimientos legales desde la posición inicial. (Valida: Requisito P11)
7. IF THE_CLIENTE_EN_LINEA no recibe un `state-sync` que confirme un `move` enviado dentro de 5 segundos, THEN THE_CLIENTE_EN_LINEA SHALL descartar el movimiento pendiente, restaurar el estado mostrado al último `state-sync` autoritativo recibido y anunciar por `aria-live` y, si `speechEnabled` es verdadero, por voz en español, un mensaje indicando que el movimiento no fue confirmado.

### Requisito 12: Cumplimiento del turno

**Historia de usuario:** Como jugador en línea, quiero que el servidor rechace movimientos ilegales o fuera de turno y me lo anuncie, para jugar con reglas claras sin ambigüedad.

#### Criterios de aceptación

1. IF THE_SERVIDOR recibe un `move` cuyo color no coincide con el turno autoritativo, THEN THE_SERVIDOR SHALL responder `move-rejected("no-es-tu-turno")` y SHALL no alterar el `fen` autoritativo. (Valida: Requisito P10)
2. IF THE_SERVIDOR recibe un `move` ilegal según `chess.js`, THEN THE_SERVIDOR SHALL responder `move-rejected("movimiento-ilegal")` y SHALL no alterar el `fen` autoritativo.
3. IF THE_SERVIDOR recibe un `move` sobre una partida ya finalizada, THEN THE_SERVIDOR SHALL responder `move-rejected("partida-finalizada")` y SHALL no alterar el `fen` autoritativo.
4. WHEN THE_CLIENTE_EN_LINEA recibe un `move-rejected`, THE_CLIENTE_EN_LINEA SHALL anunciar por `aria-live` en español el motivo del rechazo dentro de 1 segundo desde la recepción y, si `speechEnabled` es verdadero, SHALL anunciarlo también por voz en español.
5. WHILE no es el turno de un jugador, THE_TABLERO en modo en línea SHALL presentarse para ese jugador como no interactivo, de modo que no reciba foco de teclado ni acepte entradas de movimiento.

### Requisito 13: Anuncio de cada evento de red

**Historia de usuario:** Como persona ciega jugando en línea, quiero que todos los eventos de la partida se anuncien por lector de pantalla y por voz en español, para seguir la partida sin ayuda vidente.

#### Criterios de aceptación

1. WHEN THE_CLIENTE_EN_LINEA recibe cualquiera de los eventos `opponent-joined`, `state-sync`, `move-rejected`, `draw-offered`, `opponent-disconnected`, `opponent-reconnected` u `opponent-abandoned`, THE_CLIENTE_EN_LINEA SHALL emitir por `aria-live`, dentro de 1 segundo desde la recepción, un anuncio en español de al menos un carácter no vacío y, si `speechEnabled` es verdadero, SHALL emitirlo también por voz en español. (Valida: Requisito P12)
2. WHEN el estado autoritativo recibido en un `state-sync` indica jaque, THE_CLIENTE_EN_LINEA SHALL anunciar la situación de jaque en español.
3. WHEN el estado autoritativo recibido en un `state-sync` indica jaque mate, THE_CLIENTE_EN_LINEA SHALL anunciar en español el jaque mate y el resultado de la partida.
4. WHEN cambia el turno tras un `state-sync`, THE_CLIENTE_EN_LINEA SHALL anunciar en español de quién es el turno mediante texto que nombre al jugador o al color en palabras, y SHALL no depender únicamente de una indicación por color.
5. WHEN THE_CLIENTE_EN_LINEA recibe una oferta de tablas del rival, THE_SISTEMA SHALL anunciarla por `aria-live="assertive"` en español y SHALL ofrecer las acciones de aceptar y de rechazar accesibles por teclado.
6. WHERE el reloj opcional está activo, THE_CLIENTE_EN_LINEA SHALL anunciar por `aria-live` en español la cuenta atrás cuando el tiempo restante de un jugador alcance los umbrales de 60 segundos, 30 segundos y 10 segundos.
7. WHEN THE_CLIENTE_EN_LINEA presenta el estado de red o el turno, THE_SISTEMA SHALL reflejarlo mediante texto legible por lector de pantalla además de cualquier indicación por color.

### Requisito 14: Ciclo de vida de conexión y recuperación

**Historia de usuario:** Como jugador en línea, quiero que las desconexiones se gestionen con reconexión y recuperación de estado, para no perder la partida ante cortes de red.

#### Criterios de aceptación

1. WHEN el WebSocket se cierra o no conecta, THE_CLIENTE_EN_LINEA SHALL pasar al estado `reconectando`, aplicar reintentos con backoff exponencial partiendo de 1 segundo hasta un máximo de 30 segundos entre intentos y un máximo de 10 intentos, y anunciar "Conexión perdida, reintentando".
2. IF THE_CLIENTE_EN_LINEA agota los 10 intentos de reconexión sin éxito, THEN THE_CLIENTE_EN_LINEA SHALL pasar al estado `desconectado` y anunciar por `aria-live` y por voz en español que no se pudo restablecer la conexión.
3. WHEN un participante se desconecta, THE_SERVIDOR SHALL notificar `opponent-disconnected` con un periodo de gracia de 60 segundos al rival, y THE_CLIENTE_EN_LINEA del rival SHALL anunciar la desconexión y la espera de reconexión.
4. WHEN THE_SERVIDOR recibe un `reconnect` con `codigo` y `playerId` válidos, THE_SERVIDOR SHALL reasociar el socket al participante, cancelar el temporizador de abandono y devolver un `state-sync` con el `fen`, `historial` y `turno` autoritativos exactos.
5. WHEN un jugador reconecta correctamente, THE_SERVIDOR SHALL notificar `opponent-reconnected` al rival, y ambos clientes SHALL anunciar el estado restaurado.
6. WHEN un jugador reconecta tras aplicar `N` medios movimientos, THE_SERVIDOR SHALL devolver un `state-sync` cuyo `fen` es idéntico carácter a carácter al previo a la caída y cuyo `historial` contiene exactamente `N` medios movimientos. (Valida: Requisito P13)
7. IF un participante desconectado supera el periodo de gracia de 60 segundos, THEN THE_SERVIDOR SHALL fijar `resultado = "abandono"`, emitir `opponent-abandoned` y THE_CLIENTE_EN_LINEA SHALL anunciar el fin de la partida por abandono.
8. THE_ALMACENAMIENTO SHALL persistir opcionalmente el último `codigo` y `playerId` bajo la clave `once-chess.last-online-game.v1` para ofrecer "Reconectar a la última partida".
9. IF llega una reconexión con el mismo `playerId` mientras existe una sesión activa para ese jugador, THEN THE_SERVIDOR SHALL cerrar el socket anterior y asociar el nuevo, manteniendo una sola sesión por jugador.

### Requisito 15: Acciones de partida en línea

**Historia de usuario:** Como jugador en línea, quiero rendirme, ofrecer tablas y aceptar o rechazar tablas por teclado, para gestionar el desenlace de la partida de forma accesible.

#### Criterios de aceptación

1. WHEN un jugador solicita rendirse con su `playerId` válido, THE_SERVIDOR SHALL fijar `resultado = "rendicion"` con el rival como ganador y difundir el estado a ambos clientes.
2. WHEN un jugador ofrece tablas, THE_SERVIDOR SHALL registrar la oferta como pendiente y notificar `draw-offered` al rival indicando el color que la ofreció.
3. IF ya existe una oferta de tablas pendiente cuando un jugador intenta ofrecer tablas de nuevo, THEN THE_SERVIDOR SHALL no registrar una segunda oferta y SHALL mantener la oferta pendiente vigente.
4. WHEN el rival acepta las tablas, THE_SERVIDOR SHALL fijar `resultado = "tablas"` y difundir el estado a ambos clientes.
5. WHEN el rival rechaza las tablas, THE_SERVIDOR SHALL eliminar la oferta pendiente, notificar `draw-declined` y mantener la partida en curso sin cambiar el turno.
6. THE_SISTEMA SHALL exponer los controles de rendición y de tablas con `aria-label` descriptivos y activables por teclado sin necesidad de ratón.

### Requisito 16: Validación y seguridad del servidor

**Historia de usuario:** Como responsable del servicio, quiero que el servidor no confíe en el cliente y resista abusos, para garantizar partidas íntegras y proteger el servicio.

#### Criterios de aceptación

1. WHEN THE_SERVIDOR recibe un mensaje de cliente, THE_SERVIDOR SHALL validar su forma y campos contra la unión discriminada por `type` y el `codigo` conocido antes de procesarlo.
2. IF un mensaje entrante está malformado, THEN THE_SERVIDOR SHALL descartarlo, responder `error` y SHALL no mutar el estado autoritativo. (Valida: Requisito P11)
3. THE_SERVIDOR SHALL decidir la legalidad de cada movimiento exclusivamente con `chess.js` del lado del servidor, sin confiar en la legalidad reportada por el cliente.
4. WHEN una acción de mover, rendirse, ofrecer o aceptar tablas o reconectar se recibe, THE_SERVIDOR SHALL autorizarla solo si el `playerId` corresponde a un participante de la partida; en caso contrario SHALL responder `error("no-autorizado")`.
5. THE_SERVIDOR SHALL no enviar el `playerId` de un jugador al jugador rival.
6. THE_SERVIDOR SHALL aplicar limitación de frecuencia de como máximo 5 mensajes `join` o `reconnect` por conexión o IP cada 10 segundos para frenar intentos de adivinado del código por fuerza bruta.
7. THE_SERVIDOR SHALL aplicar limitación de frecuencia de como máximo 20 mensajes `move`, `create` o `join` por conexión cada 10 segundos para mitigar abuso y denegación de servicio.
8. WHEN una partida finaliza o permanece inactiva durante 30 minutos, THE_SERVIDOR SHALL purgarla del registro para invalidar su código.
9. WHERE se admite chat de texto, THE_SISTEMA SHALL tratar el texto como texto plano sin interpretar HTML y SHALL limitar cada mensaje a un máximo de 500 caracteres.
```
