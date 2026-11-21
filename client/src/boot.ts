// Starting the app in the browser: the data layer (api/index.ts: the analysis worker, or the mock) and the session
// store. Only imported by components/ClientApp.vue once mounted, so none of it runs while prerendering.
import { createApiClient } from './api';
import { withGame } from './lib/route';
import { createSession, type Session } from './stores/session';

// the opened game into the URL, in place (lib/route.ts: from the Open screen this turns its entry into the game's)
function setGameParam(id: string | null) {
  history.replaceState(history.state, '', withGame(location.href, id));
}

export async function startSession(): Promise<Session> {
  // Dev only: `?pieces` puts the Tophat pieces (lib/pieceSet.ts; pawn, knight, king so far) on the board and in the
  // captured-piece strips. The look lab is /pieces (dev server with LABS=1).
  if (import.meta.dev && new URLSearchParams(location.search).has('pieces')) {
    void import('./lib/pieceSet').then((m) => m.installPieceSet('th-pieces', '.cg-wrap'));
  }
  const api = await createApiClient();
  return createSession(api, { storage: localStorage, onGameChange: setGameParam });
}
