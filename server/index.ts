import { createApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './database';
import { ParentService } from './parent-service';
import { TutoringService } from './tutoring-service';

// Throws before anything listens if the configuration would expose this
// service beyond the local machine without an admin secret.
const config = loadConfig();

const database = createDatabase(config.databasePath);
const tutor = new TutoringService(database);
tutor.seedInitialContent();
const parent = new ParentService(database, tutor, config);

createApp(tutor, { parent, config }).listen(config.port, config.host, () => {
  console.log(`AI Family Tutor listening on http://${config.host}:${config.port}`);
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
