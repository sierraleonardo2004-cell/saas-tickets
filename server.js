const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- Configuración ----
// En Azure App Service (Linux): DATA_DIR=/home/data y JWT_SECRET=<texto largo aleatorio>
const DATA_DIR = process.env.DATA_DIR || __dirname;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar";
if (!process.env.JWT_SECRET) {
    console.warn("AVISO: define JWT_SECRET en las variables de entorno (producción).");
}
const ESTADOS = ["abierto", "en_progreso", "cerrado"];

// ---- Base de datos (SQLite en un archivo; persiste en DATA_DIR) ----
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'abierto',
    user_id INTEGER NOT NULL REFERENCES users(id),
    creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    completada INTEGER NOT NULL DEFAULT 0,
    asignado_a INTEGER REFERENCES users(id),
    creado TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Utilidades ----
const texto = (v, max) => String(v || "").trim().slice(0, max);

function auth(req, res, next) {
    const cabecera = req.headers.authorization || "";
    const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Falta el token" });
    try {
        req.user = jwt.verify(token, JWT_SECRET); // { id, nombre }
        next();
    } catch (e) {
        res.status(401).json({ error: "Token inválido o vencido" });
    }
}

// Devuelve el ticket solo si pertenece al usuario autenticado
function ticketDelUsuario(ticketId, userId) {
    return db
        .prepare("SELECT * FROM tickets WHERE id = ? AND user_id = ?")
        .get(ticketId, userId);
}

// ---- Auth ----
app.post("/auth/register", (req, res) => {
    const nombre = texto(req.body.nombre, 50);
    const email = texto(req.body.email, 100).toLowerCase();
    const password = String(req.body.password || "");

    if (!nombre || !email || password.length < 6) {
        return res
            .status(400)
            .json({ error: "Nombre, email y contraseña (mínimo 6 caracteres) son obligatorios" });
    }
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
        return res.status(409).json({ error: "Ese email ya está registrado" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = db
        .prepare("INSERT INTO users (nombre, email, password_hash) VALUES (?, ?, ?)")
        .run(nombre, email, hash);

    res.status(201).json({ id: info.lastInsertRowid, nombre, email });
});

app.post("/auth/login", (req, res) => {
    const email = texto(req.body.email, 100).toLowerCase();
    const password = String(req.body.password || "");

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: "Email o contraseña incorrectos" });
    }

    const token = jwt.sign({ id: user.id, nombre: user.nombre }, JWT_SECRET, { expiresIn: "8h" });
    res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email } });
});

// ---- Tickets (solo ve y modifica los suyos) ----
app.get("/tickets", auth, (req, res) => {
    const filas = db
        .prepare(
            `SELECT t.*,
                (SELECT COUNT(*) FROM tareas WHERE ticket_id = t.id) AS total_tareas,
                (SELECT COUNT(*) FROM tareas WHERE ticket_id = t.id AND completada = 1) AS tareas_completadas
             FROM tickets t WHERE t.user_id = ? ORDER BY t.id DESC`
        )
        .all(req.user.id);
    res.json(filas);
});

app.post("/tickets", auth, (req, res) => {
    const titulo = texto(req.body.titulo, 100);
    const descripcion = texto(req.body.descripcion, 1000);
    if (!titulo) return res.status(400).json({ error: "El título es obligatorio" });

    const info = db
        .prepare("INSERT INTO tickets (titulo, descripcion, user_id) VALUES (?, ?, ?)")
        .run(titulo, descripcion, req.user.id);
    res.status(201).json(db.prepare("SELECT * FROM tickets WHERE id = ?").get(info.lastInsertRowid));
});

app.patch("/tickets/:id", auth, (req, res) => {
    const ticket = ticketDelUsuario(req.params.id, req.user.id);
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    const estado = req.body.estado !== undefined ? req.body.estado : ticket.estado;
    if (!ESTADOS.includes(estado)) {
        return res.status(400).json({ error: "Estado válido: " + ESTADOS.join(", ") });
    }
    const titulo = req.body.titulo !== undefined ? texto(req.body.titulo, 100) : ticket.titulo;
    const descripcion =
        req.body.descripcion !== undefined ? texto(req.body.descripcion, 1000) : ticket.descripcion;
    if (!titulo) return res.status(400).json({ error: "El título no puede quedar vacío" });

    db.prepare("UPDATE tickets SET titulo = ?, descripcion = ?, estado = ? WHERE id = ?").run(
        titulo,
        descripcion,
        estado,
        ticket.id
    );
    res.json(db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id));
});

app.delete("/tickets/:id", auth, (req, res) => {
    const ticket = ticketDelUsuario(req.params.id, req.user.id);
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
    db.prepare("DELETE FROM tickets WHERE id = ?").run(ticket.id); // borra sus tareas (CASCADE)
    res.status(204).end();
});

// ---- Tareas de un ticket ----
app.get("/tickets/:id/tareas", auth, (req, res) => {
    const ticket = ticketDelUsuario(req.params.id, req.user.id);
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json(db.prepare("SELECT * FROM tareas WHERE ticket_id = ? ORDER BY id").all(ticket.id));
});

app.post("/tickets/:id/tareas", auth, (req, res) => {
    const ticket = ticketDelUsuario(req.params.id, req.user.id);
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    const titulo = texto(req.body.titulo, 100);
    if (!titulo) return res.status(400).json({ error: "El título es obligatorio" });

    // Por defecto la tarea queda asignada a quien la crea
    let asignado = req.user.id;
    if (req.body.asignado_a !== undefined && req.body.asignado_a !== null) {
        const u = db.prepare("SELECT id FROM users WHERE id = ?").get(req.body.asignado_a);
        if (!u) return res.status(400).json({ error: "El usuario asignado no existe" });
        asignado = u.id;
    }

    const info = db
        .prepare("INSERT INTO tareas (ticket_id, titulo, asignado_a) VALUES (?, ?, ?)")
        .run(ticket.id, titulo, asignado);
    res.status(201).json(db.prepare("SELECT * FROM tareas WHERE id = ?").get(info.lastInsertRowid));
});

app.patch("/tareas/:id", auth, (req, res) => {
    const tarea = db
        .prepare(
            `SELECT ta.* FROM tareas ta
             JOIN tickets t ON t.id = ta.ticket_id
             WHERE ta.id = ? AND t.user_id = ?`
        )
        .get(req.params.id, req.user.id);
    if (!tarea) return res.status(404).json({ error: "Tarea no encontrada" });

    const completada =
        req.body.completada !== undefined ? (req.body.completada ? 1 : 0) : tarea.completada;
    const titulo = req.body.titulo !== undefined ? texto(req.body.titulo, 100) : tarea.titulo;
    if (!titulo) return res.status(400).json({ error: "El título no puede quedar vacío" });

    db.prepare("UPDATE tareas SET titulo = ?, completada = ? WHERE id = ?").run(
        titulo,
        completada,
        tarea.id
    );
    res.json(db.prepare("SELECT * FROM tareas WHERE id = ?").get(tarea.id));
});

// Ruta de salud (Azure / Render)
app.get("/salud", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Servidor corriendo en puerto " + port));
