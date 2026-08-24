# SR Contenidos 2.0

Nueva aplicación independiente basada en la lógica de SR Contenidos, pero con una arquitectura web distinta:

- Supabase es la fuente única de los datos de negocio.
- No usa SQLite para clientes, reels, calendario, pagos, estadísticas, mensajes ni planes.
- La autenticación usa Supabase Auth.
- RLS aísla los clientes entre sí.
- La notebook puede ejecutar una copia local que se conecta a la misma nube.
- La misma URL funciona desde PC, notebook, tablet y teléfono.
- `SUPABASE_SERVICE_ROLE_KEY` existe únicamente en el servidor para crear accesos de clientes y asegurar el administrador.

## Qué conserva

Dashboard, Clientes, detalle de cliente, Contenidos/Reels, Calendario por día y franjas, Cobros, Mensajes, Estadísticas con captura + OCR, Portafolio, Planes editables y modo día/noche.

## Arquitectura

Navegador → Supabase Auth + Supabase REST (datos)\nNavegador → servidor Node solo para archivos/configuración y creación segura de usuarios cliente\nSupabase → PostgreSQL + RLS + Auth

## Configuración única

1. Abrí Supabase SQL Editor.
2. Pegá todo `supabase/schema.sql` y ejecutalo una vez.
3. En Supabase verificá Auth → Providers → Email habilitado.
4. En Render o en tu servidor configurá las variables del `.env.example`.
5. No publiques nunca `SUPABASE_SERVICE_ROLE_KEY` en el frontend.
6. Deployá el proyecto con Render usando `render.yaml` o Dockerfile.

En el primer arranque, el servidor intenta crear/asegurar el administrador indicado por `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

## Local

Copiá `.env.example` a `.env`, completalo y ejecutá:

```bash
npm start
```

Abrí `http://localhost:3000`. Los datos que cargues allí se guardan en la misma nube de Supabase.

## Cliente

Desde la ficha de un cliente se puede crear su acceso con correo + contraseña. Esa operación pasa por el servidor, donde se usa la service role de Supabase sin exponerla al navegador.
