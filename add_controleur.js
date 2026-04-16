// Coller dans le Shell Render: node add_controleur.js
const S=require('./node_modules/sql.js');
const b=require('./node_modules/bcryptjs');
const f=require('fs');
const DB='/data/gie.db';
S().then(Q=>{
  const db=new Q.Database(f.readFileSync(DB));
  const pin=b.hashSync('1111',8);
  db.run("DELETE FROM staff WHERE username='controleur'");
  db.run("INSERT INTO staff(username,pin_hash,role,nom,actif)VALUES('controleur',?,'controleur','Contrôleur GIE',1)",[pin]);
  const n=db.exec("SELECT COUNT(*) FROM staff WHERE role='controleur'")[0].values[0][0];
  f.writeFileSync(DB,Buffer.from(db.export()));
  console.log('✅ Contrôleur créé, total:',n,'· PIN: 1111');
});
