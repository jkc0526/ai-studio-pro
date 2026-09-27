import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('E:/work Buddy/weave-canvas/data/weave.db', { readOnly: true });
const v = db.prepare("SELECT purpose,provider_id,model_id,base_url FROM ai_config WHERE purpose='video'").get();
const p = v?.provider_id ? db.prepare('SELECT id,name,protocol,base_url FROM provider WHERE id=?').get(v.provider_id) : null;
const allp = db.prepare('SELECT id,name,protocol FROM provider').all();
db.close();
console.log('video ai_config =', JSON.stringify(v));
console.log('its provider    =', JSON.stringify(p));
console.log('all providers   =', JSON.stringify(allp, null, 1));
