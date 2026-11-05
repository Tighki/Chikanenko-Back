import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config.js";

export type AuthUser = {
  id: string;
  role: Role;
  email: string;
  fullName: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Требуется вход" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser & { iat?: number; exp?: number };
    req.user = {
      id: payload.id,
      role: payload.role,
      email: payload.email,
      fullName: payload.fullName,
    };
    next();
  } catch {
    res.status(401).json({ error: "Сессия истекла, войдите снова" });
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }
    next();
  };
}
