"""Build a short installation guide and screenshot callouts from original captures."""
from pathlib import Path
from math import atan2, cos, sin
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/installation-uk.pdf'
IMAGES = ROOT / 'docs/images'
TEMP = ROOT / 'tmp/pdfs'
OUT.parent.mkdir(parents=True, exist_ok=True)
TEMP.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold')
INK = HexColor('#172b3b')
MUTED = HexColor('#546575')
ACCENT = HexColor('#e84627')
URL14 = 'https://raw.githubusercontent.com/funteaqueue/1d20-ua-plutonium/main/module.json'
URL13 = 'https://raw.githubusercontent.com/funteaqueue/1d20-ua-plutonium/main/module-foundry13.json'
SOURCE = 'https://wiki.tercept.net/en/Plutonium/Plutonium_Installation#manifest-url'


def txt(c, text, x, top, width=515, size=12, bold=False, color=INK):
    p = Paragraph(text, ParagraphStyle('p', fontName='Arial-Bold' if bold else 'Arial',
                  fontSize=size, leading=size*1.4, textColor=color))
    _, h = p.wrap(width, 1000)
    if top+h > c._pagesize[1]-12:
        raise ValueError('Text overflows: '+text[:50])
    p.drawOn(c, x, c._pagesize[1]-top-h)
    return top+h


def image(c, file, x, top, width, crop):
    reader = ImageReader(str(IMAGES/file))
    iw, ih = reader.getSize()
    cx, cy, cw, ch = crop
    scale = width/cw
    height = ch*scale
    H = c._pagesize[1]
    c.saveState()
    path = c.beginPath()
    path.rect(x, H-top-height, width, height)
    c.clipPath(path, stroke=0, fill=0)
    c.drawImage(reader, x-cx*scale, H-top-(ih-cy)*scale, iw*scale, ih*scale)
    c.restoreState()
    return lambda px, py: (x+(px-cx)*scale, top+(py-cy)*scale)


def arrow(c, n, start, end):
    sx, sy = start
    ex, ey = end
    H = c._pagesize[1]
    angle = atan2(ey-sy, ex-sx)
    for color, lw in [(white, 5), (ACCENT, 2.6)]:
        c.setStrokeColor(color)
        c.setLineWidth(lw)
        c.line(sx+10*cos(angle), H-sy-10*sin(angle), ex, H-ey)
        for a in [angle+.45, angle-.45]:
            c.line(ex, H-ey, ex-8*cos(a), H-ey+8*sin(a))
    c.setFillColor(ACCENT)
    c.setStrokeColor(white)
    c.setLineWidth(1.2)
    c.circle(sx, H-sy, 10, stroke=1, fill=1)
    c.setFont('Arial-Bold', 10)
    c.setFillColor(white)
    c.drawCentredString(sx, H-sy-3.5, str(n))


def figure(c, n, x, y):
    if n == 1:
        p = image(c, '01-modules.jpg', x, y, 515, (985,208,630,162))
        arrow(c, 1, p(1565,347), p(1440,256))
        arrow(c, 2, p(1190,347), p(1110,316))
    elif n == 2:
        p = image(c, '02-manifest.jpg', x, y, 515, (780,912,1000,117))
        arrow(c, 1, p(1130,940), p(1190,985))
        arrow(c, 2, p(1705,940), p(1720,980))
    elif n == 3:
        p = image(c, '03-settings.jpg', x, y, 235, (0,330,360,300))
        arrow(c, 1, p(123,605), p(29,592))
        arrow(c, 2, p(137,500), p(170,464))
    else:
        p = image(c, '04-enable.jpg', x, y, 515, (0,90,680,136))
        arrow(c, 1, p(320,120), p(195,130))
        arrow(c, 2, (x+15,y+129), p(29,178))
        p = image(c, '04-enable.jpg', x, y+150, 515, (0,765,680,61))
        arrow(c, 3, (x+260,y+128), p(235,784))


