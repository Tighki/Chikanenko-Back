import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { writeAudit } from "../services/audit.js";

const buildingSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(80),
  address: z.string().trim().min(1, "Укажите адрес").max(160),
  gender: z.enum(["MALE", "FEMALE"]),
});

const roomSchema = z.object({
  buildingId: z.string().min(1),
  number: z.string().trim().min(1, "Укажите номер").max(10),
  floor: z.coerce.number().int().min(1).max(30),
  accessible: z.boolean().optional().default(false),
  bedCount: z.coerce.number().int().min(1, "Нужна хотя бы одна койка").max(8),
});

export const housingRouter = Router();
housingRouter.use(requireAuth, requireRoles("STAFF", "ADMIN"));

housingRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const buildings = await prisma.building.findMany({
      include: {
        rooms: {
          include: { beds: { orderBy: { number: "asc" }, include: { settlement: true } } },
          orderBy: [{ floor: "asc" }, { number: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });
    res.json({ buildings });
  }),
);

housingRouter.get(
  "/free-beds",
  asyncRoute(async (_req, res) => {
    const beds = await prisma.bed.findMany({
      where: { status: "FREE", room: { status: "ACTIVE" } },
      include: { room: { include: { building: true } } },
      orderBy: [{ room: { building: { name: "asc" } } }, { room: { floor: "asc" } }, { number: "asc" }],
    });
    res.json({
      beds: beds.map((bed) => ({
        id: bed.id,
        number: bed.number,
        roomNumber: bed.room.number,
        floor: bed.room.floor,
        gender: bed.room.gender,
        accessible: bed.room.accessible,
        building: bed.room.building.name,
      })),
    });
  }),
);

housingRouter.post(
  "/buildings",
  asyncRoute(async (req, res) => {
    const body = buildingSchema.parse(req.body);
    const building = await prisma.building.create({ data: body });
    await writeAudit(prisma, req.user!.id, "Новый корпус", "Building", building.id, { name: building.name });
    res.status(201).json({ building });
  }),
);

housingRouter.post(
  "/rooms",
  asyncRoute(async (req, res) => {
    const body = roomSchema.parse(req.body);
    const building = await prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) throw new HttpError(404, "Корпус не найден");
    const room = await prisma.room.create({
      data: {
        buildingId: building.id,
        number: body.number,
        floor: body.floor,
        gender: building.gender,
        accessible: body.accessible,
        beds: {
          create: Array.from({ length: body.bedCount }, (_, index) => ({ number: index + 1 })),
        },
      },
      include: { beds: true },
    });
    await writeAudit(prisma, req.user!.id, "Новая комната", "Room", room.id, {
      building: building.name,
      number: room.number,
    });
    res.status(201).json({ room });
  }),
);

housingRouter.post(
  "/rooms/:id/status",
  asyncRoute(async (req, res) => {
    const status = z.enum(["ACTIVE", "CLOSED"]).parse(req.body.status);
    const room = await prisma.room.findUnique({ where: { id: String(req.params.id) }, include: { beds: true } });
    if (!room) throw new HttpError(404, "Комната не найдена");
    if (status === "CLOSED" && room.beds.some((bed) => bed.status === "OCCUPIED")) {
      throw new HttpError(400, "Нельзя закрыть комнату с занятыми койками");
    }
    const updated = await prisma.room.update({ where: { id: room.id }, data: { status } });
    await writeAudit(prisma, req.user!.id, status === "CLOSED" ? "Закрытие комнаты" : "Открытие комнаты", "Room", room.id);
    res.json({ room: updated });
  }),
);

housingRouter.post(
  "/beds/:id/status",
  asyncRoute(async (req, res) => {
    const status = z.enum(["FREE", "BLOCKED"]).parse(req.body.status);
    const bed = await prisma.bed.findUnique({ where: { id: String(req.params.id) } });
    if (!bed) throw new HttpError(404, "Койка не найдена");
    if (bed.status === "OCCUPIED") throw new HttpError(400, "Занятую койку сначала освободите");
    if (bed.status === status) {
      res.json({ bed });
      return;
    }
    const updated = await prisma.bed.update({ where: { id: bed.id }, data: { status } });
    await writeAudit(prisma, req.user!.id, status === "BLOCKED" ? "Блокировка койки" : "Разблокировка койки", "Bed", bed.id);
    res.json({ bed: updated });
  }),
);
