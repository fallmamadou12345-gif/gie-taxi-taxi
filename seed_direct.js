
const initSqlJs = require('/opt/render/project/src/node_modules/sql.js');
const bcrypt = require('/opt/render/project/src/node_modules/bcryptjs');
const fs = require('fs');

const DB_PATH = '/data/gie.db';

async function run() {
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('DB chargée, taille:', fs.statSync(DB_PATH).size, 'bytes');
  } else {
    console.log('DB introuvable!');
    process.exit(1);
  }

  // Check current state
  const n = db.exec("SELECT COUNT(*) FROM membres")[0]?.values[0][0];
  const s = db.exec("SELECT COUNT(*) FROM staff")[0]?.values[0][0];
  console.log('Membres actuels:', n, '| Staff:', s);

  const h0 = bcrypt.hashSync('0000', 8);
  const hc = bcrypt.hashSync('2025', 8);
  const dp = bcrypt.hashSync('1234', 8);

  // Insert staff
  if (s === 0) {
    db.run("INSERT OR IGNORE INTO staff(username,pin_hash,role,nom) VALUES(?,?,?,?)", ['directeur',h0,'directeur','Directeur GIE']);
    db.run("INSERT OR IGNORE INTO staff(username,pin_hash,role,nom) VALUES(?,?,?,?)", ['caissier',hc,'caissier','Caissier GIE']);
    db.run("INSERT OR IGNORE INTO staff(username,pin_hash,role,nom) VALUES(?,?,?,?)", ['president',h0,'president','Président GIE']);
    console.log('✅ Staff inséré');
  }

  // Insert produits
  const p = db.exec("SELECT COUNT(*) FROM produits")[0]?.values[0][0];
  if (p === 0) {
    const prods = [
      ['Batterie SOLANCE','BATTERIE','🔋',33000,45000,7,'12V'],
      ['Batterie SISA','BATTERIE','🔋',27000,40000,5,''],
      ['Smartphone Spark 40','TELEPHONE','📱',57000,80000,3,'128Go'],
      ['Smartphone A16','TELEPHONE','📱',74000,100000,2,'Samsung'],
      ['Smartphone POP 10','TELEPHONE','📱',47500,65000,1,''],
      ['Huile moteur 5L','HUILE','🛢️',9500,13000,0,'5L'],
      ['Assurance taxi 1 mois','ASSURANCE','🛡️',0,21000,0,'']
    ];
    prods.forEach(pr => db.run("INSERT INTO produits(nom,categorie,icon,prix_achat,prix_vente,stock,description) VALUES(?,?,?,?,?,?,?)", pr));
    console.log('✅ Produits insérés');
  }

  // Insert membres
  const membres = [
[1,'DAOUDA','NDIAYE','776351010',''],[2,'GORA','GUEYE','775919566',''],[3,'CHEIKH A .B','THIAM','774414821',''],[5,'SERIGNE','CISSE','770330761',''],[7,'MAMADOU LAMINE','GOUDIABY','779186799',''],[8,'CHEIKH','DIOP','777526770','765951211'],[9,'CHERIF','CORREA','772146324',''],[10,'DAOUDA','DIOUF','777033600','768889920'],[11,'AZIZ','DIONE','775409070',''],[14,'ADAMA','DIOUF','776872780',''],[16,'IBRAHIMA','SENE','775989102',''],[17,'SIDY','NIANE','770247233',''],[18,'BABA','NGOM','784706758',''],[19,'AMADOU','DIA','778116383',''],[20,'SERIGNE ASSANE','DIOUF','780174669',''],[22,'NAR','NDIAYE','772873155',''],[23,'YAYA','DIALLO','772075967',''],[25,'LAMP','DIOUF','777977407',''],[26,'DJIBY','GUEYE','775529648',''],[29,'MOR','DIENG','775858522',''],[30,'DAME','SARR','775738861',''],[31,'ALIOU','YADE','775360684','775703176'],[33,'SALIOU','DIOUF','776550759',''],[34,'BOUBACAR','DIALLO','784202067',''],[35,'MOHAMADOU','GUEYE','773815985',''],[37,'PAPA MODOU','FAYE','774011776',''],[38,'ABLAYE','NDIAYE','775345429',''],[39,'ABDOU','DIENG','770599914',''],[40,'SALIOU','FALL','784726923',''],[42,'MOUSSA LAYE','THIAW','779643335',''],[43,'YANKHOBA','BADIANE','776504249',''],[45,'MOUSTAPHA','NDOA','775129977',''],[49,'DAME','FALL','782083918','771938305'],[50,'CHEIKH','FALL','779399081',''],[51,'SERIGNE','SENE','775570349',''],[55,'MALICK','MBAYE','774283390',''],[56,'KHALY','THIAM','777977699',''],[57,'AMADOU DIA','MBAYE','754401863',''],[59,'NGAGNE DEMBA','DIOUF','774801689',''],[60,'BABACAR','NGOM','776592907',''],[62,'IBRAHIMA','WADE','775201389',''],[64,'PAPE DEMBA','GUEYE','776572039',''],[66,'MAKHTAR','FALL','774526677',''],[67,'GORA','DIOP','766990249',''],[70,'ABDOULAYE','DIAGNE','772359621',''],[71,'AMADOU','SECK','772418248',''],[72,'BASSIROU','GUEYE','774112068',''],[73,'LASSANA','COULIBALY','779881896',''],[74,'FAMARA','DIEME','775636819',''],[80,'IBRAHIMA','BOYE','709759573',''],[82,'MBAYE','LO','775557708',''],[83,'PAPE','NIANG','770776757',''],[84,'MASSAMBA','DIOUF','761822585',''],[86,'MOHAMET','NDOUR','773163940',''],[88,'MOR','WANE','766841627',''],[89,'MODOU','NDIAYE','765575884',''],[90,'MAMADOU','FALL','772449508',''],[91,'MAMADOU','SENE','783350294',''],[92,'CHEIKH','WADE','770669968',''],[94,'YELLI','GUEYE','778602044',''],[95,'TOUBA','WADE','761258546',''],[96,'MAMADOU','SARR','775342278',''],[97,'MODOU M','DIENG','765044528',''],[99,'NDIAGA','DIOP','772413924',''],[100,'NDIOUGA','SECK','773152023',''],[101,'IBOU','CISSE','779625659',''],[103,'IBRAHIMA','SY','777264140',''],[105,'MODOU','NGOM','770674933',''],[106,'GORA','NGOM','774318723',''],[107,'DEMBA G','MBENGUE','771241181',''],[108,'LAMINE','DIAGNE','772317572',''],[111,'KHADIM','MBODJI','766686818',''],[112,'FALLOU','MBENGUE','778210878',''],[113,'SOULEYMANE','BABOU','774570042',''],[114,'SENY','NGOM','770627146',''],[115,'MOUSTAPHA','KAIRE','770944621',''],[116,'NDIOGOU','SARR','775753489',''],[117,'ISSA','WADE','782306271',''],[118,'MOUHAMET','GADIAGA','775092181',''],[120,'ABDOULAHAT','DIOUF','777751747',''],[122,'MOUSSA 2','THIAW','777822740',''],[125,'MBAYE','GUEYE','764608964',''],[127,'CHEIKH','YADE','779628608',''],[128,'ALIOU','DIAGNE','782109516','']
  ];

  membres.forEach(([id,prenom,nom,tel,tel2]) => {
    db.run("INSERT OR IGNORE INTO membres(id,prenom,nom,telephone,tel2,taxi,adhesion,statut,notes,pin_hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [id,prenom,nom,tel,tel2||'','','2024-09-01','actif','',dp]);
  });

  // Verify
  const newN = db.exec("SELECT COUNT(*) FROM membres")[0]?.values[0][0];
  const newS = db.exec("SELECT COUNT(*) FROM staff")[0]?.values[0][0];
  console.log('✅ Membres:', newN, '| Staff:', newS);

  // Save
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log('✅ DB sauvegardée:', fs.statSync(DB_PATH).size, 'bytes');
}

run().catch(e => { console.error('ERREUR:', e); process.exit(1); });
