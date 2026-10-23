"""Read two oriented diagnostic images and verify a face-coordinate transform."""
import json
import sys

import cv2
import numpy as np

before = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE)
after = cv2.imread(sys.argv[2], cv2.IMREAD_GRAYSCALE)
assert before is not None and after is not None
detector = cv2.SIFT_create(nfeatures=6000)
keypoints_a, descriptors_a = detector.detectAndCompute(before, None)
keypoints_b, descriptors_b = detector.detectAndCompute(after, None)
assert descriptors_a is not None and descriptors_b is not None
pairs = cv2.BFMatcher().knnMatch(descriptors_a, descriptors_b, k=2)
good = [a for a, b in pairs if a.distance < 0.72 * b.distance]
assert len(good) >= 30, ("Too few image correspondences", len(good))
points_a = np.float64([keypoints_a[m.queryIdx].pt for m in good])
points_b = np.float64([keypoints_b[m.trainIdx].pt for m in good])
matrix, mask = cv2.estimateAffinePartial2D(
    points_a, points_b, method=cv2.RANSAC, ransacReprojThreshold=1.5,
    maxIters=10000, confidence=0.999, refineIters=20,
)
assert matrix is not None and mask is not None
inliers = mask.ravel().astype(bool)
errors = np.linalg.norm(
    points_a @ matrix[:, :2].T + matrix[:, 2] - points_b, axis=1
)[inliers]
assert inliers.sum() >= 30 and inliers.mean() >= 0.65
assert np.median(errors) < 0.6 and np.quantile(errors, 0.95) < 1.5
height_a, width_a = before.shape
height_b, width_b = after.shape
normalized = (
    np.diag([1 / width_b, 1 / height_b, 1])
    @ np.vstack([matrix, [0, 0, 1]])
    @ np.diag([width_a, height_a, 1])
)
print(json.dumps({
    "method": "SIFT affine, RANSAC verified",
    "matrix": normalized.tolist(),
    "matches": len(good),
    "inliers": int(inliers.sum()),
    "medianErrorPixels": float(np.median(errors)),
    "p95ErrorPixels": float(np.quantile(errors, 0.95)),
    "referenceDimensions": [width_a, height_a],
    "exportDimensions": [width_b, height_b],
}))
