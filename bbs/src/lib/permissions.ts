import { Role } from "@prisma/client";
import { auth } from "@/lib/auth";

export { Role };

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireRole(...allowed: Role[]) {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  if (!allowed.includes(session.user.role)) {
    throw new ForbiddenError();
  }
  return session.user;
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  return session.user;
}
