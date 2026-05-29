#!/usr/bin/env python3
"""
Brother QL-800 Local Print Service - MM-MART Stock Manager
Run on the Mac where the printer is connected via USB.

Install once:
    pip install flask brother_ql pyusb python-barcode Pillow

Usage:
    python3 print_service.py

Drop PNG/JPG template files into:
    ./label_templates/
Optionally add a same-named .json sidecar for display name:
    {"name": "Red Premium"}
"""
import io, os, json, glob, re, sys, platform
from flask import Flask, request, jsonify, send_file
from PIL import Image, ImageDraw, ImageFont

# ── Compatibility patch: Pillow 10+ removed Image.ANTIALIAS ───────────────────
if not hasattr(Image, 'ANTIALIAS'):
    Image.ANTIALIAS = Image.LANCZOS

app = Flask(__name__)

PRINTER_MODEL = 'QL-800'
PRINTER_URI   = 'usb://0x04f9:0x209b'   # QL-800 on this machine; auto-discovered at print time

_DIR          = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(_DIR, 'label_templates')

# ── Die-cut label specs (printable px at 300 dpi) ─────────────────────────────
DIECUT = {
    '62x29':  (720,  342,  '62x29'),
    '62x100': (720,  1179, '62x100'),
    '62x62':  (720,  720,  '62x62'),
    '62x60':  (720,  709,  '62x60'),
    '29x90':  (306,  1063, '29x90'),
    '38x90':  (413,  1063, '38x90'),
}
# Continuous tape widths: mm → printable px width, brother_ql id
CONT = {29: (306, '29'), 38: (413, '38'), 50: (554, '50'), 54: (636, '54'), 62: (720, '62')}
MM2PX = 300 / 25.4

# Continuous tape preset sizes  key → (px_w, px_h, brother_ql_tape_id)
# Use these when the printer has a continuous roll loaded (most common setup)
CONT_PRESETS = {
    'c62x29': (720, 342,  '62'),
    'c62x50': (720, 591,  '62'),
    'c62x90': (720, 1063, '62'),
    'c29x90': (306, 1063, '29'),
    'c38x90': (413, 1063, '38'),
}

# ── CORS ──────────────────────────────────────────────────────────────────────
@app.after_request
def cors(r):
    r.headers['Access-Control-Allow-Origin']  = '*'
    r.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    r.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    # Chrome requires this to allow an HTTPS page to reach localhost (Private Network Access)
    r.headers['Access-Control-Allow-Private-Network'] = 'true'
    return r

@app.route('/templates',            methods=['OPTIONS'])
@app.route('/templates/<path:x>',   methods=['OPTIONS'])
@app.route('/preview',              methods=['OPTIONS'])
@app.route('/print',                methods=['OPTIONS'])
@app.route('/status',               methods=['OPTIONS'])
def _opts(**kw): return '', 204

# ── Fonts (Mac + Windows + Linux) ─────────────────────────────────────────────
_REG = [
    # macOS
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/HelveticaNeue.ttc',
    # Windows
    'C:/Windows/Fonts/arial.ttf',
    'C:/Windows/Fonts/calibri.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    # Linux
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
]
_BOLD = [
    # macOS
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    # Windows
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/calibrib.ttf',
    'C:/Windows/Fonts/segoeuib.ttf',
] + _REG

def _fnt(paths, size):
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, max(8, int(size)))
            except: pass
    return ImageFont.load_default()

def _wrap(text, font, max_w, draw, max_lines=3):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        bb = draw.textbbox((0, 0), t, font=font)
        if bb[2] - bb[0] <= max_w: cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines[:max_lines]

def _txt(draw, xy, text, font, fill, outline='white'):
    x, y = xy
    for dx, dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)]:
        draw.text((x+dx, y+dy), text, font=font, fill=outline)
    draw.text(xy, text, font=font, fill=fill)

# ── Templates ──────────────────────────────────────────────────────────────────
def _scan():
    if not os.path.isdir(TEMPLATES_DIR):
        return []
    seen, out = set(), []
    for ext in ('*.png','*.jpg','*.jpeg','*.bmp','*.PNG','*.JPG','*.JPEG'):
        for path in sorted(glob.glob(os.path.join(TEMPLATES_DIR, ext))):
            if path in seen: continue
            seen.add(path)
            stem = re.sub(r'\.[^.]+$', '', os.path.basename(path))
            tid  = re.sub(r'[^a-z0-9_\-]', '_', stem.lower()).strip('_') or 'tmpl'
            meta_path = re.sub(r'\.[^.]+$', '', path) + '.json'
            meta = {}
            if os.path.exists(meta_path):
                try: meta = json.load(open(meta_path, encoding='utf-8'))
                except: pass
            # Prefer JSON dimensions (written by lbx_convert.py), fall back to image pixels
            if 'mm_w' in meta and 'mm_h' in meta:
                mm_w, mm_h = float(meta['mm_w']), float(meta['mm_h'])
            else:
                try:
                    with Image.open(path) as im:
                        pw, ph = im.size
                    mm_w, mm_h = round(pw / MM2PX, 1), round(ph / MM2PX, 1)
                except: continue
            out.append({
                'id': tid, 'name': meta.get('name', stem),
                'path': path, 'type': 'user',
                'mm_w': mm_w, 'mm_h': mm_h,
            })
    return out

