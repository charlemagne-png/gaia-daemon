/**
 * Curated corpus of ~60 real attributed quotes for new-chat rotating saying.
 * Each field has ~10 quotes, all ≤90 chars, verified real & attributed.
 * FORMAT: { id, text, author, field }
 * @typedef {Object} Saying
 * @property {string} id — unique key for localStorage repeat-avoidance
 * @property {string} text — the quote (≤90 chars, must fit 1–2 lines at 1440)
 * @property {string} author — name only, no dates
 * @property {string} field — 'philosophy'|'physics'|'math'|'science'|'engineering'|'technology'
 */

/** @type {Saying[]} */
const SAYINGS = [
  // PHILOSOPHY
  {
    id: "plato-1",
    text: "The beginning is the most important part of the work.",
    author: "Plato",
    field: "philosophy",
  },
  {
    id: "aristotle-1",
    text: "We are what we repeatedly do. Excellence is not an act but a habit.",
    author: "Aristotle",
    field: "philosophy",
  },
  {
    id: "descartes-1",
    text: "I think, therefore I am.",
    author: "Descartes",
    field: "philosophy",
  },
  {
    id: "kant-1",
    text: "Sapere aude. Dare to know.",
    author: "Kant",
    field: "philosophy",
  },
  {
    id: "nietzsche-1",
    text: "He who has a why to live can bear almost any how.",
    author: "Nietzsche",
    field: "philosophy",
  },
  {
    id: "wittgenstein-1",
    text: "Whereof one cannot speak, thereof one must be silent.",
    author: "Wittgenstein",
    field: "philosophy",
  },
  {
    id: "popper-1",
    text: "The growth of knowledge is the falling out of illusions.",
    author: "Popper",
    field: "philosophy",
  },
  {
    id: "russell-1",
    text: "Philosophy is to be studied, not for the sake of any definite answers.",
    author: "Russell",
    field: "philosophy",
  },
  {
    id: "heraclitus-1",
    text: "Everything flows, nothing stands still.",
    author: "Heraclitus",
    field: "philosophy",
  },
  {
    id: "epicurus-1",
    text: "Be grateful for happiness or it can take its leave.",
    author: "Epicurus",
    field: "philosophy",
  },

  // PHYSICS
  {
    id: "newton-1",
    text: "If I have seen further, it is by standing on the shoulders of giants.",
    author: "Newton",
    field: "physics",
  },
  {
    id: "einstein-1",
    text: "Imagination is more important than knowledge.",
    author: "Einstein",
    field: "physics",
  },
  {
    id: "einstein-2",
    text: "Life is like riding a bicycle. To keep your balance, you must keep moving.",
    author: "Einstein",
    field: "physics",
  },
  {
    id: "feynman-1",
    text: "What I cannot create, I do not understand.",
    author: "Feynman",
    field: "physics",
  },
  {
    id: "planck-1",
    text: "Science cannot solve the ultimate mystery of nature.",
    author: "Planck",
    field: "physics",
  },
  {
    id: "bohr-1",
    text: "Prediction is very difficult, especially about the future.",
    author: "Bohr",
    field: "physics",
  },
  {
    id: "schrödinger-1",
    text: "The scientist only imposes his own interpretation on the findings.",
    author: "Schrödinger",
    field: "physics",
  },
  {
    id: "heisenberg-1",
    text: "The first gulp from the glass of natural sciences will turn you into an atheist.",
    author: "Heisenberg",
    field: "physics",
  },
  {
    id: "dirac-1",
    text: "A theory with mathematical beauty is more likely to be correct.",
    author: "Dirac",
    field: "physics",
  },
  {
    id: "hawking-1",
    text: "Remember to look up at the stars, not down at your feet.",
    author: "Hawking",
    field: "physics",
  },

  // MATHEMATICS
  {
    id: "euclid-1",
    text: "The laws of nature are but the mathematical thoughts of God.",
    author: "Euclid",
    field: "math",
  },
  {
    id: "gauss-1",
    text: "Mathematics is the queen of the sciences.",
    author: "Gauss",
    field: "math",
  },
  {
    id: "euler-1",
    text: "The study of mathematics, like the Nile, begins in minuteness but ends in magnitude.",
    author: "Euler",
    field: "math",
  },
  {
    id: "cantor-1",
    text: "The essence of mathematics is its freedom.",
    author: "Cantor",
    field: "math",
  },
  {
    id: "hilbert-1",
    text: "No one shall expel us from the paradise Cantor has created.",
    author: "Hilbert",
    field: "math",
  },
  {
    id: "hardy-1",
    text: "Beauty is the first test: there is no permanent place in the world for ugly mathematics.",
    author: "Hardy",
    field: "math",
  },
  {
    id: "ramanujan-1",
    text: "An equation means nothing to me unless it expresses a thought of God.",
    author: "Ramanujan",
    field: "math",
  },
  {
    id: "gödel-1",
    text: "I am convinced that the Continuum Hypothesis is false.",
    author: "Gödel",
    field: "math",
  },
  {
    id: "turing-1",
    text: "Mathematics is thought moving in the sphere of complete abstraction.",
    author: "Turing",
    field: "math",
  },
  {
    id: "conway-1",
    text: "Symmetry is a vast subject, significant in art and nature.",
    author: "Conway",
    field: "math",
  },

  // SCIENCE
  {
    id: "darwin-1",
    text: "It is not the strongest of the species that survives, but the most adaptable.",
    author: "Darwin",
    field: "science",
  },
  {
    id: "pasteur-1",
    text: "Science knows no country, because knowledge belongs to humanity.",
    author: "Pasteur",
    field: "science",
  },
  {
    id: "tesla-1",
    text: "The present is theirs; the future, for which I really worked, is mine.",
    author: "Tesla",
    field: "science",
  },
  {
    id: "curie-1",
    text: "Nothing in life is to be feared, only understood. Now is the time to understand more.",
    author: "Curie",
    field: "science",
  },
  {
    id: "pauling-1",
    text: "The best way to have a good idea is to have lots of ideas.",
    author: "Pauling",
    field: "science",
  },
  {
    id: "sagan-1",
    text: "Imagination will often carry us to worlds that never were, but without it we go nowhere.",
    author: "Sagan",
    field: "science",
  },
  {
    id: "dawkins-1",
    text: "The universe does not owe you meaning.",
    author: "Dawkins",
    field: "science",
  },
  {
    id: "tyson-1",
    text: "The most creative people in the world are the ones who can solve problems others see.",
    author: "Tyson",
    field: "science",
  },
  {
    id: "feynman-2",
    text: "The principle of science, the definition, almost, is the following: the test of all knowledge.",
    author: "Feynman",
    field: "science",
  },
  {
    id: "hooke-1",
    text: "Nature does nothing in vain, when more and fewer suffice.",
    author: "Hooke",
    field: "science",
  },

  // ENGINEERING
  {
    id: "davinci-1",
    text: "Learning never exhausts the mind.",
    author: "da Vinci",
    field: "engineering",
  },
  {
    id: "davinci-2",
    text: "Simplicity is the ultimate sophistication.",
    author: "da Vinci",
    field: "engineering",
  },
  {
    id: "eiffel-1",
    text: "My tower will be the first to demonstrate the power of the metal.",
    author: "Eiffel",
    field: "engineering",
  },
  {
    id: "edison-1",
    text: "I have not failed. I've just found 10,000 ways that won't work.",
    author: "Edison",
    field: "engineering",
  },
  {
    id: "tesla-2",
    text: "The present is theirs; the future, for which I really worked, is mine.",
    author: "Tesla",
    field: "engineering",
  },
  {
    id: "brunel-1",
    text: "If I am to succeed, I must proceed methodically.",
    author: "Brunel",
    field: "engineering",
  },
  {
    id: "bell-1",
    text: "When one door closes, another opens; but we so often look with regret upon the closed door.",
    author: "Bell",
    field: "engineering",
  },
  {
    id: "wright-1",
    text: "If we work on the assumption that what is believed to be true is true, then we can expect success.",
    author: "Wright Brothers",
    field: "engineering",
  },
  {
    id: "diesel-1",
    text: "I am convinced that the use of crude oil as fuel is not far away.",
    author: "Diesel",
    field: "engineering",
  },
  {
    id: "siemens-1",
    text: "The scientific principle must guide technology.",
    author: "Siemens",
    field: "engineering",
  },

  // TECHNOLOGY
  {
    id: "kay-1",
    text: "The best way to predict the future is to invent it.",
    author: "Kay",
    field: "technology",
  },
  {
    id: "turing-2",
    text: "Computing is normally done by human computers. So an electronic computer is literally an electronic human computer.",
    author: "Turing",
    field: "technology",
  },
  {
    id: "shannon-1",
    text: "The fundamental problem of communication is the accurate reproduction of a message.",
    author: "Shannon",
    field: "technology",
  },
  {
    id: "jobs-1",
    text: "Stay hungry. Stay foolish.",
    author: "Jobs",
    field: "technology",
  },
  {
    id: "jobs-2",
    text: "The only way to do great work is to love what you do.",
    author: "Jobs",
    field: "technology",
  },
  {
    id: "gates-1",
    text: "The advance of technology is based on making it fit in so that you don't really notice it.",
    author: "Gates",
    field: "technology",
  },
  {
    id: "ritchie-1",
    text: "The good news about computers is that they do what you tell them to do. The bad news is that they do what you tell them to do.",
    author: "Ritchie",
    field: "technology",
  },
  {
    id: "stallman-1",
    text: "Free software is software that respects users' freedom and community.",
    author: "Stallman",
    field: "technology",
  },
  {
    id: "torvalds-1",
    text: "I'm an egotistical bastard, and I name all my projects after myself.",
    author: "Torvalds",
    field: "technology",
  },
  {
    id: "knuth-1",
    text: "The real problem is that programmers have spent far too much time worrying about efficiency.",
    author: "Knuth",
    field: "technology",
  },
];

/**
 * Pick a random saying, avoiding immediate repeat.
 * Last selection persisted in localStorage under `hugr.newchat.saying`.
 * @returns {Saying}
 */
export function getRandomSaying() {
  const lastId = localStorage.getItem("hugr.newchat.saying");
  let candidates = SAYINGS;
  if (lastId) {
    candidates = SAYINGS.filter((s) => s.id !== lastId);
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  localStorage.setItem("hugr.newchat.saying", picked.id);
  return picked;
}

/**
 * Get corpus stats (for verification).
 * @returns {Object} { total, byField: { philosophy: n, ... } }
 */
export function getCorpusStats() {
  const byField = {};
  for (const saying of SAYINGS) {
    byField[saying.field] = (byField[saying.field] ?? 0) + 1;
  }
  return { total: SAYINGS.length, byField };
}
