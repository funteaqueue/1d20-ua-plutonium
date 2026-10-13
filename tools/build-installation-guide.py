"""Build the Ukrainian installation PDF from real Foundry 14 screenshots.

Arrows and page layout are vector PDF elements; source screenshots stay intact.
Requires reportlab and Arial fonts (Windows).
"""
from pathlib import Path
from math import atan2, cos, sin, pi
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/installation-uk.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
IMAGES = ROOT / 'docs/images'
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold')
W, H = 595.28, 841.89
INK = HexColor('#172b3b')
MUTED = HexColor('#546575')
ACCENT = HexColor('#da492b')
LIGHT = HexColor('#edf3f6')
URL = 'https://raw.githubusercontent.com/funteaqueue/1d20-ua-plutonium/main/module.json'
REPO = 'https://github.com/funteaqueue/1d20-ua-plutonium'
c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
c.setTitle('Встановлення українського перекладу для Plutonium')
c.setAuthor('1d20-ua-plutonium')

def txt(text, x, top, width=515, size=11, color=INK, bold=False, leading=None):
    style = ParagraphStyle('text', fontName='Arial-Bold' if bold else 'Arial',
                           fontSize=size, leading=leading or size * 1.4,
                           textColor=color, spaceAfter=0)
    p = Paragraph(text, style)
    _, height = p.wrap(width, H)
    if top + height > H - 16:
        raise ValueError(f'Text overflows page: {text[:60]}')
    p.drawOn(c, x, H-top-height)
    return top + height

def header(n, title, subtitle):
    c.setFillColor(INK)
    c.rect(0,H-9,W,9,fill=1,stroke=0)
    txt('1d20.com.ua  /  PLUTONIUM',40,29,size=9,color=MUTED,bold=True)
    txt(f'{n:02d}',40,58,width=54,size=28,color=ACCENT,bold=True)
    txt(title,98,58,width=457,size=23,bold=True)
    txt(subtitle,40,106,size=11,color=MUTED)
    c.setStrokeColor(HexColor('#d5dfe6'))
    c.line(40,42,W-40,42)
    txt('Foundry VTT 14 • Скриншоти: 14.368 • 13.10.2026',40,808,size=8,color=MUTED)
    txt(f'{n} / 4',520,808,width=40,size=8,color=MUTED)

def box(text,x,top,width=515,size=11,pad=14):
    style=ParagraphStyle('box',fontName='Arial',fontSize=size,leading=size*1.45,textColor=INK)
    p=Paragraph(text,style)
    _,height=p.wrap(width-2*pad,H)
    c.setFillColor(LIGHT)
    c.roundRect(x,H-top-height-2*pad,width,height+2*pad,8,fill=1,stroke=0)
    p.drawOn(c,x+pad,H-top-pad-height)
    return top+height+2*pad

def image(file, x, top, width, crop=None):
    """Clip the original screenshot in PDF space; never rewrite image pixels."""
    reader=ImageReader(str(IMAGES/file))
    iw,ih=reader.getSize()
    cx,cy,cw,ch=crop or (0,0,iw,ih)
    scale=width/cw
    height=ch*scale
    c.saveState()
    path=c.beginPath();path.rect(x,H-top-height,width,height)
    c.clipPath(path,stroke=0,fill=0)
    c.drawImage(reader,x-cx*scale,H-top-(ih-cy)*scale,iw*scale,ih*scale)
    c.restoreState()
    c.setStrokeColor(HexColor('#cdd9e0'));c.setLineWidth(.6)
    c.rect(x,H-top-height,width,height,fill=0,stroke=1)
    def point(px,py): return x+(px-cx)*scale,top+(py-cy)*scale
    return point, height

def arrow(number, start, end):
    sx,sy=start;ex,ey=end
    angle=atan2(ey-sy,ex-sx)
    sx2=sx+12*cos(angle);sy2=sy+12*sin(angle)
    for color,lw in [(white,5),(ACCENT,2.7)]:
        c.setStrokeColor(color);c.setLineWidth(lw)
        c.line(sx2,H-sy2,ex,H-ey)
        for a in [angle+.43,angle-.43]:
            c.line(ex,H-ey,ex-10*cos(a),H-(ey-10*sin(a)))
    c.setFillColor(ACCENT);c.setStrokeColor(white);c.setLineWidth(1.4)
    c.circle(sx,H-sy,11,stroke=1,fill=1)
    c.setFont('Arial-Bold',11);c.setFillColor(white)
    c.drawCentredString(sx,H-sy-4,str(number))

