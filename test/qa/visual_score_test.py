"""Deterministic tests for the visual audit decoder and score primitives."""
import importlib.util
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
import numpy as np

spec=importlib.util.spec_from_file_location("visual_score",Path(__file__).with_name("visual-score.py"))
score=importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)

def chunk(kind,data):
    return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)

def png(pixels,filter_kind):
    h,w,c=pixels.shape
    raw=bytearray()
    previous=np.zeros(w*c,dtype=np.int64)
    for source in pixels:
        row=source.reshape(-1).astype(np.int64)
        encoded=[]
        for x,value in enumerate(row):
            left=int(row[x-c]) if x>=c else 0
            up=int(previous[x])
            upper_left=int(previous[x-c]) if x>=c else 0
            prediction=left+up-upper_left
            distances=[abs(prediction-left),abs(prediction-up),abs(prediction-upper_left)]
            paeth=[left,up,upper_left][distances.index(min(distances))]
            base=[0,left,up,(left+up)//2,paeth][filter_kind]
            encoded.append((int(value)-base)&255)
        raw.extend(bytes([filter_kind])+bytes(encoded))
        previous=row
    header=struct.pack(">IIBBBBB",w,h,8,2 if c==3 else 6,0,0,0)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",header)+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")

class VisualScoreTest(unittest.TestCase):
    def test_png_filters_and_alpha_are_decoded_without_pixel_changes(self):
        rng=np.random.default_rng(1357)
        with tempfile.TemporaryDirectory() as directory:
            for channels in [3,4]:
                pixels=rng.integers(0,256,(13,19,channels),dtype=np.uint8)
                expected=pixels[:,:,:3].astype(float)
                if channels==4:
                    alpha=pixels[:,:,3:4]/255
                    expected=expected*alpha+255*(1-alpha)
                for filter_kind in range(5):
                    file=Path(directory)/f"{channels}-{filter_kind}.png"
                    file.write_bytes(png(pixels,filter_kind))
                    np.testing.assert_allclose(score.read_png(file),expected,atol=1e-12)
                    np.testing.assert_array_equal(score.read_png(file),score.read_png(file))

    def test_identity_and_visible_difference(self):
        a=np.random.default_rng(24).uniform(0,255,(80,100))
        self.assertAlmostEqual(score.ssim(a,a),1,places=12)
        self.assertLess(score.ssim(np.zeros((80,100)),np.full((80,100),255)),0.01)
        self.assertLess(score.ssim(a,np.full_like(a,255)),0.1)

    def test_blank_page_cannot_pass_the_frozen_reference_protocol(self):
        import json
        protocol=json.loads(Path('docs/design/visual-audit/protocol.json').read_text(encoding='utf-8'))
        reference=score.read_png('docs/design/workspace-reference-target-20261030.png')
        gray=reference@np.array([.2126,.7152,.0722])
        structure=0
        color=0
        for region in protocol['regions']:
            x,y,xx,yy=region['box']
            source=gray[y:yy,x:xx]
            blank=np.full_like(source,255)
            regional=sum(weight*score.ssim(score.reduce(source,factor),score.reduce(blank,factor)) for factor,weight in zip([1,2,4],[.2,.3,.5]))
            structure+=region['weight']*regional*100
            color+=region['weight']*(1-float(np.abs(reference[y:yy,x:xx]-255).mean())/255)*100
        composite=.7*structure+.2*100+.1*color
        self.assertLess(composite,protocol['threshold'])

    def test_console_error_rejects_even_an_identical_image_and_fails_cli(self):
        import json
        import subprocess
        import sys
        import shutil
        root=Path('test/.tmp').resolve()
        root.mkdir(parents=True,exist_ok=True)
        protocol=json.loads(Path('docs/design/visual-audit/protocol.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(prefix='metric-guard-',dir=root) as directory:
            folder=Path(directory).resolve()
            self.assertTrue(folder.is_relative_to(root))
            shutil.copyfile('docs/design/workspace-reference-target-20261030.png',folder/'actual.png')
            (folder/'geometry.json').write_text(json.dumps(protocol['geometry']),encoding='utf-8')
            (folder/'console.json').write_text(json.dumps(['Intentional metric guard probe']),encoding='utf-8')
            result=subprocess.run([sys.executable,'test/qa/visual-score.py',str(folder)],capture_output=True,text=True,check=False)
            self.assertEqual(result.returncode,1,result.stderr)
            evidence=json.loads((folder/'score.json').read_text(encoding='utf-8'))
            self.assertAlmostEqual(evidence['score'],100,places=6)
            self.assertFalse(evidence['passed'])
            self.assertFalse(evidence['captureClean'])

    def test_downsample_and_geometry(self):
        a=np.arange(64).reshape(8,8)
        np.testing.assert_array_equal(score.reduce(a,2),[[4.5,6.5,8.5,10.5],[20.5,22.5,24.5,26.5],[36.5,38.5,40.5,42.5],[52.5,54.5,56.5,58.5]])
        self.assertEqual(score.iou([0,0,10,10],[0,0,10,10]),1)
        self.assertEqual(score.iou([0,0,10,10],[20,0,10,10]),0)
        self.assertAlmostEqual(score.iou([0,0,10,10],[5,0,10,10]),1/3)

if __name__=="__main__":unittest.main()
