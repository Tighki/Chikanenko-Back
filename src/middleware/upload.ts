import path from "node:path";
import { randomBytes } from "node:crypto";
import multer from "multer";
import { config } from "../config.js";

const allowed = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"]);

export const uploadDocument = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safe = allowed.has(ext) ? ext : "";
      cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.has(ext)) {
      cb(new Error("Допустимы PDF, JPG, PNG, DOC и DOCX"));
      return;
    }
    cb(null, true);
  },
});

export const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      cb(new Error("Нужен файл Excel или CSV"));
      return;
    }
    cb(null, true);
  },
});
