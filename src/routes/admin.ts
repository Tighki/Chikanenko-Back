import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { campaignIsOpen } from "../domain/labels.js";
import { writeAudit } from "../services/audit.js";

const userSchema = z.object({
  email: z.string().trim().email("Укажите корректную почту"),
  fullName: z.string().trim().min(3, "Укажите ФИО").max(160),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  role: z.enum(["STAFF", "ADMIN"]),
  password: z.string().min(6, "Пароль не короче 6 символов").max(80),
});

const prioritySchema = z.object({
  rules: z.array(
    z.object({
      category: z.enum(["ORPHAN", "DISABILITY", "SOCIAL", "OUT_OF_TOWN", "NONE"]),
      rank: z.coerce.number().int().min(1).max(20),
      title: z.string().trim().min(2).max(200),
    }),
  ).length(5, "Нужны все пять категорий"),
});

const campaignSchema = z.object({
  name: z.string().trim().min(3).max(160),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean(),
});

function dateStart(value: string) {
  return new Date(`${value}T00:00:00`);
}

function dateEnd(value: string) {
  return new Date(`${value}T23:59:59`);
}

export const campaignRouter = Router();

campaignRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: "default" } });
    res.json({ campaign: campaign ? { ...campaign, isOpen: campaignIsOpen(campaign) } : null });
  }),
);

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRoles("ADMIN"));

adminRouter.get(
  "/users",
  asyncRoute(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
    res.json({ users });
  }),
);

adminRouter.post(
  "/users",
  asyncRoute(async (req, res) => {
    const body = userSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new HttpError(400, "Такая почта уже есть");
    const user = await prisma.user.create({
      data: {
        email,
        fullName: body.fullName,
        phone: body.phone || null,
        role: body.role,
        passwordHash: await bcrypt.hash(body.password, 10),
        mustChangePassword: true,
      },
    });
    await writeAudit(prisma, req.user!.id, "Создание пользователя", "User", user.id, { email, role: body.role });
    res.status(201).json({
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      password: body.password,
    });
  }),
);

adminRouter.get(
  "/priorities",
  asyncRoute(async (_req, res) => {
    const rules = await prisma.priorityRule.findMany({ orderBy: { rank: "asc" } });
    res.json({ rules });
  }),
);

adminRouter.put(
  "/priorities",
  asyncRoute(async (req, res) => {
    const body = prioritySchema.parse(req.body);
    const categories = new Set(body.rules.map((rule) => rule.category));
    const ranks = new Set(body.rules.map((rule) => rule.rank));
    if (categories.size !== 5 || ranks.size !== 5) {
      throw new HttpError(400, "Категории и ранги не должны повторяться");
    }
    await prisma.$transaction(
      body.rules.map((rule) =>
        prisma.priorityRule.upsert({
          where: { category: rule.category },
          update: { rank: rule.rank, title: rule.title },
          create: rule,
        }),
      ),
    );
    await writeAudit(prisma, req.user!.id, "Изменение льгот", "PriorityRule", null, {
      rules: body.rules.map((rule) => ({ category: rule.category, rank: rule.rank })),
    });
    res.json({ rules: body.rules });
  }),
);

adminRouter.put(
  "/campaign",
  asyncRoute(async (req, res) => {
    const body = campaignSchema.parse(req.body);
    const startsAt = dateStart(body.startsAt);
    const endsAt = dateEnd(body.endsAt);
    const checkInFrom = dateStart(body.checkInFrom);
    const checkInUntil = dateEnd(body.checkInUntil);
    if (endsAt < startsAt) throw new HttpError(400, "Окончание приёма раньше начала");
    if (checkInUntil < checkInFrom) throw new HttpError(400, "Окончание заселения раньше начала");
    const campaign = await prisma.campaign.upsert({
      where: { id: "default" },
      update: { name: body.name, startsAt, endsAt, checkInFrom, checkInUntil, active: body.active },
      create: { id: "default", name: body.name, startsAt, endsAt, checkInFrom, checkInUntil, active: body.active },
    });
    await writeAudit(prisma, req.user!.id, "Изменение кампании", "Campaign", campaign.id, { name: campaign.name });
    res.json({ campaign: { ...campaign, isOpen: campaignIsOpen(campaign) } });
  }),
);

adminRouter.get(
  "/audit",
  asyncRoute(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({
      include: { user: { select: { fullName: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ logs });
  }),
);
