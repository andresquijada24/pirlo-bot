# Paso al servidor real del club

Lista para llevar PIRLO BOT del servidor de pruebas al servidor real de un club. Cada paso que
publica o registra algo en un servidor real necesita la aprobación explícita del dueño (regla 8 y
9 de CLAUDE.md). El servidor de referencia (853894813169614848) nunca se usa sin autorización.

## 1. Antes de empezar

- [ ] CI en verde en `main` y el último despliegue de Vercel en estado *Ready*.
- [ ] `/club sincronizacion` en el servidor de pruebas dice «✅ Correcta».
- [ ] Probado en el servidor de pruebas: `/convocatoria crear`, botones, `/alineacion publicar`,
      un recordatorio real y `/convocatoria cancelar`.

## 2. Invitar el bot al servidor real

- [ ] Un admin del servidor real abre el enlace de invitación de la web (permisos: ver canales,
      enviar mensajes, insertar enlaces, leer historial). No necesita permisos de administrador.
- [ ] En ese servidor, `/club conectar identificador: <slug>` (ejecutado por un admin del club que
      además gestione el servidor). El club conserva plantilla, estadísticas y temporadas.

## 3. Registrar los comandos allí

- [ ] El dueño añade el ID del servidor real a la variable de GitHub `DISCORD_CLUB_GUILD_IDS`
      (*Settings → Secrets and variables → Actions → Variables*). Es su aprobación explícita.
- [ ] *Actions → Registrar comandos de Discord → Run workflow*. El workflow rechaza el servidor de
      referencia aunque esté en la lista.

## 4. Configurar el club en el servidor real

- [ ] `/club canal` para Convocatorias (y Recordatorios, Anuncios… si se usan).
- [ ] `/club zona` si el club no juega con hora de Caracas.
- [ ] `/club recordatorios minutos: 60` solo cuando el club quiera avisos automáticos.
- [ ] Cada jugador: `/vincular` con su gamertag de maritimo.app; un DT o admin aprueba con
      `/solicitudes`.

## 5. Cerrar el servidor de pruebas para ese club

- [ ] Desde el servidor de pruebas, un admin del club ejecuta `/club desconectar`. Así quien
      gestiona el servidor de pruebas deja de ser admin del club (ver PERMISSIONS.md).

## Vuelta atrás

- Quitar el ID de `DISCORD_CLUB_GUILD_IDS` y volver a registrar comandos deja de añadirlos, pero
  los ya registrados en ese servidor se quitan desde Discord (*Configuración del servidor →
  Integraciones → PIRLO BOT*) o expulsando el bot.
- `/club recordatorios minutos: 0` detiene cualquier publicación automática al instante.
