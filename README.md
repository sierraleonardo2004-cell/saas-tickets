# Tickets y Tareas (SaaS)

Sistema de gestión de tickets de soporte y tareas, construido sobre el Chat de la clase.
Node.js + Express + SQLite. Frontend y API se sirven desde el mismo servidor.

## Cumplimiento del proyecto
| Requisito | Dónde está |
|---|---|
| Adaptar el sistema base (Chat) | Mismo stack Express + `public/index.html`; los mensajes pasaron a tickets y tareas |
| Modelos nuevos (Tickets, Tareas) | Tablas `tickets` y `tareas` (más `users`) en `server.js` |
| Login y registro funcional | `POST /auth/register`, `POST /auth/login` (JWT + contraseñas cifradas) |
| Mínimo 3 endpoints y 2 modelos | 10 endpoints y 3 modelos (ver abajo) |
| Modificar endpoints y frontend | API nueva y `public/index.html` nuevo |
| Despliegue en la nube | Azure App Service o Render (ver abajo) |

## Ejecutar en local
    npm install
    npm start
    # abrir http://localhost:3000

## Endpoints
Públicos:
- POST /auth/register   { nombre, email, password }
- POST /auth/login      { email, password } -> { token, user }
- GET  /salud

Requieren `Authorization: Bearer <token>` (cada usuario solo ve lo suyo):
- GET    /tickets
- POST   /tickets            { titulo, descripcion }
- PATCH  /tickets/:id        { titulo?, descripcion?, estado? }  (abierto | en_progreso | cerrado)
- DELETE /tickets/:id
- GET    /tickets/:id/tareas
- POST   /tickets/:id/tareas { titulo, asignado_a? }
- PATCH  /tareas/:id         { titulo?, completada? }

## Variables de entorno
- `JWT_SECRET`  texto largo y aleatorio (obligatorio en producción)
- `DATA_DIR`    carpeta donde se guarda `app.db` (en Azure: `/home/data`)
- `PORT`        lo inyecta la plataforma

## Despliegue en Azure App Service (Linux)
1. Crear un App Service: Runtime Node 20, Linux.
2. Desde esta carpeta:
       az webapp up --name <nombre-unico> --runtime "NODE:20-lts" --sku B1 --location brazilsouth
3. En Configuración > Variables de entorno agregar:
       DATA_DIR=/home/data
       JWT_SECRET=<texto largo aleatorio>
       SCM_DO_BUILD_DURING_DEPLOYMENT=true
4. Abrir https://<nombre-unico>.azurewebsites.net, registrarse y probar.

## Despliegue en Render
1. Subir el proyecto a GitHub.
2. New > Web Service, conectar el repositorio.
   - Build Command: `npm install`
   - Start Command: `npm start`
3. En Environment agregar `JWT_SECRET`.
4. Importante: en el plan gratuito el disco se borra en cada reinicio o despliegue,
   por lo que los datos de SQLite se perderían. Para conservarlos, agrega un Disk
   (plan de pago) montado en `/var/data` y define `DATA_DIR=/var/data`.
