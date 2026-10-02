// Tareas en segundo plano. En la PC corren libres; en Vercel cada función vive como mucho 300 s,
// así que se avisa a Vercel que espere (waitUntil) y las tareas largas cortan a tiempo y siguen después.
const onVercel = !!process.env.VERCEL;
let waitUntil = null;
try { ({ waitUntil } = require('@vercel/functions')); } catch { /* fuera de Vercel no hace falta */ }

function bg(p) {
  const safe = Promise.resolve(p).catch(e => console.log('Tarea en segundo plano:', e && e.message));
  if (onVercel && waitUntil) { try { waitUntil(safe); } catch { /* fuera de un pedido */ } }
  return p;
}
const BUDGET_MS = Number(process.env.JOB_BUDGET_MS) || (onVercel ? 265e3 : Infinity);
const deadline = (ms = BUDGET_MS) => Date.now() + ms;
const CUT_MSG = 'Se cortó por el límite de tiempo de Vercel (5 minutos). Lo hecho quedó guardado: tocá de nuevo y sigue desde donde quedó.';

module.exports = { onVercel, bg, deadline, BUDGET_MS, CUT_MSG };
