import type { Prisma, PrismaClient } from "@prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

export function writeAudit(
  db: Db,
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  details?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId: entityId ?? null,
      details,
    },
  });
}

export function notify(db: Db, userId: string, title: string, body: string) {
  return db.notification.create({
    data: { userId, title, body },
  });
}
