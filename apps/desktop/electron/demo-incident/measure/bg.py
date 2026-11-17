import cv2, numpy as np, sys
cap = cv2.VideoCapture(sys.argv[1]); frames = []
i = 0
while True:
    ok, f = cap.read()
    if not ok or i >= 400: break
    if i % 4 == 0: frames.append(f[304:604, 481:960])
    i += 1
bg = np.median(np.stack(frames), axis=0).astype(np.uint8)
cv2.imwrite("br_bg.png", bg)
big = cv2.resize(bg, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
for x in range(0, big.shape[1], 40):
    cv2.line(big, (x, 0), (x, big.shape[0]), (0, 0, 255) if x % 200 == 0 else (0, 140, 255), 1)
    if x % 200 == 0: cv2.putText(big, str(x // 2), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
for y in range(0, big.shape[0], 40):
    cv2.line(big, (0, y), (big.shape[1], y), (0, 0, 255) if y % 200 == 0 else (0, 140, 255), 1)
    if y % 200 == 0: cv2.putText(big, str(y // 2), (2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
cv2.imwrite("br_bg_grid.png", big)
print(i, len(frames))
