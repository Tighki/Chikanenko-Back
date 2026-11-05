import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { CATEGORY_TITLES, fullName } from "../domain/labels.js";
import { buildDirectionPdf } from "../services/pdf.js";
import { assignManually, computePlan, confirmPlan, moveSettlement, summarize, unassignSettlement } from "../services/settlementService.js";

const optionsSchema = z.object({
  groupByFaculty: z.boolean().optional().default(false),
});

export const settlementRouter = Router();
settlementRouter.use(requireAuth, requireRoles("STAFF", "ADMIN"));

settlementRouter.post(
  "/preview",
  asyncRoute(async (req, res) => {
    const body = optionsSchema.parse(req.body ?? {});
    const rows = await computePlan(prisma, body.groupByFaculty);
    res.json(summarize(rows));
  }),
);

settlementRouter.post(
  "/confirm",
  asyncRoute(async (req, res) => {
    const body = optionsSchema.parse(req.body ?? {});
    const result = await confirmPlan(req.user!.id, body.groupByFaculty);
    res.json(result);
  }),
);

settlementRouter.get(
  "/runs",
  asyncRoute(async (_req, res) => {
    const runs = await prisma.settlementRun.findMany({
      include: { startedBy: { select: { fullName: true } }, _count: { select: { settlements: true } } },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    res.json({ runs });
  }),
);

settlementRouter.get(
  "/board",
  asyncRoute(async (_req, res) => {
    const applications = await prisma.application.findMany({
      where: { status: { in: ["APPROVED", "WAITLIST", "SETTLED"] } },
      include: {
        applicant: true,
        settlement: { include: { bed: { include: { room: { include: { building: true } } } } } },
      },
      orderBy: { applicant: { lastName: "asc" } },
    });
    res.json({
      waiting: applications
        .filter((item) => !item.settlement)
        .map((item) => ({
          id: item.id,
          status: item.status,
          name: fullName(item.applicant),
          gender: item.applicant.gender,
          faculty: item.applicant.faculty,
          category: item.applicant.priorityCategory,
          score: item.applicant.admissionScore,
        })),
      settled: applications
        .filter((item) => item.settlement)
        .map((item) => ({
          id: item.id,
          settlementId: item.settlement!.id,
          name: fullName(item.applicant),
          gender: item.applicant.gender,
          faculty: item.applicant.faculty,
          orderNumber: item.settlement!.orderNumber,
          method: item.settlement!.method,
          building: item.settlement!.bed.room.building.name,
          room: item.settlement!.bed.room.number,
          bed: item.settlement!.bed.number,
        })),
    });
  }),
);

settlementRouter.post(
  "/assign",
  asyncRoute(async (req, res) => {
    const body = z.object({ applicationId: z.string().min(1), bedId: z.string().min(1) }).parse(req.body);
    const settlement = await assignManually(req.user!.id, body.applicationId, body.bedId);
    res.status(201).json({ settlement });
  }),
);

settlementRouter.post(
  "/move",
  asyncRoute(async (req, res) => {
    const body = z.object({ settlementId: z.string().min(1), bedId: z.string().min(1) }).parse(req.body);
    const settlement = await moveSettlement(req.user!.id, body.settlementId, body.bedId);
    res.json({ settlement });
  }),
);

settlementRouter.post(
  "/unassign",
  asyncRoute(async (req, res) => {
    const body = z.object({ settlementId: z.string().min(1) }).parse(req.body);
    await unassignSettlement(req.user!.id, body.settlementId);
    res.json({ ok: true });
  }),
);

settlementRouter.get(
  "/report",
  asyncRoute(async (_req, res) => {
    const settlements = await prisma.settlement.findMany({
      include: {
        application: { include: { applicant: { include: { user: true } } } },
        bed: { include: { room: { include: { building: true } } } },
      },
      orderBy: { orderNumber: "asc" },
    });
    res.json({
      settlements: settlements.map((item) => ({
        id: item.id,
        orderNumber: item.orderNumber,
        method: item.method,
        assignedAt: item.assignedAt,
        name: fullName(item.application.applicant),
        faculty: item.application.applicant.faculty,
        specialty: item.application.applicant.specialty,
        category: item.application.applicant.priorityCategory,
        categoryTitle: CATEGORY_TITLES[item.application.applicant.priorityCategory],
        gender: item.application.applicant.gender,
        email: item.application.applicant.user.email,
        building: item.bed.room.building.name,
        address: item.bed.room.building.address,
        room: item.bed.room.number,
        bed: item.bed.number,
        accessible: item.bed.room.accessible,
        checkInFrom: item.checkInFrom,
        checkInUntil: item.checkInUntil,
      })),
    });
  }),
);

settlementRouter.get(
  "/:id/pdf",
  asyncRoute(async (req, res) => {
    const settlement = await prisma.settlement.findUnique({
      where: { id: String(req.params.id) },
      include: {
        application: { include: { applicant: true } },
        bed: { include: { room: { include: { building: true } } } },
      },
    });
    if (!settlement) throw new HttpError(404, "Назначение не найдено");
    const person = settlement.application.applicant;
    const pdf = await buildDirectionPdf({
      orderNumber: settlement.orderNumber,
      lastName: person.lastName,
      firstName: person.firstName,
      middleName: person.middleName,
      birthDate: person.birthDate,
      gender: person.gender,
      faculty: person.faculty,
      specialty: person.specialty,
      categoryTitle: CATEGORY_TITLES[person.priorityCategory],
      building: settlement.bed.room.building.name,
      address: settlement.bed.room.building.address,
      room: settlement.bed.room.number,
      bed: settlement.bed.number,
      accessible: settlement.bed.room.accessible,
      checkInFrom: settlement.checkInFrom,
      checkInUntil: settlement.checkInUntil,
      method: settlement.method,
      assignedAt: settlement.assignedAt,
    });
    const filename = `${settlement.orderNumber}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(pdf);
  }),
);
