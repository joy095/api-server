import { Hono } from "hono";
import { Bindings } from "..";
import { verifyBetterAuthJWT } from "../middleware/authMiddleware";
import {
  addCertificate,
  addDoctorExperience,
  createDoctor,
  deleteCertificate,
  deleteDoctorExperience,
  deleteDoctor,
  getDoctor,
  listCertificates,
  listDoctorExperiences,
  updateDoctor,
  updateDoctorExperience,
  checkDoctorSlug,
  updateCertificate,
} from "../controllers/doctor.controller";
import {
  CreateCertificateSchema,
  CreateDoctorSchema,
  CreateExperienceSchema,
  UpdateCertificateSchema,
  UpdateDoctorSchema,
  UpdateExperienceSchema,
} from "../schema/doctor.schema";
import { validateBody } from "../utils/v";
import {
  deleteCertificateImage,
  deleteExperienceImage,
  uploadCertificateImage,
  uploadExperienceImage,
} from "../controllers/doctor-image.controller";

type AppEnv = { Bindings: Bindings };

const doctorRouter = new Hono<AppEnv>();

doctorRouter.post(
  "/",
  verifyBetterAuthJWT,
  validateBody(CreateDoctorSchema),
  createDoctor,
);

doctorRouter.get("/check-slug", verifyBetterAuthJWT, checkDoctorSlug);

doctorRouter.get("/:slug", getDoctor);

doctorRouter.patch(
  "/:slug",
  verifyBetterAuthJWT,
  validateBody(UpdateDoctorSchema),
  updateDoctor,
);

doctorRouter.delete("/:slug", verifyBetterAuthJWT, deleteDoctor);

// ─── Experience ───────────────────────────────────────────────────────────────

doctorRouter.get("/:slug/experience", listDoctorExperiences);

doctorRouter.post(
  "/:slug/experience",
  verifyBetterAuthJWT,
  validateBody(CreateExperienceSchema),
  addDoctorExperience,
);

doctorRouter.patch(
  "/:slug/experience/:expId",
  verifyBetterAuthJWT,
  validateBody(UpdateExperienceSchema),
  updateDoctorExperience,
);

doctorRouter.delete(
  "/:slug/experience/:expId",
  verifyBetterAuthJWT,
  deleteDoctorExperience,
);

// ─── Certificate ──────────────────────────────────────────────────────────────

doctorRouter.get("/:slug/certificate", listCertificates);

doctorRouter.post(
  "/:slug/certificate",
  verifyBetterAuthJWT,
  validateBody(CreateCertificateSchema),
  addCertificate,
);

doctorRouter.patch(
  "/:slug/certificate/:certId",
  verifyBetterAuthJWT,
  validateBody(UpdateCertificateSchema),
  updateCertificate,
);

doctorRouter.delete(
  "/:slug/certificate/:certId",
  verifyBetterAuthJWT,
  deleteCertificate,
);

// ─── Certificate Image ─────────────────────────────────────────────────────────────

doctorRouter.post("/certificate/:certificateId/image", uploadCertificateImage);

doctorRouter.delete(
  "/certificate/:certificateId/image",
  verifyBetterAuthJWT,
  deleteCertificateImage,
);

doctorRouter.post("/experience/:experienceId/image", uploadExperienceImage);

doctorRouter.delete(
  "/experience/:experienceId/image",
  verifyBetterAuthJWT,
  deleteExperienceImage,
);

export default doctorRouter;
