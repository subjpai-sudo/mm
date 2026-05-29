#!/usr/bin/env python3
"""
match_upload_images.py — AI image matcher for MM-MART vendor photos
Identifies products in vendor photos using Gemini Vision, uploads to GCS,
stores URLs in Firebase RTDB (survives Cloud Run container restarts).

Usage:
  GEMINI_API_KEY=... python3 match_upload_images.py
  GEMINI_API_KEY=... python3 match_upload_images.py --dry-run   (no upload)
  GEMINI_API_KEY=... python3 match_upload_images.py --folder "A 1 Thai"
"""

import os, sys, json, base64, sqlite3, subprocess, tempfile, time
import urllib.request
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────
GEMINI_KEY    = os.environ.get('GEMINI_API_KEY', '').strip()
OPENAI_KEY    = os.environ.get('OPENAI_API_KEY', '').strip()
GCS_BUCKET    = 'mm-mart-products'
GCS_BASE      = f'https://storage.googleapis.com/{GCS_BUCKET}/products'
FIREBASE_BASE = 'https://mm-mart-live-default-rtdb.asia-southeast1.firebasedatabase.app/catalog'
DB_PATH       = Path(__file__).parent / 'billing.db'
MM_DIR        = Path(__file__).parent.parent   # /Users/anique/Documents/MM
DRY_RUN       = '--dry-run' in sys.argv
ONLY_FOLDER   = None
for i, a in enumerate(sys.argv):
    if a == '--folder' and i + 1 < len(sys.argv):
        ONLY_FOLDER = sys.argv[i + 1]

# Vendor folder name → DB supplier name (None = skip)
VENDOR_MAP = {
    'A 1 Thai':           'A1 Thai',
    'ABC Company':        'ABC COMPANY',
    'Ambika corporation': 'AMBIKA',
    'Bompex Japan':       'BOMPEX JAPAN',
    'Ichiba':             'ICHIBA',
    'Imai Japan':         'IMAI JAPAN',
    'Lifu Tou Thai':      'Lifu Tou',
    'Sartaz Corporation': 'SARTAJ',
    'Kara Indonasian':    None,   # not yet in DB
    'Next International': None,   # not yet in DB
}

IMG_EXTS = {'.jpg', '.jpeg', '.png', '.heic', '.heif'}


# ── Image helpers ──────────────────────────────────────────────────────────
def to_jpeg_b64(img_path: Path):
    """Return (base64_str, mime) — converts HEIC to JPEG via macOS sips."""
    if img_path.suffix.lower() in ('.heic', '.heif'):
        tmp = tempfile.mktemp(suffix='.jpg')
        subprocess.run(['sips', '-s', 'format', 'jpeg', str(img_path), '--out', tmp],
                       capture_output=True, check=True)
        data = Path(tmp).read_bytes()
        os.unlink(tmp)
    else:
        data = img_path.read_bytes()
    return base64.b64encode(data).decode(), 'image/jpeg'


