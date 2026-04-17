// Importer les crédits historiques dans la DB
// node import_credits.js
const S = require('./node_modules/sql.js');
const f = require('fs');
const DB = process.env.DB_PATH || '/data/gie.db';

const credits = [
  // ── HUILE ──
  {client:'SIDY', type:'HUILE', prix_vente:13000, montant_recu:0, garant:''},
  {client:'AZIZ NDIONE', type:'HUILE', prix_vente:13000, montant_recu:0, garant:''},

  // ── ÉLECTROMÉNAGER ──
  {client:'MAMADOU TOURE', type:'ELECTROMENAGER', prix_vente:70000, montant_recu:50000, garant:''},
  {client:'MODOU BOU ALADJI YOFF', type:'ELECTROMENAGER', prix_vente:80000, montant_recu:60000, garant:''},
  {client:'MADIOUGUE ISSA', type:'ELECTROMENAGER', prix_vente:100000, montant_recu:0, garant:''},
  {client:'IBRAHIMA SENE', type:'ELECTROMENAGER', prix_vente:120000, montant_recu:100000, garant:''},
  {client:'MODOU NDIAYE', type:'ELECTROMENAGER', prix_vente:80000, montant_recu:60000, garant:''},
  {client:'AMADOU GUEYE BAMBA', type:'ELECTROMENAGER', prix_vente:80000, montant_recu:40000, garant:''},
  {client:'AMADOU DIA', type:'ELECTROMENAGER', prix_vente:70000, montant_recu:40000, garant:''},
  {client:'ISSA MOUSTAPHA DIOUF', type:'ELECTROMENAGER', prix_vente:60000, montant_recu:50000, garant:''},
  {client:'ADAMA SARR', type:'ELECTROMENAGER', prix_vente:80000, montant_recu:65000, garant:'ISSA WADE'},
  {client:'BIRANE', type:'ELECTROMENAGER', prix_vente:70000, montant_recu:40000, garant:''},
  {client:'MOUSTAPHA TINE', type:'ELECTROMENAGER', prix_vente:80000, montant_recu:55000, garant:''},
  {client:'MODOU DIOUF', type:'ELECTROMENAGER', prix_vente:100000, montant_recu:70000, garant:''},
  {client:'OMAR AZIZ NDIONE', type:'ELECTROMENAGER', prix_vente:80000, montant_recu:55000, garant:''},
  {client:'MODOU BAMBA', type:'ELECTROMENAGER', prix_vente:90000, montant_recu:40000, garant:''},
  {client:'FALLOU DAOUDA DIOUF', type:'ELECTROMENAGER', prix_vente:90000, montant_recu:75000, garant:''},
  {client:'IBRAHIMA BAMBA', type:'ELECTROMENAGER', prix_vente:90000, montant_recu:75000, garant:''},
  {client:'ABDOU DIOUF', type:'ELECTROMENAGER', prix_vente:72500, montant_recu:30000, garant:''},
  {client:'KEBA MOUSTAPHA DIOUF', type:'ELECTROMENAGER', prix_vente:65000, montant_recu:20000, garant:''},
  {client:'BIRAME', type:'ELECTROMENAGER', prix_vente:90000, montant_recu:10000, garant:''},
  {client:'KHAKHIM MODJI', type:'ELECTROMENAGER', prix_vente:90000, montant_recu:10000, garant:''},
  {client:'CERIF CORRE', type:'ELECTROMENAGER', prix_vente:215000, montant_recu:0, garant:''},

  // ── BATTERIES ──
  {client:'ABDOU NAMA', type:'BATTERIE', prix_vente:42500, montant_recu:33000, garant:''},
  {client:'THOY YELLI', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'GORA POUYE', type:'BATTERIE', prix_vente:40000, montant_recu:20000, garant:'MOHAMED NDIOUR'},
  {client:'AROUNA MOUSTAPHA DIOUF', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'SERIGNE CISSE', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'MODOU NGOM', type:'BATTERIE', prix_vente:42000, montant_recu:30000, garant:''},
  {client:'MACOUBA BAMBA', type:'BATTERIE', prix_vente:40000, montant_recu:18000, garant:''},
  {client:'IBRAHIMA NDIAYE', type:'BATTERIE', prix_vente:40000, montant_recu:20000, garant:'NAR NDIAYE'},
  {client:'BADARA NDIAYE', type:'BATTERIE', prix_vente:45000, montant_recu:10000, garant:''},
  {client:'RAMA', type:'BATTERIE', prix_vente:45000, montant_recu:35000, garant:''},
  {client:'MALICK MBAYE', type:'BATTERIE', prix_vente:45000, montant_recu:30000, garant:''},
  {client:'GORA GUEYE', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'KHALY THIAM', type:'BATTERIE', prix_vente:40000, montant_recu:20000, garant:''},
  {client:'IBRAHIMA SENE', type:'BATTERIE', prix_vente:45000, montant_recu:30000, garant:''},
  {client:'SENY NGOM', type:'BATTERIE', prix_vente:45000, montant_recu:30000, garant:''},
  {client:'AZIZ NDIONE', type:'BATTERIE', prix_vente:45000, montant_recu:20000, garant:''},
  {client:'CHEIKH A.B. THIAM', type:'BATTERIE', prix_vente:45000, montant_recu:30000, garant:''},
  {client:'INCONNU', type:'BATTERIE', prix_vente:40000, montant_recu:10000, garant:''},
  {client:'IBOU SY', type:'BATTERIE', prix_vente:40000, montant_recu:10000, garant:''},
  {client:'MODOU MOUSTAPHA DIOUF', type:'BATTERIE', prix_vente:40000, montant_recu:15000, garant:''},
  {client:'MAMADOU SENE', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'IBRAHIMA SENE (2)', type:'BATTERIE', prix_vente:40000, montant_recu:10000, garant:''},
  {client:'MOUSSA THIAW LAYE', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'BADARA MOUSTAPHA DIOUF', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'CERIF CORREA', type:'BATTERIE', prix_vente:40000, montant_recu:10000, garant:''},
  {client:'IBRAHIMA BOYE', type:'BATTERIE', prix_vente:40000, montant_recu:30000, garant:''},
  {client:'ELADJI SENE', type:'BATTERIE', prix_vente:40000, montant_recu:10000, garant:''},
  {client:'MOR WANE', type:'BATTERIE', prix_vente:45000, montant_recu:0, garant:''},
  {client:'IBOU SY (AA743SQ)', type:'BATTERIE', prix_vente:40000, montant_recu:10000, garant:''},

  // ── ASSURANCE ──
  {client:'MALICK MBAYE', type:'ASSURANCE', prix_vente:21500, montant_recu:18500, garant:'AA339FT'},
  {client:'C M T T', type:'ASSURANCE', prix_vente:46076, montant_recu:500, garant:'025JZ'},
  {client:'MALICK MBAYE', type:'ASSURANCE', prix_vente:21500, montant_recu:21000, garant:'AA339FT'},
  {client:'BASSIROU CISSE', type:'ASSURANCE', prix_vente:21500, montant_recu:5000, garant:'DK2528AM'},
  {client:'MALICK MBAYE', type:'ASSURANCE', prix_vente:21500, montant_recu:15000, garant:'AA339FT'},
  {client:'MALICK MBAYE', type:'ASSURANCE', prix_vente:21500, montant_recu:10000, garant:'AA339FT'},
  {client:'IBRAHIMA WADE', type:'ASSURANCE', prix_vente:16500, montant_recu:0, garant:'AA804JE'},
  {client:'BASSIROU CISSE', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'DK2528AM'},
  {client:'C M T T', type:'ASSURANCE', prix_vente:16500, montant_recu:0, garant:'AA777JE'},
  {client:'IBRAHIMA FALL', type:'ASSURANCE', prix_vente:21500, montant_recu:21433, garant:'AA341TQ'},
  {client:'MBAYE LO', type:'ASSURANCE', prix_vente:16500, montant_recu:10000, garant:'DK0687AY'},
  {client:'IBRAHIMA WADE', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'AA250YF'},
  {client:'IBRAHIMA WADE', type:'ASSURANCE', prix_vente:16318, montant_recu:0, garant:'804JE'},
  {client:'CMTT', type:'ASSURANCE', prix_vente:16318, montant_recu:10000, garant:'AA169JF'},
  {client:'MALICK MBAYE', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'AA339FT'},
  {client:'GIE', type:'ASSURANCE', prix_vente:16318, montant_recu:0, garant:'AA292RZ'},
  {client:'SERIGNE MODOU MBODJI', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'AA922TQ'},
  {client:'C M TT', type:'ASSURANCE', prix_vente:16318, montant_recu:0, garant:'25'},
  {client:'LAITY NDIAYE', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'AB103DW'},
  {client:'CMTT', type:'ASSURANCE', prix_vente:16318, montant_recu:0, garant:'AA512SF'},
  {client:'BASSIROU CISSE', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'DK2528AM'},
  {client:'SENIRAN AUTO', type:'ASSURANCE', prix_vente:16318, montant_recu:0, garant:'AA777JE'},
  {client:'MOR WANE', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'AA878QD'},
  {client:'IBRAHIMA FALL', type:'ASSURANCE', prix_vente:21500, montant_recu:0, garant:'AA341TQ'},
  {client:'TNF TRANSPORT NDONGO FALL', type:'ASSURANCE', prix_vente:16318, montant_recu:0, garant:'AA081JZ'},
];

S().then(SQL => {
  const db = new SQL.Database(f.readFileSync(DB));
  const ins = db.prepare(`INSERT INTO credits(client,telephone,type,produit_id,prix_vente,montant_recu,restant,statut,client_type,membre_id,garant,garant_id,autorise_par,date_vente)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let ok = 0;
  credits.forEach(c => {
    const restant = c.prix_vente - c.montant_recu;
    const statut = restant <= 0 ? 'Soldé' : 'En cours';
    ins.run(c.client,'',c.type,null,c.prix_vente,c.montant_recu,restant,statut,'externe',null,c.garant||'',null,'Import historique','2025-09-01');
    ok++;
  });

  const total = db.exec("SELECT COUNT(*) FROM credits")[0].values[0][0];
  const encours = db.exec("SELECT COUNT(*),SUM(restant) FROM credits WHERE statut='En cours'")[0].values[0];
  
  f.writeFileSync(DB, Buffer.from(db.export()));
  console.log(`✅ ${ok} crédits importés`);
  console.log(`📊 Total DB: ${total} crédits`);
  console.log(`⚠️  En cours: ${encours[0]} crédits · Restant: ${Number(encours[1]).toLocaleString('fr-FR')} F`);
});
