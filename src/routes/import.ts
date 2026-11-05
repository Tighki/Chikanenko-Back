import bcrypt from "bcryptjs";
import { Router } from "express";
import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma.js";
import { asyncRoute, HttpError } from "../middleware/error.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { uploadSheet } from "../middleware/upload.js";
import { distanceKmFromCity, institute } from "../domain/distance.js";
import { fullName } from "../domain/labels.js";
import { writeAudit } from "../services/audit.js";
import type { Gender, PriorityCategory } from "@prisma/client";

type ImportRow = {
  name: string;
  gender: string;
  birthDate: string;
  city: string;
  region: string;
  street: string;
  house: string;
  apartment: string;
  faculty: string;
  specialty: string;
  score: string;
  category: string;
  email: string;
  phone: string;
};

const headerMap: Record<string, keyof ImportRow> = {
  фио: "name",
  пол: "gender",
  "дата рождения": "birthDate",
  город: "city",
  "населенный пункт": "city",
  "населённый пункт": "city",
  регион: "region",
  улица: "street",
  дом: "house",
  квартира: "apartment",
  кв: "apartment",
  факультет: "faculty",
  направление: "specialty",
  балл: "score",
  категория: "category",
  email: "email",
  "электронная почта": "email",
  телефон: "phone",
};

function cell(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value == null) return "";
  return String(value).trim();
}

function parseGender(value: string): Gender | null {
  const text = value.toLowerCase();
  if (["м", "муж", "мужской", "male", "m"].includes(text)) return "MALE";
  if (["ж", "жен", "женский", "female", "f"].includes(text)) return "FEMALE";
  return null;
}

function parseCategory(value: string): PriorityCategory {
  const text = value.toLowerCase();
  if (!text || ["нет", "без", "без льготы", "none"].includes(text)) return "NONE";
  if (text.includes("сирот")) return "ORPHAN";
  if (text.includes("инвалид")) return "DISABILITY";
  if (text.includes("многодет") || text.includes("малоим") || text.includes("социал")) return "SOCIAL";
  if (text.includes("иногород")) return "OUT_OF_TOWN";
  return "NONE";
}

function parseBirth(value: string): Date | null {
  if (!value) return null;
  const dotted = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) return new Date(`${dotted[3]}-${dotted[2]}-${dotted[1]}T00:00:00`);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(`${value.slice(0, 10)}T00:00:00`);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function splitName(full: string) {
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    lastName: parts[0] ?? "",
    firstName: parts[1] ?? "",
    middleName: parts.slice(2).join(" ") || null,
  };
}

export const importRouter = Router();
importRouter.use(requireAuth, requireRoles("STAFF", "ADMIN"));

importRouter.get("/template", (_req, res) => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["ФИО", "Пол", "Дата рождения", "Город", "Регион", "Улица", "Дом", "Квартира", "Факультет", "Направление", "Балл", "Категория", "Email", "Телефон"],
    ["Иванов Иван Иванович", "м", "2008-05-01", "Тула", "Тульская область", "ул. Ленина", "10", "4", "Институт информационных технологий", "Программная инженерия", 230, "иногородний", "ivanov@example.com", "+79001234567"],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Абитуриенты");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''%D0%B0%D0%B1%D0%B8%D1%82%D1%83%D1%80%D0%B8%D0%B5%D0%BD%D1%82%D1%8B.xlsx");
  res.send(buffer);
});

importRouter.post(
  "/",
  uploadSheet.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Выберите файл");
    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new HttpError(400, "В файле нет листа");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    if (rows.length < 2) throw new HttpError(400, "В файле нет строк с данными");

    const headers = (rows[0] ?? []).map((header) => cell(header).toLowerCase());
    const indexes = new Map<keyof ImportRow, number>();
    headers.forEach((header, index) => {
      const key = headerMap[header];
      if (key) indexes.set(key, index);
    });
    for (const required of ["name", "gender", "email"] as const) {
      if (!indexes.has(required)) throw new HttpError(400, "В шапке нужны колонки ФИО, Пол и Email");
    }

    const created: { email: string; password: string; name: string; distanceKm: number | null }[] = [];
    const updated: { email: string; name: string; distanceKm: number | null }[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let index = 1; index < rows.length; index += 1) {
      const source = rows[index] ?? [];
      const read = (key: keyof ImportRow) => cell(source[indexes.get(key) ?? -1]);
      const email = read("email").toLowerCase();
      const name = read("name");
      if (!email && !name) continue;
      const rowNumber = index + 1;
      try {
        if (!email.includes("@")) throw new Error("Некорректная почта");
        const gender = parseGender(read("gender"));
        if (!gender) throw new Error("Пол должен быть «м» или «ж»");
        const parts = splitName(name);
        if (!parts.lastName || !parts.firstName) throw new Error("ФИО должно содержать фамилию и имя");
        const score = Number(read("score") || 0);
        if (!Number.isInteger(score) || score < 0 || score > 400) throw new Error("Балл должен быть целым от 0 до 400");
        const city = read("city");
        const distanceKm = distanceKmFromCity(city);
        const data = {
          ...parts,
          gender,
          birthDate: parseBirth(read("birthDate")),
          city,
          region: read("region"),
          street: read("street"),
          house: read("house"),
          apartment: read("apartment"),
          distanceKm,
          faculty: read("faculty"),
          specialty: read("specialty"),
          admissionScore: score,
          priorityCategory: parseCategory(read("category")),
          imported: true,
        };
        const phone = read("phone") || null;
        const existing = await prisma.user.findUnique({ where: { email }, include: { applicant: true } });
        if (existing && existing.role !== "APPLICANT") throw new Error("Почта занята сотрудником");
        if (existing?.applicant) {
          await prisma.applicant.update({
            where: { id: existing.applicant.id },
            data: {
              ...data,
              user: { update: { fullName: fullName(data), phone } },
            },
          });
          updated.push({ email, name: fullName(data), distanceKm });
        } else if (existing) {
          throw new Error("Пользователь без анкеты абитуриента");
        } else {
          const password = `Hs${randomBytes(4).toString("hex")}`;
          await prisma.user.create({
            data: {
              email,
              passwordHash: await bcrypt.hash(password, 10),
              role: "APPLICANT",
              fullName: fullName(data),
              phone,
              mustChangePassword: true,
              applicant: { create: data },
            },
          });
          created.push({ email, password, name: fullName(data), distanceKm });
        }
      } catch (error) {
        errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "Ошибка строки" });
      }
    }

    await writeAudit(prisma, req.user!.id, "Импорт списка", "Applicant", null, {
      created: created.length,
      updated: updated.length,
      errors: errors.length,
    });
    res.json({ created, updated, errors, institute });
  }),
);
