const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gie-taxi-taxi-senegal-2026-secret-key';

// ── MIDDLEWARE ──
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH MIDDLEWARE ──
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}
function staffOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role === 'membre') return res.status(403).json({ error: 'Accès refusé' });
    next();
  });
}
function dirOnly(req, res, next) {
  auth(req, res, () => {
    if (!['directeur','president'].includes(req.user.role)) return res.status(403).json({ error: 'Réservé directeur' });
    next();
  });
}

// ══════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════
app.post('/api/login', (req, res) => {
  const { telephone, pin } = req.body;
  // Staff login
  const staff = db.prepare('SELECT * FROM staff WHERE username=? AND actif=1').get(telephone);
  if (staff && bcrypt.compareSync(pin, staff.pin_hash)) {
    const token = jwt.sign({ id: staff.id, role: staff.role, nom: staff.nom, type: 'staff' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token, user: { id: staff.id, role: staff.role, nom: staff.nom, type: 'staff' } });
  }
  // Member login
  const membre = db.prepare('SELECT * FROM membres WHERE (telephone=? OR tel2=?) AND statut != "exclu"').get(telephone, telephone);
  if (membre && bcrypt.compareSync(pin, membre.pin_hash)) {
    const token = jwt.sign({ id: membre.id, role: 'membre', nom: membre.prenom + ' ' + membre.nom, membre_id: membre.id, type: 'membre' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token, user: { id: membre.id, role: 'membre', nom: membre.prenom + ' ' + membre.nom, membre_id: membre.id, type: 'membre' } });
  }
  res.status(401).json({ error: 'Numéro ou PIN incorrect' });
});

app.post('/api/change-pin', auth, (req, res) => {
  const { old_pin, new_pin } = req.body;
  if (req.user.type === 'membre') {
    const m = db.prepare('SELECT * FROM membres WHERE id=?').get(req.user.id);
    if (!m || !bcrypt.compareSync(old_pin, m.pin_hash)) return res.status(400).json({ error: 'Ancien PIN incorrect' });
    db.prepare('UPDATE membres SET pin_hash=? WHERE id=?').run(bcrypt.hashSync(new_pin, 10), req.user.id);
  } else {
    const s = db.prepare('SELECT * FROM staff WHERE id=?').get(req.user.id);
    if (!s || !bcrypt.compareSync(old_pin, s.pin_hash)) return res.status(400).json({ error: 'Ancien PIN incorrect' });
    db.prepare('UPDATE staff SET pin_hash=? WHERE id=?').run(bcrypt.hashSync(new_pin, 10), req.user.id);
  }
  res.json({ ok: true });
});

// ══════════════════════════════════════
// MEMBRES
// ══════════════════════════════════════
app.get('/api/membres', auth, (req, res) => {
  const membres = db.prepare('SELECT id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes FROM membres ORDER BY nom,prenom').all();
  // Attach cotisations summary
  const result = membres.map(m => {
    const cots = db.prepare('SELECT mois, SUM(montant) as montant FROM cotisations WHERE membre_id=? AND mois LIKE "% 2026" OR mois IN ("Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre") GROUP BY mois').all(m.id);
    // Simpler: all 2026 cotisations
    const cots2026 = db.prepare("SELECT mois, SUM(montant) as montant FROM cotisations WHERE membre_id=? AND mois NOT LIKE '%2025%' GROUP BY mois").all(m.id);
    const cotMap = {};
    let total = 0;
    cots2026.forEach(c => { cotMap[c.mois] = c.montant; total += c.montant; });
    const moisPayes = cots2026.length;
    const moisRestants = Math.max(0, 12 - moisPayes);
    return { ...m, cotisations_2026: cotMap, total_2026: total, mois_payes: moisPayes, mois_restants: moisRestants };
  });
  res.json(result);
});

app.get('/api/membres/:id', auth, (req, res) => {
  const m = db.prepare('SELECT id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes FROM membres WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Membre introuvable' });
  const cots = db.prepare("SELECT mois, SUM(montant) as montant FROM cotisations WHERE membre_id=? AND mois NOT LIKE '%2025%' GROUP BY mois").all(m.id);
  const cotMap = {}; let total = 0;
  cots.forEach(c => { cotMap[c.mois] = c.montant; total += c.montant; });
  const hist = db.prepare('SELECT * FROM cotisations WHERE membre_id=? ORDER BY created_at DESC LIMIT 24').all(m.id);
  res.json({ ...m, cotisations_2026: cotMap, total_2026: total, mois_payes: cots.length, mois_restants: Math.max(0,12-cots.length), historique_cotisations: hist });
});

