// Cliente mínimo de Upstash Redis por REST (lo usa la versión en Vercel; en la PC no se usa).
const URL_ = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const enabled = !!(URL_ && TOKEN);

async function call(path, body) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(URL_ + path, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`Base de datos (Upstash) respondió ${r.status}: ${(data && data.error) || ''}`);
      return data;
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
  throw last;
}
// Un comando: cmd('GET', 'clave')
async function cmd(...args) {
  const d = await call('', args.map(String));
  if (d && d.error) throw new Error('Upstash: ' + d.error);
  return d ? d.result : null;
}
// Varios comandos en un viaje: pipeline([['SET','a','1'], ['GET','b']])
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const d = await call('/pipeline', cmds.map(c => c.map(String)));
  return (d || []).map(x => { if (x && x.error) throw new Error('Upstash: ' + x.error); return x ? x.result : null; });
}
const hashToObj = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };

module.exports = { enabled, cmd, pipeline, hashToObj };
