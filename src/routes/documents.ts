import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";

export const documentRouter = Router();
documentRouter.use(requireAuth);

documentRouter.get(
  "/:id/file",
  asyncRoute(async (req, res) => {
    const user = req.user!;
    const document = await prisma.document.findUnique({
      where: { id: String(req.params.id) },
      include: { application: { include: { applicant: true } } },
    });
    if (!document) throw new HttpError(404, "Документ не найден");
    const owns = user.role === "APPLICANT" && document.application.applicant.userId === user.id;
    const staff = user.role === "STAFF" || user.role === "ADMIN";
    if (!owns && !staff) throw new HttpError(403, "Недостаточно прав");

    const filePath = path.join(config.uploadDir, path.basename(document.storedName));
    if (!filePath.startsWith(config.uploadDir) || !fs.existsSync(filePath)) {
      throw new HttpError(404, "Файл не найден");
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
    );
    res.sendFile(filePath);
  }),
);
