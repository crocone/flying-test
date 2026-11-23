# Оцифровка левого столбца страниц NASA TM-84245, т. 2 (C_L, C_M, C_D против ωt). Использовано для src/cli/dynamic-stall-data.ts.
# Запуск: страница PDF рендерится в PNG (PyMuPDF, 200 dpi, поворот на −90°, оттенки серого), затем:
#   python -I digitize-tm84245.py page.png overlay.png out.json
# overlay.png — та же страница с красными точками оцифровки (проверка глазом). Нужны numpy и Pillow.
# Оцифровка левого столбца страницы NASA TM-84245 vol.2 (C_L, C_M, C_D против ωt).
# Калибровка: ось ординат — столбец с наибольшим числом тёмных пикселей; засечки слева от неё дают
# уровни C_L 2,5/0, C_M 0,1/0/−0,5, C_D 1,2/0; засечки под нижней осью — ωt через 90°.
import sys, json, numpy as np
from PIL import Image, ImageDraw
src,ovl,out=sys.argv[1:4]
im=np.array(Image.open(src))<140
H,W=im.shape
xa=max(range(int(W*0.08),int(W*0.3)),key=lambda x:im[:,x].sum())
# refine: axis may be 2 px wide; take the column band
band=im[:,xa-1:xa+2].any(axis=1)
ys=np.where(band)[0]; top,bot=ys.min(),ys.max()
# make sure top/bottom belong to long segments
segs=[];s=None
for y in range(H):
    if band[y] and s is None: s=y
    if not band[y] and s is not None:
        if y-s>60: segs.append((s,y-1))
        s=None
top=segs[0][0]; bot=segs[-1][1]
# left ticks
tl=[y for y in range(80,H-80) if im[y,xa-9:xa-2].sum()>=5 and im[y,xa-1:xa+2].any()]
g=[]
for y in tl:
    if g and y-g[-1][-1]<=2: g[-1].append(y)
    else: g.append([y])
lt=[float(np.mean(t)) for t in g]
print('xa',xa,'top',top,'bot',bot,'left ticks',[round(v) for v in lt],file=sys.stderr)
T=np.array([0,301.5,339.5,641,675.5,977.0])
best=[]
for y0 in lt:
    for j0 in range(6):
        base=y0-T[j0]; pr=[]
        for y in lt:
            j=int(np.argmin(abs(T-(y-base))))
            if abs(T[j]-(y-base))<6 and j not in [q[0] for q in pr]: pr.append((j,y))
        if len(pr)>len(best): best=pr
pairs=best
js=[p[0] for p in pairs]; assert len(set(js))>=3 and max(js)-min(js)>=4, pairs
A=np.polyfit([T[j] for j,_ in pairs],[y for _,y in pairs],1)
Y=np.polyval(A,T)
for j,y in pairs: assert abs(Y[j]-y)<2.5,(j,y,Y[j])
# x ticks below CD axis
y5=int(round(Y[5]))
xt=[x for x in range(xa-4,xa+400) if im[y5+4:y5+10,x].sum()>=4]
g=[]
for x in xt:
    if g and x-g[-1][-1]<=2: g[-1].append(x)
    else: g.append([x])
xc=[float(np.mean(t)) for t in g]
xp=[(round((x-xa)/91.7),x) for x in xc if abs((x-xa)/91.7-round((x-xa)/91.7))<0.08]
assert len(xp)>=3, xc
B=np.polyfit([n*90-90 for n,_ in xp],[x for _,x in xp],1)
X=lambda wt: np.polyval(B,wt)
print('yticks',[round(v,1) for v in Y],'xticks',[(n*90-90,round(x)) for n,x in xp],file=sys.stderr)
panels={'cl':(Y[0],2.5,Y[1],0.0,Y[1],Y[0]-4,Y[1]+4),'cm':(Y[2],0.1,Y[3],-0.5,Y[2]+(Y[3]-Y[2])/6,Y[2]-4,Y[3]+2),'cd':(Y[4],1.2,Y[5],0.0,Y[5],Y[4]-4,Y[5]+4)}
res={}
rgb=Image.open(src).convert('RGB'); dr=ImageDraw.Draw(rgb)
for k,(ya,va,yb,vb,yax,ylo,yhi) in panels.items():
    v=lambda y:va+(y-ya)*(vb-va)/(yb-ya)
    rr=[]
    for wt in range(-84,269,2):
        x=int(round(X(wt)))
        ys=[y for y in range(int(ylo),int(yhi)) if im[y,x-1:x+2].any() and abs(y-yax)>3]
        if not ys: rr.append([wt,round(float(v(yax)),3),1]); continue
        runs=[]
        for y in ys:
            if runs and y-runs[-1][-1]<=2: runs[-1].append(y)
            else: runs.append([y])
        if rr and len(runs)>1: run=min(runs,key=lambda r:abs(v(np.mean(r))-rr[-1][1]))
        else: run=max(runs,key=len)
        y=float(np.mean(run)); rr.append([wt,round(float(v(y)),3),0])
        dr.ellipse([x-3,y-3,x+3,y+3],outline=(255,0,0))
    res[k]=rr
rgb.save(ovl); json.dump(res,open(out,'w'))
