const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.SECRET || 'gmao-secret-2025-change-me';
const PORT = process.env.PORT || 3000;

let db = {
  users: [{ id: 1, name: 'Administrateur', username: 'admin', pass: bcrypt.hashSync('1234', 10), role: 'admin' }],
  machines: [
    { id: 1, name: 'Compresseur C-01', loc: 'Atelier A', st: 'running' },
    { id: 2, name: 'Convoyeur CV-02', loc: 'Ligne 1', st: 'running' }
  ],
  wos: [],
  parts: [
    { id: 1, name: 'Roulement SKF 6205', qty: 12, min: 5, loc: 'Magasin A' },
    { id: 2, name: 'Filtre a huile F-200', qty: 3, min: 5, loc: 'Magasin B' }
  ]
};

const app = express();
app.use(express.json());
app.use(express.static('public'));

function auth(req, res, next) {
  const h = req.headers.authorization;
  const t = h && h.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'Non connecte' });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expiree' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role === 'admin') next();
  else res.status(403).json({ error: 'Acces admin uniquement' });
}

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// ---- LOGIN ----
app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const u = db.users.find(x => x.username.toLowerCase() === username);
  if (!u || !bcrypt.compareSync(String(req.body.pass || ''), u.pass))
    return res.status(401).json({ error: 'Utilisateur ou mot de passe incorrect' });
  const token = jwt.sign({ id: u.id, name: u.name, role: u.role }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
});

// ---- ME ----
app.get('/api/me', auth, (req, res) => {
  const u = db.users.find(x => x.id === req.user.id);
  if (!u) return res.status(401).json({ error: 'Compte supprime' });
  res.json({ id: u.id, name: u.name, role: u.role });
});

// ---- REGISTER ----
app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const pass = String(req.body.pass || '');
  if (!name || !username || pass.length < 4)
    return res.status(400).json({ error: 'Champs invalides (mot de passe min. 4 caracteres)' });
  if (db.users.find(u => u.username.toLowerCase() === username))
    return res.status(409).json({ error: "Ce nom d'utilisateur existe deja" });
  db.users.push({ id: Date.now(), name, username, pass: bcrypt.hashSync(pass, 10), role: 'tech' });
  res.json({ ok: true, message: 'Compte cree avec succes ! Vous pouvez vous connecter.' });
});

// ---- USERS ----
app.get('/api/users', auth, adminOnly, (req, res) =>
  res.json(db.users.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role }))));

app.put('/api/users/:id/role', auth, adminOnly, (req, res) => {
  const u = db.users.find(x => x.id == req.params.id);
  if (!u) return res.status(404).json({ error: 'Introuvable' });
  if (u.id === 1) return res.status(403).json({ error: 'Compte principal protege' });
  if (!['admin', 'tech'].includes(req.body.role)) return res.status400).json({ error: 'Role invalide' });
  u.role = req.body.role;
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (req.params.id == 1) return res.status(403).json({ error: 'Compte principal protege' });
  const before = db.users.length;
  db.users = db.users.filter(u => u.id != req.params.id);
  if (db.users.length === before) return res.status(404).json({ error: 'Introuvable' });
  res.json({ ok: true });
});

// ---- MACHINES ----
app.get('/api/machines', auth, (req, res) => res.json(db.machines));

app.post('/api/machines', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  db.machines.push({ id: Date.now(), name, loc: String(req.body.loc || '').trim(), st: 'running' });
  res.json(db.machines);
});

app.put('/api/machines/:id/toggle', auth, (req, res) => {
  const m = db.machines.find(x => x.id == req.params.id);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });
  m.st = m.st === 'running' ? 'stopped' : 'running';
  res.json(m);
});

// ---- WORK ORDERS ----
app.get('/api/wos', auth, (req, res) => res.json(db.wos));

app.post('/api/wos', auth, (req, res) => {
  const desc = String(req.body.desc || '').trim();
  if (!desc) return res.status(400).json({ error: 'Description requise' });
  const wo = {
    id: db.wos.reduce((m, w) => Math.max(m, w.id), 0) + 1,
    machine: req.body.machine || '',
    desc,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    prio: ['high', 'med', 'low'].includes(req.body.prio) ? req.body.prio : 'med',
    st: 'open', end: null, by: req.user.name
  };
  db.wos.push(wo);
  const m = db.machines.find(x => x.name === wo.machine);
  if (m) m.st = 'stopped';
  res.json(wo);
});

app.put('/api/wos/:id/advance', auth, (req, res) => {
  const w = db.wos.find(x => x.id == req.params.id);
  if (!w) return res.status(404).json({ error: 'OT introuvable' });
  if (w.st === 'open') w.st = 'progress';
  else if (w.st === 'progress') {
    w.st = 'done';
    w.end = new Date().toISOString().slice(0, 10);
    const otherOpen = db.wos.some(x => x.machine === w.machine && x.st !== 'done' && x.id !== w.id);
    if (!otherOpen) {
      const m = db.machines.find(x => x.name === w.machine);
      if (m) m.st = 'running';
    }
  } else return res.status(400).json({ error: 'OT deja termine' });
  res.json(w);
});

app.delete('/api/wos/:id', auth, (req, res) => {
  db.wos = db.wos.filter(w => w.id != req.params.id);
  res.json({ ok: true });
});

// ---- PARTS ----
app.get('/api/parts', auth, (req, res) => res.json(db.parts));

app.post('/api/parts', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  db.parts.push({
    id: Date.now(), name,
    qty: Math.max(0, parseInt(req.body.qty) || 0),
    min: Math.max(0, parseInt(req.body.min) || 0),
    loc: String(req.body.loc || '').trim()
  });
  res.json(db.parts);
});

app.put('/api/parts/:id/:delta', auth, (req, res) => {
  const p = db.parts.find(x => x.id == req.params.id);
  if (!p) return res.status(404).json({ error: 'Piece introuvable' });
  p.qty = Math.max(0, p.qty + parseInt(req.params.delta));
  res.json(p);
});

app.listen(PORT, () => console.log('GMAO OK - port ' + PORT + ' | admin/1234'));
