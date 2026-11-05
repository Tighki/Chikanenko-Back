import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { notificationRouter } from "./routes/notifications.js";
import { documentRouter } from "./routes/documents.js";
import { staffRouter } from "./routes/staff.js";
import { housingRouter } from "./routes/housing.js";
import { settlementRouter } from "./routes/settlement.js";
import { importRouter } from "./routes/import.js";
import { adminRouter, campaignRouter } from "./routes/admin.js";
import { errorHandler } from "./middleware/error.js";
import { config } from "./config.js";

export const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/auth", authRouter);
app.use("/api/campaign", campaignRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/documents", documentRouter);
app.use("/api/staff", staffRouter);
app.use("/api/housing", housingRouter);
app.use("/api/settlement", settlementRouter);
app.use("/api/import", importRouter);
app.use("/api/admin", adminRouter);
app.use(errorHandler);
