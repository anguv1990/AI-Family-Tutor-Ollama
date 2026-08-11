import { createApp } from './app';
import { createDatabase } from './database';
import { TutoringService } from './tutoring-service';
import { loadConfig } from './config';
import { AiGateway, HintService, OllamaProvider } from './ai';
import { SqliteCacheStore, SqliteSafetyEventSink } from './ai-stores';

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

createApp(tutor).listen(config.port, config.host, () => {
  console.log(`AI Family Tutor listening on http://${config.host}:${config.port}`);
  console.log(`model: ${config.flashModel} via ${config.ollamaUrl}`);
});