# ── Gemini Vision ──────────────────────────────────────────────────────────
def ask_vision(b64: str, mime: str, products: list, vendor: str):
    """Returns list of (sku, 'HIGH'|'MEDIUM') matches found in image.
    Uses OpenAI GPT-4o-mini (fast, cheap, generous rate limits).
    Falls back to Gemini if OPENAI_KEY not set."""
    product_list = '\n'.join(f'{i+1}. [{s}] {n}' for i, (s, n) in enumerate(products))
    prompt = (
        f'You are identifying Asian grocery products for MM-MART store.\n'
        f'Vendor: {vendor}\n\n'
        f'Products from this vendor in our database:\n{product_list}\n\n'
        f'Look at the image. It may be a photo of a single product OR a catalog/document '
        f'page showing multiple products. Identify ALL products visible from the list.\n\n'
        f'For each match respond on its own line (exact format):\n'
        f'MATCH: [SKU] | HIGH\n'
        f'MATCH: [SKU] | MEDIUM\n\n'
        f'HIGH = very confident. MEDIUM = likely. Skip LOW confidence.\n'
        f'If nothing matches: NONE'
    )

    if OPENAI_KEY:
        # ── OpenAI GPT-4o-mini vision ──────────────────────────────────────
        payload = {
            'model': 'gpt-4o-mini',
            'max_tokens': 512,
            'temperature': 0.05,
            'messages': [{
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': prompt},
                    {'type': 'image_url', 'image_url': {
                        'url': f'data:{mime};base64,{b64}',
                        'detail': 'low',   # low = faster + cheaper
                    }},
                ],
            }],
        }
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    'https://api.openai.com/v1/chat/completions',
                    json.dumps(payload).encode(),
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {OPENAI_KEY}',
                    },
                )
                with urllib.request.urlopen(req, timeout=45) as r:
                    resp = json.loads(r.read())
                text = resp['choices'][0]['message']['content'].strip()
                break
            except urllib.error.HTTPError as e:
                body = e.read().decode()
                if e.code == 429:
                    wait = 15 * (2 ** attempt)
                    print(f'\n    [rate limit — waiting {wait}s]', end='', flush=True)
                    time.sleep(wait)
                    if attempt == 2: raise
                else:
                    raise RuntimeError(f'OpenAI {e.code}: {body[:200]}')
    elif GEMINI_KEY:
        # ── Gemini fallback ────────────────────────────────────────────────
        url = (
            'https://generativelanguage.googleapis.com/v1beta/models/'
            f'gemini-2.0-flash:generateContent?key={GEMINI_KEY}'
        )
        payload = {
            'contents': [{'parts': [
                {'text': prompt},
                {'inline_data': {'mime_type': mime, 'data': b64}},
            ]}],
            'generationConfig': {'temperature': 0.05, 'maxOutputTokens': 512},
        }
        for attempt in range(4):
            try:
                req = urllib.request.Request(
                    url, json.dumps(payload).encode(),
                    headers={'Content-Type': 'application/json'},
                )
                with urllib.request.urlopen(req, timeout=45) as r:
                    resp = json.loads(r.read())
                text = resp['candidates'][0]['content']['parts'][0]['text'].strip()
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    wait = 30 * (2 ** attempt)
                    print(f'\n    [rate limit — waiting {wait}s]', end='', flush=True)
                    time.sleep(wait)
                    if attempt == 3: raise
                else:
                    raise
    else:
        raise ValueError('Set OPENAI_API_KEY or GEMINI_API_KEY')

    valid = {s for s, _ in products}
    matches = []
    for line in text.split('\n'):
        line = line.strip()
        if not line.upper().startswith('MATCH:'):
            continue
        try:
            rest = line[6:].strip()
            sku  = rest.split('|')[0].strip().strip('[]').strip()
            conf = rest.split('|')[1].strip().upper() if '|' in rest else ''
            if conf in ('HIGH', 'MEDIUM') and sku in valid:
                matches.append((sku, conf))
        except Exception:
            pass
    return matches


# ── GCS upload ─────────────────────────────────────────────────────────────
def upload_gcs(img_path: Path, sku: str) -> str:
    """Upload image to GCS as products/{sku}.jpg, return public URL."""
    if img_path.suffix.lower() in ('.heic', '.heif'):
        tmp = tempfile.mktemp(suffix='.jpg')
        subprocess.run(['sips', '-s', 'format', 'jpeg', str(img_path), '--out', tmp],
                       capture_output=True, check=True)
        src, cleanup = tmp, True
    else:
        src, cleanup = str(img_path), False

    dest = f'gs://{GCS_BUCKET}/products/{sku}.jpg'
    r = subprocess.run(['gsutil', '-q', 'cp', src, dest], capture_output=True, text=True)
    if cleanup:
        os.unlink(src)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or 'gsutil failed')
    return f'{GCS_BASE}/{sku}.jpg'


