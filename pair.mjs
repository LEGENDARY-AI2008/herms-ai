// WhatsApp pairing-code helper. Usage: node pair.mjs 2348XXXXXXXXX
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const number = (process.argv[2] || '').replace(/\D/g, '');
if (!number) { console.error('Usage: node pair.mjs <number with country code>'); process.exit(1); }

const HOME = process.env.HERMES_HOME || '/opt/data';
const SESSION = path.join(HOME, 'platforms', 'whatsapp', 'session');
const CODE = '/tmp/pair-code.txt', STATUS = '/tmp/pair-status.txt', BACKUP = '/tmp/pair-backup.b64';
const PAIR_DEPS = '/tmp/pairdeps';

// Start every pairing with a clean session. Old half-finished login files cause "logged out".
fs.rmSync(SESSION, { recursive: true, force: true });
fs.mkdirSync(SESSION, { recursive: true });
const setStatus = (s) => { fs.writeFileSync(STATUS, s); console.log('[pair]', s); };

function findBaileys() {
  try {
    const out = execSync(
      'find /opt /app /usr /root /home /tmp /var -type d -path "*node_modules/@whiskeysockets/baileys" 2>/dev/null | head -1',
      { timeout: 60000 }
    ).toString().trim();
    if (out) return out;
  } catch {}
  return null;
}

function npmInstall(spec) {
  try {
    execSync(`npm install --prefix ${PAIR_DEPS} ${spec} --no-audit --no-fund`,
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    return null;
  } catch (e) {
    const text = (String(e.stderr || '') + String(e.stdout || '') + String(e.message || '')).trim();
    return text.slice(-400);
  }
}

let dir = findBaileys();
if (!dir) {
  setStatus('installing WhatsApp library (first time only)');
  let err = npmInstall('@whiskeysockets/baileys@6.7.9');
  if (err) {
    console.log('[pair] first install failed:', err);
    setStatus('installing WhatsApp library (trying latest version)');
    err = npmInstall('@whiskeysockets/baileys@latest');
  }
  if (err) {
    setStatus('error: npm install failed: ' + err.replace(/\s+/g, ' ').slice(-300));
    process.exit(1);
  }
  dir = path.join(PAIR_DEPS, 'node_modules', '@whiskeysockets', 'baileys');
}

const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
let entry = pkg.main || 'lib/index.js';
const exp = pkg.exports && (pkg.exports['.'] || pkg.exports);
if (exp) {
  const e = typeof exp === 'string' ? exp : (exp.import || exp.default || exp.require);
  if (typeof e === 'string') entry = e;
  else if (e && typeof e === 'object') entry = e.default || e.import || entry;
}
const mod = await import(pathToFileURL(path.join(dir, entry)).href);
const lib = (mod.default && mod.default.makeWASocket) ? mod.default : mod;
const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = lib;

const noop = () => {};
const logger = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child() { return logger; } };

for (const f of [CODE, BACKUP]) { try { fs.unlinkSync(f); } catch {} }
setStatus('starting');
const deadline = setTimeout(() => { setStatus('timed out: code not entered in time'); process.exit(2); }, 5 * 60 * 1000);

let asked = false, tries = 0;
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION);
  if (state.creds.registered) { finish(); return; }
  let version;
  try { version = (await fetchLatestBaileysVersion()).version; } catch {}
  const sock = makeWASocket({
    auth: state, logger, version,
    browser: Browsers ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04.4'],
    printQRInTerminal: false, markOnlineOnConnect: false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && !asked && !state.creds.registered) {
      asked = true;
      try {
        const raw = await sock.requestPairingCode(number);
        const code = raw.length === 8 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
        fs.writeFileSync(CODE, code);
        setStatus('waiting: enter the code in WhatsApp > Linked devices > Link with phone number');
      } catch (e) { setStatus('error: ' + e.message); process.exit(1); }
    }
    if (connection === 'open') { setTimeout(finish, 3000); }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) { setStatus('error: logged out, try again'); process.exit(1); }
      if (++tries > 8) { setStatus('error: too many reconnects'); process.exit(1); }
      setTimeout(start, 1500); // includes restartRequired (515) after pairing
    }
  });
}

function finish() {
  try {
    const creds = fs.readFileSync(path.join(SESSION, 'creds.json'));
    fs.writeFileSync(BACKUP, creds.toString('base64'));
    setStatus('paired');
  } catch (e) { setStatus('error: creds not saved: ' + e.message); process.exit(1); }
  clearTimeout(deadline);
  process.exit(0);
}

start();