# ── Label dimensions ───────────────────────────────────────────────────────────
def _dims(size_key, cw_mm, ch_mm, orient):
    if size_key == 'custom' and cw_mm and ch_mm:
        tape = min(CONT.keys(), key=lambda x: abs(x - float(cw_mm)))
        px_w, lid = CONT[tape]
        px_h = int(float(ch_mm) * MM2PX)
        return (px_h, px_w, lid) if orient == 'portrait' else (px_w, px_h, lid)
    if size_key in CONT_PRESETS:
        pw, ph, lid = CONT_PRESETS[size_key]
        return (ph, pw, lid) if orient == 'portrait' else (pw, ph, lid)
    if size_key in DIECUT:
        pw, ph, lid = DIECUT[size_key]
        return (ph, pw, lid) if orient == 'portrait' else (pw, ph, lid)
    # fallback: continuous 62×29
    pw, ph, lid = CONT_PRESETS['c62x29']
    return (pw, ph, lid)

# ── Label renderer ─────────────────────────────────────────────────────────────
def make_label(name, sku, price, barcode,
               size_key='c62x29', orient='landscape',
               tmpl_id=None, cw_mm=None, ch_mm=None):

    w, h, label_id = _dims(size_key, cw_mm, ch_mm, orient)
    img = Image.new('RGB', (w, h), 'white')

    # Background template
    if tmpl_id and tmpl_id != 'none':
        t = next((x for x in _scan() if x['id'] == tmpl_id), None)
        if t:
            try:
                bg = Image.open(t['path']).convert('RGB').resize((w, h), Image.LANCZOS)
                img = bg
            except: pass

    draw = ImageDraw.Draw(img)
    pad  = max(12, int(w * 0.018))

    fn  = _fnt(_REG,  int(h * 0.095))
    fs  = _fnt(_REG,  int(h * 0.072))
    fp  = _fnt(_BOLD, int(h * 0.165))
    fbr = _fnt(_BOLD, int(h * 0.072))

    y = pad

    # Name
    for line in _wrap(name or 'Product', fn, w - 2*pad, draw):
        _txt(draw, (pad, y), line, fn, 'black')
        bb = draw.textbbox((0,0), 'Ag', font=fn)
        y += (bb[3]-bb[1]) + 2
    y += 4

    # SKU
    _txt(draw, (pad, y), str(sku), fs, '#444444')
    bb = draw.textbbox((0,0), 'A', font=fs)
    y += (bb[3]-bb[1]) + 8

    # Barcode
    if barcode:
        try:
            import barcode as bc_lib
            from barcode.writer import ImageWriter
            CLS = bc_lib.get_barcode_class('code128')
            obj = CLS(str(barcode), writer=ImageWriter())
            buf = io.BytesIO()
            bc_h_mm = (h * 0.35) / MM2PX
            obj.write(buf, options={
                'module_height': max(4, bc_h_mm),
                'module_width': 0.55, 'quiet_zone': 2,
                'font_size': 7, 'text_distance': 2,
                'write_text': True, 'background': 'white', 'foreground': 'black',
            })
            buf.seek(0)
            bc_img = Image.open(buf).convert('RGB')
            avail_w = w - 2*pad
            avail_h = int(h * 0.42)
            r = min(avail_w / bc_img.width, avail_h / bc_img.height)
            bc_img = bc_img.resize((int(bc_img.width*r), int(bc_img.height*r)), Image.LANCZOS)
            img.paste(bc_img, ((w - bc_img.width)//2, y))
            y += bc_img.height + 6
        except:
            _txt(draw, (pad, y), str(barcode), fs, 'black')
            bb = draw.textbbox((0,0), 'A', font=fs)
            y += (bb[3]-bb[1]) + 8

    # Brand bottom-left
    bb = draw.textbbox((0,0), 'MM-MART', font=fbr)
    _txt(draw, (pad, h - pad - (bb[3]-bb[1])), 'MM-MART', fbr, '#5b3219')

    # Price bottom-right
    ptxt = f'¥{int(price):,}'
    bb = draw.textbbox((0,0), ptxt, font=fp)
    _txt(draw, (w - pad - (bb[2]-bb[0]), h - pad - (bb[3]-bb[1])), ptxt, fp, 'black')

    return img, label_id

# ── Routes ─────────────────────────────────────────────────────────────────────
def _discover():
    """Return list of connected QL printer URIs via pyusb."""
    try:
        from brother_ql.backends.helpers import discover
        return discover('pyusb')
    except Exception:
        return []

def _clean_uri(raw):
    """Strip serial-number suffix appended by some pyusb versions.
    'usb://0x04f9:0x209b_Љ'  →  'usb://0x04f9:0x209b'
    """
    import re
    if isinstance(raw, dict):
        raw = raw.get('identifier', '')
    m = re.match(r'(usb://0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)', str(raw))
    return m.group(1) if m else PRINTER_URI

@app.route('/status')
def status():
    printers = _discover()
    connected = len(printers) > 0
    printer_ids = [_clean_uri(p) for p in printers]
    return jsonify({
        'ok': True,
        'connected': connected,
        'printers': printer_ids,
        'templates_dir': TEMPLATES_DIR,
        'platform': platform.system(),
    })

@app.route('/templates')
def list_templates():
    result = [{'id': 'none', 'name': 'Plain White', 'type': 'builtin'}]
    result += [{'id': t['id'], 'name': t['name'], 'type': 'user',
                'mm_w': t['mm_w'], 'mm_h': t['mm_h']} for t in _scan()]
    return jsonify(result)

@app.route('/templates/<tmpl_id>/thumb')
def tmpl_thumb(tmpl_id):
    t = next((x for x in _scan() if x['id'] == tmpl_id), None)
    if not t:
        return jsonify({'error': 'not found'}), 404
    try:
        img = Image.open(t['path']).convert('RGB')
        tw = 210
        th = int(img.height * tw / img.width)
        thumb = img.resize((tw, th), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, 'PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/preview', methods=['POST'])
def preview():
    d = request.json or {}
    try:
        img, _ = make_label(
            d.get('name',''), d.get('sku',''),
            float(d.get('price', 0)), d.get('barcode',''),
            d.get('size','62x29'), d.get('orientation','landscape'),
            d.get('template_id'), d.get('custom_w_mm'), d.get('custom_h_mm'),
        )
        scale = max(1, min(4, 840 // img.width))
        prev  = img.resize((img.width*scale, img.height*scale), Image.LANCZOS)
        buf   = io.BytesIO()
        prev.save(buf, 'PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/print', methods=['POST'])
def do_print():
    d   = request.json or {}
    qty = max(1, min(999, int(d.get('qty', 1))))
    try:
        img, label_id = make_label(
            d.get('name',''), d.get('sku',''),
            float(d.get('price', 0)), d.get('barcode',''),
            d.get('size','62x29'), d.get('orientation','landscape'),
            d.get('template_id'), d.get('custom_w_mm'), d.get('custom_h_mm'),
        )
        from brother_ql.conversion import convert
        from brother_ql.backends.helpers import send
        from brother_ql.raster import BrotherQLRaster
        # Auto-discover printer; fall back to default URI
        printers = _discover()
        uri = _clean_uri(printers[0]) if printers else PRINTER_URI
        qlr = BrotherQLRaster(PRINTER_MODEL)
        convert(qlr, [img]*qty, label=label_id, rotate='auto',
                threshold=70, dither=False, compress=False,
                red=False, dpi_600=False, hq=True, cut=True)
        send(qlr.data, printer_identifier=uri,
             backend_identifier='pyusb', blocking=True)
        return jsonify({'ok': True, 'printed': qty, 'printer': uri})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

if __name__ == '__main__':
    os_name = platform.system()
    print('─' * 58)
    print('  MM-MART  Brother QL-800 Print Service')
    print(f'  Platform : {os_name}')
    print(f'  URL      : http://localhost:8765')
    print(f'  Templates: {TEMPLATES_DIR}')
    print()
    if os_name == 'Windows':
        print('  Windows setup:')
        print('  1. Install Zadig  →  https://zadig.akeo.ie')
        print('     (replace QL-800 driver with WinUSB / libusb-win32)')
        print('  2. pip install flask brother_ql pyusb python-barcode Pillow')
        print('  3. python print_service.py')
    else:
        print('  Mac/Linux setup:')
        print('  pip install flask brother_ql pyusb python-barcode Pillow')
        print('  python3 print_service.py')
    print()
    # Show any printers found at startup
    found = _discover()
    if found:
        print(f'  Printer found: {found[0]}')
    else:
        print('  No printer detected (connect USB cable and power on QL-800)')
    print('─' * 58)
    app.run(host='127.0.0.1', port=8765, debug=False)
