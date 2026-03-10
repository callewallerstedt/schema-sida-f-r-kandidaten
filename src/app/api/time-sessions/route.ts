import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type CheckInBody = {
  action: "check-in";
  userId: string;
};

type CheckOutBody = {
  action: "check-out";
  userId: string;
  note?: string;
};

type UpdateNoteBody = {
  action: "update-note";
  userId: string;
  note?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error.";
}

export async function GET() {
  try {
    const sessions = await prisma.timeSession.findMany({
      orderBy: [{ checkInAt: "desc" }],
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckInBody | CheckOutBody | UpdateNoteBody;

    if (body.action === "check-in") {
      const userId = body.userId?.trim();
      if (!userId) {
        return NextResponse.json({ error: "Missing user ID." }, { status: 400 });
      }

      const existing = await prisma.timeSession.findFirst({
        where: {
          userId: { equals: userId, mode: "insensitive" },
          checkOutAt: null,
        },
      });

      if (existing) {
        return NextResponse.json(
          { error: "User is already checked in." },
          { status: 409 },
        );
      }

      const now = new Date();
      const session = await prisma.timeSession.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          computerId: null,
          checkInAt: now,
          checkOutAt: null,
          note: "",
          createdAt: now,
          updatedAt: now,
        },
      });

      return NextResponse.json({ session }, { status: 201 });
    }

    if (body.action === "check-out") {
      const userId = body.userId?.trim();
      if (!userId) {
        return NextResponse.json({ error: "Missing user ID." }, { status: 400 });
      }

      const existing = await prisma.timeSession.findFirst({
        where: {
          userId: { equals: userId, mode: "insensitive" },
          checkOutAt: null,
        },
      });

      if (!existing) {
        return NextResponse.json(
          { error: "No active session found." },
          { status: 404 },
        );
      }

      const session = await prisma.timeSession.update({
        where: { id: existing.id },
        data: {
          checkOutAt: new Date(),
          note: body.note?.trim() ?? "",
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({ session });
    }

    if (body.action === "update-note") {
      const userId = body.userId?.trim();
      if (!userId) {
        return NextResponse.json({ error: "Missing user ID." }, { status: 400 });
      }

      const existing = await prisma.timeSession.findFirst({
        where: {
          userId: { equals: userId, mode: "insensitive" },
          checkOutAt: null,
        },
      });

      if (!existing) {
        return NextResponse.json(
          { error: "No active session found." },
          { status: 404 },
        );
      }

      const session = await prisma.timeSession.update({
        where: { id: existing.id },
        data: {
          note: body.note ?? "",
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({ session });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
