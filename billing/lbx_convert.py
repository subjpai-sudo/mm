#!/usr/bin/env python3
"""
Convert Brother .lbx label templates to PNG thumbnails.
Usage: python3 lbx_convert.py
"""
import os, re, json, zipfile, io
from xml.etree import ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

SRC = '/Users/anique/Documents/MM/stickertemplate'
DST = '/Users/anique/Documents/MM/billing-server/label_templates'
os.makedirs(DST, exist_ok=True)

NS = {
    'pt':     'http://schemas.brother.info/ptouch/2007/lbx/main',
    'style':  'http://schemas.brother.info/ptouch/2007/lbx/style',
    'text':   'http://schemas.brother.info/ptouch/2007/lbx/text',
    'image':  'http://schemas.brother.info/ptouch/2007/lbx/image',
    'barcode':'http://schemas.brother.info/ptouch/2007/lbx/barcode',
    'draw':   'http://schemas.brother.info/ptouch/2007/lbx/draw',
}

PT_TO_MM = 25.4 / 72.0

def pt(s):
    m = re.match(r'([\d.]+)pt', str(s or '0'))
    return float(m.group(1)) if m else 0.0

def hex_to_rgb(h, default=(0,0,0)):
    try:
        h = h.lstrip('#')
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except:
        return default

def load_font(size, bold=False):
    paths = ['/Library/Fonts/Arial Bold.ttf', '/Library/Fonts/Arial.ttf',
             '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
             '/System/Library/Fonts/Supplemental/Arial.ttf',
             '/System/Library/Fonts/Helvetica.ttc']
    if not bold:
        paths = [p for p in paths if 'Bold' not in p] + [p for p in paths if 'Bold' in p]
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, max(8, int(size)))
            except: pass
    return ImageFont.load_default()

def safe_name(s):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', s).strip('_').lower() or 'template'

