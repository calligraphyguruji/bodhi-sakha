import fs from 'node:fs';
import pg from 'pg';
// Explicit offline-to-Postgres import: never runs during builds or function startup.
// Default is validation only. All inserts are one transaction; conflicts roll back.
const filename=process.argv.find(arg=>arg.startsWith('--file='))?.slice(7);
if (!filename) {console.error('Usage: npm run db:import -- --file=/absolute/path/db.json [--apply]');process.exit(1);}
const tables={
  users:['id','name','email','password_hash','avatar_url','created_at','updated_at'],
  conversations:['id','user_id','title','pinned','archived','created_at','updated_at'],
  messages:['id','conversation_id','role','content','model','metadata','created_at'],
  user_memory:['id','user_id','memory_key','memory_value','importance','created_at','updated_at'],
  uploaded_files:['id','user_id','conversation_id','file_name','file_type','file_size','storage_url','extracted_text','created_at'],
};
let pool;
try {
  const data=JSON.parse(fs.readFileSync(filename,'utf8'));
  for(const table of Object.keys(tables)) if(!Array.isArray(data[table]))throw new Error();
  console.log('Validated records:',Object.fromEntries(Object.keys(tables).map(table=>[table,data[table].length])));
  if(!process.argv.includes('--apply'))console.log('Validation only. Back up the database, then add --apply to import.');
  else {
    if(!process.env.DATABASE_URL)throw new Error();
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      for(const [table,allowed] of Object.entries(tables))for(const row of data[table]) {
        const columns=allowed.filter(column=>row[column]!==undefined);
        const values=columns.map(column=>column==='metadata' && row[column]!==null?JSON.stringify(row[column]):row[column]);
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')})`,values);
      }
      await client.query('COMMIT');console.log('Import complete. Source file was not modified.');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}catch{console.error('Import failed. Check the source format, DATABASE_URL, migrated schema, and duplicate IDs/emails. No partial transaction is committed.');process.exitCode=1;}
finally{if(pool)await pool.end();}
