import { Router } from "express";
import { z } from "zod";
import * as authService from "../services/auth.service.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import * as usersRepo from "../repositories/users.repo.js";
import { getDb } from "@workspace/db";
import { UnauthenticatedError } from "../lib/errors.js";

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
  name: z.string().min(2).max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateMeSchema = z.object({
  name: z.string().min(2).max(120).optional(),
});

authRouter.post("/signup", async (req, res, next) => {
  try {
    const body = signupSchema.parse(req.body);
    const user = await authService.signup(body);
    req.session.user = { id: user.id, email: user.email, name: user.name };
    res.status(201).json(authService.toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await authService.login(body);
    req.session.user = { id: user.id, email: user.email, name: user.name };
    res.json(authService.toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(req.app.get("cookieName") ?? "assetmgr.sid");
    res.status(204).end();
  });
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const sessionUser = req.session.user!;
    const user = await usersRepo.findById(getDb(), sessionUser.id);
    if (!user) throw new UnauthenticatedError();
    res.json(authService.toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

authRouter.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const body = updateMeSchema.parse(req.body);
    const sessionUser = req.session.user!;
    const updated = await usersRepo.updateProfile(getDb(), sessionUser.id, body);
    req.session.user = {
      id: updated.id,
      email: updated.email,
      name: updated.name,
    };
    res.json(authService.toPublicUser(updated));
  } catch (err) {
    next(err);
  }
});
