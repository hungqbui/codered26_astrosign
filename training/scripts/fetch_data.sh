#!/usr/bin/env bash
# Downloads the three public datasets used to train the ASL letter classifier.
# See training/README.md for licensing and provenance details.
set -euo pipefail
cd "$(dirname "$0")/../data"

# 1) ASLNow! fingerspelling (MIT) - MediaPipe Web hand landmarks, multiple signers.
if [ ! -d asl-now ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 -q https://huggingface.co/datasets/sid220/asl-now-fingerspelling asl-now
  rm -rf asl-now/.git
fi

# 2) ASL alphabet images v03 (Marxulia on Hugging Face) - we keep only the non-augmented originals.
[ -f raw/asl_v03.parquet ] || curl -fL -o raw/asl_v03.parquet \
  "https://huggingface.co/datasets/Marxulia/asl_sign_languages_alphabets_v03/resolve/main/data/train-00000-of-00001.parquet"

# 3) ASL letters (EitanG98 on Hugging Face, Unlicense) - Roboflow-style photos of several signers.
if [ ! -d raw/asl_letters ]; then
  curl -fL -o raw/asl_letters.zip "https://huggingface.co/datasets/EitanG98/asl_letters_zip/resolve/main/asl_letters_zip.zip"
  mkdir -p raw/asl_letters && (cd raw/asl_letters && unzip -q ../asl_letters.zip) && rm raw/asl_letters.zip
fi

# MediaPipe Hand Landmarker model (same one the browser game uses).
[ -f hand_landmarker.task ] || curl -fL -o hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
echo "data ready"
