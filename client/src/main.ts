import { createApp } from 'vue';
import App from './App.vue';
import { createApiClient } from './api';
import { createSession, SessionKey } from './stores/session';
import './style.css';

function setGameParam(id: string | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('game', id);
  else url.searchParams.delete('game');
  history.replaceState(null, '', url);
}

async function bootstrap() {
  const api = await createApiClient();
  const session = createSession(api, { storage: localStorage, onGameChange: setGameParam });
  const app = createApp(App);
  app.provide(SessionKey, session);
  app.mount('#app');
}

void bootstrap();
