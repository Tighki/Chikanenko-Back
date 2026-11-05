import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const serverRoot = path.resolve(srcDir, "..");

function readCorsOrigin(): true | string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === "*") return true;
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : true;
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  uploadDir: path.join(serverRoot, "uploads"),
  corsOrigin: readCorsOrigin(),
};