def render_lbx(lbx_path):
    stem = re.sub(r'\.[^.]+$', '', os.path.basename(lbx_path))
    tid  = safe_name(stem)

    with zipfile.ZipFile(lbx_path) as z:
        names = z.namelist()
        xml_bytes = z.read('label.xml')
        # Load all embedded image files
        img_files = {n: z.read(n) for n in names
                     if re.search(r'\.(jpg|jpeg|bmp|png)$', n, re.I)}

    root   = ET.fromstring(xml_bytes)
    paper  = root.find('.//style:paper', NS)
    if paper is None:
        print(f'  SKIP {stem}: no paper element')
        return None

    # Paper dimensions in pt → mm
    w_pt   = pt(paper.get('width',  '175.7pt'))
    h_pt   = pt(paper.get('height', '76.3pt'))
    orient = paper.get('orientation', 'portrait')
    mm_w   = round(w_pt * PT_TO_MM, 1)   # always 62mm (tape width)
    mm_h   = round(h_pt * PT_TO_MM, 1)   # label length

    # Render canvas at 4px per pt (≈ 167 dpi equivalent for thumbnails)
    SCALE  = 4
    cx     = int(w_pt * SCALE)
    cy     = int(h_pt * SCALE)

    canvas = Image.new('RGB', (cx, cy), 'white')
    draw   = ImageDraw.Draw(canvas)

    # ── Draw background color ──────────────────────────────────────────────
    bg = root.find('.//style:backGround', NS)
    if bg is not None:
        c = hex_to_rgb(bg.get('backColor', '#FFFFFF'))
        draw.rectangle([0, 0, cx-1, cy-1], fill=c)

    # ── Render draw objects (frames/rectangles) ────────────────────────────
    for frame in root.findall('.//draw:frame', NS):
        s = frame.find('pt:objectStyle', NS)
        if s is None: continue
        fx, fy = int(pt(s.get('x','0'))*SCALE), int(pt(s.get('y','0'))*SCALE)
        fw, fh = int(pt(s.get('width','0'))*SCALE), int(pt(s.get('height','0'))*SCALE)
        pen = s.find('pt:pen', NS)
        bc  = hex_to_rgb(s.get('backColor','#FFFFFF'))
        pc  = hex_to_rgb(pen.get('color','#000000') if pen is not None else '#000000')
        if s.get('backColor','#FFFFFF') != '#FFFFFF':
            draw.rectangle([fx, fy, fx+fw, fy+fh], fill=bc)
        pw = max(1, int(pt(pen.get('widthX','0.5pt') if pen is not None else '0.5pt')*SCALE))
        draw.rectangle([fx, fy, fx+fw, fy+fh], outline=pc, width=pw)

    # ── Render embedded images ─────────────────────────────────────────────
    img_objs = root.findall('.//image:image', NS)
    img_file_list = sorted(img_files.keys())

    for idx, img_obj in enumerate(img_objs):
        s = img_obj.find('pt:objectStyle', NS)
        if s is None: continue
        ix, iy = int(pt(s.get('x','0'))*SCALE), int(pt(s.get('y','0'))*SCALE)
        iw, ih = int(pt(s.get('width','10'))*SCALE), int(pt(s.get('height','10'))*SCALE)
        if iw <= 0 or ih <= 0: continue
        # Pick image file by index
        fname = img_file_list[idx] if idx < len(img_file_list) else None
        if fname:
            try:
                pil = Image.open(io.BytesIO(img_files[fname])).convert('RGB')
                pil = pil.resize((max(1,iw), max(1,ih)), Image.LANCZOS)
                # Clip to canvas
                px, py = max(0,ix), max(0,iy)
                if px < cx and py < cy:
                    canvas.paste(pil, (px, py))
            except Exception as e:
                print(f'    img paste error: {e}')

    # ── Render text placeholders ───────────────────────────────────────────
    for txt in root.findall('.//text:text', NS):
        s = txt.find('pt:objectStyle', NS)
        if s is None: continue
        tx, ty = int(pt(s.get('x','0'))*SCALE), int(pt(s.get('y','0'))*SCALE)
        tw, th = int(pt(s.get('width','20'))*SCALE), int(pt(s.get('height','10'))*SCALE)
        if tw <= 0 or th <= 0: continue
        # Skip if fully out of canvas
        if tx > cx or ty > cy: continue
        fontExt = txt.find('.//text:fontExt', NS)
        fc = (180, 180, 200)
        if fontExt is not None:
            c = fontExt.get('textColor','#BBBBCC')
            fc = hex_to_rgb(c) if c.startswith('#') else fc
        # Draw a soft tinted box for text zone
        overlay = Image.new('RGBA', (max(1,tw), max(1,th)), (*fc, 40))
        if tx >= 0 and ty >= 0:
            canvas.paste(Image.new('RGB', (max(1,tw), max(1,th)), fc), (tx, ty),
                         mask=Image.new('L', (max(1,tw), max(1,th)), 40))
        data_el = txt.find('.//text:data', NS)
        content = (data_el.text or '').strip() if data_el is not None else ''
        if content and tw > 20 and th > 8:
            fs = max(6, int(pt(fontExt.get('size','8pt') if fontExt is not None else '8pt') * SCALE * 0.7))
            fnt = load_font(fs)
            draw.text((tx+2, ty+2), content[:20], font=fnt, fill=fc)

    # ── Render barcode placeholders ────────────────────────────────────────
    for bc_obj in root.findall('.//barcode:barcode', NS):
        s = bc_obj.find('pt:objectStyle', NS)
        if s is None: continue
        bx, by = int(pt(s.get('x','0'))*SCALE), int(pt(s.get('y','0'))*SCALE)
        bw, bh = int(pt(s.get('width','40'))*SCALE), int(pt(s.get('height','15'))*SCALE)
        if bw <= 0 or bh <= 0 or bx > cx or by > cy: continue
        # Draw striped barcode placeholder
        bw = min(bw, cx - bx)
        bh = min(bh, cy - by)
        bar_img = Image.new('RGB', (max(1,bw), max(1,bh)), 'white')
        bar_draw = ImageDraw.Draw(bar_img)
        bar_widths = [2,1,3,1,2,1,1,2,3,1,2,1,3,2,1,2,1,3,1,2]
        x_pos = 2
        for i, bwidth in enumerate(bar_widths * 5):
            if x_pos >= bw: break
            clr = (20,20,20) if i % 2 == 0 else (255,255,255)
            bar_draw.rectangle([x_pos, 2, x_pos+bwidth, bh-4], fill=clr)
            x_pos += bwidth
        canvas.paste(bar_img, (max(0,bx), max(0,by)))

    # ── Draw outer border ──────────────────────────────────────────────────
    draw.rectangle([0, 0, cx-1, cy-1], outline='#888', width=2)

    # ── If template still looks blank, add a label name watermark ──────────
    # Check if >95% of pixels are white
    import struct
    sample = canvas.crop((4, 4, min(cx-4, 100), min(cy-4, 80))).convert('L')
    bright = sum(1 for px in sample.getdata() if px > 240) / (sample.width * sample.height + 1)
    if bright > 0.90:
        # Add gradient background + name
        for row in range(cy):
            ratio = row / max(cy-1, 1)
            r = int(245 + (235 - 245) * ratio)
            g = int(240 + (225 - 240) * ratio)
            b = int(230 + (215 - 230) * ratio)
            draw.line([(0, row), (cx, row)], fill=(r, g, b))
        draw.rectangle([0, 0, cx-1, cy-1], outline='#aaa', width=2)
        fnt_big = load_font(max(10, cy // 5), bold=True)
        label = stem[:22]
        bb = draw.textbbox((0,0), label, font=fnt_big)
        tw2, th2 = bb[2]-bb[0], bb[3]-bb[1]
        tx2 = max(4, (cx - tw2) // 2)
        ty2 = max(4, (cy - th2) // 2)
        draw.text((tx2+1, ty2+1), label, font=fnt_big, fill='#ccc')
        draw.text((tx2, ty2), label, font=fnt_big, fill='#5b3219')

    # ── Save PNG + JSON ────────────────────────────────────────────────────
    out_png  = os.path.join(DST, tid + '.png')
    out_json = os.path.join(DST, tid + '.json')

    canvas.save(out_png, 'PNG')

    meta = {'name': stem, 'mm_w': mm_w, 'mm_h': mm_h,
            'has_image': len(img_files) > 0}
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f'  ✓  {tid}.png  ({mm_w}×{mm_h}mm)  {"[img]" if img_files else "[xml]"}  — {stem}')
    return tid

# ── Run ────────────────────────────────────────────────────────────────────────
print(f'Source : {SRC}')
print(f'Output : {DST}')
print()

converted = []
for fname in sorted(os.listdir(SRC)):
    if fname.endswith('.lbx'):
        result = render_lbx(os.path.join(SRC, fname))
        if result:
            converted.append(result)

print()
print(f'Done — {len(converted)} templates converted to {DST}')
