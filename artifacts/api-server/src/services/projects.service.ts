import { getDb, type Project } from "@workspace/db";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { slugify } from "../lib/hashing.js";
import * as projectsRepo from "../repositories/projects.repo.js";
import * as membersRepo from "../repositories/members.repo.js";

export interface CreateProjectInput {
  name: string;
  description: string;
  framework?: string | null;
  framework_context?: Record<string, unknown> | null;
  slug?: string | null;
}

async function uniqueSlug(base: string): Promise<string> {
  const db = getDb();
  let slug = slugify(base);
  if (!slug) slug = "project";
  let attempt = slug;
  let i = 1;
  while (await projectsRepo.findBySlug(db, attempt)) {
    i += 1;
    attempt = `${slug}-${i}`;
  }
  return attempt;
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const db = getDb();
  const slug = await uniqueSlug(input.slug ?? input.name);

  if (input.slug) {
    const existing = await projectsRepo.findBySlug(db, input.slug);
    if (existing) {
      throw new ConflictError(
        "PROJECT_SLUG_TAKEN",
        `El slug "${input.slug}" ya existe`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const project = await projectsRepo.insert(tx, {
      name: input.name,
      description: input.description,
      framework: input.framework ?? null,
      framework_context: input.framework_context ?? null,
      slug,
      created_by: userId,
    });
    await membersRepo.add(tx, {
      project_id: project.id,
      user_id: userId,
      role: "owner",
    });
    return project;
  });
}

export async function getProjectForUser(
  userId: string,
  projectId: string,
): Promise<Project & { role: "owner" | "editor" | "viewer" }> {
  const db = getDb();
  const project = await projectsRepo.findById(db, projectId);
  if (!project) {
    throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado");
  }
  const member = await membersRepo.findOne(db, projectId, userId);
  if (!member) {
    throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado");
  }
  return { ...project, role: member.role as "owner" | "editor" | "viewer" };
}

export async function listMine(userId: string) {
  const db = getDb();
  return projectsRepo.listForUser(db, userId);
}

export async function updateProject(
  projectId: string,
  patch: Partial<CreateProjectInput>,
): Promise<Project> {
  const db = getDb();
  return projectsRepo.update(db, projectId, patch);
}

export async function archiveProject(projectId: string): Promise<Project> {
  const db = getDb();
  return projectsRepo.archive(db, projectId);
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = getDb();
  await projectsRepo.remove(db, projectId);
}
