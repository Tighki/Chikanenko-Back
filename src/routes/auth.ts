import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, signToken } from "../middleware/auth.js";

const loginSchema = z.object({
  email: z.string().trim().email("Укажите корректную почту"),
  password: z.string().min(1, "Введите пароль"),
});

function publicUser(user: {
  id: string;
  email: string;
  fullName: string;
  role: "APPLICANT" | "STAFF" | "ADMIN";
  phone: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    phone: user.phone,
  };
}

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (user?.role === "APPLICANT") {
      throw new HttpError(403, "Студент не входит в систему. Список загружает сотрудник из файла.");
    }
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
    if (!user || user.role === "APPLICANT") throw new HttpError(401, "Требуется вход");
    res.json({ user: publicUser(user) });
  }),
);

