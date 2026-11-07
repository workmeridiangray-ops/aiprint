#!/usr/bin/env python3
"""Super-resolution for one image: OpenCV dnn_superres with a pretrained ESPCN model (2x or 4x).
Usage: enhance.py <input.png> <output.png> <2|4> <models_dir>
Prints "<width>x<height>" on success. Exit code 2 = module or model missing, 1 = other failure.
Alpha, if present, is enlarged with a plain resize (it is a mask, not photographic detail)."""
import os, sys

def main():
    if len(sys.argv) != 5:
        print('usage: enhance.py <in> <out> <2|4> <models_dir>', file=sys.stderr); return 1
    src, dst, scale, models = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    if scale not in (2, 4):
        print('scale must be 2 or 4', file=sys.stderr); return 1
    try:
        import cv2
        sr = cv2.dnn_superres.DnnSuperResImpl_create()
    except Exception as e:
        print(f'opencv dnn_superres unavailable: {e}', file=sys.stderr); return 2
    model = os.path.join(models, f'ESPCN_x{scale}.pb')
    if not os.path.isfile(model):
        print(f'model missing: {model}', file=sys.stderr); return 2
    img = cv2.imread(src, cv2.IMREAD_UNCHANGED)
    if img is None:
        print('cannot read input image', file=sys.stderr); return 1
    sr.readModel(model); sr.setModel('espcn', scale)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        up = sr.upsample(img[:, :, :3])
        a = cv2.resize(img[:, :, 3], (up.shape[1], up.shape[0]), interpolation=cv2.INTER_CUBIC)
        up = cv2.merge([up[:, :, 0], up[:, :, 1], up[:, :, 2], a])
    else:
        up = sr.upsample(img)
    cv2.imwrite(dst, up)
    print(f'{up.shape[1]}x{up.shape[0]}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
