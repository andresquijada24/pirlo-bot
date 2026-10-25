# Permisos y roles

Implementado en `src/core/permissions/`. Toda operación de los servicios (`src/core/*/service.ts`)
comprueba el permiso antes de tocar datos.

## Roles del club

`admin` > `dt` > `capitan` > `jugador`

Quien tiene **Gestionar servidor** en Discord actúa como `admin` de los clubes vinculados a ese
servidor. Así un servidor nunca queda bloqueado si su club se queda sin admins.

## Matriz de acciones

| Acción | Quién puede |
| --- | --- |
| Ver club, estadísticas (`/stats`) y rankings (`/ranking`), solicitar unirse | Cualquier persona del servidor |
| Ver plantilla, responder convocatorias | Miembros del club |
| Registrar resultados, gestionar convocatorias y calendario | Capitán o superior |
| Gestionar plantilla, aprobar solicitudes, asignar roles, vincular gamertags, alineaciones, corregir estadísticas, ver el estado de la sincronización | DT o superior |
| Temporadas, configuración del club (canales), sincronización | Admin |
| Registrar un club | Gestor del servidor de Discord |

## Reglas para gestionar a otros miembros

- Un admin puede gestionar y nombrar a cualquiera.
- El resto solo gestiona a miembros de **rango inferior** y solo otorga **roles inferiores** al
  suyo (un DT puede nombrar capitanes, pero no DT ni admins).
- El club **nunca se queda sin admin**: no se puede degradar ni dar de baja al último.
- Cada jugador puede editar sus propias posiciones.

## Aislamiento entre clubes

1. El club se resuelve **solo entre los clubes vinculados al servidor** donde se ejecuta el
   comando. Desde un servidor no se puede operar sobre un club de otro.
2. Todo método de repositorio recibe `clubId` y filtra por él. Un id de otro club da
   "no encontrado".
3. En la base de datos, las claves foráneas compuestas `(club_id, id)` impiden enlazar filas de
   clubes distintos.
4. Las operaciones de varias tablas (registrar club, aprobar vinculación, crear temporada) son
   funciones de Postgres atómicas que solo puede ejecutar el servidor del bot.

## Varios servidores por club

Un club puede estar conectado a más de un servidor (`/club conectar`), por ejemplo el de pruebas y
el real. Quien tiene "Gestionar servidor" en CUALQUIERA de ellos actúa como admin del club. Por
eso, al pasar al servidor real, conviene desconectar el de pruebas con `/club desconectar`
(ejecutado desde ese servidor; exige ser admin del club, no basta con gestionar el servidor).
