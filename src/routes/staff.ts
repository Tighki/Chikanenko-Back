import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { institute } from "../domain/distance.js";
import { missingDocumentLabels, fullName } from "../domain/labels.js";
import { profileProblems } from "../domain/profile.js";
import { notify, writeAudit } from "../services/audit.js";

const reviewSchema = z.object({
  status: z.enum(["IN_REVIEW", "APPROVED", "REJECTED"]),
  staffComment: z.string().trim().max(2000).optional().or(z.literal("")),
});

const documentReviewSchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED"]),
  reviewComment: z.string().trim().max(500).optional().or(z.literal("")),
});

const applicationInclude = {
  applicant: { include: { user: true } },
  documents: { orderBy: { uploadedAt: "desc" as const } },
  settlement: { include: { bed: { include: { room: { include: { building: true } } } } } },
};

export const staffRouter = Router();
staffRouter.use(requireAuth, requireRoles("STAFF", "ADMIN"));

staffRouter.get(
  "/dashboard",
  asyncRoute(async (_req, res) => {
    const [applications, beds, rooms, buildings, recent] = await Promise.all([
      prisma.application.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.bed.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.room.count(),
      prisma.building.count(),
      prisma.application.findMany({
        where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } },
        include: { applicant: true },
        orderBy: { submittedAt: "desc" },
        take: 6,
      }),
    ]);
    res.json({
      applications: Object.fromEntries(applications.map((row) => [row.status, row._count._all])),
      beds: Object.fromEntries(beds.map((row) => [row.status, row._count._all])),
      rooms,
      buildings,
      recent: recent.map((item) => ({
        id: item.id,
        status: item.status,
        submittedAt: item.submittedAt,
        name: fullName(item.applicant),
        faculty: item.applicant.faculty,
        category: item.applicant.priorityCategory,
      })),
    });
  }),
);

staffRouter.get(
  "/applications",
  asyncRoute(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const applications = await prisma.application.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(q
          ? {
              applicant: {
                OR: [
                  { lastName: { contains: q, mode: "insensitive" } },
                  { firstName: { contains: q, mode: "insensitive" } },
                  { faculty: { contains: q, mode: "insensitive" } },
                  { user: { email: { contains: q, mode: "insensitive" } } },
                ],
              },
            }
          : {}),
      },
      include: { applicant: { include: { user: true } }, settlement: true },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    });
    res.json({
      applications: applications.map((item) => ({
        id: item.id,
        status: item.status,
        submittedAt: item.submittedAt,
        name: fullName(item.applicant),
        email: item.applicant.user.email,
        city: item.applicant.city,
        distanceKm: item.applicant.distanceKm,
        faculty: item.applicant.faculty,
        specialty: item.applicant.specialty,
        score: item.applicant.admissionScore,
        category: item.applicant.priorityCategory,
        gender: item.applicant.gender,
        settled: Boolean(item.settlement),
      })),
    });
  }),
);

staffRouter.get(
  "/applications/:id",
  asyncRoute(async (req, res) => {
    const application = await prisma.application.findUnique({
      where: { id: String(req.params.id) },
      include: applicationInclude,
    });
    if (!application) throw new HttpError(404, "Заявка не найдена");
    const verified = application.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type);
    res.json({
      application: {
        ...application,
        applicant: {
          ...application.applicant,
          user: {
            email: application.applicant.user.email,
            phone: application.applicant.user.phone,
            fullName: application.applicant.user.fullName,
          },
        },
      },
      problems: profileProblems(application.applicant),
      missingDocuments: missingDocumentLabels(application.applicant.priorityCategory, verified),
      institute,
    });
  }),
);

staffRouter.post(
  "/applications/:id/status",
  asyncRoute(async (req, res) => {
    const body = reviewSchema.parse(req.body);
    const application = await prisma.application.findUnique({
      where: { id: String(req.params.id) },
      include: { applicant: { include: { user: true } }, documents: true, settlement: true },
    });
    if (!application) throw new HttpError(404, "Заявка не найдена");
    if (application.settlement || application.status === "SETTLED") {
      throw new HttpError(400, "Заселённую заявку меняют через снятие с места");
    }
    if (body.status === "APPROVED") {
      const problems = profileProblems(application.applicant);
      if (problems.length) throw new HttpError(400, problems[0]);
      const missing = missingDocumentLabels(
        application.applicant.priorityCategory,
        application.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type),
      );
      if (missing.length) throw new HttpError(400, `Не проверены документы: ${missing.join(", ")}`);
    }
    if (body.status === "REJECTED" && !body.staffComment) {
      throw new HttpError(400, "Укажите причину отказа");
    }
    const updated = await prisma.application.update({
      where: { id: application.id },
      data: {
        status: body.status,
        staffComment: body.staffComment || null,
        submittedAt: application.submittedAt ?? new Date(),
      },
    });
    const titles = {
      IN_REVIEW: "Заявка взята на проверку",
      APPROVED: "Заявка допущена к заселению",
      REJECTED: "В заселении отказано",
    };
    await notify(
      prisma,
      application.applicant.userId,
      titles[body.status],
      body.staffComment || "Статус заявки изменён сотрудником общежития.",
    );
    await writeAudit(prisma, req.user!.id, "Смена статуса заявки", "Application", application.id, {
      status: body.status,
      name: fullName(application.applicant),
    });
    res.json({ application: updated });
  }),
);

staffRouter.post(
  "/documents/:id/review",
  asyncRoute(async (req, res) => {
    const body = documentReviewSchema.parse(req.body);
    const document = await prisma.document.findUnique({ where: { id: String(req.params.id) } });
    if (!document) throw new HttpError(404, "Документ не найден");
    const updated = await prisma.document.update({
      where: { id: document.id },
      data: {
        status: body.status,
        reviewComment: body.reviewComment || null,
        reviewedById: req.user!.id,
      },
    });
    await writeAudit(prisma, req.user!.id, "Проверка документа", "Document", document.id, { status: body.status });
    res.json({ document: updated });
  }),
);
