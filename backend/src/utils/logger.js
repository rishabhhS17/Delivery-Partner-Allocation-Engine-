// ─── JSON line logger ────────────────────────────────────────────────────────
// One JSON object per line, so Render's log search can filter by field (orderId, riderId, …):
//   {"time":"…","level":"warn","component":"engine","msg":"order TTL expired","orderId":"…"}

function write(level, component, msg, fields = {}) {
  const line = { time: new Date().toISOString(), level, component, msg };
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) line[key] = { message: value.message, stack: value.stack };
    else if (value !== undefined) line[key] = value; // ObjectIds serialise to their hex string
  }
  const json = JSON.stringify(line);
  if (level === 'error') console.error(json);
  else if (level === 'warn') console.warn(json);
  else console.log(json);
}

/** @param {string} component  e.g. 'engine', 'lease', 'bots', 'server', 'routing' */
export function createLogger(component) {
  return {
    info:  (msg, fields) => write('info', component, msg, fields),
    warn:  (msg, fields) => write('warn', component, msg, fields),
    error: (msg, fields) => write('error', component, msg, fields),
  };
}
