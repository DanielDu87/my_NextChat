import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  requireAdminContext,
  updateManagedUser,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    await requireAdminContext(req);
    const users = await listManagedUsers();
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminContext(req);
    const payload = (await req.json()) as {
      username?: string;
      password?: string;
      displayName?: string;
      role?: "admin" | "user";
    };
    const user = await createManagedUser({
      username: String(payload?.username || ""),
      password: String(payload?.password || ""),
      displayName: String(payload?.displayName || ""),
      role: payload?.role === "admin" ? "admin" : "user",
    });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const context = await requireAdminContext(req);
    const payload = (await req.json()) as {
      userId?: string;
    };
    const user = await deleteManagedUser({
      actorUserId: context.actor.id,
      userId: String(payload?.userId || ""),
    });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdminContext(req);
    const payload = (await req.json()) as {
      userId?: string;
      username?: string;
      password?: string;
      displayName?: string;
    };
    const user = await updateManagedUser({
      userId: String(payload?.userId || ""),
      username: payload?.username,
      password: payload?.password,
      displayName: payload?.displayName,
    });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}
