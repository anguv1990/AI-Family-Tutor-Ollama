import { createApp } from './app';
import { createDatabase } from './database';
import { TutoringService } from './tutoring-service';

const database = createDatabase(process.env.DB_PATH || './data/tutor.sqlite');
const tutor = new TutoringService(database);
tutor.seedInitialContent();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

createApp(tutor).listen(port, host, () => {
  console.log(`AI Family Tutor listening on http://${host}:${port}`);
});
