import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { serverRoot } from "../config.js";
import { CATEGORY_TITLES, GENDER_LABELS, fullName } from "../domain/labels.js";

export type DirectionData = {
  orderNumber: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  birthDate?: Date | null;
  gender: "MALE" | "FEMALE" | null;
  faculty: string;
  specialty: string;
  categoryTitle: string;
  building: string;
  address: string;
  room: string;
  bed: number;
  accessible: boolean;
  checkInFrom?: Date | null;
  checkInUntil?: Date | null;
  method: "AUTO" | "MANUAL";
  assignedAt: Date;
};

function fontFile(name: string): string {
  const bundled = path.join(serverRoot, "assets", "fonts", name);
  if (fs.existsSync(bundled)) return bundled;
  const windows = path.join("C:\\Windows\\Fonts", name === "DejaVuSans-Bold.ttf" ? "arialbd.ttf" : "arial.ttf");
  if (fs.existsSync(windows)) return windows;
  throw new Error("Не найден шрифт с поддержкой кириллицы");
}

function formatDate(value?: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(value);
}

export function buildDirectionPdf(data: DirectionData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", fontFile("DejaVuSans.ttf"));
    doc.registerFont("bold", fontFile("DejaVuSans-Bold.ttf"));

    doc.font("body").fontSize(11).fillColor("#5c6675").text("Информационная система заселения в общежитие", {
      align: "center",
    });
    doc.moveDown(0.6);
    doc.font("bold").fontSize(18).fillColor("#1a2332").text("НАПРАВЛЕНИЕ НА ЗАСЕЛЕНИЕ", { align: "center" });
    doc.moveDown(0.3);
    doc.font("body").fontSize(13).text(`№ ${data.orderNumber}`, { align: "center" });
    doc.moveDown(1.2);

    const rows: [string, string][] = [
      ["ФИО", fullName(data)],
      ["Дата рождения", formatDate(data.birthDate)],
      ["Пол", data.gender ? GENDER_LABELS[data.gender] : "—"],
      ["Факультет", data.faculty || "—"],
      ["Направление", data.specialty || "—"],
      ["Льготная категория", data.categoryTitle || CATEGORY_TITLES.NONE],
      ["Корпус", data.building],
      ["Адрес", data.address],
      ["Комната", data.room],
      ["Койка", String(data.bed)],
      ["Доступная среда", data.accessible ? "Да" : "Нет"],
      ["Заселение с", formatDate(data.checkInFrom)],
      ["Заселение по", formatDate(data.checkInUntil)],
      ["Способ назначения", data.method === "AUTO" ? "Автоматическое" : "Ручное"],
      ["Дата направления", formatDate(data.assignedAt)],
    ];

    for (const [label, value] of rows) {
      doc.font("bold").fontSize(11).fillColor("#0e4d5c").text(label, { continued: false });
      doc.font("body").fontSize(12).fillColor("#1a2332").text(value);
      doc.moveDown(0.35);
    }

    doc.moveDown(1.4);
    doc.font("body").fontSize(11).fillColor("#1a2332").text("Комендант общежития ____________________");
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor("#5c6675").text("Документ сформирован автоматически и действителен вместе с паспортом.");
    doc.end();
  });
}
