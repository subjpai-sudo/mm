import sqlite3, json, os, socket, hashlib, re, threading, time, secrets
import urllib.request, urllib.parse
from functools import wraps
from flask import Flask, jsonify, request, render_template, abort, make_response, session, redirect
from datetime import datetime, timedelta

FIREBASE_URL = 'https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/catalog.json'
MYANMAR_JSON = os.path.join(os.path.dirname(__file__), 'myanmar_products.json')
AUTH_USERS_URL = 'https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/auth_users'

# Supabase warehouse — stock sync
SUPABASE_URL         = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'mm-mart-internal-2024-xk9q')
app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE']   = True

# Short-lived one-time tokens for cross-site navigation (solves iOS Safari cookie block)
_login_tokens = {}   # token -> {user, expires}

def _make_login_token(user_data, ttl=60):
    """Generate a one-time token that creates a session on the billing domain."""
    tok = secrets.token_hex(32)
    _login_tokens[tok] = {'user': user_data, 'expires': time.time() + ttl}
    # prune old tokens
    stale = [k for k, v in _login_tokens.items() if v['expires'] < time.time()]
    for k in stale:
        _login_tokens.pop(k, None)
    return tok
DB = os.path.join(os.path.dirname(__file__), 'billing.db')

# ── Auth ──────────────────────────────────────────────────────────────────────
def _phone_key(phone):
    return re.sub(r'\D', '', phone)

