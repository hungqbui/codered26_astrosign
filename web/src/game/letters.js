// Short handshape cues shown next to the pose diagrams.
export const LETTER_HINTS = {
  A: 'Fist, thumb resting against the side',
  B: 'Flat hand up, fingers together, thumb across palm',
  C: 'Curve the hand into a C shape',
  D: 'Index up, other fingers touch the thumb',
  E: 'Fingertips curled down onto the thumb',
  F: 'Index touches thumb, other three fingers up',
  G: 'Index and thumb point sideways, parallel',
  H: 'Index + middle point sideways together',
  I: 'Fist with pinky up',
  K: 'Index + middle up in a V, thumb between them',
  L: 'Thumb and index make an L',
  M: 'Thumb tucked under three fingers',
  N: 'Thumb tucked under two fingers',
  O: 'All fingertips touch the thumb: O shape',
  P: 'K shape pointing down',
  Q: 'G shape pointing down',
  R: 'Cross index and middle fingers',
  S: 'Fist, thumb across the front of fingers',
  T: 'Thumb tucked between index and middle',
  U: 'Index + middle up, together',
  V: 'Index + middle up, spread (peace sign)',
  W: 'Index, middle, ring up and spread',
  X: 'Index finger hooked',
  Y: 'Thumb and pinky out, others folded',
};

// Step-by-step instructions for the practice coach (for players who don't know the alphabet yet).
export const LETTER_STEPS = {
  A: ['Make a fist', 'Rest your thumb straight up against the side of your index finger'],
  B: ['Hold four fingers straight up, pressed together', 'Fold your thumb across your palm', 'Palm faces the camera'],
  C: ['Curve all fingers together', 'Curve your thumb to match, like holding a cup', 'Palm faces sideways'],
  D: ['Point your index finger straight up', 'Curl the other fingers to touch your thumb tip, making a circle'],
  E: ['Curl all fingertips down toward your palm', 'Tuck your thumb under the fingertips'],
  F: ['Touch your index fingertip to your thumb tip (a circle)', 'Keep middle, ring and pinky straight up and apart'],
  G: ['Point your index finger sideways', 'Hold your thumb parallel above it', 'Fold the other fingers in'],
  H: ['Point index and middle fingers sideways, together', 'Thumb holds the other fingers down'],
  I: ['Make a fist', 'Raise your pinky straight up'],
  K: ['Raise index and middle fingers in a V', 'Touch your thumb tip to the middle finger, between them'],
  L: ['Point your index finger straight up', 'Stick your thumb out to the side to form an L', 'Fold the other fingers in'],
  M: ['Fold your fingers down over your thumb', 'Thumb tip pokes out under the ring finger (3 fingers over it)'],
  N: ['Fold your fingers down over your thumb', 'Thumb tip pokes out under the middle finger (2 fingers over it)'],
  O: ['Curve all fingers', 'Touch every fingertip to your thumb tip to make an O'],
  P: ['Make a K shape', 'Tip your hand so the fingers point down'],
  Q: ['Make a G shape', 'Tip your hand so index and thumb point down'],
  R: ['Raise index and middle fingers', 'Cross your middle finger over your index finger'],
  S: ['Make a fist', 'Wrap your thumb across the front of your fingers'],
  T: ['Make a fist', 'Tuck your thumb between index and middle fingers'],
  U: ['Raise index and middle fingers straight up', 'Keep them pressed together'],
  V: ['Raise index and middle fingers', 'Spread them apart in a V (peace sign)'],
  W: ['Raise index, middle and ring fingers, spread apart', 'Thumb holds the pinky down'],
  X: ['Make a fist', 'Raise your index finger and bend it into a hook'],
  Y: ['Fold your three middle fingers down', 'Stretch your thumb and pinky out wide'],
};

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const PLAYER_COLORS = ['#38e1ff', '#ff4fd8'];
export const PLAYER_NAMES = ['Player 1', 'Player 2'];
// Players are assigned by where they stand (screen side); either hand can play.
export const PLAYER_SIDES = ['left side', 'right side'];
