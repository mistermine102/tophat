// The site's text pages (pages/*.vue besides the app): one list for the sitemap (server/routes/sitemap.xml.ts), the
// links under the home page and the guide pages' "More guides" box. Keep in step with the files in pages/.
export interface SitePage {
  path: string;
  /** <title> and the heading. */
  title: string;
  /** Short name for link lists. */
  short: string;
  description: string;
}

export const GUIDES: SitePage[] = [
  {
    path: '/free-chess-com-game-review',
    title: 'Free chess.com game review, with no daily limit',
    short: 'Free chess.com game review',
    description:
      'Review every one of your chess.com games for free: every move labelled from Brilliant to Blunder, explained in plain words, with a better move to try. Runs in your browser, no account.',
  },
  {
    path: '/chess-move-labels',
    title: 'Brilliant, Great, Miss, Blunder: what the chess move labels mean',
    short: 'What the move labels mean',
    description:
      'What Brilliant (!!), Great (!), Best, Excellent, Good, Inaccuracy (?!), Mistake (?), Miss and Blunder (??) mean in a chess game review, and how each one is decided.',
  },
  {
    path: '/how-to-copy-pgn-chess-com',
    title: 'How to copy a game’s PGN from chess.com (and Lichess)',
    short: 'How to copy a PGN',
    description:
      'Step by step: copy the PGN of a finished chess.com or Lichess game, on a computer or phone, and paste it into a game review. Or skip it and open your games by username.',
  },
];

export const ABOUT: SitePage = {
  path: '/about',
  title: 'About, privacy and licences',
  short: 'About',
  description: 'Tophat is a free chess game review that runs in your browser: what it is, what it stores, the source code and the licences.',
};