app.post('/api/membres', dirOnly, (req, res) => {
  const { prenom, nom, telephone, tel2, taxi, adhesion, statut, notes } = req.body;
  if (!prenom || !nom || !telephone) return res.status(400).json({ error: 'Prénom, Nom, Téléphone requis' });
  const defaultPin = bcrypt.hashSync('1234', 10);
  try {
    const result = db.prepare('INSERT INTO membres (prenom,nom,telephone,tel2,taxi,adhesion,statut,notes,pin_hash) VALUES (?,?,?,?,?,?,?,?,?)').run(prenom.toUpperCase(), nom.toUpperCase(), telephone, tel2||'', taxi||'', adhesion||'', statut||'actif', notes||'', defaultPin);
    res.json({ ok: true, id: result.lastInsertRowid, message: 'Membre créé. PIN par défaut: 1234' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ce numéro de téléphone existe déjà' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/membres/:id', staffOnly, (req, res) => {
  const { prenom, nom, telephone, tel2, taxi, adhesion, statut, notes } = req.body;
  db.prepare('UPDATE membres SET prenom=?,nom=?,telephone=?,tel2=?,taxi=?,adhesion=?,statut=?,notes=?,updated_at=datetime("now") WHERE id=?').run(
    prenom?.toUpperCase(), nom?.toUpperCase(), telephone, tel2||'', taxi||'', adhesion||'', statut||'actif', notes||'', req.params.id
  );
  res.json({ ok: true });
});

app.patch('/api/membres/:id/statut', staffOnly, (req, res) => {
  const { statut } = req.body;
  db.prepare('UPDATE membres SET statut=?,updated_at=datetime("now") WHERE id=?').run(statut, req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════
// COTISATIONS
// ══════════════════════════════════════
app.get('/api/cotisations', auth, (req, res) => {
  const mois = req.query.mois;
  let query = 'SELECT c.*,m.prenom,m.nom,m.telephone FROM cotisations c JOIN membres m ON c.membre_id=m.id';
  let params = [];
  if (mois) { query += ' WHERE c.mois=?'; params.push(mois); }
  query += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/cotisations', staffOnly, (req, res) => {
  const { membre_id, mois, montant, mode, date, note } = req.body;
  if (!membre_id || !mois || !montant) return res.status(400).json({ error: 'Données manquantes' });
  const ref = genRef();
  const result = db.prepare('INSERT INTO cotisations (membre_id,mois,montant,mode,date,saisi_par,ref_recu) VALUES (?,?,?,?,?,?,?)').run(
    membre_id, mois, montant, mode||'Espèces', date||today(), req.user.nom, ref
  );
  // Auto-update statut membre si suspendu
  const m = db.prepare('SELECT statut FROM membres WHERE id=?').get(membre_id);
  if (m?.statut === 'suspendu') db.prepare('UPDATE membres SET statut="actif",updated_at=datetime("now") WHERE id=?').run(membre_id);
  // Journal
  const mem = db.prepare('SELECT prenom,nom FROM membres WHERE id=?').get(membre_id);
  addJournal({ ref, date: date||today(), client: mem?.prenom+' '+mem?.nom, type:'COTISATION', desig:`Cotisation ${mois} — ${mem?.prenom} ${mem?.nom}`, mode: mode||'Espèces', entree: montant, membre_id, saisi_par: req.user.nom });
  res.json({ ok: true, id: result.lastInsertRowid, ref });
});

// ══════════════════════════════════════
// PRODUITS
// ══════════════════════════════════════
app.get('/api/produits', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM produits WHERE actif=1 ORDER BY categorie,nom').all());
});

app.post('/api/produits', dirOnly, (req, res) => {
  const { nom, categorie, icon, prix_achat, prix_vente, stock, description } = req.body;
  if (!nom || !categorie) return res.status(400).json({ error: 'Nom et catégorie requis' });
  const result = db.prepare('INSERT INTO produits (nom,categorie,icon,prix_achat,prix_vente,stock,description) VALUES (?,?,?,?,?,?,?)').run(nom, categorie, icon||'📦', prix_achat||0, prix_vente||0, stock||0, description||'');
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/produits/:id', dirOnly, (req, res) => {
  const { nom, categorie, icon, prix_achat, prix_vente, stock, description } = req.body;
  db.prepare('UPDATE produits SET nom=?,categorie=?,icon=?,prix_achat=?,prix_vente=?,stock=?,description=? WHERE id=?').run(nom, categorie, icon||'📦', prix_achat||0, prix_vente||0, stock||0, description||'', req.params.id);
  res.json({ ok: true });
});

app.patch('/api/produits/:id/stock', staffOnly, (req, res) => {
  const { delta } = req.body; // +1 or -1
  db.prepare('UPDATE produits SET stock=MAX(0,stock+?) WHERE id=?').run(delta||0, req.params.id);
  res.json({ ok: true, stock: db.prepare('SELECT stock FROM produits WHERE id=?').get(req.params.id)?.stock });
});

app.delete('/api/produits/:id', dirOnly, (req, res) => {
  db.prepare('UPDATE produits SET actif=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════
// CREDITS
// ══════════════════════════════════════
app.get('/api/credits', auth, (req, res) => {
  const { statut, type } = req.query;
  let q = 'SELECT c.*,GROUP_CONCAT(v.montant||"|"||v.date||"|"||v.mode, ";;") as versements_raw FROM credits c LEFT JOIN versements v ON v.credit_id=c.id';
  const where = [];
  const params = [];
  if (statut) { where.push('c.statut=?'); params.push(statut); }
  if (type) { where.push('c.type=?'); params.push(type); }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' GROUP BY c.id ORDER BY c.created_at DESC';
  const rows = db.prepare(q).all(...params);
  const result = rows.map(r => {
    const versements = r.versements_raw ? r.versements_raw.split(';;').map(v => {
      const [montant,date,mode] = v.split('|');
      return { montant: parseInt(montant), date, mode };
    }) : [];
    const { versements_raw, ...rest } = r;
    return { ...rest, versements };
  });
  res.json(result);
});

app.get('/api/credits/membre/:mid', auth, (req, res) => {
  const creds = db.prepare('SELECT c.*,GROUP_CONCAT(v.montant||"|"||v.date||"|"||v.mode, ";;") as vr FROM credits c LEFT JOIN versements v ON v.credit_id=c.id WHERE c.membre_id=? GROUP BY c.id ORDER BY c.created_at DESC').all(req.params.mid);
  res.json(creds.map(r => {
    const vs = r.vr ? r.vr.split(';;').map(v=>{const[m,d,mo]=v.split('|');return{montant:parseInt(m),date:d,mode:mo};}) : [];
    const {vr,...rest}=r; return {...rest,versements:vs};
  }));
});

app.post('/api/credits', staffOnly, (req, res) => {
  const { client, telephone, type, produit_id, prix_vente, montant_recu, client_type, membre_id, garant, garant_id, autorise_par, date_vente } = req.body;
  if (!client || !prix_vente) return res.status(400).json({ error: 'Client et prix requis' });
  // Eligibility check for membre
  if (client_type === 'membre' && membre_id) {
    const m = db.prepare('SELECT * FROM membres WHERE id=?').get(membre_id);
    if (!m || m.statut !== 'actif') return res.status(400).json({ error: 'Membre non actif' });
    const cots = db.prepare("SELECT COUNT(*) as nb FROM cotisations WHERE membre_id=? AND mois NOT LIKE '%2025%'").get(membre_id);
    const retard = Math.max(0, 12 - (cots?.nb||0));
    if (retard > 3) return res.status(400).json({ error: 'Membre en retard >3 mois — non éligible' });
    // Check existing credit
    const existing = db.prepare("SELECT id FROM credits WHERE membre_id=? AND statut='En cours'").get(membre_id);
    if (existing && !['directeur','president'].includes(req.user.role)) return res.status(400).json({ error: 'Accord directeur requis pour 2ème crédit' });
  }
  // External client must have valid garant
  if (client_type === 'externe' && (montant_recu||0) < prix_vente && !garant_id) {
    return res.status(400).json({ error: 'Garant membre GIE requis pour client externe' });
  }
  const restant = prix_vente - (montant_recu||0);
  const result = db.prepare('INSERT INTO credits (client,telephone,type,produit_id,prix_vente,montant_recu,restant,statut,client_type,membre_id,garant,garant_id,autorise_par,date_vente) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    client, telephone||'', type, produit_id||null, prix_vente, montant_recu||0, restant, restant===0?'Soldé':'En cours', client_type||'externe', membre_id||null, garant||'', garant_id||null, autorise_par||req.user.nom, date_vente||today()
  );
  const creditId = result.lastInsertRowid;
  if (montant_recu > 0) {
    const ref = genRef();
    db.prepare('INSERT INTO versements (credit_id,montant,mode,date,saisi_par,ref_recu) VALUES (?,?,?,?,?,?)').run(creditId, montant_recu, req.body.mode||'Espèces', date_vente||today(), req.user.nom, ref);
    addJournal({ ref, date: date_vente||today(), client, type:'CREDIT', desig:`Acompte crédit ${type} — ${client}`, mode: req.body.mode||'Espèces', entree: montant_recu, credit_id: creditId, saisi_par: req.user.nom });
  }
  if (produit_id) db.prepare('UPDATE produits SET stock=MAX(0,stock-1) WHERE id=?').run(produit_id);
  res.json({ ok: true, id: creditId });
});

app.post('/api/credits/:id/versement', staffOnly, (req, res) => {
  const { montant, mode, date, note } = req.body;
  const credit = db.prepare('SELECT * FROM credits WHERE id=?').get(req.params.id);
  if (!credit) return res.status(404).json({ error: 'Crédit introuvable' });
  if (credit.restant <= 0) return res.status(400).json({ error: 'Crédit déjà soldé' });
  const real = Math.min(montant, credit.restant);
  const ref = genRef();
  db.prepare('INSERT INTO versements (credit_id,montant,mode,date,note,saisi_par,ref_recu) VALUES (?,?,?,?,?,?,?)').run(credit.id, real, mode||'Espèces', date||today(), note||'', req.user.nom, ref);
  const newRestant = credit.restant - real;
  const newStatut = newRestant === 0 ? 'Soldé' : 'En cours';
  db.prepare('UPDATE credits SET montant_recu=montant_recu+?,restant=?,statut=?,updated_at=datetime("now") WHERE id=?').run(real, newRestant, newStatut, credit.id);
  addJournal({ ref, date: date||today(), client: credit.client, type:'CREDIT', desig:`Versement crédit ${credit.type}${newStatut==='Soldé'?' — SOLDÉ':''}`, mode: mode||'Espèces', entree: real, credit_id: credit.id, saisi_par: req.user.nom });
  res.json({ ok: true, ref, nouveau_restant: newRestant, statut: newStatut });
});

// ══════════════════════════════════════
// ENCAISSEMENT (Journal)
// ══════════════════════════════════════
app.get('/api/journal', auth, (req, res) => {
  const { date, type, limit } = req.query;
  let q = 'SELECT * FROM journal_caisse';
  const where = []; const params = [];
  if (date) { where.push('date=?'); params.push(date); }
  if (type) { where.push('type=?'); params.push(type); }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY created_at DESC';
  if (limit) q += ' LIMIT ' + parseInt(limit);
  res.json(db.prepare(q).all(...params));
});

app.get('/api/journal/stats', auth, (req, res) => {
  const { date } = req.query;
  const d = date || today();
  const stats = db.prepare(`SELECT 
    SUM(CASE WHEN type='COTISATION' THEN entree ELSE 0 END) as cotisations,
    SUM(CASE WHEN type='CREDIT' THEN entree ELSE 0 END) as credits,
    SUM(CASE WHEN type='VENTE' THEN entree ELSE 0 END) as ventes,
    SUM(entree) as total_entrees,
    SUM(sortie) as total_sorties,
    COUNT(*) as nb_operations
    FROM journal_caisse WHERE date=?`).get(d);
  const solde_total = db.prepare('SELECT SUM(entree)-SUM(sortie) as solde FROM journal_caisse').get();
  res.json({ ...stats, date: d, solde_caisse: solde_total?.solde||0 });
});

app.post('/api/journal', staffOnly, (req, res) => {
  const { client, type, designation, mode, entree, sortie, credit_id, membre_id, note } = req.body;
  const ref = genRef();
  const d = req.body.date || today();
  addJournal({ ref, date: d, client, type, desig: designation, mode, entree: entree||0, sortie: sortie||0, credit_id: credit_id||null, membre_id: membre_id||null, note: note||'', saisi_par: req.user.nom });
  res.json({ ok: true, ref });
});

// ══════════════════════════════════════
// BANQUE
// ══════════════════════════════════════
app.get('/api/banque', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM banque ORDER BY date DESC,created_at DESC').all());
});

app.get('/api/banque/solde', auth, (req, res) => {
  const r = db.prepare('SELECT SUM(entree)-SUM(sortie) as solde,SUM(entree) as total_entrees,SUM(sortie) as total_sorties FROM banque').get();
  res.json(r);
});

app.post('/api/banque', staffOnly, (req, res) => {
  const { date, designation, banque, entree, sortie, ref, saisi_par } = req.body;
  if (!designation || !date) return res.status(400).json({ error: 'Désignation et date requis' });
  db.prepare('INSERT INTO banque (date,designation,banque,entree,sortie,ref,saisi_par) VALUES (?,?,?,?,?,?,?)').run(date, designation, banque||'CMS', entree||0, sortie||0, ref||'', saisi_par||req.user.nom);
  res.json({ ok: true });
});

// ══════════════════════════════════════
// DEPENSES
// ══════════════════════════════════════
app.get('/api/depenses', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM depenses ORDER BY date DESC,created_at DESC').all());
});

app.post('/api/depenses', staffOnly, (req, res) => {
  const { date, designation, montant, categorie } = req.body;
  if (!designation || !montant) return res.status(400).json({ error: 'Désignation et montant requis' });
  db.prepare('INSERT INTO depenses (date,designation,montant,categorie,saisi_par) VALUES (?,?,?,?,?)').run(date||today(), designation, montant, categorie||'Admin', req.user.nom);
  // Journal sortie
  addJournal({ ref: genRef(), date: date||today(), client:'GIE TAXI TAXI', type:'DEPENSE', desig: designation, mode:'Espèces', entree:0, sortie: montant, saisi_par: req.user.nom });
  res.json({ ok: true });
});

// ══════════════════════════════════════
// TAXI
// ══════════════════════════════════════
app.get('/api/taxi', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM taxi_versements ORDER BY date ASC').all());
});

app.post('/api/taxi', staffOnly, (req, res) => {
  const { periode, entree, sortie, observation, date } = req.body;
  db.prepare('INSERT INTO taxi_versements (periode,entree,sortie,observation,date) VALUES (?,?,?,?,?)').run(periode, entree||0, sortie||0, observation||'', date||today());
  res.json({ ok: true });
});

// ══════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════
app.get('/api/stats', auth, (req, res) => {
  const membres_actifs = db.prepare("SELECT COUNT(*) as nb FROM membres WHERE statut='actif'").get().nb;
  const membres_suspendus = db.prepare("SELECT COUNT(*) as nb FROM membres WHERE statut='suspendu'").get().nb;
  const total_cotise = db.prepare("SELECT SUM(montant) as total FROM cotisations WHERE mois NOT LIKE '%2025%'").get().total||0;
  const credits_encours = db.prepare("SELECT COUNT(*) as nb,SUM(restant) as total FROM credits WHERE statut='En cours'").get();
  const credits_soldes = db.prepare("SELECT COUNT(*) as nb FROM credits WHERE statut='Soldé'").get().nb;
  const solde_banque = db.prepare('SELECT SUM(entree)-SUM(sortie) as solde FROM banque').get().solde||0;
  const solde_caisse = db.prepare('SELECT SUM(entree)-SUM(sortie) as solde FROM journal_caisse').get().solde||0;
  const taxi_stats = db.prepare('SELECT SUM(entree) as entrees,SUM(sortie) as sorties FROM taxi_versements').get();
  const cot_today = db.prepare("SELECT COUNT(*) as nb,SUM(montant) as total FROM cotisations WHERE date=?").get(today());
  res.json({
    membres_actifs, membres_suspendus, total_cotise,
    credits_encours: credits_encours.nb, credits_restant: credits_encours.total||0,
    credits_soldes, solde_banque, solde_caisse,
    taxi_entrees: taxi_stats.entrees||0, taxi_sorties: taxi_stats.sorties||0,
    taxi_net: (taxi_stats.entrees||0)-(taxi_stats.sorties||0),
    cotisations_today: cot_today.nb, montant_today: cot_today.total||0
  });
});

// ══════════════════════════════════════
// RECU
// ══════════════════════════════════════
app.get('/api/recu/:ref', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM journal_caisse WHERE ref=?').get(req.params.ref);
  if (!r) return res.status(404).json({ error: 'Reçu introuvable' });
  res.json(r);
});

// ── HELPERS ──
let refCounter = 14;
function genRef() {
  const row = db.prepare('SELECT MAX(CAST(SUBSTR(ref,3) AS INTEGER)) as max FROM journal_caisse WHERE ref LIKE "R-%"').get();
  const next = (row?.max||13) + 1;
  return 'R-' + String(next).padStart(4,'0');
}
function today() { return new Date().toISOString().split('T')[0]; }
function addJournal({ ref, date, client, type, desig, mode, entree, sortie, credit_id, membre_id, note, saisi_par }) {
  try {
    db.prepare('INSERT OR IGNORE INTO journal_caisse (ref,date,client,type,designation,mode,entree,sortie,credit_id,membre_id,note,saisi_par) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      ref, date, client||'', type, desig||'', mode||'Espèces', entree||0, sortie||0, credit_id||null, membre_id||null, note||'', saisi_par||''
    );
  } catch(e) { console.error('Journal error:', e.message); }
}

// ── CATCH ALL → SPA ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚖 GIE TAXI TAXI server running on port ${PORT}`));
module.exports = app;
