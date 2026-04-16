const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB, saveDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gie-taxi-taxi-2026-secret';

// ══ SYNC — SERVER-SENT EVENTS (temps réel sans WebSocket) ══
const sseClients = new Map(); // userId -> res

function broadcast(event, data) {
  const msg = `data: ${JSON.stringify({ event, data, ts: Date.now() })}\n\n`;
  sseClients.forEach((res, id) => {
    try { res.write(msg); } catch(e) { sseClients.delete(id); }
  });
}

app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware auth
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// ══ SSE — TEMPS RÉEL SANS WEBSOCKET ══
app.get('/api/events', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const clientId = req.user.id + '_' + Date.now();
  sseClients.set(clientId, res);
  console.log(`📡 SSE connecté: ${req.user.nom} (${sseClients.size} clients)`);

  // Send initial ping
  res.write(`data: ${JSON.stringify({ event: 'connected', data: { nom: req.user.nom } })}\n\n`);

  // Keepalive every 25s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch(e) { clearInterval(ping); sseClients.delete(clientId); }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(clientId);
    console.log(`📡 SSE déconnecté (${sseClients.size} clients)`);
  });
});
function staffOnly(req, res, next) { auth(req, res, () => { if (req.user.role === 'membre') return res.status(403).json({ error: 'Accès refusé' }); next(); }); }
function dirOnly(req, res, next) { auth(req, res, () => { if (!['directeur','president'].includes(req.user.role)) return res.status(403).json({ error: 'Réservé directeur' }); next(); }); }

