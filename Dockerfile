# =============================================================================
# FlowSight — Dockerfile  (web app + RTSP cameras)
#
# Targets Mac/Apple Silicon (linux/arm64) and Linux/amd64.  Runs the Flask
# server only — webcam/GUI modes are not usable in a container on Mac, but
# RTSP/network cameras work fine.
# =============================================================================
FROM python:3.12-slim

# System deps:
#   ffmpeg        — RTSP/H.264 decoding for cv2.VideoCapture
#   libglib2.0-0  — runtime lib required by opencv-python-headless
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps.  ultralytics depends on full opencv-python (needs libGL), so we
# install everything, drop the GUI build, then force the headless build last so
# `import cv2` resolves to it — no GUI libraries needed in the image.
COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt \
 && pip uninstall -y opencv-python opencv-contrib-python || true \
 && pip install --no-cache-dir --force-reinstall opencv-python-headless

# App code.  data/ (model + db) and the real *_config.json come in as volumes
# at runtime (see docker-compose.yml); only the shipped config/ examples +
# bytetrack.yaml are baked in.
COPY src/        ./src/
COPY templates/  ./templates/
COPY static/     ./static/
COPY config/     ./config/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    KMP_DUPLICATE_LIB_OK=TRUE \
    OPENCV_LOG_LEVEL=SILENT \
    OPENCV_FFMPEG_CAPTURE_OPTIONS="rtsp_transport;tcp"

EXPOSE 5000

# Single process, threaded.  Multi-camera state lives in process memory — do NOT
# switch to a multi-worker WSGI server.  server.py __main__ binds 0.0.0.0:5000.
CMD ["python", "-m", "src.api.server"]
