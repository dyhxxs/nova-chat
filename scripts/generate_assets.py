from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

ROOT = Path(r'E:\gptapp\apps\mobile\assets')
ROOT.mkdir(parents=True, exist_ok=True)

PURPLE = (119, 105, 240)
VIOLET = (94, 74, 218)
DARK = (23, 25, 31)
WHITE = (248, 248, 255)

def gradient(size, c1=(38,35,79), c2=(104,81,231)):
    img = Image.new('RGB', (size,size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (0.42*x + 0.58*(size-y)) / size
            t = max(0, min(1, t))
            px[x,y] = tuple(int(a*(1-t)+b*t) for a,b in zip(c1,c2))
    return img

def spark_points(cx, cy, outer, inner=None):
    if inner is None: inner = outer * .22
    pts=[]
    for i in range(16):
        a = -math.pi/2 + i*math.pi/8
        r = outer if i%4==0 else (outer*.36 if i%2==0 else inner)
        pts.append((cx+math.cos(a)*r, cy+math.sin(a)*r))
    return pts

def draw_logo(canvas, cx, cy, radius, color=WHITE, shadow=True):
    if shadow:
        sh = Image.new('RGBA', canvas.size, (0,0,0,0))
        sd = ImageDraw.Draw(sh)
        sd.polygon(spark_points(cx,cy+radius*.035,radius), fill=(0,0,0,95))
        sh = sh.filter(ImageFilter.GaussianBlur(radius*.08))
        canvas.alpha_composite(sh)
    d=ImageDraw.Draw(canvas)
    d.polygon(spark_points(cx,cy,radius), fill=color)
    # tiny companion spark
    r2=radius*.22
    d.polygon(spark_points(cx+radius*.72, cy-radius*.62, r2, r2*.25), fill=(206,200,255,255))

# Main iOS / store icon, deliberately no transparency.
base=gradient(1024).convert('RGBA')
# subtle central halo
halo=Image.new('RGBA', base.size,(0,0,0,0)); hd=ImageDraw.Draw(halo)
hd.ellipse((180,180,844,844), fill=(155,135,255,60)); halo=halo.filter(ImageFilter.GaussianBlur(95)); base.alpha_composite(halo)
draw_logo(base,512,522,230)
base.convert('RGB').save(ROOT/'icon.png', quality=95)

# Adaptive icon foreground.
fg=Image.new('RGBA',(432,432),(0,0,0,0)); draw_logo(fg,216,220,102,shadow=False); fg.save(ROOT/'android-icon-foreground.png')
mono=Image.new('RGBA',(432,432),(0,0,0,0)); md=ImageDraw.Draw(mono); md.polygon(spark_points(216,220,102), fill=(0,0,0,255)); mono.save(ROOT/'android-icon-monochrome.png')
# Keep a matching background asset for tooling, although app.json uses backgroundColor.
gradient(432,(23,25,31),(45,38,94)).save(ROOT/'android-icon-background.png')

# Splash mark on transparent canvas.
splash=Image.new('RGBA',(512,512),(0,0,0,0)); badge=gradient(320).convert('RGBA'); mask=Image.new('L',(320,320),0); ImageDraw.Draw(mask).rounded_rectangle((0,0,319,319),radius=88,fill=255); badge.putalpha(mask); splash.alpha_composite(badge,(96,96)); draw_logo(splash,256,262,74); splash.save(ROOT/'splash-icon.png')

# Favicon.
fav=base.resize((64,64), Image.Resampling.LANCZOS).convert('RGBA'); fav.save(ROOT/'favicon.png')
print('Generated Nova Chat assets in', ROOT)
