import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { writeAudit } from "../services/audit.js";

const registerSchema = z.object({
  email: z.string().trim().email("Укажите корректную почту").max(120),
  password: z.string().min(6, "Пароль не короче 6 символов").max(80),
  fullName: z.string().trim().min(3, "Укажите ФИО").max(160),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});

const loginSchema = z.object({
  email: z.string().trim().email("Укажите корректную почту"),
  password: z.string().min(1, "Введите пароль"),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().min(6, "Новый пароль не короче 6 символов").max(80),
});

function publicUser(user: {
  id: string;
  email: string;
  fullName: string;
  role: "APPLICANT" | "STAFF" | "ADMIN";
  phone: string | null;
  mustChangePassword: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    phone: user.phone,
    mustChangePassword: user.mustChangePassword,
  };
}

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncRoute(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new HttpError(400, "Такая почта уже зарегистрирована");

    const parts = body.fullName.split(/\s+/);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(body.password, 10),
        role: "APPLICANT",
        fullName: body.fullName,
        phone: body.phone || null,
        applicant: {
          create: {
            lastName: parts[0] ?? "",
            firstName: parts[1] ?? "",
            middleName: parts.slice(2).join(" ") || null,
          },
        },
      },
    });
    await writeAudit(prisma, user.id, "Регистрация", "User", user.id, { email });
    const token = signToken({ id: user.id, role: user.role, email: user.email, fullName: user.fullName });
    res.status(201).json({ token, user: publicUser(user) });
  }),
);

authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new HttpError(401, "Неверная почта или пароль");
    }
    const token = signToken({ id: user.id, role: user.role, email: user.email, fullName: user.fullName });
    res.json({ token, user: publicUser(user) });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(401, "Требуется вход");
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  "/password",
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Текущий пароль неверный");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false },
    });
    await writeAudit(prisma, user.id, "Смена пароля", "User", user.id);
    res.json({ ok: true });
  }),
);
