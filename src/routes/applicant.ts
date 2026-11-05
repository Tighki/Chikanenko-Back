import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { uploadDocument } from "../middleware/upload.js";
import { campaignIsOpen, missingDocumentLabels, requiredDocumentGroups, DOCUMENT_LABELS, CATEGORY_TITLES, fullName } from "../domain/labels.js";
import { distanceKmFromCity } from "../domain/distance.js";
import { isDocumentType, profileLocked, profileProblems } from "../domain/profile.js";
import { writeAudit } from "../services/audit.js";
import { buildDirectionPdf } from "../services/pdf.js";

const profileSchema = z.object({
  lastName: z.string().trim().min(1, "Укажите фамилию").max(80),
  firstName: z.string().trim().min(1, "Укажите имя").max(80),
  middleName: z.string().trim().max(80).optional().or(z.literal("")),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД").optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE"], { message: "Укажите пол" }),
  city: z.string().trim().min(1, "Укажите город").max(80),
  region: z.string().trim().min(1, "Укажите регион").max(120),
  street: z.string().trim().max(120).optional().or(z.literal("")),
  house: z.string().trim().max(20).optional().or(z.literal("")),
  apartment: z.string().trim().max(20).optional().or(z.literal("")),
  faculty: z.string().trim().min(1, "Укажите факультет").max(160),
  specialty: z.string().trim().min(1, "Укажите направление").max(160),
  admissionScore: z.coerce.number().int("Балл должен быть целым").min(0, "Балл не меньше 0").max(400, "Балл не больше 400"),
  priorityCategory: z.enum(["ORPHAN", "DISABILITY", "SOCIAL", "OUT_OF_TOWN", "NONE"]),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});

const commentSchema = z.object({
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

async function currentApplicant(userId: string) {
  const applicant = await prisma.applicant.findUnique({
    where: { userId },
    include: {
      user: true,
      application: {
        include: {
          documents: { orderBy: { uploadedAt: "desc" } },
          settlement: { include: { bed: { include: { room: { include: { building: true } } } } } },
        },
      },
    },
  });
  if (!applicant) throw new HttpError(404, "Анкета не найдена");
  return applicant;
}

function campaignDto(campaign: {
  name: string;
  startsAt: Date;
  endsAt: Date;
  checkInFrom: Date;
  checkInUntil: Date;
  active: boolean;
} | null) {
  if (!campaign) return null;
  return { ...campaign, isOpen: campaignIsOpen(campaign) };
}

export const applicantRouter = Router();
applicantRouter.use(requireAuth, requireRoles("APPLICANT"));

applicantRouter.get(
  "/home",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    const campaign = await prisma.campaign.findUnique({ where: { id: "default" } });
    const verified = applicant.application?.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type) ?? [];
    const { user, application, ...profile } = applicant;
    res.json({
      profile: {
        ...profile,
        fullName: fullName(applicant) || user.fullName,
        phone: user.phone,
        email: user.email,
      },
      application,
      campaign: campaignDto(campaign),
      problems: profileProblems(applicant),
      missingDocuments: missingDocumentLabels(applicant.priorityCategory, verified),
      requiredGroups: requiredDocumentGroups(applicant.priorityCategory).map((group) =>
        group.map((type) => ({ type, label: DOCUMENT_LABELS[type] })),
      ),
      profileLocked: profileLocked(applicant.application?.status),
    });
  }),
);

applicantRouter.put(
  "/profile",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    if (profileLocked(applicant.application?.status)) {
      throw new HttpError(400, "Анкету нельзя менять, пока заявка на проверке или место уже рассматривается");
    }
    const body = profileSchema.parse(req.body);
    const updated = await prisma.applicant.update({
      where: { id: applicant.id },
      data: {
        lastName: body.lastName,
        firstName: body.firstName,
        middleName: body.middleName || null,
        birthDate: body.birthDate ? new Date(`${body.birthDate}T00:00:00`) : null,
        gender: body.gender,
        city: body.city,
        region: body.region,
        street: body.street || "",
        house: body.house || "",
        apartment: body.apartment || "",
        distanceKm: distanceKmFromCity(body.city),
        faculty: body.faculty,
        specialty: body.specialty,
        admissionScore: body.admissionScore,
        priorityCategory: body.priorityCategory,
        user: {
          update: {
            fullName: fullName(body),
            phone: body.phone || null,
          },
        },
      },
    });
    res.json({ profile: updated });
  }),
);

applicantRouter.post(
  "/application",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    if (applicant.application) throw new HttpError(400, "Заявка уже создана");
    const campaign = await prisma.campaign.findUnique({ where: { id: "default" } });
    if (!campaign || !campaignIsOpen(campaign)) throw new HttpError(400, "Приём заявок сейчас закрыт");
    const application = await prisma.application.create({
      data: { applicantId: applicant.id, status: "DRAFT" },
    });
    await writeAudit(prisma, req.user!.id, "Создание заявки", "Application", application.id);
    res.status(201).json({ application });
  }),
);

