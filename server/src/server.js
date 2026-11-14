import { app } from './app.js';
import { config } from './config.js';
import { runMigrations } from './migrate.js';

await runMigrations(); // make sure the schema is up to date before serving

app.listen(config.port, () => {
  console.log(`Inkwell API listening on http://localhost:${config.port}`);
});
