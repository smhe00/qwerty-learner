#!/usr/bin/env python3
"""Extract the two reusable, *transparent* ornaments from the approved original
first-batch card. No frame or lettering is redrawn, and no text is included.
Output canvases exactly match the source 960 x 1391 image pixel coordinates.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
import hashlib
import json

SRC = Path("public/assets/achievements/song/first-batch/ACH_FIRST_DECODE.webp")
DEST = Path("public/assets/achievements/song/shared")
DEST.mkdir(parents=True, exist_ok=True)
original=Image.open(SRC).convert("RGB")
assert original.size==(960,1391), f"Unexpected reference size {original.size}"
W,H=original.size
rgb=np.asarray(original).astype(np.float32)
r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
x,y=np.meshgrid(np.arange(W),np.arange(H))
# Distinguish the actual warm-gold pigment from rice-paper and black scenery.
# Feathered chroma matte preserves naturally antialiased original pixels.
chroma=r-b
luma=(r+g+b)/3
a=np.clip((chroma-34)/25,0,1)*np.clip((240-luma)/53,0,1)
a=np.where((r>g+5)&(g>b+8)&(r>72),a,0)
# True frame and filigree regions of approved first-batch raw artwork.
# Critically, DO NOT capture scene, clouds, foliage, or surrounding paper fill.
edge=((x>=13)&(x<=946)&((y<47)|(y>1331)))
edge|=(((x<46)|(x>914))&(y>=14)&(y<=1377))
edge|=(((x<135)|(x>826))&(y<132))
edge|=(((x<142)|(x>819))&(y>1250))
edge&=(x>11)&(x<949)&(y>8)&(y<1381)
# Exactly the blank original ruyi cartouche: no calligraphy, no scene pixels.
title=(x>198)&(x<762)&(y>30)&(y<169)

def matte(name,roi):
    mask=(np.clip(a,0,1)*roi.astype(np.float32))
    # Drop isolated subpixel noise; retain anti-aliasing along true gold strokes.
    from PIL import ImageFilter
    m=Image.fromarray(np.uint8(mask*255),"L")
    large=m.point(lambda value: 255 if value>84 else 0)
    around=large.filter(ImageFilter.MaxFilter(3))
    mm=np.asarray(m,dtype=np.uint8)
    keep=np.asarray(around,dtype=np.uint8)>0
    alpha=np.where(keep,mm,0).astype(np.uint8)
    pix=np.asarray(original).copy()
    # Zero fully transparent RGB so files are compact and compositing is clean.
    pix[alpha==0,:]=0
    out=Image.fromarray(np.dstack([pix,alpha]),"RGBA")
    assert out.getbbox() is not None
    dest=DEST/name
    out.save(dest,optimize=True)
    return out,{"filename":name,"sha256":hashlib.sha256(dest.read_bytes()).hexdigest(),
                "bytes":dest.stat().st_size,"imageSize":[W,H],
                "opaquePixels":int(np.count_nonzero(alpha>210))}
outer,s0=matte("song_outer_border.png",edge)
plaque,s1=matte("song_empty_title_frame.png",title)
both=Image.alpha_composite(outer,plaque)
both.save(DEST/"song_frame_combined.png",optimize=True)
# Preview on actual raw reference, and independently over a contrasting paper.
preview=Image.new("RGBA",(W,H),(243,240,234,255))
d=ImageDraw.Draw(preview)
for yy in range(0,H,80):
 for xx in range(0,W,80):
  if (xx//80+yy//80)%2:d.rectangle((xx,yy,xx+79,yy+79),fill=(225,230,228,255))
Image.alpha_composite(preview,both).convert("RGB").save(DEST/"preview_transparency.jpg",quality=90)
# No redraw: a combined overlay is still made only from those two transparent masks.
manifest={"source":str(SRC),"sourceSha256":hashlib.sha256(SRC.read_bytes()).hexdigest(),
          "canvasSize":[W,H],"assets":[s0,s1],
          "registration":"top-left 0,0; no scale, same geometry on all artwork"}
(DEST/"README.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(manifest,ensure_ascii=False,indent=2))