applicantRouter.put(
  "/application",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    if (!applicant.application) throw new HttpError(404, "Сначала создайте заявку");
    if (!["DRAFT", "SUBMITTED", "REJECTED", "CANCELLED"].includes(applicant.application.status)) {
      throw new HttpError(400, "Сейчас заявку нельзя редактировать");
    }
    const body = commentSchema.parse(req.body);
    const application = await prisma.application.update({
      where: { id: applicant.application.id },
      data: { comment: body.comment || null },
    });
    res.json({ application });
  }),
);

applicantRouter.post(
  "/application/submit",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    if (!applicant.application) throw new HttpError(404, "Сначала создайте заявку");
    if (!["DRAFT", "REJECTED", "CANCELLED"].includes(applicant.application.status)) {
      throw new HttpError(400, "Заявка уже подана");
    }
    const campaign = await prisma.campaign.findUnique({ where: { id: "default" } });
    if (!campaign || !campaignIsOpen(campaign)) throw new HttpError(400, "Приём заявок сейчас закрыт");
    const problems = profileProblems(applicant);
    if (problems.length) throw new HttpError(400, problems[0]);
    const present = new Set(applicant.application.documents.filter((doc) => doc.status !== "REJECTED").map((doc) => doc.type));
    const missing = requiredDocumentGroups(applicant.priorityCategory)
      .filter((group) => !group.some((type) => present.has(type)))
      .map((group) => group.map((type) => DOCUMENT_LABELS[type]).join(" или "));
    if (missing.length) throw new HttpError(400, `Приложите документы: ${missing.join(", ")}`);

    const application = await prisma.application.update({
      where: { id: applicant.application.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), staffComment: null },
    });
    const staff = await prisma.user.findMany({ where: { role: { in: ["STAFF", "ADMIN"] } } });
    await prisma.notification.createMany({
      data: staff.map((person) => ({
        userId: person.id,
        title: "Новая заявка на заселение",
        body: `${fullName(applicant)} подал заявку.`,
      })),
    });
    await writeAudit(prisma, req.user!.id, "Подача заявки", "Application", application.id);
    res.json({ application });
  }),
);

applicantRouter.post(
  "/application/cancel",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    if (!applicant.application) throw new HttpError(404, "Заявка не найдена");
    if (["SETTLED", "CANCELLED"].includes(applicant.application.status)) {
      throw new HttpError(400, "Эту заявку нельзя отменить");
    }
    const application = await prisma.application.update({
      where: { id: applicant.application.id },
      data: { status: "CANCELLED" },
    });
    await writeAudit(prisma, req.user!.id, "Отмена заявки", "Application", application.id);
    res.json({ application });
  }),
);

applicantRouter.post(
  "/documents",
  uploadDocument.single("file"),
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    if (!applicant.application) throw new HttpError(400, "Сначала создайте заявку");
    if (!["DRAFT", "SUBMITTED", "REJECTED", "CANCELLED"].includes(applicant.application.status)) {
      throw new HttpError(400, "Сейчас документы менять нельзя");
    }
    const type = String(req.body.type ?? "");
    if (!isDocumentType(type)) throw new HttpError(400, "Неизвестный тип документа");
    if (!req.file) throw new HttpError(400, "Выберите файл");
    const document = await prisma.document.create({
      data: {
        applicationId: applicant.application.id,
        type,
        originalName: req.file.originalname,
        storedName: req.file.filename,
      },
    });
    res.status(201).json({ document });
  }),
);

applicantRouter.get(
  "/direction",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    const settlement = applicant.application?.settlement;
    if (!settlement) throw new HttpError(404, "Направление ещё не сформировано");
    const pdf = await buildDirectionPdf({
      orderNumber: settlement.orderNumber,
      lastName: applicant.lastName,
      firstName: applicant.firstName,
      middleName: applicant.middleName,
      birthDate: applicant.birthDate,
      gender: applicant.gender,
      faculty: applicant.faculty,
      specialty: applicant.specialty,
      categoryTitle: CATEGORY_TITLES[applicant.priorityCategory],
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

applicantRouter.delete(
  "/documents/:id",
  asyncRoute(async (req, res) => {
    const applicant = await currentApplicant(req.user!.id);
    const document = applicant.application?.documents.find((item) => item.id === req.params.id);
    if (!document || !applicant.application) throw new HttpError(404, "Документ не найден");
    if (!["DRAFT", "SUBMITTED", "REJECTED", "CANCELLED"].includes(applicant.application.status)) {
      throw new HttpError(400, "Сейчас документы менять нельзя");
    }
    if (document.status === "VERIFIED") throw new HttpError(400, "Проверенный документ удаляет сотрудник");
    await prisma.document.delete({ where: { id: document.id } });
    const filePath = path.join(config.uploadDir, path.basename(document.storedName));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  }),
);
