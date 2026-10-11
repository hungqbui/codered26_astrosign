# ASL letter classifier: training pipeline

This folder trains the hand-pose classifier that runs in the browser game. The model is a
small multilayer perceptron (MLP) on **MediaPipe hand landmarks**, trained with
**TensorFlow/Keras** (categorical cross-entropy) after a hyperparameter search, and run in the
browser with **TensorFlow.js**. It runs on hand
coordinates, not images, so it is tiny (about 25k parameters) and fast enough to run on every frame for both hands.

```
scripts/fetch_data.sh          download the three public datasets + MediaPipe model
scripts/extract_landmarks.py   images -> MediaPipe Hand Landmarker -> data/landmarks.npz
scripts/features.py            landmark -> feature vector (mirrored 1:1 in web/src/recognition/features.js)
scripts/train_tf.py            TensorFlow/Keras: hyperparameter search, evaluation, final model, checkpoint, export
scripts/checkpoint.py          save / load the Keras checkpoint; re-export it to the web app
checkpoints/                   the trained Keras checkpoint (model + optimizer state, scaler, config)
export/asl_mlp_weights.json    weights exported from the checkpoint (input to the TF.js converter)
scripts/train.py               shared helpers + the original scikit-learn baseline (kept for comparison)
reports/evaluation.md          generated results (copied below)
reports/metrics.json           generated results incl. the confusion matrix
```

## Reproduce

```bash
cd training
uv venv -p 3.11 .venv
uv pip install -p .venv/bin/python "mediapipe==0.10.14" pyarrow pillow scikit-learn numpy
scripts/fetch_data.sh
.venv/bin/python scripts/extract_landmarks.py    # ~2.5 min on CPU

# TensorFlow lives in its own environment: it needs protobuf 7, mediapipe 0.10.14 needs protobuf 4.
uv venv -p 3.11 .venv-tf
uv pip install -p .venv-tf/bin/python tensorflow==2.21.0 scikit-learn numpy
.venv-tf/bin/python scripts/train_tf.py          # ~1-1.5 h on 4 CPU cores (--trials N for a shorter search)
```

`train_tf.py` writes the following outputs.

* `checkpoints/asl_mlp.keras` + `scaler.json` + `config.json`: the trained Keras model with its
  optimizer state (so training can be resumed or fine-tuned), the feature scaler, and the chosen
  hyperparameters, class list, game letters and headline metrics. **This is the source of truth.**
  Everything below is exported from it. Training is seeded, but TensorFlow on multi-threaded
CPU is not bit-for-bit deterministic, so re-runs can differ in the third decimal.

* `export/asl_mlp_weights.json`: trained weights, scaler, class list, the letters the game uses and the chosen hyperparameters
* `../web/public/models/asl_tfjs/`: the **TensorFlow.js** LayersModel the game loads (`model.json` +
  `weights.bin`, ~100 KB). The training script builds it by calling `web/scripts/convert-model.mjs`, which needs
  `npm install` in `web/` to have been run.
* `../web/public/models/hand_poses.json`: a 3D reference handshape per letter (the medoid of the
  Marxulia photos), plus per-finger tolerances. Each tolerance is the 75th percentile of the
  distance between real samples of that letter and the reference, measured on each finger's two
  outer joints. Used by the guide cards and the practice coach.
* `../web/test/fixtures/parity.json`: raw landmarks with Python features and probabilities.
  `npm test` checks that the JavaScript features and the TensorFlow.js model reproduce them
  (features to 1e-3, probabilities to 2e-3).

### Using the checkpoint

```bash
.venv-tf/bin/python scripts/checkpoint.py info     # hyperparameters, model summary, sanity check
.venv-tf/bin/python scripts/checkpoint.py export   # checkpoint -> export/ -> web/public/models/asl_tfjs/
```

```python
from checkpoint import load_checkpoint            # run from training/scripts
ck = load_checkpoint()
probs = ck.predict_proba(landmarks)               # (N, 21, 3) MediaPipe landmarks, height units
ck.model.fit(...)                                 # resume / fine-tune (optimizer state is restored)
```

