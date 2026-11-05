import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, ".pgdata"),
  user: "hostel",
  password: "hostel",
  port: 5432,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

try {
  await pg.initialise();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already|exists/i.test(message)) throw error;
  console.log(message);
}

await pg.start();

try {
  await pg.createDatabase("hostel");
  console.log("База hostel создана");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already exists|уже существует/i.test(message)) throw error;
  console.log("База hostel уже есть");
}

console.log("PostgreSQL слушает localhost:5432");
console.log("Пользователь hostel, пароль hostel, база hostel");
console.log("Окно нужно оставить открытым, пока работает система.");

async function stop() {
  await pg.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