def _fetch_user(phone_key):
    try:
        req = urllib.request.Request(
            f'{AUTH_USERS_URL}/{phone_key}.json',
            headers={'Accept': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception:
        return None

LANDING_URL = 'https://mm-mart-live.web.app/'

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(LANDING_URL)
        return f(*args, **kwargs)
    return decorated

@app.route('/api/auth/me')
def auth_me():
    if 'user' not in session:
        return jsonify({'ok': False})
    return jsonify({'ok': True, 'user': session['user']})

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data  = request.get_json() or {}
    name  = (data.get('name') or '').strip()
    pin   = (data.get('pin') or '').strip()

    if not name or not pin:
        return jsonify({'ok': False, 'error': 'Name and PIN required'})

    # Scan all users and find by name (case-insensitive)
    all_users = _firebase_auth_get() or {}
    user = None
    for key, rec in all_users.items():
        if isinstance(rec, dict) and rec.get('name', '').lower() == name.lower():
            user = rec
            break

    if not user:
        return jsonify({'ok': False, 'error': 'Name not found'})
    if not user.get('allowed'):
        return jsonify({'ok': False, 'error': 'Account disabled'})
    if not user.get('pin_hash'):
        return jsonify({'ok': False, 'error': 'PIN not set — ask your admin'})
    if user['pin_hash'] != hashlib.sha256(pin.encode()).hexdigest():
        return jsonify({'ok': False, 'error': 'Incorrect PIN'})

    u = {
        'phone':     user.get('phone', ''),
        'name':      user.get('name', name),
        'admin':     bool(user.get('admin')),
        'developer': bool(user.get('developer')),
        'modules':   user.get('modules', {m: True for m in ['billing','catalog','stock','warehouse']}),
    }
    session['user'] = u
    must_change = bool(user.get('must_change_pin'))
    tok = _make_login_token(u, ttl=600 if must_change else 60)
    return jsonify({'ok': True, 'name': u['name'], 'phone': u['phone'],
                    'developer': u['developer'], 'modules': u['modules'],
                    'must_change_pin': must_change, 'user': u,
                    'token': tok})

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({'ok': True})

# ── Admin user management ─────────────────────────────────────────────────────
import random, string

def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        if not session['user'].get('admin'):
            return jsonify({'error': 'Admin only'}), 403
        return f(*args, **kwargs)
    return decorated

def _firebase_auth_get(path=''):
    try:
        url = f'{AUTH_USERS_URL}{path}.json'
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception:
        return None

def _firebase_auth_put(phone_key, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{AUTH_USERS_URL}/{phone_key}.json',
        data=payload, method='PUT',
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def _firebase_auth_patch(phone_key, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{AUTH_USERS_URL}/{phone_key}.json',
        data=payload, method='PATCH',
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def _firebase_auth_delete(phone_key):
    req = urllib.request.Request(
        f'{AUTH_USERS_URL}/{phone_key}.json', method='DELETE'
    )
    with urllib.request.urlopen(req, timeout=10):
        pass

ALL_MODULES = ['billing', 'catalog', 'stock', 'warehouse']

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def admin_list_users():
    data = _firebase_auth_get() or {}
    users = []
    for key, u in data.items():
        if not isinstance(u, dict):
            continue
        users.append({
            'phone_key': key,
            'name': u.get('name', ''),
            'phone': u.get('phone', key),
            'admin': bool(u.get('admin')),
            'developer': bool(u.get('developer')),
            'allowed': bool(u.get('allowed')),
            'modules': u.get('modules', {m: True for m in ALL_MODULES}),
            'has_pin': bool(u.get('pin_hash')),
        })
    users.sort(key=lambda x: x['name'].lower())
    return jsonify({'ok': True, 'users': users})

@app.route('/api/admin/users', methods=['POST'])
@require_admin
def admin_create_user():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    raw_phone = data.get('phone', '').strip()
    modules = data.get('modules', {m: True for m in ALL_MODULES})
    is_admin = bool(data.get('admin', False))

    if not name or not raw_phone:
        return jsonify({'ok': False, 'error': 'Name and phone required'}), 400

    phone_key = _phone_key(raw_phone)
    existing = _firebase_auth_get(f'/{phone_key}')
    if existing:
        return jsonify({'ok': False, 'error': 'Phone already registered'}), 409

    pin = ''.join(random.choices(string.digits, k=4))
    pin_hash = hashlib.sha256(pin.encode()).hexdigest()

    _firebase_auth_put(phone_key, {
        'name': name,
        'phone': raw_phone,
        'pin_hash': pin_hash,
        'allowed': True,
        'admin': is_admin,
        'developer': False,
        'modules': modules,
        'must_change_pin': True,
    })
    return jsonify({'ok': True, 'pin': pin, 'phone_key': phone_key})

@app.route('/api/admin/users/<phone_key>', methods=['PATCH'])
@require_admin
def admin_update_user(phone_key):
    data = request.get_json() or {}
    patch = {}
    if 'name' in data:
        patch['name'] = data['name'].strip()
    if 'modules' in data:
        patch['modules'] = data['modules']
    if 'admin' in data:
        patch['admin'] = bool(data['admin'])
    if 'allowed' in data:
        patch['allowed'] = bool(data['allowed'])
    if patch:
        _firebase_auth_patch(phone_key, patch)
    return jsonify({'ok': True})

@app.route('/api/admin/users/<phone_key>/reset-pin', methods=['POST'])
@require_admin
def admin_reset_pin(phone_key):
    pin = ''.join(random.choices(string.digits, k=4))
    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    _firebase_auth_patch(phone_key, {'pin_hash': pin_hash, 'must_change_pin': True})
    return jsonify({'ok': True, 'pin': pin})

@app.route('/api/auth/change-pin', methods=['POST'])
def auth_change_pin():
    data = request.get_json() or {}
    # Accept session OR one-time token (needed when cross-site cookies are blocked on mobile)
    user = None
    tok = (data.get('token') or '').strip()
    if tok:
        entry = _login_tokens.pop(tok, None)
        if entry and entry['expires'] > time.time():
            user = entry['user']
    if user is None:
        if 'user' not in session:
            return jsonify({'ok': False, 'error': 'Not logged in'}), 401
        user = session['user']
    pin = (data.get('pin') or '').strip()
    if not pin or not pin.isdigit() or len(pin) != 4:
        return jsonify({'ok': False, 'error': 'PIN must be exactly 4 digits'})
    name = user['name']
    all_users = _firebase_auth_get() or {}
    user_key = None
    for key, rec in all_users.items():
        if isinstance(rec, dict) and rec.get('name', '').lower() == name.lower():
            user_key = key
            break
    if not user_key:
        return jsonify({'ok': False, 'error': 'User not found'})
    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    _firebase_auth_patch(user_key, {'pin_hash': pin_hash, 'must_change_pin': False})
    # Update session and issue a fresh navigation token for the picker → module flow
    user['must_change_pin'] = False
    session['user'] = user
    new_tok = _make_login_token(user)
    return jsonify({'ok': True, 'token': new_tok})

@app.route('/api/admin/users/<phone_key>', methods=['DELETE'])
@require_admin
def admin_delete_user(phone_key):
    _firebase_auth_delete(phone_key)
    return jsonify({'ok': True})

# ── DB ────────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS products (
            sku      TEXT PRIMARY KEY,
            name     TEXT NOT NULL,
            supplier TEXT,
            price    REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS invoices (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            store          TEXT,
            date           TEXT,
            invoice_no     TEXT,
            items          TEXT,
            subtotal       REAL DEFAULT 0,
            tax_rate       REAL DEFAULT 0,
            discount_val   REAL DEFAULT 0,
            discount_type  TEXT DEFAULT 'pct',
            credit_amount  REAL DEFAULT 0,
            credit_reason  TEXT DEFAULT '',
            total          REAL DEFAULT 0,
            fb_key         TEXT,
            store_snapshot TEXT DEFAULT '',
            created_at     TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS categories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            parent_id  INTEGER REFERENCES categories(id),
            sku_prefix TEXT DEFAULT "",
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS stores (
            id      TEXT PRIMARY KEY,
            name    TEXT NOT NULL DEFAULT "",
            sub     TEXT DEFAULT "",
            address TEXT DEFAULT "",
            tel     TEXT DEFAULT "",
            email   TEXT DEFAULT "",
            zip     TEXT DEFAULT ""
        );
    ''')
    # Safe column migrations for existing DBs
    for table, col, typedef in [
        ('products', 'category_id',    'INTEGER'),
        ('products', 'barcode',        'TEXT DEFAULT ""'),
        ('products', 'image_url',      'TEXT DEFAULT ""'),
        ('products', 'fb_no',          'INTEGER'),
        ('products', 'stock',          'INTEGER DEFAULT 0'),
        ('invoices', 'store_snapshot', 'TEXT DEFAULT ""'),
    ]:
        try:
            conn.execute(f'ALTER TABLE {table} ADD COLUMN {col} {typedef}')
        except Exception:
            pass
    conn.commit()
    conn.close()

def load_products_if_empty():
    conn = get_db()
    count = conn.execute('SELECT COUNT(*) FROM products').fetchone()[0]
    if count == 0:
        # First try to load from Firebase (has the latest SKUs and data)
        loaded = _load_products_from_firebase(conn)
        if not loaded:
            # Fallback to static JSON
            src = os.path.join(os.path.dirname(__file__), 'products.json')
            if os.path.exists(src):
                with open(src) as f:
                    prods = json.load(f)
                conn.executemany(
                    'INSERT OR IGNORE INTO products(sku,name,supplier,price) VALUES(?,?,?,0)',
                    [(p['sku'], p['name'], p['supplier']) for p in prods]
                )
                conn.commit()
                print(f'  Seeded {len(prods)} products from static JSON')
    conn.close()

def _load_products_from_firebase(conn):
    """Pull products from Firebase RTDB.
    custom path: non-Myanmar (TM/IM/HM) — fields: code=SKU, name, brand=vendor, origin=country, p1=price
    overrides path: Myanmar (MM) — fields: code=SKU, name, brand=vendor, p1=price
    """
    try:
        base = 'https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/catalog'
        rows = []

        # Load non-Myanmar products from custom
        with urllib.request.urlopen(
            urllib.request.Request(f'{base}/custom.json', headers={'Accept': 'application/json'}),
            timeout=10
        ) as r:
            custom = json.loads(r.read()) or {}
        for key, item in custom.items():
            if not isinstance(item, dict):
                continue
            sku  = item.get('code') or item.get('sku', '')
            name = item.get('name', '')
            if not sku or not name:
                continue
            supplier = item.get('brand', '')   # brand = vendor/subcategory
            price    = float(item.get('p1', 0) or 0)
            barcode  = item.get('barcode', '') or ''
            rows.append((sku, name, supplier, price, barcode, None))

        # Load Myanmar products from overrides
        with urllib.request.urlopen(
            urllib.request.Request(f'{base}/overrides.json', headers={'Accept': 'application/json'}),
            timeout=10
        ) as r:
            overrides = json.loads(r.read()) or {}
        # Firebase returns numeric-keyed data as a list — normalise to dict
        if isinstance(overrides, list):
            overrides = {str(i): v for i, v in enumerate(overrides) if v is not None}
        for fb_no_str, item in overrides.items():
            if not isinstance(item, dict):
                continue
            sku  = item.get('code', '')
            name = item.get('name', '')
            if not sku or not name:
                continue
            supplier = item.get('brand', '')
            price    = float(item.get('p1', 0) or 0)
            try:
                fb_no = int(fb_no_str)
            except Exception:
                fb_no = None
            rows.append((sku, name, supplier, price, '', fb_no))

        if not rows:
            return False

        conn.executemany(
            'INSERT OR IGNORE INTO products(sku,name,supplier,price,barcode,fb_no) VALUES(?,?,?,?,?,?)',
            rows
        )
        conn.commit()

        # Link products to categories via supplier name (seed_categories must run first)
        for row in conn.execute(
            "SELECT c.id, c.name FROM categories c WHERE c.parent_id IS NOT NULL"
        ).fetchall():
            conn.execute('UPDATE products SET category_id=? WHERE supplier=?', (row[0], row[1]))
        conn.commit()

        print(f'  Loaded {len(rows)} products from Firebase RTDB')
        return True
    except Exception as e:
        print(f'  Firebase product load failed: {e}')
        return False

# ── Background Firebase + Supabase sync ───────────────────────────────────────
_sync_lock = threading.Lock()
_last_sync_time = 0.0
_last_supabase_sync = 0.0
_SYNC_INTERVAL = 5          # seconds — Firebase sync
_SUPABASE_INTERVAL = 30     # seconds — Supabase stock sync

def _sb_adjust_qty_by_barcode(barcode, delta):
    """Increment or decrement warehouse product qty in Supabase by barcode.
    delta=-N deducts stock (invoice saved), +N restores (invoice deleted)."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY or not barcode:
        return
    try:
        bc = urllib.parse.quote(str(barcode), safe='')
        fetch_url = f'{SUPABASE_URL}/rest/v1/products?select=id,qty&barcode=eq.{bc}'
        req = urllib.request.Request(fetch_url, headers={
            'apikey':        SUPABASE_SERVICE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        })
        with urllib.request.urlopen(req, timeout=8) as r:
            rows = json.loads(r.read())
        if not rows:
            return
        row = rows[0]
        new_qty = max(0, int(row.get('qty') or 0) + delta)
        patch_url = f'{SUPABASE_URL}/rest/v1/products?id=eq.{row["id"]}'
        payload = json.dumps({'qty': new_qty, 'last_updated': datetime.now().date().isoformat()}).encode()
        patch_req = urllib.request.Request(patch_url, data=payload, method='PATCH', headers={
            'apikey':        SUPABASE_SERVICE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
            'Content-Type':  'application/json',
            'Prefer':        'return=minimal',
        })
        urllib.request.urlopen(patch_req, timeout=8)
    except Exception as e:
        print(f'[sb-adj] barcode={barcode} delta={delta} err={e}')

def _pull_supabase_stock(conn):
    """Pull product stock levels from Supabase warehouse and update SQLite."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return 0
    try:
        url = f'{SUPABASE_URL}/rest/v1/products?select=sku,stock'
        req = urllib.request.Request(url, headers={
            'apikey':        SUPABASE_SERVICE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        })
        with urllib.request.urlopen(req, timeout=12) as r:
            rows = json.loads(r.read())
        updated = 0
        for row in rows:
            sku   = (row.get('sku') or '').strip()
            stock = row.get('stock')
            if sku and stock is not None:
                conn.execute('UPDATE products SET stock=? WHERE sku=?', (int(stock), sku))
                updated += 1
        conn.commit()
        return updated
    except Exception as e:
        print(f'[supabase-stock] {e}')
        return 0

def _pull_firebase_changes():
    """Pull latest barcodes + prices from Firebase, and stock from Supabase, into SQLite."""
    global _last_supabase_sync
    custom    = _fb_get('custom')    or {}
    overrides = _fb_get('overrides') or {}
    barcodes  = _fb_get('barcodes')  or {}

    if isinstance(overrides, list):
        overrides = {str(i): v for i, v in enumerate(overrides) if v is not None}
    if isinstance(barcodes, list):
        barcodes = {str(i): v for i, v in enumerate(barcodes) if v is not None}
    if isinstance(custom, list):
        custom = {str(i): v for i, v in enumerate(custom) if v is not None}

    conn = get_db()

    # TM / IM / HM products — update price/name from Firebase custom
    if isinstance(custom, dict):
        for key, item in custom.items():
            if not isinstance(item, dict):
                continue
            sku   = item.get('code') or item.get('sku', '')
            price = item.get('p1')
            name  = item.get('name')
            if not sku:
                continue
            if price is not None:
                conn.execute('UPDATE products SET price=? WHERE sku=?', (float(price or 0), sku))
            if name:
                conn.execute('UPDATE products SET name=? WHERE sku=?', (name, sku))

    # Myanmar products — update price/name from Firebase overrides
    for fb_no_str, item in overrides.items():
        if not isinstance(item, dict):
            continue
        try:
            fb_no = int(fb_no_str)
        except Exception:
            continue
        price = item.get('p1')
        name  = item.get('name')
        if price is not None:
            conn.execute('UPDATE products SET price=? WHERE fb_no=?', (float(price or 0), fb_no))
        if name:
            conn.execute('UPDATE products SET name=? WHERE fb_no=?', (name, fb_no))

    # Barcodes — TM/IM/HM products (fb_no derived from SKU via _sku_to_no)
    tmimhm_rows = conn.execute(
        "SELECT sku, barcode FROM products "
        "WHERE sku GLOB 'TM[0-9]*' OR sku GLOB 'IM[0-9]*' OR sku GLOB 'HM[0-9]*'"
    ).fetchall()
    for r in tmimhm_rows:
        no = _sku_to_no(r['sku'])
        if no is None:
            continue
        fb_bc = barcodes.get(str(no), '')
        if fb_bc and fb_bc != (r['barcode'] or ''):
            conn.execute('UPDATE products SET barcode=? WHERE sku=?', (str(fb_bc), r['sku']))

    # Barcodes — MM products (use fb_no column directly)
    mm_rows = conn.execute(
        'SELECT sku, barcode, fb_no FROM products WHERE sku GLOB "MM[0-9]*"'
    ).fetchall()
    for r in mm_rows:
        if not r['fb_no']:
            continue
        fb_bc = barcodes.get(str(r['fb_no']), '')
        if fb_bc and fb_bc != (r['barcode'] or ''):
            conn.execute('UPDATE products SET barcode=? WHERE sku=?', (str(fb_bc), r['sku']))

    # GCS image URLs stored by match_upload_images.py under catalog/images/{sku}
    img_urls = _fb_get('images') or {}
    if isinstance(img_urls, dict):
        for sku, url in img_urls.items():
            if url:
                conn.execute(
                    'UPDATE products SET image_url=? WHERE sku=?',
                    (str(url), str(sku))
                )

    # Supabase stock sync — every 30 s to stay well within rate limits
    now = time.time()
    if now - _last_supabase_sync >= _SUPABASE_INTERVAL:
        n = _pull_supabase_stock(conn)
        if n > 0:
            print(f'[supabase-stock] synced {n} stock levels')
        _last_supabase_sync = now

    conn.commit()
    conn.close()

def _start_bg_sync():
    """Daemon thread: sync Firebase → SQLite every 5 seconds."""
    def loop():
        try:
            with _sync_lock:
                _pull_firebase_changes()
        except Exception as e:
            print(f'[bg-sync startup] {e}')
        while True:
            time.sleep(5)
            try:
                with _sync_lock:
                    _pull_firebase_changes()
            except Exception as e:
                print(f'[bg-sync] {e}')
    t = threading.Thread(target=loop, daemon=True)
    t.start()
    print('  Auto-sync started (Firebase → billing every 5s)')

def seed_categories():
    conn = get_db()
    if conn.execute('SELECT COUNT(*) FROM categories').fetchone()[0] > 0:
        conn.close()
        return
    # Main categories
    mains = [('Thailand', 0), ('Indonesia', 1), ('Asian Halal', 2), ('Myanmar', 3)]
    for name, order in mains:
        conn.execute('INSERT INTO categories(name,parent_id,sku_prefix,sort_order) VALUES(?,NULL,"",?)', (name, order))
    conn.commit()
    th = conn.execute("SELECT id FROM categories WHERE name='Thailand'").fetchone()[0]
    id_ = conn.execute("SELECT id FROM categories WHERE name='Indonesia'").fetchone()[0]
    ah = conn.execute("SELECT id FROM categories WHERE name='Asian Halal'").fetchone()[0]
    # Subcategories
    subs = [
        ('A1 Thai',               th,  'AT', 0),
        ('Lifu Tou',              th,  'LT', 1),
        ('ICHIBA',                th,  'IC', 2),
        ('IMAI JAPAN',            th,  'IJ', 3),
        ('BOMPEX JAPAN',          th,  'BP', 4),
        ('ABC COMPANY',           th,  'AC', 5),
        ('Dobarfield Indonasian', id_, 'DI', 0),
        ('MY ANH Indonasian',     id_, 'MY', 1),
        ('AMBIKA',                ah,  'AM', 0),
        ('SARTAJ',                ah,  'ST', 1),
    ]
    for name, pid, prefix, order in subs:
        conn.execute('INSERT INTO categories(name,parent_id,sku_prefix,sort_order) VALUES(?,?,?,?)',
                     (name, pid, prefix, order))
    conn.commit()
    # Link existing products to their subcategory via supplier name
    for row in conn.execute('SELECT id,name FROM categories WHERE parent_id IS NOT NULL').fetchall():
        conn.execute('UPDATE products SET category_id=? WHERE supplier=?', (row[0], row[1]))
    conn.commit()
    conn.close()
    print('  Seeded categories')

LOVABLE_BASE = 'https://artful-catalog-maker.lovable.app'
FIREBASE_BASE    = 'https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/catalog'
INVOICE_FB_BASE  = 'https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/invoices'
CATALOG_ORIGINS = {
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'https://mm-mart-live.web.app', 'https://mm-mart-live.firebaseapp.com',
    'https://stock-order-hub.citystar.workers.dev',
}

@app.after_request
def add_cors(response):
    origin = request.headers.get('Origin', '')
    if origin in CATALOG_ORIGINS:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,DELETE,OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.before_request
def handle_options():
    if request.method == 'OPTIONS':
        resp = app.make_default_options_response()
        origin = request.headers.get('Origin', '')
        if origin in CATALOG_ORIGINS:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,DELETE,OPTIONS'
            resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return resp

def _firebase_patch(path, data):
    """PATCH data into Firebase REST API (merges, doesn't replace)."""
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{FIREBASE_BASE}/{path}.json',
        data=payload, method='PATCH',
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def _fb_get(path):
    """Fetch a single Firebase path, return parsed JSON or {}."""
    url = f'{FIREBASE_BASE}/{path}.json'
    try:
        with urllib.request.urlopen(url, timeout=12) as resp:
            data = json.loads(resp.read())
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def _fb_inv_push(data):
    """POST invoice to Firebase RTDB invoices node; returns the push key."""
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{INVOICE_FB_BASE}.json',
        data=payload, method='POST',
        headers={'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read()).get('name')
    except Exception as e:
        print(f'  Firebase invoice push error: {e}')
        return None

def _fb_inv_delete(fb_key):
    """DELETE a single invoice from Firebase RTDB."""
    req = urllib.request.Request(
        f'{INVOICE_FB_BASE}/{fb_key}.json', method='DELETE'
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            pass
    except Exception as e:
        print(f'  Firebase invoice delete error: {e}')

def _load_invoices_from_firebase():
    """Seed SQLite invoices from Firebase on container start."""
    try:
        with urllib.request.urlopen(f'{INVOICE_FB_BASE}.json', timeout=20) as r:
            raw = json.loads(r.read())
    except Exception as e:
        print(f'  Could not load invoices from Firebase: {e}')
        return
    if not isinstance(raw, dict):
        return
    conn = get_db()
    count = 0
    for fb_key, inv in raw.items():
        if not isinstance(inv, dict):
            continue
        if conn.execute('SELECT 1 FROM invoices WHERE fb_key=?', (fb_key,)).fetchone():
            continue
        conn.execute(
            '''INSERT INTO invoices(store,date,invoice_no,items,subtotal,tax_rate,
               discount_val,discount_type,credit_amount,credit_reason,total,
               store_snapshot,fb_key,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (
                inv.get('store',''), inv.get('date',''), inv.get('invoice_no',''),
                json.dumps(inv.get('items') or []),
                inv.get('subtotal',0), inv.get('tax_rate',0),
                inv.get('discount_val',0), inv.get('discount_type','pct'),
                inv.get('credit_amount',0), inv.get('credit_reason',''),
                inv.get('total',0),
                inv.get('store_snapshot',''),
                fb_key,
                inv.get('created_at', datetime.now().isoformat())
            )
        )
        count += 1
    conn.commit()
    conn.close()
    print(f'  Loaded {count} invoices from Firebase')

def sync_myanmar_catalog():
    """Pull Myanmar catalog from Firebase, merge with base products, upsert into SQLite."""
    # Fetch sections individually to avoid the images blob (which is too large)
    overrides = _fb_get('overrides')
    barcodes  = _fb_get('barcodes')
    custom    = _fb_get('custom')
    # Images: we skip Firebase (base64 data stored there is too large).
    # Myanmar product images are served directly from the Lovable CDN at a known path.
    images = {}  # constructed from Lovable CDN path below

    if not os.path.exists(MYANMAR_JSON):
        return {'ok': False, 'error': 'myanmar_products.json not found'}
    with open(MYANMAR_JSON) as f:
        base_products = json.load(f)

    conn = get_db()

    # Ensure Myanmar main category
    my_row = conn.execute("SELECT id FROM categories WHERE name='Myanmar' AND parent_id IS NULL").fetchone()
    my_id = my_row[0] if my_row else conn.execute(
        "INSERT INTO categories(name,parent_id,sku_prefix,sort_order) VALUES('Myanmar',NULL,'MM',3)"
    ).lastrowid
    if not my_row:
        conn.commit()

    brand_cache = {}
    def get_brand_cat(brand):
        if brand in brand_cache:
            return brand_cache[brand]
        row = conn.execute("SELECT id FROM categories WHERE name=? AND parent_id=?", (brand, my_id)).fetchone()
        if row:
            brand_cache[brand] = row[0]
            return row[0]
        pfx = ''.join(w[0] for w in brand.split()[:2]).upper()[:2] or 'MM'
        cur = conn.execute("INSERT INTO categories(name,parent_id,sku_prefix,sort_order) VALUES(?,?,?,99)",
                           (brand, my_id, pfx))
        conn.commit()
        brand_cache[brand] = cur.lastrowid
        return cur.lastrowid

    synced = 0
    for p in base_products:
        no_key = str(p['no'])
        ov = overrides.get(no_key) or {}
        name    = ov.get('name',  p['name'])
        brand   = ov.get('brand', p['brand'])
        raw_p1  = ov.get('p1',    p.get('p1', 0))
        raw_code = str(p.get('code', '')).strip().upper()
        barcode = barcodes.get(no_key) or (raw_code if raw_code and raw_code != 'NONE' else '')
        # Look up by fb_no (stable product number) — SKU is now Mm{no} format
        sku = f'MM{p["no"]}'
        try:
            price = float(raw_p1)
        except (ValueError, TypeError):
            price = 0.0
        cat_id = get_brand_cat(brand)
        # Build image URL directly from Lovable CDN (skip Firebase images — too large)
        image_url = f'{LOVABLE_BASE}/products/product_{str(p["no"]).zfill(3)}.jpg'
        # Try lookup by fb_no first (handles products renamed from MM0xxx to Mm{no})
        row = conn.execute('SELECT sku FROM products WHERE fb_no=? AND category_id IN (SELECT id FROM categories WHERE parent_id=?)', (p['no'], my_id)).fetchone()
        if row:
            sku = row['sku']  # use whatever SKU exists in DB
            conn.execute(
                'UPDATE products SET name=?,supplier=?,price=?,category_id=?,barcode=?,image_url=? WHERE sku=?',
                (name, brand, price, cat_id, barcode, image_url, sku))
        elif conn.execute('SELECT sku FROM products WHERE sku=?', (sku,)).fetchone():
            conn.execute(
                'UPDATE products SET name=?,supplier=?,price=?,category_id=?,barcode=?,image_url=? WHERE sku=?',
                (name, brand, price, cat_id, barcode, image_url, sku))
        else:
            conn.execute(
                'INSERT INTO products(sku,name,supplier,price,category_id,barcode,image_url,fb_no) VALUES(?,?,?,?,?,?,?,?)',
                (sku, name, brand, price, cat_id, barcode, image_url, p['no']))
        synced += 1

    # Custom products from Lovable
    for key, cp in custom.items():
        if not cp or not cp.get('name') or cp.get('name') == 'New Product':
            continue
        raw_code = str(cp.get('code') or '').strip()
        no_key   = str(cp.get('no', key))
        cp_no    = int(cp.get('no', 0)) if str(cp.get('no', '')).isdigit() else 0

        # Products we pushed FROM billing to Lovable have no >= 1000 (Tm=1xxx, Im=2xxx, Hm=3xxx)
        # Just update their barcode in billing if Lovable user added one — don't recreate them
        if cp_no >= 1000:
            billing_sku = raw_code  # code = billing SKU (e.g. Tm5, Im3, Hm12)
            if billing_sku:
                bc = barcodes.get(no_key, '')
                if bc:
                    conn.execute(
                        'UPDATE products SET barcode=? WHERE sku=? AND (barcode IS NULL OR barcode="")',
                        (bc, billing_sku))
            synced += 1
            continue

        # Myanmar custom products (new entries added in Lovable)
        sku   = raw_code if raw_code else f'MMC{key}'.upper()
        brand = cp.get('brand') or 'Myanmar'
        sub   = cp.get('origin') or cp.get('subcategory') or cp.get('category') or ''
        cat_row = conn.execute('SELECT id FROM categories WHERE name=? AND parent_id IS NOT NULL', (sub,)).fetchone() if sub else None
        cat_id = cat_row[0] if cat_row else get_brand_cat(brand)
        try:
            price = float(cp.get('p1', 0))
        except (ValueError, TypeError):
            price = 0.0
        bc        = barcodes.get(no_key, '')
        image_url = ''  # custom Lovable products don't have a known CDN path
        if conn.execute('SELECT sku FROM products WHERE sku=?', (sku,)).fetchone():
            conn.execute(
                'UPDATE products SET name=?,supplier=?,price=?,category_id=?,barcode=?,image_url=? WHERE sku=?',
                (cp['name'], brand, price, cat_id, bc, image_url, sku))
        else:
            conn.execute(
                'INSERT INTO products(sku,name,supplier,price,category_id,barcode,image_url) VALUES(?,?,?,?,?,?,?)',
                (sku, cp['name'], brand, price, cat_id, bc, image_url))
        synced += 1

    conn.commit()
    conn.close()
    return {'ok': True, 'synced': synced}

def _next_sku(conn, prefix):
    row = conn.execute(
        "SELECT sku FROM products WHERE sku LIKE ? ORDER BY sku DESC LIMIT 1",
        (prefix + '%',)
    ).fetchone()
    if row:
        try:
            num = int(row[0][len(prefix):]) + 1
        except ValueError:
            num = 1
    else:
        num = 1
    return f'{prefix}{num}'

# ── ROUTES ────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    # One-time token from landing page (solves cross-site cookie block on iOS Safari)
    tok = request.args.get('t')
    if tok:
        entry = _login_tokens.pop(tok, None)
        if entry and entry['expires'] > time.time():
            session['user'] = entry['user']
            return redirect('/')
        return redirect(LANDING_URL)
    if 'user' not in session:
        return redirect(LANDING_URL)
    resp = make_response(render_template('index.html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return resp

@app.route('/stock')
def stock_page():
    tok = request.args.get('t')
    if tok:
        entry = _login_tokens.pop(tok, None)
        if entry and entry['expires'] > time.time():
            session['user'] = entry['user']
            return redirect('/stock')
        return redirect(LANDING_URL)
    if 'user' not in session:
        return redirect(LANDING_URL)
    resp = make_response(render_template('stock.html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return resp

@app.route('/setup-admin', methods=['GET', 'POST'])
def setup_admin():
    """First-run: bootstrap the first developer/admin account."""
    if request.method == 'POST':
        data = request.get_json() or {}
        phone = data.get('phone', '').strip()
        name  = data.get('name', 'Admin').strip()
        pin   = data.get('pin', '').strip()
        if not phone or not phone.startswith('+'):
            return jsonify({'ok': False, 'error': 'Phone must start with + and country code'}), 400
        if not pin or not pin.isdigit() or len(pin) < 4:
            return jsonify({'ok': False, 'error': 'PIN must be 4+ digits'}), 400
        key = _phone_key(phone)
        existing_user = _firebase_auth_get(f'/{key}')
        user_data = {
            **(existing_user or {}),
            'phone': phone,
            'name': name,
            'admin': True,
            'developer': True,
            'allowed': True,
            'pin_hash': hashlib.sha256(pin.encode()).hexdigest(),
            'modules': {m: True for m in ALL_MODULES},
        }
        try:
            _firebase_auth_put(key, user_data)
            action = 'PIN updated' if existing_user else 'Developer account created'
            return jsonify({'ok': True, 'message': f'{action}. Sign in at mm-mart-live.web.app'})
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 500

    return make_response(render_template('setup_admin.html'))

@app.route('/crm')
def crm():
    resp = make_response(render_template('crm.html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return resp

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db()
    stats = {}
    for pfx, label in [('TM','Thailand'),('IM','Indonesia'),('HM','Asian Halal'),('MM','Myanmar')]:
        stats[label] = conn.execute(
            "SELECT COUNT(*) FROM products WHERE sku LIKE ?", (pfx+'%',)
        ).fetchone()[0]
    stats['total'] = sum(stats.values())
    stats['with_barcode'] = conn.execute(
        "SELECT COUNT(*) FROM products WHERE barcode IS NOT NULL AND barcode != '' AND LENGTH(barcode) > 6"
    ).fetchone()[0]
    stats['invoices_today'] = conn.execute(
        "SELECT COUNT(*) FROM invoices WHERE DATE(created_at) = DATE('now')"
    ).fetchone()[0]
    stats['invoices_total'] = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]
    conn.close()
    return jsonify(stats)

# ── Products ──────────────────────────────────────────────────────────────────
@app.route('/api/products', methods=['GET'])
def get_products():
    global _last_sync_time
    import time as _time
    now = _time.time()
    if now - _last_sync_time >= _SYNC_INTERVAL:
        if _sync_lock.acquire(blocking=False):
            try:
                _pull_firebase_changes()
                _last_sync_time = _time.time()
            except Exception as _e:
                print(f'  Inline sync error: {_e}')
            finally:
                _sync_lock.release()
    conn = get_db()
    rows = conn.execute(
        'SELECT sku,name,supplier,price,category_id,barcode,image_url,stock FROM products ORDER BY sku'
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/products', methods=['POST'])
def add_product():
    data = request.get_json()
    if not data or not data.get('name'):
        abort(400)
    conn = get_db()
    sku = (data.get('sku') or '').strip()
    if not sku:
        prefix = (data.get('sku_prefix') or 'Xx').strip()  # preserve user casing (Tm, Im, Hm, Mm)
        sku = _next_sku(conn, prefix)
    conn.execute(
        'INSERT OR IGNORE INTO products(sku,name,supplier,price,category_id,barcode) VALUES(?,?,?,?,?,?)',
        (sku, data['name'], data.get('supplier', ''), data.get('price', 0),
         data.get('category_id'), data.get('barcode', ''))
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'sku': sku})

@app.route('/api/products/<sku>', methods=['PATCH'])
def update_product(sku):
    data = request.get_json()
    conn = get_db()
    fields, vals = [], []
    for f in ('name', 'price', 'barcode', 'category_id', 'supplier', 'image_url', 'stock'):
        if f in data:
            fields.append(f'{f}=?')
            vals.append(data[f])
    if fields:
        conn.execute(f'UPDATE products SET {",".join(fields)} WHERE sku=?', (*vals, sku))
        conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/products/<sku>/image', methods=['POST'])
def upload_product_image(sku):
    """Receive a file upload, store in GCS, update DB + Firebase."""
    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'No file'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'ok': False, 'error': 'No file selected'}), 400
    try:
        import io
        from google.cloud import storage as _gcs
        data = f.read()
        # Convert any format to JPEG via Pillow
        try:
            from PIL import Image as _Img
            img = _Img.open(io.BytesIO(data))
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=88, optimize=True)
            data = buf.getvalue()
        except Exception:
            pass   # upload raw if Pillow fails
        client = _gcs.Client()
        blob = client.bucket('mm-mart-products').blob(f'products/{sku}.jpg')
        blob.upload_from_string(data, content_type='image/jpeg')
        url = f'https://storage.googleapis.com/mm-mart-products/products/{sku}.jpg'
        conn = get_db()
        conn.execute('UPDATE products SET image_url=? WHERE sku=?', (url, sku))
        conn.commit()
        fb_row = conn.execute('SELECT fb_no FROM products WHERE sku=?', (sku,)).fetchone()
        conn.close()
        versioned_url = url + '?v=' + str(int(time.time()))
        # Patch with both SKU key and numeric key so catalog app (which uses numeric keys) finds it
        no = _sku_to_no(sku) or (fb_row['fb_no'] if fb_row and fb_row['fb_no'] else None)
        patch = {sku: versioned_url}
        if no:
            patch[str(no)] = versioned_url
        _firebase_patch('images', patch)
        return jsonify({'ok': True, 'url': versioned_url})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/products/<sku>', methods=['DELETE'])
def delete_product(sku):
    conn = get_db()
    conn.execute('DELETE FROM products WHERE sku=?', (sku,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/prices', methods=['POST'])
def save_prices():
    data = request.get_json()
    if not data:
        abort(400)
    conn = get_db()
    conn.executemany('UPDATE products SET price=? WHERE sku=?',
                     [(item.get('price', 0), item['sku']) for item in data])
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'updated': len(data)})

@app.route('/api/prices/<sku>', methods=['PATCH'])
def update_price(sku):
    data = request.get_json()
    conn = get_db()
    conn.execute('UPDATE products SET price=? WHERE sku=?', (data.get('price', 0), sku))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── Categories ────────────────────────────────────────────────────────────────
@app.route('/api/categories', methods=['GET'])
def get_categories():
    conn = get_db()
    rows = conn.execute('SELECT * FROM categories ORDER BY sort_order,name').fetchall()
    # product counts per category
    counts = {r[0]: r[1] for r in conn.execute(
        'SELECT category_id, COUNT(*) FROM products WHERE category_id IS NOT NULL GROUP BY category_id'
    ).fetchall()}
    conn.close()
    cats = [dict(r) for r in rows]
    mains = [c for c in cats if c['parent_id'] is None]
    for m in mains:
        m['subs'] = [dict(**c, product_count=counts.get(c['id'], 0))
                     for c in cats if c['parent_id'] == m['id']]
        m['product_count'] = counts.get(m['id'], 0)
    return jsonify(mains)

@app.route('/api/categories', methods=['POST'])
def create_category():
    data = request.get_json()
    if not data or not data.get('name'):
        abort(400)
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO categories(name,parent_id,sku_prefix,sort_order) VALUES(?,?,?,?)',
        (data['name'].strip(), data.get('parent_id'), data.get('sku_prefix', '').upper(), data.get('sort_order', 99))
    )
    cat_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': cat_id})

@app.route('/api/categories/<int:cat_id>', methods=['PATCH'])
def update_category(cat_id):
    data = request.get_json()
    conn = get_db()
    fields, vals = [], []
    for f in ('name', 'sku_prefix', 'sort_order'):
        if f in data:
            fields.append(f'{f}=?')
            vals.append(data[f])
    if fields:
        conn.execute(f'UPDATE categories SET {",".join(fields)} WHERE id=?', (*vals, cat_id))
        conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/categories/<int:cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    conn = get_db()
    subs  = conn.execute('SELECT COUNT(*) FROM categories WHERE parent_id=?', (cat_id,)).fetchone()[0]
    prods = conn.execute('SELECT COUNT(*) FROM products WHERE category_id=?', (cat_id,)).fetchone()[0]
    if subs or prods:
        conn.close()
        return jsonify({'ok': False, 'error': f'Cannot delete: has {subs} subcategories and {prods} products'}), 400
    conn.execute('DELETE FROM categories WHERE id=?', (cat_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── Stores ───────────────────────────────────────────────────────────────────
_DEFAULT_STORES = [
    {"id":"mm_mart",      "name":"MM-MART",    "sub":"Kita Otsuka",      "address":"東京都豊島区北大塚3-32-3(201)", "tel":"03-6903-6174","email":"","zip":"170-0004"},
    {"id":"takadano",     "name":"MM-MART",    "sub":"Takadano Baba",    "address":"東京都新宿区高田馬場4丁目9-14岩ビル1階","tel":"03-6768-0683","email":"","zip":"169-0075"},
    {"id":"kita_otsuka",  "name":"MM-MART",    "sub":"Kita Otsuka",      "address":"東京都豊島区北大塚3丁目32-3","tel":"03-6903-6174","email":"","zip":"170-0004"},
    {"id":"minami",       "name":"MM-MART",    "sub":"Minami Otsuka",    "address":"東京都豊島区南大塚","tel":"","email":"","zip":"170-0005"},
    {"id":"komagome",     "name":"MM-MART",    "sub":"Komagome",         "address":"東京都豊島区駒込","tel":"","email":"","zip":""},
    {"id":"sugamo",       "name":"MM-MART",    "sub":"Sugamo",           "address":"東京都豊島区巣鴨","tel":"","email":"","zip":""},
    {"id":"kawaguchi",    "name":"MM-MART",    "sub":"Kawaguchi",        "address":"埼玉県川口市","tel":"","email":"","zip":""},
    {"id":"higashi_jujo", "name":"MM-MART",    "sub":"Higashi Jujo",     "address":"東京都北区東十条","tel":"","email":"","zip":""},
    {"id":"briyani_ot",   "name":"MM Briyani", "sub":"Otsuka",           "address":"東京都豊島区北大塚","tel":"","email":"","zip":""},
    {"id":"briyani_tb",   "name":"MM Briyani", "sub":"Takadano Baba",    "address":"東京都新宿区高田馬場","tel":"","email":"","zip":""},
]

def seed_stores():
    conn = get_db()
    for s in _DEFAULT_STORES:
        conn.execute(
            'INSERT OR IGNORE INTO stores(id,name,sub,address,tel,email,zip) VALUES(?,?,?,?,?,?,?)',
            (s['id'], s['name'], s['sub'], s['address'], s['tel'], s.get('email',''), s['zip'])
        )
    conn.commit()
    conn.close()

@app.route('/api/stores', methods=['GET'])
def get_stores():
    conn = get_db()
    rows = conn.execute('SELECT * FROM stores ORDER BY name,sub').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/stores', methods=['POST'])
def create_store():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    sub  = (data.get('sub')  or '').strip()
    if not name and not sub:
        return jsonify({'ok': False, 'error': 'Name or branch required'}), 400
    sid = re.sub(r'[^a-z0-9]+', '_', (name + '_' + sub).lower()).strip('_') or 'store'
    conn = get_db()
    # ensure unique id
    base, n = sid, 1
    while conn.execute('SELECT 1 FROM stores WHERE id=?', (sid,)).fetchone():
        sid = f'{base}_{n}'; n += 1
    conn.execute(
        'INSERT INTO stores(id,name,sub,address,tel,email,zip) VALUES(?,?,?,?,?,?,?)',
        (sid, name, sub, data.get('address','').strip(), data.get('tel','').strip(),
         data.get('email','').strip(), data.get('zip','').strip())
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': sid})

@app.route('/api/stores/<store_id>', methods=['PUT'])
def update_store(store_id):
    data = request.get_json() or {}
    conn = get_db()
    conn.execute(
        'UPDATE stores SET name=?,sub=?,address=?,tel=?,email=?,zip=? WHERE id=?',
        (
            (data.get('name') or '').strip(),
            (data.get('sub')  or '').strip(),
            (data.get('address') or '').strip(),
            (data.get('tel')     or '').strip(),
            (data.get('email')   or '').strip(),
            (data.get('zip')     or '').strip(),
            store_id
        )
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/stores/<store_id>', methods=['DELETE'])
def delete_store(store_id):
    conn = get_db()
    conn.execute('DELETE FROM stores WHERE id=?', (store_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ── Sync (for Lovable catalog integration) ────────────────────────────────────
@app.route('/api/sync/stock', methods=['POST'])
def sync_stock_now():
    """Immediately pull stock from Supabase warehouse. Called by warehouse app on stock change."""
    global _last_supabase_sync
    conn = get_db()
    n = _pull_supabase_stock(conn)
    _last_supabase_sync = time.time()
    conn.close()
    return jsonify({'ok': True, 'updated': n})

@app.route('/api/sync', methods=['POST'])
def sync_products():
    """Receive product upserts from external catalog (Lovable or any system)."""
    data = request.get_json()
    if not data:
        abort(400)
    if isinstance(data, dict):
        data = [data]
    conn = get_db()
    synced = 0
    for p in data:
        sku = (p.get('sku') or '').strip().upper()
        if not sku:
            continue
        cat_id = None
        for key in ('subcategory', 'category'):
            if p.get(key):
                row = conn.execute('SELECT id FROM categories WHERE name=?', (p[key],)).fetchone()
                if row:
                    cat_id = row[0]
                    break
        if conn.execute('SELECT sku FROM products WHERE sku=?', (sku,)).fetchone():
            conn.execute(
                'UPDATE products SET name=?,supplier=?,price=?,category_id=?,barcode=? WHERE sku=?',
                (p.get('name',''), p.get('supplier', p.get('subcategory','')),
                 p.get('price',0), cat_id, p.get('barcode',''), sku)
            )
        else:
            conn.execute(
                'INSERT INTO products(sku,name,supplier,price,category_id,barcode) VALUES(?,?,?,?,?,?)',
                (sku, p.get('name',''), p.get('supplier', p.get('subcategory','')),
                 p.get('price',0), cat_id, p.get('barcode',''))
            )
        synced += 1
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'synced': synced})

@app.route('/api/sync/firebase', methods=['POST'])
def sync_firebase():
    """Two-way Firebase sync.
    PULL: barcodes from Firebase → billing (all products: TM/IM/HM/MM).
          Myanmar overrides (name/price) → billing.
    PUSH: billing data (SKU codes, names, prices) → Firebase custom/overrides.
    """
    conn = get_db()
    barcodes  = _fb_get('barcodes')  or {}
    overrides = _fb_get('overrides') or {}

    barcode_updates = 0
    override_updates = 0

    # ── Pull: barcodes for TM / IM / HM products ─────────────────────────────
    rows = conn.execute(
        "SELECT sku, barcode FROM products "
        "WHERE sku GLOB 'TM[0-9]*' OR sku GLOB 'IM[0-9]*' OR sku GLOB 'HM[0-9]*'"
    ).fetchall()
    for r in rows:
        no = _sku_to_no(r['sku'])
        if no is None:
            continue
        fb_bc = barcodes.get(str(no), '')
        if fb_bc and fb_bc != (r['barcode'] or ''):
            conn.execute('UPDATE products SET barcode=? WHERE sku=?', (fb_bc, r['sku']))
            barcode_updates += 1

    # ── Pull: barcodes + name/price overrides for Myanmar products ────────────
    mm_rows = conn.execute(
        'SELECT sku, barcode, fb_no, name, price FROM products WHERE sku GLOB "MM[0-9]*"'
    ).fetchall()
    for r in mm_rows:
        if not r['fb_no']:
            continue
        no_key = str(r['fb_no'])

        fb_bc = barcodes.get(no_key, '')
        if fb_bc and fb_bc != (r['barcode'] or ''):
            conn.execute('UPDATE products SET barcode=? WHERE sku=?', (fb_bc, r['sku']))
            barcode_updates += 1

        ov = overrides.get(no_key) or {}
        ov_name = ov.get('name', '')
        if ov_name and ov_name != r['name']:
            try:
                price = float(ov.get('p1', r['price'] or 0))
            except (ValueError, TypeError):
                price = r['price'] or 0
            conn.execute('UPDATE products SET name=?, price=? WHERE sku=?',
                         (ov_name, price, r['sku']))
            override_updates += 1

    conn.commit()

    # ── Push: all billing data (with current SKU codes) → Firebase ───────────
    payload = _build_firebase_payload(conn)
    conn.close()

    errors = []
    pushed = 0
    for path, data in [('overrides', payload['overrides']),
                       ('barcodes',  payload['barcodes'])]:
        try:
            _firebase_patch(path, data)
            pushed += len(data)
        except Exception as e:
            errors.append(f'{path}: {e}')
    try:
        req = urllib.request.Request(
            f'{FIREBASE_BASE}/custom.json',
            data=json.dumps(payload['custom']).encode(),
            method='PUT',
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
        pushed += len(payload['custom'])
    except Exception as e:
        errors.append(f'custom: {e}')

    result = {
        'ok': not errors,
        'pulled': {'barcodes': barcode_updates, 'overrides': override_updates},
        'pushed': pushed,
    }
    if errors:
        result['errors'] = errors
    return jsonify(result)

# Stable numeric `no` for non-Myanmar products — Lovable requires numeric keys
# TM1-TM217 → 1001-1217, IM1-IM60 → 2001-2060, HM1-HM136 → 3001-3136
_PREFIX_BASE = {
    'TM': 1000, 'IM': 2000, 'HM': 3000,
}

def _sku_to_no(sku):
    """Convert billing SKU like TM5 → stable numeric no for Lovable (1005)."""
    if not sku or len(sku) < 3:
        return None
    prefix   = sku[:2].upper()
    num_part = sku[2:]
    base     = _PREFIX_BASE.get(prefix)
    if base is None:
        return None
    if not num_part.isdigit():
        return None
    return base + int(num_part)

def _build_firebase_payload(conn):
    """Build Firebase-compatible payload from all billing products.
    Myanmar products (MM prefix, fb_no 1-187) → overrides keyed by fb_no.
    Non-Myanmar products (TM/IM/HM) → custom keyed by stable numeric no.
    Images → keyed by same numeric no as their section.
    """
    rows = conn.execute('''
        SELECT p.sku, p.name, p.supplier, p.price, p.barcode, p.fb_no, p.image_url,
               c.name as subcat, pm.name as maincat
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories pm ON c.parent_id = pm.id
    ''').fetchall()

    overrides = {}
    barcodes  = {}
    custom    = {}
    images    = {}

    for r in rows:
        sku      = r['sku']       or ''
        name     = r['name']      or ''
        supplier = r['supplier']  or ''
        price    = r['price']     or 0
        barcode  = r['barcode']   or ''
        fb_no    = r['fb_no']
        image_url= r['image_url'] or ''
        subcat   = r['subcat']    or ''
        maincat  = r['maincat']   or ''

        if sku.startswith('MM') and fb_no and fb_no <= 187:
            no_key = str(fb_no)
            overrides[no_key] = {'name': name, 'brand': supplier, 'p1': price, 'code': sku}
            if barcode and not barcode.startswith('MM'):
                barcodes[no_key] = barcode
            # Myanmar images: use Lovable CDN path (billing image_url already points there)
            img = image_url or f'{LOVABLE_BASE}/products/product_{str(fb_no).zfill(3)}.jpg'
            images[no_key] = img
        else:
            no = _sku_to_no(sku)
            if no is None:
                continue
            no_key = str(no)
            custom[no_key] = {
                'no':     no,
                'name':   name,
                'brand':  subcat,
                'code':   sku,
                'origin': maincat,
                'size':   '', 'pcs': '', 'p1': price, 'p10': '', 'pcase': '',
            }
            if barcode and not barcode.startswith(sku[:2]):
                barcodes[no_key] = barcode
            if image_url:
                images[no_key] = image_url

    return {'overrides': overrides, 'barcodes': barcodes, 'custom': custom, 'images': images}

@app.route('/api/export/firebase', methods=['GET'])
def export_firebase():
    """Download Firebase-compatible JSON of all billing products."""
    conn = get_db()
    payload = _build_firebase_payload(conn)
    conn.close()
    resp = make_response(json.dumps(payload, ensure_ascii=False, indent=2))
    resp.headers['Content-Type'] = 'application/json'
    resp.headers['Content-Disposition'] = 'attachment; filename="billing_products_firebase.json"'
    return resp

@app.route('/api/export/csv', methods=['GET'])
def export_csv():
    """Download CSV of all billing products."""
    conn = get_db()
    rows = conn.execute('''
        SELECT p.sku, p.name, p.supplier, p.price, p.barcode, p.image_url,
               c.name as subcat, pm.name as maincat
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories pm ON c.parent_id = pm.id
        ORDER BY pm.name, c.name, p.name
    ''').fetchall()
    conn.close()

    lines = ['SKU,Name,Brand/Supplier,Category,Subcategory,Price,Barcode,Image URL']
    for r in rows:
        def q(v): return '"' + str(v or '').replace('"', '""') + '"'
        lines.append(','.join([
            q(r['sku']), q(r['name']), q(r['supplier']),
            q(r['maincat']), q(r['subcat']),
            str(r['price'] or 0), q(r['barcode']), q(r['image_url'])
        ]))

    resp = make_response('\n'.join(lines))
    resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
    resp.headers['Content-Disposition'] = 'attachment; filename="billing_products.csv"'
    return resp

@app.route('/api/push/firebase', methods=['POST'])
def push_firebase():
    """Push all billing products to Firebase so Lovable can show and enrich them."""
    conn = get_db()
    payload = _build_firebase_payload(conn)
    conn.close()

    errors = []
    pushed = 0
    # PATCH overrides and barcodes (merge with existing Firebase data)
    for path, data in [('overrides', payload['overrides']),
                       ('barcodes',  payload['barcodes']),
                       ('images',    payload['images'])]:
        try:
            _firebase_patch(path, data)
            pushed += len(data)
        except Exception as e:
            errors.append(f'{path}: {e}')
    # PUT custom (full replace to clear old string-keyed mess, replace with clean numeric keys)
    try:
        req = urllib.request.Request(
            f'{FIREBASE_BASE}/custom.json',
            data=json.dumps(payload['custom']).encode(),
            method='PUT',
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        pushed += len(payload['custom'])
    except Exception as e:
        errors.append(f'custom: {e}')

    if errors:
        return jsonify({'ok': False, 'error': '; '.join(errors), 'pushed': pushed})
    return jsonify({'ok': True, 'pushed': pushed,
                    'detail': {k: len(v) for k, v in payload.items()}})

@app.route('/api/catalog/data', methods=['GET'])
def catalog_data():
    """Return full catalog payload (overrides, barcodes, custom, images) as JSON.
    Used by the local catalog app to pull billing data directly without Firebase.
    """
    conn = get_db()
    payload = _build_firebase_payload(conn)
    conn.close()
    return jsonify({'ok': True, **payload})

# ── Invoices ──────────────────────────────────────────────────────────────────
@app.route('/api/invoices', methods=['GET'])
def list_invoices():
    store = request.args.get('store', '')
    conn = get_db()
    if store:
        rows = conn.execute(
            'SELECT id,store,date,invoice_no,total,created_at,store_snapshot FROM invoices WHERE store=? ORDER BY id DESC',
            (store,)).fetchall()
    else:
        rows = conn.execute(
            'SELECT id,store,date,invoice_no,total,created_at,store_snapshot FROM invoices ORDER BY id DESC LIMIT 100'
        ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/invoices', methods=['POST'])
def save_invoice():
    data = request.get_json()
    created_at = datetime.now().isoformat()
    conn = get_db()
    cur = conn.execute(
        '''INSERT INTO invoices(store,date,invoice_no,items,subtotal,tax_rate,
           discount_val,discount_type,credit_amount,credit_reason,total,
           store_snapshot,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (data.get('store',''), data.get('date',''), data.get('invoice_no',''),
         json.dumps(data.get('items',[])),
         data.get('subtotal',0), data.get('tax_rate',0),
         data.get('discount_val',0), data.get('discount_type','pct'),
         data.get('credit_amount',0), data.get('credit_reason',''),
         data.get('total',0),
         data.get('store_snapshot',''),
         created_at)
    )
    inv_id = cur.lastrowid
    conn.commit()
    # Persist to Firebase so data survives container restarts
    fb_payload = {k: data[k] for k in data}
    fb_payload['created_at'] = created_at
    fb_key = _fb_inv_push(fb_payload)
    if fb_key:
        conn.execute('UPDATE invoices SET fb_key=? WHERE id=?', (fb_key, inv_id))
        conn.commit()
    # Resolve barcodes while conn is still open, then push to Supabase in background
    items_with_bc = []
    for item in data.get('items', []):
        sku = (item.get('sku') or '').strip()
        boxes = int(item.get('qty') or 0)
        if sku and boxes > 0:
            row = conn.execute('SELECT barcode FROM products WHERE sku=?', (sku,)).fetchone()
            if row and row['barcode']:
                items_with_bc.append({'barcode': row['barcode'], 'qty': boxes})
    conn.close()
    if items_with_bc:
        threading.Thread(
            target=lambda: [_sb_adjust_qty_by_barcode(i['barcode'], -i['qty']) for i in items_with_bc],
            daemon=True
        ).start()
    return jsonify({'ok': True, 'id': inv_id})

@app.route('/api/invoices/<int:inv_id>', methods=['GET'])
def get_invoice(inv_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM invoices WHERE id=?', (inv_id,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    d = dict(row)
    d['items'] = json.loads(d['items'])
    return jsonify(d)

@app.route('/api/invoices/<int:inv_id>', methods=['DELETE'])
def delete_invoice(inv_id):
    conn = get_db()
    row = conn.execute('SELECT fb_key, items FROM invoices WHERE id=?', (inv_id,)).fetchone()
    conn.execute('DELETE FROM invoices WHERE id=?', (inv_id,))
    conn.commit()
    # Resolve barcodes before closing connection, restore stock in background
    items_with_bc = []
    if row and row['items']:
        try:
            for item in json.loads(row['items']):
                sku = (item.get('sku') or '').strip()
                boxes = int(item.get('qty') or 0)
                if sku and boxes > 0:
                    bc_row = conn.execute('SELECT barcode FROM products WHERE sku=?', (sku,)).fetchone()
                    if bc_row and bc_row['barcode']:
                        items_with_bc.append({'barcode': bc_row['barcode'], 'qty': boxes})
        except Exception:
            pass
    conn.close()
    if row and row['fb_key']:
        _fb_inv_delete(row['fb_key'])
    if items_with_bc:
        threading.Thread(
            target=lambda: [_sb_adjust_qty_by_barcode(i['barcode'], +i['qty']) for i in items_with_bc],
            daemon=True
        ).start()
    return jsonify({'ok': True})

# ── Summary ───────────────────────────────────────────────────────────────────
@app.route('/api/summary/full', methods=['GET'])
def get_summary_full():
    today = datetime.now().date()
    wk  = (today - timedelta(days=today.weekday())).isoformat()
    mo  = today.strftime('%Y-%m-01')
    lm_m = today.month - 1 or 12
    lm_y = today.year if today.month > 1 else today.year - 1
    lm  = f'{lm_y:04d}-{lm_m:02d}-01'
    conn = get_db()
    rows = conn.execute('''
        SELECT store,
            SUM(CASE WHEN date>=? THEN total ELSE 0 END) wk_total,
            SUM(CASE WHEN date>=? THEN 1 ELSE 0 END) wk_cnt,
            SUM(CASE WHEN date>=? THEN total ELSE 0 END) mo_total,
            SUM(CASE WHEN date>=? THEN 1 ELSE 0 END) mo_cnt,
            SUM(CASE WHEN date>=? AND date<? THEN total ELSE 0 END) lm_total,
            SUM(CASE WHEN date>=? AND date<? THEN 1 ELSE 0 END) lm_cnt,
            SUM(total) all_total, COUNT(*) all_cnt
        FROM invoices GROUP BY store ORDER BY all_total DESC
    ''', (wk,wk,mo,mo,lm,mo,lm,mo)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/summary', methods=['GET'])
def get_summary():
    period = request.args.get('period', 'all')
    today = datetime.now().date()
    conn = get_db()
    sql = 'SELECT store,COUNT(*) cnt,SUM(subtotal) subtotal,SUM(total-subtotal) tax,SUM(total) total FROM invoices'
    if period == 'week':
        start = (today - timedelta(days=today.weekday())).isoformat()
        rows = conn.execute(sql + ' WHERE date>=? GROUP BY store ORDER BY total DESC', (start,)).fetchall()
    elif period == 'month':
        start = today.strftime('%Y-%m-01')
        rows = conn.execute(sql + ' WHERE date>=? GROUP BY store ORDER BY total DESC', (start,)).fetchall()
    elif period == 'lastmonth':
        m = today.month - 1 or 12
        y = today.year if today.month > 1 else today.year - 1
        start = f'{y:04d}-{m:02d}-01'
        end = today.strftime('%Y-%m-01')
        rows = conn.execute(sql + ' WHERE date>=? AND date<? GROUP BY store ORDER BY total DESC', (start, end)).fetchall()
    else:
        rows = conn.execute(sql + ' GROUP BY store ORDER BY total DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

# ── STARTUP ───────────────────────────────────────────────────────────────────
# Always initialize DB on import so gunicorn workers are ready immediately
init_db()
seed_categories()        # categories must exist before products are linked
seed_stores()            # seed default store list if empty
load_products_if_empty() # loads from Firebase and links to categories
_load_invoices_from_firebase()  # restore invoice history from Firebase RTDB
try:
    sync_myanmar_catalog()   # creates MM brand subcategories + assigns category_id
except Exception as _e:
    print(f'  Myanmar catalog startup sync failed: {_e}')
_start_bg_sync()         # keeps barcodes + prices in sync with Firebase every 30s

if __name__ == '__main__':
    try:
        local_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        local_ip = '127.0.0.1'
    print('\n' + '='*55)
    print('  MM-MART Billing Server is RUNNING')
    print('='*55)
    print(f'  This computer : http://localhost:8080')
    print(f'  Other devices : http://{local_ip}:8080')
    print('  (All devices must be on the same Wi-Fi)')
    print('  Press Ctrl+C to stop the server')
    print('='*55 + '\n')
    app.run(host='0.0.0.0', port=8080, debug=False)
