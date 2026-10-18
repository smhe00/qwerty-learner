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
# Stroke-only extraction ROI: slim gold rule through the long edges;
# elaborate corner filigree is included only where its actual ornament lies.
# Extra 40px-wide edge bands would capture bamboo, inkstones and mountains.
edge=((x>=14)&(x<=946)&(((y>=12)&(y<=31))|((y>=1352)&(y<=1378))))
edge|=(((x>=17)&(x<=34))|((x>=927)&(x<=945)))&(y>=29)&(y<=1360)
edge|=(((x>=13)&(x<=126))|((x>=869)&(x<=947)))&(y>=12)&(y<=108)
edge|=(((x>=13)&(x<=121))|((x>=863)&(x<=947)))&(y>=1285)&(y<=1380)
edge&=(x>11)&(x<949)&(y>8)&(y<1381)
# Exactly the blank original ruyi cartouche; stop above the scenic foliage.
title=(x>198)&(x<762)&(y>29)&(y<156)

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
# Fill the cartouche with its *original, unaltered rice-paper pixels*.
# Segment its interior from the real gold contour; don't draw a new shape.
# This keeps the title readable over any newly generated painting.
from PIL import ImageFilter, ImageDraw
border_alpha=np.asarray(matte("song_cartouche_contour_tmp.png",title)[0].getchannel("A"))
barrier=Image.fromarray(np.where(border_alpha>55,255,0).astype("uint8"),"L")
barrier=barrier.filter(ImageFilter.MaxFilter(9))
inside_image=barrier.copy()
ImageDraw.floodfill(inside_image,(480,88),128,thresh=0)
interior=np.asarray(inside_image)==128
n_inside=int(np.count_nonzero(interior))
assert 16000<n_inside<65000, f"Title outline is broken (flood interior={n_inside})"
# Use a filled parchment backing beneath the extracted calligraphic outline.
frame_strokes=np.asarray(matte("song_cartouche_contour_tmp.png",title)[0])
title_alpha=np.maximum(frame_strokes[:,:,3],np.where(interior,246,0)).astype("uint8")
title_rgb=np.asarray(original).copy()
title_rgb[title_alpha==0,:]=0
plaque=Image.fromarray(np.dstack((title_rgb,title_alpha)),"RGBA")
(DEST/"song_cartouche_contour_tmp.png").unlink()
plaque_path=DEST/"song_empty_title_frame.png"
plaque.save(plaque_path,optimize=True)
s1={"filename":"song_empty_title_frame.png",
    "sha256":hashlib.sha256(plaque_path.read_bytes()).hexdigest(),
    "bytes":plaque_path.stat().st_size,"imageSize":[W,H],
    "opaquePixels":int(np.count_nonzero(title_alpha>210)),
    "paperInteriorPixels":n_inside}
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