def footer(c, page):
    txt(c, 'Скріншоти: Foundry 14.368', 40, 812, size=9, color=MUTED)
    txt(c, f'{page} / 2', 515, 812, width=40, size=9, color=MUTED)


c = canvas.Canvas(str(OUT), pagesize=(595.28,841.89), pageCompression=1)
c.setTitle('Як встановити український переклад для Plutonium')
c.setAuthor('1d20-ua-plutonium')
txt(c, 'Як встановити переклад', 40, 35, size=25, bold=True)
txt(c, '1d20.com.ua + Plutonium | Foundry 13 / 14', 40, 74, size=12, color=MUTED)
txt(c, '1. Відкрийте встановлення модулів', 40, 119, size=16, bold=True)
txt(c, 'На стартовому екрані: <b>Add-on Modules → Install Module</b>.', 40, 151)
figure(c, 1, 40, 186)
txt(c, '2. Вставте посилання та натисніть Install', 40, 342, size=16, bold=True)
txt(c, 'Скопіюйте <b>одне</b> посилання для своєї версії Foundry:', 40, 374)
txt(c, 'Foundry 14', 40, 408, bold=True)
txt(c, f'<link href="{URL14}" color="#155e92">{URL14}</link>', 40, 431, size=10)
txt(c, 'Foundry 13 (потрібна dnd5e 5.3.x)', 40, 481, bold=True)
txt(c, f'<link href="{URL13}" color="#155e92">{URL13}</link>', 40, 504, size=10)
txt(c, 'Вставте в <b>Manifest URL</b> унизу вікна. Натисніть <b>Install</b> поруч.', 40, 559)
figure(c, 2, 40, 609)
txt(c, 'Якщо Foundry запропонує встановити <b>Plutonium</b> або <b>libWrapper</b>, натисніть <b>Install dependency automatically</b>.', 40, 691)
txt(c, 'Якщо Plutonium уже є, він має відповідати вашій версії Foundry.', 40, 752, size=10, color=MUTED)
footer(c, 1)
c.showPage()

txt(c, 'Увімкніть модуль у світі', 40, 35, size=25, bold=True)
txt(c, '3. Відкрийте модулі', 40, 107, width=260, size=16, bold=True)
txt(c, 'Запустіть світ <b>dnd5e</b> та увійдіть як майстер гри.', 40, 143, width=255)
txt(c, 'Праворуч натисніть <b>шестерні → Module Management</b>.', 40, 206, width=255)
txt(c, 'У Foundry 13: <b>Manage Modules</b>.', 40, 267, width=255, size=11)
figure(c, 3, 320, 107)
txt(c, '4. Увімкніть переклад', 40, 335, size=16, bold=True)
txt(c, '• У пошуку введіть <b>plutonium</b>.<br/>• Увімкніть <b>1d20.com.ua — Український переклад для Plutonium</b><br/>  та <b>Plutonium</b>.<br/>• Натисніть <b>Save Module Settings</b>.', 40, 369)
figure(c, 4, 40, 452)
txt(c, 'Якщо Foundry попросить увімкнути залежності або перезавантажити сторінку — погодьтеся.', 40, 663, size=11)
txt(c, '<b>Готово.</b> Скопіюйте посилання з <b>1d20.com.ua</b>, наведіть курсор на аркуш персонажа й натисніть <b>Ctrl+V</b> поза текстовим полем.', 40, 708, size=11)
txt(c, 'Для перекладу всього імпорту: <b>Коли перекладати → Завжди</b>.', 40, 758, size=10)
txt(c, f'За основу взято <link href="{SOURCE}" color="#155e92">гайд 5etools</link>.', 40, 784, size=9, color=MUTED)
footer(c, 2)
c.save()

# Screenshot-only figures for Markdown; annotations are PDF vectors.
shots = canvas.Canvas(str(TEMP/'installation-shots.pdf'), pageCompression=1)
for n, size in enumerate([(515,133),(515,61),(235,196),(515,197)], start=1):
    shots.setPageSize(size)
    figure(shots, n, 0, 0)
    shots.showPage()
shots.save()
print(OUT)