# ── Firebase + DB ──────────────────────────────────────────────────────────
def push_firebase(updates: dict):
    """PATCH {sku: url, ...} into catalog/images in Firebase RTDB."""
    data = json.dumps(updates).encode()
    req = urllib.request.Request(
        f'{FIREBASE_BASE}/images.json', data=data, method='PATCH',
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        r.read()


def update_local_db(updates: dict):
    conn = sqlite3.connect(str(DB_PATH))
    for sku, url in updates.items():
        conn.execute('UPDATE products SET image_url=? WHERE sku=?', (url, sku))
    conn.commit()
    conn.close()


# ── Main ───────────────────────────────────────────────────────────────────
def main():
    if not OPENAI_KEY and not GEMINI_KEY:
        print('ERROR: Set OPENAI_API_KEY or GEMINI_API_KEY environment variable')
        print('  OPENAI_API_KEY=sk-... python3 match_upload_images.py')
        sys.exit(1)
    print(f'Using: {"OpenAI GPT-4o-mini" if OPENAI_KEY else "Gemini 2.0 Flash"}')

    if DRY_RUN:
        print('── DRY RUN (no uploads, no DB writes) ──\n')

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    done: set = set()
    stats = dict(matched=0, uploaded=0, no_match=0, skipped=0, errors=0)
    firebase_batch: dict = {}

    vendors = [(f, s) for f, s in VENDOR_MAP.items()
               if ONLY_FOLDER is None or f == ONLY_FOLDER]

    for folder_name, supplier in vendors:
        folder_path = MM_DIR / folder_name

        if not folder_path.exists():
            print(f'⚠  Folder not found: {folder_path}')
            continue
        if not supplier:
            print(f'⚠  No DB supplier mapped for "{folder_name}" — skipping')
            continue

        # Only fetch products that still need images
        rows = conn.execute(
            'SELECT sku, name FROM products WHERE supplier=? '
            'AND (image_url IS NULL OR image_url="") ORDER BY sku',
            (supplier,),
        ).fetchall()
        products = [(r['sku'], r['name']) for r in rows]

        if not products:
            print(f'✓  {folder_name}: all products already have images')
            continue

        images = sorted(p for p in folder_path.iterdir()
                        if p.suffix.lower() in IMG_EXTS)

        print(f'\n{"─"*60}')
        print(f'  {folder_name}  →  {supplier}')
        print(f'  {len(products)} need images  |  {len(images)} images to scan')
        print(f'{"─"*60}')

        for img in images:
            remaining = [(s, n) for s, n in products if s not in done]
            if not remaining:
                print('  ✓ All products matched — moving on')
                break

            print(f'  {img.name}  ', end='', flush=True)
            try:
                b64, mime = to_jpeg_b64(img)
                matches = ask_vision(b64, mime, remaining, folder_name)
                time.sleep(0.5)  # small buffer between requests

                if not matches:
                    print('·')
                    stats['no_match'] += 1
                    continue

                for sku, conf in matches:
                    if sku in done:
                        stats['skipped'] += 1
                        continue
                    name = next((n for s, n in products if s == sku), sku)
                    print(f'\n    [{conf}] {sku}  {name[:52]}')
                    stats['matched'] += 1
                    done.add(sku)

                    if not DRY_RUN:
                        url = upload_gcs(img, sku)
                        firebase_batch[sku] = url
                        stats['uploaded'] += 1
                        print(f'           ✓  {url}')
                    else:
                        print(f'           (dry-run)')

            except KeyboardInterrupt:
                print('\nInterrupted — flushing batch…')
                _flush(firebase_batch, stats)
                conn.close()
                sys.exit(0)
            except Exception as e:
                print(f'  ERROR: {e}')
                stats['errors'] += 1

            # Flush to Firebase every 20 uploads to avoid losing work
            if len(firebase_batch) >= 20:
                _flush(firebase_batch, stats)
                firebase_batch.clear()

    # Final flush
    if firebase_batch:
        _flush(firebase_batch, stats)

    conn.close()
    print(f'\n{"="*60}')
    print(f'  matched   {stats["matched"]}')
    print(f'  uploaded  {stats["uploaded"]}')
    print(f'  no match  {stats["no_match"]}')
    print(f'  errors    {stats["errors"]}')
    print(f'{"="*60}')
    if stats['uploaded']:
        print('\nFirebase RTDB updated at catalog/images/{sku}')
        print('Images appear in stock/billing page within 5 seconds (next sync).')


def _flush(batch: dict, stats: dict):
    if not batch:
        return
    try:
        update_local_db(batch)
        push_firebase(batch)
        print(f'  [batch flushed: {len(batch)} records → Firebase + local DB]')
    except Exception as e:
        print(f'  [batch flush error: {e}]')
        stats['errors'] += 1


if __name__ == '__main__':
    main()
