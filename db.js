const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'gie.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ──
db.exec(`
CREATE TABLE IF NOT EXISTS membres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  telephone TEXT UNIQUE NOT NULL,
  tel2 TEXT DEFAULT '',
  taxi TEXT DEFAULT '',
  adhesion TEXT DEFAULT '',
  pin_hash TEXT DEFAULT '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  statut TEXT DEFAULT 'actif',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cotisations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membre_id INTEGER NOT NULL,
  mois TEXT NOT NULL,
  montant INTEGER NOT NULL,
  mode TEXT DEFAULT 'Espèces',
  date TEXT NOT NULL,
  saisi_par TEXT DEFAULT '',
  ref_recu TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(membre_id) REFERENCES membres(id)
);

CREATE TABLE IF NOT EXISTS produits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  categorie TEXT NOT NULL,
  icon TEXT DEFAULT '📦',
  prix_achat INTEGER DEFAULT 0,
  prix_vente INTEGER DEFAULT 0,
  stock INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  telephone TEXT DEFAULT '',
  type TEXT NOT NULL,
  produit_id INTEGER,
  prix_vente INTEGER NOT NULL,
  montant_recu INTEGER DEFAULT 0,
  restant INTEGER NOT NULL,
  statut TEXT DEFAULT 'En cours',
  client_type TEXT DEFAULT 'externe',
  membre_id INTEGER,
  garant TEXT DEFAULT '',
  garant_id INTEGER,
  autorise_par TEXT DEFAULT '',
  date_vente TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS versements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id INTEGER NOT NULL,
  montant INTEGER NOT NULL,
  mode TEXT DEFAULT 'Espèces',
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  ref_recu TEXT DEFAULT '',
  saisi_par TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(credit_id) REFERENCES credits(id)
);

CREATE TABLE IF NOT EXISTS journal_caisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  client TEXT DEFAULT '',
  type TEXT NOT NULL,
  designation TEXT DEFAULT '',
  mode TEXT DEFAULT 'Espèces',
  entree INTEGER DEFAULT 0,
  sortie INTEGER DEFAULT 0,
  credit_id INTEGER,
  membre_id INTEGER,
  note TEXT DEFAULT '',
  saisi_par TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banque (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  designation TEXT NOT NULL,
  banque TEXT DEFAULT 'CMS',
  entree INTEGER DEFAULT 0,
  sortie INTEGER DEFAULT 0,
  ref TEXT DEFAULT '',
  saisi_par TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS depenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  designation TEXT NOT NULL,
  montant INTEGER NOT NULL,
  categorie TEXT DEFAULT 'Admin',
  saisi_par TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taxi_versements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periode TEXT NOT NULL,
  entree INTEGER DEFAULT 0,
  sortie INTEGER DEFAULT 0,
  observation TEXT DEFAULT '',
  date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  nom TEXT DEFAULT '',
  actif INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cotis_membre ON cotisations(membre_id);
CREATE INDEX IF NOT EXISTS idx_versements_credit ON versements(credit_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_caisse(date);
CREATE INDEX IF NOT EXISTS idx_credits_statut ON credits(statut);
`);

