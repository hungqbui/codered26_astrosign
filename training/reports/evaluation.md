Samples: **3864** (asl_letters: 1224, aslnow: 1874, marxulia: 766), of which 996 are MediaPipe landmarks of horizontally flipped photos

### Model comparison (5-fold StratifiedGroupKFold, mirror test-time averaging)

| model | accuracy | macro F1 |
|---|---|---|
| keras_mlp_128_128_64 | 0.964 | 0.964 |

### Generalisation to an unseen dataset (train on the other two sources)

| held-out source | n | accuracy | macro F1 |
|---|---|---|---|
| asl_letters | 1224 | 0.858 | 0.855 |
| aslnow | 1874 | 0.869 | 0.872 |
| marxulia | 766 | 0.923 | 0.923 |

### Left vs. right hands (unseen dataset)

Original photos are mostly right hands, flipped photos mostly left hands. Training with or without MediaPipe landmarks of flipped photos (synthetic mirroring is used in both cases):

| held-out source | training | original (≈right) | flipped (≈left) |
|---|---|---|---|
| asl_letters | mirror augmentation only | 0.842 | 0.816 |
| asl_letters | + flipped-photo landmarks | 0.872 | 0.844 |
| marxulia | mirror augmentation only | 0.922 | 0.927 |
| marxulia | + flipped-photo landmarks | 0.914 | 0.932 |

### Per-letter results (MLP, grouped CV)

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

### Confidence threshold vs. accuracy (MLP, grouped CV)

| threshold | coverage | accuracy |
|---|---|---|
| 0.0 | 1.000 | 0.964 |
| 0.5 | 0.964 | 0.981 |
| 0.6 | 0.945 | 0.985 |
| 0.7 | 0.923 | 0.990 |
| 0.8 | 0.877 | 0.994 |
| 0.9 | 0.566 | 0.998 |

### Most frequent confusions

U→R (11), N→M (8), O→E (6), A→S (6), M→T (5), P→X (4), M→E (4), W→V (3), T→A (3), R→B (3), P→Q (3), N→S (3)

### Hyperparameter search (TensorFlow/Keras, categorical cross-entropy)

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
