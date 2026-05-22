/**
 * Liste de mots pour le générateur de phrases de passe.
 *
 * Mots courts, courants, sans ambiguïté. ~256 entrées → ≈ 8 bits d'entropie
 * par mot (une phrase de 6 mots ≈ 48 bits, 10 mots ≈ 80 bits).
 */
export const WORDLIST: string[] = [
  'able', 'acid', 'acre', 'aged', 'also', 'arch', 'arm', 'army', 'atom', 'aunt',
  'auto', 'away', 'baby', 'back', 'bake', 'ball', 'band', 'bank', 'barn', 'base',
  'bath', 'beam', 'bean', 'bear', 'beat', 'bell', 'belt', 'bird', 'blue', 'boat',
  'body', 'bone', 'book', 'boot', 'born', 'boss', 'bowl', 'bulk', 'bush', 'busy',
  'cake', 'calm', 'camp', 'card', 'care', 'cart', 'case', 'cash', 'cave', 'cell',
  'chef', 'chin', 'city', 'clay', 'clip', 'club', 'coal', 'coat', 'code', 'coin',
  'cold', 'cook', 'cool', 'cope', 'corn', 'crew', 'crop', 'cube', 'curl', 'dark',
  'dash', 'data', 'dawn', 'deal', 'deck', 'deep', 'deer', 'desk', 'dial', 'dice',
  'dish', 'dock', 'door', 'dose', 'dove', 'draw', 'drum', 'dual', 'dune', 'dust',
  'duty', 'each', 'earn', 'east', 'easy', 'echo', 'edge', 'epic', 'even', 'face',
  'fact', 'fade', 'fair', 'fall', 'farm', 'fast', 'fern', 'film', 'find', 'fire',
  'fish', 'flag', 'flat', 'flow', 'foam', 'fold', 'fond', 'food', 'foot', 'fork',
  'form', 'fort', 'frog', 'fuel', 'fund', 'gain', 'game', 'gate', 'gear', 'gift',
  'glad', 'glow', 'goal', 'gold', 'golf', 'grid', 'grin', 'gulf', 'hall', 'hand',
  'hawk', 'haze', 'head', 'heat', 'herb', 'hero', 'hill', 'hint', 'hive', 'hold',
  'home', 'hood', 'hope', 'horn', 'host', 'hour', 'hunt', 'idea', 'iron', 'isle',
  'jade', 'jazz', 'join', 'jump', 'jury', 'keen', 'keep', 'kind', 'king', 'kite',
  'knee', 'knot', 'lace', 'lake', 'lamp', 'land', 'lane', 'lawn', 'leaf', 'lend',
  'lens', 'life', 'lift', 'lime', 'line', 'link', 'lion', 'list', 'lock', 'loft',
  'long', 'loop', 'lord', 'loud', 'luck', 'lung', 'maze', 'meal', 'menu', 'mild',
  'mile', 'mint', 'mist', 'moon', 'moss', 'moth', 'nest', 'news', 'next', 'noble',
  'node', 'noon', 'oak', 'oath', 'open', 'oval', 'oven', 'page', 'palm', 'park',
  'path', 'peak', 'pear', 'peer', 'pile', 'pine', 'pink', 'plan', 'play', 'plug',
  'plum', 'poem', 'pole', 'pond', 'pony', 'pool', 'port', 'pose', 'puff', 'pull',
  'pure', 'quiz', 'race', 'raft', 'rail', 'rain', 'rank', 'rare', 'reef', 'rice',
  'ring', 'road', 'rock', 'role', 'roof', 'room', 'root', 'rose', 'ruby', 'rule',
  'rush', 'sage', 'sail', 'salt', 'sand', 'seal', 'seed', 'self', 'shop', 'silk',
  'snow', 'soft', 'song', 'star', 'stem', 'tide', 'tree', 'tune', 'vast', 'wave',
  'well', 'wind', 'wing', 'wolf', 'wood', 'yard', 'zone',
];
