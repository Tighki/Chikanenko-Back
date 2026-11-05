import fs from "node:fs";
import { app } from "./app.js";
import { config } from "./config.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

app.listen(config.port, config.host, () => {
  console.log(`API http://${config.host}:${config.port}`);
});
