const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'fakturace.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db;

// Save DB to file periodically and on changes
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) { console.error('[DB Save Error]', e); }
  }, 500);
}

function forceSave() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) { console.error('[DB Save Error]', e); }
}

// Helper: run query and return rows as objects
function all(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function run(sql, params) {
  if (params) db.run(sql, params);
  else db.run(sql);
  scheduleSave();
}

async function main() {
  // Initialize sql.js
  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('[DB] Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS supplier (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT DEFAULT '', ico TEXT DEFAULT '', dic TEXT DEFAULT '',
      street TEXT DEFAULT '', city TEXT DEFAULT '', zip TEXT DEFAULT '',
      bank_account TEXT DEFAULT '', bank_code TEXT DEFAULT '',
      iban TEXT DEFAULT '', swift TEXT DEFAULT '',
      email TEXT DEFAULT '', phone TEXT DEFAULT '', web TEXT DEFAULT '',
      is_vat_payer INTEGER DEFAULT 0,
      number_format TEXT DEFAULT '{YYYY}{NNNN}',
      quote_number_format TEXT DEFAULT 'NAB{YYYY}/{NNN}',
      default_due_days INTEGER DEFAULT 14,
      default_quote_validity_days INTEGER DEFAULT 30,
      default_note TEXT DEFAULT '',
      default_quote_intro TEXT DEFAULT '',
      default_quote_outro TEXT DEFAULT '',
      currency TEXT DEFAULT 'CZK',
      logo_image TEXT DEFAULT '',
      logo_text TEXT DEFAULT '',
      vat_rates TEXT DEFAULT '[21,12,0]',
      units TEXT DEFAULT '["ks","hod","m","m²","m³","kg","l","komplet","den"]'
    )
  `);
  db.run("INSERT OR IGNORE INTO supplier (id) VALUES (1)");

  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, ico TEXT UNIQUE,
    dic TEXT DEFAULT '', street TEXT DEFAULT '', city TEXT DEFAULT '',
    zip TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
    note TEXT DEFAULT '', created_at TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, number TEXT NOT NULL,
    issue_date TEXT, due_date TEXT, taxable_date TEXT,
    payment_method TEXT DEFAULT 'bank',
    customer_data TEXT NOT NULL, items TEXT NOT NULL,
    note TEXT DEFAULT '', internal_note TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    paid_date TEXT, sent_date TEXT, recurring_id TEXT, quote_id TEXT,
    created_at TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, number TEXT NOT NULL,
    issue_date TEXT, valid_until TEXT,
    customer_data TEXT NOT NULL, items TEXT NOT NULL,
    intro_text TEXT DEFAULT '', outro_text TEXT DEFAULT '',
    note TEXT DEFAULT '', internal_note TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    discount_percent REAL DEFAULT 0,
    sent_date TEXT, approved_date TEXT, rejected_date TEXT, invoice_id TEXT,
    created_at TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS recurrings (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '',
    customer_data TEXT NOT NULL, items TEXT NOT NULL,
    recurrence TEXT DEFAULT 'monthly', next_date TEXT NOT NULL,
    active INTEGER DEFAULT 1, payment_method TEXT DEFAULT 'bank',
    note TEXT DEFAULT '', created_at TEXT DEFAULT ''
  )`);

  forceSave();

  // Migrations for existing DBs
  try { db.run("ALTER TABLE supplier ADD COLUMN vat_rates TEXT DEFAULT '[21,12,0]'"); forceSave(); } catch(e) {}
  try { db.run("ALTER TABLE supplier ADD COLUMN units TEXT DEFAULT '[\"ks\",\"hod\",\"m\",\"m²\",\"m³\",\"kg\",\"l\",\"komplet\",\"den\"]'"); forceSave(); } catch(e) {}

  // ═══ EXPRESS ═══
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'frontend')));

  const td = () => new Date().toISOString().slice(0, 10);

  // ─── ARES PROXY ─────────────────
  // Helper: fetch URL with redirect support
  function fetchUrl(url, maxRedirects) {
    maxRedirects = maxRedirects || 5;
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? require('https') : require('http');
      const opts = {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FakturaApp/2.1'
        },
        timeout: 15000
      };
      const req = mod.get(url, opts, (resp) => {
        // Follow redirects
        if ([301,302,303,307,308].includes(resp.statusCode) && resp.headers.location) {
          if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
          return fetchUrl(resp.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        }
        let body = '';
        resp.on('data', chunk => body += chunk);
        resp.on('end', () => resolve({ status: resp.statusCode, body: body }));
      });
      req.on('error', e => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  app.get('/api/ares/:ico', async (req, res) => {
    const ico = req.params.ico.replace(/\D/g, '');
    if (!ico || ico.length < 7 || ico.length > 8) {
      return res.json({ error: 'Invalid ICO: must be 7-8 digits' });
    }
    
    const url = `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`;
    console.log('[ARES] Looking up ICO:', ico);
    
    try {
      const result = await fetchUrl(url);
      console.log('[ARES] Response status:', result.status, 'body length:', result.body.length);
      
      if (result.status !== 200) {
        console.log('[ARES] Non-200 response:', result.body.substring(0, 200));
        return res.json({ error: 'ARES returned status ' + result.status });
      }
      
      let data;
      try { data = JSON.parse(result.body); } catch(e) {
        console.error('[ARES] JSON parse error. Body starts with:', result.body.substring(0, 200));
        return res.json({ error: 'Invalid response from ARES' });
      }
      
      const addr = data.sidlo || {};
      const street = [
        addr.nazevUlice,
        addr.cisloDomovni ? (addr.cisloDomovni + (addr.cisloOrientacni ? '/' + addr.cisloOrientacni : '')) : ''
      ].filter(Boolean).join(' ');
      
      const result_data = {
        name: data.obchodniJmeno || '',
        ico: data.ico || ico,
        dic: data.dic || '',
        street: street,
        city: addr.nazevObce || '',
        zip: addr.psc ? String(addr.psc) : ''
      };
      console.log('[ARES] Found:', result_data.name);
      res.json(result_data);
    } catch (err) {
      console.error('[ARES] Error for ICO', ico, ':', err.message, err.code || '');
      res.json({ error: 'Connection failed: ' + err.message });
    }
  });

  // Debug endpoint - test internet connectivity
  app.get('/api/ares-test', async (req, res) => {
    try {
      const result = await fetchUrl('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/00006947');
      res.json({ 
        ok: result.status === 200, 
        status: result.status, 
        bodyLength: result.body.length,
        preview: result.body.substring(0, 100)
      });
    } catch(err) {
      res.json({ ok: false, error: err.message, code: err.code || '' });
    }
  });

  // ─── SUPPLIER ──────────────────
  app.get('/api/supplier', (req, res) => {
    const r = get('SELECT * FROM supplier WHERE id=1');
    if (r) r.is_vat_payer = !!r.is_vat_payer;
    res.json(r || {});
  });

  app.put('/api/supplier', (req, res) => {
    const s = req.body;
    run(`UPDATE supplier SET name=?,ico=?,dic=?,street=?,city=?,zip=?,bank_account=?,bank_code=?,iban=?,swift=?,email=?,phone=?,web=?,is_vat_payer=?,number_format=?,quote_number_format=?,default_due_days=?,default_quote_validity_days=?,default_note=?,default_quote_intro=?,default_quote_outro=?,currency=?,logo_image=?,logo_text=?,vat_rates=?,units=? WHERE id=1`,
      [s.name||'',s.ico||'',s.dic||'',s.street||'',s.city||'',s.zip||'',s.bank_account||'',s.bank_code||'',s.iban||'',s.swift||'',s.email||'',s.phone||'',s.web||'',s.is_vat_payer?1:0,s.number_format||'{YYYY}{NNNN}',s.quote_number_format||"NAB{YYYY}/{NNN}",s.default_due_days||14,s.default_quote_validity_days||30,s.default_note||'',s.default_quote_intro||'',s.default_quote_outro||'',s.currency||'CZK',s.logo_image||'',s.logo_text||'',s.vat_rates||'[21,12,0]',s.units||'["ks","hod","m","m²","m³","kg","l","komplet","den"]']);
    res.json({ok:true});
  });

  // ─── CUSTOMERS ─────────────────
  app.get('/api/customers', (req, res) => res.json(all('SELECT * FROM customers ORDER BY name')));

  app.post('/api/customers', (req, res) => {
    const c = req.body;
    // Delete existing if same ICO, then insert
    const existing = get('SELECT id FROM customers WHERE ico=?', [c.ico]);
    if (existing) {
      run('UPDATE customers SET name=?,dic=?,street=?,city=?,zip=?,email=?,phone=?,note=? WHERE ico=?',
        [c.name,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.phone||'',c.note||'',c.ico]);
    } else {
      run('INSERT INTO customers (id,name,ico,dic,street,city,zip,email,phone,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [c.id||Date.now().toString(36),c.name,c.ico,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.phone||'',c.note||'',td()]);
    }
    res.json({ok:true});
  });

  app.delete('/api/customers/:id', (req, res) => { run('DELETE FROM customers WHERE id=?',[req.params.id]); res.json({ok:true}); });

  // ─── INVOICES ──────────────────
  function parseDoc(r) {
    try { r.customer = JSON.parse(r.customer_data); } catch { r.customer = {}; }
    try { r.items = JSON.parse(r.items); } catch { r.items = []; }
    return r;
  }

  app.get('/api/invoices', (req, res) => res.json(all('SELECT * FROM invoices ORDER BY created_at DESC').map(parseDoc)));

  app.post('/api/invoices', (req, res) => {
    const i = req.body;
    const existing = get('SELECT id FROM invoices WHERE id=?', [i.id]);
    if (existing) {
      run(`UPDATE invoices SET number=?,issue_date=?,due_date=?,taxable_date=?,payment_method=?,customer_data=?,items=?,note=?,internal_note=?,status=?,paid_date=?,sent_date=?,quote_id=? WHERE id=?`,
        [i.number||'',i.issue_date||'',i.due_date||'',i.taxable_date||'',i.payment_method||'bank',JSON.stringify(i.customer),JSON.stringify(i.items),i.note||'',i.internal_note||'',i.status||'new',i.paid_date||null,i.sent_date||null,i.quote_id||null,i.id]);
    } else {
      run(`INSERT INTO invoices (id,number,issue_date,due_date,taxable_date,payment_method,customer_data,items,note,internal_note,status,paid_date,sent_date,recurring_id,quote_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [i.id,i.number||'',i.issue_date||'',i.due_date||'',i.taxable_date||'',i.payment_method||'bank',JSON.stringify(i.customer),JSON.stringify(i.items),i.note||'',i.internal_note||'',i.status||'new',i.paid_date||null,i.sent_date||null,i.recurring_id||null,i.quote_id||null,i.created_at||td()]);
    }
    // Auto-save customer
    if (i.customer?.ico) {
      const c = i.customer;
      const ex = get('SELECT id FROM customers WHERE ico=?', [c.ico]);
      if (ex) run('UPDATE customers SET name=?,dic=?,street=?,city=?,zip=?,email=? WHERE ico=?', [c.name,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.ico]);
      else run('INSERT INTO customers (id,name,ico,dic,street,city,zip,email,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [c.id||Date.now().toString(36),c.name,c.ico,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',td()]);
    }
    res.json({ok:true});
  });

  app.patch('/api/invoices/:id/status', (req, res) => {
    const {status} = req.body;
    if (status === 'paid') run('UPDATE invoices SET status=?,paid_date=? WHERE id=?', [status, td(), req.params.id]);
    else if (status === 'sent') run('UPDATE invoices SET status=?,sent_date=? WHERE id=?', [status, td(), req.params.id]);
    else run('UPDATE invoices SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ok:true});
  });

  app.delete('/api/invoices/:id', (req, res) => { run('DELETE FROM invoices WHERE id=?', [req.params.id]); res.json({ok:true}); });

  // ─── QUOTES ────────────────────
  app.get('/api/quotes', (req, res) => res.json(all('SELECT * FROM quotes ORDER BY created_at DESC').map(parseDoc)));

  app.post('/api/quotes', (req, res) => {
    const q = req.body;
    const existing = get('SELECT id FROM quotes WHERE id=?', [q.id]);
    if (existing) {
      run(`UPDATE quotes SET number=?,issue_date=?,valid_until=?,customer_data=?,items=?,intro_text=?,outro_text=?,note=?,internal_note=?,status=?,discount_percent=?,sent_date=?,approved_date=?,rejected_date=?,invoice_id=? WHERE id=?`,
        [q.number||'',q.issue_date||'',q.valid_until||'',JSON.stringify(q.customer),JSON.stringify(q.items),q.intro_text||'',q.outro_text||'',q.note||'',q.internal_note||'',q.status||'draft',q.discount_percent||0,q.sent_date||null,q.approved_date||null,q.rejected_date||null,q.invoice_id||null,q.id]);
    } else {
      run(`INSERT INTO quotes (id,number,issue_date,valid_until,customer_data,items,intro_text,outro_text,note,internal_note,status,discount_percent,sent_date,approved_date,rejected_date,invoice_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [q.id,q.number||'',q.issue_date||'',q.valid_until||'',JSON.stringify(q.customer),JSON.stringify(q.items),q.intro_text||'',q.outro_text||'',q.note||'',q.internal_note||'',q.status||'draft',q.discount_percent||0,q.sent_date||null,q.approved_date||null,q.rejected_date||null,q.invoice_id||null,q.created_at||td()]);
    }
    // Auto-save customer
    if (q.customer?.ico) {
      const c = q.customer;
      const ex = get('SELECT id FROM customers WHERE ico=?', [c.ico]);
      if (ex) run('UPDATE customers SET name=?,dic=?,street=?,city=?,zip=?,email=? WHERE ico=?', [c.name,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.ico]);
      else run('INSERT INTO customers (id,name,ico,dic,street,city,zip,email,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [c.id||Date.now().toString(36),c.name,c.ico,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',td()]);
    }
    res.json({ok:true});
  });

  app.patch('/api/quotes/:id/status', (req, res) => {
    const {status} = req.body;
    if (status === 'sent') run('UPDATE quotes SET status=?,sent_date=? WHERE id=?', [status, td(), req.params.id]);
    else if (status === 'approved') run('UPDATE quotes SET status=?,approved_date=? WHERE id=?', [status, td(), req.params.id]);
    else if (status === 'rejected') run('UPDATE quotes SET status=?,rejected_date=? WHERE id=?', [status, td(), req.params.id]);
    else run('UPDATE quotes SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ok:true});
  });

  app.delete('/api/quotes/:id', (req, res) => { run('DELETE FROM quotes WHERE id=?', [req.params.id]); res.json({ok:true}); });

  // ─── RECURRINGS ────────────────
  app.get('/api/recurrings', (req, res) => res.json(all('SELECT * FROM recurrings ORDER BY next_date').map(r => { r.active = !!r.active; parseDoc(r); return r; })));

  app.post('/api/recurrings', (req, res) => {
    const r = req.body;
    const existing = get('SELECT id FROM recurrings WHERE id=?', [r.id]);
    if (existing) {
      run('UPDATE recurrings SET name=?,customer_data=?,items=?,recurrence=?,next_date=?,active=?,payment_method=?,note=? WHERE id=?',
        [r.name||'',JSON.stringify(r.customer),JSON.stringify(r.items),r.recurrence||'monthly',r.next_date,r.active?1:0,r.payment_method||'bank',r.note||'',r.id]);
    } else {
      run('INSERT INTO recurrings (id,name,customer_data,items,recurrence,next_date,active,payment_method,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [r.id,r.name||'',JSON.stringify(r.customer),JSON.stringify(r.items),r.recurrence||'monthly',r.next_date,r.active?1:0,r.payment_method||'bank',r.note||'',td()]);
    }
    res.json({ok:true});
  });

  app.delete('/api/recurrings/:id', (req, res) => { run('DELETE FROM recurrings WHERE id=?', [req.params.id]); res.json({ok:true}); });

  // ─── NUMBER GENERATORS ─────────
  function genNum(table, format, date) {
    const y = new Date(date).getFullYear(); const ys = String(y); const yy = ys.slice(2);
    const m = String(new Date(date).getMonth() + 1).padStart(2, '0');
    const rows = all(`SELECT number FROM ${table} WHERE number LIKE ?`, ['%' + ys + '%']);
    let max = 0;
    for (const r of rows) { const n = (r.number || '').replace(/\D/g, ''); const s = parseInt(n.slice(-4)) || 0; if (s > max) max = s; }
    const seq = String(max + 1);
    let num = format.replace('{YYYY}', ys).replace('{YY}', yy).replace('{MM}', m);
    num = num.replace(/\{N+\}/g, match => { const len = match.length - 2; return seq.padStart(len, '0'); });
    return num;
  }

  app.get('/api/next-number', (req, res) => {
    const sup = get('SELECT number_format FROM supplier WHERE id=1');
    res.json({ number: genNum('invoices', sup?.number_format || '{YYYY}{NNNN}', req.query.date || td()) });
  });

  app.get('/api/next-quote-number', (req, res) => {
    const sup = get('SELECT quote_number_format FROM supplier WHERE id=1');
    res.json({ number: genNum('quotes', sup?.quote_number_format || 'NAB{YYYY}/{NNN}', req.query.date || td()) });
  });

  // ─── EXPORT ────────────────────
  app.get('/api/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename=faktura-export-${td()}.json`);
    res.json({
      supplier: get('SELECT * FROM supplier WHERE id=1'),
      customers: all('SELECT * FROM customers'),
      invoices: all('SELECT * FROM invoices').map(parseDoc),
      quotes: all('SELECT * FROM quotes').map(parseDoc),
      recurrings: all('SELECT * FROM recurrings').map(r => { r.active = !!r.active; parseDoc(r); return r; }),
      exported_at: new Date().toISOString()
    });
  });

  app.post('/api/import', (req, res) => {
    const d = req.body;
    if (d.supplier) {
      const s = d.supplier;
      run(`UPDATE supplier SET name=?,ico=?,dic=?,street=?,city=?,zip=?,bank_account=?,bank_code=?,iban=?,swift=?,email=?,phone=?,web=?,is_vat_payer=?,number_format=?,currency=?,logo_image=?,logo_text=? WHERE id=1`,
        [s.name||'',s.ico||'',s.dic||'',s.street||'',s.city||'',s.zip||'',s.bank_account||'',s.bank_code||'',s.iban||'',s.swift||'',s.email||'',s.phone||'',s.web||'',s.is_vat_payer?1:0,s.number_format||'{YYYY}{NNNN}',s.currency||'CZK',s.logo_image||'',s.logo_text||'']);
    }
    if (d.invoices) for (const i of d.invoices) {
      run('DELETE FROM invoices WHERE id=?', [i.id]);
      run('INSERT INTO invoices (id,number,issue_date,due_date,taxable_date,payment_method,customer_data,items,note,internal_note,status,paid_date,sent_date,recurring_id,quote_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [i.id,i.number||'',i.issue_date||'',i.due_date||'',i.taxable_date||'',i.payment_method||'bank',JSON.stringify(i.customer),JSON.stringify(i.items),i.note||'',i.internal_note||'',i.status||'new',i.paid_date||null,i.sent_date||null,i.recurring_id||null,i.quote_id||null,i.created_at||'']);
    }
    if (d.quotes) for (const q of d.quotes) {
      run('DELETE FROM quotes WHERE id=?', [q.id]);
      run('INSERT INTO quotes (id,number,issue_date,valid_until,customer_data,items,intro_text,outro_text,note,internal_note,status,discount_percent,sent_date,approved_date,rejected_date,invoice_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [q.id,q.number||'',q.issue_date||'',q.valid_until||'',JSON.stringify(q.customer),JSON.stringify(q.items),q.intro_text||'',q.outro_text||'',q.note||'',q.internal_note||'',q.status||'draft',q.discount_percent||0,q.sent_date||null,q.approved_date||null,q.rejected_date||null,q.invoice_id||null,q.created_at||'']);
    }
    forceSave();
    res.json({ok:true});
  });

  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
  });

  // ─── BACKUP ────────────────────
  function backup() {
    const dir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const d = td();
    const bp = path.join(dir, `fakturace-${d}.db`);
    if (!fs.existsSync(bp)) {
      try {
        const data = db.export();
        fs.writeFileSync(bp, Buffer.from(data));
        console.log(`[Backup] ${bp}`);
        // Keep 30 days
        const files = fs.readdirSync(dir).sort();
        while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
      } catch (e) { console.error('[Backup]', e); }
    }
  }

  // Periodic save every 60s
  setInterval(forceSave, 60000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  FakturaApp v2.0.1 on port ${PORT}`);
    console.log(`  Database: ${DB_PATH}\n`);
    backup();
    setInterval(backup, 86400000);
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
