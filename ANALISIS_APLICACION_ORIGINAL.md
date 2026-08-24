# Análisis de la aplicación entregada — base de SR Contenidos

## Estructura detectada

La versión original tenía `app.js` como interfaz y `server.js` como servidor/API. También incluía PWA, Docker, Render y una capa Electron para escritorio.

## Funcionalidades verificadas en el código

- Login administrador/cliente mediante Supabase Auth cuando estaba configurado.
- Dashboard con clientes activos, reels publicados/pendientes, saldos y alertas de publicaciones.
- Clientes: alta y edición, rubro/categoría, plan, precio, estado, notas y color.
- Detalle de cliente: pagos, progreso, reels y creación de reel.
- Contenidos/Reels: estados desde Idea hasta Publicado y aprobación cliente.
- Calendario: actividades por día, franjas mañana/tarde, crear/editar/eliminar y eventos automáticos al programar publicaciones.
- Cobros: registrar pagos y calcular saldo.
- Mensajes: conversaciones por cliente y marcado como leído.
- Estadísticas: cargar captura, OCR con Tesseract y guardar mediciones.
- Portafolio: vista preparada para trabajos publicados.
- Planes: crear/editar planes.
- Configuración: estado de Supabase y tema día/noche.

## Problemas estructurales encontrados

1. SQLite seguía formando parte de la arquitectura y almacenaba usuarios/sesiones y, como fallback, todos los datos de negocio.
2. `SUPABASE_DATA_ENABLED` permitía que la aplicación cambiara entre Supabase y SQLite. Para una app definitiva eso es una fuente de estados inconsistentes.
3. Los planes se guardaban exclusivamente en SQLite incluso en el modo Supabase. Esto significaba que un plan modificado no era realmente global en la nube.
4. Las sesiones web dependían de una tabla SQLite local del servidor (`sessions`). En un despliegue web esto agrega un estado de servidor que no hace falta.
5. La aplicación original dependía de la API Node para cada operación de datos, con conversiones entre modelos SQLite y Supabase.
6. El frontend recibía datos ya transformados por el servidor, de modo que existían dos modelos de almacenamiento y mapeos distintos.
7. La captura de estadísticas se almacenaba como archivo local solamente en el fallback SQLite; no era un activo de nube.

## Corrección aplicada en SR Contenidos 2.0

- Supabase Auth administra las sesiones directamente en el navegador.
- PostgreSQL/Supabase es la fuente única para clientes, planes, reels, estadísticas, pagos, calendario y mensajes.
- Se crean tablas nuevas `sr20_*`, de modo que la app 2.0 no rompe las tablas de la versión anterior.
- RLS de Supabase controla el aislamiento administrador/cliente.
- Los cambios del frontend se leen y escriben directamente en Supabase y luego se vuelve a cargar desde la nube.
- El servidor Node ya no contiene una base SQLite.
- La `service_role` existe únicamente en el servidor y se usa para crear de forma segura cuentas de clientes.
- Una instalación local puede funcionar con `npm start`, pero sigue usando la misma nube: no crea una base de datos local separada.
- Render queda preparado como despliegue web definitivo.

## Resultado esperado

Una misma URL puede utilizarse desde notebook, PC, tablet o teléfono y todos ven los mismos datos porque la persistencia está en Supabase.
