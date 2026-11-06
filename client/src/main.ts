import { createApp } from 'vue';
import App from './App.vue';
import { createApiClient } from './api';
import { withGame } from './lib/route';
import { createSession, SessionKey } from './stores/session';
import './style.css';

// the opened game into the URL, in place (lib/route.ts: from the Open screen this turns its entry into the game's)
function setGameParam(id: string | null) {
  history.replaceState(null, '', withGame(location.href, id));
}

async function bootstrap() {
  const api = await createApiClient();
  const session = createSession(api, { storage: localStorage, onGameChange: setGameParam });
  const app = createApp(App);
  app.provide(SessionKey, session);
  app.mount('#app');
}

void bootstrap();
