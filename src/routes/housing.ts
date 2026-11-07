import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { missingDocumentLabels, fullName } from "../domain/labels.js";
import { writeAudit } from "../services/audit.js";
import { saveHousingLayout } from "../services/settlementService.js";

const buildingSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(80),
  address: z.string().trim().min(1, "Укажите адрес").max(160),
});

export const housingRouter = Router();
housingRouter.use(requireAuth, requireRoles("STAFF", "ADMIN"));

const layoutSchema = z.object({
  buildingId: z.string().min(1),
  rooms: z.array(z.object({
    id: z.string().min(1).optional(),
    number: z.string().trim().min(1).max(10),
    floor: z.number().int().min(1).max(30),
    gender: z.enum(["MALE", "FEMALE"]),
    accessible: z.boolean(),
    closed: z.boolean(),
    beds: z.array(z.object({
      id: z.string().min(1).optional(),
      number: z.number().int().min(1).max(8),
      blocked: z.boolean(),
      applicationId: z.string().min(1).nullable(),
    })).min(1).max(8),
  })),
});

housingRouter.get(
  "/workspace",
  asyncRoute(async (_req, res) => {
    const [buildings, applications] = await Promise.all([
      prisma.building.findMany({
        include: {
          rooms: {
            include: {
              beds: {
                orderBy: { number: "asc" },
                include: { settlement: { include: { application: { include: { applicant: true } } } } },
              },
            },
            orderBy: [{ floor: "asc" }, { number: "asc" }],
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.application.findMany({
        where: { status: { not: "CANCELLED" } },
        include: { applicant: true, documents: true, settlement: true },
        orderBy: [{ applicant: { lastName: "asc" } }, { applicant: { firstName: "asc" } }],
      }),
    ]);
    res.json({
      buildings: buildings.map((building) => ({
        id: building.id,
        name: building.name,
        address: building.address,
        rooms: building.rooms.map((room) => ({
          id: room.id,
          number: room.number,
          floor: room.floor,
          gender: room.gender,
          accessible: room.accessible,
          status: room.status,
          beds: room.beds.map((bed) => ({
            id: bed.id,
            number: bed.number,
            status: bed.status,
            occupant: bed.settlement
              ? {
                  applicationId: bed.settlement.applicationId,
                  name: fullName(bed.settlement.application.applicant),
                  gender: bed.settlement.application.applicant.gender,
                }
              : null,
          })),
        })),
      })),
      students: applications.map((application) => {
        const missing = missingDocumentLabels(
          application.applicant.priorityCategory,
          application.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type),
        );
        const genderOk = application.applicant.gender === "MALE" || application.applicant.gender === "FEMALE";
        const admitted = application.status === "APPROVED" || application.status === "WAITLIST" || application.status === "SETTLED";
        let placeBlock: string | null = null;
        if (!admitted) placeBlock = "Сначала допустите заявку";
        else if (!genderOk) placeBlock = "В анкете не указан пол";
        else if (application.status !== "SETTLED" && missing.length > 0) placeBlock = "Не проверены документы";
        return {
          applicationId: application.id,
          name: fullName(application.applicant),
          birthDate: application.applicant.birthDate,
          faculty: application.applicant.faculty,
          city: application.applicant.city,
          gender: application.applicant.gender,
          status: application.status,
          placeable: placeBlock == null,
          placeBlock,
        };
      }),
    });
  }),
);

housingRouter.post(
  "/layout",
  asyncRoute(async (req, res) => {
    const body = layoutSchema.parse(req.body);
    await saveHousingLayout(req.user!.id, body.buildingId, body.rooms);
    res.json({ ok: true });
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