> mediapipe 1.x needs `libGLESv2` even for CPU inference. 0.10.14 does not, which is why it is pinned.

## Datasets

| source | what it is | samples used | license |
|---|---|---|---|
| [sid220/asl-now-fingerspelling](https://huggingface.co/datasets/sid220/asl-now-fingerspelling) (ASLNow!) | MediaPipe **web** hand landmarks (JSON) recorded from several participants through a browser webcam | 1874 | MIT |
| [EitanG98/asl_letters](https://huggingface.co/datasets/EitanG98/asl_letters) | Photos of several signers, varied backgrounds (Roboflow-style export) | 609 photos + flipped copies (34 photos had no detectable hand) | Unlicense |
| [Marxulia/asl_sign_languages_alphabets_v03](https://huggingface.co/datasets/Marxulia/asl_sign_languages_alphabets_v03) | ASL alphabet photos and illustrations. We use only the ~20 originals per letter and drop the 400 synthetic `_aug_` copies of a single photo per letter | ~400 photos + flipped copies (99 had no detectable hand) | not declared on the dataset card |

Totals: 4,306 landmark sets were extracted, of which **3,864 belong to the 24 static letters** (J and Z were dropped). 996 of these come from horizontally flipped photos (see *Left and right hands*).

Image datasets are run through the same `hand_landmarker.task` model the game uses (IMAGE
mode, one hand, detection confidence 0.3; images with a short side under 256 px are upscaled first).
Every photo is processed twice, as-is and mirrored. The flipped copy shares the original's
cross-validation group, so the two never end up on opposite sides of a train/test split.

## Supported letters

* **Classifier:** the 24 static letters `A B C D E F G H I K L M N O P Q R S T U V W X Y`.
* **Game (default set): `B C D F H I L N O Q V W X Y`.** These 14 letters reach F1 ≥ 0.85 in the
  *unseen-dataset* evaluation below. That threshold is applied automatically by `train.py`
  (`RELIABLE_F1`) and stored as `gameLetters` in the exported model. The classifier still
  scores all 24 letters, so an `A` is not forced into the closest game letter. The game simply
  ignores letters outside its set.
* **Not supported: J and Z.** Both are traced with motion, so a single static pose cannot represent them.
  A planned extension (not built) would detect the base handshape with this classifier (I for
  J, index-point for Z) and then classify the fingertip trajectory over about 1 s. That needs
  a separate sequence dataset.

## Preprocessing (`features.py`)

1. **Aspect correction.** MediaPipe normalises x and z by frame width and y by height. We use
   x·W/H, y and z·W/H so hands keep their true proportions. ASLNow! does not store the frame
   size, so we assume 4:3 and jitter the aspect ratio during augmentation.
2. **Translate** so the wrist (landmark 0) is the origin.
3. **Scale** by the hand size: the mean 2-D distance of all landmarks from the wrist.
4. **Features (118):** the 63 normalised xyz coordinates, plus the 55 pairwise 3-D distances
   between the wrist, five fingertips and five finger-base joints. Orientation is **kept** on
   purpose: G/H vs U, P vs K and Q vs G differ mainly by how the hand is rotated.

### Left and right hands

The datasets mix left and right hands. In the ASLNow! data, the fraction of "thumb on the
image right" samples ranges from 55% to 75% by letter, so roughly a quarter to nearly half are
mirror images. Handling:

* **Training:** every sample is also added mirrored, and each augmented copy is mirrored at random.
* **Inference:** left hands are mirrored into right-hand orientation, and the prediction is
  averaged with that of the mirror image. The classifier is therefore *exactly*
  mirror-invariant (a unit test checks this), and both players get identical treatment.
* **Real left-hand landmarks:** mirror invariance in the classifier is not enough, because
  **MediaPipe itself is not mirror-equivariant**.
  * On a flipped photo, MediaPipe's landmarks differ from the mirror image of the original
    photo's landmarks by about 6% of hand size on average.
  * Training only on (mostly right-hand) landmarks plus synthetic mirroring, a model scored
    85.7% on unseen right-hand-majority photos but **81.8%** on the same photos flipped.
  * Fix: also run MediaPipe on a flipped copy of every training photo, so the model sees what
    MediaPipe actually outputs for a left hand. That narrowed the gap to 85.1% vs **84.4%**
    (table below). ASLNow! ships landmarks only, so it cannot be flipped this way. It already
    contains a mix of both hands.

### Augmentation (6 copies per sample + 1 mirror copy)

* in-plane roll ±20°
* yaw ±17°
* aspect ±15%
* depth (z) scale 0.6–1.4×
* Gaussian jitter of 2% of hand size
* random mirroring

## Model

Trained with **TensorFlow 2.21 / Keras 3** (`scripts/train_tf.py`):

* **Architecture:** standardised 118 features → Dense 128 → Dense 128 → Dense 64 (ReLU) → Dense 24 (softmax). That's 41,560 parameters.
* **Training:** categorical cross-entropy on one-hot labels with label smoothing 0.1. Adam (learning rate 3e-4), batch 64. Training stops early when the loss on a held-out 10% of photo groups stops improving; the final model ran 87 epochs.
* **Hyperparameters** were chosen by random search over 16 configurations, varying:
  * hidden layers: 64 up to 128-128-64
  * dropout 0–0.4
  * L2 0–1e-3
  * learning rate 3e-4 to 3e-3
  * batch 64–256
  * label smoothing 0–0.1

  The selection objective was accuracy on a dataset left out of training. Full table below.
* **Checkpoint:** saved to `checkpoints/`, the source of truth for the web model.

**Conversion to TensorFlow.js** (`web/scripts/convert-model.mjs`):
* rebuilds the network as a `tf.sequential` of `Dense` layers (dropout is inference-free and dropped)
* folds the `StandardScaler` into the first layer's weights and bias, so the model takes raw features
* stores the class list, game letters, hyperparameters and metrics in `userDefinedMetadata`
* saves a standard LayersModel (`model.json` + `weights.bin`)

**In the browser**, `web/src/recognition/classifier.js` loads it with `tf.loadLayersModel` on the
TensorFlow.js **CPU backend**. Only `tfjs-core`, `tfjs-layers` and `tfjs-backend-cpu` are bundled.
Each hand is scored with its mirror image in a single batched `predict` call, which takes under
1 ms per hand on a slow ARM server CPU.

The earlier scikit-learn MLP (118-128-64-24) remains in `scripts/train.py` as a baseline. On the
same data it scored 95.9% in cross-validation and 86.8% on unseen datasets (mean of 84.7 / 84.0 / 91.8).

## Evaluation

Two protocols:

* **5-fold stratified cross-validation** (`StratifiedGroupKFold`). Each photo or recording is
  its own group, so augmented copies never leak across folds.
* **Leave-one-dataset-out:** train on two sources, test on the third. Each source has
  different people, cameras, lighting and MediaPipe versions. This is the closest available
  proxy for "a new player in front of a new webcam", and it is the number to trust.

Caveat: ASLNow! has no participant IDs. Several of its samples per letter likely come from the
same person and session, so its cross-validation numbers are probably optimistic. The
leave-one-dataset-out numbers do not have this problem.

Samples: **3864** (asl_letters: 1224, aslnow: 1874, marxulia: 766), of which 996 are MediaPipe landmarks of horizontally flipped photos

#### Model comparison (5-fold StratifiedGroupKFold, mirror test-time averaging)

| model | accuracy | macro F1 |
|---|---|---|
| keras_mlp_128_128_64 | 0.964 | 0.964 |

#### Generalisation to an unseen dataset (train on the other two sources)

| held-out source | n | accuracy | macro F1 |
|---|---|---|---|
| asl_letters | 1224 | 0.858 | 0.855 |
| aslnow | 1874 | 0.869 | 0.872 |
| marxulia | 766 | 0.923 | 0.923 |

#### Left vs. right hands (unseen dataset)

Original photos are mostly right hands, flipped photos mostly left hands. Training with or without MediaPipe landmarks of flipped photos (synthetic mirroring is used in both cases):

| held-out source | training | original (≈right) | flipped (≈left) |
|---|---|---|---|
| asl_letters | mirror augmentation only | 0.842 | 0.816 |
| asl_letters | + flipped-photo landmarks | 0.872 | 0.844 |
| marxulia | mirror augmentation only | 0.922 | 0.927 |
| marxulia | + flipped-photo landmarks | 0.914 | 0.932 |

#### Per-letter results (MLP, grouped CV)

| letter | n | precision | recall | F1 | F1 unseen dataset | in game |
|---|---|---|---|---|---|---|
| A | 157 | 0.95 | 0.94 | 0.95 | 0.84 | - |
| B | 150 | 0.96 | 0.99 | 0.97 | 0.97 | yes |
| C | 118 | 0.97 | 0.98 | 0.97 | 0.96 | yes |
| D | 154 | 0.95 | 0.95 | 0.95 | 0.84 | - |
| E | 136 | 0.92 | 0.94 | 0.93 | 0.81 | - |
| F | 151 | 0.99 | 0.99 | 0.99 | 0.99 | yes |
| G | 181 | 1.00 | 0.97 | 0.98 | 0.84 | - |
| H | 153 | 0.99 | 0.99 | 0.99 | 0.93 | yes |
| I | 158 | 0.98 | 0.98 | 0.98 | 0.96 | yes |
| K | 148 | 0.99 | 0.96 | 0.98 | 0.95 | yes |
| L | 175 | 0.98 | 0.99 | 0.99 | 0.96 | yes |
| M | 174 | 0.94 | 0.91 | 0.93 | 0.72 | - |
| N | 166 | 0.97 | 0.92 | 0.94 | 0.86 | yes |
| O | 173 | 0.97 | 0.95 | 0.96 | 0.89 | yes |
| P | 155 | 0.95 | 0.94 | 0.94 | 0.84 | - |
| Q | 166 | 0.96 | 0.99 | 0.97 | 0.88 | yes |
| R | 158 | 0.92 | 0.96 | 0.93 | 0.77 | - |
| S | 175 | 0.93 | 0.97 | 0.95 | 0.78 | - |
| T | 147 | 0.93 | 0.93 | 0.93 | 0.72 | - |
| U | 188 | 0.98 | 0.93 | 0.96 | 0.83 | - |
| V | 170 | 0.97 | 0.99 | 0.98 | 0.94 | yes |
| W | 155 | 1.00 | 0.97 | 0.99 | 0.99 | yes |
| X | 188 | 0.95 | 0.98 | 0.97 | 0.86 | yes |
| Y | 168 | 0.99 | 0.98 | 0.99 | 0.94 | yes |

#### Confidence threshold vs. accuracy (MLP, grouped CV)

| threshold | coverage | accuracy |
|---|---|---|
| 0.0 | 1.000 | 0.964 |
| 0.5 | 0.964 | 0.981 |
| 0.6 | 0.945 | 0.985 |
| 0.7 | 0.923 | 0.990 |
| 0.8 | 0.877 | 0.994 |
| 0.9 | 0.566 | 0.998 |

#### Most frequent confusions

U→R (11), N→M (8), O→E (6), A→S (6), M→T (5), P→X (4), M→E (4), W→V (3), T→A (3), R→B (3), P→Q (3), N→S (3)

#### Hyperparameter search (TensorFlow/Keras, categorical cross-entropy)

TensorFlow 2.21.0 / Keras 3.15.1. Random search over 16 configurations; objective = mean accuracy on a dataset left out of training. Sorted best first.

| # | hidden | dropout | L2 | lr | batch | label smoothing | asl_letters | aslnow | marxulia | mean |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 128-128-64 | 0.0 | 0.0 | 0.0003 | 64 | 0.1 | 0.858 | 0.869 | 0.923 | **0.883** |
| 2 | 256-128 | 0.1 | 0.001 | 0.001 | 128 | 0.05 | 0.852 | 0.848 | 0.926 | **0.875** |
| 3 | 256-128 | 0.1 | 1e-05 | 0.0003 | 128 | 0.1 | 0.845 | 0.864 | 0.911 | **0.873** |
| 4 | 256-128 | 0.4 | 0.001 | 0.001 | 128 | 0.05 | 0.843 | 0.855 | 0.919 | **0.872** |
| 5 | 128-64 | 0.25 | 0.0001 | 0.003 | 256 | 0.1 | 0.837 | 0.856 | 0.920 | **0.871** |
| 6 | 128-128-64 | 0.0 | 0.001 | 0.001 | 64 | 0.0 | 0.828 | 0.865 | 0.915 | **0.869** |
| 7 | 64 | 0.1 | 0.001 | 0.0003 | 128 | 0.0 | 0.844 | 0.840 | 0.923 | **0.869** |
| 8 | 64-32 | 0.0 | 0.0 | 0.001 | 256 | 0.05 | 0.828 | 0.869 | 0.907 | **0.868** |
| 9 | 128-128-64 | 0.0 | 1e-05 | 0.003 | 64 | 0.1 | 0.848 | 0.850 | 0.906 | **0.868** |
| 10 | 256-128 | 0.25 | 1e-05 | 0.003 | 128 | 0.0 | 0.847 | 0.843 | 0.913 | **0.868** |
| 11 | 128-64 | 0.0 | 0.0001 | 0.0003 | 256 | 0.1 | 0.830 | 0.858 | 0.915 | **0.868** |
| 12 | 128 | 0.1 | 1e-05 | 0.0003 | 256 | 0.0 | 0.846 | 0.838 | 0.918 | **0.867** |
| 13 | 128-128-64 | 0.25 | 0.0001 | 0.003 | 128 | 0.1 | 0.850 | 0.827 | 0.913 | **0.863** |
| 14 | 64 | 0.25 | 1e-05 | 0.0003 | 64 | 0.05 | 0.819 | 0.851 | 0.913 | **0.861** |
| 15 | 64 | 0.0 | 0.001 | 0.003 | 256 | 0.0 | 0.815 | 0.843 | 0.913 | **0.857** |
| 16 | 128 | 0.25 | 0.001 | 0.003 | 256 | 0.05 | 0.812 | 0.841 | 0.905 | **0.853** |

**Nested estimate** (hyperparameters chosen without the test dataset): asl_letters 0.837, aslnow 0.850, marxulia 0.911; mean **0.866**.

**Production model:** hidden 128-128-64, dropout 0.0, L2 0.0, lr 0.0003, batch 64, label smoothing 0.1; trained on all data for 87 epochs (early-stopping optimum).

### Reading the results

* **In-distribution accuracy is 96.4%** (5-fold cross-validation, macro F1 0.964), meeting the
  ~95% target.
* **On a dataset never seen in training** the production model scores 85.8% / 86.9% / 92.3%
  (mean 88.3%, up from 86.8% with the scikit-learn model). That figure is slightly optimistic,
  because the same three tests were used to choose the hyperparameters. The **nested estimate**,
  which hides each test dataset from the tuning, is **86.6%**. This is the best number to expect
  for a new player.
* The losses are concentrated in known ASL confusion groups:
  * closed fists: A, E, M, N, S, T
  * U, R and D
* The 14 game letters (`B C F H I K L N O Q V W X Y`) average **0.94 F1** on unseen datasets,
  against 0.80 for the other 10. Compared with the previous model, K is back in and D is out.
* **Confidence is lower by design.** Label smoothing caps the model's top probability at roughly
  0.9, so a 0.6 threshold keeps 94.5% of predictions at 98.5% accuracy. The game confirms at
  0.6 on a smoothed probability plus a 420 ms hold.
* **Left hands** (flipped photos) score within about 2–3 points of right hands on unseen photos.

### Known limitations

* The training data covers roughly a few dozen signers. Unusual hand sizes, skin tones under
  poor lighting, or long sleeves covering the wrist were not evaluated.
* Hands that face the camera edge-on (G, H, P, Q) are where MediaPipe itself is least accurate.
* The Marxulia dataset declares no license. It contributes training samples and the medoid
  hands used for the on-screen guides. Drop it in `extract_landmarks.py` if that matters for
  your use. The pipeline runs unchanged on the other two sources.
