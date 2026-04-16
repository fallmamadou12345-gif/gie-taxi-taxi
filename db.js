const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'gie.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db = null;
let _saveTimeout = null;
let _saveCount = 0;

// ── SAVE: immédiate + debounce 500ms ──
function saveDB() {
  if (!_db) return;
  try {
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    _saveCount++;
    if (_saveCount % 10 === 0) console.log(`💾 DB sauvegardée (${_saveCount} fois)`);
  } catch(e) { console.error('❌ Save error:', e.message); }
}

function scheduleSave() {
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(saveDB, 300); // save 300ms after last write
}

// Sauvegarde périodique toutes les 30s (filet de sécurité)
setInterval(saveDB, 30000);

// ── WRAPPER sql.js → API better-sqlite3 compatible ──
function makeWrapper(sqlDb) {
  _db = sqlDb;
  return {
    exec(sql) { sqlDb.run(sql); scheduleSave(); return this; },
    prepare(sql) {
      return {
        run(...p) {
          const s = sqlDb.prepare(sql);
          s.run(Array.isArray(p[0]) ? p[0] : p);
          s.free();
          scheduleSave();
          const r = sqlDb.exec("SELECT last_insert_rowid()");
          return { lastInsertRowid: r[0]?.values[0][0] || 0, changes: 1 };
        },
        get(...p) {
          const s = sqlDb.prepare(sql);
          s.bind(Array.isArray(p[0]) ? p[0] : p);
          if (s.step()) {
            const cols = s.getColumnNames(), vals = s.get();
            s.free();
            const o = {}; cols.forEach((c,i) => o[c] = vals[i]);
            return o;
          }
          s.free(); return undefined;
        },
        all(...p) {
          const rows = [], s = sqlDb.prepare(sql);
          s.bind(Array.isArray(p[0]) ? p[0] : p);
          while(s.step()) {
            const cols = s.getColumnNames(), vals = s.get();
            const o = {}; cols.forEach((c,i) => o[c] = vals[i]);
            rows.push(o);
          }
          s.free(); return rows;
        }
      };
    },
    pragma() { return this; },
    close() { saveDB(); sqlDb.close(); },
    // Expose direct save for critical operations
    saveNow() { saveDB(); }
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS membres(id INTEGER PRIMARY KEY AUTOINCREMENT,prenom TEXT NOT NULL,nom TEXT NOT NULL,telephone TEXT UNIQUE NOT NULL,tel2 TEXT DEFAULT '',taxi TEXT DEFAULT '',adhesion TEXT DEFAULT '',pin_hash TEXT DEFAULT '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',statut TEXT DEFAULT 'actif',notes TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')),updated_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS cotisations(id INTEGER PRIMARY KEY AUTOINCREMENT,membre_id INTEGER NOT NULL,mois TEXT NOT NULL,montant INTEGER NOT NULL,mode TEXT DEFAULT 'Espèces',date TEXT NOT NULL,saisi_par TEXT DEFAULT '',ref_recu TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS produits(id INTEGER PRIMARY KEY AUTOINCREMENT,nom TEXT NOT NULL,categorie TEXT NOT NULL,icon TEXT DEFAULT '📦',prix_achat INTEGER DEFAULT 0,prix_vente INTEGER DEFAULT 0,stock INTEGER DEFAULT 0,description TEXT DEFAULT '',actif INTEGER DEFAULT 1,image_b64 TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS credits(id INTEGER PRIMARY KEY AUTOINCREMENT,client TEXT NOT NULL,telephone TEXT DEFAULT '',type TEXT NOT NULL,produit_id INTEGER,prix_vente INTEGER NOT NULL,montant_recu INTEGER DEFAULT 0,restant INTEGER NOT NULL,statut TEXT DEFAULT 'En cours',client_type TEXT DEFAULT 'externe',membre_id INTEGER,garant TEXT DEFAULT '',garant_id INTEGER,autorise_par TEXT DEFAULT '',date_vente TEXT NOT NULL,created_at TEXT DEFAULT(datetime('now')),updated_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS versements(id INTEGER PRIMARY KEY AUTOINCREMENT,credit_id INTEGER NOT NULL,montant INTEGER NOT NULL,mode TEXT DEFAULT 'Espèces',date TEXT NOT NULL,note TEXT DEFAULT '',ref_recu TEXT DEFAULT '',saisi_par TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS journal_caisse(id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT UNIQUE NOT NULL,date TEXT NOT NULL,client TEXT DEFAULT '',type TEXT NOT NULL,designation TEXT DEFAULT '',mode TEXT DEFAULT 'Espèces',entree INTEGER DEFAULT 0,sortie INTEGER DEFAULT 0,credit_id INTEGER,membre_id INTEGER,note TEXT DEFAULT '',saisi_par TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS banque(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,designation TEXT NOT NULL,banque TEXT DEFAULT 'CMS',entree INTEGER DEFAULT 0,sortie INTEGER DEFAULT 0,ref TEXT DEFAULT '',saisi_par TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS depenses(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,designation TEXT NOT NULL,montant INTEGER NOT NULL,categorie TEXT DEFAULT 'Admin',saisi_par TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS taxi_versements(id INTEGER PRIMARY KEY AUTOINCREMENT,periode TEXT NOT NULL,entree INTEGER DEFAULT 0,sortie INTEGER DEFAULT 0,observation TEXT DEFAULT '',date TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS staff(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,pin_hash TEXT NOT NULL,role TEXT NOT NULL,nom TEXT DEFAULT '',actif INTEGER DEFAULT 1);
`;

function seed(dbw) {
  if (!dbw.prepare('SELECT 1 FROM staff LIMIT 1').get()) {
    const h0=bcrypt.hashSync('0000',10),hc=bcrypt.hashSync('2025',10);
    dbw.prepare('INSERT INTO staff(username,pin_hash,role,nom)VALUES(?,?,?,?)').run('directeur',h0,'directeur','Directeur GIE');
    dbw.prepare('INSERT INTO staff(username,pin_hash,role,nom)VALUES(?,?,?,?)').run('caissier',hc,'caissier','Caissier GIE');
    dbw.prepare('INSERT INTO staff(username,pin_hash,role,nom)VALUES(?,?,?,?)').run('president',h0,'president','Président GIE');
    saveDB(); console.log('✅ Staff créé');
  }
  if (!dbw.prepare('SELECT 1 FROM produits LIMIT 1').get()) {
    const ins=dbw.prepare('INSERT INTO produits(nom,categorie,icon,prix_achat,prix_vente,stock,description)VALUES(?,?,?,?,?,?,?)');
    [['Batterie SOLANCE','BATTERIE','🔋',33000,45000,7,'12V'],['Batterie SISA','BATTERIE','🔋',27000,40000,5,''],['Smartphone Spark 40','TELEPHONE','📱',57000,80000,3,'128Go'],['Smartphone A16','TELEPHONE','📱',74000,100000,2,'Samsung'],['Smartphone POP 10','TELEPHONE','📱',47500,65000,1,''],['Huile moteur 5L','HUILE','🛢️',9500,13000,0,'5L'],['Assurance taxi 1 mois','ASSURANCE','🛡️',0,21000,0,'']].forEach(p=>ins.run(...p));
    saveDB(); console.log('✅ Produits créés');
  }
  if (!dbw.prepare('SELECT 1 FROM membres LIMIT 1').get()) {
    const dp=bcrypt.hashSync('1234',10);
    const ins=dbw.prepare('INSERT OR IGNORE INTO membres(id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes,pin_hash)VALUES(?,?,?,?,?,?,?,?,?,?)');
    [
    [1,'DAOUDA','NDIAYE','776351010','','','2024-09-01','actif',''],
    [2,'GORA','GUEYE','775919566','','','2024-09-01','actif',''],
    [3,'CHEIKH A .B','THIAM','774414821','','','2024-09-01','actif',''],
    [5,'SERIGNE','CISSE','770330761','','','2024-09-01','actif',''],
    [7,'MAMADOU LAMINE','GOUDIABY','779186799','','','2024-09-01','actif',''],
    [8,'CHEIKH','DIOP','777526770','765951211','','2024-09-01','actif',''],
    [9,'CHERIF','CORREA','772146324','','','2024-09-01','actif',''],
    [10,'DAOUDA','DIOUF','777033600','768889920','','2024-09-01','actif',''],
    [11,'AZIZ','DIONE','775409070','','','2024-09-01','actif',''],
    [14,'ADAMA','DIOUF','776872780','','','2024-09-01','actif',''],
    [16,'IBRAHIMA','SENE','775989102','','','2024-09-01','actif',''],
    [17,'SIDY','NIANE','770247233','','','2024-09-01','actif',''],
    [18,'BABA','NGOM','784706758','','','2024-09-01','actif',''],
    [19,'AMADOU','DIA','778116383','','','2024-09-01','actif',''],
    [20,'SERIGNE ASSANE','DIOUF','780174669','','','2024-09-01','actif',''],
    [22,'NAR','NDIAYE','772873155','','','2024-09-01','actif',''],
    [23,'YAYA','DIALLO','772075967','','','2024-09-01','actif',''],
    [25,'LAMP','DIOUF','777977407','','','2024-09-01','actif',''],
    [26,'DJIBY','GUEYE','775529648','','','2024-09-01','actif',''],
    [29,'MOR','DIENG','775858522','','','2024-09-01','actif',''],
    [30,'DAME','SARR','775738861','','','2024-09-01','actif',''],
    [31,'ALIOU','YADE','775360684','775703176','','2024-09-01','actif',''],
    [33,'SALIOU','DIOUF','776550759','','','2024-09-01','actif',''],
    [34,'BOUBACAR','DIALLO','784202067','','','2024-09-01','actif',''],
    [35,'MOHAMADOU','GUEYE','773815985','','','2024-09-01','actif',''],
    [37,'PAPA MODOU','FAYE','774011776','','','2024-09-01','actif',''],
    [38,'ABLAYE','NDIAYE','775345429','','','2024-09-01','actif',''],
    [39,'ABDOU','DIENG','770599914','','','2024-09-01','actif',''],
    [40,'SALIOU','FALL','784726923','','','2024-09-01','actif',''],
    [42,'MOUSSA LAYE','THIAW','779643335','','','2024-09-01','actif',''],
    [43,'YANKHOBA','BADIANE','776504249','','','2024-09-01','actif',''],
    [45,'MOUSTAPHA','NDOA','775129977','','','2024-09-01','actif',''],
    [49,'DAME','FALL','782083918','771938305','','2024-09-01','actif',''],
    [50,'CHEIKH','FALL','779399081','','','2024-09-01','actif',''],
    [51,'SERIGNE','SENE','775570349','','','2024-09-01','actif',''],
    [55,'MALICK','MBAYE','774283390','','','2024-09-01','actif',''],
    [56,'KHALY','THIAM','777977699','','','2024-09-01','actif',''],
    [57,'AMADOU DIA','MBAYE','754401863','','','2024-09-01','actif',''],
    [59,'NGAGNE DEMBA','DIOUF','774801689','','','2024-09-01','actif',''],
    [60,'BABACAR','NGOM','776592907','','','2024-09-01','actif',''],
    [62,'IBRAHIMA','WADE','775201389','','','2024-09-01','actif',''],
    [64,'PAPE DEMBA','GUEYE','776572039','','','2024-09-01','actif',''],
    [66,'MAKHTAR','FALL','774526677','','','2024-09-01','actif',''],
    [67,'GORA','DIOP','766990249','','','2024-09-01','actif',''],
    [70,'ABDOULAYE','DIAGNE','772359621','','','2024-09-01','actif',''],
    [71,'AMADOU','SECK','772418248','','','2024-09-01','actif',''],
    [72,'BASSIROU','GUEYE','774112068','','','2024-09-01','actif',''],
    [73,'LASSANA','COULIBALY','779881896','','','2024-09-01','actif',''],
    [74,'FAMARA','DIEME','775636819','','','2024-09-01','actif',''],
    [80,'IBRAHIMA','BOYE','709759573','','','2024-09-01','actif',''],
    [82,'MBAYE','LO','775557708','','','2024-09-01','actif',''],
    [83,'PAPE','NIANG','770776757','','','2024-09-01','actif',''],
    [84,'MASSAMBA','DIOUF','761822585','','','2024-09-01','actif',''],
    [86,'MOHAMET','NDOUR','773163940','','','2024-09-01','actif',''],
    [88,'MOR','WANE','766841627','','','2024-09-01','actif',''],
    [89,'MODOU','NDIAYE','765575884','','','2024-09-01','actif',''],
    [90,'MAMADOU','FALL','772449508','','','2024-09-01','actif',''],
    [91,'MAMADOU','SENE','783350294','','','2024-09-01','actif',''],
    [92,'CHEIKH','WADE','770669968','','','2024-09-01','actif',''],
    [94,'YELLI','GUEYE','778602044','','','2024-09-01','actif',''],
    [95,'TOUBA','WADE','761258546','','','2024-09-01','actif',''],
    [96,'MAMADOU','SARR','775342278','','','2024-09-01','actif',''],
    [97,'MODOU M','DIENG','765044528','','','2024-09-01','actif',''],
    [99,'NDIAGA','DIOP','772413924','','','2024-09-01','actif',''],
    [100,'NDIOUGA','SECK','773152023','','','2024-09-01','actif',''],
    [101,'IBOU','CISSE','779625659','','','2024-09-01','actif',''],
    [103,'IBRAHIMA','SY','777264140','','','2024-09-01','actif',''],
    [105,'MODOU','NGOM','770674933','','','2024-09-01','actif',''],
    [106,'GORA','NGOM','774318723','','','2024-09-01','actif',''],
    [107,'DEMBA G','MBENGUE','771241181','','','2024-09-01','actif',''],
    [108,'LAMINE','DIAGNE','772317572','','','2024-09-01','actif',''],
    [111,'KHADIM','MBODJI','766686818','','','2024-09-01','actif',''],
    [112,'FALLOU','MBENGUE','778210878','','','2024-09-01','actif',''],
    [113,'SOULEYMANE','BABOU','774570042','','','2024-09-01','actif',''],
    [114,'SENY','NGOM','770627146','','','2024-09-01','actif',''],
    [115,'MOUSTAPHA','KAIRE','770944621','','','2024-09-01','actif',''],
    [116,'NDIOGOU','SARR','775753489','','','2024-09-01','actif',''],
    [117,'ISSA','WADE','782306271','','','2024-09-01','actif',''],
    [118,'MOUHAMET','GADIAGA','775092181','','','2024-09-01','actif',''],
    [120,'ABDOULAHAT','DIOUF','777751747','','','2024-09-01','actif',''],
    [122,'MOUSSA 2','THIAW','777822740','','','2024-09-01','actif',''],
    [125,'MBAYE','GUEYE','764608964','','','2024-09-01','actif',''],
    [127,'CHEIKH','YADE','779628608','','','2024-09-01','actif',''],
    [128,'ALIOU','DIAGNE','782109516','','','2024-09-01','actif','']
  ].forEach(m=>ins.run(...m,dp));
    saveDB(); console.log('✅ 84 membres créés');
  }
  if (!dbw.prepare('SELECT 1 FROM cotisations LIMIT 1').get()) {
    const ins=dbw.prepare('INSERT INTO cotisations(membre_id,mois,montant,mode,date,saisi_par)VALUES(?,?,?,?,?,?)');
    [[1,'Janvier',2000],[1,'Février',2000],[1,'Mars',2000],[2,'Janvier',2000],[2,'Février',2000],[2,'Mars',2000],[2,'Avril',2000],[9,'Janvier',2000],[9,'Février',2000],[9,'Mars',2000],[14,'Janvier',2000],[14,'Février',2000],[14,'Mars',2000],[16,'Janvier',2000],[16,'Février',2000],[16,'Mars',2000],[22,'Janvier',2000],[22,'Février',2500],[22,'Mars',2000],[23,'Janvier',2000],[23,'Février',2000],[23,'Mars',2000],[25,'Janvier',2000],[25,'Février',2500],[25,'Mars',2500],[25,'Avril',2000],[30,'Janvier',2000],[30,'Février',2000],[30,'Mars',2000],[35,'Janvier',2000],[35,'Février',2000],[35,'Mars',2000],[35,'Avril',2000],[50,'Janvier',2000],[50,'Février',2000],[50,'Mars',2000],[50,'Avril',2000],[55,'Janvier',2000],[55,'Février',2000],[55,'Mars',2000],[60,'Janvier',2000],[60,'Février',2000],[60,'Mars',2000],[60,'Avril',2000],[66,'Janvier',2500],[66,'Février',2500],[66,'Mars',2500],[66,'Avril',2000],[90,'Janvier',2000],[90,'Février',2000],[90,'Mars',2000],[90,'Avril',2000],[90,'Mai',2000],[90,'Juin',2000],[90,'Juillet',2000],[90,'Août',2000],[90,'Septembre',2000],[90,'Octobre',2000],[90,'Novembre',2000],[90,'Décembre',2000],[95,'Janvier',2000],[95,'Février',2000],[95,'Mars',2000],[95,'Avril',2000],[95,'Mai',2000],[95,'Juin',2000],[95,'Juillet',2000],[95,'Août',2000],[95,'Septembre',2000],[95,'Octobre',2000],[95,'Novembre',2000],[95,'Décembre',2000],[103,'Janvier',2000],[103,'Février',2000],[103,'Mars',2000],[103,'Avril',2000],[103,'Mai',2000],[103,'Juin',2000],[103,'Juillet',2000],[103,'Août',2000],[103,'Septembre',2000],[103,'Octobre',2000],[103,'Novembre',2000],[103,'Décembre',2000],[125,'Janvier',2000],[125,'Février',2000],[125,'Mars',2000],[125,'Avril',2000]].forEach(([mid,mois,mt])=>ins.run(mid,mois,mt,'Espèces','2026-01-01','Import'));
    saveDB(); console.log('✅ Cotisations importées');
  }
  if (!dbw.prepare('SELECT 1 FROM banque LIMIT 1').get()) {
    const ins=dbw.prepare('INSERT INTO banque(date,designation,banque,entree,sortie,saisi_par)VALUES(?,?,?,?,?,?)');
    [['2025-02-19','VERSEMENT CMS','CMS',1000000,0],['2025-09-19','RETRAIT CMS','CMS',0,3905500],['2025-10-14','VERSEMENT TAXI','CMS',250000,0],['2026-02-10','VERSEMENT ACTIVITES','CMS',855000,0]].forEach(b=>ins.run(...b,'Import'));
  }
  if (!dbw.prepare('SELECT 1 FROM journal_caisse LIMIT 1').get()) {
    const ins=dbw.prepare('INSERT INTO journal_caisse(ref,date,client,type,designation,mode,entree,sortie,saisi_par)VALUES(?,?,?,?,?,?,?,?,?)');
    [['R-0001','2026-01-01','GIE','COTISATION','Cotisations Janvier 2026','Espèces',231000,0],['R-0002','2026-02-01','GIE','COTISATION','Cotisations Février 2026','Espèces',106500,0],['R-0003','2026-03-01','GIE','COTISATION','Cotisations Mars 2026','Espèces',111500,0]].forEach(j=>ins.run(...j,'Import'));
  }
  if (!dbw.prepare('SELECT 1 FROM taxi_versements LIMIT 1').get()) {
    const ins=dbw.prepare('INSERT INTO taxi_versements(periode,entree,sortie,observation,date)VALUES(?,?,?,?,?)');
    [['DU 08-14 SEPT 2025',45000,55000,'','2025-09-08'],['DU 15-21 SEPT 2025',65000,0,'','2025-09-15'],['DU 22-28 SEPT 2025',90000,0,'','2025-09-22'],['DU 13-19 OCT 2025',90000,0,'','2025-10-13'],['DU 10-16 NOV 2025',90000,0,'','2025-11-10'],['DU 02-08 FEV 2026',90000,19000,'','2026-02-02'],['DU 16-22 FEV 2026',90000,16500,'assurance','2026-02-16'],['DU 02-08 MARS 2026',72000,25000,'engine oil','2026-03-02'],['DU 30-05 AVR 2026',60000,42000,'pneu','2026-03-30']].forEach(t=>ins.run(...t));
  }
  saveDB();
  console.log('✅ Seed complet');
}

let dbWrapper = null;
async function getDB() {
  if (dbWrapper) return dbWrapper;
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('✅ DB chargée depuis', DB_PATH, `(${(fs.statSync(DB_PATH).size/1024).toFixed(1)} KB)`);
  } else {
    sqlDb = new SQL.Database();
    console.log('✅ Nouvelle DB créée');
  }
  dbWrapper = makeWrapper(sqlDb);
  dbWrapper.exec(SCHEMA);
  seed(dbWrapper);
  return dbWrapper;
}

module.exports = { getDB, saveDB };
