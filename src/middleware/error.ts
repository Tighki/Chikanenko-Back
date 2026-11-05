import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? "Некорректные данные" });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Error && /Допустимы|Нужен файл|Файл больше|Неожиданное поле/.test(err.message)) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Файл больше 10 МБ" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
}