# Page 1
header(1,'Відкрийте встановлення','Український переклад для Plutonium • Покрокова інструкція')
box('<b>Перед початком:</b> Foundry VTT <b>14</b>, світ із системою <b>dnd5e</b> і доступ адміністратора. Переклади вже включено до модуля; жодного ключа для користування не потрібно.',40,151)
txt('На стартовому екрані Foundry:',40,259,bold=True,size=14)
txt('<b>1.</b> Перейдіть на вкладку <b>Add-on Modules</b>.<br/><b>2.</b> Натисніть <b>Install Module</b>.',40,291,size=12)
p,_=image('01-modules.jpg',40,357,515,(424,208,1200,410))
arrow(1,p(1540,380),p(1430,255))
arrow(2,p(1100,455),p(1100,320))
txt('На знімку модуль уже встановлений. Для нового встановлення використовуйте ту саму кнопку Install Module.',40,550,size=9,color=MUTED)
box('<b>Якщо ви зараз у світі:</b> поверніться до екрана налаштування через <b>Return to Setup</b>. Це завершує поточну сесію світу, тому виконуйте встановлення поза грою.',40,602)
txt('Сторінка проєкту',40,719,size=11,bold=True)
txt(f'<link href="{REPO}" color="#216783">github.com/funteaqueue/1d20-ua-plutonium</link>',40,741,size=10)
c.showPage()

# Page 2
header(2,'Вставте посилання','Поле Manifest URL розташоване внизу вікна Install Module.')
p,_=image('02-manifest.jpg',40,154,515,(780,249,1000,780))
arrow(1,p(1190,930),p(1190,987))
arrow(2,p(1716,928),p(1716,979))
txt('<b>1.</b> Вставте всю адресу в <b>Manifest URL</b>.',40,574,size=11)
box(f'<link href="{URL}" color="#216783">{URL}</link>',40,599,size=9.3,pad=12)
txt('<b>2.</b> Натисніть нижню кнопку <b>Install</b> і дочекайтеся завершення.',40,656,size=11)
box('<b>Залежності.</b> Якщо з’явиться пропозиція встановити Plutonium та його залежності (зокрема libWrapper), погодьтеся на автоматичне встановлення. Якщо вони вже є, такого діалогу може не бути.',40,697,size=10)
c.showPage()

# Page 3
header(3,'Відкрийте модулі світу','Після встановлення модуль потрібно ввімкнути окремо в кожному світі.')
txt('Запустіть свій світ із dnd5e та увійдіть як <b>Gamemaster</b> (майстер гри).',40,163,width=258,size=12)
txt('<b>1. Settings</b><br/>На правій панелі натисніть вкладку із шестернями.',40,256,width=258,size=12)
txt('<b>2. Module Management</b><br/>У блоці Settings and Configuration відкрийте керування модулями.',40,372,width=258,size=12)
box('У Foundry 14 кнопка називається <b>Module Management</b>. В інших версіях або перекладах назва може відрізнятися.',40,502,width=255,size=10)
p,_=image('03-settings.jpg',325,163,230)
arrow(1,(305,p(28,592)[1]),p(28,592))
arrow(2,(305,p(76,456)[1]),p(76,456))
txt('Скріншот показує лише бічну панель Foundry.',40,726,size=9,color=MUTED)
c.showPage()

# Page 4
header(4,'Увімкніть і перевірте','Встановлення завершене після збереження налаштувань модулів.')
txt('<b>1.</b> У пошуку введіть <b>plutonium</b>.<br/><b>2.</b> Поставте галочку біля <b>1d20.com.ua — Український переклад для Plutonium</b>. Plutonium також має бути ввімкнений.',40,151,size=11)
p,_=image('04-enable.jpg',40,234,515,(0,0,680,273))
arrow(1,p(328,85),p(218,120))
arrow(2,p(110,270),p(30,175))
txt('Верхня частина вікна. Plutonium Addon: Automation для перекладу не потрібен.',40,451,size=9,color=MUTED)
txt('<b>3.</b> Унизу натисніть <b>Save Module Settings</b>. Якщо Foundry попросить увімкнути залежності або перезавантажити сторінку, погодьтеся.',40,484,size=11)
p,_=image('04-enable.jpg',40,554,515,(0,759,680,67))
arrow(3,(160,631),p(170,791))
txt('<b>Швидка перевірка</b>',40,657,size=13)
txt('Скопіюйте посилання нижче, наведіть курсор на бічну панель або аркуш персонажа та натисніть <b>Ctrl+V</b> поза текстовими полями.',40,685,size=10)
txt('<link href="https://1d20.com.ua/spells/fireball-xphb/" color="#216783">https://1d20.com.ua/spells/fireball-xphb/</link>',40,727,size=11)
txt('Типово перекладаються посилання 1d20.com.ua. Для перекладу всього імпорту виберіть у налаштуваннях модуля «Коли перекладати → Завжди».',40,752,size=9,color=MUTED)
c.showPage()
c.save()
print(OUT)
