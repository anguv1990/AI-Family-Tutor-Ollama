import { createApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './database';
import { ParentService } from './parent-service';
import { TutoringService } from './tutoring-service';
import { AiGateway, HintService, OllamaProvider } from './ai';
import { SqliteCacheStore, SqliteSafetyEventSink } from './ai-stores';

// Throws before anything listens if the configuration would expose this
// service beyond the local machine without an admin secret.
const config = loadConfig();

const database = createDatabase(config.databasePath);

// The gateway is wired even when Ollama is not running. Every hint path ends in
// a deterministic template, so an absent model degrades the experience without
// breaking the session — and the failure is recorded for an adult to see.
const gateway = new AiGateway({
  routes: {
    'local-fast': {
      providerId: 'ollama',
      model: config.flashModel,
      provider: new OllamaProvider({
        baseUrl: config.ollamaUrl,
        model: config.flashModel,
      }),
    },
  },
  cache: new SqliteCacheStore(database),
  events: new SqliteSafetyEventSink(database),
});

const tutor = new TutoringService(database, {
  hints: new HintService(gateway),
});
tutor.seedInitialContent();
const parent = new ParentService(database, tutor, config);

createApp(tutor, { parent, config }).listen(config.port, config.host, () => {
  console.log(`AI Family Tutor listening on http://${config.host}:${config.port}`);
  console.log(`model: ${config.flashModel} via ${config.ollamaUrl}`);
  if (config.lanMode) {
    console.log(
      'LAN mode: this app is reachable from other devices on this network. ' +
        'Parent pages require the admin secret.',
    );
  }
  if (config.parentAccess === 'open-loopback') {
    console.log(
      'ADMIN_SECRET is not set, so parent pages are open to anyone using ' +
        'this machine.',
    );
  }
});
