import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({
      items,
      unread: items.filter((item) => !item.read).length,
    });
  }),
);

notificationRouter.post(
  "/read-all",
  asyncRoute(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  }),
);

notificationRouter.post(
  "/:id/read",
  asyncRoute(async (req, res) => {
    const id = z.string().parse(req.params.id);
    const item = await prisma.notification.findUnique({ where: { id } });
    if (!item || item.userId !== req.user!.id) throw new HttpError(404, "Уведомление не найдено");
    await prisma.notification.update({ where: { id }, data: { read: true } });
    res.json({ ok: true });
  }),
);