const today = () => new Date().toISOString().split('T')[0];
function genRef(db) {
  const r = db.prepare("SELECT MAX(CAST(SUBSTR(ref,3) AS INTEGER)) as mx FROM journal_caisse WHERE ref LIKE 'R-%'").get();
  return 'R-' + String((r?.mx||0)+1).padStart(4,'0');
}
function addJournal(db, o) {
  try { db.prepare('INSERT OR IGNORE INTO journal_caisse(ref,date,client,type,designation,mode,entree,sortie,credit_id,membre_id,note,saisi_par)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(o.ref,o.date,o.client||'',o.type,o.desig||'',o.mode||'Espèces',o.entree||0,o.sortie||0,o.credit_id||null,o.membre_id||null,o.note||'',o.saisi_par||''); } catch(e) {}
}

// ══ LOGIN ══
app.post('/api/login', async (req, res) => {
  try {
    const db = await getDB();
    const { telephone, pin } = req.body;

    // ── STAFF : login avec username + PIN ──
    const staff = db.prepare('SELECT * FROM staff WHERE username=? AND actif=1').get(telephone);
    if (staff && bcrypt.compareSync(pin, staff.pin_hash)) {
      const token = jwt.sign({ id: staff.id, role: staff.role, nom: staff.nom, type: 'staff' }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, user: { id: staff.id, role: staff.role, nom: staff.nom, type: 'staff' } });
    }

    // ── MEMBRE : login avec numéro uniquement (pas de PIN) ──
    const m = db.prepare('SELECT * FROM membres WHERE (telephone=? OR tel2=?) AND statut!=?').get(telephone, telephone, 'supprimé');
    if (m) {
      // Si pin='MEMBRE_LIBRE' → connexion sans PIN (membres simples)
      // Si pin fourni → vérifier le PIN (membres qui ont changé leur PIN)
      const noPin = pin === 'MEMBRE_LIBRE';
      const pinOk = noPin || bcrypt.compareSync(pin, m.pin_hash);
      if (pinOk) {
        const token = jwt.sign({ id: m.id, role: 'membre', nom: m.prenom+' '+m.nom, membre_id: m.id, type: 'membre' }, JWT_SECRET, { expiresIn: '12h' });
        return res.json({ token, user: { id: m.id, role: 'membre', nom: m.prenom+' '+m.nom, membre_id: m.id, type: 'membre', statut: m.statut } });
      }
    }

    res.status(401).json({ error: 'Numéro non reconnu dans le GIE' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ MEMBRES ══
app.get('/api/membres', auth, async (req, res) => {
  try {
    const db = await getDB();
    const membres = db.prepare('SELECT id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes FROM membres ORDER BY nom,prenom').all();
    const result = membres.map(m => {
      const cots = db.prepare("SELECT mois,SUM(montant) as montant FROM cotisations WHERE membre_id=? GROUP BY mois").all(m.id);
      const cotMap = {}; let total = 0;
      cots.forEach(c => { cotMap[c.mois] = c.montant; total += c.montant; });
      return { ...m, cotisations_2026: cotMap, total_2026: total, mois_payes: cots.length, mois_restants: Math.max(0,12-cots.length) };
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/membres/:id', auth, async (req, res) => {
  try {
    const db = await getDB();
    const m = db.prepare('SELECT id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes FROM membres WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Introuvable' });
    const cots = db.prepare("SELECT mois,SUM(montant) as montant FROM cotisations WHERE membre_id=? GROUP BY mois").all(m.id);
    const cotMap={}; let total=0; cots.forEach(c=>{cotMap[c.mois]=c.montant;total+=c.montant;});
    res.json({ ...m, cotisations_2026: cotMap, total_2026: total, mois_payes: cots.length, mois_restants: Math.max(0,12-cots.length) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/membres', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { prenom, nom, telephone, tel2, taxi, adhesion, statut, notes } = req.body;
    if (!prenom||!nom||!telephone) return res.status(400).json({ error: 'Prénom, Nom, Téléphone requis' });
    const r = db.prepare('INSERT INTO membres(prenom,nom,telephone,tel2,taxi,adhesion,statut,notes,pin_hash)VALUES(?,?,?,?,?,?,?,?,?)').run(prenom.toUpperCase(),nom.toUpperCase(),telephone,tel2||'',taxi||'',adhesion||'',statut||'actif',notes||'',bcrypt.hashSync('1234',10));
    broadcast('membre_added', { prenom: prenom.toUpperCase(), nom: nom.toUpperCase(), telephone });
    res.json({ ok:true, id: r.lastInsertRowid, message: 'PIN par défaut: 1234' });
  } catch(e) { res.status(500).json({ error: e.message.includes('UNIQUE')?'Téléphone existe déjà':e.message }); }
});

app.put('/api/membres/:id', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { prenom, nom, telephone, tel2, taxi, adhesion, statut, notes } = req.body;
    db.prepare('UPDATE membres SET prenom=?,nom=?,telephone=?,tel2=?,taxi=?,adhesion=?,statut=?,notes=? WHERE id=?').run(prenom?.toUpperCase(),nom?.toUpperCase(),telephone,tel2||'',taxi||'',adhesion||'',statut||'actif',notes||'',req.params.id);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/membres/:id/statut', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('UPDATE membres SET statut=? WHERE id=?').run(req.body.statut, req.params.id);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ COTISATIONS ══
app.get('/api/cotisations', auth, async (req, res) => {
  try {
    const db = await getDB();
    res.json(db.prepare('SELECT c.*,m.prenom,m.nom FROM cotisations c JOIN membres m ON c.membre_id=m.id ORDER BY c.created_at DESC').all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cotisations', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { membre_id, mois, montant, mode, date, note } = req.body;
    if (!membre_id||!mois||!montant) return res.status(400).json({ error: 'Données manquantes' });
    const ref = genRef(db);
    db.prepare('INSERT INTO cotisations(membre_id,mois,montant,mode,date,saisi_par,ref_recu)VALUES(?,?,?,?,?,?,?)').run(membre_id,mois,montant,mode||'Espèces',date||today(),req.user.nom,ref);
    const m = db.prepare('SELECT prenom,nom,statut FROM membres WHERE id=?').get(membre_id);
    if (m?.statut==='suspendu') db.prepare('UPDATE membres SET statut="actif" WHERE id=?').run(membre_id);
    addJournal(db,{ref,date:date||today(),client:m?.prenom+' '+m?.nom,type:'COTISATION',desig:`Cotisation ${mois}`,mode:mode||'Espèces',entree:montant,membre_id,saisi_par:req.user.nom});
    broadcast('cotisation_added', { membre: m?.prenom+' '+m?.nom, mois, montant, ref, saisi_par: req.user.nom });
    res.json({ ok:true, ref });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ PRODUITS ══
app.get('/api/produits', auth, async (req, res) => {
  try {
    const db=await getDB();
    // Include image_b64 for display
    res.json(db.prepare('SELECT id,nom,categorie,icon,prix_achat,prix_vente,stock,description,actif,image_b64,created_at FROM produits WHERE actif=1 ORDER BY categorie,nom').all());
  }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/produits', dirOnly, async (req, res) => {
  try {
    const db=await getDB();
    const { nom, categorie, icon, prix_achat, prix_vente, stock, description, image_b64 } = req.body;
    const r = db.prepare('INSERT INTO produits(nom,categorie,icon,prix_achat,prix_vente,stock,description,image_b64)VALUES(?,?,?,?,?,?,?,?)').run(nom,categorie,icon||'📦',prix_achat||0,prix_vente||0,stock||0,description||'',image_b64||'');
    res.json({ ok:true, id: r.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/produits/:id', dirOnly, async (req, res) => {
  try {
    const db=await getDB();
    const {nom,categorie,icon,prix_achat,prix_vente,stock,description,image_b64}=req.body;
    // Si image_b64 fournie, la sauvegarder; sinon garder l'ancienne
    if (image_b64 !== undefined && image_b64 !== '') {
      db.prepare('UPDATE produits SET nom=?,categorie=?,icon=?,prix_achat=?,prix_vente=?,stock=?,description=?,image_b64=? WHERE id=?').run(nom,categorie,icon||'📦',prix_achat||0,prix_vente||0,stock||0,description||'',image_b64,req.params.id);
    } else {
      db.prepare('UPDATE produits SET nom=?,categorie=?,icon=?,prix_achat=?,prix_vente=?,stock=?,description=? WHERE id=?').run(nom,categorie,icon||'📦',prix_achat||0,prix_vente||0,stock||0,description||'',req.params.id);
    }
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/produits/:id/stock', staffOnly, async (req, res) => {
  try {
    const db=await getDB();
    db.prepare('UPDATE produits SET stock=MAX(0,stock+?) WHERE id=?').run(req.body.delta||0,req.params.id);
    res.json({ ok:true, stock: db.prepare('SELECT stock FROM produits WHERE id=?').get(req.params.id)?.stock });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/produits/:id', dirOnly, async (req, res) => {
  try { const db=await getDB(); db.prepare('UPDATE produits SET actif=0 WHERE id=?').run(req.params.id); res.json({ok:true}); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ CREDITS ══
app.get('/api/credits', auth, async (req, res) => {
  try {
    const db=await getDB();
    const credits = db.prepare('SELECT * FROM credits ORDER BY created_at DESC').all();
    const result = credits.map(c => {
      const vs = db.prepare('SELECT montant,date,mode FROM versements WHERE credit_id=? ORDER BY created_at').all(c.id);
      return { ...c, versements: vs };
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/credits/membre/:mid', auth, async (req, res) => {
  try {
    const db=await getDB();
    const credits=db.prepare('SELECT * FROM credits WHERE membre_id=? ORDER BY created_at DESC').all(req.params.mid);
    res.json(credits.map(c=>({...c,versements:db.prepare('SELECT montant,date,mode FROM versements WHERE credit_id=? ORDER BY created_at').all(c.id)})));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/credits', staffOnly, async (req, res) => {
  try {
    const db=await getDB();
    const {client,telephone,type,produit_id,prix_vente,montant_recu,client_type,membre_id,garant,garant_id,autorise_par,date_vente,mode}=req.body;
    if (!client||!prix_vente) return res.status(400).json({error:'Client et prix requis'});
    if (client_type==='membre'&&membre_id) {
      const m=db.prepare('SELECT statut FROM membres WHERE id=?').get(membre_id);
      if (!m||m.statut!=='actif') return res.status(400).json({error:'Membre non actif'});
      const cots=db.prepare('SELECT COUNT(*) as nb FROM cotisations WHERE membre_id=?').get(membre_id);
      if (Math.max(0,12-(cots?.nb||0))>3) return res.status(400).json({error:'Membre en retard >3 mois'});
    }
    const restant=prix_vente-(montant_recu||0);
    const r=db.prepare('INSERT INTO credits(client,telephone,type,produit_id,prix_vente,montant_recu,restant,statut,client_type,membre_id,garant,garant_id,autorise_par,date_vente)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(client,telephone||'',type,produit_id||null,prix_vente,montant_recu||0,restant,restant===0?'Soldé':'En cours',client_type||'externe',membre_id||null,garant||'',garant_id||null,autorise_par||req.user.nom,date_vente||today());
    const cid=r.lastInsertRowid;
    if (montant_recu>0) {
      const ref=genRef(db);
      db.prepare('INSERT INTO versements(credit_id,montant,mode,date,saisi_par,ref_recu)VALUES(?,?,?,?,?,?)').run(cid,montant_recu,mode||'Espèces',date_vente||today(),req.user.nom,ref);
      addJournal(db,{ref,date:date_vente||today(),client,type:'CREDIT',desig:`Acompte crédit ${type}`,mode:mode||'Espèces',entree:montant_recu,credit_id:cid,saisi_par:req.user.nom});
    }
    if (produit_id) db.prepare('UPDATE produits SET stock=MAX(0,stock-1) WHERE id=?').run(produit_id);
    broadcast('credit_added', { client, type, prix_vente, client_type: client_type||'externe', saisi_par: req.user.nom });
    res.json({ok:true,id:cid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/credits/:id/versement', staffOnly, async (req, res) => {
  try {
    const db=await getDB();
    const c=db.prepare('SELECT * FROM credits WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({error:'Crédit introuvable'});
    if (c.restant<=0) return res.status(400).json({error:'Crédit déjà soldé'});
    const {montant,mode,date,note}=req.body;
    const real=Math.min(montant,c.restant);
    const ref=genRef(db);
    db.prepare('INSERT INTO versements(credit_id,montant,mode,date,note,saisi_par,ref_recu)VALUES(?,?,?,?,?,?,?)').run(c.id,real,mode||'Espèces',date||today(),note||'',req.user.nom,ref);
    const nr=c.restant-real;
    const ns=nr===0?'Soldé':'En cours';
    db.prepare('UPDATE credits SET montant_recu=montant_recu+?,restant=?,statut=? WHERE id=?').run(real,nr,ns,c.id);
    addJournal(db,{ref,date:date||today(),client:c.client,type:'CREDIT',desig:`Versement ${c.type}${ns==='Soldé'?' — SOLDÉ':''}`,mode:mode||'Espèces',entree:real,credit_id:c.id,saisi_par:req.user.nom});
    broadcast('versement_added', { client: c.client, montant: real, nouveau_restant: nr, statut: ns, ref, saisi_par: req.user.nom });
    res.json({ok:true,ref,nouveau_restant:nr,statut:ns});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ JOURNAL ══
app.get('/api/journal', auth, async (req, res) => {
  try {
    const db=await getDB();
    const {date,type,limit}=req.query;
    let q='SELECT * FROM journal_caisse'; const w=[],p=[];
    if(date){w.push('date=?');p.push(date);}
    if(type){w.push('type=?');p.push(type);}
    if(w.length)q+=' WHERE '+w.join(' AND ');
    q+=' ORDER BY created_at DESC';
    if(limit)q+=' LIMIT '+parseInt(limit);
    res.json(db.prepare(q).all(...p));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/journal/stats', auth, async (req, res) => {
  try {
    const db=await getDB();
    const d=req.query.date||today();
    const s=db.prepare("SELECT SUM(CASE WHEN type='COTISATION' THEN entree ELSE 0 END) as cotisations,SUM(CASE WHEN type='CREDIT' THEN entree ELSE 0 END) as credits,SUM(CASE WHEN type='VENTE' THEN entree ELSE 0 END) as ventes,SUM(entree) as total_entrees,SUM(sortie) as total_sorties,COUNT(*) as nb_operations FROM journal_caisse WHERE date=?").get(d);
    const sol=db.prepare('SELECT SUM(entree)-SUM(sortie) as solde FROM journal_caisse').get();
    res.json({...s,date:d,solde_caisse:sol?.solde||0});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/journal', staffOnly, async (req, res) => {
  try {
    const db=await getDB();
    const ref=genRef(db);
    const {client,type,designation,mode,entree,sortie,credit_id,membre_id,note}=req.body;
    addJournal(db,{ref,date:req.body.date||today(),client,type,desig:designation,mode,entree:entree||0,sortie:sortie||0,credit_id:credit_id||null,membre_id:membre_id||null,note:note||'',saisi_par:req.user.nom});
    res.json({ok:true,ref});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ BANQUE ══
app.get('/api/banque', auth, async (req, res) => {
  try { const db=await getDB(); res.json(db.prepare('SELECT * FROM banque ORDER BY date DESC').all()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/banque/solde', auth, async (req, res) => {
  try { const db=await getDB(); res.json(db.prepare('SELECT SUM(entree)-SUM(sortie) as solde,SUM(entree) as total_entrees,SUM(sortie) as total_sorties FROM banque').get()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/banque', staffOnly, async (req, res) => {
  try {
    const db=await getDB();
    const {date,designation,banque,entree,sortie,ref,saisi_par}=req.body;
    db.prepare('INSERT INTO banque(date,designation,banque,entree,sortie,ref,saisi_par)VALUES(?,?,?,?,?,?,?)').run(date,designation,banque||'CMS',entree||0,sortie||0,ref||'',saisi_par||req.user.nom);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ DEPENSES ══
app.get('/api/depenses', auth, async (req, res) => {
  try { const db=await getDB(); res.json(db.prepare('SELECT * FROM depenses ORDER BY date DESC').all()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/depenses', staffOnly, async (req, res) => {
  try {
    const db=await getDB();
    const {date,designation,montant,categorie}=req.body;
    db.prepare('INSERT INTO depenses(date,designation,montant,categorie,saisi_par)VALUES(?,?,?,?,?)').run(date||today(),designation,montant,categorie||'Admin',req.user.nom);
    addJournal(db,{ref:genRef(db),date:date||today(),client:'GIE',type:'DEPENSE',desig:designation,mode:'Espèces',entree:0,sortie:montant,saisi_par:req.user.nom});
    broadcast('depense_added', { designation, montant, categorie: categorie||'Admin', saisi_par: req.user.nom });
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ TAXI ══
app.get('/api/taxi', auth, async (req, res) => {
  try { const db=await getDB(); res.json(db.prepare('SELECT * FROM taxi_versements ORDER BY date ASC').all()); }
  catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/taxi', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const {periode, entree, sortie, observation, date} = req.body;
    if (!periode) return res.status(400).json({error:'Période requise'});
    db.prepare('INSERT INTO taxi_versements(periode,entree,sortie,observation,date) VALUES(?,?,?,?,?)').run(periode, entree||0, sortie||0, observation||'', date||new Date().toISOString().split('T')[0]);
    const net = (entree||0)-(sortie||0);
    broadcast('taxi_added', {periode, entree: entree||0, sortie: sortie||0, net, saisi_par: req.user.nom});
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══ STATS ══
app.get('/api/stats', auth, async (req, res) => {
  try {
    const db=await getDB();
    const ma=db.prepare("SELECT COUNT(*) as nb FROM membres WHERE statut='actif'").get().nb;
    const ms=db.prepare("SELECT COUNT(*) as nb FROM membres WHERE statut='suspendu'").get().nb;
    const tc=db.prepare('SELECT SUM(montant) as t FROM cotisations').get().t||0;
    const ce=db.prepare("SELECT COUNT(*) as nb,SUM(restant) as t FROM credits WHERE statut='En cours'").get();
    const cs=db.prepare("SELECT COUNT(*) as nb FROM credits WHERE statut='Soldé'").get().nb;
    const sb=db.prepare('SELECT SUM(entree)-SUM(sortie) as s FROM banque').get().s||0;
    const sc=db.prepare('SELECT SUM(entree)-SUM(sortie) as s FROM journal_caisse').get().s||0;
    const tx=db.prepare('SELECT SUM(entree) as e,SUM(sortie) as s FROM taxi_versements').get();
    res.json({membres_actifs:ma,membres_suspendus:ms,total_cotise:tc,credits_encours:ce.nb,credits_restant:ce.t||0,credits_soldes:cs,solde_banque:sb,solde_caisse:sc,taxi_entrees:tx.e||0,taxi_sorties:tx.s||0,taxi_net:(tx.e||0)-(tx.s||0)});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/recu/:ref', auth, async (req, res) => {
  try { const db=await getDB(); const r=db.prepare('SELECT * FROM journal_caisse WHERE ref=?').get(req.params.ref); r?res.json(r):res.status(404).json({error:'Introuvable'}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ══ GESTION OPÉRATIONS (Modifier/Supprimer) ══

// Delete cotisation
app.delete('/api/cotisations/:id', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const c = db.prepare('SELECT * FROM cotisations WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Introuvable' });
    db.prepare('DELETE FROM cotisations WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update cotisation
app.put('/api/cotisations/:id', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { mois, montant, mode, date } = req.body;
    db.prepare('UPDATE cotisations SET mois=?,montant=?,mode=?,date=? WHERE id=?').run(mois, montant, mode, date, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete credit
app.delete('/api/credits/:id', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('DELETE FROM versements WHERE credit_id=?').run(req.params.id);
    db.prepare('DELETE FROM credits WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update credit
app.put('/api/credits/:id', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { client, telephone, prix_vente, montant_recu, restant, statut, garant, date_vente } = req.body;
    db.prepare('UPDATE credits SET client=?,telephone=?,prix_vente=?,montant_recu=?,restant=?,statut=?,garant=?,date_vente=?,updated_at=datetime("now") WHERE id=?')
      .run(client, telephone||'', prix_vente, montant_recu, restant, statut, garant||'', date_vente, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete versement
app.delete('/api/versements/:id', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const v = db.prepare('SELECT * FROM versements WHERE id=?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Introuvable' });
    // Recalculate credit
    db.prepare('UPDATE credits SET montant_recu=MAX(0,montant_recu-?),restant=restant+?,statut="En cours" WHERE id=?').run(v.montant, v.montant, v.credit_id);
    db.prepare('DELETE FROM versements WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete journal entry
app.delete('/api/journal/:id', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('DELETE FROM journal_caisse WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update journal entry
app.put('/api/journal/:id', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { designation, client, montant, mode, date, note } = req.body;
    db.prepare('UPDATE journal_caisse SET designation=?,client=?,entree=?,mode=?,date=?,note=? WHERE id=?')
      .run(designation, client, montant||0, mode, date, note||'', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete depense
app.delete('/api/depenses/:id', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('DELETE FROM depenses WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update depense
app.put('/api/depenses/:id', staffOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { date, designation, montant, categorie } = req.body;
    db.prepare('UPDATE depenses SET date=?,designation=?,montant=?,categorie=? WHERE id=?').run(date, designation, montant, categorie, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete banque
app.delete('/api/banque/:id', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('DELETE FROM banque WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ PARAMÈTRES / ACCÈS ══

// Get all staff
app.get('/api/staff', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    res.json(db.prepare('SELECT id,username,role,nom,actif FROM staff').all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update staff PIN
app.put('/api/staff/:id/pin', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { pin } = req.body;
    if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN min 4 chiffres' });
    db.prepare('UPDATE staff SET pin_hash=? WHERE id=?').run(bcrypt.hashSync(pin, 10), req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Toggle staff actif
app.patch('/api/staff/:id/toggle', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('UPDATE staff SET actif=CASE WHEN actif=1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Add staff
app.post('/api/staff', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    const { username, pin, role, nom } = req.body;
    if (!username || !pin) return res.status(400).json({ error: 'Username et PIN requis' });
    const r = db.prepare('INSERT INTO staff(username,pin_hash,role,nom) VALUES(?,?,?,?)').run(username, bcrypt.hashSync(pin, 10), role||'caissier', nom||username);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message.includes('UNIQUE') ? 'Username déjà utilisé' : e.message }); }
});

// Reset member PIN
app.post('/api/membres/:id/reset-pin', dirOnly, async (req, res) => {
  try {
    const db = await getDB();
    db.prepare('UPDATE membres SET pin_hash=? WHERE id=?').run(bcrypt.hashSync('1234', 10), req.params.id);
    res.json({ ok: true, message: 'PIN réinitialisé à 1234' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Change own PIN
app.post('/api/change-pin', auth, async (req, res) => {
  try {
    const db = await getDB();
    const { old_pin, new_pin } = req.body;
    if (!new_pin || new_pin.length < 4) return res.status(400).json({ error: 'Nouveau PIN min 4 chiffres' });
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══ DEBUG ══
// Force reseed (si DB vide après déploiement)
app.post('/api/admin/reseed', async (req, res) => {
  const { secret } = req.body;
  if (secret !== 'gie2026reseed') return res.status(403).json({ error: 'Interdit' });
  try {
    const { forceSeed } = require('./db');
    const result = await forceSeed();
    res.json({ ok: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/debug/status', async (req, res) => {
  try {
    // Force fresh DB instance check
    const dbModule = require('./db');
    const db = await dbModule.getDB();
    const membres = db.prepare('SELECT COUNT(*) as n FROM membres').get().n;
    const staff = db.prepare('SELECT COUNT(*) as n FROM staff').get().n;
    const produits = db.prepare('SELECT COUNT(*) as n FROM produits').get().n;
    const cotisations = db.prepare('SELECT COUNT(*) as n FROM cotisations').get().n;
    const fs = require('fs');
    const dbPath = process.env.DB_PATH || '/data/gie.db';
    const size = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size/1024).toFixed(1) + ' KB' : 'N/A';
    res.json({ ok: true, membres, staff, produits, cotisations, db_size: size, db_path: dbPath });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Catch-all → SPA
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start server after DB init
getDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚖 GIE TAXI TAXI v2.0 démarré sur port ${PORT}`);
    console.log(`📡 SSE temps réel activé`);
  });
}).catch(e => { console.error('❌ Erreur démarrage:', e); process.exit(1); });
