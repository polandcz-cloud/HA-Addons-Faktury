const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'fakturace.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
    logo_text TEXT DEFAULT ''
  );
  INSERT OR IGNORE INTO supplier (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, ico TEXT UNIQUE,
    dic TEXT DEFAULT '', street TEXT DEFAULT '', city TEXT DEFAULT '',
    zip TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
    note TEXT DEFAULT '', created_at TEXT DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, number TEXT NOT NULL,
    issue_date TEXT, due_date TEXT, taxable_date TEXT,
    payment_method TEXT DEFAULT 'bank',
    customer_data TEXT NOT NULL, items TEXT NOT NULL,
    note TEXT DEFAULT '', internal_note TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    paid_date TEXT, sent_date TEXT, recurring_id TEXT,
    quote_id TEXT,
    created_at TEXT DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, number TEXT NOT NULL,
    issue_date TEXT, valid_until TEXT,
    customer_data TEXT NOT NULL, items TEXT NOT NULL,
    intro_text TEXT DEFAULT '', outro_text TEXT DEFAULT '',
    note TEXT DEFAULT '', internal_note TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    discount_percent REAL DEFAULT 0,
    sent_date TEXT, approved_date TEXT, rejected_date TEXT,
    invoice_id TEXT,
    created_at TEXT DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS recurrings (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '',
    customer_data TEXT NOT NULL, items TEXT NOT NULL,
    recurrence TEXT DEFAULT 'monthly', next_date TEXT NOT NULL,
    active INTEGER DEFAULT 1, payment_method TEXT DEFAULT 'bank',
    note TEXT DEFAULT '', created_at TEXT DEFAULT (date('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(issue_date);
  CREATE INDEX IF NOT EXISTS idx_q_status ON quotes(status);
`);

// Migrations for existing DBs
try { db.exec("ALTER TABLE supplier ADD COLUMN quote_number_format TEXT DEFAULT 'NAB{YYYY}/{NNN}'"); } catch(e) {}
try { db.exec("ALTER TABLE supplier ADD COLUMN default_quote_validity_days INTEGER DEFAULT 30"); } catch(e) {}
try { db.exec("ALTER TABLE supplier ADD COLUMN default_quote_intro TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE supplier ADD COLUMN default_quote_outro TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE supplier ADD COLUMN logo_image TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE supplier ADD COLUMN logo_text TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE invoices ADD COLUMN quote_id TEXT"); } catch(e) {}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// ─── SUPPLIER ──────────────────────────────
app.get('/api/supplier', (req, res) => {
  const r = db.prepare('SELECT * FROM supplier WHERE id=1').get();
  r.is_vat_payer = !!r.is_vat_payer;
  res.json(r);
});
app.put('/api/supplier', (req, res) => {
  const s = req.body;
  db.prepare(`UPDATE supplier SET name=?,ico=?,dic=?,street=?,city=?,zip=?,bank_account=?,bank_code=?,iban=?,swift=?,email=?,phone=?,web=?,is_vat_payer=?,number_format=?,quote_number_format=?,default_due_days=?,default_quote_validity_days=?,default_note=?,default_quote_intro=?,default_quote_outro=?,currency=?,logo_image=?,logo_text=? WHERE id=1`)
    .run(s.name||'',s.ico||'',s.dic||'',s.street||'',s.city||'',s.zip||'',s.bank_account||'',s.bank_code||'',s.iban||'',s.swift||'',s.email||'',s.phone||'',s.web||'',s.is_vat_payer?1:0,s.number_format||'{YYYY}{NNNN}',s.quote_number_format||'NAB{YYYY}/{NNN}',s.default_due_days||14,s.default_quote_validity_days||30,s.default_note||'',s.default_quote_intro||'',s.default_quote_outro||'',s.currency||'CZK',s.logo_image||'',s.logo_text||'');
  res.json({ok:true});
});

// ─── CUSTOMERS ─────────────────────────────
app.get('/api/customers', (req, res) => res.json(db.prepare('SELECT * FROM customers ORDER BY name').all()));
app.post('/api/customers', (req, res) => {
  const c = req.body;
  db.prepare(`INSERT INTO customers (id,name,ico,dic,street,city,zip,email,phone,note) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ico) DO UPDATE SET name=?,dic=?,street=?,city=?,zip=?,email=?,phone=?,note=?`)
    .run(c.id||Date.now().toString(36),c.name,c.ico,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.phone||'',c.note||'',c.name,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.phone||'',c.note||'');
  res.json({ok:true});
});
app.delete('/api/customers/:id', (req, res) => { db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id); res.json({ok:true}); });

// ─── INVOICES ──────────────────────────────
function parseInv(r) { return {...r, customer: JSON.parse(r.customer_data), items: JSON.parse(r.items)}; }
app.get('/api/invoices', (req, res) => res.json(db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all().map(parseInv)));
app.get('/api/invoices/:id', (req, res) => { const r=db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id); r?res.json(parseInv(r)):res.status(404).json({error:'Not found'}); });
app.post('/api/invoices', (req, res) => {
  const i = req.body;
  db.prepare(`INSERT INTO invoices (id,number,issue_date,due_date,taxable_date,payment_method,customer_data,items,note,internal_note,status,paid_date,sent_date,recurring_id,quote_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=?,issue_date=?,due_date=?,taxable_date=?,payment_method=?,customer_data=?,items=?,note=?,internal_note=?,status=?,paid_date=?,sent_date=?,quote_id=?`)
    .run(i.id,i.number||'',i.issue_date||'',i.due_date||'',i.taxable_date||'',i.payment_method||'bank',JSON.stringify(i.customer),JSON.stringify(i.items),i.note||'',i.internal_note||'',i.status||'new',i.paid_date||null,i.sent_date||null,i.recurring_id||null,i.quote_id||null,i.created_at||new Date().toISOString().slice(0,10),
    i.number||'',i.issue_date||'',i.due_date||'',i.taxable_date||'',i.payment_method||'bank',JSON.stringify(i.customer),JSON.stringify(i.items),i.note||'',i.internal_note||'',i.status||'new',i.paid_date||null,i.sent_date||null,i.quote_id||null);
  if(i.customer?.ico) {
    const c=i.customer;
    db.prepare(`INSERT INTO customers (id,name,ico,dic,street,city,zip,email) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ico) DO UPDATE SET name=?,dic=?,street=?,city=?,zip=?,email=?`)
      .run(c.id||Date.now().toString(36),c.name,c.ico,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.name,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'');
  }
  res.json({ok:true});
});
app.patch('/api/invoices/:id/status', (req, res) => {
  const {status,paid_date,sent_date}=req.body;const td=new Date().toISOString().slice(0,10);
  if(status==='paid') db.prepare('UPDATE invoices SET status=?,paid_date=? WHERE id=?').run(status,paid_date||td,req.params.id);
  else if(status==='sent') db.prepare('UPDATE invoices SET status=?,sent_date=? WHERE id=?').run(status,sent_date||td,req.params.id);
  else db.prepare('UPDATE invoices SET status=? WHERE id=?').run(status,req.params.id);
  res.json({ok:true});
});
app.delete('/api/invoices/:id', (req, res) => { db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id); res.json({ok:true}); });

// ─── QUOTES (Nabídky) ─────────────────────
function parseQuote(r) { return {...r, customer: JSON.parse(r.customer_data), items: JSON.parse(r.items)}; }
app.get('/api/quotes', (req, res) => res.json(db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all().map(parseQuote)));
app.get('/api/quotes/:id', (req, res) => { const r=db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id); r?res.json(parseQuote(r)):res.status(404).json({error:'Not found'}); });
app.post('/api/quotes', (req, res) => {
  const q = req.body;
  db.prepare(`INSERT INTO quotes (id,number,issue_date,valid_until,customer_data,items,intro_text,outro_text,note,internal_note,status,discount_percent,sent_date,approved_date,rejected_date,invoice_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=?,issue_date=?,valid_until=?,customer_data=?,items=?,intro_text=?,outro_text=?,note=?,internal_note=?,status=?,discount_percent=?,sent_date=?,approved_date=?,rejected_date=?,invoice_id=?`)
    .run(q.id,q.number||'',q.issue_date||'',q.valid_until||'',JSON.stringify(q.customer),JSON.stringify(q.items),q.intro_text||'',q.outro_text||'',q.note||'',q.internal_note||'',q.status||'draft',q.discount_percent||0,q.sent_date||null,q.approved_date||null,q.rejected_date||null,q.invoice_id||null,q.created_at||new Date().toISOString().slice(0,10),
    q.number||'',q.issue_date||'',q.valid_until||'',JSON.stringify(q.customer),JSON.stringify(q.items),q.intro_text||'',q.outro_text||'',q.note||'',q.internal_note||'',q.status||'draft',q.discount_percent||0,q.sent_date||null,q.approved_date||null,q.rejected_date||null,q.invoice_id||null);
  if(q.customer?.ico) {
    const c=q.customer;
    db.prepare(`INSERT INTO customers (id,name,ico,dic,street,city,zip,email) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ico) DO UPDATE SET name=?,dic=?,street=?,city=?,zip=?,email=?`)
      .run(c.id||Date.now().toString(36),c.name,c.ico,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'',c.name,c.dic||'',c.street||'',c.city||'',c.zip||'',c.email||'');
  }
  res.json({ok:true});
});
app.patch('/api/quotes/:id/status', (req, res) => {
  const {status}=req.body;const td=new Date().toISOString().slice(0,10);
  if(status==='sent') db.prepare('UPDATE quotes SET status=?,sent_date=? WHERE id=?').run(status,td,req.params.id);
  else if(status==='approved') db.prepare('UPDATE quotes SET status=?,approved_date=? WHERE id=?').run(status,td,req.params.id);
  else if(status==='rejected') db.prepare('UPDATE quotes SET status=?,rejected_date=? WHERE id=?').run(status,td,req.params.id);
  else db.prepare('UPDATE quotes SET status=? WHERE id=?').run(status,req.params.id);
  res.json({ok:true});
});
app.delete('/api/quotes/:id', (req, res) => { db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id); res.json({ok:true}); });

// ─── RECURRINGS ────────────────────────────
app.get('/api/recurrings', (req, res) => res.json(db.prepare('SELECT * FROM recurrings ORDER BY next_date').all().map(r=>({...r,active:!!r.active,customer:JSON.parse(r.customer_data),items:JSON.parse(r.items)}))));
app.post('/api/recurrings', (req, res) => {
  const r=req.body;
  db.prepare(`INSERT INTO recurrings (id,name,customer_data,items,recurrence,next_date,active,payment_method,note) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=?,customer_data=?,items=?,recurrence=?,next_date=?,active=?,payment_method=?,note=?`)
    .run(r.id,r.name||'',JSON.stringify(r.customer),JSON.stringify(r.items),r.recurrence||'monthly',r.next_date,r.active?1:0,r.payment_method||'bank',r.note||'',r.name||'',JSON.stringify(r.customer),JSON.stringify(r.items),r.recurrence||'monthly',r.next_date,r.active?1:0,r.payment_method||'bank',r.note||'');
  res.json({ok:true});
});
app.delete('/api/recurrings/:id', (req, res) => { db.prepare('DELETE FROM recurrings WHERE id=?').run(req.params.id); res.json({ok:true}); });

// ─── NUMBER GENERATORS ─────────────────────
function genNum(table, format, date) {
  const y=new Date(date).getFullYear();const ys=String(y);const yy=ys.slice(2);const m=String(new Date(date).getMonth()+1).padStart(2,'0');
  const col = table==='quotes' ? 'number' : 'number';
  const existing=db.prepare(`SELECT ${col} FROM ${table} WHERE ${col} LIKE ?`).all(`%${ys}%`);
  let max=0;for(const r of existing){const n=(r[col]||'').replace(/\D/g,'');const s=parseInt(n.slice(-4))||0;if(s>max)max=s;}
  const seq=String(max+1);let num=format.replace('{YYYY}',ys).replace('{YY}',yy).replace('{MM}',m);
  num=num.replace(/\{N+\}/g,match=>{const len=match.length-2;return seq.padStart(len,'0');});
  return num;
}
app.get('/api/next-number', (req, res) => {
  const sup=db.prepare('SELECT number_format FROM supplier WHERE id=1').get();
  res.json({number:genNum('invoices',sup?.number_format||'{YYYY}{NNNN}',req.query.date||new Date().toISOString().slice(0,10))});
});
app.get('/api/next-quote-number', (req, res) => {
  const sup=db.prepare('SELECT quote_number_format FROM supplier WHERE id=1').get();
  res.json({number:genNum('quotes',sup?.quote_number_format||'NAB{YYYY}/{NNN}',req.query.date||new Date().toISOString().slice(0,10))});
});

// ─── EXPORT / IMPORT ───────────────────────
app.get('/api/export', (req, res) => {
  const data={supplier:db.prepare('SELECT * FROM supplier WHERE id=1').get(),customers:db.prepare('SELECT * FROM customers').all(),
    invoices:db.prepare('SELECT * FROM invoices').all().map(parseInv),quotes:db.prepare('SELECT * FROM quotes').all().map(parseQuote),
    recurrings:db.prepare('SELECT * FROM recurrings').all().map(r=>({...r,active:!!r.active,customer:JSON.parse(r.customer_data),items:JSON.parse(r.items)})),
    exported_at:new Date().toISOString()};
  res.setHeader('Content-Disposition',`attachment; filename=faktura-export-${new Date().toISOString().slice(0,10)}.json`);
  res.json(data);
});
app.post('/api/import', (req, res) => {
  const d=req.body;
  const tx=db.transaction(()=>{
    if(d.supplier){const s=d.supplier;db.prepare(`UPDATE supplier SET name=?,ico=?,dic=?,street=?,city=?,zip=?,bank_account=?,bank_code=?,iban=?,swift=?,email=?,phone=?,web=?,is_vat_payer=?,number_format=?,quote_number_format=?,default_due_days=?,default_quote_validity_days=?,default_note=?,default_quote_intro=?,default_quote_outro=?,currency=?,logo_image=?,logo_text=? WHERE id=1`).run(s.name||'',s.ico||'',s.dic||'',s.street||'',s.city||'',s.zip||'',s.bank_account||'',s.bank_code||'',s.iban||'',s.swift||'',s.email||'',s.phone||'',s.web||'',s.is_vat_payer?1:0,s.number_format||'{YYYY}{NNNN}',s.quote_number_format||'NAB{YYYY}/{NNN}',s.default_due_days||14,s.default_quote_validity_days||30,s.default_note||'',s.default_quote_intro||'',s.default_quote_outro||'',s.currency||'CZK',s.logo_image||'',s.logo_text||'');}
    if(d.invoices)for(const i of d.invoices){db.prepare(`INSERT OR REPLACE INTO invoices (id,number,issue_date,due_date,taxable_date,payment_method,customer_data,items,note,internal_note,status,paid_date,sent_date,recurring_id,quote_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(i.id,i.number||'',i.issue_date||'',i.due_date||'',i.taxable_date||'',i.payment_method||'bank',JSON.stringify(i.customer),JSON.stringify(i.items),i.note||'',i.internal_note||'',i.status||'new',i.paid_date||null,i.sent_date||null,i.recurring_id||null,i.quote_id||null,i.created_at||'');}
    if(d.quotes)for(const q of d.quotes){db.prepare(`INSERT OR REPLACE INTO quotes (id,number,issue_date,valid_until,customer_data,items,intro_text,outro_text,note,internal_note,status,discount_percent,sent_date,approved_date,rejected_date,invoice_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(q.id,q.number||'',q.issue_date||'',q.valid_until||'',JSON.stringify(q.customer),JSON.stringify(q.items),q.intro_text||'',q.outro_text||'',q.note||'',q.internal_note||'',q.status||'draft',q.discount_percent||0,q.sent_date||null,q.approved_date||null,q.rejected_date||null,q.invoice_id||null,q.created_at||'');}
  });
  tx();
  res.json({ok:true});
});

// SPA fallback
app.get('*', (req, res) => { if(!req.path.startsWith('/api/'))res.sendFile(path.join(__dirname,'frontend','index.html')); });

// Backup
function autoBackup(){
  const dir=path.join(DATA_DIR,'backups');
  if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
  const d=new Date().toISOString().slice(0,10);const bp=path.join(dir,`fakturace-${d}.db`);
  if(!fs.existsSync(bp))db.backup(bp).then(()=>{console.log(`[Backup] ${bp}`);const files=fs.readdirSync(dir).sort();while(files.length>30)fs.unlinkSync(path.join(dir,files.shift()));}).catch(e=>console.error('[Backup]',e));
}

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n  FakturaApp v2 running on port ${PORT}\n  DB: ${DB_PATH}\n`);
  autoBackup();
  setInterval(autoBackup,86400000);
});