// ── SEED DATA ──
function seedIfEmpty() {
  const bcrypt = require('bcryptjs');

  // Staff
  if (!db.prepare('SELECT 1 FROM staff LIMIT 1').get()) {
    const hash = bcrypt.hashSync('0000', 10);
    const hashC = bcrypt.hashSync('2025', 10);
    db.prepare('INSERT INTO staff (username,pin_hash,role,nom) VALUES (?,?,?,?)').run('directeur', hash, 'directeur', 'Directeur GIE');
    db.prepare('INSERT INTO staff (username,pin_hash,role,nom) VALUES (?,?,?,?)').run('caissier', hashC, 'caissier', 'Caissier GIE');
    db.prepare('INSERT INTO staff (username,pin_hash,role,nom) VALUES (?,?,?,?)').run('president', hash, 'president', 'Président GIE');
    console.log('✅ Staff créé');
  }

  // Produits
  if (!db.prepare('SELECT 1 FROM produits LIMIT 1').get()) {
    const prods = [
      ['Batterie SOLANCE', 'BATTERIE', '🔋', 33000, 45000, 7, 'Batterie SOLANCE 12V'],
      ['Batterie SISA', 'BATTERIE', '🔋', 27000, 40000, 5, 'Batterie SISA'],
      ['Batterie DELCO', 'BATTERIE', '🔋', 25000, 37500, 3, 'Batterie DELCO'],
      ['Smartphone Spark 40', 'TELEPHONE', '📱', 57000, 80000, 3, 'Spark 40 128Go'],
      ['Smartphone A16', 'TELEPHONE', '📱', 74000, 100000, 2, 'Samsung A16 128Go'],
      ['Smartphone POP 10', 'TELEPHONE', '📱', 47500, 65000, 1, 'POP 10 128Go'],
      ['Smartphone A06 64Go', 'TELEPHONE', '📱', 40000, 55000, 4, 'A06 64 gigaoctets'],
      ['Huile moteur 5L', 'HUILE', '🛢️', 9500, 13000, 0, 'Huile moteur 5 litres'],
      ['Assurance taxi 1 mois', 'ASSURANCE', '🛡️', 0, 21000, 0, 'Assurance mensuelle taxi'],
    ];
    const ins = db.prepare('INSERT INTO produits (nom,categorie,icon,prix_achat,prix_vente,stock,description) VALUES (?,?,?,?,?,?,?)');
    prods.forEach(p => ins.run(...p));
    console.log('✅ Produits créés');
  }

  // Membres
  if (!db.prepare('SELECT 1 FROM membres LIMIT 1').get()) {
    const defaultPin = bcrypt.hashSync('1234', 10);
    const membres = [
      [1,'DAOUDA','NDIAYE','776351010','','','2024-09-01','actif',''],
      [2,'GORA','GUEYE','775919566','','','2024-09-01','actif',''],
      [3,'CHEIKH A.B','THIAM','774414821','','','2024-09-01','actif',''],
      [5,'SERIGNE','CISSE','770330761','','','2024-09-01','actif',''],
      [7,'MAMADOU LAMINE','GOUDIABY','779186799','','','2024-09-01','suspendu','Plus de 3 mois sans cotiser'],
      [8,'CHEIKH','DIOP','777526770','765951211','','2024-09-01','suspendu',''],
      [9,'CHERIF','CORREA','772146324','','','2024-09-01','actif',''],
      [10,'DAOUDA','DIOUF','777033600','768889920','','2024-09-01','actif',''],
      [11,'AZIZ','DIONE','775409070','','','2024-09-01','actif',''],
      [14,'ADAMA','DIOUF','776872780','','','2024-09-01','actif',''],
      [16,'IBRAHIMA','SENE','775989102','','','2024-09-01','actif',''],
      [17,'SIDY','NIANE','770247233','','','2024-09-01','actif',''],
      [18,'BABA','NGOM','784706758','','','2024-09-01','actif',''],
      [19,'AMADOU','DIA','778116383','','','2024-09-01','suspendu',''],
      [20,'SERIGNE ASSANE','DIOUF','780174669','','','2024-09-01','suspendu',''],
      [22,'NAR','NDIAYE','772873155','','','2024-09-01','actif',''],
      [23,'YAYA','DIALLO','772075967','','','2024-09-01','actif',''],
      [25,'LAMP','DIOUF','777977407','','','2024-09-01','actif',''],
      [26,'DJIBY','GUEYE','775529648','','','2024-09-01','actif',''],
      [29,'MOR','DIENG','775858522','','','2024-09-01','actif',''],
      [30,'DAME','SARR','775738861','','','2024-09-01','actif',''],
      [31,'ALIOU','YADE','775360684','775703176','','2024-09-01','actif',''],
      [33,'SALIOU','DIOUF','776550759','','','2024-09-01','suspendu',''],
      [34,'BOUBACAR','DIALLO','784202067','','','2024-09-01','actif',''],
      [35,'MOHAMADOU','GUEYE','773815985','','','2024-09-01','actif',''],
      [38,'ABLAYE','NDIAYE','775345429','','','2024-09-01','actif',''],
      [49,'DAME','FALL','782083918','771938305','','2024-09-01','actif',''],
      [50,'CHEIKH','FALL','779399081','','','2024-09-01','actif',''],
      [55,'MALICK','MBAYE','774283390','','','2024-09-01','actif',''],
      [60,'BABACAR','NGOM','776592907','','','2024-09-01','actif',''],
      [66,'MAKHTAR','FALL','774526677','','','2024-09-01','actif',''],
      [71,'AMADOU','SECK','772418248','','','2024-09-01','actif',''],
      [80,'IBRAHIMA','BOYE','709759573','','','2024-09-01','actif',''],
      [83,'PAPE','NIANG','770776757','','','2024-09-01','actif',''],
      [86,'MOHAMET','NDOUR','773163940','','','2024-09-01','actif',''],
      [88,'MOR','WANE','766841627','','','2024-09-01','actif',''],
      [90,'MAMADOU','FALL','772449508','','','2024-09-01','actif','Membre modèle'],
      [91,'MAMADOU','SENE','783350294','','','2024-09-01','actif',''],
      [95,'TOUBA','WADE','761258546','','','2024-09-01','actif',''],
      [103,'IBRAHIMA','SY','777264140','','','2024-09-01','actif',''],
      [115,'MOUSTAPHA','KAIRE','770944621','','','2024-09-01','actif',''],
      [125,'MBAYE','GUEYE','764608964','','','2024-09-01','actif',''],
    ];
    const ins = db.prepare('INSERT OR IGNORE INTO membres (id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes,pin_hash) VALUES (?,?,?,?,?,?,?,?,?,?)');
    membres.forEach(m => ins.run(...m, defaultPin));
    console.log(`✅ ${membres.length} membres créés`);
  }

  // Cotisations
  if (!db.prepare('SELECT 1 FROM cotisations LIMIT 1').get()) {
    const cotData = [
      [1,'Janvier',2000],[1,'Février',2000],[1,'Mars',2000],
      [2,'Janvier',2000],[2,'Février',2000],[2,'Mars',2000],[2,'Avril',2000],
      [3,'Janvier',2000],[3,'Février',2000],
      [5,'Janvier',2000],[5,'Février',2000],
      [9,'Janvier',2000],[9,'Février',2000],[9,'Mars',2000],[9,'Avril',2000],
      [10,'Janvier',2000],
      [11,'Janvier',2000],[11,'Février',2000],
      [14,'Janvier',2000],[14,'Février',2000],[14,'Mars',2000],
      [16,'Janvier',2000],[16,'Février',2000],[16,'Mars',2000],
      [17,'Janvier',2000],[17,'Février',2000],
      [18,'Janvier',2000],
      [22,'Janvier',2000],[22,'Février',2500],[22,'Mars',2000],
      [23,'Janvier',2000],[23,'Février',2000],[23,'Mars',2000],
      [25,'Janvier',2000],[25,'Février',2500],[25,'Mars',2500],[25,'Avril',2000],
      [26,'Janvier',2000],[26,'Février',2000],
      [29,'Janvier',2000],[29,'Février',2500],
      [30,'Janvier',2000],[30,'Février',2000],[30,'Mars',2000],
      [31,'Janvier',2000],[31,'Février',2000],
      [34,'Janvier',2000],[34,'Février',2000],[34,'Mars',2000],
      [35,'Janvier',2000],[35,'Février',2000],[35,'Mars',2000],[35,'Avril',2000],[35,'Mai',1000],
      [38,'Janvier',2000],[38,'Février',2000],[38,'Mars',2000],
      [49,'Janvier',2000],[49,'Février',2000],[49,'Mars',2000],
      [50,'Janvier',2000],[50,'Février',2000],[50,'Mars',2000],[50,'Avril',2000],[50,'Mai',500],
      [55,'Janvier',2000],[55,'Février',2000],[55,'Mars',2000],
      [60,'Janvier',2000],[60,'Février',2000],[60,'Mars',2000],[60,'Avril',2000],
      [66,'Janvier',2500],[66,'Février',2500],[66,'Mars',2500],[66,'Avril',2000],[66,'Mai',2000],[66,'Juin',2000],
      [71,'Janvier',2000],[71,'Février',2500],[71,'Mars',2500],[71,'Avril',2000],
      [80,'Janvier',2000],[80,'Février',2000],[80,'Mars',2000],
      [83,'Janvier',2000],[83,'Février',2000],[83,'Mars',2000],
      [86,'Janvier',2000],[86,'Février',2000],
      [88,'Janvier',2000],[88,'Février',2000],[88,'Mars',500],
      [90,'Janvier',2000],[90,'Février',2000],[90,'Mars',2000],[90,'Avril',2000],[90,'Mai',2000],[90,'Juin',2000],[90,'Juillet',2000],[90,'Août',2000],[90,'Septembre',2000],[90,'Octobre',2000],[90,'Novembre',2000],[90,'Décembre',2000],
      [91,'Janvier',2000],[91,'Février',2000],[91,'Mars',2000],
      [95,'Janvier',2000],[95,'Février',2000],[95,'Mars',2000],[95,'Avril',2000],[95,'Mai',2000],[95,'Juin',2000],[95,'Juillet',2000],[95,'Août',2000],[95,'Septembre',2000],[95,'Octobre',2000],[95,'Novembre',2000],[95,'Décembre',2000],
      [103,'Janvier',2000],[103,'Février',2000],[103,'Mars',2000],[103,'Avril',2000],[103,'Mai',2000],[103,'Juin',2000],[103,'Juillet',2000],[103,'Août',2000],[103,'Septembre',2000],[103,'Octobre',2000],[103,'Novembre',2000],[103,'Décembre',2000],
      [115,'Janvier',2000],[115,'Février',2000],[115,'Mars',2000],
      [125,'Janvier',2000],[125,'Février',2000],[125,'Mars',2000],[125,'Avril',2000],[125,'Mai',2000],[125,'Juin',2000],
    ];
    const ins = db.prepare('INSERT INTO cotisations (membre_id,mois,montant,mode,date,saisi_par) VALUES (?,?,?,?,?,?)');
    cotData.forEach(([mid,mois,mt]) => ins.run(mid, mois, mt, 'Espèces', '2026-01-01', 'Import initial'));
    console.log(`✅ ${cotData.length} cotisations importées`);
  }

  // Taxi versements
  if (!db.prepare('SELECT 1 FROM taxi_versements LIMIT 1').get()) {
    const taxiData = [
      ['DU 08 AU 14 SEPT 2025',45000,55000,'','2025-09-08'],
      ['DU 15 AU 21 SEPT 2025',65000,0,'','2025-09-15'],
      ['DU 22 AU 28 SEPT 2025',90000,0,'','2025-09-22'],
      ['DU 29 AU 05 OCT',75000,0,'','2025-09-29'],
      ['DU 06 AU 12 OCT 2025',75000,16318,'assurance','2025-10-06'],
      ['DU 13 AU 19 OCT 2025',90000,0,'','2025-10-13'],
      ['DU 20 AU 26 OCT 2025',75000,0,'','2025-10-20'],
      ['DU 27 AU 02 NOV 2025',90000,0,'','2025-10-27'],
      ['DU 03 AU 09 NOV 2025',35000,16318,'assurance','2025-11-03'],
      ['DU 10 AU 16 NOV 2025',90000,0,'','2025-11-10'],
      ['DU 17 AU 23 NOV 2025',90000,0,'','2025-11-17'],
      ['DU 24 AU 30 NOV 2025',67500,0,'','2025-11-24'],
      ['DU 01 AU 07 DEC 2025',90000,16318,'','2025-12-01'],
      ['DU 08 AU 14 DEC 2025',52500,55000,'disque embrayage','2025-12-08'],
      ['DU 15 AU 21 DEC 2025',81000,105000,"train arrière main d'oeuvre",'2025-12-15'],
      ['DU 22 AU 28 DEC 2025',60000,45000,'pneu plaque frein siambloc','2025-12-22'],
      ['DU 29 AU 04 JAN 2026',90000,20000,'engine motor oil','2025-12-29'],
      ['DU 05 AU 11 JAN 2026',75000,20000,'engine motor oil','2026-01-05'],
      ['DU 12 AU 18 JAN 2026',90000,10000,'assy front door','2026-01-12'],
      ['DU 19 AU 25 JAN 2026',75000,25000,'engine motor oil','2026-01-19'],
      ['DU 26 AU 01 FEV 2026',90000,0,'','2026-01-26'],
      ['DU 02 AU 08 FEV 2026',90000,19000,'','2026-02-02'],
      ['DU 09 AU 15 FEV 2026',90000,0,'','2026-02-09'],
      ['DU 16 AU 22 FEV 2026',90000,16500,'assurance','2026-02-16'],
      ['DU 23 AU 01 MARS',60000,35000,'batterie','2026-02-23'],
      ['DU 02 AU 08 MARS 2026',72000,25000,'engine motor oil','2026-03-02'],
      ['DU 09 AU 15 MARS 2026',72000,20000,'engine motor oil','2026-03-09'],
      ['DU 16 AU 22 MARS 2026',48000,25000,'engine motor oil','2026-03-16'],
      ['DU 23 AU 29 MARS 2026',75000,16500,'assurance','2026-03-23'],
      ['DU 30 AU 05 AVRIL 2026',60000,42000,'pneu bilette frein plaquette','2026-03-30'],
    ];
    const ins = db.prepare('INSERT INTO taxi_versements (periode,entree,sortie,observation,date) VALUES (?,?,?,?,?)');
    taxiData.forEach(t => ins.run(...t));
    console.log('✅ Taxi versements importés');
  }

  // Journal initial
  if (!db.prepare('SELECT 1 FROM journal_caisse LIMIT 1').get()) {
    const journal = [
      ['R-0001','2026-01-01','Cotisations Janvier 2026','COTISATION','Cotisations Janvier 2026','Espèces',231000,0],
      ['R-0002','2026-02-01','Cotisations Février 2026','COTISATION','Cotisations Février 2026','Wave',106500,0],
      ['R-0003','2026-03-01','Cotisations Mars 2026','COTISATION','Cotisations Mars 2026','Espèces',111500,0],
      ['R-0004','2025-09-01','Cotisations Septembre 2025','COTISATION','Cotisations Septembre 2025','Espèces',188500,0],
      ['R-0005','2025-10-01','Cotisations Octobre 2025','COTISATION','Cotisations Octobre 2025','Espèces',123000,0],
      ['R-0006','2025-11-01','Cotisations Novembre 2025','COTISATION','Cotisations Novembre 2025','Espèces',96500,0],
      ['R-0007','2025-12-01','Cotisations Décembre 2025','COTISATION','Cotisations Décembre 2025','Espèces',565500,0],
    ];
    const ins = db.prepare('INSERT INTO journal_caisse (ref,date,client,type,designation,mode,entree,sortie,saisi_par) VALUES (?,?,?,?,?,?,?,?,?)');
    journal.forEach(j => ins.run(...j, 'Import'));
    console.log('✅ Journal initial créé');
  }
}

seedIfEmpty();
module.exports = db;
